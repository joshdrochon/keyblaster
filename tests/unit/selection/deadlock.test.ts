import { describe, expect, it } from "vitest";
import {
  type SelectionState,
  createSelectionState,
  firstLetter,
  pickNext,
} from "@engine/selection/index.js";
import type { WordBook } from "@engine/words/index.js";
import { COLLIDING_WORDS, masteredRecord, seen, uniformBook } from "./fixtures.js";
import { mulberry32, randInt, shuffled } from "./rng.js";

/**
 * The three-way deadlock between AC-2.1 (first-letter uniqueness), AC-9.2
 * (forced guaranteed-catch) and AC-9.1 (no repeats), plus AC-9.4's in-stage
 * ban. Each of these states is reachable in ordinary play, and in each one at
 * least one rule MUST give. The precedence is documented at the top of
 * src/engine/selection/picker.ts; these tests pin it down so it cannot drift.
 *
 * Every case asserts the same two things the child cares about: the picker
 * does not throw, and it does not return undefined.
 */

/** Hand-build a mid-stage state. Cheaper and clearer than replaying spawns. */
function midStage(
  base: SelectionState,
  over: Partial<SelectionState>,
): SelectionState {
  return { ...base, ...over };
}

describe("deadlock: AC-2.1 vs AC-9.1", () => {
  it("AC-2.1 wins: a repeat is served rather than a shared first letter", () => {
    const pool = ["ant", "arm", "apple", "bird"];
    const state = midStage(createSelectionState({ stage: 1, stagePool: pool }), {
      usedStage: ["bird"],
      servedStage: ["bird"],
      spawnCount: 1,
    });
    // "a" is taken by a live asteroid, so the only three unspawned words are
    // illegal; "bird" is legal but already served this cycle.
    for (let seed = 1; seed <= 20; seed += 1) {
      const out = pickNext(state, { live: ["apple"], book: {}, rng: mulberry32(seed) });
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.word).toBe("bird");
      expect(out.relaxed).toContain("repeat");
      expect(firstLetter(out.word)).not.toBe("a");
    }
  });
});

describe("deadlock: AC-9.2 vs AC-9.1", () => {
  it("AC-9.2 wins: the forced slot repeats the only catch word", () => {
    const pool = ["cat", "apple", "bird", "dog", "egg", "fish"];
    const book: WordBook = uniformBook(pool, () => seen(1.5));
    book["cat"] = masteredRecord();
    const state = midStage(createSelectionState({ stage: 1, stagePool: pool, book }), {
      usedStage: ["cat"],
      servedStage: ["cat"],
      spawnCount: 5,
      sinceCatch: 5,
    });
    const out = pickNext(state, { live: [], book, rng: mulberry32(2) });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.word).toBe("cat");
    expect(out.forcedCatch).toBe(true);
    expect(out.guaranteedCatch).toBe(true);
    expect(out.relaxed).toEqual(["repeat"]);
  });
});

describe("deadlock: AC-9.2 with no catch word in the pool at all", () => {
  it("AC-9.2 degrades and SAYS SO; it never stalls (EASE_NEW makes this common)", () => {
    // Every word in a first-ever stage pool starts at EASE_NEW 1.6, so this is
    // not an exotic state - it is spawn 6 of a brand-new profile.
    const pool = ["apple", "bird", "cat"];
    const book = uniformBook(pool, () => seen(1.6));
    const state = midStage(createSelectionState({ stage: 1, stagePool: pool, book }), {
      spawnCount: 5,
      sinceCatch: 5,
    });
    const out = pickNext(state, { live: [], book, rng: mulberry32(3) });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(pool).toContain(out.word);
    expect(out.forcedCatch).toBe(true);
    expect(out.guaranteedCatch).toBe(false);
    expect(out.relaxed).toContain("catch");
  });
});

describe("deadlock: all three at once", () => {
  it("AC-2.1 > AC-9.2 > AC-9.1: the blocked catch word is skipped, not smuggled in", () => {
    const pool = ["cat", "dog", "egg"];
    const book: WordBook = uniformBook(pool, () => seen(1.5));
    book["cat"] = masteredRecord(); // the only catch, and its letter is live
    const state = midStage(createSelectionState({ stage: 1, stagePool: pool, book }), {
      spawnCount: 5,
      sinceCatch: 5,
    });
    for (let seed = 1; seed <= 20; seed += 1) {
      const out = pickNext(state, { live: ["cow"], book, rng: mulberry32(seed) });
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(["dog", "egg"]).toContain(out.word);
      expect(out.relaxed).toContain("catch");
      expect(out.relaxed).not.toContain("repeat");
    }
  });
});

describe("deadlock: AC-9.4's in-stage ban is the last rule to break", () => {
  it("AC-9.4: when every word is banned for this stage, the ban gives way, not the spawn", () => {
    const pool = ["apple", "bird"];
    const book: WordBook = {
      apple: seen(1.9, { nextEligibleStage: 4, misses: 1 }),
      bird: seen(1.9, { nextEligibleStage: 4, misses: 1 }),
    };
    const state = midStage(createSelectionState({ stage: 3, stagePool: pool, book }), {
      usedStage: ["bird"],
      servedStage: ["apple", "bird"],
      spawnCount: 2,
    });
    const out = pickNext(state, { live: [], book, rng: mulberry32(4) });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(pool).toContain(out.word);
    expect(out.relaxed).toContain("eligibility");
  });
});

describe("deadlock: the board itself is the blocker", () => {
  it("AC-2.1: a fully blocked board yields no-legal-word instead of a collision", () => {
    const state = createSelectionState({ stage: 1, stagePool: ["ant", "arm"] });
    const out = pickNext(state, { live: ["apple"], book: {}, rng: mulberry32(5) });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("no-legal-word");
    // State is untouched: nothing was spawned, so no counter moved.
    expect(out.state).toEqual(state);
  });

  it("no-legal-word can only happen with asteroids already on screen", () => {
    // The anti-stall proof in picker.ts, exercised over randomised states.
    let blockedSeen = 0;
    for (let seed = 1; seed <= 4000; seed += 1) {
      const rng = mulberry32(seed);
      const pool = shuffled(COLLIDING_WORDS, rng).slice(0, 2 + randInt(rng, 5));
      const state = createSelectionState({ stage: 1 + randInt(rng, 6), stagePool: pool });
      const live = shuffled(COLLIDING_WORDS, rng).slice(0, randInt(rng, 6));
      const out = pickNext(state, { live, book: {}, rng });
      if (!out.ok) {
        blockedSeen += 1;
        expect(live.length).toBeGreaterThan(0);
      }
    }
    expect(blockedSeen).toBeGreaterThan(0);
  });

  it("an empty board ALWAYS yields a word - the game can never be stalled", () => {
    for (let seed = 1; seed <= 4000; seed += 1) {
      const rng = mulberry32(seed);
      const pool = shuffled(COLLIDING_WORDS, rng).slice(0, 1 + randInt(rng, 8));
      const state = createSelectionState({ stage: 1 + randInt(rng, 6), stagePool: pool });
      const out = pickNext(state, { live: [], book: {}, rng });
      expect(out.ok).toBe(true);
      if (out.ok) expect(typeof out.word).toBe("string");
    }
  });
});

describe("the picker is total", () => {
  const state = createSelectionState({
    stage: 3,
    stagePool: ["apple", "bird", "cat"],
    retentionPool: ["dog", "egg"],
  });

  it("survives live words that are not in any pool, and empty live entries", () => {
    expect(() =>
      pickNext(state, { live: ["zebra", "", "   "], book: {}, rng: mulberry32(6) }),
    ).not.toThrow();
  });

  it("survives a degenerate rng at both ends of the range", () => {
    for (const rng of [() => 0, () => 1, () => 0.999999]) {
      const out = pickNext(state, { live: [], book: {}, rng });
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.word.length).toBeGreaterThan(0);
    }
  });

  it("survives a missing lastSeenStage map", () => {
    const out = pickNext(state, { live: [], book: {}, rng: mulberry32(7) });
    expect(out.ok).toBe(true);
  });
});
