import type { Stars } from "../types.js";

/**
 * Stage star rating from hull hits (D27, PRD AC-4.4, surfaced by AC-20.4).
 *
 * D27 gives the hull three hits per stage; AC-4.4 maps 0 hits -> 3 stars,
 * 1 -> 2, 2 -> 1. The PRD deliberately stops there, and the reason is D29: the
 * LAST hit empties the hull, which stalls the engine and fails the mission.
 * A stage that reaches its hull capacity is never cleared, so **a cleared stage
 * can only ever carry fewer hits than the hull has marks, and therefore only
 * ever 3, 2 or 1 stars.**
 *
 * "Three hits" is now the capacity of an 18-word stage specifically; a longer
 * belt carries a proportionally longer hull (`@engine/hull`, and the note on
 * `HULL_HITS_PER_STAGE` below). The sentence above survives that unchanged,
 * because it was never about the number 3 - it is about the relation between
 * the hull and the stall.
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

/**
 * D27's hull capacity AT THE STAGE LENGTH D27 WAS WRITTEN FOR, and therefore
 * the default hit count that stalls the run (D29).
 *
 * It is no longer the capacity of every stage. `@engine/hull` scales the hull
 * with how many words the stage spawns, because D27's three marks and D17's
 * 80-90% band only agree at 18 words; see that module's header. This constant
 * stays as the DEFAULT so every existing caller keeps AC-4.4's exact 0/1/2
 * mapping, and a longer stage passes its own `maxHull`.
 */
export const HULL_HITS_PER_STAGE = 3;

/** Stars reachable by a cleared stage. 0 is absent by construction (D29). */
export const CLEARED_STAGE_STARS: readonly Stars[] = [3, 2, 1] as const;

/**
 * AC-4.4, generalised to a stage of any length.
 *
 * The AC names three rows - 0 hits is 3 stars, 1 is 2, 2 is 1 - and those rows
 * are really THIRDS of the hull, which is only visible once the hull stops
 * being 3. The rating is therefore the band the hits fall in:
 *
 *     stars = 3 - ceil(hits x 3 / maxHull)
 *
 * At maxHull 3 that is AC-4.4 term for term. At maxHull 9 it is 1-3 hits -> 2
 * stars, 4-6 -> 1, and the clamp keeps 7 and 8 at 1 rather than letting the
 * arithmetic mint a 0-star CLEARED stage - which the header below explains is
 * the one value a cleared stage may never carry.
 *
 * Returns 0 for a stall (hits >= maxHull) and for unusable input; the caller
 * must read 0 as "not cleared, no rating" (D29) and never render it.
 */
export function starsForHullHits(
  hullHits: number,
  maxHull: number = HULL_HITS_PER_STAGE,
): Stars {
  if (!Number.isFinite(hullHits)) return 0;
  if (hullHits <= 0) return 3;
  const cap = Number.isFinite(maxHull) ? Math.floor(maxHull) : HULL_HITS_PER_STAGE;
  if (cap <= 0) return 0;
  const hits = Math.floor(hullHits);
  if (hits >= cap) return 0;
  const band = 3 - Math.ceil((hits * 3) / cap);
  // hits is in [1, cap - 1], so the band is in [0, 2]; the clamp only bites on
  // the top slice of a long hull, where 0 would be a lie about a cleared stage.
  return Math.max(1, Math.min(3, band)) as Stars;
}

/**
 * True when this hull-hit count belongs to a stage that could have been
 * cleared. Exposed so the results screen can assert its own precondition
 * instead of inferring it from a 0 that would look like a score.
 */
export function isClearableHullHits(
  hullHits: number,
  maxHull: number = HULL_HITS_PER_STAGE,
): boolean {
  // Defined in terms of starsForHullHits so the two can never disagree about
  // what counts as a stall, including on junk input.
  return starsForHullHits(hullHits, maxHull) !== 0;
}
