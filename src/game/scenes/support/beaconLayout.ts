import { DESIGN_WIDTH } from "@game/sceneKeys";
import type { Rect } from "@game/ui/layout";
import { BLOCK_GAP, GUTTER, actionButton } from "@game/ui/grid";
import { PLATE_RHYTHM, lineBox } from "@game/ui/plateLayout";
import { TYPE } from "@game/ui/theme";

/**
 * BEACON PLACEMENT'S GEOMETRY, OUT OF THE SCENE (screen inventory row 8).
 *
 * ================== WHAT WAS HERE BEFORE ==================
 * Four literals in `BeaconScene.ts`, none of which appears anywhere else in
 * the product:
 *
 *   READOUT  { x: GUTTER, y: 664, w: 1728, h: 268 }
 *   BUTTON   { x: GUTTER, y: 966, w: 420,  h:  64 }
 *   shadow   drawShadow(this, 300, 470, "saluting", { scale: 0.9 })
 *   rows     y + 44, y + 116, y + 172      three hand-picked offsets
 *
 * `BeaconScene.ts` imports Phaser, so not one of them could be measured by a
 * node test - the same reason `support/earthLayout.ts` exists, and the same
 * defect it was written for. The card's height was picked and its three rows
 * were then fitted into it by eye; Shadow stood 200 px to the LEFT of the card
 * he was talking over, on open sky, at a scale nothing else uses.
 *
 * ================== THE FOUR THINGS THIS FILE DECIDES ==================
 * 1. ONE COORDINATE ROW, NOT TWO. `@engine/ephemeris` produces two strings.
 *    `coordsLine` is a POSITION - longitude, latitude, distance - and reads as
 *    one. `pulsarLine` is a CLOCK: four millisecond timing residuals against
 *    four millisecond pulsars, which is how a spacecraft with no view of Earth
 *    actually fixes itself, and which is four signed numbers to five decimal
 *    places on a screen a seven-year-old reaches by finishing a belt. It is the
 *    better piece of physics and the worse piece of copy, and it was eating a
 *    whole row of the only box on the screen. The engine still computes and
 *    still tests it; this screen no longer prints it.
 * 2. SHADOW IS INSIDE THE CARD, on the warp break's coach treatment - his
 *    column on the left, a speaker caption and his line to the right of it.
 *    Reused rather than reinvented: `support/warpLayout.ts` already measured
 *    the four coefficients of his drawn reach off the served build by
 *    screenshot difference, because a Phaser `Graphics` has no bounds.
 * 3. THE CARD IS SIZED BY WHAT IS IN IT and grows UPWARD from a fixed foot, so
 *    the gap to the forward action never moves however the flavour line wraps
 *    (`support/endingLayout.ts`'s rule, and the reason it has one).
 * 4. THE FORWARD ACTION IS `ui/grid.actionButton()` and nothing else.
 *
 * Nothing here imports Phaser or the DOM.
 */

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

/**
 * Gutter to gutter on the ARTBOARD.
 *
 * `DESIGN_WIDTH`, not `GAME_WIDTH`: `tests/e2e/grid-conformance.spec.ts`
 * declares this screen's anchor model `"fixed"`, so every element on it is
 * measured against the artboard. At 16:9 and narrower the two are the same
 * number; past it, a card that tracked the viewport would be the one element
 * disagreeing with its own screen, which is the defect that spec exists to
 * catch.
 */
export const CARD_W = DESIGN_WIDTH - GUTTER * 2;

/** The card's foot: one block gap above the forward action. It never moves. */
export const CARD_BOTTOM = actionButton().y - BLOCK_GAP;

// ---------------------------------------------------------------------------
// Shadow, on the warp break's treatment
// ---------------------------------------------------------------------------

/** `render/shadow.SHADOW_RADIUS`. */
const SHADOW_R = 64;

/**
 * His drawn reach about his origin, in radii.
 *
 * The four coefficients `support/warpLayout.ts` measured off the served build
 * by differencing two screenshots with the figure switched off, because a
 * Phaser `Graphics` returns a zero-sized rect at the origin and
 * `render/shadow.SHADOW_HEIGHT` under-reads the drawing by half a radius.
 * Restated rather than imported for the reason `earthLayout.ts` restates them:
 * `warpLayout` is the warp break's module and this screen may not reach into
 * it. `warpLayout.test.ts` parses them back out of `render/shadow.ts`.
 */
const SHADOW_ABOVE_R = 1.82;
const SHADOW_BELOW_R = 1.6;
const SHADOW_LEFT_R = 1.32;
const SHADOW_RIGHT_R = 1.52;

/**
 * The warp coach card's scale, unchanged.
 *
 * It was 0.9 here and 0.66 there, for the same figure inside the same kind of
 * plate, which is the whole of "reuse the treatment rather than inventing a
 * second one". At 0.66 his drawn height is 144.5 px, which is what sets this
 * card's lower band.
 */
export const SHADOW_SCALE = 0.66;

/** Two px of additive glow either side of the measured figure. */
const SHADOW_GLOW_BLEED_PX = 2;

/** How tall he is actually drawn, in screen px. */
export function shadowDrawnHeight(): number {
  return (SHADOW_ABOVE_R + SHADOW_BELOW_R) * SHADOW_R * SHADOW_SCALE;
}

/** The band he stands in: his drawing plus its glow, and nothing else. */
export const COACH_BAND_H = Math.ceil(shadowDrawnHeight() + SHADOW_GLOW_BLEED_PX * 2);

/**
 * The column his drawing occupies, measured from the card's left edge.
 *
 * His reach, not his origin: the drawing is not symmetric about the point it
 * is drawn at (1.32 radii left, 1.52 right), so a column centred on the origin
 * clips one shoulder.
 */
export const SHADOW_COLUMN_W =
  PLATE_RHYTHM.card.padX * 2 +
  Math.ceil((SHADOW_LEFT_R + SHADOW_RIGHT_R) * SHADOW_R * SHADOW_SCALE);

// ---------------------------------------------------------------------------
// The rows
// ---------------------------------------------------------------------------

/**
 * The coordinate row's height, in the WORST language.
 *
 * `lineBox` is the Devanagari line box whatever language is loaded, because a
 * card measured in English is a card that fits at Earth and collides in Hindi
 * (standards rule 5). `lines` is 1 for a coordinate readout and 2 when the
 * calibrating sentence wraps, which is the failure branch this screen has to
 * render without ever looking like an error.
 */
function coordsRowH(coordsLines: number): number {
  return lineBox(TYPE.heading, coordsLines);
}

/** The card's height, DERIVED from what is in it. */
export function cardHeight(flavourLines = 1, coordsLines = 1): number {
  const r = PLATE_RHYTHM.card;
  return r.padY * 2 + coordsRowH(coordsLines) + r.gap + coachBandH(flavourLines);
}

/**
 * The lower band's height: whichever is taller, the figure or what he says.
 *
 * Almost always the figure - one line of body copy under a caption is 137 px
 * against his 149 - but a three-line flavour in Devanagari is 188, and a band
 * sized only from the drawing would print his last line through the card's
 * foot.
 */
export function coachBandH(flavourLines = 1): number {
  const rows = [lineBox(TYPE.caption), lineBox(TYPE.body, flavourLines)];
  const text = rows.reduce((a, b) => a + b, 0) + PLATE_RHYTHM.card.gap;
  return Math.max(COACH_BAND_H, text);
}

/** The card, grown upward from its fixed foot. */
export function card(flavourLines = 1, coordsLines = 1): Rect {
  const h = cardHeight(flavourLines, coordsLines);
  return { x: GUTTER, y: CARD_BOTTOM - h, w: CARD_W, h };
}

/** The lower band, inside the card. */
export function coachBand(flavourLines = 1, coordsLines = 1): Rect {
  const c = card(flavourLines, coordsLines);
  const r = PLATE_RHYTHM.card;
  const h = coachBandH(flavourLines);
  return {
    x: c.x,
    y: c.y + r.padY + coordsRowH(coordsLines) + r.gap,
    w: c.w,
    h,
  };
}

/**
 * Where Shadow is DRAWN, which is not where his box starts.
 *
 * His left reach clears the card's padding rather than his origin sitting on
 * it, and his top reach clears the band rather than his origin being centred
 * in it - centring an asymmetric drawing on its own origin lifts it out of the
 * plate, which is the defect `warpLayout.shadowOrigin` carries a note about.
 */
export function shadowOrigin(flavourLines = 1, coordsLines = 1): { x: number; y: number } {
  const band = coachBand(flavourLines, coordsLines);
  const r = SHADOW_R * SHADOW_SCALE;
  return {
    x: band.x + PLATE_RHYTHM.card.padX + SHADOW_LEFT_R * r,
    y: band.y + SHADOW_GLOW_BLEED_PX + SHADOW_ABOVE_R * r,
  };
}

/** His drawn footprint on this screen, in screen px. */
export function shadowBox(flavourLines = 1, coordsLines = 1): Rect {
  const at = shadowOrigin(flavourLines, coordsLines);
  const r = SHADOW_R * SHADOW_SCALE;
  return {
    x: at.x - SHADOW_LEFT_R * r,
    y: at.y - SHADOW_ABOVE_R * r,
    w: (SHADOW_LEFT_R + SHADOW_RIGHT_R) * r,
    h: (SHADOW_ABOVE_R + SHADOW_BELOW_R) * r,
  };
}

/** A named section of the card, in reading order. */
export interface BeaconRow {
  readonly id: "coords" | "speaker" | "flavour";
  readonly rect: Rect;
}

/**
 * The card's three sections.
 *
 * `coords` runs the full content width; `speaker` and `flavour` start where
 * Shadow's column ends, and are centred against the band so that a one-line
 * flavour reads as being said BY the figure rather than floating over his head.
 */
export function rows(flavourLines = 1, coordsLines = 1): readonly BeaconRow[] {
  const c = card(flavourLines, coordsLines);
  const band = coachBand(flavourLines, coordsLines);
  const r = PLATE_RHYTHM.card;

  const coords: Rect = {
    x: c.x + r.padX,
    y: c.y + r.padY,
    w: c.w - r.padX * 2,
    h: coordsRowH(coordsLines),
  };

  const textX = band.x + SHADOW_COLUMN_W;
  const textW = band.w - SHADOW_COLUMN_W - r.padX;
  const speakerH = lineBox(TYPE.caption);
  const flavourH = lineBox(TYPE.body, flavourLines);
  const stack = speakerH + r.gap + flavourH;
  const top = band.y + (band.h - stack) / 2;

  return [
    { id: "coords", rect: coords },
    { id: "speaker", rect: { x: textX, y: top, w: textW, h: speakerH } },
    {
      id: "flavour",
      rect: { x: textX, y: top + speakerH + r.gap, w: textW, h: flavourH },
    },
  ];
}

/** The wrap width the flavour line is measured and drawn at. */
export function flavourWrapWidth(): number {
  return CARD_W - SHADOW_COLUMN_W - PLATE_RHYTHM.card.padX;
}

/** The wrap width the coordinate row is measured and drawn at. */
export function coordsWrapWidth(): number {
  return CARD_W - PLATE_RHYTHM.card.padX * 2;
}

// ---------------------------------------------------------------------------
// The beacon itself
// ---------------------------------------------------------------------------

/**
 * Where the mast's base lands.
 *
 * It was 560, which put the foot of the tower at y 658 - fine against a card
 * that started at 664, and 12 px INSIDE a card that now starts at 646 because
 * it holds a figure. The tower is what the screen is about, so the tower moves
 * and the card stays on its foot line.
 */
export const MAST_GROUND_Y = 500;

/** Where the mast is drawn, horizontally. */
export const MAST_X = 1420;

/**
 * The lamp, its halo and the tower as one rectangle - the object nothing may
 * be drawn over. The numbers are the ones `BeaconScene.buildBeacon` fills with:
 * a 48 px half-base at `+98`, and a 140 px halo radius about `-80`.
 */
export function mastBounds(): Rect {
  const haloR = 140;
  const top = MAST_GROUND_Y - 80 - haloR;
  const bottom = MAST_GROUND_Y + 98;
  return { x: MAST_X - haloR, y: top, w: haloR * 2, h: bottom - top };
}

/** The forward action. One rectangle, shared with every screen that has one. */
export function button(): Rect {
  return actionButton();
}
