import { describe, expect, it } from "vitest";
import {
  MARK,
  RIM,
  boltPoints,
  dotCentres,
  promptSegments,
  type Segment,
} from "@game/ui/plateLayout";
import { paintPlate, paintBolt, paintPromptGlyph, paintStatusDots } from "@game/ui/plate";
import { INK } from "@game/ui/theme";
import { hexToNum } from "@game/render/palette";
import type { Rect } from "@game/ui/layout";

/**
 * UR-70's MARKS, AND THE COLOUR THE CHROME IS (UR-69 rule 1).
 *
 * ================== WHAT IS BEING DEFENDED ==================
 * UR-70 named four things on the warp break that were not drawings of anything
 * in particular: a terminal prompt on the tab, two dots beside the header line,
 * a badge in the card's corner and a lightning bolt on the charge bar. Three of
 * them are CHROME - nothing about them is about warping - so they went onto the
 * shared plate as geometry plus a painter rather than into one of nine bespoke
 * scenes, which is the defect UR-69 reported and the reason UR-70 was blocked
 * on it. This file is what stops them drifting back.
 *
 * Three claims:
 *
 *   1. A MARK IS DRAWN INSIDE THE BOX IT IS HANDED. The same function draws on
 *      a 26 px header chip and on a 1728 px card; a mark that overflows its box
 *      is a mark that collides with whatever the layout put next to it.
 *   2. A BOLT'S EXTREMES ARE THE BOX'S CORNERS. Containment alone would pass a
 *      later edit that quietly shrank the mark inside a reserved square.
 *   3. THE CHROME IS GOLD BY DEFAULT AND STILL A PROP. `corner: "bracket"` and
 *      `rim: true` take `INK.accent` with no colour named at the call site, and
 *      a screen that wants its stop's accent asks for it in one word.
 *
 * ================== WATCH THEM FAIL (rule 4) ==================
 * Every number below was read off a real red run.
 *
 *   `boltPoints` with its left-hand x moved in to 0.08 of the box - a bolt that
 *   does not reach the box the bar reserved for it:
 *
 *     a bolt fills the box it is reserved, corner to corner
 *       expected 21.6 to be 20
 *
 *   `dotCentres` left-packing from the box's left edge instead of centring:
 *
 *     a row of dots is centred in its box, so a third one does not move the
 *     first two
 *       expected [ 100, 118 ] to deeply equal [ 111, 129 ]
 *
 *   `paintPlate`'s bracket stroke back at `INK.line`, i.e. before the gold
 *   default:
 *
 *     a bracketed plate is gold without the call site naming a colour
 *       expected [ 2371648 ] to deeply equal [ 16762967 ]
 *
 *   `rim: true` left unhandled, i.e. the `typeof props.rim === "string"` guard
 *   this replaced:
 *
 *     `rim: true` is the chrome gold, and a colour is still a colour
 *       expected [] to deeply equal [ 16762967 ]
 */

const BOX: Rect = { x: 20, y: 40, w: 20, h: 26 };

const within = (
  points: readonly { readonly x: number; readonly y: number }[],
  box: Rect,
): boolean =>
  points.every(
    (p) => p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h,
  );

describe("UR-70: a mark is drawn inside the box it is handed", () => {
  it("keeps the prompt's three strokes inside the glyph box", () => {
    const box: Rect = { x: 100, y: 200, w: MARK.glyph, h: MARK.glyph };
    const segments = promptSegments(box);
    expect(segments).toHaveLength(3);
    const ends = segments.flatMap((s) => [
      { x: s.x1, y: s.y1 },
      { x: s.x2, y: s.y2 },
    ]);
    expect(within(ends, box)).toBe(true);
  });

  it("draws a prompt and not a greater-than sign with a line near it", () => {
    // The chevron's two arms share their apex, and the bar sits UNDER the
    // chevron rather than beside it. Without both, the mark reads as maths.
    const box: Rect = { x: 0, y: 0, w: 26, h: 26 };
    const segments = promptSegments(box);
    const upper = segments[0] as Segment;
    const lower = segments[1] as Segment;
    const bar = segments[2] as Segment;
    expect({ x: upper.x2, y: upper.y2 }).toEqual({ x: lower.x1, y: lower.y1 });
    expect(bar.y1).toBe(bar.y2);
    expect(bar.y1).toBeGreaterThan(lower.y2);
  });

  it("a row of dots is centred in its box, so a third one does not move the first two", () => {
    const box: Rect = { x: 100, y: 0, w: 40, h: 20 };
    const two = dotCentres(box, 2);
    const three = dotCentres(box, 3);
    expect(two.map((d) => d.x)).toEqual([111, 129]);
    expect(two[0]?.x).toBe(109 + 2);
    // A cluster that grew off its left edge would move the whole header line
    // the day somebody added a state.
    const mid = (list: readonly { readonly x: number }[]): number =>
      ((list[0]?.x ?? 0) + (list[list.length - 1]?.x ?? 0)) / 2;
    expect(mid(two)).toBe(mid(three));
    expect(mid(two)).toBe(box.x + box.w / 2);
    // Every dot on one line.
    expect(new Set(three.map((d) => d.y)).size).toBe(1);
  });

  it("a bolt fills the box it is reserved, corner to corner", () => {
    const points = boltPoints(BOX);
    expect(points).toHaveLength(7);
    expect(within(points, BOX)).toBe(true);
    // CONTAINMENT IS NOT ENOUGH. The layout reserves a square for this mark, so
    // the mark has to use it: these four are what stop a later tweak shrinking
    // the bolt inside a box the bar already gave up.
    expect(Math.min(...points.map((p) => p.x))).toBe(BOX.x);
    expect(Math.max(...points.map((p) => p.x))).toBe(BOX.x + BOX.w);
    expect(Math.min(...points.map((p) => p.y))).toBe(BOX.y);
    expect(Math.max(...points.map((p) => p.y))).toBe(BOX.y + BOX.h);
  });

  it("the bolt is one polygon, so its two halves cannot show a seam", () => {
    // Drawn as two triangles the halves meet on a shared edge that shows as a
    // hairline at every size. Seven points, one ring, no repeats.
    const points = boltPoints(BOX);
    const keys = new Set(points.map((p) => `${p.x},${p.y}`));
    expect(keys.size).toBe(points.length);
  });

  it("scales with the box rather than carrying a second set of numbers", () => {
    const small = boltPoints({ x: 0, y: 0, w: 10, h: 10 });
    const big = boltPoints({ x: 0, y: 0, w: 100, h: 100 });
    for (const [i, p] of small.entries()) {
      expect(big[i]?.x).toBeCloseTo(p.x * 10, 6);
      expect(big[i]?.y).toBeCloseTo(p.y * 10, 6);
    }
  });
});

/**
 * A Graphics stand-in that records the calls a painter makes.
 *
 * The same shape `controlSurface.test.ts` uses: `ui/plate.ts` imports Phaser as
 * a TYPE only, so its painters can be driven in node against a recorder and the
 * COLOUR a plate chooses becomes an assertion rather than something a capture
 * has to show. Which is the point - "the brackets are gold" was wrong for
 * months while every guard was green.
 */
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
    fillRoundedRect() {},
    strokeRoundedRect() {},
    lineBetween() {},
    fillCircle() {},
    fillPoints() {},
  };
  return { strokes, fills, g: g as never };
}

describe("UR-70: the chrome is gold, and it is still a prop", () => {
  const RECT: Rect = { x: 0, y: 0, w: 400, h: 200 };

  it("a bracketed plate is gold without the call site naming a colour", () => {
    // THE REVERSAL. The brackets were the STOP's accent, which is red at Mars,
    // so UR-70's corner hardware read as four faint red slivers. Chrome does
    // not change colour with the planet - that is what makes it chrome.
    const r = recorder();
    paintPlate(r.g, RECT, { corner: "bracket" });
    expect(r.strokes.map((s) => s.color)).toEqual([hexToNum(INK.accent)]);
  });

  it("leaves an ordinary plate's quiet border exactly where it was", () => {
    // The default only applies to `bracket`. A continuous border is the plate's
    // own edge, and every plate already on screen keeps the line ink it had.
    const r = recorder();
    paintPlate(r.g, RECT, {});
    expect(r.strokes.map((s) => s.color)).toEqual([hexToNum(INK.line)]);
  });

  it("still lets a screen dress the brackets in its stop's accent", () => {
    // A DEFAULT AND NOT A RULE. The argument the previous lane made - that a
    // fixed colour pushes a themed value into shared chrome - is right about
    // direction, and this is what keeps the door open.
    const r = recorder();
    paintPlate(r.g, RECT, { corner: "bracket", stroke: "#D95F3B" });
    expect(r.strokes.map((s) => s.color)).toEqual([hexToNum("#D95F3B")]);
  });

  it("`rim: true` is the chrome gold, and a colour is still a colour", () => {
    const gold = recorder();
    paintPlate(gold.g, RECT, { rim: true, strokeWidth: 0 });
    expect(gold.strokes.map((s) => s.color)).toEqual([hexToNum(INK.accent)]);

    const themed = recorder();
    paintPlate(themed.g, RECT, { rim: "#7FC7E8", strokeWidth: 0 });
    expect(themed.strokes.map((s) => s.color)).toEqual([hexToNum("#7FC7E8")]);

    // And `false` still means no rim at all, which is what the warp break now
    // passes: its gold line around the element is the focus ring.
    const none = recorder();
    paintPlate(none.g, RECT, { rim: false, strokeWidth: 0 });
    expect(none.strokes).toHaveLength(0);
  });

  it("the rim is OUTSIDE the plate, which is what makes it read as chrome", () => {
    // A rim drawn on the plate's own border is just a thicker border.
    expect(RIM.gap).toBeGreaterThan(0);
  });

  it("the mark painters take their ink as a prop and default to the gold", () => {
    const glyph = recorder();
    paintPromptGlyph(glyph.g, BOX);
    expect(glyph.strokes[0]?.color).toBe(hexToNum(INK.accent));

    const dots = recorder();
    paintStatusDots(dots.g, BOX, INK.textDim);
    expect(dots.fills.map((f) => f.color)).toEqual([hexToNum(INK.textDim)]);

    const bolt = recorder();
    paintBolt(bolt.g, BOX, INK.panelSunken);
    expect(bolt.fills.map((f) => f.color)).toEqual([hexToNum(INK.panelSunken)]);
  });
});
