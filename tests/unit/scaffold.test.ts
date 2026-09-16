import { describe, expect, it } from "vitest";

/**
 * Scaffold smoke test (FIRST TASK 1). Proves the Vitest + TS + alias
 * toolchain runs before any engine module exists.
 */
describe("toolchain", () => {
  it("runs TypeScript under Vitest", () => {
    const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
    expect(sum([1, 2, 3])).toBe(6);
  });

  it("has strict TS semantics available", () => {
    const xs: readonly string[] = ["a"];
    // noUncheckedIndexedAccess makes this string | undefined
    const first: string | undefined = xs[0];
    expect(first).toBe("a");
  });
});
