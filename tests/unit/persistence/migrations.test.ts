import { describe, expect, it } from "vitest";
import {
  MIGRATIONS,
  OLDEST_SUPPORTED_VERSION,
  SCHEMA_VERSION,
  STORAGE_KEY,
  blankProfile,
  inferFirstFkLatency,
  loadState,
  migrateToCurrent,
} from "@engine/persistence/index.js";
import { SAMPLE_CAP } from "@engine/words/index.js";
import { DEFAULT_KNOBS } from "@engine/controller/index.js";
import { FakeStorage, v1Payload } from "./fixtures.js";

const freshProfile = () => blankProfile({ id: "fresh", createdAt: 0 });

function loadRaw(payload: unknown) {
  const storage = new FakeStorage({ [STORAGE_KEY]: JSON.stringify(payload) });
  return loadState(storage, { freshProfile });
}

describe("the migration chain", () => {
  it("has a link for every version between the oldest supported and current", () => {
    // The guard that makes "adding v3 is one function" true: bump
    // SCHEMA_VERSION without writing the migration and this goes red.
    for (let v = OLDEST_SUPPORTED_VERSION; v < SCHEMA_VERSION; v += 1) {
      expect(MIGRATIONS[v], `no migration from v${v}`).toBeTypeOf("function");
    }
  });

  it("is a no-op for a payload already at the current version", () => {
    const payload = { version: SCHEMA_VERSION, profiles: [], activeProfileId: null };
    const out = migrateToCurrent(payload, SCHEMA_VERSION);
    expect(out.ok).toBe(true);
    expect(out.applied).toEqual([]);
    expect(out.payload).toBe(payload);
  });

  it("refuses a version below the oldest supported rather than guessing", () => {
    expect(migrateToCurrent({}, 0).ok).toBe(false);
    expect(migrateToCurrent({}, -3).ok).toBe(false);
    expect(migrateToCurrent({}, 1.5).ok).toBe(false);
    expect(migrateToCurrent({}, Number.NaN).ok).toBe(false);
  });

  it("reports the versions it applied, in order", () => {
    // UR-51 added v3 (`Profile.knobs`), so the chain a v1 payload walks is now
    // two links. `applied` is keyed by the version each migration upgrades
    // FROM, which is why it reads [1, 2] and not [2, 3].
    const out = migrateToCurrent(v1Payload(), 1);
    expect(out.ok).toBe(true);
    expect(out.applied).toEqual([1, 2]);
    expect(out.payload["version"]).toBe(SCHEMA_VERSION);
    expect(out.payload["version"]).toBe(3);
  });

  it("UR-51: v3 gives every migrated profile the cold-start knob, and no other", () => {
    // THE WHOLE POINT OF THE MIGRATION, and the thing it deliberately does NOT
    // do: it does not infer a difficulty from `progress`. A v1 payload has no
    // rolling hit rate in it (D53), and D18 says difficulty rises only as a
    // player is watched getting better - so a child returning with six stops
    // cleared opens at the floor and climbs like everyone else. That costs them
    // a few stages of ramp and cannot hurt anybody, which is the right way
    // round for a migration.
    //
    // WATCHED FAILING, with the real number: drop `2: v2ToV3` from MIGRATIONS
    // and `ok` reads false with `applied` [1] - the payload never reaches v3 and
    // the load path replaces the child's profile with a fresh one.
    const out = migrateToCurrent(v1Payload(), 1);
    const profiles = out.payload["profiles"] as Record<string, unknown>[];
    expect(profiles.length).toBeGreaterThan(0);
    for (const profile of profiles) {
      expect(profile["knobs"]).toEqual(DEFAULT_KNOBS);
    }
  });

  it("UR-51: v3 leaves a knob that is already there alone", () => {
    // A payload written by this build and re-migrated must not have an earned
    // difficulty reset to the floor by the upgrade path.
    const earned = { maxLive: 6, lengthBias: -1 };
    const out = migrateToCurrent(
      { version: 2, activeProfileId: "p", profiles: [{ id: "p", knobs: earned }] },
      2,
    );
    expect(out.ok).toBe(true);
    expect((out.payload["profiles"] as Record<string, unknown>[])[0]!["knobs"]).toEqual(earned);
  });

  it("UR-51: v3 survives a payload whose profiles list is not a list", () => {
    // Every link has to assume nothing: a migration that throws on a
    // half-corrupt payload is another way to crash on load, which AC-18.4
    // forbids. This is the v3 link's own version of the sweep below, entered at
    // v2 so it is that link and not v1's that handles it.
    const out = migrateToCurrent({ version: 2, profiles: "nope" }, 2);
    expect(out.ok).toBe(true);
    expect(out.payload["profiles"]).toEqual([]);
  });

  it("never throws on a half-corrupt payload at any link", () => {
    const junk: unknown[] = [
      { version: 1 },
      { version: 1, profiles: "nope" },
      { version: 1, profiles: [null, 3, "x", []] },
      { version: 1, profiles: [{ progress: 7, words: 9 }] },
      { version: 1, profiles: [{ progress: [null, 1], words: { en: 4, es: { a: 1 } } }] },
    ];
    for (const payload of junk) {
      expect(() => migrateToCurrent(payload as Record<string, unknown>, 1)).not.toThrow();
    }
  });
});

describe("AC-18.4: a v1 payload still loads after v2 exists", () => {
  it("AC-18.4: migrates v1 -> current and keeps every v1 field", () => {
    const result = loadRaw(v1Payload());
    expect(result.fresh).toBe(false);
    expect(result.migrated).toBe(true);
    expect(result.loadedVersion).toBe(1);
    expect(result.state.version).toBe(SCHEMA_VERSION);
    expect(result.notices.map((n) => n.code)).toContain("migrated");
    // The write-back is scheduled so the upgrade sticks.
    expect(result.dirty).toBe(true);

    const p = result.state.profiles[0];
    expect(p?.id).toBe("old-1");
    expect(p?.name).toBe("Rey");
    expect(p?.settings.keyboardLayout).toBe("azerty");
    expect(p?.settings.uiLang).toBe("es");
    expect(p?.calibration).toEqual({ ikiMs: 320, fkLatencyMs: 610 });
    expect(p?.trophies).toEqual(["first-light"]);
    expect(p?.words["en"]?.["moon"]?.exposures).toBe(3);
    expect(p?.words["en"]?.["star"]?.ease).toBe(0.9);
  });

  it("AC-20.1: v1 stops gain lastWpm/lastAccuracy seeded from their bests", () => {
    const p = loadRaw(v1Payload()).state.profiles[0];
    const mars = p?.progress.find((s) => s.stopId === "mars");
    expect(mars?.bestWpm).toBe(25);
    expect(mars?.lastWpm).toBe(25);
    expect(mars?.bestAccuracy).toBe(0.88);
    expect(mars?.lastAccuracy).toBe(0.88);
    // Stops v1 never recorded are filled in blank, not dropped.
    expect(p?.progress.find((s) => s.stopId === "pluto")?.lastWpm).toBe(0);
  });

  it("AC-20.3: v1 words gain firstFkLatencyMs only where the window can prove it", () => {
    const en = loadRaw(v1Payload()).state.profiles[0]?.words["en"];
    // 3 exposures, 3 samples: the first sample IS the first exposure.
    expect(en?.["moon"]?.firstFkLatencyMs).toBe(700);
    // 40 exposures: the capped window evicted the first exposure long ago, so
    // types.ts says fkLatencyMs[0] is NOT it. Null beats a fabricated baseline.
    expect(en?.["star"]?.firstFkLatencyMs).toBeNull();
  });

  it("a migrated payload re-migrated is unchanged (the chain is idempotent at the head)", () => {
    const once = migrateToCurrent(v1Payload(), 1).payload;
    const twice = migrateToCurrent(once, SCHEMA_VERSION).payload;
    expect(twice).toEqual(once);
  });
});

describe("inferFirstFkLatency", () => {
  it("returns null when there are no samples", () => {
    expect(inferFirstFkLatency({})).toBeNull();
    expect(inferFirstFkLatency({ fkLatencyMs: [] })).toBeNull();
    expect(inferFirstFkLatency({ fkLatencyMs: "nope" })).toBeNull();
  });
  it("returns null for a non-finite first sample", () => {
    expect(inferFirstFkLatency({ fkLatencyMs: [Number.POSITIVE_INFINITY, 300] })).toBeNull();
    expect(inferFirstFkLatency({ fkLatencyMs: ["300"] })).toBeNull();
  });
  it("trusts the window exactly up to the cap and not one exposure past it", () => {
    expect(inferFirstFkLatency({ fkLatencyMs: [500], exposures: SAMPLE_CAP })).toBe(500);
    expect(inferFirstFkLatency({ fkLatencyMs: [500], exposures: SAMPLE_CAP + 1 })).toBeNull();
  });
  it("falls back to the sample count when exposures is missing or junk", () => {
    expect(inferFirstFkLatency({ fkLatencyMs: [500, 400] })).toBe(500);
    expect(inferFirstFkLatency({ fkLatencyMs: [500], exposures: "many" })).toBe(500);
  });
  it("leaves an existing firstFkLatencyMs alone", () => {
    const payload = v1Payload();
    const profiles = payload["profiles"] as Array<Record<string, unknown>>;
    const en = (profiles[0]?.["words"] as Record<string, Record<string, Record<string, unknown>>>)["en"];
    if (en?.["star"] !== undefined) en["star"]["firstFkLatencyMs"] = 999;
    const out = migrateToCurrent(payload, 1);
    const migrated = out.payload["profiles"] as Array<Record<string, unknown>>;
    const words = migrated[0]?.["words"] as Record<string, Record<string, Record<string, unknown>>>;
    expect(words["en"]?.["star"]?.["firstFkLatencyMs"]).toBe(999);
  });
});
