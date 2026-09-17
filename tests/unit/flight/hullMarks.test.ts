import { describe, expect, it } from "vitest";
import {
  HULL_BASE_MARKS,
  HULL_MARK_DIM,
  hullForStage,
  hullMarkAlpha,
} from "@engine/hull/index.js";
import { starsForHullHits } from "@engine/scoring/index.js";
import { DEFAULT_FLIGHT_CONFIG } from "@game/flight/stage.js";

/**
 * D31 / AC-22b.1 - THREE HULL MARKS, WHATEVER THE HULL IS.
 *
 * The hull now scales with stage length (`@engine/hull`), so a 58-word belt
 * carries nine marks. Drawing nine pips on the HUD would have been the literal
 * reading and the wrong one: nine pips in a row IS a lives counter, which
 * AC-22b.1 forbids by name - and it would have arrived as a side effect of a
 * difficulty fix rather than as a decision anybody made about the surface.
 *
 * So the HUD keeps three marks and each owns a third of the hull. These are the
 * properties that makes that honest rather than merely smaller.
 */

const SHIPPED_HULL = hullForStage(DEFAULT_FLIGHT_CONFIG.stageWordCount);

const marksAt = (hull: number, maxHull: number): number[] =>
  [0, 1, 2].map((i) => hullMarkAlpha(i, hull, maxHull));

describe("hullMarkAlpha: three marks for a hull of any size", () => {
  it("D27: at an 18-word stage it is EXACTLY what shipped - one mark per hit", () => {
    expect(marksAt(3, HULL_BASE_MARKS)).toEqual([1, 1, 1]);
    expect(marksAt(2, HULL_BASE_MARKS)).toEqual([1, 1, HULL_MARK_DIM]);
    expect(marksAt(1, HULL_BASE_MARKS)).toEqual([1, HULL_MARK_DIM, HULL_MARK_DIM]);
    expect(marksAt(0, HULL_BASE_MARKS)).toEqual([HULL_MARK_DIM, HULL_MARK_DIM, HULL_MARK_DIM]);
  });

  it("a full hull is three full marks, at every stage length", () => {
    for (const words of [18, 30, 58, 120]) {
      const cap = hullForStage(words);
      expect(marksAt(cap, cap), `${words} words`).toEqual([1, 1, 1]);
    }
  });

  it("an empty hull leaves three marks STILL THERE, dimmed (D31)", () => {
    // A mark that vanished would be a count of what was lost. It dims; it does
    // not disappear, and there are always three of them.
    const marks = marksAt(0, SHIPPED_HULL);
    expect(marks).toEqual([HULL_MARK_DIM, HULL_MARK_DIM, HULL_MARK_DIM]);
    expect(marks.every((a) => a > 0)).toBe(true);
    expect(marks).toHaveLength(3);
  });

  it("AC-6e.2's spirit: EVERY hit moves something on screen", () => {
    // The risk of compressing nine marks into three is that a single hit
    // becomes invisible, which would be a worse regression than the one being
    // fixed - the child would take damage with no feedback at all.
    for (let hull = SHIPPED_HULL; hull > 0; hull -= 1) {
      const before = marksAt(hull, SHIPPED_HULL);
      const after = marksAt(hull - 1, SHIPPED_HULL);
      expect(before, `hull ${hull} -> ${hull - 1} changed nothing`).not.toEqual(after);
    }
  });

  it("marks dim from the RIGHT: the leftmost is the last to go", () => {
    for (let hull = SHIPPED_HULL; hull >= 0; hull -= 1) {
      const marks = marksAt(hull, SHIPPED_HULL);
      expect(marks[0], `hull ${hull}`).toBeGreaterThanOrEqual(marks[1] as number);
      expect(marks[1], `hull ${hull}`).toBeGreaterThanOrEqual(marks[2] as number);
    }
  });

  it("is monotone: damage never brightens a mark", () => {
    for (let i = 0; i < 3; i += 1) {
      let previous = Number.POSITIVE_INFINITY;
      for (let hull = SHIPPED_HULL; hull >= 0; hull -= 1) {
        const a = hullMarkAlpha(i, hull, SHIPPED_HULL);
        expect(a, `mark ${i} at hull ${hull}`).toBeLessThanOrEqual(previous);
        previous = a;
      }
    }
  });

  it("the marks never promise more than the STARS will pay", () => {
    /**
     * What the child watches during the stage and what the results screen tells
     * them afterwards are the same three buckets (`starsForHullHits`), so the
     * two must not contradict each other - the HUD saying "two marks still up"
     * while the results screen hands back one star is a two-minute lie.
     *
     * The relation is `fullMarks <= stars` rather than equality, and the reason
     * is the ONE place `starsForHullHits` deviates from the arithmetic: it
     * clamps its bottom band to 1, because a CLEARED stage may never carry 0
     * stars (D29 - 0 means "not cleared"). So at the very last slice of a long
     * hull the star rating is generous by one and the marks are not. Generous
     * in that direction is the right way round.
     */
    for (let hits = 0; hits < SHIPPED_HULL; hits += 1) {
      const stars = starsForHullHits(hits, SHIPPED_HULL);
      const fullMarks = marksAt(SHIPPED_HULL - hits, SHIPPED_HULL).filter((a) => a === 1).length;
      expect(fullMarks, `${hits} hits: ${fullMarks} marks vs ${stars} stars`).toBeLessThanOrEqual(
        stars,
      );
      expect(fullMarks, `${hits} hits`).toBeGreaterThanOrEqual(stars - 1);
    }
  });

  it("D27: at three marks the HUD and the stars agree EXACTLY", () => {
    // The clamp above cannot bite at the stage length D27 was written for, so
    // there the two are identical - which is the check that the generalisation
    // did not quietly change what shipped.
    for (let hits = 0; hits < HULL_BASE_MARKS; hits += 1) {
      const stars = starsForHullHits(hits, HULL_BASE_MARKS);
      const fullMarks = marksAt(HULL_BASE_MARKS - hits, HULL_BASE_MARKS).filter(
        (a) => a === 1,
      ).length;
      expect(fullMarks, `${hits} hits`).toBe(stars);
    }
  });

  it("is total on junk, because the HUD draws whatever it is handed", () => {
    expect(hullMarkAlpha(0, Number.NaN, 9)).toBe(HULL_MARK_DIM);
    expect(hullMarkAlpha(0, 5, 0)).toBe(1);
    expect(hullMarkAlpha(0, 5, Number.NaN)).toBe(1);
    expect(hullMarkAlpha(2, 99, 9)).toBe(1);
    expect(hullMarkAlpha(0, -4, 9)).toBe(HULL_MARK_DIM);
  });

  it("D31/AC-22b.1: there is no mark count to draw, and no lost count either", () => {
    // The signature is the guarantee. It answers "how lit is mark i", and there
    // is no function here that answers "how many did you lose".
    expect(hullMarkAlpha.length).toBe(3);
  });
});
