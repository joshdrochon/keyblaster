import { describe, expect, it } from "vitest";
import {
  DEBOUNCE_MS,
  DEFAULT_PROFILE_NAME,
  DEFAULT_SHIP_NAME,
  SCHEMA_VERSION,
  STORAGE_KEY,
  type ProfileStore,
  blankProfile,
  createProfileStore,
  loadState,
  serializeState,
} from "@engine/persistence/index.js";
import { DEFAULT_SETTINGS, STOP_IDS, type Profile } from "@engine/types.js";
import { FakeClock, FakeStorage, populatedProfile, storedPayload, v1Payload, wordRecord } from "./fixtures.js";

function setup(raw?: string): { store: ProfileStore; storage: FakeStorage; clock: FakeClock } {
  const storage = new FakeStorage(raw === undefined ? {} : { [STORAGE_KEY]: raw });
  const clock = new FakeClock();
  const store = createProfileStore({ storage, clock });
  return { store, storage, clock };
}

function stored(storage: FakeStorage): unknown {
  const raw = storage.map.get(STORAGE_KEY);
  return raw === undefined ? undefined : JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Debounced writes (architecture section 7)
// ---------------------------------------------------------------------------

describe("debounced writes", () => {
  it("writes nothing before the 250 ms debounce elapses", () => {
    const { store, storage, clock } = setup(storedPayload([populatedProfile()], "p1"));
    expect(store.dirty).toBe(false);
    store.updateSettings("p1", { musicVolume: 0.1 });
    expect(store.dirty).toBe(true);
    expect(store.writeScheduled).toBe(true);
    clock.advance(DEBOUNCE_MS - 1);
    expect(storage.setCalls).toBe(0);
    clock.advance(1);
    expect(storage.setCalls).toBe(1);
    expect(store.dirty).toBe(false);
    expect(store.writeScheduled).toBe(false);
  });

  it("uses 250 ms, the number in architecture section 7", () => {
    expect(DEBOUNCE_MS).toBe(250);
  });

  it("coalesces a burst of mutations into ONE write", () => {
    const { store, storage, clock } = setup(storedPayload([populatedProfile()], "p1"));
    for (let i = 0; i < 20; i += 1) {
      store.updateSettings("p1", { sfxVolume: i / 20 });
      clock.advance(10); // faster than the debounce: the timer keeps restarting
    }
    expect(storage.setCalls).toBe(0);
    clock.advance(DEBOUNCE_MS);
    expect(storage.setCalls).toBe(1);
    const state = stored(storage) as { profiles: Array<{ settings: { sfxVolume: number } }> };
    expect(state.profiles[0]?.settings.sfxVolume).toBe(19 / 20);
  });

  it("flush() writes immediately and cancels the pending timer", () => {
    const { store, storage, clock } = setup(storedPayload([populatedProfile()], "p1"));
    store.updateSettings("p1", { reducedMotion: true });
    const result = store.flush();
    expect(result).toEqual({ ok: true, wrote: true, error: null });
    expect(storage.setCalls).toBe(1);
    expect(store.writeScheduled).toBe(false);
    clock.advance(10_000);
    expect(storage.setCalls).toBe(1); // the cancelled timer never fired
  });

  it("flush() on a clean store does nothing", () => {
    const { store, storage } = setup(storedPayload([populatedProfile()], "p1"));
    expect(store.flush()).toEqual({ ok: true, wrote: false, error: null });
    expect(storage.setCalls).toBe(0);
  });

  it("close() flushes, so pagehide loses nothing", () => {
    const { store, storage } = setup(storedPayload([populatedProfile()], "p1"));
    store.updateSettings("p1", { uppercase: true });
    expect(store.close().wrote).toBe(true);
    expect(storage.setCalls).toBe(1);
  });

  it("a repaired or migrated load schedules its own write-back", () => {
    const { store, storage, clock } = setup(JSON.stringify(v1Payload()));
    expect(store.loadResult.migrated).toBe(true);
    expect(store.writeScheduled).toBe(true);
    clock.advance(DEBOUNCE_MS);
    const state = stored(storage) as { version: number };
    expect(state.version).toBe(SCHEMA_VERSION);
  });
});

// ---------------------------------------------------------------------------
// Quota / private mode (setItem throws)
// ---------------------------------------------------------------------------

describe("storage failure degrades, never crashes", () => {
  it("AC-18.4: a quota error leaves the session playable and raises one notice", () => {
    const { store, storage, clock } = setup(storedPayload([populatedProfile()], "p1"));
    storage.setThrows = "QuotaExceededError: persistent storage full";
    store.updateSettings("p1", { musicVolume: 0.2 });
    expect(() => clock.advance(DEBOUNCE_MS)).not.toThrow();

    expect(store.degraded).toBe(true);
    expect(store.dirty).toBe(true); // still pending, so a later flush retries
    expect(store.activeProfile()?.settings.musicVolume).toBe(0.2); // memory wins
    const failures = store.notices.filter((n) => n.code === "write-failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]?.blocking).toBe(false);
  });

  it("does not spam a notice per failed write", () => {
    const { store, storage, clock } = setup();
    storage.setThrows = "QuotaExceededError";
    for (let i = 0; i < 5; i += 1) {
      store.createProfile({ name: `P${i}` });
      clock.advance(DEBOUNCE_MS);
    }
    expect(store.notices.filter((n) => n.code === "write-failed")).toHaveLength(1);
    // The five new pilots plus the fresh one the empty-storage load handed back.
    expect(store.profiles).toHaveLength(6);
  });

  it("recovers when storage starts working again", () => {
    const { store, storage, clock } = setup();
    storage.setThrows = "QuotaExceededError";
    const created = store.createProfile({ name: "Ada" });
    clock.advance(DEBOUNCE_MS);
    expect(store.degraded).toBe(true);

    storage.setThrows = null;
    expect(store.flush().ok).toBe(true);
    expect(store.degraded).toBe(false);
    expect(store.dirty).toBe(false);
    const state = stored(storage) as { profiles: Profile[] };
    expect(state.profiles.map((p) => p.id)).toContain(created.id);
  });

  it("a value that cannot be serialised is a failed write, not an exception", () => {
    const { store, storage, clock } = setup();
    const profile = store.createProfile({ name: "Ada" });
    const cyclic: number[] = [];
    cyclic.push(cyclic as unknown as number);
    store.updateProfile(profile.id, (p) => ({
      ...p,
      words: { en: { moon: { ...wordRecord(), fkLatencyMs: cyclic } } },
    }));
    expect(() => clock.advance(DEBOUNCE_MS)).not.toThrow();
    expect(store.degraded).toBe(true);
    expect(storage.map.has(STORAGE_KEY)).toBe(false);
  });

  it("AC-18.4: a corrupt payload at construction yields a playable store", () => {
    const { store } = setup("}{ not json");
    expect(store.profiles).toHaveLength(1);
    expect(store.activeProfile()?.name).toBe(DEFAULT_PROFILE_NAME);
    expect(store.loadResult.fresh).toBe(true);
    expect(store.notices.every((n) => n.blocking === false)).toBe(true);
    expect(store.takeNotices().length).toBeGreaterThan(0);
    expect(store.notices).toHaveLength(0); // drained
  });
});

// ---------------------------------------------------------------------------
// Multiple profiles (D43 "profiles, not accounts"), reset progress (D41)
// ---------------------------------------------------------------------------

describe("D43: multiple profiles", () => {
  it("creates, lists and selects", () => {
    const { store, clock } = setup();
    const ada = store.createProfile({ name: "Ada", avatar: "avatar-2" });
    const rey = store.createProfile({ name: "Rey" });
    expect(store.profiles.map((p) => p.name)).toEqual([DEFAULT_PROFILE_NAME, "Ada", "Rey"]);
    // A new profile is selected: the flow is pick-then-fly (D40).
    expect(store.activeProfile()?.id).toBe(rey.id);
    expect(store.selectProfile(ada.id)).toBe(true);
    expect(store.activeProfile()?.name).toBe("Ada");
    expect(store.selectProfile("nope")).toBe(false);
    expect(store.getProfile(ada.id)?.avatar).toBe("avatar-2");
    expect(store.getProfile("nope")).toBeNull();
    clock.advance(DEBOUNCE_MS);
  });

  it("AC-6b.1: a new profile names its ship Lantern by default", () => {
    const { store } = setup();
    const p = store.createProfile({ name: "Ada" });
    expect(p.shipName).toBe(DEFAULT_SHIP_NAME);
    expect(store.createProfile({ shipName: "Kestrel" }).shipName).toBe("Kestrel");
  });

  it("re-selecting the already-active profile is a no-op, not a write", () => {
    const { store, clock } = setup();
    const ada = store.createProfile({ name: "Ada" });
    store.flush();
    expect(store.selectProfile(ada.id)).toBe(true);
    expect(store.dirty).toBe(false);
    clock.advance(DEBOUNCE_MS);
  });

  it("deletes a profile and moves the selection off it", () => {
    const { store } = setup();
    const ada = store.createProfile({ name: "Ada" });
    const rey = store.createProfile({ name: "Rey" });
    expect(store.deleteProfile(rey.id)).toBe(true);
    expect(store.profiles.map((p) => p.id)).not.toContain(rey.id);
    expect(store.activeProfile()?.id).toBe(store.profiles[0]?.id);
    expect(store.deleteProfile(rey.id)).toBe(false);
    expect(store.deleteProfile(ada.id)).toBe(true);
  });

  it("deleting a non-active profile leaves the selection alone", () => {
    const { store } = setup();
    const ada = store.createProfile({ name: "Ada" });
    const rey = store.createProfile({ name: "Rey" });
    store.deleteProfile(ada.id);
    expect(store.activeProfile()?.id).toBe(rey.id);
  });

  it("D43: deleting the LAST profile leaves a usable, empty state", () => {
    const { store, storage, clock } = setup();
    for (const p of [...store.profiles]) store.deleteProfile(p.id);
    expect(store.profiles).toEqual([]);
    expect(store.activeProfile()).toBeNull();
    clock.advance(DEBOUNCE_MS);
    // It persists as an empty list, and reloading it is not "corruption".
    const reloaded = createProfileStore({ storage, clock: new FakeClock() });
    expect(reloaded.loadResult.fresh).toBe(false);
    expect(reloaded.profiles).toEqual([]);
    // And the player can start again.
    expect(reloaded.createProfile({ name: "New" }).name).toBe("New");
    expect(reloaded.activeProfile()?.name).toBe("New");
  });

  it("generates distinct ids without Math.random", () => {
    const { store } = setup();
    const ids = [store.createProfile().id, store.createProfile().id, store.createProfile().id];
    expect(new Set(ids).size).toBe(3);
    // Same clock, same sequence: ids are reproducible across runs.
    const twin = createProfileStore({ storage: new FakeStorage(), clock: new FakeClock() });
    expect([twin.createProfile().id, twin.createProfile().id, twin.createProfile().id]).toEqual(ids);
  });

  it("accepts an injected id source", () => {
    let n = 0;
    const store = createProfileStore({
      storage: new FakeStorage(),
      clock: new FakeClock(),
      newId: () => `id-${++n}`,
    });
    expect(store.createProfile().id).toBe("id-2"); // id-1 was the fresh-load profile
  });

  it("updateProfile on an unknown id returns null and schedules nothing", () => {
    const { store } = setup(storedPayload([populatedProfile()], "p1"));
    expect(store.updateProfile("ghost", (p) => p)).toBeNull();
    expect(store.updateSettings("ghost", { uppercase: true })).toBeNull();
    expect(store.resetProgress("ghost")).toBeNull();
    expect(store.dirty).toBe(false);
  });
});

describe("D41: reset progress", () => {
  it("D41: clears progress, trophies, skins and the word book", () => {
    const profile = populatedProfile();
    const { store } = setup(storedPayload([profile], "p1"));
    const reset = store.resetProgress("p1");
    expect(reset).not.toBeNull();
    expect(reset?.progress.every((p) => !p.cleared && p.stars === 0)).toBe(true);
    expect(reset?.progress.every((p) => p.beaconPlacedAt === null)).toBe(true);
    expect(reset?.progress.map((p) => p.stopId)).toEqual([...STOP_IDS]);
    expect(reset?.trophies).toEqual([]);
    expect(reset?.unlockedSkins).toEqual([]);
    expect(reset?.unlockedShips).toEqual([profile.shipId]);
    expect(reset?.words).toEqual({});
  });

  it("D41: keeps who the pilot is, their settings and their calibration", () => {
    const profile = populatedProfile();
    profile.settings = { ...profile.settings, uiLang: "hi", reducedMotion: true };
    profile.calibration = { ikiMs: 280, fkLatencyMs: 430 };
    const { store } = setup(storedPayload([profile], "p1"));
    const reset = store.resetProgress("p1");
    expect(reset?.id).toBe(profile.id);
    expect(reset?.name).toBe("Ada");
    expect(reset?.avatar).toBe("avatar-3");
    expect(reset?.shipName).toBe(profile.shipName);
    expect(reset?.createdAt).toBe(profile.createdAt);
    expect(reset?.settings.uiLang).toBe("hi");
    expect(reset?.settings.reducedMotion).toBe(true);
    expect(reset?.calibration).toEqual({ ikiMs: 280, fkLatencyMs: 430 });
  });

  it("D41: a reset profile is what a fresh one looks like, apart from identity", () => {
    const { store } = setup(storedPayload([populatedProfile()], "p1"));
    const reset = store.resetProgress("p1");
    const fresh = blankProfile({ id: "p1", createdAt: reset?.createdAt ?? 0, name: "Ada", avatar: "avatar-3" });
    expect({ ...reset, settings: DEFAULT_SETTINGS }).toEqual({ ...fresh, settings: DEFAULT_SETTINGS, calibration: reset?.calibration });
  });
});

// ---------------------------------------------------------------------------
// Round-trip fidelity (D44, AC-7.2)
// ---------------------------------------------------------------------------

describe("AC-7.2 / D44: round-trip fidelity", () => {
  it("AC-7.2: a populated word book survives save -> load byte-identically", () => {
    const profile = populatedProfile();
    const { store, storage, clock } = setup();
    const created = store.profiles[0];
    expect(created).toBeDefined();
    const id = created?.id ?? "";
    store.updateProfile(id, () => ({ ...profile, id }));
    clock.advance(DEBOUNCE_MS);

    const bytes = storage.map.get(STORAGE_KEY);
    expect(bytes).toBeDefined();

    const reloaded = createProfileStore({ storage, clock: new FakeClock() });
    expect(reloaded.loadResult.notices).toEqual([]);
    expect(reloaded.profiles[0]).toEqual({ ...profile, id });
    // Byte-identical, not merely deep-equal: re-encoding the decoded state
    // reproduces the exact string, so nothing drifts across sessions.
    expect(serializeState(reloaded.state)).toBe(bytes);
  });

  it("AC-7.2: firstFkLatencyMs, lastWpm and lastAccuracy all survive", () => {
    const profile = populatedProfile();
    const storage = new FakeStorage({ [STORAGE_KEY]: storedPayload([profile], profile.id) });
    const loaded = loadState(storage, { freshProfile: () => blankProfile({ id: "f", createdAt: 0 }) }).state;
    const p = loaded.profiles[0];
    expect(p?.words["en"]?.["moon"]?.firstFkLatencyMs).toBe(640);
    expect(p?.words["en"]?.["star"]?.firstFkLatencyMs).toBeNull();
    const earth = p?.progress.find((s) => s.stopId === "earth");
    expect(earth?.lastWpm).toBe(21);
    expect(earth?.lastAccuracy).toBe(0.91);
    expect(earth?.bestWpm).toBe(22.5);
  });

  it("word-book key order is stable, so identical data means identical bytes", () => {
    const a = populatedProfile();
    const b: Profile = {
      ...populatedProfile(),
      // Same words, inserted in the opposite order.
      words: {
        hi: { घर: wordRecord({ exposures: 2 }) },
        es: { luna: wordRecord({ exposures: 9 }) },
        en: {
          comet: wordRecord({ fkLatencyMs: [], ikiMs: [], lastSeen: null }),
          star: wordRecord({ exposures: 1, hits: 1, misses: 0, firstFkLatencyMs: null, ease: 1.6 }),
          moon: wordRecord(),
        },
      },
    };
    expect(storedPayload([b], "p1")).toBe(storedPayload([a], "p1"));
  });

  it("three sessions of appending word history do not drift", () => {
    const storage = new FakeStorage();
    let expected: Profile | null = null;
    for (let session = 0; session < 3; session += 1) {
      const clock = new FakeClock(1_000 + session);
      const store = createProfileStore({ storage, clock, newId: () => "fixed" });
      store.updateProfile("fixed", (p) => ({
        ...p,
        words: {
          ...p.words,
          en: {
            ...(p.words["en"] ?? {}),
            [`w${session}`]: wordRecord({ exposures: session + 1 }),
          },
        },
      }));
      clock.advance(DEBOUNCE_MS);
      expected = store.profiles[0] ?? null;
    }
    const final = createProfileStore({ storage, clock: new FakeClock() });
    expect(final.profiles[0]).toEqual(expected);
    expect(Object.keys(final.profiles[0]?.words["en"] ?? {})).toEqual(["w0", "w1", "w2"]);
  });
});
