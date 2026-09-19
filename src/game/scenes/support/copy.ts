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

/**
 * ============ "Shadow" IS A NAME (this pass) ============
 *
 * UR-81 made case AUTHORED rather than imposed - `theme.chromeCase` stopped
 * lowercasing every chrome string - and recased this table under one rule:
 * Title Case for labels and buttons, sentence case for hints, questions and
 * whole sentences. It treated "shadow" as a common noun and left it lower case
 * in all four places it appears.
 *
 * It is the coach's name. He is `render/shadow.ts`'s figure, he has a voice
 * (D63), a pose table and a speaker label, and every prose line ABOUT him in
 * this repo already capitalises him. A speaker label that reads "shadow" over a
 * line he just said is the one place a child meets his name, so it is the one
 * place it has to be right.
 *
 * NOTHING RENDERS IT THROUGH `chromeCase`, which was the thing to check before
 * editing a table: the speaker label is drawn with `lib/kit.label`, not with
 * `lib/kit.chrome`, so the table's case is the case on screen. `chromeCase`
 * would still upper-case it under D41's increased-legibility setting, which is
 * a reading aid and is correct for a name as it is for everything else.
 */
const LANE_EN = {
  // Warp break (screen 7, D30, FR-16)
  "warp.beltClear": "The belt is clear. everything is still out here.",
  /**
   * ============ A LABEL, SO TITLE CASE - AN ESCALATION THE OWNER CLOSED ============
   *
   * UR-81's rule already said labels are Title Case, and this is a label, so
   * "Warp Drive" was always the literal reading. The lane that wrote the rule
   * left this one string lower case on purpose and recorded why in
   * `gauntlet/escalations.md` (item 2): the owner's own report about the bolt
   * spelled it lower case, and recasing one label invites recasing the table.
   * Its lean was "leave it - if the owner wants Title Case on labels it should
   * be one sweep with the whole list in front of them."
   *
   * The owner has now asked for it capitalised. That closes the escalation for
   * THIS string only: "continue", "fly it again" and "stage report" are
   * untouched, so the table-wide sweep is still open and still theirs to call.
   *
   * THE CASE IS HERE BECAUSE THIS IS WHERE IT RENDERS FROM. `ui/text.uiText`
   * puts every chrome string through `theme.chromeCase`, which since UR-81
   * returns the string unchanged unless D41's increased-legibility setting is
   * on. So the table's case is the case on screen, and a capitalised literal at
   * the `WarpScene` call site would have put English capitals on Spanish words.
   */
  "warp.chargeLabel": "Warp Drive",
  "warp.chargePercent": "{percent}%",
  "warp.charged": "Warp drive charged. hold on.",
  "warp.speaker": "Shadow",
  /**
   * ============ SENTENCE CASE, WHICH MEANS ONE CAPITAL ============
   *
   * The screen's bottom-left instruction, drawn by `ui/hintLine.drawHint`. It
   * is a hint and a whole sentence, so UR-81's rule gives it a capital first
   * letter and changes nothing else - NOT Title Case, which is for labels and
   * buttons, and not a capital on the second clause either.
   *
   * That last part is the house convention and not a preference: `ui/strings.ts`
   * already ships "Only earth is lit. six more are waiting for us." and
   * "Remove {name}? their beacons go too." Making this line the one that
   * capitalises both of its sentences would be inventing a third rule on the
   * screen the sweep was opened for.
   */
  "warp.hint": "Type the sentence. a slip just asks for the same letter again.",
  // E-AI-1. Shown ONLY when a live model composed this sentence from the words
  // this child just practised and it passed all six gates. Blank otherwise -
  // the whole point is that a judge can tell the two apart.
  "warp.composed": "Shadow wrote this one from your words, just now",

  // Beacon placement (screen 8, D15, FR-17)
  "beacon.calibrating": "Beacon calibrating. it will find the sky in a moment.",
  "beacon.continue": "Continue",
  "beacon.hint": "Enter to continue",

  // Results (screen 9, D50)
  "results.heading": "Stage Report",
  "results.wpmLabel": "Words Per Minute",
  "results.accuracyLabel": "Accuracy",
  "results.deltaUp": "Up {amount} from {stop}",
  "results.deltaDown": "Down {amount} from {stop}",
  "results.deltaSame": "The same as {stop}",
  "results.fasterHeading": "Faster Than Before",
  "results.fasterMarker": "{word}",
  "results.retentionHeading": "Words From Earlier Stops",
  "results.retentionQuicker":
    "{count} came back. {percent}% on the first try, {ms} ms quicker than the first time you met them.",
  "results.retentionSteady":
    "{count} came back. {percent}% on the first try, holding steady since the first time you met them.",
  "results.retentionPlain": "{count} came back. {percent}% on the first try.",
  /**
   * NO EMPTY STATE, BY DECISION. This heading is only ever drawn when at least
   * one trophy was earned on the belt just flown; `ResultsScene.trophiesPiece`
   * returns an empty piece otherwise and the panel closes up around it. A
   * "Trophies Earned: none" line on the screen a child reaches by finishing a
   * stage is a scoreboard of what they did not do, which is the one thing D31
   * says nothing here may be.
   */
  "results.trophiesHeading": "Trophies Earned",
  /** The names themselves come from `ui/catalog.TROPHIES` via `ui/strings`. */
  "results.trophiesList": "{names}",
  "results.personalBest": "Your best here: {wpm} wpm",
  "results.newPersonalBest": "That is your best run here.",
  "results.replay": "Fly It Again",
  "results.boardHeading": "Pilots Near You",
  "results.boardYou": "You",
  "results.boardEmpty": "No other pilots nearby yet.",
  "results.boardPrompt":
    "Want to see the pilots flying near your speed? you can turn this off any time.",
  "results.boardPromptYes": "Show Nearby Pilots",
  "results.boardPromptNo": "Not Now",
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
  "ending.heading": "The Map Is Drawn",
  "ending.shadowLine":
    "Every ship that comes after us will see these. You drew the map.",
  "ending.continue": "See the Stage Report",
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
  "warp.chargeLabel": "Motor de salto",
  "warp.chargePercent": "{percent}%",
  "warp.charged": "Motor de salto cargado. agárrate.",
  // A NAME IS A NAME IN EVERY LANGUAGE. The Hindi lane table is empty and falls
  // through to English, so these two lines are the whole of the Spanish sweep.
  "warp.speaker": "Shadow",
  "warp.hint": "Escribe la frase. un desliz solo pide la misma letra otra vez.",
  "warp.composed": "Shadow escribió esta con tus palabras, ahora mismo",

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
  "results.trophiesHeading": "Trofeos conseguidos",
  "results.trophiesList": "{names}",
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
