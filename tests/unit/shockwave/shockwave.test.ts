import { describe, expect, it } from "vitest";
import {
  SHOCKWAVE_MAX_LOSS,
  hastenedFallMs,
  kickedSpinPerSec,
  shockwaveFor,
  withinReach,
} from "@engine/shockwave/index.js";
import { BONUS_STOP_IDS, ROUTE_STOP_IDS, STOP_IDS } from "@engine/types.js";

/**
 * D105: on the bonus stops only, a blasted rock disturbs the one nearest it.
 */
describe("AC-27.4: the inner run's shockwave", () => {
  it("exists at the bonus pair and nowhere on the main route", () => {
    for (const id of ROUTE_STOP_IDS) {
      expect(shockwaveFor(id), `${id} should be untouched`).toBeNull();
    }
    for (const id of BONUS_STOP_IDS) {
      expect(shockwaveFor(id), `${id} has no shockwave`).not.toBeNull();
    }
    expect(BONUS_STOP_IDS.length + ROUTE_STOP_IDS.length).toBe(STOP_IDS.length);
  });

  it("Mercury's kick is the harder of the two", () => {
    const v = shockwaveFor("venus")!;
    const m = shockwaveFor("mercury")!;
    expect(m.spinBoost).toBeGreaterThan(v.spinBoost);
    expect(m.hasteFactor).toBeLessThan(v.hasteFactor);
    expect(m.reachPx).toBeGreaterThan(v.reachPx);
  });

  it("hurries a rock, and only the part of the fall that is left", () => {
    const spec = shockwaveFor("mercury")!;
    const base = 4000;
    // Two rocks with the same budget, kicked at different depths: the one that
    // is nearly down loses less, because only its remainder is compressed.
    const early = hastenedFallMs(base, base, 500, spec);
    const late = hastenedFallMs(base, base, 3000, spec);
    expect(base - early).toBeGreaterThan(base - late);
    expect(early).toBeLessThan(base);
    expect(late).toBeLessThan(base);
  });

  it("never takes more than SHOCKWAVE_MAX_LOSS of the budget, however many land", () => {
    // The floor is the whole safety argument: a word must stay readable no
    // matter how many rocks break beside it.
    const spec = shockwaveFor("mercury")!;
    const base = 3000;
    let fall = base;
    for (let i = 0; i < 50; i += 1) fall = hastenedFallMs(base, fall, 0, spec);
    expect(fall).toBeGreaterThanOrEqual(base * SHOCKWAVE_MAX_LOSS);
  });

  it("is inert once the rock has landed", () => {
    const spec = shockwaveFor("venus")!;
    expect(hastenedFallMs(3000, 3000, 3000, spec)).toBe(3000);
    expect(hastenedFallMs(3000, 3000, 4000, spec)).toBe(3000);
  });

  it("spins a rock faster without ever reversing it", () => {
    const spec = shockwaveFor("mercury")!;
    expect(kickedSpinPerSec(0.4, spec)).toBeGreaterThan(0.4);
    expect(kickedSpinPerSec(-0.4, spec)).toBeLessThan(-0.4);
    expect(Math.sign(kickedSpinPerSec(-0.4, spec))).toBe(-1);
  });

  it("only reaches rocks that are actually near", () => {
    const spec = shockwaveFor("venus")!;
    expect(withinReach(spec, 0, 0, spec.reachPx - 1, 0)).toBe(true);
    expect(withinReach(spec, 0, 0, spec.reachPx + 1, 0)).toBe(false);
  });

  it("survives junk rather than producing a NaN fall", () => {
    const spec = shockwaveFor("mercury")!;
    expect(hastenedFallMs(3000, Number.NaN, 0, spec)).toBeNaN();
    expect(kickedSpinPerSec(Number.NaN, spec)).toBe(0);
  });
});
