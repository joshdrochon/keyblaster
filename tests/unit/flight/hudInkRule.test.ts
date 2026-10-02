import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TEXT_MIN_CONTRAST, contrastRatio } from "@engine/contrast/index.js";
import { PALETTE_STOP_IDS, paletteAt } from "@game/render/palette.js";
import { INK } from "@game/ui/theme.js";

/**
 * ONE RULE FOR THE INSTRUMENT PLATES: value in `plateText`, caption in `accent`.
 *
 * The four readouts alternated - wpm white over accent, combo accent over
 * white, score white over accent, Shield's caption white again. Nothing chose
 * that; it is what four separate edits add up to, and on screen it reads as a
 * checkerboard rather than as two instruments. The owner reported it.
 *
 * `HudScene` imports Phaser, so the pairing is read out of the source. The
 * contrast half is real arithmetic over every palette.
 */
const SRC = readFileSync("src/game/scenes/HudScene.ts", "utf8");

/** `this.text(x, y, value, COLOUR, size[, kind])` - the colour argument. */
function inkOf(field: string): string {
  const at = SRC.indexOf(`this.${field} = this.text(`);
  expect(at, `${field} is no longer built by this.text`).toBeGreaterThan(-1);
  const call = SRC.slice(at, SRC.indexOf(");", at));
  const args = call.slice(call.indexOf("this.text(") + "this.text(".length).split(",");
  return (args[3] ?? "").trim();
}

const VALUES = ["wpmValue", "comboValue", "scoreValue"];
const LABELS = ["wpmLabel", "comboLabel", "scoreLabel", "hullLabel"];

describe("the HUD does not alternate its two inks", () => {
  it("every readout's number is plateText", () => {
    for (const f of VALUES) expect(inkOf(f), `${f} breaks the rule`).toBe("plateText");
  });

  it("every readout's caption is accent", () => {
    for (const f of LABELS) expect(inkOf(f), `${f} breaks the rule`).toBe("accent");
  });

  it("holds at every stop: both inks clear 4.5:1 on the plate", () => {
    for (const cb of [false, true]) {
      for (const stop of PALETTE_STOP_IDS) {
        const p = paletteAt(stop, cb);
        expect(contrastRatio(p.plateText, p.plate), `${stop} value`).toBeGreaterThanOrEqual(
          TEXT_MIN_CONTRAST,
        );
        expect(contrastRatio(p.accent, p.plate), `${stop} caption`).toBeGreaterThanOrEqual(
          TEXT_MIN_CONTRAST,
        );
      }
    }
  });

  it("the shield is GOLD at every stop, not the stop's accent", () => {
    // UR-157 made this call for the canister marker: at Mars the stop accent is
    // the same orange as the sky and the rock. The shield and the canister that
    // refills it are now the one colour, on all seven skies.
    const call = SRC.slice(SRC.indexOf("this.buildHullMarks("));
    expect(call.slice(0, call.indexOf(")"))).toMatch(/INK\.accent/);
    for (const cb of [false, true]) {
      for (const stop of PALETTE_STOP_IDS) {
        const p = paletteAt(stop, cb);
        expect(contrastRatio(INK.accent, p.plate), `${stop} shield`).toBeGreaterThanOrEqual(
          TEXT_MIN_CONTRAST,
        );
      }
    }
  });

  it("the place mark is a planet, not a bar that reads as a letter", () => {
    const block = SRC.slice(SRC.indexOf("this.placeMark = this.add.graphics()"));
    const body = block.slice(0, block.indexOf("this.placeMark.setDepth"));
    expect(body, "a 3x16 rule beside 24px type is a lowercase l").not.toMatch(
      /fillRoundedRect/,
    );
    // Lit face then night side, the same two circles the map's discs use.
    expect(body.match(/fillCircle/g)?.length).toBe(2);
  });
});
