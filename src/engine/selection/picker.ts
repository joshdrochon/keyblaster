import type { WordRecord } from "../types.js";
import type { Allowlist } from "../allowlist/index.js";
import type { LengthBias } from "../controller/knobs.js";
import { checkWord, normalizeWord } from "../allowlist/index.js";
import { type WordBook, isEligible, recordFor } from "../words/index.js";
import {
  BELT_ANCHOR_COUNT,
  BELT_CARRY_FRACTION,
  bankSeed,
  beltSizeFor,
  sampleBelt,
} from "./bank.js";
import { weightedPick } from "./sample.js";
import { sharedPrefixUnlocked } from "./tier.js";
import { biasedWeightOf, firstLetter, isGuaranteedCatch } from "./weights.js";

/**
 * The picker (D21, D22, D23, D25; PRD FR-9, AC-2.1, AC-2.2; architecture 4.2).
 *
 * Pure and total: a stage's worth of selection is a fold over
 * `pickNext(state, context) -> { state', word }`. No clock, no storage, and
 * randomness only through the injected `rng` (CLAUDE.md).
 *
 * =========================================================================
 * PRECEDENCE, and why. Three rules constrain the same candidate set and they
 * CAN contradict each other:
 *
 *   AC-2.1  no two live asteroids share a first letter (tier locked)
 *   AC-9.1c NO BACK-TO-BACK REPEAT (AC-9.1 read consecutively; see below)
 *   AC-9.2  every 6th slot is a guaranteed-catch word if none in the last 5
 *   AC-9.1  no repeats until the stage pool is exhausted
 *   AC-9.3  ~20% of slots come from earlier stops
 *   AC-9.4  a word missed this stage is not re-served until the next stage
 *
 * Order, most protected first:
 *
 *   0. AC-9.1c - no CONSECUTIVE repeat. A corollary of AC-9.1 rather than a new
 *      acceptance criterion, ranked second only to AC-2.1.
 *
 *      This module used to argue, in a comment right above `commit`, that a
 *      back-to-back repeat was already impossible: a live word is never
 *      re-spawned, and (tier locked) its own first letter is blocked. Both
 *      halves are true and the conclusion did not follow, because BOTH
 *      conditions need the word to still be LIVE. The instant the player blasts
 *      it, it is neither live nor letter-blocking - and `commit` empties the
 *      no-replacement bag on the same spawn that exhausts it (`cycled`), so the
 *      word that just left the screen is, for exactly one slot, the freshest
 *      thing in the pool. That is the defect: the child clears a word and the
 *      very next rock carries it again.
 *
 *      It is ranked above AC-9.2 rather than folded into AC-9.1 because it
 *      excludes precisely ONE word out of the pool. Giving up a guaranteed
 *      catch (D22, morale) costs the whole wave something; giving up one
 *      candidate costs nothing that any other rule can measure. The two
 *      therefore never really compete, and when they somehow do, the visible
 *      regression - the same word twice in a row, which reads as a bug rather
 *      than as pedagogy - is the worse one to ship.
 *
 *   1. AC-2.1 - INVIOLABLE while the tier is locked.
 *      It is the only one of the five whose breach breaks a MECHANIC rather
 *      than a policy: auto-lock fires on the first keystroke and never
 *      switches targets (D24, AC-3.1, AC-3.3). Two live asteroids sharing a
 *      first letter with the dual-cannon tier locked means the player presses
 *      "s" and the game picks for them. The PRD also states it as an
 *      invariant over 10,000 spawns with exactly one exception (the tier), so
 *      the spec itself refuses to trade it away.
 *
 *   2. AC-9.2 - guaranteed catch. D22 is about morale: every wave must contain
 *      something the player can definitely kill. Losing it is a felt
 *      regression, so it outranks the remaining pedagogy rules.
 *
 *   3. AC-9.1 - no repeats. Serving a word twice in one stage is extra
 *      exposure, which is mildly GOOD for learning and only mildly bad for
 *      variety. Cheapest of the three to give up.
 *
 *   4. AC-9.3 - the retention quota is cumulative, so a slot that cannot be
 *      filled from the intended pool is made up by the next slot. Deviating
 *      for one spawn self-corrects; nothing is lost.
 *
 *   5. AC-9.4's in-stage half - "do not re-serve a word missed this stage".
 *      The AC itself is discharged by words/ setting `nextEligibleStage`
 *      (which this module reads and never recomputes). Honouring it inside the
 *      stage is a refinement, so it is the last thing dropped.
 *
 * When even rule 1 cannot be satisfied, the picker does NOT break it and does
 * NOT throw: it returns `{ ok: false, reason: "no-legal-word" }`, meaning "do
 * not spawn on this tick". That can never stall the game, and here is the
 * proof: the bottom rung of the cascade filters the whole stage pool by two
 * conditions only - the word is not already on a live asteroid, and (tier
 * locked) its first letter is not taken by a live asteroid. Both conditions
 * need a live asteroid to fire, so the rung is empty only when the board is
 * NOT empty. An empty board therefore always yields a word, and a non-empty
 * board is by definition not stalled: something is falling, and clearing or
 * losing it frees a letter. `deadlock.test.ts` asserts this as an invariant
 * over randomised states.
 * =========================================================================
 */

/** Slots per guaranteed-catch window (AC-9.2: "every 6 consecutive spawns"). */
export const CATCH_WINDOW = 6;

/** Retention share of spawns, as a percent (AC-9.3: 20%, ±1). */
export const RETENTION_PERCENT = 20;

/**
 * First stage index that interleaves earlier stops (AC-9.3: "from stage 2 on").
 * Stage indices come from types.stageIndexOf: earth 0, mars 1, jupiter 2.
 * Mars is excluded because the only stop before it is the Earth launchpad,
 * which is a single word (AC-12.1) and not a retention pool.
 */
export const RETENTION_MIN_STAGE = 2;

/** Which rule the picker had to bend to return a word at all. */
export type Relaxation = "repeat" | "consecutive" | "catch" | "source" | "eligibility";

export interface SelectionState {
  /** Stage index along the route (types.stageIndexOf). */
  readonly stage: number;
  /**
   * THIS BELT's words: one sample of the stop's bank (`bank.sampleBelt`),
   * deduped, normalised, allowlisted. Never empty, and frozen for the stage -
   * AC-9.1's no-replacement bag is defined over a fixed pool.
   */
  readonly stagePool: readonly string[];
  /** Words from EARLIER stops, for the AC-9.3 interleave. May be empty. */
  readonly retentionPool: readonly string[];
  /** Stage words served in the current no-replacement cycle (AC-9.1). */
  readonly usedStage: readonly string[];
  /**
   * Every stage word served this stage, in order. Distinct from `usedStage`,
   * which is the no-replacement BAG and empties when the pool is exhausted.
   * AC-9.4's in-stage half needs the full history: after a bag refill a word
   * missed earlier in the stage must still not come back (D23 says sooner,
   * meaning NEXT stage, not thirty seconds later).
   */
  readonly servedStage: readonly string[];
  /** Retention words served in the current cycle. */
  readonly usedRetention: readonly string[];
  /** Spawns produced this stage. */
  readonly spawnCount: number;
  /** How many of those came from the retention pool (AC-9.3). */
  readonly retentionCount: number;
  /** Spawns since the last guaranteed-catch word (AC-9.2). */
  readonly sinceCatch: number;
  /**
   * The word this stage served LAST, from either pool, or null before the
   * first spawn. AC-9.1c's whole state: the one word the next slot may not be.
   *
   * Deliberately not derived from `usedStage`/`servedStage`. `usedStage` is the
   * no-replacement bag and is emptied the moment the pool is exhausted, which
   * is exactly the instant the back-to-back repeat becomes possible; and
   * `servedStage` does not include retention words, which have a bag of their
   * own that cycles far faster because the pool is smaller.
   */
  readonly lastServed: string | null;
  /** D25 dual-cannon tier, frozen at stage start (see tier.ts). */
  readonly sharedPrefixTier: boolean;
}

export interface PickContext {
  /** Words on asteroids that are alive RIGHT NOW (AC-2.1's scope). */
  readonly live: readonly string[];
  /** This player's book for the content language. */
  readonly book: WordBook;
  /** Stage index at which each word was last served, for the SRS rule. */
  readonly lastSeenStage?: Readonly<Record<string, number>>;
  /** Injected randomness, [0, 1). The engine never calls Math.random. */
  readonly rng: () => number;
  /**
   * FR-10's secondary knob (UR-79). Omitted or 0 means the neutral mix, which
   * is byte-identical to the behaviour before the knob was read at all, so a
   * caller that does not pass it loses nothing it used to have.
   *
   * See `weights.lengthWeightFactor` for why this is a weight and not a
   * filter: a filter could empty the final cascade rung, and the totality
   * proof at the top of this file depends on it never being empty.
   */
  readonly lengthBias?: LengthBias;
}

export interface Picked {
  readonly ok: true;
  readonly word: string;
  readonly source: "stage" | "retention";
  /** True if the chosen word satisfies AC-9.2's predicate. */
  readonly guaranteedCatch: boolean;
  /** True if this slot was the forced 6th (AC-9.2). */
  readonly forcedCatch: boolean;
  /**
   * THIS ROCK IS A PRACTICE OPPORTUNITY, NOT A NEW CHALLENGE (D21, D23).
   *
   * A word is on the belt for one of two reasons. Either it is this stop's
   * curriculum arriving for the first time, or it is COMING BACK - because the
   * player missed it and D23 says a missed word comes back sooner, or because
   * it is a retention probe from an earlier stop (D21, AC-9.3).
   *
   * The second kind exists to be practised. The player put it this way and they
   * are right: the game itself decided to show this word again, so aiming it at
   * the ship punishes the child for the game's own pedagogy. Presentation reads
   * this flag and gives the rock a trajectory that is not a collision course;
   * nothing about the word, its weighting or its fall time changes (FR-8).
   */
  readonly practice: boolean;
  /** Rules bent to produce a word; empty on the happy path. */
  readonly relaxed: readonly Relaxation[];
  readonly state: SelectionState;
}

export interface NoPick {
  readonly ok: false;
  /**
   * Every pool word is either already live or collides with a live asteroid's
   * first letter. Implies `live.length > 0`, so it means "do not spawn on this
   * tick", never "the game is stuck" - see the proof above.
   */
  readonly reason: "no-legal-word";
  readonly state: SelectionState;
}

export type PickOutcome = Picked | NoPick;

/**
 * Overrides for the bank-to-belt sample (bank.ts). Every field has a shipped
 * default, so a caller that says nothing gets the sample the game flies.
 *
 * It exists so the simulation harnesses can fly a NAMED belt - "seed 7 at
 * Jupiter" - rather than whichever belt the book happened to produce. Nothing
 * on the real path passes it.
 */
export interface BeltInput {
  /** Words this belt flies. Default: `beltSizeFor(bank.length)`. */
  readonly size?: number;
  /** Default: `bankSeed(bank, book)` - see bank.ts on why the book. */
  readonly seed?: number;
  /** 0..1. Default: `BELT_CARRY_FRACTION`. */
  readonly carry?: number;
  /** Opening bank entries every belt flies. Default: `BELT_ANCHOR_COUNT`. */
  readonly anchors?: number;
  /**
   * What this pilot has already met in this bank, highest priority first.
   * Default: derived from `book` by `carryOrder`.
   *
   * Overriding it is how a harness flies a RETURNING pilot's belt without
   * also handing the pilot a warm book - which would change fall times and
   * recognition costs and confound the very measurement it was flown for. The
   * belt is the returning one; the hands are still cold.
   */
  readonly known?: readonly string[];
}

export interface SelectionInput {
  readonly stage: number;
  /**
   * THIS STOP'S BANK, not the belt (UR-79b). A bank larger than
   * `BELT_MAX_WORDS` is sampled down to one belt's worth by `bank.sampleBelt`;
   * a list at or under it is flown whole, which is every hand-built pool in the
   * test suite and every pool that was never grown.
   */
  readonly stagePool: Iterable<string>;
  readonly retentionPool?: Iterable<string>;
  readonly book?: WordBook;
  /** If given, every emitted word is guaranteed to be allowlisted. */
  readonly allowlist?: Allowlist;
  /** Rarely set; see `BeltInput`. */
  readonly belt?: BeltInput;
}

/** Thrown at STAGE SETUP, never during play. See createSelectionState. */
export class EmptyStagePoolError extends Error {
  constructor(stage: number) {
    super(`Stage ${stage} has no usable words after normalisation and allowlisting`);
    this.name = "EmptyStagePoolError";
  }
}

/**
 * Build the stage's selection state.
 *
 * This is where a content bug is allowed to be loud: an empty stage pool is
 * unbuildable content, it is caught by tests and by the content validator, and
 * it is the ONLY throw in this module. `pickNext` is total for any state this
 * function returns, which is what keeps the failure away from the child.
 */
export function createSelectionState(input: SelectionInput): SelectionState {
  const book = input.book ?? {};
  const bank = cleanPool(input.stagePool, input.allowlist);
  if (bank.length === 0) throw new EmptyStagePoolError(input.stage);

  // UR-79b: the belt is a SAMPLE of the bank. Frozen here, at stage setup, so
  // every spawn of this belt draws from one list - resampling mid-stage would
  // break AC-9.1's no-replacement bag, which is defined over a fixed pool.
  const stagePool = sampleBelt({
    bank,
    size: input.belt?.size ?? beltSizeFor(bank.length),
    seed: input.belt?.seed ?? bankSeed(bank, (w) => (book[w]?.exposures ?? 0)),
    carry: input.belt?.carry ?? BELT_CARRY_FRACTION,
    anchors: input.belt?.anchors ?? BELT_ANCHOR_COUNT,
    known: input.belt?.known ?? carryOrder(bank, book, input.stage),
  });

  const inStage = new Set(stagePool);
  // A word cannot be both this stop's curriculum and its own retention probe.
  const retentionPool = cleanPool(input.retentionPool ?? [], input.allowlist).filter(
    (w) => !inStage.has(w),
  );

  return {
    stage: input.stage,
    stagePool,
    retentionPool,
    usedStage: [],
    usedRetention: [],
    servedStage: [],
    spawnCount: 0,
    retentionCount: 0,
    sinceCatch: 0,
    lastServed: null,
    sharedPrefixTier: sharedPrefixUnlocked(stagePool, book),
  };
}

/**
 * The bank words this child has already met, in the order the SCHEDULER wants
 * them back (UR-79b). `bank.sampleBelt` fills the carried half of each length
 * bucket from the front of this list.
 *
 * Due words first, because a word whose `nextEligibleStage` has arrived is a
 * review the game has already promised itself (D23); then the least-practised,
 * because a word with two exposures needs the third more than a word with nine
 * does; then bank order, so the whole thing is a pure function of the book and
 * a replay carries the same words.
 *
 * Words the book has never seen are absent by construction - they are the
 * FRESH half, and they are drawn at random rather than ranked.
 */
function carryOrder(
  bank: readonly string[],
  book: WordBook,
  stage: number,
): readonly string[] {
  const rank = new Map<string, number>();
  bank.forEach((word, i) => rank.set(word, i));
  return bank
    .filter((word) => (book[word]?.exposures ?? 0) > 0)
    .sort((a, b) => {
      const ra = recordFor(book, a);
      const rb = recordFor(book, b);
      const dueA = stage >= ra.nextEligibleStage ? 0 : 1;
      const dueB = stage >= rb.nextEligibleStage ? 0 : 1;
      if (dueA !== dueB) return dueA - dueB;
      if (ra.exposures !== rb.exposures) return ra.exposures - rb.exposures;
      return rank.get(a)! - rank.get(b)!;
    });
}

/** Normalise, drop empties and non-allowlisted words, dedupe, keep order. */
function cleanPool(words: Iterable<string>, allowlist?: Allowlist): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of words) {
    const word = normalizeWord(raw, allowlist?.lang);
    if (word.length === 0 || seen.has(word)) continue;
    // Every word this module emits must be allowlisted (D34, AC-13.1). We drop
    // rather than throw: a single bad content entry must not kill a stage.
    if (allowlist && checkWord(word, allowlist) !== null) continue;
    seen.add(word);
    out.push(word);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The cascade
// ---------------------------------------------------------------------------

/** One rung of the relaxation cascade; the first rung with a candidate wins. */
interface Attempt {
  readonly source: "stage" | "retention";
  /** Restrict to words not yet served in this cycle (AC-9.1). */
  readonly fresh: boolean;
  /** Restrict to guaranteed-catch words (AC-9.2). */
  readonly requireCatch: boolean;
  /** Honour nextEligibleStage / the SRS rule (AC-9.3, AC-9.4). */
  readonly requireEligible: boolean;
  /** Exclude `state.lastServed`, i.e. forbid a back-to-back repeat (AC-9.1c). */
  readonly avoidLast: boolean;
}

/** Retention words owed after `n` spawns. Integer maths: no 0.2 rounding. */
export const retentionQuota = (n: number): number =>
  Math.floor((n * RETENTION_PERCENT) / 100);

/** AC-9.2: this slot is the forced 6th if the last 5 produced no catch word. */
export const catchIsForced = (state: SelectionState): boolean =>
  state.sinceCatch >= CATCH_WINDOW - 1;

/** AC-9.3: does slot `spawnCount + 1` want a word from an earlier stop? */
export function retentionIsDue(state: SelectionState): boolean {
  if (state.stage < RETENTION_MIN_STAGE) return false;
  if (state.retentionPool.length === 0) return false;
  return state.retentionCount < retentionQuota(state.spawnCount + 1);
}

/**
 * Pick the next word. Total: for any state from `createSelectionState` this
 * returns either a word or an explicit "do not spawn this tick", never
 * `undefined` and never a throw.
 */
export function pickNext(state: SelectionState, context: PickContext): PickOutcome {
  const forcedCatch = catchIsForced(state);
  const preferred: "stage" | "retention" = retentionIsDue(state) ? "retention" : "stage";
  const other: "stage" | "retention" = preferred === "retention" ? "stage" : "retention";

  const live = new Set(context.live.map((w) => normalizeWord(w)));
  const blocked = blockedLetters(state, live);
  const used = {
    stage: new Set(state.usedStage),
    retention: new Set(state.usedRetention),
  };

  for (const attempt of cascade(forcedCatch, preferred, other)) {
    const candidates = candidatesFor(attempt, state, context, used, blocked, live);
    const word = weightedPick(
      candidates,
      (w) => biasedWeightOf(w, context.book[w], context.lengthBias ?? 0),
      context.rng,
    );
    if (word === undefined) continue;
    return commit(word, attempt, state, context, used, forcedCatch, preferred);
  }

  // Unreachable with an empty board - see the precedence note at the top.
  return { ok: false, reason: "no-legal-word", state };
}

/**
 * Rungs in precedence order: consecutive before catch before repeat before
 * source before eligibility. When the slot is not forced, the catch rungs are
 * skipped rather than duplicated.
 *
 * `avoidLast` is the OUTERMOST loop, which is what makes AC-9.1c the last rule
 * given up. The whole ladder is walked once with the previous word excluded and
 * only then walked again with it allowed, so every other rule is bent before
 * the same word comes round twice in a row.
 *
 * That ordering is safe for the totality proof at the top of this file, and the
 * reason is worth stating: the FINAL rung is unchanged - `fresh: false`,
 * `requireCatch: false`, `requireEligible: false`, `avoidLast: false` - so the
 * bottom of the cascade still filters the pool by nothing but "not live" and
 * "first letter not taken". An empty board therefore still always yields a word.
 */
function cascade(
  forcedCatch: boolean,
  preferred: "stage" | "retention",
  other: "stage" | "retention",
): Attempt[] {
  const out: Attempt[] = [];
  const catchPasses = forcedCatch ? [true, false] : [false];
  for (const avoidLast of [true, false]) {
    for (const requireCatch of catchPasses) {
      for (const fresh of [true, false]) {
        for (const source of [preferred, other]) {
          out.push({ source, fresh, requireCatch, requireEligible: true, avoidLast });
        }
      }
    }
    // Last resort for this pass: ignore the no-replacement cycle AND the
    // in-stage eligibility refinement. AC-2.1's filter still applies and is
    // never dropped.
    for (const source of [preferred, other]) {
      out.push({
        source,
        fresh: false,
        requireCatch: false,
        requireEligible: false,
        avoidLast,
      });
    }
  }
  return out;
}

/** First letters the live board has taken (empty once the D25 tier is on). */
function blockedLetters(state: SelectionState, live: ReadonlySet<string>): Set<string> {
  if (state.sharedPrefixTier) return new Set();
  const out = new Set<string>();
  for (const word of live) out.add(firstLetter(word));
  return out;
}

function candidatesFor(
  attempt: Attempt,
  state: SelectionState,
  context: PickContext,
  used: { stage: Set<string>; retention: Set<string> },
  blocked: Set<string>,
  live: ReadonlySet<string>,
): string[] {
  const pool = attempt.source === "stage" ? state.stagePool : state.retentionPool;
  const usedSet = attempt.source === "stage" ? used.stage : used.retention;
  const out: string[] = [];
  for (const word of pool) {
    // The two filters that are NEVER relaxed. A word already on screen cannot
    // be spawned twice (that is physics, not policy), and AC-2.1 owns the rest.
    if (live.has(word)) continue;
    if (blocked.has(firstLetter(word))) continue;
    // AC-9.1c. One word, from either pool: the one the last rock carried.
    if (attempt.avoidLast && word === state.lastServed) continue;
    if (attempt.fresh && usedSet.has(word)) continue;
    const record = recordFor(context.book, word);
    if (attempt.requireCatch && !isGuaranteedCatch(word, record)) continue;
    if (attempt.requireEligible && !eligible(attempt, word, record, state, context)) continue;
    out.push(word);
  }
  return out;
}

/**
 * Eligibility, split by pool because the two pools mean different things.
 *
 * Retention words are spaced by the full SRS rule (AC-9.3) - that is the whole
 * point of interleaving them. Stage words are this stop's curriculum and must
 * NOT be filtered by the SRS interval, or a well-learned stop would have
 * nothing to fly. The only eligibility that applies to a stage word is the one
 * AC-9.4 sets: a word missed THIS stage has nextEligibleStage = stage + 1, so
 * it is not served again until the next stop. We read that field; words/ owns
 * the rule that writes it (D23).
 */
function eligible(
  attempt: Attempt,
  word: string,
  record: WordRecord,
  state: SelectionState,
  context: PickContext,
): boolean {
  if (attempt.source === "retention") {
    return isEligible(record, context.lastSeenStage?.[word], state.stage);
  }
  // Stage words are this stop's curriculum: the SRS interval must not strip
  // them, or a well-learned stop would have nothing left to fly. The single
  // eligibility that does apply is the one AC-9.4 writes - a word already
  // served THIS stage whose nextEligibleStage has moved past it.
  if (!state.servedStage.includes(word)) return true;
  return state.stage >= record.nextEligibleStage;
}

function commit(
  word: string,
  attempt: Attempt,
  state: SelectionState,
  context: PickContext,
  used: { stage: Set<string>; retention: Set<string> },
  forcedCatch: boolean,
  preferred: "stage" | "retention",
): Picked {
  const source = attempt.source;
  const usedSet = source === "stage" ? used.stage : used.retention;
  const pool = source === "stage" ? state.stagePool : state.retentionPool;
  const wasUsed = usedSet.has(word);

  // AC-9.1: the bag refills the moment it is empty, so consecutive blocks of
  // `pool.length` spawns are each a permutation of the pool - every word is
  // served once before any is served twice, which is what "no repeats until
  // the pool is exhausted" means.
  //
  // The bag is still NOT seeded with the word just served, and that is now a
  // deliberate division of labour rather than the mistaken claim it used to
  // be. Seeding it would make that one word appear less often than every other
  // word in the pool, which is a permanent distortion of AC-9.1's permutation
  // in exchange for a one-slot guarantee. `lastServed` buys the same guarantee
  // for exactly one slot and costs the distribution nothing: the word is
  // excluded from the NEXT pick and is a full citizen of the bag again after it.
  const nextUsed = new Set(usedSet);
  nextUsed.add(word);
  const cycled = nextUsed.size >= pool.length;
  const nextUsedList = cycled ? [] : [...nextUsed];

  const record = recordFor(context.book, word);
  const guaranteedCatch = isGuaranteedCatch(word, record);

  const relaxed: Relaxation[] = [];
  if (word === state.lastServed) relaxed.push("consecutive");
  if (wasUsed) relaxed.push("repeat");
  if (forcedCatch && !guaranteedCatch) relaxed.push("catch");
  if (source !== preferred) relaxed.push("source");
  if (!attempt.requireEligible) relaxed.push("eligibility");

  return {
    ok: true,
    word,
    source,
    guaranteedCatch,
    forcedCatch,
    practice: isPracticeSpawn(word, source, record, state),
    relaxed,
    state: {
      ...state,
      usedStage: source === "stage" ? nextUsedList : state.usedStage,
      usedRetention: source === "retention" ? nextUsedList : state.usedRetention,
      servedStage:
        source === "stage" && !state.servedStage.includes(word)
          ? [...state.servedStage, word]
          : state.servedStage,
      spawnCount: state.spawnCount + 1,
      retentionCount: state.retentionCount + (source === "retention" ? 1 : 0),
      lastServed: word,
      // AC-9.2's counter is driven by what the word IS, not by why it was
      // chosen: an unforced slot that happens to serve a mastered word resets
      // the window exactly like a forced one.
      sinceCatch: guaranteedCatch ? 0 : state.sinceCatch + 1,
    },
  };
}

/**
 * Is this spawn a word COMING BACK rather than a word arriving (D21, D23)?
 *
 * Three ways in, and each is a rule that already exists:
 *
 *   1. it came from the retention pool - that is AC-9.3's spaced-repetition
 *      probe and is a check on something the player learned at an earlier stop;
 *   2. this stage has already served it once (`servedStage`) - the bag cycled,
 *      or a rung relaxed AC-9.1, and either way the child has met it today;
 *   3. the player has MISSED it before (`record.misses > 0`) - D23's "a missed
 *      word comes back sooner", which is the case the player named.
 *
 * Case 3 is read off the word book rather than off this stage's history on
 * purpose: a word missed at Mars and met again at Saturn is still a word the
 * game chose to re-teach, and it is still not something to fly at the ship.
 *
 * Pure and exported so the scene never has to re-derive it from three sources
 * and get a fourth answer.
 */
export function isPracticeSpawn(
  word: string,
  source: "stage" | "retention",
  record: WordRecord,
  state: SelectionState,
): boolean {
  if (source === "retention") return true;
  if (state.servedStage.includes(word)) return true;
  return record.misses > 0;
}

/**
 * Does this pool contain anything AC-9.2 would accept? Content tooling and the
 * gauntlet use it to flag a stage whose forced-catch slot is unsatisfiable -
 * which is every stage pool on a brand-new profile, since EASE_NEW is 1.6.
 */
export function poolHasCatchWord(pool: readonly string[], book: WordBook): boolean {
  return pool.some((w) => isGuaranteedCatch(w, recordFor(book, w)));
}
