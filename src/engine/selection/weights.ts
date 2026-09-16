import type { WordRecord } from "../types.js";
import { type Mastery, masteryOf } from "../words/index.js";

/**
 * Selection weights and the guaranteed-catch predicate
 * (D21, D22, PRD FR-9, architecture section 4.2).
 *
 * D21: "frequency tracks mastery". A word the player has never met is served
 * ten times as often as one they have mastered, because the unknown word is
 * where the learning is and the mastered word is there for combo fodder and
 * morale, not instruction.
 *
 * The four numbers are the PRD's, verbatim. They are tunable (D69) but that is
 * a PRD edit, not a code edit - so they live here as named constants and the
 * tests diff against the constants, not against literals.
 */
export const SELECTION_WEIGHT: Readonly<Record<Mastery, number>> = Object.freeze({
  unknown: 3.0,
  weak: 2.0,
  learning: 1.0,
  mastered: 0.3,
});

/** Weight for one word's record. An absent record is "unknown" (words/). */
export function weightOf(record: WordRecord | undefined): number {
  return SELECTION_WEIGHT[masteryOf(record)];
}

/**
 * D22 wants every wave to contain at least one word the player can definitely
 * catch. The PRD spells out what "definitely" means (AC-9.2): a mastered word,
 * or a short word this player already reads without effort.
 */
export const CATCH_MAX_LENGTH = 4;
export const CATCH_MAX_EASE = 1.0;

/**
 * AC-9.2's guaranteed-catch test.
 *
 * NOTE, and this is load-bearing: new words start at EASE_NEW (1.6), so on a
 * brand-new profile NO word in a fresh stage pool satisfies this predicate.
 * The invariant is therefore conditional on the pool being able to supply a
 * catch word at all - see `poolHasCatchWord` and the picker's relaxation
 * cascade, which degrades instead of stalling.
 */
export function isGuaranteedCatch(word: string, record: WordRecord | undefined): boolean {
  if (masteryOf(record) === "mastered") return true;
  if (record === undefined) return false;
  return codePointLength(word) <= CATCH_MAX_LENGTH && record.ease <= CATCH_MAX_EASE;
}

/**
 * Length in code points, not UTF-16 units. Devanagari content (D46) is typed
 * as a sequence of code points and a surrogate pair must not read as two
 * letters when we ask "is this word four letters or fewer".
 */
export const codePointLength = (word: string): number => [...word].length;

/**
 * First letter, as a code point. AC-2.1's uniqueness rule is about what the
 * player's first keystroke will match (AC-3.1), which is one code point.
 * Empty string has no first letter; callers filter empties out at pool build.
 */
export function firstLetter(word: string): string {
  return [...word][0] ?? "";
}
