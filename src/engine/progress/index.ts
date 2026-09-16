import {
  type Profile,
  type Stars,
  type StopId,
  STOP_IDS,
  type StopProgress,
} from "../types.js";

/**
 * Route progression (D13, D56, D57; PRD AC-12.1, AC-17.3, FR-18).
 *
 * WHY THIS MODULE EXISTS. Nothing in the build ever set `StopProgress.cleared`.
 * Every scene threaded a `progress` array through its init payload and handed
 * it onward UNCHANGED, so no stop was ever recorded as cleared, the Director
 * map's unlock rule never opened the next stop, and the player bounced between
 * the map and Earth forever. Twenty-two scene tests passed: each one checked
 * that its own screen advanced, and none checked that the world had MOVED.
 *
 * The rule belongs in the engine, not in a scene: it is pure, it is the thing
 * that makes the route a route, and in `src/engine` it sits under the 95%
 * coverage gate instead of the untested `src/game`.
 */

/** A stop the player has not reached yet. */
export function blankStopProgress(stopId: StopId): StopProgress {
  return {
    stopId,
    cleared: false,
    stars: 0,
    bestWpm: 0,
    bestAccuracy: 0,
    lastWpm: 0,
    lastAccuracy: 0,
    beaconPlacedAt: null,
  };
}

export interface ClearInput {
  /** Epoch ms the beacon was placed. The caller owns the clock. */
  readonly atMs: number;
  readonly stars?: Stars;
  readonly wpm?: number;
  readonly accuracy?: number;
}

/**
 * Record a stop as cleared and its beacon as placed.
 *
 * Bests only ever move UP (D50: the results screen compares against a personal
 * best, and a worse run must not erase a better one), while `last*` always
 * takes the run just finished, because AC-20.1's delta is against the previous
 * STAGE RESULT, not the previous best.
 *
 * Idempotent: clearing an already-cleared stop keeps the earlier
 * `beaconPlacedAt`, so replaying Mars does not rewrite the date on its beacon.
 */
export function markStopCleared(
  progress: readonly StopProgress[],
  stopId: StopId,
  input: ClearInput,
): StopProgress[] {
  const existing = progress.find((p) => p.stopId === stopId) ?? blankStopProgress(stopId);
  const wpm = input.wpm ?? existing.lastWpm;
  const accuracy = input.accuracy ?? existing.lastAccuracy;

  const updated: StopProgress = {
    ...existing,
    cleared: true,
    stars: input.stars ?? existing.stars,
    bestWpm: Math.max(existing.bestWpm, wpm),
    bestAccuracy: Math.max(existing.bestAccuracy, accuracy),
    lastWpm: wpm,
    lastAccuracy: accuracy,
    beaconPlacedAt: existing.beaconPlacedAt ?? input.atMs,
  };

  const next = progress.filter((p) => p.stopId !== stopId).concat(updated);
  // Keep route order so the map and the Beacon Log can render the array as-is.
  return STOP_IDS.map((id) => next.find((p) => p.stopId === id)).filter(
    (p): p is StopProgress => p !== undefined,
  );
}

/**
 * Stops the player may enter. The first stop is always open; every later one
 * opens when the stop BEFORE it is cleared (D56's route is a line).
 */
export function unlockedStops(
  progress: readonly StopProgress[],
  order: readonly StopId[] = STOP_IDS,
): ReadonlySet<StopId> {
  const open = new Set<StopId>();
  let previousCleared = true;
  for (const stop of order) {
    if (previousCleared) open.add(stop);
    previousCleared = progress.find((p) => p.stopId === stop)?.cleared ?? false;
  }
  return open;
}

/** A stop is charted once its beacon is placed (D13). */
export function isCharted(progress: readonly StopProgress[], stopId: StopId): boolean {
  const entry = progress.find((p) => p.stopId === stopId);
  return entry !== undefined && entry.beaconPlacedAt !== null;
}

/**
 * The next stop the player should fly, or null when the route is finished.
 * This is what the Director map focuses on entry, and it is why Earth stops
 * being the answer the moment its beacon is lit.
 */
export function nextStop(progress: readonly StopProgress[]): StopId | null {
  const open = unlockedStops(progress);
  for (const stop of STOP_IDS) {
    if (open.has(stop) && !(progress.find((p) => p.stopId === stop)?.cleared ?? false)) {
      return stop;
    }
  }
  return null;
}

/** Every stop charted (D80's Map Maker, and the ending card). */
export function routeComplete(progress: readonly StopProgress[]): boolean {
  return STOP_IDS.every((id) => isCharted(progress, id));
}

/** Apply a clear to a whole profile, for the store's `updateProfile`. */
export function clearStopOnProfile(
  profile: Profile,
  stopId: StopId,
  input: ClearInput,
): Profile {
  return { ...profile, progress: markStopCleared(profile.progress, stopId, input) };
}
