import type { Lang } from "../types.js";

/**
 * Longest word we will ever put on an asteroid plate. Art direction sizes a
 * rock at 56px + 8px per letter with a ~140px cap, which lands at 13 letters
 * (art-direction.md section 4).
 */
export const MAX_WORD_LENGTH = 13;

/**
 * Characters stripped from the outside of a token before matching.
 *
 * \p{M} (combining marks) MUST be in the kept set. Every Devanagari matra,
 * anusvara, chandrabindu, nukta and virama is a Mark, not a Letter, so a class
 * of "not a letter and not a number" strips them from the end of a word:
 * गुलाबी became गुलाब, प्लूटो became प्लूट, and है became ह. 91 of 143 Hindi
 * sight words were affected.
 *
 * The allowlist GATE never broke, because construction and lookup truncated
 * identically - which is exactly why this survived. What broke is everything
 * downstream that reads the normalised string: an asteroid plate drawn from
 * Allowlist.words showed a mutilated word, and a WordRecord keyed on one was
 * keyed wrong.
 *
 * The Devanagari test in this module's own suite did not catch it. It compared
 * क़र spelled two ways, where the nukta is followed by a consonant and so is
 * never trailing. A correct test that was not representative.
 */
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu;

/**
 * Normalise a raw token to its comparable form.
 *
 * - NFC first, so Devanagari composed and decomposed forms compare equal (D46).
 * - Lowercased for cased scripts. Devanagari is caseless, so this is a no-op
 *   there; we do not special-case it, we just let toLowerCase do nothing.
 * - Surrounding punctuation removed, so "Mars." and "Mars" are the same word.
 *   Internal punctuation is kept: "don't" stays one token.
 */
export function normalizeWord(raw: string, _lang?: Lang): string {
  return raw.normalize("NFC").trim().replace(EDGE_PUNCTUATION, "").toLowerCase();
}

/**
 * Split a sentence into normalised words. Used to validate warp sentences and
 * AI output against the allowlist (AC-12.3, AC-15.2).
 */
export function tokenize(sentence: string, lang?: Lang): string[] {
  return sentence
    .split(/\s+/)
    .map((t) => normalizeWord(t, lang))
    .filter((t) => t.length > 0);
}
