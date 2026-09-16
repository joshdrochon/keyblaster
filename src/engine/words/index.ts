import {
  EASE_NEW,
  type Lang,
  type WordRecord,
} from "../types.js";
import { easeAfterHit, easeAfterMiss, easeAfterTypo } from "./ease.js";
import { nextStageAfterHit, nextStageAfterMiss } from "./srs.js";
import { median, pushCapped } from "./stats.js";

export {
  EASE_FACTOR,
  FAST_HIT_FK_LATENCY_MS,
  clampEase,
  easeAfterHit,
  easeAfterMiss,
  easeAfterTypo,
  newEase,
} from "./ease.js";
export { intervalStages, isEligible, nextStageAfterHit, nextStageAfterMiss } from "./srs.js";
export { median, pushCapped } from "./stats.js";

/** How many timing samples we keep per word (see pushCapped). */
export const SAMPLE_CAP = 20;

/** A word this player has never met (PRD FR-7). */
export function blankRecord(): WordRecord {
  return {
    exposures: 0,
    hits: 0,
    misses: 0,
    typos: 0,
    fkLatencyMs: [],
    ikiMs: [],
    ease: EASE_NEW,
    lastSeen: null,
    nextEligibleStage: 0,
  };
}

/** Outcomes the flight loop reports back to the word model. */
export type WordEvent =
  | { kind: "hit"; fkLatencyMs: number; ikiMs: readonly number[]; atMs: number; stage: number }
  | { kind: "miss"; atMs: number; stage: number }
  | { kind: "typo"; atMs: number; stage: number };

/**
 * AC-7.1: every blast, miss and typo updates the record deterministically.
 * Pure: takes the record and the event, returns a NEW record. No clock, no
 * storage, no randomness - `atMs` and `stage` are supplied by the caller so
 * tests are exact and the engine stays DOM-free (CLAUDE.md).
 */
export function applyEvent(record: WordRecord, event: WordEvent): WordRecord {
  const next: WordRecord = {
    ...record,
    fkLatencyMs: [...record.fkLatencyMs],
    ikiMs: [...record.ikiMs],
  };

  switch (event.kind) {
    case "hit": {
      next.exposures += 1;
      next.hits += 1;
      next.fkLatencyMs = pushCapped(next.fkLatencyMs, event.fkLatencyMs, SAMPLE_CAP);
      for (const iki of event.ikiMs) {
        next.ikiMs = pushCapped(next.ikiMs, iki, SAMPLE_CAP);
      }
      next.ease = easeAfterHit(record.ease, event.fkLatencyMs);
      next.lastSeen = event.atMs;
      next.nextEligibleStage = nextStageAfterHit(event.stage, next.ease);
      return next;
    }
    case "miss": {
      next.exposures += 1;
      next.misses += 1;
      next.ease = easeAfterMiss(record.ease);
      next.lastSeen = event.atMs;
      // D23: sooner, not later.
      next.nextEligibleStage = nextStageAfterMiss(event.stage);
      return next;
    }
    case "typo": {
      // A typo is not an exposure: the player is mid-word, still on target,
      // and the lock is still theirs (AC-3.2). Counting it as an exposure
      // would let one clumsy word inflate the retention denominator.
      next.typos += 1;
      next.ease = easeAfterTypo(record.ease);
      return next;
    }
  }
}

/** Median first-key latency, or null if this word has never been hit. */
export const medianFkLatency = (r: WordRecord): number | null => median(r.fkLatencyMs);

/** Median inter-key interval for this word, or null. */
export const medianIki = (r: WordRecord): number | null => median(r.ikiMs);

/** Mastery buckets used by selection weighting (arch 4.2, AC-9.x). */
export type Mastery = "unknown" | "weak" | "learning" | "mastered";

export function masteryOf(record: WordRecord | undefined): Mastery {
  if (!record || record.exposures === 0) return "unknown";
  if (record.ease > 1.2) return "weak";
  if (record.ease < 0.5) return "mastered";
  return "learning";
}

/** The per-language word book on a profile. */
export type WordBook = Record<string, WordRecord>;

export function recordFor(book: WordBook | undefined, word: string): WordRecord {
  return book?.[word] ?? blankRecord();
}

/** Non-mutating update of a whole book (persistence writes this out). */
export function withRecord(book: WordBook, word: string, record: WordRecord): WordBook {
  return { ...book, [word]: record };
}

/** Convenience for the flight loop: apply an event straight into a book. */
export function applyToBook(book: WordBook, word: string, event: WordEvent): WordBook {
  return withRecord(book, word, applyEvent(recordFor(book, word), event));
}

/** Typed accessor for the nested per-language store on Profile. */
export function bookOf(
  words: Record<string, WordBook> | undefined,
  lang: Lang,
): WordBook {
  return words?.[lang] ?? {};
}
