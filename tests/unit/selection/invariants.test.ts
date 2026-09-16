import { describe, expect, it } from "vitest";
import { EASE_MAX, EASE_MIN } from "@engine/types.js";
import {
  CATCH_WINDOW,
  type Picked,
  createSelectionState,
  firstLetter,
  isGuaranteedCatch,
  pickNext,
} from "@engine/selection/index.js";
import type { WordBook } from "@engine/words/index.js";
import { COLLIDING_WORDS, DISTINCT_LETTER_WORDS, seen } from "./fixtures.js";
import { mulberry32, randInt, shuffled } from "./rng.js";

/**
 * The two simulation invariants the PRD asks for by name:
 *   AC-2.1 - 10,000 spawns across randomised states
 *   AC-9.2 - the 6-slot catch window over 10,000 stages
 *
 * Both run on a fixed-seed mulberry32 (CLAUDE.md: no Math.random anywhere).
 * The board model is deliberately hostile: pools full of first-letter
 * collisions, a live-asteroid cap that moves, and words removed at random, so
 * the picker meets the blocked states rather than a tidy average case.
 */

describe("AC-2.1 no two live asteroids share a first letter", () => {
  it("AC-2.1: holds over 10,000 spawns across randomised states", () => {
    const TARGET = 10_000;
    let spawns = 0;
    let tierLockedSpawns = 0;
    let tierUnlockedSharedLetters = 0;
    let blocked = 0;
    let seed = 1;

    while (spawns < TARGET) {
      const rng = mulberry32(seed);
      seed += 1;

      const stage = 1 + randInt(rng, 6);
      const stagePool = shuffled(COLLIDING_WORDS, rng).slice(0, 4 + randInt(rng, 10));
      const inStage = new Set(stagePool);
      const retentionPool = shuffled(COLLIDING_WORDS, rng)
        .slice(0, randInt(rng, 7))
        .filter((w) => !inStage.has(w));

      // Random ease across the whole legal range, so some stages clear the D25
      // gate (ease < 0.6 for >= 80% of the pool) and some do not.
      const book: WordBook = {};
      const skew = rng();
      for (const word of [...stagePool, ...retentionPool]) {
        if (rng() < 0.85) {
          book[word] = seen(EASE_MIN + rng() * skew * (EASE_MAX - EASE_MIN));
        }
      }
      const lastSeenStage: Record<string, number> = {};
      for (const word of retentionPool) lastSeenStage[word] = randInt(rng, stage + 1);

      let state = createSelectionState({ stage, stagePool, retentionPool, book });
      const maxLive = 2 + randInt(rng, 6); // controller knob range, D53
      let live: string[] = [];

      for (let tick = 0; tick < 40 && spawns < TARGET; tick += 1) {
        // The board churns: asteroids get blasted or breach between spawns.
        while (live.length >= maxLive) live.splice(randInt(rng, live.length), 1);
        if (live.length > 0 && rng() < 0.35) live.splice(randInt(rng, live.length), 1);

        const out = pickNext(state, { live, book, lastSeenStage, rng });
        if (!out.ok) {
          blocked += 1;
          expect(out.reason).toBe("no-legal-word");
          expect(live.length).toBeGreaterThan(0); // the anti-stall proof
          continue;
        }

        expect([...stagePool, ...retentionPool]).toContain(out.word);
        expect(live).not.toContain(out.word);

        if (!state.sharedPrefixTier) {
          tierLockedSpawns += 1;
          const taken = new Set(live.map(firstLetter));
          expect(taken.has(firstLetter(out.word))).toBe(false);
        }

        live.push(out.word);
        state = out.state;
        spawns += 1;

        if (!state.sharedPrefixTier) {
          // The board invariant itself, re-derived from the board, not the pick.
          expect(new Set(live.map(firstLetter)).size).toBe(live.length);
        } else if (new Set(live.map(firstLetter)).size < live.length) {
          tierUnlockedSharedLetters += 1;
        }
      }
    }

    expect(spawns).toBe(TARGET);
    // The sweep is only meaningful if it actually met the hard cases.
    expect(tierLockedSpawns).toBeGreaterThan(TARGET / 2);
    expect(blocked).toBeGreaterThan(0);
    // AC-2.2: sharing does happen once D25's gate is cleared.
    expect(tierUnlockedSharedLetters).toBeGreaterThan(0);
  });
});

describe("AC-9.2 one guaranteed-catch word in every six spawns", () => {
  it("AC-9.2: holds over 10,000 stages with a seeded PRNG", () => {
    const STAGES = 10_000;
    const SPAWNS_PER_STAGE = 12;
    const POOL_SIZE = 14;
    const CATCH_WORDS = 6;
    const MAX_LIVE = 5;

    let windowsChecked = 0;
    let forcedSlots = 0;

    for (let stageSeed = 1; stageSeed <= STAGES; stageSeed += 1) {
      const rng = mulberry32(stageSeed);

      // Distinct first letters throughout, and strictly more catch words than
      // the board can block (6 > MAX_LIVE), so AC-9.2 is genuinely satisfiable
      // on every slot and any failure is the picker's, not the fixture's.
      const pool = shuffled(DISTINCT_LETTER_WORDS, rng).slice(0, POOL_SIZE);
      const book: WordBook = {};
      pool.forEach((word, i) => {
        book[word] = i < CATCH_WORDS ? seen(0.3) : seen(1.5);
      });
      expect(pool.filter((w) => isGuaranteedCatch(w, book[w])).length).toBe(CATCH_WORDS);

      let state = createSelectionState({ stage: 1 + randInt(rng, 6), stagePool: pool, book });
      expect(state.sharedPrefixTier).toBe(false); // 6/14 solid is under the D25 gate

      const picks: Picked[] = [];
      let live: string[] = [];
      for (let i = 0; i < SPAWNS_PER_STAGE; i += 1) {
        while (live.length >= MAX_LIVE) live.splice(randInt(rng, live.length), 1);
        const out = pickNext(state, { live, book, rng });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        // AC-9.2 is never the rule that gave way on a pool that can supply it.
        expect(out.relaxed).not.toContain("catch");
        if (out.forcedCatch) {
          forcedSlots += 1;
          expect(out.guaranteedCatch).toBe(true);
        }
        picks.push(out);
        live.push(out.word);
        state = out.state;
      }

      for (let i = 0; i + CATCH_WINDOW <= picks.length; i += 1) {
        windowsChecked += 1;
        const hasCatch = picks.slice(i, i + CATCH_WINDOW).some((p) => p.guaranteedCatch);
        if (!hasCatch) {
          throw new Error(
            `AC-9.2 violated at stage seed ${stageSeed}, window ${i}: ` +
              picks.slice(i, i + CATCH_WINDOW).map((p) => p.word).join(", "),
          );
        }
      }
    }

    expect(windowsChecked).toBe(STAGES * (SPAWNS_PER_STAGE - CATCH_WINDOW + 1));
    // If nothing was ever forced the invariant held by luck, not by the rule.
    expect(forcedSlots).toBeGreaterThan(0);
  });
});
