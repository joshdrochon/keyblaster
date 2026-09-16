import { describe, expect, it } from "vitest";
import { CHARS_PER_WORD, accuracy, wpm } from "@engine/scoring/index.js";

describe("wpm", () => {
  it("uses the documented definition: (characters / 5) / minutes", () => {
    expect(CHARS_PER_WORD).toBe(5);
    // 300 chars in 60 s = 60 words in 1 minute = 60 wpm.
    expect(wpm(300, 60_000)).toBe(60);
    // Same characters in half the time doubles the rate.
    expect(wpm(300, 30_000)).toBe(120);
  });

  it("is linear in characters and inverse in time", () => {
    expect(wpm(150, 60_000)).toBe(30);
    expect(wpm(300, 120_000)).toBe(30);
  });

  it("handles fractional results without rounding", () => {
    // 7 chars in 10 s: (7/5) / (1/6) = 8.4
    expect(wpm(7, 10_000)).toBeCloseTo(8.4, 10);
  });

  it("returns 0 for zero elapsed time instead of Infinity", () => {
    expect(wpm(100, 0)).toBe(0);
    expect(Number.isFinite(wpm(100, 0))).toBe(true);
  });

  it("returns 0 for negative elapsed time (clock ran backwards)", () => {
    expect(wpm(100, -5_000)).toBe(0);
  });

  it("returns 0 when no characters were typed", () => {
    expect(wpm(0, 60_000)).toBe(0);
    expect(wpm(-3, 60_000)).toBe(0);
  });
});

describe("accuracy", () => {
  it("uses the documented definition: hits / (hits + typos)", () => {
    expect(accuracy(9, 1)).toBe(0.9);
    expect(accuracy(17, 3)).toBe(0.85);
  });

  it("is 1 with no typos", () => {
    expect(accuracy(20, 0)).toBe(1);
  });

  it("returns 1 for zero attempts rather than 0 or NaN (D31)", () => {
    // A 0% on a results screen for a stage nobody typed in would be a false
    // failure signal; with no evidence of a typo the vacuous answer is 1.
    expect(accuracy(0, 0)).toBe(1);
  });

  it("clamps negative counters instead of producing a value out of [0, 1]", () => {
    expect(accuracy(-5, 10)).toBe(0);
    expect(accuracy(10, -5)).toBe(1);
  });

  it("stays within [0, 1] for a range of tallies", () => {
    for (let hits = 0; hits <= 50; hits += 7) {
      for (let typos = 0; typos <= 50; typos += 11) {
        const a = accuracy(hits, typos);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
      }
    }
  });
});
