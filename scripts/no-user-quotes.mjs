#!/usr/bin/env node
/**
 * THE REPO IS PART OF THE SUBMISSION. NOTHING IN IT QUOTES THE USER.
 *
 * Lanes cite the report that caused a fix, which is good engineering practice
 * and wrong here: `src/`, `tests/` and the shipped `docs/` all go to GitHub, so
 * a comment quoting the person who reported a bug publishes their words under
 * their name. The internal files (`gauntlet/user-reported.json` and friends)
 * are untracked and may quote freely - that is what they are for.
 *
 * WHAT TO WRITE INSTEAD. Keep the whole technical argument, drop the
 * attribution and the verbatim wording. Cite the ticket id:
 *
 *   BAD   * A player, on Saturn: "text overlaying/colliding. needs a big fix".
 *   GOOD  * UR-20, reported on Saturn: text drawn over other text.
 *
 * This check is deliberately a blunt instrument. It cannot recognise an
 * arbitrary future quote, so it looks for the two things that actually recur:
 * attribution phrases, and the misspellings that make a quote identifiable.
 * A miss here is not a licence - the rule is "never quote", not "never trip
 * this script".
 */
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";

/** Phrases that introduce someone else's words. */
const ATTRIBUTION = [
  /\bthe user (said|reported|wrote|put it|called it|noticed|asked)\b/i,
  /\ba player(,| on| looked| said| reported| wrote)[^.\n]{0,40}["“]/i,
  /\bthe report (says|calls|reads|puts it)\b/i,
  /\bTHE REPORT:/,
  /\buser'?s own words\b/i,
];

/**
 * Misspellings and fragments that only appear inside a quote. A correctly
 * spelled paraphrase is fine; these are the fingerprints of a copy-paste.
 */
const FINGERPRINTS = [
  /\bAls noticed\b/,
  /\bCant happen\b/,
  /\bwierd\b/i,
  /\bkaiper\b/i,
  /\bluanch\b/i,
  /\baduio\b/i,
  /\bpcitures\b/i,
  /\bcaffinate\b/i,
  /\bthier\b/i,
  /\bcommisioning\b/i,
  /\bcluade\b/i,
  /for the love of god/i,
  /aux cord/i,
  /feels a bit empty/i,
  /dont feel satisfying/i,
  /needs a big fix/i,
  /does not look clean/i,
  /just look noisy/i,
];

const files = execSync("git ls-files src tests docs scripts", { encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx|mjs|js|md|json|sh)$/.test(f));

const hits = [];
for (const file of files) {
  if (file === "scripts/no-user-quotes.mjs") continue;
  // A tracked path is not necessarily a path on disk: a lane may have deleted
  // a file whose deletion is not staged yet. Skipping is right - a file that
  // does not exist cannot quote anyone - and throwing here would break every
  // commit in the repo, which this check has no business doing.
  if (!existsSync(file)) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const re of [...ATTRIBUTION, ...FINGERPRINTS]) {
      if (re.test(line)) {
        hits.push({ file, line: i + 1, text: line.trim().slice(0, 120) });
        return;
      }
    }
  });
}

if (hits.length > 0) {
  console.error(
    `\nno-user-quotes: ${hits.length} tracked line(s) quote or attribute a report.\n` +
      `The repo is submitted. Keep the reasoning, cite the UR- id, drop the words.\n`,
  );
  for (const h of hits) console.error(`  ${h.file}:${h.line}  ${h.text}`);
  console.error("");
  process.exit(1);
}
console.log(`no-user-quotes: OK (${files.length} tracked files)`);
