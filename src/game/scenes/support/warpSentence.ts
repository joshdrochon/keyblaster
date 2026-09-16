/**
 * The warp-sentence typing rule (D30, PRD FR-16 / AC-16.2 / AC-16.3).
 *
 * WHERE THIS BELONGS. `src/engine`, next to `lock/machine.ts`, as a pure
 * reducer. It is here because this lane may not write to `src/engine`, and the
 * alternative - putting the rule in `WarpScene.ts` - would put game logic in a
 * scene, which the lane brief forbids outright. So it is written to engine
 * rules: no Phaser, no DOM, no clock, no randomness, pure functions over plain
 * data. Moving the file into `src/engine/warp/` is a `git mv` and an import
 * rewrite, and it should happen.
 *
 * WHY IT IS NOT `lock/machine.ts`. The lock reduces keystrokes against a set of
 * competing falling words, with parking, ambiguity and spawn/despawn. A warp
 * sentence is one fixed string with spaces and punctuation, no competition and
 * no timing pressure, and - the load-bearing difference - a typo must leave the
 * caret exactly where it was (AC-16.2). Reusing the lock would mean teaching it
 * a second, contradictory notion of "target".
 *
 * AC-16.2  a typo does not reset the sentence. `index` is unchanged, `typos`
 *          increments, and `lastEvent` becomes "retry" so the scene can
 *          re-highlight the current letter. There is no reset path in this file.
 * AC-16.3  `chargeFraction` is `index / length`. On the final character `index`
 *          equals `length`, and `n / n` is exactly 1 in IEEE-754 for every
 *          finite non-zero n - so the meter lands on 100%, not 99.97%.
 */

/** What the scene is asked to render and the player is asked to type. */
export interface WarpSentenceSpec {
  /** The story sentence, verbatim, including punctuation. */
  readonly text: string;
  /**
   * The words of the sentence that were also in the stage's asteroid pool,
   * i.e. the ones the player just blasted. D30 highlights these.
   */
  readonly blasted: readonly string[];
}

export type WarpEvent = "none" | "advance" | "retry" | "charged";

export interface WarpSentenceState {
  readonly text: string;
  /** Index of the next character to type; equals `text.length` when charged. */
  readonly index: number;
  /** Keystrokes that did not match. Counted, never displayed as a score (D31). */
  readonly typos: number;
  readonly charged: boolean;
  readonly lastEvent: WarpEvent;
  /** Half-open [start, end) character ranges covering the blasted words. */
  readonly highlights: readonly (readonly [number, number])[];
}

/**
 * Case-insensitive comparison. D41 makes lowercase the default letter case, and
 * a child who holds shift on a proper noun - or does not - has not made a
 * mistake worth a retry (D31). Punctuation and spaces are compared literally:
 * the sentence is the sentence.
 */
function sameChar(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Word boundaries used for highlighting; letters and digits only. */
const WORD_CHAR = /[\p{L}\p{N}']/u;

function normalizeForMatch(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
}

/**
 * Character ranges covering each blasted word, in sentence order. Matching is
 * whole-word and case-insensitive, so "Mars" in the pool highlights "Mars" in
 * the sentence but "mar" never highlights half of it.
 */
export function highlightRanges(
  text: string,
  blasted: readonly string[],
): (readonly [number, number])[] {
  const wanted = new Set(blasted.map(normalizeForMatch).filter((w) => w.length > 0));
  const ranges: (readonly [number, number])[] = [];
  let start = -1;
  for (let i = 0; i <= text.length; i += 1) {
    const ch = i < text.length ? (text[i] as string) : "";
    const isWord = i < text.length && WORD_CHAR.test(ch);
    if (isWord && start < 0) start = i;
    if (!isWord && start >= 0) {
      const word = normalizeForMatch(text.slice(start, i));
      if (wanted.has(word)) ranges.push([start, i] as const);
      start = -1;
    }
  }
  return ranges;
}

export function createWarpSentence(spec: WarpSentenceSpec): WarpSentenceState {
  return {
    text: spec.text,
    index: 0,
    typos: 0,
    // A zero-length sentence is already charged: there is nothing to type, and
    // the alternative is a meter that can never reach 100%.
    charged: spec.text.length === 0,
    lastEvent: "none",
    highlights: highlightRanges(spec.text, spec.blasted),
  };
}

/**
 * One keystroke. Never throws, never resets, and never returns a state whose
 * `index` went backwards.
 */
export function typeChar(
  state: WarpSentenceState,
  char: string,
): WarpSentenceState {
  if (state.charged) return { ...state, lastEvent: "none" };
  // Multi-codepoint input (a dead key, an IME commit) is not a character of
  // this sentence; ignore it rather than counting it against the player.
  if (char.length === 0) return { ...state, lastEvent: "none" };

  const expected = state.text[state.index];
  if (expected === undefined) return { ...state, lastEvent: "none" };

  if (!sameChar(char, expected)) {
    // AC-16.2: index untouched. The scene reads "retry" and re-highlights the
    // letter at `index`; there is no branch here that clears progress.
    return { ...state, typos: state.typos + 1, lastEvent: "retry" };
  }

  const index = state.index + 1;
  const charged = index >= state.text.length;
  return {
    ...state,
    index,
    charged,
    lastEvent: charged ? "charged" : "advance",
  };
}

/** AC-16.3. In [0, 1]; exactly 1 once the final character is accepted. */
export function chargeFraction(state: WarpSentenceState): number {
  if (state.text.length === 0) return 1;
  return state.index / state.text.length;
}

/** Whole percent for display. Exactly 100 when charged. */
export function chargePercent(state: WarpSentenceState): number {
  return Math.round(chargeFraction(state) * 100);
}

export type CellState = "typed" | "current" | "pending";

/** One character of the sentence, as the scene needs to draw it. */
export interface WarpCell {
  readonly char: string;
  readonly index: number;
  readonly state: CellState;
  /** True when this character belongs to a word the player just blasted. */
  readonly blasted: boolean;
}

export function cells(state: WarpSentenceState): WarpCell[] {
  const inRange = (i: number): boolean =>
    state.highlights.some(([a, b]) => i >= a && i < b);
  const out: WarpCell[] = [];
  for (let i = 0; i < state.text.length; i += 1) {
    out.push({
      char: state.text[i] as string,
      index: i,
      state: i < state.index ? "typed" : i === state.index ? "current" : "pending",
      blasted: inRange(i),
    });
  }
  return out;
}
