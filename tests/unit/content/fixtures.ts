import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Lang, StopId } from "@engine/types";

/**
 * Loading and shared shapes for the content tests (D45, D67).
 *
 * WHY node:fs AND NOT AN IMPORT. `resolveJsonModule` is off in tsconfig.json
 * and no lane may edit it (lane brief), so `import bundle from "./mars.json"`
 * does not typecheck. `src/game/scenes/lib/content.ts` solves the same problem
 * with `import.meta.glob`, which needs Vite's client types and a browser-ish
 * module graph; a unit test runs in Node, so it reads the bytes off disk. That
 * is also the stronger check: it asserts against what SHIPS, not against what
 * a bundler produced.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
export const CONTENT_ROOT = resolve(HERE, "../../../src/content");

/** The three shipped content languages (D45). */
export const CONTENT_LANGS: readonly Lang[] = ["en", "es", "hi"] as const;

/** Files in a language folder that are not stage bundles. */
const NON_BUNDLE = new Set(["sight-words.json", "ui.json"]);

/**
 * Mirrors `StageBundle` in src/game/scenes/lib/content.ts, but every field is
 * `unknown`-free and read straight from disk. Kept structurally identical on
 * purpose: if the two ever drift, the schema test below is what notices.
 */
export interface Bundle {
  readonly stopId: StopId;
  readonly lang: Lang;
  readonly planetName: string;
  readonly chapterTitle: string;
  readonly briefing: readonly string[];
  readonly pool: readonly string[];
  readonly properNouns: readonly string[];
  readonly preflightLine: string;
  readonly activationWord: string | null;
  readonly warpSentence: string | null;
  readonly beaconHeadline: string;
  readonly beaconState: string;
  readonly beaconFlavor: string;
}

export interface SightWords {
  readonly lang: Lang;
  readonly note: string;
  readonly words: readonly string[];
}

const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(path, "utf8")) as unknown;

export function bundlesFor(lang: Lang): Bundle[] {
  const dir = resolve(CONTENT_ROOT, lang);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !NON_BUNDLE.has(f))
    .sort()
    .map((f) => readJson(resolve(dir, f)) as Bundle);
}

export function sightWordsFor(lang: Lang): readonly string[] {
  const file = resolve(CONTENT_ROOT, lang, "sight-words.json");
  return (readJson(file) as SightWords).words;
}

export function rawSightWords(lang: Lang): SightWords {
  return readJson(resolve(CONTENT_ROOT, lang, "sight-words.json")) as SightWords;
}

/** Every stop, in route order (D57 puts Earth first and gives it no belt). */
export const EXPECTED_STOPS: readonly StopId[] = [
  "earth",
  "jupiter",
  "mars",
  "neptune",
  "pluto",
  "saturn",
  "uranus",
] as const; // alphabetical: bundlesFor() sorts by filename

/**
 * Everything a child READS at a stop.
 *
 * Wider than tests/e2e/briefing.spec.ts, which checks briefing + warp sentence
 * + beacon flavour. The pre-flight line is included here because
 * `content/<lang>/sight-words.json` says in its own note that it covers the
 * pre-flight line too, and an unchecked claim in a content file is how the
 * next translator ships an unlisted word.
 *
 * `{shipName}` is stripped, not substituted: a player can name their ship
 * anything, so it is never allowlist-checked (C07).
 */
export function readableProse(b: Bundle): string {
  return [
    ...b.briefing.map((s) => s.replace(/\{shipName\}/g, "")),
    b.preflightLine,
    b.warpSentence ?? "",
    b.beaconFlavor,
  ].join(" ");
}

/** Copy the player TYPES. Earth types its activation word instead (AC-12.1). */
export function typedCopy(b: Bundle): string {
  return b.warpSentence ?? b.activationWord ?? "";
}
