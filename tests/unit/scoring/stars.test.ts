import { describe, expect, it } from "vitest";
import {
  CLEARED_STAGE_STARS,
  HULL_HITS_PER_STAGE,
  isClearableHullHits,
  multiplierFor,
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

  it("clamps a finite out-of-range count into range: -1 hits is 0 hits", () => {
    expect(starsForHullHits(-1)).toBe(3);
  });

  it("non-finite input earns no rating, matching multiplierFor's policy", () => {
    // One policy across the module: a finite number out of range is clamped to
    // the nearest valid value; a non-finite number is not a play outcome and
    // yields the no-reward value. Junk must not mint a perfect score. 0 here
    // means "no rating", and isClearableHullHits reports false, so the results
    // screen declines to render rather than rendering something false.
    expect(starsForHullHits(Number.NaN)).toBe(0);
    expect(starsForHullHits(Number.POSITIVE_INFINITY)).toBe(0);
    expect(multiplierFor(Number.NaN)).toBe(0);
    expect(multiplierFor(Number.POSITIVE_INFINITY)).toBe(0);
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

  it("clamps a negative count but refuses non-finite input", () => {
    expect(isClearableHullHits(-2)).toBe(true);
    expect(isClearableHullHits(Number.NaN)).toBe(false);
    expect(isClearableHullHits(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

/**
 * UR-176: the owner's save read `venus cleared: true, stars: 0` - the one
 * rating the header says a cleared stage can never carry.
 *
 * `hullHits` is CUMULATIVE on purpose (a canister must not erase a hit, or a
 * run that emptied its hull twice collects three stars). The consequence nobody
 * reconciled: with repairs, that count can REACH the cap on a run that cleared,
 * and `hits >= cap` then read as a stall.
 */
describe("UR-176: a cleared stage never scores zero", () => {
  it("floors a cleared run at one star when repairs took it to the cap", () => {
    expect(starsForHullHits(6, 6, true)).toBe(1);
    expect(starsForHullHits(9, 6, true)).toBe(1);
  });

  it("still scores a STALL zero at the same hit count", () => {
    expect(starsForHullHits(6, 6, false)).toBe(0);
    expect(starsForHullHits(9, 6, false)).toBe(0);
  });

  it("defaults to the pre-UR-176 answer, so no existing caller moved", () => {
    expect(starsForHullHits(3, 3)).toBe(starsForHullHits(3, 3, false));
    expect(starsForHullHits(3, 3)).toBe(0);
  });

  it("changes nothing below the cap, cleared or not", () => {
    for (let hits = 0; hits < 6; hits += 1) {
      expect(starsForHullHits(hits, 6, true)).toBe(starsForHullHits(hits, 6, false));
    }
  });

  it("never reports a cleared run as unrateable", () => {
    // The guard the results screen draws stars behind has to agree with the
    // rating, or it refuses to render the star it just awarded.
    expect(isClearableHullHits(6, 6, true)).toBe(true);
    expect(isClearableHullHits(6, 6, false)).toBe(false);
  });

  it("junk input is still unusable, cleared or not", () => {
    expect(starsForHullHits(Number.NaN, 6, true)).toBe(0);
    expect(starsForHullHits(Number.POSITIVE_INFINITY, 6, true)).toBe(0);
  });
});
