import { describe, expect, it } from "vitest";
import { twinkleAlpha } from "../../../src/game/render/starField.js";

/**
 * THE STARFIELD (UR-14).
 *
 * UR-14, reported on the Title: the stars should not travel with the parallax.
 * They stay put and flicker slowly, at differing intervals.
 *
 * Two of those three words carry requirements a test can hold. STATIONARY is
 * structural and lives in `parallax.ts` - the field is built onto the `sky`
 * container, which is in `PINNED`, so it cannot scroll or sway; there is no
 * number to assert, only a placement, and the placement is the guarantee.
 *
 * SLOWLY and AT DIFFERENT INTERVALS are arithmetic, and they are here. So is
 * the constraint they have to satisfy that the player did not ask about:
 * AC-22.2 wants two Title frames a second apart to differ by more than 2% of
 * pixels, and the star layer used to carry that by sliding. The twinkle carries
 * it now, so the twinkle must actually move within a second.
 */
describe("stars twinkle slowly, and out of step with each other", () => {
  it("never goes fully dark, and never exceeds the star's own brightness", () => {
    // A star that blinks out reads as a dead pixel; one that overshoots its base
    // is a colour the palette never had.
    for (const t of [0, 250, 900, 1800, 3300, 5000, 7000]) {
      for (const swing of [0, 0.4, 0.8]) {
        const a = twinkleAlpha(0.7, swing, 4200, 1.1, t);
        expect(a).toBeGreaterThan(0);
        expect(a).toBeLessThanOrEqual(0.7 + 1e-9);
      }
    }
  });

  it("a star with no swing is perfectly steady", () => {
    // Some stars have to be still, or the field reads as mechanical.
    const a = twinkleAlpha(0.6, 0, 3000, 0.4, 0);
    for (const t of [500, 1500, 2500, 9000]) {
      expect(twinkleAlpha(0.6, 0, 3000, 0.4, t)).toBeCloseTo(a, 12);
    }
  });

  it("AC-22.2: a star moves measurably within one second", () => {
    // The property the sliding used to provide. At the slowest period in the
    // field (7400 ms) one second is about a sixth of a cycle, which is a real
    // change in alpha rather than a rounding difference.
    const moved = twinkleAlpha(0.8, 0.8, 7400, 0, 1000) - twinkleAlpha(0.8, 0.8, 7400, 0, 0);
    expect(Math.abs(moved)).toBeGreaterThan(0.05);
  });

  it("two stars with different phases are not in step", () => {
    // The whole of "at different intervals". A field twinkling in unison is a
    // flashing grid, which is worse than the sliding it replaced.
    const a = twinkleAlpha(0.8, 0.8, 4000, 0, 700);
    const b = twinkleAlpha(0.8, 0.8, 4000, Math.PI, 700);
    expect(Math.abs(a - b)).toBeGreaterThan(0.2);
  });

  it("...and two stars with different PERIODS drift apart over time", () => {
    // Phase alone would let the field come back into alignment. Different
    // periods mean it never does.
    const gap = (t: number): number =>
      Math.abs(twinkleAlpha(0.8, 0.8, 2600, 0, t) - twinkleAlpha(0.8, 0.8, 7400, 0, t));
    const samples = [0, 600, 1200, 1800, 2400, 3000, 3600].map(gap);
    expect(Math.max(...samples)).toBeGreaterThan(0.3);
  });

  it("is SLOW: a full cycle takes seconds, not frames", () => {
    // "Flickering slowly". At 2600 ms - the fastest star in the field - a single
    // 16 ms frame moves alpha by well under a hundredth, so no star strobes.
    const step = Math.abs(twinkleAlpha(0.8, 1, 2600, 0, 16) - twinkleAlpha(0.8, 1, 2600, 0, 0));
    expect(step).toBeLessThan(0.02);
  });
});
