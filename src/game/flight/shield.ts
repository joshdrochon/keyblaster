import { HULL_HITS_PER_STAGE } from "@engine/scoring/index.js";

/**
 * Hull and the shield canister (FR-4, FR-5; D26, D27, D28).
 *
 * These are RULES, and CLAUDE.md puts rules in src/engine. They are here
 * because src/engine has no hull module yet and this lane may not create one;
 * they are written as pure, total functions over numbers so that lifting them
 * into `src/engine/hull/` later is a file move plus an import change, with the
 * scene untouched. Flagged to the lead as an engine gap.
 *
 * Nothing in this file is a failure count. `hullMarksLit` is what the HUD draws
 * - three marks that dim - and there is no "lives", no deduction and no
 * penalty anywhere in the surface (D31, AC-22b.1).
 */

/** AC-4.1: three hits per stage, reset at stage start (D27). */
export const MAX_HULL = HULL_HITS_PER_STAGE;

/** AC-4.1: hull at every stage start. */
export const startingHull = (): number => MAX_HULL;

/** AC-4.2: a rock crossing the breach line costs exactly one. Never below 0. */
export function hullAfterStrike(hull: number): number {
  return Math.max(0, Math.min(MAX_HULL, Math.floor(hull)) - 1);
}

/** AC-5.2: blasting a canister restores one, capped at three. */
export function hullAfterShield(hull: number): number {
  return Math.min(MAX_HULL, Math.max(0, Math.floor(hull)) + 1);
}

/** AC-4.3: an empty hull stalls the stage (D29). */
export const isStalled = (hull: number): boolean => hull <= 0;

/** How many of the three HUD marks are lit. */
export function hullMarksLit(hull: number): number {
  return Math.max(0, Math.min(MAX_HULL, Math.floor(hull)));
}

/**
 * AC-5.1: a canister spawns only when the hull is damaged, and only one is ever
 * live. The word on it comes from the stage pool like any other rock, so this
 * predicate decides WHETHER, never WHAT - selection/ owns what.
 */
export function maySpawnCanister(
  hull: number,
  canisterLive: boolean,
): boolean {
  if (canisterLive) return false;
  return hullMarksLit(hull) < MAX_HULL;
}
