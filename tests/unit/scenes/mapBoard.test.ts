/**
 * The Director map's personal-best line, driven with the values the STORE
 * holds rather than the values the fixtures inject.
 *
 * P2d, "untested by construction". Every map test in the repo hands the scene
 * percent-scale progress as `Scene.init` data — `tests/e2e/story-lane.charted`
 * defaults `bestAccuracy = 96`, `pointer.spec` and `default-focus.spec` pass 95
 * — which never touches the persistence schema. The one helper that DOES go
 * through the real store (`tests/e2e/lib/menus.seed`) sets `cleared: true` and
 * leaves `bestWpm` and `bestAccuracy` at their blank zero, so it renders no
 * rates at all. Between them, no test ever put a REAL accuracy on the map.
 *
 * So the whole file starts from the engine and ends at the string: accuracy is
 * computed by `@engine/scoring`, stored by `@engine/progress`, round-tripped
 * through `persistence/schema` (which clamps the field to [0, 1], proving the
 * scale), and only then formatted.
 */

import { describe, expect, it } from "vitest";
import { accuracy } from "@engine/scoring/index.js";
import { blankStopProgress, markStopCleared } from "@engine/progress/index.js";
import { blankProfile, decodeProfile, newRepairLog } from "@engine/persistence/index.js";
import { STOP_IDS, type StopId, type StopProgress } from "@engine/types";
import { accuracyPercent, hasPersonalBest, mapBoardLine } from "@game/scenes/support/mapBoard";

/** Renders `{key}:{params}` so the assertions read the substituted numbers. */
const T = {
  text(key: string, params?: Record<string, string | number>): string {
    const suffix =
      params === undefined
        ? ""
        : Object.entries(params)
            .map(([k, v]) => `${k}=${String(v)}`)
            .join(",");
    return suffix === "" ? key : `${key}[${suffix}]`;
  },
};

function progressFor(list: readonly StopProgress[], stop: StopId): StopProgress {
  return list.find((p) => p.stopId === stop) ?? blankStopProgress(stop);
}

describe("Director map personal best, on the scale the store actually holds", () => {
  it("accuracy leaves @engine/scoring as a fraction, not a percentage", () => {
    // The premise. If this ever changes, every assertion below is about the
    // wrong thing and should be rewritten rather than adjusted.
    expect(accuracy(97, 3)).toBeCloseTo(0.97, 5);
    expect(accuracy(100, 0)).toBe(1);
  });

  it("the persistence schema clamps bestAccuracy to [0,1], which fixes the scale", () => {
    // A percentage cannot survive a save. This is what makes the fixtures'
    // `bestAccuracy: 96` a value the shipped game can never produce.
    const stored = blankProfile({ id: "p1", createdAt: 0 });
    const roundTripped = decodeProfile(
      {
        ...stored,
        progress: [{ ...blankStopProgress("mars"), cleared: true, bestAccuracy: 96, bestWpm: 26 }],
      },
      newRepairLog(),
      "profile",
    );
    expect(roundTripped).not.toBeNull();
    expect(progressFor(roundTripped!.progress, "mars").bestAccuracy).toBeLessThanOrEqual(1);
  });

  it("a 97% run on Mars renders as 97%, not 1%", () => {
    const rate = accuracy(97, 3);
    const progress = markStopCleared(STOP_IDS.map(blankStopProgress), "mars", {
      atMs: 1_700_000_000_000,
      stars: 3,
      wpm: 26,
      accuracy: rate,
    });
    const line = mapBoardLine(progressFor(progress, "mars"), "mars", T);
    expect(line).toContain("accuracy=97");
    expect(line).not.toContain("accuracy=1]");
    expect(line).toContain("wpm=26");
  });

  it.each([
    [1, 100],
    [0.98, 98],
    [0.97, 97],
    [0.9, 90],
    [0.455, 46],
    [0, 0],
  ])("a stored %s renders as %i%%", (stored, shown) => {
    expect(accuracyPercent(stored)).toBe(shown);
  });

  it("every belt stop the player has cleared shows its own accuracy", () => {
    // The fixtures only ever drive Mars and a mid-run trio. A full 7/7 profile
    // with seven different real rates is a state no map test has rendered.
    let progress = STOP_IDS.map(blankStopProgress);
    const expected = new Map<StopId, number>();
    STOP_IDS.forEach((stop, i) => {
      const rate = accuracy(90 + i, 10 - i);
      expected.set(stop, 90 + i);
      progress = markStopCleared(progress, stop, {
        atMs: 1_700_000_000_000,
        stars: 3,
        wpm: 20 + i,
        accuracy: rate,
      });
    });
    for (const stop of STOP_IDS) {
      const entry = progressFor(progress, stop);
      const line = mapBoardLine(entry, stop, T);
      if (!hasPersonalBest(entry, stop)) continue;
      expect(line, `${stop} board line`).toContain(`accuracy=${expected.get(stop)!}`);
    }
  });

  it("Earth never claims a personal best — it has no belt (D57)", () => {
    const progress = markStopCleared(STOP_IDS.map(blankStopProgress), "earth", {
      atMs: 1_700_000_000_000,
      stars: 3,
    });
    expect(hasPersonalBest(progressFor(progress, "earth"), "earth")).toBe(false);
  });

  it("and says NOTHING there rather than 'no run yet' — nothing is pending", () => {
    // The launchpad is not a belt the child has failed to fly; it is not a
    // belt. A placeholder reads as something missing, so Earth gets a blank.
    const progress = markStopCleared(STOP_IDS.map(blankStopProgress), "earth", {
      atMs: 1_700_000_000_000,
      stars: 3,
    });
    expect(mapBoardLine(progressFor(progress, "earth"), "earth", T)).toBe("");
    expect(mapBoardLine(blankStopProgress("earth"), "earth", T)).toBe("");
  });

  it("an uncleared stop shows no rates", () => {
    expect(mapBoardLine(blankStopProgress("pluto"), "pluto", T)).toBe("map.noRunYet");
  });
});
