import { describe, expect, it } from "vitest";
import {
  TEXT_MIN_CONTRAST,
  WORST_CASE_SKY,
  channels,
  compositeOver,
  contrastRatio,
  hexOf,
  measureText,
  measureTexts,
  relativeLuminance,
  type TextSample,
} from "@engine/contrast/index.js";
import { INK, SKY_PLATE } from "@game/ui/theme.js";
import { PALETTE_STOP_IDS, paletteAt, skyStops } from "@game/render/palette.js";

/**
 * THE NEGATIVE CONTROL FOR THE WIDENED V-22.8.
 *
 * The old check measured one pair of colours - the word on the word plate - and
 * reported 17.4:1 while five screens drew their headline STRAIGHT ONTO THE SKY
 * at 1.19:1 to 1.72:1. A widened check is only worth something if it can be
 * shown to go red on the values that shipped green, so the first block below
 * feeds it the ACTUAL pre-fix colours off the captured screens and asserts it
 * fails, with the measured ratios reproduced to within a tenth.
 */

// ---------------------------------------------------------------------------
// WCAG primitives
// ---------------------------------------------------------------------------

describe("WCAG maths", () => {
  it("parses #rgb and #rrggbb alike", () => {
    expect(channels("#fff")).toEqual([255, 255, 255]);
    expect(channels("#0E1116")).toEqual([14, 17, 22]);
    expect(hexOf([14.4, 17.5, 21.6])).toBe("#0e1216");
  });

  it("rejects anything that is not a hex colour", () => {
    expect(() => channels("rebeccapurple")).toThrow(/not a hex colour/);
    expect(() => channels("#12345")).toThrow(/not a hex colour/);
  });

  it("anchors on the two reference luminances", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 6);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 6);
  });

  it("black on white is 21:1 and is symmetric", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 4);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 4);
    expect(contrastRatio("#7f7f7f", "#7f7f7f")).toBeCloseTo(1, 6);
  });

  it("composites and clamps alpha", () => {
    expect(compositeOver("#000000", 0.5, "#ffffff")).toBe("#808080");
    expect(compositeOver("#000000", 1, "#ffffff")).toBe("#000000");
    expect(compositeOver("#000000", 2, "#ffffff")).toBe("#000000");
    expect(compositeOver("#000000", -1, "#ffffff")).toBe("#ffffff");
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE CONTROL: the values that shipped
// ---------------------------------------------------------------------------

/**
 * SKY-BORNE TEXT EXACTLY AS IT WAS DRAWN, taken from the renderer rather than
 * from a screenshot.
 *
 * Warp, Beacon, Results and Ending all drew their headline in `palette.accent`
 * and their sub-line in `palette.plateText`, with NO PLATE, straight onto
 * `skyStops(palette)`. Those are the two functions the scenes actually call, so
 * these rows are the colour pairs a child was looking at, not an eyeball of a
 * PNG - and if a palette is ever re-tuned this control re-tunes with it.
 *
 * The map's "Locked" label was `INK.locked` on the chart's own night sky.
 */
function shippedSkyText(): TextSample[] {
  const rows: TextSample[] = [];
  for (const colorblind of [false, true]) {
    for (const stop of PALETTE_STOP_IDS) {
      const pal = paletteAt(stop, colorblind);
      const [skyTop] = skyStops(pal);
      const mode = colorblind ? "cb" : "normal";
      // Headline: warp.heading / beacon.headline / results.heading / ending.heading.
      rows.push({
        screen: "headline",
        id: `${stop}.${mode}.accent`,
        color: pal.accent,
        plateFill: null,
        plateAlpha: 0,
        behind: skyTop,
      });
      // Sub-line: "Belt cleared. Type this...", "PLACED", the stop name.
      rows.push({
        screen: "subline",
        id: `${stop}.${mode}.plateText`,
        color: pal.plateText,
        plateFill: null,
        plateAlpha: 0,
        behind: skyTop,
      });
    }
  }
  rows.push({
    screen: "map",
    id: "map.locked",
    color: INK.locked,
    plateFill: null,
    plateAlpha: 0,
    behind: INK.bgDeep,
  });
  return rows;
}

describe("V-22.8 widened - negative control", () => {
  it("FAILS on the colours the scenes actually shipped", () => {
    const report = measureTexts(shippedSkyText());
    expect(report.passes).toBe(false);
    // Not "some of them". The great majority of sky-borne text on the bright
    // stops was under the bar, and a check that only caught the very worst one
    // would have let the rest through again.
    expect(report.failing.length).toBeGreaterThanOrEqual(10);
    expect(report.worst).not.toBeNull();
    expect(report.worst?.ratio).toBeLessThan(2);
  });

  it("names the accent-on-sky headline as a failure on the warm stops", () => {
    const report = measureTexts(shippedSkyText());
    const failedIds = new Set(report.failing.map((r) => r.id));
    for (const stop of ["mars", "jupiter", "saturn"]) {
      expect(failedIds, `${stop} headline should be flagged`).toContain(
        `${stop}.normal.accent`,
      );
    }
    // The map's "Locked" label is the one a finished player reads under a lit
    // beacon, and it was the dimmest ink in the game on the darkest sky.
    expect(failedIds).toContain("map.locked");
    // 2.06:1 against the chart's deepest ink, and the critic measured 1.4:1 off
    // the screenshot because the parallax lifts the sky under the labels. Both
    // are under the bar; the deeper value is the one this file can prove.
    const locked = report.rows.find((r) => r.id === "map.locked");
    expect(locked?.ratio).toBeLessThan(TEXT_MIN_CONTRAST);
  });

  it("would still have passed the OLD, word-plate-only scope", () => {
    // This is the whole defect in one assertion: the pair the rubric measured
    // was fine, so the rubric was green while the screens were not.
    const wordPlate = measureText({
      screen: "flight",
      id: "flight.word",
      color: "#F7FAFF",
      plateFill: "#0E1116",
      plateAlpha: 1,
    });
    expect(wordPlate.ratio).toBeGreaterThan(17);
    expect(wordPlate.passes).toBe(true);
  });

  it("refuses to pass on an empty sample set", () => {
    // A check that reports green because nothing registered is the original
    // bug with a smaller scope.
    expect(measureTexts([]).passes).toBe(false);
    expect(measureTexts([]).worst).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// POSITIVE CONTROL: the plate this change puts under that text
// ---------------------------------------------------------------------------

describe("the sky plate clears 4.5:1 against the brightest sky there is", () => {
  const backdrop = compositeOver(SKY_PLATE.fill, SKY_PLATE.alpha, WORST_CASE_SKY);

  it.each([
    ["text", INK.text],
    ["textDim", INK.textDim],
    ["accent", INK.accent],
    ["accentSoft", INK.accentSoft],
    ["lit", INK.lit],
  ])("%s on the plate clears the bar", (_name, color) => {
    expect(contrastRatio(color, backdrop)).toBeGreaterThanOrEqual(TEXT_MIN_CONTRAST);
  });

  it("textFaint does NOT clear it, which is why headlines may not use it", () => {
    // Kept as an assertion rather than a comment: if somebody lightens
    // `textFaint` into passing, the scenes that were forced off it should be
    // revisited deliberately rather than by accident.
    expect(contrastRatio(INK.textFaint, backdrop)).toBeLessThan(TEXT_MIN_CONTRAST);
  });

  it("locked ink is never used as sky-borne text again", () => {
    expect(contrastRatio(INK.locked, backdrop)).toBeLessThan(TEXT_MIN_CONTRAST);
  });
});
