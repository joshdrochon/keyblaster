/**
 * `G-e2e-whole` asks whether the WHOLE e2e suite passed in one run. It answers
 * by reading `gauntlet/evidence/e2e-report.json`, which Playwright's json
 * reporter rewrites on EVERY invocation — including a lane re-running one spec
 * while debugging.
 *
 * WHAT EARNED THIS FILE. On 2026-09-17 that artifact was overwritten by
 * single-spec runs three times in one afternoon by three different lanes. Twice
 * it was noticed by eye. The guard at the time was `passed + failed < 100`, a
 * magic floor that half the suite clears, so a partial run of nine specs would
 * have been read as a whole-suite pass and the rubric item would have gone
 * green on it.
 *
 * The guard now compares the spec FILES the artifact covers against the
 * `.spec.ts` files on disk, which is exact and self-maintaining.
 *
 * RULE 4 (docs/coding-standards.md): each assertion below was watched failing
 * against the real implementation, and the observed value is recorded with it.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error - rubric.mjs is plain JS on purpose: scripts/gauntlet.mjs
// runs it directly with node, before and independently of any build step. A
// gate that needs compiling is a gate that can be skipped by breaking the
// build. tests/unit/appearance/shadow.test.ts types this same import the same
// way; a shared .d.mts was tried and it conflicted with that file's own
// narrower local shape.
import { RUBRIC } from "../../gauntlet/rubric.mjs";

interface E2eWholeItem {
  id: string;
  run: (ctx: { repo: string }) => Promise<{ status: string; detail: string }>;
}

const item = (RUBRIC as E2eWholeItem[]).find((i) => i.id === "G-e2e-whole") as E2eWholeItem;

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A repo-shaped scratch directory: the `.spec.ts` names the guard will look
 * for, and an artifact describing whichever of them supposedly ran.
 */
function fakeRepo(specNames: string[], coveredNames: string[], stats?: Record<string, number>): string {
  const repo = mkdtempSync(join(tmpdir(), "kb-e2e-whole-"));
  made.push(repo);
  mkdirSync(join(repo, "tests/e2e"), { recursive: true });
  mkdirSync(join(repo, "gauntlet/evidence"), { recursive: true });
  for (const name of specNames) writeFileSync(join(repo, "tests/e2e", name), "");
  writeFileSync(
    join(repo, "gauntlet/evidence/e2e-report.json"),
    JSON.stringify({
      suites: coveredNames.map((file) => ({ file, suites: [], specs: [] })),
      stats: stats ?? { expected: 300, unexpected: 0, flaky: 0, skipped: 0 },
    }),
  );
  return repo;
}

const THREE = ["alpha.spec.ts", "beta.spec.ts", "gamma.spec.ts"];

describe("G-e2e-whole rejects a partial run", () => {
  it("fails when the artifact covers only one spec file of many", async () => {
    // The real shape of the 2026-09-17 accident.
    // Watched failing with status 'pass' under the old `< 100` floor, because
    // the artifact's stats claimed 300 tests while describing one file.
    const res = await item.run({ repo: fakeRepo(THREE, ["alpha.spec.ts"]) });
    expect(res.status).toBe("fail");
    expect(res.detail).toContain("1 of 3 spec files");
  });

  it("NAMES the spec files that are missing, so the failure is actionable", async () => {
    const res = await item.run({ repo: fakeRepo(THREE, ["alpha.spec.ts"]) });
    expect(res.detail).toContain("beta.spec.ts");
    expect(res.detail).toContain("gamma.spec.ts");
  });

  it("fails a run that is large but still missing one file", async () => {
    // The case the magic floor could never catch: plenty of tests, one spec
    // silently absent. Watched failing with 'pass' before the file comparison
    // replaced the count.
    const res = await item.run({
      repo: fakeRepo(THREE, ["alpha.spec.ts", "beta.spec.ts"]),
    });
    expect(res.status).toBe("fail");
    expect(res.detail).toContain("gamma.spec.ts");
  });

  it("passes when every spec file on disk is covered and nothing failed", async () => {
    const res = await item.run({ repo: fakeRepo(THREE, THREE) });
    expect(res.status).toBe("pass");
  });

  it("still fails a complete run that had failures, and says how many", async () => {
    // Coverage is necessary, not sufficient. Watched failing with 'pass' when
    // an early return was placed before the failure check.
    const res = await item.run({
      repo: fakeRepo(THREE, THREE, { expected: 276, unexpected: 14, flaky: 0, skipped: 0 }),
    });
    expect(res.status).toBe("fail");
    expect(res.detail).toContain("14");
  });

  it("ignores directory prefixes on the artifact's file paths", async () => {
    // Playwright reports `file` relative to the config's testDir, and that
    // spelling has changed between versions. Comparing basenames means a
    // prefix change does not silently mark every spec as missing.
    const res = await item.run({ repo: fakeRepo(THREE, THREE.map((f) => `tests/e2e/${f}`)) });
    expect(res.status).toBe("pass");
  });
});
