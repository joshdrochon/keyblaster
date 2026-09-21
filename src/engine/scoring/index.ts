/**
 * scoring/ - WPM, accuracy, combo/multiplier, stars, and the results deltas
 * (architecture 4, PRD FR-4 / FR-6c / section 3.8; D27, D29, D31, D50, D75,
 * D80, D81).
 *
 * Every export is a pure function of data handed in. No clock, no storage, no
 * DOM (CLAUDE.md HARD RULES).
 *
 * D31 constrains the *surface*, not just the behaviour: this module must not
 * expose anything shaped like a failure score. There is no lives count, no
 * failure count, no wrong count, no penalty and no deduction anywhere in the
 * public API. Typos and hull hits are accepted as inputs because the engine has
 * to measure them, and accuracy is reported because it is the primary outcome
 * (PRD section 1) - but nothing leaves this module framed as something the
 * player lost. tests/unit/scoring/surface.test.ts asserts that structurally, so
 * the rule survives future edits. That test is a guard on THIS module's surface
 * only; it is not AC-22b.1, which is a static scan of `src/game` and is somebody
 * else's test to write.
 */

export { CHARS_PER_WORD, accuracy, wpm } from "./rates.js";

export {
  INITIAL_COMBO_STATE,
  LENGTH_BONUS_FLOOR,
  LENGTH_BONUS_PER_LETTER,
  MAX_MULTIPLIER,
  MULTIPLIER_MILESTONES,
  POINTS_PER_LETTER,
  comboReducer,
  comboState,
  hudMultiplierFor,
  isMultiplierMilestone,
  multiplierFor,
  nestedCrackBonus,
  nestedCrackScore,
  scoreWordWithCombo,
  wordBaseScore,
  wordScore,
} from "./combo.js";
export type { ComboEvent, ComboState, ScoredHit } from "./combo.js";

export {
  CLEARED_STAGE_STARS,
  HULL_HITS_PER_STAGE,
  isClearableHullHits,
  starsForHullHits,
} from "./stars.js";

export {
  FASTER_IMPROVEMENT_THRESHOLD,
  computeStageResults,
  previousStageProgress,
  retentionLine,
  wordProgressMarker,
} from "./results.js";
export type {
  RetentionLine,
  StageResults,
  StageResultsInput,
  StageTally,
  WordExposure,
  WordProgressMarker,
} from "./results.js";

/**
 * Medians are NOT re-exported here. `median` lives in words/ and callers should
 * import it from there; one definition of "median first-key latency" per engine.
 */
export { meanOf } from "./stats.js";
