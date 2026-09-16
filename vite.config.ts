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
    include: ["tests/unit/**/*.test.ts"],
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
