import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@engine": path.resolve(__dirname, "src/engine"),
      "@game": path.resolve(__dirname, "src/game"),
      "@content": path.resolve(__dirname, "src/content"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/engine/**"],
      thresholds: { lines: 95, branches: 95, functions: 95, statements: 95 },
    },
  },
});
