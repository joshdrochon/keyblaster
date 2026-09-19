import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FOCUS_POP, POP_NAME_PREFIX, focusPopScale, focusPopShift } from "@game/ui/focusPop";
import { SPACE } from "@game/ui/theme";

/**
 * THE TITLE'S THIRD ANSWER TO "WHAT DOES FOCUSED LOOK LIKE" (UR-111).
 *
 * ================== THE DEFECT ==================
 * Three menus, three behaviours, and a child met all of them in six seconds:
 *
 *   ui/controls.ts   grew 1.5% and HELD it            (UR-110 fixed this one)
 *   scenes/lib/kit   did not grow at all; ring alpha only
 *   TitleScene       `scale: { from: 0.985, to: 1 }`
 *
 * The Title's was the strangest of the three. It SHRANK the item a hair and
 * settled it back to exactly the size it already was, so at rest - the state a
 * child actually looks at - a focused item on the first screen of the game was
 * the same size as an unfocused one. Same defect UR-110 reported on the other
 * kit, wearing a different tween config.
 *
 * ================== WHAT THIS FILE CAN AND CANNOT PROVE ==================
 * `TitleScene.ts` extends a Phaser class and pulls the parallax, the textures
 * and the Lantern rig in behind it, so it cannot be driven under vitest the way
 * `kitFocusHold.test.ts` drives the story kit. Two halves instead, and the
 * boundary is stated rather than glossed:
 *
 *   1. THE ARITHMETIC IS REAL AND IS THE SHARED ONE. `focusPopScale` and
 *      `focusPopShift` are the functions the scene calls, exercised here on the
 *      Title's own two box shapes - the primary, whose box starts on its root,
 *      and a quiet row, whose box starts one `plateTop` ABOVE it.
 *   2. THE WIRING IS A SOURCE GUARD, and it guards the specific collision this
 *      change had to solve: `root.x` is owned by the entrance tween AND read
 *      every frame by `drawFocusRing`, so the pop must not be written to it.
 *
 * The pixels are the browser probe recorded with this change.
 */

const source = (): string =>
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/scenes/TitleScene.ts"),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

/** The Title's two shapes, as `ringBox` reports them. */
const PRIMARY = { left: 0, top: 0, w: 560, h: 108 };
const QUIET = { left: 0, top: -14, w: 214, h: 46 };

/** Where the item's box lands once the pop container has settled. */
function drawn(box: typeof PRIMARY, popped: boolean): { x: number; y: number; w: number; h: number } {
  const scale = popped ? focusPopScale(box.w) : 1;
  const shift = focusPopShift(scale, box);
  return {
    x: shift.x + box.left * scale,
    y: shift.y + box.top * scale,
    w: box.w * scale,
    h: box.h * scale,
  };
}

describe("UR-111: the Title holds a focused item grown", () => {
  it("is bigger at rest, which is what `from: 0.985, to: 1` never was", () => {
    for (const [name, box] of [["primary", PRIMARY], ["quiet row", QUIET]] as const) {
      const base = drawn(box, false);
      const grown = drawn(box, true);
      expect(
        grown.w,
        `${name}: a focused item rests at its unfocused size, so growing on ` +
          "focus is a flourish rather than a state",
      ).toBeGreaterThan(base.w);
      expect(grown.h).toBeGreaterThan(base.h);
    }
  });

  it("never shrinks an item on focus", () => {
    // The shipped tween's resting value was 1 and its `from` was 0.985: the
    // item got SMALLER on the way in. Whatever the pop is, it is not that.
    for (const box of [PRIMARY, QUIET]) {
      expect(focusPopScale(box.w)).toBeGreaterThan(1);
    }
  });

  it("grows about the item's own centre, on both of the Title's box shapes", () => {
    // A container scales about its top-left. Held, that puts every pixel of the
    // growth on the right and the bottom - and the Title's column is the one
    // place in the game where three controls are stacked on one left edge
    // (UR-80), so a focused row drifting right is immediately visible.
    for (const [name, box] of [["primary", PRIMARY], ["quiet row", QUIET]] as const) {
      const base = drawn(box, false);
      const grown = drawn(box, true);
      const left = base.x - grown.x;
      const right = grown.x + grown.w - (base.x + base.w);
      const top = base.y - grown.y;
      const bottom = grown.y + grown.h - (base.y + base.h);
      expect(left, `${name}: the swell is not centred horizontally`).toBeCloseTo(right, 9);
      expect(top, `${name}: the swell is not centred vertically`).toBeCloseTo(bottom, 9);
      expect(left).toBeGreaterThan(0);
      expect(top).toBeGreaterThan(0);
    }
  });

  it("never swells across its own focus ring", () => {
    const clearance = SPACE.focusRingOffset - SPACE.focusRingWidth / 2;
    for (const w of [214, 420, 560, 900]) {
      const growthPerSide = (w * focusPopScale(w) - w) / 2;
      expect(growthPerSide).toBeGreaterThan(0);
      expect(
        growthPerSide,
        `a ${w}px item swells ${growthPerSide.toFixed(2)}px past each edge, ` +
          `crossing the ${clearance}px gap to its own focus ring`,
      ).toBeLessThanOrEqual(clearance + 1e-9);
    }
    expect(FOCUS_POP.maxGrowPx).toBe(clearance);
  });
});

describe("UR-111: the Title is on the one shared mechanism", () => {
  it("has no shrink-and-settle tween left in it", () => {
    expect(
      source(),
      "the item still scales from 0.985 to 1, so it shrinks on focus and rests " +
        "at the size every unfocused item is",
    ).not.toMatch(/0\.985/);
  });

  it("takes its numbers from ui/focusPop rather than its own", () => {
    const src = source();
    expect(src).toMatch(/focusPopScale/);
    expect(src).toMatch(/focusPopShift/);
    expect(src).toMatch(/from "@game\/ui\/focusPop"/);
  });

  it("scales the pop container and never the layout root", () => {
    const src = source();
    // THE COLLISION. `root.x` is the entrance tween's target and is read every
    // frame by `drawFocusRing`; a pop written there would overwrite the
    // entrance mid-flight and make the focus ring swell with the item it is a
    // fixed reference for.
    const pop = /this\.tweens\.add\(\{\s*targets: item\.pop,/;
    expect(src, "the focus swell is not on the item's own pop container").toMatch(pop);
    expect(
      src,
      "the entrance tween no longer flies the layout root, so the ring has nothing to track",
    ).toMatch(/targets: item\.root,\s*alpha: 1,\s*x: \{ from: item\.root\.x - 26/);
    expect(
      src,
      "`ringBox` stopped reading the layout root, so the ring now breathes with the control",
    ).toMatch(/return \{ x: item\.root\.x, y: top, w: item\.width, h: item\.height \}/);
  });

  it("names every pop container so one probe reads all three menus", () => {
    expect(source()).toContain("${POP_NAME_PREFIX}${id}");
    expect(POP_NAME_PREFIX).toBe("kb-pop:");
  });

  it("puts the drawing in the pop container and the status line outside it", () => {
    const src = source();
    // The status line lives inside the primary's container for PLACEMENT only.
    // It carries no ring, `height` excludes it, and a line of copy that grew
    // whenever the button above it took focus would be a second thing moving
    // for one focus change.
    expect(src).toMatch(/pop\.add\(plate\)/);
    expect(src).toMatch(/if \(sub\.plate !== null\) root\.add\(sub\.plate\)/);
    expect(src).toMatch(/root\.add\(sub\.text\)/);
  });
});
