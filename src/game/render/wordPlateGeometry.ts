/**
 * The word plate's ARITHMETIC, with no Phaser in it.
 *
 * ================== WHY THIS FILE EXISTS ==================
 * `wordPlate.ts` declares `class WordPlate extends Phaser.GameObjects.Container`,
 * so importing ANY symbol from it executes Phaser and dies on "window is not
 * defined" under vitest's node environment. Two guards documented that wall and
 * restated the numbers instead of importing them:
 *
 *   tests/unit/flight/hudKeepOut.test.ts - "PLATE WIDTH is still restated here,
 *   and cannot be imported today... THE FIX IS A MODULE SPLIT, not a wider
 *   tolerance... Not done tonight; raised in gauntlet/escalations.md"
 *   tests/unit/render/wordPlateOpacity.test.ts - "Until that module is split, a
 *   source guard is the only binding available"
 *
 * A guard that re-derives the numbers it is checking is testing its own
 * arithmetic (coding-standards rule 4's shape). This is that split: the pure
 * geometry and the pure colour maths move here, `wordPlate.ts` imports and
 * re-exports every one of them so no caller moves, and a unit test can now hold
 * the renderer's own functions rather than a copy of them.
 *
 * `PLATE_FILL_ALPHA` deliberately did NOT move. It is a property of the
 * DRAWING, its guard reads `wordPlate.ts` as source to prove the draw call uses
 * it, and moving it would make that guard pass on a file that no longer draws
 * anything.
 *
 * Nothing here knows what a scene is. Everything is a function of a word, a
 * style and a size in px.
 *
 * ================== ONE THING IS NO LONGER A FUNCTION OF ITS ARGUMENTS ======
 * `plateSize` and everything downstream of it read the glyph-advance cache in
 * `glyphAdvance.ts`, because the plate is set in a PROPORTIONAL face and a
 * layout that assumes one width per character overlaps its own letters. This
 * file is still Phaser-free and DOM-free and still loads under node; it is no
 * longer referentially transparent. `glyphAdvance.ts` states the whole trade,
 * including what still holds without it.
 */

import { glyphAdvancePx } from "./glyphAdvance.js";

/** Gap between the bottom of the rock and the top of the plate, in px. */
export const PLATE_GAP_PX = 16;

export const PLATE_PAD_X_PX = 14;
export const PLATE_PAD_Y_PX = 8;
export const PLATE_RADIUS_PX = 8;

/** AC-22.8 / rubric 8. */
export const PLATE_MIN_CONTRAST = 4.5;

export interface WordPlateStyle {
  /** Plate fill, from the stop palette's `plate`. */
  readonly plate: string;
  /** Resting letter colour, from the stop palette's `plateText`. */
  readonly plateText: string;
  /** Typed letters light to this (art-direction section 7). */
  readonly accent: string;
  readonly fontFamily: string;
  readonly fontSizePx: number;
  /** D41 increased letter spacing. */
  readonly letterSpacingPx: number;
  /** D41 letter case; lowercase is the default. */
  readonly uppercase: boolean;
  /** D41 reduced motion: the underline stops pulsing, the cue stays. */
  readonly reducedMotion: boolean;
}

// ---------------------------------------------------------------------------
// Colour maths. Exported because V-22.8's evidence must be measured with the
// renderer's own formula (D85: evidence, not a restatement).
// ---------------------------------------------------------------------------

/** "#rgb" or "#rrggbb" to 0xrrggbb. Throws on anything else: a bad palette
 * entry is a content bug and must not render as silent black. */
export function hexToInt(hex: string): number {
  const raw = hex.trim().replace(/^#/, "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`not a hex colour: ${hex}`);
  }
  return Number.parseInt(full, 16);
}

export function hexToRgb(hex: string): readonly [number, number, number] {
  const n = hexToInt(hex);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(hex: string): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.1 contrast ratio, always >= 1. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** AC-22.8 as a predicate, for the palette check and for tests. */
export function meetsPlateContrast(plate: string, text: string): boolean {
  return contrastRatio(plate, text) >= PLATE_MIN_CONTRAST;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Display form of a word under the letter-case setting (D41). */
export function displayWord(word: string, uppercase: boolean): string {
  return uppercase ? word.toUpperCase() : word;
}

/**
 * The glyphs a plate draws, one `Text` object each.
 *
 * Code points, NOT grapheme clusters, and deliberately unchanged: this is the
 * unit `wordPlate.ts` builds a `Text` for and the unit `WordPlate.letterCount`
 * reports to `@engine/lock`'s typed count. Moving it is a behaviour change in
 * the lock, not a spacing change. See `glyphAdvance.ts` for what that costs
 * Devanagari and where it is raised.
 */
export function plateGlyphs(word: string, style: WordPlateStyle): readonly string[] {
  return [...displayWord(word, style.uppercase)];
}

/**
 * How far the pen moves after each glyph of `word`, px, in draw order.
 *
 * ================== THIS REPLACED A FIXED CELL ==================
 * It used to be `cellWidthPx(style)` - `fontSizePx * 0.62 + letterSpacingPx`,
 * 19.6 px at Flight's 30 px and D41-off spacing - for EVERY character, while
 * `wordPlate.ts` drew those characters in a proportional face. Measured
 * advances at 30 px on the plate's own stack run from 6.52 px (`l`) to 24.49 px
 * (`m`): a spread of 17.97 px on a 19.6 px cell. `ll` got 13.08 px of air
 * between its two letters; `mp` in "jump" was drawn with the two glyphs
 * OVERLAPPING by 1.08 px, and `me` in "time" by 0.53 px.
 *
 * The advance is the font's own answer, so packing advance boxes end to end IS
 * even optical spacing - that is what an advance width is for. The plate then
 * adds `letterSpacingPx` between boxes, so the gap between any two adjacent
 * letters on any plate is exactly `letterSpacingPx` whatever the word, the face
 * or the script.
 */
export function letterAdvancesPx(
  word: string,
  style: WordPlateStyle,
): readonly number[] {
  return plateGlyphs(word, style).map((g) =>
    glyphAdvancePx(g, style.fontFamily, style.fontSizePx),
  );
}

/**
 * Where each glyph's CENTRE sits, px from the left edge of the text run.
 *
 * Centres rather than left edges because `wordPlate.ts` draws its letters with
 * `setOrigin(0.5, 0.5)` - it always has - and the underline cue is centred on
 * the next letter. One function answers both, so the cue and the glyph cannot
 * drift apart.
 */
export function letterCentresPx(
  word: string,
  style: WordPlateStyle,
): readonly number[] {
  const out: number[] = [];
  let pen = 0;
  for (const advance of letterAdvancesPx(word, style)) {
    out.push(pen + advance / 2);
    pen += advance + style.letterSpacingPx;
  }
  return out;
}

/**
 * The width of the set text, px - advances plus the gaps BETWEEN them.
 *
 * `n - 1` gaps, not `n`. The old cell folded `letterSpacingPx` into every
 * character including the last, so a plate carried one trailing gap of padding
 * nobody asked for on top of `PLATE_PAD_X_PX`.
 */
export function textRunWidthPx(word: string, style: WordPlateStyle): number {
  const advances = letterAdvancesPx(word, style);
  if (advances.length === 0) return 0;
  const ink = advances.reduce((a, b) => a + b, 0);
  return ink + style.letterSpacingPx * (advances.length - 1);
}

export interface PlateSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The plate's rectangle, px.
 *
 * NOT A PURE FUNCTION OF ITS ARGUMENTS ANY MORE, and that is a real cost of
 * measuring glyphs rather than assuming them. The width now depends on
 * `glyphAdvance.ts`'s process-wide cache: in node nothing is installed and
 * every answer comes from the shipped table, so unit tests are deterministic;
 * in the browser `boot.ts` installs a canvas measurer and the answer is the
 * real face's. `glyphAdvance.ts` has the full argument for why that is the only
 * honest option here and what it does and does not put at risk. The height is
 * unchanged and still a function of the style alone.
 */
export function plateSize(word: string, style: WordPlateStyle): PlateSize {
  return {
    width: textRunWidthPx(word, style) + PLATE_PAD_X_PX * 2,
    height: style.fontSizePx * 1.25 + PLATE_PAD_Y_PX * 2,
  };
}

/**
 * Where the plate's centre sits relative to the rock's centre (AC-2.3's
 * companion rule: "the word plate hangs BELOW the rock, never over it").
 */
export function plateOffsetY(rockSizePx: number, style: WordPlateStyle): number {
  return rockSizePx / 2 + PLATE_GAP_PX + plateSize("a", style).height / 2;
}

/**
 * Half the height of EVERY plate in one style, px.
 *
 * Plate height is a function of the style alone - `plateSize` puts the word
 * only in the width - so two plates in the same style are the same height, and
 * "do these two plates overlap vertically" is `|dy| < height`. The spawn column
 * rule needs that number without a word to ask it about.
 */
export function plateHalfHeightPx(style: WordPlateStyle): number {
  return plateSize("a", style).height / 2;
}
