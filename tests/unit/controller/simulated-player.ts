/**
 * The simulated player for AC-10.2.
 *
 * AC-10.2 only means something if the player's realised hit rate actually
 * responds to the knobs. A model where difficulty does not bite would make the
 * convergence claim vacuous, so every parameter below is derived from a number
 * the docs already commit to, not chosen to make the test green.
 *
 * ---------------------------------------------------------------------------
 * WHAT "true accuracy p" MEANS HERE
 * ---------------------------------------------------------------------------
 * p is the player's probability of typing one word correctly, end to end, at
 * the NEUTRAL word length (L_REF) and with unlimited time. It is a property of
 * the player, fixed for a run. It is not the measured hit rate: the measured
 * hit rate is what the controller can move, and it is always some function of
 * p and the current knobs.
 *
 * ---------------------------------------------------------------------------
 * TWO INDEPENDENT FAILURE CHANNELS
 * ---------------------------------------------------------------------------
 * 1. TYPING. Per-character correctness c is constant for a player. A word of
 *    length L survives if every character does:
 *        P(typed) = c^L,  with c chosen so that c^L_REF = p
 *                      =>  P(typed) = p^(L / L_REF)
 *    So lengthBias bites: longer words are exponentially less likely to be
 *    typed cleanly. This is the standard per-symbol reliability model.
 *
 * 2. SERVICE TIME. The player types one asteroid at a time. With up to
 *    `maxLive` asteroids on screen, an asteroid waits behind the ones ahead of
 *    it. Expected work in front of a given asteroid, including itself, is
 *        (1 + (maxLive - 1) / 2) = (maxLive + 1) / 2   words
 *    and it is only reached in time if that work fits inside its fall time:
 *        P(reached) = clamp01( fallTime(L) / ( ((maxLive+1)/2) * typeTime(L) ) )
 *    So maxLive bites: more simultaneous asteroids means a longer queue in the
 *    same fall time.
 *
 *    fallTime is architecture 4.1 verbatim, at ease 1.0:
 *        clamp(L * 1.5 * ikiMs + 1200 * 1.0, 2500, 14000)
 *    typeTime is the calibration defaults from types.ts DEFAULT_CALIBRATION:
 *        fkLatencyMs + L * ikiMs = 500 + 350L
 *
 * hit = P(typed) * P(reached). Both factors are strictly decreasing in
 * difficulty, so hit is strictly decreasing in both knobs. That is the property
 * AC-10.2 needs, and it falls out of the game's own fall-time formula rather
 * than out of a tuned constant.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE MODEL DOES NOT DO
 * ---------------------------------------------------------------------------
 * It does not let a knob make the player MORE accurate than their own typing.
 * The ceiling on measured hit rate is P(typed) at the shortest served word:
 *        ceiling = p ^ (L_MIN / L_REF)
 * No setting of any knob can exceed it. That ceiling is the reason the AC-10.2
 * assertion fails at the bottom of the p range, and it is structural: it holds
 * for any model in which the controller changes what the player is asked to do
 * rather than how well the player types.
 */

import type { Knobs, LengthBias } from "@engine/controller/index.js";

/** DEFAULT_CALIBRATION in src/engine/types.ts. */
export const IKI_MS = 350;
export const FK_LATENCY_MS = 500;

/** Architecture 4.1 constants. */
export const RECOGNITION_BASE_MS = 1200;
export const FALL_MIN_MS = 2500;
export const FALL_MAX_MS = 14000;

/**
 * Word-length buckets per lengthBias.
 *
 * Grounded in the actual stage pools: the Mars pool in story-draft-v1.md runs
 * 3-6 letters (mean 4.26). Neutral bias is therefore 3-6; -1 is its short half,
 * +1 shifts up by two while staying well inside MAX_WORD_LENGTH (13).
 */
export const LENGTHS_BY_BIAS: Readonly<Record<LengthBias, readonly number[]>> = {
  [-1]: [3, 4],
  [0]: [3, 4, 5, 6],
  [1]: [5, 6, 7, 8],
};

/** Neutral-bias mean length. p is anchored here. */
export const L_REF = 4.5;

/** Shortest word the loosest setting can serve. Sets the hit-rate ceiling. */
export const L_MIN = 3;

/**
 * Spawns per stage. The docs do not fix this. 24 is chosen so a stage is longer
 * than the 20-outcome window (otherwise the window would never be dominated by
 * the current knobs and convergence would measure stale settings).
 */
export const SPAWNS_PER_STAGE = 24;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Architecture 4.1, ease 1.0, default calibration. */
export function fallTimeMs(length: number): number {
  return clamp(length * 1.5 * IKI_MS + RECOGNITION_BASE_MS, FALL_MIN_MS, FALL_MAX_MS);
}

/** Time for the player to actually type the word once they start. */
export function typeTimeMs(length: number): number {
  return FK_LATENCY_MS + length * IKI_MS;
}

/** Channel 2: probability the player gets to this asteroid before it lands. */
export function serviceProbability(maxLive: number, length: number): number {
  const queue = (maxLive + 1) / 2;
  return clamp(fallTimeMs(length) / (queue * typeTimeMs(length)), 0, 1);
}

/** Channel 1: probability the word is typed without a wrong character. */
export function typingProbability(p: number, length: number): number {
  return Math.pow(p, length / L_REF);
}

/** Realised probability that a spawned asteroid is blasted. */
export function hitProbability(p: number, knobs: Knobs, length: number): number {
  return typingProbability(p, length) * serviceProbability(knobs.maxLive, length);
}

/**
 * The margin this player clears a word with, in the same units the controller
 * reads (`@engine/controller/margin`): the fraction of the fall budget still
 * unspent when the rock went.
 *
 * UR-51 added the margin as the controller's throttle, so a simulation that
 * reported only hits and misses would exercise a controller with no tightening
 * authority at all - and every diagnostic below it would pass vacuously. The
 * quantity is taken from the model that is already here rather than invented:
 * `serviceProbability` is `fall / (queue x type)`, so the time actually spent
 * is `queue x type` and the margin is one minus its share of the fall.
 *
 * A word that was NOT blasted has, by definition, spent its whole budget - the
 * caller passes 0 for those, exactly as the scene does for a breach.
 *
 * THE SCALE IS THIS MODEL'S, NOT THE BELT'S, and that is a finding rather than
 * a flaw. At maxLive 2 this player's margin is 0.10-0.16 - they are already
 * within a sixth of the breach line at the gentlest setting, far tighter than
 * any pilot the belt simulation flies (0.53 fast, 0.17 grade-2). A
 * margin-throttled controller therefore refuses to tighten for them at all,
 * which is the correct answer for a player with no room and is why the
 * convergence diagnostics below now measure an untightened belt.
 */
export function clearanceMarginOf(maxLive: number, length: number): number {
  const queue = (maxLive + 1) / 2;
  const spent = (queue * typeTimeMs(length)) / fallTimeMs(length);
  return clamp(1 - spent, 0, 1);
}

/**
 * Hard ceiling on measured hit rate for a player of accuracy p, over every
 * reachable knob setting. Used by the AC-10.2 failure message so the report
 * says WHY a p value is out of reach, not just that it is.
 */
export function hitRateCeiling(p: number): number {
  return typingProbability(p, L_MIN) * serviceProbability(2, L_MIN);
}
