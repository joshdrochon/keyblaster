import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  mulberry32,
  simulateBelt,
  type BeltConfig,
  type BeltResult,
  type SimPlayer,
} from "./flight.js";
import { BELT_STOP_IDS, type StopId } from "@engine/types.js";
import { firstFkLatency, medianFkLatency, type WordBook } from "@engine/words/index.js";
import { DEFAULT_FLIGHT_CONFIG, retentionPoolFor, stagePoolFor } from "@game/flight/stage.js";

/**
 * AC-6e.3 and AC-6e.4 (D77, D50). Both are claims about a WHOLE RUN, so neither
 * can be checked inside any single module - the behaviour is emergent. These
 * tests also write the evidence artifacts `L-6e.3` and `L-6e.4` read, so the
 * rubric numbers come from the engine rather than being typed in.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE WAS REWRITTEN. Both items were GREEN and neither measured its
 * claim. Read this before changing anything here.
 *
 * L-6e.3 ("no dead time > 2 s") ran on `simulateStage`, which advances its
 * clock by `nowMs += cfg.spawnIntervalMs` with `spawnIntervalMs: 120`. Dead time
 * could therefore only ever be a multiple of 120 ms, and the artifact reported
 * `maxGapMs: 120` - one tick, the floor of the measurable range. The reported
 * number WAS the instrument. Exceeding 2000 would have required seventeen
 * consecutive `pickNext` refusals in a harness whose own header says it
 * "resolves every live rock independently, as if the player could answer them
 * all at once" - the assumption that hid the belt stall a human found twice.
 *
 * L-6e.4 ("the retention line trends upward") was arithmetic. The simulated
 * child's recognition latency is `floor + (cold - floor) * 0.72 ** hits`, a
 * strictly decreasing function of hit count, and `retentionImprovementMs` took
 * `firstFkLatency - medianFkLatency` over EVERY word with two hits - including
 * two hits inside the same stage, which is not retention at all. Every seed
 * improved for every player, with the engine's SRS removed entirely. The
 * existing negative control could not fail either: it used a "flat" learner at
 * `coldRecognitionMs: 260` against a floor of 220, so the largest delta
 * expressible was 40 ms and the bound was `toBeLessThan(60)`.
 *
 * WHAT IS DIFFERENT NOW.
 *
 *  - Both artifacts come from `simulateBelt` - one serial typist, real fall
 *    times, real hull, real pacing - and it is event-driven: it jumps to the
 *    exact instant of the next event, so there is no tick and no quantisation.
 *    `measurementResolutionMs: 0` is recorded in the artifact and the rubric
 *    rejects a reading pinned to its own instrument's floor.
 *  - The run is the whole route: six belts, Mars through Pluto, on the real
 *    content pools. (Earth is the activation screen and flies no belt - D57 -
 *    so "Earth->Pluto" is six belts, not seven, and the artifact says so
 *    rather than letting the item's title imply a number nobody ran.)
 *  - Retention is measured only over words met in MORE THAN ONE STOP, which is
 *    what a delayed re-test is.
 *  - Every claim carries a negative control that is run, asserted, and WRITTEN
 *    INTO THE ARTIFACT, so the rubric fails if the control stops failing. A
 *    control nobody can re-run is a sentence, not evidence.
 *
 * ---------------------------------------------------------------------------
 * HOW TO RE-RUN THE NEGATIVE CONTROLS
 *
 *   npx vitest run tests/unit/simulation --coverage.enabled=false
 *
 * They are ordinary tests in this file, named "NEGATIVE CONTROL". Each one
 * reintroduces the defect its item exists to catch and asserts the measure goes
 * the wrong way.
 */

const WORDS = DEFAULT_FLIGHT_CONFIG.stageWordCount;
const SEEDS = 40;

/** Three children spread either side of DEFAULT_CALIBRATION, as belt.test.ts. */
const PLAYERS: [string, SimPlayer][] = [
  ["median", { accuracy: 0.93, ikiMs: 350, fkLatencyMs: 500, coldRecognitionMs: 1500 }],
  ["grade-2", { accuracy: 0.82, ikiMs: 600, fkLatencyMs: 700, coldRecognitionMs: 2400 }],
  ["quick", { accuracy: 0.97, ikiMs: 260, fkLatencyMs: 380, coldRecognitionMs: 1100 }],
];

const ROUTE: StopId[] = [...BELT_STOP_IDS];

function beltFor(stop: StopId, extra: Partial<BeltConfig> = {}): BeltConfig {
  const index = ROUTE.indexOf(stop) + 1;
  return {
    stopIndex: index,
    stagePool: stagePoolFor(stop),
    retentionPool: retentionPoolFor(ROUTE.slice(0, ROUTE.indexOf(stop))),
    spawnCount: WORDS,
    ...extra,
  };
}

/** Fly the whole route on one seed, carrying the word book forward. */
function flyRoute(
  player: SimPlayer,
  seed: number,
  extra: Partial<BeltConfig> = {},
): {
  results: BeltResult[];
  book: WordBook;
  stopsByWord: Map<string, Set<number>>;
  retentionSourced: Set<string>;
} {
  const rng = mulberry32(seed);
  let book: WordBook = {};
  const results: BeltResult[] = [];
  // Which stops each word was HIT in. The word record does not keep per-stop
  // history, so the harness keeps it: a word hit twice inside one belt is a
  // repeat, not a retention event, and only the harness can tell them apart.
  const stopsByWord = new Map<string, Set<number>>();
  // Words the SELECTION ENGINE brought back from the retention pool, as opposed
  // to words that re-appeared because two stage pools happen to share them.
  // That distinction is the whole of the engine's contribution to this line.
  const retentionSourced = new Set<string>();
  for (const stop of ROUTE) {
    const r = simulateBelt(beltFor(stop, extra), player, book, rng);
    book = r.book;
    results.push(r);
    const index = ROUTE.indexOf(stop) + 1;
    for (const s of r.spawns) {
      if (!s.hit) continue;
      const set = stopsByWord.get(s.word) ?? new Set<number>();
      set.add(index);
      stopsByWord.set(s.word, set);
      if (s.fromRetention) retentionSourced.add(s.word);
    }
  }
  return { results, book, stopsByWord, retentionSourced };
}

// ---------------------------------------------------------------------------
// AC-6e.3 — dead time
// ---------------------------------------------------------------------------

function worstDeadMs(extra: Partial<BeltConfig> = {}): { maxGapMs: number; belts: number; spawns: number; where: string } {
  let maxGapMs = 0;
  let belts = 0;
  let spawns = 0;
  let where = "none";
  for (const [name, player] of PLAYERS) {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const { results } = flyRoute(player, seed, extra);
      for (const r of results) {
        belts += 1;
        spawns += r.spawned;
        if (r.maxDeadMs > maxGapMs) {
          maxGapMs = r.maxDeadMs;
          where = `${name} seed ${seed}`;
        }
      }
    }
  }
  return { maxGapMs, belts, spawns, where };
}

describe("AC-6e.3: no dead time > 2 s during flight (D77)", () => {
  it("AC-6e.3: no belt on the Mars->Pluto route leaves the sky empty for over 2 s", () => {
    const shipped = worstDeadMs();
    // THE NEGATIVE CONTROL, RUN HERE AND WRITTEN INTO THE ARTIFACT. Remove the
    // one clause in FlightScene.trySpawn:955 that lets an empty board skip its
    // gap, and the same route on the same seeds goes quiet for longer than the
    // AC allows. Without this number the headline reading of 0 ms is a
    // statement that the fast path exists, not a measurement of anything.
    const control = worstDeadMs({ emptyBoardFastPath: false });

    expect(shipped.belts).toBeGreaterThanOrEqual(6 * SEEDS);
    expect(shipped.spawns).toBeGreaterThan(0);
    expect(shipped.maxGapMs).toBeLessThanOrEqual(2000);
    // If this stops holding, the measure can no longer reach the threshold and
    // the item above is vacuous whatever it reports.
    expect(control.maxGapMs, "the negative control must breach the 2 s limit").toBeGreaterThan(2000);

    mkdirSync("gauntlet/evidence", { recursive: true });
    writeFileSync(
      "gauntlet/evidence/deadtime.json",
      `${JSON.stringify(
        {
          claim: "AC-6e.3: no interval over 2 s with nothing live and spawns still pending",
          harness: "simulateBelt — one serial typist, real fall times, real hull, real pacing",
          method:
            "six belts (Mars->Pluto) on the real content pools, 3 player speeds x 40 seeds, event-driven clock",
          // The old artifact's entire content was `maxGapMs: 120`, which was
          // `simulateStage`'s 120 ms tick. This harness jumps to the exact
          // instant of the next event, so a reading is not rounded to anything.
          measurementResolutionMs: 0,
          maxGapMs: shipped.maxGapMs,
          worstAt: shipped.where,
          belts: shipped.belts,
          spawns: shipped.spawns,
          structuralNote:
            "0 ms is expected and is not a measurement of pacing: FlightScene.trySpawn:955 lets an empty board skip its gap, and picker.ts's final cascade rung filters the pool by nothing but 'not live' and 'first letter not taken', so an empty board always yields a word on the same instant. AC-6e.3 holds BY CONSTRUCTION. What is measured is that the construction is still in place.",
          control: {
            what: "emptyBoardFastPath: false — FlightScene.trySpawn:955's empty-board clause removed, everything else identical",
            maxGapMs: control.maxGapMs,
            worstAt: control.where,
            mustExceedMs: 2000,
          },
          source: "tests/unit/simulation/coreLoop.test.ts",
        },
        null,
        2,
      )}\n`,
    );
  });

  it("NEGATIVE CONTROL: without the empty-board fast path the belt goes quiet past 2 s", () => {
    // The same assertion as the control above, standing alone so it is visible
    // in the test list rather than buried inside the artifact writer.
    const control = worstDeadMs({ emptyBoardFastPath: false });
    expect(control.maxGapMs).toBeGreaterThan(2000);
  });

  it("AC-6e.3: a board that cannot legally fill still does not stall the belt", () => {
    // Every word shares a first letter, so AC-2.1 blocks all but one at a time.
    const collide = ["sun", "sky", "spin", "storm", "star", "solid"];
    const r = simulateBelt(
      { stopIndex: 1, stagePool: collide, retentionPool: [], spawnCount: 12, knobs: { maxLive: 4 } },
      PLAYERS[0]![1],
      {},
      mulberry32(99),
    );
    expect(r.spawned).toBeGreaterThan(0);
    expect(r.maxDeadMs).toBeLessThanOrEqual(2000);
  });
});

// ---------------------------------------------------------------------------
// AC-6e.4 — retention
// ---------------------------------------------------------------------------

/**
 * The delayed re-test AC-6e.4 is about: for words HIT IN MORE THAN ONE STOP,
 * how much faster is the player now than at first exposure?
 *
 * The old measure counted any word with two hits, including two hits inside one
 * belt. That is a repeat, not retention, and it made the number easy to move
 * without the selection engine doing anything at all.
 */
function crossStopImprovement(
  book: WordBook,
  stopsByWord: Map<string, Set<number>>,
  retentionSourced?: Set<string>,
): { words: number; meanMs: number | null; improved: number } {
  const deltas: number[] = [];
  for (const [word, stops] of stopsByWord) {
    if (stops.size < 2) continue;
    if (retentionSourced !== undefined && !retentionSourced.has(word)) continue;
    const record = book[word];
    if (record === undefined) continue;
    const first = firstFkLatency(record);
    const median = medianFkLatency(record);
    if (first === null || median === null) continue;
    deltas.push(first - median);
  }
  if (deltas.length === 0) return { words: 0, meanMs: null, improved: 0 };
  return {
    words: deltas.length,
    meanMs: deltas.reduce((a, b) => a + b, 0) / deltas.length,
    improved: deltas.filter((d) => d > 0).length,
  };
}

describe("AC-6e.4: the retention pipeline reports improvement across a full route (D50, D77)", () => {
  it("AC-6e.4: a learner who improves is reported as improving, on re-met words only", () => {
    const player = PLAYERS[0]![1];
    const perSeed: number[] = [];
    let crossStopWords = 0;
    let engineSourcedWords = 0;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const run = flyRoute(player, seed);
      const r = crossStopImprovement(run.book, run.stopsByWord);
      crossStopWords += r.words;
      engineSourcedWords += crossStopImprovement(run.book, run.stopsByWord, run.retentionSourced).words;
      if (r.meanMs !== null) perSeed.push(r.meanMs);
    }
    expect(perSeed.length).toBe(SEEDS);
    const mean = perSeed.reduce((a, b) => a + b, 0) / perSeed.length;
    const positive = perSeed.filter((d) => d > 0).length;

    // CONTROL 1 (the model). A learner whose cold recognition already sits at
    // the harness's floor cannot get faster, so the pipeline must NOT report an
    // improvement. The control this replaces used 260 ms against a floor of
    // 220, so the largest delta expressible was 40 ms and it was asserted to be
    // under 60 - it could not have failed.
    const flat: SimPlayer = { ...player, coldRecognitionMs: 220 };
    const flatRun = flyRoute(flat, 7);
    const flatResult = crossStopImprovement(flatRun.book, flatRun.stopsByWord);

    // CONTROL 2 (the engine), and the number this lane was asked for. Turn OFF
    // the D21/D23 retention interleave and the selection engine is never asked
    // to bring an earlier stop's word back. The retention line does NOT go to
    // zero - because the real content pools SHARE WORDS, so "cold", "land" and
    // "rock" are re-met at a later stop with no help from the engine at all.
    // That is worth stating plainly: part of this line is a property of the
    // story, not of the SRS. What the control shows is how much of it the
    // engine is responsible for. If the two numbers were equal, the engine
    // would contribute nothing and this item would be measuring the content.
    const withEngine = flyRoute(player, 1);
    const withoutEngine = flyRoute(player, 1, { noRetention: true });
    const withEngineWords = crossStopImprovement(withEngine.book, withEngine.stopsByWord).words;
    const withoutEngineWords = crossStopImprovement(withoutEngine.book, withoutEngine.stopsByWord).words;

    mkdirSync("gauntlet/evidence", { recursive: true });
    writeFileSync(
      "gauntlet/evidence/retention.json",
      `${JSON.stringify(
        {
          claim:
            "AC-6e.4: for words met again at a later stop, the recorded first-key latency is lower than at first exposure",
          notAClaimAbout:
            "whether a child learns. The simulated learner's recognition latency is DEFINED to fall with hit count (tests/unit/simulation/flight.ts recognitionMs), so the SIGN of the improvement is the model's. What the engine supplies, and what the controls below separate out, is WHICH words come back and how often - and that the words pipeline records and reports the improvement when one exists.",
          harness: "simulateBelt — one serial typist, real fall times, real hull, real pacing",
          route:
            "six belts, Mars->Pluto, real content pools. Earth is the activation screen and flies no belt (D57), so the full route is six belts and not seven.",
          stops: ROUTE.length,
          seeds: SEEDS,
          measures: "words HIT IN MORE THAN ONE STOP only; a word hit twice inside one belt is a repeat, not a delayed re-test",
          crossStopWords,
          engineSourcedWords,
          trendUp: mean > 0 && positive === perSeed.length,
          meanImprovementMs: Math.round(mean),
          seedsImproving: positive,
          controls: {
            flatLearner: {
              what: "coldRecognitionMs set to the harness floor (220 ms): a learner who cannot get faster",
              crossStopWords: flatResult.words,
              meanImprovementMs: flatResult.meanMs === null ? null : Math.round(flatResult.meanMs),
              trendUp: flatResult.meanMs !== null && flatResult.meanMs > 0,
              mustBe: "trendUp false — otherwise the pipeline reports improvement for a learner who did not improve",
            },
            noInterleave: {
              what: "noRetention: true — the D21/D23 retention interleave removed, so no earlier stop's word is ever offered to the picker; same player, same seed",
              crossStopWords: withoutEngineWords,
              withInterleave: withEngineWords,
              mustBe: "crossStopWords strictly below withInterleave — otherwise the selection engine contributes nothing and this line measures the content pools' overlap",
            },
          },
          limitations: [
            "the residual crossStopWords under noInterleave are words that appear in more than one stop's own pool; they are re-met without the engine's help and are part of this line whether the SRS runs or not",
            "the magnitude of the improvement is the player model's, not a measurement of the game",
          ],
          source: "tests/unit/simulation/coreLoop.test.ts",
        },
        null,
        2,
      )}\n`,
    );

    expect(crossStopWords).toBeGreaterThan(0);
    expect(engineSourcedWords).toBeGreaterThan(0);
    expect(positive).toBe(perSeed.length);
    expect(mean).toBeGreaterThan(0);
    expect(flatResult.meanMs === null || flatResult.meanMs <= 0, "flat learner must not read as improving").toBe(true);
    expect(withoutEngineWords, "the engine must add re-met words the content pools do not").toBeLessThan(withEngineWords);
  });

  it("NEGATIVE CONTROL: a learner who cannot get faster is not reported as improving", () => {
    const flat: SimPlayer = { ...PLAYERS[0]![1], coldRecognitionMs: 220 };
    const run = flyRoute(flat, 7);
    const r = crossStopImprovement(run.book, run.stopsByWord);
    expect(r.meanMs === null || r.meanMs <= 0).toBe(true);
  });

  it("NEGATIVE CONTROL: removing the retention interleave cuts the re-met words", () => {
    // The control docs/coverage-audit.md asked for: if the line held unchanged
    // with the engine's scheduler removed, the number would be a property of
    // the player model and the content, and nothing to do with the SRS.
    const player = PLAYERS[0]![1];
    for (const seed of [1, 2, 3]) {
      const on = flyRoute(player, seed);
      const off = flyRoute(player, seed, { noRetention: true });
      const onWords = crossStopImprovement(on.book, on.stopsByWord).words;
      const offWords = crossStopImprovement(off.book, off.stopsByWord).words;
      expect(offWords, `seed ${seed}`).toBeLessThan(onWords);
    }
  });

  it("NEGATIVE CONTROL: a word hit twice inside ONE belt is not counted as retention", () => {
    // The measure this replaces counted any word with two hits, which is how a
    // within-stage repeat became evidence for a delayed re-test.
    const book: WordBook = {
      repeat: {
        exposures: 2, hits: 2, misses: 0, typos: 0,
        fkLatencyMs: [400], ikiMs: [300], firstFkLatencyMs: 1200,
        ease: 1, lastSeen: 1, nextEligibleStage: 2,
      },
    };
    const oneStop = new Map([["repeat", new Set([1])]]);
    const twoStops = new Map([["repeat", new Set([1, 3])]]);
    expect(crossStopImprovement(book, oneStop).words).toBe(0);
    expect(crossStopImprovement(book, twoStops).words).toBe(1);
  });
});
