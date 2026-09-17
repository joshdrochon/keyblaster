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
  resetProfileProgress,
  serializeState,
} from "@engine/persistence/index.js";
import { DEFAULT_SETTINGS, STOP_IDS, type Profile } from "@engine/types.js";
import {
  DEFAULT_KNOBS,
  MAX_LIVE_MAX,
  MAX_LIVE_MIN,
  applyChange,
  applyKnobs,
  concurrencyTarget,
  loosenStep,
  tightenStep,
} from "@engine/controller/index.js";
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

  it("a storage that throws a non-Error is still handled", () => {
    // Browsers throw DOMExceptions, but an extension shim can throw anything.
    const storage = new FakeStorage();
    const clock = new FakeClock();
    const hostile = {
      getItem: () => null,
      setItem: () => {
        throw "nope";
      },
      removeItem: () => undefined,
    };
    const store = createProfileStore({ storage: { ...storage, ...hostile }, clock });
    store.createProfile({ name: "Ada" });
    const result = store.flush();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("nope");
    expect(store.degraded).toBe(true);
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

/**
 * UR-51: THE DIFFICULTY KNOB HAS TO SURVIVE THE TAB CLOSING.
 *
 * `docs/verification-gaps.md` instance 24: `endStage` computed the right knob,
 * emitted it on `FLIGHT_EVENTS.stageComplete`, and nothing listened. `maxLive`
 * was 2 on every belt of every run for every child, so the whole difficulty
 * controller was inert.
 *
 * WHY THESE ARE ROUND TRIPS AND NOT WRITES. A write is the half that was never
 * the problem - `endStage` always worked. The claim that matters is that a knob
 * earned on Tuesday is still there on Wednesday, so every test below goes
 * value -> store -> serialized bytes -> a SECOND store built from those bytes,
 * and reads it back from the far side. `tests/unit/arch/profileWriters` cannot
 * make this claim: it asks whether a writer exists, and a writer that nothing
 * calls satisfies it (see gauntlet/escalations.md).
 */
describe("UR-51 / FR-10: the difficulty knob round-trips through storage", () => {
  it("UR-51: a knob written at stage end is still there after a reload", () => {
    const { store, storage, clock } = setup();
    const pilot = store.createProfile({ name: "Ada" });
    // The cold start, before anything is earned.
    expect(pilot.knobs).toEqual(DEFAULT_KNOBS);

    // Five tighten steps, which is what a route's worth of stage boundaries
    // does to a pilot who stays inside D17's band.
    let knobs = pilot.knobs;
    for (let stage = 0; stage < 5; stage += 1) {
      const step = tightenStep(knobs);
      expect(step, `stage ${stage} had no step left`).not.toBeNull();
      knobs = applyChange(knobs, step);
      store.updateProfile(pilot.id, (p) => applyKnobs(p, knobs));
    }
    expect(knobs.maxLive).toBe(MAX_LIVE_MAX);
    clock.advance(DEBOUNCE_MS);

    // THE FAR SIDE. A second store, built from the bytes the first one wrote.
    //
    // WATCHED FAILING, with the real number: delete the `knobs` block from
    // `encodeProfile` and this reads `{ maxLive: 2, lengthBias: 0 }` against the
    // `{ maxLive: 7 }` the child earned. The in-memory profile above still says
    // 7, which is exactly how this defect class hides.
    //
    // I TRIED A WEAKER LEVER FIRST AND IT DID NOT FIRE. Removing `"knobs"` from
    // `PROFILE_FIELDS` left all of these green: that list is read by the PII
    // scan and by documentation, not by the encoder, which copies field by
    // field in its own literal. A control that does not go red is not a control,
    // so the one named here is the one that was actually run.
    const reloaded = createProfileStore({ storage, clock: new FakeClock() });
    expect(reloaded.loadResult.fresh).toBe(false);
    expect(reloaded.activeProfile()?.knobs).toEqual(knobs);
    expect(reloaded.activeProfile()?.knobs.maxLive).toBe(MAX_LIVE_MAX);
  });

  it("UR-51: a loosened knob round-trips too, so the ramp is not one-way", () => {
    // The direction that protects the child who is struggling. A knob that only
    // ever ratchets up across sessions traps the grade-2 pilot on the
    // difficulty that stalled them yesterday.
    const { store, storage, clock } = setup();
    const pilot = store.createProfile({ name: "Rey" });
    store.updateProfile(pilot.id, (p) => applyKnobs(p, { maxLive: 6, lengthBias: 0 }));
    store.updateProfile(pilot.id, (p) =>
      applyKnobs(p, applyChange({ maxLive: 6, lengthBias: 0 }, loosenStep({ maxLive: 6, lengthBias: 0 }))),
    );
    clock.advance(DEBOUNCE_MS);
    const reloaded = createProfileStore({ storage, clock: new FakeClock() });
    // loosenStep drops lengthBias first (D53's mirror-image order), so maxLive
    // is untouched and the bias is at its floor.
    expect(reloaded.activeProfile()?.knobs).toEqual({ maxLive: 6, lengthBias: -1 });
  });

  it("UR-51: D18's cold start survives the round trip - a new pilot opens at the floor", () => {
    // THE SAFETY PROPERTY, END TO END. `concurrencyTarget(MAX_LIVE_MIN)` is
    // exactly 1, so at this knob the fall budget is FR-8's literal formula and
    // the belt holds no standing queue. A first belt that opened anywhere else
    // would be difficulty raised on a child the game has never watched, which
    // is what D18 forbids.
    const { store, storage, clock } = setup();
    const fresh = store.createProfile({ name: "New" });
    expect(fresh.knobs.maxLive).toBe(MAX_LIVE_MIN);
    expect(concurrencyTarget(fresh.knobs.maxLive)).toBe(1);
    clock.advance(DEBOUNCE_MS);
    const reloaded = createProfileStore({ storage, clock: new FakeClock() });
    expect(reloaded.activeProfile()?.knobs).toEqual(DEFAULT_KNOBS);
  });

  it("UR-51: a reset takes the knob back to the cold start, and keeps the calibration", () => {
    // Difficulty is EARNED, so D41's reset clears it. The baseline next door is
    // a measurement OF the child and is still true after a reset - that
    // asymmetry is the whole reason they are two fields.
    const { store, storage, clock } = setup();
    const pilot = store.createProfile({ name: "Ada" });
    store.updateProfile(pilot.id, (p) => ({
      ...applyKnobs(p, { maxLive: MAX_LIVE_MAX, lengthBias: 1 }),
      calibration: { ikiMs: 615, fkLatencyMs: 700 },
    }));
    store.updateProfile(pilot.id, (p) => resetProfileProgress(p));
    clock.advance(DEBOUNCE_MS);
    const reloaded = createProfileStore({ storage, clock: new FakeClock() });
    expect(reloaded.activeProfile()?.knobs).toEqual(DEFAULT_KNOBS);
    expect(reloaded.activeProfile()?.calibration.ikiMs).toBe(615);
  });

  it("UR-51: a corrupt stored knob is repaired to FR-10's range and SAYS SO", () => {
    // A knob is read straight into the fall-time budget and the spawn gap, so a
    // stored 999 is not a cosmetic defect. `clampKnobs` is reused rather than
    // reimplemented; what the decoder adds is the repair log, because a payload
    // we changed has to be reported like every other one.
    const raw = storedPayload(
      [{ ...blankProfile({ id: "p1", createdAt: 0 }), knobs: { maxLive: 999, lengthBias: 7 as 1 } }],
      "p1",
    );
    const { store } = setup(raw);
    expect(store.activeProfile()?.knobs).toEqual({ maxLive: MAX_LIVE_MAX, lengthBias: 1 });
    expect(store.loadResult.notices.map((n) => n.code)).toContain("repaired");
    // BOTH knobs are out of range, so BOTH have to be reported. Asserting only
    // that SOME repair happened would have missed the defect coverage found
    // here: the first draft compared the clamped bias against an already
    // narrowed one, so a stored lengthBias of 7 was rewritten to 1 in silence.
    //
    // WATCHED FAILING, with the real number: narrow the bias before the
    // comparison (`lengthBias: asLengthBias(...)` inside `wanted`) and this
    // reads 1 repaired path against the 2 expected.
    const paths = store.loadResult.notices
      .filter((n) => n.code === "repaired")
      .flatMap((n) => n.detail.split(/[\s,]+/))
      .filter((d) => d.includes("knobs"));
    expect(paths.some((d) => d.endsWith("maxLive"))).toBe(true);
    expect(paths.some((d) => d.endsWith("lengthBias"))).toBe(true);
  });

  it("UR-51: a v2 payload with no knobs block loads at the cold start, silently", () => {
    // Every profile written before this field existed looks like this. The v3
    // migration supplies the knob, and the load must NOT report damage: a
    // profile that never had the field did not lose it.
    //
    // The `migrated` notice IS expected and is asserted rather than tolerated: a
    // v2 payload that loaded without walking the chain would mean the version
    // bump did nothing, and `toEqual` on the whole code list is what makes that
    // a statement instead of a shrug.
    //
    // WATCHED FAILING, with the real number: drop `2: v2ToV3` from MIGRATIONS
    // and this reads ["unmigratable", "quarantined"] against ["migrated"], with
    // the child's whole profile parked under QUARANTINE_KEY and replaced by a
    // fresh one.
    //
    // NOTE WHAT THIS DOES NOT TEST. Making `decodeKnobs` log a repair for an
    // absent block leaves this green, because the migration supplies the block
    // before the decoder ever sees it. The decoder`s own absent-block path is
    // reached by a CURRENT-version payload with the field missing, and it is
    // asserted separately below - the two look identical from here and are not
    // the same code.
    const v2 = JSON.parse(storedPayload([blankProfile({ id: "p1", createdAt: 0 })], "p1")) as {
      version: number;
      profiles: Record<string, unknown>[];
    };
    v2.version = 2;
    delete v2.profiles[0]!["knobs"];
    const { store } = setup(JSON.stringify(v2));
    expect(store.activeProfile()?.knobs).toEqual(DEFAULT_KNOBS);
    expect(store.loadResult.notices.map((n) => n.code)).toEqual(["migrated"]);
  });

  it("UR-51: a CURRENT-version payload missing the knobs block is not damage either", () => {
    // The decoder's own absent-block path, which the migration test above
    // cannot reach. A hand-edited save, or a payload written by a build that
    // bumped the version before it wrote the field, must open at the cold start
    // and report nothing: a profile that never had the field did not lose it.
    //
    // WATCHED FAILING, with the real number: have `decodeKnobs` call
    // `repaired(log, path)` on `undefined` and the codes read ["repaired"]
    // against the [] expected.
    const current = JSON.parse(storedPayload([blankProfile({ id: "p1", createdAt: 0 })], "p1")) as {
      profiles: Record<string, unknown>[];
    };
    delete current.profiles[0]!["knobs"];
    const { store } = setup(JSON.stringify(current));
    expect(store.activeProfile()?.knobs).toEqual(DEFAULT_KNOBS);
    expect(store.loadResult.notices.map((n) => n.code)).toEqual([]);
  });
});
