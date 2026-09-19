import { describe, expect, it } from "vitest";
import {
  BELT_ANCHOR_COUNT,
  BELT_CARRY_FRACTION,
  BELT_MAX_WORDS,
  BELT_MIN_WORDS,
  beltHistogram,
  beltSizeFor,
  createSelectionState,
  sampleBelt,
} from "@engine/selection/index.js";
import { BELT_STOP_IDS, EASE_NEW, type StopId } from "@engine/types";
import type { WordBook } from "@engine/words/index.js";
import { blankRecord } from "@engine/words/index.js";
import { DEFAULT_FLIGHT_CONFIG, stagePoolFor } from "@game/flight/stage.js";

/**
 * UR-79b / FR-12 / AC-12.2: THE BANK IS NOT THE BELT.
 *
 * ================== THE DEFECT ==================
 * The game shipped 312 distinct English words - a 154-word sight list and six
 * belt pools - and a child who flew Mars three times met the same forty words
 * three times, because the pool a stop OWNED was the pool a belt FLEW.
 *
 * The pools could not simply be made bigger. A belt spawns 58 words
 * (`DEFAULT_FLIGHT_CONFIG.stageWordCount`); a pool at or above 58 is served
 * once and never comes back, no word reaches a second exposure, and
 * `tests/unit/words/bookPersistence.test.ts` goes red with "nothing was
 * scheduled forward at all". 50 words a stop reds 5 tests, 48 reds 2, 46 is
 * green. So the bank grew and the BELT did not: `@engine/selection/bank`
 * samples one belt out of the bank at stage setup.
 *
 * ================== WHAT THIS FILE IS THE GATE ON ==================
 * Four properties, each of which a plain random draw would break:
 *
 *   SHAPE     every belt from one bank has the SAME length histogram, so mean
 *             word length - the thing that stalls a grade-2 pilot - is a
 *             property of the content and never of the draw.
 *   BASELINE  a pilot's FIRST belt at a stop is the pool that stop shipped,
 *             in its shipped order, so every measurement in
 *             tests/unit/simulation is measured on the belt it was measured on.
 *   CORE      every belt carries the stop's core block, which is where its
 *             warp-sentence words live (AC-12.3, D09).
 *   CARRY     a returning pilot's belt overlaps the one they flew, in the
 *             scheduler's own priority order, so D23's reviews land.
 *
 * ================== WATCHED FAILING ==================
 * Every assertion below was watched red first, by making `sampleBelt` return
 * `bank` untouched - the "just make the pools bigger" change this whole module
 * exists instead of. The real printed values are recorded at each `it`.
 */

const BANKS = new Map<StopId, readonly string[]>(
  BELT_STOP_IDS.map((stop) => [stop, stagePoolFor(stop)] as const),
);

const bankOf = (stop: StopId): readonly string[] => {
  const bank = BANKS.get(stop);
  if (bank === undefined) throw new Error(`no bank for ${stop}`);
  return bank;
};

const histogramOf = (words: readonly string[]): Record<number, number> => {
  const out: Record<number, number> = {};
  for (const w of words) out[w.length] = (out[w.length] ?? 0) + 1;
  return out;
};

const meanOf = (words: readonly string[]): number =>
  words.reduce((n, w) => n + w.length, 0) / words.length;

/** A book that has met these words, with nothing else changed. */
const bookOver = (words: readonly string[]): WordBook => {
  const out: WordBook = {};
  for (const w of words) out[w] = { ...blankRecord(), exposures: 2, ease: EASE_NEW };
  return out;
};

const SEEDS = [0, 1, 2, 3, 7, 13, 42, 99, 1234, 65535, 0x7fffffff];

describe("UR-79b: how big a belt is, given the bank behind it", () => {
  it("AC-12.2: a list at or under the belt ceiling IS the belt", () => {
    // WATCHED FAILING: with `beltSizeFor` returning `round(n * 2/5)`
    // unconditionally, a hand-built 12-word test pool reads
    // "expected 5 to be 12" and every pool in tests/unit/selection shrinks.
    for (const n of [1, 5, 12, 40, 45, BELT_MAX_WORDS]) {
      expect(beltSizeFor(n), `a ${n}-word list`).toBe(n);
    }
  });

  it("AC-12.2: the shipped banks land exactly on the sizes that were measured", () => {
    // 46 is the ceiling (the bookPersistence measurement above); 40 is Mars,
    // whose belt carries belt.test.ts's 90-150 s duration band and whose
    // distinct-word count is what moves it.
    expect(beltSizeFor(100), "Mars: a 100-word bank").toBe(40);
    expect(beltSizeFor(115), "every other stop: a 115-word bank").toBe(46);
    for (const stop of BELT_STOP_IDS) {
      const size = beltSizeFor(bankOf(stop).length);
      expect(size, `${stop} belt`).toBeGreaterThanOrEqual(BELT_MIN_WORDS);
      expect(size, `${stop} belt`).toBeLessThanOrEqual(BELT_MAX_WORDS);
      // The constraint the whole module exists for: a belt that reaches the
      // spawn count is served once and the scheduler never sees a second
      // exposure. Restated here rather than only in a comment.
      expect(size, `${stop} is served once and never practised`).toBeLessThan(
        DEFAULT_FLIGHT_CONFIG.stageWordCount,
      );
      expect(bankOf(stop).length, `${stop} bank`).toBeGreaterThan(size * 2);
    }
  });

  it("AC-12.2: a bank between the floor and the ratio still clamps to a real belt", () => {
    // 60 * 2/5 is 24, which would be a belt a 58-spawn stage cycles two and a
    // half times. The floor is what stops a mis-sized bank producing one.
    expect(beltSizeFor(60)).toBe(BELT_MIN_WORDS);
    expect(beltSizeFor(47)).toBe(BELT_MIN_WORDS);
    expect(beltSizeFor(200)).toBe(BELT_MAX_WORDS);
  });
});

describe("UR-79b / FR-8: every belt from one bank has the SAME shape", () => {
  for (const stop of BELT_STOP_IDS) {
    it(`FR-8: ${stop}'s histogram is a property of the bank, not of the seed`, () => {
      // WATCHED FAILING, with the real numbers: replace the stratified fill
      // with one seeded shuffle of the whole bank and every stop reads red at
      // seed 0 alone -
      //   uranus at seed 0: histogram: expected { 3: 9, 4: 25, 5: 5, ... }
      //     to deeply equal { 3: 10, 4: 20, 5: 7, ... }
      //   jupiter at seed 0: histogram: expected { 3: 13, 4: 9, 5: 13, ... }
      //     to deeply equal { 3: 13, 4: 9, 5: 10, ... }
      const bank = bankOf(stop);
      const size = beltSizeFor(bank.length);
      const want = Object.fromEntries(beltHistogram(bank, size));
      for (const seed of SEEDS) {
        const belt = sampleBelt({ bank, size, seed, known: bank });
        expect(belt.length, `${stop} at seed ${seed}: belt size`).toBe(size);
        expect(histogramOf(belt), `${stop} at seed ${seed}: histogram`).toEqual(want);
      }
    });
  }

  it("FR-8: and the mean that follows from it never reaches the ceiling", () => {
    /**
     * THE BOUND, from UR-72's own measurement. Pool SIZE is cheap and mean
     * WORD LENGTH is not: the same 80-word pool costs a grade-2 pilot 1 stall
     * in 240 belts at mean 4.88, 134 at 5.64 and 239 at 6.16.
     *
     * An unstratified 46-of-115 draw has a standard error of about 0.16
     * letters, so about one belt in a hundred would cross 4.9. The stratified
     * fill cannot: the mean below is the same number at every seed.
     */
    const MEAN_CEILING = 4.9;
    for (const stop of BELT_STOP_IDS) {
      const bank = bankOf(stop);
      const size = beltSizeFor(bank.length);
      // WATCHED FAILING, same control: "mars means across 11 seeds:
      // 4.1, 4.2, 3.975, 4.075, 3.875, 3.95, 4.15, 3.9, 4.25, 4.225:
      // expected 10 to be 1" - ten different belts, ten different means.
      const means = new Set(
        SEEDS.map((seed) =>
          Number(meanOf(sampleBelt({ bank, size, seed, known: bank })).toFixed(6)),
        ),
      );
      expect(means.size, `${stop} means across ${SEEDS.length} seeds: ${[...means]}`).toBe(1);
      expect([...means][0]!, `${stop} mean`).toBeLessThanOrEqual(MEAN_CEILING);
    }
  });
});

describe("UR-79b: the first belt at a stop is the stop's own belt", () => {
  for (const stop of BELT_STOP_IDS) {
    it(`AC-12.2: a new pilot at ${stop} flies the baseline block, in order`, () => {
      // WATCHED FAILING: drop the baseline shortcut from `sampleBelt` and this
      // reads, at Mars,
      //   expected [ 'mars', 'red', 'planet', 'dust', 'rust', 'cold', ... ]
      //   to equal [ 'mars', 'red', 'dry', 'sky', 'day', 'ago', ... ]
      // - a first belt that is a draw rather than the stop, and (the reason
      // this rule exists) a route simulation whose every stall count, fall
      // time and duration band was measured on a belt the game no longer flies.
      const bank = bankOf(stop);
      const size = beltSizeFor(bank.length);
      const fresh = createSelectionState({ stage: 1, stagePool: bank, book: {} });
      expect(fresh.stagePool, `${stop} first belt`).toEqual(bank.slice(0, size));
    });
  }

  it("AC-12.2: words met at OTHER stops do not count as having flown this one", () => {
    // Arriving at Saturn with `ice`, `far` and `cold` in the book from Mars is
    // not a Saturn revisit. WATCHED FAILING with the baseline shortcut
    // removed: "expected [ 'saturn', 'wears', 'rings', ...(43) ] to deeply
    // equal [ 'saturn', 'wears', 'rings', ...(43) ]" - Saturn's FIRST belt is
    // already a draw.
    const saturn = bankOf("saturn");
    const fromMars = bookOver(bankOf("mars"));
    const first = createSelectionState({ stage: 2, stagePool: saturn, book: fromMars });
    expect(first.stagePool).toEqual(saturn.slice(0, beltSizeFor(saturn.length)));
  });
});

describe("UR-79b: a returning pilot gets new words, and their reviews", () => {
  for (const stop of BELT_STOP_IDS) {
    it(`FR-12: ${stop}'s second belt is neither the first belt nor a stranger`, () => {
      // WATCHED FAILING, with the real numbers. `sampleBelt` returning the
      // bank untouched: "mars belt: expected 100 to be 40" - a 100-word belt
      // on a 58-spawn stage, which is the pool size that reds
      // bookPersistence. `carry` forced to 0: "mars carried 11 of 40 (core
      // 11): expected 11 to be greater than or equal to 20", i.e. nothing at
      // all comes back except the core and every review D23 queued expires
      // unseen. An unstratified draw: "saturn carried 15 of 46 ... expected 15
      // to be greater than or equal to 23".
      const bank = bankOf(stop);
      const size = beltSizeFor(bank.length);
      const baseline = bank.slice(0, size);
      const core = bank.slice(0, BELT_ANCHOR_COUNT);
      const second = createSelectionState({
        stage: 1,
        stagePool: bank,
        book: bookOver(baseline),
      });
      const belt = second.stagePool;
      expect(belt.length, `${stop} belt`).toBe(size);

      const carried = belt.filter((w) => baseline.includes(w));
      const fresh = belt.filter((w) => !baseline.includes(w));
      // Half, give or take the per-bucket rounding and the core block, which
      // is carried on top of the quota because it is carried unconditionally.
      const quota = size * BELT_CARRY_FRACTION;
      expect(
        carried.length,
        `${stop} carried ${carried.length} of ${size} (core ${core.length})`,
      ).toBeGreaterThanOrEqual(Math.floor(quota));
      expect(carried.length, `${stop} carried ${carried.length} of ${size}`).toBeLessThan(size);
      expect(
        fresh.length,
        `${stop} showed ${fresh.length} words this pilot has never seen`,
      ).toBeGreaterThanOrEqual(Math.floor(size / 4));

      // And the core is always there, whatever else moved.
      for (const word of core) {
        expect(belt, `${stop} dropped core word "${word}"`).toContain(word);
      }
    });
  }

  it("AC-9.3 / D23: the carried half is the SCHEDULER's half, not a random one", () => {
    // The words the book is owed come back first. WATCHED FAILING with the
    // carry rule off: "carried 20 due against 20 not-yet-due: expected 20 to
    // be greater than 20" - the belt is indifferent to what the scheduler
    // asked for. With an unstratified draw it reads "carried 9 due against 9
    // not-yet-due".
    const bank = bankOf("mars");
    const size = beltSizeFor(bank.length);
    const baseline = bank.slice(0, size);
    const book: WordBook = {};
    // Every baseline word met; half of them scheduled forward past this stage,
    // so only the other half is DUE at stage 1.
    baseline.forEach((word, i) => {
      book[word] = {
        ...blankRecord(),
        exposures: 3,
        ease: EASE_NEW,
        nextEligibleStage: i % 2 === 0 ? 0 : 5,
      };
    });
    const due = baseline.filter((_, i) => i % 2 === 0);
    const belt = createSelectionState({ stage: 1, stagePool: bank, book }).stagePool;
    const carriedDue = belt.filter((w) => due.includes(w)).length;
    const carriedNotDue = belt.filter(
      (w) => baseline.includes(w) && !due.includes(w),
    ).length;
    expect(
      carriedDue,
      `carried ${carriedDue} due against ${carriedNotDue} not-yet-due`,
    ).toBeGreaterThan(carriedNotDue);
  });

  it("FR-12: visit after visit, a child reaches most of the bank", () => {
    // The point of the whole lane, as one number per stop. WATCHED FAILING by
    // pinning the belt to the baseline block - the shipped game - where every
    // visit is identical and this reads
    //   "mars: 40 of 100 bank words reached in 6 visits (one belt is 40):
    //    expected 40 to be greater than 60".
    for (const stop of BELT_STOP_IDS) {
      const bank = bankOf(stop);
      const size = beltSizeFor(bank.length);
      let book: WordBook = {};
      const seen = new Set<string>();
      for (let visit = 0; visit < 6; visit += 1) {
        const belt = createSelectionState({ stage: 1, stagePool: bank, book }).stagePool;
        for (const w of belt) seen.add(w);
        book = bookOver([...seen]);
      }
      expect(
        seen.size,
        `${stop}: ${seen.size} of ${bank.length} bank words reached in 6 visits (one belt is ${size})`,
      ).toBeGreaterThan(size * 1.5);
    }
  });
});

describe("UR-79b: the sample is a replay, not a shuffle", () => {
  it("AC-12.2: the same bank, seed and history always give the same belt", () => {
    for (const stop of BELT_STOP_IDS) {
      const bank = bankOf(stop);
      const size = beltSizeFor(bank.length);
      const known = bank.slice(0, size);
      for (const seed of SEEDS) {
        // WATCHED FAILING by seeding the shuffle from `Math.random()`:
        // "mars at seed 0 is not a replay".
        const a = sampleBelt({ bank, size, seed, known });
        const b = sampleBelt({ bank, size, seed, known });
        expect(b, `${stop} at seed ${seed} is not a replay`).toEqual(a);
      }
    }
  });

  it("AC-12.2: and different seeds really do give different belts", () => {
    // The other half of the claim: deterministic is not the same as constant.
    // WATCHED FAILING with `sampleBelt` returning the bank: "mars produced one
    // belt for 11 seeds: expected 1 to be 11".
    for (const stop of BELT_STOP_IDS) {
      const bank = bankOf(stop);
      const size = beltSizeFor(bank.length);
      const known = bank.slice(0, size);
      const belts = SEEDS.map((seed) => sampleBelt({ bank, size, seed, known }).join(","));
      expect(new Set(belts).size, `${stop} produced one belt for ${SEEDS.length} seeds`).toBe(
        SEEDS.length,
      );
    }
  });

  it("AC-12.2: the engine draws no randomness of its own", () => {
    // `src/engine` never calls Math.random (CLAUDE.md). Stated as the
    // observable consequence rather than as a grep: the belt is unchanged when
    // Math.random is replaced by something that always returns 0.
    const real = Math.random;
    const bank = bankOf("pluto");
    const size = beltSizeFor(bank.length);
    const known = bank.slice(0, size);
    const before = sampleBelt({ bank, size, seed: 7, known });
    try {
      Math.random = () => 0;
      expect(sampleBelt({ bank, size, seed: 7, known })).toEqual(before);
    } finally {
      Math.random = real;
    }
  });
});
