import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  calibrationOf,
  mulberry32,
  simulateBelt,
  type BeltConfig,
  type BeltResult,
  type SimPlayer,
} from "./flight.js";
import { DEFAULT_CALIBRATION } from "@engine/types.js";
import { DEFAULT_FLIGHT_CONFIG, stagePoolFor } from "@game/flight/stage.js";
import { MAX_LIVE_MAX, MAX_LIVE_MIN, concurrencyTarget } from "@engine/controller/knobs.js";
import { MAX_INTENSITY_INDEX, intensityIndex } from "@game/audio/music.js";
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
 * WHAT THE GAME KNOWS IS NOW AN INPUT. Every belt below is flown with the
 * calibration the PROFILE would actually hold, never with the player's real
 * `ikiMs` handed to the game for free. `flight.ts`'s header has the full note;
 * the short version is that injecting it is how this file previously reported
 * zero stalls for a belt a real playthrough could not survive.
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
  /**
   * Time-weighted rocks on the board (UR-51). PEAK IS NOT OCCUPANCY: a belt
   * that touches four rocks for one instant and sits at one for the rest has
   * `peakLive` 4 and is, to the child holding the keyboard, the belt they
   * called boring. This is the number the report is about.
   */
  meanLive: number;
  /** Share of the belt's wall clock spent with three or more rocks live, %. */
  pctTime3plus: number;
}

function flyMany(player: SimPlayer, over: Partial<BeltConfig> = {}): Summary {
  const runs: BeltResult[] = [];
  for (let seed = 1; seed <= SEEDS; seed += 1) runs.push(fly(player, over, seed));
  const deep = runs.reduce(
    (sum, r) => sum + r.liveTimeMs.slice(3).reduce((a, b) => a + b, 0),
    0,
  );
  const clock = runs.reduce((sum, r) => sum + r.durationMs, 0);
  return {
    stalls: runs.filter((r) => r.stalled).length,
    worstHull: Math.min(...runs.map((r) => r.hull)),
    meanDurationS: mean(runs.map((r) => r.durationMs / 1000)),
    meanGapMs: mean(runs.map((r) => mean(r.gaps))),
    meanHitRate: mean(runs.map((r) => r.hitRate)),
    maxDeadMs: Math.max(...runs.map((r) => r.maxDeadMs)),
    peakLive: Math.max(...runs.map((r) => r.peakLive)),
    meanLive: mean(runs.map((r) => r.meanLive)),
    pctTime3plus: clock === 0 ? 0 : (deep / clock) * 100,
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
          // The shipped path: the profile's own baseline, which starts at
          // FR-8's default and is refined from play (D51). NOT the player's
          // real ikiMs injected into the game.
          calibration: "shipped (DEFAULT_CALIBRATION + in-stage refinement)",
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

  it("AC-4.3: THE REGRESSION - the 850 ms constant still wrecks the same belt", () => {
    // The control. Without it, "no stalls" is a claim about a simulation that
    // might simply be unable to produce one.
    //
    // THE FAST CHILD'S FIGURE MOVED, AND THAT IS A CORRECTION, NOT A RELAXATION.
    // This read "every seed, every player" while the harness computed fall time
    // from the PLAYER's `ikiMs` - so it gave a child who types at 260 ms falls a
    // third shorter than the shipped game ever gave anybody, and then reported
    // how badly the old spawn constant treated them. Flown on the baseline the
    // game actually holds, the 850 ms constant is catastrophic for the median
    // and the slow child and merely bad for the fast one: it still produces
    // stalls where the shipped pacing produces none, and still costs them a
    // sixth of their hit rate. Asserting 40 of 40 for that player would be
    // asserting the measurement bug.
    for (const [name, player] of PLAYERS) {
      const old = flyMany(player, { fixedGapMs: 850 });
      const shipped = flyMany(player);
      expect(shipped.stalls, `${name}, shipped pacing`).toBe(0);
      if (player === FAST) {
        expect(old.stalls, `${name} at the old constant`).toBeGreaterThan(0);
        expect(old.meanHitRate, name).toBeLessThan(shipped.meanHitRate - 0.1);
        continue;
      }
      expect(old.stalls, `${name} at the old constant`).toBe(SEEDS);
      expect(old.meanHitRate, name).toBeLessThan(0.6);
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
  /**
   * THE CONFIGURATION THE HULL DECISION WAS MEASURED IN, pinned.
   *
   * This describe is a before-and-after about the HULL, and a before-and-after
   * is only a measurement if one thing moved. The calibration model has since
   * changed underneath it - the game no longer gets the player's `ikiMs` for
   * free, and it now learns during the stage - so both are pinned here to what
   * they were when the 58-in-100 figure was recorded: the player's own
   * baseline, as the pre-flight ritual would measure it, and no in-stage fold.
   * Unpinned, `before` reads 46 rather than 58 and the hull comparison would be
   * quietly measuring two changes at once and crediting whichever is mentioned
   * first. The calibration defect gets its own before-and-after below.
   */
  const stallRate = (over: Partial<BeltConfig>): {
    stalls: number;
    meanHitRate: number;
    meanPassedBy: number;
    meanDurationS: number;
  } => {
    const runs: BeltResult[] = [];
    for (let seed = 1; seed <= STALL_SEEDS; seed += 1) {
      runs.push(
        simulateBelt(
          belt({
            calibration: calibrationOf(GRADE2),
            adaptiveCalibration: false,
            ...over,
          }),
          GRADE2,
          {},
          mulberry32(seed),
        ),
      );
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

/**
 * D51 / AC-11.1 / AC-11.2 / AC-4.3: THE BELT THE GAME ACTUALLY FLIES.
 *
 * The defect, in one sentence: `calibration.ikiMs` was 350 ms for every child
 * who ever played, because `PreflightScene` gated the calibration ritual on
 * `story.newProfile` and nothing in `src/` ever set that flag. Fall time is
 * `len * 1.5 * ikiMs + 1200 * ease`, so a grade-2 typist at 600 ms between keys
 * was given 3207 ms for "fit" when they need 3600 and 5595 ms for "jupiter"
 * when they need 6000. A real playthrough stalled on Jupiter at spawn 18 of 58,
 * hull 0, two words cleared; a clean 100%-accuracy repeat reached hull 1 by
 * spawn 20 at a 35% hit rate against the 84.5% the stage demands.
 *
 * This suite could not see any of it, because both simulations computed fall
 * time from the PLAYER's `ikiMs` rather than from the profile's. They measured
 * a game that already knew the answer. Every figure below comes from the
 * shipped path instead, and the first one reproduces the stall.
 */
describe("D51 / AC-11.2: the game has to find out how fast the child types", () => {
  const fly100 = (over: Partial<BeltConfig>): {
    stalls: number;
    meanHitRate: number;
    worstHull: number;
    meanDurationS: number;
    endIkiMs: number;
  } => {
    const runs: BeltResult[] = [];
    for (let seed = 1; seed <= STALL_SEEDS; seed += 1) {
      runs.push(simulateBelt(belt(over), GRADE2, {}, mulberry32(seed)));
    }
    return {
      stalls: runs.filter((r) => r.stalled).length,
      meanHitRate: mean(runs.map((r) => r.hitRate)),
      worstHull: Math.min(...runs.map((r) => r.hull)),
      meanDurationS: mean(runs.map((r) => r.durationMs / 1000)),
      endIkiMs: Math.round(mean(runs.map((r) => r.calibration.ikiMs))),
    };
  };

  it("AC-4.3: an unmeasured grade-2 pilot cannot fly a single belt", () => {
    // THE SHIPPED GAME, BEFORE. The default baseline, and no way to correct it
    // - which is exactly what the child in the playthrough was handed.
    const unmeasured = fly100({
      calibration: DEFAULT_CALIBRATION,
      adaptiveCalibration: false,
    });
    expect(unmeasured.stalls).toBe(STALL_SEEDS);
    // Not "a low hit rate". NOTHING is cleared: every word is unreachable, so
    // the belt is not hard, it is impossible.
    expect(unmeasured.meanHitRate).toBe(0);
    expect(unmeasured.endIkiMs).toBe(DEFAULT_CALIBRATION.ikiMs);
  });

  it("AC-11.1: the pre-flight ritual is what makes the belt flyable", () => {
    // The (a) half: `PreflightScene` runs the ritual for a profile the game has
    // no measurement of, and writes the answer to the profile.
    const measured = fly100({ calibration: calibrationOf(GRADE2) });
    expect(measured.stalls).toBe(0);
    expect(measured.worstHull).toBeGreaterThan(0);
    expect(measured.meanHitRate).toBeGreaterThanOrEqual(survivableHitRate(WORDS));
  });

  it("D51: a belt flown on the default baseline corrects itself from play", () => {
    // The (b) half, and the reason it is not optional: the ritual is a
    // once-per-profile event, so every profile created before it ever ran - and
    // every child whose speed changes - depends on this path instead.
    //
    // It only works because the fold is fed by KEYSTROKES. Fed by blasts, the
    // loop cannot start: this same player at the default baseline blasts
    // nothing, so there is nothing to learn from, which is the run asserted
    // above at hit rate 0. The first version of the fix measured exactly that.
    const adapting = fly100({ calibration: DEFAULT_CALIBRATION });
    expect(adapting.stalls).toBe(0);
    expect(adapting.worstHull).toBeGreaterThan(0);
    // The belief has to actually arrive somewhere near the truth, or "no
    // stalls" is being carried by something else.
    expect(adapting.endIkiMs).toBeGreaterThan(550);
    expect(adapting.endIkiMs).toBeLessThanOrEqual(GRADE2.ikiMs);
  });

  it("D51: measuring the child does not make the belt harder for anyone else", () => {
    // The median player IS the default baseline, so nothing may move for them;
    // the fast and slow players must not be pushed outside the band either.
    for (const [name, player] of PLAYERS) {
      const runs: BeltResult[] = [];
      for (let seed = 1; seed <= SEEDS; seed += 1) {
        runs.push(simulateBelt(belt({}), player, {}, mulberry32(seed)));
      }
      expect(runs.filter((r) => r.stalled).length, name).toBe(0);
      expect(
        mean(runs.map((r) => r.hitRate)),
        name,
      ).toBeGreaterThanOrEqual(survivableHitRate(WORDS));
    }
  });

  it("records the evidence", () => {
    const evidence = {
      player: GRADE2,
      stageWordCount: WORDS,
      seeds: STALL_SEEDS,
      hull: hullForStage(WORDS),
      survivableHitRate: survivableHitRate(WORDS),
      runs: {
        unmeasured: fly100({
          calibration: DEFAULT_CALIBRATION,
          adaptiveCalibration: false,
        }),
        refinedFromPlay: fly100({ calibration: DEFAULT_CALIBRATION }),
        ritualRan: fly100({ calibration: calibrationOf(GRADE2) }),
      },
      source: "tests/unit/simulation/belt.test.ts",
    };
    mkdirSync("gauntlet/evidence", { recursive: true });
    writeFileSync(
      "gauntlet/evidence/calibration-reaches-the-belt.json",
      JSON.stringify(evidence, null, 2) + "\n",
    );
    expect(evidence.runs.unmeasured.stalls).toBe(STALL_SEEDS);
    expect(evidence.runs.refinedFromPlay.stalls).toBe(0);
    expect(evidence.runs.ritualRan.stalls).toBe(0);
  });
});

/**
 * UR-42 / UR-51: HOW MANY ROCKS ARE ACTUALLY ON THE BOARD.
 *
 * ================== WHAT THE REPORTS SAY ==================
 * UR-42 asks why only one asteroid is ever on screen and whether more arrive at
 * harder levels. UR-51 is the follow-up, after the cost was explained: the belt
 * is too easy, and the difficulty should track the child flying it.
 *
 * ================== WHAT WAS TRUE BEFORE ==================
 * `peakLive` read 2 at maxLive 7 exactly as at maxLive 2, and the time-weighted
 * occupancy - which is the number the complaint is actually about - read
 * 1.00 (median), 1.04 (slow), 1.00 (fast) and 1.03 (grade-2) at BOTH ends of
 * the knob. Zero percent of every belt was spent with three rocks live. The
 * primary difficulty knob had two indistinguishable extremes.
 *
 * ================== WHAT IS ASSERTED HERE ==================
 * Both ends, and the floor is the one that matters most. At `MAX_LIVE_MIN` the
 * belt has to be the belt already measured - the grade-2 child went from 100
 * stalls in 100 to 3 in 240 and none of that may be traded for a busier sky.
 * At `MAX_LIVE_MAX` the board has to be genuinely deep for most of the belt,
 * not deep for an instant.
 */
describe("UR-51 / FR-10: the primary knob now changes what is on the board", () => {
  const ALL: ReadonlyArray<readonly [string, SimPlayer]> = [...PLAYERS, ["grade2", GRADE2]];

  it("UR-51: at the knob's FLOOR the board is exactly the one already measured", () => {
    // THE HARD CONSTRAINT. Not "similar": the floor multiplies every term this
    // change adds by zero, so these have to read what belt-survivability.json
    // recorded before the change - occupancy 1.00-1.04, peak 2, no time at all
    // at three rocks.
    //
    // WATCHED FAILING, with the real numbers: seed CONCURRENCY_TARGET_MIN at
    // 1.5 and the grade-2 child's occupancy at this setting reads 1.344 against
    // the 1.021 on record, their hit rate moves 0.9099 -> 0.9435 and their belt
    // 250.27 s -> 249.02 s. A different game for the child who must not get one.
    for (const [name, player] of ALL) {
      const s = flyMany(player, { knobs: { maxLive: MAX_LIVE_MIN } });
      expect(s.stalls, name).toBe(0);
      expect(s.peakLive, name).toBeLessThanOrEqual(2);
      expect(s.meanLive, name).toBeLessThan(1.05);
      expect(s.pctTime3plus, name).toBe(0);
    }
  });

  it("UR-51: at the knob's CEILING three or four rocks are live for most of the belt", () => {
    // UR-51's claim, as occupancy rather than as a peak. 3.0 is
    // the bar because it is the number A-21.2's top music layer needs: its
    // pressure is live + min(combo,10) x 0.5 against a threshold of 8, so index
    // 2 is unreachable below three live rocks and has never played.
    //
    // WATCHED FAILING, with the real numbers, TWO WAYS - and the second one is
    // the important one.
    //
    // (a) With the whole change out, this reads meanLive 1.004 (median), 1.040
    //     (slow), 1.000 (fast), 1.034 (grade-2) and pctTime3plus 0.0 for all
    //     four. That is the board the user was complaining about.
    //
    // (b) With the PACING half in and the FALL-BUDGET half out - drop `knobs`
    //     from this harness's `fallTimeMs` call - the belt builds the queue out
    //     of rocks budgeted for a one-deep board and drops the back of it:
    //     40 stalls in 40 for the median pilot, hit rate 0.214, meanLive 2.316.
    //     That is the P0a stall defect, reproduced exactly, and it is why the
    //     two halves are one change and not two.
    for (const [name, player] of ALL) {
      const s = flyMany(player, { knobs: { maxLive: MAX_LIVE_MAX } });
      expect(s.meanLive, name).toBeGreaterThanOrEqual(3);
      expect(s.pctTime3plus, name).toBeGreaterThan(85);
      expect(s.peakLive, name).toBeGreaterThanOrEqual(3);
    }
  });

  it("AC-4.3 / UR-51: the deeper board is still survivable, grade-2 included", () => {
    // The other half of the hard constraint, and it is a stall rate rather than
    // an opinion about how busy four rocks feels. The shield canister stays OFF,
    // so this holds without its safety net.
    for (const [name, player] of ALL) {
      const s = flyMany(player, { knobs: { maxLive: MAX_LIVE_MAX } });
      expect(s.stalls, name).toBe(0);
      expect(s.worstHull, name).toBeGreaterThan(0);
      expect(s.meanHitRate, name).toBeGreaterThanOrEqual(survivableHitRate(WORDS));
      // AC-6e.3 still holds: a deeper board must not be bought with dead air.
      expect(s.maxDeadMs, name).toBeLessThanOrEqual(2000);
    }
  });

  it("UR-51: the depth is MONOTONE in the knob, so the ramp is visible at every step", () => {
    // D20 moves one knob per stage, so a child meets this curve one step at a
    // time. A step that did nothing would be a stage that felt like no reward.
    let previous = 0;
    for (let live = MAX_LIVE_MIN; live <= MAX_LIVE_MAX; live += 1) {
      const s = flyMany(MEDIAN, { knobs: { maxLive: live } });
      expect(s.meanLive, `maxLive ${live}`).toBeGreaterThan(previous);
      expect(s.stalls, `maxLive ${live}`).toBe(0);
      previous = s.meanLive;
    }
  });

  it("A-21.2 / UR-51: the third music layer becomes reachable, without touching a music constant", () => {
    // THE KNOCK-ON, MEASURED RATHER THAN HOPED FOR. A-21.2 asks for three
    // intensity layers driven by live asteroids and combo. The pressure is
    // `live + min(combo,10) x 0.5` against thresholds [4, 8], so index 2 needs
    // three live rocks even at a maxed combo - and the board has never held
    // three, so the top layer has never played in the shipping game.
    //
    // Nothing in @game/audio is touched here and nothing may be: if the layer
    // still could not be reached, that would be a separate escalated decision
    // about what the music means, not a threshold to move.
    //
    // THE CONTROL IS THE SHIPPED BOARD: at two live rocks and a maxed combo the
    // pressure is 7 against a threshold of 8, so index 1 is the ceiling.
    expect(intensityIndex(2, 10)).toBe(1);
    expect(MAX_INTENSITY_INDEX).toBe(2);

    for (const [name, player] of ALL) {
      const s = flyMany(player, { knobs: { maxLive: MAX_LIVE_MAX } });
      // The board reaches the depth the top layer needs, and holds it for most
      // of the belt rather than brushing it once.
      expect(intensityIndex(s.peakLive, 10), name).toBe(MAX_INTENSITY_INDEX);
      expect(intensityIndex(Math.floor(s.meanLive), 10), name).toBe(MAX_INTENSITY_INDEX);
      expect(s.pctTime3plus, name).toBeGreaterThan(85);
    }

    // And at the knob's floor it is still unreachable, which is the same
    // statement as "the struggling child's belt has not changed".
    for (const [name, player] of ALL) {
      const s = flyMany(player, { knobs: { maxLive: MAX_LIVE_MIN } });
      expect(intensityIndex(s.peakLive, 10), name).toBeLessThan(MAX_INTENSITY_INDEX);
    }
  });

  it("records the occupancy evidence", () => {
    const rows: Record<string, unknown> = {};
    for (const [name, player] of ALL) {
      for (const maxLive of [MAX_LIVE_MIN, MAX_LIVE_MAX]) {
        const s = flyMany(player, { knobs: { maxLive } });
        rows[`${name}@maxLive${maxLive}`] = {
          ...s,
          meanLive: Number(s.meanLive.toFixed(3)),
          pctTime3plus: Number(s.pctTime3plus.toFixed(1)),
          concurrencyTarget: Number(concurrencyTarget(maxLive).toFixed(2)),
        };
      }
    }
    mkdirSync("gauntlet/evidence", { recursive: true });
    writeFileSync(
      "gauntlet/evidence/belt-occupancy.json",
      `${JSON.stringify(
        {
          ticket: "UR-51 (decision on UR-42)",
          stageWordCount: WORDS,
          seeds: SEEDS,
          canisters: false,
          measure:
            "meanLive is TIME-WEIGHTED rocks on the board; peakLive is the instantaneous maximum. The complaint is about the first.",
          before:
            "peakLive 2 and meanLive 1.00-1.04 at BOTH maxLive 2 and maxLive 7, pctTime3plus 0.0 for every pilot",
          rows,
          source: "tests/unit/simulation/belt.test.ts",
        },
        null,
        2,
      )}\n`,
    );
    expect(Object.keys(rows).length).toBe(8);
  });
});
