import { DEFAULT_CALIBRATION, type Calibration } from "../types.js";
import { MAX_LIVE_MIN, concurrencyTarget, type Knobs } from "../controller/knobs.js";

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

/** Multiplier on the player's median inter-key interval (PRD FR-8). */
export const KEYSTROKE_BUDGET_FACTOR = 1.5;

/** Recognition budget at ease 1.0, in ms (PRD FR-8: BASE). */
export const RECOGNITION_BASE_MS = 1200;

/** Clamp bounds, ms (PRD FR-8: MIN 2.5 s, MAX 14 s). */
export const FALL_TIME_MIN_MS = 2500;
export const FALL_TIME_MAX_MS = 14000;

/**
 * The typing half of the budget: how long we expect THIS player to need to
 * physically type a word of this length, with 50% headroom.
 */
export function keystrokeBudgetMs(length: number, ikiMs: number): number {
  return length * KEYSTROKE_BUDGET_FACTOR * ikiMs;
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
 * grade-2). That is why "there is only one asteroid on the screen at once"
 * (UR-42) could not be bought with `maxLive`, and it is what UR-51 decided to
 * change.
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
  const factor = fallBudgetFactor(knobs);
  const iki = calibration?.ikiMs ?? DEFAULT_CALIBRATION.ikiMs;
  const raw = (keystrokeBudgetMs(word.length, iki) + recognitionBudgetMs(ease)) * factor;
  return clampFallTime(raw, factor);
}

/**
 * The unclamped value, for tests and for the gauntlet's difficulty telemetry.
 * Useful because a word pinned at a clamp bound tells the controller that the
 * fall-time knob has no headroom left for that word.
 */
export function rawFallTimeMs({ word, ease, calibration, knobs }: FallTimeInput): number {
  const iki = calibration?.ikiMs ?? DEFAULT_CALIBRATION.ikiMs;
  return (
    (keystrokeBudgetMs(word.length, iki) + recognitionBudgetMs(ease)) *
    fallBudgetFactor(knobs)
  );
}

/** True if the computed value hit either clamp (telemetry, not gameplay). */
export function isClamped(input: FallTimeInput): boolean {
  const factor = fallBudgetFactor(input.knobs);
  const raw = rawFallTimeMs(input);
  return raw < FALL_TIME_MIN_MS * factor || raw > FALL_TIME_MAX_MS * factor;
}
