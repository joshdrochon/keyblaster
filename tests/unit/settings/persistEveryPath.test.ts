import { describe, expect, it } from "vitest";
import { createProfileStore, STORAGE_KEY, type ProfileStore } from "@engine/persistence/index.js";
import {
  DEFAULT_SETTINGS,
  DEVICE_SETTING_KEYS,
  PILOT_SETTING_KEYS,
  type Settings,
} from "@engine/types.js";
import { FakeClock, FakeStorage } from "../persistence/fixtures.js";

/**
 * D108, THE AUDIT: every setting, set and read back through every path.
 *
 * The owner's words: "make sure when we turn music down it stays so and so on
 * and so forth" - every setting, not just the one that was reported. So this
 * sweeps the whole of `Settings` rather than naming favourites, and a key added
 * later is swept the day it is added.
 */

/** A value that is definitely NOT the default, per key. */
const CHANGED: Settings = {
  musicVolume: 0.13,
  sfxVolume: 0.27,
  keyboardLayout: "dvorak",
  uiLang: "en",
  contentLang: "en",
  inputMethod: "latin",
  uppercase: true,
  increasedLetterSpacing: true,
  reducedMotion: true,
  colorblindPalette: true,
  relativeBoard: true,
  dashColor: "violet",
};

function fresh(): { store: ProfileStore; storage: FakeStorage; clock: FakeClock } {
  const storage = new FakeStorage({});
  const clock = new FakeClock();
  return { store: createProfileStore({ storage, clock }), storage, clock };
}

/** Reopen the same storage, as a page reload would. */
function reopen(storage: FakeStorage): ProfileStore {
  return createProfileStore({ storage, clock: new FakeClock() });
}

describe("D108: every setting survives a reload", () => {
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    it(`${key} is still set after closing and reopening`, () => {
      const { store, storage } = fresh();
      const p = store.createProfile({ name: "Ada", avatar: "a" });
      store.selectProfile(p.id);
      store.updateSettings(p.id, { [key]: CHANGED[key] } as Partial<Settings>);
      store.close();

      const again = reopen(storage);
      expect(again.settingsFor()[key], `${key} did not survive`).toEqual(CHANGED[key]);
    });
  }
});

describe("D108: a device setting is set with NO pilot selected", () => {
  /**
   * THE BUG, in the state it is actually reachable in.
   *
   * A first run SEEDS a profile, so "nobody exists" is not a state the Title
   * can be in - worth knowing, and it narrows the defect rather than removing
   * it. What IS reachable is deleting the last pilot, which leaves
   * `activeProfile()` null while the Title still offers volume. The write used
   * to return DEFAULT_SETTINGS and drop the change on the floor.
   */
  function noPilot(): { store: ProfileStore; storage: FakeStorage } {
    const { store, storage } = fresh();
    for (const p of [...store.profiles]) store.deleteProfile(p.id);
    expect(store.activeProfile(), "this test needs no active pilot").toBeNull();
    return { store, storage };
  }

  for (const key of DEVICE_SETTING_KEYS) {
    it(`${key} sticks with no pilot selected`, () => {
      const { store, storage } = noPilot();
      store.updateDeviceSettings({ [key]: CHANGED[key] });
      store.close();

      const again = reopen(storage);
      expect(again.settingsFor()[key], `${key} was discarded`).toEqual(CHANGED[key]);
    });
  }

  it("and reading with no pilot reports the device, not the shipped defaults", () => {
    const { store } = noPilot();
    store.updateDeviceSettings({ musicVolume: 0.13 });
    expect(store.settingsFor().musicVolume).toBe(0.13);
  });
});

describe("D108: a device setting is shared, a pilot setting is not", () => {
  function twoPilots(): { store: ProfileStore; a: string; b: string } {
    const { store } = fresh();
    const a = store.createProfile({ name: "Ada", avatar: "a" }).id;
    const b = store.createProfile({ name: "Bo", avatar: "b" }).id;
    return { store, a, b };
  }

  for (const key of DEVICE_SETTING_KEYS) {
    it(`${key} set by one pilot is seen by the other`, () => {
      const { store, a, b } = twoPilots();
      store.selectProfile(a);
      store.updateSettings(a, { [key]: CHANGED[key] } as Partial<Settings>);
      store.selectProfile(b);
      expect(store.settingsFor()[key], `${key} should be shared`).toEqual(CHANGED[key]);
    });
  }

  for (const key of PILOT_SETTING_KEYS) {
    it(`${key} set by one pilot does NOT leak to the other`, () => {
      const { store, a, b } = twoPilots();
      store.selectProfile(a);
      store.updateSettings(a, { [key]: CHANGED[key] } as Partial<Settings>);
      store.selectProfile(b);
      expect(store.settingsFor()[key], `${key} leaked between pilots`).toEqual(
        DEFAULT_SETTINGS[key],
      );
      store.selectProfile(a);
      expect(store.settingsFor()[key], `${key} was lost on the pilot who set it`).toEqual(
        CHANGED[key],
      );
    });
  }
});

describe("D108: switching pilots does not disturb the device", () => {
  it("volume set before a pilot exists survives creating and switching pilots", () => {
    const { store, storage } = fresh();
    store.updateDeviceSettings({ musicVolume: 0.13 });
    const a = store.createProfile({ name: "Ada", avatar: "a" }).id;
    const b = store.createProfile({ name: "Bo", avatar: "b" }).id;
    store.selectProfile(a);
    expect(store.settingsFor().musicVolume).toBe(0.13);
    store.selectProfile(b);
    expect(store.settingsFor().musicVolume).toBe(0.13);
    store.close();
    expect(reopen(storage).settingsFor().musicVolume).toBe(0.13);
  });

  it("deleting the pilot who set it does not take the device with them", () => {
    const { store, storage } = fresh();
    const a = store.createProfile({ name: "Ada", avatar: "a" }).id;
    store.selectProfile(a);
    store.updateSettings(a, { musicVolume: 0.13, uppercase: true });
    store.deleteProfile(a);
    store.close();
    const again = reopen(storage);
    expect(again.settingsFor().musicVolume, "the machine kept its volume").toBe(0.13);
  });

  it("resetting progress keeps both halves", () => {
    const { store } = fresh();
    const a = store.createProfile({ name: "Ada", avatar: "a" }).id;
    store.selectProfile(a);
    store.updateSettings(a, { musicVolume: 0.13, uppercase: true });
    store.resetProgress(a);
    expect(store.settingsFor().musicVolume).toBe(0.13);
    expect(store.settingsFor().uppercase).toBe(true);
  });
});
