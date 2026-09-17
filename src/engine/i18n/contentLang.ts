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

/**
 * SHIPPED CONTENT LANGUAGES (D95).
 *
 * Spanish and Hindi are BUILT, TRANSLATED AND TESTED — every bundle, sight-word
 * list, warp sentence and fit budget is in `src/content/` and exercised by
 * `tests/unit/content/`. They are withheld from the SHIPPED menu for the
 * hackathon build only, to shrink the surface that has to be kept honest before
 * the deadline. Nothing was deleted and nothing was weakened.
 *
 * TO RESTORE: put "es" and "hi" back in this array. That is the whole change.
 * The content, the translations, the normalisation, the transliteration matcher
 * and their tests all keep running in the meantime, so they cannot rot while
 * they are dormant — `tests/unit/content/` still fails the build if a Spanish
 * copy budget is blown or a Devanagari matra is truncated.
 *
 * WHY THIS IS A FILTER AND NOT A DELETION. Removing the content would make
 * every check that covers it pass by having nothing left to measure, which is
 * the failure mode this repo has hit repeatedly (see docs/audit.md). A filter
 * keeps the checks running against real data and makes the cut visible in one
 * place instead of invisible in fifty.
 */
export const SHIPPED_LANGS: readonly Lang[] = ["en"] as const;

/** Is this language offered in the build the player actually gets? (D95) */
export function isShipped(lang: Lang): boolean {
  return SHIPPED_LANGS.includes(lang);
}

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
  return LANGS.filter((lang) => isShipped(lang) && canTypeLang(lang, inputMethod));
}

/**
 * The full set AC-14.1 would offer if D95 were lifted, ignoring the ship
 * filter. Kept so the input-method rule stays under test on all three
 * languages while only English is shipped: without this, cutting es/hi would
 * quietly reduce AC-14.1's Devanagari case to dead code that nothing exercises.
 */
export function typeableContentLangs(inputMethod: InputMethod): Lang[] {
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
  // D95: a profile saved before the ship filter may carry es/hi. Repair it the
  // same way an untypeable pair is repaired, so an existing save degrades to a
  // playable language instead of selecting content the menu no longer offers.
  if (isShipped(current) && canTypeLang(current, inputMethod)) return current;
  if (isShipped(uiLang) && canTypeLang(uiLang, inputMethod)) return uiLang;
  return "en";
}
