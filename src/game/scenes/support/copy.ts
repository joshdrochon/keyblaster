import { interpolate, type InterpolationParams } from "@engine/i18n";
import type { Lang, StopId } from "@engine/types";
import { paletteFor } from "@game/render/palette";
import { createSceneText, type SceneText, type TextKey } from "../lib/strings";
import { hasStageBundle, stageBundle } from "../lib/content";

/**
 * Copy for the Warp / Beacon / Results / Ending screens.
 *
 * `scenes/lib/strings.ts` already owns the lookup, the `{shipName}` binding
 * (C07) and the engine's missing-key policy, and `src/content/en/ui.json`
 * already holds the four story screens another lane built. This module is a
 * thin OVERLAY on top of it: the keys below are this lane's, everything else
 * falls straight through to `SceneText.text`, which in turn falls through to
 * the engine translator.
 *
 * WHY THE TABLE IS TYPESCRIPT AND NOT `content/en/ui.json`. Two lanes are
 * writing that file at the same time and `scenes/lib/content.ts` parses every
 * other `content/en/*.json` as a stage bundle, so a second JSON file would
 * throw at module load. A merged edit to a shared JSON is the one change that
 * cannot be made safely in parallel. When the lanes are reconciled these
 * entries move into `ui.json` verbatim - they are already a flat key -> template
 * map - and `LANE_STRING_KEYS` becomes the `missingSceneStrings` check.
 *
 * C07: nothing here names the ship. `{shipName}` is bound once by
 * `createSceneText` and never passed at a call site.
 */

const LANE_EN = {
  // Warp break (screen 7, D30, FR-16)
  "warp.beltClear": "the belt is clear. everything is still out here.",
  "warp.chargeLabel": "warp drive",
  "warp.chargePercent": "{percent}%",
  "warp.charged": "warp drive charged. hold on.",
  "warp.speaker": "shadow",
  "warp.hint": "type the sentence. a slip just asks for the same letter again.",
  // E-AI-1. Shown ONLY when a live model composed this sentence from the words
  // this child just practised and it passed all six gates. Blank otherwise -
  // the whole point is that a judge can tell the two apart.
  "warp.composed": "shadow wrote this one from your words, just now",

  // Beacon placement (screen 8, D15, FR-17)
  "beacon.calibrating": "beacon calibrating. it will find the sky in a moment.",
  "beacon.continue": "continue",
  "beacon.hint": "enter to continue",

  // Results (screen 9, D50)
  "results.heading": "stage report",
  "results.wpmLabel": "words per minute",
  "results.accuracyLabel": "accuracy",
  "results.deltaUp": "up {amount} from {stop}",
  "results.deltaDown": "down {amount} from {stop}",
  "results.deltaSame": "the same as {stop}",
  "results.fasterHeading": "faster than before",
  "results.fasterMarker": "{word}",
  "results.retentionHeading": "words from earlier stops",
  "results.retentionQuicker":
    "{count} came back. {percent}% on the first try, {ms} ms quicker than the first time you met them.",
  "results.retentionSteady":
    "{count} came back. {percent}% on the first try, holding steady since the first time you met them.",
  "results.retentionPlain": "{count} came back. {percent}% on the first try.",
  "results.personalBest": "your best here: {wpm} wpm",
  "results.newPersonalBest": "that is your best run here.",
  "results.replay": "fly it again",
  "results.boardHeading": "pilots near you",
  "results.boardYou": "you",
  "results.boardEmpty": "no other pilots nearby yet.",
  "results.boardPrompt":
    "want to see the pilots flying near your speed? you can turn this off any time.",
  "results.boardPromptYes": "show nearby pilots",
  "results.boardPromptNo": "not now",
  // ONE VERB FOR MOVING, ACROSS THE WHOLE APP (UR-101). This said "tab to
  // move" while every other screen says arrows - two names for one action on
  // screens a child moves between. Both keys work here and everywhere (the kit
  // routes Arrow, Tab and Shift+Tab to the same move), so the copy names the
  // one the rest of the product names.
  //
  // NO "esc to go back" CLAUSE, and that is not an omission. `ResultsScene`
  // passes `onBack: () => {}` on purpose: the run is scored and banked, and
  // back would mean back into a belt that is already over. The shared
  // `ui.common.hintKeys` promises escape, so this screen cannot use it - a hint
  // that names a key which does nothing is worse than no hint.
  "results.hint": "Arrows to move · enter to choose",

  // Ending card (screen 12)
  "ending.heading": "the map is drawn",
  "ending.shadowLine":
    "Every ship that comes after us will see these. You drew the map.",
  "ending.continue": "see the stage report",
} as const;

/**
 * The English lane table, exported so `tests/unit/ui/hint.test.ts` can resolve a
 * hint and a button label from the SHIPPED copy rather than from a second list
 * it typed out itself (UR-56: the rule is checked against what renders).
 */
export const LANE_COPY_EN: Readonly<Record<string, string>> = LANE_EN;

export type LaneStringKey = keyof typeof LANE_EN;

export const LANE_STRING_KEYS = Object.keys(LANE_EN) as LaneStringKey[];

/**
 * Spanish, sized to content by every screen in this lane rather than to the
 * design brief's +25% constant - the measured growth on short labels is far
 * higher and the lanes were told to size to content (gauntlet/escalations.md).
 *
 * Hindi is content-pipeline output (D45, D67) and resolves through the English
 * table until it lands, which is the same documented fallback
 * `scenes/lib/strings.ts` uses.
 */
const LANE_ES: Partial<Record<LaneStringKey, string>> = {
  "warp.beltClear": "el cinturón está despejado. aquí todo está quieto.",
  "warp.chargeLabel": "motor de salto",
  "warp.chargePercent": "{percent}%",
  "warp.charged": "motor de salto cargado. agárrate.",
  "warp.speaker": "shadow",
  "warp.hint": "escribe la frase. un desliz solo pide la misma letra otra vez.",
  "warp.composed": "shadow escribió esta con tus palabras, ahora mismo",

  "beacon.calibrating": "la baliza se está calibrando. enseguida encuentra el cielo.",
  "beacon.continue": "continuar",
  "beacon.hint": "enter para continuar",

  "results.heading": "informe de la etapa",
  "results.wpmLabel": "palabras por minuto",
  "results.accuracyLabel": "precisión",
  "results.deltaUp": "sube {amount} desde {stop}",
  "results.deltaDown": "baja {amount} desde {stop}",
  "results.deltaSame": "igual que en {stop}",
  "results.fasterHeading": "más rápido que antes",
  "results.fasterMarker": "{word}",
  "results.retentionHeading": "palabras de paradas anteriores",
  "results.retentionQuicker":
    "volvieron {count}. {percent}% a la primera, {ms} ms más rápido que la primera vez.",
  "results.retentionSteady":
    "volvieron {count}. {percent}% a la primera, igual de rápido que la primera vez.",
  "results.retentionPlain": "volvieron {count}. {percent}% a la primera.",
  "results.personalBest": "tu mejor marca aquí: {wpm} ppm",
  "results.newPersonalBest": "es tu mejor vuelo aquí.",
  "results.replay": "volar otra vez",
  "results.boardHeading": "pilotos cerca de ti",
  "results.boardYou": "tú",
  "results.boardEmpty": "todavía no hay otros pilotos cerca.",
  "results.boardPrompt":
    "¿quieres ver a los pilotos que vuelan a tu velocidad? puedes desactivarlo cuando quieras.",
  "results.boardPromptYes": "ver pilotos cercanos",
  "results.boardPromptNo": "ahora no",
  "results.hint": "tab para moverte, enter para elegir",

  "ending.heading": "el mapa está trazado",
  "ending.shadowLine":
    "Todas las naves que vengan después verán estas luces. Tú trazaste el mapa.",
  "ending.continue": "ver el informe",
};

const LANE_TABLES: Readonly<Record<Lang, Partial<Record<LaneStringKey, string>>>> = {
  en: LANE_EN,
  es: LANE_ES,
  hi: {},
};

export type LaneTextKey = LaneStringKey | TextKey;

export interface LaneText {
  readonly lang: Lang;
  /** The shared resolver, for anything this lane does not own. */
  readonly base: SceneText;
  text(key: LaneTextKey, params?: InterpolationParams): string;
  /** The stop's display name. A proper noun from content, not UI copy. */
  stopName(stopId: StopId): string;
}

export interface LaneTextOptions {
  readonly lang: Lang;
  readonly shipName: string;
}

export function createLaneText(options: LaneTextOptions): LaneText {
  const { lang, shipName } = options;
  const base = createSceneText({ lang, shipName });
  const own = LANE_TABLES[lang] ?? {};
  const english = LANE_EN;

  const defaults: InterpolationParams = { shipName };

  return {
    lang,
    base,
    text(key: LaneTextKey, params?: InterpolationParams): string {
      const template =
        own[key as LaneStringKey] ?? english[key as LaneStringKey];
      // Not this lane's key: hand it to the shared resolver, which knows the
      // other lanes' table and then the engine's.
      if (template === undefined) return base.text(key as TextKey, params);
      // "prod": a child mid-game must never lose a screen to a copy bug, which
      // is the same call `scenes/lib/strings.ts` makes and for the same reason.
      return interpolate(template, { ...defaults, ...params }, "prod");
    },
    stopName(stopId: StopId): string {
      return hasStageBundle(stopId)
        ? stageBundle(stopId).planetName
        : paletteFor(stopId).name;
    },
  };
}
