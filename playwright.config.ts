import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

/**
 * Per-invocation output directory.
 *
 * Several lanes run `npx playwright test <spec>` concurrently. Playwright
 * CLEARS outputDir at the start of a run, so a second invocation deletes the
 * first one's directory and that run then dies in browserContext.close with
 * ENOENT while writing its trace - AFTER its assertions have already passed.
 *
 * The failure looks like a flaky test, which is the dangerous part: the
 * tempting "fix" is to weaken the assertion that appears to fail. Giving each
 * invocation its own directory removes the collision instead.
 */
const runId = process.env["PW_RUN_ID"] ?? String(process.pid);
const port = Number(process.env["PW_PORT"] ?? 5183);

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: path.join("test-results", runId),
  fullyParallel: true,
  /**
   * Every test boots its own Phaser WebGL game. Headless Chromium rasterises in
   * software, so N workers means N software renderers competing for the same
   * cores, and Phaser's clock then steps at a fraction of wall time - the map
   * lane measured roughly a quarter. Tests that wait on game state start timing
   * out for reasons that have nothing to do with the product.
   *
   * Three specs passed 23/23 alone and failed inside a 159-test run purely on
   * worker count. A suite whose verdict depends on machine load is not
   * measuring the product, so the worker count is pinned rather than left to
   * Playwright's CPU/2 default. Slower, and it means something.
   */
  workers: Number(process.env["PW_WORKERS"] ?? 3),
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    // Machine-readable run summary. G-e2e-whole reads this. It exists because
    // I hand-typed that evidence file once, which is exactly the defect this
    // rubric spends its time catching in other people's work: a number with no
    // producer is an assertion, not evidence.
    //
    // FOOTGUN: passing --reporter on the CLI REPLACES this whole array, so
    // `npx playwright test --reporter=line` writes no JSON and G-e2e-whole
    // stays not-implemented however green the run was. Run the suite with no
    // --reporter flag, or add json explicitly. Three full green runs produced
    // no artifact before this was noticed.
    ["json", { outputFile: "gauntlet/evidence/e2e-report.json" }],
  ],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Port derived from PW_PORT so concurrent lanes do not collide. A fixed
    // port plus reuseExistingServer:false means the second lane to start finds
    // 5183 taken and fails - which is what drove one lane to hand-roll its own
    // config on 5199. Lanes set PW_PORT; the default keeps single-run use simple.
    command: `npm run dev -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    // Never reuse: port 5173 is taken by an unrelated project on this machine,
    // and a reused foreign server silently passes/fails the whole suite.
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
