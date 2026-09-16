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
 * the rule survives future edits.
 */

export { CHARS_PER_WORD, accuracy, wpm } from "./rates.js";

export {
  INITIAL_COMBO_STATE,
  MAX_MULTIPLIER,
  POINTS_PER_LETTER,
  comboReducer,
  comboState,
  multiplierFor,
  scoreWordWithCombo,
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

export { meanOf, medianOf } from "./stats.js";
