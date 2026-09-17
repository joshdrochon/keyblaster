import { describe, expect, it } from "vitest";
import { DEFAULT_KNOBS } from "@engine/controller/index.js";
import {
  DEFAULT_AVATAR,
  DEFAULT_PROFILE_NAME,
  DEFAULT_SHIP_ID,
  DEFAULT_SHIP_NAME,
  MAX_COLLECTION,
  MAX_ID_LENGTH,
  SCHEMA_VERSION,
  STORAGE_KEY,
  blankProfile,
  blankProgress,
  bookFor,
  decodeProfile,
  emptyState,
  encodeState,
  isPlainObject,
  loadState,
  newRepairLog,
  serializeState,
} from "@engine/persistence/index.js";
import { SAMPLE_CAP } from "@engine/words/index.js";
import { DEFAULT_CALIBRATION, DEFAULT_SETTINGS, STOP_IDS } from "@engine/types.js";
import { FakeStorage, populatedProfile, wordRecord } from "./fixtures.js";

const freshProfile = () => blankProfile({ id: "fresh", createdAt: 0 });

describe("blankProfile / blankProgress", () => {
  it("D43: a new profile is name + avatar + the ship they named, and nothing else", () => {
    // THIS LIST IS THE ASSERTION, and adding to it has to be deliberate. It is
    // how AC-18.2 / NFR-3 are held by construction: a field that reaches a
    // child's save has to be typed out here by somebody who has thought about
    // whether it is PII. `knobs` (UR-51) is two integers describing how many
    // asteroids the game will put on screen - it says nothing about who the
    // child is, and `pii.test.ts` scans it alongside everything else.
    const p = blankProfile({ id: "a", createdAt: 7 });
    expect(Object.keys(p).sort()).toEqual(
      [
        "avatar",
        "calibration",
        "createdAt",
        "id",
        "knobs",
        "name",
        "progress",
        "settings",
        "shipId",
        "shipName",
        "trophies",
        "unlockedShips",
        "unlockedSkins",
        "words",
      ].sort(),
    );
    // D18's cold start: a pilot nobody has watched starts at the gentlest
    // setting, where UR-51's `concurrencyTarget` is exactly 1 and every fall
    // time is FR-8's literal formula.
    expect(p.knobs).toEqual(DEFAULT_KNOBS);
    expect(p.name).toBe(DEFAULT_PROFILE_NAME);
    expect(p.avatar).toBe(DEFAULT_AVATAR);
    expect(p.shipId).toBe(DEFAULT_SHIP_ID);
    expect(p.shipName).toBe(DEFAULT_SHIP_NAME);
    expect(p.settings).toEqual(DEFAULT_SETTINGS);
    expect(p.calibration).toEqual(DEFAULT_CALIBRATION);
    expect(p.unlockedShips).toEqual([DEFAULT_SHIP_ID]);
  });

  it("applies partial settings and calibration over the defaults", () => {
    const p = blankProfile({
      id: "a",
      createdAt: 0,
      settings: { uiLang: "hi", musicVolume: 0.1 },
      calibration: { ikiMs: 200, fkLatencyMs: 400 },
    });
    expect(p.settings.uiLang).toBe("hi");
    expect(p.settings.musicVolume).toBe(0.1);
    expect(p.settings.sfxVolume).toBe(DEFAULT_SETTINGS.sfxVolume);
    expect(p.calibration).toEqual({ ikiMs: 200, fkLatencyMs: 400 });
  });

  it("falls back to the default name when handed blank or oversized input", () => {
    expect(blankProfile({ id: "a", createdAt: 0, name: "   " }).name).toBe(DEFAULT_PROFILE_NAME);
    expect(blankProfile({ id: "a", createdAt: 0, name: "n".repeat(99) }).name).toHaveLength(24);
  });

  it("D57: progress has one row per stop, Earth first", () => {
    expect(blankProgress().map((p) => p.stopId)).toEqual([...STOP_IDS]);
    expect(blankProgress()[0]?.stopId).toBe("earth");
    expect(blankProgress().every((p) => !p.cleared && p.stars === 0 && p.beaconPlacedAt === null)).toBe(true);
  });

  it("emptyState is a valid, profile-less state", () => {
    expect(emptyState()).toEqual({ version: SCHEMA_VERSION, profiles: [], activeProfileId: null });
    expect(serializeState(emptyState())).toBe(`{"version":${SCHEMA_VERSION},"activeProfileId":null,"profiles":[]}`);
  });

  it("bookFor returns an empty book rather than undefined", () => {
    expect(bookFor(blankProfile({ id: "a", createdAt: 0 }), "en")).toEqual({});
    expect(Object.keys(bookFor(populatedProfile(), "en"))).toEqual(["moon", "star", "comet"]);
  });
});

describe("coercion primitives", () => {
  it("isPlainObject rejects arrays and null", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject("x")).toBe(false);
  });

  it("counter floors a fractional count and records the repair", () => {
    const log = newRepairLog();
    const p = decodeProfile({ id: "a", words: { en: { moon: { exposures: 3.7, nextEligibleStage: 2.2 } } } }, log, "$");
    expect(p?.words["en"]?.["moon"]?.exposures).toBe(3);
    expect(p?.words["en"]?.["moon"]?.nextEligibleStage).toBe(2);
    expect(log.count).toBeGreaterThan(0);
  });

  it("a sample window longer than the cap keeps the NEWEST samples", () => {
    const log = newRepairLog();
    const long = Array.from({ length: SAMPLE_CAP + 5 }, (_, i) => i);
    const p = decodeProfile({ id: "a", words: { en: { moon: { fkLatencyMs: long } } } }, log, "$");
    const kept = p?.words["en"]?.["moon"]?.fkLatencyMs ?? [];
    expect(kept).toHaveLength(SAMPLE_CAP);
    expect(kept[kept.length - 1]).toBe(SAMPLE_CAP + 4);
    expect(kept[0]).toBe(5);
  });

  it("rounds a fractional star count into the 0..3 band", () => {
    const log = newRepairLog();
    const p = decodeProfile({ id: "a", progress: [{ stopId: "mars", stars: 1.5 }] }, log, "$");
    expect(p?.progress.find((s) => s.stopId === "mars")?.stars).toBe(2);
    expect(log.count).toBeGreaterThan(0);
  });

  it("drops word keys that are empty or absurdly long", () => {
    const log = newRepairLog();
    const p = decodeProfile(
      { id: "a", words: { en: { "": wordRecord(), ["w".repeat(MAX_ID_LENGTH + 1)]: wordRecord(), ok: wordRecord() } } },
      log,
      "$",
    );
    expect(Object.keys(p?.words["en"] ?? {})).toEqual(["ok"]);
  });

  it("caps how many words it will re-persist from one language", () => {
    const flood: Record<string, unknown> = {};
    for (let i = 0; i < MAX_COLLECTION * 8 + 50; i += 1) flood[`w${i}`] = { exposures: 1 };
    const log = newRepairLog();
    const p = decodeProfile({ id: "a", words: { en: flood } }, log, "$");
    expect(Object.keys(p?.words["en"] ?? {})).toHaveLength(MAX_COLLECTION * 8);
  });

  it("caps list-shaped collections too", () => {
    const log = newRepairLog();
    const trophies = Array.from({ length: MAX_COLLECTION + 10 }, (_, i) => `t${i}`);
    const p = decodeProfile({ id: "a", trophies }, log, "$");
    expect(p?.trophies).toHaveLength(MAX_COLLECTION);
  });

  it("decodeProfile returns null for a non-object and for a missing id", () => {
    const log = newRepairLog();
    expect(decodeProfile(null, log, "$")).toBeNull();
    expect(decodeProfile([], log, "$")).toBeNull();
    expect(decodeProfile({ name: "no id" }, log, "$")).toBeNull();
    expect(decodeProfile({ id: "   " }, log, "$")).toBeNull();
    expect(log.count).toBe(4);
  });
});

describe("encoding", () => {
  it("writes a fixed key order so identical data is identical bytes", () => {
    const state = { version: SCHEMA_VERSION, profiles: [blankProfile({ id: "a", createdAt: 1 })], activeProfileId: "a" };
    const json = serializeState(state);
    expect(json.indexOf('"version"')).toBeLessThan(json.indexOf('"activeProfileId"'));
    expect(json.indexOf('"activeProfileId"')).toBeLessThan(json.indexOf('"profiles"'));
    expect(serializeState(state)).toBe(json);
  });

  it("always stamps the CURRENT version, whatever the state object says", () => {
    const encoded = encodeState({ version: 1, profiles: [], activeProfileId: null });
    expect(encoded["version"]).toBe(SCHEMA_VERSION);
  });

  it("skips a language with no book rather than writing an empty one", () => {
    const p = blankProfile({ id: "a", createdAt: 0 });
    p.words = { en: { moon: wordRecord() } };
    const json = serializeState({ version: SCHEMA_VERSION, profiles: [p], activeProfileId: "a" });
    expect(json).toContain('"en"');
    expect(json).not.toContain('"es"');
  });

  it("AC-18.4: encode -> decode is a fixed point for a fully populated profile", () => {
    const profile = populatedProfile();
    const raw = serializeState({ version: SCHEMA_VERSION, profiles: [profile], activeProfileId: profile.id });
    const result = loadState(new FakeStorage({ [STORAGE_KEY]: raw }), { freshProfile });
    expect(serializeState(result.state)).toBe(raw);
  });
});
