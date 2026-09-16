import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROFILE_NAME,
  QUARANTINE_KEY,
  SCHEMA_VERSION,
  STORAGE_KEY,
  type LoadResult,
  blankProfile,
  loadState,
} from "@engine/persistence/index.js";
import { DEFAULT_CALIBRATION, DEFAULT_SETTINGS, EASE_NEW, STOP_IDS } from "@engine/types.js";
import { FakeStorage, populatedProfile, storedPayload, v1Payload } from "./fixtures.js";

let n = 0;
const freshProfile = () => blankProfile({ id: `fresh-${++n}`, createdAt: 42 });

function load(raw: string | null, storage = new FakeStorage()): { result: LoadResult; storage: FakeStorage } {
  if (raw !== null) storage.map.set(STORAGE_KEY, raw);
  const result = loadState(storage, { freshProfile });
  return { result, storage };
}

/** Every load, whatever the input, must satisfy this. */
function expectUsable(result: LoadResult): void {
  expect(result.state.version).toBe(SCHEMA_VERSION);
  expect(Array.isArray(result.state.profiles)).toBe(true);
  for (const p of result.state.profiles) {
    expect(typeof p.id).toBe("string");
    expect(p.id.length).toBeGreaterThan(0);
    expect(typeof p.name).toBe("string");
    expect(p.progress).toHaveLength(STOP_IDS.length);
    expect(Number.isFinite(p.calibration.ikiMs)).toBe(true);
  }
  const ids = result.state.profiles.map((p) => p.id);
  expect(new Set(ids).size).toBe(ids.length);
  if (result.state.activeProfileId !== null) {
    expect(ids).toContain(result.state.activeProfileId);
  }
  for (const notice of result.notices) expect(notice.blocking).toBe(false);
  // The decoded state must itself be serialisable - a load that produces
  // something JSON.stringify chokes on is a crash one tick later.
  expect(() => JSON.stringify(result.state)).not.toThrow();
}

describe("loadState: the happy paths", () => {
  it("AC-18.4: a clean current-version payload loads with no notices", () => {
    const profile = populatedProfile();
    const { result } = load(storedPayload([profile], profile.id));
    expectUsable(result);
    expect(result.notices).toEqual([]);
    expect(result.fresh).toBe(false);
    expect(result.dirty).toBe(false);
    expect(result.loadedVersion).toBe(SCHEMA_VERSION);
    expect(result.state.profiles[0]).toEqual(profile);
  });

  it("AC-18.4: first run (nothing stored) is a fresh profile, not an error", () => {
    const { result } = load(null);
    expectUsable(result);
    expect(result.fresh).toBe(true);
    expect(result.state.profiles).toHaveLength(1);
    expect(result.state.profiles[0]?.name).toBe(DEFAULT_PROFILE_NAME);
    expect(result.notices.map((x) => x.code)).toEqual(["empty"]);
    expect(result.loadedVersion).toBeNull();
  });

  it("an empty profiles array is a real saved state, not damage", () => {
    // The player deleted their last profile and closed the tab.
    const { result } = load(JSON.stringify({ version: SCHEMA_VERSION, profiles: [], activeProfileId: null }));
    expectUsable(result);
    expect(result.fresh).toBe(false);
    expect(result.state.profiles).toEqual([]);
    expect(result.notices).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-18.4: "corrupted storage -> fresh profile, never a crash."
// One test per corruption shape named in the AC's fuzz list.
// ---------------------------------------------------------------------------

describe("AC-18.4: corrupted storage never crashes", () => {
  const corrupt: Array<[name: string, raw: string]> = [
    ["invalid JSON", '{"version":2,"profiles":[{'],
    ["a bare word", "undefined"],
    ["valid JSON of the wrong shape", '{"hello":"world"}'],
    ["the literal null", "null"],
    ["an empty string", ""],
    ["whitespace only", "   \n\t "],
    ["a JSON array where an object is expected", '[{"id":"a"}]'],
    ["a JSON string", '"kb:v1:profiles"'],
    ["a JSON number", "12345"],
    ["a future schema version", '{"version":99,"profiles":[],"activeProfileId":null}'],
    ["profiles as an object", '{"version":2,"profiles":{"0":{"id":"a"}},"activeProfileId":null}'],
    ["profiles full of non-objects", '{"version":2,"profiles":[1,"x",null,[]],"activeProfileId":"a"}'],
    ["deeply nested garbage", `{"version":2,"profiles":[${nest(200)}],"activeProfileId":null}`],
    ["an HTML error page", "<!DOCTYPE html><html><body>502</body></html>"],
    ["a truncated payload", storedPayload([populatedProfile()], "p1").slice(0, 120)],
  ];

  for (const [name, raw] of corrupt) {
    it(`AC-18.4: ${name} -> fresh profile + non-blocking notice, no throw`, () => {
      let result!: LoadResult;
      expect(() => {
        result = load(raw).result;
      }).not.toThrow();
      expectUsable(result);
      expect(result.fresh).toBe(true);
      expect(result.state.profiles).toHaveLength(1);
      expect(result.state.activeProfileId).toBe(result.state.profiles[0]?.id);
      expect(result.notices.length).toBeGreaterThan(0);
      expect(result.notices.every((x) => x.blocking === false)).toBe(true);
      expect(result.dirty).toBe(true);
    });
  }

  it("AC-18.4: a fresh profile after corruption is fully playable", () => {
    const { result } = load("{{{");
    const profile = result.state.profiles[0];
    expect(profile).toBeDefined();
    expect(profile?.settings).toEqual(DEFAULT_SETTINGS);
    expect(profile?.calibration).toEqual(DEFAULT_CALIBRATION);
    expect(profile?.progress.map((p) => p.stopId)).toEqual([...STOP_IDS]);
    expect(profile?.words).toEqual({});
    expect(profile?.unlockedShips).toEqual([profile?.shipId]);
  });

  it("AC-18.4: the corrupt bytes are quarantined, not destroyed", () => {
    const { result, storage } = load("not json at all");
    expect(storage.map.get(QUARANTINE_KEY)).toBe("not json at all");
    expect(result.notices.map((x) => x.code)).toContain("quarantined");
  });

  it("AC-18.4: a quarantine write that throws is still not a crash", () => {
    const storage = new FakeStorage();
    storage.map.set(STORAGE_KEY, "{oops");
    storage.setThrows = "QuotaExceededError";
    let result!: LoadResult;
    expect(() => {
      result = loadState(storage, { freshProfile });
    }).not.toThrow();
    expectUsable(result);
    expect(result.notices.map((x) => x.code)).not.toContain("quarantined");
  });

  it("AC-18.4: getItem itself throwing yields a fresh profile", () => {
    const storage = new FakeStorage();
    storage.getThrows = true;
    const result = loadState(storage, { freshProfile });
    expectUsable(result);
    expect(result.fresh).toBe(true);
    expect(result.notices.map((x) => x.code)).toEqual(["unreadable"]);
  });

  it("AC-18.4: a future schema version is never downgraded in place", () => {
    const future = JSON.stringify({ version: SCHEMA_VERSION + 1, profiles: [{ id: "x" }], activeProfileId: "x" });
    const { result, storage } = load(future);
    expectUsable(result);
    expect(result.loadedVersion).toBe(SCHEMA_VERSION + 1);
    expect(result.notices.map((x) => x.code)).toContain("future-version");
    // The newer build's payload survives under the quarantine key.
    expect(storage.map.get(QUARANTINE_KEY)).toBe(future);
  });
});

// ---------------------------------------------------------------------------
// Repair, not rejection: a payload that is merely damaged keeps the child's data
// ---------------------------------------------------------------------------

describe("loadState: field-level repair", () => {
  const withProfile = (over: Record<string, unknown>): string =>
    JSON.stringify({
      version: SCHEMA_VERSION,
      activeProfileId: "keep",
      profiles: [{ id: "keep", ...over }],
    });

  it("AC-18.4: missing required fields fall back to defaults, the profile survives", () => {
    const { result } = load(withProfile({}));
    expectUsable(result);
    const p = result.state.profiles[0];
    expect(p?.id).toBe("keep");
    expect(p?.name).toBe(DEFAULT_PROFILE_NAME);
    expect(p?.settings).toEqual(DEFAULT_SETTINGS);
    expect(p?.progress).toHaveLength(STOP_IDS.length);
    expect(result.notices.map((x) => x.code)).toContain("repaired");
    expect(result.dirty).toBe(true);
  });

  it("AC-18.4: Infinity from 1e999 never reaches a persisted number", () => {
    // JSON has no Infinity literal, but 1e999 PARSES to Infinity without error,
    // and JSON.stringify would then silently write it back out as null.
    const raw = `{"version":2,"activeProfileId":"keep","profiles":[{"id":"keep",
      "createdAt":1e999,
      "calibration":{"ikiMs":-1e999,"fkLatencyMs":1e999},
      "progress":[{"stopId":"mars","bestWpm":1e999,"bestAccuracy":1e999,"lastWpm":-1e999,"lastAccuracy":-1e999,"stars":1e999,"beaconPlacedAt":1e999}],
      "words":{"en":{"moon":{"exposures":1e999,"ease":1e999,"lastSeen":1e999,"firstFkLatencyMs":1e999,"fkLatencyMs":[1e999,300],"ikiMs":[-1e999],"nextEligibleStage":1e999}}}}]}`;
    const { result } = load(raw);
    expectUsable(result);
    const p = result.state.profiles[0];
    expect(p?.createdAt).toBe(0);
    expect(p?.calibration).toEqual(DEFAULT_CALIBRATION);
    const mars = p?.progress.find((x) => x.stopId === "mars");
    expect(mars?.bestWpm).toBe(0);
    expect(mars?.bestAccuracy).toBe(0);
    expect(mars?.lastWpm).toBe(0);
    expect(mars?.stars).toBe(0);
    expect(mars?.beaconPlacedAt).toBeNull();
    const moon = p?.words["en"]?.["moon"];
    expect(moon?.exposures).toBe(0);
    expect(moon?.ease).toBe(EASE_NEW);
    expect(moon?.lastSeen).toBeNull();
    expect(moon?.firstFkLatencyMs).toBeNull();
    expect(moon?.fkLatencyMs).toEqual([300]);
    expect(moon?.ikiMs).toEqual([]);
    // Not one non-finite number survives anywhere in the decoded state.
    expectAllFinite(result.state);
  });

  it("wrong-typed fields are replaced one at a time, not by dropping the profile", () => {
    const { result } = load(
      withProfile({
        name: 12,
        avatar: null,
        settings: "nope",
        calibration: [],
        trophies: "first-light",
        unlockedSkins: [1, "ember", "ember", null],
        words: { en: "nope", fr: { oui: {} }, hi: { घर: { exposures: 2 } } },
        progress: { mars: true },
      }),
    );
    expectUsable(result);
    const p = result.state.profiles[0];
    expect(p?.name).toBe(DEFAULT_PROFILE_NAME);
    expect(p?.settings).toEqual(DEFAULT_SETTINGS);
    expect(p?.calibration).toEqual(DEFAULT_CALIBRATION);
    expect(p?.trophies).toEqual([]);
    expect(p?.unlockedSkins).toEqual(["ember"]);
    expect(p?.words["fr"]).toBeUndefined();
    expect(p?.words["en"]).toBeUndefined();
    expect(p?.words["hi"]?.["घर"]?.exposures).toBe(2);
    expect(p?.words["hi"]?.["घर"]?.ease).toBe(EASE_NEW);
  });

  it("a duplicated stop keeps one row per stop, in route order", () => {
    const { result } = load(
      withProfile({
        progress: [
          { stopId: "mars", cleared: true, stars: 1 },
          { stopId: "mars", cleared: false, stars: 3 },
          { stopId: "vulcan", cleared: true },
          "nonsense",
        ],
      }),
    );
    const p = result.state.profiles[0];
    expect(p?.progress.map((x) => x.stopId)).toEqual([...STOP_IDS]);
    expect(p?.progress.find((x) => x.stopId === "mars")?.stars).toBe(3);
  });

  it("duplicate profile ids collapse to the first", () => {
    const raw = JSON.stringify({
      version: SCHEMA_VERSION,
      activeProfileId: "dup",
      profiles: [{ id: "dup", name: "First" }, { id: "dup", name: "Second" }],
    });
    const { result } = load(raw);
    expectUsable(result);
    expect(result.state.profiles).toHaveLength(1);
    expect(result.state.profiles[0]?.name).toBe("First");
  });

  it("a dangling activeProfileId falls back to the first profile", () => {
    const raw = JSON.stringify({
      version: SCHEMA_VERSION,
      activeProfileId: "ghost",
      profiles: [{ id: "real", name: "Real" }],
    });
    const { result } = load(raw);
    expect(result.state.activeProfileId).toBe("real");
    expect(result.notices.map((x) => x.code)).toContain("repaired");
  });

  it("an activeProfileId with no profiles resolves to null", () => {
    const { result } = load(JSON.stringify({ version: SCHEMA_VERSION, activeProfileId: "ghost", profiles: [] }));
    expect(result.state.activeProfileId).toBeNull();
    expect(result.state.profiles).toEqual([]);
  });

  it("a name longer than the cap is truncated, never rejected", () => {
    const { result } = load(withProfile({ name: "x".repeat(400) }));
    expect(result.state.profiles[0]?.name.length).toBe(24);
  });

  it("the ship you fly is always unlocked, whatever the payload claims", () => {
    const { result } = load(withProfile({ shipId: "ship-4", unlockedShips: ["ship-1"] }));
    expect(result.state.profiles[0]?.unlockedShips).toEqual(["ship-4", "ship-1"]);
  });

  it("a missing version is treated as v1 and migrated", () => {
    const payload = v1Payload();
    delete payload["version"];
    const { result } = load(JSON.stringify(payload));
    expectUsable(result);
    expect(result.migrated).toBe(true);
    expect(result.notices.map((x) => x.code)).toContain("repaired");
  });
});

/** Every number anywhere in the tree is finite. NaN and +/-Infinity both fail. */
export function expectAllFinite(value: unknown, path = "$"): void {
  if (typeof value === "number") {
    expect(Number.isFinite(value), `${path} is ${value}`).toBe(true);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    expectAllFinite(v, `${path}.${k}`);
  }
}

/** `{"a":{"a":{...}}}` nested `depth` deep - JSON.parse handles it, we must too. */
function nest(depth: number): string {
  let s = '"leaf"';
  for (let i = 0; i < depth; i += 1) s = `{"a":${s}}`;
  return s;
}
