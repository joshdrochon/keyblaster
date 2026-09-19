import type { StopId } from "../types.js";
import { HULL_PASS_COST, HULL_STRIKE_COST } from "../hull/index.js";

/**
 * TWO-LAYER ROCKS (D101, UR-106; AC-26.1..AC-26.5).
 *
 * At the last two stops some asteroids are genuinely bigger than the rest. You
 * type the word on the shell and it breaks - but only the SHELL breaks,
 * revealing a smaller rock inside carrying a SECOND word, which has to be typed
 * as well before the rock is gone.
 *
 * This module is the whole of the RULE. It owns which stops nest, how big each
 * layer is, how long the pair falls, what each way of losing it costs the hull,
 * and what cracking the whole rock pays. It owns none of the drawing and none
 * of the wiring: `FlightScene` reads these and `@engine/spawn` proves the
 * geometry.
 *
 * Pure TypeScript: no Phaser, no DOM, no Math.random (CLAUDE.md HARD RULES).
 *
 * =========================================================================
 * THE THREE THINGS THIS FEATURE COULD HAVE BROKEN, AND WHERE EACH IS ANSWERED
 * =========================================================================
 *
 * 1. AC-2.1 - EVERY LIVE WORD STARTS WITH A DISTINCT FIRST LETTER.
 *
 *    That invariant is what makes auto-lock unambiguous (D24, AC-3.1): the
 *    child presses one key and exactly one rock can be meant. An inner word
 *    appearing mid-belt is a new live word, and if it shared a first letter
 *    with anything already falling - INCLUDING the shell the child is half way
 *    through - the game would pick a target for them.
 *
 *    THE ANSWER IS TO RESERVE THE LETTER FOR THE WHOLE LIFE OF THE ROCK, not to
 *    check it at the reveal. Both words are drawn at SPAWN, by two consecutive
 *    `pickNext` calls whose `live` set includes the shell for the second call -
 *    so the two layers cannot collide with each other - and the scene then
 *    reports BOTH words as live for as long as the shell is intact
 *    (`liveWordsOf`). Nothing else can take the core's letter while the shell
 *    is up, so the reveal cannot collide with anything.
 *
 *    A reveal-time pick was the alternative and it is unshippable: `pickNext`
 *    is allowed to answer "no legal word on this tick", which is a fine answer
 *    for a spawner that can wait and no answer at all for a shell that has just
 *    come apart on screen.
 *
 *    THE COST, STATED PLAINLY: a nested rock spends TWO of the board's distinct
 *    first letters for its whole life instead of one, so a board carrying one
 *    is one letter shallower than it would otherwise be. That is why
 *    `NESTED_MAX_LIVE` is 1 - see it.
 *
 * 2. AC-22.8 - NO WORD PLATE EVER COVERS ANOTHER.
 *
 *    `@engine/spawn`'s `plateKeepOuts` proves that by interval arithmetic over
 *    a rock's whole trajectory, decided at spawn. The core's plate is a NEW
 *    plate arriving on a board that was already proven safe, so the proof has
 *    to be extended rather than trusted.
 *
 *    It is extended by proving BOTH plates at spawn. The core shares the
 *    shell's column, its angle and its fall line exactly (see `nestedFallMs`),
 *    so its whole trajectory is known the instant the shell is placed - it
 *    differs from the shell's only in plate WIDTH (a different word) and in
 *    plate OFFSET (a smaller rock hangs its plate closer). `LaneSpec.corePlate`
 *    carries it and `spawnX`/`hasCleanColumn` subtract both plates' keep-outs.
 *    The column chosen is therefore legal for the shell AND for the core, at
 *    every instant of the fall, whenever the break happens.
 *
 * 3. FR-8 - THE FALL BUDGET.
 *
 *    See `nestedFallMs`. The short version: the pair is granted the SUM of the
 *    two words' own FR-8 budgets and falls at one constant rate for the whole
 *    of it, so neither layer is answerable-by-luck and neither is a trap.
 * =========================================================================
 */

/**
 * The stops that carry two-layer rocks (D101).
 *
 * NEPTUNE AND PLUTO, AND NOTHING EARLIER. It is a late-route escalation: a
 * child arriving at Neptune has flown four belts and the game has measured
 * them four times, so the difficulty controller has an opinion and the pilot
 * has a habit. Putting a two-word rock on Mars would mean a child meeting the
 * mechanic in the same minute they meet the belt.
 *
 * A LIST AND NOT A STAGE-INDEX THRESHOLD, deliberately. `stageIndexOf` would
 * make this "stage >= 5", which silently becomes "stage >= 5 of whatever the
 * route is now" the day a stop is inserted. The two stops are named because
 * they are the decision.
 */
export const NESTED_STOPS: readonly StopId[] = ["neptune", "pluto"] as const;

export const isNestedStop = (stop: StopId): boolean => NESTED_STOPS.includes(stop);

/**
 * The share of a stop's rocks that are two-layer, as a probability per eligible
 * spawn.
 *
 * ================== WHY IT IS A SHARE AND NOT A COUNT ==================
 * A count ("three per belt") has to be scheduled, and a schedule is a second
 * pacing rule sitting beside `@engine/pacing` with nothing keeping the two
 * honest. A share is read once, at the only moment the question is asked.
 *
 * ================== WHERE THE NUMBERS COME FROM ==================
 * They are bounded from ABOVE by the route simulation's bar - no pilot may gain
 * a stall at Neptune or Pluto against a baseline of zero - and from BELOW by
 * the feature being noticeable. A 58-word belt spawns about 58 rocks; at
 * Neptune's 0.22 the eligible spawns yield roughly 5-6 nested rocks a belt and
 * at Pluto's 0.30 roughly 7-8, which is often enough to be the stop's character
 * and rare enough that an ordinary rock is still the ordinary case.
 *
 * Pluto is the higher of the two because it is the last stop and the whole
 * route's difficulty curve slopes that way (`@engine/controller/stopBand`).
 */
export const NESTED_SHARE: Readonly<Partial<Record<StopId, number>>> = {
  neptune: 0.22,
  pluto: 0.3,
};

export function nestedShareFor(stop: StopId): number {
  return NESTED_SHARE[stop] ?? 0;
}

/**
 * HOW MANY TWO-LAYER ROCKS MAY BE ON THE BOARD AT ONCE. One.
 *
 * ================== THIS IS AC-2.1'S NUMBER, NOT A TASTE CALL ==================
 * A nested rock holds two of the board's distinct first letters for its whole
 * life (see the header). The belt's deepest board is `MAX_LIVE_MAX` rocks, and
 * every one of them needs a letter no other live word has taken. Two nested
 * rocks on a 7-deep board would need NINE distinct first letters out of a stage
 * pool whose words do not begin with nine different letters often enough to
 * promise it - and when the promise fails, `pickNext` answers "no legal word",
 * the belt holds a tick, and the board runs shallower than the knob asked for.
 *
 * That is not a crash and it is not even a bug; it is the belt quietly refusing
 * to be as deep as the difficulty curve says it should be, at the two stops
 * where the curve is steepest. One nested rock costs one letter, which the
 * cascade absorbs; two costs two, which it measurably does not.
 *
 * It also bounds the picture. The shell is the biggest object the playfield
 * ever draws (`NESTED_SHELL_MIN_PX`), and two of them level with each other on
 * a board that also has to stay legible is a different board from the one
 * `tests/unit/flight/plateSeparation.test.ts` sweeps.
 */
export const NESTED_MAX_LIVE = 1;

// ---------------------------------------------------------------------------
// Size (AC-26.2: the shell is visibly bigger, the core is smaller)
// ---------------------------------------------------------------------------

/**
 * The biggest an ORDINARY rock can be - `render/asteroid.MAX_SIZE_PX`.
 *
 * DUPLICATED RATHER THAN IMPORTED, because `src/engine` may not import
 * `src/game` (CLAUDE.md: the engine never touches Phaser, and `asteroid.ts` is
 * a renderer). The tie is asserted in `tests/unit/nested/nested.test.ts`
 * instead, so if the renderer ever moves its clamp this goes red rather than
 * drifting - the same arrangement `scoring/combo.LENGTH_BONUS_FLOOR` uses for
 * its tie to `selection/weights.CATCH_MAX_LENGTH`.
 */
export const ORDINARY_MAX_SIZE_PX = 140;

/** How much bigger the shell is than the rock the same word would have made. */
export const NESTED_SHELL_SCALE = 1.5;

/**
 * THE SMALLEST A SHELL MAY BE, AND WHY THERE IS A FLOOR AT ALL.
 *
 * The brief is "the outer rock is visibly bigger than a NORMAL rock", and a
 * plain multiplier does not deliver that. An ordinary rock is 56-140 px
 * depending on its word, so 1.5x a three-letter word is 84 px - smaller than an
 * ordinary eight-letter rock, and the child would have to know the word's
 * length to know what they were looking at. The mechanic would be legible only
 * in hindsight, which for a seven-year-old is not legible.
 *
 * So every shell clears the LARGEST ordinary rock by 20%: 1.2 x 140 = 168. The
 * claim "a shell is bigger than every ordinary rock at every word length" is
 * then arithmetic rather than a hope about which words a pool carries, and
 * `tests/unit/nested/nested.test.ts` asserts it over the whole length range.
 */
export const NESTED_SHELL_MIN_PX = Math.round(ORDINARY_MAX_SIZE_PX * 1.2);

/**
 * And the ceiling, px.
 *
 * Bounded by the board rather than by taste. `SPAWN_MARGIN_PX` leaves a 1280 px
 * playable span at the 16:9 floor and `@engine/spawn` sizes its keep-out by the
 * WIDER of a rock and its plate; a plate's half-width already reaches 108 px at
 * the longest word any shipped pool carries, so a shell half-width up to 105 px
 * costs the column rule nothing it was not already paying. Above this the rock
 * starts to be the binding constraint on where a word may go, which would make
 * this feature quietly eat the angle budget UR-83 measured.
 */
export const NESTED_SHELL_MAX_PX = 210;

/**
 * The shell's drawn size, from the size the same word would have had alone.
 *
 * Takes the ORDINARY size rather than a word length, so the renderer's
 * `asteroidSizePx` stays the single definition of how a word maps to a rock and
 * this is a transform on top of it. Non-decreasing in its argument, so AC-2.3's
 * "size is a monotonic function of word length" still holds WITHIN this class
 * of rock - see C21 for the across-class reading, which this feature knowingly
 * breaks because the owner asked for a rock that is bigger than a normal one.
 */
export function nestedShellSizePx(ordinarySizePx: number): number {
  if (!Number.isFinite(ordinarySizePx)) return NESTED_SHELL_MIN_PX;
  const scaled = Math.max(0, ordinarySizePx) * NESTED_SHELL_SCALE;
  return Math.min(NESTED_SHELL_MAX_PX, Math.max(NESTED_SHELL_MIN_PX, scaled));
}

// ---------------------------------------------------------------------------
// Fall time (FR-8, AC-26.3)
// ---------------------------------------------------------------------------

/**
 * ================== THE FALL BUDGET FOR A PAIR OF WORDS ==================
 *
 * THE QUESTION THE BRIEF ASKS, HONESTLY. The core inherits a partly-fallen
 * position, so it has less screen left than a rock that just arrived. Does it
 * get a fresh budget?
 *
 * THE ANSWER: NO FRESH CLOCK, BUT A FULL SHARE. The pair is granted
 * `fallTimeMs(shell) + fallTimeMs(core)` at spawn and falls at ONE constant
 * rate over the whole of it. The core does not get a new timer when the shell
 * breaks; it gets the remainder of a budget that was sized for both words from
 * the first frame.
 *
 * ================== WHY NOT A FRESH CLOCK AT THE REVEAL ==================
 * It was the obvious design and it fails twice.
 *
 *   IT CHANGES THE ROCK'S SPEED MID-FALL. Re-basing "remaining distance over a
 *   new budget" makes the rock accelerate when the child is quick and decelerate
 *   when they are slow. This project already has a bug report for a rock that
 *   moved differently near the bottom (UR-83: an 80 px sideways slide as a rock
 *   passed the ship), and the finding there was that a trajectory which changes
 *   part way down reads as a glitch rather than as a rule.
 *
 *   AND IT HAS A DEGENERATE CASE THAT LOOKS BROKEN. A child who cracks the
 *   shell at the last possible instant leaves the core six pixels above the
 *   breach line with a full five-second budget to cross them - a rock hovering
 *   over the ship. There is no clamp that fixes that without reintroducing the
 *   trap it was supposed to remove.
 *
 * ================== WHY THE SUM IS NOT A TRAP ==================
 * Because it is EXACTLY the budget the two words would have had as two separate
 * rocks, and a child answers them serially either way - AC-2.1 gives every live
 * word a distinct first letter precisely so that the player is one server.
 *
 *     two ordinary rocks   budget(a) + budget(b), spent serially
 *     one nested rock      budget(a) + budget(b), spent serially
 *
 * FR-8's budget for one word already carries the keystroke headroom
 * (`KEYSTROKE_BUDGET_FACTOR`, 1.5 at the knob's floor) and the recognition
 * allowance (`recognitionBaseMs`), both scaled to this pilot's MEASURED
 * interval. Summing two of them sums the headroom too, so a pilot at their own
 * measured speed finishes both layers with the same fraction of the budget
 * unspent that they would have had on either word alone.
 *
 * It is in one respect strictly EASIER than the two rocks: there is no spawn
 * gap between the layers and no second rock to find on the board, so the
 * queueing time `@engine/pacing` would have charged between them is not charged
 * at all. The route simulation measures the claim rather than resting on it -
 * `tests/unit/simulation/nestedRoute.test.ts`, four pilots including the
 * grade-2 model at 600 ms between keys.
 */
export function nestedFallMs(shellFallMs: number, coreFallMs: number): number {
  const a = Number.isFinite(shellFallMs) ? Math.max(0, shellFallMs) : 0;
  const b = Number.isFinite(coreFallMs) ? Math.max(0, coreFallMs) : 0;
  return a + b;
}

/**
 * The fraction of the pair's fall that is the SHELL's own budget.
 *
 * Exported because it is the number that says whether the core is answerable,
 * and a number nobody can read is a number that drifts. A child who cracks the
 * shell inside this fraction hands the core its whole FR-8 budget; one who runs
 * over eats into it, exactly as running over on an ordinary rock eats into the
 * NEXT rock's queueing time. Nothing is taken from them that an ordinary belt
 * would not have taken.
 */
export function shellBudgetFraction(shellFallMs: number, coreFallMs: number): number {
  const total = nestedFallMs(shellFallMs, coreFallMs);
  if (total <= 0) return 1;
  return Math.max(0, Math.min(1, shellFallMs / total));
}

/**
 * What the belt should expect a two-layer rock to COST this player, from the
 * two single-word estimates (`@engine/pacing.expectedClearMs`).
 *
 * The sum, for the same reason the budget is the sum: the child types both
 * words, one after the other. This matters more than it looks - `spawnGapMs`
 * paces the whole belt off `liveClearMs`, so a nested rock reported as costing
 * one word's work would make the spawner feed the board as though the biggest
 * object on it were free.
 */
export function nestedClearEstimateMs(shellMs: number, coreMs: number): number {
  return nestedFallMs(shellMs, coreMs);
}

// ---------------------------------------------------------------------------
// The hull (AC-26.4)
// ---------------------------------------------------------------------------

/**
 * WHAT A TWO-LAYER ROCK COSTS THE HULL, BY HOW MUCH OF IT WAS ANSWERED.
 *
 *     shell intact at the ship   HULL_STRIKE_COST   a whole mark
 *     core exposed at the ship   HULL_PASS_COST     half a mark
 *
 * ================== THE SHELL IS AN ORDINARY STRIKE ==================
 * A rock arrived, nothing on it was typed, and it hit the ship. That is exactly
 * AC-4.2 and it gets AC-4.2's cost. It is also, deliberately, no MORE than
 * that: an unbroken shell is two unanswered words, and charging a mark and a
 * half for it was considered and rejected - D31 rules out a surface that frames
 * a run as something lost, and a rock that costs more than other rocks is the
 * clearest form of that there is. A nested rock is therefore CHEAPER than the
 * two ordinary rocks it replaces, never dearer.
 *
 * ================== THE CORE IS THE HALF MARK, AND WHY ==================
 * `HULL_PASS_COST` exists because the owner ruled that any word passing the
 * ship is a failure while "a near miss is not the same event as a hit and must
 * not read like one" (UR-91, C20). A rock whose shell the child removed is the
 * same shape of event one layer in: real work landed, the rock still got
 * through. It is the only place in this game where a child can do half a job,
 * and the hull is the only channel that can tell them the difference.
 *
 * REUSING THE CONSTANT RATHER THAN ADDING ONE IS THE POINT. A third cost would
 * be a third thing to tune and a third thing to keep in step with `hullMarksLit`
 * and `starsForHullHits`. There are two ways to lose a rock and there are two
 * costs.
 */
export const NESTED_SHELL_HULL_COST = HULL_STRIKE_COST;
export const NESTED_CORE_HULL_COST = HULL_PASS_COST;

/** What this rock costs, given whether its shell was still on when it landed. */
export function nestedHullCost(shellIntact: boolean): number {
  return shellIntact ? NESTED_SHELL_HULL_COST : NESTED_CORE_HULL_COST;
}

// ---------------------------------------------------------------------------
// Whether THIS spawn nests
// ---------------------------------------------------------------------------

/** Everything the gate needs that is not a coin flip. */
export interface NestGate {
  readonly stopId: StopId;
  /** Two-layer rocks already on the board. */
  readonly nestedLive: number;
  /** Stage words not yet spawned. A pair needs two of them. */
  readonly wordsLeft: number;
  /**
   * Either layer is a word the GAME chose to show again - a retention probe or
   * one the child missed (D21, D23, `Picked.practice`).
   *
   * A NESTED ROCK IS NEVER A PRACTICE ROCK, and this is the one place the two
   * features meet. A practice rock is placed off the ship's lane and sails PAST
   * the hull rather than into it, because charging a child for the game's own
   * decision to re-teach them is the direction D31 forbids outright. A rock
   * with two words has two chances to be that, and the pass-by rule has no
   * sensible half: does a rock whose shell is a practice word and whose core is
   * not sail past?
   *
   * So the question is refused rather than answered. If either pick comes back
   * practice, this spawn is an ordinary rock and the D21/D23 promise is
   * untouched by this feature at every stop including these two.
   */
  readonly anyPractice: boolean;
}

/**
 * May this spawn be a two-layer rock, before the draw?
 *
 * Split from the draw so the deterministic half can be tested without a PRNG
 * and so a caller can skip the draw entirely - which matters, because the draw
 * comes off the seeded stream and a gate that consumed it on every spawn at
 * every stop would shift every column in the game.
 */
export function nestingAllowed(gate: NestGate): boolean {
  if (!isNestedStop(gate.stopId)) return false;
  if (gate.anyPractice) return false;
  if (gate.nestedLive >= NESTED_MAX_LIVE) return false;
  return gate.wordsLeft >= 2;
}

/** The draw itself. `draw` is one sample from the scene's seeded rng, [0, 1). */
export function nestingDrawPasses(stop: StopId, draw: number): boolean {
  if (!Number.isFinite(draw)) return false;
  return draw < nestedShareFor(stop);
}

/**
 * The whole gate in one call: the deterministic conditions AND the draw.
 *
 * `draw` is taken by the caller rather than by a `rng` argument so that the
 * order of the seeded stream stays the caller's business - `FlightScene` is
 * emphatic that `this.rng`'s order is load-bearing and reproduced rock for rock
 * by `tests/unit/flight/plateSeparation.test.ts`.
 */
export function shouldNest(gate: NestGate, draw: number): boolean {
  return nestingAllowed(gate) && nestingDrawPasses(gate.stopId, draw);
}

/**
 * The words a rock contributes to AC-2.1's live set.
 *
 * ONE FUNCTION BECAUSE TWO WOULD DRIFT. The scene reports live words to
 * `pickNext` and the belt simulation reports them to the same function; if they
 * disagreed about whether a shelled core is live, the harness would be proving
 * the invariant on a board the game does not fly. That is the defect class this
 * repo has been bitten by more than once - a check that exercises something
 * ADJACENT to the shipped thing.
 */
export function liveWordsOf(rock: {
  readonly word: string;
  readonly coreWord?: string | null;
}): readonly string[] {
  const core = rock.coreWord;
  return core === undefined || core === null ? [rock.word] : [rock.word, core];
}
