/**
 * EVERY INK THE ENDING CARD DRAWS (AC-22.8).
 *
 * The captured ending drew "the map is drawn" in `palette.accent` (#ffb3c7)
 * straight onto Pluto's dawn sky and measured 1.19:1 - the worst number in the
 * whole build - and its seven stop names were `INK.textDim` on the same bare
 * sky. Both were invisible to the rubric because the rubric only ever measured
 * the word plate.
 *
 * So the scene's ink inventory is DECLARED, in `endingLayout.ts`, next to the
 * maths, and this test measures all of it. The scene reads the same constants,
 * so a colour that is not measured here is a colour the scene cannot draw.
 *
 * The last case is a NEGATIVE CONTROL. It measures the pair the screen used to
 * ship and asserts it FAILS, so a green run here is evidence the check can go
 * red rather than evidence that nothing was measured.
 */

import { describe, expect, it } from "vitest";
import {
  TEXT_MIN_CONTRAST,
  contrastRatio,
  measureTexts,
} from "@engine/contrast/index.js";
import { ENDING_INK, endingTextSamples } from "@game/scenes/support/endingLayout";
import { paletteFor, skyStops } from "@game/render/palette";

describe("the ending card's ink", () => {
  const report = measureTexts(endingTextSamples());

  it("measures every piece of text the scene draws, not one of them", () => {
    expect(report.rows.length).toBeGreaterThanOrEqual(4);
    expect(report.screens).toEqual(["ending"]);
    const ids = report.rows.map((r) => r.id);
    expect(ids).toContain("ending.heading");
    expect(ids).toContain("ending.stopName");
    expect(ids).toContain("ending.shadowLine");
    expect(ids).toContain("ending.continue");
  });

  it("clears 4.5:1 on the plate it actually sits on, every row", () => {
    for (const row of report.rows) {
      expect(row.ratio, `${row.id} (${row.color} on ${row.backdrop})`).toBeGreaterThanOrEqual(
        TEXT_MIN_CONTRAST,
      );
    }
    expect(report.failing).toEqual([]);
    expect(report.passes).toBe(true);
  });

  it("never uses an ink the theme says is not readable as words", () => {
    // INK.textFaint (3.4:1) and INK.locked are dim states, not type colours.
    const inks = Object.values(ENDING_INK).map((c) => c.toLowerCase());
    expect(inks).not.toContain("#6a7a8e");
    expect(inks).not.toContain("#3a4656");
  });
});

describe("negative control: the pair that shipped", () => {
  it("fails, so a pass above means something", () => {
    // What the headline used to be: the stop accent, drawn on bare sky.
    const pluto = paletteFor("pluto");
    const bare = contrastRatio(pluto.accent, skyStops(pluto)[0]);
    expect(bare).toBeLessThan(TEXT_MIN_CONTRAST);

    const bright = paletteFor("saturn");
    expect(contrastRatio(bright.accent, skyStops(bright)[0])).toBeLessThan(
      TEXT_MIN_CONTRAST,
    );

    // And the same measurement through the module the scene uses.
    const shipped = measureTexts([
      {
        screen: "ending",
        id: "ending.heading",
        color: pluto.accent,
        plateFill: null,
        plateAlpha: 1,
        behind: skyStops(pluto)[0],
      },
    ]);
    expect(shipped.passes).toBe(false);
  });
});
