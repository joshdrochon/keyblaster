import { BACK_CORNER_BOTTOM, GUTTER, HEADING_TOP, backCorner } from "@game/ui/grid";
import { CONSOLE_STRIP, consoleStripBelow } from "@game/ui/controlSurfaceLayout";
import type { Rect } from "@game/ui/layout";
import { DESIGN_WIDTH, GAME_HEIGHT } from "@game/sceneKeys";
import { SPACE } from "@game/ui/theme";

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
  /**
   * WHICH RUN OF THE COLUMN THIS ROW BELONGS TO (UR-58).
   *
   * The header run - the eyebrow, the planet's name, the chapter - shares its
   * line with Shadow, who now stands in the page's top-right corner. Those rows
   * are therefore wrapped to `headerColumnWidth()` and the run as a whole is
   * floored at the height of the box he occupies, so the first sentence starts
   * below him whatever a stop's copy or a language's line box does.
   *
   * It is declared per row rather than inferred from an id, because inferring
   * it would mean this module knowing that a sentence's id starts with
   * "sentence". Only a LEADING run counts; a header row after a body row is
   * treated as body, so the notch cannot be opened twice.
   */
  readonly group?: "header" | "body";
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
 * footer. He is in the page's top-right corner now (UR-58), where the room he
 * takes is reserved by `SHADOW_NOTCH` inside the flow instead of by shortening
 * the plate.
 *
 * 988 IS NOT AVAILABLE TO BE LOWERED. `hi/neptune` flows an 837 px column with
 * its gaps already squeezed to the 0.35 floor, and 988 - 84 - 64 is 840: three
 * pixels of slack. Anything the foot of this screen needs has to come out of
 * the 92 px below it, which is what sizes the launch button (standards rule 8 -
 * the bar does not move to make a number pass).
 */
export const PAGE_MAX_BOTTOM = 988;

/** How far the gaps may be squeezed before the page has to grow instead. */
export const GAP_FLOOR_SCALE = 0.3;

/** The type column inside the plate. */
export function columnWidth(): number {
  return PAGE_W - PAD_X * 2;
}

/**
 * The column the HEADER run is wrapped to: the full column, less the corner
 * Shadow stands in and the air beside him (UR-58).
 *
 * The body keeps the full width. He is only ever level with the three short
 * lines at the top - the eyebrow, the planet's name and the chapter - and
 * narrowing 740 to 593 costs none of them a line in any shipped language,
 * which `briefingLayout.test.ts` checks across all 21 stop/language pairs
 * rather than at the one stop a capture boots (standards rule 5).
 */
export function headerColumnWidth(): number {
  return columnWidth() - SHADOW_NOTCH.w - SHADOW_NOTCH.gap;
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

/** How many rows are in the LEADING header run. */
function headerRun(rows: readonly Rows[]): number {
  let n = 0;
  while (n < rows.length && rows[n]?.group === "header") n += 1;
  return n;
}

/**
 * The column, flowed: every row's top, relative to the column's own top.
 *
 * ONE FUNCTION, USED TWICE. The fit search and the placement pass used to be
 * two loops with the same arithmetic written out twice; adding the notch to one
 * of them and not the other would put a row where the search said it would not
 * go. They read the same offsets now, so they cannot disagree.
 */
function flow(rows: readonly Rows[], scale: number): { tops: number[]; height: number } {
  const header = headerRun(rows);
  const tops: number[] = [];
  let y = 0;
  for (const [i, row] of rows.entries()) {
    tops.push(y);
    const gap = i === rows.length - 1 ? 0 : Math.round(row.gapAfter * scale);
    y += row.height + gap;
    // THE NOTCH IS A FLOOR ON THE HEADER RUN, not a box the body is asked to
    // dodge. Reserving it here means the fit search sees the same column the
    // placement pass draws, so a stop whose header is shorter than Shadow is
    // reported as overflow rather than printed through him.
    if (header > 0 && i === header - 1) y = Math.max(y, SHADOW_NOTCH.h + gap);
  }
  const last = rows[rows.length - 1];
  const lastTop = tops[tops.length - 1];
  return {
    tops,
    height: last === undefined || lastTop === undefined ? 0 : lastTop + last.height,
  };
}

function columnHeight(rows: readonly Rows[], scale: number): number {
  return flow(rows, scale).height;
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

  const laidOut = flow(rows, gapScale);
  const height = laidOut.height;
  const pageH = Math.min(
    PAGE_MAX_BOTTOM - PAGE_TOP,
    Math.max(PAGE_MIN_H, height + PAD_Y * 2),
  );
  const page: Rect = { x: PAGE_X, y: PAGE_TOP, w: PAGE_W, h: pageH };

  const header = headerRun(rows);
  const placed: PlacedRow[] = rows.map((row, i) => ({
    ...row,
    x: PAGE_X + PAD_X,
    y: PAGE_TOP + PAD_Y + (laidOut.tops[i] ?? 0),
    w: i < header ? headerColumnWidth() : columnWidth(),
  }));

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
/**
 * EVERY NUMBER HERE IS `ui/controlSurfaceLayout.CONSOLE_STRIP`'s NOW (UR-77).
 *
 * The height and the lamp count used to be declared on this screen, which is
 * how the Pre-flight came to keep a 76 px version of the same object after
 * UR-61 raised this one to 124. Two screens that must agree read one
 * declaration; the box is derived from each screen's own glass.
 */
export const SHELF = {
  ...consoleStripBelow(WINDOW),
  lamps: CONSOLE_STRIP.lamps,
} as const;

/** The strip's box, for the shared control surface that dresses it. */
export function controlStrip(): Rect {
  return consoleStripBelow(WINDOW);
}

// ---------------------------------------------------------------------------
// The two actions (UR-27, placed by UR-60)
// ---------------------------------------------------------------------------

/**
 * LAUNCH IS THE FOCUS: bottom of the screen, on its centre line (UR-60).
 *
 * ================== WHAT THIS SUPERSEDES ==================
 * UR-27 put a way back on the screen at all, because a player could open a
 * planet and find none: Escape always worked and was invisible, and a child who
 * arrived by clicking had no pointer route out. UR-50.1 then pulled that chip
 * out of the top-right corner and stacked it directly over launch, on the
 * grounds that a question and its answer should not be 820 px apart.
 *
 * UR-60 revises the second of those DELIBERATELY, and only the placement half.
 * Two plates of similar weight in one stack read as a pair of choices; the
 * screen has one forward action and a way out, which is not a pair. So they are
 * separated on purpose: launch alone on the screen's centre line, the way out
 * small and parked on the left gutter. The chip stays a real, labelled,
 * keyboard- and pointer-reachable control, which is all UR-27 ever asked for.
 *
 * ================== WHY 68 px TALL AND NOT 92 ==================
 * Measured, not chosen. The page may reach y 987 (`es/neptune`, and `hi/earth`
 * and `hi/mars` within a pixel of it) and the artboard ends at 1080, so the band
 * this button lives in is 93 px. The FOCUS RING is what spends it: it is drawn
 * outside the control and its halo is wider again, so a 68 px button at y 998
 * puts ring and halo inside 987..1080 with the plate itself 30 px clear of the
 * page. A 92 px button would fit only by letting the ring run off the bottom of
 * the frame or through the page, and neither is a trade worth making for 24 px
 * of plate - the button is the widest thing on the screen's foot and the only
 * thing on its centre line, which is what makes it the focus.
 */
/**
 * THE LINE BOTH ACTIONS REST ON (UR-76).
 *
 * The two controls used to be centred on EACH OTHER - `BACK_CHIP.y` was
 * `LAUNCH.y + (LAUNCH.h - 48) / 2` - which is the right idea and the wrong
 * axis. Centring two boxes of different heights puts the taller one's bottom
 * closer to the edge of the screen than the shorter one's: launch ended 14 px
 * off the artboard's foot against the chip's 24 px, and once launch wears the
 * focus ring it is the first thing on the screen a child looks at, so it was
 * the crowding they saw. Reported by the project owner against this screen.
 *
 * So the shared quantity is the BOTTOM, not the middle. One named line, and
 * both controls derive from it, which is also what makes it testable: an
 * element's distance from the foot of the screen is now a property of the row
 * rather than an accident of two independently chosen heights.
 *
 * THE CHIP DID NOT MOVE. The line IS where the chip already sat (1008 + 48),
 * because the chip was the one that looked right - launch is what comes to it.
 *
 * C19 THEN MOVED THE CHIP TO THE TOP-RIGHT CORNER, so this line now governs
 * launch alone. The NUMBER is deliberately unchanged: it was derived from where
 * the chip sat, launch's clearance from the page above it and from the foot of
 * the artboard is what it actually holds, and re-deriving it from the one
 * control left on it would move the only control the owner did not complain
 * about. See `backChip` below.
 *
 * ================== UR-101: AND THE NUMBER FINALLY MOVED ==================
 * The project owner reported launch and the back chip as a pair that "bottom
 * out 24 px from the foot of a 1080 frame". Half of that was already untrue,
 * and the untrue half is the whole fix: C19/UR-95 took the chip OFF this line
 * and put it in `ui/grid.backCorner`, whose foot is `BACK_CORNER_BOTTOM` - the
 * hint plate's own bottom edge, 1048. So the chip had 32 px of air, launch had
 * 24, and the two controls the owner named as one row were eight pixels out of
 * line with each other.
 *
 * This line is therefore `BACK_CORNER_BOTTOM` rather than a literal. Launch
 * gets the air, the two controls are genuinely on one line again, and the line
 * is DERIVED from the corner rule so the next time that corner moves this one
 * moves with it instead of being left behind a second time.
 *
 * WHERE THE AIR COMES FROM, MEASURED. Not from above: `es/neptune` flows a page
 * to y 987 and launch's focus ring starts at `LAUNCH.y - 11`, so at `y` 998 the
 * ring's top edge IS 987. There is one pixel of headroom on this screen. The
 * 8 px comes out of the button's height, which is the same trade UR-76 made -
 * see `LAUNCH`.
 */
export const ACTION_BOTTOM = BACK_CORNER_BOTTOM;

/**
 * LAUNCH SHRANK BY 10 px RATHER THAN MOVING UP 10, and that is forced.
 *
 * `PAGE_MAX_BOTTOM` is 988 and launch sits at 998, so there are exactly ten
 * pixels between the page and the button and none of them are spare. Moving
 * launch up to meet `ACTION_BOTTOM` would spend all ten and put the button on
 * the page. Its height is therefore derived from the line it has to reach,
 * which keeps `LAUNCH.y` - and so the page clearance - exactly where the long
 * note above left it.
 *
 * 58 px is still a fifth taller than the chip and three times its area at
 * 420 px wide, so the size argument below is untouched: launch is the widest
 * thing on the screen's foot and the only thing on its centre line.
 *
 * ================== UR-101: 50 px, AND 488 WIDE TO PAY FOR IT ==========
 * `ACTION_BOTTOM` came down 8 px to meet the chip's own foot line, and since
 * `y` is pinned by the page above (there is ONE pixel of headroom on this
 * screen - see the note on `ACTION_BOTTOM`) the height is what pays, exactly as
 * it did last time.
 *
 * THE WIDTH IS NOT A TASTE. UR-60's "launch is the focus" is asserted as "the
 * chip is under half launch's area", and the chip is 224 x 48 = 10_752. At
 * 420 x 50 launch's half-area is 10_500 and that invariant goes RED: the
 * quiet control would be more than half the weight of the forward action. So
 * the button is widened to hold the area it had - 420 x 58 = 24_360 against
 * 488 x 50 = 24_400 - rather than the assertion being relaxed to fit the new
 * number, which is the move `docs/coding-standards.md` rule 8 forbids.
 *
 * 488 is the area-preserving width rounded to the nearest multiple of 4. The
 * MINIMUM that holds the focus invariant is 432, and it was rejected: 4% of
 * margin on a claim about two controls' relative weight is not margin, it is
 * the next silent breakage.
 */
export const LAUNCH = { w: 488, h: ACTION_BOTTOM - 998, y: 998 } as const;

/**
 * THE WAY OUT, SMALL AND ON THE LEFT (UR-60).
 *
 * Quiet is a matter of SIZE, INK and PLACEMENT, and never of the focus ring.
 * The chip is a third of the button's area, printed at caption size in
 * `INK.textDim` on the unlit panel, and parked on the gutter where nothing
 * competes with it - but when it holds focus it wears exactly the ring launch
 * wears, at the same width and the same offset (AC-18.1). A ring narrowed to
 * suit a small control is a control a child cannot find, and the gold ring is
 * the only thing on this screen that says where the keyboard is.
 *
 * On launch's BOTTOM line, so the two actions share a line rather than one
 * floating above the other's shoulder - and share their distance from the foot
 * of the screen, which centring them on each other did not give (UR-76).
 */
export const BACK_CHIP = {
  w: 224,
  h: 48,
} as const;

/**
 * THE CENTRE LINE LAUNCH SITS ON: the middle of the artboard (UR-60).
 *
 * `DESIGN_WIDTH / 2`, NOT `GAME_WIDTH / 2`, and that is a deliberate reading of
 * "centred on the screen" rather than a shortcut. Two facts decide it:
 *
 *  - At every window 16:9 or narrower the two are the SAME NUMBER. `GAME_WIDTH`
 *    is the window's aspect at a pinned 1080 height, floored at `MIN_ASPECT`
 *    (sceneKeys, D99), so it is 1920 for all of them and 960 is the screen's
 *    own centre.
 *  - Past 16:9 they differ, and every other object on this screen - the page on
 *    the gutter, the glass at 1012, the strip under it - is measured against the
 *    artboard. A single element tracking the viewport while its composition does
 *    not is the exact defect `grid-conformance.spec.ts` declares this screen
 *    "fixed" to catch, and it caught this screen's back chip doing it once
 *    already (UR-19). Widening the whole composition is a real change and a
 *    different one; it is in `gauntlet/escalations.md`, not smuggled in here.
 */
export const ACTION_CX = DESIGN_WIDTH / 2;

/**
 * THE CHIP MOVED TO THE PRODUCT'S BACK CORNER: TOP-RIGHT (collision C19).
 *
 * ================== WHAT WAS REPORTED ==================
 * The project owner walked the app and named this as one of two examples of
 * controls landing somewhere different on every page: "back to the map" is
 * top-right on Pre-flight and bottom-left here. Measured on the served build,
 * this chip at (96, 1008) against Pre-flight's at (1562, 84).
 *
 * ================== WHY THIS CORNER AND NOT THAT ONE ==================
 * Bottom-left is the KEYBOARD HINT's line on nine screens (`ui/grid.HINT_TOP`,
 * drawn by `ui/hintLine.drawHint`). One corner holding two different kinds of
 * thing is what makes a corner stop meaning anything, so the hint keeps the one
 * it has on nine screens and the way out takes the empty one. `ui/grid.backCorner`
 * is the single definition and Pre-flight reads the same function.
 *
 * ================== WHAT SURVIVES OF UR-60 ==================
 * Everything except the corner. UR-60 separated the two actions on purpose -
 * launch alone on the screen's centre line, the way out small and quiet - and
 * its reasoning was that two plates of similar weight stacked together read as
 * a pair of choices. A 224x48 chip in `INK.textDim` on `INK.panel`, 924 px away
 * and 924 px up, does not read as launch's pair either, so the argument holds
 * at the new corner. The SIZE and the INK are untouched; `ACTION_BOTTOM` and
 * UR-76's shared-bottom rule now govern launch alone, which is the only control
 * still on that line.
 *
 * ================== WHAT IT COSTS, HONESTLY ==================
 * The chip lands on the cockpit glass. `WINDOW` is (1012, 84, 812x636) and the
 * chip is (1600, 84, 224x48), so 224x48 of the window's top-right corner is
 * covered by an opaque plate. Pre-flight's chip clears its own glass because
 * that window starts at y=170. Logged in `gauntlet/escalations.md` with the
 * alternatives; the corner rule is what the owner asked for and a chip in the
 * corner of a viewport is a familiar place for a way out.
 */
export function backChip(): Rect {
  return backCorner(BACK_CHIP.w, BACK_CHIP.h);
}

export function launchButton(): Rect {
  return {
    x: ACTION_CX - LAUNCH.w / 2,
    y: LAUNCH.y,
    w: LAUNCH.w,
    h: LAUNCH.h,
  };
}

/**
 * The box a focus ring occupies around a control (`lib/kit.createFocusRing`).
 *
 * The ring is drawn OUTSIDE the control, and its soft halo is six px wider
 * again, so "the button fits" and "the ring fits" are different questions. The
 * band under the page is 93 px tall at the longest stop and this is what makes
 * the difference between the two of them measurable rather than eyeballed.
 */
export function focusRingBox(box: Rect): Rect {
  const o = SPACE.focusRingOffset + (SPACE.focusRingWidth + 6) / 2;
  return { x: box.x - o, y: box.y - o, w: box.w + o * 2, h: box.h + o * 2 };
}

/** The foot of the artboard, which the action band has to stay inside. */
export const FRAME_BOTTOM = GAME_HEIGHT;

// ---------------------------------------------------------------------------
// Shadow, in the page's top-right corner (UR-58)
// ---------------------------------------------------------------------------

/**
 * SHADOW DELIVERS THE BRIEFING; HE DOES NOT STAND BESIDE IT (UR-58).
 *
 * He used to stand under the glass on the button row, where he read as an
 * ornament next to a control. In the page's top-right corner he is the figure
 * the page is coming FROM - the same place a dialogue box puts the speaker -
 * which is the read the report asked for and the one the typed reveal (UR-59)
 * depends on to make sense.
 *
 * SMALLER, AND THE SIZE IS DERIVED. The corner he has to fit in is bounded by
 * the first sentence, and the tightest case in the product is `hi/neptune`,
 * whose gaps are squeezed to 0.35 and whose first sentence starts 276 px down
 * the artboard. At scale 0.62 his drawn box is 127 x 147 and ends at 263, which
 * clears it by 13 px; at the 0.78 he was drawn at it would be 185 tall and it
 * would not. The number is therefore a consequence of the copy, and
 * `briefingLayout.test.ts` re-derives it at every stop in every language.
 */
export const SHADOW_SCALE = 0.62;

/** `render/shadow.ts`'s nominal body radius at scale 1. */
const SHADOW_R = 64;

/**
 * The corner the header run gives up to him: his drawn box, plus air.
 *
 * Same multiples as `shadowBox`, which is the model `resultsLayout` uses for
 * the same figure. Derived from the scale rather than typed in, so making him
 * bigger cannot quietly stop reserving room for him.
 */
export const SHADOW_NOTCH = {
  w: Math.ceil(3.2 * SHADOW_R * SHADOW_SCALE),
  h: Math.ceil(3.7 * SHADOW_R * SHADOW_SCALE),
  /** Air between his box and the header type beside it. */
  gap: 24,
} as const;

/**
 * Where he stands: box hard against the right edge of the type column, top
 * against the page's own padding. Both edges are the column's, not new numbers,
 * so he lines up with the type rather than floating near it.
 */
export const SHADOW_AT = {
  x: PAGE_X + PAD_X + columnWidth() - 1.6 * SHADOW_R * SHADOW_SCALE,
  y: PAGE_TOP + PAD_Y + 2.0 * SHADOW_R * SHADOW_SCALE,
  scale: SHADOW_SCALE,
} as const;

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
