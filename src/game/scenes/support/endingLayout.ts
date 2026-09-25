import type { TextSample } from "@engine/contrast/index.js";
import type { Lang } from "@engine/types";
import { speechCardHeight, speechCardRows, speechCardWrapWidth } from "@game/ui/speechCard";
import { stackRows } from "@game/ui/plateLayout";
import { ACTION_BUTTON } from "@game/ui/grid";
import { INK, SKY_PLATE, SPACE, TYPE } from "@game/ui/theme";

/**
 * WHERE THE ENDING CARD PUTS THINGS, AND IN WHAT INK.
 *
 * The ending is the payoff: it is the last thing a seven-year-old sees after
 * finishing the whole game, and the captured version of it was the worst screen
 * in the build. Three of its four defects were arithmetic, and arithmetic that
 * lived inside `EndingScene.create()` where no unit test could reach it:
 *
 *   AN EMPTY BLACK PANEL, 838x105, DEAD CENTRE. The scene drew Shadow's closing
 *   plate opaque in `create()` and held the line itself at alpha 0 behind a
 *   delayed call ~3 s into the card. Every capture of the screen was taken
 *   before that call fired, so what shipped was a plate with nothing in it. The
 *   rule that fixes it is a layout rule, not a tween rule: NO CONTENT, NO
 *   PANEL. `endingLayout({ closingLine: "" }).panel` is `null`, and the scene
 *   cannot draw a rect it was not given.
 *
 *   THE ROUTE BAND AT y=470, straight through the terrain silhouette, so seven
 *   lamps and their seven names sank into a mountain. The band now sits high in
 *   the sky ON ITS OWN PLATE, which is the only way a band of text over a world
 *   layer another lane owns can be relied on to read.
 *
 *   THE HEADLINE floating top-left over bare sky at 1.19:1. It is now centred,
 *   at display size, on the shared sky plate, in an ink measured here.
 *
 *   SHADOW'S WORDS 680 PX FROM SHADOW (UR-148). The closing plate was centred
 *   on the frame while the speaker stood bottom-left, so nothing on screen said
 *   the two were the same event. It is `ui/speechCard`'s card now - a speaker
 *   row over a line row, the outline Earth activation and the pilot picker
 *   already wear - anchored over her head on `SPEECH_TAIL_GAP`.
 *
 * NOTHING IN THIS FILE IMPORTS PHASER. It is plain numbers and colour names, so
 * the screen's composition is testable without booting a renderer - which is
 * the whole reason the defects survived a green suite in the first place.
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface TextRect extends Rect {
  /** Word-wrap width for the Phaser text object inside this rect. */
  readonly wrapWidth: number;
}

/** The design space every scene in this game lays out against. */
export const ENDING_STAGE = { width: 1920, height: 1080 } as const;

export interface EndingLayoutInput {
  /** How many stops the route has. Seven, unless a test says otherwise. */
  readonly stopCount: number;
  /**
   * Shadow's closing line, ALREADY RESOLVED. An empty or blank string means
   * there is nothing to say, and then there is no panel to say it on.
   */
  readonly closingLine: string;
  readonly headlineSize: number;
  readonly labelSize: number;
  /** `lineHeightEm(lang)` from the theme; Devanagari grows the band. */
  readonly lineHeightEm: number;
  /** Size of the closing line. Defaults to the theme's body size. */
  readonly bodySize?: number;
  /**
   * Budgeted average glyph advance, in em. `advanceEmFor(lang)`. This is how
   * the panel is sized to its content without a canvas to measure on.
   */
  readonly advanceEm?: number;
  readonly width?: number;
  readonly height?: number;
}

export interface EndingLayout {
  /** The band the headline is centred in. */
  readonly headline: Rect;
  /** Where the headline text is anchored, with origin (0.5, 0). */
  readonly headlineAnchor: { readonly x: number; readonly y: number };
  /** The route's own plate. Everything below is inside it. */
  readonly routeBand: Rect;
  readonly rail: { readonly y: number; readonly from: number; readonly to: number };
  readonly lampX: readonly number[];
  readonly lampHaloRadius: number;
  readonly lampBeadRadius: number;
  /** Top of the stop names, drawn with origin (0.5, 0). */
  readonly labelY: number;
  /** Shadow's drawn footprint, which the card above is anchored to. */
  readonly shadow: Rect;
  /** Shadow's speech card, or null when there is no line to put on it. */
  readonly panel: Rect | null;
  /** The card's speaker row ("Shadow"). */
  readonly panelSpeaker: Rect | null;
  /** Lines the card is cut for. 0 when there is nothing to say. */
  readonly panelLines: number;
  readonly panelText: TextRect | null;
  readonly button: Rect;
}

// The single column of margins the whole card is built from.
const MARGIN = 120;
const HEADLINE_TOP = 72;
const HEADLINE_PAD_Y = 14;
const BAND_GAP = 78;
const BAND_INSET = 110;
const RAIL_INSET = 150;
const RAIL_TOP_PAD = 84;
const LABEL_GAP = 44;
const BAND_BOTTOM_PAD = 34;
/**
 * The card's widest. It keeps the 1080 the centred panel had, so the measure a
 * child reads at is unchanged; only the anchor moved (UR-148).
 */
const PANEL_W = 1080;
/**
 * UR-199: it sat at y=900, 60 px above the foot line every other forward
 * action in the game stands on. The WIDTH stays this screen's own - it is the
 * terminal action and its test asks for >= 480 - but the height and the foot
 * line are the shared ones.
 */
const BUTTON = { w: 560, h: ACTION_BUTTON.h } as const;

// ---------------------------------------------------------------------------
// Shadow, and the card above her
// ---------------------------------------------------------------------------

/** `render/shadow.SHADOW_RADIUS`. */
const SHADOW_R = 64;
/**
 * Her drawn reach about her origin, in radii - `support/warpLayout.ts`'s four
 * coefficients, measured off the served build (`render/shadow.SHADOW_HEIGHT`
 * under-reads the drawing by half a radius). Restated rather than imported,
 * like `support/earthLayout.ts` does, because those are other screens' modules.
 */
const SHADOW_ABOVE_R = 1.82;
const SHADOW_BELOW_R = 1.6;
const SHADOW_LEFT_R = 1.32;
const SHADOW_RIGHT_R = 1.52;

const SHADOW_SCALE = 0.95;

/**
 * Where she stands. BOTH COORDINATES MOVED, and neither is a taste call.
 *
 * `x` IS NOW DERIVED, exactly as `earthLayout.shadowOrigin` derives its own:
 * her drawn box's LEFT EDGE lands on `GUTTER`, so the card above her starts on
 * the page margin and its content on the margin's inner line. It was the
 * literal 280, which put the card's type at 320 - a line `ui/alignment.ts`
 * does not name, and `left-edge-conformance.spec.ts` counts as two more
 * off-model elements on a screen already carrying two.
 *
 * `y` WAS 760 AND THE CARD FORCED IT DOWN. A card anchored over her head grows
 * up into the route band's plate, and 760 leaves 169 px of sky between the two
 * - one line of card, not two. Hindi decides it: its band is 23 px taller AND
 * its line wraps to two, so at 760 the card printed 14.7 px INTO the band, in
 * the one language nobody here reads. 800 gives all three at least
 * `PLATE_STACK_GAP`, and nothing lives in her column below her - the button is
 * centred at x 680-1240 and her feet land at 897, 151 px clear of
 * `BACK_CORNER_BOTTOM`.
 */
export const SHADOW_AT = {
  x: SPACE.gutter + SHADOW_LEFT_R * SHADOW_R * SHADOW_SCALE,
  y: 800,
  scale: SHADOW_SCALE,
} as const;

/** Air between the top of her drawing and the foot of her card. */
export const SPEECH_TAIL_GAP = SPACE.gap;

export function shadowBox(): Rect {
  const r = SHADOW_R * SHADOW_AT.scale;
  return {
    x: SHADOW_AT.x - SHADOW_LEFT_R * r,
    y: SHADOW_AT.y - SHADOW_ABOVE_R * r,
    w: (SHADOW_LEFT_R + SHADOW_RIGHT_R) * r,
    h: (SHADOW_ABOVE_R + SHADOW_BELOW_R) * r,
  };
}

/**
 * The tallest card the screen has room for, in lines. MEASURED, not picked.
 *
 * The card grows UPWARD out of Shadow's head, so its ceiling is the route
 * band's own plate. The card's foot is 669.3 and the band's bottom is 460 in
 * Latin and 483 in Devanagari, which is 186.3 px in the worst language;
 * `speechCardHeight` is 114 at one line, 161 at two and 208 at three. Two fits
 * with 25.3 px to spare, three does not. It was 4 while the panel was centred
 * low on the frame with the whole lower half of the screen to grow into.
 *
 * It is a RESERVATION, not a wrap setting - Phaser wraps the real string at
 * `panelText.wrapWidth` and knows nothing about this number - so copy longer
 * than the budget would be clipped. `endingLayout.test.ts` asserts every
 * SHIPPED closing line wraps inside it, and that a third line would collide.
 */
export const PANEL_MAX_LINES = 2;

/**
 * Budgeted average glyph advance per character, in em.
 *
 * MEASURED, not guessed. The captured ending rendered
 * "Every ship that comes after us will see these. You drew the map." - 64
 * characters - as 878 px of ink at 30 px, which is 0.457 em per character. The
 * Latin budget is rounded UP to 0.50 so the estimate over-counts rather than
 * clips, and Devanagari is budgeted wider again because its conjuncts and
 * matras carry more ink per cluster (see LINE_HEIGHT in the theme, measured the
 * same way).
 */
export const ADVANCE_EM = { latin: 0.5, devanagari: 0.6 } as const;

export function advanceEmFor(lang: Lang): number {
  return lang === "hi" ? ADVANCE_EM.devanagari : ADVANCE_EM.latin;
}

/**
 * How many lines `text` takes at `wrapWidth`, budgeted.
 *
 * Greedy whole-word wrapping, the same rule Phaser's `useAdvancedWrap` follows,
 * so the count tracks the real break points rather than dividing a character
 * count by a width. A word wider than the whole line gets its own line and is
 * never split, which is also what Phaser does.
 */
export function wrapLineCount(
  text: string,
  wrapWidth: number,
  fontPx: number,
  advanceEm: number,
): number {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return 0;
  const per = fontPx * advanceEm;
  let lines = 1;
  let used = 0;
  for (const word of words) {
    const width = word.length * per;
    if (used === 0) {
      used = width;
      continue;
    }
    // `+ per` is the space between the two words, budgeted as one character.
    if (used + per + width <= wrapWidth) used += per + width;
    else {
      lines += 1;
      used = width;
    }
  }
  return lines;
}

export const LAMP_HALO_RADIUS = 34;
export const LAMP_BEAD_RADIUS = 11;

/** Does this string have anything in it a child could read? */
export function hasContent(text: string): boolean {
  return text.trim().length > 0;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

export function rectWithin(r: Rect, width: number, height: number): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= width && r.y + r.h <= height;
}

/**
 * The composition, top to bottom: headline, route, closing line, forward action.
 *
 * Each block is placed off the bottom of the one above it rather than at a
 * remembered y, so a taller Devanagari band pushes the rest down instead of
 * landing on top of it.
 */
export function endingLayout(input: EndingLayoutInput): EndingLayout {
  const width = input.width ?? ENDING_STAGE.width;
  const height = input.height ?? ENDING_STAGE.height;

  const headlineH =
    Math.round(input.headlineSize * input.lineHeightEm) + HEADLINE_PAD_Y * 2;
  const headline: Rect = {
    x: MARGIN,
    y: HEADLINE_TOP,
    w: width - MARGIN * 2,
    h: headlineH,
  };

  const labelH = Math.round(input.labelSize * input.lineHeightEm);
  const bandH = RAIL_TOP_PAD + LABEL_GAP + labelH + BAND_BOTTOM_PAD;
  const routeBand: Rect = {
    x: BAND_INSET,
    y: headline.y + headline.h + BAND_GAP,
    w: width - BAND_INSET * 2,
    h: bandH,
  };

  const railY = routeBand.y + RAIL_TOP_PAD;
  const from = routeBand.x + RAIL_INSET;
  const to = routeBand.x + routeBand.w - RAIL_INSET;
  const stops = Math.max(1, Math.trunc(input.stopCount));
  // One stop is a degenerate route, not a crash: it sits in the middle.
  const lampX =
    stops === 1
      ? [(from + to) / 2]
      : Array.from({ length: stops }, (_, i) => from + ((to - from) * i) / (stops - 1));

  const button: Rect = {
    x: Math.round((width - BUTTON.w) / 2),
    y: ACTION_BUTTON.y,
    w: BUTTON.w,
    h: BUTTON.h,
  };

  // NO CONTENT, NO PANEL. This is the whole fix for the empty black box: the
  // scene is handed `null` and has nothing to draw.
  //
  // AND IT SITS ON SHADOW'S HEAD (UR-148). It was 1080 px of plate centred on
  // the frame while the speaker stood bottom-left, so the figure and her words
  // had no relationship on screen - the same defect `support/earthLayout.ts`
  // closed on the Earth screen, and closed the same way: the card is anchored
  // to her drawn box, left-aligned to her column because she stands on the
  // left, and grows UPWARD from a tail gap over her head.
  const figure = shadowBox();
  const bodySize = input.bodySize ?? TYPE.body;
  const advanceEm = input.advanceEm ?? ADVANCE_EM.latin;
  // Her column, clamped so the card cannot run past the right margin.
  const cardW = Math.min(PANEL_W, width - SPACE.gutter - figure.x);
  const wrapWidth = speechCardWrapWidth(cardW);
  const lines = Math.max(
    1,
    Math.min(
      PANEL_MAX_LINES,
      wrapLineCount(input.closingLine, wrapWidth, bodySize, advanceEm),
    ),
  );
  const cardH = speechCardHeight(lines);
  const panel: Rect | null = hasContent(input.closingLine)
    ? { x: figure.x, y: figure.y - SPEECH_TAIL_GAP - cardH, w: cardW, h: cardH }
    : null;
  const rows = panel === null ? null : stackRows(panel, speechCardRows(lines), "card");
  const speakerRow = rows?.[0] ?? null;
  const lineRow = rows?.[1] ?? null;
  const panelText: TextRect | null =
    lineRow === null ? null : { ...lineRow, wrapWidth };

  return {
    headline,
    headlineAnchor: { x: Math.round(width / 2), y: headline.y + HEADLINE_PAD_Y },
    routeBand,
    rail: { y: railY, from: lampX[0] ?? from, to: lampX[lampX.length - 1] ?? to },
    lampX,
    lampHaloRadius: LAMP_HALO_RADIUS,
    lampBeadRadius: LAMP_BEAD_RADIUS,
    labelY: railY + LABEL_GAP,
    shadow: figure,
    panel,
    panelSpeaker: speakerRow,
    panelLines: panel === null ? 0 : lines,
    panelText,
    button,
  };
}

export interface NamedRect {
  readonly id: string;
  readonly rect: Rect;
}

/**
 * The blocks, for the collision check. A block that is not emitted is not in
 * the list, which is exactly what "no content, no panel" has to mean.
 */
export function endingBlocks(layout: EndingLayout): NamedRect[] {
  const out: NamedRect[] = [
    { id: "headline", rect: layout.headline },
    { id: "routeBand", rect: layout.routeBand },
    { id: "button", rect: layout.button },
  ];
  if (layout.panel !== null) out.splice(2, 0, { id: "panel", rect: layout.panel });
  return out;
}

// ---------------------------------------------------------------------------
// Ink (AC-22.8)
// ---------------------------------------------------------------------------

/**
 * EVERY COLOUR THE ENDING DRAWS WORDS IN.
 *
 * Declared here rather than at the four call sites so the contrast test and the
 * scene read one list. `INK.textFaint` and `INK.locked` are absent on purpose:
 * they measure 3.4:1 and below even on the plate, so they are dim STATES and
 * never type colours (see the theme).
 *
 * The stop accents are deliberately not here either. Seven planet accents on a
 * dark plate is seven different ratios, some of them fine and some of them not,
 * and the fix for a route that has to read end to end is one legible ink for
 * the names with the colour carried by the LAMPS instead.
 */
export const ENDING_INK = {
  heading: INK.accentSoft,
  stopName: INK.text,
  /** The menu accent, not Pluto's - the same call `continue` below makes. */
  speaker: INK.accent,
  shadowLine: INK.text,
  continue: INK.accent,
} as const;

/** The panel colours the words above are read against. */
export const ENDING_PLATE = {
  /** The shared sky plate, for anything `skyText` plates itself. */
  sky: SKY_PLATE.fill,
  skyAlpha: SKY_PLATE.alpha,
  /** The route band and the closing panel, which the scene draws itself. */
  panel: INK.panel,
  button: INK.panelRaised,
  stroke: INK.line,
  radius: SPACE.radius,
  /**
   * The scene's own plates are painted at the SAME alpha as the shared sky
   * plate, and the rows below claim that alpha rather than a flattering 1.0.
   * The contrast module composites it over white, so what the rubric reads is
   * the worst case a dawn sky can push through the glass.
   */
  alpha: SKY_PLATE.alpha,
} as const;

/** The scene's contrast inventory, in the shape `measureTexts` reads. */
export function endingTextSamples(): TextSample[] {
  return [
    {
      screen: "ending",
      id: "ending.heading",
      color: ENDING_INK.heading,
      plateFill: ENDING_PLATE.sky,
      plateAlpha: ENDING_PLATE.skyAlpha,
    },
    {
      screen: "ending",
      id: "ending.stopName",
      color: ENDING_INK.stopName,
      plateFill: ENDING_PLATE.panel,
      plateAlpha: ENDING_PLATE.alpha,
    },
    {
      screen: "ending",
      id: "ending.speaker",
      color: ENDING_INK.speaker,
      plateFill: ENDING_PLATE.panel,
      plateAlpha: ENDING_PLATE.alpha,
    },
    {
      screen: "ending",
      id: "ending.shadowLine",
      color: ENDING_INK.shadowLine,
      plateFill: ENDING_PLATE.panel,
      plateAlpha: ENDING_PLATE.alpha,
    },
    {
      screen: "ending",
      id: "ending.continue",
      color: ENDING_INK.continue,
      plateFill: ENDING_PLATE.button,
      plateAlpha: ENDING_PLATE.alpha,
    },
  ];
}

/** The type sizes the card uses, so the scene and the tests agree on them. */
export const ENDING_TYPE = {
  heading: TYPE.display,
  stopName: TYPE.caption,
  /** `speechCardRows`' first row is a caption; this has to agree with it. */
  speaker: TYPE.caption,
  shadowLine: TYPE.body,
  continue: TYPE.label,
} as const;
