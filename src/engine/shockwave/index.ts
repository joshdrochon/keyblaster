import type { StopId } from "../types.js";

/**
 * THE INNER RUN HITS BACK (bonus stops only).
 *
 * Venus and Mercury are optional and they are flown after Pluto, by a player
 * who has already cleared the whole route. The knobs the controller turns are
 * the same everywhere, so a harder stop cannot come from difficulty alone
 * without either breaking the pacing model or making the main route easier by
 * comparison. This is the extra thing instead: destroying a rock DISTURBS the
 * one nearest it.
 *
 * ================== WHAT IT MAY AND MAY NOT TOUCH ==================
 * SPIN and FALL RATE, and nothing else.
 *
 * Not the sideways line. `FlightScene.updateRocks` carries an explicit
 * prohibition on it - "a rock that changes direction part-way down reads as
 * being deflected by something, which is a bug this project has already had
 * reported once" - and a shockwave that shoved rocks sideways would also walk
 * them through the plate keep-out the spawner proved at spawn time.
 *
 * Not past `SHOCKWAVE_MAX_LOSS` of the rock's own budget. The first version of
 * this clamped against FR-8's literal 2500 ms and was INERT: Mercury's falls
 * are already ~2143 ms once the queue-depth scaling has run, so the floor bit
 * on every rock and nothing was ever hurried. FR-8's number governs the fall a
 * rock is ASSIGNED at spawn, not how much of it is left, and reusing it here
 * was a category error.
 *
 * The bound that belongs here is proportional: however many rocks break beside
 * a word, that word keeps at least `SHOCKWAVE_MAX_LOSS` of the time it was
 * given. A mechanic that could starve a reader is not a difficulty, it is a
 * defect - so the floor is measured against the rock's ORIGINAL budget, which
 * is why the caller passes it and repeated kicks cannot compound past it.
 */

/** The least of its own budget a kicked rock may be left with. */
export const SHOCKWAVE_MAX_LOSS = 0.7;
export interface ShockwaveSpec {
  /** Multiplier on the disturbed rock's spin. 1 leaves it alone. */
  readonly spinBoost: number;
  /**
   * What the disturbed rock's REMAINING fall is multiplied by. Below 1 the
   * rock hurries; `hastenedRemainingMs` then refuses to go under the floor.
   */
  readonly hasteFactor: number;
  /** How near a rock has to be, in px, to feel it at all. */
  readonly reachPx: number;
}

/**
 * Only the bonus pair. A partial record on purpose: `shockwaveFor` returns null
 * for every stop on the main route, so the seven shipped belts are byte-for-byte
 * the game they were before this existed.
 *
 * Mercury is the harder of the two in both terms. It is the last stop on the
 * inner run and the closest to the sun, and it is the one the owner asked to be
 * especially intense.
 */
export const SHOCKWAVE_BY_STOP: Partial<Record<StopId, ShockwaveSpec>> = {
  venus: { spinBoost: 1.7, hasteFactor: 0.9, reachPx: 420 },
  mercury: { spinBoost: 2.6, hasteFactor: 0.78, reachPx: 560 },
};

export function shockwaveFor(stopId: StopId): ShockwaveSpec | null {
  return SHOCKWAVE_BY_STOP[stopId] ?? null;
}

/** True when `otherX,otherY` is inside the blast's reach of `x,y`. */
export function withinReach(
  spec: ShockwaveSpec,
  x: number,
  y: number,
  otherX: number,
  otherY: number,
): boolean {
  return Math.hypot(otherX - x, otherY - y) <= spec.reachPx;
}

/**
 * The rock's whole fall after a kick, in ms.
 *
 * Only the REMAINING part is compressed - a rock two thirds of the way down has
 * already spent most of its budget, and scaling the total would hurry it by an
 * amount that depends on when it happened to spawn. `baseFallMs` is the budget
 * it was born with, so N kicks in a row still cannot take more than
 * `SHOCKWAVE_MAX_LOSS` off it.
 */
export function hastenedFallMs(
  baseFallMs: number,
  currentFallMs: number,
  elapsedMs: number,
  spec: ShockwaveSpec,
): number {
  if (!Number.isFinite(currentFallMs) || !Number.isFinite(elapsedMs)) return currentFallMs;
  const remaining = currentFallMs - elapsedMs;
  if (remaining <= 0) return currentFallMs;
  const hurried = elapsedMs + remaining * spec.hasteFactor;
  return Math.max(baseFallMs * SHOCKWAVE_MAX_LOSS, Math.min(currentFallMs, hurried));
}

/** The spin after a kick. Sign is kept, so a rock never reverses. */
export function kickedSpinPerSec(spinPerSec: number, spec: ShockwaveSpec): number {
  if (!Number.isFinite(spinPerSec)) return 0;
  return spinPerSec * spec.spinBoost;
}
