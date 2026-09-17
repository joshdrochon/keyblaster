import { GUTTER, HEADING_TOP } from "@game/ui/grid";
import type { Rect } from "@game/ui/layout";

/**
 * THE BRIEFING PAGE'S COLUMN (screen 4, UR-20).
 *
 * ================== THE DEFECT, MEASURED ==================
 * UR-20, reported on Saturn: text drawn over other text. The page
 * flowed its sentences down from `PAGE.y + 200` with `y += t.height + 16` and
 * no upper bound, and then drew "The Lantern is fuelled and ready." at the
 * ABSOLUTE `PAGE.y + PAGE.h - 62`. Nothing reserved the footer's rows and
 * nothing fitted the column to the plate, so the flow simply ran through it.
 *
 * Every visible Text object's bounds, read off the live scene tree, one boot
 * per stop:
 *
 *   earth     column reaches y 956, page bottom 868  -> 88 px off the plate,
 *                                                       footer buried
 *   jupiter   overlaps the footer
 *   saturn    overlaps the footer   <- the stop the player screenshotted
 *   neptune   overlaps the footer
 *   pluto     overlaps the footer
 *   mars      fits with 39 px spare  <- which is why every capture looked fine
 *
 * Mars is the stop the capture harness boots by default. That is the whole
 * reason this shipped: the one stop anybody ever looked at is the one stop with
 * three short sentences.
 *
 * ================== THE FIX IS STRUCTURAL ==================
 * THE FOOTER IS IN THE FLOW. It is the last block in the column rather than an
 * absolute y, so it cannot be overrun by definition - not for a longer stop,
 * not in Devanagari, not for copy nobody has written yet. Everything else here
 * follows from that:
 *
 *   - the page's HEIGHT comes from the flowed column, floored so a short stop
 *     still reads as a page rather than a caption strip;
 *   - when the column is too tall, the GAPS tighten first, down to a floor;
 *   - TEXT IS NEVER SHRUNK (`ui/layout.ts` says so at length and means it:
 *     making a seven-year-old's type smaller to win a layout argument is the
 *     failure that module exists to prevent);
 *   - and when it still does not fit, `overflow` says so in pixels instead of
 *     the page quietly printing through itself.
 *
 * Pure: numbers in, rectangles out. No Phaser, no DOM. The caller measures its
 * own Text objects and hands the heights in.
 */

export interface Rows {
  readonly id: string;
  /** Measured height of this block's Text object. */
  readonly height: number;
  /** Air under it at full scale. The last block's is ignored. */
  readonly gapAfter: number;
}

export interface PlacedRow extends Rows {
  readonly x: number;
  readonly y: number;
  readonly w: number;
}

// ---------------------------------------------------------------------------
// The plate
// ---------------------------------------------------------------------------

/** The page's left edge: the product's gutter (`ui/grid.ts`). */
export const PAGE_X = GUTTER;

/**
 * The page's top: the product's heading line (`ui/grid.HEADING_TOP`).
 *
 * The page IS this screen's heading - there is no separate title - so it starts
 * where every other screen's title starts. That is the "every page is following
 * suit" half of the same report.
 *
 * It is `HEADING_TOP` rather than the 84 it was written as, because UR-50.3
 * makes the WINDOW start here too: two objects that must agree should read
 * their line from the grid, not each copy the same literal.
 */
export const PAGE_TOP = HEADING_TOP;

/**
 * 884, not 852: the extra 32 px of column is 32 px fewer wrapped lines, which
 * is the cheapest room there is. The plate still stops 32 px short of the
 * cockpit window at x=1012.
 */
export const PAGE_W = 884;

/** Inset from the plate's edge to its type. */
export const PAD_X = 72;
/**
 * 32, not 40. Hindi is the binding case: its line box is 1.2x Latin's
 * (`theme.LINE_HEIGHT`, measured) and Neptune has the most copy, so
 * `hi/neptune` needs 829 px of column against the 840 this box gives it. Eight
 * pixels of padding is the difference between fitting and shrinking a
 * seven-year-old's type, which is not a trade this file is allowed to make.
 */
export const PAD_Y = 32;

/** A short stop still reads as a page. */
export const PAGE_MIN_H = 620;

/**
 * The lowest the plate may reach.
 *
 * Shadow used to stand at (176, 964) - directly under this column - which
 * capped the page at about 856 and is most of why there was no room for the
 * footer. He now stands under the glass instead (`BriefingScene`), so the plate
 * owns the whole left side and the only thing under it is the keyboard hint
 * line at `ui/grid.HINT_TOP` (1004), which it clears by 16 px.
 */
export const PAGE_MAX_BOTTOM = 988;

/** How far the gaps may be squeezed before the page has to grow instead. */
export const GAP_FLOOR_SCALE = 0.3;

/** The type column inside the plate. */
export function columnWidth(): number {
  return PAGE_W - PAD_X * 2;
}

// ---------------------------------------------------------------------------
// The flow
// ---------------------------------------------------------------------------

export interface BriefingLayout {
  readonly page: Rect;
  readonly rows: readonly PlacedRow[];
  /** How far past `PAGE_MAX_BOTTOM` the column still reaches. 0 when it fits. */
  readonly overflow: number;
  /** What the gaps were scaled by to make it fit. 1 when nothing was needed. */
  readonly gapScale: number;
}

function columnHeight(rows: readonly Rows[], scale: number): number {
  return rows.reduce(
    (total, row, i) =>
      total + row.height + (i === rows.length - 1 ? 0 : Math.round(row.gapAfter * scale)),
    0,
  );
}

/**
 * Lay the page out from its measured blocks.
 *
 * ORDER OF CONCESSIONS, and it is the order a designer would use: white space
 * first, then the plate grows, then - and only then - the caller is told the
 * truth. Nothing here touches a font size.
 */
export function briefingLayout(rows: readonly Rows[]): BriefingLayout {
  const usableMax = PAGE_MAX_BOTTOM - PAGE_TOP - PAD_Y * 2;

  let gapScale = 1;
  for (let s = 100; s >= Math.round(GAP_FLOOR_SCALE * 100); s -= 5) {
    gapScale = s / 100;
    if (columnHeight(rows, gapScale) <= usableMax) break;
  }

  const height = columnHeight(rows, gapScale);
  const pageH = Math.min(
    PAGE_MAX_BOTTOM - PAGE_TOP,
    Math.max(PAGE_MIN_H, height + PAD_Y * 2),
  );
  const page: Rect = { x: PAGE_X, y: PAGE_TOP, w: PAGE_W, h: pageH };

  const placed: PlacedRow[] = [];
  let y = PAGE_TOP + PAD_Y;
  for (const [i, row] of rows.entries()) {
    placed.push({ ...row, x: PAGE_X + PAD_X, y, w: columnWidth() });
    y += row.height + (i === rows.length - 1 ? 0 : Math.round(row.gapAfter * gapScale));
  }

  return {
    page,
    rows: placed,
    overflow: Math.max(0, height - usableMax),
    gapScale,
  };
}

/** The lowest edge the flowed column reaches. */
export function columnBottom(layout: BriefingLayout): number {
  const last = layout.rows[layout.rows.length - 1];
  return last === undefined ? PAGE_TOP : last.y + last.height;
}

// ---------------------------------------------------------------------------
// The cockpit window, and the column of things under it (UR-50)
// ---------------------------------------------------------------------------

/**
 * THE GLASS.
 *
 * `y` IS `PAGE_TOP`, and that is the point of it. It used to be 140 while the
 * page started at 84, so the screen's two big objects began 56 px apart for no
 * reason a viewer could see. What filled the gap was a caption reading "through
 * the window" - a label naming the thing it sat on, which is the kind of copy
 * that exists to justify a layout rather than to tell anyone anything. A player
 * asked for the caption to go, and their reasoning was the useful half: without
 * it the two columns can start on the same line (UR-50.3).
 *
 * The height comes from the budget BELOW it, which is fixed and tight:
 *   24 gap + 76 shelf + 24 + 66 chip + 24 + 92 launch + 14 + 24 hint + 16 edge
 * is 360 px, so the glass may reach 1080 - 360 = 720. At `y` 84 that is 636,
 * which is within 4 px of the 640 it has always been - the window did not have
 * to shrink to gain the alignment, it only had to move.
 */
export const WINDOW = { x: 1012, y: PAGE_TOP, w: 812, h: 636, r: 56 } as const;

/** The right edge of the glass, which is this screen's right margin. */
export const RIGHT_MARGIN = WINDOW.x + WINDOW.w;

/**
 * THE STOP-PROGRESS SHELF, THE WIDTH OF THE GLASS (UR-50.2).
 *
 * Reported as "the black bar is narrower than the window". Measured, the BAR
 * was 60 px WIDER than the glass - `x - 30, w + 60` - and the thing that is
 * actually narrow is its CONTENTS: the nine lamps ran `x + 30 + i * 92`, so
 * 1042..1778 against a 1012..1824 window. That left 30 px of empty bar on the
 * left and 46 on the right, and an inset, off-centre row of dots inside an
 * over-wide bar is what reads as "narrower than the window".
 *
 * So both halves move to the glass: the bar is exactly the window's box, and
 * the lamps are centred in it with equal air at both ends. The report was
 * right about the screen and wrong about which rectangle; the fix is the one
 * the report asked for either way.
 */
export const SHELF = {
  x: WINDOW.x,
  y: WINDOW.y + WINDOW.h + 24,
  w: WINDOW.w,
  h: 76,
  lamps: 9,
  lampR: 11,
} as const;

/** Lamp centres, centred as a group inside the shelf rather than inset from it. */
export function shelfLamps(): readonly number[] {
  const pitch = SHELF.w / SHELF.lamps;
  return Array.from({ length: SHELF.lamps }, (_, i) => SHELF.x + pitch * (i + 0.5));
}

// ---------------------------------------------------------------------------
// The two actions (UR-27, moved by UR-50.1)
// ---------------------------------------------------------------------------

/**
 * THE WAY OUT.
 *
 * A player: "if i click on a planet I should have a way to go back to the map,
 * make a bug for it". Escape ALREADY went back - `BriefingScene` has passed
 * `onBack` since it landed and `lib/kit.createKeyboardMenu` fires it on Escape
 * or Backspace - so nothing was broken. The affordance was invisible: the
 * screen printed "enter to launch" and never mentioned the other key, and a
 * player who arrived by CLICKING a planet had no pointer target at all, which
 * is the half-supported input that makes a mechanic worse than absent.
 *
 * IT USED TO SIT TOP-RIGHT, in the Director map's chip shape, so that the way
 * out of a stop looked like the ways out of the map. The same player has since
 * looked at it and asked for the two actions to be together, which is the
 * better call and not a close one: the top-right chip is 820 px from the button
 * it is an alternative to, so the screen asks "launch?" in one corner and
 * answers "or don't" in another.
 *
 * STACKED, NOT SIDE BY SIDE, and that is forced rather than chosen. Shadow
 * stands under the glass and his drawn box reaches x 1156; the glass centre is
 * 1418; a launch button 380 wide plus a 262 chip beside it is 666 of row, which
 * centred would start at 1085 and put the primary action through him. Stacking
 * also keeps the hierarchy legible - the big one is the forward one - and does
 * not depend on the page's height, which varies by stop.
 */
export const BACK_CHIP = { w: 262, h: 66, y: SHELF.y + SHELF.h + 24 } as const;

/** The launch button, centred under the glass, below the way out. */
export const LAUNCH = { w: 380, h: 92, y: BACK_CHIP.y + BACK_CHIP.h + 24 } as const;

/** The vertical centre line both actions sit on: the glass's own. */
export const ACTION_CX = WINDOW.x + WINDOW.w / 2;

export function backChip(): Rect {
  return {
    x: ACTION_CX - BACK_CHIP.w / 2,
    y: BACK_CHIP.y,
    w: BACK_CHIP.w,
    h: BACK_CHIP.h,
  };
}

export function launchButton(): Rect {
  return {
    x: ACTION_CX - LAUNCH.w / 2,
    y: LAUNCH.y,
    w: LAUNCH.w,
    h: LAUNCH.h,
  };
}

/** Where Shadow stands: under the glass, clear of the page and the buttons. */
export const SHADOW_AT = { x: 1076, y: 992, scale: 0.78 } as const;

/**
 * Shadow's drawn footprint, in multiples of the 64 px nominal radius
 * `render/shadow.ts` uses at scale 1. Same model as `resultsLayout.shadowBox`,
 * restated here because this lane may not import from that screen's module.
 */
export function shadowBox(
  at: { readonly x: number; readonly y: number; readonly scale: number } = SHADOW_AT,
): Rect {
  const r = 64 * at.scale;
  return { x: at.x - 1.6 * r, y: at.y - 2.0 * r, w: 1.6 * r * 2, h: (2.0 + 1.7) * r };
}
