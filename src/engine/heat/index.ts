import { rockHintFits, type RockHintView } from "../hint/index.js";
import { type StopId } from "../types.js";

/**
 * D110: a rock arrives hot at Mercury and cools as it falls. Venus's cloud
 * (D109) is a reading load; this is a timing one.
 */

/** One entry, so every other belt is unchanged. */
export const HEAT_BY_STOP: Readonly<Partial<Record<StopId, boolean>>> = Object.freeze({
  mercury: true,
});

export function hasHeat(stop: StopId): boolean {
  return HEAT_BY_STOP[stop] === true;
}

/** One rock in three. Counted, not rolled: the ratio is the promise. */
export const HEAT_EVERY = 3;

export function isHotRock(stop: StopId, hotCycle: number): boolean {
  if (!hasHeat(stop)) return false;
  if (!Number.isFinite(hotCycle)) return false;
  return Math.floor(hotCycle) % HEAT_EVERY === 0;
}

export interface HotWarningInput {
  readonly stopId: StopId;
  readonly saidThisRun: boolean;
  readonly leadMs: number;
  readonly hot: RockHintView | null;
}

/** Same shape as `shouldWarnNested`: the line lands while the rock is still there. */
export function shouldWarnHot(input: HotWarningInput): boolean {
  if (input.saidThisRun) return false;
  if (!hasHeat(input.stopId)) return false;
  if (input.hot === null) return false;
  return rockHintFits(input.hot, input.leadMs);
}

/**
 * Steep early, then flat: a body radiates fastest when it is hottest, and it
 * puts the decision where there is still one to make. At 1.8 a rock sheds two
 * thirds of its heat in the first 40% of the drop.
 */
export const HEAT_EXP = 1.8;



/** The bonus is the top half of the fall. */
export const HEAT_WINDOW = 0.5;

/** 1 at spawn, 0 by `HEAT_WINDOW`. Fails COLD on junk. */
export function heatOf(fallProgress: number): number {
  if (!Number.isFinite(fallProgress)) return 0;
  const p = Math.min(1, Math.max(0, fallProgress));
  if (p >= HEAT_WINDOW) return 0;
  return Math.pow(1 - p / HEAT_WINDOW, HEAT_EXP);
}

/**
 * Heat quantised to 1/255, which is the finest a colour channel can hold.
 *
 * THERE WERE SIX STEPS, on the assumption that a vector redraw per rock per
 * frame was too dear. Measured on three live rocks: 157 ms median frame at near
 * continuous redraw against 162 ms at six, with a 165 ms floor on a belt with
 * no heat at all. The redraw does not register. Six steps bought nothing and
 * cost a visible jolt - 16 to 33 units of colour per repaint, doubled on the
 * first one because the curve is steep early.
 */
export function heatStep(heat: number): number {
  if (!Number.isFinite(heat)) return 0;
  return Math.round(Math.min(1, Math.max(0, heat)) * 255);
}

/**
 * NEVER BELOW 1. A cold rock pays what a rock has always paid - this adds a
 * reward for speed, it does not take anything from the child who is slower
 * (D31). "Cold costs more" is the same ordering without a penalty in it.
 */
export const HEAT_BONUS_MAX = 0.5;

export function heatMultiplier(heat: number): number {
  if (!Number.isFinite(heat)) return 1;
  const h = Math.min(1, Math.max(0, heat));
  return 1 + h * HEAT_BONUS_MAX;
}
