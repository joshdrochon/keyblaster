import { describe, expect, it } from "vitest";
import {
  SHIP_LANE_CLEARANCE_PX,
  isOnShipLane,
  offLaneSpans,
  playableSpan,
  shipLane,
  spawnX,
  type LaneSpec,
} from "@engine/spawn/index.js";
import { mulberry32 } from "../selection/rng.js";

/**
 * D21 / D23 / D31: a word that came back is not aimed at the ship.
 *
 * The player's reasoning, which is the learning design: a word is on the belt a
 * second time because they MISSED it (D23) or because it is a retention check
 * (D21). Both are the game's own decision to re-teach. Flying it at the hull
 * charges the child for that decision, which D31 forbids.
 *
 * What this module may and may not do is the thing worth pinning: it moves a
 * COLUMN. It is handed no word, no ease and no fall time, so it cannot make a
 * practice rock easier even by accident.
 */

const GAME_WIDTH = 1920;

const spec = (over: Partial<LaneSpec> = {}): LaneSpec => ({
  width: GAME_WIDTH,
  marginPx: 320,
  shipX: GAME_WIDTH / 2,
  shipHalfWidthPx: 46,
  rockHalfWidthPx: 40,
  ...over,
});

describe("shipLane: which columns come down on the Lantern", () => {
  it("is centred on the ship and reaches both silhouettes plus clearance", () => {
    const s = spec();
    const lane = shipLane(s);
    const reach = s.shipHalfWidthPx + s.rockHalfWidthPx + SHIP_LANE_CLEARANCE_PX;
    expect(lane.from).toBe(s.shipX - reach);
    expect(lane.to).toBe(s.shipX + reach);
    expect(isOnShipLane(s.shipX, s)).toBe(true);
  });

  it("a bigger rock owns a wider lane - a long word is a wider target", () => {
    const small = shipLane(spec({ rockHalfWidthPx: 28 }));
    const large = shipLane(spec({ rockHalfWidthPx: 70 }));
    expect(large.to - large.from).toBeGreaterThan(small.to - small.from);
  });

  it("the boundary is inclusive, so a rock exactly touching counts as on it", () => {
    const s = spec();
    const lane = shipLane(s);
    expect(isOnShipLane(lane.from, s)).toBe(true);
    expect(isOnShipLane(lane.to, s)).toBe(true);
    expect(isOnShipLane(lane.from - 1, s)).toBe(false);
    expect(isOnShipLane(lane.to + 1, s)).toBe(false);
  });
});

describe("playableSpan: the margin the near-plane framing needs", () => {
  it("is the width inset by the margin at each edge", () => {
    expect(playableSpan(spec())).toEqual({ from: 320, to: GAME_WIDTH - 320 });
  });

  it("collapses to the centre rather than inverting on an absurd margin", () => {
    // A reversed interval would sample off-screen. This is a configuration
    // mistake, not a runtime state, and it must stay total either way.
    expect(playableSpan(spec({ marginPx: 2000 }))).toEqual({ from: 960, to: 960 });
  });
});

describe("spawnX with avoidShipLane false: the ordinary rock, unchanged", () => {
  it("stays inside the playable span for every value the rng can return", () => {
    const s = spec();
    const play = playableSpan(s);
    for (let i = 0; i < 2000; i += 1) {
      const rng = mulberry32(i);
      const x = spawnX(s, rng, false);
      expect(x).toBeGreaterThanOrEqual(play.from);
      expect(x).toBeLessThanOrEqual(play.to);
    }
  });

  it("DOES use the ship's lane - a first-time word is a real threat", () => {
    // The flag has to change something. If no rock were ever aimed at the ship
    // the hull would be decoration, which is not what D27/D28 describe.
    const s = spec();
    const rng = mulberry32(3);
    let onLane = 0;
    for (let i = 0; i < 4000; i += 1) if (isOnShipLane(spawnX(s, rng, false), s)) onLane += 1;
    expect(onLane).toBeGreaterThan(0);
  });

  it("is uniform over the playable width: the two halves get similar counts", () => {
    const s = spec();
    const rng = mulberry32(17);
    const play = playableSpan(s);
    const middle = (play.from + play.to) / 2;
    let left = 0;
    for (let i = 0; i < 20_000; i += 1) if (spawnX(s, rng, false) < middle) left += 1;
    expect(left / 20_000).toBeGreaterThan(0.45);
    expect(left / 20_000).toBeLessThan(0.55);
  });
});

describe("spawnX with avoidShipLane true: the practice rock", () => {
  it("D23: NEVER lands on the ship's lane, over 20,000 seeded spawns", () => {
    // The assertion the defect is about, stated as an invariant rather than as
    // a sample - the same shape AC-2.1 uses, and for the same reason.
    const rng = mulberry32(42);
    for (const rockHalfWidthPx of [28, 40, 56, 70]) {
      const s = spec({ rockHalfWidthPx });
      for (let i = 0; i < 5000; i += 1) {
        const x = spawnX(s, rng, true);
        expect(isOnShipLane(x, s), `rock ${rockHalfWidthPx} at ${x}`).toBe(false);
      }
    }
  });

  it("stays inside the playable span, so it never hides behind the framing", () => {
    const s = spec();
    const play = playableSpan(s);
    const rng = mulberry32(8);
    for (let i = 0; i < 5000; i += 1) {
      const x = spawnX(s, rng, true);
      expect(x).toBeGreaterThanOrEqual(play.from);
      expect(x).toBeLessThanOrEqual(play.to);
    }
  });

  it("uses BOTH sides - practice rocks do not pile up on one edge", () => {
    const s = spec();
    const rng = mulberry32(21);
    let left = 0;
    let right = 0;
    for (let i = 0; i < 10_000; i += 1) {
      const x = spawnX(s, rng, true);
      if (x < s.shipX) left += 1;
      else right += 1;
    }
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
    // The ship is centred and the margins are equal, so the split is even.
    expect(Math.abs(left - right) / 10_000).toBeLessThan(0.05);
  });

  it("weights the two sides by WIDTH, not by a coin flip", () => {
    // With the ship off centre one side is much narrower. A 50/50 side choice
    // would crowd practice rocks into the narrow strip, which reads as the game
    // dumping them in a corner rather than as them simply missing the ship.
    const s = spec({ shipX: 520 });
    const spans = offLaneSpans(s);
    expect(spans.length).toBe(2);
    const [narrow, wide] = spans as [{ from: number; to: number }, { from: number; to: number }];
    const narrowWidth = narrow.to - narrow.from;
    const wideWidth = wide.to - wide.from;
    expect(wideWidth).toBeGreaterThan(narrowWidth * 3);

    const rng = mulberry32(13);
    let inNarrow = 0;
    const runs = 20_000;
    for (let i = 0; i < runs; i += 1) {
      if (spawnX(s, rng, true) <= narrow.to) inNarrow += 1;
    }
    const expected = narrowWidth / (narrowWidth + wideWidth);
    expect(inNarrow / runs).toBeGreaterThan(expected - 0.03);
    expect(inNarrow / runs).toBeLessThan(expected + 0.03);
  });

  it("offLaneSpans drops a side the ship has swallowed entirely", () => {
    // Ship hard against the left margin: there is no room to its left, so there
    // is one span, not two with an empty one in it.
    const s = spec({ shipX: 330 });
    const spans = offLaneSpans(s);
    expect(spans.length).toBe(1);
    expect(spans[0]?.to).toBe(playableSpan(s).to);
  });

  it("degrades to the far edge when there is no off-lane column at all", () => {
    // A huge rock on a narrow playfield. The rule cannot be satisfied, so it
    // keeps the INTENT - as far from the ship as the stage allows - rather than
    // throwing or quietly falling back to a uniform pick.
    const s = spec({ width: 900, marginPx: 380, rockHalfWidthPx: 200, shipX: 450 });
    expect(offLaneSpans(s)).toEqual([]);
    const play = playableSpan(s);
    const rng = mulberry32(2);
    for (let i = 0; i < 200; i += 1) {
      const x = spawnX(s, rng, true);
      expect(x === play.from || x === play.to).toBe(true);
    }
  });

  it("picks the FURTHER edge when it degrades, not an arbitrary one", () => {
    const left = spec({ width: 900, marginPx: 380, rockHalfWidthPx: 200, shipX: 500 });
    const right = spec({ width: 900, marginPx: 380, rockHalfWidthPx: 200, shipX: 400 });
    expect(spawnX(left, () => 0.5, true)).toBe(playableSpan(left).from);
    expect(spawnX(right, () => 0.5, true)).toBe(playableSpan(right).to);
  });

  it("is total at the top of the rng's range", () => {
    // `rng()` is documented as [0, 1). An implementation that returned exactly
    // 1 must still produce a column rather than `undefined`.
    const s = spec();
    const x = spawnX(s, () => 1, true);
    expect(Number.isFinite(x)).toBe(true);
    expect(isOnShipLane(x, s)).toBe(false);
  });

  it("takes no word, no ease and no fall time: it cannot change difficulty", () => {
    // The signature IS the guarantee that "trajectory, not difficulty" holds.
    // FR-8 owns fall time and nothing in this module can reach it.
    expect(spawnX.length).toBe(3);
    const keys = Object.keys(spec());
    expect(keys).toEqual([
      "width",
      "marginPx",
      "shipX",
      "shipHalfWidthPx",
      "rockHalfWidthPx",
    ]);
  });

  it("honours an explicit clearance override", () => {
    const tight = shipLane(spec({ clearancePx: 0 }));
    const loose = shipLane(spec({ clearancePx: 200 }));
    expect(loose.to - loose.from).toBeGreaterThan(tight.to - tight.from);
  });
});
