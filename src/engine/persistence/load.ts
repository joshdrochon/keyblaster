import type { Profile } from "../types.js";
import type { StoragePort } from "./port.js";
import { OLDEST_SUPPORTED_VERSION, migrateToCurrent } from "./migrations.js";
import {
  QUARANTINE_KEY,
  SCHEMA_VERSION,
  STORAGE_KEY,
  type PersistedState,
  type RepairLog,
  decodeProfile,
  isPlainObject,
  newRepairLog,
  repaired,
} from "./schema.js";

/**
 * Why a load is not a clean load. Codes, not sentences: the game layer maps
 * these to i18n strings (architecture section 8 forbids user-facing literals in
 * src/game, and the engine is not where UI copy lives either).
 */
export type NoticeCode =
  /** Nothing stored yet. Not damage: first run. */
  | "empty"
  /** getItem itself threw - storage disabled, or a hostile extension. */
  | "unreadable"
  /** The stored string is not JSON. */
  | "invalid-json"
  /** Valid JSON, wrong shape (array, string, number, null, missing profiles). */
  | "wrong-shape"
  /** Written by a build newer than this one. */
  | "future-version"
  /** A version we have no migration path from. */
  | "unmigratable"
  /** Loaded, but fields had to be replaced on the way in. */
  | "repaired"
  /** Loaded, and the payload was upgraded from an older schema version. */
  | "migrated"
  /** The unreadable payload was parked under QUARANTINE_KEY. */
  | "quarantined"
  /** setItem threw: the session continues, unsaved. */
  | "write-failed";

/**
 * AC-18.4: "corrupted storage -> fresh profile, never a crash", and the notice
 * is non-blocking. `blocking` is a literal `false` so that a future edit that
 * tries to make a persistence failure modal has to change the type first.
 */
export interface Notice {
  readonly code: NoticeCode;
  /** Developer-facing detail. Never rendered raw to a child. */
  readonly detail: string;
  readonly blocking: false;
}

export function notice(code: NoticeCode, detail: string): Notice {
  return { code, detail, blocking: false };
}

export interface LoadResult {
  /** Always usable. Never null, never partially decoded. */
  readonly state: PersistedState;
  readonly notices: readonly Notice[];
  /** True when nothing was recovered and the profile handed back is brand new. */
  readonly fresh: boolean;
  /** The version found in storage, or null when there was nothing to read. */
  readonly loadedVersion: number | null;
  readonly migrated: boolean;
  /**
   * True when the decoded state differs from the bytes in storage (repaired,
   * migrated, or fresh). The store schedules a write so the repair sticks.
   */
  readonly dirty: boolean;
}

export interface LoadOptions {
  /**
   * Builds the profile handed back when there is nothing to load. Injected
   * because a new profile needs an id and a createdAt, and this module owns
   * neither a clock nor a random source.
   */
  freshProfile: () => Profile;
}

/** getItem may throw; treat that exactly like unreadable data. */
function readRaw(storage: StoragePort): { raw: string | null; threw: boolean } {
  try {
    return { raw: storage.getItem(STORAGE_KEY), threw: false };
  } catch {
    return { raw: null, threw: true };
  }
}

/**
 * Park bytes we refuse to parse under QUARANTINE_KEY, best-effort.
 *
 * Deliberately swallows every failure: quarantine is a courtesy to a future
 * recovery path, and a full quota must never turn into an exception on the load
 * path (AC-18.4). Returns whether it stuck, so the caller can say so.
 */
function quarantine(storage: StoragePort, raw: string): boolean {
  try {
    storage.setItem(QUARANTINE_KEY, raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * The state handed back whenever nothing usable could be read: exactly one
 * fresh profile, selected.
 *
 * WHY A PROFILE AND NOT AN EMPTY LIST. AC-18.4 says corruption yields a fresh
 * profile. A child whose save is damaged should land in a playable game with a
 * small notice, not on an empty picker that silently implies their pilot never
 * existed. `fresh: true` is how the game knows to route them to the profile
 * screen to name themselves rather than straight to the map.
 */
function freshState(freshProfile: () => Profile): PersistedState {
  const profile = freshProfile();
  return { version: SCHEMA_VERSION, profiles: [profile], activeProfileId: profile.id };
}

function freshResult(
  freshProfile: () => Profile,
  loadedVersion: number | null,
  notices: Notice[],
): LoadResult {
  return {
    state: freshState(freshProfile),
    notices,
    fresh: true,
    loadedVersion,
    migrated: false,
    dirty: true,
  };
}

/**
 * Read, migrate and repair the stored payload. TOTAL: for every possible input
 * string - including every string a fuzzer can produce - this returns a usable
 * state and a list of non-blocking notices. It has no throwing path.
 */
export function loadState(storage: StoragePort, options: LoadOptions): LoadResult {
  const { freshProfile } = options;
  const notices: Notice[] = [];

  const { raw, threw } = readRaw(storage);
  if (threw) {
    notices.push(notice("unreadable", `${STORAGE_KEY}: getItem threw`));
    return freshResult(freshProfile, null, notices);
  }
  if (raw === null || raw.trim().length === 0) {
    notices.push(
      raw === null
        ? notice("empty", `${STORAGE_KEY}: no stored payload`)
        : notice("wrong-shape", `${STORAGE_KEY}: stored payload is blank`),
    );
    return freshResult(freshProfile, null, notices);
  }

  const reject = (code: NoticeCode, detail: string, version: number | null): LoadResult => {
    notices.push(notice(code, detail));
    const parked = quarantine(storage, raw);
    if (parked) notices.push(notice("quarantined", `original payload moved to ${QUARANTINE_KEY}`));
    return freshResult(freshProfile, version, notices);
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return reject("invalid-json", why, null);
  }

  if (!isPlainObject(parsed)) {
    return reject("wrong-shape", `expected an object, got ${describe(parsed)}`, null);
  }

  const log = newRepairLog();
  const rawVersion = parsed["version"];
  let version: number;
  if (typeof rawVersion === "number" && Number.isInteger(rawVersion) && rawVersion >= OLDEST_SUPPORTED_VERSION) {
    version = rawVersion;
  } else {
    // A payload with no version is either the very first build or damage. Both
    // walk the chain from v1; damage is caught by the shape check below.
    version = OLDEST_SUPPORTED_VERSION;
    repaired(log, "version");
  }

  if (version > SCHEMA_VERSION) {
    return reject(
      "future-version",
      `payload is v${version}, this build reads v${SCHEMA_VERSION}`,
      version,
    );
  }

  if (!Array.isArray(parsed["profiles"])) {
    return reject("wrong-shape", `profiles is ${describe(parsed["profiles"])}, expected an array`, version);
  }

  const migration = migrateToCurrent(parsed, version);
  if (!migration.ok) {
    return reject("unmigratable", `no migration path from v${version}`, version);
  }

  const migratedProfiles = migration.payload["profiles"];
  const rawProfiles = Array.isArray(migratedProfiles) ? migratedProfiles : [];
  const decoded: Profile[] = [];
  const seen = new Set<string>();
  for (const [i, entry] of rawProfiles.entries()) {
    const profile = decodeProfile(entry, log, `profiles[${i}]`);
    if (profile === null) continue;
    if (seen.has(profile.id)) {
      repaired(log, `profiles[${i}].id`);
      continue;
    }
    seen.add(profile.id);
    decoded.push(profile);
  }

  // An empty profiles array is a legitimate saved state (the player deleted
  // their last profile). An array that had entries and decoded to nothing is
  // damage, and takes the corrupt path.
  if (decoded.length === 0 && rawProfiles.length > 0) {
    return reject("wrong-shape", `${rawProfiles.length} stored profiles, none decodable`, version);
  }

  const activeProfileId = resolveActive(migration.payload["activeProfileId"], decoded, log);

  if (migration.applied.length > 0) {
    notices.push(notice("migrated", `v${version} -> v${SCHEMA_VERSION}`));
  }
  if (log.count > 0) {
    notices.push(
      notice("repaired", `${log.count} field(s) repaired${log.paths.length > 0 ? `: ${log.paths.join(", ")}` : ""}`),
    );
  }

  return {
    state: { version: SCHEMA_VERSION, profiles: decoded, activeProfileId },
    notices,
    fresh: false,
    loadedVersion: version,
    migrated: migration.applied.length > 0,
    dirty: log.count > 0 || migration.applied.length > 0,
  };
}

/**
 * The selected profile must exist. A dangling id points the Director map at a
 * profile that is not there; falling back to the first profile keeps the game
 * playable, and null is only correct when there are genuinely no profiles.
 */
function resolveActive(raw: unknown, profiles: readonly Profile[], log: RepairLog): string | null {
  const first = profiles[0];
  if (first === undefined) {
    if (raw !== null && raw !== undefined) repaired(log, "activeProfileId");
    return null;
  }
  if (typeof raw === "string" && profiles.some((p) => p.id === raw)) return raw;
  repaired(log, "activeProfileId");
  return first.id;
}

/** Short description of a value for a developer-facing notice detail. */
function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value;
}
