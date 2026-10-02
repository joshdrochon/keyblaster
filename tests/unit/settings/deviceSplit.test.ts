import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEVICE_SETTINGS,
  DEFAULT_SETTINGS,
  DEVICE_SETTING_KEYS,
  PILOT_SETTING_KEYS,
  effectiveSettings,
  splitSettingsPatch,
  type Settings,
} from "@engine/types.js";

/**
 * D108: SETTINGS BELONG EITHER TO THE MACHINE OR TO A PILOT.
 *
 * The bug: Settings opens from the Title, where no pilot is selected, and every
 * row there was written to whichever profile happened to be active - or
 * silently discarded when there was none. Volume, calm motion, the colour-safe
 * palette, the keyboard and the menu language are about the room and the
 * hardware; the rest are about one child's eyes and hands.
 *
 * This file is the rule. The store and the app are checked against it next
 * door, so a key cannot drift into the wrong half without one of them failing.
 */
describe("D108: the two halves are exhaustive and disjoint", () => {
  it("every key in Settings is in exactly one half", () => {
    const all = Object.keys(DEFAULT_SETTINGS).sort();
    const halves = [...DEVICE_SETTING_KEYS, ...PILOT_SETTING_KEYS].sort();
    expect(halves).toEqual(all);
    expect(new Set(halves).size, "a key is in both halves").toBe(all.length);
  });

  it("puts the machine's settings on the device", () => {
    // Would a sibling sharing this laptop want it different? No.
    for (const k of [
      "musicVolume",
      "sfxVolume",
      "reducedMotion",
      "colorblindPalette",
      "keyboardLayout",
      "uiLang",
    ] as const) {
      expect(DEVICE_SETTING_KEYS, `${k} should be device-owned`).toContain(k);
    }
  });

  it("leaves what is about the child on the pilot", () => {
    for (const k of [
      "uppercase",
      "increasedLetterSpacing",
      "contentLang",
      "inputMethod",
      "relativeBoard",
      "dashColor",
    ] as const) {
      expect(PILOT_SETTING_KEYS, `${k} should stay on the profile`).toContain(k);
    }
  });

  it("the device defaults agree with the shipped defaults, key for key", () => {
    for (const k of DEVICE_SETTING_KEYS) {
      expect(DEFAULT_DEVICE_SETTINGS[k]).toBe(DEFAULT_SETTINGS[k]);
    }
  });
});

describe("D108: splitSettingsPatch routes every key", () => {
  it("sends each key to its own half and loses nothing", () => {
    const patch: Partial<Settings> = {
      musicVolume: 0.1,
      uppercase: true,
      uiLang: "en",
      dashColor: "teal",
    };
    const { device, pilot } = splitSettingsPatch(patch);
    expect(device).toEqual({ musicVolume: 0.1, uiLang: "en" });
    expect(pilot).toEqual({ uppercase: true, dashColor: "teal" });
  });

  it("drops undefined rather than writing it over a real value", () => {
    const { device, pilot } = splitSettingsPatch({
      musicVolume: undefined,
      uppercase: undefined,
    } as Partial<Settings>);
    expect(device).toEqual({});
    expect(pilot).toEqual({});
  });

  it("handles a FULL settings object, which is what applySettings passes", () => {
    const { device, pilot } = splitSettingsPatch({ ...DEFAULT_SETTINGS });
    expect(Object.keys(device).sort()).toEqual([...DEVICE_SETTING_KEYS].sort());
    expect(Object.keys(pilot).sort()).toEqual([...PILOT_SETTING_KEYS].sort());
  });
});

describe("D108: the device always wins for its own keys", () => {
  it("shadows a profile's stale copy", () => {
    // A profile saved before D108 still carries all twelve. The device's half
    // must win or a stale copy drags the volume back.
    const stale: Settings = { ...DEFAULT_SETTINGS, musicVolume: 0.9, uppercase: true };
    const got = effectiveSettings(stale, { ...DEFAULT_DEVICE_SETTINGS, musicVolume: 0.2 });
    expect(got.musicVolume, "device must win").toBe(0.2);
    expect(got.uppercase, "pilot keys are untouched").toBe(true);
  });

  it("returns a complete Settings, never a partial one", () => {
    const got = effectiveSettings(DEFAULT_SETTINGS, DEFAULT_DEVICE_SETTINGS);
    expect(Object.keys(got).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });
});
