import { describe, expect, it } from "vitest";
import {
  CLEARED_STAGE_STARS,
  HULL_HITS_PER_STAGE,
  isClearableHullHits,
  starsForHullHits,
} from "@engine/scoring/index.js";

describe("starsForHullHits (AC-4.4)", () => {
  it("AC-4.4: 0 hull hits = 3 stars", () => {
    expect(starsForHullHits(0)).toBe(3);
  });

  it("AC-4.4: 1 hull hit = 2 stars", () => {
    expect(starsForHullHits(1)).toBe(2);
  });

  it("AC-4.4: 2 hull hits = 1 star", () => {
    expect(starsForHullHits(2)).toBe(1);
  });

  it("AC-4.4: 3 hull hits is a stall (D29), not a rating - it returns 0", () => {
    // D27 gives the hull three hits; the third empties it, and D29 makes an
    // empty hull a mission fail. So 3 is never the tally of a *cleared* stage.
    // We map it to 0 and document that 0 means "not cleared", which is why
    // CLEARED_STAGE_STARS below excludes it.
    expect(HULL_HITS_PER_STAGE).toBe(3);
    expect(starsForHullHits(3)).toBe(0);
    expect(starsForHullHits(4)).toBe(0);
  });

  it("AC-4.4: a cleared stage can only ever be 3, 2 or 1 stars", () => {
    const reachable = new Set<number>();
    for (let hits = 0; hits < HULL_HITS_PER_STAGE; hits++) {
      reachable.add(starsForHullHits(hits));
    }
    expect([...reachable].sort((a, b) => b - a)).toEqual([...CLEARED_STAGE_STARS]);
    expect(reachable.has(0)).toBe(false);
  });

  it("clamps negative and non-finite input to a full rating, never NaN", () => {
    expect(starsForHullHits(-1)).toBe(3);
    expect(starsForHullHits(Number.NaN)).toBe(3);
    expect(starsForHullHits(Number.POSITIVE_INFINITY)).toBe(3);
  });

  it("floors a fractional hit count", () => {
    expect(starsForHullHits(1.9)).toBe(2);
    expect(starsForHullHits(2.9)).toBe(1);
  });
});

describe("isClearableHullHits", () => {
  it("is true for 0..2 and false from the stall onwards (D29)", () => {
    expect(isClearableHullHits(0)).toBe(true);
    expect(isClearableHullHits(1)).toBe(true);
    expect(isClearableHullHits(2)).toBe(true);
    expect(isClearableHullHits(3)).toBe(false);
    expect(isClearableHullHits(9)).toBe(false);
  });

  it("treats junk input as clearable rather than as a stall", () => {
    expect(isClearableHullHits(-2)).toBe(true);
    expect(isClearableHullHits(Number.NaN)).toBe(true);
  });

  it("never disagrees with starsForHullHits about what is a stall", () => {
    for (let hits = -2; hits <= 6; hits++) {
      expect(isClearableHullHits(hits)).toBe(starsForHullHits(hits) !== 0);
    }
  });
});
