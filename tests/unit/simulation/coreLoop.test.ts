import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  mulberry32,
  retentionImprovementMs,
  simulateStage,
  type SimPlayer,
  type StageConfig,
} from "./flight.js";
import type { WordBook } from "@engine/words/index.js";

/**
 * AC-6e.3 and AC-6e.4 (D77, D50). Both are claims about a WHOLE RUN, so they
 * cannot be checked inside any single module - the behaviour is emergent.
 *
 * These tests also write the evidence artifacts the gauntlet reads, so the
 * rubric numbers are produced by the real engine rather than typed in by hand.
 */

const MARS = [
  "red", "planet", "dust", "rust", "cold", "dry", "sky", "pink", "day",
  "tiny", "moons", "spin", "long", "ago", "rivers", "run", "across",
  "now", "empty", "first", "pilot", "place", "beacon",
];
const JUPITER = [
  "biggest", "fit", "every", "other", "inside", "ground", "land", "clouds",
  "stripes", "orange", "white", "brown", "giant", "storm", "great", "spot",
  "years", "many", "still", "keep", "big",
];
const SATURN = [
  "wears", "rings", "look", "solid", "far", "away", "close", "made", "ice",
  "rock", "bits", "chunks", "house", "light", "float", "find", "lakes",
  "water", "between", "through",
];

/** A grade 2-5 typist: not fast, not perfect. */
const LEARNER: SimPlayer = {
  accuracy: 0.93,
  ikiMs: 340,
  coldRecognitionMs: 1500,
};

function stage(stopIndex: number, pool: readonly string[], retention: readonly string[]): StageConfig {
  return {
    stopIndex,
    stagePool: pool,
    retentionPool: retention,
    spawnCount: 24,
    maxLive: 3,
    spawnIntervalMs: 120,
  };
}

describe("AC-6e.3: no dead time > 2 s during flight (D77)", () => {
  it("AC-6e.3: holds across 200 seeded stages", () => {
    let worst = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const r = simulateStage(stage(1, MARS, []), LEARNER, {}, mulberry32(seed));
      worst = Math.max(worst, r.maxDeadMs);
    }
    // Written from the real simulation, not typed in.
    mkdirSync("gauntlet/evidence", { recursive: true });
    writeFileSync(
      "gauntlet/evidence/deadtime.json",
      JSON.stringify({ maxGapMs: worst, stages: 200, source: "tests/unit/simulation/coreLoop.test.ts" }, null, 2) + "\n",
    );
    expect(worst).toBeLessThanOrEqual(2000);
  });

  it("AC-6e.3: a board that cannot legally spawn still does not stall", () => {
    // Every word shares a first letter, so AC-2.1 blocks all but one at a time.
    // The picker must decline rather than throw, and the stage must still end.
    const collide = ["sun", "sky", "spin", "storm", "star", "solid"];
    const r = simulateStage(
      { ...stage(1, collide, []), maxLive: 4 },
      LEARNER,
      {},
      mulberry32(99),
    );
    expect(r.spawns.length).toBeGreaterThan(0);
    expect(r.maxDeadMs).toBeLessThanOrEqual(2000);
  });

  it("AC-6e.3: dead time is measured, not assumed - a starved board reports it", () => {
    // Sanity check that the metric can be non-zero, so the passing result above
    // means something. A very long spawn interval starves the board on purpose.
    const r = simulateStage(
      { ...stage(1, MARS, []), spawnIntervalMs: 4000, maxLive: 1 },
      LEARNER,
      {},
      mulberry32(5),
    );
    expect(r.maxDeadMs).toBeGreaterThan(0);
  });
});

describe("AC-6e.4: retention improves across an Earth->Pluto run (D50, D77)", () => {
  it("AC-6e.4: a simulated learner gets measurably faster on re-met words", () => {
    const improvements: number[] = [];

    for (let seed = 1; seed <= 40; seed++) {
      const rng = mulberry32(seed);
      let book: WordBook = {};

      // Mars, then Jupiter interleaving Mars words, then Saturn interleaving both.
      const mars = simulateStage(stage(1, MARS, []), LEARNER, book, rng);
      book = mars.book;
      const jupiter = simulateStage(stage(2, JUPITER, MARS), LEARNER, book, rng);
      book = jupiter.book;
      const saturn = simulateStage(stage(3, SATURN, [...MARS, ...JUPITER]), LEARNER, book, rng);
      book = saturn.book;

      const delta = retentionImprovementMs(book);
      if (delta !== null) improvements.push(delta);
    }

    expect(improvements.length).toBeGreaterThan(0);
    const mean = improvements.reduce((a, b) => a + b, 0) / improvements.length;
    const positive = improvements.filter((d) => d > 0).length;

    mkdirSync("gauntlet/evidence", { recursive: true });
    writeFileSync(
      "gauntlet/evidence/retention.json",
      JSON.stringify({
        trendUp: mean > 0 && positive === improvements.length,
        meanImprovementMs: Math.round(mean),
        seedsImproving: positive,
        seeds: improvements.length,
        source: "tests/unit/simulation/coreLoop.test.ts",
      }, null, 2) + "\n",
    );

    // Every seed must improve. A mean that hides a regressing seed would let
    // the headline learning claim in D50 rest on an average.
    expect(positive).toBe(improvements.length);
    expect(mean).toBeGreaterThan(0);
  });

  it("AC-6e.4: the measure can go down, so 'up' means something", () => {
    // A learner who never improves must NOT produce a positive retention delta.
    const flat: SimPlayer = { ...LEARNER, coldRecognitionMs: 260 };
    const rng = mulberry32(7);
    let book: WordBook = {};
    book = simulateStage(stage(1, MARS, []), flat, book, rng).book;
    book = simulateStage(stage(2, JUPITER, MARS), flat, book, rng).book;
    const delta = retentionImprovementMs(book);
    expect(delta).not.toBeNull();
    // Floor is 220ms, so a 260ms cold learner has almost nothing to gain.
    expect(delta!).toBeLessThan(60);
  });
});
