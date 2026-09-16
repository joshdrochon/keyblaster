import type { Lang } from "../types.js";
import {
  FALLBACK_LANG,
  type StringKey,
  type StringTable,
  TABLES,
} from "./strings.js";

/**
 * Lookup + interpolation (PRD FR-14, D45).
 *
 * MISSING-KEY POLICY - decided here, tested in tests/unit/i18n/translate.test.ts:
 *
 *   dev  -> THROW MissingStringError immediately, even when English has the key.
 *           A missing translation is a content bug and dev is where it must
 *           surface. Falling back to English in dev would hide it forever: the
 *           screen would read fine in the developer's locale and ship broken.
 *   prod -> NEVER throw. Resolve in order: selected language, then English,
 *           then the key itself. A child mid-flight must not lose the game to a
 *           string bug. The key is a legible last resort ("settings.uiLang" is
 *           ugly but not a crash and not a blank).
 *
 * This mirrors the allowlist's `assertAllowed` dev/prod split (AC-13.1) on
 * purpose - one escalation rule across the engine, not two.
 *
 * `onMissing` downgrades the dev throw to a report + the prod fallback chain.
 * That is the escape hatch for a translator preview build; it is opt-in, so the
 * default stays loud.
 *
 * Placeholders use `{name}` (C07's `{shipName}` is the one that matters). A
 * missing param throws in dev and leaves the placeholder text intact in prod,
 * because "The {shipName} is ready." is readable and "The undefined is ready."
 * is not. Substitution is single-pass: a value containing `{x}` is never
 * re-scanned, so a player-chosen ship name cannot inject another placeholder.
 */

export type InterpolationParams = Readonly<Record<string, string | number>>;

export type Mode = "dev" | "prod";

export class MissingStringError extends Error {
  readonly key: string;
  readonly lang: Lang;
  constructor(key: string, lang: Lang) {
    super(`Missing i18n string "${key}" for language "${lang}"`);
    this.name = "MissingStringError";
    this.key = key;
    this.lang = lang;
  }
}

export class MissingParamError extends Error {
  readonly param: string;
  readonly template: string;
  constructor(param: string, template: string) {
    super(`Missing i18n parameter "${param}" for template "${template}"`);
    this.name = "MissingParamError";
    this.param = param;
    this.template = template;
  }
}

/** `{name}` only: no nesting, no formatting directives, no expressions. */
const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

/**
 * Substitute `{name}` placeholders. Exported because the content pipeline
 * interpolates story prose with the same `{shipName}` rule (C07) without
 * going through a string table.
 */
export function interpolate(
  template: string,
  params: InterpolationParams = {},
  mode: Mode = "prod",
): string {
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    const value = params[name];
    if (value === undefined) {
      if (mode === "dev") throw new MissingParamError(name, template);
      return whole;
    }
    return String(value);
  });
}

/** Placeholder names a template expects, in order of first appearance. */
export function placeholdersIn(template: string): string[] {
  const seen: string[] = [];
  for (const m of template.matchAll(PLACEHOLDER)) {
    const name = m[1];
    if (name !== undefined && !seen.includes(name)) seen.push(name);
  }
  return seen;
}

export interface TranslatorOptions {
  readonly lang: Lang;
  readonly mode: Mode;
  /** Defaults to the shipped tables; injected in tests and by the content pipeline. */
  readonly tables?: Readonly<Record<Lang, StringTable>>;
  /** Called for every unresolved key. Its presence suppresses the dev throw. */
  readonly onMissing?: (key: string, lang: Lang) => void;
}

export interface Translator {
  readonly lang: Lang;
  readonly mode: Mode;
  /** Resolve and interpolate. See the missing-key policy above. */
  t(key: StringKey, params?: InterpolationParams): string;
  /** True if the key resolves in this language without falling back. */
  has(key: StringKey): boolean;
  /** The raw template, before interpolation. Null if unresolved anywhere. */
  raw(key: StringKey): string | null;
}

export function createTranslator(options: TranslatorOptions): Translator {
  const { lang, mode, tables = TABLES, onMissing } = options;

  const own: StringTable = tables[lang] ?? {};
  const fallback: StringTable = tables[FALLBACK_LANG] ?? {};

  const raw = (key: StringKey): string | null =>
    own[key] ?? fallback[key] ?? null;

  return {
    lang,
    mode,
    has: (key: StringKey) => own[key] !== undefined,

    raw,

    t(key: StringKey, params?: InterpolationParams): string {
      const mine = own[key];
      if (mine !== undefined) return interpolate(mine, params, mode);

      onMissing?.(key, lang);
      // Loud in dev unless a sink explicitly took responsibility for it.
      if (mode === "dev" && onMissing === undefined) {
        throw new MissingStringError(key, lang);
      }
      const english = fallback[key];
      if (english !== undefined) return interpolate(english, params, mode);
      return key;
    },
  };
}
