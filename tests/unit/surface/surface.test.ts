import { describe, expect, it } from "vitest";
import { INK, SKY_PLATE, SPACE, STEP, TYPE } from "@game/ui/theme";
import { BEACON_LOG, CONTENT_TOP, HEADING_TOP, SETTINGS_CONSOLE } from "@game/ui/layout";
import { DEBRIS_SPEC, LAYERS, OVERDRAWING_PLANES } from "@game/render/layers";
import { hudRects } from "@game/flight/hudLayout";
import { PALETTE_STOP_IDS, paletteAt, skyStops } from "@game/render/palette";
import { contrastRatio } from "@engine/contrast/index.js";

/**
 * THE SURFACE SNAPSHOT.
 *
 * Every hand-written guard in this suite answers a question somebody thought to
 * ask. This one answers the question nobody asked yet: a token moves in
 * `theme.ts`, or a palette is re-tuned, and the screen it quietly changed is
 * three directories away. Twice this week a change to one scene broke a guard
 * on another - which is the good case. The bad case is the one with no guard.
 *
 * So the whole Phaser-free surface - tokens, layout rects, layer depths, every
 * palette, and the contrast pairs those palettes imply - is serialised into
 * `surface.snap.json` and diffed. It asserts nothing about whether a value is
 * RIGHT; it asserts that a value did not move without somebody seeing it move.
 * The diff is the review.
 *
 * WHEN IT FAILS: read the diff. If the change was intended, run
 * `npm run snap:update`. If it was not, you just found the bug this file is for.
 *
 * DETERMINISM IS THE WHOLE CONTRACT. Nothing here may read a clock, a random
 * source, the filesystem or a rendered pixel. Numbers are rounded to 4 places
 * so a float's last bit cannot make this fail on another machine.
 */
const round = (n: number): number => Math.round(n * 1e4) / 1e4;

function palettes(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const colorblind of [false, true]) {
    for (const stop of PALETTE_STOP_IDS) {
      const p = paletteAt(stop, colorblind);
      const sky = skyStops(p);
      out[`${stop}.${colorblind ? "colorblind" : "normal"}`] = {
        accent: p.accent,
        plate: p.plate,
        plateText: p.plateText,
        sky,
        colors: p.colors,
        colorRoles: p.colorRoles,
        // The pairs a screen actually puts next to each other. A palette
        // re-tune that quietly drops one of these under the bar shows up here
        // as a number, not as a child squinting at a screenshot.
        contrast: {
          textOnPlate: round(contrastRatio(p.plateText, p.plate)),
          accentOnPlate: round(contrastRatio(p.accent, p.plate)),
          goldOnPlate: round(contrastRatio(INK.accent, p.plate)),
          textOnSkyTop: round(contrastRatio(p.plateText, sky[0]!)),
          goldOnSkyTop: round(contrastRatio(INK.accent, sky[0]!)),
        },
      };
    }
  }
  return out;
}

describe("the surface snapshot", () => {
  it("records every shared token, rect, depth and palette", async () => {
    const surface = {
      theme: { TYPE, STEP, SPACE, INK, SKY_PLATE },
      layout: {
        HEADING_TOP,
        CONTENT_TOP,
        BEACON_LOG,
        SETTINGS_CONSOLE,
      },
      layers: {
        stack: LAYERS,
        overdrawing: OVERDRAWING_PLANES,
        debris: DEBRIS_SPEC,
      },
      // 1920 is the design frame; the right-hand plate is struck from the width.
      hud: hudRects(1920),
      palettes: palettes(),
    };
    await expect(JSON.stringify(surface, null, 2) + "\n").toMatchFileSnapshot(
      "./surface.snap.json",
    );
  });
});
