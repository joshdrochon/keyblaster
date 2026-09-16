import { describe, expect, it } from "vitest";
import {
  INITIAL_COMBO_STATE,
  MAX_MULTIPLIER,
  POINTS_PER_LETTER,
  comboReducer,
  comboState,
  hudMultiplierFor,
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

  it("clamps non-finite and negative combos to 0 (no-reward policy)", () => {
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

  it("AC-6c.1: fixed-seed simulation - state depends only on the trailing hits", () => {
    // Deliberately NOT an oracle of min(combo, 10): re-deriving the production
    // formula in the test proves nothing. The property asserted here is one the
    // formula does not state - path independence. Whatever happened before the
    // last reset must be forgotten completely, which is what "resets" means and
    // what stops a reset count leaking into state (D31).
    // Hits at ~85%, the band the whole engine targets (PRD FR-10), so runs long
    // enough to reach the x10 cap actually occur within the sample.
    const rand = mulberry32(0x5eed);
    const seen = new Map<number, string>();
    let s = INITIAL_COMBO_STATE;
    let trailingHits = 0;
    for (let i = 0; i < 5_000; i++) {
      const roll = rand();
      const e = roll < 0.85 ? "hit" : roll < 0.93 ? "typo" : "hullHit";
      s = comboReducer(s, e);
      trailingHits = e === "hit" ? trailingHits + 1 : 0;
      const fingerprint = `${s.combo}/${s.multiplier}`;
      const first = seen.get(trailingHits);
      if (first === undefined) seen.set(trailingHits, fingerprint);
      else expect(fingerprint).toBe(first);
    }
    // The run must actually have exercised a reset and the cap.
    expect(seen.has(0)).toBe(true);
    expect([...seen.keys()].some((k) => k > MAX_MULTIPLIER)).toBe(true);
  });

  it("AC-6c.1: the first twelve multipliers match a hand-written table", () => {
    // Independent oracle: written out by hand from AC-6c.1, not computed.
    const expected = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10];
    let s = INITIAL_COMBO_STATE;
    const actual = [s.multiplier];
    for (let i = 0; i < 12; i++) {
      s = comboReducer(s, "hit");
      actual.push(s.multiplier);
    }
    expect(actual).toEqual(expected);
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

describe("combo ownership contract", () => {
  it("scoring before advancing the combo yields 0 - callers must advance first", () => {
    // This is the trap the doc comment on wordScore exists to prevent, pinned
    // so the contract cannot silently change. It is correct arithmetic for a x0
    // multiplier, not a bug, but it is also never what a caller wants.
    expect(wordScore(4, INITIAL_COMBO_STATE.multiplier)).toBe(0);
  });

  it("a caller that owns the combo uses wordScore, not scoreWordWithCombo", () => {
    // Option 1: the caller already ran the reducer for AC-3.4.
    const advanced = comboReducer(INITIAL_COMBO_STATE, "hit");
    expect(wordScore(4, advanced.multiplier)).toBe(80);
    expect(advanced.combo).toBe(1);

    // Doing both double-advances: one word, combo 2, 160 points. Pinned here so
    // the failure mode is visible in the suite rather than discovered in play.
    const doubled = scoreWordWithCombo(advanced, 4);
    expect(doubled.combo.combo).toBe(2);
    expect(doubled.points).toBe(160);
  });

  it("option 2 - this module owns the combo - gives the same result once", () => {
    const owned = scoreWordWithCombo(INITIAL_COMBO_STATE, 4);
    expect(owned.combo.combo).toBe(1);
    expect(owned.points).toBe(80);
  });
});

describe("hudMultiplierFor (AC-6c.1 display)", () => {
  it("AC-6c.1: the HUD never renders x0, including at stage start", () => {
    // AC-6c.1 says the HUD shows "xN". An "x0" on screen before the player has
    // done anything displays having nothing, which D31 rules out.
    expect(hudMultiplierFor(INITIAL_COMBO_STATE.combo)).toBe(1);
    expect(hudMultiplierFor(0)).toBe(1);
    expect(hudMultiplierFor(-3)).toBe(1);
    expect(hudMultiplierFor(Number.NaN)).toBe(1);
  });

  it("AC-6c.1: above zero it is the scoring multiplier, cap included", () => {
    for (let combo = 1; combo <= 15; combo++) {
      expect(hudMultiplierFor(combo)).toBe(multiplierFor(combo));
    }
    expect(hudMultiplierFor(40)).toBe(10);
  });

  it("the display floor never reaches the scored value", () => {
    // wordScore is computed from multiplierFor, never from hudMultiplierFor.
    expect(wordScore(5, multiplierFor(0))).toBe(0);
    expect(scoreWordWithCombo(INITIAL_COMBO_STATE, 5).points).toBe(100);
  });
});
