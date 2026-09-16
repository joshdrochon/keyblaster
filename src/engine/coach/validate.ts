import {
  filterWords,
  sentenceIsAllowed,
  tokenize,
  type Allowlist,
} from "../allowlist/index.js";
import { SHADOW_BANNED_TERMS, scanForBanned } from "./banned.js";
import { parseCoachPayload } from "./schema.js";
import type {
  CoachFailure,
  CoachPayload,
  CoachRequest,
  SanitizedCoachRequest,
} from "./types.js";

/**
 * AC-15.2: every output is validated before use. Four gates, in the PRD's
 * order, any failure -> fallback:
 *
 *   1. JSON schema        (schema.ts)
 *   2. allowlist          (src/engine/allowlist - D34)
 *   3. word count         (note <= 20 words, FR-15)
 *   4. banned-term scan   (banned.ts - D34 content + D31 voice)
 *
 * NOTE ON ORDER. architecture section 4.6 lists the last two the other way
 * round ("banned-term scan -> length"); PRD FR-15/AC-15.2 lists
 * "schema, allowlist, word count, banned-term scan". Every failure produces
 * the same outcome - the shipped fallback - so the order only changes which
 * `CoachFailure` label a test sees. We follow the PRD, which outranks the
 * architecture doc (CLAUDE.md PRECEDENCE).
 *
 * NOTE ON THE TWO ALLOWLIST SCOPES. The variants are TYPED by a child, so they
 * are held to `allowlist.has` via `sentenceIsAllowed` - strict, no exceptions.
 * The note is READ, never typed, so by default it is held to
 * `allowlist.hasReadable`, which additionally admits the proper nouns
 * (Phobos, Titan, Charon) that story note 4 keeps out of the typeable pool.
 * A coach note that cannot say "Phobos" is a worse note for no safety gain -
 * `hasReadable` is still the allowlist, not an escape from it. Callers that
 * want the strict rule for the note too pass `noteScope: "typeable"`.
 */

/** FR-15: the coach note is at most 20 words. */
export const MAX_NOTE_WORDS = 20;

/** Which half of the allowlist the note is checked against. */
export type NoteScope = "readable" | "typeable";

export interface CoachValidatorOptions {
  readonly allowlist: Allowlist;
  /** Default MAX_NOTE_WORDS (20). */
  readonly maxNoteWords?: number;
  /** Default "readable". See the note above. */
  readonly noteScope?: NoteScope;
  /** Default SHADOW_BANNED_TERMS (["wrong"]). */
  readonly bannedTerms?: readonly string[];
}

export type CoachValidation =
  | { readonly ok: true; readonly value: CoachPayload }
  | { readonly ok: false; readonly reason: CoachFailure };

export interface CoachValidator {
  readonly allowlist: Allowlist;
  readonly maxNoteWords: number;
  readonly noteScope: NoteScope;
  /** Run all four gates over a raw, untrusted payload. */
  validate(raw: unknown): CoachValidation;
  /**
   * Put a request through the allowlist before it reaches a prompt or a mock
   * template. Without this a caller could hand the coach an unfiltered word
   * and have it read back out in Shadow's voice.
   */
  sanitize(req: CoachRequest): SanitizedCoachRequest;
}

/** Clamp to [0, 1]; NaN reads as 0 rather than propagating into a prompt. */
function clampRate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function createCoachValidator(
  options: CoachValidatorOptions,
): CoachValidator {
  const allowlist = options.allowlist;
  const maxNoteWords = options.maxNoteWords ?? MAX_NOTE_WORDS;
  const noteScope: NoteScope = options.noteScope ?? "readable";
  const bannedTerms = options.bannedTerms ?? SHADOW_BANNED_TERMS;
  const lang = allowlist.lang;

  const noteIsAllowed = (note: string): boolean => {
    if (noteScope === "typeable") return sentenceIsAllowed(note, allowlist);
    return tokenize(note, lang).every((word) => allowlist.hasReadable(word));
  };

  return {
    allowlist,
    maxNoteWords,
    noteScope,

    validate(raw: unknown): CoachValidation {
      // 1. schema
      const payload = parseCoachPayload(raw);
      if (payload === null) return { ok: false, reason: "schema" };

      // 2. allowlist (D34)
      if (!noteIsAllowed(payload.note)) return { ok: false, reason: "allowlist" };
      for (const variant of payload.variants) {
        if (!sentenceIsAllowed(variant, allowlist)) {
          return { ok: false, reason: "allowlist" };
        }
      }

      // 3. word count (FR-15)
      if (tokenize(payload.note, lang).length > maxNoteWords) {
        return { ok: false, reason: "length" };
      }

      // 4. banned terms: D34 content + D31/AC-25.3 voice ("wrong")
      for (const text of [payload.note, ...payload.variants]) {
        if (scanForBanned(text, lang, bannedTerms) !== null) {
          return { ok: false, reason: "banned" };
        }
      }

      return { ok: true, value: payload };
    },

    sanitize(req: CoachRequest): SanitizedCoachRequest {
      return {
        stopId: req.stopId,
        lang: req.lang,
        missed: filterWords(req.missed, allowlist).accepted,
        slow: filterWords(req.slow, allowlist).accepted,
        hitRate: clampRate(req.hitRate),
      };
    },
  };
}
