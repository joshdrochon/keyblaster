import type { Profile, Settings } from "../types.js";
import type { CancelTimer, Clock, IdSource, StoragePort } from "./port.js";
import { type LoadResult, type Notice, loadState, notice } from "./load.js";
import {
  STORAGE_KEY,
  type NewProfileInput,
  type PersistedState,
  blankProfile,
  resetProfileProgress,
  serializeState,
} from "./schema.js";

/** Architecture section 7: "writes debounced (250 ms)". */
export const DEBOUNCE_MS = 250;

export interface SaveResult {
  /** False only when storage refused the write. Never throws either way. */
  readonly ok: boolean;
  /** False when there was nothing to write. */
  readonly wrote: boolean;
  readonly error: string | null;
}

export interface ProfileStoreOptions {
  storage: StoragePort;
  clock: Clock;
  /** Overridable for tests; defaults to DEBOUNCE_MS. */
  debounceMs?: number;
  /** Profile id generator. Defaults to a clock + counter id (no randomness). */
  newId?: IdSource;
}

/**
 * The persistence surface the game layer talks to (D43, D44).
 *
 * Every mutator returns immediately and schedules a debounced write; nothing
 * here does I/O synchronously except `flush`. Nothing here throws: a storage
 * failure sets `degraded` and pushes a non-blocking notice, because a child
 * mid-flight must not lose the session to a full quota.
 */
export interface ProfileStore {
  /** The live state. Treat as read-only; mutate through the methods. */
  readonly state: PersistedState;
  readonly profiles: readonly Profile[];
  /** Unsaved changes are pending. */
  readonly dirty: boolean;
  /** A write is scheduled but has not fired yet. */
  readonly writeScheduled: boolean;
  /** The last write failed; the session is running from memory only. */
  readonly degraded: boolean;
  /** What happened on load, plus any write failures since. Non-blocking. */
  readonly notices: readonly Notice[];
  /** What the load itself found (fresh / migrated / repaired). */
  readonly loadResult: LoadResult;

  activeProfile(): Profile | null;
  getProfile(id: string): Profile | null;
  createProfile(input?: Partial<Omit<NewProfileInput, "id" | "createdAt">>): Profile;
  selectProfile(id: string): boolean;
  deleteProfile(id: string): boolean;
  /** Replace a profile through a pure updater. Returns the new profile. */
  updateProfile(id: string, update: (profile: Profile) => Profile): Profile | null;
  updateSettings(id: string, patch: Partial<Settings>): Profile | null;
  /** D41 "reset progress": keeps the pilot, clears everything they earned. */
  resetProgress(id: string): Profile | null;
  /** Write now if dirty. Wire to visibilitychange and to the results screen. */
  flush(): SaveResult;
  /** Cancel the pending timer and flush. Wire to pagehide / scene shutdown. */
  close(): SaveResult;
  /** Drain the notice queue; the game shows each one once. */
  takeNotices(): Notice[];
}

/**
 * Default id source: monotonic within a session, derived from the injected
 * clock, and free of Math.random so a seeded test gets a stable id (CLAUDE.md
 * forbids reaching for globals here anyway).
 */
function defaultIdSource(clock: Clock): IdSource {
  let n = 0;
  return () => {
    n += 1;
    return `p${clock.now().toString(36)}-${n.toString(36)}`;
  };
}

export function createProfileStore(options: ProfileStoreOptions): ProfileStore {
  const { storage, clock } = options;
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS;
  const newId = options.newId ?? defaultIdSource(clock);

  const freshProfile = (): Profile => blankProfile({ id: newId(), createdAt: clock.now() });

  const loadResult = loadState(storage, { freshProfile });
  const state: PersistedState = loadResult.state;
  const notices: Notice[] = [...loadResult.notices];

  let dirty = loadResult.dirty;
  let degraded = false;
  let cancel: CancelTimer | null = null;

  /** Trailing-edge debounce: the timer restarts on every mutation. */
  function schedule(): void {
    dirty = true;
    if (cancel !== null) cancel();
    cancel = clock.schedule(() => {
      cancel = null;
      write();
    }, debounceMs);
  }

  /**
   * The only place that touches setItem.
   *
   * QUOTA / PRIVATE-MODE POLICY. setItem throws on a full quota and in some
   * private-browsing modes. We keep the in-memory state authoritative, mark the
   * store degraded, raise ONE non-blocking notice per failure streak, and leave
   * `dirty` set so the next flush retries. The game keeps running with no save;
   * it never crashes and never blocks (AC-18.4 in spirit, NFR-3 unaffected).
   */
  function write(): SaveResult {
    if (!dirty) return { ok: true, wrote: false, error: null };
    try {
      storage.setItem(STORAGE_KEY, serializeState(state));
      dirty = false;
      degraded = false;
      return { ok: true, wrote: true, error: null };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (!degraded) {
        degraded = true;
        notices.push(notice("write-failed", `${STORAGE_KEY}: ${detail}`));
      }
      return { ok: false, wrote: false, error: detail };
    }
  }

  // A repaired, migrated or freshly created state differs from the bytes on
  // disk. Schedule the write-back immediately rather than waiting for the first
  // gameplay mutation: a child who opens the game and closes the tab should
  // still end up with a migrated save, not a v1 payload that migrates again
  // every launch.
  if (dirty) schedule();

  function indexOf(id: string): number {
    return state.profiles.findIndex((p) => p.id === id);
  }

  function replaceAt(i: number, profile: Profile): Profile {
    state.profiles = [
      ...state.profiles.slice(0, i),
      profile,
      ...state.profiles.slice(i + 1),
    ];
    schedule();
    return profile;
  }

  const store: ProfileStore = {
    get state() {
      return state;
    },
    get profiles() {
      return state.profiles;
    },
    get dirty() {
      return dirty;
    },
    get writeScheduled() {
      return cancel !== null;
    },
    get degraded() {
      return degraded;
    },
    get notices() {
      return notices;
    },
    loadResult,

    activeProfile() {
      const id = state.activeProfileId;
      if (id === null) return null;
      return state.profiles.find((p) => p.id === id) ?? null;
    },

    getProfile(id) {
      return state.profiles.find((p) => p.id === id) ?? null;
    },

    createProfile(input = {}) {
      const profile = blankProfile({ ...input, id: newId(), createdAt: clock.now() });
      state.profiles = [...state.profiles, profile];
      // A profile you just made is the profile you want to fly (D40 flow:
      // profile pick -> map). Selecting it here saves the caller a round trip.
      state.activeProfileId = profile.id;
      schedule();
      return profile;
    },

    selectProfile(id) {
      if (indexOf(id) < 0) return false;
      if (state.activeProfileId === id) return true;
      state.activeProfileId = id;
      schedule();
      return true;
    },

    /**
     * Deleting the last profile leaves profiles: [] and activeProfileId: null.
     * That is a USABLE state, not an error: it is exactly the first-run state,
     * and the profile screen offers "create". We deliberately do not conjure a
     * replacement profile - a child who just deleted their pilot would find it
     * standing right back up.
     */
    deleteProfile(id) {
      const i = indexOf(id);
      if (i < 0) return false;
      state.profiles = [...state.profiles.slice(0, i), ...state.profiles.slice(i + 1)];
      if (state.activeProfileId === id) {
        state.activeProfileId = state.profiles[0]?.id ?? null;
      }
      schedule();
      return true;
    },

    updateProfile(id, update) {
      const i = indexOf(id);
      const existing = state.profiles[i];
      if (i < 0 || existing === undefined) return null;
      return replaceAt(i, update(existing));
    },

    updateSettings(id, patch) {
      return store.updateProfile(id, (p) => ({ ...p, settings: { ...p.settings, ...patch } }));
    },

    resetProgress(id) {
      return store.updateProfile(id, resetProfileProgress);
    },

    flush() {
      if (cancel !== null) {
        cancel();
        cancel = null;
      }
      return write();
    },

    close() {
      return store.flush();
    },

    takeNotices() {
      return notices.splice(0, notices.length);
    },
  };

  return store;
}
