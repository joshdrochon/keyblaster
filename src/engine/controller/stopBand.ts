/**
 * The band of `maxLive` a STOP allows (UR-83; FR-10, D17, D20, D53).
 *
 * ================== THE REPORT THIS ANSWERS ==================
 * "The game has no challenge, I finish every level first try at ~100% accuracy,
 * and you would not expect seven rocks on Mars but you absolutely should on
 * Pluto." Raised five times.
 *
 * The cause was structural rather than a mis-tuned number: `@engine/controller`
 * had NO STOP INPUT. `stageIndexOf` has existed in `@engine/types` since the
 * route was built and the controller never saw it, so Mars and Pluto were the
 * same board for an equally good typist and difficulty was 100% adaptive with
 * 0% progression. On top of that `DEFAULT_KNOBS.maxLive` is `MAX_LIVE_MIN`, so
 * a fresh pilot's belt AT EVERY STOP opened at the gentlest setting the game
 * has and climbed at one step per belt from there.
 *
 * ================== A RANGE, NEVER A SCHEDULE ==================
 * This does not decide a stop's difficulty. It decides the two ENDS of the
 * range the adaptive controller works inside:
 *
 *   - the FLOOR is progression. It is what makes a stop inherently harder than
 *     the one before it whoever is flying, and it is the only thing here that a
 *     pilot cannot talk the controller out of.
 *   - the CEILING is what stops a stop being harder than it should ever be.
 *     Mars cannot reach the top of FR-10's range however good the child is.
 *   - BETWEEN THEM, nothing changed. `decideStage` reads the same hit rate and
 *     the same margin-to-breach it always did, and it moves one knob per stage
 *     (D20, AC-10.1). A weak typist on Pluto sits at Pluto's floor; a strong
 *     one on Mars sits at Mars' ceiling.
 *
 * ================== THE BANDS OVERLAP, AND THAT IS THE POINT ==============
 * If Mars' ceiling were below Neptune's floor, a strong Mars pilot and a weak
 * Neptune pilot would be SCHEDULED rather than measured - handed a difficulty
 * for being at a stop. Every adjacent pair overlaps by at least three settings:
 *
 *     stop      stage  floor  ceiling   overlap with the stop before
 *     mars        1      2       4      -
 *     jupiter     2      2       5      2..4  (3 settings)
 *     saturn      3      3       6      3..5  (3 settings)
 *     uranus      4      3       7      3..6  (4 settings)
 *     neptune     5      4       7      4..7  (4 settings)
 *     pluto       6      5       7      5..7  (3 settings)
 *
 * Every step of the route raises the floor or the ceiling and lowers neither,
 * so each stop is inherently harder than the one before it; Mars tops out at 4
 * and Pluto opens no lower than 5 and reaches 7, which is the owner's "not
 * seven on Mars, yes seven on Pluto" stated as arithmetic. Adjacent bands share
 * at least three settings, so a strong pilot on an early stop and a weak pilot
 * on a late one can and do meet in the middle.
 *
 * ================== BOTH ENDS ARE FUNCTIONS, NOT A TABLE ==================
 * A table would be a second place for the route's shape to be written down.
 * The ceiling is the stage index run `STOP_BAND_CEILING_LEAD` ahead and capped
 * at FR-10's; the floor is the stage index run at `STOP_BAND_FLOOR_RISE` - and
 * that rate is the one number here that had to be measured rather than
 * reasoned, because it is set against how fast the CONTROLLER can climb. See
 * `STOP_BAND_FLOOR_RISE`.
 *
 * MARS' FLOOR IS FR-10'S FLOOR, and that is the safety property. The belt a
 * first-time grade-2 child flies on their first stop is `MAX_LIVE_MIN`, which
 * is the cold start that was already measured at zero stalls in 240 route
 * belts; nothing here can make a child's first belt busier than the one on
 * record. `tests/unit/controller/stopBand.test.ts` pins it.
 *
 * Pure: no clock, no randomness, no storage, like everything else in
 * `src/engine` (CLAUDE.md).
 */

import { type StopId, stageIndexOf } from "../types.js";
import {
  type LiveBand,
  MAX_LIVE_MAX,
  MAX_LIVE_MIN,
  clampBand,
} from "./knobs.js";

/**
 * How far ahead of the stage index a stop's ceiling runs, before FR-10's own
 * cap bites: `ceiling = min(MAX_LIVE_MAX, stage + 3)`.
 *
 * Three, so every stop is a RANGE - three settings wide at the early stops
 * (Mars 2..4), and never narrower than two once the cap truncates it (Pluto
 * 6..7). Two would make Mars 2..3, a single alternative, which is a schedule
 * with a shrug. Four would put Mars at maxLive 5, most of the way to the board
 * the owner says belongs to Pluto.
 */
export const STOP_BAND_CEILING_LEAD = 3;

/**
 * Settings the FLOOR rises over the whole route, divided by the five steps it
 * has to rise over: three fifths of a setting per stop.
 *
 * ================== THIS NUMBER IS THE DIFFERENCE BETWEEN A BAND AND A
 * SCHEDULE, AND IT WAS MEASURED THE HARD WAY ==================
 * The obvious floor is `stageIndexOf` itself - one setting a stop, 2 3 4 5 6 7,
 * the widest progression FR-10's six settings can express. It was tried first
 * and the route sweep says it is wrong, for a reason no amount of reading would
 * have found:
 *
 *   THE CONTROLLER ALSO CLIMBS AT ONE SETTING A STOP. D20 allows exactly one
 *   knob move per stage and a stage is a belt, so a floor rising at one a stop
 *   rises exactly as fast as the best possible pilot can climb. Measured over
 *   40 seeds, the fast pilot opened every stop at the floor plus one and the
 *   grade-2 pilot opened every stop at the floor - a separation of ONE setting
 *   between two pilots 2.3x apart in typing speed, at every stop on the route,
 *   with the whole of FR-10's range spent on the schedule and none of it left
 *   for the child. That is UR-51's saturation defect rebuilt out of different
 *   parts, and `UR-51: two pilots of DIFFERENT skill now END THE ROUTE ON
 *   DIFFERENT BELTS` reads
 *
 *       fast ends the route at maxLive 7, grade-2 at 6:
 *       expected 1 to be greater than or equal to 2
 *
 * At three fifths the floor runs 2 2 3 3 4 5 and the controller outruns it, so
 * a strong pilot arrives at Pluto's CEILING while a grade-2 pilot arrives at
 * Pluto's FLOOR - two settings apart, which is UR-51's bar, with the
 * progression intact. The stop still decides the range; the child still decides
 * where in it they sit.
 */
export const STOP_BAND_FLOOR_RISE = 3 / 5;

/**
 * The band for a stage index (`@engine/types.stageIndexOf`): earth 0, mars 1,
 * ... pluto 6.
 *
 * Earth has no belt (D57) and so no band that anything flies; it answers
 * `MAX_LIVE_MIN`..`MAX_LIVE_MIN + HEADROOM` rather than throwing, for the same
 * reason `clampKnobs` clamps - a route index that arrived from a restored
 * profile must never be able to stop a child's game.
 */
export function stopBandForStage(stage: number): LiveBand {
  const s = Number.isFinite(stage) ? Math.floor(stage) : 0;
  // The floor climbs SLOWER than one setting a stop - see
  // `STOP_BAND_FLOOR_RISE` - and stops short of FR-10's cap, so that even the
  // last stop has settings above its floor to adapt into.
  const floor = Math.min(
    MAX_LIVE_MAX - STOP_BAND_CEILING_LEAD + 1,
    MAX_LIVE_MIN + Math.floor(Math.max(0, s - 1) * STOP_BAND_FLOOR_RISE),
  );
  const ceiling = Math.min(MAX_LIVE_MAX, Math.max(floor, s + STOP_BAND_CEILING_LEAD));
  return clampBand({ floor, ceiling });
}

/** The band this stop's belt is flown inside. */
export function stopBand(stop: StopId): LiveBand {
  return stopBandForStage(stageIndexOf(stop));
}

/**
 * The band for a stop that may be absent.
 *
 * `null` is FR-10's whole range, and the omission is the honest default rather
 * than a convenience: a caller with no stop in hand is not asserting that the
 * belt has no stop, so the band must not pretend to a progression it has no
 * data for. Every pre-UR-83 caller lands here and flies the 2..7 it always did.
 */
export function bandOf(stop: StopId | null | undefined): LiveBand {
  return stop === null || stop === undefined
    ? { floor: MAX_LIVE_MIN, ceiling: MAX_LIVE_MAX }
    : stopBand(stop);
}

// ---------------------------------------------------------------------------
// PER-STOP PACE (UR-84)
// ---------------------------------------------------------------------------

/**
 * How much of a rock's fall budget the LAST stop takes away, as a fraction.
 *
 * ================== WHAT THE STOP DECIDED BEFORE THIS ==================
 * Only HOW MANY rocks. `stopBandForStage` sets the two ends of the `maxLive`
 * range and nothing else, so Pluto and Mars differed in the number of things on
 * the board and in nothing about how fast any one of them fell. Measured on the
 * route sweep, a ~100%-accuracy pilot arrived at Pluto still finishing each word
 * with about a third of its budget unspent: a busier board is a different job,
 * not a faster one, and the owner's report is about speed.
 *
 * So the stop now also sets a PACE, on the same `stageIndexOf` axis the band
 * runs on and in the same file, because a table in a second place is how the
 * route's shape starts disagreeing with itself.
 *
 * ================== IT COMPOSES WITH ABILITY, IT DOES NOT REPLACE IT =======
 * This file returns the route's shape only. `@engine/fallTime.stopPaceFactor`
 * is what applies it, and it scales the whole drop by `headroomEarned` - the
 * one axis `keystrokeHeadroom`, `recognitionBaseMs` and the per-rock spread all
 * already ratchet on. So:
 *
 *     iki      260*   350    440    520    600+
 *     pluto    0.88   0.88   0.92   0.96   1.00
 *              ----------------------------  ----
 *              (the pace multiple at the last stop)
 *
 * A pilot measured at `HEADROOM_SLOW_IKI_MS` or slower flies Pluto at exactly
 * FR-8's budget, at every stop, whatever the route says. A grade-2 child is
 * therefore not handed one millisecond less anywhere on the route by this - it
 * is arithmetic rather than a hope about a simulation, and it is the same
 * safety shape UR-51 and UR-72 already ship.
 *
 * ================== WHERE 0.12 COMES FROM ==================
 * Measured, not chosen: it is the largest drop at which NO pilot gains a belt
 * anywhere on the route. Route sweep, 40 seeds x 6 belts x 5 pilots, the real
 * controller carried stop to stop, with C20's unscaled floor and UR-84's
 * within-belt adaptation both on:
 *
 *     drop    0.10   0.12   0.13         0.15              0.20
 *     stalls  0      0      slow 1 at    median 1 pluto,   median 9 pluto +
 *                           uranus       slow 1 uranus     1 neptune,
 *                                        + 1 pluto         slow 3+3+3
 *
 * and the pilot that breaks first is the MEDIAN, not the grade-2 one - the
 * `headroomEarned` scaling exempts the tail entirely, so the binding pilot is
 * the one at FR-8's own default interval who earns the whole ratchet on every
 * axis in `@engine/fallTime` at once. `tests/unit/simulation/launchRoute.test.ts`
 * is the sweep and `gauntlet/evidence/route-speed.json` is its table.
 *
 * WHAT IT BUYS, in the number the report is about: a ~100%-accuracy pilot's
 * lower-quartile margin at Pluto goes 0.427 -> 0.343, i.e. from finishing each
 * word with 43% of its budget unused to 34%, and their fastest rock at Pluto
 * goes from a flat 10 000 ms (C20's floor, every belt, every seed) to 5393 ms.
 *
 * FR-8'S BOUNDS ARE UNTOUCHED. The pace is applied inside `rawFallTimeMs`, i.e.
 * BEFORE `clampFallTime`, so no rock can be granted less than FR-8's literal
 * 2500 ms floor however late the stop is.
 */
export const STOP_PACE_DROP = 0.12;

/**
 * The fraction of the budget this stage takes away, before ability is read.
 *
 * Linear in the stage index over the six BELT stops, so Mars is exactly 0 - the
 * first belt a child ever flies is FR-8's budget byte for byte, which is the
 * same floor `stopBandForStage` puts Mars on and the same cold start D18 is
 * about. Earth (0) has no belt (D57) and answers 0 for the reason
 * `stopBandForStage` answers a band rather than throwing.
 */
export function stopPaceDropForStage(stage: number): number {
  const s = Number.isFinite(stage) ? Math.floor(stage) : 0;
  const steps = Math.min(STOP_PACE_LAST_STAGE - 1, Math.max(0, s - 1));
  return (steps / (STOP_PACE_LAST_STAGE - 1)) * STOP_PACE_DROP;
}

/** Pluto's stage index: the stop at which the whole drop has been applied. */
const STOP_PACE_LAST_STAGE = 6;

/** The fraction of the budget this stop takes away, before ability is read. */
export function stopPaceDrop(stop: StopId): number {
  return stopPaceDropForStage(stageIndexOf(stop));
}
