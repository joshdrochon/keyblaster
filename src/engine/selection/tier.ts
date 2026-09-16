import type { WordRecord } from "../types.js";
import { type WordBook, recordFor } from "../words/index.js";

/**
 * Shared-prefix difficulty tier (D25, PRD AC-2.1/AC-2.2, architecture 4.2).
 *
 * D25 makes "two asteroids start with the same letter" a MASTERY-GATED tier,
 * skinned as the Lantern's dual cannons. Until it unlocks, AC-2.1 guarantees
 * the first keystroke is unambiguous, so auto-lock (D24/AC-3.1) always has
 * exactly one answer. Once it unlocks, lock/ resolves on the first keystroke
 * that makes the typed prefix unique (AC-2.2) - that half is lock/'s job; this
 * module only decides WHEN sharing is permitted.
 *
 * Gate, verbatim from architecture 4.2: at least 80% of the stage pool has
 * ease < 0.6.
 */

/** Ease below which a word counts as "solid" for the D25 gate. */
export const TIER_EASE_THRESHOLD = 0.6;

/** Fraction of the stage pool that must be solid before the tier unlocks. */
export const TIER_UNLOCK_FRACTION = 0.8;

/** Share of `pool` whose record has ease < TIER_EASE_THRESHOLD, in [0, 1]. */
export function solidFraction(pool: readonly string[], book: WordBook): number {
  if (pool.length === 0) return 0; // no pool, no mastery - never 0/0.
  let solid = 0;
  for (const word of pool) {
    const record: WordRecord = recordFor(book, word);
    if (record.ease < TIER_EASE_THRESHOLD) solid += 1;
  }
  return solid / pool.length;
}

/**
 * AC-2.2 / D25: is the shared-prefix tier unlocked for this stage pool?
 *
 * Evaluated ONCE, at stage start (see createSelectionState). Ease moves during
 * a stage, so re-evaluating per spawn could flip the tier on mid-flight and
 * retroactively make an already-live pair of asteroids legal or illegal. A
 * difficulty tier that switches under the player's fingers is a worse bug than
 * a tier that unlocks one stage late.
 */
export function sharedPrefixUnlocked(pool: readonly string[], book: WordBook): boolean {
  return solidFraction(pool, book) >= TIER_UNLOCK_FRACTION;
}
