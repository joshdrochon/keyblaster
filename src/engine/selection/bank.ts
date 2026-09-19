/**
 * THE BANK AND THE BELT (UR-79b, FR-12, AC-12.2).
 *
 * ================== THE DEFECT ==================
 * The game shipped 312 distinct English words: a 154-word sight list and six
 * belt pools of 40-46. A child who flies Mars three times meets the same forty
 * words three times, because the pool a stop OWNS and the pool a belt FLIES
 * were the same list.
 *
 * ================== WHY THE POOLS COULD NOT SIMPLY GROW ==================
 * This is the constraint the whole module is shaped by, and it is measured, not
 * argued. A belt spawns `DEFAULT_FLIGHT_CONFIG.stageWordCount` (58) words. A
 * pool AT OR ABOVE 58 is served once and never comes back, so no word reaches a
 * second exposure, `@engine/words/srs` never advances past its first step, ease
 * never decays, and `tests/unit/words/bookPersistence.test.ts` goes red with
 * "nothing was scheduled forward at all". Sweeping every stop together on the
 * route harness: 50 words a stop reds 5 tests, 48 reds 2, 46 is green. That is
 * why `tests/unit/content/poolRange.test.ts` pinned the pools at 46, and it is
 * still true.
 *
 * ================== THE FIX: DECOUPLE THE TWO ==================
 * The stop owns a BANK (100 at Mars, 115 everywhere else). A belt SAMPLES a
 * BELT from it - 40 at Mars, 46 elsewhere, exactly the sizes that were measured
 * green. Inside one belt nothing changed: the same number of distinct words,
 * cycling the same number of times, so the scheduler sees exactly the exposure
 * pattern it saw before and `bookPersistence` stays green. ACROSS belts and
 * across visits the child meets words they have never seen.
 *
 * ================== WHAT THE SAMPLE GUARANTEES ==================
 * Three things, because a random 46-of-112 draw guarantees none of them:
 *
 *  1. THE SAME DIFFICULTY, EVERY TIME. The sample's length histogram is the
 *     bank's histogram scaled to the belt by largest-remainder rounding, so it
 *     is the SAME histogram for every seed. Mean word length is therefore a
 *     property of the bank, not of the draw - which matters because mean length
 *     is what stalls a grade-2 pilot (UR-72: 80 words at mean 4.88 is 1 stall
 *     in 240 belts; the same 80 at 6.16 is 239). An unstratified draw of 46
 *     from a bank of mean 4.69 has a standard error of about 0.16 letters, so
 *     roughly one belt in a hundred would cross the 4.9 ceiling. This cannot.
 *
 *  2. THE ANCHORS ALWAYS FLY. The first `BELT_ANCHOR_COUNT` entries of a bank
 *     are its anchors and every belt carries them. The warp sentence is built
 *     from the stop's own words (AC-12.3) and the warp break highlights the
 *     ones the child actually blasted (D09), so a belt that did not sample
 *     "rings" would make "Saturn wears rings made of ice and rock" a sentence
 *     about a flight the child did not take. The content files put every
 *     content word of the warp sentence in that opening block.
 *
 *  3. A REVISIT IS NOT A NEW STOP. `carry` reserves a fraction of the belt for
 *     words the book has already met here, so the scheduler's earlier work
 *     still pays off. See `BELT_CARRY_FRACTION`.
 *
 * Pure TypeScript, no clock, no Math.random: the seed is an argument and the
 * same seed with the same bank returns the same belt, so a replay is identical.
 */

/** The largest belt a stop may fly. 46 is the measured ceiling (see above). */
export const BELT_MAX_WORDS = 46;

/**
 * The smallest belt a sampled bank may fly.
 *
 * Mars's floor, and a floor for everyone. `belt.test.ts` flies the MARS bank at
 * stop index 1 for every one of its runs, so Mars alone carries that file's
 * absolute-zero stall assertions and its 90-150 s duration band, and the band
 * is sensitive to the belt's DISTINCT word count: a word the player has met
 * before costs them a warm recognition instead of a cold one, so six more
 * distinct words is about eight seconds of belt. Mars at 46 crosses 150 s.
 */
export const BELT_MIN_WORDS = 40;

/**
 * Belt size as a fraction of bank size, for a bank big enough to sample.
 *
 * 2/5 puts Mars's 100-word bank at exactly 40 and every 115-word bank at
 * exactly 46. The ratio is the thing the content author tunes: a bank is sized
 * to land its belt, rather than the belt being a number the engine keeps per
 * stop - `src/engine` does not know that Mars exists.
 *
 * The bank HISTOGRAMS are then solved backwards from the same arithmetic, so
 * that `beltHistogram` hands every belt the exact length profile its stop
 * shipped before this lane. That is not decoration: it is what lets the route
 * simulation's stall counts, fall times and belt durations be compared with the
 * baseline at all.
 */
export const BANK_BELT_FRACTION = 2 / 5;

/**
 * How many opening bank entries are the stop's CORE - words every belt flies.
 *
 * Eleven, and the number comes off the content rather than off taste: every
 * content word of every warp sentence sits inside the first eleven entries of
 * its bank, and Saturn is the stop that needs all eleven ("Saturn wears rings
 * made of ice and rock" reaches `rock` at index 10). The core is therefore
 * "the words this stop's own sentence is built from, plus the head of its
 * briefing vocabulary", which is what a stop cannot be flown without - and it
 * is a quarter of the belt, leaving three quarters to vary.
 *
 * Why it has to be pinned at all: the warp break highlights the words the child
 * actually blasted (D09), so a belt that dropped `rings` would show a Saturn
 * sentence about a flight that did not happen.
 */
export const BELT_ANCHOR_COUNT = 11;

/**
 * How much of a belt is carried over from words the book has already met here.
 *
 * ================== WHY A HALF ==================
 * Zero would hand a returning child a disjoint vocabulary: every word they had
 * been scheduled to review would be absent, `nextEligibleStage` would expire
 * unused, and the second exposure that takes ease from 1.6 to under 1.2 would
 * never arrive. One would be the game we already ship.
 *
 * A half means a word met on the last visit has an even chance of coming back
 * on this one, so the expected wait for a review is two visits - inside D23's
 * own +1 / +2 / +4 stage window.
 *
 * THIS IS THE QUOTA ON THE SLOTS THAT ARE FREE TO VARY, not the whole belt.
 * The core block (`BELT_ANCHOR_COUNT`) is carried unconditionally on top of it,
 * so the measured overlap between one belt and the next is 65-68%: 27 of
 * Mars's 40 and 30-31 of everyone else's 46. Thirteen to sixteen rocks a belt
 * are words the child has never seen, which over the six visits in
 * `bank.test.ts` reaches 85-99 of a 100- or 115-word bank.
 *
 * The carried part is not a random part: it is taken in the scheduler's own
 * priority order (due first, least-practised first), so the words that are
 * actually owed a review are the ones that come back.
 */
export const BELT_CARRY_FRACTION = 1 / 2;

/**
 * THE FIRST BELT AT A STOP IS THE STOP'S OWN BELT, NOT A SAMPLE.
 *
 * A bank opens with its BASELINE BLOCK: the belt this stop shipped, in the
 * order it shipped, sized exactly `beltSizeFor(bank.length)`. A pilot who has
 * met at most this fraction of that block has not flown here, and flies it
 * whole; sampling begins on the visit after.
 *
 * ================== WHY, AS A PRODUCT DECISION ==================
 * The first time a child reaches Saturn they should get Saturn: the words the
 * briefing just read to them, the words the warp sentence is made of, in the
 * order the author chose, rather than a draw that happens to open with `hoop`
 * and `gem`. Sampling exists for the child who comes BACK; there is nothing to
 * vary away from until there has been a first time.
 *
 * ================== AND WHY IT IS ALSO THE HONEST BAR ==================
 * It is what makes the route simulation comparable at all. Those belts are the
 * ones every stall count, fall time and duration band in tests/unit/simulation
 * was measured on, and they are unchanged by this lane - not approximately,
 * identically. That is worth stating precisely because the measurement that
 * found it is uncomfortable: simply REVERSING the six shipped pools - same
 * words, same histogram, same mean, same everything but the array order -
 * turns six assertions in `launchRoute.test.ts` red, including a median-pilot
 * stall at Pluto. The controller's ramp is sensitive to the ORDER words arrive
 * in, so "the same words in the same order" is the only baseline that is worth
 * anything, and every belt that is NOT the baseline is proved separately, over
 * seeds, in `tests/unit/selection/bank.test.ts` and `beltSample.test.ts`.
 *
 * A half rather than "any word at all": arriving at Saturn with `ice`, `far`
 * and `cold` already in the book from Mars must not count as having flown
 * Saturn, and one belt here puts every baseline word in the book, so the two
 * cases are nowhere near each other and no threshold in between is delicate.
 */
export const BELT_BASELINE_FRACTION = 1 / 2;

export interface BeltSample {
  /** The whole bank, cleaned, in content order. */
  readonly bank: readonly string[];
  /** How many words this belt flies. */
  readonly size: number;
  /** Deterministic: the same seed and bank always give the same belt. */
  readonly seed: number;
  /**
   * Bank words the book has already met, HIGHEST PRIORITY FIRST. The caller
   * orders this (picker.ts sorts by due-ness then exposures) because ordering
   * it here would mean this module importing the word book, and the bank rule
   * is about lists of strings.
   */
  readonly known?: readonly string[];
  /** 0..1. Defaults to `BELT_CARRY_FRACTION`. */
  readonly carry?: number;
  /** Opening bank entries that every belt flies. Defaults to the constant. */
  readonly anchors?: number;
}

/**
 * How many words a belt flies, given the size of the bank behind it.
 *
 * A bank at or under the ceiling IS its belt - that is the shipped behaviour
 * for every pool that was never grown, and for every hand-built pool in the
 * test suite, so nothing that passes a small list gets silently shortened.
 */
export function beltSizeFor(bankSize: number): number {
  if (bankSize <= BELT_MAX_WORDS) return bankSize;
  const scaled = Math.round(bankSize * BANK_BELT_FRACTION);
  return Math.min(BELT_MAX_WORDS, Math.max(BELT_MIN_WORDS, scaled));
}

/**
 * How many words of each length a belt of `size` takes from `bank`.
 *
 * Largest-remainder ("Hare quota") allocation, tie-broken by shorter length
 * first so the result is a pure function of the bank and the size - no seed
 * reaches this, which is what makes every belt from one bank the same shape.
 */
export function beltHistogram(
  bank: readonly string[],
  size: number,
): ReadonlyMap<number, number> {
  const have = new Map<number, number>();
  for (const word of bank) have.set(word.length, (have.get(word.length) ?? 0) + 1);
  const lengths = [...have.keys()].sort((a, b) => a - b);
  if (size >= bank.length) return have;

  const out = new Map<number, number>();
  const remainders: Array<{ length: number; rem: number }> = [];
  let assigned = 0;
  for (const length of lengths) {
    const exact = (size * (have.get(length) ?? 0)) / bank.length;
    const floor = Math.floor(exact);
    out.set(length, floor);
    assigned += floor;
    remainders.push({ length, rem: exact - floor });
  }
  remainders.sort((a, b) => (b.rem === a.rem ? a.length - b.length : b.rem - a.rem));
  for (let i = 0; assigned < size && i < remainders.length; i += 1) {
    const { length } = remainders[i]!;
    out.set(length, (out.get(length) ?? 0) + 1);
    assigned += 1;
  }
  return out;
}

/**
 * The belt this bank flies at this seed.
 *
 * Returned in BANK ORDER, not draw order: the picker weights words rather than
 * reading them in sequence, and a stable order keeps every downstream
 * measurement (histograms, `sharedPrefixUnlocked`, the ritual planner) a
 * function of WHICH words were drawn rather than of the order they fell out in.
 */
export function sampleBelt(input: BeltSample): readonly string[] {
  const { bank, size } = input;
  if (size >= bank.length) return bank;
  if (size <= 0) return [];

  const anchorCount = Math.max(0, Math.min(input.anchors ?? BELT_ANCHOR_COUNT, size));
  const anchors = new Set(bank.slice(0, anchorCount));
  const carry = Math.min(1, Math.max(0, input.carry ?? BELT_CARRY_FRACTION));
  const knownRank = new Map<string, number>();
  (input.known ?? []).forEach((word, i) => {
    if (!knownRank.has(word)) knownRank.set(word, i);
  });

  // The baseline block, until this pilot has actually flown here.
  const baseline = bank.slice(0, size);
  const met = baseline.reduce((n, w) => n + (knownRank.has(w) ? 1 : 0), 0);
  if (met <= size * BELT_BASELINE_FRACTION) return baseline;

  const target = rebalanceForAnchors(beltHistogram(bank, size), bank, anchors);
  const byLength = new Map<number, string[]>();
  for (const word of bank) {
    const bucket = byLength.get(word.length);
    if (bucket === undefined) byLength.set(word.length, [word]);
    else bucket.push(word);
  }

  const chosen = new Set<string>();
  for (const [length, want] of [...target.entries()].sort((a, b) => a[0] - b[0])) {
    const bucket = byLength.get(length) ?? [];
    const forced = bucket.filter((w) => anchors.has(w));
    for (const word of forced) chosen.add(word);
    let room = want - forced.length;
    if (room <= 0) continue;

    const rest = bucket.filter((w) => !anchors.has(w));
    const known = rest
      .filter((w) => knownRank.has(w))
      .sort((a, b) => knownRank.get(a)! - knownRank.get(b)!);
    const fresh = shuffle(
      rest.filter((w) => !knownRank.has(w)),
      hash32(`${input.seed}:${length}`),
    );

    const carried = Math.min(room, Math.min(known.length, Math.round(room * carry)));
    for (let i = 0; i < carried; i += 1) chosen.add(known[i]!);
    room -= carried;

    // Fresh words fill the rest; if the bank has run out of unseen words at
    // this length the remaining known ones top it up, so the belt is always
    // full and a child who has met every word still gets a whole belt.
    let f = 0;
    for (; room > 0 && f < fresh.length; f += 1, room -= 1) chosen.add(fresh[f]!);
    for (let k = carried; room > 0 && k < known.length; k += 1, room -= 1) {
      chosen.add(known[k]!);
    }
  }

  return bank.filter((w) => chosen.has(w));
}

/**
 * A seed for this bank from what the book remembers of it.
 *
 * WHY THE BOOK AND NOT A CLOCK OR A COUNTER. The sample has to be the same on a
 * replay and different on a revisit, and the only thing that is both persistent
 * and monotone across visits is the child's own word book - which is also
 * exactly the thing that makes a revisit a revisit. A profile that has flown
 * Mars twice hashes differently from one that has flown it once, and reloading
 * the same profile hashes the same both times.
 *
 * Only bank words count, so a belt at Saturn does not reshuffle because the
 * child learned something at Mars.
 */
export function bankSeed(
  bank: readonly string[],
  exposuresOf: (word: string) => number,
): number {
  let h = 0x811c9dc5;
  for (const word of bank) {
    const n = exposuresOf(word);
    if (n <= 0) continue;
    h = mix32(h, hash32(word));
    h = mix32(h, n >>> 0);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Make room for the anchors without changing the belt's size.
 *
 * An anchor block that is heavier in one length than the histogram allows would
 * otherwise push an anchor out of its own belt. The shipped content never does
 * this (Saturn is the worst case at two 5-letter anchors against a target of
 * nine), but a content edit must not be able to silently drop a warp-sentence
 * word, so the seats are moved instead: the bucket with the most slack gives
 * one up, and the total stays exactly `size`.
 */
function rebalanceForAnchors(
  target: ReadonlyMap<number, number>,
  bank: readonly string[],
  anchors: ReadonlySet<string>,
): Map<number, number> {
  const out = new Map(target);
  const need = new Map<number, number>();
  for (const word of bank) {
    if (anchors.has(word)) need.set(word.length, (need.get(word.length) ?? 0) + 1);
  }
  for (const [length, want] of need) {
    let short = want - (out.get(length) ?? 0);
    if (short <= 0) continue;
    out.set(length, want);
    while (short > 0) {
      let donor: number | null = null;
      let slack = 0;
      for (const [other, count] of out) {
        if (other === length) continue;
        const free = count - (need.get(other) ?? 0);
        if (free > slack) {
          slack = free;
          donor = other;
        }
      }
      if (donor === null) break;
      out.set(donor, (out.get(donor) ?? 0) - 1);
      short -= 1;
    }
  }
  return out;
}

/** FNV-1a over a string or a number's decimal form. Deterministic, 32-bit. */
function hash32(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mix32(a: number, b: number): number {
  let h = (a ^ b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** mulberry32, local to the engine: `src/engine` never calls Math.random. */
function rngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates on a copy, driven by a seeded rng. */
function shuffle(items: readonly string[], seed: number): string[] {
  const out = [...items];
  const rng = rngFrom(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i]!;
    out[i] = out[j]!;
    out[j] = a;
  }
  return out;
}
