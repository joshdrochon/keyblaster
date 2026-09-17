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
import { HULL_BASE_MARKS, hullForStage, survivableHitRate } from "@engine/hull/index.js";
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
/**
 * THE CHILD THIS ROUND IS ABOUT. A grade-2 typist: 600 ms between keys, 0.82
 * per-character accuracy, 2.4 s to recognise a word they do not know yet. These
 * are the numbers in the D27-vs-D17 escalation, so the "before" figure here is
 * directly comparable with the one that was already on record.
 *
 * They are NOT in `PLAYERS`: the three players above are spreads around the
 * median and the survivability assertions are made about them. This one is the
 * tail, and what is measured about them is a rate, not a pass/fail.
 */
const GRADE2: SimPlayer = { accuracy: 0.82, ikiMs: 600, fkLatencyMs: 700, coldRecognitionMs: 2400 };
const STALL_SEEDS = 100;
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
    // THIS CONTROL USED TO BE VACUOUS. It flew a pool whose words all share a
    // first letter and then asserted `maxDeadMs <= 2000` - a restatement of the
    // passing assertion above, not a demonstration that the metric can move. It
    // also could not have worked: a shared first letter only blocks a NON-EMPTY
    // board (AC-2.1), and `picker.ts`'s final cascade rung filters by nothing
    // but "not live" and "first letter not taken", so an empty board always
    // yields a word. Dead time in this harness is structurally impossible while
    // FlightScene.trySpawn:955's empty-board fast path is modelled.
    //
    // So the control removes that clause and nothing else. The belt then waits
    // out its derived gap on an empty board - which is precisely the defect
    // AC-6e.3 forbids - and the metric moves off zero. That is the evidence
    // that a reading of 0 ms above means something.
    //
    // The stronger claim - that the metric can pass 2000, so the THRESHOLD is
    // reachable and not only the metric - takes the whole sweep and is asserted
    // in tests/unit/simulation/coreLoop.test.ts, which records the breach in
    // gauntlet/evidence/deadtime.json for the rubric to gate on. One seed here
    // reaches a few hundred ms; asserting 2000 off a single seed would be a
    // number tuned to one run.
    const quiet = simulateBelt(
      belt({ spawnCount: 24, knobs: { maxLive: MAX_LIVE_MIN }, emptyBoardFastPath: false }),
      SLOW,
      {},
      mulberry32(5),
    );
    expect(quiet.spawned).toBeGreaterThan(0);
    expect(quiet.maxDeadMs).toBeGreaterThan(0);

    // And with the shipped rule back, the same belt on the same seed is silent
    // for no time at all.
    const shipped = simulateBelt(
      belt({ spawnCount: 24, knobs: { maxLive: MAX_LIVE_MIN } }),
      SLOW,
      {},
      mulberry32(5),
    );
    expect(shipped.maxDeadMs).toBe(0);
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

/**
 * D17 vs D27, MEASURED - the decision this round implements.
 *
 * D27 fixes the hull at three marks. D17 targets 85% success. At 18 words those
 * agree; at 58 they cannot, because three marks out of 58 demands 94.8% and
 * that is four points above the TOP of D17's band. The escalation recorded what
 * that costs a real child: a grade-2 typist stalled on 55 of 100 belts.
 *
 * `@engine/hull` turns D27's three marks into D27's RATE - three marks per 18
 * words, so 58 words carries nine - and this is the before-and-after. The two
 * changes are measured SEPARATELY, because one of them is doing nearly all of
 * the work and a single lumped figure would hide which.
 */
describe("D17 / D27 / AC-4.3: the grade-2 child, before and after", () => {
  const stallRate = (over: Partial<BeltConfig>): {
    stalls: number;
    meanHitRate: number;
    meanPassedBy: number;
    meanDurationS: number;
  } => {
    const runs: BeltResult[] = [];
    for (let seed = 1; seed <= STALL_SEEDS; seed += 1) {
      runs.push(simulateBelt(belt(over), GRADE2, {}, mulberry32(seed)));
    }
    return {
      stalls: runs.filter((r) => r.stalled).length,
      meanHitRate: mean(runs.map((r) => r.hitRate)),
      meanPassedBy: mean(runs.map((r) => r.passedBy)),
      meanDurationS: mean(runs.map((r) => r.durationMs / 1000)),
    };
  };

  it("AC-4.3 / D31: the stall rate goes from most belts to none of them", () => {
    // BEFORE: the shipped hull of 3 against a 58-word stage, the exact
    // configuration the escalation measured. AFTER: the same belt, same seeds,
    // same child, with the hull scaled by stage length.
    const before = stallRate({ maxHull: HULL_BASE_MARKS, practiceRocksPassBy: false });
    const passByOnly = stallRate({ maxHull: HULL_BASE_MARKS });
    const hullOnly = stallRate({ practiceRocksPassBy: false });
    const after = stallRate({});
    const withCanisters = stallRate({ canisters: true });

    // The baseline has to reproduce the number already on record, or the
    // "after" figure is being compared against a different simulation.
    expect(before.stalls).toBeGreaterThan(50);
    expect(before.stalls).toBeLessThanOrEqual(60);

    // THE CLAIM. Not "fewer"; none. D31 says the child who stalls is not the
    // problem, and a stage that ends under one child in a hundred is a stage
    // that ends under children.
    expect(after.stalls).toBe(0);
    // And it is the HULL doing it, not the trajectory change riding along.
    expect(hullOnly.stalls).toBe(0);
    expect(passByOnly.stalls).toBeGreaterThan(30);
    expect(withCanisters.stalls).toBe(0);

    mkdirSync("gauntlet/evidence", { recursive: true });
    writeFileSync(
      "gauntlet/evidence/grade2-stall-rate.json",
      JSON.stringify(
        {
          player: GRADE2,
          stageWordCount: WORDS,
          seeds: STALL_SEEDS,
          hullBefore: HULL_BASE_MARKS,
          hullAfter: hullForStage(WORDS),
          survivableHitRateBefore: survivableHitRate(WORDS, HULL_BASE_MARKS),
          survivableHitRateAfter: survivableHitRate(WORDS),
          runs: { before, passByOnly, hullOnly, after, withCanisters },
          source: "tests/unit/simulation/belt.test.ts",
        },
        null,
        2,
      ) + "\n",
    );
  });

  it("D17: the child now lands inside the band instead of under the floor", () => {
    // The point of the change is not "easier". It is that the measured hit rate
    // and the rate the stage DEMANDS finally overlap, which is what D17 and D27
    // were always meant to say together.
    const after = stallRate({});
    expect(after.meanHitRate).toBeGreaterThanOrEqual(survivableHitRate(WORDS));
  });

  it("D21/D23: the pass-by is a trajectory change, not a difficulty discount", () => {
    // How much hull the practice rule actually gives back over a whole stage.
    // If this were large, "trajectory not difficulty" would be a slogan rather
    // than a description - a stage would be measurably easier because rocks
    // stopped counting.
    const after = stallRate({});
    expect(after.meanPassedBy).toBeLessThan(1);
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
