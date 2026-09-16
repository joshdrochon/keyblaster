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
