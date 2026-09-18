import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GAME_HEIGHT, GAME_WIDTH } from "@game/sceneKeys";
import { SKY_PLATE, SPACE } from "@game/ui/theme";
import {
  CONTENT_TOP,
  GUTTER,
  HEADING_TOP,
  HINT_TOP,
  SUBHEADING_TOP,
  contentRight,
  contentWidth,
  headingText,
  subheadingText,
  twoColumns,
} from "@game/ui/grid";
import { BEACON_LOG } from "@game/ui/layout";
import {
  BOARD_W,
  BOARD_X,
  HINT_Y,
  REPORT_W,
  REPORT_X,
  STAGE_W,
} from "@game/scenes/support/resultsLayout";
import {
  COACH,
  INSTRUMENT,
  METER,
  PANEL,
  instrumentContains,
  lanternBox,
  shipBandTop,
} from "@game/scenes/support/warpLayout";
import { ROW, WINDOW } from "@game/scenes/support/preflightLayout";

/**
 * EVERY PAGE FOLLOWS SUIT.
 *
 * ================== WHAT WAS REPORTED ==================
 * UR-19, from a frozen build: the stage report did not read as aligned, and the
 * requirement was that EVERY page follow the same system. That last clause is
 * the defect, and it is structural rather than cosmetic - every screen positioned itself from its own constants, so the
 * product had three left margins and four heading heights:
 *
 *   96   menu kit, Briefing page, Director map
 *   120  Pre-flight rows, the Ending's card margin
 *   160  Results, Warp, Beacon
 *
 * Walking from the Beacon Log into the stage report moved the heading 64 px
 * sideways and 20 px up. Nothing was wrong on either screen on its own.
 *
 * ================== WHAT THIS FILE HOLDS ==================
 * Every screen's declared geometry against `ui/grid.ts`, plus a source guard
 * that catches the next screen to lay a heading out by hand. The guard is the
 * part that makes this "every page" rather than "the four I remembered".
 *
 * Watch it fail: set `REPORT_X` back to 160, or put a numeric x back on any
 * scene's `skyText` heading.
 *
 *   npx vitest run tests/unit/ui/grid.test.ts --coverage.enabled=false
 */

const SCENES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/scenes");

/** A scene's code with comments stripped, so a guard cannot read an excuse. */
function code(file: string): string {
  return readFileSync(resolve(SCENES, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

const sceneFiles = (): string[] =>
  readdirSync(SCENES).filter((f) => f.endsWith("Scene.ts"));

/**
 * The one screen exempt from the heading grid, with its reason.
 *
 * The Title is a WORDMARK, not a heading: it is centred on the world and sized
 * to it, and the menu the player picks from hangs off the wordmark rather than
 * off a column. An unexplained exemption is how a completeness check stops
 * meaning anything, so it is named here and nowhere else.
 */
const HEADING_EXEMPT = new Set(["TitleScene.ts"]);

describe("the grid is the widest screen's, not a preference", () => {
  it("is the menu kit's gutter", () => {
    expect(GUTTER).toBe(SPACE.gutter);
  });

  it("is the largest gutter the Beacon Log's trophy block can afford", () => {
    // `gutter + 620 + 40` is the trophy block's left edge; three 340 px tiles
    // and two 24 px gaps is 1068 wide. At a 16:9 world (sceneKeys MIN_ASPECT,
    // 1920) the block's right edge has to clear the right gutter.
    const block = 3 * BEACON_LOG.trophies.tileW + 2 * BEACON_LOG.trophies.colGap;
    expect(BEACON_LOG.trophies.left + block).toBeLessThanOrEqual(1920 - GUTTER);
    // ...and 160 does not fit, which is why the story screens moved in.
    expect(160 + 620 + 40 + block).toBeGreaterThan(1920 - 160);
  });

  it("derives its right edge from the live world width", () => {
    expect(contentRight()).toBe(GAME_WIDTH - GUTTER);
    expect(contentWidth()).toBe(GAME_WIDTH - GUTTER * 2);
    expect(HINT_TOP).toBe(GAME_HEIGHT - 76);
    expect(HEADING_TOP).toBeLessThan(SUBHEADING_TOP);
    expect(SUBHEADING_TOP).toBeLessThan(CONTENT_TOP);
  });

  it("offsets plated text so the PLATE lands on the line, not the text", () => {
    // This is the Results heading's defect exactly: the text was at x=160 and
    // the panel under it was at x=160, so the plate started at 138 and the
    // heading read as hanging off the corner.
    expect(headingText().x).toBeGreaterThan(GUTTER);
    expect(headingText().x - GUTTER).toBe(SKY_PLATE.padX);
    expect(headingText().y - HEADING_TOP).toBe(SKY_PLATE.padY);
    expect(subheadingText().y - SUBHEADING_TOP).toBe(SKY_PLATE.padY);
  });

  it("splits a row into columns that end on the right gutter", () => {
    const [a, b] = twoColumns(0.62);
    expect(a.x).toBe(GUTTER);
    expect(b.x).toBe(a.x + a.w + 40);
    expect(b.x + b.w).toBe(contentRight());
  });
});

describe("every screen's column starts and ends on the grid", () => {
  it("Results: both panels, the buttons and the hint", () => {
    expect(REPORT_X).toBe(GUTTER);
    expect(BOARD_X + BOARD_W).toBe(STAGE_W - GUTTER);
    expect(REPORT_X + REPORT_W).toBeLessThan(BOARD_X);
    expect(HINT_Y).toBe(HINT_TOP);
  });

  it("the Warp break: three cards on one left edge, ending clear of the ship", () => {
    for (const card of [PANEL, INSTRUMENT, COACH]) expect(card.x).toBe(GUTTER);
    // UR-62: the charge track is no longer a card of its own on the gutter. It
    // is inset INSIDE the instrument, which is why it is not in the list above.
    expect(instrumentContains(METER)).toBe(true);
    expect(METER.x).toBeGreaterThan(GUTTER);
    // UR-63: what the cards give up is the BOTTOM of the frame, not a bay on
    // the right - the ship a player actually sees stands at the bottom centre,
    // where Flight puts it. The column ends above it.
    expect(COACH.y + COACH.h).toBeLessThan(shipBandTop());
    expect(lanternBox().x).toBeGreaterThan(0);
    expect(lanternBox().x + lanternBox().w).toBeLessThan(1920);
  });

  it("Pre-flight: the system rows, and the window on the right gutter", () => {
    expect(ROW.x).toBe(GUTTER);
    expect(WINDOW.x + WINDOW.w).toBe(1920 - GUTTER);
  });

  it("the Beacon Log's own columns", () => {
    expect(BEACON_LOG.beacons.x).toBe(GUTTER);
    expect(BEACON_LOG.hintTop).toBe(HINT_TOP);
  });
});

describe("no screen lays a heading out by hand", () => {
  it("every scene positions plated text from the grid", () => {
    const offenders: string[] = [];
    for (const file of sceneFiles()) {
      if (HEADING_EXEMPT.has(file)) continue;
      // `skyText(this, 160, 96, ...)` is the defect: a literal coordinate pair
      // that no other screen can agree with.
      // Both call shapes: one line, and the prettier-broken multi-line form.
      for (const m of code(file).matchAll(
        /skyText\(\s*this,\s*(-?\d+)\s*,\s*(-?\d+)\s*,/g,
      )) {
        // (0, 0) is the OPPOSITE of the defect: it is a part the screen's
        // layout module positions afterwards (`ResultsScene.ink`).
        if (m[1] === "0" && m[2] === "0") continue;
        offenders.push(`${file}: skyText at (${m[1]}, ${m[2]})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("NEGATIVE CONTROL: the guard catches the coordinates that shipped", () => {
    const shipped = `skyText(this, 160, 64, this.lane.copy.text("results.heading"), {`;
    const found = [
      ...shipped.matchAll(/skyText\(\s*this,\s*(-?\d+)\s*,\s*(-?\d+)\s*,/g),
    ].map((m) => `${m[1]},${m[2]}`);
    expect(found).toEqual(["160,64"]);
  });

  it("the Title's exemption is the only one, and it is declared", () => {
    expect([...HEADING_EXEMPT]).toEqual(["TitleScene.ts"]);
  });
});
