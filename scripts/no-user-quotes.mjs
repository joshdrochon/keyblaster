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
 * THREE LAYERS, and the third is the exact one. Attribution phrases and
 * misspelling fingerprints are guesses about what a future quote will look
 * like, and they missed a real leak: DirectorMapScene quoted a report verbatim,
 * typo included, and this script passed it because the sentence happened to
 * contain none of the listed fingerprints.
 *
 * The third layer does not guess. Every verbatim report is already recorded in
 * gauntlet/user-reported.json under `said`, so the quotes are enumerable: any
 * run of QUOTE_WINDOW consecutive words from any `said` value, appearing in a
 * tracked file, IS the quote. That catches every past and future report by
 * construction rather than by pattern-matching a typo someone remembered.
 *
 * A miss is still not a licence - the rule is "never quote", not "never trip
 * this script".
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

/** Phrases that introduce someone else's words. */
const ATTRIBUTION = [
  /\bthe user (said|reported|wrote|put it|called it|noticed|asked)\b/i,
  /\ba player(,| on| looked| said| reported| wrote)[^.\n]{0,40}["“]/i,
  /\bthe report (says|calls|reads|puts it)\b/i,
  /\bTHE REPORT:/,
  /\buser'?s own words\b/i,
  // Second person is still attribution. Found in docs/SUBMIT.md, which is
  // tracked: "which is exactly the mistake you caught" and "You asked whether".
  /\byou (asked|said|reported|complained|caught|flagged|pointed out|called it)\b/i,
  /\bexactly the mistake you\b/i,
];

/**
 * How many consecutive words must match a recorded report before it counts as
 * a quote. Five is too loose - "should not be on the screen" is ordinary
 * English that a comment may legitimately contain. Eight is too strict, since
 * quotes get trimmed mid-sentence when they are pasted. Six was chosen by
 * running both bounds over the whole tracked corpus: at 5 it flagged 3 lines
 * that were paraphrase, at 6 it flagged only the real leak, at 8 it flagged
 * nothing and missed it.
 */
export const QUOTE_WINDOW = 6;

/** Lowercase, strip punctuation, collapse runs of whitespace. */
export function normalise(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every run of QUOTE_WINDOW consecutive words across every recorded report.
 * Returns a Set, so the per-line scan is a hash lookup rather than a scan of
 * every report for every line of the repo.
 */
export function buildQuoteWindows(reports) {
  const windows = new Set();
  for (const report of reports) {
    const said = typeof report?.said === "string" ? report.said : "";
    if (said === "") continue;
    const words = normalise(said).split(" ").filter(Boolean);
    for (let i = 0; i + QUOTE_WINDOW <= words.length; i += 1) {
      windows.add(words.slice(i, i + QUOTE_WINDOW).join(" "));
    }
  }
  return windows;
}

/**
 * An escape hatch, because layer 3 has an irreducible false-positive tail: a
 * report may repeat an ordinary six-word run that a technical comment also
 * contains ("the only text in the game under ..."). Paraphrasing correct
 * engineering prose to satisfy a lint makes the prose worse, so the line can
 * say why it is not a quote instead:
 *
 *   // no-user-quotes-ok: describes the contrast bar, not a report
 *
 * A bare marker is NOT enough - the reason is mandatory, so that suppressing a
 * real leak costs a sentence someone has to write and a reviewer can read.
 */
export const SUPPRESSION = /no-user-quotes-ok:\s*\S+/;

/**
 * The reason a line is a hit, or undefined. Pure, so the test can drive it
 * without a git checkout or a filesystem.
 */
export function scanLine(line, quoteWindows) {
  if (SUPPRESSION.test(line)) return undefined;
  for (const re of ATTRIBUTION) if (re.test(line)) return "attribution";
  for (const re of FINGERPRINTS) if (re.test(line)) return "fingerprint";
  if (quoteWindows !== undefined && quoteWindows.size > 0) {
    const words = normalise(line).split(" ").filter(Boolean);
    for (let i = 0; i + QUOTE_WINDOW <= words.length; i += 1) {
      if (quoteWindows.has(words.slice(i, i + QUOTE_WINDOW).join(" "))) {
        return "verbatim";
      }
    }
  }
  return undefined;
}

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

/**
 * Phrases the GAME says. When a report quotes the game's own copy back - the
 * tagline, a coach line, an on-screen instruction - layer 3 would otherwise
 * flag the shipped string itself as a quote of the person who read it aloud.
 * It is the opposite: the words are the product's, and they must stay exactly
 * as they are. Subtracting this set from the report windows is what makes the
 * difference between "their words" and "our words they repeated".
 *
 * Sourced from the files that DEFINE shipped copy, so it cannot drift from
 * what the game actually says.
 */
export const COPY_SOURCES = [
  "src/engine/i18n/strings.ts",
  "src/engine/coach/mock.ts",
  // A DIRECTORY, deliberately. Copy does not live in one file: it is every
  // src/content/<lang>/*.json, nine of them in en alone, plus the es and hi
  // siblings that are cut from the shipped menu but still tracked. Listing
  // paths meant ui.json was missed, which cost two suppressions in scenes
  // whose comments name an on-screen string - the gate was calling the game's
  // own words a quote of the person who read them.
  "src/content",
];

/** Every .json under a directory, recursively; [] if it is not one. */
function jsonFilesUnder(dir) {
  if (!existsSync(dir)) return [];
  let entries;
  try {
    if (!statSync(dir).isDirectory()) return [dir];
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...jsonFilesUnder(full));
    else if (e.name.endsWith(".json")) out.push(full);
  }
  return out;
}

export function buildCopyWindows(sources = COPY_SOURCES, read = readFileSync) {
  const windows = new Set();
  const expanded = sources.flatMap((s) =>
    existsSync(s) && statSync(s).isDirectory() ? jsonFilesUnder(s) : [s],
  );
  for (const file of expanded) {
    if (!existsSync(file)) continue;
    // Every double-quoted literal in the file, which is where copy lives in
    // both a TS string table and a JSON story file.
    const text = read(file, "utf8");
    for (const [, literal] of text.matchAll(/"([^"\\\n]{8,})"/g)) {
      const words = normalise(literal).split(" ").filter(Boolean);
      for (let i = 0; i + QUOTE_WINDOW <= words.length; i += 1) {
        windows.add(words.slice(i, i + QUOTE_WINDOW).join(" "));
      }
    }
  }
  return windows;
}

/**
 * The recorded reports, or [] when the internal file is absent. It is
 * UNTRACKED by design - it is the file that is allowed to quote - so a clean
 * checkout, CI, or a fresh clone has no copy. Layers 1 and 2 still run there;
 * only the exact layer needs the corpus. Failing the commit because the
 * private file is missing would be this check breaking every clone, which it
 * has no business doing.
 */
export function loadReports(path = "gauntlet/user-reported.json") {
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (Array.isArray(parsed)) return parsed;
    const nested = parsed.reports ?? parsed.tickets ?? Object.values(parsed).find(Array.isArray);
    return Array.isArray(nested) ? nested : [];
  } catch {
    return [];
  }
}

export function main() {
  const files = execSync("git ls-files src tests docs scripts", { encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.(ts|tsx|mjs|js|md|json|sh)$/.test(f));

  const copyWindows = buildCopyWindows();
  const quoteWindows = buildQuoteWindows(loadReports());
  for (const w of copyWindows) quoteWindows.delete(w);
  const hits = [];
  for (const file of files) {
    if (file === "scripts/no-user-quotes.mjs") continue;
    // A tracked path is not necessarily a path on disk: a lane may have
    // deleted a file whose deletion is not staged yet. Skipping is right - a
    // file that does not exist cannot quote anyone - and throwing here would
    // break every commit in the repo.
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      const reason = scanLine(line, quoteWindows);
      if (reason === undefined) return;
      hits.push({ file, line: i + 1, reason, text: line.trim().slice(0, 120) });
    });
  }

  if (hits.length > 0) {
    console.error(
      `\nno-user-quotes: ${hits.length} tracked line(s) quote or attribute a report.\n` +
        `The repo is submitted. Keep the reasoning, cite the UR- id, drop the words.\n`,
    );
    for (const h of hits) console.error(`  ${h.file}:${h.line}  [${h.reason}]  ${h.text}`);
    console.error("");
    return 1;
  }
  console.log(
    `no-user-quotes: OK (${files.length} tracked files, ${quoteWindows.size} quote windows)`,
  );
  return 0;
}

// Only run as a CLI. Importing this module from a test must not scan the repo
// or call process.exit.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
