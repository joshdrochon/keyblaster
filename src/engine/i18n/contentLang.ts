import { type InputMethod, type Lang, LANGS } from "../types.js";

/**
 * Content-language availability (AC-14.1, D45, D46).
 *
 * D45: "Content language is only offered if the selected keyboard/input method
 * can type it." AC-14.1 fixes the one case that bites: Devanagari content is
 * offered ONLY when `inputMethod` is `inscript` (native layout) or `translit`
 * (romanized buffer -> Devanagari, D46).
 *
 * en and es are Latin script and are always offered. `inputMethod` describes
 * how Hindi is entered, not what the keyboard can produce in general; a
 * Devanagari layout does not remove a child's ability to type "water". Spanish
 * accents are handled by normalisation in allowlist/normalize.ts, not here.
 */

/** Languages written in Devanagari, so gated by input method. */
export const DEVANAGARI_LANGS: readonly Lang[] = ["hi"] as const;

/** Input methods that can produce Devanagari (D46). */
export const DEVANAGARI_INPUT_METHODS: readonly InputMethod[] = [
  "inscript",
  "translit",
] as const;

export function isDevanagariLang(lang: Lang): boolean {
  return DEVANAGARI_LANGS.includes(lang);
}

/** AC-14.1: can this input method actually type this content language? */
export function canTypeLang(lang: Lang, inputMethod: InputMethod): boolean {
  if (!isDevanagariLang(lang)) return true;
  return DEVANAGARI_INPUT_METHODS.includes(inputMethod);
}

/**
 * AC-14.1: the content-language options the Settings screen may show.
 * Order follows LANGS so the menu is stable between renders.
 */
export function availableContentLangs(inputMethod: InputMethod): Lang[] {
  return LANGS.filter((lang) => canTypeLang(lang, inputMethod));
}

/**
 * Repair a settings pair that AC-14.1 has just invalidated - the player
 * switched their input method back to `latin` while Hindi content was
 * selected. Prefer the UI language so the game stays in one language where it
 * can, then English, which is always typeable.
 *
 * Returning the current value unchanged when it is still legal matters: the
 * caller can use identity to decide whether to tell the player anything.
 */
export function resolveContentLang(
  current: Lang,
  inputMethod: InputMethod,
  uiLang: Lang,
): Lang {
  if (canTypeLang(current, inputMethod)) return current;
  if (canTypeLang(uiLang, inputMethod)) return uiLang;
  return "en";
}
