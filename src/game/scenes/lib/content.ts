import { type Lang, type StopId, isStopId } from "@engine/types";

/**
 * Stage-bundle loading for the story screens (architecture section 2's
 * `content/  stage bundles (en/es/hi)`, D45, D67).
 *
 * THE SHAPE. One JSON file per stop per language, `src/content/<lang>/<stop>.json`,
 * carrying the five parts story-draft-v1.md gives every chapter - briefing,
 * asteroid pool, pre-flight line, warp sentence, beacon text - plus the two
 * things the Earth launchpad needs instead of a belt (D57): an activation word
 * and no warp sentence.
 *
 * WHY import.meta.glob AND NOT `import bundle from "./mars.json"`.
 * `resolveJsonModule` is off in tsconfig.json and no lane may edit tsconfig,
 * so a direct JSON import does not typecheck. `import.meta.glob` is declared by
 * vite/client (which tsconfig DOES load), returns `unknown`, and is therefore
 * forced through the validator below - which is the better outcome anyway: the
 * JSON is content, content is the thing most likely to be wrong, and a
 * hand-written narrowing function is a schema check that runs in the browser.
 *
 * TWO DELIBERATE DEPARTURES FROM story-draft-v1.md, both upward in the
 * precedence order (CLAUDE.md puts prd.md above the story draft):
 *
 *  1. Briefings are trimmed to FIVE sentences. The story draft runs to six or
 *     seven in places; design-brief-v2.md screen 4 says "3-5 sentences" and the
 *     PRD agrees, so the prose is cut, and every pool word cut with it is gone
 *     from the pool too (the pool is defined as the briefing's content words).
 *  2. The planet's own name IS in the pool. Story note 4 excludes proper nouns
 *     from pools, but AC-12.3 requires every content word of the warp sentence
 *     to exist in the pool, and every warp sentence opens with the planet's
 *     name. Note 4's real target is the moons - Phobos, Deimos, Titan, Triton,
 *     Charon - which stay readable-only in `properNouns`.
 */

export interface StageBundle {
  readonly stopId: StopId;
  readonly lang: Lang;
  /** Display name of the planet, e.g. "Mars". */
  readonly planetName: string;
  /** Chapter subtitle, e.g. "The Red Planet". */
  readonly chapterTitle: string;
  /** 3-5 sentences. May contain `{shipName}` (C07). */
  readonly briefing: readonly string[];
  /** The typeable asteroid words for this stage. Empty at Earth (D57). */
  readonly pool: readonly string[];
  /** Readable in briefing prose, never typed (story note 4). */
  readonly properNouns: readonly string[];
  /** Shadow's narrative startup line (D51). */
  readonly preflightLine: string;
  /** Earth only (AC-12.1): the single word that lights the beacon. */
  readonly activationWord: string | null;
  /** The warp-break sentence (D30). Null at Earth, which has no belt. */
  readonly warpSentence: string | null;
  readonly beaconHeadline: string;
  readonly beaconState: string;
  readonly beaconFlavor: string;
}

export interface SightWords {
  readonly lang: Lang;
  readonly words: readonly string[];
}

// Vite inlines these at build time; the values arrive as parsed JSON.
const BUNDLE_MODULES = import.meta.glob("../../../content/en/*.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function str(record: Record<string, unknown>, key: string): string {
  const v = record[key];
  if (typeof v !== "string") {
    throw new Error(`stage bundle field "${key}" is not a string`);
  }
  return v;
}

function strOrNull(record: Record<string, unknown>, key: string): string | null {
  const v = record[key];
  if (v === null) return null;
  if (typeof v !== "string") {
    throw new Error(`stage bundle field "${key}" is not a string or null`);
  }
  return v;
}

/**
 * Narrow one parsed JSON value to a StageBundle, or throw.
 *
 * Throwing is right here and nowhere else in this lane: a malformed bundle is
 * a build-time content bug that the e2e content test catches before a child
 * ever sees it, and the alternative - a half-populated briefing rendering as
 * blank space - is the failure a child would actually experience.
 */
export function parseStageBundle(value: unknown): StageBundle {
  if (typeof value !== "object" || value === null) {
    throw new Error("stage bundle is not an object");
  }
  const raw = value as Record<string, unknown>;
  const stopId = str(raw, "stopId");
  if (!isStopId(stopId)) throw new Error(`unknown stopId "${stopId}"`);

  const briefing = raw["briefing"];
  if (!isStringArray(briefing)) throw new Error("briefing is not a string array");
  if (briefing.length < 3 || briefing.length > 5) {
    throw new Error(
      `briefing for ${stopId} has ${briefing.length} sentences; the design brief allows 3-5`,
    );
  }
  const pool = raw["pool"];
  if (!isStringArray(pool)) throw new Error("pool is not a string array");
  const properNouns = raw["properNouns"];
  if (!isStringArray(properNouns)) {
    throw new Error("properNouns is not a string array");
  }

  return {
    stopId,
    lang: "en",
    planetName: str(raw, "planetName"),
    chapterTitle: str(raw, "chapterTitle"),
    briefing,
    pool,
    properNouns,
    preflightLine: str(raw, "preflightLine"),
    activationWord: strOrNull(raw, "activationWord"),
    warpSentence: strOrNull(raw, "warpSentence"),
    beaconHeadline: str(raw, "beaconHeadline"),
    beaconState: str(raw, "beaconState"),
    beaconFlavor: str(raw, "beaconFlavor"),
  };
}

/**
 * A stage bundle is identified by carrying a `stopId`, not by its filename.
 *
 * `content/en/` also holds `sight-words.json` and `ui.json`, and the folder
 * will grow; matching on names would mean every new content file silently
 * becomes a bundle the validator then rejects, taking every story scene down
 * with it. The tell is the field, so the tell is what is checked - and a file
 * that DOES claim a stopId is still validated in full and still throws.
 */
function isBundleShaped(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)["stopId"] === "string"
  );
}

const BUNDLES: Partial<Record<StopId, StageBundle>> = (() => {
  const out: Partial<Record<StopId, StageBundle>> = {};
  for (const value of Object.values(BUNDLE_MODULES)) {
    if (!isBundleShaped(value)) continue;
    const bundle = parseStageBundle(value);
    out[bundle.stopId] = bundle;
  }
  return out;
})();

export function stageBundle(stopId: StopId): StageBundle {
  const bundle = BUNDLES[stopId];
  if (bundle === undefined) {
    throw new Error(`no stage bundle shipped for stop "${stopId}"`);
  }
  return bundle;
}

export function hasStageBundle(stopId: StopId): boolean {
  return BUNDLES[stopId] !== undefined;
}

/**
 * Words the pre-flight ritual may use (FR-11: "high-frequency words").
 *
 * Drawn from the stop's own pool so the child warms up on the vocabulary they
 * are about to fly through, which is also what makes the ritual read as the
 * ship checking itself rather than as a warm-up exercise (AC-11.3).
 * `planRitual` needs short words and at least one 7+ letter word; when a pool
 * cannot supply both it returns null and the caller keeps DEFAULT_CALIBRATION.
 */
export function ritualPool(stopId: StopId): readonly string[] {
  const bundle = BUNDLES[stopId];
  if (bundle === undefined || bundle.pool.length === 0) return [];
  return bundle.pool;
}
