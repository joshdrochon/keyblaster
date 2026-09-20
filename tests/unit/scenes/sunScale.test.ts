import { describe, expect, it } from "vitest";
import { STOP_IDS } from "@engine/types.js";
import { sunScaleForStop } from "@game/render/sunScale";

/**
 * THE SUN WAS THE SAME SIZE AT MARS AND AT PLUTO.
 *
 * The beacon screen prints the distance on the very same frame - Pluto reads
 * `r 35.61 AU` - so the sky contradicted a number the child could read off it.
 *
 * This is deliberately NOT the physical law. True angular size goes as 1/r,
 * which puts Pluto's disc at about 1.3 px: correct, invisible, and it would
 * delete the only visible light source in a frame whose every rim and
 * silhouette is lit by it. What is asserted here is the SHAPE - smaller at
 * every stop, never larger, ending materially smaller than it began.
 */
describe("the sun shrinks as the route goes out", () => {
  it("is strictly smaller at every stop than the one before it", () => {
    let prev = Number.POSITIVE_INFINITY;
    for (const stop of STOP_IDS) {
      const scale = sunScaleForStop(stop);
      expect(scale, `${stop} is not smaller than the stop before it`).toBeLessThan(prev);
      prev = scale;
    }
  });

  it("keeps the disc visible at the far end rather than erasing the light", () => {
    const pluto = sunScaleForStop(STOP_IDS[STOP_IDS.length - 1]);
    // A frame lit from nowhere is a worse lie than a generous disc.
    expect(pluto).toBeGreaterThan(0.25);
    expect(pluto).toBeLessThan(0.5);
  });

  it("an unknown or absent stop is the near size, which is what every caller had before", () => {
    expect(sunScaleForStop(undefined)).toBe(1);
    expect(sunScaleForStop("nowhere" as never)).toBe(1);
  });
});
