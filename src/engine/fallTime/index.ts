import { DEFAULT_CALIBRATION, type Calibration } from "../types.js";
import {
  MAX_LIVE_MAX,
  MAX_LIVE_MIN,
  concurrencyTarget,
  type Knobs,
} from "../controller/knobs.js";

/**
 * Fall time (D19, PRD FR-8, architecture section 4.1).
 *
 *   fallTime = clamp(len * 1.5 * player.ikiMs + 1200 * ease(word), 2500, 14000)
 *
 * The split is the whole idea (D19). Word LENGTH is motor cost and is VISIBLE:
 * the asteroid is bigger, so the player can see that a long word is a bigger
 * job. EASE is recognition cost and is INVISIBLE: it is this player's history
 * with this word. That is why AC-8.3 forbids any UI that maps size to speed -
 * showing the rule would turn an adaptive system into a judgement about the
 * child.
 *
 * Constants are first-pass and tunable (D69). They are exported so tests and
 * the PRD can be diffed against each other rather than against magic numbers.
 *
 * UR-51: THE FORMULA ABOVE IS THE BUDGET FOR A ONE-DEEP BOARD. It budgets a
 * rock for reading and typing and not for WAITING, and every rock on a deeper
 * board is waiting. The whole expression is therefore multiplied by
 * `fallBudgetFactor`, which is the controller's own `concurrencyTarget` and is
 * exactly 1 at `MAX_LIVE_MIN` - so the line above is still, byte for byte, the
 * fall time the gentlest belt flies. See `fallBudgetFactor` for why this is not
 * a new global constant.
 */

/**
 * Multiplier on the player's median inter-key interval (PRD FR-8), i.e. the
 * typing budget with 50% headroom. This is the value at `MAX_LIVE_MIN` and it
 * is FR-8's literal constant; `keystrokeHeadroom` is what a pilot who has
 * earned it flies instead.
 */
export const KEYSTROKE_BUDGET_FACTOR = 1.5;

/**
 * The headroom a pilot at the top of the knob gets instead: 12.5% (UR-51).
 *
 * ================== WHY THE HEADROOM HAD TO MOVE ==================
 * FR-8 budgets a word at `len * 1.5 * iki`, so a pilot who types at their own
 * measured speed spends two thirds of the typing budget and the other third is
 * slack - and measured over a route, a fast pilot's rocks left the board with
 * 53% of the WHOLE budget unused (`./margin.ts` has the four-pilot table). That
 * is why every difficulty change before this one could only ever add words and
 * never take away time: a busier board cost a fast pilot nothing, because the
 * slack absorbed it. `gauntlet/evidence/route-occupancy.json` recorded the
 * board going from 1.00 rocks to 3.35 with the closest approach to the breach
 * line barely moving.
 *
 * So the headroom is the thing that gets spent. At `MAX_LIVE_MIN` it is FR-8's
 * 1.5 exactly - the same byte, for a new profile and for any pilot the
 * controller has not moved - and it ratchets to 1.125 at `MAX_LIVE_MAX` for a
 * pilot whose measured speed has earned it (`HEADROOM_SLOW_IKI_MS`).
 *
 * ================== IT IS NOT A NEW KNOB (AC-10.4) ==================
 * The knob set is still exactly {maxLive, lengthBias}. This is a FUNCTION of
 * the primary knob, the way `concurrencyTarget` is, so it inherits every
 * property the knob already has: it moves one step per stage (D20, AC-10.1),
 * it is persisted on the profile with the knob, and a loosen - including the
 * one `beginStall` forces - ratchets it straight back. Adding a third knob
 * would have needed its own schema field, its own migration, and its own
 * proof that all three never move in one stage.
 *
 * ================== AND IT IS WHY THE CLIMB TERMINATES ==================
 * `@engine/controller` now tightens on margin rather than on hit rate, and this
 * is the term that spends margin. Without it the controller would read a
 * quantity no knob could move and climb to the cap for everybody, which is the
 * defect it was changed to fix. The two halves are one loop.
 */
export const KEYSTROKE_HEADROOM_MIN = 1.125;

/**
 * The typing speed at which NONE of the ratchet is available, ms between keys.
 *
 * ================== WHY THE KNOB IS NOT ENOUGH ON ITS OWN ==================
 * The knob says how deep the board is; it does not say who is flying it. Forced
 * to `MAX_LIVE_MAX` with the ratchet on the knob alone, the grade-2 pilot
 * stalled 23 of 240 route-belts against the 3 on record - measured, in
 * `tests/unit/simulation/launchRoute.test.ts`, not predicted. The margin gate in
 * `@engine/controller` makes that state hard to reach, and "hard to reach" is
 * not the same claim as "safe", and UR-51's constraint is the second one.
 *
 * ================== WHERE 600 COMES FROM ==================
 * It is the grade-2 model this repo has measured against since the belt-stall
 * investigation - `ikiMs: 600`, used by `tests/unit/simulation/belt.test.ts`,
 * `tests/unit/flight/beltConcurrency.test.ts` and the route sweep. At that speed
 * the measured margin is 0.171, below `TIGHTEN_MARGIN_ABOVE` (0.35): by the
 * controller's own measure that pilot has no slack to spend, so none is taken.
 * The interpolation runs from FR-8's own default (350 ms) to here, so:
 *
 *     iki      260*   350    440    600+
 *     earned   1.00   1.00   0.64   0.00
 *
 * (*) The flight scene floors the calibration it hands fall time at
 * FR-8's default, so the engine never sees a value below 350 on the real path -
 * that clamp is a LOOSENING rule and predates this. It is why the ratchet is
 * full at the default rather than only below it, and why a pilot faster than
 * the default earns the same full ratchet as one exactly at it.
 */
export const HEADROOM_SLOW_IKI_MS = 600;

/** Recognition budget at ease 1.0, in ms (PRD FR-8: BASE). */
export const RECOGNITION_BASE_MS = 1200;

/** Clamp bounds, ms (PRD FR-8: MIN 2.5 s, MAX 14 s). */
export const FALL_TIME_MIN_MS = 2500;
export const FALL_TIME_MAX_MS = 14000;

/**
 * How much of the ratchet this player's measured typing speed has earned, 0..1.
 *
 * See `HEADROOM_SLOW_IKI_MS` for the anchor and the measurement. Total: a
 * non-finite calibration reads as the slowest pilot, i.e. earns nothing, which
 * is the only direction a corrupt value may move a child's belt.
 */
export function headroomEarned(ikiMs: number): number {
  const iki = Number.isFinite(ikiMs) ? ikiMs : HEADROOM_SLOW_IKI_MS;
  // `Math.max(1, ...)` rather than a guard: the span is a difference of two
  // constants, so a guard on it would be a branch no test could ever reach and
  // an uncoverable branch is how the 95% gate gets argued with instead of met.
  const span = Math.max(1, HEADROOM_SLOW_IKI_MS - DEFAULT_CALIBRATION.ikiMs);
  return Math.min(1, Math.max(0, (HEADROOM_SLOW_IKI_MS - iki) / span));
}

/**
 * How much headroom over this player's own typing speed the budget grants, at
 * this setting of the primary knob and this measured speed (UR-51).
 *
 * At FR-8's default interval, or anything faster:
 *
 *     maxLive   2      3      4      5      6      7
 *     headroom  1.500  1.425  1.350  1.275  1.200  1.125
 *
 * A slower pilot keeps more of it at every setting, in proportion to
 * `headroomEarned`; at `HEADROOM_SLOW_IKI_MS` and beyond the row above is
 * flat 1.500 and the belt is FR-8's, whatever the knob says.
 *
 * Continuous across FR-10's 2..7 for the reason `concurrencyTarget` is: the
 * knob moves one step per stage (D20, AC-10.1) and a headroom that dropped in
 * visible jumps would make one stage boundary in three a cliff.
 *
 * TWO INDEPENDENT FLOORS, AND BOTH ARE EXACT. At `MAX_LIVE_MIN` this is exactly
 * `KEYSTROKE_BUDGET_FACTOR` for every pilot, and at `HEADROOM_SLOW_IKI_MS` it
 * is exactly `KEYSTROKE_BUDGET_FACTOR` at every knob setting. So the belt a new
 * profile flies and the belt a grade-2 pilot flies are both FR-8's formula
 * unchanged, byte for byte - UR-51's hard constraint, as a property of this
 * function rather than as a hope about a simulation.
 * `tests/unit/fallTime/fallTime.test.ts` sweeps every shipped word at every
 * pilot speed against the pre-change value.
 *
 * A corrupt knob reads as the floor rather than as NaN - same rule as
 * `clampKnobs` and `concurrencyTarget`: a restored profile must never be able
 * to stop a child's game.
 */
export function keystrokeHeadroom(maxLive: number, ikiMs?: number): number {
  const span = MAX_LIVE_MAX - MAX_LIVE_MIN;
  const live = Number.isFinite(maxLive) ? Math.floor(maxLive) : MAX_LIVE_MIN;
  const steps = Math.min(span, Math.max(0, live - MAX_LIVE_MIN));
  const earned = headroomEarned(ikiMs ?? DEFAULT_CALIBRATION.ikiMs);
  return (
    KEYSTROKE_BUDGET_FACTOR +
    (steps / span) * earned * (KEYSTROKE_HEADROOM_MIN - KEYSTROKE_BUDGET_FACTOR)
  );
}

/**
 * The typing half of the budget: how long we expect THIS player to need to
 * physically type a word of this length, with headroom.
 *
 * `headroom` defaults to FR-8's literal 50%, so every existing caller and the
 * PRD's own formula are unchanged. `fallTimeMs` passes `keystrokeHeadroom` of
 * the current knob instead (UR-51).
 */
export function keystrokeBudgetMs(
  length: number,
  ikiMs: number,
  headroom: number = KEYSTROKE_BUDGET_FACTOR,
): number {
  return length * headroom * ikiMs;
}

/** The recognition half: how long we expect them to need to READ it. */
export function recognitionBudgetMs(ease: number): number {
  return RECOGNITION_BASE_MS * ease;
}

/**
 * How much of FR-8's budget this rock gets, as a multiple (UR-42, UR-51).
 *
 * ================== THE BUDGET IS PER QUEUE, NOT PER ROCK ==================
 * FR-8's formula budgets a rock for the player to READ it and TYPE it. It does
 * not budget for the rock to WAIT, and on a board holding more than one rock
 * every rock but the front one is waiting. A player is a single server
 * (AC-2.1), so the Nth rock on the board waits N-1 service times before anyone
 * can touch it, and it falls throughout. FR-8's budget therefore affords
 * exactly floor(fall / service) answerable rocks, which at the shipped
 * constants is 1 for every pilot in every shipped pool
 * (gauntlet/evidence/belt-concurrency.json: 1.18 fast, 1.25 median, 1.38
 * grade-2). That is why UR-42's report - a board that never holds more than one
 * word-asteroid - could not be answered with `maxLive`, and it is what UR-51
 * decided to change.
 *
 * So the budget scales with the depth the controller is asking for. This is the
 * reason the scale is NOT a new global constant: a global would widen the
 * budget for the grade-2 child as well, which is precisely the trade UR-42
 * refused and the hard constraint on UR-51 forbids. At `MAX_LIVE_MIN` the
 * factor is exactly 1 and every fall time in the game is the byte it was.
 *
 * ================== THE SHAPE OF FR-8 IS UNTOUCHED ==================
 * A multiple, applied to the whole expression, so D19's split survives: length
 * is still motor cost and still visible, ease is still recognition cost and
 * still invisible, and their ratio at any knob setting is FR-8's ratio. Nothing
 * here can make one word cheap relative to another.
 */
export function fallBudgetFactor(knobs?: Pick<Knobs, "maxLive">): number {
  return concurrencyTarget(knobs?.maxLive ?? MAX_LIVE_MIN);
}

/**
 * Clamp against FR-8's MIN/MAX, scaled by the same factor as the budget.
 *
 * ================== WHY THE CLAMP SCALES TOO ==================
 * It has to, or the mechanism fails silently for exactly the pilot it must not
 * fail for. A grade-2 pilot's five-letter word raws at 6420 ms; at a depth of 4
 * that is 25 680 ms, and against a fixed 14 000 ms ceiling it clamps back to a
 * fall/service ratio of 3.03 - so the belt would build a 4-deep queue and then
 * drop the back of it on the child's hull. The bound is part of the budget, not
 * a separate policy about it, so it moves with the budget.
 *
 * At `MAX_LIVE_MIN` the factor is 1, so the bounds are FR-8's literal 2.5 s and
 * 14 s. The PRD's numbers are still the numbers the shipped floor flies.
 */
export const clampFallTime = (ms: number, factor = 1): number => {
  const f = Number.isFinite(factor) ? Math.max(1, factor) : 1;
  return Math.min(FALL_TIME_MAX_MS * f, Math.max(FALL_TIME_MIN_MS * f, ms));
};

export interface FallTimeInput {
  /** The word as it will be typed; only its length is used. */
  readonly word: string;
  /** This player's ease for this word, already clamped to [0.25, 2.0]. */
  readonly ease: number;
  /** The player's calibration; defaults to 350 ms iki per PRD FR-8. */
  readonly calibration?: Calibration;
  /**
   * The controller's current knobs; only `maxLive` is read, and only to size
   * the queue this rock may have to wait in (`fallBudgetFactor`). Absent means
   * `MAX_LIVE_MIN`, i.e. FR-8's budget exactly as written.
   */
  readonly knobs?: Pick<Knobs, "maxLive">;
}

/**
 * AC-8.1: the formula exactly as documented, with the clamps holding.
 * Pure and total - no clock, no randomness, no NaN escapes.
 */
export function fallTimeMs({ word, ease, calibration, knobs }: FallTimeInput): number {
  return clampFallTime(rawFallTimeMs({ word, ease, calibration, knobs }), fallBudgetFactor(knobs));
}

/**
 * The unclamped value, for tests and for the gauntlet's difficulty telemetry.
 * Useful because a word pinned at a clamp bound tells the controller that the
 * fall-time knob has no headroom left for that word.
 */
export function rawFallTimeMs({ word, ease, calibration, knobs }: FallTimeInput): number {
  const iki = calibration?.ikiMs ?? DEFAULT_CALIBRATION.ikiMs;
  const headroom = keystrokeHeadroom(knobs?.maxLive ?? MAX_LIVE_MIN, iki);
  return (
    (keystrokeBudgetMs(word.length, iki, headroom) + recognitionBudgetMs(ease)) *
    fallBudgetFactor(knobs)
  );
}

/** True if the computed value hit either clamp (telemetry, not gameplay). */
export function isClamped(input: FallTimeInput): boolean {
  const factor = fallBudgetFactor(input.knobs);
  const raw = rawFallTimeMs(input);
  return raw < FALL_TIME_MIN_MS * factor || raw > FALL_TIME_MAX_MS * factor;
}
