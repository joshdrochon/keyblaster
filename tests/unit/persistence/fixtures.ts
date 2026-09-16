import type { Clock, StoragePort } from "@engine/persistence/index.js";
import {
  SCHEMA_VERSION,
  blankProfile,
  encodeState,
} from "@engine/persistence/index.js";
import type { Profile, WordRecord } from "@engine/types.js";

/**
 * In-memory StoragePort. The lane brief forbids localStorage in the engine, so
 * this fake IS the storage under test - every corruption case in the AC-18.4
 * suite is just a string put in here.
 */
export class FakeStorage implements StoragePort {
  readonly map = new Map<string, string>();
  /** Set to make getItem throw, like a hostile extension or a locked-down iframe. */
  getThrows = false;
  /** Set to make setItem throw, like a full quota or Safari private mode. */
  setThrows: string | null = null;
  setCalls = 0;

  constructor(initial?: Record<string, string>) {
    for (const [k, v] of Object.entries(initial ?? {})) this.map.set(k, v);
  }

  getItem(key: string): string | null {
    if (this.getThrows) throw new Error("SecurityError: storage disabled");
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.setCalls += 1;
    if (this.setThrows !== null) throw new Error(this.setThrows);
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/**
 * Deterministic clock + timer queue. `advance` is the only thing that moves
 * time, so a 250 ms debounce is tested exactly rather than with a real wait.
 */
export class FakeClock implements Clock {
  private t: number;
  private nextId = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();

  constructor(start = 1_000_000) {
    this.t = start;
  }

  now(): number {
    return this.t;
  }

  schedule(callback: () => void, delayMs: number): () => void {
    const id = this.nextId++;
    this.timers.set(id, { at: this.t + delayMs, fn: callback });
    return () => {
      this.timers.delete(id);
    };
  }

  /** Move time forward, firing everything due, in time order. */
  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      let due: [number, { at: number; fn: () => void }] | null = null;
      for (const entry of this.timers.entries()) {
        if (entry[1].at <= target && (due === null || entry[1].at < due[1].at)) due = entry;
      }
      if (due === null) break;
      this.timers.delete(due[0]);
      this.t = due[1].at;
      due[1].fn();
    }
    this.t = target;
  }

  get pending(): number {
    return this.timers.size;
  }
}

export function wordRecord(over: Partial<WordRecord> = {}): WordRecord {
  return {
    exposures: 4,
    hits: 3,
    misses: 1,
    typos: 2,
    fkLatencyMs: [510, 480, 455],
    ikiMs: [300, 290, 310],
    firstFkLatencyMs: 640,
    ease: 1.35,
    lastSeen: 1_700_000_000_000,
    nextEligibleStage: 3,
    ...over,
  };
}

/** A profile with real progress and a populated word book in all three langs. */
export function populatedProfile(id = "p1"): Profile {
  const profile = blankProfile({ id, createdAt: 1_700_000_000_000, name: "Ada", avatar: "avatar-3" });
  profile.progress = profile.progress.map((p, i) =>
    i === 0 || i === 1
      ? {
          ...p,
          cleared: true,
          stars: 3,
          bestWpm: 22.5,
          bestAccuracy: 0.94,
          lastWpm: 21,
          lastAccuracy: 0.91,
          beaconPlacedAt: 1_700_000_100_000,
        }
      : p,
  );
  profile.trophies = ["first-light", "pathfinder"];
  profile.unlockedSkins = ["ember"];
  profile.words = {
    en: {
      moon: wordRecord(),
      star: wordRecord({ exposures: 1, hits: 1, misses: 0, firstFkLatencyMs: null, ease: 1.6 }),
      comet: wordRecord({ fkLatencyMs: [], ikiMs: [], lastSeen: null }),
    },
    es: { luna: wordRecord({ exposures: 9 }) },
    hi: { घर: wordRecord({ exposures: 2 }) },
  };
  return profile;
}

/** The exact bytes the store would write for these profiles. */
export function storedPayload(profiles: Profile[], activeProfileId: string | null): string {
  return JSON.stringify(encodeState({ version: SCHEMA_VERSION, profiles, activeProfileId }));
}

/**
 * A v1 payload, hand-built. v1 predates WordRecord.firstFkLatencyMs and
 * StopProgress.lastWpm/lastAccuracy, so those keys are ABSENT here - that
 * absence is what the v1 -> v2 migration test is actually testing.
 */
export function v1Payload(): Record<string, unknown> {
  return {
    version: 1,
    activeProfileId: "old-1",
    profiles: [
      {
        id: "old-1",
        name: "Rey",
        avatar: "avatar-2",
        shipId: "ship-1",
        shipName: "Lantern",
        createdAt: 1_600_000_000_000,
        calibration: { ikiMs: 320, fkLatencyMs: 610 },
        settings: {
          musicVolume: 0.5,
          sfxVolume: 0.9,
          keyboardLayout: "azerty",
          uiLang: "es",
          contentLang: "es",
          inputMethod: "latin",
          uppercase: true,
          increasedLetterSpacing: true,
          reducedMotion: false,
          colorblindPalette: false,
          relativeBoard: true,
        },
        progress: [
          { stopId: "earth", cleared: true, stars: 3, bestWpm: 18, bestAccuracy: 0.97, beaconPlacedAt: 1 },
          { stopId: "mars", cleared: true, stars: 2, bestWpm: 25, bestAccuracy: 0.88, beaconPlacedAt: null },
        ],
        trophies: ["first-light"],
        unlockedShips: ["ship-1"],
        unlockedSkins: [],
        words: {
          en: {
            // Under the sample cap: the first sample IS the first exposure.
            moon: {
              exposures: 3,
              hits: 3,
              misses: 0,
              typos: 0,
              fkLatencyMs: [700, 650, 600],
              ikiMs: [340, 330],
              ease: 1.4,
              lastSeen: 1_600_000_100_000,
              nextEligibleStage: 2,
            },
            // Past the cap: the window can no longer hold the first exposure.
            star: {
              exposures: 40,
              hits: 38,
              misses: 2,
              typos: 5,
              fkLatencyMs: [420, 410, 400],
              ikiMs: [280],
              ease: 0.9,
              lastSeen: 1_600_000_200_000,
              nextEligibleStage: 6,
            },
          },
        },
      },
    ],
  };
}
