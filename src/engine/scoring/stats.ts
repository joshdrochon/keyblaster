/**
 * Small numeric helpers shared by the scoring module.
 *
 * These live here rather than inline because every AC-20 computation reads
 * "median first-key latency" and must read it the same way (D50).
 */

/**
 * Median of a sample set. Returns null for an empty set rather than 0 or NaN:
 * "no data yet" is a distinct state from "0 ms", and the results screen has to
 * be able to say nothing instead of saying something false (D50).
 *
 * Even-sized sets average the two middle samples, which is the conventional
 * definition and keeps `medianOf([a, b])` monotone in both samples.
 */
export function medianOf(samples: readonly number[]): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  // Both lookups are in range because length > 0; the assertions exist only to
  // satisfy noUncheckedIndexedAccess, not to paper over a real miss.
  const hi = sorted[mid] as number;
  if (sorted.length % 2 === 1) return hi;
  const lo = sorted[mid - 1] as number;
  return (lo + hi) / 2;
}

/** Arithmetic mean, or null for an empty set (same "no data" contract). */
export function meanOf(samples: readonly number[]): number | null {
  if (samples.length === 0) return null;
  let total = 0;
  for (const s of samples) total += s;
  return total / samples.length;
}
