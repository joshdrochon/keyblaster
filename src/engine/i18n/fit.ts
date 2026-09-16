import type { Lang } from "../types.js";
import { type StringKey, type StringTable, TABLES } from "./strings.js";

/**
 * Label-fit budgeting (design-brief-v2.md, i18n section: "Design text
 * containers for Spanish length (+25%) and Devanagari height").
 *
 * This is a CHARACTER-COUNT budget, not a pixel measurement. src/engine has no
 * DOM and no font metrics (CLAUDE.md hard rule), so the real sizing happens in
 * src/game/render against glyph metrics. What belongs here is the thing a unit
 * test can hold: a copy budget per label, checked against the actual strings in
 * every language, so an over-long translation fails in CI rather than clipping
 * on a child's screen.
 *
 * Devanagari is deliberately absent from the expansion factor. Hindi runs
 * SHORTER than English in characters and taller in pixels; height is a font
 * metrics problem, and inventing a multiplier here would be a made-up number.
 * The brief gives one number, +25% for Spanish, and that is the one encoded.
 */

/** Documented copy expansion vs. English, by language. */
export const LANG_EXPANSION: Readonly<Record<Lang, number>> = {
  en: 1,
  es: 1.25,
  hi: 1,
};

/**
 * Worst-case length a designer should budget for a label whose English copy is
 * `enText`. Used before translations exist; once they do, measure them.
 */
export function projectedLength(enText: string, lang: Lang): number {
  return Math.ceil(enText.length * LANG_EXPANSION[lang]);
}

export function fits(text: string, maxChars: number): boolean {
  return text.length <= maxChars;
}

/**
 * Which languages blow a label's budget. Empty array means the label is safe
 * in all three. Interpolated values are not counted: the caller sizes for
 * `{shipName}` separately, since a player can name their ship anything.
 */
export function overflowingLangs(
  key: StringKey,
  maxChars: number,
  tables: Readonly<Record<Lang, StringTable>> = TABLES,
): Lang[] {
  const out: Lang[] = [];
  for (const lang of Object.keys(tables) as Lang[]) {
    const text = tables[lang][key];
    if (text !== undefined && !fits(text, maxChars)) out.push(lang);
  }
  return out;
}

/** Longest rendering of a key across all languages, for sizing a container. */
export function widestLength(
  key: StringKey,
  tables: Readonly<Record<Lang, StringTable>> = TABLES,
): number {
  let widest = 0;
  for (const lang of Object.keys(tables) as Lang[]) {
    const text = tables[lang][key];
    if (text !== undefined && text.length > widest) widest = text.length;
  }
  return widest;
}
