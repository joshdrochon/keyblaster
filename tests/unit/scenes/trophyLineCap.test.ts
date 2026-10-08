import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TROPHIES } from "@game/ui/catalog";
import { LANE_STRING_KEYS, createLaneText } from "@game/scenes/support/copy";
import {
  BUTTON_GAP_Y,
  BUTTON_H,
  BUTTON_Y_MAX,
  PANEL_MAX_BOTTOM,
  PANEL_TOP,
} from "@game/scenes/support/resultsLayout";
import { HINT_PAD } from "@game/ui/hintLine";
import { HINT_TOP } from "@game/ui/grid";

/**
 * THE STAGE REPORT'S ONE UNBOUNDED BLOCK (owner, Oct 7).
 *
 * "Trophies Earned" printed every name it had. Twelve wrap to three lines at
 * caption size in the panel's content width - heading 24 + 8 + 3 x 26 = 110 -
 * and that block alone pushed a full report past the buttons. Measured: with
 * the old 64 px buttons a full report overshot by 60 px, so this screen was
 * over-stuffed before the button height ever changed.
 *
 * The line is capped to one now and ends "and N more"; the full set is on the
 * trophies screen, which is what that screen is for.
 *
 *   npx vitest run tests/unit/scenes/trophyLineCap.test.ts --coverage.enabled=false
 */

const RESULTS = join(process.cwd(), "src/game/scenes/ResultsScene.ts");
const results = (): string => readFileSync(RESULTS, "utf8");

describe("the trophy line is capped to one line", () => {
  it("drops names until it fits, measured on the real Text", () => {
    const src = results();
    expect(src).toContain("text.getWrappedText().length > 1");
    // Measured, not estimated from character counts.
    expect(src).toContain("const text = body.obj as Phaser.GameObjects.Text;");
  });

  it("always keeps at least one name, however long that name is", () => {
    expect(results()).toContain("shown >= 1");
  });

  it("says how many it dropped rather than trailing off", () => {
    const t = createLaneText({ lang: "en", shipName: "Lantern", pilotName: "Rin" });
    const line = t.text("results.trophiesMore", { names: "First Light", count: "5" });
    expect(line).toContain("First Light");
    expect(line).toContain("5");
    expect(line).toContain("more");
  });

  it("the shortened form is translated, not built in English in the scene", () => {
    expect(LANE_STRING_KEYS).toContain("results.trophiesMore");
    const es = createLaneText({ lang: "es", shipName: "Lantern", pilotName: "Rin" });
    expect(es.text("results.trophiesMore", { names: "x", count: "2" })).toContain("más");
  });

  it("the uncapped form is still used when nothing was dropped", () => {
    expect(results()).toContain("shown.length === names.length");
  });

  it("there are twelve trophies, which is the case this exists for", () => {
    expect(TROPHIES.length).toBe(12);
  });
});

describe("the button row's floor is derived from the thing it must clear", () => {
  it("clears the keyboard hint's ink, which is all it has to clear", () => {
    // This screen's hint sits BELOW the buttons rather than beside them, so the
    // only thing the row answers to is that line. It was `HINT_TOP -
    // BLOCK_GAP - BUTTON_H`, 40 px higher, which cost a full report 40 px it
    // does not have.
    expect(BUTTON_Y_MAX).toBe(HINT_TOP + HINT_PAD.y - BUTTON_H);
    expect(BUTTON_Y_MAX + BUTTON_H).toBeLessThanOrEqual(HINT_TOP + HINT_PAD.y);
  });

  it("the panel's floor leaves the declared air above the row", () => {
    expect(PANEL_MAX_BOTTOM).toBe(BUTTON_Y_MAX - BUTTON_GAP_Y);
  });

  it("a full report fits inside that floor", () => {
    // The six blocks a very good run carries, at the minimum gap the panel is
    // allowed to tighten to. Each is measured in `resultsTrophies.test.ts`.
    const blocks = [232, 34, 30, 108, 66, 66];
    const PAD = 40;
    const GAP_MIN = 12;
    const content = blocks.reduce((a, b) => a + b, 0) + (blocks.length - 1) * GAP_MIN + PAD;
    expect(PANEL_TOP + content).toBeLessThanOrEqual(PANEL_MAX_BOTTOM);
  });
});
