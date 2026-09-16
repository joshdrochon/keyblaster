import { describe, expect, it } from "vitest";
import {
  blankStopProgress,
  clearStopOnProfile,
  isCharted,
  markStopCleared,
  nextStop,
  routeComplete,
  unlockedStops,
} from "@engine/progress/index.js";
import { STOP_IDS, type Profile, type StopProgress } from "@engine/types.js";

const at = (n: number) => ({ atMs: n });

describe("AC-12.1 / D57: Earth clears and opens Mars", () => {
  it("THE REGRESSION: activating Earth must unlock Mars", () => {
    // The shipped build handed `progress` onward unchanged, so Earth was never
    // cleared, Mars never opened, and the map sent the player back to Earth
    // forever. Twenty-two scene tests passed while this was true, because each
    // checked that its own screen advanced and none checked the world moved.
    const start: StopProgress[] = [];
    expect(unlockedStops(start).has("mars")).toBe(false);

    const after = markStopCleared(start, "earth", at(1000));
    expect(unlockedStops(after).has("mars")).toBe(true);
    expect(after.find((p) => p.stopId === "earth")?.cleared).toBe(true);
  });

  it("the next stop stops being Earth once Earth is lit", () => {
    expect(nextStop([])).toBe("earth");
    expect(nextStop(markStopCleared([], "earth", at(1)))).toBe("mars");
  });

  it("charts Earth by placing its beacon", () => {
    expect(isCharted([], "earth")).toBe(false);
    expect(isCharted(markStopCleared([], "earth", at(5)), "earth")).toBe(true);
  });
});

describe("unlocking follows the route in order (D56)", () => {
  it("opens exactly one stop ahead of the furthest cleared", () => {
    let p: StopProgress[] = [];
    expect([...unlockedStops(p)]).toEqual(["earth"]);
    p = markStopCleared(p, "earth", at(1));
    expect([...unlockedStops(p)].sort()).toEqual(["earth", "mars"].sort());
    p = markStopCleared(p, "mars", at(2));
    expect(unlockedStops(p).has("jupiter")).toBe(true);
    expect(unlockedStops(p).has("saturn")).toBe(false);
  });

  it("clearing out of order does not open a stop whose predecessor is unfinished", () => {
    const p = markStopCleared([], "saturn", at(1));
    expect(unlockedStops(p).has("uranus")).toBe(true); // saturn cleared
    expect(unlockedStops(p).has("mars")).toBe(false); // earth still not cleared
  });

  it("walks the whole route to Pluto", () => {
    let p: StopProgress[] = [];
    for (const stop of STOP_IDS) {
      expect(unlockedStops(p).has(stop), `${stop} should be open`).toBe(true);
      p = markStopCleared(p, stop, at(1));
    }
    expect(nextStop(p)).toBeNull();
    expect(routeComplete(p)).toBe(true);
  });
});

describe("bests move up, last takes the run (D50, AC-20.1)", () => {
  it("keeps the better wpm and accuracy but records the latest", () => {
    let p = markStopCleared([], "mars", { atMs: 1, wpm: 40, accuracy: 0.9 });
    p = markStopCleared(p, "mars", { atMs: 2, wpm: 25, accuracy: 0.7 });
    const mars = p.find((x) => x.stopId === "mars")!;
    expect(mars.bestWpm).toBe(40);
    expect(mars.bestAccuracy).toBeCloseTo(0.9, 10);
    expect(mars.lastWpm).toBe(25);
    expect(mars.lastAccuracy).toBeCloseTo(0.7, 10);
  });

  it("is idempotent about the beacon date - a replay does not rewrite it", () => {
    let p = markStopCleared([], "mars", at(1000));
    p = markStopCleared(p, "mars", at(9999));
    expect(p.find((x) => x.stopId === "mars")?.beaconPlacedAt).toBe(1000);
  });

  it("carries stars through and keeps the previous ones when not supplied", () => {
    let p = markStopCleared([], "mars", { atMs: 1, stars: 3 });
    expect(p.find((x) => x.stopId === "mars")?.stars).toBe(3);
    p = markStopCleared(p, "mars", at(2));
    expect(p.find((x) => x.stopId === "mars")?.stars).toBe(3);
  });
});

describe("shape and ordering", () => {
  it("returns the array in route order, whatever order stops were cleared", () => {
    let p = markStopCleared([], "pluto", at(1));
    p = markStopCleared(p, "earth", at(2));
    p = markStopCleared(p, "jupiter", at(3));
    expect(p.map((x) => x.stopId)).toEqual(["earth", "jupiter", "pluto"]);
  });

  it("never mutates the array it was given", () => {
    const start: StopProgress[] = [blankStopProgress("earth")];
    const snapshot = JSON.parse(JSON.stringify(start));
    markStopCleared(start, "earth", at(1));
    expect(start).toEqual(snapshot);
  });

  it("a blank stop is not cleared, not charted, and scores zero", () => {
    const b = blankStopProgress("mars");
    expect(b).toEqual({
      stopId: "mars", cleared: false, stars: 0, bestWpm: 0, bestAccuracy: 0,
      lastWpm: 0, lastAccuracy: 0, beaconPlacedAt: null,
    });
  });
});

describe("clearStopOnProfile", () => {
  const profile = (progress: StopProgress[]): Profile =>
    ({ id: "p", name: "Ada", avatar: "a", shipId: "coral", shipName: "Lantern",
       createdAt: 0, calibration: { ikiMs: 350, fkLatencyMs: 500 },
       settings: {} as Profile["settings"], progress, trophies: [],
       unlockedShips: [], unlockedSkins: [], words: {} }) as Profile;

  it("clears the stop on the profile without touching anything else", () => {
    const before = profile([]);
    const after = clearStopOnProfile(before, "earth", at(7));
    expect(after.progress.find((p) => p.stopId === "earth")?.cleared).toBe(true);
    expect(after.name).toBe("Ada");
    expect(before.progress).toEqual([]);
  });
});
