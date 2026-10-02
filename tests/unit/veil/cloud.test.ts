import { describe, expect, it } from "vitest";
import {
  CLEAR_AHEAD,
  VEIL_BY_STOP,
  isVeiled,
  veilFrom,
  veilWindowFor,
} from "@engine/veil/index.js";
import { STOP_IDS } from "@engine/types.js";

/**
 * D109: Venus reads through cloud.
 *
 * The safety properties come first, because the failure mode of this mechanic
 * is a seven-year-old looking at a word they cannot read.
 */
describe("AC-27.5: the cloud never hides what the player needs", () => {
  const W = veilWindowFor("venus");

  it("never veils a letter already typed", () => {
    for (let typed = 0; typed <= 12; typed += 1) {
      for (let i = 0; i < typed; i += 1) {
        expect(isVeiled(i, typed, W), `typed=${typed} i=${i}`).toBe(false);
      }
    }
  });

  it("keeps the head of the word clear, at every typed count", () => {
    for (let typed = 0; typed <= 12; typed += 1) {
      for (let i = 0; i <= CLEAR_AHEAD; i += 1) {
        expect(isVeiled(i, typed, W), `typed=${typed} i=${i}`).toBe(false);
      }
    }
  });

  it("DOES NOT MOVE as the word is typed, which is the whole change", () => {
    // The owner read a travelling band as the letters shifting: every keystroke
    // turned one letter white->accent AND one grey->white. The boundary is
    // fixed at the head of the word now, so the only colour change per
    // keystroke is the accent one the game had before D109.
    const first = veilFrom(0, W);
    for (let typed = 0; typed <= 12; typed += 1) {
      expect(veilFrom(typed, W), `the cloud moved at typed=${typed}`).toBe(first);
    }
  });

  it("clears entirely by the time the word is finished", () => {
    for (const length of [2, 3, 5, 8]) {
      for (let i = 0; i < length; i += 1) expect(isVeiled(i, length, W)).toBe(false);
    }
  });

  it("a veiled letter stays veiled until it is typed, then lights", () => {
    // It clears when the cursor has PASSED it, not on arrival: the letter AT
    // the cursor is still behind cloud, and the underline is what marks it.
    // That is the cost of a band that does not travel, and it is why the veil
    // colour is derived against AC-22.8 rather than chosen - the letter being
    // typed has to stay readable at 4.5:1 (see wordPlateVeil.test.ts).
    const i = 6;
    for (let typed = 0; typed <= i; typed += 1) {
      expect(isVeiled(i, typed, W), `letter ${i} cleared early at typed=${typed}`).toBe(true);
    }
    expect(isVeiled(i, i + 1, W), "it never cleared once typed").toBe(false);
  });

  it("FAILS OPEN on junk: no cloud rather than an unreadable word", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, -99]) {
      expect(isVeiled(0, bad, W), `typedCount=${bad}`).toBe(false);
    }
    for (const badWindow of [Number.NaN, -1]) {
      expect(isVeiled(50, 0, badWindow)).toBe(false);
    }
  });

  it("a short word is never fully behind cloud", () => {
    // Two and three letter words exist in every pool. CLEAR_AHEAD + 1 letters
    // are clear from the head, so a word that short carries no cloud at all.
    for (const length of [2, 3]) {
      for (let i = 0; i < length; i += 1) {
        expect(isVeiled(i, 0, W), `a ${length}-letter word veiled letter ${i}`).toBe(false);
      }
    }
  });
});

describe("AC-27.6: the cloud is Venus's and nowhere else's", () => {
  it("is on Venus", () => {
    expect(veilWindowFor("venus")).toBe(CLEAR_AHEAD);
  });

  it("is on no other stop, so every other belt is byte-identical", () => {
    for (const stop of STOP_IDS.filter((s) => s !== "venus")) {
      expect(veilWindowFor(stop), `${stop} grew a cloud`).toBeNull();
    }
  });

  it("a stop with no entry veils nothing at all", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(isVeiled(i, 0, veilWindowFor("mercury"))).toBe(false);
    }
  });

  it("stays a short list - a mechanic on every stop is not a mechanic", () => {
    expect(Object.keys(VEIL_BY_STOP).length).toBeLessThanOrEqual(2);
  });
});
