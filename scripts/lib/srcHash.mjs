/**
 * A content hash of everything a gauntlet result depends on.
 *
 * WHY THIS EXISTS. Staleness used to be mtime-only: `gauntlet/report.md` was
 * treated as fresh when its mtime beat the newest file under `src/`. A critic
 * showed two holes:
 *
 *   - `touch gauntlet/report.md` converted 21 UNVERIFIED rubric tickets to
 *     DONE. No code changed, no check ran, the board simply believed it.
 *   - `git checkout` rewrites every mtime under `src/`, so the answer depended
 *     on checkout ORDER rather than on content. Switching branches and back
 *     could make a stale report look current, or a current one look stale.
 *
 * mtime is the only free signal and coarse would be fine IF it failed safe.
 * It does not, so it is replaced by content. A hash cannot be touched into
 * agreement and does not care what git did to the filesystem.
 *
 * The rubric is hashed too, deliberately: a report is invalidated by a change
 * to the CHECKS as surely as by a change to the code they measure.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Files whose content a gauntlet result depends on, in a stable order. */
function inputs() {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      // Content JSON counts: palettes and word pools change what a check sees.
      else if (/\.(ts|json|mjs)$/.test(e.name)) out.push(p);
    }
  };
  walk(join(REPO, "src"));
  const rubric = join(REPO, "tests/gauntlet/rubric.mjs");
  if (existsSync(rubric)) out.push(rubric);
  return out;
}

/**
 * @returns {string} 16 hex chars — short enough to sit in a markdown header,
 *   long enough that a collision is not a practical concern at this scale.
 */
export function srcHash() {
  const h = createHash("sha256");
  for (const p of inputs()) {
    // The path is hashed as well as the bytes, so a rename is a change.
    h.update(p.slice(REPO.length + 1));
    h.update("\0");
    h.update(readFileSync(p));
    h.update("\0");
  }
  return h.digest("hex").slice(0, 16);
}

/** How many files the hash covers, for a human reading the header line. */
export function srcHashInputCount() {
  return inputs().length;
}
