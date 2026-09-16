import { describe, expect, it } from "vitest";
import {
  LIFT_MAX,
  MAX_COOL_SHIFT,
  NEAR_PLANE_MAX_L,
  PALETTE_STOP_IDS,
  atmospheric,
  coolShift,
  depthRamp,
  desaturate,
  foregroundInk,
  foregroundObjectInk,
  lightAngleOf,
  lightPositionOf,
  liftAt,
  mixHex,
  paletteFor,
  relativeLuminance,
  rgbOf,
  rimOf,
  skyStops,
  skyStopsLate,
  warmShift,
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
      //
      // A NIGHT STOP CANNOT MEET THAT, AND SHOULD NOT PRETEND TO. Earth and
      // Neptune have a dark sky, and the near plane sits ABOVE it by a bounded
      // step (`foregroundInk`, and the bound below) - so the ramp's own span is
      // necessarily small. Forcing it to 40 means either a near plane pale
      // enough to read as a white frame, which is the defect this round exists
      // to fix, or a far plane darker than the sky it is supposed to dissolve
      // into. The frame's range comes from the sky gradient and the foreground
      // OBJECTS instead, and that is asserted separately below.
      expect(spread, `${p.id} value spread`).toBeGreaterThan(isBrightStop(p) ? 40 : 10);
    }
  });

  it("but the FRAME has a real range at every stop, night ones included", () => {
    // The honest version of the claim above, over everything the frame is drawn
    // with: the sky gradient, the four silhouette planes, and the near-black the
    // foreground objects take.
    for (const p of STOPS) {
      const values = [...depthRamp(p, 4), ...skyStops(p), foregroundObjectInk(p)].map(lightness);
      const span = Math.max(...values) - Math.min(...values);
      expect(span, `${p.id} frame value span`).toBeGreaterThan(isBrightStop(p) ? 55 : 28);
      // Judge note 1: "the darkest element is maybe 30% where the reference
      // foreground is near-black." Something in every frame is genuinely dark.
      expect(Math.min(...values), `${p.id} darkest element`).toBeLessThan(18);
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
      const sky = lightness(skyStops(p)[1] as string);
      if (isBrightStop(p)) {
        expect(ink, `${p.id} is bright, so its foreground is the darkest thing`).toBeLessThan(
          Math.min(...p.colors.map(lightness)) + 1e-9,
        );
      } else {
        expect(ink, `${p.id} is dark, so its foreground sits above its sky`).toBeGreaterThan(sky);
      }
    }
  });

  /**
   * THE BOUND THE WHITE SLABS NEEDED.
   *
   * The dark branch of `foregroundInk` used to return the palette's LIGHTEST
   * colour pushed 22% further toward white, which on Earth is cloud white taken
   * to near-white - and it was painting `canyonWalls` on the near plane. The
   * Title screen came out with two large near-white masses framing the left and
   * right edges: a pale border around the screen, not foreground terrain.
   *
   * It satisfied every assertion in this file at the time, because every one of
   * them was a FLOOR. "Separate from the sky" has no upper limit, so a near
   * plane could separate itself all the way to white and still pass. So this is
   * a bound in both directions, and the ceiling is the half that was missing.
   */
  it("the near plane sits a bounded distance from the sky - in BOTH directions", () => {
    for (const p of STOPS) {
      const near = lightness(depthRamp(p, 4)[3] as string);
      const sky = lightness(skyStops(p)[1] as string);
      const delta = near - sky;
      if (delta < 0) {
        // Bright stop: a near-black silhouette against a light sky. There is no
        // ceiling on this direction - dark is exactly what is wanted - but it
        // has to be a real silhouette and not a slightly-dimmer sky.
        expect(-delta, `${p.id} near plane must read as a silhouette`).toBeGreaterThan(25);
      } else {
        // Dark stop. A LIFT, not a brightness target.
        expect(delta, `${p.id} near plane must separate from the sky`).toBeGreaterThanOrEqual(8);
        expect(delta, `${p.id} near plane must not become a pale frame`).toBeLessThanOrEqual(22);
      }
      // And an absolute ceiling, whatever the sky is doing. Nothing at or under
      // L* 42 can read as pale. The old Earth value was L* 94.
      expect(near, `${p.id} near plane absolute value`).toBeLessThanOrEqual(NEAR_PLANE_MAX_L);
    }
  });

  it("the near plane is terrain and the foreground OBJECTS are the near-black", () => {
    // How the frame gets a genuinely dark element without the near plane having
    // to be it. A rock silhouetted against the near terrain is how the reference
    // builds its darkest value; painting the whole foreground black is not.
    for (const p of STOPS) {
      const obj = lightness(foregroundObjectInk(p));
      const near = lightness(depthRamp(p, 4)[3] as string);
      expect(obj, `${p.id} foreground object ink`).toBeLessThan(18);
      expect(obj, `${p.id} objects read against the near plane`).toBeLessThanOrEqual(near);
    }
  });
});

describe("WORLD-BAR item 1: atmospheric lift", () => {
  it("lift 0 leaves a colour alone and lift 1 all but dissolves it into the sky", () => {
    const sky = "#F1C79A";
    const fill = "#31140C";
    expect(atmospheric(fill, sky, 0)).toBe(fill);
    // "Dissolved into the sky" is a claim about VALUE and about contrast, and
    // that is what is measured. It is deliberately NOT a deltaE, because a fully
    // lifted ridge is still cooler than the air in front of it and the whole
    // point of widening `MAX_COOL_SHIFT` (judge note 3) was to make that hue
    // difference big enough to see. A deltaE bound here would have been a test
    // that fails when the fix works, which is how "all one brown" survived.
    const before = Math.abs(lightness(fill) - lightness(sky));
    const after = Math.abs(lightness(atmospheric(fill, sky, 1)) - lightness(sky));
    expect(after, "the far ridge has lost its value contrast with the sky").toBeLessThan(
      before / 5,
    );
    expect(chroma(atmospheric(fill, sky, 1))).toBeLessThan(chroma(sky));
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

  /**
   * Judge note 3: "One hue family. The 14% cool-shift cap is too timid to read.
   * Widen it and check against AC-22.7's palette tolerance rather than assuming
   * 14% is the ceiling."
   *
   * So the cap is measured rather than assumed, and it is measured against the
   * thing it is actually applied to. Testing `coolShift` on a RAW palette colour
   * (which the old bound test did) says nothing useful: the shift is only ever
   * applied to a colour that has already been mixed into the sky, and the
   * strongest shift lands on the farthest plane, which is 90% sky by then.
   */
  it("the hue shifts move the ramp enough to read, and not further", () => {
    for (const p of STOPS) {
      const sky = skyStops(p)[1] as string;
      const ink = foregroundInk(p);
      const ramp = depthRamp(p, 4);
      const moves = ramp.map((c, i) => {
        const t = liftAt(i, 4);
        // The same ramp with the hue work removed: haze and nothing else.
        const plain = mixHex(desaturate(ink, t * 0.55), sky, t);
        return deltaE(c, plain);
      });
      // Big enough to see somewhere on the ramp...
      expect(Math.max(...moves), `${p.id} strongest hue move`).toBeGreaterThan(8);
      // ...and nowhere large enough to be a colour the stop does not own. 26 is
      // roughly where a hazed mid-tone stops being recognisably the same family.
      for (const [i, m] of moves.entries()) {
        expect(m, `${p.id} plane ${i} hue move`).toBeLessThan(26);
      }
    }
  });

  it("the far end is cool and the near end is warm, on every stop", () => {
    // The actual complaint was "the image is all one brown", which is a
    // statement about the two ENDS, not about any one colour. Measured in a*b*
    // rather than as a hue angle, because hue angle is meaningless at the low
    // chroma the far planes sit at.
    for (const p of STOPS) {
      const ramp = depthRamp(p, 4);
      const [, fa, fb] = lab(ramp[0] as string);
      const [, na, nb] = lab(ramp[3] as string);
      expect(Math.hypot(fa - na, fb - nb), `${p.id} far/near hue separation`).toBeGreaterThan(8);
    }
  });

  it("warming never recolours something too dark to carry a hue", () => {
    // Warming a near-black turns it a visible maroon while moving its L* by less
    // than one step. On Uranus that put a red-black on the near plane of an ice
    // giant. The taper below L* 28 is what stops it.
    const nearBlack = "#0A0D0F";
    expect(deltaE(warmShift(nearBlack, 1), nearBlack)).toBeLessThan(4);
    const midTone = "#4A4C63";
    expect(deltaE(warmShift(midTone, 1), midTone)).toBeGreaterThan(4);
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
