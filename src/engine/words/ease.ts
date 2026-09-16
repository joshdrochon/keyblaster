import { EASE_MAX, EASE_MIN, EASE_NEW } from "../types.js";

/**
 * Ease updates (architecture section 4.1, D19, D21).
 *
 * `ease` is recognition difficulty, not motor difficulty: word LENGTH already
 * carries motor cost through the fall-time formula and the asteroid's size.
 * Ease is how long this particular player takes to RECOGNISE this particular
 * word, which is what LaBerge & Samuels call fluency.
 *
 * Multipliers are exactly as documented. They are tunable (D69) but changing
 * them is a PRD edit, not a code edit.
 */

/** A hit faster than this is treated as recognised, not decoded (arch 4.1). */
export const FAST_HIT_FK_LATENCY_MS = 800;

export const EASE_FACTOR = Object.freeze({
  fastHit: 0.85,
  slowHit: 0.95,
  miss: 1.25,
  typo: 1.05,
});

export const clampEase = (ease: number): number =>
  Math.min(EASE_MAX, Math.max(EASE_MIN, ease));

/** Starting ease for a word this player has never seen (arch 4.1). */
export const newEase = (): number => EASE_NEW;

/**
 * A hit. `fkLatencyMs` is first-key latency: the gap between the asteroid
 * becoming typeable and the player's first keystroke. That gap is recognition;
 * everything after it is typing speed, which the ikiMs budget handles.
 */
export function easeAfterHit(ease: number, fkLatencyMs: number): number {
  const factor =
    fkLatencyMs < FAST_HIT_FK_LATENCY_MS ? EASE_FACTOR.fastHit : EASE_FACTOR.slowHit;
  return clampEase(ease * factor);
}

/** A miss: the asteroid reached the breach line unblasted. */
export const easeAfterMiss = (ease: number): number =>
  clampEase(ease * EASE_FACTOR.miss);

/**
 * A typo on this word. Deliberately the gentlest nudge of the four: D31 says
 * the player must always feel like the best typer in the world, so a wrong
 * letter costs a little recognition credit and nothing else. It never drops
 * the lock (AC-3.2) and never reads as failure.
 */
export const easeAfterTypo = (ease: number): number =>
  clampEase(ease * EASE_FACTOR.typo);
