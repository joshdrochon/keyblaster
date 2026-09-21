import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  calibrationOf,
  mulberry32,
  simulateBelt,
  type BeltResult,
  type SimPlayer,
} from "./flight.js";
import { BELT_STOP_IDS, type Calibration, type StopId } from "@engine/types.js";
import { DEFAULT_KNOBS } from "@engine/controller/knobs.js";
import {
  type SpawnOutcome,
  clearanceMargin,
  createController,
  createMarginWindow,
  endStage,
  recordOutcome,
} from "@engine/controller/index.js";
import { DEFAULT_FLIGHT_CONFIG, stagePoolFor, retentionPoolFor } from "@game/flight/stage.js";
import {
  CANISTER_SPAWN_CHANCE,
  HULL_BASE_MARKS,
  HULL_PASS_COST,
  hullForStage,
  survivableHitRate,
} from "@engine/hull/index.js";

/**
 * ==========================================================================
 * HOW BIG IS THE HULL? THE SWEEP THE OWNER PICKED 6 FROM (C26, RESOLVED)
 * ==========================================================================
 *
 * ================== THE QUESTION, AND WHOSE IT WAS ==================
 * The project owner asked for the hull to go back to three hits: "it should
 * still be 3 hits, and we have the repair rocks so should be fine." AC-4.1 is
 * on their side of the wording - it says `hull == 3 at every stage start` in as
 * many words - while `hullForStage` had been returning 9 at the shipped 58-word
 * belt since the D27/D17 reconciliation. That collision is C26, and it was
 * MEASURED rather than answered from a comment, because the ask has one
 * measurable premise and the premise is the second half of the sentence: the
 * repair rocks.
 *
 * THE OWNER HAS SINCE DECIDED: SIX MARKS AT THE SHIPPED BELT. This file is no
 * longer the argument for a hull size. It is the standing measurement UNDER
 * that decision - the sweep, re-run against the tree, with the one bar that did
 * not move asserted at the top: grade-2 loses no belts.
 *
 * ================== WHY IT NEEDED MEASURING AT ALL ==================
 * The canister is not a refund. It is an ORDINARY ROCK with an ordinary fall
 * time that happens to give a mark back when it is BLASTED (AC-5.2), and the
 * pilot who needs one most is the pilot least able to reach it. It also
 * competes for the only server the game has: AC-2.1 gives the child one word at
 * a time, so every canister typed is an ordinary rock that was not. A hull
 * budget that counts canisters SPAWNED is counting a rescue that may never
 * arrive, which is why `BeltResult` carries spawned and cleared separately.
 *
 * ================== THE HARNESS ==================
 * `simulateBelt` through the whole six-stop route, exactly as
 * `nestedRoute.test.ts` flies it: a cold profile per seed, the controller
 * rebuilt inside each stop's band (UR-83) with the rolling windows carried
 * across (D53), the belief re-folded from the pilot's own keystrokes, the D21
 * retention interleave live, and D101's two-layer rocks at Neptune and Pluto.
 * The ONLY differences between the arms below are `maxHull` and the canister
 * settings.
 *
 * Canisters are ON in every arm here. They default OFF in the harness, which is
 * right for a survivability claim that wants no safety net - but this file's
 * whole question is what the net is worth, so leaving it off would beg it.
 *
 * ================== SEEDS, AND WHY THERE IS A KNOB ON THEM ==================
 * The assertions run at `SEEDS` = 40, i.e. 240 belts per pilot per arm, which
 * is what a 3.5-minute suite can afford for five arms. The TABLE the decision
 * was taken from is 120 seeds (720 belts per pilot) and is reproduced with
 *
 *   KB_HULL_SEEDS=120 npx vitest run tests/unit/simulation/hullThreeHits.test.ts \
 *     --coverage.enabled=false
 *
 * which rewrites `gauntlet/evidence/hull-three-hits.json` with the long run.
 * The seed count is the ONLY thing the variable moves; every arm, pilot and
 * assertion is identical, so the committed run is a subsample of the artifact
 * rather than a different experiment. Both runs are recorded below.
 *
 * ================== WHAT IT SAYS, 120 SEEDS, 720 BELTS/PILOT ==================
 * Measured against THIS tree, 2026-09-20, `gauntlet/evidence/hull-three-hits.json`:
 *
 *   stalls per 720 belts       ace  fast  median  slow  grade2  needs
 *   maxHull 9 (the old rate)     0     0      82     9      0    84.5%
 *   maxHull 6 (SHIPPED, C26)     0     6     162    64      0    89.7%
 *   maxHull 5                    1    22     202   112      0    91.4%  <- over D17
 *   maxHull 3 (AC-4.1 literal)  58   135     307   309     42    94.8%  <- over D17
 *   maxHull 3, canisters MAXED  10    43     165   106     35    94.8%
 *
 * THESE ARE NOT THE NUMBERS C26 WAS FIRST LOGGED WITH (the shipped row read
 * `0 0 52 4 0` at nine marks) AND THE DIFFERENCE IS NOT NOISE. Two things moved
 * under the sweep since: `QUEUE_PAY` is 0.45 in `@engine/fallTime`, which the
 * owner approved by play and which costs every pilot time on a deep board, and
 * `hullAfterShield` no longer over-pays a repair on a half-damaged hull (the
 * AC-5.2 fix below). Both make every arm harsher, and they move the arms
 * together - the SHAPE of the sweep, which is what the decision was taken from,
 * is unchanged, and so is the row the decision turns on. The table was re-run
 * rather than inherited, which is why it is quoted from a run and dated.
 *
 * ================== WHY 6 AND NOT 5, WHICH ALSO HOLDS THE LINE ==================
 * Five marks keeps the grade-2 pilot at zero too, so the guarantee alone does
 * not pick between them. D17 does: five marks over 58 words is survivable only
 * above 91.4%, which is over the top of the 80-90% band the whole controller is
 * tuned to hold a child inside, and six is the smallest hull that is not. The
 * two constraints meet at exactly one number, which is the number the owner
 * chose from the stall table. `hullForStage` is written as that relation
 * (`HULL_SPAWNS_PER_MARK`) rather than as the literal 6.
 *
 * ================== AND THREE IS STILL NOT REACHABLE ==================
 * THE GUARANTEE BREAKS AT THREE. The grade-2 pilot - 600 ms between keys, 82%
 * accuracy, the tail this project has re-proved every difficulty change against
 * - loses 41 belts of 720, and THE OWNER'S OWN LEVER DOES NOT RECOVER IT:
 * `CANISTER_SPAWN_CHANCE` at 1.0 with three canisters live at once, roughly a
 * third of the belt turned into repair rocks and far past anything shippable,
 * still leaves them losing 32. A 3-mark hull holds THREE EVENTS; a canister has
 * to spawn, fall and be typed by the same one pair of hands that is already
 * behind. More repair rocks help the child who does not need them.
 *
 * That negative result is asserted, not narrated: if a later change makes a
 * 3-mark hull survivable for grade-2, the assertion goes RED and demands the
 * question be re-measured rather than re-decided from this comment.
 *
 * ================== THE HALF MARK NOBODY CAN SEE ==================
 * `HULL_PASS_COST` is 0.5 and both surfaces that show damage read
 * `hullMarksLit`, which CEILS - so a pass-by dims the Lantern not at all and
 * opens no repair window. Measured here at six marks and NOT changed: what a
 * near miss should do to the ship's light is a feel decision, and it is the
 * owner's. Numbers, options and a lean are in `gauntlet/escalations.md`.
 */

const SEEDS = Number.parseInt(process.env.KB_HULL_SEEDS ?? "40", 10) || 40;
const WORDS = DEFAULT_FLIGHT_CONFIG.stageWordCount;
const BELTS = SEEDS * BELT_STOP_IDS.length;

/** D17's band: ~85% success, "the center of an ~80-90% band". */
const BAND_FLOOR = 0.8;
const BAND_CEILING = 0.9;

/** The hull the owner's decision put on the shipped belt (C26). */
const SHIPPED_HULL = hullForStage(WORDS);

const ACE: SimPlayer = { accuracy: 0.999, ikiMs: 240, fkLatencyMs: 380, coldRecognitionMs: 1000 };
const FAST: SimPlayer = { accuracy: 0.97, ikiMs: 260, fkLatencyMs: 400, coldRecognitionMs: 1100 };
const MEDIAN: SimPlayer = { accuracy: 0.93, ikiMs: 350, fkLatencyMs: 500, coldRecognitionMs: 1500 };
const SLOW: SimPlayer = { accuracy: 0.88, ikiMs: 440, fkLatencyMs: 650, coldRecognitionMs: 1800 };
/** The tail, and the guarantee: this pilot must not lose belts. */
const GRADE2: SimPlayer = {
  accuracy: 0.82,
  ikiMs: 600,
  fkLatencyMs: 700,
  coldRecognitionMs: 2400,
};

const PILOTS: ReadonlyArray<readonly [string, SimPlayer]> = [
  ["ace", ACE],
  ["fast", FAST],
  ["median", MEDIAN],
  ["slow", SLOW],
  ["grade2", GRADE2],
];

interface Arm {
  /** Hull marks, or undefined for the shipped `hullForStage`. */
  readonly maxHull?: number;
  readonly canisterChance: number;
  readonly canisterMaxLive: number;
}

interface RouteRow {
  stalls: number;
  perStopStalls: number[];
  canistersSpawned: number;
  canistersCleared: number;
  damage: number;
  repaired: number;
  passedBy: number;
  coresBreached: number;
  silentHullEvents: number;
  canisterGateShutWhileDamaged: number;
  hitRate: number;
  worstHull: number;
}

const avg = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

function flyRoute(player: SimPlayer, arm: Arm): RouteRow {
  const perStopStalls = new Array<number>(BELT_STOP_IDS.length).fill(0);
  const hitRates: number[] = [];
  let stalls = 0;
  let canistersSpawned = 0;
  let canistersCleared = 0;
  let damage = 0;
  let repaired = 0;
  let passedBy = 0;
  let coresBreached = 0;
  let silentHullEvents = 0;
  let canisterGateShutWhileDamaged = 0;
  let worstHull = Number.POSITIVE_INFINITY;

  for (let seed = 1; seed <= SEEDS; seed += 1) {
    let knobs = DEFAULT_KNOBS;
    let carriedOutcomes: readonly SpawnOutcome[] = [];
    let carriedMargins = createMarginWindow([]);
    let calibration: Calibration = calibrationOf(player);
    const rng = mulberry32(seed);

    for (let i = 0; i < BELT_STOP_IDS.length; i += 1) {
      const stopId = BELT_STOP_IDS[i] as StopId;
      const controller = createController({
        knobs,
        window: carriedOutcomes,
        margins: carriedMargins,
        stopId,
      });
      const result: BeltResult = simulateBelt(
        {
          stopIndex: i + 1,
          stopId,
          stagePool: stagePoolFor(stopId),
          retentionPool: retentionPoolFor(BELT_STOP_IDS.slice(0, i)),
          spawnCount: WORDS,
          calibration,
          knobs: controller.knobs,
          canisters: true,
          canisterChance: arm.canisterChance,
          canisterMaxLive: arm.canisterMaxLive,
          maxHull: arm.maxHull,
        },
        player,
        {},
        rng,
      );

      if (result.stalled) {
        stalls += 1;
        perStopStalls[i] = (perStopStalls[i] ?? 0) + 1;
      }
      canistersSpawned += result.canistersSpawned;
      canistersCleared += result.canistersCleared;
      damage += result.hullDamage;
      repaired += result.hullRepaired;
      passedBy += result.passedBy;
      coresBreached += result.coresBreached;
      silentHullEvents += result.silentHullEvents;
      canisterGateShutWhileDamaged += result.canisterGateShutWhileDamaged;
      hitRates.push(result.hitRate);
      worstHull = Math.min(worstHull, result.hull);

      const margins = result.spawns.map((s) =>
        clearanceMargin({
          spawnedAtMs: s.spawnedAtMs,
          leftAtMs: s.clearedAtMs,
          fallMs: s.fallMs,
        }),
      );
      let next = controller;
      result.spawns.forEach((spawn, k) => {
        next = recordOutcome(next, spawn.hit ? "blasted" : "missed", margins[k] as number);
      });
      next = endStage(next);
      knobs = next.knobs;
      carriedOutcomes = next.window.outcomes;
      carriedMargins = next.margins;
      calibration = result.calibration;
    }
  }

  return {
    stalls,
    perStopStalls,
    canistersSpawned,
    canistersCleared,
    damage,
    repaired,
    passedBy,
    coresBreached,
    silentHullEvents,
    canisterGateShutWhileDamaged,
    hitRate: avg(hitRates),
    worstHull,
  };
}

const ARMS: Record<string, Arm> = {
  /** WHAT SHIPS: `hullForStage`, six marks at 58 words, the canister rule as it ships. */
  shipped: { canisterChance: CANISTER_SPAWN_CHANCE, canisterMaxLive: 1 },
  /** The rate that shipped before C26 was resolved - nine marks at 58 words. */
  nine: { maxHull: 9, canisterChance: CANISTER_SPAWN_CHANCE, canisterMaxLive: 1 },
  /** One mark below the decision, and the reason it was not the decision. */
  five: { maxHull: 5, canisterChance: CANISTER_SPAWN_CHANCE, canisterMaxLive: 1 },
  /** AC-4.1 read literally: three marks, and the same shipped canister rule. */
  threeHits: { maxHull: HULL_BASE_MARKS, canisterChance: CANISTER_SPAWN_CHANCE, canisterMaxLive: 1 },
  /** Three marks with the canister lever pushed past anything shippable. */
  threeHitsMaxedCanisters: { maxHull: HULL_BASE_MARKS, canisterChance: 1, canisterMaxLive: 3 },
};

const rows: Record<string, Record<string, RouteRow>> = {};
for (const [arm, cfg] of Object.entries(ARMS)) {
  rows[arm] = Object.fromEntries(
    PILOTS.map(([name, player]) => [name, flyRoute(player, cfg)]),
  ) as Record<string, RouteRow>;
}

const row = (arm: string, pilot: string): RouteRow => rows[arm]?.[pilot] as RouteRow;

describe("C26 / D27 / D17 / AC-4.1: how big the hull is at a 58-word belt", () => {
  it("C26: the shipped belt carries SIX marks, which is what the owner decided", () => {
    // The decision, as one assertion, stated against the config the game boots
    // rather than against the literal 58 - if `stageWordCount` moves, this row
    // moves with it and the rate is what holds (`HULL_SPAWNS_PER_MARK`).
    //
    // WATCHED FAILING at `toBe(9)`:
    //   "the shipped 58-word belt carries 6 marks: expected 6 to be 9
    //    // Object.is equality"
    expect(
      SHIPPED_HULL,
      `the shipped ${WORDS}-word belt carries ${SHIPPED_HULL} marks`,
    ).toBe(6);
  });

  it("D17: six marks lands INSIDE the band, and five - which also holds the line - does not", () => {
    // WHY THE ANSWER IS 6 AND NOT 5, in arithmetic rather than in stalls. Both
    // keep grade-2 at zero (the table below); only one of them is a belt D17
    // says a child can be held inside. This is the whole content of
    // `HULL_SPAWNS_PER_MARK` being ten.
    //
    // WATCHED FAILING with the shipped line asserted at `toBeGreaterThan`:
    //   "6 marks over 58 words needs 89.7%, inside D17's 80.0-90.0% band:
    //    expected 0.896551724137931 to be greater than 0.9"
    const atShipped = survivableHitRate(WORDS, SHIPPED_HULL);
    const atFive = survivableHitRate(WORDS, 5);
    const atThree = survivableHitRate(WORDS, HULL_BASE_MARKS);
    expect(
      atShipped,
      `${SHIPPED_HULL} marks over ${WORDS} words needs ${(atShipped * 100).toFixed(1)}%, inside D17's ${(BAND_FLOOR * 100).toFixed(1)}-${(BAND_CEILING * 100).toFixed(1)}% band`,
    ).toBeLessThanOrEqual(BAND_CEILING);
    expect(atShipped).toBeGreaterThanOrEqual(BAND_FLOOR);
    expect(
      atFive,
      `5 marks over ${WORDS} words needs ${(atFive * 100).toFixed(1)}% - above D17's ceiling, which is why the smallest hull that holds the grade-2 line is not the hull that ships`,
    ).toBeGreaterThan(BAND_CEILING);
    expect(
      atThree,
      `${HULL_BASE_MARKS} marks over ${WORDS} words needs ${(atThree * 100).toFixed(1)}% - D17's band tops out at ${(BAND_CEILING * 100).toFixed(1)}%`,
    ).toBeGreaterThan(BAND_CEILING);
    // And D27 is untouched at the length it was written for.
    expect(
      survivableHitRate(18, hullForStage(18)),
      "an 18-word belt no longer matches D27's own arithmetic",
    ).toBeCloseTo(1 - 3 / 18, 10);
  });

  it("AC-4.3: the grade-2 pilot loses NO belt on the six-mark hull that ships", () => {
    // THE BAR THAT DID NOT MOVE, on the arm that ships, re-measured against
    // this tree rather than inherited from the lane that proposed the change.
    // Everything else in this file is a comparison against this line.
    //
    // WATCHED FAILING at `toBe(1)`:
    //   "grade-2 stalled 0 times in 240 belts on the shipped 6-mark hull (per
    //    stop: [0,0,0,0,0,0]) - this is the invariant every other claim in this
    //    file is measured against: expected +0 to be 1 // Object.is equality"
    const r = row("shipped", "grade2");
    expect(
      r.stalls,
      `grade-2 stalled ${r.stalls} times in ${BELTS} belts on the shipped ${SHIPPED_HULL}-mark hull (per stop: ${JSON.stringify(r.perStopStalls)}) - this is the invariant every other claim in this file is measured against`,
    ).toBe(0);
  });

  it("C26: going 9 -> 6 cost the tail nothing, and it is not free further up the range", () => {
    // WHAT THE CHANGE ACTUALLY BOUGHT AND SPENT, both halves stated. The hull
    // got a third smaller: the pilots with room lose belts they did not lose
    // before, and the pilot the guarantee is about does not. A test that only
    // asserted the guarantee would pass on a hull of 900.
    //
    // WATCHED FAILING with `toBeGreaterThan(tailNine.stalls)`:
    //   "the tail paid for the smaller hull: 0 stalls at nine marks, 0 at six:
    //    expected 0 to be greater than 0"
    const tailNine = row("nine", "grade2");
    const tailSix = row("shipped", "grade2");
    expect(
      tailSix.stalls,
      `the tail paid for the smaller hull: ${tailNine.stalls} stalls at nine marks, ${tailSix.stalls} at six`,
    ).toBe(tailNine.stalls);
    const median = row("shipped", "median").stalls;
    const medianNine = row("nine", "median").stalls;
    expect(
      median,
      `the median pilot lost ${median} belts of ${BELTS} at six marks against ${medianNine} at nine - if these are equal the arms are not measuring different games`,
    ).toBeGreaterThan(medianNine);
  });

  it("C26: the sweep is monotone in hull size - a smaller hull never costs a pilot less", () => {
    // The sweep as a shape rather than as five numbers, so the table cannot
    // drift into nonsense one arm at a time.
    //
    // WATCHED FAILING with the six/five step asserted the other way round:
    //   "fast: 0 stalls at nine marks, 2 at six, 8 at five, 47 at three - the
    //    sweep is not monotone in hull size: expected 8 to be less than or
    //    equal to 2"
    for (const [name] of PILOTS) {
      const nine = row("nine", name).stalls;
      const six = row("shipped", name).stalls;
      const five = row("five", name).stalls;
      const three = row("threeHits", name).stalls;
      const trail = `${name}: ${nine} stalls at nine marks, ${six} at six, ${five} at five, ${three} at three - the sweep is not monotone in hull size`;
      expect(nine, trail).toBeLessThanOrEqual(six);
      expect(six, trail).toBeLessThanOrEqual(five);
      expect(five, trail).toBeLessThanOrEqual(three);
    }
  });

  it("AC-5.1 / AC-5.2: the measurement is not vacuous - canisters spawned, and most were cleared", () => {
    // ANTI-VACUITY. "Three hits fails even with canisters" says nothing if no
    // canister was ever on a belt, and it says something different if they
    // spawned and were never reached. Both halves are checked, for every arm.
    for (const arm of Object.keys(ARMS)) {
      for (const [name] of PILOTS) {
        const r = row(arm, name);
        expect(
          r.canistersSpawned,
          `${arm}/${name}: no canister spawned over ${BELTS} belts, so this arm measured no repair rocks at all`,
        ).toBeGreaterThan(0);
        expect(
          r.canistersCleared,
          `${arm}/${name}: ${r.canistersSpawned} canisters spawned and none was cleared`,
        ).toBeGreaterThan(0);
        expect(
          r.repaired,
          `${arm}/${name}: ${r.canistersCleared} canisters were blasted and the hull got nothing back`,
        ).toBeGreaterThan(0);
      }
    }
    // A CANISTER IS NOT A REFUND, and this is the number that says so. The
    // pilots who cope clear nearly all of them; the pilot who is drowning
    // clears fewer, at exactly the stops where the hull is emptying.
    const clearRate = (arm: string, pilot: string): number => {
      const r = row(arm, pilot);
      return r.canistersCleared / r.canistersSpawned;
    };
    expect(
      clearRate("shipped", "ace"),
      "the ace pilot is failing to reach repair rocks, which would make every comparison below a measurement of the harness",
    ).toBeGreaterThan(0.8);
    expect(
      clearRate("threeHits", "median"),
      `the median pilot cleared ${(clearRate("threeHits", "median") * 100).toFixed(0)}% of the canisters offered at a 3-mark hull - if this were ~100% the canister would be a refund and the stall counts below would have another cause`,
    ).toBeLessThan(0.95);
  });

  it("AC-5.2: a canister now returns exactly one mark, so repairs cannot exceed canisters cleared", () => {
    // THE `hullAfterShield` FIX, MEASURED OVER THE ROUTE RATHER THAN AT A
    // POINT. It used to ceil the running hull before adding one, so a repair on
    // a half-damaged hull returned 1.5 marks and `repaired` ran AHEAD of
    // `canistersCleared` on every arm. One mark per canister is now the
    // ceiling, and the cap is the only thing that can make it less.
    //
    // WATCHED FAILING against the old `hullAfterShield` (ceil, then add),
    //  by restoring it in `@engine/hull` and re-running this file:
    //   "shipped/ace: 503 canisters cleared returned 551.5 marks - AC-5.2 says
    //    one mark per canister: expected 551.5 to be less than or equal to 503"
    for (const arm of Object.keys(ARMS)) {
      for (const [name] of PILOTS) {
        const r = row(arm, name);
        expect(
          r.repaired,
          `${arm}/${name}: ${r.canistersCleared} canisters cleared returned ${r.repaired} marks - AC-5.2 says one mark per canister`,
        ).toBeLessThanOrEqual(r.canistersCleared);
      }
    }
  });

  it("AC-4.1 / D27: a three-hit hull at 58 words COSTS the grade-2 pilot belts, canisters and all", () => {
    // THE FINDING THAT CLOSED THE THREE-HIT QUESTION, still asserted. The
    // owner's premise was that the repair rocks cover the difference; measured,
    // they do not, and the decision went to six rather than to three because of
    // this row.
    //
    // WATCHED FAILING the other way round - `toBe(0)`, i.e. asserting the
    // original premise:
    //   "a 3-mark hull cost the grade-2 pilot 13 belts of 240 (per stop:
    //    [0,2,0,0,4,7]) - the shipped hull costs them 0: expected 13 to be +0
    //    // Object.is equality"
    const three = row("threeHits", "grade2");
    const shipped = row("shipped", "grade2");
    expect(
      three.stalls,
      `a 3-mark hull cost the grade-2 pilot ${three.stalls} belts of ${BELTS} (per stop: ${JSON.stringify(three.perStopStalls)}) - the shipped hull costs them ${shipped.stalls}`,
    ).toBeGreaterThan(shipped.stalls);

    // And it is not only the tail. Every pilot in the harness loses belts,
    // including the ~100%-accuracy one, which is what "three events is not a
    // hull, it is a countdown" looks like from the other end.
    for (const [name] of PILOTS) {
      expect(
        row("threeHits", name).stalls,
        `${name} lost no belts at a 3-mark hull, so the arms are not measuring different games`,
      ).toBeGreaterThan(row("shipped", name).stalls);
    }
  });

  it("AC-5.1 / AC-5.2: raising the canister rate does NOT make a three-hit hull viable", () => {
    // THE OWNER'S OWN LEVER, PUSHED TO ITS CEILING. `CANISTER_SPAWN_CHANCE` at
    // 1.0 and three canisters live instead of one - far past anything that
    // would ship, since it turns roughly a third of the belt into repair rocks.
    //
    // It helps, and it is not enough, and both halves are asserted: the first
    // so nobody reads this as "canisters do nothing", the second because it is
    // the answer to the question that was asked.
    const maxed = row("threeHitsMaxedCanisters", "grade2");
    const plain = row("threeHits", "grade2");
    expect(
      maxed.canistersSpawned,
      "the maxed arm did not actually spawn more canisters, so it is not the lever it claims to be",
    ).toBeGreaterThan(plain.canistersSpawned);
    expect(
      maxed.stalls,
      `maxing the canister rule did not help grade-2 at all (${plain.stalls} -> ${maxed.stalls} of ${BELTS})`,
    ).toBeLessThan(plain.stalls);
    // THE ASSERTION THE DECISION RESTS ON.
    //
    // WATCHED FAILING as `toBe(0)`:
    //   "even with every eligible spawn a canister and three live at once, a
    //    3-mark hull still cost grade-2 8 belts of 240 (per stop:
    //    [0,2,0,0,2,4]). The shipped hull costs them 0. [...]
    //    expected 8 to be +0 // Object.is equality"
    expect(
      maxed.stalls,
      `even with every eligible spawn a canister and three live at once, a 3-mark hull still cost grade-2 ${maxed.stalls} belts of ${BELTS} (per stop: ${JSON.stringify(maxed.perStopStalls)}). The shipped hull costs them ${row("shipped", "grade2").stalls}. If this is now zero the finding has changed and the hull question must be re-measured, not re-decided from this comment.`,
    ).toBeGreaterThan(0);
  });

  it("UR-91 / C26: at six marks, half-mark damage is REAL and invisible on both surfaces", () => {
    // `HULL_PASS_COST` IS 0.5 AND NOTHING SHOWS IT. `hullLampLevel` and
    // `maySpawnCanister` both go through `hullMarksLit`, which CEILS, so a
    // pass-by leaving the hull at 5.5 of 6 dims the Lantern not at all and
    // opens no repair window. This asserts that the case is not hypothetical at
    // the shipped hull, and records how big it is; the DECISION about whether
    // to change it is the owner's and is in `gauntlet/escalations.md`.
    //
    // NOT CHANGED HERE. If it is ever changed, this assertion goes red and
    // takes the escalation with it.
    //
    // WATCHED FAILING at `toBe(0)`:
    //   "grade-2 took 144 hull charges the Lantern did not show, over 240 belts
    //    at 6 marks, and was refused a repair rock 2232 times on a damaged
    //    ship: expected 144 to be +0 // Object.is equality"
    const r = row("shipped", "grade2");
    const trail = `grade-2 took ${r.silentHullEvents} hull charges the Lantern did not show, over ${BELTS} belts at ${SHIPPED_HULL} marks, and was refused a repair rock ${r.canisterGateShutWhileDamaged} times on a damaged ship`;
    expect(r.silentHullEvents, trail).toBeGreaterThan(0);
    expect(r.canisterGateShutWhileDamaged, trail).toBeGreaterThan(0);
    // EVERY SILENT CHARGE IS A HALF-MARK ONE, and there are exactly two of
    // those: a pass-by (`HULL_PASS_COST`, UR-91) and a D101 rock whose core
    // reaches the ship with the shell already off (AC-26.4). A whole-mark
    // strike always moves `hullMarksLit`. Bounding the count by the two
    // half-mark events is what makes this a measurement of the rounding rather
    // than of the belt: if a third fractional cost ever appears, it goes red.
    //
    // MEASURED WRONG FIRST TIME, which is why the bound is written out: the
    // first version of this assertion bounded the count by pass-bys alone and
    // failed at 144 against 135, because the exposed-core cost is also a half.
    expect(
      r.silentHullEvents,
      `${r.silentHullEvents} silent charges against ${r.passedBy} pass-bys and ${r.coresBreached} exposed cores - a fractional cost other than HULL_PASS_COST (${HULL_PASS_COST}) and AC-26.4's half is in play`,
    ).toBeLessThanOrEqual(r.passedBy + r.coresBreached);
  });
});

/** The table, written out so the decision has an artifact and not a memory. */
const EVIDENCE = "gauntlet/evidence";
mkdirSync(EVIDENCE, { recursive: true });
/**
 * TWO NAMES FOR THE SAME RUN. The canonical file is what the decision log
 * cites and it is rewritten by every suite run, i.e. at the default 40 seeds;
 * the belt-suffixed one is not, so the 720-belt artifact the decision was taken
 * from survives the next `npm test` instead of being quietly downsampled.
 */
const evidence = `${JSON.stringify(
    {
      seeds: SEEDS,
      beltsPerPilot: BELTS,
      spawnCount: WORDS,
      shippedMaxHull: SHIPPED_HULL,
      canisterSpawnChance: CANISTER_SPAWN_CHANCE,
      hullPassCost: HULL_PASS_COST,
      survivableHitRate: {
        shipped: survivableHitRate(WORDS, SHIPPED_HULL),
        nine: survivableHitRate(WORDS, 9),
        five: survivableHitRate(WORDS, 5),
        threeMarks: survivableHitRate(WORDS, HULL_BASE_MARKS),
      },
      arms: ARMS,
      rows,
    },
    null,
    2,
  )}\n`;
writeFileSync(`${EVIDENCE}/hull-three-hits.json`, evidence);
writeFileSync(`${EVIDENCE}/hull-three-hits-${BELTS}belts.json`, evidence);
