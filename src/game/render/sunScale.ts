/**
 * How big the sun is drawn at each stop. Pure: no Phaser, no DOM.
 *
 * It lives in its own file rather than in `parallax.ts` for a reason worth
 * stating: `parallax.ts` imports Phaser, so nothing in it can be loaded under
 * vitest's node environment, and a rule that cannot be loaded cannot be
 * asserted. Two defects tonight survived precisely because the only thing a
 * test could reach was a tween's existence rather than its effect.
 */
import { ELEMENTS } from "@engine/ephemeris/elements.js";
import { STOP_IDS, isSatelliteStop, satelliteHost, type StopId } from "@engine/types.js";
import { lightPositionOf, type StopPalette } from "./palette.js";

/** The warm mix at Earth and at Pluto. Every bright stop clears deltaE 30. */
const SUN_WARM_NEAR = 0.9;
const SUN_WARM_FAR = 0.55;

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
 * So it is a legibility curve with the right SHAPE: one step per stop, ending
 * at about a third. Evenly spaced per STOP rather than in AU, because Earth to
 * Mars is half an AU and Uranus to Pluto is sixteen - a curve in AU spends its
 * whole range before Jupiter and then looks static for the rest of the game.
 *
 * THE RANK IS BY DISTANCE, NOT BY ARRAY POSITION. It used to be
 * `STOP_IDS.indexOf`, which gave the right answer only because the route ran
 * outward and the array happened to be in that order. A stop CLOSER to the sun
 * than Earth would have been handed the smallest disc in the game. Ranking by
 * the semi-major axis the ephemeris already carries makes the rule say what it
 * means, and it is the same numbers for a route that does run outward.
 */
/**
 * Distance rank over the PLANETS only.
 *
 * A satellite shares its host's orbit - Zoozve's semi-major axis is 0.7236 AU
 * against Venus's 0.7233 - so ranking it separately inserts a rank between two
 * neighbours that are in the same place. That is not a rounding wobble: it
 * moved Venus from -0.167 to -0.333 steps from Earth, which clamped its warmth
 * to a full mix and made it exactly as warm as Mercury's. A satellite takes its
 * host's rank, because it is at its host's distance.
 */
const BY_DISTANCE: readonly StopId[] = [...STOP_IDS]
  .filter((id) => !isSatelliteStop(id))
  .sort((a, b) => ELEMENTS[a].at.aAu - ELEMENTS[b].at.aAu);

/**
 * How far out a stop is, measured in STEPS FROM EARTH along the distance rank.
 *
 * Anchored on Earth rather than on the array's first entry so that every stop
 * on the shipped route keeps the exact number it had before D103 added two
 * closer ones: spreading the curve over nine ranks moved Earth off zero and
 * cost Mars 1.3 deltaE of sun-versus-sky separation, which put it under the
 * project's bar. A stop inside Earth's orbit gets a NEGATIVE step, so it is
 * bigger and warmer than Earth rather than smaller than Pluto.
 */
function stepsFromEarth(stopId: StopId): number {
  const host = satelliteHost(stopId);
  const here = BY_DISTANCE.indexOf(host ?? stopId);
  if (here < 0) return 0;
  const earth = BY_DISTANCE.indexOf("earth");
  const last = BY_DISTANCE.indexOf("pluto");
  const span = Math.max(1, last - earth);
  return (here - earth) / span;
}

export function sunScaleForStop(stopId?: StopId): number {
  if (stopId === undefined) return 1;
  return 1 - stepsFromEarth(stopId) * SUN_SHRINK_BY_PLUTO;
}

const SUN_BASE_R = 80;

/**
 * The full-frame x range `lightPositionOf` actually uses, across the route.
 *
 * NOT [0, 1], and not the [0.08, 0.92] the formula's `+/- 0.42` suggests:
 * `cos(a)` never reaches +/-1 for the seven angles in play, so the real sweep
 * is 0.259 (Earth) to 0.741 (Pluto). Remapping from the theoretical range
 * would bunch all seven suns into the middle of the aperture and waste most
 * of the glass, so the measured range is what gets stretched.
 */
/** Extra air between the disc and the aperture edge (UR-159). */
const SUN_BAND_MARGIN = 28;

const LIGHT_X_MIN = 0.259;
const LIGHT_X_MAX = 0.741;

/**
 * Where the light's centre goes, in world px.
 *
 * With no band this is the frame position, unchanged. With one, the route's
 * own sweep is stretched across the band and then INSET BY THE DISC'S RADIUS,
 * so the stop at either end of the route has a whole sun inside the glass
 * rather than a bitten edge on the frame. A band narrower than one disc
 * collapses to its centre, which is the honest answer for a porthole.
 */
export function lightBandX(
  atX: number,
  r: number,
  w: number,
  band?: { readonly x: number; readonly w: number },
): number {
  if (band === undefined) return w * atX;
  // UR-159: a full radius plus a margin, so the disc is clearly inside the
  // glass rather than 3 px off it as Pluto's was.
  const inset = Math.min(r * 1.1 + SUN_BAND_MARGIN, band.w / 2);
  const lo = band.x + inset;
  const hi = band.x + band.w - inset;
  if (hi <= lo) return band.x + band.w / 2;
  const t = (atX - LIGHT_X_MIN) / (LIGHT_X_MAX - LIGHT_X_MIN);
  return lo + Math.min(1, Math.max(0, t)) * (hi - lo);
}

export function sunRadius(pal: StopPalette): number {
  return SUN_BASE_R * sunScaleForStop(pal.id as StopId);
}

/** UR-160: the call site scaled a second time, so Pluto drew at 16 px not 36. */
export function sunGeometry(
  pal: StopPalette,
  w: number,
  h: number,
  lightBand?: { readonly x: number; readonly w: number },
  nudge?: { readonly x: number; readonly y: number },
): { readonly cx: number; readonly cy: number; readonly r: number } {
  const at = lightPositionOf(pal);
  const r = sunRadius(pal);
  return {
    cx: lightBandX(at.x, r, w, lightBand) + (nudge?.x ?? 0) * w,
    cy: (at.y + (nudge?.y ?? 0)) * h,
    r,
  };
}

/**
 * How far the disc is mixed toward `SUN_WARM` at this stop.
 *
 * Warmth buys separation from a pale sky, and the amount needed is not the
 * same everywhere: Mars needs almost all of it, Pluto needs half and reads as
 * a desert sun with more. Ranked by distance for the same reason the size is.
 */
export function sunWarmthForStop(stopId?: StopId): number {
  if (stopId === undefined) return SUN_WARM_NEAR;
  // A stop inside Earth's orbit has a NEGATIVE step, so it mixes warmer than
  // Earth rather than flattening onto it. Capped at a full mix.
  const t = stepsFromEarth(stopId);
  return Math.min(1, SUN_WARM_NEAR + t * (SUN_WARM_FAR - SUN_WARM_NEAR));
}
