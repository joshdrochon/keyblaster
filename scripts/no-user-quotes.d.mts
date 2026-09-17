/**
 * Types for `no-user-quotes.mjs`, so its test can import it under `tsc
 * --noEmit` without the module resolving to `any`.
 *
 * The script stays plain JS because `scripts/precommit.sh` runs it directly
 * with node, before and independently of any build step - a gate that needs
 * compiling is a gate that can be skipped by breaking the build.
 */

/** Words of context that must match a recorded report before it is a quote. */
export const QUOTE_WINDOW: number;

/** Matches `no-user-quotes-ok: <reason>`; the reason is mandatory. */
export const SUPPRESSION: RegExp;

/** Files whose double-quoted literals are the game's own shipped copy. */
export const COPY_SOURCES: readonly string[];

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalise(text: string): string;

/**
 * One entry from `gauntlet/user-reported.json`. Only `said` is read here, but
 * the entries carry id, state, owner and evidence too, and a closed shape
 * would reject the real file.
 */
export interface UserReport {
  said?: string;
  [field: string]: unknown;
}

/** Every run of `QUOTE_WINDOW` consecutive words across every recorded report. */
export function buildQuoteWindows(reports: readonly UserReport[]): Set<string>;

/** The same windows, taken from shipped copy, to be subtracted from the above. */
export function buildCopyWindows(sources?: readonly string[]): Set<string>;

/** Recorded reports, or `[]` when the untracked internal file is absent. */
export function loadReports(path?: string): UserReport[];

/** Why a line is a hit, or `undefined`. */
export function scanLine(
  line: string,
  quoteWindows?: Set<string>,
): "attribution" | "fingerprint" | "verbatim" | undefined;

/** Process exit code: 0 clean, 1 when tracked lines quote a report. */
export function main(): number;
