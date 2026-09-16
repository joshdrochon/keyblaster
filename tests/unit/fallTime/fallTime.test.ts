import { describe, expect, it } from "vitest";
import {
  FALL_TIME_MAX_MS,
  FALL_TIME_MIN_MS,
  KEYSTROKE_BUDGET_FACTOR,
  RECOGNITION_BASE_MS,
  clampFallTime,
  fallTimeMs,
  isClamped,
  keystrokeBudgetMs,
  rawFallTimeMs,
  recognitionBudgetMs,
} from "@engine/fallTime/index.js";
import { DEFAULT_CALIBRATION, EASE_MAX, EASE_MIN } from "@engine/types.js";

/** Deterministic PRNG so property runs are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("constants match PRD FR-8 exactly", () => {
  it("uses the documented numbers, not approximations", () => {
    expect(KEYSTROKE_BUDGET_FACTOR).toBe(1.5);
    expect(RECOGNITION_BASE_MS).toBe(1200);
    expect(FALL_TIME_MIN_MS).toBe(2500);
    expect(FALL_TIME_MAX_MS).toBe(14000);
    expect(DEFAULT_CALIBRATION.ikiMs).toBe(350);
  });
});

describe("AC-8.1: formula implemented exactly", () => {
  it("is len * 1.5 * iki + 1200 * ease", () => {
    // 6 letters, iki 400, ease 1.0 -> 6*1.5*400 + 1200 = 3600 + 1200 = 4800
    const ms = fallTimeMs({
      word: "planet",
      ease: 1.0,
      calibration: { ikiMs: 400, fkLatencyMs: 500 },
    });
    expect(ms).toBe(4800);
  });

  it("defaults the inter-key interval to 350 ms when uncalibrated", () => {
    // 4 letters, default iki 350, ease 1.0 -> 4*1.5*350 + 1200 = 2100 + 1200 = 3300
    expect(fallTimeMs({ word: "dust", ease: 1.0 })).toBe(3300);
  });

  it("splits into a keystroke half and a recognition half", () => {
    expect(keystrokeBudgetMs(6, 400)).toBe(3600);
    expect(recognitionBudgetMs(1.0)).toBe(1200);
    expect(recognitionBudgetMs(0.5)).toBe(600);
  });

  it("agrees with its own parts for any input", () => {
    const rand = mulberry32(20260916);
    for (let i = 0; i < 2000; i++) {
      const len = 1 + Math.floor(rand() * 13);
      const ease = EASE_MIN + rand() * (EASE_MAX - EASE_MIN);
      const ikiMs = 120 + rand() * 700;
      const word = "a".repeat(len);
      const input = { word, ease, calibration: { ikiMs, fkLatencyMs: 500 } };
      expect(rawFallTimeMs(input)).toBeCloseTo(
        keystrokeBudgetMs(len, ikiMs) + recognitionBudgetMs(ease),
        9,
      );
      expect(fallTimeMs(input)).toBe(clampFallTime(rawFallTimeMs(input)));
    }
  });
});

describe("AC-8.1: clamps hold", () => {
  it("never falls faster than the minimum", () => {
    // Shortest word, fastest typist, easiest word -> well under 2500
    const ms = fallTimeMs({
      word: "a",
      ease: EASE_MIN,
      calibration: { ikiMs: 100, fkLatencyMs: 200 },
    });
    expect(ms).toBe(FALL_TIME_MIN_MS);
  });

  it("never falls slower than the maximum", () => {
    const ms = fallTimeMs({
      word: "a".repeat(13),
      ease: EASE_MAX,
      calibration: { ikiMs: 900, fkLatencyMs: 900 },
    });
    expect(ms).toBe(FALL_TIME_MAX_MS);
  });

  it("stays inside the bounds across the whole realistic input space", () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 5000; i++) {
      const ms = fallTimeMs({
        word: "a".repeat(1 + Math.floor(rand() * 13)),
        ease: EASE_MIN + rand() * (EASE_MAX - EASE_MIN),
        calibration: { ikiMs: 80 + rand() * 900, fkLatencyMs: 500 },
      });
      expect(ms).toBeGreaterThanOrEqual(FALL_TIME_MIN_MS);
      expect(ms).toBeLessThanOrEqual(FALL_TIME_MAX_MS);
    }
  });

  it("reports whether a value was clamped, for controller telemetry", () => {
    expect(isClamped({ word: "a", ease: EASE_MIN, calibration: { ikiMs: 100, fkLatencyMs: 200 } })).toBe(true);
    expect(isClamped({ word: "planet", ease: 1.0, calibration: { ikiMs: 400, fkLatencyMs: 500 } })).toBe(false);
  });

  it("clampFallTime passes through values already in range", () => {
    expect(clampFallTime(5000)).toBe(5000);
    expect(clampFallTime(FALL_TIME_MIN_MS)).toBe(FALL_TIME_MIN_MS);
    expect(clampFallTime(FALL_TIME_MAX_MS)).toBe(FALL_TIME_MAX_MS);
  });
});

describe("AC-8.2: a known long word can fall faster than an unknown short word", () => {
  it("uses the PRD's own worked example", () => {
    // The PRD names these two explicitly: dinosaur at ease 0.3, because at 1.8.
    const dinosaur = fallTimeMs({ word: "dinosaur", ease: 0.3 });
    const because = fallTimeMs({ word: "because", ease: 1.8 });
    expect(dinosaur).toBeLessThan(because);
    // Show the arithmetic so a future reader can check it by hand:
    // dinosaur 8*1.5*350 + 1200*0.3 = 4200 +  360 = 4560
    // because  7*1.5*350 + 1200*1.8 = 3675 + 2160 = 5835
    expect(dinosaur).toBe(4560);
    expect(because).toBe(5835);
  });

  it("is non-decreasing in length, and strictly increasing above the floor", () => {
    // At the default 350 ms iki and ease 1.0 a 1- and 2-letter word both land
    // under the 2500 ms floor (2*1.5*350 + 1200 = 2250), so they clamp to the
    // same value. Strict monotonicity is therefore false at the bottom of the
    // range and only non-decreasing is true everywhere. Asserting the stronger
    // property would be asserting a bug.
    const at = (n: number) => fallTimeMs({ word: "a".repeat(n), ease: 1.0 });
    for (let n = 2; n <= 13; n++) expect(at(n)).toBeGreaterThanOrEqual(at(n - 1));
    for (let n = 4; n <= 13; n++) expect(at(n)).toBeGreaterThan(at(n - 1));
  });

  it("pins the shortest words to the floor at default calibration", () => {
    // Documented so the clamp is a known property, not a surprise: the floor
    // exists so no word is unreadably fast for a grade-2 reader (D01, D19).
    expect(fallTimeMs({ word: "a", ease: 1.0 })).toBe(FALL_TIME_MIN_MS);
    expect(fallTimeMs({ word: "at", ease: 1.0 })).toBe(FALL_TIME_MIN_MS);
    expect(fallTimeMs({ word: "dry", ease: 1.0 })).toBeGreaterThan(FALL_TIME_MIN_MS);
  });

  it("is monotonic in ease at fixed length", () => {
    const at = (ease: number) => fallTimeMs({ word: "planet", ease });
    expect(at(1.6)).toBeGreaterThan(at(0.8));
    expect(at(0.8)).toBeGreaterThan(at(0.25));
  });

  it("gives an unknown word more time than a mastered one of equal length", () => {
    // D21: unknown words get more time; mastered words become combo fodder.
    const unknown = fallTimeMs({ word: "rivers", ease: 1.6 });
    const mastered = fallTimeMs({ word: "planet", ease: 0.3 });
    expect(unknown).toBeGreaterThan(mastered);
  });
});

describe("degenerate input is total, never NaN", () => {
  it("handles the empty word", () => {
    const ms = fallTimeMs({ word: "", ease: 1.0 });
    expect(Number.isFinite(ms)).toBe(true);
    expect(ms).toBe(FALL_TIME_MIN_MS);
  });

  it("handles a zero inter-key interval without dividing by anything", () => {
    const ms = fallTimeMs({ word: "planet", ease: 1.0, calibration: { ikiMs: 0, fkLatencyMs: 0 } });
    expect(ms).toBe(FALL_TIME_MIN_MS);
  });
});
