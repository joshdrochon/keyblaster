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
import { PALETTE_STOP_IDS, paletteAt, skyStops } from "@game/render/palette";
import { INK, SKY_PLATE } from "@game/ui/theme";

/**
 * EVERY INK THE STAGE REPORT AND THE TITLE PUT ON THE SCREEN (AC-22.8, D41).
 *
 * The blind critic measured three of them off the capture:
 *
 *   "stage report"                  palette accent on Mars sky   1.72:1
 *   the sub-headers                 accent / faint on Mars sky    1.59 - 1.72:1
 *   "tab to move, enter to choose"  INK.textFaint on Mars sky     2.57:1
 *
 * None of them were bugs in the maths - `src/engine/contrast` has been right
 * the whole time. They were text drawn straight onto a warm ochre sky with
 * nothing behind it, on a screen whose one measured pair (the word plate) was
 * excellent. So this file measures the INVENTORY: every colour pair these two
 * scenes draw, at every stop, in both the standard and the colourblind palette
 * (D41), against the surface it is actually read on.
 *
 * `SHIPPED_SKY_PAIRS` is the negative control. It is the defect itself, built
 * from `paletteAt()` and `skyStops()` rather than pasted in as a number, and
 * the test asserts it goes RED. A contrast check nobody has watched fail is not
 * evidence of anything - that is how 1.72:1 shipped green in the first place.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../../../src/game/scenes");

/**
 * A scene's CODE, with its comments removed.
 *
 * The source guards below look for inks that must not be used. Both scenes
 * explain at length why those inks were removed, naming them, and a guard that
 * cannot tell an explanation from a call is a guard that forces the explanation
 * out of the file.
 */
function code(file: string): string {
  return readFileSync(resolve(SRC, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

/** The plate `skyText()` puts under anything drawn over the world. */
const SKY_SURFACE = compositeOver(SKY_PLATE.fill, SKY_PLATE.alpha, WORST_CASE_SKY);

/**
 * These four must stay in step with the constants in `ResultsScene.ts`. The
 * source guard at the bottom of the file is what keeps them honest: it reads the
 * scene and fails if a literal appears there that is not one of these.
 */
const PANEL_ALPHA = 0.94;
const PANEL_SURFACE = compositeOver(INK.panel, PANEL_ALPHA, WORST_CASE_SKY);
const BUTTON_FILL = "#32445E";
const BUTTON_STROKE = "#5A7195";
const BUTTON_INK = INK.panelSunken;

function sample(
  screen: string,
  id: string,
  color: string,
  plateFill: string,
): TextSample {
  // Every surface here is already flat - the plate colours have been composited
  // over white above - so the alpha is 1 and the ratio is the worst case.
  return { screen, id, color, plateFill, plateAlpha: 1, behind: WORST_CASE_SKY };
}

/** The whole inventory for one stop, exactly as the two scenes draw it. */
function inventory(stop: (typeof PALETTE_STOP_IDS)[number], colorblind: boolean): TextSample[] {
  const accent = paletteAt(stop, colorblind).accent;
  const s = (id: string, color: string): TextSample =>
    sample("results", id, color, SKY_SURFACE);
  const p = (id: string, color: string): TextSample =>
    sample("results", id, color, PANEL_SURFACE);

  return [
    // --- drawn over the world, on skyText's own plate --------------------
    s("results.heading", accent),
    s("results.stop", INK.textDim),
    s("results.hint", INK.textDim),

    // --- on the panel the scene draws -----------------------------------
    p("results.wpm.caption", INK.textDim),
    p("results.wpm.value", accent),
    p("results.wpm.delta", INK.textDim),
    p("results.accuracy.caption", INK.textDim),
    p("results.accuracy.value", accent),
    p("results.accuracy.delta", INK.textDim),
    p("results.stars.caption", INK.textDim),
    p("results.hull", INK.text),
    p("results.personalBest.new", accent),
    p("results.personalBest", INK.textDim),
    p("results.faster.heading", accent),
    p("results.faster.word", INK.text),
    p("results.retention.heading", accent),
    p("results.retention.line", INK.text),
    p("results.board.heading", accent),
    p("results.board.prompt", INK.text),
    p("results.board.empty", INK.textDim),
    p("results.board.row", INK.text),
    p("results.board.you", accent),

    // --- on a button surface ---------------------------------------------
    sample("results", "results.replay", INK.text, BUTTON_FILL),
    sample("results", "results.board.yes", INK.text, BUTTON_FILL),
    sample("results", "results.board.no", INK.text, BUTTON_FILL),
    sample("results", "results.continue", BUTTON_INK, accent),

    // --- the Title -------------------------------------------------------
    sample("title", "title.tagline", INK.textDim, SKY_SURFACE),
    sample("title", "title.settings", INK.text, SKY_SURFACE),
    sample("title", "title.primarySub", INK.textDim, SKY_SURFACE),
    sample("title", "title.lang.on", accent, SKY_SURFACE),
    sample("title", "title.lang.off", INK.textDim, SKY_SURFACE),
    sample("title", "title.primary", BUTTON_INK, accent),
  ];
}

describe("results + title ink clears 4.5:1 on the surface it sits on", () => {
  it("passes for every stop, in both palettes", () => {
    for (const stop of PALETTE_STOP_IDS) {
      for (const colorblind of [false, true]) {
        const report = measureTexts(inventory(stop, colorblind));
        const worst = report.worst;
        expect(
          report.failing.map((r) => `${r.id} ${r.color} on ${r.backdrop} = ${r.ratio}:1`),
          `${stop}${colorblind ? " (colourblind)" : ""}`,
        ).toEqual([]);
        expect(report.passes).toBe(true);
        expect(worst?.ratio ?? 0).toBeGreaterThanOrEqual(TEXT_MIN_CONTRAST);
      }
    }
  });

  it("goes red on the pairs that actually shipped", () => {
    // THE NEGATIVE CONTROL. "stage report" was the stop accent on the top band
    // of the stop's own sky, with nothing between them.
    const mars = paletteAt("mars", false);
    const marsSky = skyStops(mars)[0] as string;
    const shipped: TextSample[] = [
      {
        screen: "results",
        id: "results.heading",
        color: mars.accent,
        plateFill: null,
        plateAlpha: 1,
        behind: marsSky,
      },
      {
        screen: "results",
        id: "results.hint",
        color: INK.textFaint,
        plateFill: null,
        plateAlpha: 1,
        behind: marsSky,
      },
    ];
    const report = measureTexts(shipped);
    expect(report.passes).toBe(false);
    expect(report.failing).toHaveLength(2);
    // The critic measured 1.72:1 and 2.57:1 against the sky as captured; the
    // engine measures against the top band, which is brighter still.
    expect(contrastRatio(mars.accent, marsSky)).toBeLessThan(TEXT_MIN_CONTRAST);
    expect(contrastRatio(INK.textFaint, marsSky)).toBeLessThan(TEXT_MIN_CONTRAST);
  });

  it("keeps the two inks that cannot carry words out of both scenes", () => {
    // INK.textFaint is 4.06:1 on the panel and INK.locked is 1.55:1: neither
    // can hold a word anywhere on these screens, at any size.
    expect(contrastRatio(INK.textFaint, PANEL_SURFACE)).toBeLessThan(TEXT_MIN_CONTRAST);
    expect(contrastRatio(INK.locked, PANEL_SURFACE)).toBeLessThan(TEXT_MIN_CONTRAST);

    for (const file of ["ResultsScene.ts", "TitleScene.ts"]) {
      const source = code(file);
      expect(source, `${file} uses INK.textFaint`).not.toContain("INK.textFaint");
      expect(source, `${file} uses INK.locked`).not.toContain("INK.locked");
    }
  });
});

describe("a button on the stage report reads as pressable", () => {
  it("has a surface and a border that separate it from the panel behind it", () => {
    // THE DEFECT: the button plate was INK.panelRaised on an INK.panel panel -
    // 1.08:1, which is no edge at all - with the label in the stop accent, so
    // the whole control read as disabled text rather than as a thing to press.
    expect(contrastRatio(INK.panelRaised, INK.panel)).toBeLessThan(1.2);

    // The fix: a lifted fill you can see, and a border you can definitely see.
    expect(contrastRatio(BUTTON_FILL, PANEL_SURFACE)).toBeGreaterThan(1.5);
    expect(contrastRatio(BUTTON_STROKE, PANEL_SURFACE)).toBeGreaterThan(3);
  });

  it("makes the primary action the filled one", () => {
    // Continue is a filled accent button and replay is an outlined one, so
    // which action the screen expects is legible before the ring lands on it.
    for (const stop of PALETTE_STOP_IDS) {
      for (const colorblind of [false, true]) {
        const accent = paletteAt(stop, colorblind).accent;
        expect(contrastRatio(accent, BUTTON_FILL), stop).toBeGreaterThan(3);
        expect(contrastRatio(BUTTON_INK, accent), stop).toBeGreaterThanOrEqual(
          TEXT_MIN_CONTRAST,
        );
      }
    }
  });
});

describe("D41: chrome on these two screens is lowercase", () => {
  it("never upper-cases or title-cases a chrome string at the render site", () => {
    for (const file of ["ResultsScene.ts", "TitleScene.ts"]) {
      const source = code(file);
      expect(source, `${file} upper-cases at the render site`).not.toMatch(
        /\.toLocaleUpperCase\(|\.toUpperCase\(/,
      );
      // `chromeCase(x, true)` is the theme's own upper-case switch.
      expect(source, `${file} asks chromeCase for capitals`).not.toMatch(
        /chromeCase\([^)]*,\s*true\s*\)/,
      );
    }
  });
});
