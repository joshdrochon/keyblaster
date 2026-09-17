import { describe, expect, it } from "vitest";
import {
  createSelectionState,
  isPracticeSpawn,
  pickNext,
  type Picked,
  type SelectionState,
} from "@engine/selection/index.js";
import { applyEvent, blankRecord, recordFor, type WordBook } from "@engine/words/index.js";
import { stagePoolFor } from "@game/flight/stage.js";
import { mulberry32 } from "./rng.js";
import { masteredRecord, uniformBook } from "./fixtures.js";

/**
 * AC-9.1 READ CONSECUTIVELY, and the D21/D23 practice flag.
 *
 * ================== THE DEFECT ==================
 * The player saw the same word twice in a row. AC-9.1 forbids repeats until the
 * pool is exhausted, and the picker honoured that - the bug was in the sentence
 * AFTER it. `commit` empties the no-replacement bag on the spawn that exhausts
 * the pool (`cycled`), so for exactly one slot the word that just left the
 * screen is the freshest candidate in it. The picker's own comment argued this
 * could not happen because a live word is never re-spawned and its first letter
 * is blocked - both true, and both requiring the word to still be LIVE. The
 * instant the child blasts it, neither holds.
 *
 * ================== HOW IT IS TESTED ==================
 * Not with one hand-built state. The failure needed the bag to cycle AND the
 * word to have just cleared AND the rng to land on it, which is a conjunction
 * nobody writes by hand - so these run whole stages over many seeds and assert
 * the property over every adjacent pair. The seeded rng makes that reproducible
 * rather than flaky (the invariants suite makes the same argument for AC-2.1).
 */

const MARS = stagePoolFor("mars");
const JUPITER = stagePoolFor("jupiter");
const SEEDS = 200;

interface Served {
  word: string;
  source: "stage" | "retention";
  practice: boolean;
}

/**
 * Fly a stage's worth of picks with a board that empties after every spawn.
 *
 * AN EMPTY BOARD IS THE HARD CASE, not a convenient one. While a word is live
 * it cannot be re-picked at all, so a board that holds rocks HIDES this bug.
 * The child who clears every word the instant it arrives - the one the game is
 * trying to produce - is precisely the child who meets the same word twice.
 */
function serveAll(
  pool: readonly string[],
  spawns: number,
  seed: number,
  options: { retentionPool?: readonly string[]; stage?: number; book?: WordBook } = {},
): Served[] {
  const rng = mulberry32(seed);
  const stage = options.stage ?? 1;
  let book: WordBook = { ...(options.book ?? {}) };
  let state: SelectionState = createSelectionState({
    stage,
    stagePool: pool,
    retentionPool: options.retentionPool ?? [],
    book,
  });
  const out: Served[] = [];
  for (let i = 0; i < spawns; i += 1) {
    const outcome = pickNext(state, { live: [], book, rng });
    if (!outcome.ok) throw new Error("an empty board must always yield a word");
    state = outcome.state;
    out.push({ word: outcome.word, source: outcome.source, practice: outcome.practice });
    // The rock is cleared immediately, so the next pick sees an empty board and
    // a word that is no longer live - the exact shape the defect needed.
    book = {
      ...book,
      [outcome.word]: applyEvent(recordFor(book, outcome.word), {
        kind: "hit",
        fkLatencyMs: 600,
        ikiMs: [350],
        atMs: i * 1000,
        stage,
      }),
    };
  }
  return out;
}

function consecutiveRepeats(served: readonly Served[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < served.length; i += 1) {
    const a = served[i - 1] as Served;
    const b = served[i] as Served;
    if (a.word === b.word) out.push(`${b.word} at slot ${i}`);
  }
  return out;
}

describe("AC-9.1: the same word never arrives twice in a row", () => {
  it("AC-9.1: no consecutive repeat over 200 seeded Mars stages", () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const served = serveAll(MARS, 58, seed);
      expect(consecutiveRepeats(served), `seed ${seed}`).toEqual([]);
    }
  });

  it("AC-9.1: still none when the stage runs LONG past the bag's first cycle", () => {
    // The bag refill is the mechanism, so the belt has to lap the pool several
    // times for the test to have met the bug at all.
    for (let seed = 1; seed <= 40; seed += 1) {
      const served = serveAll(MARS, MARS.length * 5, seed);
      expect(consecutiveRepeats(served), `seed ${seed}`).toEqual([]);
      const cycles = served.length / MARS.length;
      expect(cycles, "the test must actually lap the pool").toBeGreaterThan(3);
    }
  });

  it("AC-9.1 / AC-9.3: still none when retention words are interleaved", () => {
    // The other suspect. Retention has its OWN bag over a much smaller pool, so
    // it cycles far more often - and a retention word landing next to itself is
    // the same defect through a different door.
    for (let seed = 1; seed <= 60; seed += 1) {
      const served = serveAll(JUPITER, 58, seed, { retentionPool: MARS, stage: 2 });
      expect(consecutiveRepeats(served), `seed ${seed}`).toEqual([]);
      expect(served.some((s) => s.source === "retention"), `seed ${seed}`).toBe(true);
    }
  });

  it("AC-9.1: still none with the D25 tier unlocked, where no letter is blocked", () => {
    // `blockedLetters` returns an empty set once the shared-prefix tier is on,
    // which removes the accidental protection the old comment relied on.
    const book = uniformBook(MARS, masteredRecord);
    for (let seed = 1; seed <= 60; seed += 1) {
      const served = serveAll(MARS, 58, seed, { book });
      expect(consecutiveRepeats(served), `seed ${seed}`).toEqual([]);
    }
  });

  it("AC-9.1: THE REGRESSION - a two-word pool is where the rule has to bend", () => {
    // The control. Without it, "no consecutive repeats" might be a claim about
    // a picker that could never produce one. With a pool of two and both words
    // live-then-cleared, alternation is the only legal answer, and a pool of
    // ONE leaves the picker no choice at all - which it takes rather than
    // stalling, because AC-2.1 is the only rule that is never relaxed.
    const pair = serveAll(["alpha", "bravo"], 20, 7);
    expect(consecutiveRepeats(pair)).toEqual([]);
    expect(new Set(pair.map((s) => s.word)).size).toBe(2);

    const single = serveAll(["alpha"], 5, 7);
    expect(single.map((s) => s.word)).toEqual(Array(5).fill("alpha"));
  });

  it("AC-9.1: every word still gets served - the rule costs no coverage", () => {
    // Excluding one candidate must not quietly starve part of the pool, which
    // is the failure mode of the obvious alternative (seeding the refilled bag
    // with the word just served).
    const served = serveAll(MARS, MARS.length * 6, 3);
    expect(new Set(served.map((s) => s.word)).size).toBe(MARS.length);
  });

  it("AC-9.1: the fix costs the distribution nothing - no word is starved", () => {
    /**
     * WHY THIS AND NOT "EVERY BLOCK OF `pool.length` IS A PERMUTATION".
     *
     * That stronger claim is not one this picker makes, and it was not true
     * before this change either: AC-9.2 outranks AC-9.1 by design (see the
     * precedence note in picker.ts), so a forced guaranteed-catch slot with no
     * FRESH catch word available will re-serve a used one and put the bag out
     * of phase with any fixed block boundary. Asserting it would be asserting
     * a rule the module deliberately does not have.
     *
     * What this change could genuinely have broken is the DISTRIBUTION, which
     * is the trap in the obvious alternative fix: seeding the refilled bag with
     * the word just served would permanently make that word rarer than the
     * rest. `lastServed` excludes it from one slot and then lets it back in, so
     * over a long run every word should land within a reasonable factor of the
     * mean. That is the property worth pinning.
     */
    const served = serveAll(MARS, MARS.length * 12, 11).map((s) => s.word);
    const counts = new Map<string, number>();
    for (const word of MARS) counts.set(word, 0);
    for (const word of served) counts.set(word, (counts.get(word) ?? 0) + 1);

    const mean = served.length / MARS.length;
    for (const [word, n] of counts) {
      expect(n, `${word} was starved`).toBeGreaterThan(mean * 0.4);
      expect(n, `${word} was over-served`).toBeLessThan(mean * 2.2);
    }
  });

  it("reports the bent rule when it has to serve one anyway", () => {
    const rng = mulberry32(1);
    const state = createSelectionState({ stage: 1, stagePool: ["only"], book: {} });
    const first = pickNext(state, { live: [], book: {}, rng }) as Picked;
    const second = pickNext(first.state, { live: [], book: {}, rng }) as Picked;
    expect(second.word).toBe("only");
    expect(second.relaxed).toContain("consecutive");
    expect(first.relaxed).not.toContain("consecutive");
  });

  it("lastServed is the one word carried, from either pool", () => {
    const rng = mulberry32(5);
    let state = createSelectionState({
      stage: 2,
      stagePool: JUPITER,
      retentionPool: MARS,
      book: {},
    });
    expect(state.lastServed).toBe(null);
    for (let i = 0; i < 20; i += 1) {
      const out = pickNext(state, { live: [], book: {}, rng }) as Picked;
      state = out.state;
      expect(state.lastServed).toBe(out.word);
    }
  });
});

describe("D21 / D23: a word that COMES BACK is flagged as practice", () => {
  it("D21: every retention word is a practice word", () => {
    const served = serveAll(JUPITER, 58, 2, { retentionPool: MARS, stage: 2 });
    const retention = served.filter((s) => s.source === "retention");
    expect(retention.length).toBeGreaterThan(0);
    expect(retention.every((s) => s.practice)).toBe(true);
  });

  it("D23: a word the player has MISSED comes back flagged, on any stage", () => {
    const missed = applyEvent(blankRecord(), { kind: "miss", atMs: 0, stage: 0 });
    const state = createSelectionState({ stage: 1, stagePool: MARS, book: {} });
    expect(isPracticeSpawn("dust", "stage", missed, state)).toBe(true);
    // Read off the WORD BOOK, not off this stage: a word missed at Mars and met
    // again at Saturn is still one the game chose to re-teach.
    expect(missed.misses).toBe(1);
  });

  it("AC-9.1: a word already served THIS stage is practice when it comes back", () => {
    const rng = mulberry32(9);
    let state = createSelectionState({ stage: 1, stagePool: ["alpha", "bravo"], book: {} });
    const first = pickNext(state, { live: [], book: {}, rng }) as Picked;
    state = first.state;
    expect(first.practice).toBe(false);
    const second = pickNext(state, { live: [], book: {}, rng }) as Picked;
    state = second.state;
    const third = pickNext(state, { live: [], book: {}, rng }) as Picked;
    // Slot three can only be one of the two, and both have now been served.
    expect(third.practice).toBe(true);
  });

  it("a brand-new word on its first exposure is NOT practice", () => {
    // The flag has to mean something. If everything were practice, nothing
    // would ever be aimed at the ship and the belt would stop being a belt.
    const served = serveAll(MARS, MARS.length, 4);
    expect(served.slice(0, MARS.length).some((s) => !s.practice)).toBe(true);
    expect(served[0]?.practice).toBe(false);
  });

  it("the flag is stable: same inputs, same answer, no clock and no rng", () => {
    const state = createSelectionState({ stage: 1, stagePool: MARS, book: {} });
    const record = blankRecord();
    for (let i = 0; i < 5; i += 1) {
      expect(isPracticeSpawn("dust", "stage", record, state)).toBe(false);
      expect(isPracticeSpawn("dust", "retention", record, state)).toBe(true);
    }
  });
});
