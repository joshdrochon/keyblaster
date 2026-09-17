import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GAME_WIDTH } from "@game/sceneKeys";
import { SKY_PLATE } from "@game/ui/theme";
import { GUTTER, HINT_CONTRACT, contentRight, contentWidth, headerText } from "@game/ui/grid";
import { rectsOverlap } from "@game/ui/layout";
import { hintOrigin } from "@game/ui/hint";
import { LANTERN_PLUME_LENGTH, lanternDesignBox } from "@game/render/lanternGeometry";
import {
  LAMP_HALO_MAX,
  MAP_HEADER_PAD_Y,
  NODE_R,
  PANEL_STAR_R,
  ROUTE_X0,
  ROUTE_Y,
  SHADOW_BAY_GAP,
  SHADOW_R,
  SHIP_EXHAUST,
  SHIP_H,
  SHIP_Y,
  headerBottom,
  lampY,
  nodeBlockBottom,
  nodeStep,
  nodeX,
  panelBox,
  panelInkLeft,
  panelInkRight,
  panelStarsY,
  routeX1,
  shadowBox,
  shipBox,
  starsCentreForRight,
} from "@game/scenes/support/mapLayout";
import { STOP_IDS } from "@engine/types";

/**
 * THE DIRECTOR MAP, AS GEOMETRY.
 *
 * ================== WHAT WAS REPORTED ==================
 *   UR-53  the ship is to hover above the stop the screen is currently about.
 *          There was no ship on this screen at all.
 *   UR-54  the travel label did not line up with the three stars, and the board
 *          at the foot did not share the heading's left edge.
 *
 * Both are arithmetic, so both are held here rather than by a capture. Every
 * per-stop claim runs ALL SEVEN stops: the acceptance gate for asteroid
 * visibility booted Mars only, and re-run across six stops with the defect
 * reintroduced, Uranus passed it (coding-standards rule 5).
 *
 * ================== WATCH THEM FAIL ==================
 * Every number below was READ OFF A RED RUN. Break it, run it, put it back.
 * Each per-stop case names its stop, and all seven fire, not the first one.
 *
 *   `panelBox().x` back to 200, the value that shipped
 *   -> "the board starts on the same line as the heading above it":
 *      `expected 200 to be 96`, and the ink line with it: `expected 222 to
 *      be 118`.
 *
 *   `PANEL_PAD` back to 40, the inset that shipped
 *   -> "the board's ink column is the header's ink column":
 *      `expected 136 to be 118`.
 *
 *   `starsCentreForRight` back to a flat `right - 118`, i.e. the shipped
 *   `PANEL.x + PANEL.w - 140` against an action at `- 40`
 *   -> "'fly here' and the three stars end on ONE right-hand line":
 *      `the stars do not end where 'fly here' ends: expected 1741.6 to be
 *      close to 1802, received difference is 60.4`.
 *
 *   `SHIP_Y` 334 -> 300
 *   -> "the ship clears the header block", all seven stops:
 *      `earth: ship top 244.2 is inside the header block, which ends at 263`.
 *
 *   `SHIP_H` 96 -> 160
 *   -> same case: `earth: ship top 241.0 is inside the header block, which
 *      ends at 263`.
 *
 *   `ROUTE_Y` back to 430, the value that shipped
 *   -> "the ship clears the beacon lamp", all seven stops:
 *      `earth: ship bottom 374.2 overlaps the lamp halo, which starts at 318`.
 *      This is why the route moved; it is not a taste edit.
 *
 *   `SHIP_EXHAUST` true
 *   -> same case: `earth: ship bottom 408.5 overlaps the lamp halo, which
 *      starts at 388`. The plume is 152 design units and there is no room.
 *
 *   `nodeX` re-derived from a second step (`(routeX1() - 210) / 7`)
 *   -> "the route is symmetric about the frame's centre line":
 *      `expected 1495.7142857142858 to be 1710`.
 *
 *   npx vitest run tests/unit/scenes/mapLayout.test.ts --coverage.enabled=false
 */

const ALL_STOPS = STOP_IDS.map((id, i) => [id, i] as const);

describe("UR-53: the Lantern hovers above the current planet", () => {
  it("there is a ship on this screen at all, and it is the shared drawing", () => {
    // The report was not "it is in the wrong place", it was that the map had no
    // player in it. `drawLantern` is the ONE implementation (rule 3); a private
    // copy in a scene is what the one-drawing guard could not see for months.
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/scenes/DirectorMapScene.ts"),
      "utf8",
    );
    expect(src).toContain("drawLantern(this,");
    expect(src).not.toMatch(/private\s+drawLantern/);
  });

  it.each(ALL_STOPS)("%s: the ship sits directly over its planet", (_id, i) => {
    const box = shipBox(i);
    expect(box.x + box.w / 2).toBeCloseTo(nodeX(i), 6);
  });

  it("the ship holds one y for all seven stops, so the row reads as a row", () => {
    const ys = ALL_STOPS.map(([, i]) => shipBox(i).y);
    expect(new Set(ys).size).toBe(1);
  });

  it.each(ALL_STOPS)("%s: the ship clears the header block", (id, i) => {
    const box = shipBox(i);
    expect(
      box.y,
      `${id}: ship top ${box.y.toFixed(1)} is inside the header block, ` +
        `which ends at ${headerBottom()}`,
    ).toBeGreaterThan(headerBottom());
  });

  it.each(ALL_STOPS)("%s: the ship clears the beacon lamp", (id, i) => {
    const box = shipBox(i);
    const haloTop = lampY() - LAMP_HALO_MAX;
    expect(
      box.y + box.h,
      `${id}: ship bottom ${(box.y + box.h).toFixed(1)} overlaps the lamp halo, ` +
        `which starts at ${haloTop}`,
    ).toBeLessThan(haloTop);
  });

  it("the ship's box is the drawing, plume included", () => {
    // If someone turns the exhaust back on, the box has to grow with it or the
    // clearances above become a claim about a ship the screen is not drawing.
    expect(SHIP_EXHAUST).toBe(false);
    expect(shipBox(0).h).toBe(SHIP_H);
    const withPlume = lanternDesignBox(true);
    const without = lanternDesignBox(false);
    expect(withPlume.bottom - without.bottom).toBe(LANTERN_PLUME_LENGTH);
  });

  it("the ship needs no keep-clear zone, and the reason is its depth", () => {
    // Stated as a test rather than as a comment, because the comment is what
    // stops being true. shipFx is depth 6; the map decorates up to nearField,
    // which is 5.
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/scenes/DirectorMapScene.ts"),
      "utf8",
    );
    expect(src).toContain('layerOf("shipFx")');
    expect(src).toMatch(/decorate: \["sky", "farField", "midField", "nearField"\]/);
  });
});

describe("UR-54: the map is on the one grid", () => {
  it("the board starts on the same line as the heading above it", () => {
    // UR-54's first clause. Plate to plate: the heading's plate corner IS the
    // gutter, and that is where the board's has to start.
    expect(panelBox().x).toBe(GUTTER);
  });

  it("the board stops short of Shadow, and does not run under him", () => {
    // The trap in widening the board: Shadow stands at GAME_WIDTH - 150 on the
    // same band. At the old width (right edge GAME_WIDTH - 200) he cleared it by
    // accident. Taken out to the right gutter, the board runs under him - and
    // under him is where the star row and "fly here" are.
    const board = panelBox();
    const shadow = shadowBox();
    expect(
      rectsOverlap(board, shadow),
      `board (${board.x}..${board.x + board.w}) overlaps Shadow ` +
        `(${shadow.x}..${shadow.x + shadow.w})`,
    ).toBe(false);
    expect(shadow.x - (board.x + board.w)).toBe(SHADOW_BAY_GAP);
    // ...and the bay is the only thing between the board and the gutter.
    expect(board.x + board.w).toBeLessThan(contentRight());
    expect(contentRight() - (board.x + board.w)).toBeLessThan(200);
  });

  it("NEGATIVE CONTROL: the full content column WOULD run under Shadow", () => {
    // Without this, the case above passes for any board narrow enough, and the
    // bay would look like a taste decision rather than a clearance.
    const full = { x: GUTTER, y: panelBox().y, w: contentWidth(), h: panelBox().h };
    expect(rectsOverlap(full, shadowBox())).toBe(true);
  });

  it("the restated Shadow radius is the one shadow.ts draws with", () => {
    // `render/shadow.ts` pulls in Phaser and cannot be imported here, so the
    // radius is restated in `mapLayout`. A restatement nobody checks is how a
    // clearance quietly stops clearing anything.
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/render/shadow.ts"),
      "utf8",
    );
    const m = /export const SHADOW_RADIUS = (\d+(?:\.\d+)?);/.exec(src);
    expect(m?.[1], "shadow.ts no longer declares SHADOW_RADIUS").toBeDefined();
    expect(Number(m?.[1])).toBe(SHADOW_R);
  });

  it("the board's ink column is the header's ink column", () => {
    // ...and ink to ink, which is what makes it read as aligned rather than
    // merely measure as aligned. The board used 40 for its title and 42 for the
    // two lines under it - three left edges inside one card.
    expect(panelInkLeft()).toBe(headerText(0).x);
    expect(panelInkLeft() - panelBox().x).toBe(SKY_PLATE.padX);
  });

  it("'fly here' and the three stars end on ONE right-hand line", () => {
    // `drawStars(cx, r)` draws at cx-gap, cx, cx+gap with gap = r * 2.6, so the
    // cluster's right edge is cx + gap + r.
    const cx = starsCentreForRight(panelInkRight(), PANEL_STAR_R);
    const starsRight = cx + PANEL_STAR_R * 2.6 + PANEL_STAR_R;
    expect(starsRight, "the stars do not end where 'fly here' ends").toBeCloseTo(
      panelInkRight(),
      6,
    );
  });

  it("NEGATIVE CONTROL: the pair that shipped was 42.4px out", () => {
    // Without this the assertion above could be satisfied by any self-consistent
    // pair of numbers. This is the gap the user could see, rebuilt from what the
    // screen actually drew: "fly here" right-aligned at `PANEL.w - 40`, the star
    // cluster centred at `PANEL.w - 140`. Both insets are off the same edge, so
    // the gap does not depend on where the board was.
    const SHIPPED_ACTION_INSET = 40;
    const SHIPPED_STARS_INSET = 140;
    const gap =
      SHIPPED_STARS_INSET - SHIPPED_ACTION_INSET - (PANEL_STAR_R * 2.6 + PANEL_STAR_R);
    expect(gap, "the two were never out by anything").toBeCloseTo(42.4, 6);
    // ...and they are one line now.
    const cx = starsCentreForRight(panelInkRight(), PANEL_STAR_R);
    expect(panelInkRight() - (cx + PANEL_STAR_R * 2.6 + PANEL_STAR_R)).toBeCloseTo(0, 6);
  });

  it("the hint is the shared bottom-left line, not a centred caption", () => {
    const at = hintOrigin(SKY_PLATE.padX, MAP_HEADER_PAD_Y);
    expect(at.x - SKY_PLATE.padX).toBe(HINT_CONTRACT.x);
    expect(at.y - HINT_CONTRACT.top).toBeGreaterThanOrEqual(0);
    expect(at.y - HINT_CONTRACT.top).toBeLessThanOrEqual(HINT_CONTRACT.slack);
    // It was centred on the world at GAME_HEIGHT - 66. That is one of the six
    // different hint x positions the blind critic measured across nine screens.
    expect(at.x).not.toBeCloseTo(GAME_WIDTH / 2, 0);
  });

  it("the route is symmetric about the frame's centre line", () => {
    expect(nodeX(0)).toBe(ROUTE_X0);
    expect(nodeX(STOP_IDS.length - 1)).toBe(routeX1());
    expect(nodeX(0) + nodeX(STOP_IDS.length - 1)).toBeCloseTo(GAME_WIDTH, 6);
    expect(nodeStep()).toBeCloseTo((routeX1() - ROUTE_X0) / (STOP_IDS.length - 1), 6);
  });

  it("nothing hanging off a node reaches the board", () => {
    expect(nodeBlockBottom()).toBeLessThan(panelBox().y);
    expect(ROUTE_Y + NODE_R).toBeLessThan(panelBox().y);
  });

  it("the board sits clear of the hint line", () => {
    expect(panelBox().y + panelBox().h).toBeLessThan(HINT_CONTRACT.top);
  });

  it("the panel star row is inside the board", () => {
    expect(panelStarsY() + PANEL_STAR_R).toBeLessThan(panelBox().y + panelBox().h);
    expect(starsCentreForRight(panelInkRight(), PANEL_STAR_R) - PANEL_STAR_R * 2.6 - PANEL_STAR_R)
      .toBeGreaterThan(panelInkLeft());
  });

  it("the ship's own band is between the header and the route, at every stop", () => {
    for (const [id, i] of ALL_STOPS) {
      const box = shipBox(i);
      expect(box.y, id).toBeGreaterThan(headerBottom());
      expect(box.y + box.h, id).toBeLessThan(ROUTE_Y - NODE_R);
      expect(SHIP_Y, id).toBeGreaterThan(headerBottom());
    }
  });
});
