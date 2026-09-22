import type { Lang } from "@engine/types.js";
import {
  type InterpolationParams,
  type StringKey,
  createTranslator,
  interpolate,
} from "@engine/i18n/index.js";

/**
 * Copy the core loop needs that the shipped string table does not carry yet.
 *
 * AC-14.3 says every UI string comes from i18n and no scene contains hard-coded
 * English. `@engine/i18n` owns the table, and this lane may not edit src/engine,
 * but the HUD and the stall card (D29, screen 6b) need six keys the table has
 * not got. So this file is a TABLE, not a scene: same flat key -> string shape,
 * all three languages, and every literal carries the i18n-ignore marker because
 * a string table is the one place literals are supposed to live.
 *
 * When the missing keys land in `@engine/i18n/strings.ts`, delete the table
 * below and the `t` wrapper falls through to the engine translator unchanged.
 * Flagged to the lead as an engine gap rather than patched across the seam.
 */

export type FlightStringKey =
  /**
   * UR-146. Spoken, so D98 applies: `SPOKEN_FLIGHT_KEYS` renders it. Eight
   * words, and the first four are the whole instruction - `shouldHintCanister`
   * spends the lead clause out of the canister's own fall, so a longer line is
   * a line that qualifies less often.
   */
  | "flight.canisterHint"
  /**
   * UR-148. Said once per run, the first time a child meets a two-layer rock.
   * Spoken, so D98 applies. Longer than the canister hint because it teaches a
   * mechanic rather than pointing at a colour; only the first sentence is
   * gated on the rock's fall.
   */
  | "flight.nestedHint"
  | "hud.wpm"
  | "hud.combo"
  | "hud.score"
  | "stall.title"
  | "stall.line"
  | "stall.restart"
  | "stall.quit";

/** Clip ids == table keys, so a scene cannot spell one differently (D98). */
export const CANISTER_HINT_KEY = "flight.canisterHint";
export const NESTED_HINT_KEY = "flight.nestedHint";

/**
 * The clause that NAMES the rock - the first sentence of a hint. The rest is
 * the reason, and a child who has heard "blast the gold ring" has what they
 * need whether or not the rock survives the second half. `shouldHintCanister`
 * says why the whole line cannot be waited on.
 */
export function hintLead(text: string): string {
  const stop = text.search(/[.!?]/);
  return (stop < 0 ? text : text.slice(0, stop + 1)).trim();
}

type LocalTable = Readonly<Partial<Record<FlightStringKey, string>>>;

const LOCAL_EN: LocalTable = {
  "flight.canisterHint": "Blast the gold ring! It fixes our shield.", // i18n-ignore: string table
  "flight.nestedHint": "That rock has two layers! Blast it, then type the word inside.", // i18n-ignore: string table
  "hud.wpm": "wpm", // i18n-ignore: string table
  "hud.combo": "combo", // i18n-ignore: string table
  "hud.score": "score", // i18n-ignore: string table
  "stall.title": "The engines went quiet.", // i18n-ignore: string table
  "stall.line": "We drifted a little, pilot. Every word you flew is still aboard. Let's try again. Ready when you are.", // i18n-ignore: string table
  "stall.restart": "Fly this stage again", // i18n-ignore: string table
  "stall.quit": "Quit to Map", // i18n-ignore: string table
};

const LOCAL_ES: LocalTable = {
  "flight.canisterHint": "¡Dispara al anillo dorado! Repara nuestro escudo.", // i18n-ignore: string table
  "flight.nestedHint": "¡Esa roca tiene dos capas! Dispárala y escribe la palabra de dentro.", // i18n-ignore: string table
  "hud.wpm": "ppm", // i18n-ignore: string table
  "hud.combo": "racha", // i18n-ignore: string table
  "hud.score": "puntos", // i18n-ignore: string table
  "stall.title": "Los motores se quedaron en silencio.", // i18n-ignore: string table
  "stall.line": "Nos desviamos un poco, piloto. Todas tus palabras siguen a bordo. Probemos otra vez. Cuando quieras.", // i18n-ignore: string table
  "stall.restart": "Volar esta etapa otra vez", // i18n-ignore: string table
  "stall.quit": "Salir al mapa", // i18n-ignore: string table
};

const LOCAL_HI: LocalTable = {
  "flight.canisterHint": "सुनहरे छल्ले को उड़ाओ! वह ढाल ठीक करता है।", // i18n-ignore: string table
  "flight.nestedHint": "उस चट्टान की दो परतें हैं! उसे उड़ाओ, फिर अंदर वाला शब्द लिखो।", // i18n-ignore: string table
  "hud.wpm": "श/मि", // i18n-ignore: string table
  "hud.combo": "लगातार", // i18n-ignore: string table
  "hud.score": "अंक", // i18n-ignore: string table
  "stall.title": "इंजन शांत हो गए।", // i18n-ignore: string table
  "stall.line": "हम थोड़ा बहक गए, पायलट। तुम्हारे सारे शब्द अब भी हमारे पास हैं। चलो फिर से कोशिश करें। जब तुम तैयार हो।", // i18n-ignore: string table
  "stall.restart": "यह चरण फिर से उड़ाओ", // i18n-ignore: string table
  "stall.quit": "नक्शे पर लौटो", // i18n-ignore: string table
};

const LOCAL: Readonly<Record<Lang, LocalTable>> = {
  en: LOCAL_EN,
  es: LOCAL_ES,
  hi: LOCAL_HI,
};

export interface FlightCopy {
  readonly lang: Lang;
  /** Engine keys and local keys, resolved in that order. */
  t(key: StringKey | FlightStringKey, params?: InterpolationParams): string;
}

/**
 * `defaults` is where `{shipName}` is bound once per profile (C07): no scene
 * ever passes it at a call site, so no scene can forget it.
 */
export function createFlightCopy(
  lang: Lang,
  defaults: InterpolationParams,
): FlightCopy {
  const engine = createTranslator({ lang, mode: "prod", defaults });
  const own = LOCAL[lang];
  const fallback = LOCAL.en;

  return {
    lang,
    t(key, params) {
      const local =
        own[key as FlightStringKey] ?? fallback[key as FlightStringKey];
      if (local !== undefined) {
        return interpolate(local, { ...defaults, ...params }, "prod");
      }
      return engine.t(key as StringKey, params);
    },
  };
}
