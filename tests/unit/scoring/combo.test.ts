import { describe, expect, it } from "vitest";
import {
  INITIAL_COMBO_STATE,
  MAX_MULTIPLIER,
  POINTS_PER_LETTER,
  comboReducer,
  comboState,
  multiplierFor,
  scoreWordWithCombo,
  wordScore,
} from "@engine/scoring/index.js";
import { mulberry32 } from "./fixtures.js";

describe("multiplierFor", () => {
  it("AC-6c.1: multiplier = min(combo, 10)", () => {
    for (let combo = 0; combo <= 10; combo++) {
      expect(multiplierFor(combo)).toBe(Math.min(combo, MAX_MULTIPLIER));
    }
  });

  it("AC-6c.1: multiplier is capped at x10 above combo 10", () => {
    expect(multiplierFor(11)).toBe(10);
    expect(multiplierFor(50)).toBe(10);
    expect(multiplierFor(1_000_000)).toBe(10);
  });

  it("clamps non-finite and negative combos to 0", () => {
    expect(multiplierFor(-1)).toBe(0);
    expect(multiplierFor(Number.NaN)).toBe(0);
    expect(multiplierFor(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("floors a fractional combo", () => {
    expect(multiplierFor(3.9)).toBe(3);
  });
});

describe("comboState", () => {
  it("starts at combo 0 / multiplier 0", () => {
    expect(INITIAL_COMBO_STATE).toEqual({ combo: 0, multiplier: 0 });
  });

  it("normalises hostile input", () => {
    expect(comboState(-4)).toEqual({ combo: 0, multiplier: 0 });
    expect(comboState(Number.NaN)).toEqual({ combo: 0, multiplier: 0 });
    expect(comboState(4.7)).toEqual({ combo: 4, multiplier: 4 });
  });
});

describe("comboReducer (AC-6c.1)", () => {
  it("AC-6c.1: a hit advances the combo by one", () => {
    let s = INITIAL_COMBO_STATE;
    s = comboReducer(s, "hit");
    expect(s).toEqual({ combo: 1, multiplier: 1 });
    s = comboReducer(s, "hit");
    expect(s).toEqual({ combo: 2, multiplier: 2 });
  });

  it("AC-6c.1: combo resets on typo", () => {
    let s = INITIAL_COMBO_STATE;
    for (let i = 0; i < 7; i++) s = comboReducer(s, "hit");
    expect(s.multiplier).toBe(7);
    s = comboReducer(s, "typo");
    expect(s).toEqual(INITIAL_COMBO_STATE);
  });

  it("AC-6c.1: combo resets on hull hit", () => {
    let s = comboState(9);
    s = comboReducer(s, "hullHit");
    expect(s).toEqual(INITIAL_COMBO_STATE);
  });

  it("AC-6c.1: resetting from 0 is a no-op, never negative", () => {
    expect(comboReducer(INITIAL_COMBO_STATE, "typo")).toEqual(
      INITIAL_COMBO_STATE,
    );
    expect(comboReducer(INITIAL_COMBO_STATE, "hullHit")).toEqual(
      INITIAL_COMBO_STATE,
    );
  });

  it("AC-6c.1: multiplier stops at x10 while the combo keeps climbing", () => {
    let s = INITIAL_COMBO_STATE;
    for (let i = 0; i < 25; i++) s = comboReducer(s, "hit");
    expect(s.combo).toBe(25);
    expect(s.multiplier).toBe(10);
  });

  it("is pure: the input state is not mutated", () => {
    const start = comboState(3);
    comboReducer(start, "hit");
    comboReducer(start, "typo");
    expect(start).toEqual({ combo: 3, multiplier: 3 });
  });

  it("AC-6c.1: fixed-seed simulation keeps every invariant", () => {
    const rand = mulberry32(0x5eed);
    const events = ["hit", "typo", "hullHit"] as const;
    let s = INITIAL_COMBO_STATE;
    let expectedCombo = 0;
    for (let i = 0; i < 5_000; i++) {
      const e = events[Math.floor(rand() * events.length)] ?? "hit";
      s = comboReducer(s, e);
      expectedCombo = e === "hit" ? expectedCombo + 1 : 0;
      expect(s.combo).toBe(expectedCombo);
      expect(s.multiplier).toBe(Math.min(expectedCombo, MAX_MULTIPLIER));
      expect(s.multiplier).toBeGreaterThanOrEqual(0);
      expect(s.multiplier).toBeLessThanOrEqual(MAX_MULTIPLIER);
    }
  });
});

describe("wordScore", () => {
  it("uses the decision-log formula: length x 20 x combo", () => {
    expect(POINTS_PER_LETTER).toBe(20);
    expect(wordScore(5, 3)).toBe(5 * 20 * 3);
    expect(wordScore(9, 1)).toBe(180);
  });

  it("AC-6c.1: the multiplier used for score is capped at x10", () => {
    expect(wordScore(4, 10)).toBe(800);
    expect(wordScore(4, 40)).toBe(800);
  });

  it("returns 0 for a zero-length word or a zero multiplier", () => {
    expect(wordScore(0, 5)).toBe(0);
    expect(wordScore(5, 0)).toBe(0);
    expect(wordScore(-5, 5)).toBe(0);
    expect(wordScore(5, -5)).toBe(0);
    expect(wordScore(Number.NaN, 5)).toBe(0);
    expect(wordScore(5, Number.NaN)).toBe(0);
  });
});

describe("scoreWordWithCombo", () => {
  it("AC-6c.1: the first word of a chain scores at x1, not x0", () => {
    const { combo, points } = scoreWordWithCombo(INITIAL_COMBO_STATE, 4);
    expect(combo).toEqual({ combo: 1, multiplier: 1 });
    expect(points).toBe(80);
  });

  it("AC-6c.1: a chain of words scores at the rising multiplier", () => {
    let s = INITIAL_COMBO_STATE;
    const points: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = scoreWordWithCombo(s, 3);
      s = r.combo;
      points.push(r.points);
    }
    expect(points).toEqual([60, 120, 180, 240]);
  });

  it("AC-6c.1: after a typo the next word is back to x1", () => {
    let s = comboState(6);
    s = comboReducer(s, "typo");
    expect(scoreWordWithCombo(s, 5).points).toBe(100);
  });
});
