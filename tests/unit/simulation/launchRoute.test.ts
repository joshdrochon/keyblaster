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
  LAUNCH_CEREMONY_STEP,
  LAUNCH_CEREMONY_WORDS,
  MIN_IKI_MS,
  foldLaunchCeremony,
  planLaunchCeremony,
  type Keystroke,
  type RitualStepInput,
} from "@engine/calibration/index.js";
import { BELT_STOP_IDS, DEFAULT_CALIBRATION, type Calibration } from "@engine/types.js";
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
): RitualStepInput[] {
  if (kind === "none") return [];
  const stopId = BELT_STOP_IDS[stopIndex];
  if (stopId === undefined) return [];
  const plan = planLaunchCeremony(stagePoolFor(stopId), mulberry32(0x9e + stopIndex));
  if (plan === null) return [];
  const iki = kind === "mashed" ? MIN_IKI_MS : player.ikiMs;
  const fk = kind === "mashed" ? 90 : (player.fkLatencyMs ?? 500);
  const words = plan.steps.flatMap((s) => s.words);
  let clock = 0;
  return [
    {
      id: LAUNCH_CEREMONY_STEP,
      words: words.map((word) => {
        const shownAtMs = clock;
        const keystrokes: Keystroke[] = [];
        let at = shownAtMs + fk;
        for (let i = 0; i < word.length; i += 1) {
          keystrokes.push({ charIndex: i, atMs: at });
          at += iki;
        }
        clock = at + 400;
        return { word, shownAtMs, keystrokes };
      }),
    },
  ];
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
