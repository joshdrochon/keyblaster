import { GAME_HEIGHT, GAME_WIDTH } from "@game/sceneKeys";
import { SPACE } from "./theme.js";

/**
 * MENU LAYOUT MATHS. Pure: nothing here imports Phaser or touches the DOM.
 *
 * WHY IT IS ITS OWN MODULE. The Beacon Log laid its twelve trophy tiles out on
 * a fixed 190 px row pitch - `250 + row * 190` - while every tile MEASURED its
 * own height from wrapped text. The two disagreed the moment a criterion ran to
 * three lines: "cross the main belt without a scratch" is 237 px tall in a
 * 230 px column, so its last line printed inside the tile below it, and the
 * bottom row ran off the frame. A fixed pitch is a promise about text that
 * nothing measures, and it fails first in the language with the tallest lines
 * (theme.ts LINE_HEIGHT: Devanagari's ink box is ~1.2x Latin's).
 *
 * So the pitch is computed FROM the measured heights, here, where it can be
 * unit-tested without a canvas: the caller measures, this decides, the caller
 * positions. The functions take numbers and return rectangles - no Phaser type
 * appears in any signature.
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

export interface ColumnFlowOptions {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly rowGap: number;
}

/** A single column: each row starts under the measured bottom of the last. */
export function flowColumn(
  heights: readonly number[],
  options: ColumnFlowOptions,
): Rect[] {
  const out: Rect[] = [];
  let y = options.top;
  for (const h of heights) {
    out.push({ x: options.left, y, w: options.width, h });
    y += h + options.rowGap;
  }
  return out;
}

export interface GridFlowOptions {
  readonly left: number;
  readonly top: number;
  readonly columns: number;
  readonly colWidth: number;
  readonly colGap: number;
  readonly rowGap: number;
}

/**
 * A fixed-column grid whose ROW PITCH IS MEASURED.
 *
 * Every tile in a row shares the row's top edge - a gallery is a grid and a
 * ragged top reads as a bug - and the next row starts below the TALLEST tile in
 * this one plus the gap. That single rule is what makes overlap impossible, and
 * it is what the fixed pitch could not express.
 */
export function flowGrid(
  heights: readonly number[],
  options: GridFlowOptions,
): Rect[] {
  const cols = Math.max(1, Math.floor(options.columns));
  const out: Rect[] = [];
  let y = options.top;
  for (let i = 0; i < heights.length; i += cols) {
    const row = heights.slice(i, i + cols);
    const tallest = Math.max(...row);
    row.forEach((h, col) => {
      out.push({
        x: options.left + col * (options.colWidth + options.colGap),
        y,
        w: options.colWidth,
        h,
      });
    });
    y += tallest + options.rowGap;
  }
  return out;
}

/** The lowest edge any of these rectangles reaches. */
export function bottomOf(rects: readonly Rect[]): number {
  return rects.reduce((low, r) => Math.max(low, r.y + r.h), 0);
}

/** True when the two rectangles share area. Touching edges do not count. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

export function anyOverlap(rects: readonly Rect[]): boolean {
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i];
      const b = rects[j];
      if (a && b && rectsOverlap(a, b)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Fit
// ---------------------------------------------------------------------------

export interface FitOptions {
  readonly top: number;
  readonly rowGap: number;
  readonly minRowGap: number;
  /** Glyph height the measured heights were taken at. */
  readonly glyph: number;
  /** How small the glyph may get and still be a picture of something. */
  readonly minGlyph: number;
  /** The lowest y the block may reach. */
  readonly bottom: number;
  readonly columns: number;
}

export interface FitPlan {
  readonly rowGap: number;
  readonly glyph: number;
  readonly fits: boolean;
  /** Px still over the limit after the plan. 0 when it fits. */
  readonly overflow: number;
}

function rowMaxima(heights: readonly number[], columns: number): number[] {
  const cols = Math.max(1, Math.floor(columns));
  const rows: number[] = [];
  for (let i = 0; i < heights.length; i += cols) {
    rows.push(Math.max(...heights.slice(i, i + cols)));
  }
  return rows;
}

function blockBottom(rows: readonly number[], top: number, gap: number): number {
  if (rows.length === 0) return top;
  return top + rows.reduce((a, b) => a + b, 0) + gap * (rows.length - 1);
}

/**
 * Make a measured block fit, and say honestly when it cannot.
 *
 * ORDER MATTERS, and it is the order a designer would use. White space goes
 * first: a tighter row gap costs nothing a child can read. Only when the gap is
 * at its floor does the GLYPH shrink, because an unearned trophy is an
 * invitation (D31/D74) and an invitation you cannot see is not one. TEXT IS
 * NEVER SHRUNK - not here, not anywhere. Making a 7-year-old's type smaller to
 * win a layout argument is the failure this module exists to prevent.
 *
 * Shrinking the glyph by `d` takes AT MOST `d` off a tile, and only off tiles
 * whose glyph is the taller half; the plan is therefore pessimistic on purpose,
 * and the caller re-measures after rebuilding rather than trusting this number.
 */
export function fitPlan(
  heights: readonly number[],
  options: FitOptions,
): FitPlan {
  const rows = rowMaxima(heights, options.columns);
  if (rows.length === 0) {
    return { rowGap: options.rowGap, glyph: options.glyph, fits: true, overflow: 0 };
  }

  for (let gap = options.rowGap; gap >= options.minRowGap; gap -= 1) {
    if (blockBottom(rows, options.top, gap) <= options.bottom) {
      return { rowGap: gap, glyph: options.glyph, fits: true, overflow: 0 };
    }
  }

  const gap = options.minRowGap;
  const over = blockBottom(rows, options.top, gap) - options.bottom;
  const perRow = Math.ceil(over / rows.length);
  const glyph = Math.max(options.minGlyph, options.glyph - perRow);
  const recovered = (options.glyph - glyph) * rows.length;
  const overflow = Math.max(0, over - recovered);
  return { rowGap: gap, glyph, fits: overflow === 0, overflow };
}

// ---------------------------------------------------------------------------
// The Beacon Log's frame
// ---------------------------------------------------------------------------

const RIGHT_EDGE = GAME_WIDTH - SPACE.gutter;

/**
 * SCREEN 10's regions, as numbers rather than as literals sprinkled through the
 * scene. Three bands, none of which may cross another:
 *
 *   BEACONS   left column, seven rows, one per stop.
 *   TROPHIES  right block, three columns x four rows, all twelve of D80.
 *   ASIDE     the empty state - Shadow asleep and his one line - which the old
 *             screen drew at `GAME_HEIGHT - 116` straight across the pluto row
 *             and on top of the neptune row. It has its own band now, in the
 *             empty top-right quarter beside the heading, where it sits next to
 *             the title it is commenting on and crosses nothing a child reads.
 *
 * The trophy block takes the WIDTH because 12 wrapped criteria in three columns
 * is the thing on this screen that runs out of room first; the beacon column
 * takes the HEIGHT because seven rows do. Both are then checked against the
 * frame by `fitPlan`, in every UI language, by tests/unit/ui/layout.test.ts.
 */
export const BEACON_LOG = {
  /** Section captions ("beacons · 0 of 7 lit"), under the heading. */
  captionY: 206,

  beacons: {
    x: SPACE.gutter,
    w: 620,
    top: 240,
    rowGap: 10,
    minRowGap: 4,
    glyph: 68,
    minGlyph: 46,
    /** Clear of the hint line at the foot of the screen. */
    bottom: 986,
    columns: 1,
  },

  trophies: {
    left: SPACE.gutter + 620 + 40,
    tileW: 340,
    colGap: 24,
    top: 240,
    rowGap: 22,
    minRowGap: 10,
    glyph: 52,
    minGlyph: 34,
    bottom: 1052,
    columns: 3,
  },

  /** Right-aligned block in the header band; only drawn in the empty state. */
  aside: {
    right: RIGHT_EDGE,
    w: 640,
    top: 44,
    h: 152,
    /** The sleeping Shadow's drawn height. */
    shadow: 108,
  },

  /** Where `MenuScene.addHint` puts its line. Nothing may reach it. */
  hintTop: GAME_HEIGHT - 76,
} as const;

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

/** What an overlay can see of the scene it was launched over. */
export interface SceneBelow {
  readonly exists: boolean;
  readonly active: boolean;
  readonly paused: boolean;
  readonly visible: boolean;
}

/**
 * Does a pause overlay have to draw its own sky?
 *
 * `pause.png` was a flat void: the capture harness boots `?scene=Pause`
 * standalone - so does a child who deep-links one - and the overlay skips its
 * backdrop because the frozen belt is supposed to show through. With no belt
 * underneath, "supposed to show through" is a card floating on black.
 *
 * A scene below only counts if it is REGISTERED, VISIBLE, and either running or
 * paused. Phaser's `pause` leaves `visible` true and the display list intact -
 * that is why the belt freezes rather than disappearing - so a paused-visible
 * scene is exactly the case the overlay was designed for. Anything else, and
 * the overlay is the only thing on screen and has to dress it.
 */
export function needsOwnBackdrop(below: SceneBelow | null): boolean {
  if (below === null || !below.exists) return true;
  if (!below.visible) return true;
  return !(below.active || below.paused);
}
