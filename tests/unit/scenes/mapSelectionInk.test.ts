import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SPACE } from "@game/ui/theme";

/**
 * THE MAP'S SELECTION READS LIKE THE REST OF THE APP (owner, Oct 7).
 *
 * Two reports, both measured off the running build at 1280x720:
 *   - the gold outline on a selected planet's name plate was struck at
 *     `strokePlateOutline`'s default 2 px, against the 4 px every focus ring in
 *     the game is drawn at. It is not the standard ring - the map hides that
 *     one over a stop disc - so nothing was holding the two together.
 *   - the planet's subtitle ("Launchpad", "The Giant") was `INK.textDim` while
 *     the stage report's and the beacon's titles both wear the stop's accent.
 *
 *   npx vitest run tests/unit/scenes/mapSelectionInk.test.ts --coverage.enabled=false
 */

const MAP = join(process.cwd(), "src/game/scenes/DirectorMapScene.ts");
const map = (): string => readFileSync(MAP, "utf8");

describe("the selected name plate is outlined at the ring's own width", () => {
  it("passes the shared width rather than taking the 2 px default", () => {
    const src = map();
    const call = src.slice(src.indexOf("strokePlateOutline("));
    expect(call.slice(0, 400)).toContain("SPACE.focusRingWidth");
  });

  it("the shared width is what the focus ring is actually painted at", () => {
    const plate = readFileSync(join(process.cwd(), "src/game/ui/plate.ts"), "utf8");
    expect(plate).toContain("g.lineStyle(SPACE.focusRingWidth, hexToNum(accent), 1);");
    expect(SPACE.focusRingWidth).toBe(4);
  });
});

describe("the chapter line wears the stop's own accent", () => {
  it("is repainted per selection, because the panel outlives the stop", () => {
    const src = map();
    expect(src).toContain("this.panelChapter.setColor(");
    expect(src).toContain("paletteAt(stop, this.story.ctx.colorblindPalette).accent");
  });

  it("a locked stop stays dim, so the colour still means 'you have been here'", () => {
    expect(map()).toContain("locked ? INK.textDim :");
  });

  it("matches the two card titles that already do this", () => {
    const results = readFileSync(join(process.cwd(), "src/game/scenes/ResultsScene.ts"), "utf8");
    const beacon = readFileSync(join(process.cwd(), "src/game/scenes/BeaconScene.ts"), "utf8");
    expect(results).toContain("color: this.lane.palette.accent,");
    expect(beacon).toContain("color: pal.accent,");
  });
});
