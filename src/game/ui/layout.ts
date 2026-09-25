import { GAME_HEIGHT, GAME_WIDTH } from "@game/sceneKeys";
import { THIRD_LINE_TOP } from "./grid.js";
import { LINE_HEIGHT, SPACE, STEP, TYPE } from "./theme.js";

/**
 * THE TWO HORIZONTAL LINES EVERY MENU SCREEN IS BUILT ON (UR-85).
 *
 * `HEADING_TOP` is where the title is drawn. `CONTENT_TOP` is where the first
 * control is. They are here, in the pure layout module, rather than in
 * `MenuScene`, because two of the four screens get their geometry from a plan
 * in this file and not from the scene at all - so a constant that lived on the
 * scene could only bind half of them.
 *
 * MEASURED BEFORE THIS EXISTED, on the served build: the picker and the create
 * screen started their controls at 250, the beacon log at 240 and settings at
 * 216. Four screens a child moves between, three content lines.
 *
 * THE SHARED LINE IS THE TIGHTEST SCREEN'S, not the most common one. 250 was
 * the majority and settings cannot reach it: moving its column down 34 px puts
 * the Hindi layout's last row at 1002 and the reset key at 983, through the
 * hint line, which `tests/unit/ui/layout.test.ts` catches in every UI language.
 * The other three have hundreds of pixels of headroom and lose nothing by
 * coming up to meet it. A shared line that only holds in English is not one.
 */
export const HEADING_TOP = 84;
export const CONTENT_TOP = 216;

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

/**
 * The right gutter, READ AT DRAW TIME.
 *
 * This was `const RIGHT_EDGE = GAME_WIDTH - SPACE.gutter` at module top level,
 * which was correct while the world was a fixed 1920 wide and is a frozen 1872
 * now that it is not (D99, `sceneKeys` header): a module-level `const` captures
 * the live binding's value at import time, before `bootGame` has measured the
 * window. A getter reads it when the screen is actually laid out.
 */
const rightEdge = (): number => GAME_WIDTH - SPACE.gutter;

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
/**
 * ============ THE SECTION CAPTIONS GET THEIR OWN BAND ============
 *
 * WHAT WAS REPORTED. At a 2000 px window neither section heading could be read:
 * "Beacons · 3 of 7 lit" was drawn behind the Earth row and "Trophies · 5 of 12
 * earned" behind the First Light card, each showing only as grey type bleeding
 * through a card's top edge.
 *
 * IT WAS NEVER A DEPTH BUG. Measured on the served build at 2000x1125, the
 * caption's ink ran 206..240.71 while the first control's ring started at 216:
 * the caption sat at an unnamed y of its own and the column started at the
 * shared `CONTENT_TOP`, so the caption was drawn INSIDE the first card's
 * rectangle. Raising its z-order would have put readable grey type on top of a
 * card and left the screen wrong.
 *
 * SO THE HEADING IS ALLOWED FOR IN THE FLOW, the way `buildEmptyState`'s aside
 * already is. Three facts fix the numbers, and none of them is a taste:
 *
 *   CAPTION_LINE   `grid.THIRD_LINE_TOP`. This line already exists for exactly
 *                  this string - it is where the Director map draws "1 of 7
 *                  lit" - and 216 is the first line clear of a `TYPE.display`
 *                  heading, whose ink box ends at 167 in Latin and 184 in
 *                  Devanagari (measured; theme.ts LINE_HEIGHT).
 *   CAPTION_BAND   one line of `TYPE.body` at the Devanagari line height. The
 *                  measured ink is 34.71 px in Latin and 42.71 in Devanagari,
 *                  so 47 covers the worst script the UI ships with air to
 *                  spare. A band tuned to English is a band that collides in
 *                  Hindi, which is the failure `fitPlan` exists to prevent.
 *   STEP.tight     the air under the caption. `SPACE.gap` (20) is the step
 *                  between two BLOCKS; a caption and the column it names are
 *                  one instrument, which is `STEP.tight`'s documented job. It
 *                  is also the choice that keeps the beacon column off its
 *                  glyph floor: at 20 the worst-case Devanagari column fits
 *                  only by shrinking the beacon glyph to `minGlyph` exactly,
 *                  and a value that passes with nothing to spare fails on the
 *                  next string somebody writes.
 *
 * THIS SCREEN'S CONTENT LINE IS THEREFORE NOT `CONTENT_TOP`, and that is not a
 * one-off. `CONTENT_TOP` is where content starts under a TWO-line header block;
 * the Beacon Log has a three-line one, so it gets the same treatment the map
 * and the beacon screen get for their third line. The other three menus are
 * untouched and UR-85's shared line still binds them.
 *
 * THE COST, STATED. The beacon column's band shrinks by 59 px, so `fitPlan`
 * spends white space first and the seven rows close from a 10 px gap to 7. That
 * is the order this module documents - white space, then the glyph, never the
 * type - and a 3 px tighter list is not the defect an unreadable heading is.
 */
const CAPTION_LINE = THIRD_LINE_TOP;
const CAPTION_BAND = Math.round(TYPE.body * LINE_HEIGHT.devanagari);
/** Where this screen's columns start: under the caption, not beside it. */
const LOG_CONTENT_TOP = CAPTION_LINE + CAPTION_BAND + STEP.tight;

export const BEACON_LOG = {
  /** Section captions ("beacons · 0 of 7 lit"), on the header's third line. */
  captionY: CAPTION_LINE,
  /** The lowest a caption's ink reaches. Nothing in a column may cross it. */
  captionBottom: CAPTION_LINE + CAPTION_BAND,

  beacons: {
    x: SPACE.gutter,
    w: 620,
    top: LOG_CONTENT_TOP,
    rowGap: 10,
    minRowGap: 4,
    glyph: 68,
    minGlyph: 46,
    /** Clear of the hint line at the foot of the screen. */
    bottom: 986,
    columns: 1,
  },

  trophies: {
    left: SPACE.gutter,
    tileW: 560,
    colGap: 24,
    top: LOG_CONTENT_TOP,
    rowGap: 64,
    /**
     * 4, THE SAME FLOOR THE BEACON COLUMN HAS, not 10.
     *
     * Two blocks on one screen had two different white-space floors, and the
     * higher one was the reason the caption band did not fit: with the columns
     * 59 px lower, the Devanagari "every tile at its worst" case could not
     * spend enough gap before it reached the glyph, and `fitPlan` was made to
     * shrink an unearned trophy's mark instead of closing white space.
     *
     * That inverts this module's own order - white space first, the glyph
     * second, the type never - so the floor is the one number that changes.
     * Nothing real reaches it: the shipped copy flows at the nominal 22 px gap
     * with 372 px to spare, measured on the served build. It binds only in the
     * synthetic worst case, which is exactly where spending white space is the
     * right answer.
     */
    minRowGap: 4,
    glyph: 52,
    minGlyph: 34,
    bottom: 1052,
    columns: 3,
  },

  /** Right-aligned block in the header band; only drawn in the empty state. */
  aside: {
    /** Live: the world's right gutter, which moves with the window (D99). */
    get right(): number {
      return rightEdge();
    },
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

// ---------------------------------------------------------------------------
// Settings' console frame
// ---------------------------------------------------------------------------

/**
 * SCREEN 11's two console panels (UR-11).
 *
 * The old screen stacked its rows on a fixed 14 px gap inside two plates of a
 * hard-coded 700 and 760 px - the same "a fixed pitch is a promise about text
 * that nothing measures" defect the Beacon Log shipped, and it survived only
 * because a flat row is short. Every control on the console is TALLER than the
 * row it replaced (a knob is 130 px against the pill slider's 59), and a label
 * that wraps to two lines in Devanagari adds another 40 - so the left column's
 * six rows now come within 6 px of the keyboard hint in Hindi.
 *
 * So the column is flowed by `fitPlan` / `flowColumn`, exactly like the Beacon
 * Log's, and `bottom` is where the panel's BEZEL may reach rather than where
 * the last control may: the panel is drawn 26 px past the stack on every side,
 * and a panel edge printed across the hint line is the same defect as a control
 * printed across it.
 */
export const SETTINGS_CONSOLE = {
  /**
   * THE SHARED CONTENT LINE (UR-85), not a number of this screen's own.
   *
   * This used to be 216, argued from the bezel: the face's top edge at
   * `top - bezel` = 190 sat 8 px below the title. That is a sound reason for
   * where the PANEL's edge goes and not for where the first control goes, and
   * it put settings' controls 34 px above every other menu's. The face now
   * starts at `CONTENT_TOP - bezel` = 224, still clear of a title whose ink box
   * ends near 182.
   */
  top: CONTENT_TOP,
  rowGap: 18,
  minRowGap: 6,
  /** How far the console face extends past the stack on every side. */
  bezel: 26,
  /**
   * How far in from the face's edge a control row starts is NOT here: it is
   * `controlSurfaceLayout.consoleContentInset()`, because it is a fact about
   * the console's own furniture (UR-122) and not about this screen. Putting it
   * beside `bezel` is what made the two the same number by accident, which is
   * the defect it fixes.
   */
  /** The gap between the last toggle and the one destructive key. */
  keyGap: 28,
  /** Unused here: the column has no glyph to shrink. Text is NEVER shrunk. */
  glyph: 0,
  minGlyph: 0,
  columns: 1,
  /** The lowest the BEZEL may reach, which is the hint line. */
  get bottom(): number {
    return BEACON_LOG.hintTop - 26;
  },
} as const;
