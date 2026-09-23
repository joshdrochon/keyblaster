import { describe, expect, it } from "vitest";
import { CHARGE_OVERSHOOT, chargeLevelFor } from "@game/scenes/support/chargeLadder";
import { stageBundle } from "@game/scenes/lib/content";
import { STOP_IDS, type StopId } from "@engine/types";

/**
 * UR-195. THE CLAIMS THE SCREEN ACTUALLY MAKES.
 *
 * Every one of these was a defect first, found by measuring the RENDERED alpha
 * rather than the number the scene passed in - the two disagreed for three
 * rounds. They are written as properties over every word length the shipped
 * pools contain, because the bugs all lived at the ends: the first keystroke
 * and the last.
 */

/** Word lengths the shipped content can actually produce. */
const LENGTHS = (): number[] => {
  const lens = new Set<number>();
  for (const stop of STOP_IDS as readonly StopId[]) {
    for (const w of stageBundle(stop).pool) lens.add([...w].length);
  }
  return [...lens].sort((a, b) => a - b);
};

describe("the blaster charges, one keystroke at a time (UR-195)", () => {
  it("the shipped pools are 2 to 8 characters, so that is the range under test", () => {
    const lens = LENGTHS();
    expect(Math.min(...lens)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...lens)).toBeLessThanOrEqual(8);
  });

  it("the LAST keystroke always blooms to a full lens", () => {
    // The blast fires off the back of this, so anything under 1 means the kill
    // shot starts from a lens that was never filled.
    for (const n of LENGTHS()) {
      expect(chargeLevelFor(n, n).bloom, `${n}-letter word`).toBeCloseTo(1, 6);
    }
  });

  it("EVERY keystroke overshoots its resting level by the same amount", () => {
    // The first arrangement made the overshoot shrink as the word went on, so
    // the pop stopped reading exactly when the charge was most interesting.
    for (const n of LENGTHS()) {
      for (let i = 1; i <= n; i += 1) {
        const { bloom, settle } = chargeLevelFor(i, n);
        expect(bloom - settle, `key ${i} of ${n}`).toBeCloseTo(CHARGE_OVERSHOOT, 6);
      }
    }
  });

  it("the FIRST keystroke is always visible over the lamp's own glow", () => {
    // MEASURED, not chosen: the lamp's standing glow is 0.24-0.44 alpha and
    // the muzzle draws at 0.85 * bloom, so below ~0.55 the first pulse is
    // painted underneath the lamp. It rendered at 0.37 and looked like nothing.
    for (const n of LENGTHS()) {
      expect(chargeLevelFor(1, n).bloom, `${n}-letter word`).toBeGreaterThanOrEqual(0.55);
    }
  });

  it("never steps backwards inside a word", () => {
    // A charge that dips reads as leaking rather than filling.
    for (const n of LENGTHS()) {
      let prevBloom = -1;
      let prevSettle = -1;
      for (let i = 1; i <= n; i += 1) {
        const { bloom, settle } = chargeLevelFor(i, n);
        expect(bloom, `key ${i} of ${n}`).toBeGreaterThanOrEqual(prevBloom);
        expect(settle, `key ${i} of ${n}`).toBeGreaterThanOrEqual(prevSettle);
        prevBloom = bloom;
        prevSettle = settle;
      }
    }
  });

  it("stays inside the lens at both ends", () => {
    for (const n of LENGTHS()) {
      for (let i = 1; i <= n; i += 1) {
        const { bloom, settle } = chargeLevelFor(i, n);
        expect(bloom).toBeLessThanOrEqual(1);
        expect(settle).toBeGreaterThanOrEqual(0);
        expect(settle).toBeLessThanOrEqual(bloom);
      }
    }
  });

  it("a one-letter word is a single full bloom, not a divide by zero", () => {
    const only = chargeLevelFor(1, 1);
    expect(only.bloom).toBeCloseTo(1, 6);
    expect(Number.isFinite(only.settle)).toBe(true);
  });

  it("nonsense input never produces NaN on a child's screen", () => {
    for (const [i, n] of [[0, 5], [-3, 5], [9, 5], [1, 0], [1, -2]] as const) {
      const { bloom, settle } = chargeLevelFor(i, n);
      expect(Number.isFinite(bloom), `${i}/${n}`).toBe(true);
      expect(Number.isFinite(settle), `${i}/${n}`).toBe(true);
      expect(bloom).toBeLessThanOrEqual(1);
    }
  });
});
