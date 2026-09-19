/**
 * The Director map's personal-best line, as a pure function of a StopProgress.
 *
 * Extracted from `DirectorMapScene.select` so it can be driven with the values
 * the STORE actually holds rather than the values the e2e fixtures inject.
 *
 * WHY THIS FILE EXISTS. `StopProgress.bestAccuracy` is a 0..1 fraction at every
 * producer and at rest: `@engine/scoring/rates.accuracy` returns a fraction,
 * `@engine/progress.markStopCleared` stores what it is given, and
 * `persistence/schema` clamps the field to [0, 1] on load. `ResultsScene`
 * formats it as `accuracy * 100`. The map did not, so a 97% run rendered as
 * "1% accurate" — and every map fixture in the suite injects percent-scale
 * progress straight into `Scene.init` (`tests/e2e/story-lane.charted` passes
 * `bestAccuracy = 96`), bypassing the schema entirely, while the store-level
 * seed helper sets `cleared` and leaves the rates at 0. No test in the repo
 * ever joined the two, so the map was green on a scale the game never stores.
 */

import { isBeltStop, type StopId, type StopProgress } from "@engine/types";

/** The slice of the story lane's translator this line needs. */
export interface MapBoardText {
  text(key: string, params?: Record<string, string | number>): string;
}

/**
 * True when this stop has rates worth showing. Earth has no belt (D57), so it
 * has no WPM and no accuracy to be best at.
 */
export function hasPersonalBest(entry: StopProgress, stop: StopId): boolean {
  return entry.cleared && isBeltStop(stop);
}

/** `bestAccuracy` is a fraction; the string is a percentage. */
export function accuracyPercent(bestAccuracy: number): number {
  return Math.round(bestAccuracy * 100);
}

export function mapBoardLine(entry: StopProgress, stop: StopId, t: MapBoardText): string {
  // Earth is the launchpad and has no belt (D57), so there is no run it is
  // waiting for. "No run yet" reads as something missing, which is why it was
  // wrong there and right on a belt stop the child simply has not flown.
  // An empty line rather than a placeholder: nothing is pending.
  if (!isBeltStop(stop)) return "";
  if (!hasPersonalBest(entry, stop)) return t.text("map.noRunYet");
  return (
    `${t.text("map.personalBest")}  ·  ` +
    `${t.text("map.bestWpm", { wpm: Math.round(entry.bestWpm) })}  ·  ` +
    `${t.text("map.bestAccuracy", { accuracy: accuracyPercent(entry.bestAccuracy) })}`
  );
}
