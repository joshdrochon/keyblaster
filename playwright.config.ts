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
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
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
