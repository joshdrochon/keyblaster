import type { CoachPayload, CoachVariants } from "./types.js";

/**
 * Gate 1 of AC-15.2: JSON schema.
 *
 * This runs on output from a language model and on output from a serverless
 * function we did not write, so it trusts nothing: not the type of the top
 * level value, not the presence of the keys, not the element type of the
 * array, not the length of the array. Anything that is not exactly
 * `{ note: string, variants: [string, string] }` is a schema failure and the
 * caller falls back (AC-15.1).
 *
 * Why hand-rolled rather than a validator library: src/engine has no runtime
 * dependencies, and the schema is four lines of shape. A dependency here would
 * also land in the client bundle for no benefit.
 */

/** The number of sentence variants FR-15 asks for. Not configurable. */
export const VARIANT_COUNT = 2;

/**
 * Trim, and treat a whitespace-only string as absent. A model that returns
 * `{ note: "   " }` has returned nothing; the fallback must never be empty, so
 * neither may a "live" note.
 */
function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Parse an unknown payload into a CoachPayload, or null if it does not match.
 * Never throws: a thrown parse error inside a fallback path is how a "silent"
 * degrade becomes a crash (D33 says it fails silently).
 */
export function parseCoachPayload(raw: unknown): CoachPayload | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;

  const candidate = raw as { note?: unknown; variants?: unknown };

  const note = asText(candidate.note);
  if (note === null) return null;

  const variants = candidate.variants;
  if (!Array.isArray(variants) || variants.length !== VARIANT_COUNT) return null;

  // Checked position by position rather than in a loop: FR-15 says two, the
  // length check above says two, and reading both explicitly is what lets the
  // tuple type be built without a cast under noUncheckedIndexedAccess.
  const first = asText(variants[0]);
  const second = asText(variants[1]);
  if (first === null || second === null) return null;

  const tuple: CoachVariants = [first, second];
  return { note, variants: tuple };
}
