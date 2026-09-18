import type { Rect } from "./layout.js";
import { LINE_HEIGHT, SKY_PLATE, SPACE, STEP } from "./theme.js";

/**
 * THE PLATE'S RHYTHM AND GEOMETRY, AS NUMBERS (UR-69, UR-70).
 *
 * ================== WHY THIS FILE IS SEPARATE FROM `plate.ts` ==================
 * The same split `controlSurfaceLayout.ts` has from `controlSurface.ts`, for
 * the same reason: everything here is pure - numbers in, numbers out, no Phaser
 * and no DOM - so the part a player actually complains about can be UNIT TESTED
 * rather than eyeballed in a capture.
 *
 * And the part a player complained about is SPACING. UR-70: "how its nice and
 * condensed space without excessive padding", against a warp break whose
 * destination line was followed by a 70 px hole. A hole is a subtraction
 * between two rectangles, which is exactly the kind of thing this project has
 * learned to assert (`support/warpLayout.ts` and `support/resultsLayout.ts`
 * both exist for the same reason).
 *
 * ================== THE RHYTHM, STATED ==================
 * Three vertical steps and nothing between them. Every plate in the game insets
 * its content by one of these and separates its rows by one of these.
 *
 *   tight  8   rows of one instrument that read as ONE control
 *   glass 12   the inset on a plate cut to a single line of type
 *   card  20   the inset on a content card, and the air between its rows
 *
 * They are not invented. 12 is `SKY_PLATE.padY`, which is the padding AC-22.8's
 * evidence has been measured against since the plate token landed; 20 is
 * `SPACE.gap`; 8 is the step the warp instrument was already built on (UR-62).
 * What is new is that they are the ONLY three, that they are a property of the
 * shared component rather than of nine scenes, and that a screen names which
 * one it is on instead of adding 24 to a y coordinate.
 *
 * HORIZONTAL PADDING IS UNCHANGED, DELIBERATELY. UR-70 is a vertical
 * complaint, and the horizontal inset is what sets a wrapped sentence's line
 * count - a screen whose card wraps to two lines instead of one is a different
 * defect wearing this fix's clothes. The x insets below are the numbers the
 * screens already drew at.
 *
 * ================== THE ROW MODEL ==================
 * A plate is a stack of rows, top-aligned, separated by the rhythm's gap, with
 * one pad above the first and one below the last. `stackRows` is that sentence
 * as a function and `plateHeight` is its inverse, so a card's HEIGHT is derived
 * from what is in it rather than picked and then found to be 60 px too tall.
 *
 * A row's height comes from `lineBox`, which is the DEVANAGARI line box, not
 * the Latin one. Rule 5: these screens render in three languages, and a card
 * measured in English is the "briefing page fit at Mars" defect with different
 * nouns. Hindi's ink box is 1.23x Latin's (`theme.LINE_HEIGHT`, measured), so a
 * rhythm laid out on Latin metrics collides the moment the language changes.
 */

// ---------------------------------------------------------------------------
// The three steps
// ---------------------------------------------------------------------------

/**
 * Every vertical distance a plate is allowed to put between two things.
 *
 * A fourth entry here is a design decision, not a tweak: it means some screen
 * has a spacing need the other eight do not, and the thing to do with that is
 * write down which screen and why.
 */
export const PLATE_STEP = {
  tight: STEP.hair,
  glass: STEP.tight,
  card: STEP.unit,
} as const;

/** Air between two plates stacked in one column. One step, like everything. */
export const PLATE_STACK_GAP = PLATE_STEP.card;

export interface PlateRhythm {
  /** Left and right inset from the plate's edge to its content. */
  readonly padX: number;
  /** Top and bottom inset. */
  readonly padY: number;
  /** Between two stacked rows inside the plate. */
  readonly gap: number;
}

/**
 * The four rhythms a plate can be on, and what each is for.
 *
 * `card`      prose and a control: the warp sentence, the stage report's
 *             panels, the stall card, the briefing page.
 * `instrument` a dense readout cluster that has to read as ONE control - the
 *             warp drive's label / track / charged line (UR-62), the HUD's
 *             readouts. Tighter than a card on purpose: air between the rows of
 *             one instrument is what made the warp drive read as three pieces.
 * `chip`      one line of type on glass. Identical to `SKY_PLATE`, because
 *             `skyText` draws exactly this and V-22.8's evidence is measured
 *             against those two numbers - changing them here would silently
 *             move the contrast rows' geometry.
 * `button`    a control the player presses. `SPACE.rowPad*`, which is what the
 *             menu kit's rows have always used.
 */
export const PLATE_RHYTHM = {
  card: { padX: STEP.pad, padY: PLATE_STEP.card, gap: PLATE_STEP.card },
  /**
   * `padX` IS THE CARD'S, and that is a change (UR-69 near-miss).
   *
   * It was `STEP.inset` (32) - "the numbers the screens already drew at", per
   * the note above, which deliberately left horizontal padding alone because
   * UR-70 was a vertical complaint. The consequence showed up in the census:
   * the warp break stacks a CARD and an INSTRUMENT in one column, both plates
   * on `GUTTER`, so the screen drew its destination line at 136 and the words
   * "warp drive" at 128 - an 8 px near-miss between two things that are meant
   * to read as one left edge, which is exactly the one-off being objected to.
   *
   * A rhythm's job is VERTICAL density; that is what its own docstring above
   * says it is for, and `padY` 12 / `gap` 8 still say it. Two plates stacked in
   * one column share a content line or the column has two edges.
   *
   * The risk the old note names - a wider inset rewrapping a sentence - runs
   * the other way here: the instrument's content box gets 16 px NARROWER on a
   * 1728 px card, holding "warp drive", a track and one charged line.
   */
  instrument: { padX: STEP.pad, padY: PLATE_STEP.glass, gap: PLATE_STEP.tight },
  chip: { padX: SKY_PLATE.padX, padY: SKY_PLATE.padY, gap: PLATE_STEP.tight },
  button: { padX: SPACE.rowPadX, padY: SPACE.rowPadY, gap: PLATE_STEP.tight },
} as const satisfies Record<string, PlateRhythm>;

export type PlateRhythmName = keyof typeof PLATE_RHYTHM;

export function rhythmOf(name: PlateRhythmName = "card"): PlateRhythm {
  return PLATE_RHYTHM[name];
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/**
 * How tall one line of `fontPx` type is, in the WORST language.
 *
 * Devanagari, always, whatever language is loaded. A card whose height depends
 * on the UI language is a card that fits in English and collides in Hindi, and
 * the collision is invisible to anyone reading the screen in English - which is
 * the same shape as the briefing page that fit at Mars and collided at five of
 * the other six stops (standards rule 5).
 */
export function lineBox(fontPx: number, lines = 1): number {
  return Math.round(fontPx * LINE_HEIGHT.devanagari) * Math.max(1, lines);
}

/** The content box: the plate minus its padding. */
export function plateContent(rect: Rect, name: PlateRhythmName = "card"): Rect {
  const r = rhythmOf(name);
  return {
    x: rect.x + r.padX,
    y: rect.y + r.padY,
    w: Math.max(0, rect.w - r.padX * 2),
    h: Math.max(0, rect.h - r.padY * 2),
  };
}

/**
 * The plate's rows, top-aligned inside its content box.
 *
 * TOP-ALIGNED AND NOT CENTRED, which is the whole of UR-70's padding note. The
 * warp sentence used to be centred in a fixed band, so a one-line stop put half
 * its slack ABOVE the sentence - a 70 px hole between "destination: saturn" and
 * the thing the child is there to type. Centring distributes dead space evenly;
 * a rhythm puts all of it at the bottom, where a card's foot is, and keeps the
 * distance between a label and the thing it labels the same on every screen and
 * at every sentence length.
 */
export function stackRows(
  rect: Rect,
  heights: readonly number[],
  name: PlateRhythmName = "card",
): Rect[] {
  const r = rhythmOf(name);
  const box = plateContent(rect, name);
  const out: Rect[] = [];
  let y = box.y;
  for (const h of heights) {
    out.push({ x: box.x, y, w: box.w, h });
    y += h + r.gap;
  }
  return out;
}

/**
 * The height a plate needs to hold these rows on this rhythm.
 *
 * The inverse of `stackRows`, so a card's height is DERIVED rather than picked.
 * `PANEL.h` on the warp break was 280 because somebody tried 250, found the
 * hint printed through, and added 30.
 */
export function plateHeight(heights: readonly number[], name: PlateRhythmName = "card"): number {
  const r = rhythmOf(name);
  if (heights.length === 0) return r.padY * 2;
  const rows = heights.reduce((a, b) => a + b, 0);
  return r.padY * 2 + rows + r.gap * (heights.length - 1);
}

/**
 * A row pinned to the BOTTOM of the plate's content box.
 *
 * For the one thing a card has that is not part of its reading order: the
 * keyboard hint at the foot of the warp sentence card. It is a footer, so it
 * sits at the foot, and the slack a short sentence leaves lands between the
 * content and it rather than between a heading and its body.
 */
export function plateFooter(rect: Rect, height: number, name: PlateRhythmName = "card"): Rect {
  const box = plateContent(rect, name);
  return { x: box.x, y: box.y + box.h - height, w: box.w, h: height };
}

// ---------------------------------------------------------------------------
// Chrome geometry (UR-70)
// ---------------------------------------------------------------------------

/**
 * How long a corner bracket's arms are, as a fraction of the plate's SHORTER
 * side, and the floor and ceiling that keeps them reading as corners.
 *
 * An arm that is half the edge is not a bracket, it is a broken border; an arm
 * of 6 px on a 1728 px card is a speck. Bounded rather than tuned per screen,
 * because the same component draws a 96 px chip and a 1728 px card.
 */
export const BRACKET = {
  fraction: 0.14,
  min: 18,
  max: 56,
} as const;

export function bracketArm(rect: Rect): number {
  const side = Math.min(rect.w, rect.h);
  return Math.round(
    Math.min(BRACKET.max, Math.max(BRACKET.min, side * BRACKET.fraction)),
  );
}

export interface Segment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/**
 * The eight strokes of a four-corner bracket: two arms per corner, inset by the
 * radius so they start where the rounded corner's arc ends.
 *
 * Pure, and returned as segments rather than drawn, so the test can assert that
 * every arm is inside the plate and that no two of them meet - a "bracket" whose
 * arms join is just the border again.
 */
export function bracketSegments(rect: Rect, radius: number): Segment[] {
  const arm = bracketArm(rect);
  const r = Math.min(radius, Math.min(rect.w, rect.h) / 2);
  const l = rect.x;
  const t = rect.y;
  const rt = rect.x + rect.w;
  const b = rect.y + rect.h;
  return [
    { x1: l, y1: t + r + arm, x2: l, y2: t + r },
    { x1: l + r, y1: t, x2: l + r + arm, y2: t },
    { x1: rt - r - arm, y1: t, x2: rt - r, y2: t },
    { x1: rt, y1: t + r, x2: rt, y2: t + r + arm },
    { x1: rt, y1: b - r - arm, x2: rt, y2: b - r },
    { x1: rt - r, y1: b, x2: rt - r - arm, y2: b },
    { x1: l + r + arm, y1: b, x2: l + r, y2: b },
    { x1: l, y1: b - r, x2: l, y2: b - r - arm },
  ];
}

/**
 * The rim's rectangle: a second outline OUTSIDE the plate, with a gap of sky
 * between the two.
 *
 * UR-70 asks for a gold line around the whole element. Outside and not on the
 * edge, because a rim drawn on the plate's own border is a thicker border -
 * the two-line read is what makes it chrome. The gap is one tight step.
 */
export const RIM = {
  gap: PLATE_STEP.tight,
  width: 2,
} as const;

export function rimRect(rect: Rect, gap: number = RIM.gap): Rect {
  return { x: rect.x - gap, y: rect.y - gap, w: rect.w + gap * 2, h: rect.h + gap * 2 };
}

export function rimRadius(radius: number, gap: number = RIM.gap): number {
  return radius + gap;
}

/**
 * The square the destination badge occupies, tucked inside the plate's top
 * right corner (UR-70: the destination's icon, set in the element's top right).
 *
 * INSIDE, on the plate's own padding, so it cannot collide with a rim or a
 * bracket arm and cannot hang over an edge on a narrow window.
 */
export function badgeBox(
  rect: Rect,
  size: number,
  name: PlateRhythmName = "card",
): Rect {
  const box = plateContent(rect, name);
  return { x: box.x + box.w - size, y: box.y, w: size, h: size };
}
