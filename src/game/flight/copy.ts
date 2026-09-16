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
  | "hud.wpm"
  | "hud.combo"
  | "hud.score"
  | "stall.title"
  | "stall.line"
  | "stall.restart";

type LocalTable = Readonly<Partial<Record<FlightStringKey, string>>>;

const LOCAL_EN: LocalTable = {
  "hud.wpm": "wpm", // i18n-ignore: string table
  "hud.combo": "combo", // i18n-ignore: string table
  "hud.score": "score", // i18n-ignore: string table
  "stall.title": "The engines went quiet.", // i18n-ignore: string table
  "stall.line": "We drifted a little, pilot. Every word you flew is still aboard — let's take this belt again.", // i18n-ignore: string table
  "stall.restart": "Fly this stage again", // i18n-ignore: string table
};

const LOCAL_ES: LocalTable = {
  "hud.wpm": "ppm", // i18n-ignore: string table
  "hud.combo": "racha", // i18n-ignore: string table
  "hud.score": "puntos", // i18n-ignore: string table
  "stall.title": "Los motores se quedaron en silencio.", // i18n-ignore: string table
  "stall.line": "Nos desviamos un poco, piloto. Todas tus palabras siguen a bordo: volvamos a cruzar este cinturón.", // i18n-ignore: string table
  "stall.restart": "Volar esta etapa otra vez", // i18n-ignore: string table
};

const LOCAL_HI: LocalTable = {
  "hud.wpm": "श/मि", // i18n-ignore: string table
  "hud.combo": "लगातार", // i18n-ignore: string table
  "hud.score": "अंक", // i18n-ignore: string table
  "stall.title": "इंजन शांत हो गए।", // i18n-ignore: string table
  "stall.line": "हम थोड़ा बहक गए, पायलट। तुम्हारे सारे शब्द अब भी हमारे पास हैं — चलो यह पट्टी फिर से पार करें।", // i18n-ignore: string table
  "stall.restart": "यह चरण फिर से उड़ाओ", // i18n-ignore: string table
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
