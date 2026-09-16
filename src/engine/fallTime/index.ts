import { DEFAULT_CALIBRATION, type Calibration } from "../types.js";

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

export const clampFallTime = (ms: number): number =>
  Math.min(FALL_TIME_MAX_MS, Math.max(FALL_TIME_MIN_MS, ms));

export interface FallTimeInput {
  /** The word as it will be typed; only its length is used. */
  readonly word: string;
  /** This player's ease for this word, already clamped to [0.25, 2.0]. */
  readonly ease: number;
  /** The player's calibration; defaults to 350 ms iki per PRD FR-8. */
  readonly calibration?: Calibration;
}

/**
 * AC-8.1: the formula exactly as documented, with the clamps holding.
 * Pure and total - no clock, no randomness, no NaN escapes.
 */
export function fallTimeMs({ word, ease, calibration }: FallTimeInput): number {
  const iki = calibration?.ikiMs ?? DEFAULT_CALIBRATION.ikiMs;
  const raw = keystrokeBudgetMs(word.length, iki) + recognitionBudgetMs(ease);
  return clampFallTime(raw);
}

/**
 * The unclamped value, for tests and for the gauntlet's difficulty telemetry.
 * Useful because a word pinned at a clamp bound tells the controller that the
 * fall-time knob has no headroom left for that word.
 */
export function rawFallTimeMs({ word, ease, calibration }: FallTimeInput): number {
  const iki = calibration?.ikiMs ?? DEFAULT_CALIBRATION.ikiMs;
  return keystrokeBudgetMs(word.length, iki) + recognitionBudgetMs(ease);
}

/** True if the computed value hit either clamp (telemetry, not gameplay). */
export function isClamped(input: FallTimeInput): boolean {
  const raw = rawFallTimeMs(input);
  return raw < FALL_TIME_MIN_MS || raw > FALL_TIME_MAX_MS;
}
