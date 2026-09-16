import { describe, expect, it } from "vitest";
import {
  CATCH_MAX_EASE,
  CATCH_MAX_LENGTH,
  SELECTION_WEIGHT,
  TIER_EASE_THRESHOLD,
  TIER_UNLOCK_FRACTION,
  codePointLength,
  firstLetter,
  isGuaranteedCatch,
  sharedPrefixUnlocked,
  solidFraction,
  uniformPick,
  weightOf,
  weightedPick,
} from "@engine/selection/index.js";
import { EASE_NEW } from "@engine/types.js";
import { blankRecord } from "@engine/words/index.js";
import {
  learningRecord,
  masteredRecord,
  seen,
  unknownRecord,
  uniformBook,
  weakRecord,
} from "./fixtures.js";
import { mulberry32 } from "./rng.js";

describe("FR-9 weights", () => {
  it("FR-9: the four weights are exactly the PRD's 3.0 / 2.0 / 1.0 / 0.3", () => {
    expect(SELECTION_WEIGHT).toEqual({
      unknown: 3.0,
      weak: 2.0,
      learning: 1.0,
      mastered: 0.3,
    });
  });

  it("FR-9: weightOf maps every mastery bucket, and an absent record is unknown", () => {
    expect(weightOf(undefined)).toBe(3.0);
    expect(weightOf(unknownRecord())).toBe(3.0);
    expect(weightOf(weakRecord())).toBe(2.0);
    expect(weightOf(learningRecord())).toBe(1.0);
    expect(weightOf(masteredRecord())).toBe(0.3);
  });

  it("FR-9: the boundaries land where words/masteryOf puts them", () => {
    expect(weightOf(seen(1.21))).toBe(2.0); // ease > 1.2 is weak
    expect(weightOf(seen(1.2))).toBe(1.0); // exactly 1.2 is learning
    expect(weightOf(seen(0.5))).toBe(1.0); // exactly 0.5 is learning
    expect(weightOf(seen(0.49))).toBe(0.3); // ease < 0.5 is mastered
  });
});

describe("AC-9.2 guaranteed-catch predicate", () => {
  it("AC-9.2: a mastered word is a catch whatever its length", () => {
    expect(isGuaranteedCatch("dinosaur", masteredRecord())).toBe(true);
  });

  it("AC-9.2: a short word at or below ease 1.0 is a catch", () => {
    expect(isGuaranteedCatch("cat", seen(CATCH_MAX_EASE))).toBe(true);
    expect(isGuaranteedCatch("fish", seen(0.9))).toBe(true);
  });

  it("AC-9.2: length and ease are both required for the short-word branch", () => {
    expect(isGuaranteedCatch("apple", seen(0.9))).toBe(false); // 5 letters
    expect(isGuaranteedCatch("cat", seen(1.01))).toBe(false); // ease too high
    expect(CATCH_MAX_LENGTH).toBe(4);
  });

  it("AC-9.2: an undefined record is never a catch", () => {
    expect(isGuaranteedCatch("cat", undefined)).toBe(false);
  });

  it("AC-9.2: a BRAND-NEW pool contains no catch word, because EASE_NEW is 1.6", () => {
    // Documented spec tension, not a bug in this module: AC-9.2's forced slot
    // is unsatisfiable on a first-ever stage. The picker degrades (see
    // deadlock.test.ts) rather than stalling.
    expect(EASE_NEW).toBeGreaterThan(CATCH_MAX_EASE);
    expect(isGuaranteedCatch("cat", blankRecord())).toBe(false);
  });
});

describe("code-point helpers", () => {
  it("counts code points, not UTF-16 units (D46 content is not ASCII)", () => {
    expect(codePointLength("cat")).toBe(3);
    expect(codePointLength("घर")).toBe(2);
    expect(codePointLength("\u{1F680}ab")).toBe(3);
  });

  it("firstLetter returns one code point, and empty for an empty word", () => {
    expect(firstLetter("cat")).toBe("c");
    expect(firstLetter("\u{1F680}ab")).toBe("\u{1F680}");
    expect(firstLetter("")).toBe("");
  });
});

describe("D25 shared-prefix tier gate", () => {
  const pool = ["one", "two", "three", "four", "five"];

  it("AC-2.2: the gate is 80% of the stage pool under ease 0.6", () => {
    expect(TIER_UNLOCK_FRACTION).toBe(0.8);
    expect(TIER_EASE_THRESHOLD).toBe(0.6);
  });

  it("AC-2.2: unlocks at exactly 80%, stays locked below it", () => {
    const four = { ...uniformBook(pool.slice(0, 4), () => seen(0.5)), five: seen(1.5) };
    expect(solidFraction(pool, four)).toBeCloseTo(0.8);
    expect(sharedPrefixUnlocked(pool, four)).toBe(true);

    const three = { ...uniformBook(pool.slice(0, 3), () => seen(0.5)), four: seen(1.5), five: seen(1.5) };
    expect(solidFraction(pool, three)).toBeCloseTo(0.6);
    expect(sharedPrefixUnlocked(pool, three)).toBe(false);
  });

  it("AC-2.2: ease exactly 0.6 is NOT solid (the doc says ease < 0.6)", () => {
    expect(solidFraction(["one"], { one: seen(0.6) })).toBe(0);
    expect(solidFraction(["one"], { one: seen(0.5999) })).toBe(1);
  });

  it("an empty pool is 0% solid, never 0/0", () => {
    expect(solidFraction([], {})).toBe(0);
    expect(sharedPrefixUnlocked([], {})).toBe(false);
  });

  it("an unseen word is not solid: recordFor gives it EASE_NEW", () => {
    expect(sharedPrefixUnlocked(pool, {})).toBe(false);
  });
});

describe("weighted sampling", () => {
  it("returns undefined only for an empty list", () => {
    expect(weightedPick([], () => 1, mulberry32(1))).toBeUndefined();
    expect(uniformPick([], mulberry32(1))).toBeUndefined();
  });

  it("FR-9: draw frequencies track the weights over a seeded stream", () => {
    const rng = mulberry32(20260916);
    const weights: Record<string, number> = { u: 3.0, w: 2.0, l: 1.0, m: 0.3 };
    const counts: Record<string, number> = { u: 0, w: 0, l: 0, m: 0 };
    const n = 60_000;
    for (let i = 0; i < n; i += 1) {
      const picked = weightedPick(["u", "w", "l", "m"], (k) => weights[k] ?? 0, rng);
      expect(picked).toBeDefined();
      counts[picked as string] = (counts[picked as string] ?? 0) + 1;
    }
    const total = 6.3;
    for (const key of ["u", "w", "l", "m"]) {
      const expected = ((weights[key] ?? 0) / total) * n;
      expect(Math.abs((counts[key] ?? 0) - expected) / expected).toBeLessThan(0.05);
    }
  });

  it("falls back to a uniform pick when every weight is zero, never NaN", () => {
    const seenItems = new Set<string>();
    for (let seed = 1; seed <= 40; seed += 1) {
      const got = weightedPick(["a", "b", "c"], () => 0, mulberry32(seed));
      expect(got).toBeDefined();
      seenItems.add(got as string);
    }
    expect(seenItems.size).toBe(3);
  });

  it("ignores NaN and negative weights instead of propagating them", () => {
    const got = weightedPick(["a", "b"], (k) => (k === "a" ? Number.NaN : 5), mulberry32(7));
    expect(got).toBe("b");
    const neg = weightedPick(["a", "b"], (k) => (k === "a" ? -10 : 5), mulberry32(7));
    expect(neg).toBe("b");
  });

  it("never returns undefined for an out-of-contract rng that yields 1", () => {
    expect(weightedPick(["a", "b", "c"], () => 1, () => 1)).toBe("c");
    expect(uniformPick(["a", "b", "c"], () => 1)).toBe("c");
    expect(uniformPick(["a", "b", "c"], () => -1)).toBe("a");
  });
});
