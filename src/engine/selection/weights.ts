import type { WordRecord } from "../types.js";
import type { LengthBias } from "../controller/knobs.js";
import { type Mastery, masteryOf } from "../words/index.js";

/**
 * Selection weights and the guaranteed-catch predicate
 * (D21, D22, PRD FR-9, architecture section 4.2).
 *
 * D21: "frequency tracks mastery". A word the player has never met is served
 * ten times as often as one they have mastered, because the unknown word is
 * where the learning is and the mastered word is there for combo fodder and
 * morale, not instruction.
 *
 * The four numbers are the PRD's, verbatim. They are tunable (D69) but that is
 * a PRD edit, not a code edit - so they live here as named constants and the
 * tests diff against the constants, not against literals.
 */
export const SELECTION_WEIGHT: Readonly<Record<Mastery, number>> = Object.freeze({
  unknown: 3.0,
  weak: 2.0,
  learning: 1.0,
  mastered: 0.3,
});

/** Weight for one word's record. An absent record is "unknown" (words/). */
export function weightOf(record: WordRecord | undefined): number {
  return SELECTION_WEIGHT[masteryOf(record)];
}

// ---------------------------------------------------------------------------
// FR-10's SECONDARY KNOB, `lengthBias` (UR-79)
// ---------------------------------------------------------------------------

/**
 * WHAT THIS FIXES. `lengthBias` is half of FR-10's knob set (AC-10.4) and the
 * controller has always moved it: `tightenStep` raises it before it touches
 * `maxLive`, `loosenStep` drops it to its floor first, `persistence` stores it
 * and `schema` repairs it. Nothing ever READ it. Grep for `lengthBias` across
 * `src/engine/selection` before this commit and there are no hits, so the
 * secondary knob was inert - the word a child saw was the same whether the
 * controller had tightened them to +1 or loosened them to -1.
 *
 * That was survivable while every pool was 26-32 words with a longest word of
 * 7, because there was barely a long end to bias TOWARDS. UR-79 widens the
 * pools to 64-68 with a genuine 3-to-8 letter spread, and a spread is exactly
 * what a mix knob needs to have something to say.
 *
 * ================== WHY A FACTOR AND NOT A FILTER ==================
 * A filter ("at -1 only serve words of 5 or fewer") would shrink the candidate
 * list, and the candidate list is what `picker.ts`'s totality proof rests on -
 * the final cascade rung must filter by nothing but "not live" and "first
 * letter not taken". A multiplicative weight cannot empty a list, so the proof
 * is untouched and the knob still cannot stall the board.
 *
 * ================== WHY MASTERY STILL WINS ==================
 * D21 says frequency tracks mastery. The mastery axis spans 10x
 * (unknown 3.0 -> mastered 0.3); this spans 4x at full deflection
 * (1.6 -> 0.4). So a knob at +1 re-orders words WITHIN a mastery band and
 * never promotes a mastered long word over an unknown short one:
 * 0.3 x 1.6 = 0.48 is still below 3.0 x 0.4 = 1.2.
 */

/** Word length that the bias pivots around: neither favoured nor penalised. */
export const LENGTH_BIAS_PIVOT = 5;

/** Letters either side of the pivot at which the bias reaches full strength. */
export const LENGTH_BIAS_SPAN = 3;

/** Maximum fractional swing at full deflection: 1 +/- this. */
export const LENGTH_BIAS_STRENGTH = 0.6;

/**
 * Multiplier applied to a word's selection weight for this knob position.
 *
 * `bias === 0` returns exactly 1 for every word, so a neutral knob - which is
 * `DEFAULT_KNOBS` and therefore every cold-start profile - leaves selection
 * byte-identical to the behaviour before this existed.
 */
export function lengthWeightFactor(word: string, bias: LengthBias): number {
  if (bias === 0) return 1;
  const deflection = Math.max(
    -1,
    Math.min(1, (codePointLength(word) - LENGTH_BIAS_PIVOT) / LENGTH_BIAS_SPAN),
  );
  return 1 + bias * LENGTH_BIAS_STRENGTH * deflection;
}

/**
 * The weight `pickNext` actually samples on: mastery (D21) times the length
 * mix knob (FR-10). Always strictly positive, so `weightedPick` never falls
 * through to its uniform guard.
 */
export function biasedWeightOf(
  word: string,
  record: WordRecord | undefined,
  bias: LengthBias,
): number {
  return weightOf(record) * lengthWeightFactor(word, bias);
}

/**
 * D22 wants every wave to contain at least one word the player can definitely
 * catch. The PRD spells out what "definitely" means (AC-9.2): a mastered word,
 * or a short word this player already reads without effort.
 */
export const CATCH_MAX_LENGTH = 4;
export const CATCH_MAX_EASE = 1.0;

/**
 * AC-9.2's guaranteed-catch test.
 *
 * NOTE, and this is load-bearing: new words start at EASE_NEW (1.6), so on a
 * brand-new profile NO word in a fresh stage pool satisfies this predicate.
 * The invariant is therefore conditional on the pool being able to supply a
 * catch word at all - see `poolHasCatchWord` and the picker's relaxation
 * cascade, which degrades instead of stalling.
 */
export function isGuaranteedCatch(word: string, record: WordRecord | undefined): boolean {
  if (masteryOf(record) === "mastered") return true;
  if (record === undefined) return false;
  return codePointLength(word) <= CATCH_MAX_LENGTH && record.ease <= CATCH_MAX_EASE;
}

/**
 * Length in code points, not UTF-16 units. Devanagari content (D46) is typed
 * as a sequence of code points and a surrogate pair must not read as two
 * letters when we ask "is this word four letters or fewer".
 */
export const codePointLength = (word: string): number => [...word].length;

/**
 * First letter, as a code point. AC-2.1's uniqueness rule is about what the
 * player's first keystroke will match (AC-3.1), which is one code point.
 * Empty string has no first letter; callers filter empties out at pool build.
 */
export function firstLetter(word: string): string {
  return [...word][0] ?? "";
}
