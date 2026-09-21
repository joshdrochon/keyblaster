/**
 * WHAT A MULTIPLIER STEP IS ALLOWED TO DO (UR-117).
 *
 * ================== THE DEFECT THIS FILE EXISTS TO PREVENT ==================
 * Three signals land when the score multiplier goes up, and they are rationed
 * DIFFERENTLY. Getting that backwards is the whole failure mode:
 *
 *   BLOOM      every step. Silent, over the rock that just died.
 *   CHIME      x3, x5, x10 only.
 *   BIG BLAST  x3, x5, x10 only - a louder blast and a harder explosion.
 *
 * `scoring/combo.MULTIPLIER_MILESTONES` carries the argument in full and it is
 * not relitigated here: the multiplier is `min(combo, 10)`, so it rises on each
 * of the first ten words of a streak and then never again. A chime on every
 * step is ten rewards in the opening twenty seconds and silence for the rest of
 * the belt; a chime on none of them is a mechanic with no voice. The bloom
 * marks the seven quiet steps, the chime marks the three loud ones.
 *
 * ================== WHY IT TAKES A TRANSITION, NOT A COMBO ==================
 * Both inputs are MULTIPLIERS - `ComboState.multiplier`, read before and after
 * `comboReducer(state, "hit")` - and the rule is about the STEP between them,
 * never about the number on its own.
 *
 * Inferring it from the combo count instead is the bug. At combo 11, 12, 13 the
 * multiplier is pinned at 10 by `MAX_MULTIPLIER`: the combo is still climbing
 * and the multiplier is not, so a rule that reads the combo would bloom on
 * every word for the rest of the streak and - worse - re-fire the x10 chime and
 * the big explosion on each of them. That is precisely the noise the rationing
 * exists to prevent, arriving at the one point in a belt where the player is
 * doing best. A transition of 10 -> 10 is not a step, and this says so.
 *
 * Nothing here knows about Phaser, sound or text. `FlightScene` asks it what
 * this hit earned and then does those things; the rule itself is arithmetic and
 * is tested as arithmetic.
 */

import { isMultiplierMilestone } from "@engine/scoring/index.js";

/** What one hit earned. Every field is a thing the scene may or may not do. */
export interface MultiplierCelebration {
  /** The multiplier went up. Show the silent bloom over the rock. */
  readonly bloom: boolean;
  /** ...and it went up to x3, x5 or x10. Play `comboUp`. */
  readonly chime: boolean;
  /**
   * ...and therefore the rock comes apart harder and the blast is louder.
   *
   * The same flag as `chime` by construction rather than by coincidence: the
   * three milestone signals are one decision, and two booleans that could drift
   * apart is how a feature ends up chiming without exploding.
   */
  readonly milestone: boolean;
  /** The multiplier now in force, e.g. 5. What the bloom reads. */
  readonly multiplier: number;
}

/** Nothing happened: a hit that did not move the multiplier. */
export const NO_CELEBRATION: MultiplierCelebration = Object.freeze({
  bloom: false,
  chime: false,
  milestone: false,
  multiplier: 0,
});

/**
 * The rule, for one `comboReducer(state, "hit")`.
 *
 * `before`/`after` are the multipliers either side of it. A non-increase - a
 * reset, a capped streak, junk input - earns nothing at all.
 */
export function celebrationFor(before: number, after: number): MultiplierCelebration {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return NO_CELEBRATION;
  const to = Math.floor(after);
  if (to <= Math.floor(before)) return NO_CELEBRATION;
  const milestone = isMultiplierMilestone(to);
  return { bloom: true, chime: milestone, milestone, multiplier: to };
}

/* ======================================================================== *
 *  THE BLOOM ITSELF
 * ======================================================================== */

/**
 * THE NUMBER BLOOMS ON THE ROCK, NOT ON THE HUD.
 *
 * The HUD already carries `xN` and it is the wrong place for this: a value
 * changing in the corner is bookkeeping, and what the owner asked for was the
 * hit PAYING OFF. So the new multiplier is drawn at the position of the rock
 * that just died, swells, and fades. It is silent on all but three steps, which
 * is what lets it fire on all ten.
 *
 * ================== IT MAY NOT LAND ON A WORD PLATE ==================
 * A plate hangs BELOW its rock - `render/wordPlateGeometry.plateOffsetY` is
 * `rockSizePx / 2 + PLATE_GAP_PX + plateHalfHeight` - so the band under the
 * rock centre belongs to the word, and a number drawn over it would be the
 * UR-06/UR-52 defect one layer up: decoration on top of the thing the child is
 * reading. The bloom is therefore anchored at the rock CENTRE and does not
 * travel; `bloomHalfHeightPx()` at full swell is what has to fit in the gap
 * above the plate, and `tests/unit/flight/comboBloom.test.ts` asserts it does
 * at the SMALLEST rock the game can spawn (`asteroid.BASE_SIZE_PX`), which is
 * the tightest case.
 *
 * It also does not travel UPWARD, which is not an oversight: `fractureRock`'s
 * `+points` floater already owns that path and two texts climbing out of one
 * rock is two things to read. The bloom swells in place and the score leaves.
 */
export const COMBO_BLOOM = Object.freeze({
  /** Bigger than the `+points` floater's 26 px: this is the headline. */
  fontSizePx: 34,
  /** Phaser's line box for a text object is about 1.25x the font size. */
  lineHeightFactor: 1.25,
  /** Swell: from a little under full size to a little over, then gone. */
  fromScale: 0.55,
  /**
   * What `x2` swells to. Every step above it is bigger - see `bloomToScale`.
   */
  toScale: 1.3,
  /**
   * How much bigger each further multiplier gets, and where it stops (UR-130).
   *
   * A FIXED `toScale` drew `x2` and `x10` at the same size, so the number said
   * the streak had grown and the drawing did not. The ceiling matters as much
   * as the step: this is painted over a rock mid-explosion, and a headline that
   * keeps growing to x10 ends up wider than the thing it is celebrating.
   */
  scalePerStep: 0.085,
  maxScale: 2.05,
  /** Short. It sits on top of an explosion and must not outlive it. */
  durationMs: 420,
  /**
   * How much longer a MILESTONE's bloom holds (UR-130).
   *
   * x3, x5 and x10 are the three the chime and the bigger explosion are
   * rationed to, so they are the three worth reading rather than glimpsing.
   * The ordinary steps keep 420 ms: there are seven of them in the first
   * twenty seconds and lingering on each would stack them on one another.
   */
  milestoneDurationMs: 700,
  /** Clearance kept between the bloom's box and the plate's top edge, px. */
  plateMarginPx: 8,
});

/**
 * What this multiplier's bloom swells to (UR-130).
 *
 * Measured from `x2`, which is the first one anybody sees, so the step is the
 * distance between consecutive multipliers rather than an absolute size. `x1`
 * is never drawn (the multiplier has to RISE for a bloom to fire at all), and
 * the clamp keeps the arithmetic honest if it ever is.
 */
/** How long this bloom stays up: longer for the three that are celebrated. */
export function bloomDurationMs(milestone: boolean): number {
  return milestone ? COMBO_BLOOM.milestoneDurationMs : COMBO_BLOOM.durationMs;
}

export function bloomToScale(multiplier: number): number {
  const n = Number.isFinite(multiplier) ? Math.floor(multiplier) : 2;
  const steps = Math.max(0, n - 2);
  return Math.min(COMBO_BLOOM.maxScale, COMBO_BLOOM.toScale + steps * COMBO_BLOOM.scalePerStep);
}

/**
 * Half the height of the bloom's painted box at full swell, px.
 *
 * TAKES THE MULTIPLIER, because the box is no longer one size. The caller uses
 * this to lift the bloom clear of the rock it is drawn on, so a bigger number
 * has to be lifted further or `x10` would sit lower than `x3` did.
 */
export function bloomHalfHeightPx(multiplier: number = COMBO_BLOOM.maxScale): number {
  const scale =
    multiplier === COMBO_BLOOM.maxScale ? COMBO_BLOOM.maxScale : bloomToScale(multiplier);
  return (COMBO_BLOOM.fontSizePx * COMBO_BLOOM.lineHeightFactor * scale) / 2;
}

/** What the bloom says. The HUD's own vocabulary, so it reads as the same thing. */
export function bloomText(multiplier: number): string {
  return `x${Math.max(1, Math.floor(multiplier))}`;
}
