import { describe, expect, it } from "vitest";
import { lightPositionOf, paletteAt } from "@game/render/palette";
import { STOP_IDS } from "@engine/types";
import {
  HEADING_PLATE_BOTTOM,
  BOARD_W,
  BOARD_X,
  BUTTON_Y_MAX,
  PANEL_TOP,
  PANEL_TOP_MIN,
  REPORT_W,
  REPORT_X,
  STAGE_H,
  STAGE_W,
  contentHeight,
  overlaps,
  panelTop,
  resultsLayout,
  shadowBox,
  stack,
  sunDisc,
  withinStage,
  type Block,
  type Rect,
} from "@game/scenes/support/resultsLayout";

/**
 * THE STAGE REPORT'S GEOMETRY (screen 9).
 *
 * Three defects, all of them measurable off a capture and therefore all of them
 * assertable here without a browser:
 *
 *   1. Two panels 980x700 and 580x700 with content only in the top ~165 px.
 *      About 75% of each was empty, because both heights were constants.
 *   2. The board panel's right edge at x=1760 cut through Shadow's left arm,
 *      which starts at about x=1767.
 *   3. Mars' sun sits at (641, 315) with a radius of up to 86, so its top arc
 *      reached y=229 - 7 px above a panel whose top edge was 236 - and a white
 *      crescent came out from behind a black slab.
 *
 * `SHIPPED` below is the geometry that produced all three. It is kept as the
 * NEGATIVE CONTROL: the same assertions are run against it and are expected to
 * fail, so a check that quietly stopped measuring anything cannot read green.
 */

/** The rectangles as ResultsScene shipped them. */
const SHIPPED = {
  report: { x: 160, y: 236, w: 980, h: 700 } as Rect,
  board: { x: 1180, y: 236, w: 580, h: 700 } as Rect,
};

/** Shadow stands in the bottom-right corner at 0.7 scale. */
const SHADOW = shadowBox(1830, 940, 0.7);

/**
 * A first run at Mars, which is the case the capture caught: a WPM, an accuracy
 * and three stars, and then nothing - no delta (Earth is not a previous stage,
 * D57), no personal best (there is nothing to beat yet), no faster words and no
 * retention line. Four absences, all of them correct.
 */
const THIN_REPORT: Block[] = [
  { id: "stats", height: 152 },
  { id: "hull", height: 32 },
];

/**
 * A late stage with everything the screen can say, at Latin line heights:
 * both deltas, the hull line, a personal best, six faster words in two columns
 * of three, and a two-line retention claim.
 */
const FULL_REPORT: Block[] = [
  { id: "stats", height: 166 },
  { id: "hull", height: 32 },
  { id: "personal-best", height: 32 },
  { id: "faster", height: 158 },
  { id: "retention", height: 92 },
];

/**
 * The same screen in Devanagari, whose measured ink box is 1.23x Latin's
 * (theme.LINE_HEIGHT, D45). This is the worst case the panel has to hold, and it
 * only holds it because `fitPanel` gives up air rather than shrinking the type.
 */
const FULL_REPORT_HI: Block[] = FULL_REPORT.map((b) => ({
  ...b,
  height: Math.ceil(b.height * 1.2),
}));

/** The D43 opt-in question, which is what the board panel holds on a first run. */
const PROMPT_BOARD: Block[] = [
  { id: "board-prompt", height: 86 },
  { id: "board-yes", height: 64 },
  { id: "board-no", height: 64 },
];

function layoutFor(report: Block[], board: Block[], stop = "mars"): ReturnType<typeof resultsLayout> {
  return resultsLayout({
    report,
    board,
    sun: sunDisc(lightPositionOf(paletteAt(stop as never, false))),
    shadow: SHADOW,
  });
}

describe("resultsLayout: the panels do not collide with anything", () => {
  it("keeps the two panels apart", () => {
    for (const report of [THIN_REPORT, FULL_REPORT]) {
      const l = layoutFor(report, PROMPT_BOARD);
      expect(l.board).not.toBeNull();
      expect(overlaps(l.report, l.board as Rect)).toBe(false);
    }
  });

  it("never draws a panel over Shadow", () => {
    // The shipped board panel DID, which is why he was captured with a slice
    // missing from his arm. If this control ever reads false the box below has
    // stopped describing the figure and the test has stopped testing anything.
    expect(overlaps(SHIPPED.board, SHADOW)).toBe(true);

    for (const report of [THIN_REPORT, FULL_REPORT]) {
      for (const board of [PROMPT_BOARD, [] as Block[]]) {
        const l = layoutFor(report, board);
        expect(overlaps(l.report, SHADOW)).toBe(false);
        if (l.board !== null) expect(overlaps(l.board, SHADOW)).toBe(false);
        expect(overlaps(l.replay, SHADOW)).toBe(false);
        expect(overlaps(l.proceed, SHADOW)).toBe(false);
      }
    }
  });

  it("keeps the buttons clear of the panels", () => {
    for (const report of [THIN_REPORT, FULL_REPORT]) {
      const l = layoutFor(report, PROMPT_BOARD);
      expect(overlaps(l.replay, l.report)).toBe(false);
      expect(overlaps(l.proceed, l.report)).toBe(false);
      expect(overlaps(l.replay, l.board as Rect)).toBe(false);
      expect(overlaps(l.replay, l.proceed)).toBe(false);
    }
  });

  it("stays inside 1920x1080", () => {
    for (const stop of STOP_IDS) {
      for (const report of [THIN_REPORT, FULL_REPORT]) {
        const l = layoutFor(report, PROMPT_BOARD, stop);
        expect(withinStage(l.report), `${stop} report`).toBe(true);
        expect(withinStage(l.board as Rect), `${stop} board`).toBe(true);
        expect(withinStage(l.replay), `${stop} replay`).toBe(true);
        expect(withinStage(l.proceed), `${stop} continue`).toBe(true);
        expect(l.hint.x).toBeLessThan(STAGE_W);
        expect(l.hint.y).toBeLessThan(STAGE_H);
        expect(l.report.y).toBeGreaterThanOrEqual(PANEL_TOP_MIN);
      }
    }
  });
});

describe("resultsLayout: a panel's height is its content", () => {
  it("is not a constant", () => {
    const thin = layoutFor(THIN_REPORT, PROMPT_BOARD);
    const full = layoutFor(FULL_REPORT, PROMPT_BOARD);
    expect(full.report.h).toBeGreaterThan(thin.report.h);
    // The shipped panel was the same 700 either way, which is the defect.
    expect(thin.report.h).not.toBe(SHIPPED.report.h);
  });

  it("does not leave three quarters of the panel empty", () => {
    // The measure the critic used: content as a fraction of panel height. The
    // shipped panel held ~210 px of content in 700 px, i.e. under a third.
    const shippedFill = contentHeight(THIN_REPORT) / SHIPPED.report.h;
    expect(shippedFill).toBeLessThan(0.32);

    for (const report of [THIN_REPORT, FULL_REPORT]) {
      const l = layoutFor(report, PROMPT_BOARD);
      const fill = contentHeight(report) / l.report.h;
      expect(fill, `fill for ${report.length} blocks`).toBeGreaterThan(0.4);
    }
  });

  it("still gives a stage report some presence", () => {
    // Sized to content is not the same as shrunk to the text. A report a child
    // has just earned is not allowed to become a caption strip.
    const l = layoutFor([{ id: "stats", height: 120 }], []);
    expect(l.report.h).toBeGreaterThanOrEqual(430);
  });

  it("stacks blocks in order with a gap, and skips empty ones", () => {
    const placed = stack(0, 100, 500, [
      { id: "a", height: 40 },
      { id: "gone", height: 0 },
      { id: "b", height: 60 },
    ]);
    expect(placed.map((p) => p.id)).toEqual(["a", "b"]);
    expect(placed[0]?.y).toBe(100);
    expect(placed[1]?.y).toBe(168);
    expect(contentHeight([{ id: "a", height: 40 }, { id: "b", height: 60 }])).toBe(128);
  });

  it("lays every block inside the panel it belongs to", () => {
    // Devanagari included: the block heights that overflow at comfortable
    // spacing are exactly the case `fitPanel` compacts for, and a panel that
    // reports a height its own content does not fit inside is worse than one
    // that is too big.
    for (const report of [THIN_REPORT, FULL_REPORT, FULL_REPORT_HI]) {
      const l = layoutFor(report, PROMPT_BOARD);
      for (const block of l.reportContent) {
        expect(block.x).toBeGreaterThanOrEqual(l.report.x);
        expect(block.x + block.w).toBeLessThanOrEqual(l.report.x + l.report.w);
        expect(block.y).toBeGreaterThanOrEqual(l.report.y);
        expect(block.y + block.height).toBeLessThanOrEqual(l.report.y + l.report.h);
      }
      for (const block of l.boardContent) {
        const board = l.board as Rect;
        expect(block.x + block.w).toBeLessThanOrEqual(board.x + board.w);
        expect(block.y + block.height).toBeLessThanOrEqual(board.y + board.h);
      }
    }
  });

  it("drops the board panel entirely when there is nothing to put in it", () => {
    const l = layoutFor(THIN_REPORT, []);
    expect(l.board).toBeNull();
    expect(l.boardContent).toEqual([]);
  });

  it("brings the button row up with a short report, and never above the floor", () => {
    const short = layoutFor(THIN_REPORT, []);
    const full = layoutFor(FULL_REPORT, PROMPT_BOARD);
    expect(short.replay.y).toBeLessThan(full.replay.y);
    expect(short.replay.y).toBeGreaterThanOrEqual(740);
    expect(full.replay.y).toBeLessThanOrEqual(BUTTON_Y_MAX);
  });
});

describe("resultsLayout: the sun never leaks out from behind a panel", () => {
  it("was leaking on Mars at the shipped top edge", () => {
    const disc = sunDisc(lightPositionOf(paletteAt("mars", false)));
    // The measurement: the disc's top arc is ABOVE the shipped panel edge while
    // its centre is behind the panel. That is a crescent of sun on a black slab.
    expect(disc.cy - disc.r).toBeLessThan(SHIPPED.report.y);
    expect(disc.cy + disc.r).toBeGreaterThan(SHIPPED.report.y);
    expect(disc.cx - disc.r).toBeGreaterThan(SHIPPED.report.x);
    expect(disc.cx + disc.r).toBeLessThan(SHIPPED.report.x + SHIPPED.report.w);
  });

  it("covers the disc for every stop whose sun is behind a panel", () => {
    for (const stop of STOP_IDS) {
      const disc = sunDisc(lightPositionOf(paletteAt(stop, false)));
      const l = layoutFor(FULL_REPORT, PROMPT_BOARD, stop);
      for (const panel of [l.report, l.board as Rect]) {
        const inColumn =
          disc.cx - disc.r >= panel.x && disc.cx + disc.r <= panel.x + panel.w;
        if (!inColumn) continue;

        // THE REQUIREMENT IS "NO CRESCENT OF SUN IS VISIBLE", not "the panel
        // covers the disc". Those were the same thing until the art lane lifted
        // the light out of the KEYBLASTER wordmark (UR-06) and Earth's disc rose
        // to y=140.7..312.7 — its top now sits behind the HEADING PLATE and only
        // its body behind the panel. The old assertion demanded one surface do
        // the whole job, which is a sufficient condition, not the real one.
        //
        // What must hold is that the two surfaces leave NO BAND between them,
        // and that together they span the disc.
        const covered = (y: number): boolean =>
          y <= HEADING_PLATE_BOTTOM || (y >= panel.y && y <= panel.y + panel.h);
        expect(panel.y, `${stop}: a band is exposed above the panel`).toBeLessThanOrEqual(
          HEADING_PLATE_BOTTOM,
        );
        expect(covered(disc.cy - disc.r), `${stop} disc top exposed`).toBe(true);
        expect(covered(disc.cy + disc.r), `${stop} disc bottom exposed`).toBe(true);
        expect(panel.y + panel.h, `${stop} bottom`).toBeGreaterThanOrEqual(
          disc.cy + disc.r,
        );
      }
    }
  });

  it("leaves a sun that is already in open sky alone", () => {
    // A disc wholly above the panel reads as a sun, not as a leak, so the panel
    // must NOT climb to swallow it.
    const high = { cx: REPORT_X + REPORT_W / 2, cy: 90, r: 40 };
    expect(panelTop(PANEL_TOP, high, REPORT_X, REPORT_W)).toBe(PANEL_TOP);
    // And one that is wholly below it is already hidden.
    const low = { cx: REPORT_X + REPORT_W / 2, cy: 500, r: 40 };
    expect(panelTop(PANEL_TOP, low, REPORT_X, REPORT_W)).toBe(PANEL_TOP);
    // A disc in the other column is not this panel's problem.
    const elsewhere = { cx: BOARD_X + BOARD_W / 2, cy: 236, r: 40 };
    expect(panelTop(PANEL_TOP, elsewhere, REPORT_X, REPORT_W)).toBe(PANEL_TOP);
    expect(panelTop(PANEL_TOP, null, REPORT_X, REPORT_W)).toBe(PANEL_TOP);
  });

  it("never climbs past the heading to do it", () => {
    const huge = { cx: REPORT_X + REPORT_W / 2, cy: 300, r: 600 };
    expect(panelTop(PANEL_TOP, huge, REPORT_X, REPORT_W)).toBe(PANEL_TOP_MIN);
  });
});

describe("resultsLayout: Shadow's footprint", () => {
  it("is wider than the body and taller than the antenna", () => {
    const box = shadowBox(1830, 940, 0.7);
    // SHADOW_RADIUS is 64; the hover cushion alone is 2.3 R across.
    expect(box.w).toBeGreaterThan(2.3 * 64 * 0.7);
    expect(box.h).toBeGreaterThan(2.9 * 64 * 0.7);
    expect(box.x + box.w).toBeLessThanOrEqual(STAGE_W);
    expect(box.y + box.h).toBeLessThanOrEqual(STAGE_H);
  });
});
