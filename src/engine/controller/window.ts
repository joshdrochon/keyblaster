/**
 * Rolling hit-rate window (D53, PRD FR-10, architecture section 4.3).
 *
 * "HIT RATE (asteroids blasted / spawned) over the last 20 spawn outcomes."
 * The window is rolling, not per-stage: it is explicitly "the last 20
 * outcomes", so it carries across a stage boundary. That is what lets the
 * controller see a trend rather than one stage's noise, which is the whole
 * point of D53 preferring hit rate over a raw stage score.
 */

/** One spawn's fate. A spawned asteroid is either blasted or it is not. */
export type SpawnOutcome = "blasted" | "missed";

/** PRD FR-10: "the last 20 spawn outcomes". */
export const WINDOW_SIZE = 20;

export interface HitWindow {
  /** Oldest first, newest last. Length is capped at WINDOW_SIZE. */
  readonly outcomes: readonly SpawnOutcome[];
}

/**
 * Build a window. A seed longer than WINDOW_SIZE keeps only its tail, so a
 * restored profile can never smuggle in a longer memory than the spec allows.
 */
export function createWindow(seed: readonly SpawnOutcome[] = []): HitWindow {
  return { outcomes: seed.slice(-WINDOW_SIZE) };
}

/** Append one outcome, evicting the oldest once the window is full. */
export function pushOutcome(window: HitWindow, outcome: SpawnOutcome): HitWindow {
  const next = [...window.outcomes, outcome];
  return { outcomes: next.length > WINDOW_SIZE ? next.slice(-WINDOW_SIZE) : next };
}

/** Blasted count in the window. */
export function windowHits(window: HitWindow): number {
  let hits = 0;
  for (const o of window.outcomes) if (o === "blasted") hits += 1;
  return hits;
}

/**
 * Hit rate over whatever the window currently holds, or null when it is empty.
 *
 * Before 20 outcomes exist the rate is computed over the partial window rather
 * than withheld. The spec sets no minimum sample size, and withholding one
 * would mean a first stage can never adapt - which contradicts D18's promise
 * that the cold start is handled in-game and not by a frozen controller.
 *
 * Consequence worth knowing: a 1-outcome window reads 0.0 or 1.0, so the very
 * first stage can move a knob on a single sample. That is the documented
 * behaviour and we implement it; the disguised warm-up wave (D18) is where the
 * spec puts the cold-start protection, not here.
 */
export function windowRate(window: HitWindow): number | null {
  const n = window.outcomes.length;
  if (n === 0) return null;
  return windowHits(window) / n;
}
