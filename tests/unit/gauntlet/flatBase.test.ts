import { describe, expect, it } from "vitest";
import {
  MIN_STEP,
  longestFlatBase,
  paintFlatBase,
  paintLimb,
  paintRingPlane,
// @ts-expect-error - .mjs tooling module, no type declarations by design
} from "../../gauntlet/flatBase.mjs";

/**
 * AC-22.10, THE PIXEL HALF, WITH ITS NEGATIVE CONTROL.
 *
 * D97 took the terrain out because the shapes read as noise three times over,
 * and nothing in this repo stopped it coming back. A sine hill, a mesa, any
 * flat-based mass could land tomorrow and every gate would stay green - which is
 * the shape of `docs/verification-gaps.md` instances 2 and 18: a decision with
 * no guard is a decision that expires quietly.
 *
 * Everything here is synthetic and pure, so the control runs in milliseconds and
 * needs no browser. `tests/e2e/no-terrain.spec.ts` runs the IDENTICAL function
 * on real captured frames at all six belted stops; this file is what proves the
 * function can tell the three shapes apart at all.
 */

const W = 1280;
const H = 720;

/**
 * A stand-in for the sky: a vertical gradient, bright at the top and dark at the
 * bottom, which is what every stop in this game actually draws. It matters that
 * the background is a GRADIENT and not a flat field - a detector that only works
 * on a flat background is measuring its own fixture.
 */
function skyFrame(): Uint8Array {
  const g = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) {
    const v = Math.round(206 - (206 - 70) * (y / (H - 1)));
    for (let x = 0; x < W; x += 1) g[y * W + x] = v;
  }
  return g;
}

/** The bar, as a fraction of frame width. See `no-terrain.spec.ts` for the why. */
const BAR = 0.3;

describe("AC-22.10 / D97: a flat-based mass is detectable and the allowed space forms are not", () => {
  it("an empty sky has no flat base in it", () => {
    const r = longestFlatBase({ grey: skyFrame(), w: W, h: H }) as { runFraction: number };
    // A downward gradient never steps UP, so there is nothing to find. If this
    // ever reports a run, the measure is reading its own sampling band.
    expect(r.runFraction).toBe(0);
  });

  /**
   * THE NEGATIVE CONTROL. The defect, composited into the same sky.
   *
   * A mass 720 px wide ending in a flat base with sky beneath it - which is the
   * "brown ribbon" `tiles.ts` documents at length as the shape that failed
   * structurally twice, because a plane that wraps every tile height can only be
   * a partial fill and a partial fill repeated vertically is a band.
   */
  it("NEGATIVE CONTROL: a flat-based mass is caught, well clear of the bar", () => {
    const grey = paintFlatBase(skyFrame(), W, H, {
      x0: 180,
      x1: 900,
      yTop: 220,
      yBase: 330,
    }) as Uint8Array;
    const r = longestFlatBase({ grey, w: W, h: H }) as {
      runFraction: number;
      runPx: number;
      atRow: number;
    };
    // The mass is 720 px wide and the measure finds essentially all of it.
    expect(r.runPx).toBeGreaterThanOrEqual(700);
    expect(r.atRow, "the base, not the top edge").toBeGreaterThan(300);
    expect(
      r.runFraction,
      `a flat-based mass must exceed the bar, or the e2e cannot fail on one`,
    ).toBeGreaterThan(BAR);
    // Recorded so the margin is visible rather than implied: 0.562 against 0.30.
    expect(r.runFraction).toBeGreaterThan(0.55);
  });

  /**
   * AND THE TWO FORMS D97 PUT IN ITS PLACE MUST NOT FIRE.
   *
   * This is the half that decides whether the check is usable. A ring plane seen
   * near edge-on is a very wide, very shallow ellipse, and the bottom of one is
   * nearly flat for a long way: a naive fixed-row detector scored this exact
   * shape 0.420 of frame width, above any bar that would still catch the defect.
   * Locating the edge per column with non-maximum suppression brings it to 0.204,
   * which is where the bar's floor comes from.
   */
  it("a ring plane seen near edge-on stays under the bar", () => {
    const grey = paintRingPlane(skyFrame(), W, H, {
      cx: 640,
      cy: 300,
      halfWidth: 420,
      halfHeight: 26,
    }) as Uint8Array;
    const r = longestFlatBase({ grey, w: W, h: H }) as { runFraction: number };
    expect(r.runFraction, "a ring plane is an ALLOWED form (D97)").toBeLessThan(BAR);
    // The real number, so nobody lowers the bar without seeing what it costs.
    expect(r.runFraction).toBeGreaterThan(0.15);
  });

  it("a planet limb stays under the bar", () => {
    const grey = paintLimb(skyFrame(), W, H, {
      cx: 640,
      cy: -1150,
      radius: 1500,
    }) as Uint8Array;
    const r = longestFlatBase({ grey, w: W, h: H }) as { runFraction: number };
    expect(r.runFraction, "a planet limb is an ALLOWED form (D97)").toBeLessThan(BAR);
  });

  it("the measure ignores what it is told to ignore", () => {
    // The HUD and the word plates are dark rectangles on sky and their bottom
    // edges are, correctly, flat bases. They are UI, not world, so the e2e masks
    // them; this asserts the masking works rather than assuming it.
    const grey = paintFlatBase(skyFrame(), W, H, {
      x0: 180,
      x1: 900,
      yTop: 220,
      yBase: 330,
    }) as Uint8Array;
    const masked = longestFlatBase({
      grey,
      w: W,
      h: H,
      exclude: [{ x0: 150, y0: 200, x1: 930, y1: 360 }],
    }) as { runFraction: number };
    expect(masked.runFraction).toBe(0);
  });

  it("a step smaller than MIN_STEP is not an edge", () => {
    const grey = paintFlatBase(skyFrame(), W, H, {
      x0: 180,
      x1: 900,
      yTop: 220,
      yBase: 330,
      // Four levels under the sky at that height: a shading change, not a mass.
      value: Math.round(206 - (206 - 70) * (330 / (H - 1))) - 4,
    }) as Uint8Array;
    const r = longestFlatBase({ grey, w: W, h: H }) as { runFraction: number };
    expect(MIN_STEP).toBeGreaterThan(4);
    expect(r.runFraction).toBe(0);
  });
});
