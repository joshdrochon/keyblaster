import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  TEXT_MIN_CONTRAST,
  contrastRatio,
  measureTexts,
  relativeLuminance,
  type TextSample,
} from "@engine/contrast/index.js";
import { INK } from "@game/ui/theme";
import { HULL, VOID_LSTAR, hullStops, lightness } from "@game/ui/panel";

/**
 * THE TWO COCKPIT SCREENS: BRIEFING AND PRE-FLIGHT.
 *
 * ================== WHAT THE BLIND CRITIC MEASURED ==================
 *   "mission briefing" eyebrow      3.28:1   INK.textFaint on the page
 *   "through the window"            4.31:1   INK.textFaint on the hull
 *   briefing: 40.9% of pixels at L* < 5      the hull, which was INK.bg
 *
 * The first two were missed by the sky-borne sweep that took 69 strings to a
 * worst case of 5.87:1, because that sweep measures text drawn over the WORLD
 * and these sit on plates the scene drew itself. Same bar, different surface:
 * AC-22.8 is 4.5:1 wherever the text is.
 *
 * The third is not a contrast ratio, it is an AREA. Two fifths of the briefing
 * screen was `INK.bg` (#08111F, L* 4.98) - not dark, black - so the left and
 * right thirds read as holes rather than as the inside of a ship. The hull is
 * now a lit material with a floor above `VOID_LSTAR`, which is what this file
 * asserts: the number is a property of the tokens, so it is checkable here
 * rather than by re-measuring a PNG.
 *
 * Watch it fail: put `INK.textFaint` back on the eyebrow in
 * `BriefingScene.drawPage`, or fill the hull with `INK.bg` again.
 *
 *   npx vitest run tests/unit/scenes/cockpitInk.test.ts --coverage.enabled=false
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/scenes");

/** A scene's code with its comments removed, so a guard cannot read an excuse. */
function code(file: string): string {
  return readFileSync(resolve(SRC, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

/** The briefing page's paper, as `BriefingScene.drawPage` mixes it. */
function mix(a: string, b: string, t: number): string {
  const ch = (h: string): number[] =>
    [0, 2, 4].map((i) => Number.parseInt(h.replace("#", "").slice(i, i + 2), 16));
  const [ar, ag, ab] = ch(a) as [number, number, number];
  const [br, bg, bb] = ch(b) as [number, number, number];
  const to = (x: number, y: number): string =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${to(ar, br)}${to(ag, bg)}${to(ab, bb)}`;
}

const PAPER_MIX = 0.1;
const PAPER = mix(INK.panelRaised, INK.text, PAPER_MIX);

const sample = (screen: string, id: string, color: string, on: string): TextSample => ({
  screen,
  id,
  color,
  plateFill: on,
  plateAlpha: 1,
});

describe("every label on the two cockpit screens clears 4.5:1", () => {
  it("passes on the page, on the hull and on the console shelf", () => {
    const rows: TextSample[] = [
      // --- the briefing page ------------------------------------------------
      sample("briefing", "briefing.heading", INK.textDim, PAPER),
      sample("briefing", "briefing.planetName", INK.text, PAPER),
      sample("briefing", "briefing.sentence", INK.text, PAPER),
      sample("briefing", "briefing.shipReady", INK.textDim, PAPER),
      // --- on the hull ------------------------------------------------------
      ...hullStops().flatMap((stop) => [
        sample("briefing", `briefing.window@${stop}`, INK.textDim, stop),
        sample("briefing", `briefing.hint@${stop}`, INK.textDim, stop),
        sample("preflight", `preflight.hint@${stop}`, INK.textDim, stop),
        sample("preflight", `preflight.row@${stop}`, INK.textDim, INK.panelSunken),
      ]),
    ];
    const report = measureTexts(rows);
    expect(
      report.failing.map((r) => `${r.id} ${r.color} on ${r.backdrop} = ${r.ratio}:1`),
    ).toEqual([]);
    expect(report.passes).toBe(true);
  });

  it("NEGATIVE CONTROL: the inks that shipped are red on the same surfaces", () => {
    // 3.28:1 and 4.31:1, the two numbers the critic reported.
    expect(contrastRatio(INK.textFaint, PAPER)).toBeLessThan(TEXT_MIN_CONTRAST);
    expect(contrastRatio(INK.textFaint, INK.bg)).toBeLessThan(TEXT_MIN_CONTRAST);
  });

  it("keeps the faintest ink out of both scenes entirely", () => {
    // `INK.textFaint` cannot carry a word on any surface either screen has.
    for (const file of ["BriefingScene.ts", "PreflightScene.ts"]) {
      expect(code(file), `${file} uses INK.textFaint`).not.toContain("INK.textFaint");
    }
  });
});

describe("the cockpit hull is a surface, not a hole", () => {
  it("never goes below the void floor", () => {
    for (const stop of hullStops()) {
      expect(lightness(stop), stop).toBeGreaterThan(VOID_LSTAR);
    }
  });

  it("NEGATIVE CONTROL: what shipped was below it", () => {
    // `INK.bg` is L* 4.98 and it filled 40.9% of the briefing frame.
    expect(lightness(INK.bg)).toBeLessThan(VOID_LSTAR);
    expect(lightness(INK.bgDeep)).toBeLessThan(VOID_LSTAR);
  });

  it("is lit from above, like every other surface in the game", () => {
    expect(relativeLuminance(HULL.top)).toBeGreaterThan(relativeLuminance(HULL.bottom));
  });

  it("stays clearly darker than the briefing page it sits behind", () => {
    // The page is paper and the hull is metal; if they converge the page stops
    // reading as a separate object. Four L* is the floor either way.
    expect(lightness(PAPER) - lightness(HULL.top)).toBeGreaterThan(4);
  });

  it("is what the two scenes actually fill the frame with", () => {
    /**
     * UR-77 MOVED THE HULL OUT OF THE SCENES, so this asks the question one
     * level up.
     *
     * It used to grep each scene for `HULL`, which was the right question while
     * each scene owned its own wall - and the fact that BOTH scenes had to be
     * grepped for the same token is the defect UR-77 is about. The hull, the
     * aperture mask and the frame are one component now
     * (`ui/viewportWindow.ts`), so the claim splits in two: the component
     * draws the lit material, and NEITHER SCENE fills the frame itself any
     * more - not with `HULL` and certainly not with `INK.bg`.
     *
     * WATCHED FAILING: put the gradient fill back into `BriefingScene` and the
     * second assertion reports "BriefingScene.ts fills the frame itself".
     */
    const component = readFileSync(
      resolve(SRC, "../ui/viewportWindow.ts"),
      "utf8",
    );
    expect(component, "the window component draws the hull").toContain("HULL.top");
    expect(component).toContain("HULL.bottom");

    for (const file of ["BriefingScene.ts", "PreflightScene.ts"]) {
      const source = code(file);
      expect(source, `${file} does not reach the window component`).toContain(
        "drawCockpitWindow(",
      );
      // The defect, exactly: a full-frame fill in the darkest ink there is.
      expect(source, `${file} still fills the frame with INK.bg`).not.toMatch(
        /fillStyle\(hexToNum\(INK\.bgDeep?\), 1\);\s*\n\s*\w+\.fillRect\(0, 0,/,
      );
      // ...and it does not fill the frame at all, in any ink.
      expect(source, `${file} fills the frame itself`).not.toMatch(
        /\.fillRect\(0,\s*0,\s*GAME_WIDTH/,
      );
    }
  });
});
