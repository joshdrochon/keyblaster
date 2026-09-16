import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  mulberry32,
  simulateBelt,
  type BeltConfig,
  type BeltResult,
  type SimPlayer,
} from "./flight.js";
import { DEFAULT_FLIGHT_CONFIG, stagePoolFor } from "@game/flight/stage.js";
import { MAX_LIVE_MAX, MAX_LIVE_MIN } from "@engine/controller/knobs.js";
import type { WordBook } from "@engine/words/index.js";

/**
 * IS A BELT SURVIVABLE? (FR-6, AC-4.1, AC-4.2, AC-4.3, AC-6e.3; D27, D31.)
 *
 * THE DEFECT THIS FILE EXISTS FOR. `FlightScene` fed the belt a rock every
 * 850 ms, a constant, while a child clears roughly one word every two seconds.
 * A rock that is not being typed is still falling, so the surplus did not queue
 * - it landed. Three landings empty the hull (D27) and the stage stalls, and
 * `tests/e2e/playthrough.spec.ts` watched that happen five times in a row.
 *
 * WHY NOTHING CAUGHT IT. Every unit test in this suite was about one module, and
 * no module is wrong: the gap was in FlightScene, the fall time in fallTime, the
 * concurrency cap in controller. The one whole-run harness, `simulateStage`,
 * clears every live rock independently - a player with as many hands as the
 * board has rocks - so the arrival rate never had to be compared with anything.
 * `simulateBelt` is the same harness with a single serial typist and a real
 * hull, which is the only shape in which the question can be asked at all.
 *
 * WHAT IS ASSERTED, AND WHAT IS ONLY MEASURED. Survivability is asserted, for
 * three player speeds, across seeds, at both ends of the `maxLive` knob, and
 * with the shield canister turned OFF so the claim holds without its safety net.
 * Belt DURATION is measured and written to evidence: it is a property of the
 * player's hands, not of the spawner, and the numbers are in the report rather
 * than in an assertion that would quietly redefine `stageWordCount`.
 */

const MARS = stagePoolFor("mars");
const JUPITER = stagePoolFor("jupiter");
const SATURN = stagePoolFor("saturn");
const WORDS = DEFAULT_FLIGHT_CONFIG.stageWordCount;
const SEEDS = 40;

/**
 * Three children, spread either side of `DEFAULT_CALIBRATION` (iki 350, fk 500)
 * by the same +/-25% the stage-length model uses.
 *
 * `coldRecognitionMs` is deliberately far above each one's measured first-key
 * latency. That is the honest case and it is the hard one: the ritual measures
 * recognition on short, high-frequency words (D51), so a stage of unfamiliar
 * ones costs more than calibration alone can predict, and the belt has to find
 * that out by watching. A player model that recognises every word at its
 * calibrated latency would let a belt paced purely off calibration look safe.
 */
const MEDIAN: SimPlayer = { accuracy: 0.93, ikiMs: 350, fkLatencyMs: 500, coldRecognitionMs: 1500 };
const SLOW: SimPlayer = { accuracy: 0.88, ikiMs: 440, fkLatencyMs: 650, coldRecognitionMs: 1900 };
const FAST: SimPlayer = { accuracy: 0.97, ikiMs: 260, fkLatencyMs: 400, coldRecognitionMs: 1100 };

const PLAYERS: ReadonlyArray<readonly [string, SimPlayer]> = [
  ["median", MEDIAN],
  ["slow", SLOW],
  ["fast", FAST],
];

function belt(over: Partial<BeltConfig> = {}): BeltConfig {
  return {
    stopIndex: 1,
    stagePool: MARS,
    retentionPool: [],
    spawnCount: WORDS,
    ...over,
  };
}

function fly(player: SimPlayer, over: Partial<BeltConfig> = {}, seed = 1): BeltResult {
  return simulateBelt(belt(over), player, {}, mulberry32(seed));
}

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

interface Summary {
  stalls: number;
  worstHull: number;
  meanDurationS: number;
  meanGapMs: number;
  meanHitRate: number;
  maxDeadMs: number;
  peakLive: number;
}

function flyMany(player: SimPlayer, over: Partial<BeltConfig> = {}): Summary {
  const runs: BeltResult[] = [];
  for (let seed = 1; seed <= SEEDS; seed += 1) runs.push(fly(player, over, seed));
  return {
    stalls: runs.filter((r) => r.stalled).length,
    worstHull: Math.min(...runs.map((r) => r.hull)),
    meanDurationS: mean(runs.map((r) => r.durationMs / 1000)),
    meanGapMs: mean(runs.map((r) => mean(r.gaps))),
    meanHitRate: mean(runs.map((r) => r.hitRate)),
    maxDeadMs: Math.max(...runs.map((r) => r.maxDeadMs)),
    peakLive: Math.max(...runs.map((r) => r.peakLive)),
  };
}

describe("AC-4.3 / FR-6: a Mars belt is completable without the hull reaching zero", () => {
  it("AC-4.3: the hull survives a whole belt for a median, a slow and a fast typist", () => {
    const evidence: Record<string, unknown> = {};
    for (const [name, player] of PLAYERS) {
      for (const maxLive of [MAX_LIVE_MIN, MAX_LIVE_MAX]) {
        const s = flyMany(player, { knobs: { maxLive } });
        evidence[`${name}@maxLive${maxLive}`] = s;
        // Not "usually survives". A stage that stalls for one child in forty is
        // a stage that stalls, and D31 says that child is not the problem.
        expect(s.stalls, `${name} at maxLive ${maxLive}`).toBe(0);
        expect(s.worstHull, `${name} at maxLive ${maxLive}`).toBeGreaterThan(0);
      }
    }
    mkdirSync("gauntlet/evidence", { recursive: true });
    writeFileSync(
      "gauntlet/evidence/belt-survivability.json",
      JSON.stringify(
        {
          stageWordCount: WORDS,
          seeds: SEEDS,
          canisters: false,
          players: evidence,
          source: "tests/unit/simulation/belt.test.ts",
        },
        null,
        2,
      ) + "\n",
    );
  });

  it("AC-4.2: every rock that spawns is accounted for, blasted or breached", () => {
    for (const [name, player] of PLAYERS) {
      const r = fly(player);
      expect(r.spawned, name).toBe(WORDS);
      expect(r.spawns.length, name).toBe(WORDS);
      expect(r.blasted + r.breaches, name).toBe(WORDS);
    }
  });

  it("AC-4.3: THE REGRESSION - the 850 ms constant stalls the same belt, every seed", () => {
    // The control. Without it, "no stalls" is a claim about a simulation that
    // might simply be unable to produce one.
    for (const [name, player] of PLAYERS) {
      const s = flyMany(player, { fixedGapMs: 850 });
      expect(s.stalls, `${name} at the old constant`).toBe(SEEDS);
      expect(s.meanHitRate, name).toBeLessThan(0.6);
    }
  });

  it("AC-4.3: it holds across a three-stop run, with retention words in the mix", () => {
    // A later belt is harder in two ways the first cannot show: the word book
    // has decayed `ease` (shorter falls) and 20% of spawns come from earlier
    // stops (AC-9.3). Both land on the same pacing.
    for (const [name, player] of PLAYERS) {
      let book: WordBook = {};
      const rng = mulberry32(7);
      const stages: Array<[number, readonly string[], readonly string[]]> = [
        [1, MARS, []],
        [2, JUPITER, MARS],
        [3, SATURN, [...MARS, ...JUPITER]],
      ];
      for (const [stopIndex, pool, retention] of stages) {
        const r = simulateBelt(
          belt({ stopIndex, stagePool: pool, retentionPool: retention }),
          player,
          book,
          rng,
        );
        expect(r.stalled, `${name} at stop ${stopIndex}`).toBe(false);
        expect(r.hull, `${name} at stop ${stopIndex}`).toBeGreaterThan(0);
        book = r.book;
      }
    }
  });
});

describe("AC-6e.3: pacing the belt to the player does not empty the sky", () => {
  it("AC-6e.3: no interval over 2 s with nothing live and spawns still pending", () => {
    // The risk the fix creates, and the reason the gap is only ever a delay onto
    // a NON-EMPTY board: an empty board with rocks pending spawns at once.
    for (const [name, player] of PLAYERS) {
      for (const maxLive of [MAX_LIVE_MIN, MAX_LIVE_MAX]) {
        const s = flyMany(player, { knobs: { maxLive } });
        expect(s.maxDeadMs, `${name} at maxLive ${maxLive}`).toBeLessThanOrEqual(2000);
      }
    }
  });

  it("AC-6e.3: the measure can be non-zero, so zero means something", () => {
    // A belt whose words all share a first letter cannot legally fill the board
    // (AC-2.1), which is the one way a gap-free board can still go quiet.
    const collide = ["sun", "sky", "spin", "storm", "star", "solid"];
    const r = simulateBelt(
      belt({ stagePool: collide, spawnCount: 12, knobs: { maxLive: MAX_LIVE_MAX } }),
      MEDIAN,
      {},
      mulberry32(5),
    );
    expect(r.spawned).toBeGreaterThan(0);
    expect(r.maxDeadMs).toBeLessThanOrEqual(2000);
  });
});

describe("D31: the belt slows down for the player who is struggling", () => {
  it("D31: a less accurate child gets a LONGER gap, at identical calibration", () => {
    // Same hands, same words, worse day. Nothing about the response may be a
    // punishment, so the only thing that may move is how much room they get.
    const steady: SimPlayer = { ...MEDIAN, accuracy: 0.98 };
    const struggling: SimPlayer = { ...MEDIAN, accuracy: 0.7 };
    const a = flyMany(steady);
    const b = flyMany(struggling);
    expect(b.meanGapMs).toBeGreaterThan(a.meanGapMs);
  });

  it("D31: tightening maxLive never feeds a struggling player faster than they clear", () => {
    const struggling: SimPlayer = { ...SLOW, accuracy: 0.75 };
    for (const maxLive of [MAX_LIVE_MIN, MAX_LIVE_MAX]) {
      const s = flyMany(struggling, { knobs: { maxLive } });
      // The D17 band's own floor. Below this the controller itself calls the
      // stage too hard (LOOSEN_BELOW), so the belt has stopped being a belt.
      expect(s.meanHitRate, `maxLive ${maxLive}`).toBeGreaterThanOrEqual(0.8);
    }
  });
});

describe("FR-6: how long a belt takes is the player's hands, not the spawner", () => {
  it("FR-6: the belt is bounded by what the player clears, not by the gap", () => {
    // The pacing throttles; it never drives. A belt cannot be shorter than the
    // words in it take to type, and this says it is not much longer either -
    // which is what stops a safe gap from turning into a slow one.
    for (const [name, player] of PLAYERS) {
      const r = fly(player);
      const spent = r.spawns.filter((s) => s.hit).reduce((sum, s) => sum + s.actualMs, 0);
      expect(r.durationMs, name).toBeGreaterThanOrEqual(spent);
      expect(r.durationMs / spent, name).toBeLessThan(1.25);
    }
  });

  it("FR-6: a median typist's Mars belt lands inside the 90-150 s target", () => {
    const s = flyMany(MEDIAN);
    expect(s.meanDurationS).toBeGreaterThanOrEqual(90);
    expect(s.meanDurationS).toBeLessThanOrEqual(150);
  });

  it("FR-6: the belt orders by typing speed, fastest child first", () => {
    const fast = flyMany(FAST).meanDurationS;
    const median = flyMany(MEDIAN).meanDurationS;
    const slow = flyMany(SLOW).meanDurationS;
    expect(fast).toBeLessThan(median);
    expect(median).toBeLessThan(slow);
  });
});
