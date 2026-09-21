import type { Rect } from "./layout.js";
import { HEADING_TOP } from "./grid.js";

/**
 * THE COCKPIT WINDOW, MEASURED (UR-77).
 *
 * ================== WHAT THIS IS FOR ==================
 * The Briefing and the Pre-flight screen are the same cockpit seen twice: a
 * window cut out of a hull, a hull filling everything around it, and a console
 * strip under the glass. Until UR-77 each screen hand-drew the window in its
 * own scene file, and the two drawings had drifted - the Briefing's glass had a
 * CROSS (a vertical mullion and a horizontal one) and the Pre-flight's had a
 * single vertical strut, 4% of the width further left, in a slightly different
 * ink at a slightly different alpha.
 *
 * The project owner did not report "the ink is 0.05 different". They noticed
 * the missing crosshatch and correctly inferred from it that the window was not
 * a shared component. That inference is the ticket: two drawings that happen to
 * match today are not one component, because the next hand touching one screen
 * moves it away from the other again. So the window is a component now, and
 * this module is its geometry.
 *
 * ================== WHY GEOMETRY IS SEPARATE FROM DRAWING ==================
 * The split `panel.ts`/`cockpit.ts` and `controlSurfaceLayout.ts`/
 * `controlSurface.ts` already use, for the same reason: everything here is
 * pure, so the unit suite can assert WHAT IS ON THE GLASS - how many mullions,
 * where each one is, that the frame really surrounds the aperture - in Node,
 * without booting Phaser and without reading a pixel.
 *
 * ================== WHY NOT `controlSurface.ts` ==================
 * That module is documented as the console FACE a column of controls is
 * screwed to: bezel, milled metal, screws, vents, glass recesses. A window is
 * the opposite object - it is the hole, not the plate - it owns the hull mask
 * and the parallax clip, and its consumers are the two story scenes rather than
 * `cockpit.ts`. Folding a viewport into the console module would give that file
 * two unrelated jobs. It is a sibling instead, with the same two-file shape.
 *
 * Nothing here imports Phaser or the DOM.
 */

/**
 * The window's hardware sizes. ONE SET, BOTH SCREENS.
 *
 * Every number was already in the product twice. Where the two copies
 * disagreed, the Briefing's value is the reference - it is the newer screen and
 * the one that was polished (UR-50, UR-58, UR-59, UR-60, UR-61).
 */
/**
 * THE APERTURE ITSELF - the one rectangle the glass is cut at (UR-121).
 *
 * ================== THE DRIFT UR-77 DID NOT CLOSE ==================
 * UR-77 made the window a COMPONENT and put its styling here, and the module
 * note above says exactly why: "two drawings that happen to match today are not
 * one component". What it did not do was move the RECTANGLE. Each screen kept
 * its own, and they were never the same:
 *
 *     briefing   x 1012  y  84  w 812  h 636  r 56
 *     preflight  x  900  y 170  w 924  h 600  r 48
 *
 * 112 px further left, 112 px wider, 36 px shorter, 86 px lower, on a tighter
 * corner. The owner walked Briefing -> Pre-flight and saw the glass jump, which
 * is the same way they found the missing crosshatch: the component was shared
 * and the number it was called with was not.
 *
 * The Briefing's is the standard, on the owner's instruction. It is also the
 * one that is derived rather than typed - `x` is the page's right column and
 * `y` is `grid.HEADING_TOP`, so it sits on the product's own lines instead of
 * on two numbers somebody nudged.
 */
export const VIEWPORT_APERTURE = {
  x: 1012,
  y: HEADING_TOP,
  w: 812,
  h: 636,
  r: 56,
} as const;

export const VIEWPORT_WINDOW = {
  /** How far outside the aperture the heavy outer ring is struck. */
  frameOffset: 7,
  /** The outer ring: the frame the glass is seated in. */
  frameWidth: 14,
  /** The inner ring, catching the light from outside the ship. */
  innerWidth: 3,
  /**
   * How much of the stop's accent is in the inner ring, and how hard it burns.
   *
   * 0.5/0.5, the Briefing's pair. The Pre-flight's was 0.45/0.45, which is not
   * a decision anybody made - it is what a hand-copied line looks like after
   * somebody nudged it once.
   */
  innerMix: 0.5,
  innerAlpha: 0.5,
  /** The frame's own ink, as an alpha over the raised-panel token. */
  frameAlpha: 1,
  /** A vertical mullion: the width of the strut. */
  mullionW: 16,
  /** A horizontal mullion: the depth of the strut. */
  mullionH: 12,
  /** How opaque a strut is. The Briefing's 0.92, not the Pre-flight's 0.9. */
  mullionAlpha: 0.92,
  /** Where the vertical strut crosses, as a fraction of the aperture's width. */
  verticalAt: 0.42,
  /** Where the horizontal strut crosses, as a fraction of its height. */
  horizontalAt: 0.7,
} as const;

/**
 * WHERE THE CROSS CROSSES - the one thing that is genuinely per-screen.
 *
 * Both screens get a CROSS. The single strut was not a decision either; it was
 * the older screen never being brought along, which is the same story as the
 * 76 px console strip (UR-61).
 *
 * What IS a real difference is the HEIGHT the horizontal strut crosses at,
 * because only one of the two windows has something printed on its glass. The
 * Pre-flight's carries the typed word - a plate up to 848 px wide, low on the
 * glass - and the Briefing's 0.7 lands squarely on the top edge of it. So the
 * fraction is a prop with the Briefing's value as the default, and Pre-flight
 * derives its own from the plate it has to clear (`preflightLayout`).
 *
 * `undefined` means "no strut on that axis". Nothing in the product passes it,
 * and that is deliberate: it exists so a future screen with a porthole can say
 * so out loud rather than quietly hand-drawing a second window.
 */
export interface MullionPattern {
  readonly verticalAt?: number | undefined;
  readonly horizontalAt?: number | undefined;
}

/** The cross both cockpit screens carry. */
export const COCKPIT_CROSS: MullionPattern = {
  verticalAt: VIEWPORT_WINDOW.verticalAt,
  horizontalAt: VIEWPORT_WINDOW.horizontalAt,
};

export interface ViewportWindowParts {
  /** The hole in the hull. The parallax is clipped to exactly this. */
  readonly aperture: Rect;
  readonly radius: number;
  /** The outer ring's stroke path, struck outside the aperture. */
  readonly frame: Rect;
  readonly frameRadius: number;
  /** The struts across the glass, vertical first. */
  readonly mullions: readonly Rect[];
}

/**
 * Lay a cockpit window out around its aperture.
 *
 * Everything the window draws comes from these boxes; nothing is measured
 * twice. That is what lets a test assert the geometry of the thing the screens
 * actually draw rather than of a model of it.
 */
export function viewportWindowLayout(
  aperture: Rect,
  radius: number,
  pattern: MullionPattern = COCKPIT_CROSS,
): ViewportWindowParts {
  const o = VIEWPORT_WINDOW.frameOffset;
  const mullions: Rect[] = [];
  if (pattern.verticalAt !== undefined) {
    mullions.push({
      // Centred on the fraction, so the strut straddles the line rather than
      // starting on it. The Pre-flight wrote this as `w * 0.38 - 8`, i.e. the
      // same intent with the half-width subtracted by hand.
      x: aperture.x + aperture.w * pattern.verticalAt - VIEWPORT_WINDOW.mullionW / 2,
      y: aperture.y,
      w: VIEWPORT_WINDOW.mullionW,
      h: aperture.h,
    });
  }
  if (pattern.horizontalAt !== undefined) {
    mullions.push({
      x: aperture.x,
      y: aperture.y + aperture.h * pattern.horizontalAt,
      w: aperture.w,
      h: VIEWPORT_WINDOW.mullionH,
    });
  }
  return {
    aperture,
    radius,
    frame: {
      x: aperture.x - o,
      y: aperture.y - o,
      w: aperture.w + o * 2,
      h: aperture.h + o * 2,
    },
    frameRadius: radius + o,
    mullions,
  };
}

/**
 * How many separate pieces the window draws.
 *
 * The number a regression would move, the same guard
 * `controlSurfaceElementCount` gives the console strip. A window that has
 * quietly become a rounded rectangle with a line round it has lost its struts,
 * and this count says so out loud.
 */
export function viewportWindowElementCount(parts: ViewportWindowParts): number {
  return 2 + parts.mullions.length;
}
