import { describe, expect, it } from "vitest";
import { createProfileStore } from "@engine/persistence/store.js";
import { loadState } from "@engine/persistence/load.js";
import { blankProfile, DEFAULT_PROFILE_NAME, STORAGE_KEY } from "@engine/persistence/schema.js";
import type { StoragePort } from "@engine/persistence/port.js";

/**
 * A BROWSER THAT HAS NEVER PLAYED HAS NO PILOTS (owner, Oct 7).
 *
 * "If we have no pilots there should not be a default pilot, there should only
 * be one option which is New Pilot." A fresh Safari tab showed a pilot called
 * "Pilot" with no beacons, which reads as the game inventing a child.
 *
 * It was NOT the defect UR-146/UR-187 fixed. That one was the create screen
 * minting a pilot when Enter was pressed on an untouched form. This is the
 * STORE: `freshState` built a starting state containing one blank profile,
 * which falls through to the schema's `DEFAULT_PROFILE_NAME`. Same symptom,
 * different file, never touched.
 *
 * AC-18.4 says CORRUPTED storage gives a fresh profile. It says nothing about
 * empty storage, so the rescue still applies to damage and only to damage.
 *
 *   npx vitest run tests/unit/persistence/emptyPicker.test.ts --coverage.enabled=false
 */

class Fake implements StoragePort {
  readonly map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

const fresh = () => blankProfile({ id: "x", createdAt: 0 });
const load = (raw: string | null) => {
  const storage = new Fake();
  if (raw !== null) storage.setItem(STORAGE_KEY, raw);
  return loadState(storage, { freshProfile: fresh });
};

describe("no key at all: the browser has never played", () => {
  it("hands back no pilots", () => {
    expect(load(null).state.profiles).toHaveLength(0);
  });

  it("has no active pilot either, so nothing is silently selected", () => {
    expect(load(null).state.activeProfileId).toBeNull();
  });

  it("a store built on empty storage starts empty", () => {
    const store = createProfileStore({
      storage: new Fake(),
      clock: { now: () => 0, schedule: () => () => undefined },
    });
    expect(store.profiles).toHaveLength(0);
    expect(store.activeProfile()).toBeNull();
  });

  it("and the first pilot a child makes is the first id minted", () => {
    let n = 0;
    const store = createProfileStore({
      storage: new Fake(),
      clock: { now: () => 0, schedule: () => () => undefined },
      newId: () => `id-${++n}`,
    });
    expect(store.createProfile({ name: "Rin" }).id).toBe("id-1");
  });
});

describe("AC-18.4: a save that EXISTED and could not be read is still rescued", () => {
  it("rescues unparseable JSON", () => {
    const state = load("{ not json").state;
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0]?.name).toBe(DEFAULT_PROFILE_NAME);
  });

  it("rescues a payload of the wrong shape", () => {
    expect(load("[1,2,3]").state.profiles).toHaveLength(1);
  });

  it("rescues a key written blank, because something wrote that", () => {
    // The distinction the whole change rests on: absent is not the same as
    // present-and-empty.
    expect(load("   ").state.profiles).toHaveLength(1);
  });

  it("an empty profiles ARRAY is a real saved state, not damage", () => {
    const saved = JSON.stringify({
      version: 1,
      profiles: [],
      activeProfileId: null,
      device: {},
    });
    expect(load(saved).state.profiles).toHaveLength(0);
  });
});
