import type { TextSample } from "@engine/contrast/index.js";
import type { Lang } from "@engine/types";
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
  /** Shadow's closing plate, or null when there is no line to put on it. */
  readonly panel: Rect | null;
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
const PANEL_PAD_X = 40;
const PANEL_PAD_Y = 30;
/**
 * The closing panel is CENTRED and narrower than the band on purpose: Shadow
 * stands in the left gutter, so a panel that shared the band's left edge would
 * be drawn straight through the figure saying the line.
 */
const PANEL_W = 1080;
/** Panel bottom to button top. Constant, whatever the panel holds. */
const PANEL_BOTTOM_GAP = 70;
const BUTTON = { w: 560, h: 76 } as const;

/**
 * The tallest closing panel the card has room for, in lines.
 *
 * Four lines of Devanagari is 248 px of panel, which still clears the route
 * band with 120 px to spare. It is a RESERVATION, not a wrap setting - Phaser
 * wraps the real string at `panelText.wrapWidth` and knows nothing about this
 * number - so a line longer than the budget would be clipped. That is why
 * `endingLayout.test.ts` asserts every SHIPPED closing line wraps inside it;
 * new copy that does not is a red test, not a silent crop.
 */
export const PANEL_MAX_LINES = 4;

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
    y: height - 180,
    w: BUTTON.w,
    h: BUTTON.h,
  };

  // NO CONTENT, NO PANEL. This is the whole fix for the empty black box: the
  // scene is handed `null` and has nothing to draw.
  //
  // AND NO CONSTANT HEIGHT. The first fix left a 1380x170 plate holding one
  // line, about 110 px of which was dead black - the same defect the critic
  // found on the results screen. The panel is now budgeted from its own
  // content: it is exactly as tall as the lines the closing string wraps to,
  // and it grows UPWARD so the gap to the forward action never moves.
  const bodySize = input.bodySize ?? TYPE.body;
  const advanceEm = input.advanceEm ?? ADVANCE_EM.latin;
  const panelX = Math.round((width - PANEL_W) / 2);
  const wrapWidth = PANEL_W - PANEL_PAD_X * 2;
  const lines = Math.min(
    PANEL_MAX_LINES,
    wrapLineCount(input.closingLine, wrapWidth, bodySize, advanceEm),
  );
  const inkH = lines * Math.round(bodySize * input.lineHeightEm);
  const panelH = inkH + PANEL_PAD_Y * 2;
  const panel: Rect | null = hasContent(input.closingLine)
    ? {
        x: panelX,
        y: button.y - PANEL_BOTTOM_GAP - panelH,
        w: PANEL_W,
        h: panelH,
      }
    : null;
  const panelText: TextRect | null =
    panel === null
      ? null
      : {
          x: panel.x + PANEL_PAD_X,
          y: panel.y + PANEL_PAD_Y,
          w: wrapWidth,
          h: inkH,
          wrapWidth,
        };

  return {
    headline,
    headlineAnchor: { x: Math.round(width / 2), y: headline.y + HEADLINE_PAD_Y },
    routeBand,
    rail: { y: railY, from: lampX[0] ?? from, to: lampX[lampX.length - 1] ?? to },
    lampX,
    lampHaloRadius: LAMP_HALO_RADIUS,
    lampBeadRadius: LAMP_BEAD_RADIUS,
    labelY: railY + LABEL_GAP,
    panel,
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
  shadowLine: TYPE.body,
  continue: TYPE.label,
} as const;
