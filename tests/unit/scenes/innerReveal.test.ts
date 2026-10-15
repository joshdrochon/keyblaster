import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DOORWAY_REVEAL_MS,
  INNER_LINE_MS,
  doorwayRevealScale,
} from "@game/scenes/support/mapLayout";
import { bonusLitCount, bonusUnlocked } from "@engine/progress/index.js";
import { ROUTE_STOP_IDS, type StopId, type StopProgress } from "@engine/types.js";

const charted = (stopId: StopId): StopProgress => ({
  stopId,
  cleared: true,
  stars: 3,
  bestWpm: 14,
  bestAccuracy: 92,
  lastWpm: 14,
  lastAccuracy: 92,
  beaconPlacedAt: 1,
});

/** The condition DirectorMapScene announces the inner run on (AC-27.7). */
const reveals = (progress: readonly StopProgress[]): boolean =>
  bonusUnlocked(progress) && bonusLitCount(progress) === 0;

describe("AC-27.7: the inner run announces itself", () => {
  it("the caret is absent until the line ends, then reaches full size", () => {
    expect(doorwayRevealScale(-INNER_LINE_MS, false)).toBe(0);
    expect(doorwayRevealScale(-1, false)).toBe(0);
    expect(doorwayRevealScale(0, false)).toBe(0);
    expect(doorwayRevealScale(DOORWAY_REVEAL_MS, false)).toBe(1);
    expect(doorwayRevealScale(DOORWAY_REVEAL_MS * 4, false)).toBe(1);
  });

  it("it only ever grows", () => {
    let last = -1;
    for (let ms = 0; ms <= DOORWAY_REVEAL_MS; ms += 30) {
      const now = doorwayRevealScale(ms, false);
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
  });

  it("D41: reduced motion is handed the end state, not the bloom", () => {
    expect(doorwayRevealScale(0, true)).toBe(1);
    expect(doorwayRevealScale(-INNER_LINE_MS, true)).toBe(1);
  });

  it("a junk clock shows the caret rather than hiding it", () => {
    expect(doorwayRevealScale(Number.NaN, false)).toBe(1);
    expect(doorwayRevealScale(Number.POSITIVE_INFINITY, false)).toBe(1);
  });

  /**
   * The wait is a measured number because the voice bus hands back no
   * completion callback. Nothing stops somebody re-rendering the clip longer,
   * so the file is what holds the constant honest.
   */
  it("the wait matches the rendered clip", () => {
    const file = resolve(
      __dirname,
      "../../../src/content/audio/voice/map.innerOpenSpoken.mp3",
    );
    const bytes = readFileSync(file);
    let at = 0;
    if (bytes.toString("latin1", 0, 3) === "ID3") {
      at =
        10 +
        ((bytes[6]! & 0x7f) << 21) +
        ((bytes[7]! & 0x7f) << 14) +
        ((bytes[8]! & 0x7f) << 7) +
        (bytes[9]! & 0x7f);
    }
    while (at < bytes.length - 4 && !(bytes[at] === 0xff && (bytes[at + 1]! & 0xe0) === 0xe0)) {
      at += 1;
    }
    const RATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
    const kbps = RATES[(bytes[at + 2]! & 0xf0) >> 4]!;
    expect(kbps).toBeGreaterThan(0);
    const seconds = ((bytes.length - at) * 8) / (kbps * 1000);
    expect(INNER_LINE_MS).toBeGreaterThan(seconds * 1000 - 500);
    expect(INNER_LINE_MS).toBeLessThan(seconds * 1000 + 500);
  });

  it("nothing is announced until the whole route is charted", () => {
    const partial = ROUTE_STOP_IDS.slice(0, 6).map(charted);
    expect(reveals(partial)).toBe(false);
  });

  it("it announces exactly once the route is charted and nothing inner is lit", () => {
    expect(reveals(ROUTE_STOP_IDS.map(charted))).toBe(true);
  });

  it("lighting any inner beacon ends it, with no stored flag to forget", () => {
    for (const bonus of ["venus", "mercury"] as const) {
      const after = [...ROUTE_STOP_IDS.map(charted), charted(bonus)];
      expect(bonusUnlocked(after)).toBe(true);
      expect(reveals(after)).toBe(false);
    }
  });
});
