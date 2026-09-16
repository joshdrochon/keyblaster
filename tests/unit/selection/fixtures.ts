import { type WordRecord } from "@engine/types.js";
import { type WordBook, blankRecord } from "@engine/words/index.js";

/**
 * Word-record builders for selection tests.
 *
 * masteryOf() calls a record with exposures === 0 "unknown" whatever its ease,
 * so every seen-word helper here sets exposures explicitly. Getting that wrong
 * silently turns a weighting test into a tautology.
 */
export function seen(ease: number, over: Partial<WordRecord> = {}): WordRecord {
  return { ...blankRecord(), exposures: 3, hits: 3, ease, lastSeen: 0, ...over };
}

/** exposures 0 -> "unknown", weight 3.0. */
export const unknownRecord = (): WordRecord => blankRecord();
/** ease > 1.2 -> "weak", weight 2.0. */
export const weakRecord = (): WordRecord => seen(1.5);
/** 0.5 <= ease <= 1.2 -> "learning", weight 1.0. */
export const learningRecord = (): WordRecord => seen(0.8);
/** ease < 0.5 -> "mastered", weight 0.3, and always a guaranteed catch. */
export const masteredRecord = (): WordRecord => seen(0.3);

export function bookFrom(entries: Record<string, WordRecord>): WordBook {
  return { ...entries };
}

/** Give every word in `pool` the same record. */
export function uniformBook(pool: readonly string[], make: () => WordRecord): WordBook {
  const book: WordBook = {};
  for (const word of pool) book[word] = make();
  return book;
}

/**
 * 26 allowlist-shaped words, one per first letter. Used wherever a test needs
 * first-letter collisions to be impossible so that AC-2.1 cannot mask the rule
 * actually under test.
 */
export const DISTINCT_LETTER_WORDS: readonly string[] = [
  "apple", "bird", "cat", "dog", "egg", "fish", "goat", "hat", "ice", "jump",
  "kite", "leaf", "moon", "nest", "open", "play", "quiet", "run", "sun", "tree",
  "under", "van", "wind", "box", "yes", "zoo",
];

/**
 * Words that deliberately collide on first letters, for the AC-2.1 sweep.
 * A pool with unique initials would pass AC-2.1 by construction and prove
 * nothing.
 */
export const COLLIDING_WORDS: readonly string[] = [
  "apple", "ant", "arm", "bird", "bat", "big", "cat", "cow", "cup",
  "dog", "duck", "egg", "eat", "fish", "frog", "goat", "gold", "hat",
];
