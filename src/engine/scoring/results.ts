import type { Profile, StopId, StopProgress, Stars, WordRecord } from "../types.js";
import { STOP_IDS, isBeltStop, stageIndexOf } from "../types.js";
import { firstFkLatency, median } from "../words/index.js";
import { accuracy, wpm } from "./rates.js";
import { meanOf } from "./stats.js";
import { HULL_HITS_PER_STAGE, starsForHullHits } from "./stars.js";

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
  /**
   * Fewer than `maxHull` for a cleared stage; reaching `maxHull` is a stall,
   * not a rating (D27, D29).
   */
  readonly hullHits: number;
  /**
   * The stage's hull capacity (`@engine/hull.hullForStage`). Optional, and it
   * defaults to D27's three: every caller written before the hull started
   * scaling with stage length keeps AC-4.4's exact 0/1/2 mapping without
   * changing a line.
   */
  readonly maxHull?: number;
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
  /** Median across the retained prior window; null on a first exposure. */
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
   * Mean of (this stage's median latency - FIRST-EVER-exposure latency) in ms,
   * over the retention words that have both. Negative means faster than the
   * first time the word was ever seen, which is the direction D50 wants to
   * show. Null when no retention word has a comparable pair.
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
 * The previous stage of the same profile (AC-20.1). Two rules, both load-
 * bearing, both learned the hard way:
 *
 * WHICH STOP. "Previous" is the nearest *belt* stop below this one that has
 * been cleared. Earth is excluded by `isBeltStop` even though it is cleared
 * first and sits at index 0: Earth is the launchpad, it has no belt (D57), it
 * is cleared by typing a single word (AC-12.1), and it therefore has no flight,
 * no WPM and no accuracy. Its stored figures are zeroes. Walking into them
 * hands the very first results screen a child ever sees a fabricated
 * "+60 WPM vs Earth", which is not a small cosmetic error - it is the results
 * screen lying about learning evidence on its first appearance. Mars correctly
 * has no previous stage, and correctly shows no delta.
 *
 * WHICH FIGURES. The delta is against that stop's LAST run (`lastWpm`,
 * `lastAccuracy`), not its all-time best. A best-based delta punishes normal
 * variance: a player who hits 70 WPM on Mars once, settles around 50, then runs
 * Jupiter at 60 is improving and would be shown "-10". Rendering steady
 * improvement as regression is the D31 failure mode, and it is worse than a
 * missing delta because it is confidently wrong. Bests still exist on
 * `StopProgress` and still drive trophies (D80); they are simply not what
 * "vs previous stage" means.
 */
export function previousStageProgress(
  profile: Profile,
  stopId: StopId,
): StopProgress | null {
  const index = stageIndexOf(stopId);
  const byStop = new Map<StopId, StopProgress>();
  for (const p of profile.progress) byStop.set(p.stopId, p);
  // An unknown stop gives index -1, so the loop simply never runs.
  for (let i = index - 1; i >= 0; i--) {
    // 0 <= i < index <= STOP_IDS.length - 1, so this lookup always lands; the
    // assertion is only to satisfy noUncheckedIndexedAccess.
    const earlier = STOP_IDS[i] as StopId;
    if (!isBeltStop(earlier)) continue;
    const progress = byStop.get(earlier);
    if (progress && progress.cleared) return progress;
  }
  return null;
}

/** A latency we are willing to divide by or subtract from. */
function usableLatency(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/**
 * AC-20.2 for one word.
 *
 * "Median first-key latency vs prior exposure" is read as: the median of the
 * samples taken this stage against the median of every retained sample taken
 * before it. Medians on both sides is the only reading under which the word
 * "median" does work - comparing a median to a single previous sample would
 * make the marker flicker on ordinary keystroke noise, and D50's marker is
 * supposed to be evidence of learning, not of one lucky keypress.
 *
 * The rolling window is the right baseline *here*, unlike AC-20.3: "faster than
 * before" means faster than recent form, and `words/pushCapped` keeps the
 * window recent on purpose.
 *
 * A word with no prior exposure, or with no usable sample this stage, is never
 * marked faster: there is nothing to have improved on. It returns nulls rather
 * than zeros so the screen can stay silent (D31).
 */
export function wordProgressMarker(exposure: WordExposure): WordProgressMarker {
  // words/median already discards non-finite samples, so neither side can be
  // NaN; `usableLatency` additionally rejects a zero or negative baseline
  // rather than dividing by it (AC-18.4, corrupt storage).
  const current = median(exposure.fkLatencyMs);
  const prior = median(exposure.prior?.fkLatencyMs ?? []);
  const base = usableLatency(prior);
  if (current === null || base === null) {
    return {
      word: exposure.word,
      faster: false,
      medianLatencyMs: current,
      priorMedianLatencyMs: prior,
      improvement: null,
    };
  }
  const improvement = (base - current) / base;
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
 * The comparison point is the FIRST EVER exposure, and it comes from
 * `firstFkLatency(record)` - never from `fkLatencyMs[0]`. The rolling window is
 * capped at `words/SAMPLE_CAP` and evicts oldest-first, so `fkLatencyMs[0]` is
 * the 21st-from-last sample once a word passes the cap, not its first exposure.
 * Retention words are by construction the high-exposure words (D21), so index 0
 * is wrong on exactly the words this line is about: a word first met at 2000 ms
 * and now typed at 590 ms reports about -10 ms through the window and about
 * -1410 ms through `firstFkLatencyMs`. The retention line is the single
 * headline learning-evidence claim in D50, and the window understates it by two
 * orders of magnitude.
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
    const current = median(e.fkLatencyMs);
    const first = usableLatency(
      e.prior === null ? null : firstFkLatency(e.prior),
    );
    if (current !== null && first !== null) deltas.push(current - first);
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
    wpmDelta: previous === null ? null : stageWpm - previous.lastWpm,
    accuracyDelta:
      previous === null ? null : stageAccuracy - previous.lastAccuracy,
    previousStopId: previous?.stopId ?? null,
    stars: starsForHullHits(tally.hullHits, tally.maxHull ?? HULL_HITS_PER_STAGE),
    words: exposures.map(wordProgressMarker),
    retention: retentionLine(exposures),
  };
}
