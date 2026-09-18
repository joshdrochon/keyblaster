/**
 * `gauntlet/evidence/e2e-report.json` is the artifact `G-e2e-whole` reads to
 * decide whether the e2e suite passes. Playwright's json reporter rewrites it
 * on EVERY invocation, so a lane re-running one spec while debugging silently
 * replaces the whole-suite result with a nine-test one.
 *
 * WHAT EARNED THIS FILE. On 2026-09-17 that artifact was clobbered FOUR times
 * in one afternoon by four different lanes. Three were repaired by hand; the
 * fourth was caught only because a lane had kept its own backup. The defect was
 * never carelessness - it was that being careful was required at all, on a file
 * every Playwright command writes.
 *
 * The destination is now derived from the command line, so a filtered run
 * physically cannot reach the evidence file.
 *
 * RULE 4 (docs/coding-standards.md): every case below was watched failing
 * against the real implementation before it was kept.
 */
import { describe, expect, it } from "vitest";

import { e2eReportPath, isFilteredRun } from "../../../playwright.config";

const EVIDENCE = "gauntlet/evidence/e2e-report.json";

describe("a filtered run cannot reach the whole-suite artifact", () => {
  it("treats a named spec file as filtered", () => {
    // The exact shape of the clobbering: `npx playwright test tests/e2e/x.spec.ts`.
    // Watched failing with the evidence path returned, before argv was consulted.
    expect(isFilteredRun(["tests/e2e/flight.spec.ts"])).toBe(true);
    expect(e2eReportPath(["tests/e2e/flight.spec.ts"], "r1")).toBe("test-results/r1/e2e-report.json");
  });

  it("treats several named specs as filtered", () => {
    const argv = ["tests/e2e/pause.spec.ts", "tests/e2e/profile.spec.ts"];
    expect(isFilteredRun(argv)).toBe(true);
  });

  it.each([
    ["-g", ["-g", "UR-53"]],
    ["--grep", ["--grep", "UR-53"]],
    ["--grep=", ["--grep=UR-53"]],
    ["--grep-invert", ["--grep-invert", "slow"]],
    ["--project", ["--project", "chromium"]],
    ["--shard", ["--shard=1/3"]],
  ])("treats %s as filtered", (_label, argv) => {
    expect(isFilteredRun(argv)).toBe(true);
  });

  it("lets an unfiltered whole-suite run write the evidence file", () => {
    expect(isFilteredRun([])).toBe(false);
    expect(e2eReportPath([], "r1")).toBe(EVIDENCE);
  });

  it("does NOT mistake a flag's value for a spec filter", () => {
    // `--workers 1` must stay a whole-suite run. Watched failing as `true`
    // when any non-dash token was treated as a positional filter: the serial
    // verification run would then never have written the evidence file, which
    // is the opposite failure and just as silent.
    expect(isFilteredRun(["--workers", "1"])).toBe(false);
    expect(e2eReportPath(["--workers", "1"], "r1")).toBe(EVIDENCE);
    expect(isFilteredRun(["--timeout", "60000"])).toBe(false);
  });

  it("handles a flag written with an equals sign", () => {
    expect(isFilteredRun(["--workers=1"])).toBe(false);
  });

  it("does not let a boolean flag swallow a following spec name", () => {
    // `--headed tests/e2e/x.spec.ts` IS filtered: --headed takes no value, so
    // the spec after it is a real filter. Watched failing as `false` before
    // BOOLEAN_FLAGS existed, which would have let a headed single-spec debug
    // run overwrite the evidence file - the precise accident being prevented.
    expect(isFilteredRun(["--headed", "tests/e2e/flight.spec.ts"])).toBe(true);
  });

  it("keeps the run id out of the shared directory entirely", () => {
    // Two lanes filtering at the same time must not collide with each other
    // either, or the fix just moves the problem.
    expect(e2eReportPath(["a.spec.ts"], "lane-a")).not.toBe(e2eReportPath(["a.spec.ts"], "lane-b"));
  });
});
