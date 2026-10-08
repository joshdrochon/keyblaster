import { rockHintFits, type RockHintView } from "../hint/index.js";
import type { StopId } from "../types.js";

/**
 * VENUS READS THROUGH CLOUD (D109).
 *
 * ================== WHY THE BONUS STOPS NEEDED THIS ==================
 * Venus, Zoozve and Mercury had NO mechanical difference from any other belt.
 * The only stop-specific line was `difficultyStageOf`, which borrows another
 * stop's knobs - so the three of them were harder numbers wearing new paint,
 * and Pluto, with its two-layer rocks, was mechanically richer than the stop
 * that is supposed to be the hardest in the game. D105's shockwave was meant to
 * be this and was removed (D106) without a replacement.
 *
 * ================== THE MECHANIC ==================
 * You cannot see Venus's surface. So on Venus the far end of a word sits behind
 * cloud: the letters you have typed and the next few are clear, and the rest
 * are veiled until you reach them. The cloud RECEDES as you type.
 *
 * It changes what the player does, not what they look at: a reader cannot take
 * the whole word in at a glance and must decode it left to right, which is the
 * skill the game is for.
 *
 * ================== WHAT IT MAY NEVER DO ==================
 * It may never make a letter unreadable. A veiled letter keeps its glyph, its
 * place and its advance - so nothing reflows - and is drawn at a colour that
 * still clears AC-22.8's 4.5:1 against the plate. A child who cannot decode it
 * can still read it; the cloud is a nudge, not a blindfold. `CLEAR_AHEAD` is
 * deliberately generous for the same reason.
 */

/** Letters kept fully clear BEYOND the one being typed. */
export const CLEAR_AHEAD = 2;

/** The stops whose words arrive behind cloud, and how far ahead stays clear. */
export const VEIL_BY_STOP: Readonly<Partial<Record<StopId, number>>> = Object.freeze({
  venus: CLEAR_AHEAD,
});

/** How far ahead stays clear at this stop, or null where there is no cloud. */
export function veilWindowFor(stop: StopId): number | null {
  return VEIL_BY_STOP[stop] ?? null;
}

export interface VeilWarningInput {
  readonly stopId: StopId;
  readonly saidThisRun: boolean;
  readonly leadMs: number;
  readonly veiled: RockHintView | null;
}

/** The line lands while the word it points at is still there. */
export function shouldWarnVeil(input: VeilWarningInput): boolean {
  if (input.saidThisRun) return false;
  if (veilWindowFor(input.stopId) === null) return false;
  if (input.veiled === null) return false;
  return rockHintFits(input.veiled, input.leadMs);
}

/**
 * The first index that is behind cloud, given how much is typed.
 *
 * Everything before it is clear: the typed letters, the one being typed, and
 * `window` more. Junk input yields a window past the end of any word, i.e. no
 * veil at all - the mechanic fails OPEN, because a cloud that appears when the
 * clock misbehaves would be a word a child cannot read.
 */
export function veilFrom(_typedCount: number, window: number | null): number {
  if (window === null || !Number.isFinite(window) || window < 0) return Number.POSITIVE_INFINITY;
  // FIXED AT THE HEAD OF THE WORD, NOT SLIDING WITH THE CURSOR.
  //
  // This used to be `typed + window + 1`, so the clear band was a window that
  // travelled: every keystroke turned one letter white->accent AND one
  // grey->white, which the owner read as the letters shifting. The boundary is
  // the same at typed=0 either way; it just no longer moves, so the only colour
  // change per keystroke is the accent one the game had before D109.
  return Math.floor(window) + 1;
}

/**
 * Is letter `i` behind cloud right now?
 *
 * A letter already typed is never behind cloud: the plate lights it in the
 * accent, and this says so rather than leaving the render to be the only thing
 * that knows. Everything from `veilFrom` onward is veiled and STAYS veiled
 * until the cursor reaches it, which is what stops the clear band travelling.
 */
export function isVeiled(i: number, typedCount: number, window: number | null): boolean {
  const typed = Number.isFinite(typedCount) ? Math.max(0, Math.floor(typedCount)) : 0;
  if (i < typed) return false;
  return i >= veilFrom(typedCount, window);
}
