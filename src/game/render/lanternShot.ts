/**
 * REFERENCE-COMPARE HARNESS for the Lantern (AC-24.2, gauntlet item R-lantern).
 *
 * Draws the four base colourways (D79, AC-24.3) in a row at a clean, fixed
 * scale on a flat field, which is exactly how the reference sheet in
 * `design-reference/refs/` is laid out - so the judge step compares like with
 * like instead of hunting a ship out of a parallax frame.
 *
 * WHY THIS IS NOT IN `src/game/scenes/`: trace-check relation 3 requires every
 * file there to have a screen-inventory row (D78), and a render harness is not
 * a screen. It lives in render/, is registered by boot.ts only when the URL
 * carries `?lantern=1`, and never runs in a normal session.
 */

import Phaser from "phaser";
import { LANTERN_COLORWAYS, LANTERN_DESIGN_HEIGHT, drawLantern } from "./lantern.js";
import { ensureTextures } from "./textures.js";
import { GAME_HEIGHT, GAME_WIDTH } from "../sceneKeys.js";

export const LANTERN_SHOT_KEY = "LanternShot";

export class LanternShotScene extends Phaser.Scene {
  constructor() {
    super(LANTERN_SHOT_KEY);
  }

  create(): void {
    ensureTextures(this);
    // Transparent, not the reference's blue field: an alpha background makes
    // the SILHOUETTE the only thing in the frame, which is what a side-by-side
    // judge and the desaturated-silhouette item (AC-22.4) both want to see.
    // boot.ts builds the game with `transparent: true` under `?lantern=1`.
    this.cameras.main.setBackgroundColor("rgba(0,0,0,0)");

    const count = LANTERN_COLORWAYS.length;
    // 0.60 keeps a full fin span (1.62x fuselage width) clear of its neighbour.
    const scale = (GAME_HEIGHT * 0.6) / LANTERN_DESIGN_HEIGHT;
    const step = GAME_WIDTH / count;

    LANTERN_COLORWAYS.forEach((colorway, i) => {
      drawLantern(this, step * (i + 0.5), GAME_HEIGHT * 0.5, {
        scale,
        colorway,
        exhaust: true,
        beam: true,
        idleBob: false,
        iris: 0.72,
      });
    });

    (window as unknown as { __kbLanternShot?: boolean }).__kbLanternShot = true;
  }
}
