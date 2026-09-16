import Phaser from "phaser";
import type { Lang } from "@engine/types";
import {
  FONT_STACK,
  INK,
  chromeCase,
  letterSpacingPx,
  lineHeightEm,
} from "./theme.js";

/**
 * One text factory for every menu label, so the three D41 typography settings -
 * letter case, increased letter spacing, and the script's line height - are
 * applied in exactly one place and cannot drift between screens.
 *
 * `chrome: false` opts a string out of the letter-case setting. That is for the
 * child's own words: a pilot called "Ana" stays "Ana" when the game is in
 * lowercase mode, because her name is not chrome.
 */

export interface UiTextOptions {
  readonly size?: number;
  readonly color?: string;
  readonly align?: "left" | "center" | "right";
  /** Word-wrap width in px. Omit for a single line sized to content. */
  readonly wrapWidth?: number;
  readonly lang: Lang;
  readonly uppercase: boolean;
  readonly increasedLetterSpacing: boolean;
  /** False for user-entered names; true (default) for UI copy. */
  readonly chrome?: boolean;
  readonly alpha?: number;
}

export function uiText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  content: string,
  options: UiTextOptions,
): Phaser.GameObjects.Text {
  const size = options.size ?? 30;
  const shown =
    options.chrome === false ? content : chromeCase(content, options.uppercase);

  const style: Phaser.Types.GameObjects.Text.TextStyle = {
    fontFamily: FONT_STACK,
    fontSize: `${size}px`,
    color: options.color ?? INK.text,
    align: options.align ?? "left",
    // Devanagari's ink box is ~1.23x Latin's at the same point size
    // (theme.ts LINE_HEIGHT documents the measurement), so rows in Hindi get
    // more leading rather than smaller glyphs.
    lineSpacing: Math.round(size * (lineHeightEm(options.lang) - 1)),
  };
  if (options.wrapWidth !== undefined) {
    style.wordWrap = { width: options.wrapWidth, useAdvancedWrap: true };
  }

  const text = scene.add.text(x, y, shown, style);
  const spacing = letterSpacingPx(size, options.increasedLetterSpacing);
  // setLetterSpacing arrived in Phaser 3.60; guard so the kit still renders on
  // an older runtime rather than throwing on the first label.
  const withSpacing = text as unknown as {
    setLetterSpacing?: (v: number) => Phaser.GameObjects.Text;
  };
  if (typeof withSpacing.setLetterSpacing === "function") {
    withSpacing.setLetterSpacing(spacing);
  }
  if (options.alpha !== undefined) text.setAlpha(options.alpha);
  return text;
}

/**
 * Size a control TO CONTENT with a floor, never to a fixed width derived from
 * the English string.
 *
 * The design brief's flat "+25% for Spanish" is a trap for short labels, which
 * is all a settings screen has: `Locked` -> `Bloqueado` is +50%, `Pilot name`
 * -> `Nombre del piloto` is +70%, `Beacon Log` -> `Registro de balizas` is
 * +90%. Growth is inversely proportional to length, because Spanish pays a
 * fixed cost in articles and prepositions that a short label cannot amortise.
 * So every plate in this kit is measured from the text object that is actually
 * on screen, in the language that is actually selected, and the minimum only
 * stops a one-word control from collapsing.
 */
export function plateWidth(
  content: Phaser.GameObjects.Text,
  padX: number,
  minWidth: number,
): number {
  return Math.max(minWidth, Math.ceil(content.width) + padX * 2);
}

/** Same rule vertically, which is where Devanagari bites instead. */
export function plateHeight(
  content: Phaser.GameObjects.Text,
  padY: number,
  minHeight: number,
): number {
  return Math.max(minHeight, Math.ceil(content.height) + padY * 2);
}
