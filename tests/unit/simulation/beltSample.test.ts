import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  calibrationOf,
  mulberry32,
  simulateBelt,
  type BeltResult,
  type SimPlayer,
} from "./flight.js";
import { BELT_STOP_IDS, type StopId } from "@engine/types";
import { DEFAULT_KNOBS } from "@engine/controller/knobs.js";
import {
  type SpawnOutcome,
  clearanceMargin,
  createController,
  createMarginWindow,
  endStage,
  recordOutcome,
} from "@engine/controller/index.js";
import { beltSizeFor, sampleBelt } from "@engine/selection/index.js";
import { DEFAULT_FLIGHT_CONFIG, stagePoolFor } from "@game/flight/stage.js";
import { survivableHitRate } from "@engine/hull/index.js";

/**
 * UR-79b / AC-4.3 / FR-8: IS A *SAMPLED* BELT STILL A BELT A CHILD SURVIVES?
 *
 * ================== WHY THIS FILE EXISTS AT ALL ==================
 * `launchRoute.test.ts` flies the route with a fresh book at every stop, which
 * is exactly right for what it measures - and it means it only ever flies each
 * bank's BASELINE BLOCK, the pool that shipped before banks existed. That is
 * deliberate (see `BELT_BASELINE_FRACTION`): it keeps every stall count, fall
 * time and duration band in this directory measured on the belt it was
 * measured on, and this lane changes none of them.
 *
 * But it also means the thing this lane ADDED - the belt a RETURNING child
 * flies, drawn out of the wider bank - would never be flown by any harness. So
 * it is flown here: the same 40 seeds, the same six belts, the same real
 * controller carried stop to stop, the same four pilots, with every belt a
 * sample rather than a baseline.
 *
 * ================== HOW A RETURNING PILOT IS MODELLED ==================
 * Through `belt.known` and NOT by handing the simulated child a warm word
 * book. A warm book would shorten fall times (ease) and remove the cold
 * recognition cost, and the belt would then look survivable because the PILOT
 * got easier rather than because the BELT is safe. So the belt is the returning
 * one and the hands are still cold, which is the conservative direction: a real
 * returning child is faster than this.
 *
 * ================== THE BAR ==================
 * Zero stalls, for every pilot, at every stop - the same non-negotiable
 * `launchRoute.test.ts` states for the baseline belts. Plus the two things that
 * make the bar meaningful: the hit rate a belt demands is still met, and the
 * mean word length of every sampled belt is under FR-8's 4.9 ceiling.
 *
 * ================== WATCHED FAILING ==================
 * Recorded at each `it`. The control is the pre-bank change this module exists
 * instead of: give every stop a single pool of its whole bank (`sampleBelt`
 * returning `bank`), which is "just make the pools bigger".
 */

const WORDS = DEFAULT_FLIGHT_CONFIG.stageWordCount;
const SEEDS = 40;

/** The four pilots the route is stated for. Identical to launchRoute.test.ts. */
const FAST: SimPlayer = { accuracy: 0.97, ikiMs: 260, fkLatencyMs: 400, coldRecognitionMs: 1100 };
const MEDIAN: SimPlayer = { accuracy: 0.93, ikiMs: 350, fkLatencyMs: 500, coldRecognitionMs: 1500 };
const SLOW: SimPlayer = { accuracy: 0.88, ikiMs: 440, fkLatencyMs: 650, coldRecognitionMs: 1900 };
const GRADE2: SimPlayer = { accuracy: 0.82, ikiMs: 600, fkLatencyMs: 700, coldRecognitionMs: 2400 };

const PILOTS: ReadonlyArray<readonly [string, SimPlayer]> = [
  ["fast", FAST],
  ["median", MEDIAN],
  ["slow", SLOW],
  ["grade2", GRADE2],
];

const BANK = new Map<StopId, readonly string[]>(
  BELT_STOP_IDS.map((stop) => [stop, stagePoolFor(stop)] as const),
);

const bankOf = (stop: StopId): readonly string[] => BANK.get(stop) ?? [];

/** What a pilot who has flown this stop once has met: its baseline belt. */
const flownOnce = (stop: StopId): readonly string[] =>
  bankOf(stop).slice(0, beltSizeFor(bankOf(stop).length));

/** The belt this route seed hands this stop. */
const beltAt = (stop: StopId, seed: number): readonly string[] => {
  const bank = bankOf(stop);
  return sampleBelt({
    bank,
    size: beltSizeFor(bank.length),
    seed,
    known: flownOnce(stop),
  });
};

const meanOf = (words: readonly string[]): number =>
  words.reduce((n, w) => n + w.length, 0) / words.length;

interface Row {
  stop: string;
  stalls: number;
  hitRate: number;
  meanWordLength: number;
  beltSeconds: number;
  worstHull: number;
  distinctWords: number;
  /** Words this pilot met here across all 40 sampled belts. */
  reachedOverSeeds: number;
}

/**
 * Fly the whole route once per seed with SAMPLED belts, carrying the real
 * controller, its windows and the profile's belief from stop to stop - the
 * same wiring `launchRoute.test.ts` uses, so the two are comparable.
 */
function flySampledRoute(player: SimPlayer): Row[] {
  const cols = BELT_STOP_IDS.map(() => ({
    stalls: 0,
    hit: [] as number[],
    seconds: [] as number[],
    hull: [] as number[],
    reached: new Set<string>(),
  }));

  for (let seed = 1; seed <= SEEDS; seed += 1) {
    let knobs = DEFAULT_KNOBS;
    let carriedOutcomes: readonly SpawnOutcome[] = [];
    let carriedMargins = createMarginWindow([]);
    let calibration = calibrationOf(player);
    const rng = mulberry32(seed);

    for (let stop = 0; stop < BELT_STOP_IDS.length; stop += 1) {
      const stopId = BELT_STOP_IDS[stop]!;
      let controller = createController({
        knobs,
        window: carriedOutcomes,
        margins: carriedMargins,
        stopId,
      });
      const opened = controller.knobs;
      const result: BeltResult = simulateBelt(
        {
          stopIndex: stop + 1,
          stopId,
          stagePool: bankOf(stopId),
          retentionPool: [],
          spawnCount: WORDS,
          calibration,
          knobs: opened,
          // THE WHOLE POINT: a returning pilot's belt, at this route's seed.
          belt: { seed, known: flownOnce(stopId) },
        },
        player,
        {},
        rng,
      );

      const col = cols[stop]!;
      if (result.stalled) col.stalls += 1;
      col.hit.push(result.hitRate);
      col.seconds.push(result.durationMs / 1000);
      col.hull.push(result.hull);
      for (const word of beltAt(stopId, seed)) col.reached.add(word);

      calibration = result.calibration;
      const margins = result.spawns.map((s) =>
        clearanceMargin({
          spawnedAtMs: s.spawnedAtMs,
          leftAtMs: s.clearedAtMs,
          fallMs: s.fallMs,
        }),
      );
      let next = controller;
      result.spawns.forEach((spawn, i) => {
        next = recordOutcome(next, spawn.hit ? "blasted" : "missed", margins[i]!);
      });
      next = endStage(next);
      knobs = next.knobs;
      carriedOutcomes = next.window.outcomes;
      carriedMargins = next.margins;
      controller = next;
    }
  }

  const avg = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  return cols.map((c, i) => {
    const stopId = BELT_STOP_IDS[i]!;
    return {
      stop: stopId,
      stalls: c.stalls,
      hitRate: Number(avg(c.hit).toFixed(4)),
      meanWordLength: Number(meanOf(beltAt(stopId, 1)).toFixed(3)),
      beltSeconds: Number(avg(c.seconds).toFixed(2)),
      worstHull: Math.min(...c.hull),
      distinctWords: beltAt(stopId, 1).length,
      reachedOverSeeds: c.reached.size,
    };
  });
}

const rows: Record<string, Row[]> = {};
for (const [name, player] of PILOTS) rows[name] = flySampledRoute(player);

const EVIDENCE = "gauntlet/evidence";

describe("UR-79b / AC-4.3: the route, flown on SAMPLED belts", () => {
  it("AC-4.3: ZERO stalls, for every pilot, at every stop", () => {
    // WATCHED FAILING, with the real numbers: drop the sampling entirely so
    // every stop flies its whole bank as one pool - the "just make the pools
    // bigger" change this module exists instead of - and this reads
    //     median stalled 2 times at neptune on sampled belts: expected 2 to be +0
    // with the same pilot's hull emptying at that stop ("median emptied the
    // hull at neptune: expected 0 to be greater than 0").
    for (const [name, steps] of Object.entries(rows)) {
      for (const step of steps) {
        expect(
          step.stalls,
          `${name} stalled ${step.stalls} times at ${step.stop} on sampled belts`,
        ).toBe(0);
      }
    }
  });

  it("AC-4.3 / D27: and the hull is never emptied on the way", () => {
    for (const [name, steps] of Object.entries(rows)) {
      for (const step of steps) {
        expect(step.worstHull, `${name} emptied the hull at ${step.stop}`).toBeGreaterThan(0);
      }
    }
  });

  it("AC-6e.3: the hit rate a belt demands is still met on a sampled belt", () => {
    const bar = survivableHitRate(WORDS);
    for (const [name, steps] of Object.entries(rows)) {
      for (const step of steps) {
        expect(
          step.hitRate,
          `${name} cleared ${step.hitRate} at ${step.stop} against ${bar}`,
        ).toBeGreaterThanOrEqual(bar);
      }
    }
  });

  it("FR-8: every sampled belt is under the mean-length ceiling", () => {
    // 4.9, from UR-72's measurement: 80 words at mean 4.88 costs a grade-2
    // pilot 1 stall in 240 belts and the same 80 at 6.16 costs 239.
    for (const step of rows.grade2!) {
      expect(
        step.meanWordLength,
        `${step.stop} sampled mean ${step.meanWordLength}`,
      ).toBeLessThanOrEqual(4.9);
    }
  });

  it("FR-12: a belt is still one belt's worth of words, sampled or not", () => {
    // The constraint that shapes the lane: a belt at or above the spawn count
    // is served once, so the scheduler never sees a second exposure. WATCHED
    // FAILING under the same control: "mars belt: expected 100 to be less
    // than 58".
    for (const step of rows.grade2!) {
      expect(step.distinctWords, `${step.stop} belt`).toBeLessThan(WORDS);
      expect(step.distinctWords, `${step.stop} belt`).toBeGreaterThanOrEqual(40);
    }
  });

  it("records the sampled route", () => {
    mkdirSync(EVIDENCE, { recursive: true });
    writeFileSync(
      `${EVIDENCE}/belt-sample-route.json`,
      `${JSON.stringify(
        {
          ticket: "UR-79b",
          seeds: SEEDS,
          beltsPerRoute: BELT_STOP_IDS.length,
          note:
            "Each belt is a SAMPLE of its stop's bank for a pilot who has flown that stop once, at the route seed. A brand-new profile per seed; the real controller carried stop to stop, one endStage per belt, margins reported with every outcome. The pilot's word book stays cold on purpose - the belt is the returning one, the hands are not.",
          banks: Object.fromEntries(
            BELT_STOP_IDS.map((stop) => [
              stop,
              { bank: bankOf(stop).length, belt: beltSizeFor(bankOf(stop).length) },
            ]),
          ),
          pilots: PILOTS.map(([name, p]) => ({ name, ...p })),
          rows,
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
    expect(Object.keys(rows).length).toBe(PILOTS.length);
  });
});
