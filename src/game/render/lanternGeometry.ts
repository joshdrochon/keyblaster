/**
 * The Lantern's geometry in DESIGN UNITS, with no Phaser in it.
 *
 * `lantern.ts` draws the ship and imports Phaser to do it, which means nothing
 * outside a booted game can ask how tall the ship is. That was fine while only
 * Flight, Warp and the Title placed one - all three scale it against the frame
 * and eyeball the result.
 *
 * UR-53 put a Lantern on the Director map, hovering above the selected planet,
 * in a band with the header block's plate above it and a beacon lamp's halo
 * below it. "Does the ship fit between those two things, at all seven stops" is
 * arithmetic, and arithmetic belongs in a test rather than in a screenshot - so
 * the numbers the answer depends on live here and `lantern.ts` re-exports them.
 *
 * Every value is a ratio off the reference sheet times the fuselage width; see
 * the geometry note at the top of `lantern.ts`.
 */

/** Bottom of the nozzle bell. */
export const NOZZLE_BOTTOM = 178;
/** The outermost point of the fin span, i.e. the ship's drawn half-width. */
export const FIN_TIP = { x: 123, y: 150 } as const;
/** The emitter pivots here, at the top of the fixed collar. */
export const PIVOT = { x: 0, y: -160 } as const;
/** Lens centre relative to PIVOT. */
export const LENS_LOCAL = { x: 0, y: -50 } as const;
export const LENS_R = 37;

/** Top of the beam head, relative to the rig's origin. */
export const LANTERN_DESIGN_TOP = PIVOT.y + LENS_LOCAL.y - LENS_R;

/** Top of the beam head to the bottom of the nozzle bell, in design units. */
export const LANTERN_DESIGN_HEIGHT = NOZZLE_BOTTOM - LANTERN_DESIGN_TOP;

/**
 * Fraction of the drawn height that sits ABOVE the rig's origin.
 *
 * `drawLantern(scene, x, y)` puts the ORIGIN at (x, y), not the ship's centre,
 * so a caller placing the ship in a gap has to know which way it is off-centre.
 * This is that number: 247 of 425, i.e. the ship hangs 58% above its origin.
 */
export const LANTERN_ABOVE_ORIGIN = -LANTERN_DESIGN_TOP / LANTERN_DESIGN_HEIGHT;

/**
 * The lens centre relative to the rig's origin, design units.
 *
 * The beam comes out of HERE (AC-24.1: one beam source), and a caller that
 * draws its own beam - Flight does, because the beam is gameplay - needs the
 * origin without reaching into the rig's transform.
 */
export const LANTERN_LENS_OFFSET = {
  x: PIVOT.x + LENS_LOCAL.x,
  y: PIVOT.y + LENS_LOCAL.y,
} as const;

/**
 * How far past the nozzle the idle exhaust plume reaches.
 *
 * `paintExhaust` fills `plume(34, 152)`, so a rig drawn with `exhaust: true` is
 * a third taller than `LANTERN_DESIGN_HEIGHT` says. The Director map draws with
 * `exhaust: false` precisely because of this number; it is exported so that
 * choice is checkable rather than a claim in a comment.
 */
export const LANTERN_PLUME_LENGTH = 152;

/** The ship's drawn box, in design units, relative to the rig's origin. */
export function lanternDesignBox(withExhaust: boolean): {
  top: number;
  bottom: number;
  halfWidth: number;
} {
  return {
    top: LANTERN_DESIGN_TOP,
    bottom: NOZZLE_BOTTOM + (withExhaust ? LANTERN_PLUME_LENGTH : 0),
    halfWidth: FIN_TIP.x,
  };
}
