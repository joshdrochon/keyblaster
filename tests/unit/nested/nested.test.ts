import { describe, expect, it } from "vitest";
import {
  NESTED_CORE_HULL_COST,
  NESTED_MAX_LIVE,
  NESTED_SHELL_HULL_COST,
  NESTED_SHELL_MAX_PX,
  NESTED_SHELL_MIN_PX,
  NESTED_SHELL_SCALE,
  NESTED_STOPS,
  ORDINARY_MAX_SIZE_PX,
  isNestedStop,
  liveWordsOf,
  nestedClearEstimateMs,
  nestedFallMs,
  nestedHullCost,
  nestedShareFor,
  nestedShellSizePx,
  nestingAllowed,
  nestingDrawPasses,
  shellBudgetFraction,
  shouldNest,
} from "@engine/nested/index.js";
import {
  MAX_SIZE_PX,
  MIN_SIZED_WORD_LENGTH,
  asteroidSizePx,
} from "@game/render/asteroid.js";
import { HULL_PASS_COST, HULL_STRIKE_COST, hullAfterStrike } from "@engine/hull/index.js";
import { nestedCrackBonus, nestedCrackScore, wordBaseScore, wordScore } from "@engine/scoring/index.js";
import { fallTimeMs } from "@engine/fallTime/index.js";
import { DEFAULT_CALIBRATION, STOP_IDS, type StopId } from "@engine/types.js";
import { EASE_NEW } from "@engine/types.js";

/**
 * D101 / UR-106: TWO-LAYER ROCKS. THE RULE, NOT THE WIRING.
 *
 * Some asteroids at the last two stops are genuinely bigger than the rest. You
 * type the word on the shell and it breaks - but only the SHELL breaks,
 * revealing a smaller rock inside carrying a SECOND word, which has to be typed
 * as well.
 *
 * This file holds the arithmetic. The three invariants the feature could have
 * broken are proved where they live rather than here:
 *
 *   AC-2.1  distinct first letters      tests/unit/nested/liveLetters.test.ts
 *   AC-22.8 no plate covers another     tests/unit/flight/plateSeparation.test.ts
 *   FR-8    a pilot can still answer it tests/unit/simulation/nestedRoute.test.ts
 *
 * EVERY NUMBER IN A HEADER BELOW WAS PRINTED BY THIS FILE, not predicted.
 * `npx vitest run tests/unit/nested --coverage.enabled=false`
 */

describe("D101 nested rocks: which stops, and how often", () => {
  it("AC-26.1: two-layer rocks exist at Neptune and Pluto and nowhere else", () => {
    expect([...NESTED_STOPS]).toEqual(["neptune", "pluto"]);
    for (const stop of STOP_IDS) {
      const expected = stop === "neptune" || stop === "pluto";
      expect(isNestedStop(stop), `${stop}`).toBe(expected);
      expect(nestedShareFor(stop) > 0, `${stop} share`).toBe(expected);
    }
  });

  it("AC-26.1: the share climbs toward the end of the route", () => {
    // MEASURED: neptune 0.22, pluto 0.3. Pluto is the last stop and the whole
    // route's difficulty slopes that way (`@engine/controller/stopBand`).
    expect(nestedShareFor("neptune")).toBe(0.22);
    expect(nestedShareFor("pluto")).toBe(0.3);
    expect(nestedShareFor("pluto")).toBeGreaterThan(nestedShareFor("neptune"));
  });

  it("AC-26.1: the draw gate fires at exactly the declared share", () => {
    // 100000 uniform draws against Pluto's 0.3. MEASURED: 30000 of 100000.
    let fired = 0;
    const n = 100_000;
    for (let i = 0; i < n; i += 1) {
      if (nestingDrawPasses("pluto", i / n)) fired += 1;
    }
    expect(fired).toBe(30_000);
    // And nothing fires at a stop that does not nest, at any draw.
    for (const stop of ["earth", "mars", "jupiter", "saturn", "uranus"] as StopId[]) {
      expect(nestingDrawPasses(stop, 0)).toBe(false);
      expect(nestingDrawPasses(stop, 0.999)).toBe(false);
    }
    // Junk is not a draw.
    expect(nestingDrawPasses("pluto", Number.NaN)).toBe(false);
  });

  it("AC-26.1: at most one two-layer rock is live at a time", () => {
    // It is AC-2.1's number, not a taste call: a nested rock holds TWO of the
    // board's distinct first letters for its whole life, so two of them would
    // need nine on a 7-deep board.
    expect(NESTED_MAX_LIVE).toBe(1);
    const base = { stopId: "pluto" as StopId, wordsLeft: 20, anyPractice: false };
    expect(nestingAllowed({ ...base, nestedLive: 0 })).toBe(true);
    expect(nestingAllowed({ ...base, nestedLive: 1 })).toBe(false);
    expect(nestingAllowed({ ...base, nestedLive: 4 })).toBe(false);
  });

  it("AC-26.1: a rock with a practice layer never nests (D21, D23)", () => {
    // A practice rock sails PAST the ship rather than into it, and a rock with
    // two words has no sensible half of that rule. The question is refused.
    const base = { stopId: "pluto" as StopId, nestedLive: 0, wordsLeft: 20 };
    expect(nestingAllowed({ ...base, anyPractice: false })).toBe(true);
    expect(nestingAllowed({ ...base, anyPractice: true })).toBe(false);
  });

  it("AC-26.1: a pair needs two of the stage's remaining words", () => {
    const base = { stopId: "pluto" as StopId, nestedLive: 0, anyPractice: false };
    expect(nestingAllowed({ ...base, wordsLeft: 2 })).toBe(true);
    expect(nestingAllowed({ ...base, wordsLeft: 1 })).toBe(false);
    expect(nestingAllowed({ ...base, wordsLeft: 0 })).toBe(false);
  });

  it("AC-26.1: shouldNest is the conjunction, and the draw is never asked first", () => {
    const gate = {
      stopId: "mars" as StopId,
      nestedLive: 0,
      wordsLeft: 40,
      anyPractice: false,
    };
    // Mars never nests however the draw lands.
    expect(shouldNest(gate, 0)).toBe(false);
    expect(shouldNest({ ...gate, stopId: "pluto" }, 0)).toBe(true);
    expect(shouldNest({ ...gate, stopId: "pluto" }, 0.99)).toBe(false);
  });
});

describe("D101 nested rocks: the shell is visibly bigger (AC-26.2)", () => {
  it("AC-26.2: the renderer's clamp and this module's copy of it agree", () => {
    // DUPLICATED, because src/engine may not import src/game (CLAUDE.md). This
    // is the assertion that stops the copy drifting - the same arrangement
    // `scoring/combo.LENGTH_BONUS_FLOOR` uses for its tie to selection/.
    expect(ORDINARY_MAX_SIZE_PX).toBe(MAX_SIZE_PX);
  });

  it("AC-26.2: every shell is bigger than every ordinary rock, at every length", () => {
    // The whole point of the floor. MEASURED over 3..40 letters:
    //   ordinary  56 .. 140      shell  168 .. 210
    // so the smallest shell clears the biggest ordinary rock by 28 px (20%).
    const lengths = Array.from({ length: 38 }, (_, i) => i + MIN_SIZED_WORD_LENGTH);
    const ordinary = lengths.map((n) => asteroidSizePx(n));
    const shells = lengths.map((n) => nestedShellSizePx(asteroidSizePx(n)));
    expect(Math.min(...ordinary)).toBe(56);
    expect(Math.max(...ordinary)).toBe(140);
    expect(Math.min(...shells)).toBe(168);
    expect(Math.max(...shells)).toBe(210);
    expect(Math.min(...shells)).toBeGreaterThan(Math.max(...ordinary));
    for (const n of lengths) {
      expect(
        nestedShellSizePx(asteroidSizePx(n)),
        `a ${n}-letter shell must beat every ordinary rock`,
      ).toBeGreaterThan(MAX_SIZE_PX);
    }
  });

  it("AC-26.2: the core is smaller than the shell it came out of", () => {
    // The core is an ORDINARY rock for its word, so it is <= 140 while every
    // shell is >= 168. There is no pair of words for which this fails.
    for (let shellLen = 3; shellLen <= 20; shellLen += 1) {
      for (let coreLen = 3; coreLen <= 20; coreLen += 1) {
        const shell = nestedShellSizePx(asteroidSizePx(shellLen));
        const core = asteroidSizePx(coreLen);
        expect(core, `core ${coreLen} inside shell ${shellLen}`).toBeLessThan(shell);
      }
    }
  });

  it("AC-26.2: shell size is non-decreasing in word length (AC-2.3 within the class)", () => {
    let previous = 0;
    for (let n = 1; n <= 40; n += 1) {
      const size = nestedShellSizePx(asteroidSizePx(n));
      expect(size).toBeGreaterThanOrEqual(previous);
      previous = size;
    }
  });

  it("AC-26.2: the scale and both clamps are the shipped numbers", () => {
    expect(NESTED_SHELL_SCALE).toBe(1.5);
    expect(NESTED_SHELL_MIN_PX).toBe(168);
    expect(NESTED_SHELL_MAX_PX).toBe(210);
    // The multiplier is what bites in the middle of the range, between the two
    // clamps. MEASURED: a 12-letter word is 128 px ordinary and 192 px shelled.
    expect(asteroidSizePx(12)).toBe(128);
    expect(nestedShellSizePx(128)).toBe(192);
    // Total on junk rather than NaN px of rock.
    expect(nestedShellSizePx(Number.NaN)).toBe(NESTED_SHELL_MIN_PX);
    expect(nestedShellSizePx(-10)).toBe(NESTED_SHELL_MIN_PX);
  });
});

describe("D101 nested rocks: the fall budget (AC-26.3, FR-8)", () => {
  it("AC-26.3: the pair gets the SUM of both words' own FR-8 budgets", () => {
    const shell = fallTimeMs({
      word: "storm",
      ease: EASE_NEW,
      calibration: DEFAULT_CALIBRATION,
    });
    const core = fallTimeMs({
      word: "ice",
      ease: EASE_NEW,
      calibration: DEFAULT_CALIBRATION,
    });
    // MEASURED at FR-8's default calibration, ease 1.6, knob floor:
    //   "storm" 4545 ms   "ice" 3495 ms   pair 8040 ms
    expect(Math.round(shell)).toBe(4545);
    expect(Math.round(core)).toBe(3495);
    expect(Math.round(nestedFallMs(shell, core))).toBe(8040);
    expect(nestedFallMs(shell, core)).toBe(shell + core);
  });

  it("AC-26.3: neither layer is answerable-by-luck - each keeps its own budget", () => {
    // THE CLAIM THAT MAKES THIS NOT A TRAP: the core's share of the pair's
    // budget is EXACTLY the budget it would have had as a rock of its own.
    // Cracking the shell inside the shell's own budget therefore hands the core
    // a full FR-8 allowance, and the shell's own budget is likewise untouched.
    for (const [a, b] of [
      ["storm", "ice"],
      ["frozen", "dim"],
      ["horizon", "far"],
    ] as const) {
      const shell = fallTimeMs({ word: a, ease: EASE_NEW, calibration: DEFAULT_CALIBRATION });
      const core = fallTimeMs({ word: b, ease: EASE_NEW, calibration: DEFAULT_CALIBRATION });
      const total = nestedFallMs(shell, core);
      expect(total - shell).toBeCloseTo(core, 9);
      expect(total - core).toBeCloseTo(shell, 9);
      // And the shell owns the first slice of the fall, the core the rest.
      expect(shellBudgetFraction(shell, core)).toBeCloseTo(shell / total, 9);
    }
  });

  it("AC-26.3: neither layer ever owns less than a quarter of the fall", () => {
    // Not a tuning claim - a legibility one. If the shell owned 95% of the fall
    // the core would flash past the ship; if it owned 5% the child would be
    // reading a second word almost at the top. Over every pair of lengths in
    // the shipped 3..12 band at ease 1.6:
    //   MEASURED min 0.298, max 0.702  (a 3-letter core behind a 12-letter
    //   shell, and the same pair the other way up)
    const fracs: number[] = [];
    for (let a = 3; a <= 12; a += 1) {
      for (let b = 3; b <= 12; b += 1) {
        const shell = fallTimeMs({
          word: "x".repeat(a),
          ease: EASE_NEW,
          calibration: DEFAULT_CALIBRATION,
        });
        const core = fallTimeMs({
          word: "x".repeat(b),
          ease: EASE_NEW,
          calibration: DEFAULT_CALIBRATION,
        });
        fracs.push(shellBudgetFraction(shell, core));
      }
    }
    expect(Number(Math.min(...fracs).toFixed(3))).toBe(0.298);
    expect(Number(Math.max(...fracs).toFixed(3))).toBe(0.702);
    // The bar the numbers are held against, stated separately from them: no
    // layer of a two-layer rock may be squeezed under a quarter of the fall.
    expect(Math.min(...fracs)).toBeGreaterThan(0.25);
    expect(Math.max(...fracs)).toBeLessThan(0.75);
  });

  it("AC-26.3: the belt is paced off what the WHOLE rock costs", () => {
    // Understate this and `@engine/pacing` feeds the board as though the
    // biggest object on it were free.
    expect(nestedClearEstimateMs(1200, 900)).toBe(2100);
    expect(nestedClearEstimateMs(Number.NaN, 900)).toBe(900);
    expect(nestedFallMs(-5, 900)).toBe(900);
    expect(shellBudgetFraction(0, 0)).toBe(1);
  });
});

describe("D101 nested rocks: the hull (AC-26.4)", () => {
  it("AC-26.4: an unbroken shell costs a whole mark, an exposed core half", () => {
    expect(NESTED_SHELL_HULL_COST).toBe(HULL_STRIKE_COST);
    expect(NESTED_CORE_HULL_COST).toBe(HULL_PASS_COST);
    expect(nestedHullCost(true)).toBe(1);
    expect(nestedHullCost(false)).toBe(0.5);
  });

  it("AC-26.4: a nested rock is never DEARER than the two rocks it replaces", () => {
    // D31 rules out a rock that punishes harder than other rocks. Two ordinary
    // rocks both missed cost 2 marks; the pair costs at most 1.
    const twoOrdinary = HULL_STRIKE_COST * 2;
    expect(nestedHullCost(true)).toBeLessThan(twoOrdinary);
    expect(nestedHullCost(false)).toBeLessThan(twoOrdinary);
  });

  it("AC-26.4: the half mark survives the running hull, two at a time", () => {
    // `hullAfterStrike` keeps fractions so two half-costs make a whole mark -
    // the property UR-91 added and the reason this reuses HULL_PASS_COST rather
    // than inventing a third constant.
    let hull = 9;
    hull = hullAfterStrike(hull, 9, nestedHullCost(false));
    expect(hull).toBe(8.5);
    hull = hullAfterStrike(hull, 9, nestedHullCost(false));
    expect(hull).toBe(8);
    hull = hullAfterStrike(hull, 9, nestedHullCost(true));
    expect(hull).toBe(7);
  });
});

describe("D101 nested rocks: scoring (AC-26.5)", () => {
  it("AC-26.5: cracking the rock pays what one word of the combined length would", () => {
    // base(a+b) - base(a) - base(b), i.e. exactly the superlinear term UR-72
    // put on length, earned by facing the letters as one job.
    // MEASURED:
    //   3+3 -> 40    4+4 -> 160   5+3 -> 150   6+5 -> 440
    expect(nestedCrackBonus(3, 3)).toBe(40);
    expect(nestedCrackBonus(4, 4)).toBe(160);
    expect(nestedCrackBonus(5, 3)).toBe(150);
    expect(nestedCrackBonus(6, 5)).toBe(440);
    for (let a = 1; a <= 12; a += 1) {
      for (let b = 1; b <= 12; b += 1) {
        expect(nestedCrackBonus(a, b)).toBe(
          wordBaseScore(a + b) - wordBaseScore(a) - wordBaseScore(b),
        );
      }
    }
  });

  it("AC-26.5: the whole rock pays exactly what one combined word would", () => {
    // The point of deriving the bonus rather than picking one: layers plus
    // bonus is base(a+b) at the multiplier, to the point.
    for (const m of [1, 3, 10]) {
      const total = wordScore(5, m) + wordScore(3, m) + nestedCrackScore(5, 3, m);
      expect(total).toBe(wordScore(8, m));
    }
  });

  it("AC-26.5: a two-layer rock beats the two ordinary rocks it replaces", () => {
    // At a flat multiplier the bonus is the whole of the difference, and it is
    // meant to be felt: MEASURED 320 against 170 at x1 for a 5+3 rock.
    expect(wordScore(5, 1) + wordScore(3, 1)).toBe(170);
    expect(wordScore(5, 1) + wordScore(3, 1) + nestedCrackScore(5, 3, 1)).toBe(320);
  });

  it("AC-26.5: the bonus is capped and total on junk, like every other score", () => {
    expect(nestedCrackScore(5, 3, 40)).toBe(nestedCrackScore(5, 3, 10));
    expect(nestedCrackScore(5, 3, 0)).toBe(0);
    expect(nestedCrackBonus(0, 5)).toBe(0);
    expect(nestedCrackBonus(Number.NaN, 5)).toBe(0);
    expect(nestedCrackBonus(5, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("D101 nested rocks: the live-word set (AC-2.1's scope)", () => {
  it("AC-26.1: a shelled rock is TWO live words, a cracked one is ONE", () => {
    expect(liveWordsOf({ word: "storm", coreWord: "ice" })).toEqual(["storm", "ice"]);
    expect(liveWordsOf({ word: "ice", coreWord: null })).toEqual(["ice"]);
    expect(liveWordsOf({ word: "ice" })).toEqual(["ice"]);
  });
});
