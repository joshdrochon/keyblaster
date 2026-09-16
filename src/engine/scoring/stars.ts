import type { Stars } from "../types.js";

/**
 * Stage star rating from hull hits (D27, PRD AC-4.4, surfaced by AC-20.4).
 *
 * D27 gives the hull three hits per stage; AC-4.4 maps 0 hits -> 3 stars,
 * 1 -> 2, 2 -> 1. The PRD deliberately stops there, and the reason is D29: the
 * third hit empties the hull, which stalls the engine and fails the mission.
 * A stage that reaches three hits is never cleared, so **a cleared stage can
 * only ever carry 0, 1 or 2 hits, and therefore only ever 3, 2 or 1 stars.**
 *
 * That makes 0 stars unreachable for a cleared stage. We still define it -
 * `Stars` includes 0 and a stalled stage has to map somewhere - but it means
 * "this stage was not cleared", not "you earned nothing". Making it explicit
 * here is the point: the alternative (letting 3 hits fall through to whatever
 * the arithmetic produced) would quietly invent a 0-star cleared stage that the
 * PRD never sanctions.
 *
 * NON-FINITE INPUT POLICY (shared with combo.ts): a finite number out of range
 * is clamped and floored into range, so -1 hits is 0 hits and earns 3 stars. A
 * non-finite number is not a play outcome, so it is unusable and yields the
 * no-reward value, which here is 0 - "no rating", the same value a stall
 * produces. Junk data must not mint a perfect score, and because 0 also makes
 * `isClearableHullHits` false, the results screen declines to render a rating
 * rather than rendering a bad one. Nothing negative reaches the player either
 * way (D31).
 */

/** D27: hull capacity, and therefore the hit count that stalls the run (D29). */
export const HULL_HITS_PER_STAGE = 3;

/** Stars reachable by a cleared stage. 0 is absent by construction (D29). */
export const CLEARED_STAGE_STARS: readonly Stars[] = [3, 2, 1] as const;

/**
 * AC-4.4. Returns 0 for a stall (>= 3 hits) and for unusable input; the caller
 * must read 0 as "not cleared, no rating" (D29) and never render it.
 */
export function starsForHullHits(hullHits: number): Stars {
  if (!Number.isFinite(hullHits)) return 0;
  if (hullHits <= 0) return 3;
  const hits = Math.floor(hullHits);
  if (hits >= HULL_HITS_PER_STAGE) return 0;
  // hits is 1 or 2 here, so 3 - hits is 2 or 1.
  return (HULL_HITS_PER_STAGE - hits) as Stars;
}

/**
 * True when this hull-hit count belongs to a stage that could have been
 * cleared. Exposed so the results screen can assert its own precondition
 * instead of inferring it from a 0 that would look like a score.
 */
export function isClearableHullHits(hullHits: number): boolean {
  // Defined in terms of starsForHullHits so the two can never disagree about
  // what counts as a stall, including on junk input.
  return starsForHullHits(hullHits) !== 0;
}
