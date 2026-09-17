/**
 * Spawn pacing (FR-6, FR-8, FR-10; D17, D19, D27, D31, D53).
 *
 * THE RULE THIS MODULE OWNS: how long the belt waits between one rock and the
 * next. It used to be a constant - 850 ms, written into FlightScene - and a
 * constant is the one thing a spawn gap cannot be, because the belt is cleared
 * by a CHILD and children do not type at a constant rate.
 *
 * WHY A CONSTANT IS A BUG AND NOT A TUNING VALUE.
 *
 * A player is a single server: AC-2.1 gives every live word a distinct first
 * letter precisely so the lock is unambiguous, so words are cleared one after
 * another, never in parallel. Words leave the board at a rate of one per
 * `expectedClearMs`, which at `DEFAULT_CALIBRATION` is about 2.1 s. Spawning
 * every 850 ms feeds the board at 2.4x that rate.
 *
 * `maxLive` (FR-10) caps how many rocks are LIVE, not how many are fed in, and a
 * rock that is not being typed is still falling. The surplus does not queue
 * politely: it lands. At `maxLive` 2 the second rock waits a whole word before
 * the player can reach it, and with a fall time of `len * 1.5 * iki +
 * 1200 * ease` it has about 4.3 s to live when it is new and about 3.6 s once
 * the player has learned it - so wait plus typing exceeds its budget as soon as
 * `ease` decays. The belt got LETHAL as the child got BETTER. Hull is 3 (D27),
 * so the stage stalled. At 18 words a stage ended before the arithmetic caught
 * up with it; at 58 it does not.
 *
 * WHAT REPLACES IT: the belt feeds one rock per rock's worth of the player's own
 * work, and it MEASURES the work rather than assuming it.
 *
 *   gap = outstanding work on the board  -  lead
 *
 * OUTSTANDING WORK is the sum of what the live rocks are expected to cost this
 * player, minus what they have already spent on the one in hand. Anchoring on
 * the board instead of on the clock is what makes a backlog DRAIN: a gap
 * measured from the spawn instant preserves whatever delay the belt has already
 * accumulated forever, because it feeds a new rock exactly as fast as one
 * leaves without ever repaying the debt.
 *
 * Each rock's cost is an estimate plus a correction:
 *   - ESTIMATED from this player's calibration (D51) and this word's ease, so a
 *     slow typist gets a slow belt on the first rock of their first stage,
 *     before any evidence exists;
 *   - CORRECTED by the median amount this player has recently been running over
 *     that estimate, so the belt paces the player in front of it rather than
 *     the one their calibration describes. Median, never mean, for the reason
 *     calibration/stats.ts gives, and never negative: evidence that they are
 *     fast does not speed the belt up.
 *
 * LEAD is the overlap: the next rock arrives slightly BEFORE the player is
 * expected to be free, so the sky is never empty and there is always something
 * to look at next. It is taken as a fraction of the fall-time SLACK - the
 * headroom D19's formula grants a rock over what the player needs to type it -
 * so the overlap can never cost a rock more time than it had spare. That
 * fraction is the controller's `maxLive` knob (D53).
 *
 * STANDING is the queue, and it is what UR-51 added. The lead alone could never
 * put a second rock on the board: `outstanding` is the WHOLE board's work, so
 * subtracting only an overlap from it schedules the next rock for the moment
 * the board is expected to be EMPTY. That is a steady state of one rock at
 * every knob setting, which is exactly what `peakLive: 2 at maxLive 7` and a
 * time-weighted occupancy of 1.00-1.04 recorded. A board of N rocks is a board
 * with N-1 rocks' work standing on it - Little's law, and there is no other way
 * to have one - so the belt leaves that much standing before it waits, sized by
 * `concurrencyTarget(maxLive)`.
 *
 * NEITHER TERM FEEDS FASTER THAN THE PLAYER DRAINS, and that is still the
 * difference between a harder belt and an unsurvivable one. At the target depth
 * the gap is one service time, the same as it always was; the queue is a
 * one-off backlog the belt is willing to build, not a higher rate. Measured, a
 * median pilot's belt is 143.75 s at the knob's floor and 143.46 s at its
 * ceiling - the same 58 words, the same hands, three and a half rocks on screen
 * instead of one. What the deeper queue costs is that every rock in it has to
 * survive the wait, which is why `@engine/fallTime` scales FR-8's budget by the
 * same target. Build the queue without widening the budget and the median pilot
 * stalls on 40 belts out of 40 at a hit rate of 0.214.
 *
 * RELIEF is D31 in arithmetic. A player below the D17 band has every estimate
 * stretched, immediately, without waiting for a stage boundary - which also
 * shrinks the slack and so removes the overlap. Missing makes the belt gentler.
 * The term is bounded below by 1: nothing here can make the belt faster.
 *
 * WHAT THIS MODULE IS NOT.
 *
 * It is not a knob. The knob set is exactly {maxLive, lengthBias} (AC-10.4) and
 * this module adds nothing to it: it READS `maxLive` and the rolling hit rate
 * and returns a duration. Nothing here changes a knob, so AC-10.1's "at most one
 * knob change per stage" is untouched. World scroll speed does not appear in
 * this file at all.
 *
 * It also cannot create dead air (AC-6e.3). The gap only ever delays a spawn
 * onto a board that already has something live; an empty board with spawns
 * pending never waits, and that fast path belongs to the caller. A longer gap
 * moves rocks apart, it does not leave the sky empty.
 *
 * Pure and total, like everything else in src/engine: no clock, no randomness,
 * no storage.
 */

import { RECOGNITION_BASE_MS } from "../fallTime/index.js";
import { LOOSEN_BELOW } from "../controller/index.js";
import {
  MAX_LIVE_MAX,
  MAX_LIVE_MIN,
  concurrencyTarget,
  type Knobs,
} from "../controller/knobs.js";
import { DEFAULT_CALIBRATION, type Calibration } from "../types.js";

// ---------------------------------------------------------------------------
// Constants. Tunable (D69), exported so a test can diff them against the PRD
// rather than against a magic number.
// ---------------------------------------------------------------------------

/**
 * The beat between finishing one rock and starting the next: finding the next
 * word, moving the eye to it, deciding. 300 ms is the same allowance
 * `tests/unit/flight/stageLength.test.ts` costs a word with, so the belt's
 * pacing and the belt's LENGTH are derived from one number instead of two.
 */
export const SELECTION_BEAT_MS = 300;

/**
 * Recognition cost is read straight out of FR-8's fall-time formula -
 * `RECOGNITION_BASE_MS * ease` - and floored at this player's measured
 * first-key latency.
 *
 * WHY THE ENGINE'S OWN NUMBER RATHER THAN `fkLatencyMs * ease`. Calibration
 * measures first-key latency during the pre-flight ritual, on short,
 * high-frequency words (D51) - words the child already reads. A stage pool is
 * not that: `EASE_NEW` is 1.6 precisely because the game has no history with
 * those words yet. Pacing off the ritual's number alone underestimates a cold
 * word by the whole difference between reading a word you know and decoding one
 * you do not, which is the difference between a belt that is survivable and one
 * that is not - and it underestimates it WORST at the start of a stage, when
 * every word is cold and no observed evidence exists yet to correct it.
 *
 * The floor keeps calibration in the formula where it belongs: a slow reader's
 * measured latency still sets the bottom, so a mastered word never costs less
 * than the fastest this player has ever been measured.
 */
export const recognitionCostMs = (ease: number, fkLatencyMs: number): number =>
  Math.max(fkLatencyMs, RECOGNITION_BASE_MS * Math.max(0, ease));

/** How many recent clear times the observed estimate reads (newest last). */
export const CLEAR_SAMPLE_WINDOW = 8;

/**
 * Which quantile of the recent residuals the belt paces to.
 *
 * NOT the median, and this is the one place in this build where a median is the
 * wrong statistic. A median residual is right about half the rocks and
 * under-paces the other half by however much it was wrong - and a rock
 * under-paced by more than its fall-time slack is a hull mark, not a near miss.
 * Nine tenths of an eight-sample window is the second-slowest rock the player
 * has cleared: it covers the ordinary spread of a child's typing - a typo here,
 * a word they had to look at twice - while still refusing to chase the single
 * worst sample the way a maximum would.
 *
 * THE ASYMMETRY IS THE POINT, AND IT IS FREE. A gap longer than the player needs
 * empties the board, and an empty board spawns immediately (the caller's
 * AC-6e.3 fast path), so a belt paced too gently is exactly as long as the
 * player's own hands - it costs nothing but a less busy sky. A gap shorter than
 * they need costs a hull mark. The two errors are not worth the same, so the
 * estimate does not sit in the middle of them.
 */
export const CLEAR_BIAS_QUANTILE = 0.9;

/**
 * Floor on the gap, ms. A sanity bound, not a pacing value: it exists so a
 * degenerate estimate - a one-letter word at floor ease, a corrupt sample -
 * can never restore the 850 ms defect by another route.
 */
export const MIN_SPAWN_GAP_MS = 600;

/**
 * Ceiling on the gap, ms. One outlier - a child who put the keyboard down for
 * ten seconds - must not empty the sky for the rest of the stage. The quantile
 * over a window already absorbs one of those; this bounds the case where it
 * cannot.
 */
export const MAX_SPAWN_GAP_MS = 6000;

/**
 * How much of a rock's fall-time slack the next rock's overlap may eat, at the
 * floor and at the cap of `maxLive`.
 *
 * At `maxLive` 2 a sixth of the headroom is spent on overlap, so the next rock
 * appears just as the current one is being finished. At 7 it is half: the rock
 * arrives while the player is still inside the current word, so the board reads
 * busy. Neither can push a rock past its own budget, because the fraction is
 * taken OF that budget's spare part - and because the spare part is measured
 * against what this player actually costs, not what calibration hoped.
 *
 * The range is narrow on purpose, and the reason is arithmetic rather than
 * taste. A serial typist cannot survive a belt fed faster than they clear it,
 * so every honest setting of this term lives just under "one rock at a time".
 * What `maxLive` buys is overlap and the attention it costs, not throughput.
 */
export const LEAD_FRACTION_MIN = 0.15;
export const LEAD_FRACTION_MAX = 0.5;

/** Hard ceiling on the overlap, ms, whatever the slack says. */
export const MAX_LEAD_MS = 800;

/** The most the gap can stretch for a struggling player (D31). */
export const RELIEF_MAX = 1.5;

// ---------------------------------------------------------------------------
// Expected time to clear one word
// ---------------------------------------------------------------------------

export interface ClearEstimateInput {
  /** Length in GRAPHEMES, so Hindi and Spanish cost what they look like. */
  readonly length: number;
  /** This player's ease for this word, already clamped to [0.25, 2.0]. */
  readonly ease: number;
  /** The player's calibration; defaults to PRD FR-8's 350 / 500. */
  readonly calibration?: Calibration;
}

/**
 * How long THIS player is expected to need to turn this rock into debris:
 * recognise it, type it, and look for the next one.
 *
 *   recognition = max(fkLatencyMs, RECOGNITION_BASE_MS x ease)
 *   typing      = (length - 1) x ikiMs        (the first key is in recognition)
 *   choosing    = SELECTION_BEAT_MS
 *
 * This is the SERVICE TIME of the belt's one server. It is deliberately not the
 * fall-time formula: fall time is a budget granted to a rock with 50% headroom
 * (D19), while this is an estimate of what the player actually spends. Pacing
 * off the budget instead of off the spend is how a belt ends up feeding rocks
 * faster than they can be answered.
 */
export function expectedClearMs({
  length,
  ease,
  calibration,
}: ClearEstimateInput): number {
  const iki = calibration?.ikiMs ?? DEFAULT_CALIBRATION.ikiMs;
  const fk = calibration?.fkLatencyMs ?? DEFAULT_CALIBRATION.fkLatencyMs;
  const letters = Number.isFinite(length) ? Math.max(1, Math.floor(length)) : 1;
  const recognition = recognitionCostMs(ease, fk);
  const typing = (letters - 1) * iki;
  return recognition + typing + SELECTION_BEAT_MS;
}

/**
 * How much slower this player is than we estimated, in ms, over the last few
 * rocks they cleared - or null before any evidence exists.
 *
 * A RESIDUAL, NOT A CLEAR TIME, and the difference matters. A scalar "typical
 * clear time" is blind to word length: it is dragged down by three-letter words
 * and then under-paces the seven-letter ones, which is exactly the rock that
 * cannot afford it. The residual is the part of the cost the estimate CANNOT
 * see - a child who reads more slowly than the ritual measured, a keyboard
 * being hunted for - and that part does not scale with length, so adding it
 * back corrects every word by the right amount.
 *
 * One sample is `actual service - the estimate made for that rock at spawn`.
 * Service time runs from the moment the player was free to attend to the rock
 * (it spawned, or the previous rock left the board - whichever came later) to
 * the moment it blew up. Queueing time is excluded on purpose; including it
 * would make the belt chase its own tail, every wait feeding a longer gap
 * feeding a longer wait.
 *
 * Read at `CLEAR_BIAS_QUANTILE` of the window rather than at its middle, for
 * the reason given there. Floored at zero, so evidence that the player is FASTER
 * than estimated never speeds the belt up: the caller's empty-board fast path
 * already hands a fast player their next rock the instant they want it, and
 * shortening a belt on the strength of eight good words is how the 850 ms defect
 * would grow back.
 */
export function observedBiasMs(
  residuals: readonly number[],
  window: number = CLEAR_SAMPLE_WINDOW,
): number | null {
  const usable = residuals.filter((s) => Number.isFinite(s));
  if (usable.length === 0) return null;
  const recent = [...usable.slice(-Math.max(1, Math.floor(window)))].sort((a, b) => a - b);
  // Linear interpolation between the two neighbouring samples, so a window of
  // four does not jump a whole sample's width when one value changes.
  const pos = CLEAR_BIAS_QUANTILE * (recent.length - 1);
  const lo = recent[Math.floor(pos)]!;
  const hi = recent[Math.ceil(pos)]!;
  return Math.max(0, lo + (hi - lo) * (pos - Math.floor(pos)));
}

// ---------------------------------------------------------------------------
// The modulating terms
// ---------------------------------------------------------------------------

/**
 * D31 in arithmetic, and the reason this is a multiplier rather than a
 * subtraction: a player who is missing gets MORE time per rock, in proportion
 * to how far below the D17 band they have fallen, and they get it now rather
 * than at the next stage boundary.
 *
 * Bounded below by 1: no hit rate, however good, may shorten the belt through
 * this term. Tightening is the controller's job and arrives through `maxLive`,
 * which is the only difficulty channel the PRD gives (AC-10.1, AC-10.4).
 */
export function hitRateRelief(hitRate: number | null): number {
  if (hitRate === null || !Number.isFinite(hitRate)) return 1;
  if (hitRate >= LOOSEN_BELOW) return 1;
  const shortfall = LOOSEN_BELOW - Math.max(0, hitRate);
  return Math.min(RELIEF_MAX, 1 + shortfall);
}

/**
 * How much of a rock's spare fall time the NEXT rock is allowed to overlap into,
 * as a fraction, interpolated across the `maxLive` range (FR-10: 2..7).
 *
 * This is the whole of the controller's grip on the belt's pacing. It is a
 * fraction of SLACK rather than of the gap, which is what makes a tightened
 * belt harder without making it unclearable: the overlap is paid out of margin
 * the rock already had, so there is always something left.
 */
export function leadFraction(maxLive: number): number {
  const span = MAX_LIVE_MAX - MAX_LIVE_MIN;
  // A corrupt knob reads as the floor rather than as NaN: a restored profile
  // must never be able to stop a child's game (knobs.ts, clampKnobs).
  const live = Number.isFinite(maxLive) ? Math.floor(maxLive) : MAX_LIVE_MIN;
  const steps = Math.min(span, Math.max(0, live - MAX_LIVE_MIN));
  return LEAD_FRACTION_MIN + (steps / span) * (LEAD_FRACTION_MAX - LEAD_FRACTION_MIN);
}

/**
 * How much outstanding work the belt is willing to leave STANDING on the board,
 * in units of the newest rock's service time (UR-42, UR-51).
 *
 * ================== WHY THE BELT HELD ONE ROCK ==================
 * The gap was `outstanding - lead`, and `outstanding` is the whole board's
 * work. That schedules the next rock for the moment the board is expected to be
 * EMPTY, so the belt's steady state is one rock however high `maxLive` is set.
 * It is why `peakLive` read 2 at maxLive 7 exactly as at maxLive 2, and why the
 * time-weighted occupancy read 1.00-1.04 at both ends: the knob raised a
 * ceiling the pacing never let the board approach.
 *
 * A board of N rocks is a board with N-1 rocks' worth of work standing on it -
 * that is what Little's law says, and there is no other way to have one. So the
 * belt subtracts that much before it waits, and the number comes from the
 * controller's own knob through `concurrencyTarget`.
 *
 * ================== THIS IS NOT MORE THROUGHPUT ==================
 * The belt still feeds exactly one rock per rock's worth of the player's own
 * work: at the target depth the gap is one service time, the same as before.
 * What changes is the STANDING QUEUE it is willing to build first, and the
 * rocks in it are answerable only because `@engine/fallTime` scales FR-8's
 * budget by the same target. Doing this half alone is the P0a stall defect.
 *
 * ================== D31 REACHES IT IMMEDIATELY ==================
 * The allowance is divided by `hitRateRelief`, so a player below the D17 band
 * gets a SHALLOWER board at once rather than at the next stage boundary - the
 * same shape as the gap stretch, in the channel that is now the difficulty.
 * At relief 1.5 a target of 4 is flown as a target of 3. Bounded below by zero:
 * the floor case is the shipped belt, never a shallower one.
 */
export function standingDepth(maxLive: number, relief: number): number {
  const target = concurrencyTarget(maxLive);
  const r = Number.isFinite(relief) ? Math.max(1, relief) : 1;
  return Math.max(0, (target - 1) / r);
}

// ---------------------------------------------------------------------------
// The gap
// ---------------------------------------------------------------------------

export interface SpawnGapInput {
  /**
   * `expectedClearMs` for every rock now on the board, INCLUDING the one that
   * just spawned, which must be LAST - the slack the overlap is taken from is
   * that rock's.
   */
  readonly liveClearMs: readonly number[];
  /**
   * How long the player has already been working on the rock in hand, ms. The
   * belt has that much of the backlog behind it already, and forgetting it
   * would make every gap a word longer than the player needs.
   */
  readonly servedMs?: number;
  /** Fall time of the rock that just spawned - where the slack comes from. */
  readonly fallMs: number;
  /**
   * `observedBiasMs` over recent rocks, or null before any evidence. Null is
   * not "zero": with no evidence at all the belt declines to overlap rocks,
   * because the first thing a stage owes a player it has never watched is room.
   */
  readonly biasMs?: number | null;
  /** The controller's current knobs; only `maxLive` is read. */
  readonly knobs: Pick<Knobs, "maxLive">;
  /** Rolling hit rate from the controller's window, or null when empty. */
  readonly hitRate?: number | null;
}

/** The gap, and the two quantities it was made of, for tests and telemetry. */
export interface SpawnPace {
  /** Wait before the next rock, ms. Already clamped. */
  readonly gapMs: number;
  /** Work the board is expected to cost the player from now, ms. */
  readonly outstandingMs: number;
  /** How far ahead of the player the next rock arrives, ms. */
  readonly leadMs: number;
  /**
   * Work the belt is content to leave standing on the board, ms - the queue
   * `maxLive` is asking for, priced in this player's own service time. Zero at
   * `MAX_LIVE_MIN`, which is what makes the gentlest setting the shipped belt.
   */
  readonly standingMs: number;
}

const positive = (n: number | null | undefined): number =>
  n !== null && n !== undefined && Number.isFinite(n) ? Math.max(0, n) : 0;

/**
 * Pace the belt: how long to wait after this spawn before feeding the next rock.
 *
 * Every live rock costs its own estimate plus whatever this player has recently
 * been costing on top of it. The correction only ever runs one way - a player
 * slower than their calibration is a player being buried, and the estimate is
 * the one thing that cannot see it.
 */
export function paceSpawn({
  liveClearMs,
  servedMs = 0,
  fallMs,
  biasMs = null,
  knobs,
  hitRate = null,
}: SpawnGapInput): SpawnPace {
  const relief = hitRateRelief(hitRate);
  const bias = positive(biasMs);
  const service = (estimate: number): number => (positive(estimate) + bias) * relief;

  const total = liveClearMs.reduce((sum, ms) => sum + service(ms), 0);
  const outstanding = Math.max(0, total - positive(servedMs));

  // The slack is measured against what the just-spawned rock costs THIS player,
  // bias and relief included: a struggling player has no spare fall time to lend
  // to an overlap, and so gets none. Neither does a player nobody has watched
  // yet - `biasMs` null means the belt has no evidence, and an overlap granted
  // on no evidence is the 850 ms defect in miniature.
  const newest =
    liveClearMs.length === 0 ? 0 : service(liveClearMs[liveClearMs.length - 1]!);
  const slack = Math.max(0, positive(fallMs) - newest);
  const lead =
    biasMs === null ? 0 : Math.min(MAX_LEAD_MS, slack * leadFraction(knobs.maxLive));

  // The queue the controller is asking for, priced at what the newest rock
  // costs THIS player. Zero at the knob's floor, so the gentlest belt is the
  // one already measured at 3 stalls in 240.
  const standing = newest * standingDepth(knobs.maxLive, relief);

  const gap = Math.min(
    MAX_SPAWN_GAP_MS,
    Math.max(MIN_SPAWN_GAP_MS, Math.round(outstanding - standing - lead)),
  );
  return {
    gapMs: gap,
    outstandingMs: Math.round(outstanding),
    leadMs: Math.round(lead),
    standingMs: Math.round(standing),
  };
}

/** The gap alone, for callers that do not need the workings. */
export const spawnGapMs = (input: SpawnGapInput): number => paceSpawn(input).gapMs;
