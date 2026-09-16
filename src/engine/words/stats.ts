/**
 * Small statistics helpers for the word model.
 *
 * Medians, not means, everywhere a player's timing is summarised: a 7-year-old
 * who looks away mid-word produces one enormous interval, and a mean would let
 * that single sample redefine their whole baseline (D51, D19).
 */

/**
 * Median of a sample set. Returns null for an empty set - never NaN.
 *
 * Non-finite samples are discarded before sorting. A comparator of (a-b) is
 * undefined for NaN, so a single NaN does not merely skew the result, it
 * corrupts the sort and poisons every downstream number. Corrupt storage is a
 * live path for this (AC-18.4), not a hypothetical.
 */
export function median(values: readonly number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Keep the most recent `n` samples. Per-word history is unbounded otherwise,
 * and a word typed 200 times would let ancient samples outvote current skill.
 */
export function pushCapped(samples: number[], value: number, cap: number): number[] {
  const next = [...samples, value];
  return next.length > cap ? next.slice(next.length - cap) : next;
}
