import { GAME_HEIGHT, GAME_WIDTH } from "@game/sceneKeys";
import { INK, LINE_HEIGHT, SKY_PLATE, SPACE, STEP, TYPE } from "@game/ui/theme";
import { layer } from "@game/render/layers";
import { paletteAt } from "@game/render/palette";
import { contrastRatio } from "@engine/contrast/index.js";
import {
  GUTTER,
  HEADING_TOP,
  HINT_TOP,
  contentRight,
  contentWidth,
} from "@game/ui/grid";
import { KEEP_CLEAR_PAD, keepClear, type KeepClearShape } from "@game/render/keepClear";
import {
  LANTERN_ABOVE_ORIGIN,
  LANTERN_DESIGN_HEIGHT,
  lanternDesignBox,
} from "@game/render/lanternGeometry";
import { STOP_IDS, type StopId } from "@engine/types";
import type { StopView } from "@engine/progress/index.js";

/**
 * THE DIRECTOR MAP'S GEOMETRY, with no Phaser in it.
 *
 * `DirectorMapScene` draws from these and nothing else, so three user reports
 * against this screen can be held by a unit test instead of by a screenshot:
 *
 *   UR-52  decorative debris drew over the planets (a black rock across Mars).
 *   UR-53  the Lantern should hover above the CURRENT planet. There was no ship
 *          on this screen at all.
 *   UR-54  the travel label did not line up with the three stars, and the board
 *          at the foot did not share the heading's left edge.
 *
 * Everything below is read at CALL TIME where it depends on the world's width
 * (D99, `sceneKeys.ts`): a module-level `const` off `GAME_WIDTH` freezes 1920
 * before `bootGame` has measured the window.
 */

// ---------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------

/**
 * The route's y.
 *
 * ================== WHY IT MOVED FROM 430 (UR-53) ==================
 * The Lantern hovers above the selected planet, and it has to fit between two
 * things that were already there: the header block's third line ("n of 7
 * beacons lit"), whose plate bottom is `headerBlockBottom()`, and the selected
 * stop's beacon lamp, whose halo reaches `LAMP_HALO_MAX` above the disc. At
 * y=430 that gap was 258 -> 368, i.e. 60 px, and a 60 px Lantern on a 1080 px
 * frame is a speck rather than a ship.
 *
 * 500 opens the gap to 258 -> 388 and still leaves 24 px between the lowest
 * thing hanging off a node (its star row) and the top of the board. It also
 * centres the node row better in the band between the header and the board,
 * which is the "everything lined up nicely" half of UR-54.
 *
 * `mapLayout.test.ts` asserts both clearances rather than trusting this note.
 */
export const ROUTE_Y = 500;

/**
 * The route's left end, and by symmetry its right.
 *
 * NOT the grid gutter, and that is deliberate. Every other left edge on this
 * screen is `GUTTER` (96). A node is not a left edge: it is a disc with a
 * CENTRED caption plate under it, and the caption is wider than the disc. At
 * x=96 Earth's caption would start off the left of the frame. 210 is the inset
 * that keeps a centred caption inside the world, and the row stays symmetric
 * about the frame's centre line, which is what makes it read as a route.
 */
export const ROUTE_X0 = 210;
export const routeX1 = (): number => GAME_WIDTH - ROUTE_X0;

export const NODE_R = 46;
/** The dark rim drawn behind the planet disc, so the disc reads off the sky. */
export const NODE_RIM = 8;

/** Spacing between two adjacent stops. */
export const nodeStep = (): number => (routeX1() - ROUTE_X0) / (STOP_IDS.length - 1);

/** Where stop `i` sits. The ONE derivation; the discs, the focus ring, the
 *  keep-clear zones and the ship all read it. */
export const nodeX = (i: number): number => ROUTE_X0 + nodeStep() * i;

// ---------------------------------------------------------------------------
// The beacon lamp
// ---------------------------------------------------------------------------

/** How far the lamp floats above the planet's limb (see DirectorMapScene). */
export const LAMP_RISE = 16;
/** `drawBeacon`'s outermost halo: `fillCircle(lx, ly, 34 + 16 * strength)`. */
export const LAMP_HALO_MAX = 50;

export const lampY = (): number => ROUTE_Y - NODE_R - LAMP_RISE;

// ---------------------------------------------------------------------------
// The caption and the star row under a node
// ---------------------------------------------------------------------------

/** Ink top of the caption, measured from the disc's limb. */
export const CAPTION_GAP = 26;
export const STAR_R = 14;

/**
 * The caption's own plate padding, as `DirectorMapScene` draws it.
 *
 * DECLARED HERE RATHER THAN AT THE CALL SITE because three things now measure
 * off it - the keep-clear zone, the star row and the focus ring's box - and a
 * pad that lives in the `skyText` options object is a number only the drawing
 * knows. `SKY_PLATE.padY` is 12; this caption has always drawn 8, and the
 * difference used to be absorbed silently by `captionPlateH` over-estimating.
 */
export const CAPTION_PAD_X = 16;
export const CAPTION_PAD_Y = 8;

/** One drawn line of the caption, at `TYPE.label` on the shared line height. */
export const CAPTION_LINE_H = Math.round(TYPE.label * 1.56);

/**
 * THE CAPTION IS ONE LINE.
 *
 * ================== WHY IT WAS TWO ==================
 * It was the stop's name and, under it, a status word: "Locked" on a locked
 * stop, "Beacon Lit" on a charted one. Both were removed:
 *
 *   "Locked"      is now a LOCK MARK beside the name (`LOCK_SIZE` below, drawn
 *                 by `ui/chrome.paintLockGlyph`). A word that repeats for six
 *                 of seven stops is a column of the same word, not a status.
 *   "Beacon Lit"  is gone outright. There is a lit beacon DRAWN over a charted
 *                 planet already; the caption said the picture again.
 *                 `map.charted` stays in the string table - it is still the
 *                 right English for the idea, and nothing is gained by
 *                 deleting a translated line to prove a screen stopped using
 *                 it - it simply has no reader on this screen.
 *
 * The height is declared rather than measured: the parallax is built before the
 * type is, so a zone that depended on the drawn bounds would have to be
 * recomputed after the fact - the same trap `titleLayout.ts` documents. The
 * FOCUS RING does measure, because it is built after the type and even air is
 * the whole point of it (`nodeRingBox`).
 */
export const CAPTION_LINES = 1;
export const captionPlateH = (): number => CAPTION_LINE_H * CAPTION_LINES + CAPTION_PAD_Y * 2;

/** Top edge of the caption's plate. */
export const captionPlateTop = (): number => ROUTE_Y + NODE_R + CAPTION_GAP - CAPTION_PAD_Y;
/** Bottom edge of the caption's plate. */
export const captionPlateBottom = (): number => captionPlateTop() + captionPlateH();

/**
 * THE LOCK MARK, which replaced the word "Locked".
 *
 * Size off the TYPE scale and gap off the SPACING scale, not off two numbers
 * picked beside the label - that is the rule `theme.ts` states and the reason
 * `SPACE.rowPadX` cost an hour. `TYPE.caption` (20) against a `TYPE.label` (24)
 * word is the same one-step-down relationship the header block uses between its
 * heading and its subheading, so the mark reads as belonging to the name rather
 * than as a second thing beside it.
 *
 * The ink is `INK.textDim`: the SAME token the locked caption's own text uses,
 * so the mark and the word it sits beside are one colour and D31 holds - this
 * is "not yet", said quietly, never a refusal drawn in red.
 */
export const LOCK_SIZE = TYPE.caption;
export const LOCK_GAP = STEP.hair;
/** How much horizontal room the mark and its gap take from the name. */
export const lockAdvance = (): number => LOCK_SIZE + LOCK_GAP;

/**
 * Centre of the per-stop star row, measured from the disc's limb.
 *
 * DERIVED FROM THE CAPTION, not a number of its own. It was 116, which cleared
 * a TWO-line caption plate; the caption is one line now, so a literal here
 * would have left a 37 px hole under every charted stop and the screen would
 * have read as though something had failed to draw. One unit of air
 * (`SPACE.gap`) between the plate's bottom edge and the top of a star.
 */
export const STAR_ROW_GAP =
  CAPTION_GAP - CAPTION_PAD_Y + captionPlateH() + SPACE.gap + STAR_R;

/** The lowest ink hanging off a node: the star row's bottom edge. */
export const nodeBlockBottom = (): number => ROUTE_Y + NODE_R + STAR_ROW_GAP + STAR_R;

// ---------------------------------------------------------------------------
// UR-105: the discs drew UNDER the mote plane
// ---------------------------------------------------------------------------

/**
 * THE DEPTH THE MAP'S OWN INK DRAWS AT.
 *
 * ================== WHAT WAS REPORTED ==================
 * A gold accent diamond sat ON Saturn's disc. It is the same family of defect
 * as UR-52 and it survived UR-52's fix, because `mapKeepClear` only steers the
 * things that ASK for it: `parallax.ts` passes `keepClear` to the four DEBRIS
 * planes and NOT to `nearField`'s light tile (the motes, glints and accent
 * diamonds), which is drawn at `NEAR_LIGHT_DEPTH` - a hair under `nearField`,
 * i.e. 4.99. The discs drew at 4. So the diamond was genuinely in front of the
 * planet and no zone was ever going to move it.
 *
 * FIXED AT THE LAYER, not on the sprite. The map's own ink now draws ABOVE
 * every plane this screen decorates, read out of `render/layers.ts` rather than
 * typed here, so a plane that moves in that table takes this with it. It stays
 * BELOW `shipFx` (6), which is where the Lantern and the beacon lamps are and
 * where they belong: the ship passes in front of the planet it hovers over.
 */
export const NODE_DEPTH = layer("nearField").depth + 0.5;
/** The route line, immediately under the discs it joins. */
export const ROUTE_DEPTH = NODE_DEPTH - 0.1;

/**
 * The selected planet's glow (UR-92), which replaced the focus ring.
 *
 * Under the disc, so the planet sits on its own halo rather than inside a
 * coloured box. Three soft rings with a squared falloff, reaching `GLOW_REACH`
 * past the disc - wide enough to read as light and too soft to read as an
 * outline, which is the whole reason the ring went.
 */
export const GLOW_DEPTH = NODE_DEPTH - 0.05;
export const GLOW_RINGS = 16;
export const GLOW_REACH = 34;
export const GLOW_ALPHA = 0.30;
/** A locked stop still shows selection, quietly: looking is not unlocking. */
export const GLOW_ALPHA_LOCKED = 0.24;

// ---------------------------------------------------------------------------
// The focus ring's box
// ---------------------------------------------------------------------------

/** Air between the node's ink and the focus ring's box, on all four sides. */
export const RING_PAD = STEP.tight;

/**
 * THE FOCUS RING WRAPS THE DISC AND THE NAME PLATE AS ONE BOX.
 *
 * It was `{ x: n.x - NODE_R - 14, y: ROUTE_Y - NODE_R - 14, w/h: (NODE_R+14)*2 }`
 * - a square around the disc alone. That was defensible while the status word
 * made the caption a block of its own; with the caption down to one line the
 * name reads as the node's label, and a ring that stops above it says the name
 * is not part of the thing being chosen.
 *
 * THE CAPTION'S WIDTH IS MEASURED, NOT DECLARED. Every other number on this
 * screen is declared because the parallax is built before the type is - but
 * this box is built in `create()` AFTER the captions are drawn, and "even air
 * on all four sides" is a claim about the drawn plate, not about an upper
 * bound. "Neptune" and "Mars" are not the same width; a declared half-width
 * would give one of them even air and the other a margin.
 *
 * The disc is measured to its DARK RIM (`NODE_R + NODE_RIM`), which is the
 * planet's drawn edge - the old box was struck off `NODE_R`, so its 14 px of
 * air was really 6.
 */
export function nodeRingBox(
  i: number,
  caption: { readonly halfW: number; readonly bottom: number },
): PanelBox {
  const discEdge = NODE_R + NODE_RIM;
  const halfW = Math.max(discEdge, caption.halfW) + RING_PAD;
  const top = ROUTE_Y - discEdge - RING_PAD;
  return {
    x: nodeX(i) - halfW,
    y: top,
    w: halfW * 2,
    h: caption.bottom + RING_PAD - top,
  };
}

/** The declared caption box, for the zones and for a test with no Phaser. */
export const captionBoxDeclared = (): { halfW: number; bottom: number } => ({
  halfW: nodeStep() / 2,
  bottom: captionPlateBottom(),
});

// ---------------------------------------------------------------------------
// The mission badge (replaced the three header plates)
// ---------------------------------------------------------------------------

/**
 * ONE BADGE WHERE THREE PLATES WERE.
 *
 * ================== WHAT WAS REPORTED ==================
 * The top-left of this screen was three stacked sky plates - "Route to Pluto",
 * "Seven stops, one lit path" and "6 of 7 beacons lit" - and the owner reported
 * it as TOO BUSY. Three objects, three plates, three edges, all saying one
 * thing: which route this is and how far along it the child is.
 *
 * It is one status badge now: a mission line, a goal line, and a segmented bar
 * with one segment per beacon.
 *
 *   OLD  three plates spanning y 84..263, with air between them
 *   NEW  one card, y 84..236
 *
 * ================== WHAT THE BADGE IS NOT ==================
 * ITS BORDER IS `INK.line`, NEVER THE ACCENT. The reference mock draws a glow
 * border in the stop gold; that is the treatment that made the Title's buttons
 * read as double-ringed, and the rule that fixed three separate bugs is that
 * THE ACCENT IS THE FOCUS LANGUAGE - a control does not paint itself in it.
 * `BADGE_PLATE` is the whole surface, declared here, so a scene cannot reach
 * past it and a test can assert the ink without a browser.
 *
 * IT IS OPAQUE, like the board at the foot of the screen and for the same
 * reason (`lib/kit.plate`): a card this size shows the sky behind it as a
 * SHAPE rather than as a tint.
 *
 * IT STARTS ON THE GUTTER. Its plate corner is `(GUTTER, HEADING_TOP)` and its
 * ink column is `headingText()` - the same two numbers the three plates landed
 * on, which is what keeps `grid-conformance`'s header origin met and keeps the
 * badge, the board and the hint on ONE left edge (UR-54).
 */
export const BADGE_PLATE = {
  fill: SKY_PLATE.fill,
  /** Opaque: this is a card, not a sheet of glass over one line of type. */
  alpha: 1,
  /** NOT `INK.accent`. See above. */
  stroke: INK.line,
  strokeAlpha: 0.9,
  radius: SPACE.radius,
} as const;

// A card's insets, not the heading plate's: this is a card.
export const BADGE_PAD_X = STEP.pad;
export const BADGE_PAD_Y = STEP.unit;

/**
 * The badge's three rows, top to bottom.
 *
 * The mission line keeps `TYPE.heading`. It is the screen's TITLE as well as
 * the badge's first row, and four other screens (Warp, Beacon, Results,
 * Pre-flight) draw theirs at 44 on the same grid line - shrinking this one
 * would make the hub's title smaller than every screen it leads to, which is a
 * product-wide type decision rather than a header cleanup. The compactness
 * comes from collapsing three plates into one card, not from the title.
 */
export const BADGE_MISSION_SIZE = TYPE.heading;
/** The goal line, the count beside it, and the bar's row. One step down. */
export const BADGE_LINE_SIZE = TYPE.caption;

/**
 * A drawn line's height, DECLARED at the Devanagari multiplier.
 *
 * The same rule `CAPTION_LINE_H` follows: the plate is painted before the type
 * is measured, so a row declared at the Latin height would be overflowed by
 * Hindi - whose ink box is 1.23x Latin's (`theme.LINE_HEIGHT`) - and the goal
 * line would be drawn through the mission line above it.
 */
export const badgeLineH = (size: number): number =>
  Math.round(size * LINE_HEIGHT.devanagari);

/** Mission to goal: the smallest step, because they are one block. */
export const BADGE_ROW_GAP = STEP.hair;
/** Goal to bar: one step more, because the bar is a different kind of thing. */
export const BADGE_BAR_GAP = STEP.tight;

/**
 * THE SEGMENTED BAR, AND WHERE ITS TREATMENT COMES FROM.
 *
 * The owner asked for the pre-flight ceremony's system bars to be reused
 * rather than a second bar invented. Those are 8 px tall with a 4 px radius, a
 * track in `INK.line` and a fill in the stop's accent (`PreflightScene.paintRow`)
 * - and they are a SMOOTH fill, not segmented, which is the one thing this bar
 * cannot copy: the unit here is a beacon and a child has to be able to count
 * seven of them. So the height, the radius and the fill-on-track idea are the
 * pre-flight bar's; the division into seven is this screen's.
 *
 * ONE SEGMENT PER STOP, derived from `STOP_IDS` rather than from a literal 7,
 * so a route that gains a stop gains a segment instead of lying.
 *
 * A SEGMENT IS A PILL, WHICH IS HOW IT REACHES THE SHARED COMPONENT.
 * `plate.paintPlate` with `corner: "pill"` rounds to half the shorter side, so
 * an 8 px segment is drawn at a 4 px radius - the pre-flight bar's radius,
 * arrived at by construction rather than retyped. It also keeps this screen off
 * `arch/platePainters.test.ts`'s allowlist: the Title's accent rule and the
 * briefing's ribbon left that list by becoming pills, and a third entry reading
 * "a mark, not a surface" would be the component not being used.
 */
export const BAR_H = 8;
export const SEG_GAP = STEP.hair;
export const SEG_W = 52;
export const barWidth = (): number =>
  SEG_W * STOP_IDS.length + SEG_GAP * (STOP_IDS.length - 1);

/**
 * The badge's width: the bar's, plus the padding either side.
 *
 * DERIVED FROM THE BAR because the bar is the one row whose width is a
 * declaration rather than a measurement - the two text rows are as wide as
 * their translations. 412 px of ink holds "Mission: Pluto" at 44 px (~320 px
 * drawn) with room to spare, and `map.spec.ts` measures the DRAWN rows against
 * this box in the browser rather than trusting that sentence.
 */
export const BADGE_W = barWidth() + BADGE_PAD_X * 2;

export const badgeInkLeft = (): number => GUTTER + BADGE_PAD_X;
export const badgeInkRight = (): number => GUTTER + BADGE_W - BADGE_PAD_X;

/** Row 1: the mission line's ink top. `grid.headingText()`, by construction. */
export const badgeMissionY = (): number => HEADING_TOP + BADGE_PAD_Y;
/** Row 2: the goal line, and the count that flows after it. */
export const badgeGoalY = (): number =>
  badgeMissionY() + badgeLineH(BADGE_MISSION_SIZE) + BADGE_ROW_GAP;
/** Row 3: the bar. */
export const badgeBarY = (): number =>
  badgeGoalY() + badgeLineH(BADGE_LINE_SIZE) + BADGE_BAR_GAP;

export const badgeBox = (): PanelBox => ({
  x: GUTTER,
  y: HEADING_TOP,
  w: BADGE_W,
  h: badgeBarY() + BAR_H + BADGE_PAD_Y - HEADING_TOP,
});

/**
 * The gap between the goal line and the count that follows it on its row.
 *
 * `STEP.unit` EXACTLY, and it is load-bearing twice over. It is the product's
 * vertical unit used as a horizontal one, which is what the scale is for - and
 * it is also `alignment.RUN_GAP`, so the label, the sentence and the count
 * coalesce into ONE laid-out run and the row is judged on the run's left edge
 * (118) rather than on three. A count right-anchored on the badge's own right
 * edge would be a fourth off-model element on this screen, which
 * `left-edge-conformance.spec.ts` budgets at three.
 */
export const BADGE_COUNT_GAP = STEP.unit;
/** Between the "Goal:" label and the sentence it introduces: inside one line. */
export const BADGE_LABEL_GAP = STEP.hair;

export interface BarSegment {
  readonly stopId: StopId;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Is this stop's beacon lit? Read from the route, never counted twice. */
  readonly lit: boolean;
}

/**
 * The seven segments, left to right, in the route's own order (`STOP_IDS`).
 *
 * IT TAKES THE ROUTE VIEW, so the bar and the discs cannot disagree. The header
 * used to count `isCharted` while the labels read `unlockedStops`, and the
 * capture that came back said "7 of 7 beacons lit" over seven stops labelled
 * "Locked" (see `DirectorMapScene.create`). One derivation, passed in.
 *
 * Matched BY STOP ID rather than by index: `routeView` returns `STOP_IDS`'
 * order today, and a bar that silently depends on that is a bar that lights the
 * wrong beacon the day it does not.
 */
export function barSegments(view: readonly StopView[] = []): BarSegment[] {
  const y = badgeBarY();
  return STOP_IDS.map((stopId, i) => ({
    stopId,
    x: badgeInkLeft() + i * (SEG_W + SEG_GAP),
    y,
    w: SEG_W,
    h: BAR_H,
    lit: view.find((v) => v.stopId === stopId)?.charted ?? false,
  }));
}

/**
 * A GRAPHIC HAS TO BE VISIBLE TO MEAN ANYTHING: 3:1, WCAG 2.1's non-text bar.
 *
 * Text on this screen is held to 4.5:1 (AC-22.8) and a segment is not text, but
 * a segment nobody can see is a beacon the bar does not report.
 */
export const SEGMENT_MIN_RATIO = 3;

/**
 * THE INK A LIT SEGMENT IS PAINTED IN: THE STOP'S OWN COLOUR.
 *
 * Earth gold, Mars rust, Saturn's planet gold. Measured on the badge's own
 * fill, every stop clears the bar comfortably in BOTH palettes - the lowest is
 * Mars at 6.71:1 in normal mode and Neptune at 10.97:1 in colourblind mode - so
 * the tint holds up and the bar reads as this route rather than as a generic
 * meter.
 *
 * ================== IT IS `accent`, AND THAT IS LOAD-BEARING ==================
 * `paletteAt(...).accent` is the PLATE accent, legible on `#0E1116` by
 * construction. `worldAccent` is the one separated from the sky by luminance,
 * and on the two near-white stops it is a near-black: Saturn's and Pluto's are
 * `#111318`, which is 1.02:1 on this card. `render/palette.ts` carries the
 * whole story - the typed letter was invisible in colourblind mode for exactly
 * this reason - and the floor below is what stops this bar repeating it.
 *
 * A first cut of this function returned one flat ink in colourblind mode, on
 * the belief that the variant collapsed the accents. It does not: the seven
 * colourblind accents are seven distinct, legible colours, so a colourblind
 * child keeps the tint too. The measurement is in `mapBadge.test.ts`.
 */
export function segmentInk(stopId: StopId, colorblind: boolean): string {
  const accent = paletteAt(stopId, colorblind).accent;
  return contrastRatio(accent, BADGE_PLATE.fill) >= SEGMENT_MIN_RATIO
    ? accent
    : INK.lit;
}

/**
 * The unlit segment's ink, and why it is an OUTLINE.
 *
 * Straight off the empty star this screen already draws (`DirectorMapScene.
 * drawStars`): filled means earned, outlined means not yet, and the outline is
 * `INK.textDim` - the dimmer of two LEGIBLE inks - rather than `INK.locked`,
 * which disappears into the surface at under 2:1. "Three stars a child cannot
 * count is a rating that does not exist" was written about that glyph; seven
 * segments a child cannot count is the same defect with a different shape.
 */
export const SEGMENT_UNLIT_INK = INK.textDim;
export const SEGMENT_UNLIT_ALPHA = 0.75;
export const SEGMENT_UNLIT_WIDTH = 2;

/** The bottom of the badge - i.e. of everything this screen's header draws. */
export const headerBottom = (): number => badgeBox().y + badgeBox().h;

// ---------------------------------------------------------------------------
// The Lantern (UR-53)
// ---------------------------------------------------------------------------

/**
 * WHICH PLANET THE SHIP HOVERS OVER: THE SELECTED ONE.
 *
 * UR-53 asks for the CURRENT planet. Selection and furthest-beacon progress are
 * different things on this screen and they disagree the moment a child presses
 * Right, so the choice had to be made rather than assumed:
 *
 *   SELECTION  the ship moves with the focus ring. "Current" means the stop the
 *              screen is currently ABOUT - which is already what the board at
 *              the bottom means by it: the title, the chapter, the personal best
 *              and "fly here" all retitle to the focused stop. A second reading
 *              of "current" on one screen is the defect UR-52 and the route
 *              header were both about.
 *   PROGRESS   the ship parks on the furthest lit beacon. Truthful about where
 *              the pilot IS, but it never moves, so it reads as decoration, and
 *              it would contradict the board beside it.
 *
 * SELECTION, therefore. The ship is the cursor: it says "this is the stop you
 * are looking at, and this is what would fly there".
 */

/**
 * The ship's drawn height, nose to nozzle.
 *
 * `drawLantern` is built with `exhaust: false` here, so its drawn extent IS
 * `LANTERN_DESIGN_HEIGHT` - lens top at -247 design units, nozzle bottom at
 * +178. With the plume on it would reach a further 152 units past the nozzle
 * (a third again as tall) and there is no room for that between the header and
 * the lamp. A ship HOVERING is holding station, not burning, so the still
 * version is also the more honest drawing.
 */
export const SHIP_H = 96;
export const SHIP_SCALE = SHIP_H / LANTERN_DESIGN_HEIGHT;
/** Fraction of the drawn height that sits ABOVE the rig's origin (247/425). */
export const SHIP_ABOVE_ORIGIN = LANTERN_ABOVE_ORIGIN;

/** `drawLantern` is called with this; `shipBox` measures the same drawing. */
export const SHIP_EXHAUST = false;

/**
 * The ship's ORIGIN y - not its top and not its centre. One line for all seven
 * stops: the ship changes x, never y, so the route reads as a row rather than
 * as a wobble.
 *
 * ================== WHY IT MOVED FROM 334 ==================
 * The ship hovered too high: 79.8 px of empty sky between its nozzle and the
 * planet it was supposed to be hovering over, which reads as a ship parked in
 * the header rather than as a cursor sitting on a stop.
 *
 * THE NUMBER IS DERIVED, AND THE DERIVATION IS THE POINT. `drawLantern` puts
 * the rig's ORIGIN at (x, y) and the ship hangs 58% of its height ABOVE that
 * origin (`LANTERN_ABOVE_ORIGIN`), so `SHIP_Y` is neither edge and the gap
 * cannot be read off it. `shipBox` is the only honest reader:
 *
 *   k            = SHIP_H / LANTERN_DESIGN_HEIGHT = 96 / 425
 *   ship bottom  = SHIP_Y + NOZZLE_BOTTOM * k     = SHIP_Y + 40.207
 *   disc top     = ROUTE_Y - NODE_R               = 454
 *
 * ================== THE GAP IS A BAND, BECAUSE THE SHIP BOBS ==================
 * `drawLantern` gives an idle rig a `y: { from: y - 2, to: y + 2 }` tween - art
 * direction section 5's "gentle 2 px bob on a 3 s sine" - and it runs under
 * reduced motion too. So there is no single gap; there is a 4 px band, and the
 * number to solve for is the WHOLE band rather than the rest position:
 *
 *   gap(SHIP_Y) spans [411.79 - SHIP_Y, 415.79 - SHIP_Y]
 *   inside 10..15  =>  400.79 <= SHIP_Y <= 401.79
 *
 * 401 puts the band at 10.79 .. 14.79, so the nozzle is between 10 and 15 px
 * over the limb at EVERY point of the bob rather than only at rest. The first
 * value measured, 400, read 13.79 at rest and 15.79 at the top of the bob - out
 * of range for a third of every three-second cycle, which is exactly the kind
 * of thing a still capture cannot show and the browser probe did.
 *
 * Nothing else about the ship moved: `SHIP_H`, `SHIP_SCALE`, `SHIP_EXHAUST`,
 * the bob and the livery are all untouched, and x is still `nodeX(i)`.
 *
 * ================== WHAT THIS COSTS, AND WHERE IT IS LOGGED ==================
 * The beacon lamp on a CHARTED stop floats `LAMP_RISE` above the same limb, so
 * the band the ship has just moved into is the band the lamp is in: its halo
 * reaches `lampY() - LAMP_HALO_MAX` = 388 and the nozzle is now at 441.2, so
 * the ship overlaps the lamp by 53.2 px (55.2 at the bottom of the bob) at
 * whichever charted stop is selected.
 * The old `SHIP_Y` cleared it, and that clearance is what `mapLayout.test.ts`
 * used to assert. It cannot be kept AND a 10-15 px hover: there is 66 px
 * between the halo's top and the disc, and the ship is 96 px tall.
 *
 * gauntlet/escalations.md carries the options and a lean. Nothing here silently
 * drops the constraint - the test below now measures the overlap instead of
 * denying it, so a later change cannot make it worse unnoticed.
 */
export const SHIP_Y = 401;

/**
 * The idle bob's amplitude, in px.
 *
 * RESTATED, NOT IMPORTED, exactly as `SHADOW_R` is and for the same reason:
 * `render/lantern.ts` draws the tween and pulls in Phaser, so a node unit test
 * cannot load it. `mapLayout.test.ts` parses the tween out of that file and
 * fails if this restatement drifts - a clearance measured against a bob nobody
 * checks is a clearance that quietly stops clearing.
 */
export const SHIP_BOB = 2;

/** The nozzle's y at rest: the ship's lowest drawn ink. */
export const shipBottom = (): number => SHIP_Y + lanternDesignBox(SHIP_EXHAUST).bottom * SHIP_SCALE;
/** The planet's lit limb, i.e. the top of the disc the ship hovers over. */
export const discTop = (): number => ROUTE_Y - NODE_R;
/** The air the report is about, at rest: nozzle to limb. */
export const shipDiscGap = (): number => discTop() - shipBottom();
/** The same air across the whole bob - the number the 10-15 has to hold for. */
export const shipDiscGapRange = (): { min: number; max: number } => ({
  min: shipDiscGap() - SHIP_BOB,
  max: shipDiscGap() + SHIP_BOB,
});

/**
 * The ship's drawn box when it hovers over stop `i`.
 *
 * Derived from `lanternDesignBox`, not from a remembered aspect ratio: the box
 * a test checks and the drawing the scene puts on screen are then the same
 * object scaled, and turning the exhaust back on would move the box rather
 * than silently invalidate the clearance this screen is built around.
 */
export function shipBox(i: number): { x: number; y: number; w: number; h: number } {
  const box = lanternDesignBox(SHIP_EXHAUST);
  const k = SHIP_H / LANTERN_DESIGN_HEIGHT;
  return {
    x: nodeX(i) - box.halfWidth * k,
    y: SHIP_Y + box.top * k,
    w: box.halfWidth * 2 * k,
    h: (box.bottom - box.top) * k,
  };
}

// ---------------------------------------------------------------------------
// The board at the bottom (UR-54)
// ---------------------------------------------------------------------------

export interface PanelBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

// ---------------------------------------------------------------------------
// Shadow, who stands beside the board
// ---------------------------------------------------------------------------

/**
 * Where the Shadow stands, and how much room he takes.
 *
 * RESTATED, NOT IMPORTED. `render/shadow.ts` draws him and pulls in Phaser, so
 * a node unit test cannot load it; `mapLayout.test.ts` parses `SHADOW_RADIUS`
 * out of that file and fails if this restatement drifts, which is the same
 * arrangement `warpLayout` used before the Lantern's geometry was extracted.
 *
 * The half-width is the arm span at rest - 1.45 R covers every pose in
 * `POSES` - times the scale this screen draws him at.
 */
export const SHADOW_R = 64;
export const SHADOW_SCALE = 0.8;
export const SHADOW_HALF_W = SHADOW_R * 1.45 * SHADOW_SCALE;
export const SHADOW_HALF_H = SHADOW_R * 1.35 * SHADOW_SCALE;
export const shadowAt = (): { x: number; y: number } => ({
  x: GAME_WIDTH - 150,
  // Her feet on the status board's foot line. This was `GAME_HEIGHT - 190`,
  // which put her 9 px below it - enough to read as not quite lined up.
  y: PANEL_BOTTOM - SHADOW_HALF_H,
});
export function shadowBox(): PanelBox {
  const at = shadowAt();
  return {
    x: at.x - SHADOW_HALF_W,
    y: at.y - SHADOW_HALF_H,
    w: SHADOW_HALF_W * 2,
    h: SHADOW_HALF_H * 2,
  };
}
/** Air between the board's right edge and Shadow's arm. */
export const SHADOW_BAY_GAP = 24;

/**
 * UR-54: the board at the foot of the screen is to start on the same left edge
 * as the heading above it.
 *
 * It was `{ x: 200, y: 700, w: GAME_WIDTH - 400 }` - a left edge this screen
 * invented for itself, 104 px right of the heading plate above it. It is the
 * content column now, so the board's plate starts on the heading's line and its
 * ink column is the heading's ink column. That is UR-19's grid; this screen
 * simply was not on it.
 *
 * THE RIGHT EDGE IS A BAY, NOT THE GUTTER, and that is the half of this change
 * that is easy to get wrong. Shadow stands at `GAME_WIDTH - 150` on the same
 * band as the board. At the OLD width the board stopped at `GAME_WIDTH - 200`
 * and he stood clear of it by accident; taken out to the right gutter, the
 * board runs under him - and under him is where the star row and "fly here"
 * are. So the board gives up a bay on the right, exactly as the Warp break's
 * cards give one up for the Lantern, and `mapLayout.test.ts` asserts the two
 * rectangles are disjoint rather than trusting this note.
 */
export const panelRight = (): number => shadowBox().x - SHADOW_BAY_GAP;

export const PANEL_Y = 700;
export const PANEL_H = 250;
export const PANEL_BOTTOM = PANEL_Y + PANEL_H;

export const panelBox = (): PanelBox => ({
  x: GUTTER,
  y: PANEL_Y,
  w: panelRight() - GUTTER,
  h: PANEL_H,
});

/**
 * The inset from the board's edge to its ink.
 *
 * `SKY_PLATE.padX`, which is what every plated block in the product uses, so
 * the board's text column lands on the heading's text column as well as its
 * plate landing on the heading's plate. The board used to use 40 for its title
 * and 42 for the two lines under it, which is three left edges inside one card.
 */
export const PANEL_PAD = SKY_PLATE.padX;

export const panelInkLeft = (): number => panelBox().x + PANEL_PAD;
/** The right-hand ink line. "fly here" AND the star row hang off this. */
export const panelInkRight = (): number => panelBox().x + panelBox().w - PANEL_PAD;

/**
 * UR-54: the travel label and the star row beneath it did not share a right
 * edge.
 *
 * `drawStars(cx, r)` puts its three glyphs at `cx - gap`, `cx`, `cx + gap` with
 * `gap = r * 2.6`, so the cluster's right edge is `cx + gap + r`. "fly here" is
 * right-aligned on `panelInkRight()`; the stars were centred on
 * `PANEL.x + PANEL.w - 140`, which put their right edge 42.4 px short of it.
 * Nothing was wrong with either number on its own, which is why it survived.
 */
export const starsCentreForRight = (right: number, r: number): number => right - r * 2.6 - r;

export const PANEL_STAR_R = 16;
/** The star row's baseline inside the board. */
export const panelStarsY = (): number => panelBox().y + panelBox().h - 62;

// ---------------------------------------------------------------------------
// The chips, top right
// ---------------------------------------------------------------------------

export const CHIP = { w: 262, h: 66, y: 74, gap: 22 } as const;
/** Right-aligned on the content column, like everything else on this screen. */
export const chipX = (index: 0 | 1): number =>
  contentRight() - CHIP.w - (1 - index) * (CHIP.gap + CHIP.w);

// ---------------------------------------------------------------------------
// The hint (UR-54: it is a grid line, not a centred caption)
// ---------------------------------------------------------------------------

/** An upper bound on the hint line's width, for its keep-clear zone only. */
export const HINT_W = 620;

// ---------------------------------------------------------------------------
// UR-52: the keep-clear zones
// ---------------------------------------------------------------------------

/**
 * Everything on this screen that decorative debris must not land on.
 *
 * ================== WHAT WAS REPORTED ==================
 * UR-52: decorative debris drew ACROSS the map. A near-black rock from the
 * `nearField` plane sat over Mars. `nearField` draws at depth 5 and the
 * planet discs at depth 4, so it was genuinely on top of the planet - and
 * `LANE_GUARD` could never have helped, because it keeps rocks out of the
 * CENTRE of the frame while this screen's content runs the full width.
 *
 * This is the second report of that defect. The first was UR-06, an asteroid
 * across the "B" of KEYBLASTER, and it was fixed on the Title only. So the rule
 * rather than the instance: `render/keepClear.ts` is the mechanism, the Title
 * registers through `titleLayout.ts`, and this screen registers here.
 *
 * ================== WHAT IS IN THE LIST, AND WHY THE TYPE IS TOO ==================
 * The planets, their lamps and their star rows are the parts that can be
 * covered outright. The header, the board, the chips and the hint sit on opaque
 * plates in FRONT of every debris plane, so on today's depths they cannot be -
 * and they are registered anyway. A zone costs sky; a depth that changes under
 * a screen with no zone costs the same bug a third time, and "it is plated,
 * trust me" is how 1.19:1 contrast shipped on five screens (see `kit.skyText`).
 *
 * ================== WHAT IS NOT IN IT ==================
 * The Lantern. It is drawn into the `shipFx` container at depth 6, in front of
 * every plane this screen decorates, and it MOVES with the selection - a static
 * zone for it would have to blanket the whole route band and would cost a third
 * of the field's rocks to protect something nothing can cover.
 */
export function mapKeepClear(): readonly KeepClearShape[] {
  const k = keepClear();
  const panel = panelBox();
  const step = nodeStep();
  const capTop = captionPlateTop();
  const starHalf = STAR_R * 2.6 + STAR_R;

  for (let i = 0; i < STOP_IDS.length; i += 1) {
    const x = nodeX(i);
    // The planet, measured to the dark rim the disc is drawn on, PLUS the pad:
    // a rock five pixels off Mars's limb is still crossing the map.
    k.circle(x, ROUTE_Y, NODE_R + NODE_RIM);
    // The lamp, measured to its widest halo rather than its lit core. The halo
    // is a glow with no hard edge, so it keeps the pad too.
    k.circle(x, lampY(), LAMP_HALO_MAX);
    // The caption's plate. NO PAD: this one has a hard edge and it is opaque,
    // so a rock that stops at the edge stops at the edge. `step` is the honest
    // upper bound on its width - the captions are centred on nodes `step` apart
    // and already must not collide with each other, so nothing derived from the
    // drawn text can be wider without the screen being broken anyway.
    k.centredBlock(x, capTop, step, captionPlateH(), 0);
    // The star row. UNPLATED outlines on open sky - the one piece of ink on
    // this screen with nothing behind it - so it keeps the full pad.
    k.centredBlock(x, ROUTE_Y + NODE_R + STAR_ROW_GAP - STAR_R, starHalf * 2, STAR_R * 2);
  }

  // The chrome: four opaque plates, so NO PAD on any of them (see above). Only
  // the widths are estimates, and they are estimates upward.
  const badge = badgeBox();
  k.rect(badge.x, badge.y, badge.w, badge.h, 0);
  k.rect(panel.x, panel.y, panel.w, panel.h, 0);
  k.rect(chipX(0), CHIP.y, CHIP.w * 2 + CHIP.gap, CHIP.h, 0);
  k.rect(GUTTER, HINT_TOP, HINT_W, GAME_HEIGHT - HINT_TOP, KEEP_CLEAR_PAD);
  const figure = shadowBox();
  k.rect(figure.x, figure.y, figure.w, figure.h, KEEP_CLEAR_PAD);

  return k.zones();
}

/** The pad every unplated zone above carries, re-exported so a test can name it. */
export { KEEP_CLEAR_PAD };
