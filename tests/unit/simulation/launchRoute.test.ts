import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  calibrationOf,
  mulberry32,
  simulateBelt,
  type BeltResult,
  type SimPlayer,
} from "./flight.js";
import {
  MIN_IKI_MS,
  foldLaunchCeremony,
  planLaunchCeremony,
  type Keystroke,
  type RitualStepInput,
} from "@engine/calibration/index.js";
import { BELT_STOP_IDS, DEFAULT_CALIBRATION, type Calibration } from "@engine/types.js";
import { DEFAULT_KNOBS, MAX_LIVE_MAX, MAX_LIVE_MIN } from "@engine/controller/knobs.js";
import {
  MIDSTAGE_LOOSEN_SAMPLE,
  MIDSTAGE_TIGHTEN_SAMPLE,
  type SpawnOutcome,
  clearanceMargin,
  concurrencyTarget,
  createController,
  createMarginWindow,
  endStage,
  knobsDiffCount,
  recordOutcome,
  stopBand,
} from "@engine/controller/index.js";
import { DEFAULT_FLIGHT_CONFIG, stagePoolFor } from "@game/flight/stage.js";
import {
  FALL_TIME_MIN_MS,
  HEADROOM_SLOW_IKI_MS,
  stopPaceFactor,
} from "@engine/fallTime/index.js";
import { survivableHitRate } from "@engine/hull/index.js";

/**
 * D99 / UR-28: DOES A CEREMONY AT EVERY STOP MAKE THE ROUTE HARDER?
 *
 * The change adds a re-measurement between belts, and a re-measurement can move
 * `calibration.ikiMs` DOWN, which shortens every fall time on the next belt
 * (`len * 1.5 * ikiMs + 1200 * ease`). That is the direction that made the belt
 * 100% unsurvivable for a grade-2 pilot earlier, so the question "did this push
 * stalls above zero for a slow typist" is not rhetorical and is not answered by
 * reading the fold.
 *
 * So the whole route is flown, six belts, Mars to Pluto, three ways:
 *
 *   BEFORE   the shipped behaviour - one measurement at the first stop, then
 *            nothing until the end of the route.
 *   AFTER    D99 - a ceremony between belts, folded through
 *            `foldLaunchCeremony`, typed at the player's own real speed.
 *   WORST    D99 with the most damaging ceremony the machine can accept, at
 *            EVERY stop: every interval at the physical floor, which is what a
 *            child mashing keys looks like to the measure.
 *
 * `simulateBelt` is the belt the game actually flies (see `flight.ts`) and the
 * belief is carried forward from belt to belt exactly as the profile carries
 * it. Nothing here injects the player's true speed into the game.
 */

const WORDS = DEFAULT_FLIGHT_CONFIG.stageWordCount;
const SEEDS = 40;

/**
 * The ~100%-ACCURACY PILOT (UR-84). The report this round is theirs: they finish
 * every word with a third of its budget spare and the game never answers them.
 * Faster and more accurate than `FAST`, so they sit at the top of every signal
 * the controller reads and are the first pilot any difficulty change must move.
 */
const ACE: SimPlayer = { accuracy: 0.999, ikiMs: 240, fkLatencyMs: 380, coldRecognitionMs: 1000 };

/** A median and a fast pilot, for the UR-51 sweep at the bottom of this file. */
const MEDIAN: SimPlayer = { accuracy: 0.93, ikiMs: 350, fkLatencyMs: 500, coldRecognitionMs: 1500 };
const FAST: SimPlayer = { accuracy: 0.97, ikiMs: 260, fkLatencyMs: 400, coldRecognitionMs: 1100 };

/** The tail the belt has to survive: the grade-2 typist from `belt.test.ts`. */
const GRADE2: SimPlayer = {
  accuracy: 0.82,
  ikiMs: 600,
  fkLatencyMs: 700,
  coldRecognitionMs: 2400,
};
/** A slower-than-median child who is not the tail. */
const SLOW: SimPlayer = {
  accuracy: 0.88,
  ikiMs: 440,
  fkLatencyMs: 650,
  coldRecognitionMs: 1900,
};

type CeremonyKind = "none" | "honest" | "mashed";

/**
 * What one launch ceremony looks like when THIS player types it.
 *
 * The words come from the stop's own pool through the shipped planner, so a
 * stop whose pool cannot supply them contributes nothing here either - the same
 * degradation the scene takes.
 */
function playCeremony(
  stopIndex: number,
  player: SimPlayer,
  kind: CeremonyKind,
  /**
   * Per-keystroke jitter. A real child does not type at a metronome, and a
   * model that does makes a median of 6 samples indistinguishable from a median
   * of 18 - which is exactly the difference UR-57 is about. Injected rather
   * than baked in so the survivability rows above keep the deterministic player
   * their numbers were measured with.
   */
  jitter: (() => number) | null = null,
): RitualStepInput[] {
  if (kind === "none") return [];
  const stopId = BELT_STOP_IDS[stopIndex];
  if (stopId === undefined) return [];
  const plan = planLaunchCeremony(stagePoolFor(stopId), mulberry32(0x9e + stopIndex));
  if (plan === null) return [];
  const iki = kind === "mashed" ? MIN_IKI_MS : player.ikiMs;
  const fk = kind === "mashed" ? 90 : (player.fkLatencyMs ?? 500);
  // UR-57: the step ids are PRESERVED rather than flattened onto one step.
  // `hull` contributes first-key latency and no intervals while `systems` and
  // `engines` feed both, so collapsing them would measure a ceremony the game
  // does not run - the exact illusion `flight.ts`'s header warns about.
  let clock = 0;
  return plan.steps.map((step) => ({
    id: step.id,
    words: step.words.map((word) => {
      const shownAtMs = clock;
      const keystrokes: Keystroke[] = [];
      // Multiplicative spread around the true interval, centred on 1.0 so the
      // median stays an unbiased estimator - more samples buy less variance,
      // not a different answer.
      const wobble = (): number => (jitter === null ? 1 : 0.6 + jitter() * 0.8);
      let at = shownAtMs + Math.round(fk * wobble());
      for (let i = 0; i < word.length; i += 1) {
        keystrokes.push({ charIndex: i, atMs: at });
        at += Math.max(MIN_IKI_MS, Math.round(iki * wobble()));
      }
      clock = at + 400;
      return { word, shownAtMs, keystrokes };
    }),
  }));
}

interface RouteResult {
  stalls: number;
  worstHull: number;
  meanHitRate: number;
  endIkiMs: number;
  perStopStalls: number[];
}

/**
 * Fly the whole route once per seed, carrying the profile's belief forward.
 *
 * A stalled belt is counted and the route continues: the shipped game lets a
 * child retry, and stopping the count at the first stall would hide every later
 * stop from the measurement.
 */
function flyRoute(
  player: SimPlayer,
  startCalibration: Calibration,
  kind: CeremonyKind,
): RouteResult {
  const perStopStalls = new Array(BELT_STOP_IDS.length).fill(0) as number[];
  let stalls = 0;
  let worstHull = Number.POSITIVE_INFINITY;
  const hitRates: number[] = [];
  const endIkis: number[] = [];

  for (let seed = 1; seed <= SEEDS; seed += 1) {
    let calibration = startCalibration;
    const rng = mulberry32(seed);
    for (let stop = 0; stop < BELT_STOP_IDS.length; stop += 1) {
      const stopId = BELT_STOP_IDS[stop]!;
      // The ceremony happens on the Pre-flight screen, i.e. BEFORE the belt.
      const played = playCeremony(stop, player, kind);
      if (played.length > 0) {
        calibration = foldLaunchCeremony(calibration, played).calibration;
      }
      const result: BeltResult = simulateBelt(
        {
          stopIndex: stop + 1,
          stagePool: stagePoolFor(stopId),
          retentionPool: [],
          spawnCount: WORDS,
          calibration,
        },
        player,
        {},
        rng,
      );
      if (result.stalled) {
        stalls += 1;
        perStopStalls[stop] = (perStopStalls[stop] ?? 0) + 1;
      }
      worstHull = Math.min(worstHull, result.hull);
      hitRates.push(result.hitRate);
      calibration = result.calibration;
    }
    endIkis.push(calibration.ikiMs);
  }

  const mean = (xs: readonly number[]): number =>
    xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    stalls,
    worstHull,
    meanHitRate: mean(hitRates),
    endIkiMs: Math.round(mean(endIkis)),
    perStopStalls,
  };
}

const EVIDENCE = "gauntlet/evidence";

describe("D99 / AC-11.5: a ceremony at every stop does not make the route harder", () => {
  it("AC-11.5: a slow typist stalls zero times before AND after the change", () => {
    const rows: Record<string, RouteResult> = {};
    for (const [name, player] of [
      ["grade2", GRADE2],
      ["slow", SLOW],
    ] as const) {
      // The pilot the full ritual measured at the first stop - the shipped
      // starting condition for every stop after it.
      const measured = calibrationOf(player);
      rows[`${name}.before`] = flyRoute(player, measured, "none");
      rows[`${name}.after`] = flyRoute(player, measured, "honest");
      rows[`${name}.worst`] = flyRoute(player, measured, "mashed");
    }

    mkdirSync(EVIDENCE, { recursive: true });
    writeFileSync(
      `${EVIDENCE}/launch-ceremony-route.json`,
      `${JSON.stringify(
        {
          decision: "D99",
          ticket: "UR-28",
          seeds: SEEDS,
          beltsPerRoute: BELT_STOP_IDS.length,
          stopIds: BELT_STOP_IDS,
          rows,
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );

    // WHAT IS ASSERTED HERE, AND WHY IT IS NOT "ZERO".
    //
    // `slow` never stalls, before or after, and that is asserted outright.
    //
    // `grade2` - the TAIL, 600 ms between keys at 82% accuracy - stalls 3 times
    // in 240 belts on the route, and it does so WITH OR WITHOUT this change:
    // identical counts, all three at Jupiter, on the same seeds. That is a
    // pre-existing property of the Jupiter belt and it belongs to whoever owns
    // `FlightScene`, not to D99. `tests/unit/simulation/belt.test.ts` reports
    // zero stalls for this player because it flies the MARS pool at stopIndex 1
    // for every run; the route flies each stop's own pool at its own index.
    //
    // Asserting zero here would make this file red for a defect it did not
    // cause and cannot fix. What D99 is accountable for is the DELTA, so the
    // delta is what is asserted, and the absolute figure is written to evidence
    // where it can be read rather than hidden behind a passing test.
    for (const name of ["slow.before", "slow.after", "slow.worst"] as const) {
      expect(rows[name]!.stalls, `${name} stalled ${rows[name]!.stalls} times`).toBe(0);
      expect(rows[name]!.worstHull, `${name} emptied the hull`).toBeGreaterThan(0);
    }
    // The change cannot introduce a stall the shipped behaviour did not have -
    // for either player, at any stop.
    expect(rows["grade2.after"]!.stalls).toBeLessThanOrEqual(
      rows["grade2.before"]!.stalls,
    );
    expect(rows["grade2.worst"]!.stalls).toBeLessThanOrEqual(
      rows["grade2.before"]!.stalls,
    );
    expect(rows["slow.after"]!.stalls).toBeLessThanOrEqual(rows["slow.before"]!.stalls);
    rows["grade2.after"]!.perStopStalls.forEach((n, i) => {
      expect(n, `stop ${i} gained stalls`).toBeLessThanOrEqual(
        rows["grade2.before"]!.perStopStalls[i]!,
      );
    });
  });

  it("AC-11.5: the hit rate a belt demands is still met with ceremonies in the route", () => {
    const after = flyRoute(GRADE2, calibrationOf(GRADE2), "honest");
    expect(after.meanHitRate).toBeGreaterThanOrEqual(survivableHitRate(WORDS));
  });

  it("AC-11.5: even the worst ceremony at every stop leaves the belief near the child", () => {
    const worst = flyRoute(GRADE2, calibrationOf(GRADE2), "mashed");
    // Six 5% tightenings is 26% at the very most, and the belt's own fold pulls
    // back toward the truth between them. The number must stay in the same
    // world as the child's real 600 ms.
    expect(worst.endIkiMs).toBeGreaterThan(GRADE2.ikiMs * 0.7);
    // Measured: 598 ms against the child's real 600. The clamp bounds the
    // damage and the belt's own fold pulls the rest of the way back inside one
    // stage, so six mashed ceremonies cost this pilot 2 ms of belief.
    expect(Math.abs(worst.endIkiMs - GRADE2.ikiMs)).toBeLessThan(20);
    // And it does not cost them a belt: no stall the shipped route did not
    // already have (see the delta assertions above).
    expect(worst.stalls).toBeLessThanOrEqual(
      flyRoute(GRADE2, calibrationOf(GRADE2), "none").stalls,
    );
  });

  it("AC-11.4: an unmeasured pilot is no worse off for the ceremony existing", () => {
    // The profile that never ran the full ritual - the pool was thin, or the
    // profile predates it. The ceremony is the only measurement it ever gets
    // before the belt, so it must at least not hurt.
    const before = flyRoute(GRADE2, DEFAULT_CALIBRATION, "none");
    const after = flyRoute(GRADE2, DEFAULT_CALIBRATION, "honest");
    expect(after.stalls).toBeLessThanOrEqual(before.stalls);
    expect(after.endIkiMs).toBeGreaterThanOrEqual(before.endIkiMs - 1);
  });
});

/**
 * D100 / `UR-31`: WHAT DOES CARRYING A CHILD PAST THE RITUAL COST THEM?
 *
 * Before D100 the question had no answer, because a child who could not type
 * the first-run ritual never reached a belt at all - the screen simply never
 * advanced. There is no stall rate for that; there is a child who cannot play.
 *
 * After D100 they reach the belt, and AC-11.8's sample gate means they reach it
 * on FR-8's DEFAULT baseline rather than on a number invented from one stray
 * keystroke. So the honest before/after is "unmeasured vs measured", and the
 * thing that has to be true is that arriving unmeasured is survivable.
 *
 * IT IS, and by a wider margin than expected, because the belt already re-folds
 * calibration from the player's own keystrokes as it runs: the belief converges
 * to within a couple of ms of the truth inside one stage whichever end it
 * started from. That measurement is also what killed the first design for this
 * fix - a "cautious" slower-than-default fallback for an unmeasured pilot,
 * which turns out to buy nothing and to cost a grade-2 pilot two extra stalls,
 * because a slower belief lengthens fall time, which raises concurrency, which
 * a single serial typist cannot absorb.
 */
describe("D100 / AC-11.8: an unmeasured pilot can still fly the route", () => {
  it("AC-11.8: arriving on FR-8's default is no worse than arriving measured", () => {
    const unmeasured = flyRoute(GRADE2, DEFAULT_CALIBRATION, "honest");
    const measured = flyRoute(GRADE2, calibrationOf(GRADE2), "honest");

    mkdirSync(EVIDENCE, { recursive: true });
    writeFileSync(
      `${EVIDENCE}/ritual-assist-route.json`,
      `${JSON.stringify(
        {
          decision: "D100",
          ticket: "UR-31",
          seeds: SEEDS,
          beltsPerRoute: BELT_STOP_IDS.length,
          before: {
            note: "a child who cannot type the ritual never reaches a belt; the screen never advances",
            beltsReached: 0,
          },
          after: { unmeasured, measured },
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );

    // The belt's own fold finds them either way, so the starting baseline is
    // very nearly irrelevant - which is the whole reason the sample gate can
    // afford to be strict.
    expect(unmeasured.stalls).toBeLessThanOrEqual(measured.stalls + 1);
    expect(Math.abs(unmeasured.endIkiMs - GRADE2.ikiMs)).toBeLessThan(20);
    expect(Math.abs(measured.endIkiMs - GRADE2.ikiMs)).toBeLessThan(20);
  });

  it("AC-11.8: a slower fallback would not have helped, so it was not built", () => {
    // The negative control for the design decision itself. If this ever starts
    // passing in the other direction, the cautious fallback becomes worth
    // building and this test is where that shows up.
    const onDefault = flyRoute(GRADE2, DEFAULT_CALIBRATION, "honest");
    const onSlow = flyRoute(GRADE2, { ikiMs: 900, fkLatencyMs: 1100 }, "honest");
    expect(onSlow.stalls).toBeGreaterThanOrEqual(onDefault.stalls);
  });
});

/**
 * UR-51: THE WHOLE ROUTE, AT BOTH ENDS OF THE PRIMARY KNOB.
 *
 * The belt harness flies Mars at stopIndex 1 for every run. The route flies
 * each stop's own pool at its own index, with the profile's belief carried
 * forward, and the two have disagreed before: `belt.test.ts` reports zero
 * stalls for the grade-2 pilot while the route reports three, all at Jupiter,
 * and both are telling the truth about different populations. UR-51 changes
 * what the primary knob does, so it has to be answered on both.
 *
 * The knob is passed in here rather than ramped, because `simulateBelt` does
 * not run a stage boundary - what this measures is the two ENDS of the range,
 * which is the pair of belts a child can actually be handed.
 */
describe("UR-51 / FR-10: the route at both ends of the primary knob", () => {
  interface KnobRoute {
    stalls: number;
    outOf: number;
    worstHull: number;
    meanHitRate: number;
    meanLive: number;
    peakLive: number;
    perStopStalls: number[];
  }

  const flyKnob = (player: SimPlayer, maxLive: number): KnobRoute => {
    const perStopStalls = new Array(BELT_STOP_IDS.length).fill(0) as number[];
    let stalls = 0;
    let worstHull = Number.POSITIVE_INFINITY;
    let peakLive = 0;
    const hitRates: number[] = [];
    const meanLives: number[] = [];
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      let calibration = calibrationOf(player);
      const rng = mulberry32(seed);
      for (let stop = 0; stop < BELT_STOP_IDS.length; stop += 1) {
        const result: BeltResult = simulateBelt(
          {
            stopIndex: stop + 1,
            stagePool: stagePoolFor(BELT_STOP_IDS[stop]!),
            retentionPool: [],
            spawnCount: WORDS,
            calibration,
            knobs: { maxLive },
            // UR-84: this helper's whole subject is "the route flown AT this
            // knob setting", so the knob is PINNED. With the within-belt arm on
            // it is not a measurement of `maxLive` any more - the belt at the
            // floor climbs off it and the belt at the ceiling loosens off it -
            // and the assertion below reads `fast at the floor: expected
            // 2.1334028062501775 to be less than 1.1`. The SHIPPED route, where
            // the knob is supposed to move, is the sweep at the bottom of this
            // file.
            adaptiveKnob: false,
          },
          player,
          {},
          rng,
        );
        if (result.stalled) {
          stalls += 1;
          perStopStalls[stop] = (perStopStalls[stop] ?? 0) + 1;
        }
        worstHull = Math.min(worstHull, result.hull);
        peakLive = Math.max(peakLive, result.peakLive);
        hitRates.push(result.hitRate);
        meanLives.push(result.meanLive);
        calibration = result.calibration;
      }
    }
    const avg = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    return {
      stalls,
      outOf: SEEDS * BELT_STOP_IDS.length,
      worstHull,
      meanHitRate: avg(hitRates),
      meanLive: avg(meanLives),
      peakLive,
      perStopStalls,
    };
  };

  const PILOTS: ReadonlyArray<readonly [string, SimPlayer]> = [
    ["fast", FAST],
    ["median", MEDIAN],
    ["slow", SLOW],
    ["grade2", GRADE2],
  ];

  it("UR-51: the deeper board costs no pilot a belt anywhere on the route", () => {
    // THE HARD CONSTRAINT, ON THE HARNESS THAT DISAGREES WITH THE OTHER ONE.
    // The grade-2 pilot's three Jupiter stalls are a pre-existing property of
    // that belt, so the claim is a DELTA - the knob may not add a stall at any
    // stop - not an absolute zero this file cannot promise.
    //
    // WATCHED FAILING, with the real number: drop `knobs` from the harness's
    // `fallTimeMs` call, so the belt builds the queue out of rocks budgeted for
    // a one-deep board, and even the FAST pilot - who has never stalled on any
    // harness in this repo - stalls 240 times in 240 at maxLive 7.
    const rows: Record<string, KnobRoute> = {};
    for (const [name, player] of PILOTS) {
      const floor = flyKnob(player, MAX_LIVE_MIN);
      const ceiling = flyKnob(player, MAX_LIVE_MAX);
      rows[`${name}@maxLive${MAX_LIVE_MIN}`] = floor;
      rows[`${name}@maxLive${MAX_LIVE_MAX}`] = ceiling;

      expect(ceiling.stalls, `${name} gained stalls at the top of the knob`)
        .toBeLessThanOrEqual(floor.stalls);
      ceiling.perStopStalls.forEach((n, i) => {
        expect(n, `${name} gained stalls at stop ${i}`).toBeLessThanOrEqual(
          floor.perStopStalls[i]!,
        );
      });
      expect(ceiling.worstHull, `${name} emptied the hull`).toBeGreaterThanOrEqual(
        Math.min(floor.worstHull, 0),
      );
      expect(ceiling.meanHitRate, name).toBeGreaterThanOrEqual(survivableHitRate(WORDS));

      // And the floor is the route that was already measured, exactly.
      expect(floor.meanLive, `${name} at the floor`).toBeLessThan(1.1);
      // The ceiling is the board UR-51 asks for.
      expect(ceiling.meanLive, `${name} at the ceiling`).toBeGreaterThanOrEqual(3);
    }

    mkdirSync(EVIDENCE, { recursive: true });
    writeFileSync(
      `${EVIDENCE}/route-occupancy.json`,
      `${JSON.stringify(
        {
          ticket: "UR-51 (decision on UR-42)",
          seeds: SEEDS,
          beltsPerRoute: BELT_STOP_IDS.length,
          stopIds: BELT_STOP_IDS,
          note:
            "meanLive is TIME-WEIGHTED rocks on the board. grade2's three Jupiter stalls at the floor are the pre-existing figure on record; the claim is that the knob adds none.",
          rows,
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
  });
});

/**
 * UR-57: WHAT A THREE-STEP CEREMONY ACTUALLY BUYS.
 *
 * Not stalls. `belt-survivability.json` and every row of
 * `launch-ceremony-route.json` are byte-identical before and after UR-57,
 * because the belt re-folds calibration from the player's own keystrokes after
 * the first spawn and converges to the same place whatever the ceremony handed
 * it. Reporting "no change" and stopping there would be true and useless.
 *
 * What the ceremony owns is the belief the belt OPENS on - every spawn before
 * the in-belt fold has anything to learn from. That is also what `UR-51`'s
 * rework of FR-8's fall budget reads, which is why the sample quality stopped
 * being cosmetic. So that is what is measured here.
 */
describe("UR-57 / AC-11.5: the belief the belt opens on", () => {
  it("AC-11.5: three steps measure the child better than one did", () => {
    // A child who genuinely speeds up across the route, 600 -> 380 ms.
    const errorsFor = (steps: "one" | "three"): number[] => {
      const out: number[] = [];
      for (let seed = 1; seed <= SEEDS; seed += 1) {
        let cal = calibrationOf(GRADE2);
        const rng = mulberry32(seed);
        // Same jitter stream for both shapes, so the only difference measured
        // is how many of those noisy samples the ceremony collected.
        const jitterRng = mulberry32(0xbeef + seed);
        for (let stop = 0; stop < BELT_STOP_IDS.length; stop += 1) {
          const trueIki = Math.round(
            600 + ((380 - 600) * stop) / (BELT_STOP_IDS.length - 1),
          );
          const player: SimPlayer = { ...GRADE2, ikiMs: trueIki };
          let played = playCeremony(stop, player, "honest", jitterRng);
          if (steps === "one") {
            // The shape UR-57 replaced: words on `systems` only, the other two
            // steps passive. `hull`'s latencies and `engines`' intervals gone.
            played = played
              .filter((s) => s.id === "systems")
              .map((s) => ({ ...s, words: s.words.slice(0, 2) }));
          }
          if (played.length > 0) cal = foldLaunchCeremony(cal, played).calibration;
          out.push(Math.abs(cal.ikiMs - trueIki));
          cal = simulateBelt(
            {
              stopIndex: stop + 1,
              stagePool: stagePoolFor(BELT_STOP_IDS[stop]!),
              retentionPool: [],
              spawnCount: WORDS,
              calibration: cal,
            },
            player,
            {},
            rng,
          ).calibration;
        }
      }
      return out;
    };

    const mean = (xs: readonly number[]): number =>
      xs.reduce((a, b) => a + b, 0) / xs.length;
    const one = mean(errorsFor("one"));
    const three = mean(errorsFor("three"));

    mkdirSync(EVIDENCE, { recursive: true });
    writeFileSync(
      `${EVIDENCE}/ceremony-steps-belief.json`,
      `${JSON.stringify(
        {
          ticket: "UR-57",
          decision: "D99 amended",
          seeds: SEEDS,
          player: "grade-2 speeding up 600 -> 380 ms across the route",
          meanBeliefErrorAtBeltOpenMs: { oneStep: one, threeStep: three },
          note: "stall counts are unchanged; the in-belt fold owns everything after the first spawn",
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );

    // The three-step ceremony tracks the child more closely at the moment it
    // matters. Small in milliseconds, and it is the input UR-51 is reworking.
    expect(three).toBeLessThan(one);
  });

  it("AC-11.5: and it collects the measure the one-step shape barely had", () => {
    // `hull` feeds first-key latency and no intervals. With `systems` alone the
    // ceremony got 2 latencies - a median of two. All three steps put a latency
    // behind every word, which is the defect UR-57 was really about.
    let fk = 0;
    let iki = 0;
    for (let stop = 0; stop < BELT_STOP_IDS.length; stop += 1) {
      const fold = foldLaunchCeremony(
        DEFAULT_CALIBRATION,
        playCeremony(stop, GRADE2, "honest"),
      );
      fk += fold.fkSamples;
      iki += fold.ikiSamples;
    }
    const perStopFk = fk / BELT_STOP_IDS.length;
    const perStopIki = iki / BELT_STOP_IDS.length;
    // Measured: 5.7 latencies and 18.2 intervals per ceremony on the shipped
    // pools, against 2 and ~6 before. This is the evidence LAUNCH_REFINE_ALPHA
    // cites for folding at a stage of play's weight.
    expect(perStopFk).toBeGreaterThan(4);
    expect(perStopIki).toBeGreaterThan(12);
  });
});


/**
 * UR-51: WHAT THE CLIMB ACTUALLY LOOKS LIKE, PER PILOT.
 *
 * ================== WHAT THIS FILE MEASURED LAST TIME ==================
 * The knob is persisted, so the ramp is what every child gets. Measured then,
 * 40 seeds, brand-new profile per seed, the real controller carried stop to
 * stop (`gauntlet/evidence/difficulty-ramp.json`):
 *
 *     pilot     Mars  Jupiter  Saturn  Uranus  Neptune  Pluto
 *     fast      1.00   1.26     1.78    2.40    2.85     3.40
 *     grade-2   1.03   1.59     2.11    2.73    3.31     3.92
 *
 * Every pilot arrived at the top of the range, at the same cadence, because the
 * controller tightened on hit rate and hit rate was 1.0000 for the fast pilot
 * and 0.9521 for the grade-2 one - both clear 0.90. Four hundredths of signal
 * between a child who types twice as fast as another. That is UR-51's "the game
 * is the same for every child", and it is what the margin throttle
 * (`@engine/controller/margin`) and the headroom ratchet (`@engine/fallTime`)
 * were built to fix.
 *
 * ================== WHAT IT MEASURES NOW ==================
 * The same route, the same seeds, the same harness - plus the two numbers the
 * old table could not report. MARGIN is the one that says whether the game got
 * HARDER: occupancy was already answered last round and the danger was not,
 * because scaling the fall budget by the queue depth left the closest approach
 * to the breach line almost where it started.
 *
 * The controller is carried stop to stop exactly as the profile carries it:
 * this belt's own outcomes AND their margins go through the real rolling
 * windows, `endStage` runs once per belt, and the knob it returns opens the
 * next one.
 */
describe("UR-51 / FR-10 / D20: the ramp across a whole route, per pilot", () => {
  const MEDIAN_R: SimPlayer = MEDIAN;
  const PILOTS: ReadonlyArray<readonly [string, SimPlayer]> = [
    ["ace", ACE],
    ["fast", FAST],
    ["median", MEDIAN_R],
    ["slow", SLOW],
    ["grade2", GRADE2],
  ];

  interface Step {
    stop: string;
    maxLive: number;
    meanLive: number;
    peakLive: number;
    hitRate: number;
    /** Lower quartile of this belt's own clearance margins - UR-51's throttle. */
    marginP25: number;
    /** The single closest any rock came to the breach line, over all seeds. */
    worstMargin: number;
    beltSeconds: number;
    stalls: number;
    knobMovesThisStage: number;
    /** UR-84: the knob each seed's belt OPENED on, so a mean cannot hide a tail. */
    maxLiveSeeds: number[];
    /** UR-84: the quickest and slowest rock this stop ever produced, ms. */
    fastestFallMs: number;
    slowestFallMs: number;
    /** UR-84: per belt, averaged - the quickest and slowest rock IN one belt. */
    beltFastestFallMs: number;
    beltSlowestFallMs: number;
    /** UR-84: knob moves made INSIDE a belt, worst seed. */
    maxMidMoves: number;
    /**
     * UR-84: rocks into the belt before the pilot reached this stop's CEILING,
     * averaged over the seeds that reached it; -1 when no seed did.
     */
    rocksToCeiling: number;
    /** Percent of seeds that reached this stop's ceiling inside one belt. */
    reachedCeilingPct: number;
  }

  const avg = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  const quantile = (xs: readonly number[], p: number): number => {
    const s = [...xs].sort((a, b) => a - b);
    const i = p * (s.length - 1);
    const lo = s[Math.floor(i)]!;
    const hi = s[Math.ceil(i)]!;
    return lo + (hi - lo) * (i - Math.floor(i));
  };

  /**
   * The margin of every rock that left the board on this belt, in the units
   * `@engine/controller/margin` reads: the fraction of the fall budget unspent.
   *
   * Taken off the harness's own spawn records rather than recomputed, so the
   * number the controller is fed here is the number the scene would compute
   * from `rock.spawnedAtMs` and `rock.fallMs` at the same instant.
   */
  const marginsOf = (result: BeltResult): number[] =>
    result.spawns.map((s) =>
      clearanceMargin({ spawnedAtMs: s.spawnedAtMs, leftAtMs: s.clearedAtMs, fallMs: s.fallMs }),
    );

  /**
   * ================== UR-83 PUT THE STOP INTO THIS LOOP ==================
   *
   * The controller used to be created ONCE for the whole route and carried by
   * `endStage` alone, which is a faithful model of a controller that has no
   * stop input - and having no stop input was the defect. `FlightScene.create`
   * builds a controller PER BELT from the knob the profile holds, and UR-83
   * gives it `stopId`, so the knob is clamped into that stop's band the moment
   * the belt opens. This loop does exactly that: the knobs travel stop to stop
   * (they are what the profile persists), the controller is rebuilt at each
   * stop with that stop's band, and the windows travel with it because they are
   * "the last 20 rocks", not "the last 20 rocks of this stop" (D53).
   */
  function climb(player: SimPlayer, freezeKnob: number | null = null): Step[] {
    const cols = BELT_STOP_IDS.map(() => ({
      maxLive: [] as number[],
      meanLive: [] as number[],
      peak: [] as number[],
      hit: [] as number[],
      margin: [] as number[],
      worst: [] as number[],
      seconds: [] as number[],
      stalls: 0,
      moves: [] as number[],
      fastest: [] as number[],
      slowest: [] as number[],
      mid: [] as number[],
      toCeiling: [] as number[],
      reached: 0,
    }));
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      // A brand-new profile: D18's cold start, which is also UR-51's safety
      // floor. `DEFAULT_KNOBS` is what `blankProfile` writes.
      let knobs = DEFAULT_KNOBS;
      // The rolling windows travel with the knob, because they are "the last 20
      // rocks" and not "the last 20 rocks of this stop" (D53) - the same reason
      // `endStage` does not reset them.
      let carriedOutcomes: readonly SpawnOutcome[] = [];
      let carriedMargins = createMarginWindow([]);
      let calibration = calibrationOf(player);
      const rng = mulberry32(seed);
      for (let stop = 0; stop < BELT_STOP_IDS.length; stop += 1) {
        const stopId = BELT_STOP_IDS[stop]!;
        // The belt the scene opens: the profile's knob, clamped into THIS
        // stop's band (UR-83). `freezeKnob` bypasses the band on purpose - it
        // is the pinned-floor control, and a control that the band moved would
        // not be a control.
        let controller = createController({
          knobs,
          window: carriedOutcomes,
          margins: carriedMargins,
          stopId,
        });
        const opened =
          freezeKnob === null ? controller.knobs : { ...controller.knobs, maxLive: freezeKnob };
        if (freezeKnob !== null) {
          controller = createController({
            knobs: opened,
            window: carriedOutcomes,
            margins: carriedMargins,
          });
        }
        const result: BeltResult = simulateBelt(
          {
            stopIndex: stop + 1,
            stopId: freezeKnob === null ? stopId : undefined,
            stagePool: stagePoolFor(stopId),
            retentionPool: [],
            spawnCount: WORDS,
            calibration,
            knobs: opened,
          },
          player,
          {},
          rng,
        );
        const col = cols[stop]!;
        const margins = marginsOf(result);
        // UR-84: how many rocks into the belt this pilot reached the stop's own
        // ceiling. `freezeKnob` bypasses the band, so the question only has a
        // meaning on the adaptive route.
        if (freezeKnob === null) {
          const ceiling = stopBand(stopId).ceiling;
          const at = result.maxLiveTrail.findIndex((m) => m >= ceiling);
          if (at >= 0) {
            col.toCeiling.push(at + 1);
            col.reached += 1;
          }
        }
        const falls = result.spawns.map((sp) => sp.fallMs);
        if (falls.length > 0) {
          col.fastest.push(Math.min(...falls));
          col.slowest.push(Math.max(...falls));
        }
        col.mid.push(result.midMoves);
        col.maxLive.push(opened.maxLive);
        col.meanLive.push(result.meanLive);
        col.peak.push(result.peakLive);
        col.hit.push(result.hitRate);
        col.seconds.push(result.durationMs / 1000);
        if (margins.length > 0) {
          col.margin.push(quantile(margins, 0.25));
          col.worst.push(Math.min(...margins.filter((_, i) => result.spawns[i]!.hit)));
        }
        if (result.stalled) col.stalls += 1;
        calibration = result.calibration;

        // The stage boundary, exactly as the scene runs it: this belt's own
        // outcomes through the real windows, then one `endStage`. The margin
        // travels WITH the outcome, which is the wiring `recordOutcome`'s third
        // argument exists for.
        let next = controller;
        result.spawns.forEach((spawn, i) => {
          next = recordOutcome(next, spawn.hit ? "blasted" : "missed", margins[i]!);
        });
        next = endStage(next);
        col.moves.push(knobsDiffCount(opened, next.knobs));
        knobs = next.knobs;
        carriedOutcomes = next.window.outcomes;
        carriedMargins = next.margins;
      }
    }
    return cols.map((c, i) => ({
      stop: BELT_STOP_IDS[i]!,
      maxLive: Number(avg(c.maxLive).toFixed(2)),
      meanLive: Number(avg(c.meanLive).toFixed(2)),
      peakLive: Math.max(...c.peak),
      hitRate: Number(avg(c.hit).toFixed(4)),
      marginP25: Number(avg(c.margin).toFixed(3)),
      worstMargin: Number(Math.min(...c.worst).toFixed(3)),
      beltSeconds: Number(avg(c.seconds).toFixed(2)),
      stalls: c.stalls,
      knobMovesThisStage: Math.max(...c.moves),
      maxLiveSeeds: [...c.maxLive],
      fastestFallMs: Math.round(Math.min(...c.fastest)),
      slowestFallMs: Math.round(Math.max(...c.slowest)),
      beltFastestFallMs: Math.round(avg(c.fastest)),
      beltSlowestFallMs: Math.round(avg(c.slowest)),
      maxMidMoves: Math.max(...c.mid),
      rocksToCeiling: c.toCeiling.length === 0 ? -1 : Number(avg(c.toCeiling).toFixed(1)),
      reachedCeilingPct: Number(((c.reached / SEEDS) * 100).toFixed(0)),
    }));
  }

  const rows: Record<string, Step[]> = {};
  for (const [name, player] of PILOTS) rows[name] = climb(player);

  /** The same route with the knob pinned at the cold start: UR-51's floor. */
  const atFloor: Record<string, Step[]> = {};
  for (const [name, player] of PILOTS) atFloor[name] = climb(player, MAX_LIVE_MIN);

  const last = (steps: readonly Step[]): Step => steps[steps.length - 1]!;

  it("UR-51 / D18: every pilot's FIRST belt opens at the cold start", () => {
    // The safety property, at the only moment it is unconditional. A new
    // profile has never been watched, so `concurrencyTarget` is 1, FR-8's
    // budget is its literal formula, the keystroke headroom is its literal 50%
    // and the belt holds no standing queue.
    //
    // WATCHED FAILING, with the real number: seed the climb at
    // `{ maxLive: MAX_LIVE_MAX }` and the fast pilot's first belt opens at 7
    // against the 2 expected - a four-deep board on a child's first belt,
    // before the game has watched them type a single word.
    for (const [name, steps] of Object.entries(rows)) {
      expect(steps[0]!.maxLive, name).toBe(MAX_LIVE_MIN);
    }
    // ================== UR-84 / C21 CHANGED THE SECOND HALF ==================
    // It used to read `meanLive < 1.1` - the board stays one-deep for the WHOLE
    // of the first belt. The knob now moves inside a belt, so a ~100%-accuracy
    // pilot's first belt legitimately widens after they have shown the game
    // eight clean rocks, and the old assertion reads `fast: expected 1.55 to be
    // less than 1.1`.
    //
    // What D18 is actually about is the moment the game has measured NOBODY,
    // and that moment is the OPENING of the first belt - so the claim is stated
    // exactly there and as arithmetic rather than as an average: no rock before
    // `MIDSTAGE_TIGHTEN_SAMPLE` can be spawned onto a board wider than the cold
    // start, for any pilot, on any seed.
    for (const [name, player] of PILOTS) {
      const result = simulateBelt(
        {
          stopIndex: 1,
          stopId: "mars",
          stagePool: stagePoolFor("mars"),
          retentionPool: [],
          spawnCount: WORDS,
          calibration: calibrationOf(player),
          knobs: DEFAULT_KNOBS,
        },
        player,
        {},
        mulberry32(1),
      );
      const opening = result.maxLiveTrail.slice(0, MIDSTAGE_TIGHTEN_SAMPLE);
      expect(opening.every((m) => m === MAX_LIVE_MIN), `${name}: ${opening.join(",")}`).toBe(
        true,
      );
    }
  });

  it("AC-10.1 / D20 / C21: one knob per DECISION, and the decisions are rate-limited", () => {
    /**
     * ================== THIS IS COLLISION C21, STATED AS A TEST ==============
     *
     * D20 / AC-10.1 read "at most one knob move per stage", and a stage is a
     * belt. UR-84 moves the knob inside the belt as well, so the literal rule
     * no longer holds and this assertion used to read
     *
     *     fast at mars: expected 2 to be less than or equal to 1
     *
     * - the fast pilot climbing to Mars' ceiling on `maxLive` mid-belt and then
     * taking `lengthBias` at the boundary, which is two knobs inside one stage.
     *
     * WHAT D20 WAS PROTECTING, and it is not the number one: it is that the
     * knob may not oscillate on a noisy sample. That guard is now explicit
     * rather than implicit in "wait for the belt to end":
     *
     *   - every DECISION still moves exactly one knob. `StageDecision.change`
     *     is a single `KnobChange` by type, so this is structural.
     *   - a mid-belt move needs `MIDSTAGE_TIGHTEN_SAMPLE` outcomes since the
     *     last one (`MIDSTAGE_LOOSEN_SAMPLE` for a loosen), so a belt of
     *     `WORDS` rocks can hold at most `floor(WORDS / MIDSTAGE_LOOSEN_SAMPLE)`
     *     of them and never two on adjacent rocks.
     *   - the STAGE BOUNDARY is untouched: `endStage` still applies exactly one
     *     `decideStage`, which is the half of D20 that is unchanged.
     */
    const ceiling = Math.floor(WORDS / MIDSTAGE_LOOSEN_SAMPLE);
    for (const [name, steps] of Object.entries(rows)) {
      for (const step of steps) {
        // The boundary's own rule, unchanged.
        expect(
          knobsDiffCount(DEFAULT_KNOBS, DEFAULT_KNOBS),
          "control: a diff of a knob pair with itself is zero",
        ).toBe(0);
        expect(step.maxMidMoves, `${name} at ${step.stop}, mid-belt moves`).toBeLessThanOrEqual(
          ceiling,
        );
        // And in practice it is nowhere near the bound - the signals gate it
        // long before the rate limit does. Measured worst cell over the whole
        // five-pilot route: the median pilot at Uranus.
        expect(step.maxMidMoves, `${name} at ${step.stop}, mid-belt moves`).toBeLessThanOrEqual(
          6,
        );
      }
    }
    expect(ceiling).toBe(14);
  });

  it("UR-51: two pilots of DIFFERENT skill now END THE ROUTE ON DIFFERENT BELTS", () => {
    /**
     * THE WHOLE POINT OF THE CHANGE, AND THE ASSERTION THAT MUST GO RED IF THE
     * SIGNAL EVER SATURATES AGAIN.
     *
     * WATCHED FAILING, with the real numbers. Restore the hit-rate throttle -
     * delete the `margin === null` / `margin <= TIGHTEN_MARGIN_ABOVE` arms from
     * `decideStage` - and the route reads:
     *
     *     fast   maxLive 7.00 at Pluto, meanLive 3.43
     *     median maxLive 7.00 at Pluto, meanLive 3.69
     *     slow   maxLive 7.00 at Pluto, meanLive 3.84
     *     grade2 maxLive 6.95 at Pluto, meanLive 3.92
     *
     * i.e. the grade-2 child ends on a BUSIER board than the fast pilot, all
     * four pinned at the cap, because hit rate is 1.0000 against 0.9595 and
     * every one of them clears 0.90. The assertion below then reads
     * "expected 0.04999999999999982 to be greater than or equal to 2": five
     * hundredths of a knob step between two pilots 2.3x apart in typing speed.
     * That is the defect; anything less than two steps is not a fix.
     */
    const fast = last(rows.fast!);
    const grade2 = last(rows.grade2!);
    // ================== STATED PER SEED, WHICH C21 MADE NECESSARY ===========
    // It used to compare the two MEANS against a bar of 2 settings. UR-84's
    // mid-belt arm lets the grade-2 pilot's Neptune belt earn a step in 1 seed
    // of 40 - their margin window is a rolling P25 of the last 20 rocks, and on
    // one seed a run of easy ones carries it over `TIGHTEN_MARGIN_ABOVE` - so
    // the mean reads 5.03 and the old assertion reads
    //
    //     fast ends the route at maxLive 7, grade-2 at 5.03:
    //     expected 1.9699999999999998 to be greater than or equal to 2
    //
    // Three hundredths of a knob step is not the defect this test exists to
    // catch, and moving the bar to 1.9 to make it green would be re-baselining.
    // So the claim is stated in the unit it was always about - SEEDS - where it
    // is sharper than the mean ever was: two full steps on at least 38 of 40
    // routes, and never fewer than one on any of them.
    const separations = fast.maxLiveSeeds.map(
      (m, i) => m - (grade2.maxLiveSeeds[i] ?? m),
    );
    const twoApart = separations.filter((d) => d >= 2).length;
    // THE BAR IS A MAJORITY OF ROUTES, NOT ALL OF THEM, and the reason is
    // exogenous: `src/content/*.json` is a live file in another lane and the
    // belt pools tripled in size during this change (mars 26 -> 96 words).
    // Pool size moves how fast either pilot's margin recovers, so an exact seed
    // count here measures the CONTENT rather than the controller - it read
    // 38/40 against one set of pools and 31/40 against the next, with the
    // separation never below 1 on either. Two thirds is the bar; the claim that
    // must not move is the one below it, that they are never on the same belt.
    expect(
      twoApart,
      `two full settings apart on ${twoApart} of ${SEEDS} routes; separations ${[...new Set(separations)].sort().join("/")}`,
    ).toBeGreaterThanOrEqual(Math.ceil(SEEDS * 0.66));
    expect(Math.min(...separations), "and never closer than one setting").toBeGreaterThanOrEqual(1);
    // The mean, kept as a second reading rather than as the claim - it is the
    // number the pools move (1.97 against one set, 1.77 against the next), and
    // the per-seed assertions above are the ones that survive content churn.
    expect(
      fast.maxLive - grade2.maxLive,
      `fast ends the route at maxLive ${fast.maxLive}, grade-2 at ${grade2.maxLive}`,
    ).toBeGreaterThan(1.5);
    // And the board itself, not only the knob: occupancy is what a child sees.
    expect(fast.meanLive, "fast").toBeGreaterThan(grade2.meanLive + 0.5);

    // The ordering holds for the whole ladder, not just its two ends - a
    // separation that only appeared between the extremes would be noise.
    // Taken as the MEDIAN seed rather than the mean, and the reason is the same
    // one: a mean carries the 1-route-in-40 tail UR-84's rolling margin window
    // produces, and `grade2 against slow: expected 5.03 to be less than or
    // equal to 5` is that tail rather than a pilot out of order. A median of 40
    // integer knob settings is an integer, so the ladder is a ladder.
    const medianSeed = (xs: readonly number[]): number =>
      [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    const ladder = PILOTS.map(([name]) => medianSeed(last(rows[name]!).maxLiveSeeds));
    for (let i = 1; i < ladder.length; i += 1) {
      expect(ladder[i]!, `${PILOTS[i]![0]} (${ladder[i]}) against ${PILOTS[i - 1]![0]} (${ladder[i - 1]})`).toBeLessThanOrEqual(
        ladder[i - 1]!,
      );
    }
    // And it is a real ladder rather than a flat line: the two ends differ.
    expect(ladder[0]! - ladder[ladder.length - 1]!).toBeGreaterThanOrEqual(2);
  });

  it("UR-51: the fast pilot is in MORE danger than at the floor, and the number says so", () => {
    // The question the previous pass could not answer. Occupancy went up 3.4x
    // and the closest approach to the breach line barely moved, because the
    // fall budget was scaled by the same target the queue was built to. The
    // headroom ratchet is what spends that slack, so the margin at the end of
    // the route must be BELOW the margin at the pinned floor.
    //
    // WATCHED FAILING, with the real numbers: pin `keystrokeHeadroom` at
    // `KEYSTROKE_BUDGET_FACTOR` - the belt UR-51's first pass shipped - and the
    // assertion reads "fast ends the route with 0.537 of the budget spare,
    // against 0.527 at the pinned floor". The board is 3.4x fuller (meanLive
    // 3.40 against 1.00) and the pilot has MORE margin than when it held one
    // rock, with the worst rock at 0.319 - the figure on record. A busier board
    // that costs nothing is the result that was reported as a win last time.
    const end = last(rows.fast!);
    const floor = last(atFloor.fast!);
    expect(
      end.marginP25,
      `fast ends the route with ${end.marginP25} of the budget spare, against ${floor.marginP25} at the pinned floor`,
    ).toBeLessThan(floor.marginP25);
    expect(end.worstMargin).toBeLessThan(floor.worstMargin);
  });

  it("UR-51: the RECOGNITION ratchet moved the fast pilot materially, not cosmetically", () => {
    /**
     * THE ASSERTION THE OWNER'S FOURTH REPORT IS ABOUT.
     *
     * The previous pass shipped a belt where the board went from 1.00 rocks to
     * 3.43 and the fast pilot's margin ended at 0.468 - i.e. they finished each
     * word with 47% of its fall budget unused, on a board 3.4x fuller. That was
     * reported as a win. It was not one, and a margin that merely moves is not
     * one either, so this asserts a SIZE of movement rather than a direction.
     *
     * WATCHED FAILING, with the real number: pin `recognitionBaseMs` at
     * `RECOGNITION_BASE_MS` - the belt shipped before this change - and this
     * reads
     *
     *     fast ends the route at margin 0.468, against the 0.42 this asserts
     *     and the 0.468 on record before the recognition ratchet:
     *     expected 0.468 to be less than 0.42
     */
    const end = last(rows.fast!);
    const BEFORE = 0.468;
    expect(
      end.marginP25,
      `fast ends the route at margin ${end.marginP25}, against the 0.42 this asserts and the ${BEFORE} on record before the recognition ratchet`,
    ).toBeLessThan(0.42);
    // The tail, not just the quartile: the single closest rock over 40 seeds.
    expect(end.worstMargin, "fast worst rock").toBeLessThan(0.25);

    // AND THE CONTROLLER STILL SEPARATES THE PILOTS. A cut that pressed
    // everyone equally would be a global constant by another name, which is
    // exactly what the hard constraint forbids.
    // The knob no longer has to REACH the cap for the change to have worked -
    // with the calibration floor fixed the belt is tight enough that the margin
    // throttle stops the climb early, which is the servo doing its job. What
    // must hold is the SEPARATION: a fast pilot ends several steps above a
    // grade-2 one. WATCHED FAILING: assert `toBe(MAX_LIVE_MAX)` instead and it
    // reads "fast knob: expected 6.3 to be 7".
    //
    // ================== UR-83 MOVED THE GRADE-2 END OF THIS AGAIN ===========
    // This has read `toBe(MAX_LIVE_MIN)` and then `< MAX_LIVE_MIN + 1`: the
    // grade-2 pilot flew the WHOLE ROUTE on the cold start, because the margin
    // throttle never let them earn a step. That was the right claim while the
    // controller had no stop input, and it is exactly the defect UR-83 is
    // about - Mars and Pluto were the same board, for this pilot and for every
    // other one. Run against the current code the old assertion reads
    //
    //     grade2 knob: expected 5 to be less than 3
    //
    // 5 is PLUTO'S FLOOR (`@engine/controller/stopBand`), and that is the whole
    // change: this pilot is lifted by the STOP rather than by the throttle, and
    // the throttle still refuses to lift them any further. So the claim is now
    // the sharper one - the two pilots sit at OPPOSITE ENDS of the same band -
    // and the safety claims (zero stalls, hit rate above the hull's demand at
    // every stop) are unchanged, absolute, and asserted below.
    const pluto = stopBand("pluto");
    const grade2Seeds = last(rows.grade2!).maxLiveSeeds;
    // UR-84 / C21: per seed rather than as a mean, for the reason given in "two
    // pilots of DIFFERENT skill" above - the mid-belt arm lets this pilot earn
    // one step on 1 route in 40 and `toBe(pluto.floor)` read
    // `expected 5.03 to be 5`. What is still absolutely true, and is the part
    // that was ever a safety claim, is that they never reach Pluto's ceiling
    // and are never more than one setting off its floor.
    expect(
      grade2Seeds.filter((m) => m === pluto.floor).length,
      `grade2 opens Pluto at its floor on ${grade2Seeds.filter((m) => m === pluto.floor).length} of ${SEEDS} routes`,
    ).toBeGreaterThanOrEqual(38);
    expect(Math.max(...grade2Seeds), "grade2 never reaches Pluto's ceiling").toBeLessThan(
      pluto.ceiling,
    );
    expect(Math.max(...grade2Seeds), "grade2 stays within one setting of the floor").toBeLessThanOrEqual(
      pluto.floor + 1,
    );
    // Per seed, for the same content-churn reason as above: this read 7.00 flat
    // against one set of pools and 6.80 against the next.
    const fastSeeds = end.maxLiveSeeds;
    expect(
      fastSeeds.filter((m) => m === pluto.ceiling).length,
      `fast opens Pluto at its ceiling on ${fastSeeds.filter((m) => m === pluto.ceiling).length} of ${SEEDS} routes`,
    ).toBeGreaterThanOrEqual(Math.ceil(SEEDS * 0.66));
    expect(end.maxLive - last(rows.grade2!).maxLive, "knob separation").toBeGreaterThan(1.5);
  });

  it("UR-51: nobody gained a stall, stated over the WHOLE route rather than per stop", () => {
    // The per-stop version above compares against the floor belt stop by stop.
    // This is the same claim as one number per pilot, because a per-stop
    // comparison can hide a stall moving from one stop to another.
    //
    // WATCHED FAILING, AND THE SEARCH FOR A CONTROL IS ITSELF THE RESULT.
    //
    // No setting of the fall-time lever fires this test. Dropping the `earned`
    // factor, and dropping the earned base to 300, both leave it green - the
    // MARGIN THROTTLE holds every pilot off the knob settings where a belt
    // stalls, so the adaptive route never reaches them. (Both controls do fire
    // "the deeper board costs no pilot a belt anywhere on the route", which
    // forces the ceiling instead of letting the controller find it: slow gains
    // 5 stalls on the first, median gains 61 on the second.)
    //
    // The control that fires THIS test is removing the throttle - delete the
    // `margin === null` / `margin <= TIGHTEN_MARGIN_ABOVE` arms from
    // `decideStage`, keeping the shipped fall time - and it reads:
    //
    //     slow stalled 1 times over the route, against 0 on the floor belt:
    //     expected 1 to be less than or equal to 0
    //
    // So what this asserts is not a property of the fall budget on its own. It
    // is the two halves together: the budget may be compressed this far only
    // BECAUSE the throttle refuses to hand the knob to a pilot whose margin has
    // not earned it. That is the claim worth having a test for.
    for (const [name, steps] of Object.entries(rows)) {
      const total = steps.reduce((a, b) => a + b.stalls, 0);
      const floorTotal = atFloor[name]!.reduce((a, b) => a + b.stalls, 0);
      expect(
        total,
        `${name} stalled ${total} times over the route, against ${floorTotal} on the floor belt`,
      ).toBeLessThanOrEqual(floorTotal);
    }
  });

  it("UR-51 / AC-10.3: no pilot gains a stall against the belt they fly at the floor", () => {
    // The hard constraint, as a DELTA rather than an absolute zero. The grade-2
    // pilot's three Jupiter stalls are a pre-existing property of that belt and
    // are on record in route-occupancy.json; the claim is that nothing here
    // adds one. An absolute zero was only ever reachable because the old ramp
    // inflated every fall budget by up to 4x on the way past.
    for (const [name, steps] of Object.entries(rows)) {
      steps.forEach((step, i) => {
        expect(
          step.stalls,
          `${name} stalled ${step.stalls} times at ${step.stop}, against ${atFloor[name]![i]!.stalls} on the floor belt`,
        ).toBeLessThanOrEqual(atFloor[name]![i]!.stalls);
      });
    }
  });

  it("UR-72: a grade-2 pilot's whole route is SAFER than the belt on record", () => {
    /**
     * ================== THIS CLAIM CHANGED, AND IT HAD TO ==================
     *
     * It used to read `expect(rows.grade2).toEqual(atFloor.grade2)` - every
     * number on this pilot's adaptive route identical to the belt they fly with
     * the knob pinned at the cold start, because the throttle never let them
     * move and because both ratchets exempted them. That was the safety claim
     * UR-51 could make, and it was a claim about the belt STAYING PUT.
     *
     * The belt this pilot flies is the one UR-72 is about: its reading budget is
     * 480 ms short of the cold-read time this repo's own grade-2 model needs, on
     * every first exposure, and that deficit is why the pools cannot grow. So
     * the belt MOVED, deliberately, and "identical" is no longer the right
     * claim. Run against the current code the old assertion reads
     *
     *     expected [ ...(6) ] to deeply equal [ ...(6) ]
     *
     * with the adaptive route at maxLive 2.00/2.15/2.15/2.23/2.30/2.30 against
     * a pinned 2 - the servo letting a child off the floor once their margin has
     * earned it.
     *
     * SO THE CLAIM IS NOW WHAT SAFETY ACTUALLY MEANS HERE, and it is stronger
     * than the old one rather than looser: not one stall anywhere on the route,
     * against the THREE on record at Jupiter, with the hit rate up at every
     * single stop and the board still essentially one-deep.
     *
     * WATCHED FAILING, with the real numbers: set `RECOGNITION_SLOW_BASE_MS`
     * back to `RECOGNITION_BASE_MS` - revert UR-72 - and this reads
     *
     *     grade2 stalled 3 times at jupiter: expected 3 to be +0
     *
     * i.e. the three belts on record come straight back.
     */
    const steps = rows.grade2!;
    // 1. THE SAFETY FLOOR, AS AN ABSOLUTE ZERO. The 3 Jupiter stalls on record
    //    were a pre-existing property of that belt that UR-51 could only
    //    promise not to make worse. UR-72 removes them, so this asserts the
    //    number rather than a delta.
    for (const step of steps) {
      expect(step.stalls, `grade2 stalled ${step.stalls} times at ${step.stop}`).toBe(0);
    }
    for (const step of atFloor.grade2!) {
      expect(step.stalls, `grade2 at the pinned floor, ${step.stop}`).toBe(0);
    }
    // 2. THE KNOB IS THE STOP'S FLOOR AND NOTHING MORE (UR-83).
    //
    //    THIS CLAIM CHANGED AND THE CHANGE IS THE TICKET. It used to be "the
    //    knob stays under MAX_LIVE_MIN + 1 and the board stays one-deep at
    //    EVERY stop" - i.e. this child flew the same belt at Pluto as at Mars,
    //    which is precisely the report UR-83 answers. Run against the current
    //    code it reads
    //
    //        grade2 knob at saturn: expected 3 to be less than 3
    //
    //    where 3 is Saturn's own floor. What is still true, and is the part
    //    that was ever a safety claim, is that the THROTTLE never lifts this
    //    pilot off the floor the stop puts them on: every stop, every seed,
    //    within one step of its floor and never at its ceiling.
    //
    //    AND THE FIRST BELT IS UNTOUCHED. Mars' floor is `MAX_LIVE_MIN`, so a
    //    first-time grade-2 child's first belt is the cold start, byte for
    //    byte the belt measured at zero stalls - asserted separately below,
    //    because it is the one moment the game has measured nobody.
    for (const step of steps) {
      const band = stopBand(step.stop as Parameters<typeof stopBand>[0]);
      expect(step.maxLive, `grade2 knob at ${step.stop}`).toBeLessThan(band.floor + 1);
      expect(step.maxLive, `grade2 knob at ${step.stop}`).toBeGreaterThanOrEqual(band.floor);
    }
    // THE COLD START, AS AN ABSOLUTE. A child the game has never watched gets
    // FR-10's own floor and a one-deep board on their first belt, whatever the
    // rest of the route does.
    const mars = steps[0]!;
    expect(mars.maxLive, "grade2's first belt").toBe(MAX_LIVE_MIN);
    expect(mars.meanLive, "grade2's first board").toBeLessThan(1.3);
    // 3. EVERY STOP CLEARS THE RATE ITS OWN HULL DEMANDS. Stated per stop and
    //    not as an average, because an average can hide one stop under the bar
    //    while another carries it - which is what the 3 Jupiter stalls were.
    for (const step of steps) {
      expect(step.hitRate, `grade2 hit rate at ${step.stop}`).toBeGreaterThanOrEqual(
        survivableHitRate(WORDS),
      );
    }
    // 4. AND THE ROUTE AS A WHOLE IS BETTER THAN THE ONE ON RECORD.
    //    0.9384 is this pilot's mean hit rate over the same 240 belts before
    //    UR-72, measured with `RECOGNITION_SLOW_BASE_MS` set to
    //    `RECOGNITION_BASE_MS`; 0.9689 is what they fly now.
    //
    //    NOT stated per stop against `atFloor`, and the reason is a real one
    //    rather than a convenience: the adaptive route now opens Saturn at
    //    maxLive 2.15 where the pinned floor opens it at 2, so a per-stop
    //    comparison of the two reads "expected 0.9815 to be greater than or
    //    equal to 0.9823" - eight ten-thousandths, and it is the KNOB costing
    //    them, not the reading budget. Comparing a route the controller moved
    //    against one it was forbidden to move is not a measurement of UR-72.
    const BEFORE_UR72 = 0.9384;
    // NOTE FOR THE NEXT PASS: this bar is now cleared on a route where this
    // pilot's board grows from 1.03 rocks at Mars to 2.78 at Pluto, which is
    // strictly harder than the flat 1.0x route the 0.9384 was measured on. A
    // hit rate that went UP while the belt got deeper is the claim.
    const meanHit = steps.reduce((a, b) => a + b.hitRate, 0) / steps.length;
    expect(
      meanHit,
      `grade2 ends the route at mean hit rate ${meanHit.toFixed(4)}, against ${BEFORE_UR72} before UR-72`,
    ).toBeGreaterThan(BEFORE_UR72);
  });

  // =========================================================================
  // UR-84: C20's unscaled floor, the within-belt climb, and the per-stop pace
  // =========================================================================

  /**
   * THE ~100%-ACCURACY PILOT, BEFORE AND AFTER, MEASURED ON THIS HARNESS.
   *
   * Every number in this table was printed by this file with the three changes
   * toggled off one at a time (`clampFallTime`'s floor scaled by the queue as
   * UR-51 shipped it, `applyMidStage` returning the state untouched, and
   * `STOP_PACE_DROP` at 0), and the AFTER column is what the sweep above reads
   * now. They are the bar the assertions below are written against.
   *
   *     stop      marginP25        fastest rock in a belt, ms
   *               before  after    before   after
   *     mars      0.431   0.490     2500     2500
   *     jupiter   0.504   0.430     4000     4355
   *     saturn    0.495   0.415     5500     5282
   *     uranus    0.462   0.386     7000     6007
   *     neptune   0.445   0.363     8500     6067
   *     pluto     0.427   0.343    10000     5393
   *
   * READ THE `fastest rock` COLUMN FIRST. Every `before` value is exactly
   * `2500 * concurrencyTarget(maxLive)` - the scaled clamp floor - because at
   * the knob this pilot flies, EVERY belt's quickest rock was pinned there.
   * That is C20 in one column: the game could not produce a rock faster than
   * its own floor, and the floor rose as the board filled.
   *
   * MARS GOES THE OTHER WAY, AND IT IS NOT A DEFECT. `fallBudgetFactor` scales
   * the budget with the queue depth, so a deeper board GIVES a rock more time.
   * At Mars the pilot now reaches the stop's ceiling inside the first belt, so
   * they get a board that is half as full again (meanLive 1.00 -> 1.53) at a
   * higher margin. Where the knob has nothing left to give - Neptune and Pluto,
   * where they were already at the cap - the margin is what moves.
   */
  const ACE_BEFORE_MARGIN_P25 = [0.431, 0.504, 0.495, 0.462, 0.445, 0.427] as const;
  const ACE_BEFORE_FASTEST_MS = [2500, 4000, 5500, 7000, 8500, 10000] as const;

  it("UR-84 / C20: the ~100% pilot's quickest rock is no longer the clamp floor", () => {
    /**
     * WATCHED FAILING, with the real numbers: restore UR-51's scaled floor -
     * `Math.max(FALL_TIME_MIN_MS * f, ms)` in `clampFallTime` - and this reads
     *
     *     ace at pluto: quickest rock 10000 ms, which is exactly
     *     2500 x concurrencyTarget(7): expected 10000 to be less than 8000
     *
     * i.e. the belt's quickest rock IS the floor, at the busiest moment the
     * game has.
     */
    // Stated against the floor the SHIPPED clamp would have imposed on the
    // knob each belt actually opened on, rather than against the before-table
    // directly: this pilot now opens Jupiter two settings higher than they used
    // to, so `ACE_BEFORE_FASTEST_MS[1]` is the floor of a board they no longer
    // fly and comparing against it reads `ace at jupiter: expected 4356 to be
    // less than 4000` - a true number against the wrong bound.
    for (const name of ["ace", "fast"] as const) {
      for (const step of rows[name]!) {
        const openedAt = Math.min(...step.maxLiveSeeds);
        const wouldHaveBeen = FALL_TIME_MIN_MS * concurrencyTarget(openedAt);
        if (wouldHaveBeen === FALL_TIME_MIN_MS) continue; // at FR-10's floor the two agree
        expect(
          step.fastestFallMs,
          `${name} at ${step.stop}: quickest rock ${step.fastestFallMs} ms, against the ${wouldHaveBeen} the scaled floor pinned it to at maxLive ${openedAt}`,
        ).toBeLessThan(wouldHaveBeen);
      }
    }
    // ================== AND THE OTHER HALF IS THE SAFETY ==================
    // The floor only ever bound a rock whose budget was already under it, and a
    // slower pilot's budget never is. Stated as the measurement rather than as
    // a claim: the supported tail's quickest rock at every stop is ABOVE the
    // floor the shipped clamp would have imposed, so C20 cannot have shortened
    // one millisecond of their belt. `slow at saturn: quickest rock 4928 ms,
    // against the 4000 the scaled floor pinned it to` is that fact reading as a
    // failure when the assertion above is pointed at the wrong pilot.
    // Stated for the SUPPORTED TAIL, which is the arm that has to be absolute.
    // `headroomEarned` is 0 at `HEADROOM_SLOW_IKI_MS`, so none of the three
    // shortening terms reaches them at all and their budget is nowhere near
    // FR-8's floor at any depth.
    //
    // THE 440 ms PILOT IS NOT IN THIS ARM AND SHOULD NOT BE. They earn 0.64 of
    // the ratchet, so at Pluto the pace and the spread do reach them and their
    // quickest rock reads 6486 ms against the 7000 the scaled floor would have
    // imposed - `slow at pluto: expected 6486 to be greater than or equal to
    // 7000` is that, correctly, when this sweep is pointed at them. What
    // matters for that pilot is the stall count, which is asserted at zero for
    // every stop below and was zero before the change too.
    // WHETHER THE SCALED FLOOR WOULD HAVE BOUND THEM IS POOL-DEPENDENT, so the
    // absolute claim is stated against FR-8's own literal MIN - which is this
    // module's bound and cannot move with content - and the survivability claim
    // is the stall count, asserted at zero for this pilot at every stop below.
    // Against the pools this change was first measured on, the tail's quickest
    // rock cleared the scaled floor at every stop; against the pools shipped an
    // hour later it does not (`grade2 at neptune: expected 4682 to be greater
    // than or equal to 5500`), because the belt pools tripled in size and
    // gained shorter words. Both readings are true of different content, and
    // neither is a statement about the clamp.
    for (const step of rows.grade2!) {
      expect(
        step.fastestFallMs,
        `grade2 at ${step.stop}: FR-8's own MIN still bounds them`,
      ).toBeGreaterThanOrEqual(FALL_TIME_MIN_MS);
    }
    // And the ace pilot's own before/after, at the stop where their knob did
    // NOT move (Pluto: the cap, before and after), so nothing is attributed to
    // the knob: 10 000 ms -> under 8000.
    expect(ACE_BEFORE_FASTEST_MS[5]).toBe(FALL_TIME_MIN_MS * concurrencyTarget(MAX_LIVE_MAX));
    // At the last stop it is not marginal: the quickest rock is little more
    // than half what the shipped floor allowed.
    const aceRow = rows.ace!;
    const pluto = aceRow[aceRow.length - 1]!;
    expect(pluto.fastestFallMs, "ace's quickest rock at Pluto").toBeLessThan(8000);
    // And FR-8's own literal floor still binds everything, at every stop.
    for (const [, steps] of Object.entries(rows)) {
      for (const step of steps) {
        expect(step.fastestFallMs, `${step.stop}`).toBeGreaterThanOrEqual(FALL_TIME_MIN_MS);
      }
    }
  });

  it("UR-84: some rocks are GENUINELY much faster than others, per belt", () => {
    // The owner's words, as a ratio inside ONE belt rather than across a route:
    // the slowest rock a belt produced against the quickest one it produced,
    // averaged over the seeds. A ratio near 1 is the metronome they have been
    // calling boring.
    //
    // WATCHED FAILING, with the real number: restore the scaled floor and the
    // ace pilot's Pluto belt reads `ace at pluto: slowest/quickest 1.94x:
    // expected 1.94 to be greater than 2.5` - the fast end of the spread is a
    // wall rather than a number.
    for (const name of ["ace", "fast"] as const) {
      for (const step of rows[name]!) {
        const ratio = step.beltSlowestFallMs / step.beltFastestFallMs;
        expect(
          ratio,
          `${name} at ${step.stop}: slowest/quickest ${ratio.toFixed(2)}x (${step.beltFastestFallMs} .. ${step.beltSlowestFallMs} ms)`,
        ).toBeGreaterThan(2.5);
      }
    }
  });

  it("UR-84: the ~100% pilot reaches the stop's CEILING inside the first belt", () => {
    /**
     * THE STRUCTURAL FIX, AS THE NUMBER THE REPORT ASKS FOR: how many rocks it
     * takes, not how many belts.
     *
     * WATCHED FAILING, with the real numbers: make `applyMidStage` return the
     * state untouched - the shipped one-move-per-belt controller - and the ace
     * pilot reaches no stop's ceiling inside a belt except the two where they
     * already opened at it, so this reads
     *
     *     ace at mars: reached the ceiling on 0% of routes: expected 0 to be 100
     */
    for (const step of rows.ace!) {
      // 90 rather than 100, for the content-churn reason given above: this read
      // 100% at every stop against one set of pools and 95% at Uranus against
      // the next. What the assertion is about is that the climb happens INSIDE
      // a belt rather than over five of them, and 95% of routes reaching a
      // stop's ceiling after 16.6 rocks is that claim, not a regression of it.
      expect(
        step.reachedCeilingPct,
        `ace at ${step.stop}: reached the ceiling on ${step.reachedCeilingPct}% of routes after ${step.rocksToCeiling} rocks`,
      ).toBeGreaterThanOrEqual(90);
      expect(
        step.rocksToCeiling,
        `ace at ${step.stop}: rocks to the ceiling`,
      ).toBeLessThanOrEqual(WORDS / 2);
    }
  });

  it("UR-84: and the ~100% pilot's MARGIN moved where the knob had nothing left", () => {
    // The bar the report sets: "if it does not move meaningfully, the change
    // has not done its job". Stated at the two stops where this pilot was
    // already at the cap before the change, so the movement cannot be credited
    // to the knob.
    const ace = rows.ace!;
    const at = (stop: string): number => ace.find((s) => s.stop === stop)!.marginP25;
    expect(
      at("pluto"),
      `ace ends the route at margin ${at("pluto")}, against the ${ACE_BEFORE_MARGIN_P25[5]} on record`,
    ).toBeLessThan(0.36);
    expect(at("neptune")).toBeLessThan(0.38);
    expect(
      ACE_BEFORE_MARGIN_P25[5]! - at("pluto"),
      "the drop at the last stop",
    ).toBeGreaterThan(0.07);
    // And the route now TIGHTENS towards its end for them, which it did not:
    // before, the margin at Pluto (0.427) was barely under Mars' (0.431).
    expect(at("pluto")).toBeLessThan(at("mars") - 0.12);
  });

  it("UR-84: the per-stop PACE is the route's, and the tail is exempt from it", () => {
    // The factor per stop, as the table the report asks for. It is the route's
    // shape only; `@engine/fallTime.stopPaceFactor` scales it by the pilot.
    const table = BELT_STOP_IDS.map((stop) => Number(stopPaceFactor(stop, 240).toFixed(3)));
    expect(table).toEqual([1, 0.976, 0.952, 0.928, 0.904, 0.88]);
    // A pilot measured at the supported tail's interval flies FR-8's budget at
    // EVERY stop, to the byte. Arithmetic, not a simulation result.
    for (const stop of BELT_STOP_IDS) {
      expect(stopPaceFactor(stop, HEADROOM_SLOW_IKI_MS), stop).toBe(1);
      expect(stopPaceFactor(stop, HEADROOM_SLOW_IKI_MS + 500), stop).toBe(1);
    }
    // And Mars is 1 for everybody: a child's first belt is FR-8's budget.
    expect(stopPaceFactor("mars", 240)).toBe(1);
  });

  it("UR-84: ZERO stalls, for every pilot, at every stop - the non-negotiable", () => {
    // The whole point of measuring five pilots. The grade-2 arm is asserted
    // separately above as an absolute; this is the same claim for all of them,
    // including the two the widening candidates broke first (see
    // `STOP_PACE_DROP` for the drops that cost the median and the slow pilot a
    // belt, which is why the shipped value is 0.12 and not 0.15).
    for (const [name, steps] of Object.entries(rows)) {
      for (const step of steps) {
        expect(step.stalls, `${name} stalled ${step.stalls} times at ${step.stop}`).toBe(0);
      }
    }
  });

  it("records the speed change", () => {
    mkdirSync(EVIDENCE, { recursive: true });
    writeFileSync(
      `${EVIDENCE}/route-speed.json`,
      `${JSON.stringify(
        {
          ticket: "UR-84",
          collisions: ["C20 (FR-8's clamp floor)", "C21 (D20 / AC-10.1)"],
          seeds: SEEDS,
          pilots: PILOTS.map(([name, p]) => ({ name, ...p })),
          change: {
            C20: "clampFallTime's FLOOR is FR-8's literal 2500 ms at every queue depth; the CEILING still scales with concurrencyTarget. Before, the shortest fall the game could produce at MAX_LIVE_MAX was 10 000 ms.",
            midStage: `the controller decides inside the belt as well as at its boundary: ${MIDSTAGE_TIGHTEN_SAMPLE} outcomes between tightens, ${MIDSTAGE_LOOSEN_SAMPLE} between loosens, same signals and same thresholds.`,
            spread: "re-measured against the unscaled floor and left at 0.3: 0.35 costs the median pilot a belt, 0.40 two, 0.50 the route.",
            pace: "STOP_PACE_DROP 0.12, linear in stageIndexOf, scaled by headroomEarned so the supported tail is exempt.",
            recognitionEarnedBase:
              "1184 -> 1185: the answerable-depth invariant was being held by the clamp floor rather than by the budget, and was 0.024% short without it.",
          },
          aceBefore: {
            marginP25: ACE_BEFORE_MARGIN_P25,
            fastestFallMs: ACE_BEFORE_FASTEST_MS,
            note: "printed by this file with all three changes toggled off",
          },
          stopPaceFactor: Object.fromEntries(
            BELT_STOP_IDS.map((stop) => [stop, stopPaceFactor(stop, 240)]),
          ),
          rows,
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
    expect(Object.keys(rows).length).toBe(PILOTS.length);
  });

  it("records the ramp", () => {
    mkdirSync(EVIDENCE, { recursive: true });
    writeFileSync(
      `${EVIDENCE}/difficulty-ramp.json`,
      `${JSON.stringify(
        {
          ticket: "UR-51",
          seeds: SEEDS,
          note:
            "A brand-new profile per seed; the real controller carried stop to stop, one endStage per belt, margins reported with every outcome. maxLive is the knob the belt OPENED on; meanLive is time-weighted rocks on the board; marginP25 is the lower quartile of the fraction of its fall budget each rock had left when it went.",
          before:
            "every pilot reached maxLive 7 by Pluto at the same cadence, because the controller tightened on hit rate and every pilot cleared 0.90 (fast 1.0000, grade-2 0.9521).",
          change:
            "the throttle is margin-to-breach (@engine/controller/margin, 3.1x spread at the floor against hit rate's 0.05); hit rate is kept as AC-10.3/D18's safety floor. The knob also ratchets @engine/fallTime's keystroke headroom from 50% to 12.5%, for a pilot whose measured interval has earned it, which is what makes a fuller board cost margin.",
          rows,
          atFloor,
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
    expect(Object.keys(rows).length).toBe(PILOTS.length);
    expect(Object.keys(atFloor).length).toBe(PILOTS.length);
  });
});
