/**
 * The one statistic this module needs that the word model does not already
 * provide.
 *
 * Medians come from `words/stats.ts` (exported as `median` from
 * `words/index.js`) and are NOT re-implemented here. That file is already
 * NaN-hardened, and two medians in one engine is two places for the definition
 * of "median first-key latency" to drift.
 */

/**
 * Arithmetic mean, or null for an empty set. Non-finite samples are discarded
 * before summing, for the same reason `words/median` discards them: corrupt
 * storage is a live path (AC-18.4), and one NaN in a sum poisons every number
 * downstream of it, including one typed `number | null`.
 *
 * A mean is the right summary here and a median is not: AC-20.3 asks for the
 * *mean* latency delta across the retention set, which is an aggregate over
 * words rather than over one child's noisy keystrokes.
 */
export function meanOf(samples: readonly number[]): number | null {
  const clean = samples.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return null;
  let total = 0;
  for (const s of clean) total += s;
  return total / clean.length;
}
