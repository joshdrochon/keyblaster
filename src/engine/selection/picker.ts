import type { WordRecord } from "../types.js";
import type { Allowlist } from "../allowlist/index.js";
import { checkWord, normalizeWord } from "../allowlist/index.js";
import { type WordBook, isEligible, recordFor } from "../words/index.js";
import { weightedPick } from "./sample.js";
import { sharedPrefixUnlocked } from "./tier.js";
import { firstLetter, isGuaranteedCatch, weightOf } from "./weights.js";

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
 *   AC-9.2  every 6th slot is a guaranteed-catch word if none in the last 5
 *   AC-9.1  no repeats until the stage pool is exhausted
 *   AC-9.3  ~20% of slots come from earlier stops
 *   AC-9.4  a word missed this stage is not re-served until the next stage
 *
 * Order, most protected first:
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
export type Relaxation = "repeat" | "catch" | "source" | "eligibility";

export interface SelectionState {
  /** Stage index along the route (types.stageIndexOf). */
  readonly stage: number;
  /** This stop's pool: deduped, normalised, allowlisted. Never empty. */
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
}

export interface Picked {
  readonly ok: true;
  readonly word: string;
  readonly source: "stage" | "retention";
  /** True if the chosen word satisfies AC-9.2's predicate. */
  readonly guaranteedCatch: boolean;
  /** True if this slot was the forced 6th (AC-9.2). */
  readonly forcedCatch: boolean;
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

export interface SelectionInput {
  readonly stage: number;
  readonly stagePool: Iterable<string>;
  readonly retentionPool?: Iterable<string>;
  readonly book?: WordBook;
  /** If given, every emitted word is guaranteed to be allowlisted. */
  readonly allowlist?: Allowlist;
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
  const stagePool = cleanPool(input.stagePool, input.allowlist);
  if (stagePool.length === 0) throw new EmptyStagePoolError(input.stage);

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
    sharedPrefixTier: sharedPrefixUnlocked(stagePool, book),
  };
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
    const word = weightedPick(candidates, (w) => weightOf(context.book[w]), context.rng);
    if (word === undefined) continue;
    return commit(word, attempt, state, context, used, forcedCatch, preferred);
  }

  // Unreachable with an empty board - see the precedence note at the top.
  return { ok: false, reason: "no-legal-word", state };
}

/**
 * Rungs in precedence order: catch before repeat before source before
 * eligibility. When the slot is not forced, the catch rungs are skipped rather
 * than duplicated.
 */
function cascade(
  forcedCatch: boolean,
  preferred: "stage" | "retention",
  other: "stage" | "retention",
): Attempt[] {
  const out: Attempt[] = [];
  const catchPasses = forcedCatch ? [true, false] : [false];
  for (const requireCatch of catchPasses) {
    for (const fresh of [true, false]) {
      for (const source of [preferred, other]) {
        out.push({ source, fresh, requireCatch, requireEligible: true });
      }
    }
  }
  // Last resort: ignore the no-replacement cycle AND the in-stage eligibility
  // refinement. AC-2.1's filter still applies and is never dropped.
  for (const source of [preferred, other]) {
    out.push({ source, fresh: false, requireCatch: false, requireEligible: false });
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
  // the pool is exhausted" means. The bag is NOT seeded with the word just
  // served: a back-to-back repeat is already impossible because a live word is
  // never re-spawned and (tier locked) its own first letter is blocked, and
  // seeding it would make that one word appear less often than the rest.
  const nextUsed = new Set(usedSet);
  nextUsed.add(word);
  const cycled = nextUsed.size >= pool.length;
  const nextUsedList = cycled ? [] : [...nextUsed];

  const guaranteedCatch = isGuaranteedCatch(word, recordFor(context.book, word));

  const relaxed: Relaxation[] = [];
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
      // AC-9.2's counter is driven by what the word IS, not by why it was
      // chosen: an unforced slot that happens to serve a mastered word resets
      // the window exactly like a forced one.
      sinceCatch: guaranteedCatch ? 0 : state.sinceCatch + 1,
    },
  };
}

/**
 * Does this pool contain anything AC-9.2 would accept? Content tooling and the
 * gauntlet use it to flag a stage whose forced-catch slot is unsatisfiable -
 * which is every stage pool on a brand-new profile, since EASE_NEW is 1.6.
 */
export function poolHasCatchWord(pool: readonly string[], book: WordBook): boolean {
  return pool.some((w) => isGuaranteedCatch(w, recordFor(book, w)));
}
