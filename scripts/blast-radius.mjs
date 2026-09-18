#!/usr/bin/env node
/**
 * WHO DEPENDS ON THIS, before you change it.
 *
 * WHY THIS EXISTS. A one-line edit to a shared token is a WIDE change with a
 * NARROW diff. `SPACE.rowPadX` was changed without asking this question first;
 * three test files already asserted a plate corner that depended on it and the
 * menu screens did not share an inner line, so the value was changed three
 * times - 22, 28, the gutter, back to 22 - and each attempt cost a rebuild, a
 * census capture and a full test run. Thirty minutes for a change that was two
 * minutes of work once the answer was known, and the answer was one grep away.
 *
 *   node scripts/blast-radius.mjs SPACE.rowPadX
 *   node scripts/blast-radius.mjs HINT_CONTRACT drawHint
 *
 * Prints every src/ and tests/ file that names the symbol, split so the risk is
 * visible: TESTS that assert it are what turns a small edit into a long one.
 */
import { execFileSync } from "node:child_process";

const names = process.argv.slice(2);
if (names.length === 0) {
  console.error("usage: node scripts/blast-radius.mjs <symbol> [symbol...]");
  process.exit(2);
}

const hits = (name, dir) => {
  try {
    return execFileSync("grep", ["-rl", "--include=*.ts", "--include=*.mjs", name, dir], {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
};

let worst = 0;
for (const name of names) {
  const src = hits(name, "src");
  const tests = hits(name, "tests");
  worst = Math.max(worst, src.length + tests.length);
  console.log(`\n${name}  —  ${src.length} source, ${tests.length} test`);
  for (const f of src) console.log(`   src   ${f}`);
  for (const f of tests) console.log(`   TEST  ${f}`);
}

console.log(
  `\n${worst >= 6 ? "WIDE" : worst >= 3 ? "MODERATE" : "NARROW"}: read the TEST files above` +
    " before editing. They are where a two-minute change becomes a thirty-minute one.",
);
