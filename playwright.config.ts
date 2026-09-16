import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
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
