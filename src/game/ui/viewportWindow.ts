import Phaser from "phaser";
import { hexToNum, mixHex } from "@game/render/palette";
import { INK } from "./theme.js";
import { HULL } from "./panel.js";
import type { Rect } from "./layout.js";
import {
  type MullionPattern,
  VIEWPORT_WINDOW,
  type ViewportWindowParts,
  viewportWindowLayout,
} from "./viewportWindowLayout.js";

/**
 * THE COCKPIT WINDOW, DRAWN — ONE COMPONENT, TWO SCREENS (UR-77; D83).
 *
 * ================== WHAT THIS REPLACES ==================
 * Two hand-drawn windows. `BriefingScene.drawCockpit` and
 * `PreflightScene.drawWindowAndPlanet` each built the hull, the inverted hull
 * mask, the parallax clip, the two frame rings and the struts from scratch, in
 * about thirty lines apiece that were nearly - but not quite - the same lines.
 * The differences were not decisions: a single strut instead of a cross, 0.45
 * where the other said 0.5, 0.9 where the other said 0.92, and two separate
 * mask-source Graphics on the Briefing with byte-identical geometry.
 *
 * The owner spotted the missing crosshatch and read the real fault off it - the
 * window is not a shared component. Making the second drawing match the first
 * would have closed the symptom and left the fault, because the next hand to
 * touch one screen moves it away from the other again. So there is ONE
 * implementation and both scenes call it; `viewportWindow.test.ts` greps both
 * scenes to prove neither kept a private copy.
 *
 * ================== WHAT IT OWNS ==================
 * Everything about the hole and the wall around it:
 *  - the aperture mask, so the parallax stack is CLIPPED to the glass rather
 *    than cropped (the layers keep moving behind the frame);
 *  - the hull, as a lit surface rather than a hole - milled charcoal from
 *    `panel.HULL`, lit from above, darkest stop L* 7.5 against `VOID_LSTAR`;
 *  - the inverted mask that cuts the aperture out of it, so the frame and the
 *    glass are pixel-identical and no seam shows at the rim;
 *  - the two frame rings and the struts.
 *
 * What it does NOT own is anything SEEN through the glass, which is the scene's
 * own business: the Briefing's parallax celestial layer, the Pre-flight's
 * planet swinging in over the ritual, the typed word. Those are handed the
 * returned `glass` mask.
 *
 * ================== THE RULES ==================
 *  - AC-22.8. Every colour comes from a token; `viewportWindow.test.ts` fails
 *    on a hex literal in this file, the same guard `controlSurface.ts` is held
 *    to, because a literal is the only way an unmeasured ink gets drawn.
 *  - D83/D84. Vector, in code. Nothing here loads a raster.
 *  - The light comes from ABOVE, once, for the whole surface: the hull's
 *    gradient runs `HULL.top` to `HULL.bottom`, never the other way.
 */

/** A window the scene can hang things behind, and tear down after itself. */
export interface CockpitWindow {
  /** The measured pieces, for anything the scene has to place against them. */
  readonly parts: ViewportWindowParts;
  /**
   * The clip for anything that must be seen THROUGH the glass.
   *
   * A geometry mask, not a crop: whatever is behind it keeps moving.
   */
  readonly glass: Phaser.Display.Masks.GeometryMask;
  /**
   * The Graphics the frame was drawn into, so a caller can paint the console
   * strip onto the same object rather than adding a second one.
   */
  readonly frame: Phaser.GameObjects.Graphics;
  /**
   * The off-display-list Graphics backing the masks.
   *
   * THE SCENE MUST DESTROY THESE on shutdown. A Graphics from `make.graphics`
   * is not on the display list, so `scene.restart()` does not sweep it up:
   * every restart left another mask source and another GeometryMask behind and
   * the WebGL stencil work grew with them. It only shows under repeated
   * restarts, which is exactly what a per-stop sweep does.
   */
  readonly maskSources: readonly Phaser.GameObjects.Graphics[];
}

export interface CockpitWindowOptions {
  /** The hole in the hull. */
  readonly aperture: Rect;
  readonly radius: number;
  /** The stop's accent: the only saturated thing on the frame. */
  readonly accent: string;
  /** The world the hull has to fill. Read at call time - it grows (D99). */
  readonly world: { readonly w: number; readonly h: number };
  /** Which struts cross the glass. Defaults to the cockpit cross. */
  readonly mullions?: MullionPattern | undefined;
  /** Where the wall sits in the scene's stack. */
  readonly hullDepth: number;
  /** Where the frame sits. Always above the hull. */
  readonly frameDepth: number;
}

/**
 * Cut a cockpit window into the scene and frame it.
 *
 * The one call site each screen has. It is deliberately a single call rather
 * than four exported primitives: four primitives are four things a screen can
 * forget, and the Pre-flight forgetting the crosshatch is the whole ticket.
 */
export function drawCockpitWindow(
  scene: Phaser.Scene,
  options: CockpitWindowOptions,
): CockpitWindow {
  const parts = viewportWindowLayout(options.aperture, options.radius, options.mullions);
  const { aperture, radius } = parts;

  // ONE mask source, two masks off it: the glass clip and its inverse. The
  // Briefing used to build this rectangle twice, in two Graphics objects, 165
  // lines apart - which is how a window's corner radius comes to disagree with
  // its own hull cutout and show a rim.
  const shape = scene.make.graphics({}, false);
  shape.fillStyle(0xffffff, 1);
  shape.fillRoundedRect(aperture.x, aperture.y, aperture.w, aperture.h, radius);
  const glass = shape.createGeometryMask();
  const cutout = shape.createGeometryMask();
  cutout.setInvertAlpha(true);

  // A LIT SURFACE, NOT A HOLE. This was a flat `INK.bg` fill - L* 4.98 - over
  // every pixel the page and the glass did not cover, about 40% of the frame; a
  // blind critic measured it and called the left and right thirds voids. It is
  // milled charcoal now, lit from above like every other surface in the game.
  // See `ui/panel.ts` HULL / VOID_LSTAR.
  const hull = scene.add.graphics().setDepth(options.hullDepth);
  hull.fillGradientStyle(
    hexToNum(HULL.top),
    hexToNum(HULL.top),
    hexToNum(HULL.bottom),
    hexToNum(HULL.bottom),
    1,
  );
  hull.fillRect(0, 0, options.world.w, options.world.h);
  hull.setMask(cutout);

  const frame = scene.add.graphics().setDepth(options.frameDepth);
  // Two rings, the inner one catching the light from outside the ship.
  frame.lineStyle(
    VIEWPORT_WINDOW.frameWidth,
    hexToNum(INK.panelRaised),
    VIEWPORT_WINDOW.frameAlpha,
  );
  frame.strokeRoundedRect(
    parts.frame.x,
    parts.frame.y,
    parts.frame.w,
    parts.frame.h,
    parts.frameRadius,
  );
  frame.lineStyle(
    VIEWPORT_WINDOW.innerWidth,
    hexToNum(mixHex(options.accent, INK.text, VIEWPORT_WINDOW.innerMix)),
    VIEWPORT_WINDOW.innerAlpha,
  );
  frame.strokeRoundedRect(aperture.x, aperture.y, aperture.w, aperture.h, radius);

  // The struts: this is a ship, not a picture frame.
  frame.fillStyle(hexToNum(INK.panelRaised), VIEWPORT_WINDOW.mullionAlpha);
  for (const m of parts.mullions) frame.fillRect(m.x, m.y, m.w, m.h);

  return { parts, glass, frame, maskSources: [shape] };
}
