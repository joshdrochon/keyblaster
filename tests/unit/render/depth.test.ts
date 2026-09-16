import { describe, expect, it } from "vitest";
import {
  LIFT_MAX,
  MAX_COOL_SHIFT,
  PALETTE_STOP_IDS,
  atmospheric,
  coolShift,
  depthRamp,
  desaturate,
  foregroundInk,
  lightAngleOf,
  lightPositionOf,
  liftAt,
  paletteFor,
  relativeLuminance,
  rgbOf,
  rimOf,
  skyStops,
  skyStopsLate,
  atmosphereFor,
} from "../../../src/game/render/palette.js";
import { isBrightStop } from "../../../src/game/render/palette.js";

/**
 * THE DEPTH SYSTEM (design-reference/refs/WORLD-BAR.md, art-direction.md §2).
 *
 * The flight screen passed every visual check the rubric had - five layers,
 * five distinct speeds, a gradient that travels, zero Linear easing - and a
 * player looked at it and said "it's not giving 3D visuals at all". The bar
 * document says why: those checks measure the STACK, and depth is carried by
 * COLOUR. So the properties below are the ones nobody was measuring.
 *
 * They are deliberately written against all seven palettes rather than against
 * Mars. A depth ramp that reads on the one stop somebody eyeballed is the same
 * class of bug as a sky that travels at one stop, which is what `skyStopsLate`
 * had before this change.
 */

const STOPS = PALETTE_STOP_IDS.map((id) => paletteFor(id));

/** CIE76 deltaE, so "the sky demonstrably travels" is the same number AC-22.3 uses. */
function lab(hex: string): [number, number, number] {
  const { r, g, b } = rgbOf(hex);
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const rl = lin(r);
  const gl = lin(g);
  const bl = lin(b);
  const x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
  const y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  const z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** CIE L*, 0..100. The perceptual value axis - "value range" means this one. */
function lightness(hex: string): number {
  return lab(hex)[0];
}

function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** Distance from grey, 0..1. The saturation half of atmospheric perspective. */
function chroma(hex: string): number {
  const { r, g, b } = rgbOf(hex);
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

describe("WORLD-BAR item 2: the value range spans near-sky to near-black", () => {
  it("the far plane is close to the sky and the near plane is nowhere near it", () => {
    for (const p of STOPS) {
      const sky = skyStops(p)[1];
      const ramp = depthRamp(p, 4);
      const far = ramp[0] as string;
      const near = ramp[3] as string;
      // "Distant layers LIFT toward the sky colour and lose contrast until the
      // furthest ridge is nearly sky."
      const farGap = Math.abs(lightness(far) - lightness(sky));
      const nearGap = Math.abs(lightness(near) - lightness(sky));
      expect(nearGap, `${p.id}: the near plane must separate from the sky`).toBeGreaterThan(
        farGap * 3,
      );
    }
  });

  it("the ramp's two ends are a whole value range apart, not three steps of one brown", () => {
    for (const p of STOPS) {
      const ramp = depthRamp(p, 4);
      // Measured in L*, not in relative luminance: luminance is linear light
      // and compresses the whole dark end into a rounding error, so a night
      // stop with a real, visible value ladder would score near zero on it.
      const spread = Math.abs(lightness(ramp[0] as string) - lightness(ramp[3] as string));
      // The old `depthBands` mixed between two mid-tones. Half the L* range is
      // the floor for a frame that reads as having a front and a back.
      expect(spread, `${p.id} value spread`).toBeGreaterThan(40);
    }
  });

  it("the ramp is monotone, so the eye can order the planes", () => {
    for (const p of STOPS) {
      const ramp = depthRamp(p, 4).map(lightness);
      const descending = ramp.every((v, i) => i === 0 || v <= (ramp[i - 1] as number));
      const ascending = ramp.every((v, i) => i === 0 || v >= (ramp[i - 1] as number));
      expect(descending || ascending, `${p.id} ramp ${ramp.join(" -> ")}`).toBe(true);
    }
  });

  it("art-direction section 2: the foreground runs AWAY from the sky, either way", () => {
    // "Darker toward the camera on bright stops and lighter toward the camera
    // on dark stops." A black foreground on Earth's navy night sky is an
    // invisible one, and it is where a naive "make it near-black" rule fails.
    for (const p of STOPS) {
      const ink = lightness(foregroundInk(p));
      if (isBrightStop(p)) {
        expect(ink, `${p.id} is bright, so its foreground is the darkest thing`).toBeLessThan(
          Math.min(...p.colors.map(lightness)) + 1e-9,
        );
      } else {
        expect(ink, `${p.id} is dark, so its foreground is the lightest thing`).toBeGreaterThan(
          Math.max(...p.colors.map(lightness)) - 1e-9,
        );
      }
    }
  });
});

describe("WORLD-BAR item 1: atmospheric lift", () => {
  it("lift 0 leaves a colour alone and lift 1 all but dissolves it into the sky", () => {
    const sky = "#F1C79A";
    const fill = "#31140C";
    expect(atmospheric(fill, sky, 0)).toBe(fill);
    // Not identical to the sky: a fully lifted ridge is still a shape, and it
    // is COOLER than the air in front of it (`coolShift`). The claim is that it
    // has travelled almost all of the way there.
    const before = deltaE(fill, sky);
    const after = deltaE(atmospheric(fill, sky, 1), sky);
    expect(after).toBeLessThan(before / 4);
  });

  it("a lifted colour loses chroma as well as contrast", () => {
    // Doing only the mix is what makes a frame read as "tinted" rather than as
    // "distant" - real air takes the colour out of a shape too.
    const fill = "#B5522A";
    const sky = "#F1C79A";
    expect(chroma(atmospheric(fill, sky, 0.9))).toBeLessThan(chroma(fill));
  });

  it("compounds with distance rather than ramping evenly", () => {
    // Air thickness is not linear, and a linear ramp puts the mid-field halfway
    // to the sky, which reads as fog.
    const mid = liftAt(1, 4);
    expect(liftAt(0, 4)).toBeCloseTo(LIFT_MAX, 6);
    expect(liftAt(3, 4)).toBe(0);
    expect(mid).toBeLessThan(LIFT_MAX * 0.75);
    expect(mid).toBeGreaterThan(LIFT_MAX * 0.5);
  });

  it("is a single flat plane when there is only one", () => {
    expect(liftAt(0, 1)).toBe(0);
    expect(depthRamp(paletteFor("mars"), 1)).toHaveLength(1);
  });
});

describe("WORLD-BAR item 3: hue shifts with depth, within the palette's tolerance", () => {
  it("cooling raises blue and lowers red", () => {
    const before = rgbOf("#B5522A");
    const after = rgbOf(coolShift("#B5522A", 1));
    expect(after.b).toBeGreaterThan(before.b);
    expect(after.r).toBeLessThan(before.r);
  });

  it("is bounded, so no stop gains a colour it does not own (AC-22.7)", () => {
    for (const p of STOPS) {
      for (const c of p.colors) {
        const shifted = coolShift(c, 1);
        const moved = Math.max(
          Math.abs(rgbOf(shifted).r - rgbOf(c).r),
          Math.abs(rgbOf(shifted).b - rgbOf(c).b),
        );
        expect(moved / 255, `${p.id} ${c}`).toBeLessThanOrEqual(MAX_COOL_SHIFT * 1.3 + 0.01);
      }
    }
  });

  it("desaturate fully flattens a colour to a grey", () => {
    expect(chroma(desaturate("#B5522A", 1))).toBeCloseTo(0, 2);
    expect(chroma(desaturate("#B5522A", 0.5))).toBeLessThan(chroma("#B5522A"));
    expect(desaturate("#B5522A", 0)).toBe("#B5522A");
  });
});

describe("WORLD-BAR item 4: one light source, and it is placed", () => {
  it("every stop has a light angle and it is above the horizon", () => {
    for (const p of STOPS) {
      const a = lightAngleOf(p);
      expect(Math.sin(a), `${p.id} light points upward on screen`).toBeLessThan(0);
    }
  });

  it("the light sits inside the frame, so the player can see the source", () => {
    for (const p of STOPS) {
      const at = lightPositionOf(p);
      expect(at.x, p.id).toBeGreaterThan(0.02);
      expect(at.x, p.id).toBeLessThan(0.98);
      expect(at.y, p.id).toBeGreaterThan(0.05);
      expect(at.y, p.id).toBeLessThan(0.7);
    }
  });

  it("the light swings across the route rather than being the same everywhere", () => {
    const first = lightAngleOf(STOPS[0] as (typeof STOPS)[number]);
    const last = lightAngleOf(STOPS[STOPS.length - 1] as (typeof STOPS)[number]);
    expect(Math.abs(last - first)).toBeGreaterThan(1);
  });

  it("a rim is lighter than the fill it belongs to (art-direction §2)", () => {
    for (const p of STOPS) {
      for (const fill of depthRamp(p, 4)) {
        expect(relativeLuminance(rimOf(fill)), `${p.id} ${fill}`).toBeGreaterThan(
          relativeLuminance(fill),
        );
      }
    }
  });
});

describe("AC-22.3: the sky travels at EVERY stop, not just the one that was checked", () => {
  it("deltaE between the opening and closing sky is over 10 for all seven", () => {
    for (const p of STOPS) {
      const early = skyStops(p)[0];
      const late = skyStopsLate(p)[0];
      // The previous rule leaned on `colors[2]`, which left Saturn at 4.7 and
      // Pluto at 5.3 - two stops whose sky did not demonstrably travel while a
      // green e2e measured Mars.
      expect(deltaE(early, late), `${p.id}`).toBeGreaterThan(10);
    }
  });
});

describe("WORLD-BAR item 8: one atmosphere pass per stop", () => {
  it("every stop names a pass", () => {
    for (const id of PALETTE_STOP_IDS) {
      expect(atmosphereFor(id)).toBeTruthy();
    }
  });

  it("the pass is the stop's own weather, not one effect everywhere", () => {
    expect(atmosphereFor("mars")).toBe("dust");
    expect(atmosphereFor("saturn")).toBe("glitter");
    expect(atmosphereFor("neptune")).toBe("streaks");
    expect(new Set(PALETTE_STOP_IDS.map(atmosphereFor)).size).toBeGreaterThanOrEqual(3);
  });
});
