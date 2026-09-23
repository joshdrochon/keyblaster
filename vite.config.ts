import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@engine": path.resolve(root, "src/engine"),
      "@game": path.resolve(root, "src/game"),
      "@content": path.resolve(root, "src/content"),
    },
  },
  server: { port: 5183, strictPort: true },
  build: { target: "es2022", sourcemap: true },
  test: {
    // `tests/live` talks to the deployed endpoint and spends money, so every
    // file in it is `describe.skipIf` on an env var and collects to nothing in
    // a normal run. Included so `npx vitest run tests/live` can find it.
    include: ["tests/unit/**/*.test.ts", "tests/live/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["src/engine/**/*.ts"],
      reporter: ["text-summary", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      thresholds: { lines: 95, branches: 95, functions: 95, statements: 95 },
    },
  },
});
