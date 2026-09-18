import { describe, expect, it, vi } from "vitest";
import type { Rect } from "@game/ui/layout";
import { INK } from "@game/ui/theme";
import { hexToNum } from "@game/render/palette";
import { LOCK_SIZE } from "@game/scenes/support/mapLayout";

/**
 * THE LOCK MARK THAT REPLACED THE WORD "Locked" ON THE DIRECTOR MAP.
 *
 * ================== WHAT WAS REPORTED ==================
 * Six of the map's seven planets carried the word "Locked" on a second caption
 * line. A word repeated down a row carries no information - it is a column of
 * the same word - and it was what made every caption two lines tall, which is
 * what pushed the name away from its disc and left the focus ring wrapping the
 * disc alone.
 *
 * ================== WHAT THIS FILE HOLDS ==================
 * Three claims, and none of them is "it looks deliberate", which is not a thing
 * a test can see:
 *
 *   1. THE MARK FILLS THE BOX IT IS HANDED. The caption reserves `LOCK_SIZE`
 *      beside the name; a mark that merely fits inside that box leaves a hole
 *      the layout already paid for. Containment alone would pass a later edit
 *      that quietly shrank it.
 *   2. IT SCALES WITH THE BOX. One set of fractions, so the same function draws
 *      a 20 px caption mark and a 60 px one and nothing carries a second set of
 *      numbers for the bigger size.
 *   3. THE INK IS A PROP, AND THE MAP PASSES ITS LABEL'S OWN TOKEN. A mark
 *      beside a word in a different ink reads as a warning stuck to the word
 *      rather than as the quiet half of one label (D31: not yet, never denied).
 *
 * ================== WHY PHASER IS STUBBED ==================
 * `chrome.ts` imports Phaser and cannot be loaded under vitest's node
 * environment, so the real painter is driven against a recorder - the same
 * arrangement `focusRingTravel.test.ts` uses and for the same reason. The
 * geometry comes out of `lockGlyphParts`, which takes no Phaser at all.
 *
 * ================== WATCH THEM FAIL (rule 4) ==================
 * Every value below was read off a real red run.
 *
 *   the body inset to `box.w * 0.8` and centred, i.e. a mark that fits rather
 *   than fills
 *   -> "the mark fills the box it is handed, corner to corner":
 *      `expected 22 to be 20`
 *
 *   `r = box.w * 0.27` replaced by a flat `5`
 *   -> "it scales with the box rather than carrying a second set of numbers":
 *      `expected 5 to be close to 25, received difference is 20`
 *
 *   `paintLockGlyph`'s `tint` hard-coded to `INK.accent`
 *   -> "the ink is a prop, so the caller's token is the one that is drawn":
 *      `expected [ 16762967, 16762967 ] to deeply equal [ 11056840, 11056840 ]`
 *
 *   the shackle's centre lifted 4 px off the body's top edge
 *   -> "it is a padlock: a closed shackle STANDING on a body":
 *      `expected 42.6 to be 46.6`, and the fill case with it:
 *      `the mark fills the box it is handed: expected 36 to be 40`
 *
 *   `Math.max(2, ...)` dropped from the stroke
 *   -> "the stroke never vanishes, whatever the box": `expected 0.96 to be 2`
 *
 *   `g.fillStyle(tint, alpha)` back to `g.fillStyle(tint, 1)`
 *   -> "alpha is a prop too": `expected [ 1 ] to deeply equal [ 0.6 ]`
 *
 *   npx vitest run tests/unit/ui/lockGlyph.test.ts --coverage.enabled=false
 */
vi.mock("phaser", () => ({ default: { GameObjects: {}, Tweens: {}, Scene: class {} } }));

const { lockGlyphParts, paintLockGlyph } = await import("@game/ui/chrome");

const BOX: Rect = { x: 20, y: 40, w: LOCK_SIZE, h: LOCK_SIZE };

/** The mark's outermost ink, as four edges. */
function inkBounds(box: Rect): { left: number; right: number; top: number; bottom: number } {
  const p = lockGlyphParts(box);
  return {
    left: Math.min(p.body.x, p.shackle.cx - p.shackle.r - p.shackle.lineW / 2),
    right: Math.max(p.body.x + p.body.w, p.shackle.cx + p.shackle.r + p.shackle.lineW / 2),
    top: Math.min(p.body.y, p.shackle.cy - p.shackle.r - p.shackle.lineW / 2),
    bottom: p.body.y + p.body.h,
  };
}

function recorder(): {
  readonly strokes: { color: number; alpha: number; width: number }[];
  readonly fills: { color: number; alpha: number }[];
  readonly g: never;
} {
  const strokes: { color: number; alpha: number; width: number }[] = [];
  const fills: { color: number; alpha: number }[] = [];
  const g = {
    lineStyle(width: number, color: number, alpha: number) {
      strokes.push({ width, color, alpha });
    },
    fillStyle(color: number, alpha: number) {
      fills.push({ color, alpha });
    },
    beginPath() {},
    arc() {},
    strokePath() {},
    fillRoundedRect() {},
  };
  return { strokes, fills, g: g as never };
}

describe("the lock mark", () => {
  it("the mark fills the box it is handed, corner to corner", () => {
    const ink = inkBounds(BOX);
    expect(ink.left).toBe(BOX.x);
    expect(ink.right).toBe(BOX.x + BOX.w);
    expect(ink.top).toBe(BOX.y);
    expect(ink.bottom).toBe(BOX.y + BOX.h);
  });

  it("it is a padlock: a closed shackle STANDING on a body, not two shapes", () => {
    const p = lockGlyphParts(BOX);
    // The shackle's centre is the body's top edge, so the arc springs out of
    // the body rather than floating over it.
    expect(p.shackle.cy).toBe(p.body.y);
    // The shackle is narrower than the body it stands on. A shackle as wide as
    // the body reads as a bag handle.
    expect(p.shackle.r + p.shackle.lineW / 2).toBeLessThan(p.body.w / 2);
    // The body is the taller half of the mark, which is what a padlock is.
    expect(p.body.h).toBeGreaterThan(p.shackle.r);
  });

  it("it scales with the box rather than carrying a second set of numbers", () => {
    const small = lockGlyphParts({ x: 0, y: 0, w: 20, h: 20 });
    const big = lockGlyphParts({ x: 0, y: 0, w: 100, h: 100 });
    expect(big.shackle.r).toBeCloseTo(small.shackle.r * 5, 6);
    expect(big.body.h).toBeCloseTo(small.body.h * 5, 6);
    expect(big.radius).toBeCloseTo(small.radius * 5, 6);
    // ...and it still fills the box at both sizes.
    for (const box of [{ x: 0, y: 0, w: 20, h: 20 }, { x: 0, y: 0, w: 100, h: 100 }]) {
      const ink = inkBounds(box);
      expect(ink.bottom - ink.top).toBeCloseTo(box.h, 6);
      expect(ink.right - ink.left).toBeCloseTo(box.w, 6);
    }
  });

  it("the stroke never vanishes, whatever the box", () => {
    // A twelfth of the height, floored at 2 - the same floor `drawTrophyMark`
    // uses, and for the same reason: below about 17 px the twelfth is a
    // hairline that disappears against a plate.
    expect(lockGlyphParts(BOX).shackle.lineW).toBeCloseTo(2.4, 6);
    expect(lockGlyphParts({ x: 0, y: 0, w: 60, h: 60 }).shackle.lineW).toBeCloseTo(7.2, 6);
    expect(lockGlyphParts({ x: 0, y: 0, w: 8, h: 8 }).shackle.lineW).toBe(2);
  });

  it("the ink is a prop, so the caller's token is the one that is drawn", () => {
    // The map passes `INK.textDim` - the SAME token the locked name beside it is
    // drawn in - so the mark and the word are one label. A second ink here is
    // how "not yet" comes to read as "denied" (D31).
    const r = recorder();
    paintLockGlyph(r.g, BOX, INK.textDim);
    expect([...r.strokes.map((s) => s.color), ...r.fills.map((f) => f.color)]).toEqual([
      hexToNum(INK.textDim),
      hexToNum(INK.textDim),
    ]);
  });

  it("alpha is a prop too, and full opacity is the default", () => {
    const r = recorder();
    paintLockGlyph(r.g, BOX, INK.textDim);
    expect([...r.strokes.map((s) => s.alpha), ...r.fills.map((f) => f.alpha)]).toEqual([1, 1]);
    const dim = recorder();
    paintLockGlyph(dim.g, BOX, INK.textDim, 0.6);
    expect(dim.fills.map((f) => f.alpha)).toEqual([0.6]);
  });
});
