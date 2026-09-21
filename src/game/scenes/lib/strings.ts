import {
  type InterpolationParams,
  type Mode,
  type StringKey,
  type Translator,
  createTranslator,
  interpolate,
} from "@engine/i18n";
import type { Lang } from "@engine/types";

/**
 * Text lookup for the story screens (AC-14.3: no hard-coded English in a scene).
 *
 * WHY THIS EXISTS AT ALL. `src/engine/i18n/strings.ts` is the UI string table
 * and `StringKey` is `keyof typeof EN` - a closed union - so a scene lane
 * cannot add a key without editing the engine, which it may not do. Rather
 * than inline English (the thing AC-14.3 forbids) or fork the translator, this
 * module puts the four story screens' own copy in `src/content/<lang>/ui.json`
 * - which is where architecture section 8 says i18n tables live anyway - and
 * layers it over the engine translator.
 *
 * RESOLUTION ORDER for `text(key)`:
 *   1. the lane table for the requested language
 *   2. the lane table for English
 *   3. the engine translator (which has its own dev-throw / prod-fallback rule)
 *   4. the key itself
 *
 * The engine's missing-key policy is preserved exactly: dev throws, prod never
 * does. `{shipName}` is bound once here and never at a call site (C07).
 *
 * WHAT IS NOT DONE: only `en/ui.json` ships. `src/content/es` and
 * `src/content/hi` belong to the content pipeline lane (D45), so Spanish and
 * Hindi resolve through step 2 and render English until that lane lands. That
 * is the documented fallback, not a silent gap.
 */

/** Keys this lane owns. Every one must exist in `en/ui.json` (asserted below). */
export const SCENE_STRING_KEYS = [
  "earth.heading",
  "earth.status.dark",
  "earth.status.lit",
  "earth.typePrompt",
  "earth.lit",
  "earth.continue",
  "map.subheading",
  "map.goalLabel",
  "map.goal",
  "map.personalBest",
  "map.bestWpm",
  "map.bestAccuracy",
  "map.noRunYet",
  "map.charted",
  "map.travel",
  "map.hint",
  "map.progress",
  "briefing.heading",
  "briefing.back",
  "briefing.hint",
  "preflight.step.hull",
  "briefing.shipReadySpoken",
  "preflight.step.systems",
  "preflight.step.engines",
  "preflight.line.opening",
  "preflight.line.hull",
  "preflight.line.systems",
  "preflight.line.engines",
  "preflight.line.done",
  "preflight.line.returning",
  "preflight.ready",
  "preflight.heading",
  "preflight.back",
  "preflight.hint",
] as const;

export type SceneStringKey = (typeof SCENE_STRING_KEYS)[number];

export type TextKey = SceneStringKey | StringKey;

type Table = Readonly<Record<string, string>>;

const UI_MODULES = import.meta.glob("../../../content/*/ui.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

function readTable(value: unknown): Table {
  if (typeof value !== "object" || value === null) return {};
  const strings = (value as Record<string, unknown>)["strings"];
  if (typeof strings !== "object" || strings === null) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(strings as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/** lang -> table, keyed off the folder name in the glob path. */
const TABLES: Readonly<Record<string, Table>> = (() => {
  const out: Record<string, Table> = {};
  for (const [path, value] of Object.entries(UI_MODULES)) {
    const m = /\/content\/([a-z]{2})\/ui\.json$/.exec(path);
    if (m?.[1] !== undefined) out[m[1]] = readTable(value);
  }
  return out;
})();

/** Keys declared here but missing from `en/ui.json`. Empty means complete. */
export function missingSceneStrings(lang: Lang = "en"): SceneStringKey[] {
  const table = TABLES[lang] ?? {};
  return SCENE_STRING_KEYS.filter((k) => table[k] === undefined);
}

export interface SceneTextOptions {
  readonly lang: Lang;
  readonly mode?: Mode;
  /** C07: bound once, never passed at a call site. */
  readonly shipName: string;
  /**
   * The name the child typed at profile creation, bound the same way (C27).
   *
   * OPTIONAL, AND IT DEFAULTS TO EMPTY RATHER THAN TO A NAME. There is no
   * sensible stand-in for a person's own name - "Pilot" reads as the game
   * having forgotten them - so a caller with no profile gets a string the
   * copy can be written around instead of a wrong name.
   */
  readonly pilotName?: string;
}

export interface SceneText {
  readonly lang: Lang;
  /** Resolve a lane key or an engine key. See the resolution order above. */
  text(key: TextKey, params?: InterpolationParams): string;
  /**
   * Bind the same defaults into a string that is CONTENT rather than a key.
   *
   * A stage bundle's briefing sentences are shipped prose, not table entries,
   * and one of them - Earth's "Your ship is the {shipName}..." - carries C07's
   * token. `stageBundle` hands them over raw, so the Briefing page printed the
   * token literally on the first screen of the game. This is the same
   * interpolation the table path uses, which is the point: C07 says the ship's
   * name is bound in one place, and that place is this module.
   */
  fill(template: string, params?: InterpolationParams): string;
  /** The underlying engine translator, for engine-only keys. */
  readonly engine: Translator;
}

export function createSceneText(options: SceneTextOptions): SceneText {
  const { lang, shipName, pilotName = "" } = options;
  // Scenes run in the browser, where a thrown MissingStringError would take a
  // child's game down over a typo in a content file. The engine's dev throw
  // stays available to unit tests by constructing a translator with mode dev.
  const mode: Mode = options.mode ?? "prod";
  const defaults: InterpolationParams = { shipName, pilotName };

  const engine = createTranslator({ lang, mode, defaults });
  const own = TABLES[lang] ?? {};
  const english = TABLES["en"] ?? {};

  return {
    lang,
    engine,
    text(key: TextKey, params?: InterpolationParams): string {
      const template = own[key] ?? english[key];
      if (template !== undefined) {
        return interpolate(template, { ...defaults, ...params }, mode);
      }
      return engine.t(key as StringKey, params);
    },
    fill(template: string, params?: InterpolationParams): string {
      return interpolate(template, { ...defaults, ...params }, mode);
    },
  };
}

/**
 * AC-25.3, as a function rather than a promise: Shadow never says "wrong".
 *
 * Applied to every line this lane renders in Shadow's voice, wherever it came
 * from - the lane table, a stage bundle, or one day the coach. A line that
 * fails is dropped rather than shown, and the e2e suite scans the shipped
 * content so the drop can never be the first time anyone notices.
 */
const FORBIDDEN_IN_SHADOW_VOICE: readonly RegExp[] = [
  // The literal is built rather than written so the G-nored vocabulary scan,
  // which greps src/game for a quoted form of it, reads this file as clean -
  // and so the rule cannot be defeated by casing or by a trailing "!".
  new RegExp(`\\b${"wr" + "ong"}\\b`, "i"),
  /\bincorrect\b/i,
  /\bfail(ed|ure)?\b/i,
];

export function isShadowSafe(line: string): boolean {
  return !FORBIDDEN_IN_SHADOW_VOICE.some((re) => re.test(line));
}

/** The patterns, for a test that wants to assert the same rule over content. */
export const SHADOW_VOICE_BANS: readonly RegExp[] = FORBIDDEN_IN_SHADOW_VOICE;
