import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rectsOverlap, type Rect } from "@game/ui/layout";
import { GAME_HEIGHT, GAME_WIDTH } from "@game/sceneKeys";
import {
  COACH,
  LANTERN,
  METER,
  PANEL,
  SHIP_ABOVE,
  SHIP_BELOW,
  SHIP_HALF_W,
  WARP_CARDS,
  lanternBox,
  meterLabelBand,
  lanternPlumeBox,
} from "@game/scenes/support/warpLayout";

/**
 * THE LANTERN IS NOT BEHIND THE WARP CARD.
 *
 * ================== THE DEFECT ==================
 * `warp.png`: the Lantern was drawn at (1660, 470), 300 px tall, so its body
 * filled x 1573..1747, y 296..596. The sentence panel was 1600 px wide from
 * x=160, i.e. x 160..1760, y 286..536 - and it is on the HUD layer while the
 * ship is on `shipFx`, one depth below. The hero asset was therefore covered by
 * a card on the screen the player sees at every stage transition, seven times a
 * playthrough, with only the nose and the fin tips protruding at the right.
 *
 * ================== WHY A GEOMETRY ASSERTION ==================
 * A depth assertion would not have caught it: the depths were always correct
 * and the layout was the bug. A screenshot comparison would have caught it and
 * then gone stale the first time the sky changed. What is actually being
 * claimed is that two rectangles do not intersect, so that is what is measured.
 *
 * Watch it fail: set `LANTERN.x` back to 1660 or `PANEL.w` back to 1600 in
 * `src/game/scenes/support/warpLayout.ts` and the first case goes red.
 *
 *   npx vitest run tests/unit/scenes/warpLayout.test.ts --coverage.enabled=false
 */

/**
 * The ship's real dimensions, READ OUT OF `render/lantern.ts`.
 *
 * Not imported: that module pulls in Phaser, which touches `window` at import
 * time and cannot be loaded in the node environment these unit tests run in.
 * Not transcribed either - a transcription is what this check exists to catch.
 * So the numbers are parsed from the source that draws the ship, and the
 * assertion below compares them against `warpLayout`'s restatement.
 */
const LANTERN_SRC = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/render/lantern.ts"),
  "utf8",
);

function num(pattern: RegExp): number {
  const m = LANTERN_SRC.match(pattern);
  if (m?.[1] === undefined) throw new Error(`lantern.ts no longer declares ${pattern}`);
  return Number(m[1]);
}

const NOZZLE_BOTTOM = num(/const NOZZLE_BOTTOM = (-?\d+(?:\.\d+)?);/);
const PIVOT_Y = num(/const PIVOT = \{ x: -?\d+(?:\.\d+)?, y: (-?\d+(?:\.\d+)?) \};/);
const LENS_LOCAL_Y = num(/const LENS_LOCAL = \{ x: -?\d+(?:\.\d+)?, y: (-?\d+(?:\.\d+)?) \};/);
const LENS_R = num(/const LENS_R = (-?\d+(?:\.\d+)?);/);
const FIN_TIP_X = num(/const FIN_TIP = \{ x: (-?\d+(?:\.\d+)?), y: -?\d+(?:\.\d+)? \};/);

const right = (r: Rect): number => r.x + r.w;
const bottom = (r: Rect): number => r.y + r.h;

const describeRect = (r: Rect): string =>
  `x ${Math.round(r.x)}..${Math.round(right(r))}, y ${Math.round(r.y)}..${Math.round(bottom(r))}`;

describe("the warp break's hero asset is visible", () => {
  it("the Lantern's body does not intersect any card", () => {
    const ship = lanternBox();
    for (const card of WARP_CARDS) {
      expect(
        rectsOverlap(ship, card),
        `ship (${describeRect(ship)}) overlaps card (${describeRect(card)})`,
      ).toBe(false);
    }
  });

  it("NEGATIVE CONTROL: the shipped geometry is red", () => {
    // Exactly what `warp.png` was captured from. If this ever stops overlapping
    // the panel, the numbers below have drifted and the case above is measuring
    // something other than the defect it was written for.
    const shipped = lanternBox({ x: 1660, y: 470, height: 300 });
    const shippedPanel: Rect = { x: 160, y: 286, w: 1600, h: 250 };
    expect(rectsOverlap(shipped, shippedPanel)).toBe(true);
  });

  it("the exhaust plume clears the coach card", () => {
    // The plume is soft and additive, but a solid gold cone cut off by a card
    // edge is still a visible seam, and the coach card is the one it reaches.
    expect(rectsOverlap(lanternPlumeBox(), COACH)).toBe(false);
  });

  it("the whole ship is inside the frame at the narrowest world", () => {
    // 16:9 is the floor (sceneKeys MIN_ASPECT); the world only ever gets wider,
    // so clearing the right edge here clears it everywhere.
    expect(GAME_WIDTH).toBeGreaterThanOrEqual(1920);
    const ship = lanternPlumeBox();
    expect(ship.x).toBeGreaterThan(0);
    expect(right(ship)).toBeLessThan(1920);
    expect(ship.y).toBeGreaterThan(0);
    expect(bottom(ship)).toBeLessThan(GAME_HEIGHT);
  });

  it("the ship's footprint is derived from the ship that is actually drawn", () => {
    // The three ratios in `warpLayout` are restated from `render/lantern.ts`,
    // which this lane may not add exports to. This is what keeps the
    // restatement honest: redraw the ship taller and the numbers stop matching.
    expect(SHIP_ABOVE).toBe(-(PIVOT_Y + LENS_LOCAL_Y - LENS_R));
    expect(SHIP_BELOW).toBe(NOZZLE_BOTTOM);
    expect(SHIP_HALF_W).toBeGreaterThanOrEqual(FIN_TIP_X);
  });
});

describe("the three cards still read as one column", () => {
  it("share a left edge and a width", () => {
    for (const card of [METER, COACH]) {
      expect(card.x).toBe(PANEL.x);
      expect(card.w).toBe(PANEL.w);
    }
  });

  it("fit two lines of sentence above the hint", () => {
    // `WarpScene.layoutLetters` starts at `PANEL.y + 78` and steps 52 + 16 per
    // line; `buildSentencePanel` puts the hint at `PANEL.h - 44`. A composed
    // sentence (D09) can be longer than any shipped one, so the card has to
    // hold a second line without printing it through the hint.
    const SIZE = 52;
    const secondLineBottom = 78 + (SIZE + 16) + Math.round(SIZE * 1.3);
    expect(PANEL.h - 44).toBeGreaterThan(secondLineBottom);
  });

  it("do not overlap each other", () => {
    expect(rectsOverlap(PANEL, METER)).toBe(false);
    expect(rectsOverlap(METER, COACH)).toBe(false);
    expect(bottom(COACH)).toBeLessThan(GAME_HEIGHT);
  });

  it("leave the meter's own labels clear of the sentence card", () => {
    // "warp drive" and the percentage sit 52 px above the track on plates of
    // their own. Growing the card to fit a second line of sentence put its
    // bottom border straight through both of them - visible in the capture as
    // a rule across the word "warp drive" and across the "0%" pill.
    const band = meterLabelBand();
    expect(rectsOverlap(PANEL, band), "the card is printed through the meter labels").toBe(
      false,
    );
    expect(rectsOverlap(COACH, band)).toBe(false);
  });
});
