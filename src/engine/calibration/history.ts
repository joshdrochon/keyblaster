import {
  DEFAULT_CALIBRATION,
  type Calibration,
  type Profile,
  type WordRecord,
} from "../types.js";
import {
  MAX_FK_LATENCY_MS,
  MAX_IKI_MS,
  MIN_FK_LATENCY_MS,
  MIN_IKI_MS,
  boundSamples,
  clamp,
  median,
  settleMs,
} from "./stats.js";

/**
 * The returning-player half of D51: "Returning players calibrated by history."
 *
 * Two things live here. `needsCalibration` decides whether the ritual runs at
 * all (AC-11.2), and `refineCalibration` / `calibrationFromHistory` keep a
 * returning player's baseline current from ordinary play, so the ~20 s ritual
 * is a once-per-profile event rather than a recurring toll.
 */

/**
 * The slice of a Profile these predicates read. Narrow on purpose: nothing
 * here needs a name, an avatar or a ship, so persistence/ and the scenes can
 * pass anything profile-shaped.
 */
export type CalibratableProfile = Pick<
  Profile,
  "calibration" | "words" | "progress"
>;

/**
 * How much smoothing a stage of play applies to the stored baseline.
 *
 * `next = (1 - alpha) * stored + alpha * median(this stage's samples)`.
 *
 * Two layers of defence, for two different failure modes. The inner median
 * kills outliers *within* a stage (a pause to scratch an ear). The outer
 * exponential weight limits how far any single stage can move the baseline,
 * which kills outliers *across* stages (a little brother grabbing the keyboard
 * for one belt). At alpha 0.2 the half-life is ln(0.5)/ln(0.8) = 3.1 stages:
 * a child who genuinely got faster has their new speed mostly reflected inside
 * one trip out to Pluto (six belts, D57), while one bad stage can never move
 * difficulty by more than a fifth of the gap. FR-8 multiplies ikiMs by 1.5 to
 * set fall time, so a jumpy baseline is felt immediately - hence the caution.
 *
 * Known artifact: because the baseline is rounded to whole milliseconds, the
 * fold has a dead zone of about `1 / (2 * alpha)` = 2.5 ms around the true
 * value, where the rounded step lands back on itself and stops moving. At
 * FR-8's 1.5x that is under 4 ms of fall time on a 2.5-14 s drop - below
 * anything a child can perceive, and cheaper than carrying fractional
 * milliseconds through persistence.
 */
export const REFINE_ALPHA = 0.2;

/**
 * How many recent samples per measure `calibrationFromHistory` pools.
 *
 * FR-10's controller reasons over the last 20 spawn outcomes; 50 keystroke
 * samples is a little more than two stages of play. Recent enough that a child
 * who got faster last week is not still being timed as they were last month,
 * long enough that the median has something to stand on.
 */
export const HISTORY_SAMPLE_WINDOW = 50;

/** Every word record on a profile, across all content languages. */
function allRecords(profile: CalibratableProfile): WordRecord[] {
  const out: WordRecord[] = [];
  for (const byWord of Object.values(profile.words)) {
    out.push(...Object.values(byWord));
  }
  return out;
}

/**
 * Has this profile ever typed anything the engine could learn from?
 *
 * This is the whole of D51's "history". Exposures, stored keystroke samples
 * and cleared stops all count; a profile that has only been named and given an
 * avatar has none of them.
 */
export function hasTypingHistory(profile: CalibratableProfile): boolean {
  for (const record of allRecords(profile)) {
    if (
      record.exposures > 0 ||
      record.ikiMs.length > 0 ||
      record.fkLatencyMs.length > 0
    ) {
      return true;
    }
  }
  for (const stop of profile.progress) {
    if (stop.cleared || stop.bestWpm > 0) return true;
  }
  return false;
}

/** True when the stored baseline is still the untouched FR-8 default. */
export function isDefaultCalibration(calibration: Calibration): boolean {
  return (
    calibration.ikiMs === DEFAULT_CALIBRATION.ikiMs &&
    calibration.fkLatencyMs === DEFAULT_CALIBRATION.fkLatencyMs
  );
}

/**
 * AC-11.2: the ritual runs on new profiles only.
 *
 * types.ts carries no "calibrated" flag and is not ours to edit, so newness is
 * derived from the two facts that define it: the profile has no history to be
 * calibrated by (D51), and its baseline is still the shipped default. Both
 * must hold. A returning player is skipped on the first clause; a new player
 * who has just finished the ritual is skipped on the second.
 *
 * The one collision is a child whose measured medians land on exactly 350/500,
 * who would be offered the ritual once more. That costs them twenty seconds of
 * Shadow talking, which AC-11.3 says reads as story anyway - a cheaper failure
 * than a stray flag that gets out of sync with the numbers it guards.
 */
export function needsCalibration(profile: CalibratableProfile): boolean {
  return !hasTypingHistory(profile) && isDefaultCalibration(profile.calibration);
}

/** Raw timings observed during ordinary play, handed over by the scene. */
export interface ObservedTimings {
  readonly ikiMs?: readonly number[];
  readonly fkLatencyMs?: readonly number[];
}

function fold(
  stored: number,
  samples: readonly number[] | undefined,
  alpha: number,
  floor: number,
  ceiling: number,
): number {
  const bounded = boundSamples(samples ?? [], floor, ceiling);
  const observed = median(bounded.values);
  if (observed === null) return settleMs(stored, floor, ceiling);
  return settleMs((1 - alpha) * stored + alpha * observed, floor, ceiling);
}

/**
 * Fold a stage's observed timings into the stored baseline (D51).
 *
 * Median-of-batch, then exponential smoothing - see REFINE_ALPHA for why both.
 * A measure with no usable samples is left exactly as it was, so a stage where
 * the child only blasted three-letter words does not reset their latency.
 */
export function refineCalibration(
  current: Calibration,
  observed: ObservedTimings,
  alpha: number = REFINE_ALPHA,
): Calibration {
  const a = Number.isFinite(alpha) ? clamp(alpha, 0, 1) : REFINE_ALPHA;
  return {
    ikiMs: fold(current.ikiMs, observed.ikiMs, a, MIN_IKI_MS, MAX_IKI_MS),
    fkLatencyMs: fold(
      current.fkLatencyMs,
      observed.fkLatencyMs,
      a,
      MIN_FK_LATENCY_MS,
      MAX_FK_LATENCY_MS,
    ),
  };
}

/** Newest-first sample walk across records, stopping at `window` values. */
function recentSamples(
  records: readonly WordRecord[],
  pick: (record: WordRecord) => readonly number[],
  window: number,
): number[] {
  const out: number[] = [];
  for (const record of records) {
    const samples = pick(record);
    // WordRecord arrays are documented "newest last" (types.ts), so walk back.
    for (let i = samples.length - 1; i >= 0 && out.length < window; i -= 1) {
      out.push(samples[i]!);
    }
    if (out.length >= window) break;
  }
  return out;
}

export interface HistoryOptions {
  /** Restrict to one content language. Default: pool all of them. */
  readonly lang?: string;
  /** Override the sample window. Default HISTORY_SAMPLE_WINDOW. */
  readonly window?: number;
}

/**
 * Rebuild a baseline from stored per-word history (D51), for a returning
 * player who never ran the ritual - or whose stored baseline was lost to a
 * schema migration.
 *
 * Words are visited most-recently-seen first, and each contributes its newest
 * samples, so the window is genuinely recent play and not whichever word
 * happens to sort first. Medians again, and each measure falls back to the
 * profile's current value when history has nothing to say.
 */
export function calibrationFromHistory(
  profile: CalibratableProfile,
  options: HistoryOptions = {},
): Calibration {
  const window = options.window ?? HISTORY_SAMPLE_WINDOW;
  const records: WordRecord[] = [];
  for (const [lang, byWord] of Object.entries(profile.words)) {
    if (options.lang !== undefined && options.lang !== lang) continue;
    records.push(...Object.values(byWord));
  }
  // Never-seen words sort last; they carry no samples anyway.
  records.sort((a, b) => (b.lastSeen ?? -Infinity) - (a.lastSeen ?? -Infinity));

  const iki = boundSamples(
    recentSamples(records, (r) => r.ikiMs, window),
    MIN_IKI_MS,
    MAX_IKI_MS,
  );
  const fk = boundSamples(
    recentSamples(records, (r) => r.fkLatencyMs, window),
    MIN_FK_LATENCY_MS,
    MAX_FK_LATENCY_MS,
  );

  const ikiMedian = median(iki.values);
  const fkMedian = median(fk.values);

  return {
    ikiMs:
      ikiMedian === null
        ? profile.calibration.ikiMs
        : settleMs(ikiMedian, MIN_IKI_MS, MAX_IKI_MS),
    fkLatencyMs:
      fkMedian === null
        ? profile.calibration.fkLatencyMs
        : settleMs(fkMedian, MIN_FK_LATENCY_MS, MAX_FK_LATENCY_MS),
  };
}
