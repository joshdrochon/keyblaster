/**
 * Difficulty controller (D17, D18, D20, D53; PRD FR-10; architecture 4.3).
 *
 * TWO SIGNALS, AND THEY DO DIFFERENT JOBS (UR-51).
 *
 *   HIT RATE - blasted / spawned over the last 20 spawn outcomes (D53). It is
 *     the SAFETY FLOOR. FR-10's literal rules are unchanged: below 0.80 loosen,
 *     and nothing may tighten unless it is above 0.90 and AC-10.3 / D18's 0.85
 *     gate is satisfied on the rolling AND the stage rate.
 *   MARGIN TO BREACH - `./margin.ts`, the fraction of its fall budget a rock
 *     still had left when it went. It is the THROTTLE: a tighten additionally
 *     requires that even the worst quarter of recent rocks finished with room.
 *
 * WHY TWO. Hit rate is bounded above by 1 and every pilot who can fly the belt
 * at all is pinned against that bound - measured over a whole route, a fast
 * pilot runs 1.0000 and a grade-2 pilot 0.9521, so both clear 0.90, both
 * tighten every stage, and both arrive at the top of the knob together. Margin
 * separates the same four pilots 0.532 / 0.362 / 0.260 / 0.171. The numbers and
 * the method are in `./margin.ts`; UR-51 is the report.
 *
 * THE MARGIN CAN ONLY EVER MAKE THE BELT SAFER. It adds a precondition to
 * tightening and an extra trigger for loosening. There is no state of the
 * margin window that causes a tighten FR-10's hit-rate rules would not already
 * have allowed, so the D17 band and D18's direction are intact.
 *
 * At stage end:
 *   rate < 0.80, or margin floor < 0.12       -> loosen
 *   rate > 0.90 and D18 gate and margin > 0.35 -> tighten
 *   otherwise                                  -> hold
 * D17 puts the target band at 80-90% with 85% at its centre (Wilson et al.
 * 2019); the hit-rate thresholds are that band's edges, so "hold" means "the
 * player is already in the zone D17 asks for".
 *
 * Exactly one knob moves per stage (D20, AC-10.1). The module is a pure
 * (state, event) -> state' machine with no clock, no randomness and no
 * storage, per CLAUDE.md's src/engine rules.
 */

import {
  DEFAULT_KNOBS,
  type BudgetKnobs,
  type KnobChange,
  type Knobs,
  type LiveBand,
  applyChange,
  budgetLiveOf,
  clampKnobs,
  loosenStep,
  ratchetBudget,
  tightenStep,
} from "./knobs.js";
import { bandOf } from "./stopBand.js";
import type { StopId } from "../types.js";
import {
  type MarginWindow,
  createMarginWindow,
  marginFloor,
  pushMargin,
} from "./margin.js";
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
  GLOBAL_LIVE_BAND,
  KNOB_NAMES,
  clampBand,
  LENGTH_BIAS_MAX,
  LENGTH_BIAS_MIN,
  MAX_LIVE_MAX,
  MAX_LIVE_MIN,
  applyChange,
  applyKnobs,
  asLengthBias,
  budgetLiveOf,
  clampKnobs,
  concurrencyTarget,
  knobsDiffCount,
  loosenStep,
  ratchetBudget,
  tightenStep,
} from "./knobs.js";
export type {
  BudgetKnobs,
  KnobChange,
  KnobName,
  Knobs,
  LengthBias,
  LiveBand,
} from "./knobs.js";

export {
  STOP_BAND_CEILING_LEAD,
  STOP_BAND_FLOOR_RISE,
  bandOf,
  bandPosition,
  stopBand,
  stopBandForStage,
} from "./stopBand.js";

export {
  RAMP_OPEN_LIVE,
  STAGE_RAMP_FAST_MS,
  STAGE_RAMP_SLOW_MS,
  rampedMaxLive,
  stageRampMs,
} from "./ramp.js";

export {
  WINDOW_SIZE,
  createWindow,
  pushOutcome,
  windowHits,
  windowRate,
} from "./window.js";
export type { HitWindow, SpawnOutcome } from "./window.js";

export {
  MARGIN_QUANTILE,
  MARGIN_WINDOW_SIZE,
  clearanceMargin,
  createMarginWindow,
  marginFloor,
  pushMargin,
} from "./margin.js";
export type { ClearanceInput, MarginWindow } from "./margin.js";

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

/**
 * A tighten additionally requires this much of the fall budget left over, read
 * at `MARGIN_QUANTILE` of the margin window (UR-51).
 *
 * WHERE 0.35 COMES FROM. It is placed between two measured pilots rather than
 * chosen. Over a whole route, 40 seeds, brand-new profile per seed, the lower
 * quartile of the margin window reads:
 *
 *     fast 0.532   median 0.362   slow 0.260   grade-2 0.171
 *
 * so the gate opens for the two pilots who are finishing words with a third of
 * the fall still unused and stays shut for the two who are not. That is the
 * separation UR-51 asks for, stated as the quantity itself rather than as a
 * classification of children.
 *
 * IT IS A SERVO, NOT A CLASSIFIER, and that is the part worth stating. Every
 * step of `maxLive` cuts `keystrokeHeadroom` (see `@engine/fallTime`), which
 * spends margin - so a pilot who climbs watches this number fall towards the
 * gate and stops when it arrives. Hit rate could never do this: no setting of
 * any knob moved it off 1.0.
 */
export const TIGHTEN_MARGIN_ABOVE = 0.35;

/**
 * Below this the belt is landing on the child, whatever the hit rate says, and
 * the controller loosens (UR-51, D31).
 *
 * WHY IT IS NEEDED BESIDE `LOOSEN_BELOW`. A hit rate can be 1.0 while every
 * single rock is blasted a few hundred ms from the breach line; that player is
 * not comfortable, they are lucky, and the D53 rule alone cannot see it. It is
 * also what makes a stall ratchet the knob BACK: a belt that emptied the hull
 * has rocks at margin 0 in its window, so `beginStall`'s stage boundary
 * loosens rather than holding on a flattering rolling rate.
 *
 * 0.12 rather than something nearer the tighten gate so the two are not a
 * switch: between them is D17's "hold", the zone where the belt is already
 * where it should be.
 */
export const LOOSEN_MARGIN_BELOW = 0.12;

// ---------------------------------------------------------------------------
// WITHIN-BELT ADAPTATION (UR-84, collision C21 against D20 / AC-10.1)
// ---------------------------------------------------------------------------

/**
 * Outcomes this belt must report before a mid-belt TIGHTEN, and the minimum
 * spacing between two of them.
 *
 * ================== THE STRUCTURAL DEFECT THIS ANSWERS ==================
 * D20 allows exactly one knob move per STAGE, and a stage is a belt. A stop's
 * band (`./stopBand.ts`) is two to five settings wide, so a pilot at a stop's
 * floor needs two to five CLEAN BELTS to reach its ceiling - and the route is
 * six stops long. Measured on the route sweep, a ~100%-accuracy pilot finished
 * every belt with about a third of each rock's budget unspent, because the
 * difficulty that was supposed to meet them was still four belts away when the
 * game ended. UR-83 gave the controller a range; it did not make the climb to
 * the top of that range fast enough to be felt inside a single belt.
 *
 * So the same decision `decideStage` makes at a stage boundary is now also made
 * DURING the belt, on the same two signals and against the same thresholds.
 * Nothing about what a tighten requires has changed - `decideStage` is called
 * verbatim - only how often it is asked.
 *
 * ================== WHY D20 NEEDED ITS OWN GUARD AND NOT THIS ONE =========
 * D20's rule exists to stop the knob oscillating on a noisy sample, and that
 * risk is REAL and is worse here: a hit rate over five rocks is a far worse
 * estimate than one over fifty-eight. The stage rule's guard was "wait for the
 * stage to end", and that guard is exactly what made the controller too slow.
 * This is the replacement, and it is three gates rather than one:
 *
 *   1. SAMPLE. No mid-belt tighten before this many outcomes have been
 *      reported since the last move (or since the belt opened). Eight, which is
 *      `WINDOW_SIZE * 0.4` - enough that the stage rate `mayTighten` reads is a
 *      rate rather than a coin flip, and small enough that a 58-rock belt has
 *      room for the widest band (Uranus, 3..7, four steps) to be climbed inside
 *      it: rock 32 of 58, measured rather than hoped.
 *   2. RATE LIMIT. The same eight is the spacing between moves, so the knob can
 *      move at most `floor(58 / 8)` = 7 times in a belt and never twice on
 *      adjacent rocks.
 *   3. THE TWO SIGNALS, UNCHANGED. The rolling window (20 outcomes, spanning
 *      belts) must still be above `TIGHTEN_ABOVE`, both rates must still clear
 *      `TIGHTEN_FLOOR` (AC-10.3 / D18), and the margin quartile must still be
 *      above `TIGHTEN_MARGIN_ABOVE`. That last one is why this cannot reach the
 *      supported tail: a grade-2 pilot's measured margin is 0.171, so the gate
 *      is shut for them at every sample size, on every rock, at every stop.
 *      Arithmetic, not a simulation result.
 *
 * A STALL IS STILL UNREACHABLE BY TIGHTENING for the same reason it was before:
 * `TIGHTEN_FLOOR` is checked against this belt's own rate, so a belt that is
 * going badly cannot tighten however flattering the rolling window is.
 */
export const MIDSTAGE_TIGHTEN_SAMPLE = 8;

/**
 * The same, for a mid-belt LOOSEN - and it is deliberately HALF the tighten's.
 *
 * The asymmetry is the safety posture stated as a number: a struggling child is
 * helped twice as fast as a strong one is pressed. Four outcomes is one rock
 * more than the hull has marks (D27 at the shipped stage length), so the belt
 * can answer a child who is losing the belt before the belt is lost, which is
 * the one thing the stage-boundary rule structurally could not do - `beginStall`
 * forcing a loosen AFTER the hull emptied was the only relief that existed
 * inside a belt.
 *
 * It is also why this change is net SAFER than the rule it collides with: every
 * mid-belt loosen is relief that did not previously arrive until the belt ended.
 */
export const MIDSTAGE_LOOSEN_SAMPLE = 4;

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
  /**
   * Nobody reported how close the rocks came to the breach line, so there is no
   * evidence that the player has room. UR-51: this is the FAIL-SAFE branch, and
   * it is what a caller that stopped recording margins gets - a belt that never
   * gets harder, rather than one that quietly falls back to the saturated
   * signal the margin replaced.
   */
  | "no-margin"
  /** The player is clearing rocks, but close to the line. UR-51's throttle. */
  | "margin-tight"
  /** Both knobs are already at their cap. */
  | "at-tighten-ceiling"
  /** Both knobs are already at their floor. */
  | "at-loosen-floor"
  /**
   * UR-84: the signals say move, but this belt has not reported enough
   * outcomes since the last mid-belt move. Only `decideMidStage` produces it;
   * `decideStage` never does, so the stage boundary is unchanged.
   */
  | "too-soon"
  /**
   * C23: the pilot is flying on RELIEF, so the room they have is the room the
   * controller just handed them and not room they earned.
   *
   * ================== WHY THE THROTTLE NEEDED THIS ==================
   * `TIGHTEN_MARGIN_ABOVE` is a servo on margin, and margin is measured against
   * the budget `@engine/fallTime` granted - so widening the budget widens the
   * margin, and without this gate every millisecond of relief is read back as
   * evidence that the child can take more and spent on a tighten. Measured: with
   * the ratchet on and this gate off, the route sweep moves the median pilot's
   * knob from 3.16 to 3.68 at Uranus, takes the mid-belt move count past
   * `AC-10.1 / D20 / C21`'s rate limit (7 against 6) and COSTS that pilot a belt
   * at Pluto that they did not lose before the relief existed. The relief was
   * being converted straight into difficulty by the loop it was meant to
   * protect them from.
   *
   * It can only ever make the belt safer - it adds a precondition to tightening
   * and none to loosening - and it clears itself the moment the belt does, since
   * `createController` opens the next one with the ratchet equal to the knob.
   */
  | "on-relief";

export interface StageDecision {
  readonly action: StageAction;
  /** null on hold. Never more than one change (AC-10.1). */
  readonly change: KnobChange | null;
  /** Rolling hit rate that drove the decision; null when the window is empty. */
  readonly windowRate: number | null;
  /** This stage's own hit rate; null when the stage spawned nothing. */
  readonly stageRate: number | null;
  /**
   * The margin window read at `MARGIN_QUANTILE`; null before any rock has been
   * reported with one. UR-51's throttle, recorded on every decision so a hold
   * is explainable rather than an unlabelled no-op.
   */
  readonly marginFloor: number | null;
  /** Populated only when action is "hold". */
  readonly holdReason: HoldReason | null;
}

export interface ControllerState {
  /**
   * The knob pair, plus C23's `budgetLive` ratchet - the depth
   * `@engine/fallTime.fallBudgetFactor` sizes the budget from.
   *
   * IT IS THE SAME OBJECT THE SCENE ALREADY PASSES. `FlightScene.spawnRock`
   * hands `this.controller.knobs` straight to `fallTimeMs`, and
   * `tests/unit/flight/knobWiring.test.ts` asserts that it does, so the ratchet
   * reaches fall time through a wire that already exists rather than through a
   * new field somebody has to remember to pass - which is this repo's
   * most-repeated defect (coding-standards rule 2). AC-10.4's knob SET is
   * untouched; see `BudgetKnobs`.
   */
  readonly knobs: BudgetKnobs;
  /**
   * The stop this controller is flying, or null for a caller that has none
   * (UR-83). It is what turns `stageIndexOf` into a band; see `./stopBand.ts`
   * for why the range and not the value is what a stop decides.
   */
  readonly stopId: StopId | null;
  /**
   * `bandOf(stopId)`, carried on the state rather than recomputed at each use
   * so a debug overlay and a test read the same two numbers the decision did.
   */
  readonly band: LiveBand;
  readonly window: HitWindow;
  /** Margins of the last `MARGIN_WINDOW_SIZE` rocks to leave the board. */
  readonly margins: MarginWindow;
  /** Spawn outcomes seen since the last endStage. */
  readonly stageSpawned: number;
  readonly stageBlasted: number;
  readonly stagesCompleted: number;
  /** Result of the most recent endStage, or null before the first one. */
  readonly lastDecision: StageDecision | null;
  /**
   * `stageSpawned` at the last knob move made INSIDE this belt (UR-84), or 0
   * when the belt has not moved one yet. The rate limit is read off this rather
   * than off a clock, because `src/engine` has no clock (CLAUDE.md) and because
   * "one move per eight rocks" is the quantity the guard is actually about.
   */
  readonly stageMidMoveAt: number;
  /** Knob moves made inside this belt so far (UR-84). Reset by `endStage`. */
  readonly stageMidMoves: number;
  /**
   * The most recent WITHIN-BELT decision that actually moved a knob, or null.
   *
   * Separate from `lastDecision` on purpose: that field is documented as the
   * result of the most recent `endStage` and a debug overlay reads it as one.
   * Two different events deserve two different fields.
   */
  readonly lastMidDecision: StageDecision | null;
}

export interface ControllerInit {
  readonly knobs?: Partial<BudgetKnobs>;
  readonly window?: readonly SpawnOutcome[];
  readonly margins?: MarginWindow;
  /**
   * Which stop's belt this controller is about to fly (UR-83).
   *
   * OPTIONAL, and omitting it is FR-10's whole 2..7 range - the byte-identical
   * pre-UR-83 controller. It is optional in the type and required in practice:
   * `FlightScene` passes `this.cfg.stopId`, and
   * `tests/unit/flight/knobWiring.test.ts` asserts that it does, because a
   * field with a writer nobody calls is this repo's most-repeated defect.
   */
  readonly stopId?: StopId | null;
}

/**
 * THE KNOB IS CLAMPED INTO THE STOP'S BAND THE MOMENT THE BELT OPENS, and this
 * is the line that makes a stop inherently harder than the one before it.
 *
 * The knob arrives from the PROFILE (`storedKnobs`), so it is wherever the
 * child's whole history left it. Clamping it here means:
 *
 *   - a child arriving at Saturn on the cold start is lifted to Saturn's floor,
 *     rather than flying Saturn on the belt Mars handed them. That is
 *     progression, and it is the only thing in the controller a pilot cannot
 *     talk it out of.
 *   - a strong pilot REPLAYING Mars at maxLive 7 is pushed back down to Mars'
 *     ceiling of 4, so an early stop cannot be flown at a late stop's board.
 *   - nothing else moves. The adaptive decision is untouched; it simply has two
 *     new ends.
 */
export function createController(init: ControllerInit = {}): ControllerState {
  const stopId = init.stopId ?? null;
  const band = bandOf(stopId);
  const knobs = clampKnobs({ ...DEFAULT_KNOBS, ...init.knobs }, band);
  return {
    // C23: A BELT OPENS WITH THE RATCHET EQUAL TO THE KNOB unless the caller
    // hands one over. `clampKnobs` drops `budgetLive`, which is what makes that
    // true by construction for every restored profile - relief is earned on the
    // belt it is given on and cannot be carried into the next one. A caller
    // that passes one (the loosen-step measurement in
    // `tests/unit/simulation/loosenRelief.test.ts`) gets it back, bounded by the
    // stop's own ceiling.
    knobs: ratchetBudget(
      init.knobs?.budgetLive === undefined
        ? knobs
        : { ...knobs, budgetLive: init.knobs.budgetLive },
      knobs,
      band,
    ),
    stopId,
    band,
    window: createWindow(init.window),
    margins: createMarginWindow(init.margins),
    stageSpawned: 0,
    stageBlasted: 0,
    stagesCompleted: 0,
    lastDecision: null,
    stageMidMoveAt: 0,
    stageMidMoves: 0,
    lastMidDecision: null,
  };
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * One asteroid's fate. Called once per spawn, at the moment the spawn resolves
 * (blast or hull hit / off-screen), never at spawn time - the denominator is
 * "spawned", but an unresolved asteroid has no outcome to record yet.
 *
 * `margin` is UR-51's throttle signal: `clearanceMargin` of the rock that just
 * left, i.e. how much of its fall budget was still unspent. It is OPTIONAL in
 * the type and required in practice - a caller that omits it can never tighten
 * (`HoldReason` "no-margin"), which is the fail-safe direction and is the only
 * honest way to type a signal that arrives from a scene this module may not
 * import. The real call sites are asserted in
 * `tests/unit/flight/knobWiring.test.ts`, because a field with a writer nobody
 * calls is this repo's most-repeated defect (coding-standards rule 2).
 */
export function recordOutcome(
  state: ControllerState,
  outcome: SpawnOutcome,
  margin?: number | null,
): ControllerState {
  const recorded: ControllerState = {
    ...state,
    window: pushOutcome(state.window, outcome),
    margins:
      margin === undefined || margin === null
        ? state.margins
        : pushMargin(state.margins, margin),
    stageSpawned: state.stageSpawned + 1,
    stageBlasted: state.stageBlasted + (outcome === "blasted" ? 1 : 0),
  };
  // UR-84: the within-belt decision happens HERE rather than at a call site,
  // and that is deliberate. Every caller that reports an outcome gets it - the
  // scene, the belt simulation, the route sweep - so there is no second place
  // to forget it, which is this repo's most-repeated defect (coding-standards
  // rule 2). It is still pure, still has no clock, and still moves at most one
  // knob per call.
  return applyMidStage(recorded);
}

/**
 * What the controller would do RIGHT NOW, mid-belt, or a hold saying why.
 *
 * Pure and exported for the same reason `decideStage` is: a debug overlay and a
 * test can ask "what would happen?" without advancing anything.
 *
 * It is `decideStage` plus the two sample gates and nothing else. Re-deriving
 * the thresholds here would be a second place for FR-10's band to be written
 * down, and a second place is how the two quietly disagree.
 */
export function decideMidStage(state: ControllerState): StageDecision {
  const decision = decideStage(state);
  if (decision.action === "hold" || decision.change === null) return decision;
  const since = state.stageSpawned - state.stageMidMoveAt;
  const need =
    decision.action === "loosen" ? MIDSTAGE_LOOSEN_SAMPLE : MIDSTAGE_TIGHTEN_SAMPLE;
  if (since < need) {
    return {
      action: "hold",
      change: null,
      windowRate: decision.windowRate,
      stageRate: decision.stageRate,
      marginFloor: decision.marginFloor,
      holdReason: "too-soon",
    };
  }
  return decision;
}

/**
 * Apply `decideMidStage`, or return the state untouched.
 *
 * `endStage` is NOT affected and its rule is unchanged: the stage boundary
 * still runs `decideStage` and still moves at most one knob. A belt that has
 * already moved mid-flight may therefore also move at its boundary, which is
 * the collision with D20 that C21 logs rather than hides.
 */
function applyMidStage(state: ControllerState): ControllerState {
  const decision = decideMidStage(state);
  if (decision.change === null) return state;
  return {
    ...state,
    // C23: the knob moves and the RATCHET does not follow it down. A tighten
    // raises both; a loosen gives up the board and keeps the budget, which is
    // the whole of D31's inversion fix. See `BudgetKnobs`.
    knobs: ratchetBudget(state.knobs, applyChange(state.knobs, decision.change, state.band), state.band),
    stageMidMoveAt: state.stageSpawned,
    stageMidMoves: state.stageMidMoves + 1,
    lastMidDecision: decision,
  };
}

/** Rolling hit rate right now, or null before any outcome exists. */
export function hitRate(state: ControllerState): number | null {
  return windowRate(state.window);
}

/**
 * The margin window read at `MARGIN_QUANTILE`, or null before any evidence.
 * UR-51's throttle, exposed for a debug overlay and for the route simulation.
 */
export function marginFloorOf(state: ControllerState): number | null {
  return marginFloor(state.margins);
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
  const margin = marginFloor(state.margins);

  const hold = (holdReason: HoldReason): StageDecision => ({
    action: "hold",
    change: null,
    windowRate: rolling,
    stageRate: stage,
    marginFloor: margin,
    holdReason,
  });

  // A stage that spawned nothing says nothing about the player. Adjusting on
  // it would let a quit-and-restart change difficulty for free.
  if (stage === null || rolling === null) return hold("no-spawns");

  // LOOSEN IS CHECKED FIRST, and the order is load-bearing. A player can be
  // above 0.90 on the rolling rate and still be taking every rock at the last
  // instant - a stall is exactly that shape - and testing tighten first would
  // hold on the margin instead of giving the time back (UR-51, D31).
  const marginSaysLoosen = margin !== null && margin < LOOSEN_MARGIN_BELOW;
  if (rolling < LOOSEN_BELOW || marginSaysLoosen) {
    // The band, not FR-10's floor: a stop's floor is the bottom of the relief
    // this controller may give, and below it the honest answer is
    // "at-loosen-floor" rather than a change that `applyChange` would undo.
    const change = loosenStep(state.knobs, state.band);
    if (change === null) return hold("at-loosen-floor");
    return {
      action: "loosen",
      change,
      windowRate: rolling,
      stageRate: stage,
      marginFloor: margin,
      holdReason: null,
    };
  }

  if (rolling > TIGHTEN_ABOVE) {
    if (!mayTighten(rolling, stage)) return hold("d18-guard");
    // C23: a pilot on relief has not earned more. See `HoldReason` "on-relief".
    if (budgetLiveOf(state.knobs) > state.knobs.maxLive) return hold("on-relief");
    // UR-51's throttle. Hit rate got the player this far; the margin decides
    // whether there is room for more. Null is refused rather than defaulted:
    // see `HoldReason` "no-margin".
    if (margin === null) return hold("no-margin");
    if (margin <= TIGHTEN_MARGIN_ABOVE) return hold("margin-tight");
    const change = tightenStep(state.knobs, state.band);
    if (change === null) return hold("at-tighten-ceiling");
    return {
      action: "tighten",
      change,
      windowRate: rolling,
      stageRate: stage,
      marginFloor: margin,
      holdReason: null,
    };
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
    // C23: the ratchet survives the boundary decision for the same reason it
    // survives a mid-belt one - a loosen may never take time off the child's
    // hands. It does NOT survive the belt: `createController` opens the next
    // one from `clampKnobs`, which drops it.
    knobs: ratchetBudget(state.knobs, applyChange(state.knobs, decision.change, state.band), state.band),
    stopId: state.stopId,
    band: state.band,
    window: state.window,
    // Rolling for the same reason the hit window is: it is "the last 20 rocks",
    // not "the last 20 rocks of this stage". A stage boundary that wiped the
    // margin evidence would hand every stage a "no-margin" hold on its first
    // decision and make the throttle a function of stage length.
    margins: state.margins,
    stageSpawned: 0,
    stageBlasted: 0,
    stagesCompleted: state.stagesCompleted + 1,
    lastDecision: decision,
    // UR-84: the within-belt budget is per BELT, so it resets with the tally
    // the belt is counted in. Carrying it would make the second belt of a route
    // adapt more slowly than the first for no reason anyone could state.
    stageMidMoveAt: 0,
    stageMidMoves: 0,
    lastMidDecision: null,
  };
}
