/**
 * Combo, multiplier and word score (D75, D81, PRD FR-6c / AC-6c.1).
 *
 * The decision log records Type Storm's word score as `length x 20 x combo`
 * with the combo capped at x10, and D75 puts a combo multiplier on our score.
 * AC-6c.1 fixes the multiplier as `min(combo, 10)`, so that is what ships -
 * same shape, same cap, our AC.
 */

/** Type Storm's per-letter score weight, mirrored per the decision log. */
export const POINTS_PER_LETTER = 20;

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
  /** AC-6c.1: min(combo, 10). The HUD renders this as "xN". */
  readonly multiplier: number;
}

/** Multiplier for a given combo. AC-6c.1. Floors and clamps defensively. */
export function multiplierFor(combo: number): number {
  if (!Number.isFinite(combo) || combo <= 0) return 0;
  return Math.min(Math.floor(combo), MAX_MULTIPLIER);
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
 * Score for one completed word: `length x 20 x multiplier`.
 *
 * `multiplier` is the multiplier AFTER the hit has been applied to the combo,
 * so the first word of a chain scores at x1 rather than x0. Callers run the
 * reducer, then score with the new state - `scoreWordWithCombo` does both.
 */
export function wordScore(wordLength: number, multiplier: number): number {
  if (!Number.isFinite(wordLength) || wordLength <= 0) return 0;
  if (!Number.isFinite(multiplier) || multiplier <= 0) return 0;
  return (
    Math.floor(wordLength) *
    POINTS_PER_LETTER *
    Math.min(Math.floor(multiplier), MAX_MULTIPLIER)
  );
}

export interface ScoredHit {
  readonly combo: ComboState;
  readonly points: number;
}

/**
 * Apply a completed word: advance the combo, then score at the new multiplier.
 * This ordering is what makes AC-6c.1's "x1 on the first word" hold.
 */
export function scoreWordWithCombo(
  state: ComboState,
  wordLength: number,
): ScoredHit {
  const combo = comboReducer(state, "hit");
  return { combo, points: wordScore(wordLength, combo.multiplier) };
}
