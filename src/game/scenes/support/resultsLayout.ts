/**
 * WHERE THE STAGE REPORT'S PANELS GO (screen 9).
 *
 * Pure maths, no Phaser, no DOM: every function here takes MEASURED content
 * heights and returns rectangles. That is the whole point of the module. The
 * defect it exists to end was two black slabs 980x700 and 580x700 with content
 * only in their top ~165 px - about 75% of each panel empty - because both
 * heights were hard-coded constants that no longer had anything to do with what
 * the screen had to say. A first run at Mars has a WPM, an accuracy and three
 * stars: no delta (D57 - Earth is not a previous stage), no personal best
 * (nothing to beat yet), no faster-words list and no retention line, because all
 * four of those are ABSENCE rather than zero on this screen. Four absent blocks
 * are four absent blocks' worth of panel, and the panel has to know that.
 *
 * So the panel is sized from its content, floored at `REPORT_MIN_H` /
 * `BOARD_MIN_H` so a stage report a child has just earned still reads as a
 * thing with something in it rather than a caption strip, and capped so it can
 * never run under the button row or off the stage.
 *
 * TWO OTHER RULES LIVE HERE, both of them geometry rather than decoration:
 *
 *   THE SUN. The world behind this screen draws its light source as a bright
 *   disc, and on Mars it lands at (641, 315) - just far enough up that its top
 *   arc poked out above a panel whose top edge was at y=236. A white crescent
 *   emerging from behind a black slab reads as a rendering fault, not as a sun.
 *   The sun belongs to the parallax lane and is not touched; the PANEL moves, up
 *   to `PANEL_TOP_MIN`, until the disc is wholly behind it (`panelTop`), and the
 *   panel is kept tall enough to cover its bottom too (`panelHeight`).
 *
 *   SHADOW. The robot stands in the bottom-right corner and the board panel's
 *   right edge was 7 px inside his left arm, so he was drawn with a slice
 *   missing. `shadowBox` states his footprint and `resultsLayout` narrows the
 *   board panel rather than clipping him: a character is never the thing that
 *   gives way to a rectangle.
 *
 * Coordinates are DESIGN space, 1920x1080, the space the scenes are authored in.
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Disc {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

/** One measured piece of panel content: how tall it turned out to be. */
export interface Block {
  readonly id: string;
  readonly height: number;
}

export interface PlacedBlock extends Block {
  readonly x: number;
  readonly y: number;
  readonly w: number;
}

export const STAGE_W = 1920;
export const STAGE_H = 1080;

export const REPORT_X = 160;
export const REPORT_W = 980;
export const BOARD_X = 1180;
export const BOARD_W = 580;

/** Where a panel would start if nothing were in the way. */
export const PANEL_TOP = 236;
/**
 * The highest a panel may be pushed to hide the sun. Above this it would eat
 * the heading and the stop name, which sit on their own contrast plates from
 * y=52 to y=181 in the widest script the game ships (Devanagari, D45).
 */
export const PANEL_TOP_MIN = 196;

export const PANEL_PAD_X = 48;
export const PANEL_PAD_Y = 44;
/** Vertical air between two content blocks inside a panel. */
export const BLOCK_GAP = 28;

/**
 * A panel never gets smaller than this, however little it has to say. The brief
 * is explicit that shrinking the stage report to its text is the wrong fix on
 * its own: what a child just earned should feel like it has something in it.
 */
export const REPORT_MIN_H = 430;
export const BOARD_MIN_H = 380;

/** No panel may reach below this; the button row and its air live under it. */
export const PANEL_MAX_BOTTOM = 942;

/**
 * The radius used when hiding the light source.
 *
 * `render/parallax.ts` sizes the sun 48 or 86 px depending on how bright the
 * stop's sky is, and neither the function nor the constants are exported. Rather
 * than mirror a private number that can drift, this takes the LARGER of the two
 * always: covering a disc that turns out to be smaller costs a few pixels of
 * panel and covering one that turns out to be bigger is the bug.
 */
export const SUN_R = 86;
/** Slack around the disc, so the crisp lip on its edge is covered too. */
export const SUN_CLEARANCE = 18;

export const BUTTON_W = 420;
export const BUTTON_H = 64;
export const BUTTON_GAP_X = 40;
/** Air between the bottom of the taller panel and the button row. */
export const BUTTON_GAP_Y = 44;
/**
 * The button row follows the panels down but never rides up under them: with a
 * short stage report it sits at the floor, with a full one at the ceiling, and
 * in between it tracks the content so there is never an orphaned band of sky
 * between the report and the two things you can do about it.
 */
export const BUTTON_Y_MIN = 740;
export const BUTTON_Y_MAX = 966;

/** Clear air between a panel edge and Shadow. */
export const SHADOW_GAP = 24;

/**
 * Shadow's drawn footprint, in multiples of `SHADOW_RADIUS` from
 * `render/shadow.ts` (64 at scale 1). Read off the draw calls and the pose
 * table rather than guessed, because a box that is a few pixels short is
 * exactly the bug it is meant to catch - the shipped board panel ended at
 * x=1760 and the cheering pose's raised arm starts at about 1760.6.
 *
 * The widest thing is a raised paddle, not the body: `cheering` puts both arms
 * at 138 degrees from a root 0.84 R out, the paddle is a 0.92 x 0.54 R ellipse
 * around the arm's midpoint, and the far corner of that lands near 1.55 R. The
 * tallest is the antenna tip plus its glow at 1.9 R above the anchor with the
 * body sunk -0.08 R; the lowest is the soft cast shadow at 1.52 R below. The
 * hover bob moves all of it. These are the outside of that, so a rectangle that
 * clears this box clears every pose.
 */
export const SHADOW_NOMINAL_R = 64;
export const SHADOW_HALF_W_R = 1.6;
export const SHADOW_ABOVE_R = 2.0;
export const SHADOW_BELOW_R = 1.7;

export function clamp(value: number, low: number, high: number): number {
  if (high < low) return low;
  return Math.min(Math.max(value, low), high);
}

/** True when the two rectangles share any area at all. Touching is not overlap. */
export function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

/** True when the rectangle lies wholly inside the stage. */
export function withinStage(r: Rect, w = STAGE_W, h = STAGE_H): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h;
}

/** Shadow's footprint for an anchor and a uniform scale. */
export function shadowBox(x: number, y: number, scale: number): Rect {
  const r = SHADOW_NOMINAL_R * scale;
  return {
    x: x - SHADOW_HALF_W_R * r,
    y: y - SHADOW_ABOVE_R * r,
    w: SHADOW_HALF_W_R * r * 2,
    h: (SHADOW_ABOVE_R + SHADOW_BELOW_R) * r,
  };
}

/**
 * The stop's light source as this screen has to treat it: centre from
 * `lightPositionOf` (a fraction of the stage), radius the worst case.
 */
export function sunDisc(
  at: { readonly x: number; readonly y: number },
  stageW = STAGE_W,
  stageH = STAGE_H,
): Disc {
  return { cx: at.x * stageW, cy: at.y * stageH, r: SUN_R };
}

/** Blocks with nothing in them take up nothing, including their gap. */
function drawn(blocks: readonly Block[]): Block[] {
  return blocks.filter((b) => b.height > 0);
}

/** Total height of a stack of blocks, gaps included. */
export function contentHeight(
  blocks: readonly Block[],
  gap: number = BLOCK_GAP,
): number {
  const list = drawn(blocks);
  if (list.length === 0) return 0;
  return list.reduce((sum, b) => sum + b.height, 0) + gap * (list.length - 1);
}

/** Lay a stack of measured blocks down a column. */
export function stack(
  x: number,
  top: number,
  w: number,
  blocks: readonly Block[],
  gap: number = BLOCK_GAP,
): PlacedBlock[] {
  const out: PlacedBlock[] = [];
  let y = top;
  for (const block of drawn(blocks)) {
    out.push({ ...block, x, y, w });
    y += block.height + gap;
  }
  return out;
}

function discOverlapsColumn(disc: Disc, x: number, w: number): boolean {
  return disc.cx + disc.r > x && disc.cx - disc.r < x + w;
}

/**
 * The top edge a panel needs so a bright disc behind it never shows.
 *
 * Three cases, and only one of them moves anything:
 *   - the disc is not in this column       -> nothing to hide
 *   - the disc is wholly below the top     -> already hidden
 *   - the disc is wholly above the top     -> it is in OPEN SKY and whole,
 *                                             which is what a sun should look
 *                                             like; covering it would be worse
 *   - the disc straddles the top edge      -> the leak. Raise until it doesn't.
 */
export function panelTop(
  preferred: number,
  disc: Disc | null,
  x: number,
  w: number,
  minTop: number = PANEL_TOP_MIN,
  clearance: number = SUN_CLEARANCE,
): number {
  if (disc === null) return preferred;
  if (!discOverlapsColumn(disc, x, w)) return preferred;
  const top = disc.cy - disc.r;
  const bottom = disc.cy + disc.r;
  if (top >= preferred) return preferred;
  if (bottom <= preferred) return preferred;
  return clamp(top - clearance, minTop, preferred);
}

/** The tightest a panel is allowed to get before it simply cannot hold its content. */
export const BLOCK_GAP_MIN = 12;
export const PANEL_PAD_Y_MIN = 20;

export interface PanelFit {
  readonly h: number;
  /** The gap the stack must actually be laid out with. */
  readonly gap: number;
  readonly padY: number;
  /**
   * Where the stack starts inside the panel.
   *
   * Normally `top + padY`. When the panel is sitting on its floor - a first run
   * at Mars has three things to say and `REPORT_MIN_H` keeps the report a panel
   * rather than a caption strip - the slack is split above and below instead of
   * all being left at the bottom, so the floor reads as a deliberate size and
   * not as content that stopped early.
   */
  readonly contentTop: number;
}

/**
 * A panel's height AND the spacing that height assumes, which have to be
 * decided together or the content lands outside the box that was sized for it.
 *
 * Normal case: content at full spacing, floored at `minH` so a report a child
 * has just earned still reads as a panel, and never so short that it uncovers
 * the bottom of the disc its top edge was raised to hide.
 *
 * Crowded case: a late stage in Devanagari says everything this screen can say
 * at a line height 20% taller than Latin (D45, theme.LINE_HEIGHT), and that does
 * not fit between the heading and the button row at comfortable spacing. The air
 * gives way before the words do - gap first, then padding, each to a floor -
 * because shrinking a script to fit a Latin-sized box is the one thing D41 and
 * D45 both forbid. If it still will not fit, the panel takes everything it can
 * have and the caller has more content than this screen can hold; the unit test
 * pins the realistic worst case so that stays a theoretical branch.
 */
export function fitPanel(
  top: number,
  blocks: readonly Block[],
  minH: number,
  disc: Disc | null,
  x: number,
  w: number,
  maxBottom: number = PANEL_MAX_BOTTOM,
  clearance: number = SUN_CLEARANCE,
): PanelFit {
  const available = Math.max(0, maxBottom - top);
  const list = drawn(blocks);
  const bare = list.reduce((sum, b) => sum + b.height, 0);
  const gaps = Math.max(0, list.length - 1);

  let gap = BLOCK_GAP;
  let padY = PANEL_PAD_Y;
  if (bare + gaps * gap + padY * 2 > available) {
    padY = PANEL_PAD_Y_MIN;
    const room = available - padY * 2 - bare;
    gap = gaps === 0 ? gap : clamp(Math.floor(room / gaps), BLOCK_GAP_MIN, BLOCK_GAP);
  }

  const needed = bare + gaps * gap + padY * 2;
  let h = Math.max(needed, minH);
  if (disc !== null && discOverlapsColumn(disc, x, w) && disc.cy - disc.r < top) {
    h = Math.max(h, disc.cy + disc.r + clearance - top);
  }
  h = clamp(h, 0, available);
  const slack = Math.max(0, h - needed);
  return { h, gap, padY, contentTop: top + padY + Math.round(slack / 2) };
}

export interface ResultsLayoutInput {
  /** Measured blocks of the stage report, top to bottom. */
  readonly report: readonly Block[];
  /** Measured blocks of the relative board, or empty when it is not drawn. */
  readonly board: readonly Block[];
  /** The stop's light source, or null when this screen draws no world. */
  readonly sun: Disc | null;
  /** Shadow's footprint (`shadowBox`). */
  readonly shadow: Rect;
}

export interface ResultsLayout {
  readonly report: Rect;
  readonly reportContent: readonly PlacedBlock[];
  /** Null when the board is not on screen at all. */
  readonly board: Rect | null;
  readonly boardContent: readonly PlacedBlock[];
  readonly replay: Rect;
  readonly proceed: Rect;
  /** Baseline for the keyboard hint, which sits to the right of the buttons. */
  readonly hint: { readonly x: number; readonly y: number };
  readonly shadow: Rect;
}

/**
 * The whole screen, from measured content.
 *
 * Order matters and is the order the constraints were argued in: hide the sun
 * (it decides the top edge), size to content (it decides the height), keep off
 * Shadow (it decides the board's width), then put the buttons under whichever
 * panel ended up taller.
 */
export function resultsLayout(input: ResultsLayoutInput): ResultsLayout {
  const { sun, shadow } = input;

  // ONE top edge for both panels. Two panels at two different heights because
  // the sun happens to be behind one of them is a worse picture than either.
  const top = Math.min(
    panelTop(PANEL_TOP, sun, REPORT_X, REPORT_W),
    panelTop(PANEL_TOP, sun, BOARD_X, BOARD_W),
  );

  const reportFit = fitPanel(top, input.report, REPORT_MIN_H, sun, REPORT_X, REPORT_W);
  const report: Rect = { x: REPORT_X, y: top, w: REPORT_W, h: reportFit.h };

  const hasBoard = drawn(input.board).length > 0;
  const boardFit = fitPanel(top, input.board, BOARD_MIN_H, sun, BOARD_X, BOARD_W);
  let board: Rect | null = null;
  if (hasBoard) {
    let w = BOARD_W;
    // Shadow is not clipped to fit a rectangle; the rectangle gives way.
    const spans = top < shadow.y + shadow.h && shadow.y < top + boardFit.h;
    if (spans) w = Math.min(w, Math.max(0, shadow.x - SHADOW_GAP - BOARD_X));
    board = { x: BOARD_X, y: top, w, h: boardFit.h };
  }

  const bottom = Math.max(
    report.y + report.h,
    board === null ? 0 : board.y + board.h,
  );
  const buttonY = clamp(bottom + BUTTON_GAP_Y, BUTTON_Y_MIN, BUTTON_Y_MAX);
  const replay: Rect = { x: REPORT_X, y: buttonY, w: BUTTON_W, h: BUTTON_H };
  const proceed: Rect = {
    x: REPORT_X + BUTTON_W + BUTTON_GAP_X,
    y: buttonY,
    w: BUTTON_W,
    h: BUTTON_H,
  };

  return {
    report,
    reportContent: stack(
      REPORT_X + PANEL_PAD_X,
      reportFit.contentTop,
      REPORT_W - PANEL_PAD_X * 2,
      input.report,
      reportFit.gap,
    ),
    board,
    boardContent:
      board === null
        ? []
        : stack(
            board.x + PANEL_PAD_X,
            boardFit.contentTop,
            board.w - PANEL_PAD_X * 2,
            input.board,
            boardFit.gap,
          ),
    replay,
    proceed,
    hint: { x: proceed.x + proceed.w + BUTTON_GAP_X, y: buttonY + 20 },
    shadow,
  };
}
