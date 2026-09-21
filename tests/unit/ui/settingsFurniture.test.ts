import { describe, expect, it } from "vitest";

import {
  boltClearance,
  boltInkBand,
  consoleColumns,
  consoleContentInset,
} from "@game/ui/controlSurfaceLayout";
import { CONTROL_SURFACE } from "@game/ui/controlSurfaceLayout";
import { PAGE_PADDING, contentRight, contentWidth, pageBox, pageInset } from "@game/ui/grid";
import { SETTINGS_CONSOLE } from "@game/ui/layout";
import { SPACE, STEP } from "@game/ui/theme";
import { rivetPositions } from "@game/ui/panel";

/**
 * SHIP CONTROLS' FURNITURE: THE MARGIN AND THE BOLTS (UR-121, UR-122).
 *
 * ================== THE TWO REPORTS ==================
 * The project owner, on this screen, in one sitting:
 *
 *   1. "The left panel is not following the uniform margin. Why isn't there one
 *      page-level padding rather than each item being moved by hand?"
 *   2. "The panel's corner bolts are being overlapped by the setting rows."
 *
 * Both were true, both were measured on the BUILT PREVIEW before anything was
 * changed, and they have the same cause: the screen computed its CONTROLS first
 * and derived the console face from them by subtracting a bezel, so the face
 * landed wherever the arithmetic put it and the rows landed on the face's own
 * furniture.
 *
 * ================== WHAT WAS MEASURED, IN PIXELS ==================
 * Built to a scratch dir, served on a spare port, `page.screenshot()` decoded
 * and scanned at y = 300 / 500 / 700 / 900. Every scanline agreed.
 *
 *   left panel ink     x 69 .. 938      page padding is 96
 *   right panel ink    x 981 .. 1850    content right edge is 1824
 *
 * So the left panel sat 27 px OUTSIDE the margin and the right panel ran 26 px
 * PAST it, in opposite directions, on a screen whose heading was on the line at
 * x=96. Nothing was wrong with either number on its own, which is why it
 * survived: it is the `ui/grid.ts` defect exactly.
 *
 * The bolts, from the same capture. A row plate's clean unfocused fill reads
 * `(19,24,32)`; where a bolt is underneath it reads `(23,29,36)`, because the
 * plate is `PANEL.faceShade` at alpha 0.88 and 12% of the screw shows through.
 * That contamination band was found at x 906..912 and 97..101 on the left panel
 * and 1009..1012 on the right - SIX PIXELS on every long edge, on all four
 * mid-edge and bottom-corner screws of both panels. On the FOCUSED row it is
 * worse and not subtler: the plate fills `PANEL.bay` at alpha 1, which erases
 * the screw outright, and the focus ring's amber (`254,199,87`) was measured
 * running through the bolt's ink at x=88.
 *
 * ================== WHY THIS TEST IS PURE ==================
 * `SettingsScene` extends a Phaser class and cannot be imported under vitest's
 * node environment. So the geometry it draws was moved OUT of it, into
 * `controlSurfaceLayout.consoleColumns`, and this measures the real function
 * the screen calls rather than a model of it - the same split `panel.ts` and
 * `cockpit.ts` already use.
 *
 * ================== WHAT IT REFUSES TO ASSERT ==================
 * Not "the left edge is 96". A test that pins the output is green the day
 * somebody nudges the panel back and adjusts the constant beside it, which is
 * the fix this change is specifically not. It asserts the RELATIONS - the face
 * is on the page box, the row clears the bolt's ink, the ring clears it too -
 * so the only way to make it pass is to keep deriving.
 */

describe("UR-121 the console faces sit on the page padding, not beside it", () => {
  it("declares ONE page padding that the gutter and the page box agree on", () => {
    // The padding is not a new number. It is `GUTTER`, named, so that a screen
    // has something to DERIVE from instead of something to add to.
    expect(PAGE_PADDING).toBe(SPACE.gutter);
    expect(pageInset(0)).toBe(PAGE_PADDING);
    expect(pageBox().x).toBe(PAGE_PADDING);
    expect(pageBox().x + pageBox().w).toBe(contentRight());
  });

  it("`pageInset` answers the question the console could not previously ask", () => {
    // "Where does my CONTENT go so that the furniture N px outside it lands on
    // the page's edge?" A panel drawn `bezel` px outside its stack is exactly
    // this question, and the old code answered it by not asking.
    for (const outset of [0, 14, 26, 48]) {
      expect(pageInset(outset)).toBe(PAGE_PADDING + outset);
    }
  });

  it("the LEFT face's outer edge is the page padding, to the pixel", () => {
    const [left] = consoleColumns(2);
    // WATCHED FAILING. With `SettingsScene`'s old arithmetic restored
    // (`leftX = SPACE.gutter`, face drawn at `leftX - bezel`), this reads:
    //   AssertionError: expected 70 to be 96 // Object.is equality
    // and the pixel probe of the built preview read the ink at 69.
    expect(left?.faceX).toBe(PAGE_PADDING);
  });

  it("the RIGHT face's outer edge is the content right edge, to the pixel", () => {
    const [, right] = consoleColumns(2);
    // WATCHED FAILING, same restore:
    //   AssertionError: expected 1850 to be 1824 // Object.is equality
    // 1850 is what the pixel probe measured, so the guard and the screenshot
    // were failing on the same number rather than on two models of it.
    expect((right?.faceX ?? 0) + (right?.faceW ?? 0)).toBe(contentRight());
  });

  it("neither face leaves the page box at any world width", () => {
    // `GAME_WIDTH` is read at call time (D99: the world widens with the
    // window), so the relation has to hold at more than 1920. A face that
    // tracked a captured width would fly off the box at 2560 - the defect
    // `grid-conformance.spec.ts` was built to catch once already.
    for (const n of [1, 2, 3]) {
      const cols = consoleColumns(n);
      expect(cols[0]?.faceX).toBe(PAGE_PADDING);
      const last = cols[cols.length - 1];
      expect((last?.faceX ?? 0) + (last?.faceW ?? 0)).toBeLessThanOrEqual(contentRight());
      // And the columns together must actually USE the box, or "inside the
      // box" would be satisfied by a panel one pixel wide.
      const used = cols.reduce((sum, c) => sum + c.faceW, 0);
      expect(used).toBeGreaterThan(contentWidth() * 0.9);
    }
  });

  it("NEGATIVE CONTROL: a face laid out the OLD way misses the box, and is seen to", () => {
    // Without this the checks above could be passing because the numbers happen
    // to line up rather than because the derivation is right.
    const oldColW = Math.min(820, (1920 - SPACE.gutter * 3) / 2);
    const oldLeftFaceX = SPACE.gutter - SETTINGS_CONSOLE.bezel;
    const oldRightFaceRight =
      SPACE.gutter * 2 + oldColW + oldColW + SETTINGS_CONSOLE.bezel;
    expect(oldLeftFaceX).toBe(70);
    expect(oldLeftFaceX).toBeLessThan(PAGE_PADDING);
    expect(oldRightFaceRight).toBe(1850);
    expect(oldRightFaceRight).toBeGreaterThan(contentRight());
  });
});

describe("UR-122 a control row never reaches the console's bolts", () => {
  it("the console says how much of its own edge the bolts own", () => {
    // Read off `drawRivet`'s pen, not estimated: the head is `rivetR` and the
    // cast shadow is one pixel bigger.
    expect(boltClearance()).toBe(
      CONTROL_SURFACE.rivetInset + CONTROL_SURFACE.rivetR + CONTROL_SURFACE.rivetRim,
    );
    expect(boltInkBand()).toEqual({ near: 12, far: 32 });
  });

  it("the row's PLATE clears the bolt's ink", () => {
    const [left, right] = consoleColumns(2);
    const band = boltInkBand();
    for (const col of [left, right]) {
      if (col === undefined) throw new Error("no column");
      const boltFar = col.faceX + band.far;
      const boltNear = col.faceX + col.faceW - band.far;
      // WATCHED FAILING. With `consoleContentInset()` back at the bezel (26)
      // and the faces derived from the controls, this run read:
      //   the row plate is drawn over the bolt: expected 96 to be greater
      //   than or equal to 102
      // 102 - 96 is the six pixels the pixel probe found on the screen.
      expect(col.controlX, "the row plate is drawn over the bolt").toBeGreaterThanOrEqual(
        boltFar,
      );
      expect(
        col.controlX + col.colW,
        "the row plate is drawn over the bolt",
      ).toBeLessThanOrEqual(boltNear);
    }
  });

  it("the FOCUS RING clears it too, which the plate alone does not buy", () => {
    // The ring is the thing the pixel probe actually caught running through the
    // screw: it sits `focusRingOffset` outside the plate and is
    // `focusRingWidth` wide, so its outer ink is another 8 px further out.
    // An inset of `boltClearance()` alone would have left the plate clear and
    // the ring still on the bolt, which is the fix that looks right and is not.
    const [left] = consoleColumns(2);
    if (left === undefined) throw new Error("no column");
    const ringOuterInk = left.controlX - SPACE.focusRingOffset - SPACE.focusRingWidth / 2;
    const boltFar = left.faceX + boltInkBand().far;
    // WATCHED FAILING, same restore:
    //   the focus ring is drawn over the bolt: expected 88 to be greater
    //   than 102
    // 88 is exactly where the pixel probe measured the ring's amber
    // (254,199,87) landing on the built preview, so the guard and the
    // screenshot fail on the same number.
    expect(ringOuterInk, "the focus ring is drawn over the bolt").toBeGreaterThan(boltFar);
    // And it clears by the air the inset was derived with, not by luck.
    expect(ringOuterInk - boltFar).toBe(STEP.hair);
  });

  it("the inset is DERIVED from the bolt and the ring, never picked", () => {
    expect(consoleContentInset()).toBe(
      boltClearance() + SPACE.focusRingOffset + SPACE.focusRingWidth / 2 + STEP.hair,
    );
    // It must be bigger than the bezel, which is the number it used to be.
    // That equality was the defect, so the inequality is the guard.
    expect(consoleContentInset()).toBeGreaterThan(SETTINGS_CONSOLE.bezel);
    // A multiple of 4, like every distance in `theme.STEP`.
    expect(consoleContentInset() % 4).toBe(0);
  });

  it("every screw on a real Settings panel is clear of every row", () => {
    // The whole panel, not one edge. `rivetPositions` adds MID-EDGE screws once
    // the face is tall enough (h >= inset * 12), and the shipped panel is ~742
    // px tall - so there are six per face, and the two in the middle are the
    // ones that sit squarely behind a row rather than near a plate's corner
    // radius. The pixel probe found the contamination on exactly those.
    const [left, right] = consoleColumns(2);
    const faceH = 742;
    for (const col of [left, right]) {
      if (col === undefined) throw new Error("no column");
      const rect = {
        x: col.faceX,
        y: SETTINGS_CONSOLE.top - SETTINGS_CONSOLE.bezel,
        w: col.faceW,
        h: faceH,
      };
      const screws = rivetPositions(rect, CONTROL_SURFACE.rivetInset);
      // WATCHED FAILING, same restore:
      //   screw at (92, 212) is under a row: expected 14 to be less than or
      //   equal to 0
      // 14 rather than 6 because this measures the row's INK, ring included.
      expect(screws.length, "the tall panel should carry mid-edge screws").toBe(6);
      const reach = CONTROL_SURFACE.rivetR + CONTROL_SURFACE.rivetRim;
      const rowLeft = col.controlX - SPACE.focusRingOffset - SPACE.focusRingWidth / 2;
      const rowRight =
        col.controlX + col.colW + SPACE.focusRingOffset + SPACE.focusRingWidth / 2;
      for (const screw of screws) {
        // Interval intersection, in px. Positive means the row's ink and the
        // screw's ink share that many pixels of the x axis - which is the
        // number the pixel probe read off the built preview as a
        // `(23,29,36)` contamination band inside a `(19,24,32)` plate.
        const overlap =
          Math.min(screw.x + reach, rowRight) - Math.max(screw.x - reach, rowLeft);
        expect(
          overlap,
          `screw at (${screw.x}, ${screw.y}) is under a row`,
        ).toBeLessThanOrEqual(0);
      }
    }
  });

  it("NEGATIVE CONTROL: the OLD inset puts the row on the bolt by exactly 6px", () => {
    // The number the owner reported, reproduced from the constants, so "no
    // overlap" above cannot mean "nothing was measured".
    const overlap = boltInkBand().far - SETTINGS_CONSOLE.bezel;
    expect(overlap).toBe(6);
    expect(overlap).toBeGreaterThan(0);
  });
});
