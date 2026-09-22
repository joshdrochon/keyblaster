import { describe, expect, it } from "vitest";
import { GAME_HEIGHT } from "@game/sceneKeys";
import { BACK_CORNER_BOTTOM, GUTTER, HINT_TOP } from "@game/ui/grid";
import { rectsOverlap } from "@game/ui/layout";
import {
  NEW_PILOT_ID,
  SHADOW_DRAWN_HEIGHT,
  initialFocusId,
  shadowBox,
  shadowClearTop,
  shadowOrigin,
} from "@game/scenes/support/pickerLayout";

/**
 * THE PROFILE PICKER'S GEOMETRY (UR-112).
 *
 * `ProfilePickerScene.ts` imports Phaser, so the two things the owner reported
 * about this screen - the caret opening on a pilot row, and "Shadow is floating
 * in the middle of space" - were both unassertable from a node test. The scene
 * now asks this module where those things go, and this is where they are
 * measured.
 *
 * `SHADOW_HEIGHT` is `SHADOW_RADIUS * 2.9` = 185.6; the scene divides a wanted
 * drawn height through it, which is the arithmetic `drawShadow` asks for.
 */

const SHADOW_HEIGHT = 64 * 2.9;
const LIST_SCALE = SHADOW_DRAWN_HEIGHT.list / SHADOW_HEIGHT;
const EMPTY_SCALE = SHADOW_DRAWN_HEIGHT.empty / SHADOW_HEIGHT;

describe("which control opens with the caret", () => {
  it("is 'new pilot', whoever last flew and however many pilots there are", () => {
    // The owner's brother took several seconds to find this control. The screen
    // used to open on the pilot who last flew.
    expect(initialFocusId(0, null)).toBe(NEW_PILOT_ID);
    expect(initialFocusId(1, "pilot-a")).toBe(NEW_PILOT_ID);
    expect(initialFocusId(3, "pilot-c")).toBe(NEW_PILOT_ID);
  });
});

describe("Shadow stands in the bottom-right corner, on the product's lines", () => {
  for (const [name, scale] of [
    ["the list variant", LIST_SCALE],
    ["the empty hangar", EMPTY_SCALE],
  ] as const) {
    it(`${name}: his drawn box sits on the right gutter and the foot line`, () => {
      const box = shadowBox(1920, scale);
      // RIGHT EDGE on the right gutter - the same line the heading, the hint
      // and the row column measure to.
      expect(Math.round(box.x + box.w)).toBe(1920 - GUTTER);
      // BOTTOM EDGE on `grid.BACK_CORNER_BOTTOM`, the foot line the hint
      // plate's own bottom edge defines and `grid.backCorner` sits a
      // bottom-right control on.
      expect(Math.round(box.y + box.h)).toBe(BACK_CORNER_BOTTOM);
    });

    it(`${name}: he reflows with the world rather than freezing at 1920`, () => {
      for (const width of [1600, 1920, 2560]) {
        expect(Math.round(shadowBox(width, scale).x + shadowBox(width, scale).w)).toBe(
          width - GUTTER,
        );
      }
    });

    it(`${name}: he is not in the middle of the sky`, () => {
      // THE DEFECT, as a claim. The literals were (1660, 620) on the list
      // variant and (1382, 520) on the empty one - both above the vertical
      // middle of a 1080 world and neither on any named line.
      const at = shadowOrigin(1920, scale);
      expect(at.y).toBeGreaterThan(GAME_HEIGHT / 2);
      expect(at.x).toBeGreaterThan(1920 / 2);
    });

    it(`${name}: he clears the keyboard hint's column`, () => {
      // The hint owns bottom-LEFT (`grid.HINT_CONTRACT`). One corner must not
      // hold two kinds of thing, and these are two corners.
      const hint = { x: GUTTER, y: HINT_TOP, w: 560, h: 44 };
      expect(rectsOverlap(shadowBox(1920, scale), hint)).toBe(false);
    });
  }

  it("leaves the row column room for four rows before he is reached", () => {
    // CONTENT_TOP 216, a 112 px row and a 20 px gap: four rows end at 744.
    // `shadowClearTop` is the line the column must stay above, and it does.
    expect(shadowClearTop(1920, LIST_SCALE)).toBeGreaterThan(216 + 4 * 132);
  });
});
