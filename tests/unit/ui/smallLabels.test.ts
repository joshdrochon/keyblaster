import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  TEXT_MIN_CONTRAST,
  WORST_CASE_SKY,
  compositeOver,
  contrastRatio,
  measureTexts,
  type TextSample,
} from "@engine/contrast/index.js";
import { PALETTE_STOP_IDS, paletteAt } from "@game/render/palette";
import { menuDebris } from "@game/ui/starfield";
import { INK } from "@game/ui/theme";

/**
 * THE SMALL LABELS NOBODY WAS MEASURING.
 *
 * A contrast sweep took 69 sky-borne strings to a worst case of 5.87:1 and all
 * four of these went straight past it, because `skyText`'s registry only sees
 * text a scene drew OVER THE WORLD. These sit on plates - the HUD's own
 * readout plate, and the menu backdrop - so nothing registered them:
 *
 *   HUD label "wpm"        3.94:1   stop accent on the 0.86-alpha HUD plate
 *   HUD label "score"      4.31:1   the same pair, over a different sky
 *   "remove pilot"         2.82:1   INK.textFaint on the menu backdrop
 *
 * AC-22.8's bar is 4.5:1 wherever the text is drawn and whatever it is drawn
 * on. The word plate (15.58:1) and the HUD numerals (12-14:1) are at bar and
 * are untouched by any of this - the assertions below pin them so a fix to the
 * labels cannot quietly cost the numbers.
 *
 * ================== WHY THE HUD NUMBER MOVED AT ALL ==================
 * The readout plate was drawn at alpha 0.86, so the surface under a HUD label
 * depended on WHICH SKY happened to be behind the corner of the screen - which
 * is why the same pair measured 3.94 on the left and 4.31 on the right of one
 * frame. A contrast plate whose contrast is a function of the parallax is not a
 * contrast plate. It is opaque now, and the ratio is a constant.
 *
 *   npx vitest run tests/unit/ui/smallLabels.test.ts --coverage.enabled=false
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game");

const source = (file: string): string => readFileSync(resolve(SRC, file), "utf8");

/**
 * The alpha `HudScene.plate` fills its readout plate at, read from the scene.
 *
 * READ OFF THE `drawPlate` CALL since UR-69 moved the drawing into the shared
 * component (`ui/plate.ts`). The regex used to match `g.fillStyle(hexToInt(
 * fill), N)`, which is the spelling the scene painted with when it had its own
 * rounded rect. It is still the SCENE that is read, not the component, and for
 * the reason this file exists: the alpha that matters is the one this screen
 * asks for, and a default in the component would be a number no stop was ever
 * measured at.
 */
function hudPlateAlpha(): number {
  // WATCHED FAILING after the move: with `alpha: 1` in `HudScene.plate` put
  // back to the shipped `alpha: 0.86`, this file reports
  //   the HUD's labels clear 4.5:1 at every stop > draws its readout plate
  //   opaque, so the ratio is not a function of the sky
  //     expected 0.86 to be 1
  const m = source("scenes/HudScene.ts").match(/drawPlate\(\s*this,[\s\S]*?alpha:\s*([\d.]+)/);
  if (m?.[1] === undefined) throw new Error("HudScene no longer fills its plate");
  return Number(m[1]);
}

// ---------------------------------------------------------------------------
// The HUD
// ---------------------------------------------------------------------------

describe("the HUD's labels clear 4.5:1 at every stop", () => {
  it("draws its readout plate opaque, so the ratio is not a function of the sky", () => {
    expect(hudPlateAlpha()).toBe(1);
  });

  it("clears the bar for every accent, in both palettes", () => {
    const rows: TextSample[] = [];
    for (const stop of PALETTE_STOP_IDS) {
      for (const colorblind of [false, true]) {
        const pal = paletteAt(stop, colorblind);
        const surface = compositeOver(pal.plate, hudPlateAlpha(), WORST_CASE_SKY);
        const tag = `${stop}${colorblind ? "-cb" : ""}`;
        rows.push(
          { screen: "hud", id: `hud.wpm@${tag}`, color: pal.accent, plateFill: surface, plateAlpha: 1 },
          { screen: "hud", id: `hud.score@${tag}`, color: pal.accent, plateFill: surface, plateAlpha: 1 },
          { screen: "hud", id: `hud.combo@${tag}`, color: pal.plateText, plateFill: surface, plateAlpha: 1 },
          { screen: "hud", id: `hud.hull@${tag}`, color: pal.plateText, plateFill: surface, plateAlpha: 1 },
        );
      }
    }
    const report = measureTexts(rows);
    expect(
      report.failing.map((r) => `${r.id} ${r.color} on ${r.backdrop} = ${r.ratio}:1`),
    ).toEqual([]);
  });

  it("NEGATIVE CONTROL: at the shipped alpha the warm accents fall under the bar", () => {
    // 0.86 over the brightest sky a stop can produce. Mars' coral lands at
    // 4.55:1 in the best case for that alpha, and the capture measured 3.94.
    const shipped = compositeOver("#0E1116", 0.86, WORST_CASE_SKY);
    expect(contrastRatio(paletteAt("mars", false).accent, shipped)).toBeLessThan(4.6);
    // The label is a 16 px glyph, so most of its pixels are antialiased blends
    // of that pair rather than the pair itself - which is how a nominal 4.55
    // measured 3.94 off the capture. A margin of 0.05 over the bar is not one.
    expect(contrastRatio(paletteAt("mars", false).accent, shipped)).toBeLessThan(
      TEXT_MIN_CONTRAST + 0.1,
    );
  });

  it("does not cost the numerals, which were already at bar", () => {
    // 12-14:1 before, and they may only go up: the plate got darker, not lighter.
    for (const stop of PALETTE_STOP_IDS) {
      const pal = paletteAt(stop, false);
      const surface = compositeOver(pal.plate, hudPlateAlpha(), WORST_CASE_SKY);
      expect(contrastRatio(pal.plateText, surface), stop).toBeGreaterThanOrEqual(12);
    }
  });
});

// ---------------------------------------------------------------------------
// The menu backdrop
// ---------------------------------------------------------------------------

/**
 * The LIGHTEST surface the menu backdrop can put under a label.
 *
 * The gradient bottoms out at the stop's ground colour; on top of that a debris
 * rock may sit, filled from the stop's brightest palette entry, with a lit
 * crown on it. Worst case is therefore both of those composited, at the
 * heaviest alpha `menuDebris` ever emits.
 */
function lightestMenuSurface(stop: (typeof PALETTE_STOP_IDS)[number]): string {
  const pal = paletteAt(stop, false);
  const maxAlpha = Math.max(...menuDebris(1920, 1080).map((r) => r.alpha));
  const ground = pal.colors[5] ?? INK.bg;
  const body = compositeOver(pal.colors[4] ?? INK.panel, maxAlpha, ground);
  // `Backdrop.paintDebris` puts a lit crown on each rock at 0.35 of its alpha.
  return compositeOver(INK.text, maxAlpha * 0.35, body);
}

describe("the menu's bottom-left lines clear 4.5:1", () => {
  it("passes for the hint and for 'remove pilot', at every stop", () => {
    const rows: TextSample[] = PALETTE_STOP_IDS.flatMap((stop) => {
      const surface = lightestMenuSurface(stop);
      return [
        { screen: "menu", id: `ui.hint@${stop}`, color: INK.textDim, plateFill: surface, plateAlpha: 1 },
        { screen: "menu", id: `ui.pick.remove@${stop}`, color: INK.textDim, plateFill: surface, plateAlpha: 1 },
      ];
    });
    const report = measureTexts(rows);
    expect(
      report.failing.map((r) => `${r.id} ${r.color} on ${r.backdrop} = ${r.ratio}:1`),
    ).toEqual([]);
  });

  it("NEGATIVE CONTROL: INK.textFaint cannot carry that line anywhere", () => {
    for (const stop of PALETTE_STOP_IDS) {
      expect(
        contrastRatio(INK.textFaint, lightestMenuSurface(stop)),
        stop,
      ).toBeLessThan(TEXT_MIN_CONTRAST);
    }
  });

  it("keeps the faintest ink out of the picker entirely", () => {
    const code = source("scenes/ProfilePickerScene.ts")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(code, "ProfilePickerScene uses INK.textFaint").not.toContain("INK.textFaint");
  });
});
