/**
 * WAS THE EVIDENCE COMPLETE WHEN IT LANDED, AND IF NOT, WHY NOT.
 *
 * An evidence artifact can lose a field two ways, and they look identical in the
 * file:
 *
 *   NEVER WRITTEN  the spec that owns the field threw before reaching its write
 *                  - a broken fixture, an unmet precondition, an upstream
 *                  assertion. The artifact is a SYMPTOM; the cause is in that
 *                  spec.
 *   CLOBBERED      the field was written, and a later writer assigned over the
 *                  whole key instead of merging into it. The artifact is the
 *                  CAUSE, and the feature it describes is probably fine.
 *
 * A-21.2 spent weeks red on the second one while the music intensity index
 * worked perfectly, and then went red again on the first one the day the
 * clobbering was fixed. Telling them apart by hand cost an hour each time.
 *
 * This lives in its own module rather than inline in the spec so both branches
 * can actually be exercised - a classifier whose interesting branch has never
 * run is the same shape of problem it exists to report.
 */

export interface RequiredFields {
  /** Which spec is responsible for writing these, named so a reader can go there. */
  readonly owner: string;
  readonly fields: readonly string[];
}

export interface CompletenessInput {
  /** The artifact as it is about to be written. */
  readonly evidence: Record<string, unknown>;
  /** Every `key.field` any spec successfully wrote, whether or not it survived. */
  readonly everWritten: ReadonlySet<string>;
  readonly required: Readonly<Record<string, RequiredFields>>;
}

export interface MissingField {
  readonly path: string;
  readonly cause: "never-written" | "clobbered";
  readonly detail: string;
}

/** Every required field that is not in the artifact, and why it is not. */
export function missingEvidenceFields(input: CompletenessInput): MissingField[] {
  const missing: MissingField[] = [];
  for (const [key, { owner, fields }] of Object.entries(input.required)) {
    const block = input.evidence[key] as Record<string, unknown> | undefined;
    for (const field of fields) {
      const path = `${key}.${field}`;
      if (block !== undefined && block[field] !== undefined) continue;
      missing.push(
        input.everWritten.has(path)
          ? {
              path,
              cause: "clobbered",
              detail:
                `${path} CLOBBERED - it was written and then removed. Something ` +
                `assigned evidence[${JSON.stringify(key)}] directly instead of calling ` +
                `record(), which merges. The feature is probably fine; this file is the bug.`,
            }
          : {
              path,
              cause: "never-written",
              detail:
                `${path} NEVER WRITTEN - ${owner} did not reach its write. Look for a ` +
                `failing assertion or an unmet precondition in that spec; this artifact ` +
                `is a symptom, not the cause.`,
            },
      );
    }
  }
  return missing;
}
