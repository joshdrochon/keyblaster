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

  it("never veils the letter being typed", () => {
    for (let typed = 0; typed <= 12; typed += 1) {
      expect(isVeiled(typed, typed, W), `the next letter at typed=${typed}`).toBe(false);
    }
  });

  it("keeps CLEAR_AHEAD more letters clear beyond it", () => {
    for (let typed = 0; typed <= 12; typed += 1) {
      for (let k = 1; k <= CLEAR_AHEAD; k += 1) {
        expect(isVeiled(typed + k, typed, W), `typed=${typed} +${k}`).toBe(false);
      }
    }
  });

  it("recedes as the word is typed, never advances", () => {
    let previous = -1;
    for (let typed = 0; typed <= 12; typed += 1) {
      const from = veilFrom(typed, W);
      expect(from, "the cloud moved backwards").toBeGreaterThan(previous);
      previous = from;
    }
  });

  it("clears entirely by the time the word is finished", () => {
    for (const length of [2, 3, 5, 8]) {
      const from = veilFrom(length, W);
      for (let i = 0; i < length; i += 1) expect(isVeiled(i, length, W)).toBe(false);
      expect(from).toBeGreaterThanOrEqual(length);
    }
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
    // Two and three letter words exist in every pool.
    for (const length of [2, 3]) {
      const veiled = Array.from({ length }, (_, i) => isVeiled(i, 0, W));
      expect(veiled.every((v) => v), `a ${length}-letter word vanished`).toBe(false);
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
