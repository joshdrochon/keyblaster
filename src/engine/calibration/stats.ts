/**
 * Robust statistics for the pre-flight ritual (D51, PRD FR-11).
 *
 * Everything here is median-based, never mean-based. A 7-year-old who looks
 * away for one keystroke would drag a mean far enough to retune the entire
 * difficulty curve through FR-8's `keystrokeBudget = 1.5 x ikiMs`, and D18
 * says difficulty may only move as the player gets better - never because of
 * one distracted moment.
 */

/**
 * Ceiling on a single inter-key interval, ms.
 *
 * Anchored to FR-8 rather than guessed. Fall time is
 * `len * 1.5 * ikiMs + 1200 * ease`, clamped to MAX 14000 ms. For the
 * shortest word we would ever put on a rock (3 letters), any ikiMs above
 * `14000 / (3 * 1.5)` = 3111 ms cannot make a single asteroid fall any
 * slower - the clamp has already swallowed it. Past that point a larger
 * interval says nothing about the game, only that the child has stopped
 * typing. 3000 ms is that point, rounded down to a round number.
 *
 * Samples above the ceiling are CAPPED, not discarded. Discarding them would
 * delete exactly the evidence that a slow typist is slow, pull the median back
 * toward the fast 350 ms default, and hand that child a harder game - the
 * failure D18 and D31 exist to prevent. A cap keeps "slow" while bounding
 * "walked away", and the median already absorbs one or two capped samples.
 */
export const MAX_IKI_MS = 3000;

/**
 * Floor on a single inter-key interval, ms. 40 ms/key is roughly 300 WPM
 * sustained; no child produces that. A delta below it is key auto-repeat, a
 * duplicated event, or two records emitted in the same tick - not typing. Sub-
 * floor samples are DISCARDED rather than raised, because unlike the ceiling
 * there is no real player these could be describing.
 */
export const MIN_IKI_MS = 40;

/**
 * Ceiling on first-key latency, ms.
 *
 * D51 fixes the whole ritual at ~20 s across five or six words, i.e. about
 * 3.5 s per word including the typing itself. A single first-key latency past
 * 5 s means the child stopped looking at the screen, not that reading a short
 * high-frequency word was hard. Capped for the same reason as MAX_IKI_MS.
 */
export const MAX_FK_LATENCY_MS = 5000;

/**
 * Floor on first-key latency, ms. Simple visual reaction time bottoms out near
 * 200 ms even for adults; 80 ms is generous headroom. Anything faster means a
 * key was already down when the prompt appeared. Discarded, not raised.
 */
export const MIN_FK_LATENCY_MS = 80;

/** One measurement pass: what survived, and what had to be bent to survive. */
export interface BoundedSamples {
  /** Usable values, already clamped to the ceiling. */
  readonly values: readonly number[];
  /** How many were at or above the ceiling and got capped. */
  readonly capped: number;
  /** How many were dropped as non-physical (sub-floor, negative, non-finite). */
  readonly discarded: number;
}

/**
 * Apply the documented floor/ceiling policy to a raw sample run.
 * Cap above, discard below - see MAX_IKI_MS and MIN_IKI_MS for why the two
 * ends are treated differently.
 */
export function boundSamples(
  raw: Iterable<number>,
  floor: number,
  ceiling: number,
): BoundedSamples {
  const values: number[] = [];
  let capped = 0;
  let discarded = 0;
  for (const value of raw) {
    if (!Number.isFinite(value) || value < floor) {
      discarded += 1;
      continue;
    }
    if (value > ceiling) {
      values.push(ceiling);
      capped += 1;
      continue;
    }
    values.push(value);
  }
  return { values, capped, discarded };
}

/**
 * Median of a sample run, or null when there is nothing to measure.
 *
 * Null - not 0, not the default - because "no samples" is a different fact
 * from "measured zero", and only the caller knows which fallback applies
 * (computeCalibration falls back per field to DEFAULT_CALIBRATION).
 */
export function median(samples: readonly number[]): number | null {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return null;
  // Both parities in one path: for odd n the two indices coincide. n >= 1
  // here, so both indices are in range and the assertions cannot fire.
  const mid = (n - 1) / 2;
  const lo = sorted[Math.floor(mid)]!;
  const hi = sorted[Math.ceil(mid)]!;
  return (lo + hi) / 2;
}

/** Clamp, with non-finite input resolved to the low bound. */
export function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

/**
 * Round a millisecond figure to a whole ms and hold it inside the documented
 * bounds. Calibration is persisted and multiplied by 1.5 in FR-8; keeping it
 * an integer keeps stored profiles and test fixtures readable.
 */
export function settleMs(value: number, floor: number, ceiling: number): number {
  return Math.round(clamp(value, floor, ceiling));
}
