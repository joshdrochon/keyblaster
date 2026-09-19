/**
 * Word selection (D21, D22, D23, D25; PRD FR-9, AC-2.1, AC-2.2;
 * architecture section 4.2).
 *
 * The other half of the learning engine. words/ decides what the player KNOWS;
 * this module decides what they SEE next, which is how D21's rule - "speed
 * tracks fluency, frequency tracks mastery" - reaches the screen.
 *
 * Public shape is a fold:
 *
 *   let state = createSelectionState({ stage, stagePool, retentionPool, book });
 *   const out = pickNext(state, { live, book, lastSeenStage, rng });
 *   if (out.ok) { spawn(out.word); state = out.state; }
 *
 * Pure TypeScript: no Phaser, no DOM, no clock, no Math.random (CLAUDE.md).
 * The precedence order between AC-2.1, AC-9.2 and AC-9.1, and the proof that
 * a locked board can never stall the game, are documented in picker.ts.
 */

export {
  CATCH_WINDOW,
  EmptyStagePoolError,
  RETENTION_MIN_STAGE,
  RETENTION_PERCENT,
  catchIsForced,
  createSelectionState,
  isPracticeSpawn,
  pickNext,
  poolHasCatchWord,
  retentionIsDue,
  retentionQuota,
} from "./picker.js";
export {
  BANK_BELT_FRACTION,
  BELT_ANCHOR_COUNT,
  BELT_CARRY_FRACTION,
  BELT_MAX_WORDS,
  BELT_MIN_WORDS,
  bankSeed,
  beltHistogram,
  beltSizeFor,
  sampleBelt,
} from "./bank.js";
export type { BeltSample } from "./bank.js";

export type {
  BeltInput,
  NoPick,
  PickContext,
  PickOutcome,
  Picked,
  Relaxation,
  SelectionInput,
  SelectionState,
} from "./picker.js";

export { uniformPick, weightedPick } from "./sample.js";

export {
  TIER_EASE_THRESHOLD,
  TIER_UNLOCK_FRACTION,
  sharedPrefixUnlocked,
  solidFraction,
} from "./tier.js";

export {
  CATCH_MAX_EASE,
  CATCH_MAX_LENGTH,
  LENGTH_BIAS_PIVOT,
  LENGTH_BIAS_SPAN,
  LENGTH_BIAS_STRENGTH,
  SELECTION_WEIGHT,
  biasedWeightOf,
  codePointLength,
  firstLetter,
  isGuaranteedCatch,
  lengthWeightFactor,
  weightOf,
} from "./weights.js";
