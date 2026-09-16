import { describe, expect, it } from "vitest";
import { createAllowlist } from "@engine/allowlist/index.js";
import {
  CATCH_WINDOW,
  EmptyStagePoolError,
  RETENTION_MIN_STAGE,
  RETENTION_PERCENT,
  type PickContext,
  type Picked,
  type SelectionState,
  catchIsForced,
  createSelectionState,
  pickNext,
  poolHasCatchWord,
  retentionQuota,
} from "@engine/selection/index.js";
import type { WordBook } from "@engine/words/index.js";
import {
  DISTINCT_LETTER_WORDS,
  masteredRecord,
  seen,
  uniformBook,
} from "./fixtures.js";
import { mulberry32 } from "./rng.js";

/** Drive `n` spawns with an empty board, collecting the picks. */
function runSpawns(
  start: SelectionState,
  n: number,
  ctx: Omit<PickContext, "live">,
  live: readonly string[] = [],
): { words: string[]; picks: Picked[]; state: SelectionState } {
  let state = start;
  const words: string[] = [];
  const picks: Picked[] = [];
  for (let i = 0; i < n; i += 1) {
    const out = pickNext(state, { ...ctx, live });
    expect(out.ok).toBe(true);
    if (!out.ok) break;
    words.push(out.word);
    picks.push(out);
    state = out.state;
  }
  return { words, picks, state };
}

describe("createSelectionState", () => {
  it("normalises, dedupes and keeps pool order", () => {
    const state = createSelectionState({
      stage: 1,
      stagePool: ["Apple.", "apple", "  BIRD  ", "cat"],
    });
    expect(state.stagePool).toEqual(["apple", "bird", "cat"]);
  });

  it("drops words that are not on the allowlist (D34, AC-13.1)", () => {
    const allowlist = createAllowlist({ lang: "en", words: ["apple", "bird"] });
    const state = createSelectionState({
      stage: 1,
      stagePool: ["apple", "zzzz", "bird"],
      retentionPool: ["cat", "bird"],
      allowlist,
    });
    expect(state.stagePool).toEqual(["apple", "bird"]);
    // "cat" is not allowlisted, "bird" is already this stop's curriculum.
    expect(state.retentionPool).toEqual([]);
  });

  it("keeps the retention pool disjoint from the stage pool", () => {
    const state = createSelectionState({
      stage: 3,
      stagePool: ["apple", "bird"],
      retentionPool: ["bird", "cat"],
    });
    expect(state.retentionPool).toEqual(["cat"]);
  });

  it("throws EmptyStagePoolError at SETUP for unbuildable content", () => {
    expect(() => createSelectionState({ stage: 2, stagePool: [] })).toThrow(
      EmptyStagePoolError,
    );
    expect(() => createSelectionState({ stage: 2, stagePool: ["  ", ""] })).toThrow(
      /no usable words/,
    );
  });

  it("AC-2.2: freezes the D25 tier at stage start", () => {
    const pool = ["flow", "flower"];
    expect(createSelectionState({ stage: 4, stagePool: pool }).sharedPrefixTier).toBe(false);
    expect(
      createSelectionState({
        stage: 4,
        stagePool: pool,
        book: uniformBook(pool, masteredRecord),
      }).sharedPrefixTier,
    ).toBe(true);
  });
});

describe("AC-9.1 weighted sampling without replacement", () => {
  const pool = DISTINCT_LETTER_WORDS.slice(0, 8);

  it("AC-9.1: no repeats until the stage pool is exhausted", () => {
    const state = createSelectionState({ stage: 1, stagePool: pool });
    for (let seed = 1; seed <= 25; seed += 1) {
      const { words } = runSpawns(state, pool.length, { book: {}, rng: mulberry32(seed) });
      expect(new Set(words).size).toBe(pool.length);
      expect([...words].sort()).toEqual([...pool].sort());
    }
  });

  it("AC-9.1: the bag refills after exhaustion, so a stage outlives its pool", () => {
    const state = createSelectionState({ stage: 1, stagePool: pool });
    const { words } = runSpawns(state, pool.length * 4, { book: {}, rng: mulberry32(99) });
    expect(words).toHaveLength(pool.length * 4);
    // Every cycle of `pool.length` picks is itself repeat-free.
    for (let c = 0; c < 4; c += 1) {
      const cycle = words.slice(c * pool.length, (c + 1) * pool.length);
      expect(new Set(cycle).size).toBe(pool.length);
    }
  });

  it("AC-9.1: a live word is never re-spawned, so no repeat is ever visible", () => {
    // The bag refills to empty, so the flat sequence CAN repeat a word across a
    // cycle boundary. On a real board that is invisible: the previous word is
    // still falling, and a live word is never a candidate.
    let state = createSelectionState({ stage: 1, stagePool: pool });
    const rng = mulberry32(4242);
    const live: string[] = [];
    for (let i = 0; i < 200; i += 1) {
      while (live.length >= 4) live.shift();
      const out = pickNext(state, { live, book: {}, rng });
      expect(out.ok).toBe(true);
      if (!out.ok) break;
      expect(live).not.toContain(out.word);
      live.push(out.word);
      state = out.state;
    }
  });

  it("FR-9: unknown words are drawn far more often than mastered ones (3.0 vs 0.3)", () => {
    // Weighting can only be read where the no-replacement bag is NOT the
    // binding constraint, so this takes 8 picks out of a 26-word pool and
    // repeats it over many seeds rather than draining one cycle.
    const big = [...DISTINCT_LETTER_WORDS];
    const book: WordBook = {};
    big.forEach((w, i) => {
      if (i % 2 === 0) book[w] = masteredRecord();
    });
    const state = createSelectionState({ stage: 1, stagePool: big, book });
    let mastered = 0;
    let unknown = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
      const { words } = runSpawns(state, 8, { book, rng: mulberry32(seed) });
      for (const w of words) {
        if (book[w] === undefined) unknown += 1;
        else mastered += 1;
      }
    }
    expect(unknown).toBeGreaterThan(mastered * 3);
  });
});

describe("AC-9.2 guaranteed-catch forcing", () => {
  it("AC-9.2: the window is 6 slots and forcing starts after 5 dry ones", () => {
    expect(CATCH_WINDOW).toBe(6);
    const base = createSelectionState({ stage: 1, stagePool: ["apple"] });
    expect(catchIsForced({ ...base, sinceCatch: 4 })).toBe(false);
    expect(catchIsForced({ ...base, sinceCatch: 5 })).toBe(true);
  });

  it("AC-9.2: every 6 consecutive spawns contain a catch when the pool has one", () => {
    const pool = ["apple", "bird", "cat", "dog", "egg", "fish", "goat"];
    // Only "goat" is a catch; the rest are weak, so the forced slot has exactly
    // one legal answer and the no-repeat bag has to give way to produce it.
    const book: WordBook = uniformBook(pool, () => seen(1.5));
    book["goat"] = masteredRecord();
    const state = createSelectionState({ stage: 1, stagePool: pool, book });
    const { picks } = runSpawns(state, 60, { book, rng: mulberry32(11) });
    for (let i = 0; i + CATCH_WINDOW <= picks.length; i += 1) {
      const window = picks.slice(i, i + CATCH_WINDOW);
      expect(window.some((p) => p.guaranteedCatch)).toBe(true);
    }
    const forced = picks.filter((p) => p.forcedCatch);
    expect(forced.length).toBeGreaterThan(0);
    expect(forced.every((p) => p.word === "goat" && p.guaranteedCatch)).toBe(true);
    // The forced slot never lies about what it cost: AC-9.1 is the rule that
    // gives way when the only catch word has already been served this cycle
    // (pinned exactly in deadlock.test.ts).
    expect(forced.every((p) => p.relaxed.every((r) => r === "repeat"))).toBe(true);
  });

  it("AC-9.2: an unforced slot that happens to serve a catch resets the window", () => {
    const pool = ["cat", "dog"];
    const book = uniformBook(pool, () => seen(0.9)); // both are catches
    const state = createSelectionState({ stage: 1, stagePool: pool, book });
    const { picks } = runSpawns(state, 6, { book, rng: mulberry32(3) });
    expect(picks.every((p) => p.guaranteedCatch)).toBe(true);
    expect(picks.every((p) => !p.forcedCatch)).toBe(true);
  });

  it("AC-9.2: poolHasCatchWord tells content tooling when the slot is unsatisfiable", () => {
    const pool = ["apple", "banana"];
    expect(poolHasCatchWord(pool, {})).toBe(false);
    expect(poolHasCatchWord(pool, { apple: masteredRecord() })).toBe(true);
  });
});

describe("AC-9.3 retention interleave", () => {
  const stagePool = DISTINCT_LETTER_WORDS.slice(0, 12);
  // Disjoint initials from the stage pool, all <= 4 letters at ease 0.8 so
  // every retention word is also a catch: that keeps AC-9.2's forcing from
  // firing and pulling EXTRA retention words into the sample.
  const retentionPool = ["moon", "nest", "open", "play", "run", "van"];
  const book: WordBook = {
    ...uniformBook(retentionPool, () => seen(0.8)),
  };
  const lastSeenStage: Record<string, number> = Object.fromEntries(
    retentionPool.map((w) => [w, 0]),
  );

  it("AC-9.3: the quota is 20 percent, computed in integer maths", () => {
    expect(RETENTION_PERCENT).toBe(20);
    expect([0, 1, 2, 3, 4, 5, 9, 10, 100].map(retentionQuota)).toEqual([
      0, 0, 0, 0, 0, 1, 1, 2, 20,
    ]);
  });

  it("AC-9.3: from stage 2 on, 20% (+/-1) of spawns come from earlier stops", () => {
    const state = createSelectionState({ stage: 3, stagePool, retentionPool, book });
    for (let seed = 1; seed <= 20; seed += 1) {
      const n = 100;
      const out = runSpawns(state, n, { book, lastSeenStage, rng: mulberry32(seed) });
      const retention = out.picks.filter((p) => p.source === "retention").length;
      expect(Math.abs(retention - (n * RETENTION_PERCENT) / 100)).toBeLessThanOrEqual(1);
      expect(out.state.retentionCount).toBe(retention);
    }
  });

  it("AC-9.3: retention words obey words/isEligible - overdue only", () => {
    // ease 0.8 -> intervalStages 2. Last seen at stage 2, current stage 3, so
    // only one stage has passed: nothing is due and every slot stays local.
    const recent: Record<string, number> = Object.fromEntries(
      retentionPool.map((w) => [w, 2]),
    );
    const state = createSelectionState({ stage: 3, stagePool, retentionPool, book });
    const out = runSpawns(state, 40, { book, lastSeenStage: recent, rng: mulberry32(5) });
    expect(out.picks.every((p) => p.source === "stage")).toBe(true);
  });

  it("AC-9.3: a word whose nextEligibleStage is in the future is not interleaved", () => {
    const blockedBook: WordBook = Object.fromEntries(
      retentionPool.map((w) => [w, seen(0.8, { nextEligibleStage: 9 })]),
    );
    const state = createSelectionState({
      stage: 3,
      stagePool,
      retentionPool,
      book: blockedBook,
    });
    const out = runSpawns(state, 40, { book: blockedBook, lastSeenStage, rng: mulberry32(6) });
    expect(out.picks.every((p) => p.source === "stage")).toBe(true);
  });

  it("AC-9.3: stage 1 has no earlier belt to retest, so nothing is interleaved", () => {
    expect(RETENTION_MIN_STAGE).toBe(2);
    const state = createSelectionState({ stage: 1, stagePool, retentionPool, book });
    const out = runSpawns(state, 50, { book, lastSeenStage, rng: mulberry32(7) });
    expect(out.state.retentionCount).toBe(0);
  });

  it("AC-9.3: an empty retention pool is simply never drawn from", () => {
    const state = createSelectionState({ stage: 5, stagePool });
    const out = runSpawns(state, 50, { book: {}, rng: mulberry32(8) });
    expect(out.state.retentionCount).toBe(0);
  });
});

describe("AC-9.4 a missed word waits for the next stage", () => {
  it("AC-9.4: a word missed this stage is not re-served this stage", () => {
    const pool = ["apple", "bird", "cat"];
    const state = createSelectionState({ stage: 3, stagePool: pool });
    // words/ has already written nextEligibleStage = stage + 1 for "apple".
    const book: WordBook = { apple: seen(1.9, { nextEligibleStage: 4, misses: 1 }) };
    const out = runSpawns(state, 30, { book, rng: mulberry32(21) });
    expect(out.words.filter((w) => w === "apple")).toHaveLength(1);
    expect(out.words.filter((w) => w === "bird").length).toBeGreaterThan(5);
  });

  it("AC-9.4: next stage, the same record is servable again", () => {
    const pool = ["apple", "bird", "cat"];
    const book: WordBook = { apple: seen(1.9, { nextEligibleStage: 4, misses: 1 }) };
    const state = createSelectionState({ stage: 4, stagePool: pool, book });
    const out = runSpawns(state, 30, { book, rng: mulberry32(22) });
    expect(out.words.filter((w) => w === "apple").length).toBeGreaterThan(1);
  });

  it("AC-9.4: the picker reads nextEligibleStage and never writes it (words/ owns D23)", () => {
    const pool = ["apple", "bird", "cat"];
    const book: WordBook = { apple: seen(1.9, { nextEligibleStage: 4, misses: 1 }) };
    const before = JSON.stringify(book);
    const state = createSelectionState({ stage: 3, stagePool: pool, book });
    runSpawns(state, 20, { book, rng: mulberry32(23) });
    expect(JSON.stringify(book)).toBe(before);
  });
});

describe("AC-2.1 / AC-2.2 first letters", () => {
  it("AC-2.1: a live first letter is never served again while the tier is locked", () => {
    const state = createSelectionState({ stage: 1, stagePool: ["apple", "ant", "bird"] });
    for (let seed = 1; seed <= 30; seed += 1) {
      const out = pickNext(state, { live: ["apple"], book: {}, rng: mulberry32(seed) });
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.word).toBe("bird");
    }
  });

  it("AC-2.1: live words are normalised before their letters are read", () => {
    const state = createSelectionState({ stage: 1, stagePool: ["apple", "ant", "bird"] });
    const out = pickNext(state, { live: ["  Apple. "], book: {}, rng: mulberry32(2) });
    expect(out.ok && out.word).toBe("bird");
  });

  it("AC-2.1: with the tier locked, a fully blocked board yields no spawn, not a collision", () => {
    const state = createSelectionState({ stage: 1, stagePool: ["flow", "flower"] });
    const out = pickNext(state, { live: ["flow"], book: {}, rng: mulberry32(1) });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.reason).toBe("no-legal-word");
  });

  it("AC-2.2: with the D25 tier unlocked, flow and flower may be live together", () => {
    const pool = ["flow", "flower"];
    const book = uniformBook(pool, masteredRecord);
    const state = createSelectionState({ stage: 6, stagePool: pool, book });
    expect(state.sharedPrefixTier).toBe(true);
    const out = pickNext(state, { live: ["flow"], book, rng: mulberry32(1) });
    expect(out.ok && out.word).toBe("flower");
  });

  it("a word already on screen is never spawned twice, tier or no tier", () => {
    const pool = ["flow", "flower", "flight"];
    const book = uniformBook(pool, masteredRecord);
    const state = createSelectionState({ stage: 6, stagePool: pool, book });
    for (let seed = 1; seed <= 30; seed += 1) {
      const out = pickNext(state, { live: ["flow", "flower"], book, rng: mulberry32(seed) });
      expect(out.ok && out.word).toBe("flight");
    }
  });
});
