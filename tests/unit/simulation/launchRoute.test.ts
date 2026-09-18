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
  clearanceMargin,
  createController,
  endStage,
  knobsDiffCount,
  recordOutcome,
} from "@engine/controller/index.js";
import { DEFAULT_FLIGHT_CONFIG, stagePoolFor } from "@game/flight/stage.js";
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
    }));
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      // A brand-new profile: D18's cold start, which is also UR-51's safety
      // floor. `DEFAULT_KNOBS` is what `blankProfile` writes.
      let controller = createController({ knobs: DEFAULT_KNOBS });
      let calibration = calibrationOf(player);
      const rng = mulberry32(seed);
      for (let stop = 0; stop < BELT_STOP_IDS.length; stop += 1) {
        const opened =
          freezeKnob === null ? controller.knobs : { ...controller.knobs, maxLive: freezeKnob };
        const result: BeltResult = simulateBelt(
          {
            stopIndex: stop + 1,
            stagePool: stagePoolFor(BELT_STOP_IDS[stop]!),
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
        controller = next;
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
      expect(steps[0]!.meanLive, name).toBeLessThan(1.1);
    }
  });

  it("AC-10.1 / D20: at most one knob moves per stage, at every stop, for every pilot", () => {
    for (const [name, steps] of Object.entries(rows)) {
      for (const step of steps) {
        expect(step.knobMovesThisStage, `${name} at ${step.stop}`).toBeLessThanOrEqual(1);
      }
    }
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
    expect(
      fast.maxLive - grade2.maxLive,
      `fast ends the route at maxLive ${fast.maxLive}, grade-2 at ${grade2.maxLive}`,
    ).toBeGreaterThanOrEqual(2);
    // And the board itself, not only the knob: occupancy is what a child sees.
    expect(fast.meanLive, "fast").toBeGreaterThan(grade2.meanLive + 0.5);

    // The ordering holds for the whole ladder, not just its two ends - a
    // separation that only appeared between the extremes would be noise.
    const ladder = PILOTS.map(([name]) => last(rows[name]!).maxLive);
    for (let i = 1; i < ladder.length; i += 1) {
      expect(ladder[i]!, `${PILOTS[i]![0]} against ${PILOTS[i - 1]![0]}`).toBeLessThanOrEqual(
        ladder[i - 1]!,
      );
    }
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

  it("UR-51: a grade-2 pilot's whole route is the belt already on record", () => {
    // The other half of the hard constraint, and the one a simulation CAN
    // settle: the margin throttle keeps this pilot at the cold start, and
    // `keystrokeHeadroom` is FR-8's literal 1.5 at their measured speed
    // whatever the knob says - so every number on their route is the floor
    // belt's number, not close to it.
    expect(rows.grade2).toEqual(atFloor.grade2);
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
    expect(Object.keys(rows).length).toBe(4);
    expect(Object.keys(atFloor).length).toBe(4);
  });
});
