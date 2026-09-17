/**
 * Calibration: the ~20 s pre-flight ritual and the returning-player baseline
 * (D51, D81, D18, PRD FR-11).
 *
 * What this module is for, in one paragraph. A new pilot's first twenty
 * seconds are Shadow running the ship's startup sequence - hull check, systems
 * check, engines (D81). It is framed entirely as story (AC-11.3) and the child
 * is never told they are being timed, but the three steps yield a median
 * inter-key interval and a median first-key latency (AC-11.1) which FR-8 then
 * uses to set how fast asteroids fall. Returning players never see it: they
 * are calibrated by history instead (D51, AC-11.2).
 *
 * Three rules hold everywhere below.
 *
 * 1. No clock. Every timestamp is injected by the caller; src/engine never
 *    reads Date.now() (CLAUDE.md).
 * 2. Medians, never means. One distracted keystroke from a seven-year-old must
 *    not move the difficulty curve (D18).
 * 3. Nothing grade-shaped exists here. A Keystroke has a position and a time
 *    and no character, so accuracy is not withheld during the ritual - it is
 *    uncomputable from the inputs this module accepts (AC-11.3, D31).
 */

export {
  LONG_WORD_MAX_LENGTH,
  LONG_WORD_MIN_LENGTH,
  RITUAL_BUDGET_MS,
  RITUAL_STEPS,
  SHORT_WORD_MAX_LENGTH,
  PREFLIGHT_ASSIST_CEILING_MS,
  PREFLIGHT_ASSIST_FACTOR,
  PREFLIGHT_ASSIST_FLOOR_MS,
  PREFLIGHT_ASSIST_GIVE_UP,
  estimateRitualTypingMs,
  planRitual,
  promptAssistMs,
  shuffleInPlace,
  stepSpec,
  wordFitsStep,
  type CalibrationMeasure,
  type CalibrationStepId,
  type CalibrationStepSpec,
  type RitualPlan,
  type RitualPlanStep,
} from "./ritual.js";

export {
  MAX_FK_LATENCY_MS,
  MAX_IKI_MS,
  MIN_FK_LATENCY_MS,
  MIN_IKI_MS,
  boundSamples,
  clamp,
  median,
  settleMs,
  type BoundedSamples,
} from "./stats.js";

export {
  RITUAL_MIN_FK_SAMPLES,
  RITUAL_MIN_IKI_SAMPLES,
  applyCalibration,
  computeCalibration,
  measureStep,
  type CalibrationResult,
  type CalibrationStepOutcome,
  type Keystroke,
  type RitualStepInput,
  type RitualWordInput,
} from "./measure.js";

export {
  LAUNCH_MAX_TIGHTEN,
  LAUNCH_MIN_FK_SAMPLES,
  LAUNCH_MIN_IKI_SAMPLES,
  LAUNCH_REFINE_ALPHA,
  foldLaunchCeremony,
  planLaunchCeremony,
  type LaunchFoldOptions,
  type LaunchFoldResult,
} from "./launch.js";

export {
  HISTORY_SAMPLE_WINDOW,
  REFINE_ALPHA,
  calibrationFromHistory,
  hasTypingHistory,
  isDefaultCalibration,
  needsCalibration,
  refineCalibration,
  type CalibratableProfile,
  type HistoryOptions,
  type ObservedTimings,
} from "./history.js";
