import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GAME_WIDTH } from "@game/sceneKeys";
import { LINE_HEIGHT, SKY_PLATE, SPACE, STEP, TYPE, TYPE_SIZES } from "@game/ui/theme";
import { GUTTER, HINT_CONTRACT, contentRight, contentWidth, headerText } from "@game/ui/grid";
import { rectsOverlap } from "@game/ui/layout";
import { hintInk } from "@game/ui/hintLine";
import { layer } from "@game/render/layers";
import {
  LANTERN_DESIGN_HEIGHT,
  LANTERN_PLUME_LENGTH,
  lanternDesignBox,
} from "@game/render/lanternGeometry";
import {
  CAPTION_GAP,
  CAPTION_LINES,
  CAPTION_LINE_H,
  CAPTION_PAD_Y,
  LAMP_HALO_MAX,
  LOCK_GAP,
  LOCK_SIZE,
  NODE_DEPTH,
  NODE_R,
  NODE_RIM,
  PANEL_STAR_R,
  RING_PAD,
  ROUTE_DEPTH,
  ROUTE_X0,
  ROUTE_Y,
  SHADOW_BAY_GAP,
  SHADOW_R,
  SHIP_EXHAUST,
  SHIP_H,
  SHIP_SCALE,
  SHIP_BOB,
  SHIP_Y,
  STAR_R,
  STAR_ROW_GAP,
  captionBoxDeclared,
  captionPlateBottom,
  captionPlateH,
  captionPlateTop,
  headerBottom,
  lampY,
  lockAdvance,
  nodeBlockBottom,
  nodeRingBox,
  nodeStep,
  nodeX,
  panelBox,
  panelInkLeft,
  panelInkRight,
  PANEL_PAD_Y,
  panelBoardY,
  panelStarsY,
  routeX1,
  shadowBox,
  shipBox,
  shipDiscGap,
  shipDiscGapRange,
  starsCentreForRight,
} from "@game/scenes/support/mapLayout";
import { SCENE_STRING_KEYS } from "@game/scenes/lib/strings";
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
 * ================== AND THE SIX CHANGES OF 2026-09-18 ==================
 * Same rule, same runs. Every number here was printed by a red vitest.
 *
 *   `SHIP_Y` back to 334, the value that hovered too high
 *   -> "the ship hovers 10-15 px over the planet", all seven stops:
 *      `earth: ship bottom 374.2, disc top 454: expected 79.7929411764706 to
 *      be less than or equal to 15`
 *   -> and "the ship's overlap with the beacon lamp is measured, not denied":
 *      `earth: the ship no longer enters the lamp halo at all: expected
 *      -13.792941176470606 to be greater than 0`.
 *
 *   `SHIP_H` 96 -> 160
 *   -> "nothing else about the ship moved": `expected 160 to be 96`, and
 *      "the ship hovers 10-15 px over the planet": `earth: ship bottom 467.0,
 *      disc top 454: expected -13.011764705882342 to be greater than or equal
 *      to 10`.
 *
 *   `CAPTION_LINES` back to 2
 *   -> "the plate is one line of TYPE.label plus the caption's own padding":
 *      `expected 2 to be 1`.
 *
 *   `STAR_ROW_GAP` back to the literal 116 that cleared a two-line caption
 *   -> "the star row follows the caption": `expected 116 to be 105`, and
 *      "the lowest ink on a node came up with it": `expected 24 to be greater
 *      than 24`.
 *
 *   the caption's `padX` back to the literal 16
 *   -> "the padding is the padding the scene actually draws with":
 *      `expected 'import Phaser from "phaser";\nimport …' to contain
 *      'padX: CAPTION_PAD_X'`.
 *
 *   `map.charted` pasted back into the caption
 *   -> "no status word is drawn under a planet's name": `expected 'import
 *      Phaser …' not to contain 'text("map.charted")'`.
 *
 *   `LOCK_SIZE` 20 -> 19, i.e. a size that is not on the scale
 *   -> "its size is on the type scale and its gap is on the spacing scale":
 *      `expected [ 128, 72, 52, 44, 36, 30, 24, 20 ] to include 19`.
 *
 *   `INK.textDim` swapped for `INK.locked` at the `paintLockGlyph` call
 *   -> "the scene draws it, in the ink the locked name is drawn in":
 *      `expected 'import Phaser …' to match /paintLockGlyph\([\s\S]{0,220}
 *      INK\.tex…/`.
 *
 *   the shackle's arc cut short at `Math.PI * 1.6`, i.e. a lock hanging open
 *   -> "D31: it is not-yet, never denied": `expected 'export function
 *      lockGlyphParts(box: R…' to contain 'Math.PI * 2'`.
 *
 *   `NODE_DEPTH` back to 4, the depth the discs shipped at
 *   -> "it clears the light tile too, which is the one that carries the
 *      diamonds": `expected 4 to be greater than 4.99`. This is the gold
 *      diamond on Saturn, as arithmetic.
 *   -> and `ROUTE_DEPTH` back to 3: "the map's ink is above every plane this
 *      screen decorates": `midField draws over the route: expected 3 to be
 *      greater than 3`.
 *
 *   `NODE_DEPTH` at 6.5, i.e. in front of the ship
 *   -> "the ship still passes in FRONT of the planet it hovers over":
 *      `expected 6.5 to be less than 6`.
 *
 *   `nodeRingBox` back to the square around the disc alone
 *   -> "the box holds the disc AND the plate": `expected 560 to be greater
 *      than 617`, and "the air is even on all four sides": `Mars: expected 2
 *      to be 12`, `Neptune: expected -36 to be 12`.
 *
 *   `nodeRingBox`'s x shifted by half the lock's advance without re-centring
 *   -> "it is still centred on the stop it belongs to": `earth: expected 220
 *      to be close to 210, received difference is 10`.
 *
 *   npx vitest run tests/unit/scenes/mapLayout.test.ts --coverage.enabled=false
 */

const ALL_STOPS = STOP_IDS.map((id, i) => [id, i] as const);

describe("UR-53: the Lantern hovers above the current planet", () => {
  it("there is a ship on this screen at all, and it is the shared drawing", () => {
    // The report was not "it is in the wrong place", it was that the map had no
    // player in it. `drawLantern` is the ONE implementation (rule 3); a private
    // copy in a scene is what the one-drawing guard could not see for months.
    //
    // UR-64 moved the call to `lib/livery.drawPlayerLantern`, which DELEGATES
    // to that one implementation with the pilot's hull resolved - it does not
    // draw. Both spellings are accepted here so this case keeps asking its own
    // question ("is there a ship, and is it the shared one") rather than
    // becoming a second, weaker copy of the livery guard in
    // `tests/unit/arch/liveryReaders.test.ts`.
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/scenes/DirectorMapScene.ts"),
      "utf8",
    );
    expect(src).toMatch(/draw(Player)?Lantern\(this,/);
    expect(src).not.toMatch(/private\s+draw(Player)?Lantern\s*\(/);
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

  it.each(ALL_STOPS)("%s: the ship hovers 10-15 px over the planet", (id, i) => {
    // UR-77: the ship hovered too high. `SHIP_Y` 334 put the nozzle at
    // 374.2 with the disc's limb at 454 - 79.8 px of empty sky, which reads as
    // a ship parked under the header rather than as a cursor on a stop.
    //
    // Struck off `shipBox`, not off `SHIP_Y`. `SHIP_Y` is the rig's ORIGIN and
    // the ship hangs 58% of its height above it, so the gap is not visible in
    // the constant and a test that read it would be testing a number rather
    // than a drawing.
    // AND IT IS THE WHOLE BOB THAT HAS TO BE IN RANGE, not the rest position.
    // The rig bobs 2 px either way on a 3 s sine and does so under reduced
    // motion too, so a `SHIP_Y` solved for the rest gap alone is out of range
    // for a third of every cycle - which a still capture cannot show. The
    // browser probe read 15.79 at the top of the bob with the first value.
    const box = shipBox(i);
    const gap = (ROUTE_Y - NODE_R) - (box.y + box.h);
    const band = shipDiscGapRange();
    expect(gap).toBeCloseTo(shipDiscGap(), 6);
    expect(band.min, `${id}: at the bottom of the bob the ship is ${band.min.toFixed(2)} px over`)
      .toBeGreaterThanOrEqual(10);
    expect(band.max, `${id}: at the top of the bob the ship is ${band.max.toFixed(2)} px over`)
      .toBeLessThanOrEqual(15);
    // ...and one y for all seven, so the route reads as a row.
    expect(gap, `${id}`).toBeCloseTo(shipDiscGap(), 6);
  });

  it("the bob this is solved against is the bob the ship is drawn with", () => {
    // `render/lantern.ts` pulls in Phaser and cannot be imported here, so
    // `SHIP_BOB` is a restatement - and a restatement nobody checks is how a
    // clearance quietly stops clearing anything (`SHADOW_R`, above).
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/render/lantern.ts"),
      "utf8",
    );
    const m = /y: \{ from: y - (\d+(?:\.\d+)?), to: y \+ (\d+(?:\.\d+)?) \}/.exec(src);
    expect(m?.[1], "lantern.ts no longer bobs an idle rig this way").toBeDefined();
    expect(Number(m?.[1])).toBe(SHIP_BOB);
    expect(Number(m?.[2])).toBe(SHIP_BOB);
  });

  it("nothing else about the ship moved", () => {
    // The brief was explicit: not its scale, not its bob, not its livery, not
    // its x. Only the two that are geometry can be asserted here; the bob and
    // the livery are `buildLantern`'s options and are read by
    // `tests/unit/arch/liveryReaders.test.ts`.
    expect(SHIP_H).toBe(96);
    expect(SHIP_SCALE).toBe(SHIP_H / LANTERN_DESIGN_HEIGHT);
    expect(SHIP_EXHAUST).toBe(false);
    for (const [, i] of ALL_STOPS) expect(shipBox(i).x + shipBox(i).w / 2).toBeCloseTo(nodeX(i), 6);
  });

  it.each(ALL_STOPS)("%s: the ship's overlap with the beacon lamp is measured, not denied", (id, i) => {
    // ================== THIS CASE USED TO ASSERT THE OPPOSITE ==================
    // It was `ship bottom < lampY() - LAMP_HALO_MAX`, and it was right: at
    // `SHIP_Y` 334 the ship cleared the lamp. A 10-15 px hover cannot. There
    // are 66 px between the halo's top (388) and the disc (454) and the ship is
    // 96 px tall, so the two constraints are arithmetically exclusive, and the
    // hover is the one the owner asked for.
    //
    // gauntlet/escalations.md carries the four options and the lean (tuck the
    // lamp onto the limb next; it is not this lane's to move). What is NOT
    // acceptable is deleting the case, so it measures the cost instead: a later
    // edit that makes the overlap worse fails here rather than passing quietly.
    const box = shipBox(i);
    const haloTop = lampY() - LAMP_HALO_MAX;
    const overlap = box.y + box.h + SHIP_BOB - haloTop;
    expect(overlap, `${id}: the ship no longer enters the lamp halo at all`).toBeGreaterThan(0);
    expect(
      overlap,
      `${id}: the ship reaches ${overlap.toFixed(2)} px into the lamp halo at the bottom ` +
        `of its bob, worse than the 55.21 logged in gauntlet/escalations.md`,
    ).toBeLessThanOrEqual(55.21);
    // The nozzle still stops short of the planet itself, bob included - the
    // ship hovers over the lamp, it does not land on the world.
    expect(box.y + box.h + SHIP_BOB).toBeLessThan(ROUTE_Y - NODE_R);
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
    // `hintInk()`, NOT `hintOrigin(padX, the map header's own padY)`. It used to
    // pass the map header's padding to `skyText` and so drew its ink at
    // (118, 1012) while the menu screens drew theirs at (96, 1004) - the map
    // was the closest to right and still nobody's neighbour. `ui/hintLine`
    // owns both numbers for every screen now and takes no arguments at all.
    const at = hintInk();
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

/**
 * THE CAPTION LOST ITS SECOND LINE, AND EVERYTHING UNDER IT HAD TO FOLLOW.
 *
 * The status word under a planet's name was the reported defect - six copies of
 * "Locked" down a row, and "Beacon Lit" repeating a lit beacon that is drawn
 * over the planet. Taking it off is one line in the scene; the reason it is a
 * geometry change is that FOUR things were measured off a two-line plate: the
 * keep-clear zone, the star row, the lowest ink on a node, and now the focus
 * ring's box.
 */
describe("the caption is one line", () => {
  it("the plate is one line of TYPE.label plus the caption's own padding", () => {
    expect(CAPTION_LINES).toBe(1);
    expect(captionPlateH()).toBe(CAPTION_LINE_H + CAPTION_PAD_Y * 2);
    // NEGATIVE CONTROL: the two-line plate it replaced. Without this the case
    // above is satisfied by any self-consistent pair of numbers.
    expect(CAPTION_LINE_H * 2 + CAPTION_PAD_Y * 2 - captionPlateH()).toBe(CAPTION_LINE_H);
  });

  it("the padding is the padding the scene actually draws with", () => {
    // It used to be `SKY_PLATE.padY` (12) in the layout and 8 at the call site,
    // and the difference was absorbed silently by the zone over-estimating. A
    // ring with even air cannot absorb anything, so the two are one number now.
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/scenes/DirectorMapScene.ts"),
      "utf8",
    );
    expect(src).toContain("padX: CAPTION_PAD_X");
    expect(src).toContain("padY: CAPTION_PAD_Y");
    expect(src).not.toContain("padX: 16,");
  });

  it("no status word is drawn under a planet's name", () => {
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/scenes/DirectorMapScene.ts"),
      "utf8",
    );
    // "Beacon lit" is gone from this screen outright...
    expect(src).not.toContain('text("map.charted")');
    // ...and the two-line join that built the caption is gone with it.
    expect(src).not.toMatch(/\$\{this\.stopName\(stopId\)\}\\n/);
    // `map.locked` still has ONE reader - the board's action line, where "fly
    // here" turns into "locked" - and that is not a caption under a planet.
    expect(src.match(/text\("map\.locked"\)/g) ?? []).toHaveLength(1);
  });

  it("the string stays in the table, with no reader on this screen", () => {
    // Deleting a translated line to prove a screen stopped using it costs the
    // three languages and gains nothing.
    expect(SCENE_STRING_KEYS).toContain("map.charted");
  });

  it("the star row follows the caption instead of sitting where it used to", () => {
    // It was 116, which cleared TWO lines. A literal would have left a hole the
    // height of the line that was removed.
    expect(STAR_ROW_GAP).toBe(
      CAPTION_GAP - CAPTION_PAD_Y + captionPlateH() + SPACE.gap + STAR_R,
    );
    // One unit of air between the plate's bottom edge and the top of a star.
    const starTop = ROUTE_Y + NODE_R + STAR_ROW_GAP - STAR_R;
    expect(starTop - captionPlateBottom()).toBe(SPACE.gap);
    expect(STAR_ROW_GAP).toBeLessThan(116);
  });

  it("the lowest ink on a node came up with it, and still clears the board", () => {
    expect(nodeBlockBottom()).toBe(ROUTE_Y + NODE_R + STAR_ROW_GAP + STAR_R);
    expect(nodeBlockBottom()).toBeLessThan(panelBox().y);
    // It shipped at 676, one caption line lower. The air over the board is what
    // that line was taking, so it has to come back.
    expect(panelBox().y - nodeBlockBottom()).toBeGreaterThan(700 - 676);
  });
});

/**
 * THE LOCK MARK, AND WHY ITS TWO NUMBERS ARE TOKENS.
 *
 * "Small, deliberate beside the label" is not a thing a test can see. What it
 * CAN hold is that neither number was picked beside the label: the size is on
 * the type scale and the gap is on the spacing scale, which is the rule
 * `theme.ts` states and the one `SPACE.rowPadX` cost an hour for breaking.
 */
describe("the lock mark replaces the word", () => {
  it("its size is on the type scale and its gap is on the spacing scale", () => {
    expect(TYPE_SIZES).toContain(LOCK_SIZE);
    expect(Object.values(STEP)).toContain(LOCK_GAP);
    // One step under the word it sits beside, which is the same relationship
    // the header block uses between its heading and its subheading.
    expect(LOCK_SIZE).toBeLessThan(TYPE.label);
    expect(lockAdvance()).toBe(LOCK_SIZE + LOCK_GAP);
  });

  it("the scene draws it, in the ink the locked name is drawn in", () => {
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/scenes/DirectorMapScene.ts"),
      "utf8",
    );
    expect(src).toContain("paintLockGlyph(");
    // ONE token for the mark and the word. A second ink here is how a mark
    // beside a label comes to read as a warning stuck to it.
    expect(src).toMatch(/paintLockGlyph\([\s\S]{0,220}INK\.textDim/);
    expect(src).toContain("color: locked ? INK.textDim : INK.text");
  });

  it("it is vector, drawn in code (D83)", () => {
    const chrome = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/ui/chrome.ts"),
      "utf8",
    );
    expect(chrome).toContain("export function paintLockGlyph");
    expect(chrome).not.toMatch(/paintLockGlyph[\s\S]{0,400}scene\.add\.(image|sprite)/);
  });

  it("D31: it is not-yet, never denied - no cross, no bar, no red", () => {
    const chrome = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/ui/chrome.ts"),
      "utf8",
    );
    const mark = chrome.slice(chrome.indexOf("export function lockGlyphParts"));
    const body = mark.slice(0, mark.indexOf("\n/**", 1));
    expect(body).not.toMatch(/INK\.(bad|danger|error|warn)/);
    // The shackle is a closed half-circle standing on the body. A padlock drawn
    // hanging open would read as "you may go", which is the opposite of true.
    expect(body).toContain("Math.PI * 2");
  });
});

/**
 * UR-105: A GOLD DIAMOND SAT ON SATURN.
 *
 * Fixed at the LAYER. `mapKeepClear` could never have moved it: `parallax.ts`
 * hands `keepClear` to the four DEBRIS planes and not to `nearField`'s light
 * tile - the motes, glints and accent diamonds - which draws a hair under
 * `nearField` at 4.99. The discs drew at 4.
 */
describe("UR-105: the discs draw above the mote plane", () => {
  it("the map's ink is above every plane this screen decorates", () => {
    const decorated = ["sky", "farField", "midField", "nearField"] as const;
    for (const id of decorated) {
      expect(NODE_DEPTH, `${id} draws over the planets`).toBeGreaterThan(layer(id).depth);
      expect(ROUTE_DEPTH, `${id} draws over the route`).toBeGreaterThan(layer(id).depth);
    }
    // NEGATIVE CONTROL: the depth that shipped. Without it this passes for any
    // number above 5 and the fix would look like a preference.
    expect(4).toBeLessThan(layer("nearField").depth);
  });

  it("it clears the light tile too, which is the one that carries the diamonds", () => {
    // `parallax.NEAR_LIGHT_DEPTH` is `layer("nearField").depth - 0.01`, restated
    // here for the same reason `SHADOW_R` is - the file it lives in imports
    // Phaser - and checked against the source so the restatement cannot drift.
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/render/parallax.ts"),
      "utf8",
    );
    const m = /const NEAR_LIGHT_DEPTH = layer\("nearField"\)\.depth - (\d+(?:\.\d+)?);/.exec(src);
    expect(m?.[1], "parallax.ts no longer declares NEAR_LIGHT_DEPTH this way").toBeDefined();
    expect(NODE_DEPTH).toBeGreaterThan(layer("nearField").depth - Number(m?.[1]));
  });

  it("the ship still passes in FRONT of the planet it hovers over", () => {
    expect(NODE_DEPTH).toBeLessThan(layer("shipFx").depth);
    expect(ROUTE_DEPTH).toBeLessThan(NODE_DEPTH);
  });

  it("the scene uses the layer constants, not a literal depth", () => {
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/scenes/DirectorMapScene.ts"),
      "utf8",
    );
    expect(src).toContain("setDepth(NODE_DEPTH)");
    expect(src).toContain("setDepth(ROUTE_DEPTH)");
    expect(src).not.toContain("this.add.graphics().setDepth(4)");
  });
});

/**
 * THE FOCUS RING WRAPS THE DISC AND THE NAME PLATE AS ONE BOX.
 *
 * Ordered after the caption on purpose: the box's height is the caption's
 * bottom edge, so this could not be settled until the caption was one line.
 */
describe("the focus ring's box", () => {
  const CAPTIONS = [
    { name: "Mars, the narrowest name", halfW: 58, bottom: captionPlateBottom() },
    { name: "Neptune, the widest", halfW: 96, bottom: captionPlateBottom() },
    { name: "a caption narrower than the disc", halfW: 20, bottom: captionPlateBottom() },
  ] as const;

  it.each(CAPTIONS.map((c) => [c.name, c] as const))(
    "%s: the box holds the disc AND the plate",
    (_name, cap) => {
      const box = nodeRingBox(3, cap);
      const discEdge = NODE_R + NODE_RIM;
      // The disc, to its dark rim - the drawn edge, not `NODE_R`. The box that
      // shipped was struck off `NODE_R + 14`, so its 14 px of air was really 6.
      expect(box.y).toBeLessThan(ROUTE_Y - discEdge);
      expect(box.x).toBeLessThanOrEqual(nodeX(3) - discEdge);
      expect(box.x + box.w).toBeGreaterThanOrEqual(nodeX(3) + discEdge);
      // ...and the name plate, which the old box stopped 100 px above.
      expect(box.y + box.h).toBeGreaterThan(cap.bottom);
      expect(box.x).toBeLessThanOrEqual(nodeX(3) - cap.halfW);
    },
  );

  it.each(CAPTIONS.map((c) => [c.name, c] as const))(
    "%s: the air is even on all four sides",
    (_name, cap) => {
      const box = nodeRingBox(3, cap);
      const discEdge = NODE_R + NODE_RIM;
      const inkLeft = nodeX(3) - Math.max(discEdge, cap.halfW);
      const inkRight = nodeX(3) + Math.max(discEdge, cap.halfW);
      expect(inkLeft - box.x).toBe(RING_PAD);
      expect(box.x + box.w - inkRight).toBe(RING_PAD);
      expect(ROUTE_Y - discEdge - box.y).toBe(RING_PAD);
      expect(box.y + box.h - cap.bottom).toBe(RING_PAD);
    },
  );

  it("it is still centred on the stop it belongs to, at every stop", () => {
    for (const [id, i] of ALL_STOPS) {
      const box = nodeRingBox(i, captionBoxDeclared());
      expect(box.x + box.w / 2, id).toBeCloseTo(nodeX(i), 6);
    }
  });

  it("NEGATIVE CONTROL: the square that shipped missed the name entirely", () => {
    // `{ y: ROUTE_Y - NODE_R - 14, h: (NODE_R + 14) * 2 }`.
    const shipped = { y: ROUTE_Y - NODE_R - 14, h: (NODE_R + 14) * 2 };
    expect(shipped.y + shipped.h).toBeLessThan(captionPlateTop());
  });

  it("the scene builds it from the layout, and measures the caption", () => {
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/scenes/DirectorMapScene.ts"),
      "utf8",
    );
    expect(src).toContain("nodeRingBox(i, n.caption)");
    expect(src).not.toMatch(/x: n\.x - NODE_R - 14/);
    // The plate's width is MEASURED off the drawn text: "Mars" and "Neptune"
    // are not the same width, and a declared half-width would give one of them
    // even air and the other a margin.
    expect(src).toContain("cap.text.getBounds()");
  });
});

describe("UR-176: the stars sit on the line they belong to", () => {
  it("centres the star row on the personal-best line, not on the board's foot", () => {
    // It was `panelBox().h - 62` - measured from the FOOT, so the stars and the
    // line were two independent numbers. Measured live, 24.6 px apart.
    const lineMid = panelBoardY() + Math.round(TYPE.body * LINE_HEIGHT.latin) / 2;
    expect(panelStarsY()).toBeCloseTo(lineMid, 6);
  });

  it("the scene draws the line where the layout says it does", () => {
    const src = readFileSync("src/game/scenes/DirectorMapScene.ts", "utf8");
    expect(src).toMatch(/label\(this, inkLeft, panelBoardY\(\)/);
    expect(src).not.toMatch(/label\(this, inkLeft, PANEL\.y \+ 146/);
  });
});

describe("UR-177: the board is sized to its rows and pinned at the foot", () => {
  it("leaves the same pad under the last ink as above the first", () => {
    // It was y700/h250 with the lowest ink 70 px above the foot - dead space
    // the owner reported. The top pad is the title row's own offset.
    const box = panelBox();
    const lastInk = panelBoardY() + Math.round(TYPE.body * LINE_HEIGHT.latin);
    expect(box.y + box.h - lastInk).toBe(PANEL_PAD_Y);
    expect(PANEL_PAD_Y).toBe(34);
  });

  it("keeps the foot exactly where it has always been", () => {
    // The card shrinks upward: judges are looking at this screen and its
    // bottom edge is what sits above the hint line.
    expect(panelBox().y + panelBox().h).toBe(950);
  });

  it("the star row is still inside the card it hangs in", () => {
    const box = panelBox();
    expect(panelStarsY() + PANEL_STAR_R).toBeLessThan(box.y + box.h);
  });
});

describe("UR-180: the arrow is the affordance, and the only thing that moves", () => {
  const src = readFileSync("src/game/scenes/DirectorMapScene.ts", "utf8");

  it("draws the arrow as its own object, right of the words", () => {
    // The words hold still so they stay readable; a pulsing label on a screen
    // a child can sit on indefinitely is noise.
    expect(src).toMatch(/this\.panelArrow = label\(/);
    expect(src).toMatch(/panelInkRight\(\) - ARROW_GAP/);
  });

  it("glimmers rather than sliding - light on it, not it moving (UR-180)", () => {
    // Destiny's interactive elements carry light across them and bulge on
    // arrival; nothing loops a position. A repeating slide reads as fidgeting.
    expect(src).toMatch(/alpha: \{ from: 1, to: ARROW_GLIMMER_ALPHA \}/);
    expect(src).not.toMatch(/ARROW_NUDGE_PX/);
  });

  it("bulges once when the selection lands", () => {
    expect(src).toMatch(/scale: \{ from: ACTION_POP_FROM, to: 1 \}/);
    expect(src).toMatch(/this\.popAction\(\);/);
  });

  it("holds still under reduced motion (D41 / AC-19.3)", () => {
    expect(src).toMatch(/if \(!this\.story\.ctx\.reducedMotion\) \{[\s\S]{0,400}this\.tweens\.add\(/);
    expect(src).toMatch(/if \(this\.story\.ctx\.reducedMotion\) return;/);
  });

  it("points at nothing when there is nothing to fly to", () => {
    expect(src).toMatch(/this\.panelArrow\.setVisible\(!locked\)/);
  });
});

describe("UR-181: a locked stop answers instead of ignoring the child", () => {
  const src = readFileSync("src/game/scenes/DirectorMapScene.ts", "utf8");

  it("shakes the action rather than returning in silence", () => {
    // It was a bare `return` - a child could not tell a locked stop from a
    // broken key. D31 forbids reading as failure, not answering at all.
    expect(src).toMatch(/if \(node\.locked\) \{[\s\S]{0,200}this\.shakeAction\(\);/);
  });

  it("eases out rather than snapping, and never under reduced motion", () => {
    expect(src).toMatch(/ease: "Elastic\.Out"/);
    expect(src).toMatch(/shakeAction\(\): void \{\s*\n\s*if \(this\.story\.ctx\.reducedMotion\) return;/);
  });

  it("draws a lock beside the word, like the chips do", () => {
    expect(src).toMatch(/paintLockGlyph\(/);
    expect(src).toMatch(/if \(locked\) \{/);
  });
});

describe("UR-181: the board's lock is on the same scales as the chips'", () => {
  const src = readFileSync("src/game/scenes/DirectorMapScene.ts", "utf8");

  it("sizes one step down from the word, and gaps on the spacing scale", () => {
    // `mapLayout.LOCK_SIZE` states the rule for the caption chips; this is the
    // same relationship against a `TYPE.body` word.
    expect(src).toMatch(/const ACTION_LOCK_SIZE = TYPE\.label;/);
    expect(src).toMatch(/ACTION_LOCK_SIZE \+ STEP\.hair/);
  });

  it("centres the mark on the word rather than on a number beside it", () => {
    expect(src).toMatch(/this\.panelAction\.y \+ this\.panelAction\.height \/ 2/);
  });
});
