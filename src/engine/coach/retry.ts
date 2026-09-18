import { normalizeWord, tokenize } from "../allowlist/index.js";
import type { Lang } from "../types.js";
import {
  validateComposedSentence,
  type SentenceValidatorOptions,
} from "./sentence.js";

/**
 * UR-64 - SHADOW MAY NOT OFFER A RETRY THE SENTENCE DOES NOT GIVE.
 *
 * ================== THE DEFECT ==================
 * At a warp break the coach can say that one word took the pilot a moment and
 * then offer to do it again together. The sentence the child is handed straight
 * afterwards is the stop's static `warpSentence` from
 * `src/content/<lang>/<stop>.json`, which has no relationship to that word - at
 * Pluto the note named "up" and the sentence was "Pluto is small, cold, and far
 * away." The offer is made in the same breath as the thing that breaks it, and
 * a seven-year-old is the one holding it.
 *
 * NOTHING UPSTREAM OF THIS IS WRONG, and that matters for where the fix goes:
 *
 *   the slow word is real       `blastHistory.slowWords` measures each blasted
 *                               word's mean inter-keystroke interval against
 *                               THAT child's own calibrated `ikiMs`, and
 *                               refuses to name a word already reported as
 *                               missed. The claim is honest.
 *   the ask already exists      `CoachRequest.compose` asks for the break's
 *                               sentence to be composed from the run (D09).
 *   nothing answers it          the only producer of a `sentence` field is the
 *                               `/api/coach` function in warp mode, and
 *                               `chooseTransport` makes an unconfigured build a
 *                               MOCK build. The deployment that would light
 *                               that path up has not happened, so on every
 *                               build anyone can run today `result.sentence` is
 *                               `absent` and the static string stands.
 *
 * So the note is written by one thing, the sentence by another, and nothing in
 * between ever compared them.
 *
 * ================== THE RULE, AND WHY IT IS SHAPED LIKE THIS ==================
 * One invariant, enforced at the one place both strings are known:
 *
 *   IF the note names a word and offers to type it again,
 *   THEN the sentence the child is given contains that word.
 *
 * It is enforced by making the CONSEQUENT true where that is possible and by
 * withdrawing the ANTECEDENT where it is not. In order:
 *
 *   1. `retrySentenceFor` looks for a sentence that already contains the word
 *      and is safe to put in front of the child, and the screen uses it.
 *   2. `withoutRetryPromise` takes the offer back out of the note when step 1
 *      found nothing.
 *
 * Step 2 alone would have closed the ticket. It is here as the FLOOR rather
 * than as the fix, because a note that says "that one took a moment" and then
 * hands the child a sentence with the word in it is the whole of D09's
 * retrieval-practice claim, and a note that just says "that one took a moment"
 * is only honest.
 *
 * ================== WHY NOTHING HERE INVENTS A SENTENCE ==================
 * `mock.ts`'s own header says it: "inventing sentences it cannot check is
 * exactly the failure the allowlist exists to prevent" (D34, AC-13.1/13.2).
 * Every word a child reads or types has to be on that stop's allowlist - the
 * pool, plus the sight words, plus proper nouns - and
 * `tests/unit/content/allowlist.test.ts` is the gate that says so.
 *
 * `retrySentenceFor` therefore SELECTS; it does not generate. Its candidates
 * are strings that already shipped as that stop's own prose, and every one it
 * returns has been through all six gates in `sentence.ts` - the same gates a
 * live model's sentence has to clear - so the allowlist, the AC-12.3 pool rule,
 * the banned-term scan, the typeable-character set and the length band all hold
 * for it by the same measurement, not by an argument about where it came from.
 * A frame assembled out of allowlisted words would pass those gates too and
 * would read like a ransom note; shipped prose reads like English because a
 * person wrote it.
 *
 * WHAT THAT COSTS, STATED PLAINLY: a stop's prose only covers some of its pool,
 * so most slow words have no sentence and most of the time the note simply does
 * not make the offer. That is step 2 doing its job, and it is the honest half
 * of the answer until `/api/coach` is deployed and the live path composes a
 * sentence around the word on purpose.
 *
 * Nothing in this file talks to a model, reads a clock or touches the network.
 */

/**
 * The phrases that promise an IMMEDIATE retry, i.e. one the sentence below the
 * note is expected to deliver.
 *
 * ================== THE LINE THIS DRAWS ==================
 * "Try it again with me" is a promise about the next thing on the screen.
 * "Watch for it next time" and "next time it is yours" are about the NEXT BELT,
 * and the sentence owes them nothing - a note may name a word without promising
 * it, and turning every mention into a promise would strip perfectly honest
 * copy. So the test is deliberately narrow: an offer to do it again, HERE.
 *
 * Matched case-insensitively against the note. Deliberately phrases rather than
 * single words: "again" on its own appears in "let's take the next belt a
 * little slower together, and we'll get it again next time", which promises
 * nothing about this screen.
 */
export const RETRY_PROMISES: readonly string[] = [
  "again with me",
  "with me again",
  "try it again",
  "let us try it",
  "let's try it",
  "type it again",
  "one more time",
];

/**
 * Words a note names, i.e. the quoted runs.
 *
 * The same rule `scenes/support/coachHighlight.quotedWords` draws its accent
 * spans from, restated here because that module is in `src/game` and this one
 * may not import it. `tests/unit/coach/retry.test.ts` asserts the two agree on
 * every shipped template, so the word this file withdraws a promise about is
 * the same word the screen paints in the accent.
 */
export function namedWords(note: string): string[] {
  const out: string[] = [];
  for (const m of note.matchAll(/"([^"\n]+)"/g)) {
    const word = m[1];
    if (word !== undefined && word.trim().length > 0) out.push(word.trim());
  }
  return out;
}

/** True when the note offers to do a word again right now. */
export function promisesRetry(note: string): boolean {
  const lower = note.toLowerCase();
  return RETRY_PROMISES.some((phrase) => lower.includes(phrase));
}

/**
 * The word a note both NAMES and promises to retry, or null.
 *
 * Null for a note that promises nothing, and null for a note that promises
 * without naming anything - "let's do that again" is about the belt, and there
 * is no word for a sentence to owe.
 */
export function promisedWord(note: string): string | null {
  if (!promisesRetry(note)) return null;
  const [first] = namedWords(note);
  return first ?? null;
}

/**
 * Does this sentence give the child that word?
 *
 * WHOLE-WORD AND NORMALISED, never `includes`. "up" is a substring of "supper"
 * and of "surface"; a substring test would have reported the promise kept at
 * Pluto, where the sentence contains "up" only inside another word, and the
 * whole point of this file is that the child gets to TYPE the word.
 * `normalizeWord` is the allowlist's own fold, so case and the apostrophe are
 * handled the one way this codebase handles them.
 */
export function sentenceGives(sentence: string, word: string, lang: Lang): boolean {
  const wanted = normalizeWord(word, lang);
  if (wanted.length === 0) return false;
  return tokenize(sentence, lang).some((token) => token === wanted);
}

/**
 * Take the offer back out of a note, leaving the rest of it.
 *
 * The promise is always its own sentence in every template that makes one, so
 * this drops the sentence that carries it and returns what is left - "Clean
 * run, pilot. "up" took a moment." is still a true, warm, complete note, and it
 * still NAMES the word, which is AC-15.5's claim and is not the part that was
 * broken.
 *
 * IT NEVER RETURNS AN EMPTY STRING. A note that is nothing but a promise would
 * otherwise be erased, and a blank coach area is a worse screen than a note
 * with a promise in it; the original comes back instead, and
 * `retry.test.ts` holds that case directly rather than leaving it to whoever
 * next writes a template.
 */
export function withoutRetryPromise(note: string): string {
  // Split on sentence ends, KEEPING the terminator with its sentence, so the
  // rejoin cannot lose a full stop or invent one.
  const parts = note.match(/[^.!?।]+[.!?।]*\s*/gu);
  if (parts === null) return note;
  const kept = parts.filter((part) => !promisesRetry(part));
  const out = kept.join("").trim();
  return out.length === 0 ? note : out;
}

export interface RetrySentenceOptions {
  /**
   * Sentences that are allowed to become this break's warp sentence: the
   * stop's own shipped prose. NOTHING IS GENERATED - see the header.
   */
  readonly candidates: readonly string[];
  /** The word the note promised. The sentence has to contain it. */
  readonly word: string;
  /** The six gates' options, exactly as a live composed sentence gets them. */
  readonly gate: SentenceValidatorOptions;
}

/**
 * A sentence for this break that contains `word` and clears all six gates, or
 * null.
 *
 * Candidates are tried IN ORDER and the first that passes wins, so the caller
 * decides the preference (the stop's own warp sentence first, then its
 * briefing) and this function never has an opinion it cannot be tested on.
 */
export function retrySentenceFor(options: RetrySentenceOptions): string | null {
  const lang = options.gate.allowlist.lang;
  if (normalizeWord(options.word, lang).length === 0) return null;
  for (const candidate of options.candidates) {
    if (!sentenceGives(candidate, options.word, lang)) continue;
    // The SAME six gates a model's sentence has to clear. Shipped prose is not
    // exempt: the length band and the typeable-character set are about the
    // child typing it, and a briefing line is written to be read.
    if (validateComposedSentence(candidate, options.gate).ok) return candidate;
  }
  return null;
}

/** What the screen should show, once the note and the sentence are compared. */
export interface RetryResolution {
  /** The note as it should be drawn. Unchanged unless a promise was withdrawn. */
  readonly note: string;
  /** A replacement warp sentence, or null to keep the one already laid out. */
  readonly sentence: string | null;
  /** The word the promise is about, once it is one the screen can keep. */
  readonly word: string | null;
  /**
   * Why the note changed, for the debug bag. `null` means it did not.
   *
   *   "kept"      the promise stands and `sentence` delivers it
   *   "standing"  the promise stands; the sentence already contained the word
   *   "withdrawn" no sentence could give the word, so the offer was removed
   */
  readonly outcome: "kept" | "standing" | "withdrawn" | null;
}

export interface ResolveRetryOptions extends Omit<RetrySentenceOptions, "word"> {
  readonly note: string;
  /** The sentence the screen has already laid out. */
  readonly current: string;
  /**
   * False when the sentence may not be swapped - the child has started typing,
   * or a live composed sentence is on screen and E-AI-1's marker is standing
   * for it. The promise is then withdrawn rather than kept by force, because
   * changing the line under a child mid-word is a worse thing to do to them
   * than not offering (D31).
   */
  readonly mayReplace: boolean;
}

/**
 * THE ONE RULE, applied. Pure, total, and it never throws: a coach note is
 * untrusted input and this runs on the path that draws it.
 */
export function resolveRetry(options: ResolveRetryOptions): RetryResolution {
  const none: RetryResolution = {
    note: options.note,
    sentence: null,
    word: null,
    outcome: null,
  };
  const word = promisedWord(options.note);
  if (word === null) return none;

  const lang = options.gate.allowlist.lang;
  // Already kept. The commonest case once `/api/coach` is deployed: gate 6 of
  // `sentence.ts` requires a composed sentence to reuse one of this child's own
  // words, so a live sentence built around the slow word lands here.
  if (sentenceGives(options.current, word, lang)) {
    return { note: options.note, sentence: null, word, outcome: "standing" };
  }

  if (options.mayReplace) {
    const found = retrySentenceFor({
      candidates: options.candidates,
      word,
      gate: options.gate,
    });
    if (found !== null && found !== options.current) {
      return { note: options.note, sentence: found, word, outcome: "kept" };
    }
  }

  return {
    note: withoutRetryPromise(options.note),
    sentence: null,
    word: null,
    outcome: "withdrawn",
  };
}
