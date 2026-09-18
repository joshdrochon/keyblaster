/**
 * Combo, multiplier and word score (D75, D81, PRD FR-6c / AC-6c.1).
 *
 * The decision log records Type Storm's word score as `length x 20 x combo`
 * with the combo capped at x10, and D75 puts a combo multiplier on our score.
 * AC-6c.1 fixes the multiplier as `min(combo, 10)`, so that is what ships -
 * same shape, same cap, our AC.
 *
 * NON-FINITE INPUT POLICY (shared with stars.ts): a finite number out of range
 * is clamped and floored to the nearest value that is in range; a non-finite
 * number is not a play outcome at all, so it is treated as unusable and yields
 * the no-reward value. NaN and Infinity therefore both give multiplier 0 and
 * score 0 - junk never earns points.
 *
 * `UR-72`: LENGTH NOW PAYS, AND UNDER THE OLD CURVE IT WAS WORSE THAN FLAT.
 * `UR-72` asks for longer words on the rocks and for a long word to be worth
 * more than a short one. `length x 20 x combo` is linear in length, so the
 * reward PER KEYSTROKE
 * was a constant 20 x combo whatever the word was - while the combo advances
 * once per WORD, not once per letter. Two four-letter words therefore beat one
 * nine-letter word outright (160 + 80 of multiplier growth against 180 at the
 * same starting combo) and cost one keystroke less. The curve that was supposed
 * to be neutral on length was quietly paying the player to avoid long words,
 * which is the opposite of what the content change beside this one is for.
 *
 * The fix is a superlinear term, not a bigger flat weight: the per-letter rate
 * stays where the decision log put it and a quadratic bonus is added on top of
 * it for every letter past the guaranteed-catch band (`LENGTH_BONUS_FLOOR`).
 * Below that floor nothing changes at all, so a struggling pilot's three- and
 * four-letter rocks score exactly what they scored before - this adds a reward
 * for reach, it does not take one away from anybody (D31).
 */

/** Type Storm's per-letter score weight, mirrored per the decision log. */
export const POINTS_PER_LETTER = 20;

/**
 * Length at which the bonus starts counting, and the reason it is this number.
 *
 * It is AC-9.2's guaranteed-catch length (`selection/weights.CATCH_MAX_LENGTH`,
 * 4): the longest word the engine is willing to promise a player can catch.
 * Everything at or below it is the floor the game already treats as "within
 * reach", so that is exactly where "reach" should start being paid for.
 *
 * It is DUPLICATED rather than imported so that scoring does not depend on
 * selection - two engine modules that have no other reason to know about each
 * other. The tie is asserted in tests/unit/scoring/combo.test.ts instead, so if
 * the selection lane ever moves its number this fails rather than drifting.
 */
export const LENGTH_BONUS_FLOOR = 4;

/**
 * Points added per squared letter past `LENGTH_BONUS_FLOOR`.
 *
 * Half `POINTS_PER_LETTER`, chosen against one measurable bar: a nine-letter
 * word must beat two four-letter words at EVERY combo, including x10 where both
 * short words are also capped. At 10 that is 430 against 240 at x1 and 4300
 * against 1600 at x10 - a premium of 1.8x to 2.7x, which is meant to be felt.
 * The premium is paying for real risk as well as effort: one slip anywhere in a
 * long word resets the combo (`comboReducer`), and the longer the word the more
 * of the chain is staked on it.
 */
export const LENGTH_BONUS_PER_LETTER = 10;

/** AC-6c.1 / D81: the multiplier stops climbing at x10. */
export const MAX_MULTIPLIER = 10;

/**
 * Everything that moves the combo. Named for what happened in the world, not
 * for a verdict on the player: D31 forbids a "wrong" signal, so a mistyped key
 * is a `typo` event and an asteroid crossing the line is a `hullHit` event.
 * Neither is scored, counted against the player, or surfaced as a failure.
 */
export type ComboEvent = "hit" | "typo" | "hullHit";

export interface ComboState {
  /** Consecutive words completed without a typo or a hull hit. */
  readonly combo: number;
  /** AC-6c.1: min(combo, 10). This is the SCORING multiplier. */
  readonly multiplier: number;
}

/** Multiplier for a given combo. AC-6c.1. */
export function multiplierFor(combo: number): number {
  if (!Number.isFinite(combo) || combo <= 0) return 0;
  return Math.min(Math.floor(combo), MAX_MULTIPLIER);
}

/**
 * What the HUD renders as "xN" (AC-6c.1).
 *
 * This is deliberately NOT the scoring multiplier. `multiplierFor(0)` is 0
 * because a combo of nothing scores nothing, but AC-6c.1 also says the HUD
 * shows "xN", and an "x0" sitting on screen at stage start - before the player
 * has had a chance to do anything - is a display of having nothing, which is
 * the exact register D31 rules out. The floor of x1 is a display floor only;
 * no score is ever computed from it.
 */
export function hudMultiplierFor(combo: number): number {
  return Math.max(1, multiplierFor(combo));
}

/** A combo state from a raw count, so callers never build one by hand. */
export function comboState(combo: number): ComboState {
  const c = Number.isFinite(combo) && combo > 0 ? Math.floor(combo) : 0;
  return { combo: c, multiplier: multiplierFor(c) };
}

/** Stage start, and the state a typo or hull hit returns to. */
export const INITIAL_COMBO_STATE: ComboState = comboState(0);

/**
 * The AC-6c.1 reducer: pure, total, and the single place the reset rule lives.
 *
 * Both `typo` and `hullHit` reset to zero. That is the whole of the rule - a
 * reset costs the player their multiplier and nothing else. There is no
 * deduction and no stored count of resets, because a stored count is the shape
 * of a lives counter and D31 rules that out.
 */
export function comboReducer(state: ComboState, event: ComboEvent): ComboState {
  switch (event) {
    case "hit":
      return comboState(state.combo + 1);
    case "typo":
    case "hullHit":
      return INITIAL_COMBO_STATE;
  }
}

/**
 * Base value of one word before the combo, in points. Exported so the length
 * curve can be read and tested on its own, without a multiplier in the way.
 *
 *     base(len) = len x 20 + 10 x max(0, len - 4)^2
 *
 *     len   3    4    5    6    7    8    9   10   11   12   13
 *     base 60   80  110  160  230  320  430  560  710  880 1070
 *
 * Non-finite or non-positive length is not a word, so it is worth nothing
 * (module header, non-finite input policy). Length is floored, never rounded:
 * a fractional length is junk input and must not round UP into a bonus band.
 */
export function wordBaseScore(wordLength: number): number {
  if (!Number.isFinite(wordLength) || wordLength <= 0) return 0;
  const len = Math.floor(wordLength);
  const over = Math.max(0, len - LENGTH_BONUS_FLOOR);
  return len * POINTS_PER_LETTER + LENGTH_BONUS_PER_LETTER * over * over;
}

/**
 * Score for one completed word: `base(length) x multiplier`.
 *
 * OWNERSHIP CONTRACT. `multiplier` must be the multiplier AFTER the hit has
 * been applied to the combo, so the first word of a chain scores at x1 rather
 * than x0. There are exactly two correct ways to score a word, and mixing them
 * is the bug this note exists to prevent:
 *
 *   1. The caller owns the combo (it already ran `comboReducer(s, "hit")` for
 *      AC-3.4): call `wordScore(len, newState.multiplier)`. Do NOT also call
 *      `scoreWordWithCombo`, which would advance the combo a second time.
 *   2. This module owns the combo: call `scoreWordWithCombo(state, len)` and do
 *      not run the reducer yourself.
 *
 * Passing a pre-hit multiplier - `wordScore(len, INITIAL_COMBO_STATE.multiplier)`
 * - scores 0. That is correct arithmetic for a x0 multiplier, not a special
 * case, and it is why option 1 says "newState".
 */
export function wordScore(wordLength: number, multiplier: number): number {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return 0;
  return (
    wordBaseScore(wordLength) * Math.min(Math.floor(multiplier), MAX_MULTIPLIER)
  );
}

/**
 * WHAT A TWO-LAYER ROCK PAYS (D101, AC-26.5).
 *
 * ================== THE QUESTION ==================
 * Two words, one rock. Each layer is a completed word and is scored as one -
 * `wordScore(len, multiplier)`, the combo advancing on each, exactly as if they
 * had been two rocks. That much is not a decision; it is what a completed word
 * is worth and there is no reason for this rock's words to be worth less.
 *
 * The decision is what CRACKING THE WHOLE ROCK pays on top, and "nothing" was a
 * real candidate. It is rejected because scoring two layers at face value makes
 * a nested rock pay exactly what two ordinary rocks pay while being the harder
 * object: both words are answered inside one budget with no gap between them,
 * the rock is the biggest thing on the board, and one slip anywhere across
 * either word resets the chain that was riding on both of them. A reward that
 * is identical to the easy case is a mechanic the game is not paying for.
 *
 * ================== THE BONUS IS THE CURVE ALREADY HERE ==================
 * It is what the rock would have been worth AS ONE WORD of the combined length,
 * minus what the two layers already paid:
 *
 *     crack(a, b) = base(a + b) - base(a) - base(b)
 *
 * which, since `base` is linear plus `LENGTH_BONUS_PER_LETTER x over^2`, is
 * exactly the superlinear term the child earned by facing the letters together
 * instead of in two separate jobs. No new constant, no new curve, and it pays
 * for reach on the same slope `UR-72` put there:
 *
 *     shell  core   base(a)  base(b)  base(a+b)  crack
 *       3      3       60       60       160       40
 *       4      4       80       80       320      160
 *       5      3      110       60       320      150
 *       6      5      160      110       710      440
 *
 * ================== IT IS PAID ONLY WHEN THE ROCK IS GONE ==================
 * On the CORE's blast, at the core's multiplier, because that is the instant
 * the whole rock was answered. A child who cracks the shell and loses the core
 * keeps the shell's own points and does not get this - which is the one place
 * the scoring says out loud that the rock was the job, not the word.
 *
 * Non-finite or non-positive lengths are not words, so they are worth nothing;
 * `wordBaseScore` already holds that policy and this inherits it rather than
 * restating it.
 */
export function nestedCrackBonus(shellLength: number, coreLength: number): number {
  const a = Number.isFinite(shellLength) ? Math.floor(Math.max(0, shellLength)) : 0;
  const b = Number.isFinite(coreLength) ? Math.floor(Math.max(0, coreLength)) : 0;
  if (a <= 0 || b <= 0) return 0;
  return Math.max(0, wordBaseScore(a + b) - wordBaseScore(a) - wordBaseScore(b));
}

/**
 * The bonus at a multiplier, i.e. what actually lands on the score.
 *
 * Shares `wordScore`'s ownership contract to the letter: `multiplier` is the
 * multiplier AFTER the core's hit has advanced the combo, so cracking a rock on
 * the first word of a chain pays at x1 rather than at x0.
 */
export function nestedCrackScore(
  shellLength: number,
  coreLength: number,
  multiplier: number,
): number {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return 0;
  return (
    nestedCrackBonus(shellLength, coreLength) *
    Math.min(Math.floor(multiplier), MAX_MULTIPLIER)
  );
}

export interface ScoredHit {
  readonly combo: ComboState;
  readonly points: number;
}

/**
 * Apply a completed word: advance the combo, then score at the new multiplier.
 * This ordering is what makes AC-6c.1's "x1 on the first word" hold. See the
 * ownership contract on `wordScore` before calling this alongside your own
 * `comboReducer` call.
 */
export function scoreWordWithCombo(
  state: ComboState,
  wordLength: number,
): ScoredHit {
  const combo = comboReducer(state, "hit");
  return { combo, points: wordScore(wordLength, combo.multiplier) };
}
