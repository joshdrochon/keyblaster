import { SCHEMA_VERSION, isPlainObject } from "./schema.js";
import { SAMPLE_CAP } from "../words/index.js";

/**
 * Forward migrations (architecture section 7).
 *
 * SHAPE OF THE CHAIN. A migration takes the RAW decoded payload at version N
 * and returns the raw payload at version N+1. It runs before any coercion, so
 * it may assume nothing: every field it reads is `unknown` and every access is
 * guarded. It must never throw - a migration that throws on a half-corrupt
 * payload is just another way to crash on load, which AC-18.4 forbids.
 *
 * ADDING v3. Write `function v2ToV3(p) {...}`, add `3: v2ToV3` to MIGRATIONS,
 * bump SCHEMA_VERSION to 3. Nothing else changes: old payloads walk the chain
 * 1 -> 2 -> 3, and a v1 payload written by the first build still loads.
 *
 * WHY FORWARD-ONLY. There is no down migration and there never will be. A newer
 * build's payload is handled by the future-version policy in load.ts (quarantine
 * and start fresh), not by trying to guess which fields to drop.
 */
export type Migration = (payload: Record<string, unknown>) => Record<string, unknown>;

/** Keyed by the version the migration UPGRADES FROM. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  1: v1ToV2,
};

/** The oldest payload version this build can still read. */
export const OLDEST_SUPPORTED_VERSION = 1;

export interface MigrationResult {
  payload: Record<string, unknown>;
  /** Versions whose migration ran, in order. Empty when already current. */
  applied: number[];
  /** True when the chain reached SCHEMA_VERSION. */
  ok: boolean;
}

/**
 * Walk the chain from `fromVersion` up to SCHEMA_VERSION.
 *
 * A missing link (a version we have no migration for) is a hard stop rather
 * than a best-effort guess: the caller turns it into a fresh profile plus a
 * notice, which is the documented corrupt path.
 */
export function migrateToCurrent(
  payload: Record<string, unknown>,
  fromVersion: number,
): MigrationResult {
  let current = payload;
  const applied: number[] = [];
  if (!Number.isInteger(fromVersion) || fromVersion < OLDEST_SUPPORTED_VERSION) {
    return { payload: current, applied, ok: false };
  }
  for (let v = fromVersion; v < SCHEMA_VERSION; v += 1) {
    const migration = MIGRATIONS[v];
    if (migration === undefined) return { payload: current, applied, ok: false };
    current = migration(current);
    applied.push(v);
  }
  return { payload: current, applied, ok: true };
}

// ---------------------------------------------------------------------------
// v1 -> v2
// ---------------------------------------------------------------------------

/**
 * v2 added two things the results screen needs and v1 never recorded:
 *
 * 1. WordRecord.firstFkLatencyMs - first-key latency at the word's FIRST ever
 *    exposure (AC-20.3). We fill it from fkLatencyMs[0] ONLY when the rolling
 *    window provably still holds the first exposure, i.e. the word has been
 *    seen no more times than the window is long. Past that, types.ts is
 *    explicit that fkLatencyMs[0] is NOT the first exposure, and a retention
 *    delta computed against a fabricated baseline is worse than no delta at
 *    all - so it stays null and the results screen omits the line.
 *
 * 2. StopProgress.lastWpm / lastAccuracy - the MOST RECENT run's figures
 *    (AC-20.1). A v1 payload only recorded bests, so the best is the only
 *    figure that exists; seeding last from best makes the first post-migration
 *    delta 0-or-positive rather than inventing a regression.
 */
function v1ToV2(payload: Record<string, unknown>): Record<string, unknown> {
  const profiles = Array.isArray(payload["profiles"]) ? payload["profiles"] : [];
  return {
    ...payload,
    version: 2,
    profiles: profiles.map(upgradeProfileV1ToV2),
  };
}

function upgradeProfileV1ToV2(raw: unknown): unknown {
  if (!isPlainObject(raw)) return raw;
  return {
    ...raw,
    progress: upgradeProgressV1ToV2(raw["progress"]),
    words: upgradeWordsV1ToV2(raw["words"]),
  };
}

function upgradeProgressV1ToV2(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  return raw.map((entry) => {
    if (!isPlainObject(entry)) return entry;
    const bestWpm = entry["bestWpm"];
    const bestAccuracy = entry["bestAccuracy"];
    return {
      ...entry,
      lastWpm: entry["lastWpm"] ?? (typeof bestWpm === "number" ? bestWpm : 0),
      lastAccuracy: entry["lastAccuracy"] ?? (typeof bestAccuracy === "number" ? bestAccuracy : 0),
    };
  });
}

function upgradeWordsV1ToV2(raw: unknown): unknown {
  if (!isPlainObject(raw)) return raw;
  const out: Record<string, unknown> = {};
  for (const [lang, book] of Object.entries(raw)) {
    if (!isPlainObject(book)) {
      out[lang] = book;
      continue;
    }
    const upgraded: Record<string, unknown> = {};
    for (const [word, record] of Object.entries(book)) {
      upgraded[word] = upgradeWordRecordV1ToV2(record);
    }
    out[lang] = upgraded;
  }
  return out;
}

function upgradeWordRecordV1ToV2(raw: unknown): unknown {
  if (!isPlainObject(raw)) return raw;
  if (raw["firstFkLatencyMs"] !== undefined) return raw;
  return { ...raw, firstFkLatencyMs: inferFirstFkLatency(raw) };
}

/** See the v1ToV2 comment: only trust the window while it cannot have evicted. */
export function inferFirstFkLatency(record: Record<string, unknown>): number | null {
  const samples = record["fkLatencyMs"];
  if (!Array.isArray(samples)) return null;
  const first = samples[0];
  if (typeof first !== "number" || !Number.isFinite(first)) return null;
  const exposures = record["exposures"];
  const seen = typeof exposures === "number" && Number.isFinite(exposures) ? exposures : samples.length;
  if (seen > SAMPLE_CAP) return null;
  return first;
}
