/**
 * How a belt OPENS (UR-83).
 *
 * ================== THE REPORT ==================
 * "Mars should open with ONE rock for the first 5-10 seconds, then gradually
 * increase." The stop band (`./stopBand.ts`) is progression across the route;
 * this is the first ten seconds of every single belt on it, and it is the half
 * that stops a stage slamming a child at second zero.
 *
 * Without it the two changes fight each other. A per-stop FLOOR is exactly the
 * promise that a later stop's belt starts busy - Pluto opens at five live rocks
 * - and "five rocks the instant the stage begins" is the same defect the owner
 * reported from the other end. So the floor is where the belt ARRIVES, and this
 * is how it gets there.
 *
 * ================== IT IS AN OPENING, NOT AN ANIMATION ==================
 * The duration is a function of what the game has MEASURED about this child's
 * hands - the same `headroomEarned` axis `@engine/fallTime` reads for both
 * halves of FR-8's budget, so nothing here can disagree with the fall budget
 * about who is fast:
 *
 *     iki       260*    350     440     520     600+
 *     ramp ms   5000    5000    6800    8400    10000
 *
 * (*) A pilot faster than FR-8's own default gets the same opening as one
 * exactly at it, for the reason `headroomEarned` treats them the same.
 *
 * A pilot the controller already knows is quick reaches the stop's floor in
 * five seconds; a pilot it has not measured, or has measured as slow, gets the
 * full ten. Both ends are the window the report asked for, so the slowest child
 * gets the most generous reading of it rather than the average of it.
 *
 * ================== WHAT IT IS NOT ==================
 * It is NOT a knob (AC-10.4 - the knob set is still exactly
 * {maxLive, lengthBias}) and it is not persisted. It is a cap on how much of
 * the knob the board is allowed to use YET, it resets with every belt because
 * every belt is a fresh opening, and it can only ever hold the board SHALLOWER
 * than the knob says. There is no value of the elapsed clock at which this
 * returns more rocks than `maxLive` already allowed, so no belt anywhere can be
 * made busier by it.
 *
 * Pure: the elapsed time is a parameter, not a clock (CLAUDE.md).
 */

import { headroomEarned } from "../fallTime/index.js";
import { DEFAULT_CALIBRATION } from "../types.js";

/** Live rocks a belt opens on, before the ramp widens it. The report's "ONE". */
export const RAMP_OPEN_LIVE = 1;

/**
 * The opening for a pilot whose measured interval has earned the short one, ms.
 *
 * The bottom of the owner's own 5-10 second window. It is not shorter than the
 * window because a fast typist still has to READ a board they have not seen -
 * the opening is about arriving, not about being rewarded for speed.
 */
export const STAGE_RAMP_FAST_MS = 5000;

/**
 * The opening for an unmeasured pilot, or one measured at
 * `HEADROOM_SLOW_IKI_MS` or slower, ms.
 *
 * The top of the window. THIS IS THE DEFAULT, and the direction matters: a
 * profile the game has never watched is handed the longest opening, not the
 * average one, for the same reason every other unmeasured default in this
 * project points at the gentler belt.
 */
export const STAGE_RAMP_SLOW_MS = 10000;

/**
 * How long this belt takes to widen from one rock to the stop's floor, ms.
 *
 * A corrupt or non-finite calibration reads as the SLOWEST pilot, i.e. the
 * longest opening - the only direction a bad value may move a child's belt.
 */
export function stageRampMs(ikiMs?: number): number {
  const earned = headroomEarned(ikiMs ?? DEFAULT_CALIBRATION.ikiMs);
  return STAGE_RAMP_SLOW_MS + earned * (STAGE_RAMP_FAST_MS - STAGE_RAMP_SLOW_MS);
}

/**
 * How many rocks the board may hold this far into the belt.
 *
 * One at the instant the belt opens, one more at each of `cap - 1` equal steps,
 * and exactly `cap` from `rampMs` onward. At a cap of 2 - Mars for a pilot the
 * controller has not moved - that reads as the report asked for it: one rock,
 * for the whole opening, and then two.
 *
 * Total and monotonic. A non-finite clock or a non-finite duration reads as
 * "the ramp is over", because a belt that could not tell the time must not be
 * one that never widens; the cap itself is still the bound in that case, so the
 * failure mode is the pre-UR-83 belt rather than a stuck one.
 */
export function rampedMaxLive(cap: number, elapsedMs: number, rampMs: number): number {
  const top = Math.max(RAMP_OPEN_LIVE, Number.isFinite(cap) ? Math.floor(cap) : RAMP_OPEN_LIVE);
  if (!(rampMs > 0) || !Number.isFinite(elapsedMs)) return top;
  const t = Math.min(1, Math.max(0, elapsedMs) / rampMs);
  return Math.min(top, RAMP_OPEN_LIVE + Math.floor(t * (top - RAMP_OPEN_LIVE)));
}
