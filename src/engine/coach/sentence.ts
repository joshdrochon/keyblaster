import {
  MAX_WORD_LENGTH,
  normalizeWord,
  tokenize,
  type Allowlist,
} from "../allowlist/index.js";
import type { Lang } from "../types.js";
import { SHADOW_BANNED_TERMS, scanForBanned } from "./banned.js";
import type { ComposeContext } from "./types.js";

/**
 * THE COMPOSED WARP SENTENCE (D09, D30, D33, D34; FR-16 / AC-16.x, AC-12.3,
 * AC-15.2; decision-log Origin, line 18).
 *
 * WHY THIS FILE EXISTS. The decision log's founding line says Type Storm's
 * end-of-level sentence "doesn't reuse the words just typed" and that we fix
 * it. Until now we did not: `stageBundle(stop).warpSentence` is one hardcoded
 * string per stop, so "Mars is the red planet." is what every child types on
 * every run whatever they practised. This module is the gate that lets a
 * sentence composed by the model - from THAT child's own hard words - be put
 * in front of a seven-year-old.
 *
 * IT IS A VALIDATOR, NOT A GENERATOR. Nothing here talks to a model, reads a
 * clock or touches the network. It takes an untrusted string and either
 * accepts it or names the gate it failed. The generator is the one existing
 * `/api/coach` call (D33: one call per warp break, never in the game loop).
 *
 * SIX GATES, ANY FAILURE -> THE SHIPPED STATIC SENTENCE. The first four are the
 * same bar `validate.ts` holds the coach note to, because this is read by the
 * same child; the last two exist only because this string is TYPED and is
 * supposed to be about the run:
 *
 *   1. shape      typeable characters only, one sentence, ends in a stop
 *   2. allowlist  every word `allowlist.has` - the STRICT typeable scope, not
 *                 `hasReadable`. A note may say "Phobos"; a sentence the child
 *                 has to type may not (story note 4).
 *   3. length     inside the band the SHIPPED sentences already occupy
 *   4. pool       AC-12.3: every content word is in THIS stage's pool
 *   5. banned     D34 content blocklist + D31/AC-25.3 voice ("wrong")
 *   6. reuse      at least one word the child just missed, typed slowly or
 *                 blasted. Without this the feature is a random sentence.
 *
 * ON AC-12.3. "Every content word in a warp sentence exists in that stage's
 * asteroid pool" was written for six hand-authored strings, and the obvious
 * worry is that it cannot survive a generated one. It can, and gate 4 is it:
 * a content word is a token that is not a sight word, and the stage pool is
 * the same array the belt spawns from. What a generated sentence loses is the
 * ability to be checked ONCE at build time - so it is checked every time,
 * before a single letter is drawn. The escalation for this is E-AI-1.
 *
 * ON THE LENGTH BAND. The shipped sentences across all three languages run
 * 17-48 characters and 4-10 words. The gate below is that band with one word
 * and eight characters of slack on top, because a generated sentence carries
 * the child's own words and those are not always short. There is no slack
 * underneath: a three-word sentence is not the beat this screen is for.
 * `tests/unit/coach/sentence.test.ts` runs every shipped sentence through this
 * gate, so the calibration is proven against the content rather than asserted.
 */

/** The typeable band, calibrated on the shipped sentences. See the header. */
export const SENTENCE_LIMITS = Object.freeze({
  minChars: 16,
  maxChars: 56,
  minWords: 4,
  maxWords: 11,
  /** The allowlist's own plate cap; a longer word is not typeable anywhere. */
  maxWordChars: MAX_WORD_LENGTH,
});

export type SentenceLimits = typeof SENTENCE_LIMITS;

/**
 * Why a candidate was refused. Deliberately NOT merged into `CoachFailure`:
 * the note and the sentence fail independently (see `pipeline.settle`), and a
 * shared union would invite code that reports one as the other.
 */
export type SentenceFailure =
  | "absent"
  | "shape"
  | "allowlist"
  | "length"
  | "pool"
  | "banned"
  | "reuse";

export type SentenceOutcome =
  | {
      readonly ok: true;
      readonly text: string;
      /**
       * The words from THIS run that the sentence gave back to the child, in
       * sentence order. This is the retrieval-practice claim, as data - a test
       * and the debug bag can both read it, and it is what the on-screen
       * marker is allowed to stand for.
       */
      readonly reused: readonly string[];
    }
  | { readonly ok: false; readonly reason: SentenceFailure };

/** No sentence was asked for, or none came back. The static one is used. */
export const NO_SENTENCE: SentenceOutcome = Object.freeze({
  ok: false,
  reason: "absent",
});

export interface SentenceValidatorOptions {
  /** D34. The same list `validate.ts` holds the note to. */
  readonly allowlist: Allowlist;
  /** This stage's typeable asteroid pool. AC-12.3 is checked against it. */
  readonly pool: readonly string[];
  /** Words exempt from AC-12.3's "content word" rule. */
  readonly sightWords: readonly string[];
  /** Words this child missed, typed slowly, or blasted. Gate 6. */
  readonly practised: readonly string[];
  readonly limits?: SentenceLimits;
  readonly bannedTerms?: readonly string[];
}

/**
 * Characters a 7-11 year old can reach on one keyboard, and nothing else.
 *
 * Letters and combining marks cover all three content languages (Devanagari
 * matras are Marks, see `allowlist/normalize.ts`). The punctuation set is
 * exactly what the shipped sentences use: comma, full stop, Devanagari danda,
 * and the straight apostrophe. A curly quote, an em dash, a digit, a colon or
 * a bracket is a character the child cannot produce, so a sentence containing
 * one is not typeable however good it reads.
 */
const TYPEABLE = /^[\p{L}\p{M} ,.'।]+$/u;

/** One sentence, terminated. `.` everywhere, `।` in Devanagari. */
const TERMINATOR = /[.।]$/u;

/** Interior sentence-enders would make this two sentences, not one. */
const INTERIOR_TERMINATOR = /[.।](?!$)/u;

function reject(reason: SentenceFailure): SentenceOutcome {
  return { ok: false, reason };
}

/**
 * Run a candidate through all six gates. Never throws: a throw inside a
 * fallback path is how "degrades silently" (D33) becomes a crash on a child's
 * screen.
 */
export function validateComposedSentence(
  raw: unknown,
  options: SentenceValidatorOptions,
): SentenceOutcome {
  // "Nothing came back" and "something bad came back" are different facts and
  // the debug bag reports both: `absent` is the normal state of every mock and
  // note-only call, `shape` means a model handed us something unusable.
  if (raw === undefined || raw === null) return NO_SENTENCE;
  if (typeof raw !== "string") return reject("shape");

  const text = raw.trim();
  if (text.length === 0) return NO_SENTENCE;

  const allowlist = options.allowlist;
  const lang: Lang = allowlist.lang;
  const limits = options.limits ?? SENTENCE_LIMITS;

  // 1. shape
  if (!TYPEABLE.test(text)) return reject("shape");
  if (!TERMINATOR.test(text)) return reject("shape");
  if (INTERIOR_TERMINATOR.test(text)) return reject("shape");
  if (/\s\s/u.test(text)) return reject("shape");
  if (/\s[,.]/u.test(text)) return reject("shape");

  const tokens = tokenize(text, lang);

  // 2. allowlist (D34) - typeable scope, no proper-noun exemption.
  for (const token of tokens) {
    if (!allowlist.has(token)) return reject("allowlist");
  }

  // 3. length
  if (text.length < limits.minChars || text.length > limits.maxChars) {
    return reject("length");
  }
  if (tokens.length < limits.minWords || tokens.length > limits.maxWords) {
    return reject("length");
  }
  for (const token of tokens) {
    if (token.length > limits.maxWordChars) return reject("length");
  }

  // 4. AC-12.3 - every content word is in this stage's pool.
  const sight = new Set(options.sightWords.map((w) => normalizeWord(w, lang)));
  const pool = new Set(options.pool.map((w) => normalizeWord(w, lang)));
  const content = tokens.filter((t) => !sight.has(t));
  // A sentence of nothing but sight words is grammatical and says nothing
  // about the stop. AC-12.3's own test asserts `content.length > 0` for the
  // shipped sentences; a generated one is held to the same floor.
  if (content.length === 0) return reject("pool");
  for (const token of content) {
    if (!pool.has(token)) return reject("pool");
  }

  // 5. banned terms (D34 content + D31/AC-25.3 voice)
  if (scanForBanned(text, lang, options.bannedTerms ?? SHADOW_BANNED_TERMS) !== null) {
    return reject("banned");
  }

  // 6. reuse - the whole reason this feature exists (D09).
  const practised = new Set(
    options.practised.map((w) => normalizeWord(w, lang)).filter((w) => w.length > 0),
  );
  const reused = tokens.filter((t) => practised.has(t));
  if (reused.length === 0) return reject("reuse");

  return { ok: true, text, reused };
}

/**
 * The practised set for a request: what the child missed, what took them a
 * moment, and what they shot down. One function so the prompt, the gate and
 * the scene cannot disagree about what "the words that child just practised"
 * means.
 *
 * Order is MISSED, then SLOW, then BLASTED, and it is load-bearing: the prompt
 * hands the model this list and tells it to prefer the front of it. Retrieval
 * practice is strongest on the words that were hardest, so the words that got
 * past the child come first (E-AI-1).
 */
export function practisedWords(
  missed: readonly string[],
  slow: readonly string[],
  compose: ComposeContext | undefined,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const word of [...missed, ...slow, ...(compose?.blasted ?? [])]) {
    const w = word.trim();
    if (w.length === 0) continue;
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}
