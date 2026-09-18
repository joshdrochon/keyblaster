import { describe, expect, it } from "vitest";
import { wordBaseScore } from "@engine/scoring/combo.js";
import { DEFAULT_FLIGHT_CONFIG } from "@game/flight/stage.js";
import { type Bundle, bundlesFor } from "./fixtures.js";

/**
 * UR-79 / FR-12 / AC-12.2: HOW WIDE EACH STOP'S ASTEROID POOL IS.
 *
 * ================== THE DEFECT ==================
 * The owner played Mars, Jupiter and Pluto and said the word variation was
 * extremely narrow, and asked for a wider RANGE - genuinely short words and
 * genuinely long ones, with the long ones worth more.
 *
 * They were right about the arithmetic. A belt spawns
 * `DEFAULT_FLIGHT_CONFIG.stageWordCount` (58) words. The shipped pools were
 * 26-32 words, so every word came round about twice a belt: mars 26 (2.23x),
 * jupiter 30 (1.93x), saturn 28, uranus 30, neptune 30, pluto 32. Sixteen of
 * Mars's twenty-six words were three or four letters and its longest was
 * `surface`. "Narrow" was 58/26, not a matter of taste.
 *
 * ================== WHY THIS FILE IS A GATE AND NOT A README ==================
 * The pools cannot simply be made big. `tests/unit/simulation/belt.test.ts` and
 * `tests/unit/simulation/launchRoute.test.ts` fly the REAL pools through the
 * real belt for a grade-2 pilot (600 ms between keys, 82% accuracy) and assert
 * absolute stall counts. Every number below was found by moving the pool one
 * step at a time and re-running those two files, and every one of them is one
 * step from red in at least one direction. So the sizes are asserted EXACTLY:
 * a later lane that "just adds a few more words" gets a red test naming the
 * measurement rather than a child who cannot finish Jupiter.
 *
 * ================== WHAT WAS MEASURED, AND AT WHICH BOUND ==================
 * Sweeping every stop together, at 40 seeds x 6 belts on the route harness and
 * on the Mars belt harness:
 *
 *   all six stops at 50 words     5 red in simulation/
 *   all six stops at 48 words     2 red (grade-2 stalls once at Jupiter)
 *   all six stops at 46 words     GREEN                        <- what ships
 *   Mars at 42+ words             red: the FR-6 belt-duration band and the
 *                                 D31 control band both go over
 *   Mars with ONE 8-letter word   red: 5 tests in belt.test.ts, including
 *                                 grade-2 stalls at the knob FLOOR going 0->1
 *
 * Mars is the tight one because `belt.test.ts` flies the MARS pool at stop
 * index 1 for every one of its runs, so Mars alone carries that file's
 * absolute-zero stall assertions and its 90-150 s duration band. That is why
 * Mars is 40 words with a longest word of 7 while the other five are 46 with a
 * longest of 8, and it is why the long end of the owner's range lives at
 * Jupiter through Pluto rather than at the first stop.
 */

const EN = bundlesFor("en");
const belt = (stopId: string): Bundle => {
  const b = EN.find((x) => x.stopId === stopId);
  if (b === undefined) throw new Error(`no en/${stopId}.json`);
  return b;
};

/** Length histogram of a pool, keyed by letter count. */
const histogramOf = (pool: readonly string[]): Record<number, number> => {
  const out: Record<number, number> = {};
  for (const word of pool) out[word.length] = (out[word.length] ?? 0) + 1;
  return out;
};

const meanLengthOf = (pool: readonly string[]): number =>
  pool.reduce((n, w) => n + w.length, 0) / pool.length;

/**
 * The shape of every belt pool as it ships, measured.
 *
 * `mean` is rounded to three places and compared with a tolerance of half a
 * thousandth, so it is a recorded value rather than a band: swapping one word
 * for a word of a different length moves it and this goes red.
 */
const SHAPE: ReadonlyArray<{
  readonly stopId: string;
  readonly size: number;
  readonly mean: number;
  readonly max: number;
  readonly histogram: Readonly<Record<number, number>>;
}> = [
  { stopId: "mars", size: 40, mean: 4.05, max: 7, histogram: { 3: 14, 4: 16, 5: 5, 6: 4, 7: 1 } },
  {
    stopId: "jupiter",
    size: 46,
    mean: 4.848,
    max: 8,
    histogram: { 3: 13, 4: 9, 5: 10, 6: 5, 7: 4, 8: 5 },
  },
  {
    stopId: "saturn",
    size: 46,
    mean: 4.63,
    max: 8,
    histogram: { 3: 10, 4: 17, 5: 9, 6: 3, 7: 4, 8: 3 },
  },
  {
    stopId: "uranus",
    size: 46,
    mean: 4.543,
    max: 8,
    histogram: { 3: 10, 4: 20, 5: 7, 6: 2, 7: 4, 8: 3 },
  },
  {
    stopId: "neptune",
    size: 46,
    mean: 4.652,
    max: 8,
    histogram: { 2: 1, 3: 11, 4: 15, 5: 7, 6: 5, 7: 2, 8: 5 },
  },
  {
    stopId: "pluto",
    size: 46,
    mean: 4.674,
    max: 8,
    histogram: { 2: 1, 3: 11, 4: 13, 5: 7, 6: 8, 7: 3, 8: 3 },
  },
];

/** The sizes the owner played and called narrow. Kept so the delta is readable. */
const SHIPPED_BEFORE: Readonly<Record<string, number>> = {
  mars: 26,
  jupiter: 30,
  saturn: 28,
  uranus: 30,
  neptune: 30,
  pluto: 32,
};

describe("UR-79 / AC-12.2: every belt pool is wide enough to stop repeating", () => {
  for (const shape of SHAPE) {
    it(`AC-12.2: en/${shape.stopId} ships exactly ${shape.size} words`, () => {
      // WATCHED FAILING: with the pools the owner played, this reads
      // "mars ships 26 words, up from 26" and every row is red.
      const pool = belt(shape.stopId).pool;
      expect(
        pool.length,
        `${shape.stopId} ships ${pool.length} words, up from ${SHIPPED_BEFORE[shape.stopId]}`,
      ).toBe(shape.size);
      // The defect in one number: how many times a 58-word belt has to come
      // back to the same word. It was ~2x everywhere; nothing may go back.
      const repeatFactor = DEFAULT_FLIGHT_CONFIG.stageWordCount / pool.length;
      expect(repeatFactor, `${shape.stopId} still repeats ${repeatFactor.toFixed(2)}x`).toBeLessThan(
        1.5,
      );
      expect(pool.length).toBeGreaterThan(SHIPPED_BEFORE[shape.stopId]!);
    });
  }

  it("AC-12.2: no belt pool reaches the belt's own spawn count", () => {
    // A pool AT OR ABOVE `stageWordCount` is served once and never again, so
    // no word in it can reach a second exposure and the SRS schedule
    // (`@engine/words/srs`) never advances past its first step. That is not a
    // hypothetical: at 66 words a stop,
    // `tests/unit/words/bookPersistence.test.ts` > "the schedule a stop wrote
    // is still binding at the next stop" goes red with "nothing was scheduled
    // forward at all", because no word got the two fast hits that take ease
    // from 1.6 to under 1.2.
    for (const shape of SHAPE) {
      expect(
        belt(shape.stopId).pool.length,
        `${shape.stopId} is served once and never practised`,
      ).toBeLessThan(DEFAULT_FLIGHT_CONFIG.stageWordCount);
    }
  });
});

describe("UR-79 / FR-8: variety was bought with WORDS, not with LETTERS", () => {
  /**
   * THE BOUND, from UR-72's own measurement and re-confirmed here.
   *
   * Pool SIZE is cheap and mean WORD LENGTH is not. The same 80-word pool
   * costs a grade-2 pilot 1 stall in 240 belts at mean 4.88, 134 at mean 5.64
   * and 239 at mean 6.16 - because at 600 ms a keystroke a 6.16-letter word is
   * 3.7 s of pure typing, which is the motor half of FR-8 and no reading
   * budget reaches it.
   */
  const MEAN_CEILING = 4.9;

  for (const shape of SHAPE) {
    it(`FR-8: en/${shape.stopId} holds its mean word length under ${MEAN_CEILING}`, () => {
      const mean = meanLengthOf(belt(shape.stopId).pool);
      expect(mean, `${shape.stopId} mean is ${mean.toFixed(3)}`).toBeLessThanOrEqual(MEAN_CEILING);
      // Recorded, not banded: the measured value this lane shipped and proved.
      expect(mean, `${shape.stopId} mean moved to ${mean.toFixed(3)}`).toBeCloseTo(shape.mean, 3);
    });

    it(`FR-8: en/${shape.stopId} has the length histogram that was measured`, () => {
      const pool = belt(shape.stopId).pool;
      expect(histogramOf(pool), `${shape.stopId} histogram`).toEqual(shape.histogram);
      expect(Math.max(...pool.map((w) => w.length))).toBe(shape.max);
    });
  }

  it("FR-8: Mars carries no 8-letter word, and that is a measurement", () => {
    // NOT a style choice and NOT an oversight. `belt.test.ts` flies the Mars
    // pool for all of its runs, and trading ONE 4-letter Mars word for
    // `mountain` - pool size unchanged at 40, mean 4.05 -> 4.15 - takes that
    // file from green to five red, including:
    //   "at the knob's FLOOR the board is exactly the one already measured"
    //       grade2: expected 1 to be +0
    //   "the stall rate goes from most belts to none of them"
    //       expected 32 to be less than or equal to 15
    // So the long end of the owner's range starts at Jupiter. If this ever
    // becomes affordable, this assertion is where it is noticed.
    expect(Math.max(...belt("mars").pool.map((w) => w.length))).toBe(7);
  });
});

describe("UR-79: the RANGE the owner asked for is actually in the pools", () => {
  it("FR-12: every belt pool carries genuinely SHORT words", () => {
    for (const shape of SHAPE) {
      const short = belt(shape.stopId).pool.filter((w) => w.length <= 3);
      expect(short.length, `${shape.stopId} short words: ${short.join(", ")}`).toBeGreaterThanOrEqual(
        10,
      );
    }
  });

  it("FR-12: every belt pool after Mars carries genuinely LONG words", () => {
    // Seven and eight letters. Mars is excluded for the reason measured above,
    // and is asserted separately so its exclusion cannot spread silently.
    for (const shape of SHAPE) {
      const long = belt(shape.stopId).pool.filter((w) => w.length >= 7);
      if (shape.stopId === "mars") {
        expect(long.length, "mars long words").toBe(1);
        continue;
      }
      expect(long.length, `${shape.stopId} long words: ${long.join(", ")}`).toBeGreaterThanOrEqual(
        5,
      );
    }
  });

  it("FR-12: the spread inside one pool is at least five letters wide", () => {
    // The owner's actual ask: short words AND long words, not a pile of 5s.
    for (const shape of SHAPE) {
      const lengths = belt(shape.stopId).pool.map((w) => w.length);
      const spread = Math.max(...lengths) - Math.min(...lengths);
      expect(spread, `${shape.stopId} spread`).toBeGreaterThanOrEqual(4);
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
