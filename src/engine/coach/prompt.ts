import type { Lang } from "../types.js";
import { MAX_NOTE_WORDS } from "./validate.js";
import type { SanitizedCoachRequest } from "./types.js";

/**
 * The coach prompt (D33, D34, D66, story note 6).
 *
 * D34's three layers, in order of how much work they do:
 *   1. the graded allowlist        - does the real work
 *   2. the post-filter (validate.ts)
 *   3. THIS system prompt          - a backup
 *
 * It is written as a backup and nothing downstream trusts it: every rule below
 * is also enforced by code that runs on the response. A prompt that is the
 * only thing standing between a language model and a seven-year-old is a
 * design error, not a guardrail.
 *
 * NOT EXPORTED FROM index.ts. It is reachable by path for the serverless
 * function (api/coach.ts) and for DirectCoach, and stays out of the client
 * bundle's import graph so the prod build carries neither the prompt nor the
 * transport that uses it (AC-15.4).
 */

const LANG_NAMES: Readonly<Record<Lang, string>> = {
  en: "English",
  es: "Spanish",
  hi: "Hindi",
};

/** Shadow's voice rules, stated to the model as well as enforced in code. */
export function buildSystemPrompt(lang: Lang, maxNoteWords = MAX_NOTE_WORDS): string {
  return [
    "You are Shadow, the small navigation robot aboard a child's spaceship.",
    `You speak ${LANG_NAMES[lang]} to a child in grades 2 to 5.`,
    "",
    "Voice rules, all of them absolute:",
    `- The note is at most ${maxNoteWords} words.`,
    "- Warm, short, calm. You are a co-pilot, not a teacher.",
    '- NEVER use the word "wrong". Never say the child failed or lost.',
    "- Name the specific words the pilot missed. Naming the word is the point.",
    "- Use only simple, common words a grade 2 reader knows.",
    "- No alcohol, drugs, weapons, violence or profanity, in any form.",
    "",
    "Also return two short practice sentences for the next stage. Each must be",
    "a plain declarative sentence built only from the words listed as the pool",
    "for that stop, plus the most common sight words.",
    "",
    'Reply with JSON only: {"note": string, "variants": [string, string]}',
    "No prose before or after the JSON. No code fence.",
  ].join("\n");
}

/** The per-break user turn. Takes a SANITIZED request: the words are filtered. */
export function buildUserPrompt(req: SanitizedCoachRequest): string {
  const list = (words: readonly string[]): string =>
    words.length > 0 ? words.join(", ") : "(none)";

  return [
    `stop: ${req.stopId}`,
    `missed: ${list(req.missed)}`,
    `slow: ${list(req.slow)}`,
    `hit rate: ${Math.round(req.hitRate * 100)}%`,
  ].join("\n");
}
