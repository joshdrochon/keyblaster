/**
 * persistence/ - versioned local persistence for profiles (D43, D44, FR-18,
 * architecture section 7).
 *
 * WHAT THIS MODULE GUARANTEES
 *  - AC-18.4 loadState() is TOTAL. For any string in storage - valid, damaged,
 *    or adversarial - it returns a usable state plus non-blocking notices. It
 *    has no throwing path, and the fuzz suite asserts that over hundreds of
 *    seeded mutations.
 *  - AC-18.2 / NFR-3 a profile is name + avatar + the ship they named. Encoding
 *    copies a fixed field list one name at a time, so no contact field can
 *    reach storage even if one is added to the type upstream.
 *  - D44 per-word history and map progress survive a save/load round trip
 *    byte-for-byte.
 *
 * WHAT IT NEVER TOUCHES
 *  localStorage, Date.now(), setTimeout, window, document. All three are
 *  injected (port.ts). src/game supplies the real adapters:
 *
 *    const store = createProfileStore({
 *      storage: window.localStorage,
 *      clock: {
 *        now: () => Date.now(),
 *        schedule: (fn, ms) => { const id = window.setTimeout(fn, ms);
 *                                return () => window.clearTimeout(id); },
 *      },
 *    });
 *    document.addEventListener("visibilitychange", () => {
 *      if (document.visibilityState === "hidden") store.flush();
 *    });
 *    window.addEventListener("pagehide", () => store.close());
 */

export type { CancelTimer, Clock, IdSource, StoragePort } from "./port.js";

export {
  DEFAULT_AVATAR,
  DEFAULT_PROFILE_NAME,
  DEFAULT_SHIP_ID,
  DEFAULT_SHIP_NAME,
  MAX_COLLECTION,
  MAX_ID_LENGTH,
  MAX_NAME_LENGTH,
  PROFILE_FIELDS,
  QUARANTINE_KEY,
  SCHEMA_VERSION,
  STORAGE_KEY,
  type NewProfileInput,
  type PersistedState,
  type RepairLog,
  blankProfile,
  blankProgress,
  bookFor,
  decodeProfile,
  emptyState,
  encodeState,
  isPlainObject,
  newRepairLog,
  resetProfileProgress,
  serializeState,
} from "./schema.js";

export {
  MIGRATIONS,
  OLDEST_SUPPORTED_VERSION,
  type Migration,
  type MigrationResult,
  inferFirstFkLatency,
  migrateToCurrent,
} from "./migrations.js";

export {
  type LoadOptions,
  type LoadResult,
  type Notice,
  type NoticeCode,
  loadState,
  notice,
} from "./load.js";

export {
  DEBOUNCE_MS,
  type ProfileStore,
  type ProfileStoreOptions,
  type SaveResult,
  createProfileStore,
} from "./store.js";

export {
  PII_KEY_TOKENS,
  assertNoPii,
  findPiiKeys,
  normalizeKey,
  piiTokenFor,
  splitKeyParts,
} from "./pii.js";
