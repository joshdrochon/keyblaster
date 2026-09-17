/**
 * Difficulty knobs (D20, D53, PRD FR-10, architecture section 4.3).
 *
 * D20 fixes the working rule: one knob per stage. D53 fixes which knobs exist
 * and in which order they move. This file owns the knob *values* and the step
 * ordering; index.ts owns when a step is allowed to happen.
 *
 * AC-10.4 is a statement about this file: the set of knobs is exactly
 * {maxLive, lengthBias}. World scroll speed is constant per stage and is
 * deliberately absent, so no code path can ever reach for it.
 */

/** Word-length mix bias (PRD FR-10: "-1/0/+1"). */
export type LengthBias = -1 | 0 | 1;

/** Max simultaneous asteroids. PRD FR-10 range 2-7 inclusive. */
export const MAX_LIVE_MIN = 2;
export const MAX_LIVE_MAX = 7;

export const LENGTH_BIAS_MIN: LengthBias = -1;
export const LENGTH_BIAS_MAX: LengthBias = 1;

/**
 * The complete knob set. Adding a field here is a spec change: AC-10.4 asserts
 * this shape, so a scroll-speed knob cannot be introduced without failing a
 * test that names the AC.
 */
export interface Knobs {
  /** Primary knob (D53): max simultaneous asteroids. */
  readonly maxLive: number;
  /** Secondary knob (D53): word-length mix bias. */
  readonly lengthBias: LengthBias;
}

export type KnobName = keyof Knobs;

/** Exhaustive, ordered knob list. AC-10.4 compares against this literal. */
export const KNOB_NAMES: readonly KnobName[] = ["maxLive", "lengthBias"] as const;

/**
 * Cold start (D18): difficulty increases only as the player gets better, so a
 * fresh profile starts at the gentlest simultaneous-asteroid count and a
 * neutral length mix. The warm-up wave, not the controller, carries the first
 * impression.
 */
export const DEFAULT_KNOBS: Knobs = {
  maxLive: MAX_LIVE_MIN,
  lengthBias: 0,
};

// ---------------------------------------------------------------------------
// What `maxLive` actually BUYS (UR-42, UR-51)
// ---------------------------------------------------------------------------

/**
 * How many word-asteroids the belt INTENDS to hold answerable at once, at this
 * setting of the primary knob.
 *
 * ================== WHY THIS EXISTS ==================
 * `maxLive` was a ceiling nothing reached. `gauntlet/evidence/belt-survivability.json`
 * recorded `peakLive: 2` at maxLive 7 exactly as at maxLive 2, over 40 seeds and
 * three player speeds, and the time-weighted occupancy was 1.00-1.04 rocks at
 * both ends. A knob whose two extremes are indistinguishable is not a
 * difficulty range, and UR-51 is the report that says so.
 *
 * THE CONSTRAINT THE KNOB COULD NOT SEE. A player is a single server (AC-2.1
 * gives every live word a distinct first letter so the lock is unambiguous), so
 * a board holding N rocks is a board where the last one WAITS N-1 service times
 * before anyone can touch it - and it falls the whole time. By Little's law a
 * belt running at the player's own throughput holds N rocks only if each rock
 * lives N service times, so N is bounded by
 *
 *     N  <=  fallTimeMs / expectedClearMs
 *
 * At FR-8's shipped budget that ratio is 1.18 (fast), 1.25 (median) and 1.38
 * (grade-2) - one, at every pilot speed, in every shipped pool. Raising
 * `maxLive` could not put a second answerable rock on the board because FR-8's
 * fall budget bound first. That is UR-42; UR-51 is the decision taken on it -
 * widen the budget, and make the knob express the range.
 *
 * ================== SO THE KNOB NOW MEANS A DEPTH ==================
 * This is the one number both halves read. `@engine/fallTime` scales FR-8's
 * budget by it, so a rock granted a place in a 4-deep queue is granted the fall
 * time to survive the queue; `@engine/pacing` holds that many rocks' worth of
 * work standing on the board, so the queue is actually built. Neither half is
 * meaningful without the other: budget without pacing is a slower game, pacing
 * without budget is the P0a stall defect.
 *
 * ================== THE FLOOR IS EXACTLY 1, AND THAT IS THE SAFETY ==========
 * At `MAX_LIVE_MIN` this returns 1, so the fall-budget scale is x1 and the
 * pacing allowance is zero: the belt a struggling child flies is BIT-IDENTICAL
 * to the one measured at 3 stalls in 240 route-belts. The hard constraint on
 * UR-51 - harder for a fast typist, not unsurvivable for a grade-2 child - is
 * therefore a property of this function's floor rather than a hope about a
 * simulation. `tests/unit/controller/controller.test.ts` pins it.
 */
export const CONCURRENCY_TARGET_MIN = 1;

/**
 * Depth at `MAX_LIVE_MAX`. Four, per UR-51, and because the fall budget it
 * implies still clears `expectedClearMs` for the grade-2 pilot with margin -
 * measured, in gauntlet/evidence/belt-concurrency.json, not assumed.
 */
export const CONCURRENCY_TARGET_MAX = 4;

/**
 * Intended board depth for a knob setting, interpolated across FR-10's 2..7.
 *
 * Continuous rather than integral on purpose: the knob moves one step per stage
 * (D20, AC-10.1) and a depth that jumped a whole rock every step would make one
 * stage boundary in three a cliff. A fractional target moves the fall budget and
 * the standing allowance smoothly, and the board's own integer depth falls out.
 *
 *     maxLive  2    3    4    5    6    7
 *     target   1.0  1.6  2.2  2.8  3.4  4.0
 */
export function concurrencyTarget(maxLive: number): number {
  const span = MAX_LIVE_MAX - MAX_LIVE_MIN;
  // A corrupt knob reads as the floor rather than as NaN: a restored profile
  // must never be able to stop a child's game (clampKnobs, same rule).
  const live = Number.isFinite(maxLive) ? Math.floor(maxLive) : MAX_LIVE_MIN;
  const steps = Math.min(span, Math.max(0, live - MAX_LIVE_MIN));
  return (
    CONCURRENCY_TARGET_MIN +
    (steps / span) * (CONCURRENCY_TARGET_MAX - CONCURRENCY_TARGET_MIN)
  );
}

/** A single knob move. AC-10.1: at most one of these per stage, ever. */
export interface KnobChange {
  readonly knob: KnobName;
  readonly from: number;
  readonly to: number;
}

function clampInt(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(value)));
}

/** Narrow an arbitrary number onto the LengthBias union, clamping to bounds. */
export function asLengthBias(value: number): LengthBias {
  const n = clampInt(value, LENGTH_BIAS_MIN, LENGTH_BIAS_MAX);
  return n === -1 || n === 1 ? n : 0;
}

/**
 * Force a knob pair into range. Callers may hand us persisted values from an
 * older schema version; we clamp rather than throw, because a corrupt knob
 * must never stop a child's game (CLAUDE.md, same spirit as AC-13.1 prod mode).
 */
export function clampKnobs(knobs: Knobs): Knobs {
  return {
    maxLive: clampInt(knobs.maxLive, MAX_LIVE_MIN, MAX_LIVE_MAX),
    lengthBias: asLengthBias(knobs.lengthBias),
  };
}

/**
 * Next tighten step, or null when both knobs are already at their hard cap.
 *
 * Order is fixed by D53/architecture 4.3: maxLive +1 (cap 7), else
 * lengthBias +1 (cap +1). Primary first, secondary only when the primary is at
 * its bound (PRD FR-10: "knob choice alternates primary -> secondary when
 * primary is at its bound").
 */
export function tightenStep(knobs: Knobs): KnobChange | null {
  const k = clampKnobs(knobs);
  if (k.maxLive < MAX_LIVE_MAX) {
    return { knob: "maxLive", from: k.maxLive, to: k.maxLive + 1 };
  }
  if (k.lengthBias < LENGTH_BIAS_MAX) {
    return { knob: "lengthBias", from: k.lengthBias, to: k.lengthBias + 1 };
  }
  return null;
}

/**
 * Next loosen step, or null when both knobs are already at their hard floor.
 *
 * Order is deliberately the mirror image, not the reverse, of tightenStep:
 * lengthBias -1 (floor -1), else maxLive -1 (floor 2). Shorter words are the
 * cheapest relief to give, and giving it first means a struggling player keeps
 * the asteroid count they have already learned to track.
 *
 * The asymmetry is load-bearing: it makes lengthBias ratchet down to its floor
 * and stay there, so maxLive ends up carrying the steady-state control. That is
 * what D53 means by calling maxLive the primary knob.
 */
export function loosenStep(knobs: Knobs): KnobChange | null {
  const k = clampKnobs(knobs);
  if (k.lengthBias > LENGTH_BIAS_MIN) {
    return { knob: "lengthBias", from: k.lengthBias, to: k.lengthBias - 1 };
  }
  if (k.maxLive > MAX_LIVE_MIN) {
    return { knob: "maxLive", from: k.maxLive, to: k.maxLive - 1 };
  }
  return null;
}

/** Apply a step. `null` is the hold case and returns the knobs untouched. */
export function applyChange(knobs: Knobs, change: KnobChange | null): Knobs {
  const k = clampKnobs(knobs);
  if (change === null) return k;
  return change.knob === "maxLive"
    ? { maxLive: clampInt(change.to, MAX_LIVE_MIN, MAX_LIVE_MAX), lengthBias: k.lengthBias }
    : { maxLive: k.maxLive, lengthBias: asLengthBias(change.to) };
}

/** How many knob fields differ. AC-10.1 asserts this is never greater than 1. */
export function knobsDiffCount(a: Knobs, b: Knobs): number {
  let n = 0;
  if (a.maxLive !== b.maxLive) n += 1;
  if (a.lengthBias !== b.lengthBias) n += 1;
  return n;
}
