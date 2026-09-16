import type { Lang } from "../types.js";
import { isBlocked } from "./blocklist.js";
import { MAX_WORD_LENGTH, normalizeWord, tokenize } from "./normalize.js";

export { blockedPrefixStems, blockedStems, isBlocked } from "./blocklist.js";
export { MAX_WORD_LENGTH, normalizeWord, tokenize } from "./normalize.js";

/** Why a word was refused. */
export type RejectionReason =
  | "empty"
  | "too-long"
  | "blocked"
  | "not-in-allowlist";

export interface Rejection {
  readonly word: string;
  readonly reason: RejectionReason;
}

export interface FilterResult {
  readonly accepted: readonly string[];
  readonly rejected: readonly Rejection[];
}

/**
 * A compiled, immutable word list for one language (D34).
 *
 * `words` are the typeable pool: Fry 1000 + every stage pool.
 * `properNouns` (Phobos, Titan, Charon...) are readable in briefings but are
 * never typed, so they are held separately - story-draft note 4.
 */
export interface Allowlist {
  readonly lang: Lang;
  readonly size: number;
  /** True if the word may appear on an asteroid or in a typed sentence. */
  has(word: string): boolean;
  /** True if the word may appear in briefing prose only. */
  hasReadable(word: string): boolean;
  readonly words: readonly string[];
  readonly properNouns: readonly string[];
}

export interface AllowlistSource {
  readonly lang: Lang;
  readonly words: Iterable<string>;
  readonly properNouns?: Iterable<string>;
}

/**
 * Build an allowlist. Entries are normalised on the way in, so the compiled
 * JSON can carry human-readable casing; blocked entries are dropped rather
 * than trusted, which is what makes AC-13.2 hold by construction.
 */
export function createAllowlist(source: AllowlistSource): Allowlist {
  const words = new Set<string>();
  for (const raw of source.words) {
    const w = normalizeWord(raw, source.lang);
    if (w.length === 0 || w.length > MAX_WORD_LENGTH) continue;
    if (isBlocked(w)) continue;
    words.add(w);
  }

  const properNouns = new Set<string>();
  for (const raw of source.properNouns ?? []) {
    const w = normalizeWord(raw, source.lang);
    if (w.length === 0) continue;
    if (isBlocked(w)) continue;
    properNouns.add(w);
  }

  const wordList = [...words].sort();
  const properList = [...properNouns].sort();

  return {
    lang: source.lang,
    size: words.size,
    has: (word: string) => words.has(normalizeWord(word, source.lang)),
    hasReadable: (word: string) => {
      const w = normalizeWord(word, source.lang);
      return words.has(w) || properNouns.has(w);
    },
    words: wordList,
    properNouns: properList,
  };
}

/** Classify one word without throwing. */
export function checkWord(word: string, allowlist: Allowlist): Rejection | null {
  const w = normalizeWord(word, allowlist.lang);
  if (w.length === 0) return { word: w, reason: "empty" };
  if (w.length > MAX_WORD_LENGTH) return { word: w, reason: "too-long" };
  if (isBlocked(w)) return { word: w, reason: "blocked" };
  if (!allowlist.has(w)) return { word: w, reason: "not-in-allowlist" };
  return null;
}

/**
 * Filter a batch. Nothing throws: callers decide what a rejection means.
 * Used for AI output (AC-15.2) and content validation (AC-12.3).
 */
export function filterWords(
  words: Iterable<string>,
  allowlist: Allowlist,
): FilterResult {
  const accepted: string[] = [];
  const rejected: Rejection[] = [];
  for (const raw of words) {
    const bad = checkWord(raw, allowlist);
    if (bad) rejected.push(bad);
    else accepted.push(normalizeWord(raw, allowlist.lang));
  }
  return { accepted, rejected };
}

/** True if every word in the sentence is typeable (AC-12.3). */
export function sentenceIsAllowed(
  sentence: string,
  allowlist: Allowlist,
): boolean {
  return filterWords(tokenize(sentence, allowlist.lang), allowlist).rejected
    .length === 0;
}

export class AllowlistViolation extends Error {
  readonly rejection: Rejection;
  constructor(rejection: Rejection) {
    super(`Word "${rejection.word}" refused: ${rejection.reason}`);
    this.name = "AllowlistViolation";
    this.rejection = rejection;
  }
}

/**
 * AC-13.1: a violation throws in dev so it is caught in test, and is dropped
 * in prod so a content bug can never crash a child's game.
 * Returns the word in dev, or null in prod when refused.
 */
export function assertAllowed(
  word: string,
  allowlist: Allowlist,
  mode: "dev" | "prod",
): string | null {
  const bad = checkWord(word, allowlist);
  if (!bad) return normalizeWord(word, allowlist.lang);
  if (mode === "dev") throw new AllowlistViolation(bad);
  return null;
}
