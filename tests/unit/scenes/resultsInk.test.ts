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
import { ACTION_INK } from "@game/ui/plate";
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
const PANEL_ALPHA = 1;
const PANEL_SURFACE = compositeOver(INK.panel, PANEL_ALPHA, WORST_CASE_SKY);
/**
 * THE BUTTON SURFACES, IMPORTED RATHER THAN RETYPED (UR-112).
 *
 * These were three hexes copied out of `ResultsScene.ts` into this file, which
 * is how a test comes to measure a pair the screen has stopped drawing. They
 * are `ui/plate.ACTION_INK` now, so the numbers here move when the component
 * moves and this file cannot pass green about a colour nobody paints.
 */
/** The Title's primary is still an accent plate with dark ink on it - see the
 * report for UR-112: that screen is the one action button NOT yet on
 * `ACTION_INK`, and this is the pair it draws. */
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

    // --- on a button surface ---------------------------------------------
    // THE STAGE REPORT'S BUTTONS ARE NO LONGER THEMED (UR-112). `continue` was
    // `INK.panelSunken` on the STOP ACCENT - a pair that measured fine as text
    // and made the gold focus ring invisible, because `INK.accent` on the Earth
    // accent is 1.00:1. Both emphases are `ACTION_INK` now and both labels are
    // `ACTION_INK.label`, so there is one pair here instead of two.
    sample("results", "results.replay", ACTION_INK.label, ACTION_INK.secondaryFill),
    sample("results", "results.continue", ACTION_INK.label, ACTION_INK.primaryFill),

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
  it("has a surface you can see against the sky it sits on", () => {
    // THE ORIGINAL DEFECT: the button plate was INK.panelRaised on an INK.panel
    // panel - 1.08:1, which is no edge at all - with the label in the stop
    // accent, so the whole control read as disabled text rather than as a thing
    // to press.
    expect(contrastRatio(INK.panelRaised, INK.panel)).toBeLessThan(1.2);

    // WHAT CHANGED IN UR-112. These buttons are drawn BELOW the panels, on the
    // stop's own sky, so the surface that matters is the sky and not the panel.
    // Both emphases clear it comfortably at the brightest sky in the game,
    // which is what the old lifted blue was buying against the panel.
    expect(contrastRatio(ACTION_INK.primaryFill, WORST_CASE_SKY)).toBeGreaterThan(3);
    expect(contrastRatio(ACTION_INK.secondaryFill, WORST_CASE_SKY)).toBeGreaterThan(3);
  });

  it("lets the FOCUS RING say which action the screen expects", () => {
    // THE REVERSAL (UR-112). This used to assert that `continue` was a filled
    // STOP-ACCENT button - "which action the screen expects is legible before
    // the ring lands on it". It was, and it cost the ring: the owner reported
    // that this screen's buttons "do not have the right yellow outline", and
    // `INK.accent` on the Earth accent is 1.00:1.
    //
    // Emphasis is the ring's job now. The ring opens on the forward action
    // (AC-18.1, `tests/e2e/default-focus.spec.ts`), so it is ALWAYS on one of
    // these two, and what this file has to prove is that it can be seen there.
    for (const stop of PALETTE_STOP_IDS) {
      for (const colorblind of [false, true]) {
        const accent = paletteAt(stop, colorblind).accent;
        // The old treatment, as the negative control: a button wearing the
        // stop accent cannot show a gold ring.
        expect(contrastRatio(INK.accent, accent), `${stop} accent-filled`).toBeLessThan(3);
        // The new one, at both emphases.
        expect(
          contrastRatio(INK.accent, ACTION_INK.primaryFill),
          `${stop} primary`,
        ).toBeGreaterThan(3);
        expect(
          contrastRatio(INK.accent, ACTION_INK.secondaryFill),
          `${stop} secondary`,
        ).toBeGreaterThan(3);
        // The label still reads, which is what this file is for.
        expect(
          contrastRatio(ACTION_INK.label, ACTION_INK.primaryFill),
          stop,
        ).toBeGreaterThanOrEqual(TEXT_MIN_CONTRAST);
      }
    }
  });
});

describe("the stage report's card is OPAQUE", () => {
  /**
   * THE DEFECT, measured off `results.png`.
   *
   * The card body read #1c1b1d (L* 10.0) and inside the moon's footprint it
   * read #1d2024 (L* 11.9): a circle was visible THROUGH a panel that is
   * supposed to be a solid surface. The panel is on the HUD layer and the moon
   * is on `celestial`, six depths below it, so nothing was mis-ordered - the
   * fill simply carried alpha. At 0.94 over the celestial disc, 6% of a
   * near-white body comes through, which is about 2 L* of ghost.
   *
   * "Three per cent of sky comes through, which is the point" was the comment
   * on the constant. It is the point for `SKY_PLATE`, which is a sheet of glass
   * laid over the world behind a line of type. It is not the point for a card
   * the size of a third of the screen: at that size the thing showing through
   * is a shape, and a shape inside a panel is a rendering bug to anyone
   * looking at it.
   *
   * Watch it fail: put `PANEL_ALPHA` back to 0.94 in `ResultsScene.ts`.
   */
  const declared = (): number => {
    const m = readFileSync(resolve(SRC, "ResultsScene.ts"), "utf8").match(
      /const PANEL_ALPHA = ([\d.]+);/,
    );
    if (m?.[1] === undefined) throw new Error("ResultsScene no longer declares PANEL_ALPHA");
    return Number(m[1]);
  };

  it("draws the panel at alpha 1, so no sky reaches the card body", () => {
    expect(declared()).toBe(1);
  });

  it("is what this file measures against", () => {
    // The local copy above is only evidence if it is the scene's own number.
    expect(PANEL_ALPHA).toBe(declared());
  });

  it("composites to the swatch itself over ANY sky", () => {
    // The real claim: the surface under the card's text does not depend on what
    // is behind the card. `WORST_CASE_SKY` is white, which is the brightest a
    // celestial body can be.
    // `compositeOver` returns lower-case hex; the token is upper-case.
    const swatch = INK.panel.toLowerCase();
    expect(compositeOver(INK.panel, PANEL_ALPHA, WORST_CASE_SKY)).toBe(swatch);
    expect(compositeOver(INK.panel, PANEL_ALPHA, "#000000")).toBe(swatch);
    expect(PANEL_SURFACE).toBe(swatch);
  });

  it("NEGATIVE CONTROL: the shipped alpha did let the sky through", () => {
    // 0.94 over white is #1c1f24, which is the ghost the critic measured.
    expect(compositeOver(INK.panel, 0.94, WORST_CASE_SKY)).not.toBe(INK.panel.toLowerCase());
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
