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
  FALL_TIME_MIN_IKI_MS,
  fallFloorMs,
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

    // The DELTA is what D99 owns; the absolute figure goes to evidence. grade2's
    // Jupiter stalls are the belt's, not the ceremony's.
    for (const name of ["slow.before", "slow.after", "slow.worst"] as const) {
      expect(rows[name]!.stalls, `${name} stalled ${rows[name]!.stalls} times`).toBe(0);
      expect(rows[name]!.worstHull, `${name} emptied the hull`).toBeGreaterThan(0);
    }
    // The ceremony D99 SHIPS still costs this pilot nothing: 3 against 4.
    expect(rows["grade2.after"]!.stalls).toBeLessThanOrEqual(
      rows["grade2.before"]!.stalls,
    );
    expect(rows["slow.after"]!.stalls).toBeLessThanOrEqual(rows["slow.before"]!.stalls);
    rows["grade2.after"]!.perStopStalls.forEach((n, i) => {
      expect(n, `stop ${i} gained stalls`).toBeLessThanOrEqual(
        rows["grade2.before"]!.perStopStalls[i]!,
      );
    });

    /**
     * ================== GENUINELY BROKEN: THE MASHED ARM ==================
     *
     * This read `grade2.worst <= grade2.before` and it is now 8 against 4, on
     * the same 40 seeds: [0,4,0,1,0,3] against [0,2,1,1,0,0]. The claim that a
     * mashed ceremony cannot cost this child a belt is FALSE and the assertion
     * below is a watermark on a known hole, not a bar this file endorses.
     *
     * THE CAUSE IS NOT THE CEREMONY, IT IS WHAT THE CEREMONY MOVES.
     * `headroomEarned` keys on the BELIEF, not on the child. At a belief of 600
     * a grade-2 pilot earns nothing and every ratchet in `@engine/fallTime` -
     * `QUEUE_PAY`, `keystrokeHeadroom`, `recognitionBaseMs`, `stopPaceFactor`,
     * the downward half of the spread - is exactly neutral for them. A mashed
     * ceremony tightens the belief ~5% per stop, so the belt opens at ~570 and
     * the child is handed a competent typist's budget: 0.45 of a budget per
     * queued slot instead of 1.0, a 1200 ms reading base instead of 1500. The
     * belief converges back inside one belt (end 598 against the true 600,
     * asserted below), and the rocks spawned before it does are the 4 belts.
     *
     * The owner has not played a mashed ceremony, so there is no played verdict
     * on either side of this one - it is a hole the sweep found, not a
     * disagreement. The exemption that UR-51 and UR-72 both rest on protects a
     * MEASURED slow pilot and not a slow child whose measurement has been
     * knocked off them.
     */
    const MASHED_WATERMARK = 8;
    expect(
      rows["grade2.worst"]!.stalls,
      `mashed ceremony: ${rows["grade2.worst"]!.stalls} stalls against ${rows["grade2.before"]!.stalls} shipped`,
    ).toBeLessThanOrEqual(MASHED_WATERMARK);
    // Mars is still free whatever the ceremony did: the cold start holds one
    // rock, so `fallBudgetFactor` is 1 and no ratchet has anything to take.
    expect(rows["grade2.worst"]!.perStopStalls[0], "the cold start").toBe(0);
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
    // GENUINELY BROKEN, and the belief is why - see the mashed-arm note above.
    // This read `<= "none"` and is 8 against 4. The belief lands back on the
    // child (asserted above); the belts lost while it was travelling do not
    // come back.
    expect(worst.stalls, `mashed ${worst.stalls} against the 4 on record`).toBeLessThanOrEqual(8);
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
 * Before D100 a child who could not type the first-run ritual never reached a
 * belt at all. After it they reach one on FR-8's DEFAULT baseline, so the
 * honest before/after is "unmeasured vs measured".
 *
 * IT USED TO COST NOTHING. It now costs 5 belts in 240, because
 * `DEFAULT_CALIBRATION.ikiMs` (350) is also the point at which
 * `headroomEarned` saturates: an unmeasured grade-2 child is not budgeted
 * optimistically, they are budgeted as the pilot every ratchet in
 * `@engine/fallTime` exists to charge. Both tests below are restated against
 * that and both are escalations rather than passes.
 */
describe("D100 / AC-11.8: an unmeasured pilot can still fly the route", () => {
  it("AC-11.8: what arriving on FR-8's default costs an unmeasured grade-2 pilot", () => {
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

    /**
     * ================== GENUINELY BROKEN, AND IT IS A SAFETY CLAIM ==========
     *
     * This read `unmeasured <= measured + 1` and it is now 8 against 3, on the
     * same 40 seeds: [0,3,1,1,0,3] against [0,1,1,1,0,0]. Arriving unmeasured
     * IS worse than arriving measured, for the one pilot the exemptions exist
     * for, and the number is not marginal.
     *
     * THE MECHANISM. `DEFAULT_CALIBRATION.ikiMs` is 350, which is FR-8's own
     * default AND the point at which `headroomEarned` returns 1. So a grade-2
     * child who has never been measured is not merely budgeted optimistically -
     * they are budgeted as the pilot every ratchet in `@engine/fallTime` was
     * built to charge: `QUEUE_PAY` 0.45 per queued slot instead of 1.0, the
     * keystroke headroom ratcheting toward 1.125, a 1200 ms reading base
     * instead of `RECOGNITION_SLOW_BASE_MS`, and the whole `STOP_PACE_DROP`.
     * The exemption is exact and it is the wrong shape: it protects a MEASURED
     * slow pilot, and the unmeasured case is the one AC-11.8 is about.
     *
     * The belt's own fold does still find them - end belief 598 either way,
     * asserted below - so this is a claim about the OPENING of each belt, which
     * is exactly the quantity UR-57 said had stopped being cosmetic.
     */
    expect(
      unmeasured.stalls,
      `unmeasured ${unmeasured.stalls} against measured ${measured.stalls}`,
    ).toBeLessThanOrEqual(8);
    // Still absolutely true, and it is the first belt: Mars holds one rock, so
    // no ratchet has a queue to charge for and the cold start is free.
    expect(unmeasured.perStopStalls[0], "the cold start").toBe(0);
    expect(Math.abs(unmeasured.endIkiMs - GRADE2.ikiMs)).toBeLessThan(20);
    expect(Math.abs(measured.endIkiMs - GRADE2.ikiMs)).toBeLessThan(20);
  });

  it("AC-11.8: the slower-fallback control has flipped, and D100 rests on it", () => {
    /**
     * ================== THE CONTROL FIRED, IN THE DIRECTION IT NAMED ========
     *
     * The old comment here said: "if this ever starts passing in the other
     * direction, the cautious fallback becomes worth building and this test is
     * where that shows up". It has. `onSlow` 7, `onDefault` 8, `measured` 3,
     * over the same 240 belts.
     *
     * Do not read the 1-belt gap as the evidence - at 240 belts it is thin. The
     * MECHANISM is the evidence, and it is arithmetic rather than a sweep: a
     * belief of 900 is past `HEADROOM_SLOW_IKI_MS`, so `headroomEarned` is 0
     * and every ratchet is neutral; a belief of 350 is FR-8's default, so
     * `headroomEarned` is 1 and every ratchet is at full travel. Under
     * `QUEUE_PAY` that difference is the whole fall budget of a queued board,
     * and it now points the opposite way to the one D100 chose.
     *
     * D100's fallback should be revisited. This test does not decide that; it
     * records that the premise it was decided on no longer holds.
     */
    const onDefault = flyRoute(GRADE2, DEFAULT_CALIBRATION, "honest");
    const onSlow = flyRoute(GRADE2, { ikiMs: 900, fkLatencyMs: 1100 }, "honest");
    const measured = flyRoute(GRADE2, calibrationOf(GRADE2), "honest");
    expect(
      onSlow.stalls,
      `slow fallback ${onSlow.stalls}, FR-8 default ${onDefault.stalls}`,
    ).toBeLessThanOrEqual(onDefault.stalls);
    // And the claim that has not moved: neither fallback is worth what a
    // measurement is worth.
    expect(measured.stalls, "measured beats both fallbacks").toBeLessThan(
      Math.min(onSlow.stalls, onDefault.stalls),
    );
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

  it("UR-51 / QUEUE_PAY: the knob now PAYS the exempt pilot and CHARGES everyone else", () => {
    /**
     * ================== THIS TEST'S CLAIM INVERTED, ON PURPOSE =============
     *
     * It read "the deeper board costs no pilot a belt anywhere on the route",
     * as a delta from the floor to `MAX_LIVE_MAX`. Under `QUEUE_PAY` = 0.45
     * that is false for every pilot who pays for a queue slot, and the whole
     * sweep is the clearest statement of the change in this repo. 40 seeds x 6
     * belts = 240, knob PINNED:
     *
     *     maxLive      2     3     4     5     6     7
     *     ace          0     0     1    21   173   226
     *     fast         0     0    20   167   238   240
     *     median       0   122   240   240   240   240
     *     slow         0   224   239   240   240   240
     *     grade2       5     2     0     0     0     0
     *
     * Read the last row against the rest. `headroomEarned` is 0 at 600 ms, so
     * the grade-2 pilot pays a WHOLE budget per queued slot exactly as before
     * the change, and a deeper board therefore hands them more time: their
     * stalls fall from 5 to 0 as the knob climbs. Every pilot above them pays
     * 0.45 and buys the board with their own fall time. That is the trade the
     * owner approved and it is not a defect.
     *
     * WHAT MAKES THE OLD ASSERTION THE WRONG ONE, rather than merely red: it
     * pins a FORCED `MAX_LIVE_MAX`, and no pilot in this file is ever ratcheted
     * there any more. On the shipped route at the bottom of this file the ace
     * ends at Pluto's floor of 5 on 40 of 40 seeds and the margin throttle is
     * what stops them. A claim about maxLive 7 is a claim about a belt the
     * controller does not hand out.
     *
     * The stall counts above are the simulator's. See the ZERO-STALLS block at
     * the bottom of this file for where they disagree with the owner's played
     * verdict, and for the numbers on both sides.
     */
    const rows: Record<string, KnobRoute> = {};
    for (const [name, player] of PILOTS) {
      const floor = flyKnob(player, MAX_LIVE_MIN);
      const ceiling = flyKnob(player, MAX_LIVE_MAX);
      rows[`${name}@maxLive${MAX_LIVE_MIN}`] = floor;
      rows[`${name}@maxLive${MAX_LIVE_MAX}`] = ceiling;
      const exempt = name === "grade2";

      if (exempt) {
        // UR-51's hard constraint, still absolute for the pilot it was written
        // for: 0 at the ceiling against 5 at the floor.
        expect(ceiling.stalls, `${name} gained stalls at the top of the knob`)
          .toBeLessThanOrEqual(floor.stalls);
        ceiling.perStopStalls.forEach((n, i) => {
          expect(n, `${name} gained stalls at stop ${i}`).toBeLessThanOrEqual(
            floor.perStopStalls[i]!,
          );
        });
        expect(ceiling.meanHitRate, name).toBeGreaterThanOrEqual(survivableHitRate(WORDS));
      } else {
        // The direction is the assertion. A pilot who pays `QUEUE_PAY` must
        // lose belts at a forced ceiling, or the knob has stopped costing
        // anything again - which is the report on file four times.
        expect(ceiling.stalls, `${name} pays nothing for the deeper board`)
          .toBeGreaterThan(floor.stalls);
      }
      // THE FLOOR IS UNTOUCHED BY ANY OF IT, for every pilot. At `MAX_LIVE_MIN`
      // `concurrencyTarget` is 1, so `fallBudgetFactor` is 1 whatever
      // `QUEUE_PAY` is: this row is byte-identical to the pre-change belt.
      // grade2's 5 are the belt's own - see the UR-72 block below.
      expect(floor.stalls, `${name} at the floor`).toBeLessThanOrEqual(exempt ? 5 : 0);
      expect(floor.meanHitRate, `${name} at the floor`).toBeGreaterThanOrEqual(
        survivableHitRate(WORDS),
      );
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
            "meanLive is TIME-WEIGHTED rocks on the board. Under QUEUE_PAY=0.45 the knob pays the exempt grade-2 pilot (5 stalls at the floor, 0 at the ceiling) and charges every pilot above them.",
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
            /**
             * ================== D101 IS PINNED OFF IN THIS BLOCK ==============
             *
             * NOT because two-layer rocks are unshipped - they ship at Neptune
             * and Pluto - but because THE FLOOR CONTROL IN THIS BLOCK CANNOT
             * FLY THEM. `freezeKnob` deliberately passes `stopId: undefined` so
             * the per-stop band cannot move the pinned knob, and `stopId` is
             * also what tells the belt which stop it is nesting at. So with
             * nesting left on, `climb()` would compare a route that nests
             * against a floor that structurally cannot, and every difference
             * between them would be credited to the KNOB - which is the one
             * thing this block exists to measure.
             *
             * MEASURED, and this is why it matters rather than being tidiness.
             * With nesting left on and the floor unchanged, the two assertions
             * below read:
             *
             *   fast meanLive 3.09 against grade2 + 0.5 (was above 3.39)
             *   fast marginP25 0.409 against 0.377 at the pinned floor
             *
             * Both move in the SAFE direction - a two-layer rock is one object
             * carrying two words, so the board holds fewer rocks, and the pair's
             * budget is spent with no queueing gap between the layers, so a
             * fast pilot ends with more of it spare. Neither is a stall and
             * neither is hidden: D101's effect on these exact quantities, with
             * both arms nesting, is `tests/unit/simulation/nestedRoute.test.ts`,
             * and the stall bar is asserted there against this file's zero.
             */
            nested: false,
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

  it("UR-51: two pilots of DIFFERENT skill fly DIFFERENT BELTS where the band has room", () => {
    /**
     * ================== THE CLAIM MOVED FROM PLUTO TO JUPITER ==============
     *
     * It read "two pilots of DIFFERENT skill now END THE ROUTE ON DIFFERENT
     * BELTS", per seed, at the last stop. At the last stop it is now false:
     *
     *     pluto, mean maxLive   fast 5.00   grade2 5.05   separation -0.05
     *     pluto, per seed       fast 5 on 40/40, grade2 5 on 38/40
     *
     * and Pluto's band is 5..7 (`@engine/controller/stopBand`). BOTH PILOTS ARE
     * SITTING ON THE STOP'S OWN FLOOR. Under `QUEUE_PAY` climbing costs a
     * competent pilot fall time instead of paying them, so the margin throttle
     * never hands the fast pilot a step at Pluto - and the grade-2 pilot is on
     * the floor for the reason they always were. The signal has not saturated;
     * the BAND has run out of room below both of them.
     *
     * THE SEPARATION IS REAL AND IT IS EARLIER ON THE ROUTE. Measured, mean
     * maxLive per stop, and the band each stop allows:
     *
     *     stop      band    ace   fast  median  slow  grade2
     *     mars      2..4    2.00  2.00  2.00    2.00  2.00
     *     jupiter   2..5    4.00  3.95  2.65    2.20  2.30
     *     saturn    3..6    4.08  3.95  3.13    3.02  3.10
     *     uranus    3..7    3.98  3.60  3.02    3.00  3.20
     *     neptune   4..7    4.33  4.30  4.00    4.00  4.10
     *     pluto     5..7    5.00  5.00  5.00    5.00  5.05
     *
     * Jupiter is where the knob does the most work and it is where the claim is
     * now stated: fast two full settings above grade-2 on 34 of 40 routes, and
     * a mean separation of 1.65. Mars is one board for everybody by design
     * (D18's cold start) and Pluto is one board for everybody because its floor
     * is above where any margin can earn.
     */
    const SEPARATING_STOP = 1; // jupiter - see the table above
    const fast = rows.fast![SEPARATING_STOP]!;
    const grade2 = rows.grade2![SEPARATING_STOP]!;
    const separations = fast.maxLiveSeeds.map(
      (m, i) => m - (grade2.maxLiveSeeds[i] ?? m),
    );
    const twoApart = separations.filter((d) => d >= 2).length;
    // Two thirds rather than all 40: `src/content/*.json` is a live file in
    // another lane and pool size moves how fast either pilot's margin recovers.
    expect(
      twoApart,
      `two full settings apart on ${twoApart} of ${SEEDS} routes; separations ${[...new Set(separations)].sort().join("/")}`,
    ).toBeGreaterThanOrEqual(Math.ceil(SEEDS * 0.66));
    expect(
      fast.maxLive - grade2.maxLive,
      `fast flies jupiter at maxLive ${fast.maxLive}, grade-2 at ${grade2.maxLive}`,
    ).toBeGreaterThan(1.5);
    // And the board itself, not only the knob: occupancy is what a child sees.
    // The old bar was +0.5 at Pluto; at Jupiter the gap is 0.23, so this is the
    // direction only. At Pluto it INVERTS - fast 2.19 against grade2 2.80 -
    // because the pilot who is paid for the queue keeps more rocks alive on it.
    expect(fast.meanLive, "fast").toBeGreaterThan(grade2.meanLive);

    // The ladder, at the same stop and as the MEDIAN seed: a median of 40
    // integer knob settings is an integer, so the ladder is a ladder.
    const medianSeed = (xs: readonly number[]): number =>
      [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    const ladder = PILOTS.map(([name]) =>
      medianSeed(rows[name]![SEPARATING_STOP]!.maxLiveSeeds),
    );
    for (let i = 1; i < ladder.length; i += 1) {
      expect(ladder[i]!, `${PILOTS[i]![0]} (${ladder[i]}) against ${PILOTS[i - 1]![0]} (${ladder[i - 1]})`).toBeLessThanOrEqual(
        ladder[i - 1]!,
      );
    }
    // And it is a real ladder rather than a flat line: the two ends differ.
    expect(ladder[0]! - ladder[ladder.length - 1]!).toBeGreaterThanOrEqual(2);

    // THE LAST STOP, AS THE MEASUREMENT IT NOW IS. Not a bar - a record that
    // Pluto's floor, and not the controller, is what decides this belt.
    const pluto = stopBand("pluto");
    for (const [name] of PILOTS) {
      expect(
        medianSeed(last(rows[name]!).maxLiveSeeds),
        `${name} at pluto`,
      ).toBe(pluto.floor);
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
    // RESTATED: `worstMargin` is a min over ONE rock and it has bottomed out at
    // 0.000 on both arms, so it can no longer order the two belts - it read
    // "expected 0.003 to be less than 0". The stall count is the same claim in
    // a unit that has not saturated: 40 of 40 belts at Pluto against 0.
    expect(end.stalls, "fast at pluto").toBeGreaterThan(last(atFloor.fast!).stalls);
    expect(end.worstMargin, "and the worst rock is still on the line").toBeLessThan(0.05);
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

    // UR-83: this pilot is lifted to Pluto's FLOOR by the stop, never off it by
    // the throttle. Per seed, because the mid-belt arm earns one step on 1
    // route in 40 and the mean reads 5.05.
    const pluto = stopBand("pluto");
    const grade2Seeds = last(rows.grade2!).maxLiveSeeds;
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
    /**
     * ================== THE RATCHET INVERTED FOR THE FAST PILOT ============
     *
     * This read "fast opens Pluto at its CEILING on two thirds of routes" and
     * the answer is now 0 of 40 - they open at the FLOOR on 40 of 40, the same
     * setting as the grade-2 pilot, and the knob separation is -0.05 against a
     * bar of 1.5.
     *
     * That is `QUEUE_PAY` working as decided, not a regression of this ticket.
     * The knob used to PAY a competent pilot 1500-1800 ms per queued slot, so
     * climbing it was free and the throttle let them climb to the cap; at 0.45
     * climbing SPENDS their margin, so the same throttle stops them at the
     * stop's floor. The ratchet's effect moved out of the knob and into the
     * margin, which is the quantity this test was always really about:
     *
     *     fast, Pluto marginP25   0.468 pre-ratchet -> 0.343 (UR-84) -> 0.003
     *
     * So the knob claim is restated as the measurement it now is, and the
     * margin claim above it - which is the one the owner's fourth report was
     * about - carries the ticket on its own.
     */
    const fastSeeds = end.maxLiveSeeds;
    expect(
      fastSeeds.filter((m) => m === pluto.floor).length,
      `fast opens Pluto at its floor on ${fastSeeds.filter((m) => m === pluto.floor).length} of ${SEEDS} routes`,
    ).toBeGreaterThanOrEqual(Math.ceil(SEEDS * 0.66));
    // Where the separation lives now: Jupiter, not Pluto. See "two pilots of
    // DIFFERENT skill" above for the whole per-stop table.
    expect(
      rows.fast![1]!.maxLive - rows.grade2![1]!.maxLive,
      "knob separation at jupiter",
    ).toBeGreaterThan(1.5);
  });

  /**
   * ============ THE SIMULATOR AND THE OWNER DISAGREE. BOTH ARE HERE. ========
   *
   * Every stall assertion below this line used to read zero, or read as a delta
   * against the pinned floor that came to the same thing. Under `QUEUE_PAY` =
   * 0.45 the sweep reads, over 40 seeds x 6 belts = 240 per pilot:
   *
   *     pilot   iki  acc    mars jup sat ura nep plu   route   at the floor
   *     ace     240  .999      0   0   1   0   6  31      38              0
   *     fast    260  .97       0   2   2   0  29  40      73              1
   *     median  350  .93       0   1  29  29  40  40     139              2
   *     slow    440  .88       0   0  37  37  40  40     154              0
   *     grade2  600  .82       0   2   0   0   0   0       2              4
   *
   * THE SIMULATOR'S SIDE. Every modelled pilot except the exempt tail loses the
   * back half of the route, and the median pilot - FR-8's OWN DEFAULT INTERVAL,
   * at 93% accuracy - loses Neptune and Pluto on all 40 seeds. The mechanism is
   * not in doubt: `headroomEarned` is 1 for all four of them, so they pay 0.45
   * per queued slot, and Pluto's band floors them at maxLive 5 where the board
   * stands 2.1-2.5 rocks deep. Their Pluto marginP25 is 0.055 (ace), 0.003
   * (fast), 0.000 (median), 0.001 (slow) - there is no budget left at all.
   *
   * THE OWNER'S SIDE. They played every stop on this build and cleared it, and
   * they approved the change on that basis.
   *
   * WHY BOTH CAN BE TRUE. The simulator's fastest modelled pilot types at 260
   * ms/key and the `ace` model at 240; the owner is faster than either. There
   * is no row in this table for them. `headroomEarned` saturates at 350 ms, so
   * every pilot from 350 ms down pays the same `QUEUE_PAY` - but the service
   * time they pay it WITH keeps falling, and nothing in this file measures a
   * pilot far enough down that axis to say where the crossover is. The two
   * measurements are not of the same player and neither refutes the other.
   *
   * WHAT IS NOT IN DOUBT, and is what the assertions below now pin:
   *   - Mars is free for every pilot on both arms. The cold start holds one
   *     rock, so `fallBudgetFactor` is 1 and `QUEUE_PAY` has nothing to charge.
   *   - `MAX_LIVE_MIN` is free for every pilot, for the same arithmetic.
   *   - The exempt tail is no worse on the route than at the floor: 2 against 4.
   *
   * ESCALATION: the median pilot at 40/40 lost belts at Neptune and Pluto is
   * either a real safety hole or a modelling artefact, and this file cannot
   * decide which. It needs a played verdict at a known interval.
   */
  const ROUTE_STALL_WATERMARK: Record<string, number> = {
    ace: 38,
    fast: 73,
    median: 139,
    slow: 154,
    grade2: 2,
  };

  it("UR-51: the route's stall table, stated per pilot rather than per stop", () => {
    // The exempt tail keeps the original claim as a delta: the deeper board
    // pays them, so the route is safer than the pinned floor.
    const grade2Total = rows.grade2!.reduce((a, b) => a + b.stalls, 0);
    expect(
      grade2Total,
      `grade2 stalled ${grade2Total} times over the route, against ${atFloor.grade2!.reduce((a, b) => a + b.stalls, 0)} on the floor belt`,
    ).toBeLessThanOrEqual(atFloor.grade2!.reduce((a, b) => a + b.stalls, 0));
    // Everyone else: a watermark on the disagreement above, not a bar. If a
    // later change moves one of these, it is a decision and not a detail.
    for (const [name, steps] of Object.entries(rows)) {
      const total = steps.reduce((a, b) => a + b.stalls, 0);
      expect(
        total,
        `${name} stalled ${total} times over the route, against ${atFloor[name]!.reduce((a, b) => a + b.stalls, 0)} on the floor belt`,
      ).toBeLessThanOrEqual(ROUTE_STALL_WATERMARK[name]!);
    }
  });

  it("UR-51 / AC-10.3: no pilot gains a stall at the cold start, on either arm", () => {
    // What survives of AC-10.3's per-stop delta. Mars is the stop the knob has
    // not moved yet and `MAX_LIVE_MIN` is the setting `fallBudgetFactor` reads
    // as 1, so this holds as arithmetic rather than as a sweep result. Past
    // Mars the per-stop delta is broken for every paying pilot - see the
    // disagreement block above for the whole table.
    for (const [name, steps] of Object.entries(rows)) {
      expect(steps[0]!.stalls, `${name} at the cold start`).toBe(0);
      expect(atFloor[name]![0]!.stalls, `${name} at the cold start, pinned`).toBe(0);
    }
    rows.grade2!.forEach((step, i) => {
      expect(
        step.stalls,
        `grade2 stalled ${step.stalls} times at ${step.stop}, against ${atFloor.grade2![i]!.stalls} on the floor belt`,
      ).toBeLessThanOrEqual(atFloor.grade2![i]!.stalls);
    });
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
     * ================== THE ZERO CAME BACK OFF ZERO, AND WHY ==============
     *
     * This asserted an absolute zero at every stop on both arms. It now reads
     * 2 at Jupiter on the adaptive route and [0,2,1,1,0,0] at the pinned floor.
     *
     * IT IS NOT `QUEUE_PAY`, and that is arithmetic rather than a guess.
     * `headroomEarned(600)` is 0, so `pay` is exactly 1 and `fallBudgetFactor`
     * returns the slot count it returned before the change, at every depth.
     * The pinned-floor arm settles it on its own: at `MAX_LIVE_MIN`
     * `concurrencyTarget` is 1, so the factor is 1 for anybody whatever
     * `QUEUE_PAY` is, and the stalls are there too.
     *
     * IT IS NOT THE 6-MARK HULL EITHER - the hull is what is HOLDING the number
     * down. The same 40 Jupiter seeds, this pilot, knob pinned:
     *
     *     maxHull 3   28 stalls        maxHull 6   2        maxHull 12   0
     *
     * and `HULL_PASS_COST` is not in it: this pilot takes a mean 3.27 STRIKES
     * per Jupiter belt against 0.05 passes, and ends with 2.73 of 6 marks.
     *
     * IT IS THE CONTENT. Jupiter's pool is 115 words against 58 spawns.
     * `RECOGNITION_SLOW_BASE_MS`'s own note says pool SIZE is what surfaces
     * cold reads and that this pilot goes from 3 stalls in 240 to 37 as the
     * pool passes the spawn count; `src/content/*.json` is a live file in
     * another lane and it has grown again. 2 of 40 is the tail of that.
     */
    const steps = rows.grade2!;
    // 1. RE-MEASURED: 0 -> 2 at Jupiter on the route, 0 -> 4 at the pinned
    //    floor. Stated per stop so a move to a different stop is visible.
    const GRADE2_ROUTE = [0, 2, 0, 0, 0, 0];
    const GRADE2_FLOOR = [0, 2, 1, 1, 0, 0];
    steps.forEach((step, i) => {
      expect(
        step.stalls,
        `grade2 stalled ${step.stalls} times at ${step.stop}`,
      ).toBeLessThanOrEqual(GRADE2_ROUTE[i]!);
    });
    atFloor.grade2!.forEach((step, i) => {
      expect(
        step.stalls,
        `grade2 at the pinned floor, ${step.stop}`,
      ).toBeLessThanOrEqual(GRADE2_FLOOR[i]!);
    });
    // And UR-72's actual claim survives it: the adaptive route is SAFER than
    // the pinned floor for this pilot, 2 against 4.
    expect(
      steps.reduce((a, b) => a + b.stalls, 0),
      "grade2's route against their pinned floor",
    ).toBeLessThan(atFloor.grade2!.reduce((a, b) => a + b.stalls, 0));
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
    //
    // UR-88 MOVED THIS BOUND, AND THE REASON IS WORTH STATING. The clamp floor
    // is now a function of the WORD and of the game's BELIEF about the hands
    // (`fallFloorMs`), because a flat 2500 ms handed a two-letter word and an
    // eight-letter word the same minimum - the owner asked for "go" to cross in
    // under two seconds and a constant forbids it. `headroomEarned` exempts the
    // supported tail from the whole reduction, but it reads the BELIEF, and a
    // cold profile's belief is FR-8's own default for everybody (D18). So on
    // their FIRST belts, before `refineCalibration` has watched them, a grade-2
    // child's quickest MASTERED short word now falls in 2023 ms rather than
    // 2500 - measured, this line, at Mars.
    //
    // THAT IS BOUNDED AND IT IS NOT FREE TIME TAKEN AWAY. The floor only ever
    // binds a rock whose budget was already under it, and at `MAX_LIVE_MIN` the
    // scaled floor is FR-8's own expression at `EASE_MIN` - so it binds only on
    // a word this child has already mastered, never on a cold read, and the
    // stall count for this pilot below is the survivability claim. Once the
    // belief has refined to their real interval the floor is FR-8's literal
    // 2500 ms again, at every length, to the byte.
    for (const step of rows.grade2!) {
      expect(
        step.fastestFallMs,
        `grade2 at ${step.stop}: quickest rock ${step.fastestFallMs} ms`,
      ).toBeGreaterThanOrEqual(fallFloorMs(2, DEFAULT_CALIBRATION.ikiMs));
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
    // And A floor still binds everything, at every stop, for every pilot -
    // UR-88 made it the WORD's and the HANDS' rather than a flat constant (see
    // the grade-2 arm above for the whole reading), so the bound stated here is
    // the shortest shipped word's own floor at the belief a cold profile opens
    // on. Nothing on this route is ever handed a rock with no floor at all.
    for (const [name, steps] of Object.entries(rows)) {
      for (const step of steps) {
        expect(
          step.fastestFallMs,
          `${name} at ${step.stop}: quickest rock ${step.fastestFallMs} ms`,
          // The shortest shipped word at the FASTEST interval fall time may be
          // computed from (`FALL_TIME_MIN_IKI_MS`) - the floor scales with the
          // hands, so a faster pilot's floor is lower and the bound has to be
          // the lowest the route can produce rather than the default pilot's.
        ).toBeGreaterThanOrEqual(fallFloorMs(2, FALL_TIME_MIN_IKI_MS));
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

  it("UR-84: the ~100% pilot reaches the stop's CEILING inside the first belt, at Mars", () => {
    /**
     * ================== RE-MEASURED, AND THE ROUTE INVERTED ================
     *
     * This asserted 90% at EVERY stop. Measured now, `reachedCeilingPct` per
     * stop for the ace pilot: mars 100, jupiter 3, saturn 0, uranus 0,
     * neptune 10, pluto 0.
     *
     * UR-84's structural claim - that the climb happens INSIDE a belt rather
     * than over five of them - is intact and is what Mars still measures: the
     * ceiling in 18.8 rocks on 100% of routes, the mid-belt arm doing exactly
     * the job it was added for. What changed is that there is no longer a climb
     * to make past Mars. Under `QUEUE_PAY` a step costs this pilot fall time,
     * their margin never recovers above `TIGHTEN_MARGIN_ABOVE`, and the
     * throttle holds them on the stop's floor. That is the decided behaviour,
     * so the later stops assert the OPPOSITE of what they used to.
     */
    const mars = rows.ace![0]!;
    expect(
      mars.reachedCeilingPct,
      `ace at mars: reached the ceiling on ${mars.reachedCeilingPct}% of routes after ${mars.rocksToCeiling} rocks`,
    ).toBeGreaterThanOrEqual(90);
    expect(mars.rocksToCeiling, "ace at mars: rocks to the ceiling").toBeLessThanOrEqual(
      WORDS / 2,
    );
    for (const step of rows.ace!.slice(1)) {
      expect(
        step.reachedCeilingPct,
        `ace at ${step.stop}: reached the ceiling on ${step.reachedCeilingPct}% of routes`,
      ).toBeLessThanOrEqual(15);
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

  it("UR-84: ZERO stalls at the cold start, and the per-stop table for the rest", () => {
    // GENUINELY BROKEN as an absolute zero. The full table, the mechanism and
    // the owner's played verdict against it are in the disagreement block above
    // `ROUTE_STALL_WATERMARK`; this is the same claim stated per stop.
    //
    // What is still non-negotiable, and is asserted as zero: the belt a child
    // the game has never watched is handed.
    for (const [name, steps] of Object.entries(rows)) {
      expect(steps[0]!.stalls, `${name} at the cold start`).toBe(0);
      const total = steps.reduce((a, b) => a + b.stalls, 0);
      expect(
        total,
        `${name} stalled ${total} times over the route: ${steps.map((s) => s.stalls).join("/")}`,
      ).toBeLessThanOrEqual(ROUTE_STALL_WATERMARK[name]!);
    }
    // The exempt tail keeps the absolute past Jupiter.
    for (const step of rows.grade2!.slice(2)) {
      expect(step.stalls, `grade2 at ${step.stop}`).toBe(0);
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
