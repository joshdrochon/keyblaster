import {
  ANTHROPIC_MESSAGES_URL,
  DIRECT_COACH_MARKER,
} from "./direct.js";

/**
 * The build-test half of AC-15.4: "the direct path is unreachable in prod
 * builds", asserted against the real artifact rather than against intent.
 *
 * THIS FILE IS NEVER IMPORTED BY index.ts. It imports direct.ts, so importing
 * it from the game would drag the thing it is checking for into the bundle.
 * Its only callers are the unit test and the gauntlet build step, both of
 * which run outside the client graph.
 *
 * Usage in a build test:
 *
 *   const bundle = readFileSync("dist/assets/index-*.js", "utf8");
 *   expect(directCoachIssues(bundle)).toEqual([]);
 *
 * It also doubles as a narrow secrets check for this module: `x-api-key` in a
 * client bundle means the key handling went wrong, whatever else did (D47,
 * CLAUDE.md "No keys in the client bundle").
 */

/** Strings that must not appear in any production bundle. */
export const DIRECT_COACH_FORBIDDEN: readonly string[] = [
  DIRECT_COACH_MARKER,
  ANTHROPIC_MESSAGES_URL,
  "x-api-key",
  "anthropic-dangerous-direct-browser-access",
  "createDirectCoach",
];

/**
 * Returns one message per forbidden string found. Empty array means the bundle
 * is clean. Never throws, so a build script can report all of them at once.
 */
export function directCoachIssues(bundleText: string): string[] {
  const issues: string[] = [];
  for (const needle of DIRECT_COACH_FORBIDDEN) {
    if (bundleText.includes(needle)) {
      issues.push(`DirectCoach reached the bundle: found "${needle}"`);
    }
  }
  return issues;
}
