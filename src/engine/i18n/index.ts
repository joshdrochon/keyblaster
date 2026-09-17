/**
 * i18n (D45, D46, D41; PRD FR-14; architecture section 8).
 *
 * Four things live here:
 *   strings.ts     UI string tables for en/es/hi and the StringKey union.
 *   translate.ts   lookup, `{shipName}` interpolation (C07), missing-key policy.
 *   contentLang.ts AC-14.1 - content languages filtered by input method.
 *   translit.ts    AC-14.2 - romanized Hindi -> Devanagari, variant sets.
 *   hardcoded.ts   AC-14.3 - the reusable no-hard-coded-copy checker.
 *   fit.ts         Spanish +25% copy budget from the design brief.
 *
 * THE PORT lock/ CONSUMES is `WordMatcher` (`createWordMatcher(inputMethod)`):
 * two predicates, `isPrefix` and `isComplete`. The lock injects it rather than
 * importing the table, so variant sets reach per-keystroke narrowing without
 * lock/ knowing any Devanagari. `canonicalRomanization` is for DISPLAY only -
 * a lock that matches against that one string is back to the single-spelling
 * failure the variant sets exist to prevent.
 *
 * Pure TypeScript throughout: no DOM, no clock, no storage (CLAUDE.md).
 */

export {
  EN,
  ES,
  FALLBACK_LANG,
  HI,
  STRING_KEYS,
  TABLES,
  type StringKey,
  type StringTable,
} from "./strings.js";

export {
  createTranslator,
  interpolate,
  MissingParamError,
  MissingStringError,
  placeholdersIn,
  type InterpolationParams,
  type Mode,
  type Translator,
  type TranslatorOptions,
} from "./translate.js";

export {
  availableContentLangs,
  canTypeLang,
  DEVANAGARI_INPUT_METHODS,
  DEVANAGARI_LANGS,
  isDevanagariLang,
  isShipped,
  resolveContentLang,
  SHIPPED_LANGS,
  typeableContentLangs,
} from "./contentLang.js";

export {
  canonicalRomanization,
  createWordMatcher,
  EXACT_MATCHER,
  findAmbiguousPairs,
  hasDevanagari,
  isTransliterationPrefix,
  matchesTransliteration,
  matchesTypedWord,
  normalizeTyped,
  romanizationsOf,
  segmentDevanagari,
  TRANSLIT_MATCHER,
  TRANSLIT_TABLE,
  type Akshara,
  type AmbiguousPair,
  type WordMatcher,
} from "./translit.js";

export {
  findHardcodedStrings,
  HARDCODED_IGNORE_MARKER,
  scanSource,
  type HardcodedFinding,
  type HardcodedReason,
} from "./hardcoded.js";

export {
  fits,
  LANG_EXPANSION,
  overflowingLangs,
  projectedLength,
  widestLength,
} from "./fit.js";
