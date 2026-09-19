import { describe, expect, it } from "vitest";
import { wordBaseScore } from "@engine/scoring/combo.js";
import { beltHistogram, beltSizeFor, sampleBelt } from "@engine/selection/index.js";
import { DEFAULT_FLIGHT_CONFIG } from "@game/flight/stage.js";
import { type Bundle, bundlesFor } from "./fixtures.js";

/**
 * UR-79 / UR-79b / FR-12 / AC-12.2: HOW WIDE EACH STOP'S VOCABULARY IS.
 *
 * ================== THE FIRST DEFECT (UR-79) ==================
 * The owner played Mars, Jupiter and Pluto and said the word variation was
 * extremely narrow. They were right about the arithmetic: a belt spawns
 * `DEFAULT_FLIGHT_CONFIG.stageWordCount` (58) words and the pools were 26-32,
 * so every word came round about twice a belt. The pools were widened to 40-46.
 *
 * ================== THE SECOND DEFECT (UR-79b) ==================
 * 40-46 is as wide as a POOL can be, and the whole game was still only 312
 * distinct English words - a 154-word sight list plus six pools - because the
 * pool a stop OWNED was the pool a belt FLEW. A child who flew Mars three times
 * met the same forty words three times.
 *
 * ================== WHY THE POOLS COULD NOT SIMPLY GROW ==================
 * A pool AT OR ABOVE `stageWordCount` is served once and never comes back, so
 * no word reaches a second exposure, `@engine/words/srs` never advances past
 * its first step, ease never decays, and
 * `tests/unit/words/bookPersistence.test.ts` > "the schedule a stop wrote is
 * still binding at the next stop" goes red with "nothing was scheduled forward
 * at all". Sweeping every stop together, at 40 seeds x 6 belts on the route
 * harness and on the Mars belt harness:
 *
 *   all six stops at 50 words     5 red in simulation/
 *   all six stops at 48 words     2 red (grade-2 stalls once at Jupiter)
 *   all six stops at 46 words     GREEN
 *
 * ================== SO THE BANK GREW AND THE BELT DID NOT ==================
 * `src/content/en/<stop>.json` now ships a BANK: 100 words at Mars, 115 at
 * every other stop. `@engine/selection/bank.sampleBelt` hands one BELT out of
 * it at stage setup - 40 at Mars, 46 elsewhere, the sizes measured green above.
 * This file is the gate on both halves: the banks are asserted EXACTLY, and so
 * is the fact that every belt they can produce has the length profile the stop
 * shipped before banks existed.
 *
 * ================== WHY MARS IS THE ODD ONE ==================
 * `belt.test.ts` flies the MARS bank at stop index 1 for every one of its runs,
 * so Mars alone carries that file's absolute-zero stall assertions and its
 * 90-150 s duration band. That band is sensitive to the belt's DISTINCT word
 * count - a word the player has met before costs them a warm recognition
 * instead of a cold one - so Mars's belt stays at 40 and its longest word at 7.
 */

const EN = bundlesFor("en");
const belt = (stopId: string): Bundle => {
  const b = EN.find((x) => x.stopId === stopId);
  if (b === undefined) throw new Error(`no en/${stopId}.json`);
  return b;
};

/** Length histogram of a list, keyed by letter count. */
const histogramOf = (pool: readonly string[]): Record<number, number> => {
  const out: Record<number, number> = {};
  for (const word of pool) out[word.length] = (out[word.length] ?? 0) + 1;
  return out;
};

const meanLengthOf = (pool: readonly string[]): number =>
  pool.reduce((n, w) => n + w.length, 0) / pool.length;

/** Seeds every per-belt claim below is stated over. */
const SEEDS = [0, 1, 2, 3, 7, 13, 42, 99, 1234, 65535, 0x7fffffff];

/** Every belt a stop's bank can hand over at those seeds, plus the baseline. */
const beltsOf = (stopId: string): readonly (readonly string[])[] => {
  const bank = belt(stopId).pool;
  const size = beltSizeFor(bank.length);
  return [
    bank.slice(0, size),
    ...SEEDS.map((seed) => sampleBelt({ bank, size, seed, known: bank.slice(0, size) })),
  ];
};

/**
 * The shape of every bank as it ships, and the belt it hands over, measured.
 *
 * `beltMean` is the mean the stop shipped BEFORE this lane, to three places:
 * the bank histograms were solved backwards from `beltHistogram`'s
 * largest-remainder arithmetic so that the sampled belt reproduces the measured
 * pool's length profile exactly. Swapping one bank word for a word of a
 * different length moves a bank count and this goes red.
 */
const SHAPE: ReadonlyArray<{
  readonly stopId: string;
  readonly bank: number;
  readonly beltSize: number;
  readonly bankHistogram: Readonly<Record<number, number>>;
  readonly beltHistogram: Readonly<Record<number, number>>;
  readonly beltMean: number;
  readonly max: number;
}> = [
  {
    stopId: "mars",
    bank: 100,
    beltSize: 40,
    bankHistogram: { 3: 35, 4: 40, 5: 12, 6: 10, 7: 3 },
    beltHistogram: { 3: 14, 4: 16, 5: 5, 6: 4, 7: 1 },
    beltMean: 4.05,
    max: 7,
  },
  {
    stopId: "jupiter",
    bank: 115,
    beltSize: 46,
    bankHistogram: { 3: 32, 4: 22, 5: 25, 6: 13, 7: 10, 8: 13 },
    beltHistogram: { 3: 13, 4: 9, 5: 10, 6: 5, 7: 4, 8: 5 },
    beltMean: 4.848,
    max: 8,
  },
  {
    stopId: "saturn",
    bank: 115,
    beltSize: 46,
    bankHistogram: { 3: 25, 4: 42, 5: 22, 6: 8, 7: 10, 8: 8 },
    beltHistogram: { 3: 10, 4: 17, 5: 9, 6: 3, 7: 4, 8: 3 },
    beltMean: 4.63,
    max: 8,
  },
  {
    stopId: "uranus",
    bank: 115,
    beltSize: 46,
    bankHistogram: { 3: 25, 4: 50, 5: 17, 6: 5, 7: 10, 8: 8 },
    beltHistogram: { 3: 10, 4: 20, 5: 7, 6: 2, 7: 4, 8: 3 },
    beltMean: 4.543,
    max: 8,
  },
  {
    stopId: "neptune",
    bank: 115,
    beltSize: 46,
    bankHistogram: { 2: 2, 3: 27, 4: 37, 5: 18, 6: 13, 7: 5, 8: 13 },
    beltHistogram: { 2: 1, 3: 11, 4: 15, 5: 7, 6: 5, 7: 2, 8: 5 },
    beltMean: 4.652,
    max: 8,
  },
  {
    stopId: "pluto",
    bank: 115,
    beltSize: 46,
    bankHistogram: { 2: 2, 3: 27, 4: 32, 5: 18, 6: 20, 7: 8, 8: 8 },
    beltHistogram: { 2: 1, 3: 11, 4: 13, 5: 7, 6: 8, 7: 3, 8: 3 },
    beltMean: 4.674,
    max: 8,
  },
];

/** The sizes the owner played and called narrow, and what UR-79 left. */
const SHIPPED_BEFORE: Readonly<Record<string, readonly [number, number]>> = {
  mars: [26, 40],
  jupiter: [30, 46],
  saturn: [28, 46],
  uranus: [30, 46],
  neptune: [30, 46],
  pluto: [32, 46],
};

describe("UR-79b / AC-12.2: every stop OWNS far more words than one belt flies", () => {
  for (const shape of SHAPE) {
    it(`AC-12.2: en/${shape.stopId} ships a bank of exactly ${shape.bank} words`, () => {
      // WATCHED FAILING: with the pools this lane started from, this reads
      // "mars ships 40 words, up from 26 before UR-79" and every row is red.
      const bank = belt(shape.stopId).pool;
      const [narrow, afterUr79] = SHIPPED_BEFORE[shape.stopId]!;
      expect(
        bank.length,
        `${shape.stopId} ships ${bank.length} words, up from ${afterUr79} (and from ${narrow} before UR-79)`,
      ).toBe(shape.bank);
      expect(histogramOf(bank), `${shape.stopId} bank histogram`).toEqual(shape.bankHistogram);
      expect(new Set(bank).size, `${shape.stopId} bank has duplicates`).toBe(bank.length);
    });

    it(`AC-12.2: en/${shape.stopId} still hands a belt exactly ${shape.beltSize} words`, () => {
      // WATCHED FAILING: return the whole bank instead of sampling and this
      // reads "mars belt is 100 words" against the 40 the route was measured
      // on, and `bookPersistence` goes red behind it.
      const bank = belt(shape.stopId).pool;
      expect(beltSizeFor(bank.length), `${shape.stopId} belt`).toBe(shape.beltSize);
      for (const flown of beltsOf(shape.stopId)) {
        expect(flown.length, `${shape.stopId} belt`).toBe(shape.beltSize);
      }
      // The repeat factor the owner complained about, on the belt that flies.
      const repeatFactor = DEFAULT_FLIGHT_CONFIG.stageWordCount / shape.beltSize;
      expect(
        repeatFactor,
        `${shape.stopId} still repeats ${repeatFactor.toFixed(2)}x`,
      ).toBeLessThan(1.5);
    });
  }

  it("AC-12.2: no belt reaches the belt's own spawn count", () => {
    // A belt AT OR ABOVE `stageWordCount` is served once and never again, so
    // no word in it can reach a second exposure and the SRS schedule
    // (`@engine/words/srs`) never advances past its first step. At 66 words a
    // stop, `tests/unit/words/bookPersistence.test.ts` > "the schedule a stop
    // wrote is still binding at the next stop" goes red with "nothing was
    // scheduled forward at all". This is the constraint the bank exists to
    // route around, so it is asserted on the BELT and not on the bank.
    for (const shape of SHAPE) {
      expect(
        shape.beltSize,
        `${shape.stopId} is served once and never practised`,
      ).toBeLessThan(DEFAULT_FLIGHT_CONFIG.stageWordCount);
    }
  });

  it("FR-12: the whole game's English vocabulary, before and after", () => {
    // The headline, as one number rather than as six. The union is what a
    // child can ever meet: the six banks plus the sight list, deduped.
    const banks = EN.flatMap((b) => b.pool);
    const distinct = new Set(banks);
    expect(banks.length, "bank slots across the six belt stops").toBe(675);
    expect(distinct.size, "distinct words across the six banks").toBe(381);
    // Before this lane the same six stops carried 270 slots and 178 distinct
    // words. WATCHED FAILING against the shipped content: "expected 178 to be
    // 381".
    expect(distinct.size).toBeGreaterThan(178 * 2);
  });
});

describe("UR-79b / FR-8: variety was bought with WORDS, not with LETTERS", () => {
  /**
   * THE BOUND, from UR-72's own measurement and re-confirmed here.
   *
   * Pool SIZE is cheap and mean WORD LENGTH is not. The same 80-word pool
   * costs a grade-2 pilot 1 stall in 240 belts at mean 4.88, 134 at mean 5.64
   * and 239 at mean 6.16 - because at 600 ms a keystroke a 6.16-letter word is
   * 3.7 s of pure typing, which is the motor half of FR-8 and no reading
   * budget reaches it.
   *
   * The sample is STRATIFIED BY LENGTH for exactly this reason. An
   * unstratified 46-of-115 draw has a standard error of about 0.16 letters, so
   * about one belt in a hundred would cross the ceiling and no test that flew
   * one belt would ever see it.
   */
  const MEAN_CEILING = 4.9;

  for (const shape of SHAPE) {
    it(`FR-8: every en/${shape.stopId} belt has the length profile that was measured`, () => {
      // WATCHED FAILING with an unstratified draw: "uranus at seed 0:
      // expected { 3: 9, 4: 25, 5: 5, ... } to deeply equal
      // { 3: 10, 4: 20, 5: 7, ... }", and Mars's mean moves across ten
      // different values over eleven seeds.
      const bank = belt(shape.stopId).pool;
      expect(
        Object.fromEntries(beltHistogram(bank, shape.beltSize)),
        `${shape.stopId} belt histogram`,
      ).toEqual(shape.beltHistogram);
      for (const flown of beltsOf(shape.stopId)) {
        expect(histogramOf(flown), `${shape.stopId} belt histogram`).toEqual(
          shape.beltHistogram,
        );
        const mean = meanLengthOf(flown);
        expect(mean, `${shape.stopId} mean is ${mean.toFixed(3)}`).toBeLessThanOrEqual(
          MEAN_CEILING,
        );
        // Recorded, not banded: the mean this stop shipped before banks
        // existed, which every belt it can now produce still has.
        expect(mean, `${shape.stopId} mean moved to ${mean.toFixed(3)}`).toBeCloseTo(
          shape.beltMean,
          3,
        );
        expect(Math.max(...flown.map((w) => w.length))).toBe(shape.max);
      }
    });
  }

  it("FR-8: Mars carries no 8-letter word, and that is a measurement", () => {
    // NOT a style choice and NOT an oversight. `belt.test.ts` flies the Mars
    // bank for all of its runs, and trading ONE 4-letter Mars word for
    // `mountain` - belt size unchanged at 40, mean 4.05 -> 4.15 - takes that
    // file from green to five red, including:
    //   "at the knob's FLOOR the board is exactly the one already measured"
    //       grade2: expected 1 to be +0
    //   "the stall rate goes from most belts to none of them"
    //       expected 32 to be less than or equal to 15
    // So the long end of the owner's range starts at Jupiter. Stated over the
    // whole BANK, because a word that is not in the bank cannot be sampled.
    expect(Math.max(...belt("mars").pool.map((w) => w.length))).toBe(7);
  });
});

describe("UR-79: the RANGE the owner asked for is in every belt, not only in the bank", () => {
  it("FR-12: every belt carries genuinely SHORT words", () => {
    for (const shape of SHAPE) {
      for (const flown of beltsOf(shape.stopId)) {
        const short = flown.filter((w) => w.length <= 3);
        expect(
          short.length,
          `${shape.stopId} short words: ${short.join(", ")}`,
        ).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it("FR-12: every belt after Mars carries genuinely LONG words", () => {
    // Seven and eight letters. Mars is excluded for the reason measured above,
    // and is asserted separately so its exclusion cannot spread silently.
    for (const shape of SHAPE) {
      for (const flown of beltsOf(shape.stopId)) {
        const long = flown.filter((w) => w.length >= 7);
        if (shape.stopId === "mars") {
          expect(long.length, "mars long words").toBe(1);
          continue;
        }
        expect(
          long.length,
          `${shape.stopId} long words: ${long.join(", ")}`,
        ).toBeGreaterThanOrEqual(5);
      }
    }
  });

  it("FR-12: the spread inside one belt is at least four letters wide", () => {
    // The owner's actual ask: short words AND long words, not a pile of 5s.
    for (const shape of SHAPE) {
      for (const flown of beltsOf(shape.stopId)) {
        const lengths = flown.map((w) => w.length);
        const spread = Math.max(...lengths) - Math.min(...lengths);
        expect(spread, `${shape.stopId} spread`).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("AC-12.3 / D09: every warp-sentence word is inside the core block", () => {
    // The core block is the opening `BELT_ANCHOR_COUNT` entries of a bank, and
    // every belt flies it. The warp break highlights the words the child
    // actually blasted, so a belt that dropped `rings` would show a Saturn
    // sentence about a flight that did not happen. Stated here, on the
    // CONTENT, because that is where the ordering has to be maintained.
    for (const shape of SHAPE) {
      const bundle = belt(shape.stopId);
      const bank = bundle.pool;
      const words = (bundle.warpSentence ?? "")
        .toLowerCase()
        .replace(/[^a-z\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 0 && bank.includes(w));
      expect(words.length, `${shape.stopId} warp sentence has no pool words`).toBeGreaterThan(0);
      for (const word of words) {
        for (const flown of beltsOf(shape.stopId)) {
          expect(flown, `${shape.stopId} belt dropped warp word "${word}"`).toContain(word);
        }
      }
    }
  });
});

describe("UR-79 / AC-3.4: the long words already pay, at the new maximum", () => {
  /**
   * `@engine/scoring/combo.wordBaseScore` is NOT changed by this lane. It is
   * read here so the owner's second ask - "the long ones worth more points" -
   * is answered with the numbers that apply to the lengths now in the pools,
   * rather than to the 9- and 12-letter words that are not.
   */
  it("AC-3.4: an 8-letter word is worth four of a 4-letter word", () => {
    expect(wordBaseScore(3)).toBe(60);
    expect(wordBaseScore(4)).toBe(80);
    expect(wordBaseScore(5)).toBe(110);
    expect(wordBaseScore(6)).toBe(160);
    expect(wordBaseScore(7)).toBe(230);
    expect(wordBaseScore(8)).toBe(320);
    // The two ends of the range that actually ships.
    expect(wordBaseScore(8) / wordBaseScore(3)).toBeCloseTo(5.333, 3);
    expect(wordBaseScore(8) / wordBaseScore(4)).toBe(4);
  });

  it("AC-3.4: the curve is convex across every length a pool can serve", () => {
    // Each extra letter is worth strictly more than the one before it, so the
    // incentive to type the long word rises with its cost. 2 -> 8 is the full
    // range the six pools contain.
    const steps: number[] = [];
    for (let len = 3; len <= 8; len += 1) {
      steps.push(wordBaseScore(len) - wordBaseScore(len - 1));
    }
    expect(steps).toEqual([20, 20, 30, 50, 70, 90]);
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i]!).toBeGreaterThanOrEqual(steps[i - 1]!);
    }
  });
});
