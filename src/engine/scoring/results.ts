import type { Profile, StopId, StopProgress, Stars, WordRecord } from "../types.js";
import { STOP_IDS, stageIndexOf } from "../types.js";
import { accuracy, wpm } from "./rates.js";
import { meanOf, medianOf } from "./stats.js";
import { starsForHullHits } from "./stars.js";

/**
 * The results screen (D50, PRD section 3.8, AC-20.1 .. AC-20.4).
 *
 * Everything here is a pure function of data handed in. The module never reads
 * a clock, storage or the DOM: the caller passes the stage tally, the per-word
 * exposures for this stage, and the profile as it stood *before* this stage was
 * written back. That last part matters - a delta against a profile that already
 * absorbed this stage is a delta against itself.
 *
 * D31 governs the shape of the output: accuracy is reported, typos feed the
 * engine, and nothing in the returned object is a failure score. Where there is
 * no data (first stage, first exposure, no retention words) the answer is
 * `null`, meaning "nothing to say yet" - never 0, which on a results screen
 * reads as a verdict.
 */

/** AC-20.2: a word counts as faster when its median latency improves >= 15%. */
export const FASTER_IMPROVEMENT_THRESHOLD = 0.15;

/** Raw stage counters the flight scene hands over at stage end. */
export interface StageTally {
  /** Characters typed correctly this stage; feeds WPM. */
  readonly characters: number;
  readonly elapsedMs: number;
  readonly hits: number;
  /** Counted for the engine only; never surfaced as a score (D31). */
  readonly typos: number;
  /** 0..2 for a cleared stage; 3 is a stall, not a rating (D27, D29). */
  readonly hullHits: number;
}

/**
 * One word as it was encountered during this stage.
 *
 * `prior` is that word's `WordRecord` from *before* this stage - null if the
 * stage was its first ever exposure. Keeping the before-state explicit is what
 * lets AC-20.2 and AC-20.3 be pure: we never have to guess which of the samples
 * in a merged record belong to the stage just played.
 */
export interface WordExposure {
  readonly word: string;
  /** First-key latency samples recorded for this word this stage. */
  readonly fkLatencyMs: readonly number[];
  /** True if the word was completed rather than reaching the breach line. */
  readonly hit: boolean;
  /** True if this was a retention interleave from an earlier stop (D21). */
  readonly retention: boolean;
  readonly prior: WordRecord | null;
}

/** AC-20.2 output, one per word seen this stage. */
export interface WordProgressMarker {
  readonly word: string;
  /** AC-20.2: median first-key latency improved >= 15% vs prior exposure. */
  readonly faster: boolean;
  /** Median of this stage's samples; null if the word yielded no sample. */
  readonly medianLatencyMs: number | null;
  /** Median across all prior exposures; null on a word's first exposure. */
  readonly priorMedianLatencyMs: number | null;
  /**
   * Fractional improvement, e.g. 0.2 for 20% faster. Null when either side is
   * missing. Negative simply means slower this time; it is a measurement, and
   * the results screen renders a marker only when `faster` is true, so a slower
   * word shows nothing rather than showing a penalty (D31).
   */
  readonly improvement: number | null;
}

/** AC-20.3 output: one line about the retention words in this stage. */
export interface RetentionLine {
  /** Retention words encountered this stage. 0 before the interleave starts. */
  readonly wordCount: number;
  /** Fraction of those words hit, in [0, 1]. Null when wordCount is 0. */
  readonly hitRate: number | null;
  /**
   * Mean of (this stage's median latency - first-exposure latency) in ms, over
   * the retention words that have both. Negative means faster than the first
   * time the word was ever seen, which is the direction D50 wants to show.
   * Null when no retention word has a comparable pair.
   */
  readonly meanLatencyDeltaMs: number | null;
}

/** AC-20.1 + AC-20.4, plus the per-word and retention lines. */
export interface StageResults {
  readonly stopId: StopId;
  readonly wpm: number;
  readonly accuracy: number;
  /** AC-20.1: delta vs the previous stage, or null if there is no previous. */
  readonly wpmDelta: number | null;
  readonly accuracyDelta: number | null;
  readonly previousStopId: StopId | null;
  /** AC-20.4, via AC-4.4. */
  readonly stars: Stars;
  readonly words: readonly WordProgressMarker[];
  readonly retention: RetentionLine;
}

export interface StageResultsInput {
  readonly stopId: StopId;
  readonly tally: StageTally;
  readonly exposures: readonly WordExposure[];
  /** The profile BEFORE this stage is written back. */
  readonly profile: Profile;
}

/**
 * The previous stage of the same profile (AC-20.1).
 *
 * "Previous" is the nearest *cleared* stop below this one, not literally
 * `index - 1`. Earth is the launchpad and has no belt (D57), so a strict
 * index - 1 would leave Mars permanently without a delta, and a stop replayed
 * out of order would compare against an empty row. Walking down to the nearest
 * cleared stop gives Mars a delta as soon as there is anything to compare to
 * and degrades to null only when the profile genuinely has no earlier stage.
 */
export function previousStageProgress(
  profile: Profile,
  stopId: StopId,
): StopProgress | null {
  const index = stageIndexOf(stopId);
  if (index < 0) return null;
  const byStop = new Map<StopId, StopProgress>();
  for (const p of profile.progress) byStop.set(p.stopId, p);
  for (let i = index - 1; i >= 0; i--) {
    const earlier = indexToStop(i);
    if (earlier === null) continue;
    const progress = byStop.get(earlier);
    if (progress && progress.cleared) return progress;
  }
  return null;
}

/** Inverse of stageIndexOf. noUncheckedIndexedAccess makes the miss explicit. */
function indexToStop(index: number): StopId | null {
  return STOP_IDS[index] ?? null;
}

/**
 * AC-20.2 for one word.
 *
 * "Median first-key latency vs prior exposure" is read as: the median of the
 * samples taken this stage against the median of every sample taken before it.
 * Medians on both sides is the only reading under which the word "median"
 * does work - comparing a median to a single previous sample would make the
 * marker flicker on ordinary keystroke noise, and D50's marker is supposed to
 * be evidence of learning, not of one lucky keypress.
 *
 * A word with no prior exposure, or with no sample this stage, is never marked
 * faster: there is nothing to have improved on. It returns nulls rather than
 * zeros so the screen can stay silent (D31).
 */
export function wordProgressMarker(exposure: WordExposure): WordProgressMarker {
  const current = medianOf(exposure.fkLatencyMs);
  const prior = medianOf(exposure.prior?.fkLatencyMs ?? []);
  if (current === null || prior === null || prior <= 0) {
    return {
      word: exposure.word,
      faster: false,
      medianLatencyMs: current,
      priorMedianLatencyMs: prior,
      improvement: null,
    };
  }
  const improvement = (prior - current) / prior;
  return {
    word: exposure.word,
    faster: improvement >= FASTER_IMPROVEMENT_THRESHOLD,
    medianLatencyMs: current,
    priorMedianLatencyMs: prior,
    improvement,
  };
}

/**
 * AC-20.3.
 *
 * The comparison point is the FIRST ever exposure, not the previous one: the
 * retention line is the delayed-retest evidence (D21, D50, Bjork), and its
 * claim is "these words are faster than when you met them", which only holds
 * against sample zero. `WordRecord.fkLatencyMs` is newest-last, so sample zero
 * is `fkLatencyMs[0]`.
 */
export function retentionLine(
  exposures: readonly WordExposure[],
): RetentionLine {
  const retention = exposures.filter((e) => e.retention);
  if (retention.length === 0) {
    return { wordCount: 0, hitRate: null, meanLatencyDeltaMs: null };
  }
  let hits = 0;
  const deltas: number[] = [];
  for (const e of retention) {
    if (e.hit) hits++;
    const current = medianOf(e.fkLatencyMs);
    const first = e.prior?.fkLatencyMs[0];
    if (current !== null && first !== undefined) deltas.push(current - first);
  }
  return {
    wordCount: retention.length,
    hitRate: hits / retention.length,
    meanLatencyDeltaMs: meanOf(deltas),
  };
}

/** AC-20.1 through AC-20.4, assembled. */
export function computeStageResults(input: StageResultsInput): StageResults {
  const { stopId, tally, exposures, profile } = input;
  const stageWpm = wpm(tally.characters, tally.elapsedMs);
  const stageAccuracy = accuracy(tally.hits, tally.typos);
  const previous = previousStageProgress(profile, stopId);
  return {
    stopId,
    wpm: stageWpm,
    accuracy: stageAccuracy,
    wpmDelta: previous === null ? null : stageWpm - previous.bestWpm,
    accuracyDelta:
      previous === null ? null : stageAccuracy - previous.bestAccuracy,
    previousStopId: previous?.stopId ?? null,
    stars: starsForHullHits(tally.hullHits),
    words: exposures.map(wordProgressMarker),
    retention: retentionLine(exposures),
  };
}
