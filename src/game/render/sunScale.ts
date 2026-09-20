/**
 * How big the sun is drawn at each stop. Pure: no Phaser, no DOM.
 *
 * It lives in its own file rather than in `parallax.ts` for a reason worth
 * stating: `parallax.ts` imports Phaser, so nothing in it can be loaded under
 * vitest's node environment, and a rule that cannot be loaded cannot be
 * asserted. Two defects tonight survived precisely because the only thing a
 * test could reach was a tween's existence rather than its effect.
 */
import { STOP_IDS, type StopId } from "@engine/types.js";

/** How much of the disc the route's far end takes away. */
export const SUN_SHRINK_BY_PLUTO = 0.66;

/**
 * How much of its near-Earth size the sun keeps at this stop.
 *
 * THE SUN WAS THE SAME SIZE AT MARS AND AT PLUTO, and it should not be. The
 * beacon screen prints the distance on the very same frame - Pluto reads
 * `r 35.61 AU` - so the sky was contradicting a number the child can read.
 *
 * This is NOT the physical law. True angular size goes as 1/r, which puts
 * Pluto's disc at 48/35.61 = 1.3 px: correct, invisible, and it would delete
 * the one visible light source that every rim and silhouette in the frame is
 * lit by (WORLD-BAR item 4). A frame lit from nowhere is a worse lie than a
 * generous disc.
 *
 * So it is a legibility curve with the right SHAPE: smaller at every stop,
 * ending at about a third. Linear in ROUTE ORDER rather than in AU, because
 * the route is what the child experiences - Earth to Mars is half an AU and
 * Uranus to Pluto is sixteen, so a curve in AU would spend its whole range
 * before Jupiter and then look static for the rest of the game.
 *
 *     earth 1.00  mars 0.89  jupiter 0.78  saturn 0.67
 *     uranus 0.56  neptune 0.45  pluto 0.34
 */
export function sunScaleForStop(stopId?: StopId): number {
  if (stopId === undefined) return 1;
  const i = STOP_IDS.indexOf(stopId);
  if (i < 0) return 1;
  const last = Math.max(1, STOP_IDS.length - 1);
  return 1 - (i / last) * SUN_SHRINK_BY_PLUTO;
}
