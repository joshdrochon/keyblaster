import { describe, expect, it } from "vitest";
import { HULL_HITS_PER_STAGE } from "@engine/scoring/index.js";
import {
  MAX_HULL,
  hullAfterShield,
  hullAfterStrike,
  hullMarksLit,
  isStalled,
  maySpawnCanister,
  startingHull,
} from "@game/flight/shield.js";

/**
 * HULL AND THE SHIELD CANISTER - FR-4, FR-5; D26, D27, D28, D29.
 *
 * `src/game/flight/shield.ts` shipped with NO test at all. It is five pure
 * rules that decide how much punishment the ship absorbs, when the stage ends
 * and when a repair is offered - which is to say it decides whether a child
 * gets to keep playing. It lives under `src/game/`, which the 95% coverage gate
 * does not cover, so "untested" was invisible to every gate in the repo.
 *
 * These are rules, so they are tested like rules: total, at the boundaries, and
 * for the properties the ACs actually claim rather than for the two happy
 * values. Nothing here is a failure count (D31, AC-22b.1) and no test asserts
 * one exists.
 */

describe("hull constants (AC-4.1, D27)", () => {
  it("AC-4.1: the hull is exactly the scoring module's three hits per stage", () => {
    // Stated once, in the engine. A second literal here would let the HUD and
    // the star rating disagree about what "three" means without failing.
    expect(MAX_HULL).toBe(HULL_HITS_PER_STAGE);
    expect(MAX_HULL).toBe(3);
  });

  it("AC-4.1 / D27: every stage starts at full hull", () => {
    expect(startingHull()).toBe(MAX_HULL);
  });
});

describe("hullAfterStrike (AC-4.2)", () => {
  it("AC-4.2: a rock crossing the breach line costs exactly one", () => {
    expect(hullAfterStrike(3)).toBe(2);
    expect(hullAfterStrike(2)).toBe(1);
    expect(hullAfterStrike(1)).toBe(0);
  });

  it("AC-4.2: it never goes below zero, however many strikes land", () => {
    // The stall card takes a frame or two to appear (FlightScene sinks the ship
    // for ~2.4 s first), and rocks already past the ship still resolve in that
    // window. A negative hull would draw as negative HUD marks.
    expect(hullAfterStrike(0)).toBe(0);
    expect(hullAfterStrike(-5)).toBe(0);
  });

  it("clamps a hull above the maximum before spending from it", () => {
    // A persisted or mis-passed value must not buy extra lives by arithmetic.
    expect(hullAfterStrike(99)).toBe(MAX_HULL - 1);
  });

  it("floors a fractional hull rather than propagating it", () => {
    expect(hullAfterStrike(2.9)).toBe(1);
  });

  it("is monotonically non-increasing across its whole domain", () => {
    for (let hull = -2; hull <= 6; hull += 1) {
      expect(hullAfterStrike(hull)).toBeLessThanOrEqual(hullMarksLit(hull));
    }
  });
});

describe("hullAfterShield (AC-5.2, D26)", () => {
  it("AC-5.2: blasting a canister restores exactly one mark", () => {
    expect(hullAfterShield(0)).toBe(1);
    expect(hullAfterShield(1)).toBe(2);
    expect(hullAfterShield(2)).toBe(3);
  });

  it("AC-5.2: the repair is capped at three - a canister never overfills", () => {
    expect(hullAfterShield(3)).toBe(MAX_HULL);
    expect(hullAfterShield(10)).toBe(MAX_HULL);
  });

  it("never returns less than one, even from a corrupt negative hull", () => {
    expect(hullAfterShield(-4)).toBe(1);
  });

  it("a strike then a repair returns the hull it started at, mid-range", () => {
    for (const hull of [1, 2, 3]) {
      expect(hullAfterShield(hullAfterStrike(hull))).toBe(hull);
    }
  });
});

describe("isStalled (AC-4.3, D29)", () => {
  it("AC-4.3: an empty hull stalls the stage", () => {
    expect(isStalled(0)).toBe(true);
  });

  it("AC-4.3: any remaining mark keeps the ship flying", () => {
    expect(isStalled(1)).toBe(false);
    expect(isStalled(2)).toBe(false);
    expect(isStalled(3)).toBe(false);
  });

  it("treats a negative hull as stalled rather than as not-yet-stalled", () => {
    expect(isStalled(-1)).toBe(true);
  });
});

describe("hullMarksLit (HUD, D31/AC-22b.1)", () => {
  it("lights one mark per remaining hit", () => {
    expect(hullMarksLit(0)).toBe(0);
    expect(hullMarksLit(1)).toBe(1);
    expect(hullMarksLit(3)).toBe(3);
  });

  it("is clamped to [0, MAX_HULL] so the HUD can never draw a negative count", () => {
    expect(hullMarksLit(-3)).toBe(0);
    expect(hullMarksLit(99)).toBe(MAX_HULL);
  });

  it("counts what REMAINS, never what was lost", () => {
    // D31: nothing in the surface may read as a penalty. The function the HUD
    // calls returns marks still lit; there is no `hullMarksLost` to draw.
    expect(hullMarksLit(2)).toBe(2);
    expect(MAX_HULL - hullMarksLit(2)).toBe(1); // only the test may subtract
  });
});

describe("maySpawnCanister (AC-5.1)", () => {
  it("AC-5.1: no canister while the hull is full - there is nothing to repair", () => {
    expect(maySpawnCanister(MAX_HULL, false)).toBe(false);
  });

  it("AC-5.1: a damaged hull may spawn one", () => {
    expect(maySpawnCanister(2, false)).toBe(true);
    expect(maySpawnCanister(1, false)).toBe(true);
    expect(maySpawnCanister(0, false)).toBe(true);
  });

  it("AC-5.1: only ever one canister live at a time", () => {
    for (const hull of [0, 1, 2, 3]) {
      expect(maySpawnCanister(hull, true)).toBe(false);
    }
  });

  it("decides WHETHER, never WHAT: it takes no pool and returns no word", () => {
    // selection/ owns which word rides the canister. This signature is the
    // guarantee that the canister cannot smuggle in an unallowlisted word.
    expect(maySpawnCanister.length).toBe(2);
  });

  it("an over-full hull is still treated as full", () => {
    expect(maySpawnCanister(99, false)).toBe(false);
  });
});
