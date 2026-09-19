import { describe, expect, it } from "vitest";
import { GAME_HEIGHT } from "@game/sceneKeys";
import {
  BEACON_LOG,
  anyOverlap,
  bottomOf,
  fitPlan,
  flowColumn,
  flowGrid,
  needsOwnBackdrop,
  rectsOverlap,
} from "@game/ui/layout";

/**
 * THE BEACON LOG'S LAYOUT MATHS.
 *
 * The screen that produced `gauntlet/evidence/screens/beacon-log.png` laid its
 * trophy tiles out on a FIXED 190 px row pitch (`250 + row * 190`). A tile whose
 * wrapped criterion runs to three lines is 237 px tall, so its last line printed
 * INSIDE the tile below it - "scratch" landed in the "chain 50" card, "the same"
 * in "steady hull", "back" in "last light" - and the bottom row ran off the
 * frame. A fixed pitch is a promise about measured text that nothing measures.
 *
 * So the pitch is computed from the heights that were actually measured, and
 * the three properties that make that correct are asserted here rather than
 * eyeballed in a screenshot: nothing overlaps, nothing leaves the frame, and a
 * tall row pushes the next one down by at least its own height.
 */

/** Heights in the shape the real screen measures: 12 tiles, 3 columns. */
const TWELVE = [124, 118, 237, 118, 124, 124, 190, 150, 164, 124, 118, 150];

describe("rect helpers", () => {
  it("detects overlapping rectangles, and edge-touching is not overlap", () => {
    expect(
      rectsOverlap({ x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 50, w: 100, h: 100 }),
    ).toBe(true);
    expect(
      rectsOverlap({ x: 0, y: 0, w: 100, h: 100 }, { x: 100, y: 0, w: 100, h: 100 }),
    ).toBe(false);
    expect(
      rectsOverlap({ x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 100, w: 100, h: 100 }),
    ).toBe(false);
  });
});

describe("flowGrid", () => {
  const opts = {
    left: 756,
    top: 250,
    columns: 3,
    colWidth: 340,
    colGap: 24,
    rowGap: 22,
  };

  it("keeps three columns, at the caller's pitch", () => {
    const rects = flowGrid(TWELVE, opts);
    expect(rects).toHaveLength(12);
    expect(rects.map((r) => r.x)).toEqual([
      756, 1120, 1484, 756, 1120, 1484, 756, 1120, 1484, 756, 1120, 1484,
    ]);
    expect(rects[0]?.w).toBe(340);
  });

  it("no two tiles overlap, however tall one of them is", () => {
    expect(anyOverlap(flowGrid(TWELVE, opts))).toBe(false);
    // The exact defect in the screenshot: one 3-line tile beside two 1-line
    // tiles. On the old fixed pitch this row's text ran into the next row.
    expect(anyOverlap(flowGrid([118, 237, 118, 118, 118, 118], opts))).toBe(false);
  });

  it("a row whose tallest tile is 240px pushes the next row down by >= 240", () => {
    const rects = flowGrid([120, 240, 120, 120, 120, 120], opts);
    const firstRowTop = rects[0]?.y ?? 0;
    const secondRowTop = rects[3]?.y ?? 0;
    expect(secondRowTop - firstRowTop).toBeGreaterThanOrEqual(240);
  });

  it("every tile in a row shares the row's top edge", () => {
    const rects = flowGrid(TWELVE, opts);
    expect(rects[0]?.y).toBe(rects[1]?.y);
    expect(rects[1]?.y).toBe(rects[2]?.y);
    expect(rects[3]?.y).toBe(rects[5]?.y);
  });
});

describe("flowColumn", () => {
  it("stacks by measured height, never by a fixed pitch", () => {
    const rects = flowColumn([96, 130, 96], {
      left: 96,
      top: 250,
      width: 620,
      rowGap: 10,
    });
    expect(rects.map((r) => r.y)).toEqual([250, 356, 496]);
    expect(anyOverlap(rects)).toBe(false);
  });
});

describe("fitPlan", () => {
  const base = {
    top: 250,
    rowGap: 22,
    minRowGap: 10,
    glyph: 52,
    minGlyph: 34,
    bottom: 1044,
    columns: 3,
  };

  it("leaves a grid that already fits exactly as it is", () => {
    const plan = fitPlan(TWELVE, base);
    expect(plan.fits).toBe(true);
    expect(plan.rowGap).toBe(22);
    expect(plan.glyph).toBe(52);
  });

  it("tightens the row gap before it touches the glyph", () => {
    const tall = TWELVE.map((h) => h + 10);
    const plan = fitPlan(tall, base);
    expect(plan.fits).toBe(true);
    expect(plan.rowGap).toBeLessThan(22);
    expect(plan.rowGap).toBeGreaterThanOrEqual(10);
    expect(plan.glyph).toBe(52);
  });

  it("shrinks the glyph only when the gap is already at its floor", () => {
    const veryTall = TWELVE.map((h) => h + 70);
    const plan = fitPlan(veryTall, base);
    expect(plan.rowGap).toBe(10);
    expect(plan.glyph).toBeLessThan(52);
    expect(plan.glyph).toBeGreaterThanOrEqual(34);
  });

  it("never shrinks the glyph below the floor, and says so", () => {
    const absurd = TWELVE.map((h) => h + 400);
    const plan = fitPlan(absurd, base);
    expect(plan.glyph).toBe(34);
    expect(plan.fits).toBe(false);
    expect(plan.overflow).toBeGreaterThan(0);
  });
});

describe("the beacon log fits the 1920x1080 frame", () => {
  /**
   * A trophy tile's MEASURED height, modelled the way `Tile` builds one with a
   * glyph at its left: padding, then whichever is taller - the glyph, or the
   * name plus the criterion.
   *
   * The per-line heights come from theme.ts: Phaser's text metrics are about
   * 1.05 em of ink, and `uiText` adds `lineHeightEm(lang) - 1` of leading, so a
   * Devanagari line is ~1.2x a Latin one (LINE_HEIGHT). A grid tuned to English
   * alone is a grid that clips in Hindi, which is why both are asserted.
   */
  const tile = (titleLines: number, detailLines: number, lang: "en" | "hi") => {
    const em = lang === "hi" ? 1.56 : 1.3;
    const line = (fs: number): number =>
      Math.round(fs * 1.05) + Math.round(fs * (em - 1));
    const text = titleLines * line(24) + 6 + detailLines * line(20);
    return 28 + Math.max(BEACON_LOG.trophies.glyph, text);
  };

  /**
   * The twelve criteria as they wrap in a 218 px text column, worst case: the
   * long ones ("cross the main belt without a scratch", "clear a belt where two
   * rocks start the same") run to three lines, the short ones to one.
   */
  const DETAIL_LINES = [2, 2, 3, 1, 1, 1, 3, 2, 2, 1, 1, 2];
  const script = (lang: "en" | "hi"): number[] =>
    DETAIL_LINES.map((d) => tile(1, d, lang));
  /** Every tile at its worst at once - far beyond anything the copy can do. */
  const STRESS = DETAIL_LINES.map(() => tile(2, 3, "hi"));

  for (const [name, heights] of [
    ["latin", script("en")],
    ["devanagari", script("hi")],
    ["devanagari, every tile at its worst", STRESS],
  ] as const) {
    it(`the whole 4-row trophy grid is inside 1080 (${name})`, () => {
      const t = BEACON_LOG.trophies;
      const plan = fitPlan(heights, t);
      expect(plan.fits).toBe(true);
      // Re-measured after the shrink: a smaller glyph gives back at most the
      // px it lost, so the plan is checked against the pessimistic case.
      const rects = flowGrid(heights.map((h) => h - (t.glyph - plan.glyph)), {
        left: BEACON_LOG.trophies.left,
        top: t.top,
        columns: 3,
        colWidth: BEACON_LOG.trophies.tileW,
        colGap: BEACON_LOG.trophies.colGap,
        rowGap: plan.rowGap,
      });
      expect(anyOverlap(rects)).toBe(false);
      expect(bottomOf(rects)).toBeLessThanOrEqual(GAME_HEIGHT);
      expect(bottomOf(rects)).toBeLessThanOrEqual(t.bottom);
    });
  }

  it("the trophy grid sits inside the right gutter", () => {
    const t = BEACON_LOG.trophies;
    expect(t.left).toBeGreaterThanOrEqual(
      BEACON_LOG.beacons.x + BEACON_LOG.beacons.w,
    );
    expect(t.left + t.tileW * 3 + t.colGap * 2).toBe(1824);
  });

  it("the beacon column clears the keyboard hint, in both scripts", () => {
    const b = BEACON_LOG.beacons;
    // 96 px is the measured row at the nominal glyph; 118 is the same row with
    // a wrapped Devanagari label, which is the worst case the screen can draw.
    for (const rowHeight of [96, 106, 118]) {
      const heights: number[] = new Array(7).fill(rowHeight);
      const plan = fitPlan(heights, b);
      expect(plan.fits).toBe(true);
      const rects = flowColumn(
        heights.map((h) => h - (b.glyph - plan.glyph)),
        { left: b.x, top: b.top, width: b.w, rowGap: plan.rowGap },
      );
      expect(bottomOf(rects)).toBeLessThanOrEqual(BEACON_LOG.hintTop);
      expect(bottomOf(rects)).toBeLessThanOrEqual(b.bottom);
    }
  });

  /**
   * THE SECTION CAPTIONS HAVE THEIR OWN BAND.
   *
   * WHAT WAS REPORTED. At 2000 px the project owner could not read either
   * section heading: "Beacons · 3 of 7 lit" was drawn behind the Earth row and
   * "Trophies · 5 of 12 earned" behind the First Light card, each visible only
   * as grey text bleeding through a card's top edge.
   *
   * IT IS NOT A DEPTH BUG. Measured on the served build at 2000x1125, the
   * caption's ink ran 206..240.71 and the first control's ring started at 216 -
   * the caption and the column were anchored to the same content line, so the
   * caption was drawn INSIDE the first card's rectangle. A z-order fix would
   * have put readable grey type on top of a card and called it done.
   *
   * So the claim is geometric and made in both scripts: the caption's INK BOX,
   * modelled the same way the trophy tiles' lines are (`line`, above), must not
   * share area with the first control beneath it. Devanagari is the case that
   * binds - its ink box is 1.2x Latin's (theme.ts LINE_HEIGHT) - and a band
   * tuned to English alone is a band that collides in Hindi.
   */
  it("the section captions clear the first control under them, in both scripts", () => {
    /** One line of `TYPE.body` caption ink, the test's own model of it. */
    const captionInk = (lang: "en" | "hi"): number => {
      const em = lang === "hi" ? 1.56 : 1.3;
      return Math.round(30 * 1.05) + Math.round(30 * (em - 1));
    };
    /** The measured first row / first tile on the served build. */
    const FIRST_BEACON_H = 96;
    const FIRST_TROPHY_H = 104;

    for (const lang of ["en", "hi"] as const) {
      const ink = captionInk(lang);
      const columns = [
        {
          name: "beacons",
          caption: {
            x: BEACON_LOG.beacons.x,
            y: BEACON_LOG.captionY,
            w: BEACON_LOG.beacons.w,
            h: ink,
          },
          first: {
            x: BEACON_LOG.beacons.x,
            y: BEACON_LOG.beacons.top,
            w: BEACON_LOG.beacons.w,
            h: FIRST_BEACON_H,
          },
        },
        {
          name: "trophies",
          caption: {
            x: BEACON_LOG.trophies.left,
            y: BEACON_LOG.captionY,
            w: BEACON_LOG.trophies.tileW,
            h: ink,
          },
          first: {
            x: BEACON_LOG.trophies.left,
            y: BEACON_LOG.trophies.top,
            w: BEACON_LOG.trophies.tileW,
            h: FIRST_TROPHY_H,
          },
        },
      ];

      for (const col of columns) {
        const captionBottom = col.caption.y + col.caption.h;
        const clearance = col.first.y - captionBottom;
        expect(
          rectsOverlap(col.caption, col.first),
          `${lang}: the ${col.name} caption (${col.caption.y}..${captionBottom}) ` +
            `is drawn inside the first control under it (top ${col.first.y}), ` +
            `overlapping it by ${-clearance} px`,
        ).toBe(false);
        // Touching is not enough: a caption flush against a card's top edge
        // still reads as bleeding through it.
        expect(
          clearance,
          `${lang}: the ${col.name} caption bottom is ${captionBottom} and the ` +
            `first control starts at ${col.first.y} - ${clearance} px of band`,
        ).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it("the empty-state aside is clear of both columns", () => {
    const aside = BEACON_LOG.aside;
    const column = flowColumn(new Array(7).fill(106), {
      left: BEACON_LOG.beacons.x,
      top: BEACON_LOG.beacons.top,
      width: BEACON_LOG.beacons.w,
      rowGap: BEACON_LOG.beacons.rowGap,
    });
    const grid = flowGrid(TWELVE, {
      left: BEACON_LOG.trophies.left,
      top: BEACON_LOG.trophies.top,
      columns: 3,
      colWidth: BEACON_LOG.trophies.tileW,
      colGap: BEACON_LOG.trophies.colGap,
      rowGap: BEACON_LOG.trophies.rowGap,
    });
    const asideRect = {
      x: aside.right - aside.w,
      y: aside.top,
      w: aside.w,
      h: aside.h,
    };
    for (const r of [...column, ...grid]) {
      expect(rectsOverlap(asideRect, r)).toBe(false);
    }
  });
});

describe("needsOwnBackdrop", () => {
  /**
   * `pause.png` was a flat #060d18 void: the capture harness boots `?scene=Pause`
   * standalone, `wantsBackdrop` is false because the frozen belt is meant to
   * show through, and with no belt underneath what is left is a card on black.
   */
  it("is true when nothing is running underneath", () => {
    expect(needsOwnBackdrop(null)).toBe(true);
    expect(
      needsOwnBackdrop({ exists: false, active: false, paused: false, visible: false }),
    ).toBe(true);
  });

  it("is true when the scene below exists but is not rendering", () => {
    expect(
      needsOwnBackdrop({ exists: true, active: false, paused: false, visible: true }),
    ).toBe(true);
    // Visible:false is the real bug the brief asks about - a "frozen" scene
    // that has been hidden draws nothing at all.
    expect(
      needsOwnBackdrop({ exists: true, active: false, paused: true, visible: false }),
    ).toBe(true);
  });

  it("is false when a live or paused-but-visible scene is underneath", () => {
    expect(
      needsOwnBackdrop({ exists: true, active: true, paused: false, visible: true }),
    ).toBe(false);
    expect(
      needsOwnBackdrop({ exists: true, active: false, paused: true, visible: true }),
    ).toBe(false);
  });
});
