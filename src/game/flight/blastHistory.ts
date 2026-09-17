import { normalizeWord } from "@engine/allowlist/index.js";
import type { ObservedTimings } from "@engine/calibration/index.js";
import { DEFAULT_CALIBRATION, type Calibration } from "@engine/types.js";

/**
 * BLAST HISTORY - what the player actually shot down, in order (D09).
 *
 * D09 is the founding differentiator: "Asteroid words come from the current
 * stage's story text. The end-of-stage sentence is built from the words the
 * player just blasted." The decision log's Origin section names the specific
 * defect in Type Storm that this fixes - the end-of-level sentence there does
 * not reuse the words just typed.
 *
 * Before this module existed, `WarpScene` highlighted the stop's WHOLE POOL.
 * That is a claim about the content file, not about the run: a word the child
 * missed was highlighted exactly like a word they hit, which is the same
 * non-relationship Type Storm has. The fix is not "pass the pool more
 * carefully" - it is to record the run and highlight from the record.
 *
 * WHAT IS RECORDED. One entry per RESOLUTION, in resolution order:
 *   - a blast, with the word, its position in the run, when it happened, and
 *     the timings the lock machine measured (first-key latency, inter-key
 *     intervals). The timings are what make "slow" answerable without a second
 *     pass over the word book.
 *   - a miss, with the word and when it crossed the breach line.
 *
 * WHERE THIS BELONGS. `src/engine`, next to `words/` - it is a pure fold over
 * plain data with no Phaser, no DOM, no clock and no randomness. It is here
 * because this change may not add an engine module; lifting the file into
 * `src/engine/run/` is a move plus an import rewrite and nothing else changes.
 * Flagged to the lead as an engine gap, with `flight/shield.ts`.
 *
 * NOTHING HERE IS A SCORE. A miss is a fact about which words to bring back,
 * never a penalty (D31, AC-22b.1). `hitRate` exists because the coach request
 * (FR-15) takes one, and it is never displayed.
 */

/** One word the player shot down. */
export interface BlastEvent {
  /** The word as it was typed and as the plate showed it. */
  readonly word: string;
  /** 0-based position in the run. The Nth thing the player blasted. */
  readonly order: number;
  /** Clock reading at the blast. Same origin as `performance.now()`. */
  readonly atMs: number;
  /** Lock-machine measurement: time from spawn-visible to the first key. */
  readonly fkLatencyMs: number;
  /** Lock-machine measurement: gaps between successive keystrokes. */
  readonly ikiMs: readonly number[];
  /** Shield canisters are blasted like any rock and count like any rock. */
  readonly wasCanister: boolean;
}

/** One word that crossed the breach line. */
export interface MissEvent {
  readonly word: string;
  readonly atMs: number;
}

/** The whole run, in order. Immutable; every writer returns a new value. */
export interface BlastHistory {
  readonly blasts: readonly BlastEvent[];
  readonly misses: readonly MissEvent[];
}

export const EMPTY_HISTORY: BlastHistory = { blasts: [], misses: [] };

export function emptyHistory(): BlastHistory {
  return EMPTY_HISTORY;
}

/** What `recordBlast` needs; `order` is assigned by the history, not the caller. */
export type BlastInput = Omit<BlastEvent, "order">;

export function recordBlast(history: BlastHistory, blast: BlastInput): BlastHistory {
  return {
    blasts: [...history.blasts, { ...blast, order: history.blasts.length }],
    misses: history.misses,
  };
}

export function recordMiss(history: BlastHistory, miss: MissEvent): BlastHistory {
  return { blasts: history.blasts, misses: [...history.misses, miss] };
}

/**
 * The words the player blasted, in blast order, each once.
 *
 * De-duplicated on the normalised form, because the same word can be served
 * twice in a stage (a retention probe, a catch word) and the warp sentence
 * highlights a WORD, not an occurrence. First blast wins the position: the
 * order the child earned it in is the order that is true.
 */
export function blastedWords(history: BlastHistory): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const blast of history.blasts) {
    const key = normalizeWord(blast.word);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(blast.word);
  }
  return out;
}

/**
 * Words that got past the ship and were NOT blasted anywhere else in the run.
 *
 * A word served twice, missed once and hit once, is not a word the child let
 * through - they can type it. This is what Shadow names (AC-15.5), so naming
 * a word they demonstrably hit would be wrong on its own terms.
 */
export function missedWords(history: BlastHistory): readonly string[] {
  const hit = new Set(history.blasts.map((b) => normalizeWord(b.word)));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const miss of history.misses) {
    const key = normalizeWord(miss.word);
    if (key.length === 0 || hit.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(miss.word);
  }
  return out;
}

/**
 * How long the player took over each keystroke of a blasted word, in ms.
 *
 * The mean of the inter-key intervals, ignoring the first-key latency: that
 * one measures reading the word, which `fallTime` already budgets separately
 * (D19). A single-letter word has no intervals and is never "slow".
 */
export function meanIkiMs(blast: BlastEvent): number | null {
  if (blast.ikiMs.length === 0) return null;
  const total = blast.ikiMs.reduce((sum, ms) => sum + ms, 0);
  return total / blast.ikiMs.length;
}

/** Words typed correctly but slowly, relative to this player's own median. */
export const SLOW_FACTOR = 1.5;

/**
 * "Slow" is measured against the PLAYER, not against a table.
 *
 * `calibration.ikiMs` is this child's own median inter-key interval, measured
 * in the pre-flight ritual (FR-11). A word they typed at 1.5x their own pace
 * is one they had to think about; a fast typist and a slow typist therefore
 * get the same kind of note about the same kind of word, which is the whole
 * point of calibrating at all.
 */
export function slowWords(
  history: BlastHistory,
  calibration: Calibration = DEFAULT_CALIBRATION,
  factor: number = SLOW_FACTOR,
): readonly string[] {
  const threshold = calibration.ikiMs * factor;
  const missed = new Set(missedWords(history).map((w) => normalizeWord(w)));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const blast of history.blasts) {
    const mean = meanIkiMs(blast);
    if (mean === null || mean <= threshold) continue;
    const key = normalizeWord(blast.word);
    // A word already named as missed must not be named twice: the coach note
    // reads as one list to a child, not as two categories.
    if (key.length === 0 || missed.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(blast.word);
  }
  return out;
}

/**
 * Fraction of resolutions that were blasts, in [0, 1]. A run with nothing in
 * it is 1: no word got past the ship, because no word was served.
 */
export function hitRateOf(history: BlastHistory): number {
  const total = history.blasts.length + history.misses.length;
  if (total === 0) return 1;
  return history.blasts.length / total;
}

/** Everything the warp break needs from a finished stage, in one value. */
export interface StageOutcome {
  readonly blasted: readonly string[];
  readonly missed: readonly string[];
  readonly slow: readonly string[];
  readonly hitRate: number;
}

/**
 * The keystroke timings this run measured, in the shape `@engine/calibration`
 * folds into a profile (`refineCalibration`).
 *
 * WHY THIS EXISTS. D51 says a returning player is "calibrated by history", and
 * `calibrationFromHistory` reads that history off `profile.words`. Nothing in
 * `src/` ever writes `profile.words`, so for every profile that did not run the
 * pre-flight ritual that history is empty and `calibration.ikiMs` stays at
 * FR-8's 350 ms default for ever - which sets fall time for a child who types
 * at 600 ms as if they typed at 350. This is the other end of the same seam:
 * the run itself already measured every interval, and this hands them over.
 *
 * WHAT IS AND IS NOT INCLUDED. Blasts only. A missed word contributes no
 * intervals because the lock machine emits none for it - there is nothing to
 * measure on a word the child never started - and a word they abandoned
 * half-way would report the pause, not their hands. Bounding and the median are
 * `@engine/calibration`'s job, not this module's, so nothing is filtered here:
 * this is a faithful transcript, and the engine decides what is usable.
 */
export function observedTimings(history: BlastHistory): ObservedTimings {
  const ikiMs: number[] = [];
  const fkLatencyMs: number[] = [];
  for (const blast of history.blasts) {
    ikiMs.push(...blast.ikiMs);
    if (Number.isFinite(blast.fkLatencyMs)) fkLatencyMs.push(blast.fkLatencyMs);
  }
  return { ikiMs, fkLatencyMs };
}

export function stageOutcome(
  history: BlastHistory,
  calibration: Calibration = DEFAULT_CALIBRATION,
): StageOutcome {
  return {
    blasted: blastedWords(history),
    missed: missedWords(history),
    slow: slowWords(history, calibration),
    hitRate: hitRateOf(history),
  };
}
