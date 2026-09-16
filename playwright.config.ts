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

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: path.join("test-results", runId),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:5183",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --port 5183 --strictPort",
    url: "http://localhost:5183",
    // Never reuse: port 5173 is taken by an unrelated project on this machine,
    // and a reused foreign server silently passes/fails the whole suite.
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
