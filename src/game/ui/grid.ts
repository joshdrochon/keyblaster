import { DESIGN_WIDTH, GAME_HEIGHT, GAME_WIDTH } from "@game/sceneKeys";
import { SKY_PLATE, SPACE, TYPE } from "./theme.js";

/**
 * THE ONE GRID EVERY SCREEN LAYS OUT AGAINST.
 *
 * ================== WHY IT EXISTS ==================
 * UR-19: the stage report did not read as aligned, and the requirement was that
 * EVERY page follow the same system. That last clause is the defect. Each screen positioned itself from its own
 * constants, so the product had three left margins and four heading heights:
 *
 *   96   the menu kit (`SPACE.gutter`), the Briefing page, the Director map
 *   120  the Pre-flight system rows, the Ending's card margin
 *   160  Results, the Warp break, Beacon placement
 *
 *   y 64 the Results heading      y 68 the map's
 *   y 84 every menu heading       y 96 Warp's and Beacon's
 *
 * Nothing was wrong on any one screen. The product was wrong BETWEEN them: a
 * heading jumped 64 px sideways and 32 px up when you walked from the Beacon
 * Log into the stage report, which is exactly the kind of thing that reads as
 * "not clean" without being nameable.
 *
 * ================== WHY 96 AND NOT 160 ==================
 * Measured, not chosen. The Beacon Log's trophy block is three 340 px tiles
 * plus two 24 px gaps, and it starts one beacon column plus a gap from the left
 * margin: `gutter + 620 + 40`. At a 96 px gutter its right edge lands on 1824,
 * exactly `1920 - 96`. At 160 it needs 2048 and runs off a 16:9 world, which
 * `sceneKeys.MIN_ASPECT` documents as the case AC-18.1 forbids. So the widest
 * screen in the game fixes the gutter for all of them, and the three story
 * screens move in rather than the five menu screens moving out.
 *
 * ================== PLATED TEXT ==================
 * Half the headings in the game are `skyText`, which draws a contrast plate cut
 * from the text's own bounds plus padding. Putting the TEXT on the grid line
 * puts the PLATE 22 px to the left of it, which is what made the Results
 * heading look like it was hugging the corner while the panel under it was not.
 * `headingText()` returns where the TEXT goes so that the PLATE lands on the
 * line; anything drawn without a plate uses the line directly.
 *
 * Nothing here imports Phaser or the DOM. `GAME_WIDTH` is read at call time,
 * never captured: the world widens with the window (D99, sceneKeys.ts).
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

// ---------------------------------------------------------------------------
// The lines
// ---------------------------------------------------------------------------

/** The left and right margin. One number for the whole product. */
export const GUTTER = SPACE.gutter;

/**
 * The top of a screen heading's INK - or of its plate, where it has one.
 *
 * 84 is `MenuScene.addHeading`'s default, i.e. the value five screens already
 * used and the only one of the four that more than one screen agreed on.
 */
export const HEADING_TOP = 84;

/** The top of the line under a heading (the stop name, the map's subtitle). */
export const SUBHEADING_TOP = 168;

/** A third header line, where a screen has one (the map's "1 of 7 lit"). */
export const THIRD_LINE_TOP = 216;

/**
 * The tops of the header block's three lines, in order. A screen uses as many
 * as it has; nothing may start a line the screen above it did not.
 */
export const HEADER_LINES: readonly number[] = [
  HEADING_TOP,
  SUBHEADING_TOP,
  THIRD_LINE_TOP,
];

/**
 * Where content may start once a heading and its subline have been drawn.
 *
 * Two lines, not three: the screens with a third header line (the Director map,
 * Beacon placement) do not put a panel directly under it. `headerBlockBottom`
 * is the honest lower bound for a screen that needs one.
 */
export const CONTENT_TOP = 236;

/**
 * The keyboard hint's line, bottom-left. `MenuScene.addHint` has drawn here
 * since the menu kit landed; the story screens now do too.
 */
export const HINT_TOP = GAME_HEIGHT - 76;

/**
 * The foot line the hint plate and the back chip share (UR-95).
 *
 * The hint's plate is its caption ink plus `SKY_PLATE.padY` at each end; 44 is
 * that box, measured. Named here so the chip and the hint cannot drift apart.
 */
export const BACK_CORNER_BOTTOM = HINT_TOP + 44;

/**
 * THE ONE CORNER A VISIBLE BACK CONTROL LIVES IN: TOP-RIGHT.
 *
 * ================== WHAT WAS REPORTED ==================
 * The project owner: controls are in different places from page to page, and
 * "back to the map" is top-right on Pre-flight and bottom-left on the Briefing.
 * Measured on the served build: Pre-flight's chip at (1562, 84), the Briefing's
 * at (96, 1008). Two screens with a visible way out, two different corners.
 *
 * ================== WHY TOP-RIGHT AND NOT BOTTOM-LEFT ==================
 * The bottom-left corner is already spoken for: it is the keyboard hint's line
 * (`HINT_TOP`, and `ui/hintLine.ts` draws every screen's there). One corner must
 * not hold two different kinds of thing, or "bottom-left" stops meaning anything
 * to a child walking the product. So the hint keeps the corner it has on nine
 * screens and the way out takes the empty one.
 *
 * ================== WHAT THIS OVERRIDES ==================
 * UR-60 parked the Briefing's chip on the left gutter so it would not compete
 * with launch, which sits alone on the screen's centre line. Only the PLACEMENT
 * half is overridden - the chip keeps UR-60's size (224x48) and its `INK.textDim`
 * on `INK.panel`, so it is still the quiet control UR-60 made it, and a chip in
 * the far top-right corner does not compete with a 420 px button on the bottom
 * centre line either. Logged as collision C19 in `docs/decision-log.md`.
 *
 * ================== WHY THE ARTBOARD AND NOT `contentRight()` ==================
 * `DESIGN_WIDTH`, not `GAME_WIDTH`. Both screens that have a chip are declared
 * FIXED compositions by `tests/e2e/grid-conformance.spec.ts` - Pre-flight's
 * cockpit glass ends at 1824 and the Briefing's does too - so a chip that
 * tracked the viewport would fly off the composition it belongs to at a 2560
 * window. That is the exact defect the conformance spec caught this chip doing
 * once already (UR-19). At 16:9 and narrower the two numbers are identical.
 */
export const BACK_CORNER_TOP = HEADING_TOP;

/** The artboard's right margin: what a FIXED composition measures against. */
export const ARTBOARD_RIGHT = DESIGN_WIDTH - GUTTER;

/**
 * Where a back control of this size goes. The size and the ink stay the
 * screen's; the CORNER is the product's.
 */
/**
 * BOTTOM-right, not top-right (UR-95).
 *
 * The corner moved because the top-right one is not free: the Briefing's
 * cockpit glass reaches `ARTBOARD_RIGHT` at `HEADING_TOP`, so a chip there sat
 * ON the window (C19), and Pre-flight's cleared it only because its window
 * happens to start lower. A corner that is only free on some screens is not a
 * shared corner.
 *
 * The foot of the screen is free on both, and it pairs the way out with the
 * hint line that names the key for it: instructions bottom-left, the control
 * bottom-right, one row. `BACK_CORNER_BOTTOM` is the hint plate's own bottom
 * edge, so the two sit on one line however tall either becomes.
 *
 * WHY THE CHIP SURVIVED AT ALL. Escape leaves both screens and the hint says
 * so, which made removing it tempting - but it is the only POINTER route back
 * from either, and a child on a mouse would have had none.
 */
export function backCorner(w: number, h: number): Rect {
  return { x: ARTBOARD_RIGHT - w, y: BACK_CORNER_BOTTOM - h, w, h };
}

// ---------------------------------------------------------------------------
// THE ONE PLACE A PRIMARY ACTION BUTTON SITS
// ---------------------------------------------------------------------------

/**
 * THE FORWARD ACTION'S SIZE AND LINE, FOR EVERY SCREEN THAT HAS ONE.
 *
 * ================== WHAT WAS REPORTED ==================
 * The project owner walked the product and reported the forward action as a
 * control that lands somewhere different on every page - the same report that
 * produced `backCorner` for the way OUT, now made about the way ON.
 * Measured on the served build, the five screens with a single forward action:
 *
 *   Earth activation   centred, 420 x 88 at y 939.6      (GAME_WIDTH / 2)
 *   Beacon placement   LEFT GUTTER, 420 x 64 at y 966    (x = 96)
 *   Briefing           centred, 488 x 50 at y 998        (DESIGN_WIDTH / 2)
 *   Ending             centred, 560 x 76 at y 900
 *   Results            a PAIR, 420 x 64 at x 616 / 1076, y clamped 740..908
 *
 * Five screens, four widths, four heights, four y values and two different
 * horizontal anchors. Nothing is wrong on any one of them; the product is
 * wrong between them, which is the `ui/grid.ts` defect exactly.
 *
 * ================== WHY EARTH'S NUMBERS AND NOT ANOTHER SCREEN'S ==========
 * Taken from Earth activation's launch button, which is the control the
 * report named as the one the others should match. It is also the only one of the five that is
 * centred on the world AND clear of both foot-line corners: the hint plate's
 * band starts at `HINT_TOP` on the left gutter and `backCorner` owns the right,
 * and a 420 px button centred on a 1920 px artboard spans 750..1170, which
 * touches neither.
 *
 * `y` is `Math.round(GAME_HEIGHT * 0.87)`: the same fraction Earth already
 * drew at, rounded, because 939.6 is not a position a second screen can be
 * asked to match. `GAME_HEIGHT` is pinned (D99, `sceneKeys`), so this is 940.
 *
 * ================== WHY IT TAKES A WIDTH ==================
 * `DESIGN_WIDTH` by default, `GAME_WIDTH` on request, and the two are the SAME
 * NUMBER at every window 16:9 or narrower. Past 16:9 they differ, and which one
 * is right is a property of the SCREEN, not of the button:
 * `grid-conformance.spec.ts` declares each screen's anchor model, and a fixed
 * composition (Beacon, Briefing, Results, Ending) measures against the artboard
 * while a centred one (Earth activation) reflows with the world. A button that
 * picked one for everybody would put the element at odds with its own screen,
 * which is the single defect that spec exists to catch.
 */
export const ACTION_BUTTON = {
  w: 420,
  h: 88,
  /** Earth activation's `GAME_HEIGHT * 0.87`, rounded. */
  y: Math.round(GAME_HEIGHT * 0.87),
} as const;

/** The forward action's rectangle, centred on the width its screen is anchored to. */
export function actionButton(width: number = DESIGN_WIDTH): Rect {
  return {
    x: Math.round(width / 2 - ACTION_BUTTON.w / 2),
    y: ACTION_BUTTON.y,
    w: ACTION_BUTTON.w,
    h: ACTION_BUTTON.h,
  };
}

/** The lowest edge of the forward action. Nothing may be drawn below it. */
export const ACTION_BUTTON_BOTTOM = ACTION_BUTTON.y + ACTION_BUTTON.h;

/** Vertical air between two stacked blocks. */
export const BLOCK_GAP = 40;

/** Horizontal air between two columns. */
export const COLUMN_GAP = 40;

// ---------------------------------------------------------------------------
// Derived, at call time
// ---------------------------------------------------------------------------

/** The rightmost x any content may reach. */
export function contentRight(): number {
  return GAME_WIDTH - GUTTER;
}

/** How wide the content column is on this world. */
export function contentWidth(): number {
  return contentRight() - GUTTER;
}

/** The full content column, as a rectangle from the heading down to the hint. */
export function contentBox(): Rect {
  return {
    x: GUTTER,
    y: CONTENT_TOP,
    w: contentWidth(),
    h: HINT_TOP - BLOCK_GAP - CONTENT_TOP,
  };
}

/**
 * Split the content column in two at a ratio, with one gap between.
 *
 * Returns absolute x/w pairs, so a caller never adds a gutter to a width and
 * gets it wrong. `ratio` is the LEFT column's share of the space either side of
 * the gap.
 */
export function twoColumns(ratio: number, gap: number = COLUMN_GAP): [Rect, Rect] {
  const usable = contentWidth() - gap;
  const left = Math.round(usable * Math.min(1, Math.max(0, ratio)));
  const box = contentBox();
  return [
    { x: GUTTER, y: box.y, w: left, h: box.h },
    { x: GUTTER + left + gap, y: box.y, w: usable - left, h: box.h },
  ];
}

// ---------------------------------------------------------------------------
// Plated text
// ---------------------------------------------------------------------------

/**
 * Where a PLATED heading's text object goes, so that its plate's top-left
 * corner lands on the grid.
 *
 * The padding defaults are `SKY_PLATE`'s, which is what `skyText` uses unless a
 * caller overrides them - and callers do override `padY`, so it is a parameter
 * rather than a constant.
 */
export function headingText(padX: number = SKY_PLATE.padX, padY: number = SKY_PLATE.padY): Point {
  return { x: GUTTER + padX, y: HEADING_TOP + padY };
}

/**
 * Where line `i` of the header block's plated text goes. `0` is the heading.
 */
export function headerText(
  line: number,
  padX: number = SKY_PLATE.padX,
  padY: number = SKY_PLATE.padY,
): Point {
  const top = HEADER_LINES[Math.min(Math.max(line, 0), HEADER_LINES.length - 1)];
  return { x: GUTTER + padX, y: (top ?? HEADING_TOP) + padY };
}

/** The same, for the line under a heading. */
export function subheadingText(
  padX: number = SKY_PLATE.padX,
  padY: number = SKY_PLATE.padY,
): Point {
  return { x: GUTTER + padX, y: SUBHEADING_TOP + padY };
}

/** The same, for the keyboard hint at the foot of a screen. */
export function hintText(
  padX: number = SKY_PLATE.padX,
  padY: number = SKY_PLATE.padY,
): Point {
  return { x: GUTTER + padX, y: HINT_TOP + padY };
}

/**
 * The lowest a plated heading's plate reaches, for a screen that has to keep
 * something else clear of it.
 *
 * `TYPE.heading` at the Latin line height plus both paddings. Devanagari is
 * taller, which `SUBHEADING_TOP` at 168 already absorbs.
 */
export function headingBottom(padY: number = SKY_PLATE.padY): number {
  return HEADING_TOP + Math.round(TYPE.heading * 1.3) + padY * 2;
}

/**
 * The lowest edge of a two-line header block: heading plus the line under it.
 *
 * This is the highest a panel may ride up to (the stage report pulls its top
 * edge up to hide the stop's sun), so it is the number that keeps a card from
 * being drawn through the stop's name.
 */
export function headerBlockBottom(padY: number = SKY_PLATE.padY): number {
  return SUBHEADING_TOP + Math.round(TYPE.body * 1.3) + padY * 2;
}

// ---------------------------------------------------------------------------
// The header and the hint, as a CONTRACT (UR-19)
// ---------------------------------------------------------------------------

/**
 * WHAT "FOLLOWING SUIT" ACTUALLY MEANS, as three checkable claims.
 *
 * UR-19 asked that EVERY page follow one system. This module's first pass
 * answered half of it: one gutter, one heading line, and a source
 * guard against literal coordinates. A blind critic then measured the product
 * and found that necessary was not sufficient -
 *
 *   HEADER   shared by 4 screens of 9. Map, Warp, Beacon and Results agree on a
 *            44 px title whose plate starts at (96, 84). Briefing uses a 20 px
 *            eyebrow over a 44 px title; Earth activation a 24 px centred chip;
 *            the Ending 72 px centred; PRE-FLIGHT HAS NOTHING above y=320.
 *   HINT     six different x positions and four different y values, and three
 *            screens with no hint at all.
 *   ANCHOR   Map reflows with the world; Title, Pre-flight and Ending do not,
 *            so their right margin runs from 845 to 1485 at a 2560 window.
 *
 * None of that was assertable, because "does any text overlap" - which is what
 * the UR-20 sweep asks - is a question a blank wireframe passes. These three
 * constants are what a screen is measured against instead, and
 * `tests/unit/ui/gridConformance.test.ts` measures every screen against them
 * with a named, shrinking list of the ones that do not yet comply.
 */
export const HEADER_CONTRACT = {
  /** The top-left corner of a screen title's PLATE, or of its ink if unplated. */
  origin: { x: GUTTER, y: HEADING_TOP },
  /** How far a title may sit from that corner and still count as on it. */
  tolerance: 6,
} as const;

/**
 * The band a screen's keyboard hint lives in.
 *
 * A BAND, not a line: `MenuScene.addHint` draws its ink at `HINT_TOP` and the
 * story screens draw a plate whose ink sits a few px lower, so demanding one y
 * would fail screens that are doing the right thing. The x is exact, because
 * there is no reason for two screens to start their instructions at different
 * left edges.
 */
export const HINT_CONTRACT = {
  x: GUTTER,
  top: HINT_TOP,
  /** Ink may start anywhere in this many px below `top`. */
  slack: 28,
} as const;
