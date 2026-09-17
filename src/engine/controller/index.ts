/**
 * Difficulty controller (D17, D18, D20, D53; PRD FR-10; architecture 4.3).
 *
 * Signal: hit rate = asteroids blasted / spawned, over a rolling window of the
 * last 20 spawn outcomes (D53).
 *
 * At stage end:
 *   rate > 0.90 -> tighten
 *   rate < 0.80 -> loosen
 *   otherwise   -> hold
 * D17 puts the target band at 80-90% with 85% at its centre (Wilson et al.
 * 2019); the thresholds above are that band's edges, so "hold" means "the
 * player is already in the zone D17 asks for".
 *
 * Exactly one knob moves per stage (D20, AC-10.1). The module is a pure
 * (state, event) -> state' machine with no clock, no randomness and no
 * storage, per CLAUDE.md's src/engine rules.
 */

import {
  DEFAULT_KNOBS,
  type KnobChange,
  type Knobs,
  applyChange,
  clampKnobs,
  loosenStep,
  tightenStep,
} from "./knobs.js";
import {
  type HitWindow,
  type SpawnOutcome,
  createWindow,
  pushOutcome,
  windowRate,
} from "./window.js";

export {
  CONCURRENCY_TARGET_MAX,
  CONCURRENCY_TARGET_MIN,
  DEFAULT_KNOBS,
  KNOB_NAMES,
  LENGTH_BIAS_MAX,
  LENGTH_BIAS_MIN,
  MAX_LIVE_MAX,
  MAX_LIVE_MIN,
  applyChange,
  applyKnobs,
  asLengthBias,
  clampKnobs,
  concurrencyTarget,
  knobsDiffCount,
  loosenStep,
  tightenStep,
} from "./knobs.js";
export type { KnobChange, KnobName, Knobs, LengthBias } from "./knobs.js";

export {
  WINDOW_SIZE,
  createWindow,
  pushOutcome,
  windowHits,
  windowRate,
} from "./window.js";
export type { HitWindow, SpawnOutcome } from "./window.js";

// ---------------------------------------------------------------------------
// Thresholds. D53 and PRD FR-10 give these as literals; D17 explains them.
// ---------------------------------------------------------------------------

/** Strictly above this and the stage was too easy (D53). */
export const TIGHTEN_ABOVE = 0.9;

/** Strictly below this and the stage was too hard (D53). */
export const LOOSEN_BELOW = 0.8;

/**
 * AC-10.3 / D18: difficulty never increases while hit rate is below 0.85.
 *
 * READING (this is the part that needs stating, because 0.85 < 0.90 and so the
 * guard looks redundant against the tighten trigger):
 *
 * The trigger and the guard read different quantities.
 *   - The trigger reads the ROLLING window, which spans stage boundaries. It
 *     answers "has this player been comfortable lately?".
 *   - The guard additionally reads THIS STAGE's own hit rate. It answers "is
 *     the player comfortable right now?".
 *
 * They disagree whenever a stage is shorter than the window. A player who
 * blasted 18 of the previous 18 spawns and then went 1-for-2 in a short stage
 * has a window rate of 19/20 = 0.95 (tighten) but a stage rate of 0.50. D18
 * says difficulty increases only as the player gets BETTER; that player is not
 * getting better, so we hold. Without the stage gate the lagging window would
 * tighten on evidence the current stage contradicts.
 *
 * The guard is also applied to the window rate itself. That arm is subsumed by
 * the > 0.90 trigger today, and is kept on purpose: D17 says the band is
 * "tuned in playtest", so TIGHTEN_ABOVE is expected to move. Enforcing D18 at
 * the point of action rather than inferring it from the trigger means a
 * retuned threshold can never quietly break the decision.
 */
export const TIGHTEN_FLOOR = 0.85;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type StageAction = "tighten" | "loosen" | "hold";

/**
 * Why nothing moved. Present on every decision so a hold is explainable in a
 * debug overlay and in tests, rather than being an unlabelled no-op.
 */
export type HoldReason =
  /** The stage spawned nothing, so it carries no evidence. */
  | "no-spawns"
  /** Hit rate is inside the D17 band; this is the healthy case. */
  | "in-band"
  /** Window says tighten, but AC-10.3 / D18 forbids it. */
  | "d18-guard"
  /** Both knobs are already at their cap. */
  | "at-tighten-ceiling"
  /** Both knobs are already at their floor. */
  | "at-loosen-floor";

export interface StageDecision {
  readonly action: StageAction;
  /** null on hold. Never more than one change (AC-10.1). */
  readonly change: KnobChange | null;
  /** Rolling hit rate that drove the decision; null when the window is empty. */
  readonly windowRate: number | null;
  /** This stage's own hit rate; null when the stage spawned nothing. */
  readonly stageRate: number | null;
  /** Populated only when action is "hold". */
  readonly holdReason: HoldReason | null;
}

export interface ControllerState {
  readonly knobs: Knobs;
  readonly window: HitWindow;
  /** Spawn outcomes seen since the last endStage. */
  readonly stageSpawned: number;
  readonly stageBlasted: number;
  readonly stagesCompleted: number;
  /** Result of the most recent endStage, or null before the first one. */
  readonly lastDecision: StageDecision | null;
}

export interface ControllerInit {
  readonly knobs?: Partial<Knobs>;
  readonly window?: readonly SpawnOutcome[];
}

export function createController(init: ControllerInit = {}): ControllerState {
  return {
    knobs: clampKnobs({ ...DEFAULT_KNOBS, ...init.knobs }),
    window: createWindow(init.window),
    stageSpawned: 0,
    stageBlasted: 0,
    stagesCompleted: 0,
    lastDecision: null,
  };
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * One asteroid's fate. Called once per spawn, at the moment the spawn resolves
 * (blast or hull hit / off-screen), never at spawn time - the denominator is
 * "spawned", but an unresolved asteroid has no outcome to record yet.
 */
export function recordOutcome(
  state: ControllerState,
  outcome: SpawnOutcome,
): ControllerState {
  return {
    ...state,
    window: pushOutcome(state.window, outcome),
    stageSpawned: state.stageSpawned + 1,
    stageBlasted: state.stageBlasted + (outcome === "blasted" ? 1 : 0),
  };
}

/** Rolling hit rate right now, or null before any outcome exists. */
export function hitRate(state: ControllerState): number | null {
  return windowRate(state.window);
}

/** This stage's hit rate so far, or null if it has spawned nothing. */
export function stageHitRate(state: ControllerState): number | null {
  return state.stageSpawned === 0 ? null : state.stageBlasted / state.stageSpawned;
}

/**
 * AC-10.3 / D18 gate. Both the rolling rate and the current stage's rate must
 * be at or above TIGHTEN_FLOOR. See TIGHTEN_FLOOR for why there are two arms.
 */
export function mayTighten(
  rollingRate: number | null,
  stageRate: number | null,
): boolean {
  if (rollingRate === null || stageRate === null) return false;
  return rollingRate >= TIGHTEN_FLOOR && stageRate >= TIGHTEN_FLOOR;
}

/**
 * Decide what a stage boundary should do, without applying it. Pure, so tests
 * and a debug overlay can ask "what would happen?" without advancing state.
 */
export function decideStage(state: ControllerState): StageDecision {
  const rolling = windowRate(state.window);
  const stage = stageHitRate(state);

  const hold = (holdReason: HoldReason): StageDecision => ({
    action: "hold",
    change: null,
    windowRate: rolling,
    stageRate: stage,
    holdReason,
  });

  // A stage that spawned nothing says nothing about the player. Adjusting on
  // it would let a quit-and-restart change difficulty for free.
  if (stage === null || rolling === null) return hold("no-spawns");

  if (rolling > TIGHTEN_ABOVE) {
    if (!mayTighten(rolling, stage)) return hold("d18-guard");
    const change = tightenStep(state.knobs);
    if (change === null) return hold("at-tighten-ceiling");
    return { action: "tighten", change, windowRate: rolling, stageRate: stage, holdReason: null };
  }

  if (rolling < LOOSEN_BELOW) {
    const change = loosenStep(state.knobs);
    if (change === null) return hold("at-loosen-floor");
    return { action: "loosen", change, windowRate: rolling, stageRate: stage, holdReason: null };
  }

  return hold("in-band");
}

/**
 * Apply the stage boundary: at most one knob moves (AC-10.1), the per-stage
 * tally resets, and the rolling window is deliberately NOT reset - it is "the
 * last 20 outcomes", not "the last 20 outcomes of this stage" (D53).
 */
export function endStage(state: ControllerState): ControllerState {
  const decision = decideStage(state);
  return {
    knobs: applyChange(state.knobs, decision.change),
    window: state.window,
    stageSpawned: 0,
    stageBlasted: 0,
    stagesCompleted: state.stagesCompleted + 1,
    lastDecision: decision,
  };
}
