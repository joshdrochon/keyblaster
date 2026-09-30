import {
  BONUS_STOP_IDS,
  isBonusStop,
  type Profile,
  ROUTE_STOP_IDS,
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

/**
 * A stop is charted once it is CLEARED and its beacon is placed (D13).
 *
 * BOTH HALVES, and the null check is `!= null` rather than `!== null`, because
 * of this defect: the Director map's header counted `isCharted` while its
 * labels and discs read `unlockedStops`, which reads `cleared`. An entry that
 * carried one field and not the other - anything written by something other
 * than `markStopCleared` - lit a lamp over a disc labelled "Locked". At seven
 * of seven that told a child who had finished the game that it was locked.
 *
 * `markStopCleared` sets both together, so requiring both costs a real record
 * nothing and makes a malformed one fail CLOSED (dark and locked, which is at
 * least a state that exists) instead of contradicting itself on screen.
 */
export function isCharted(progress: readonly StopProgress[], stopId: StopId): boolean {
  const entry = progress.find((p) => p.stopId === stopId);
  return entry !== undefined && entry.cleared === true && entry.beaconPlacedAt != null;
}

/** One stop as a screen should draw it. */
export interface StopView {
  readonly stopId: StopId;
  readonly cleared: boolean;
  /** Beacon lit: the lamp, the lit disc, the route segment, the header count. */
  readonly charted: boolean;
  /** "Not yet" - never "denied" (D31). Drawn, dimmed, and still focusable. */
  readonly locked: boolean;
  readonly stars: Stars;
}

/**
 * THE ONE DERIVATION EVERY MAP-LIKE SCREEN READS.
 *
 * The header, the disc, the label, the lamp and the route line were five
 * readers asking two different questions of the same array. They are one
 * question now: a screen calls `routeView` once and draws what it says, so
 * "4 of 7 lit" and the label under the fourth planet cannot disagree, whatever
 * the array underneath looks like.
 */
export function routeView(
  progress: readonly StopProgress[],
  order: readonly StopId[] = STOP_IDS,
): readonly StopView[] {
  const open = unlockedStops(progress, order);
  return order.map((stopId) => {
    const entry = progress.find((p) => p.stopId === stopId);
    const charted = isCharted(progress, stopId);
    return {
      stopId,
      cleared: entry?.cleared === true,
      charted,
      // A lit beacon is by definition a stop the player has flown, so it can
      // never be locked. Stated here rather than trusted of `unlockedStops`.
      locked: !charted && !open.has(stopId),
      stars: entry?.stars ?? 0,
    };
  });
}

/**
 * Beacons lit ON THE MAIN ROUTE, for the map header.
 *
 * The bonus pair is deliberately not counted. "7 of 9" would tell a child who
 * has just finished the whole story that they are two short of something, and
 * the bonus stops do not exist for them until Pluto is lit.
 */
export function litCount(progress: readonly StopProgress[]): number {
  return routeView(progress).filter((s) => s.charted && !isBonusStop(s.stopId)).length;
}

/** Beacons lit on the bonus pair, once it exists. */
export function bonusLitCount(progress: readonly StopProgress[]): number {
  return BONUS_STOP_IDS.filter((id) => isCharted(progress, id)).length;
}

/**
 * Whether the inner run is reachable at all: Pluto lit.
 *
 * The map asks this before it draws the doorway at Earth, so a player who has
 * not finished the route is not shown a route they cannot fly.
 */
export function bonusUnlocked(progress: readonly StopProgress[]): boolean {
  return routeComplete(progress);
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

/**
 * The MAIN ROUTE charted (D80's Map Maker, and the ending card).
 *
 * Earth through Pluto, not the bonus pair. The ending fires here and the Map
 * Maker trophy is earned here; gating either on Venus and Mercury would make
 * the story's last beat conditional on optional content.
 */
export function routeComplete(progress: readonly StopProgress[]): boolean {
  return ROUTE_STOP_IDS.every((id) => isCharted(progress, id));
}

/** Both bonus beacons lit. The inner run's own completion. */
export function bonusComplete(progress: readonly StopProgress[]): boolean {
  return BONUS_STOP_IDS.every((id) => isCharted(progress, id));
}

/** Apply a clear to a whole profile, for the store's `updateProfile`. */
export function clearStopOnProfile(
  profile: Profile,
  stopId: StopId,
  input: ClearInput,
): Profile {
  return { ...profile, progress: markStopCleared(profile.progress, stopId, input) };
}
