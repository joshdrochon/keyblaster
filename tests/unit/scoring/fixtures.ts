import type { Profile, StopId, StopProgress, WordRecord } from "@engine/types.js";
import { DEFAULT_CALIBRATION, DEFAULT_SETTINGS, EASE_NEW } from "@engine/types.js";

/**
 * Fixture builders. The scoring module is pure, so every test is "given this
 * profile and these exposures", and these keep that setup to one line.
 */

export function wordRecord(over: Partial<WordRecord> = {}): WordRecord {
  return {
    exposures: 1,
    hits: 1,
    misses: 0,
    typos: 0,
    fkLatencyMs: [],
    ikiMs: [],
    ease: EASE_NEW,
    lastSeen: null,
    nextEligibleStage: 0,
    ...over,
  };
}

export function stopProgress(
  stopId: StopId,
  over: Partial<StopProgress> = {},
): StopProgress {
  return {
    stopId,
    cleared: true,
    stars: 3,
    bestWpm: 0,
    bestAccuracy: 0,
    beaconPlacedAt: null,
    ...over,
  };
}

export function profile(progress: StopProgress[] = []): Profile {
  return {
    id: "p1",
    name: "Pilot",
    avatar: "a1",
    shipId: "lantern",
    shipName: "Lantern",
    createdAt: 0,
    calibration: DEFAULT_CALIBRATION,
    settings: DEFAULT_SETTINGS,
    progress,
    trophies: [],
    unlockedShips: [],
    unlockedSkins: [],
    words: {},
  };
}

/**
 * mulberry32. Fixed-seed PRNG for the simulation tests - the lane brief bans
 * Math.random in tests so a failure is always reproducible.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
