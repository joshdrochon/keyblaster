import {
  type InterpolationParams,
  type StringKey,
  type StringTable,
  TABLES as ENGINE_TABLES,
  createTranslator,
  overflowingLangs,
  projectedLength,
  widestLength,
} from "@engine/i18n";
import type { Lang } from "@engine/types";
import { UI_TABLES, type UiStringKey } from "./strings.js";

/**
 * The scene-facing translator (D45, AC-14.3, C07).
 *
 * All lookup, fallback and `{shipName}` interpolation happen inside
 * `@engine/i18n`'s `createTranslator`. This module does two things on top:
 *
 *  1. MERGES the engine's string table with this lane's menu table
 *     (strings.ts), so a scene calls one `t()` and never has to know which
 *     table a key came from.
 *  2. BINDS `{shipName}` once per profile via the translator's `defaults`
 *     (C07), so no call site ever passes it and no scene can forget to.
 *
 * NOTE ON THE SIGNATURE. The lane brief described `createTranslator(tables,
 * { defaults })`. The version on disk takes a single options object,
 * `createTranslator({ lang, mode, tables, defaults })`, which is what this
 * file calls. If the engine's signature changes, this is the only place in the
 * five scenes that has to move.
 */

export type MenuKey = StringKey | UiStringKey;

/** Everything a menu can say, in one table per language. */
const MERGED: Readonly<Record<Lang, StringTable>> = ((): Readonly<
  Record<Lang, StringTable>
> => {
  const out: Record<string, Record<string, string>> = {};
  for (const lang of ["en", "es", "hi"] as Lang[]) {
    out[lang] = { ...ENGINE_TABLES[lang], ...UI_TABLES[lang] };
  }
  // The cast is the seam: StringTable is keyed by the engine's StringKey union,
  // and this table is deliberately wider. Every read goes back through
  // `MenuKey`, so the widening is contained to these two lines.
  return out as unknown as Readonly<Record<Lang, StringTable>>;
})();

export interface MenuTranslator {
  readonly lang: Lang;
  t(key: MenuKey, params?: InterpolationParams): string;
  raw(key: MenuKey): string | null;
}

/**
 * `mode: "prod"` on purpose. The dev mode of the engine translator THROWS on a
 * missing key, which is right for a content bug caught in CI and wrong for a
 * child three belts into a run: a menu that crashes because one Hindi label is
 * missing has failed harder than one that shows the English. The missing-key
 * gap is caught by the i18n unit suite, not by a crash on a kid's screen.
 */
export function createMenuTranslator(
  lang: Lang,
  shipName: string,
): MenuTranslator {
  const inner = createTranslator({
    lang,
    mode: "prod",
    tables: MERGED,
    defaults: { shipName },
  });
  return {
    lang,
    t: (key, params) => inner.t(key as StringKey, params),
    raw: (key) => inner.raw(key as StringKey),
  };
}

/**
 * Minimum width a container must reserve for a key, in CHARACTERS, across all
 * three languages.
 *
 * WHY NOT "+25% for Spanish". The design brief's flat +25% is wrong for short
 * labels, and short labels are all a settings screen has. Measured against the
 * real translations: `Locked` -> `Bloqueado` is +50%, `Pilot name` -> `Nombre
 * del piloto` is +70%, `Beacon Log` -> `Registro de balizas` is +90%. Spanish
 * pays a fixed cost in articles and prepositions that a two-word English label
 * has nothing to amortise it against, so the shorter the label the worse the
 * flat factor is. Every control in this kit therefore sizes TO CONTENT with a
 * minimum, and this function is what "to content" means before the text is
 * measured in pixels.
 */
export function widestChars(key: MenuKey): number {
  return widestLength(key as StringKey, MERGED);
}

/** Languages whose translation of `key` blows a `maxChars` budget. */
export function overflowing(key: MenuKey, maxChars: number): Lang[] {
  return overflowingLangs(key as StringKey, maxChars, MERGED);
}

/** Re-exported so scenes can budget a label before its translation exists. */
export { projectedLength };
