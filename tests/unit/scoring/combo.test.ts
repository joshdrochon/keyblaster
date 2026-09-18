import { describe, expect, it } from "vitest";
import { MAX_WORD_LENGTH } from "@engine/allowlist/index.js";
import {
  INITIAL_COMBO_STATE,
  LENGTH_BONUS_FLOOR,
  LENGTH_BONUS_PER_LETTER,
  MAX_MULTIPLIER,
  POINTS_PER_LETTER,
  comboReducer,
  comboState,
  hudMultiplierFor,
  multiplierFor,
  scoreWordWithCombo,
  wordBaseScore,
  wordScore,
} from "@engine/scoring/index.js";
import { CATCH_MAX_LENGTH } from "@engine/selection/index.js";
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

describe("wordBaseScore (`UR-72`: the length curve, with the combo out of the way)", () => {
  it("`UR-72`: the shipped table, written out by hand from the formula", () => {
    // Independent oracle. Computed with a calculator from
    // `len x 20 + 10 x max(0, len - 4)^2`, NOT by calling the function, so a
    // sign flip or a floor/ceil slip in the implementation shows up here.
    // WATCHED FAILING, negative control 1 - `LENGTH_BONUS_PER_LETTER` forced to
    // 0, i.e. the linear curve that shipped:
    //   AssertionError: expected [ Array(12) ] to deeply equal [ Array(12) ]
    //   - 110  + 100   (and 120, 140, 180, 200, 220, 240, 260 for the rest)
    // Negative control 2 - `LENGTH_BONUS_FLOOR` moved 4 -> 5 - fails the same
    // row at len 5 and 6 instead: - 110 - 160 received 100 and 140.
    const table = [40, 60, 80, 110, 160, 230, 320, 430, 560, 710, 880, 1070];
    const actual: number[] = [];
    for (let len = 2; len <= MAX_WORD_LENGTH; len++) actual.push(wordBaseScore(len));
    expect(actual).toEqual(table);
  });

  it("`UR-72`: nothing at or below the guaranteed-catch length moved at all", () => {
    // The half of this change that is about D31: a pilot who can only reach
    // short rocks scores exactly what they scored before. Only reach was
    // rewarded; nothing was taken away.
    for (let len = 1; len <= LENGTH_BONUS_FLOOR; len++) {
      expect(wordBaseScore(len), `len ${len}`).toBe(len * POINTS_PER_LETTER);
    }
    // And the very next letter is the first one that earns a bonus.
    // WATCHED FAILING, negative control 1:
    //   AssertionError: expected 100 to be 110 // Object.is equality
    expect(wordBaseScore(LENGTH_BONUS_FLOOR + 1)).toBe(
      (LENGTH_BONUS_FLOOR + 1) * POINTS_PER_LETTER + LENGTH_BONUS_PER_LETTER,
    );
  });

  it("`UR-72`: the floor is AC-9.2's guaranteed-catch length, not a loose number", () => {
    // combo.ts duplicates this rather than importing selection/. The tie is
    // asserted HERE so that the selection lane moving its number turns this
    // red instead of silently shifting where the score curve bends.
    // WATCHED FAILING, negative control 2 (`LENGTH_BONUS_FLOOR` set to 5):
    //   AssertionError: expected 5 to be 4 // Object.is equality
    expect(LENGTH_BONUS_FLOOR).toBe(CATCH_MAX_LENGTH);
  });

  it("`UR-72`: the curve is strictly increasing and accelerating", () => {
    // The property the linear curve did NOT have. `deltas` must themselves
    // grow, which is what "a long word is worth reaching for" means.
    const deltas: number[] = [];
    for (let len = 2; len <= MAX_WORD_LENGTH; len++) {
      deltas.push(wordBaseScore(len) - wordBaseScore(len - 1));
    }
    for (let i = 1; i < deltas.length; i++) {
      expect(deltas[i], `delta at len ${i + 2}`).toBeGreaterThanOrEqual(
        deltas[i - 1] as number,
      );
    }
    // Strictly accelerating past the floor, flat below it.
    // WATCHED FAILING, negative control 1:
    //   AssertionError: expected 20 to be greater than 80
    expect(deltas[0]).toBe(POINTS_PER_LETTER);
    expect(deltas[deltas.length - 1]).toBeGreaterThan(POINTS_PER_LETTER * 4);
  });

  it("junk length is worth nothing and a fraction never rounds up into a band", () => {
    // WATCHED FAILING with the `Number.isFinite(...) || <= 0` guard deleted:
    //   AssertionError: expected -60 to be +0 // Object.is equality
    // A negative length does not just score nothing without the guard, it MINTS
    // a negative score, which is the one shape D31 rules out entirely.
    expect(wordBaseScore(0)).toBe(0);
    expect(wordBaseScore(-3)).toBe(0);
    expect(wordBaseScore(Number.NaN)).toBe(0);
    expect(wordBaseScore(Number.POSITIVE_INFINITY)).toBe(0);
    // 4.9 is a 4-letter word's worth, not a 5-letter word's.
    expect(wordBaseScore(4.9)).toBe(wordBaseScore(4));
  });
});

describe("`UR-72`: a long word beats the short words it costs", () => {
  /**
   * The bar the constant was chosen against, asserted rather than asserted-in-
   * a-comment. A nine-letter word has to beat TWO four-letter words at every
   * combo, including x10 where the short pair is capped too - otherwise the
   * cheapest way to score is still to ignore the long rocks, which is the
   * behaviour `UR-72` is about: the long rock is the one to leave alone.
   */
  const twoShortWords = (startCombo: number): number => {
    let s = comboState(startCombo);
    let total = 0;
    for (let i = 0; i < 2; i++) {
      const r = scoreWordWithCombo(s, 4);
      s = r.combo;
      total += r.points;
    }
    return total;
  };

  it("`UR-72`: one 9-letter word outscores two 4-letter words at every combo", () => {
    // WATCHED FAILING, negative control 1 (the shipped linear curve), at the
    // very first combo:
    //   AssertionError: combo 0: expected 180 to be greater than 240
    // The long word LOST by 60 points while costing an extra keystroke. That
    // is the defect `UR-72` reports, measured.
    for (let start = 0; start <= 15; start++) {
      const long = scoreWordWithCombo(comboState(start), 9).points;
      expect(long, `combo ${start}`).toBeGreaterThan(twoShortWords(start));
    }
  });

  it("`UR-72`: the exact numbers at the two ends of the multiplier", () => {
    // Fresh chain: 430 against 80 + 160.
    // WATCHED FAILING, negative control 1: expected 180 to be 430.
    // WATCHED FAILING, negative control 2: expected 340 to be 430.
    expect(scoreWordWithCombo(INITIAL_COMBO_STATE, 9).points).toBe(430);
    expect(twoShortWords(0)).toBe(240);
    // Capped chain: both sides at x10.
    expect(scoreWordWithCombo(comboState(10), 9).points).toBe(4300);
    expect(twoShortWords(10)).toBe(1600);
  });

  it("`UR-72`: a 4-letter word and a 9-letter word, side by side", () => {
    // The two numbers the report asks for, at a fixed multiplier so the
    // comparison is about length and nothing else.
    // WATCHED FAILING, negative control 1: expected 180 to be 430.
    expect(wordScore(4, 1)).toBe(80);
    expect(wordScore(9, 1)).toBe(430);
    expect(wordScore(4, 10)).toBe(800);
    expect(wordScore(9, 10)).toBe(4300);
  });

  it("`UR-72`: per-keystroke reward now rises with length instead of being flat", () => {
    // The root cause in one assertion. Under `len x 20` this was 20 for every
    // length, so length was never an incentive - the combo advancing per WORD
    // made it an active disincentive.
    // WATCHED FAILING, negative control 1:
    //   expected 20 to be close to 47.78, received difference is 27.78
    // WATCHED FAILING, negative control 2:
    //   expected 37.77777777777778 to be close to 47.78
    const perKey = (len: number): number => wordBaseScore(len) / len;
    expect(perKey(4)).toBe(20);
    expect(perKey(9)).toBeCloseTo(47.78, 2);
    for (let len = LENGTH_BONUS_FLOOR + 1; len <= MAX_WORD_LENGTH; len++) {
      expect(perKey(len), `len ${len}`).toBeGreaterThan(perKey(len - 1));
    }
  });
});

describe("wordScore", () => {
  it("`UR-72`: base curve times the capped multiplier", () => {
    // WATCHED FAILING, negative control 1: expected 300 to be 330.
    expect(POINTS_PER_LETTER).toBe(20);
    expect(wordScore(5, 3)).toBe(wordBaseScore(5) * 3);
    expect(wordScore(5, 3)).toBe(330);
    expect(wordScore(9, 1)).toBe(430);
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
    expect(scoreWordWithCombo(s, 5).points).toBe(wordBaseScore(5));
    expect(scoreWordWithCombo(s, 5).points).toBe(110);
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
    expect(scoreWordWithCombo(INITIAL_COMBO_STATE, 5).points).toBe(110);
  });
});
