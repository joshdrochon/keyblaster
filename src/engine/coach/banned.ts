import { isBlocked, normalizeWord, tokenize } from "../allowlist/index.js";
import type { Lang } from "../types.js";

/**
 * Gate 4 of AC-15.2: the banned-term scan, plus Shadow's voice rule.
 *
 * TWO DIFFERENT BANS LIVE HERE, and they exist for different reasons.
 *
 * 1. CONTENT (D34). Reuses `isBlocked` from src/engine/allowlist - the house
 *    blocklist, not a second copy of it. This module deliberately does not
 *    define its own list of swearing/alcohol/drug stems: two lists drift, and
 *    the one that drifts is always the one nobody runs the fixture test
 *    against. "liquor" is caught here through that shared list (it is D34's
 *    worked example).
 *
 *    This gate is NOT redundant with the allowlist gate. The allowlist gate
 *    asks "is this word on the list"; this one asks "is this word forbidden".
 *    A compilation bug that widened the allowlist would defeat the first check
 *    and not the second, which is the whole point of D34's layering.
 *
 * 2. VOICE (D31, D33, D66, story note 6). Shadow NEVER says "wrong". AC-25.3
 *    makes that a hard requirement for every Shadow line, scripted or
 *    generated, so a generated note containing it is refused and the shipped
 *    fallback is used instead.
 *
 * SHIPPED VOICE LIST = exactly ["wrong"]. That is the word the docs name, and
 * the only one. Widening it ("bad", "fail", "error") would quietly reject
 * perfectly good live notes - "not bad at all, pilot" - on a rule no document
 * asks for. The list is a parameter so content can extend it deliberately.
 */

/** The one word Shadow may never say (D31, story note 6, AC-25.3). */
export const SHADOW_BANNED_TERMS: readonly string[] = ["wrong"];

/** Why the scan refused the text. */
export type BanReason = "blocked-word" | "banned-term";

export interface BanHit {
  readonly term: string;
  readonly reason: BanReason;
}

/**
 * Scan one string. Returns the first hit, or null if clean.
 *
 * Voice terms are matched two ways on purpose:
 *   - per token, as a prefix, so "wrongly" and "wrong." are caught;
 *   - as a substring of the whole normalised text, so a token the tokenizer
 *     cannot split - "you-were-wrong", an em-dash run - is caught too.
 * Content terms are matched per token via `isBlocked`, which already owns its
 * own prefix/exact tier split (allowlist/blocklist.ts).
 */
export function scanForBanned(
  text: string,
  lang?: Lang,
  terms: readonly string[] = SHADOW_BANNED_TERMS,
): BanHit | null {
  const tokens = tokenize(text, lang);

  for (const token of tokens) {
    if (isBlocked(token)) return { term: token, reason: "blocked-word" };
    for (const term of terms) {
      if (token.startsWith(term)) return { term, reason: "banned-term" };
    }
  }

  const flat = normalizeWord(text, lang);
  for (const term of terms) {
    if (flat.includes(term)) return { term, reason: "banned-term" };
  }

  return null;
}

/**
 * AC-25.3 in one call, for anything that wants the voice rule without the rest
 * of the pipeline (the scripted line-table scan is somebody else's test, but
 * it should be able to use this).
 */
export function saysWrong(text: string, lang?: Lang): boolean {
  const hit = scanForBanned(text, lang, SHADOW_BANNED_TERMS);
  return hit !== null && hit.reason === "banned-term";
}
