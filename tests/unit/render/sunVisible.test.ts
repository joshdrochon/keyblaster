import { describe, expect, it } from "vitest";
import { STOP_IDS } from "@engine/types";
import { isBrightStop, lightPositionOf, mixHex, paletteAt, skyStops } from "@game/render/palette";
import { readFileSync } from "node:fs";
import { deltaE, hexToLab } from "@game/flight/stage";
import {
  lightBandX,
  sunGeometry,
  sunRadius,
  sunScaleForStop,
  sunWarmthForStop,
} from "@game/render/sunScale";

/**
 * THE SUN IS DRAWN AT EVERY STOP, AND AT EVERY STOP YOU CAN SEE IT (UR-119).
 *
 * ================== THE TWO DEFECTS ==================
 * The owner, from the screen: Neptune's sun looks smaller than Pluto's, and
 * Mars, Jupiter and Saturn look like they have no sun at all. Both were real
 * and both came from one line deciding something it had no business deciding.
 *
 * 1. SIZE. `sunRadius` was `isBrightStop(pal) ? 86 : 48` and was then
 *    multiplied by `sunScale.ts`'s 1.00 -> 0.34 route curve. A 79% step chosen
 *    by SKY BRIGHTNESS swamped the curve, so the drawn radius was not
 *    monotonic in distance: earth 48.0, mars 76.5, jupiter 67.1, saturn 57.6,
 *    uranus 48.2, neptune 21.6, pluto 29.2. The sun GREW leaving Earth, and
 *    Pluto's was 35% bigger than Neptune's from three times further out.
 *
 * 2. VISIBILITY. The fill was `mixHex(skyTop, "#FFFFFF", bright ? 0.9 : 0.74)`.
 *    Ninety per cent of the way to white, on a sky that is already pale, IS
 *    the sky. Pluto measured deltaE 4.1 from its own sky - `#FEFEFE` on
 *    `#F2F4F8` - against this project's bar of 10.
 *
 * ================== WHY DELTA-E ==================
 * A luminance contrast ratio cannot see this fix: by that measure Mars goes
 * 1.50 -> 1.22 and the change looks like a regression. There is nowhere
 * brighter to go on a near-white sky, so the separation is bought in CHROMA,
 * and deltaE is what this project already measures colour separation with
 * (AC-22.3, `render/depth.test.ts`, the rubric's deltaE 10).
 */

const skyTopOf = (id: (typeof STOP_IDS)[number]): string => skyStops(paletteAt(id, false))[0];

const SUN_WARM = "#F6A93B";
const coreFor = (id: (typeof STOP_IDS)[number]): string => {
  const pal = paletteAt(id, false);
  const skyTop = skyStops(pal)[0];
  return isBrightStop(pal)
    ? mixHex(skyTop, SUN_WARM, sunWarmthForStop(id))
    : mixHex(skyTop, "#FFFFFF", 0.74);
};
/**
 * The SHIPPED radius, not a copy of the formula. The copy is how UR-160 hid:
 * `parallax` applied the route curve twice and this file could not tell.
 */
const radiusFor = (id: (typeof STOP_IDS)[number]): number => sunRadius(paletteAt(id, false));

describe("the sun shrinks along the route and never grows", () => {
  it("is strictly smaller at every stop than at the one before", () => {
    // `sunScale.ts` says the disc should be "smaller at every stop". Nothing
    // enforced it, because the brightness step was applied after the curve.
    const radii = STOP_IDS.map(radiusFor);
    for (let i = 1; i < radii.length; i += 1) {
      expect(
        radii[i]!,
        `${STOP_IDS[i]} (${radii[i]!.toFixed(1)}) is not smaller than ${STOP_IDS[i - 1]} (${radii[i - 1]!.toFixed(1)})`,
      ).toBeLessThan(radii[i - 1]!);
    }
  });

  it("the two inversions the owner reported are gone by name", () => {
    // Pluto is three times further out than Neptune and had the bigger sun.
    expect(radiusFor("pluto")).toBeLessThan(radiusFor("neptune"));
    // And the sun grew on the way out of Earth.
    expect(radiusFor("mars")).toBeLessThan(radiusFor("earth"));
  });

  it("size no longer depends on how bright the sky is", () => {
    // THE DEFECT'S MECHANISM. Neptune (dark) and Pluto (bright) are adjacent on
    // the route, so if brightness still moved the radius these two would be the
    // pair it showed up on.
    expect(isBrightStop(paletteAt("neptune", false))).toBe(false);
    expect(isBrightStop(paletteAt("pluto", false))).toBe(true);
    const ratio = radiusFor("neptune") / radiusFor("pluto");
    const curve = sunScaleForStop("neptune") / sunScaleForStop("pluto");
    expect(ratio).toBeCloseTo(curve, 6);
  });
});

describe("the disc is tellable from its own sky at every stop", () => {
  it("clears the project's deltaE bar of 10 everywhere", () => {
    for (const id of STOP_IDS) {
      const d = deltaE(hexToLab(coreFor(id)), hexToLab(skyTopOf(id)));
      expect(d, `${id}: the sun is deltaE ${d.toFixed(1)} from its sky`).toBeGreaterThan(10);
    }
  });

  it("clears it with real margin on the five that were failing", () => {
    // mars 30.9, jupiter 18.0, saturn 26.8, uranus 15.9, pluto 4.1 before.
    // Not asserted at the old numbers - asserted well clear of them, so a
    // future palette edit that drifts back toward the sky fails here first.
    for (const id of ["mars", "jupiter", "saturn", "uranus", "pluto"] as const) {
      const d = deltaE(hexToLab(coreFor(id)), hexToLab(skyTopOf(id)));
      expect(d, `${id} is only deltaE ${d.toFixed(1)} from its sky`).toBeGreaterThan(30);
    }
  });

  it("the two dark stops are untouched, because white already worked there", () => {
    // Earth 71.3 and Neptune 71.9 before AND after. Warming these would take
    // separation away, not add it.
    for (const id of ["earth", "neptune"] as const) {
      expect(isBrightStop(paletteAt(id, false))).toBe(false);
      const d = deltaE(hexToLab(coreFor(id)), hexToLab(skyTopOf(id)));
      expect(d).toBeGreaterThan(60);
    }
  });

  it("NEGATIVE CONTROL: the old rule fails this file", () => {
    // What shipped, so "the bar is clearable" is not mistaken for "the bar is
    // loose". Pluto is the one that proves it.
    const old = (id: (typeof STOP_IDS)[number]): string =>
      mixHex(skyTopOf(id), "#FFFFFF", isBrightStop(paletteAt(id, false)) ? 0.9 : 0.74);
    const failing = STOP_IDS.filter(
      (id) => deltaE(hexToLab(old(id)), hexToLab(skyTopOf(id))) <= 10,
    );
    expect(failing).toEqual(["pluto"]);
  });
});

/**
 * ================== AND IT HAS TO BE INSIDE THE GLASS (UR-120) ==================
 *
 * The owner, on the Mars briefing: "I see no sun in the window". It was drawn,
 * at the right size and now in the right colour - and at x 0.334 of the FRAME,
 * which on that screen is behind the briefing card. Briefing and Pre-flight
 * mask the parallax to a 812 px aperture at x 1012 (0.527..0.950 of 1920), and
 * `lightPositionOf` sweeps the route across the whole frame:
 *
 *     earth 0.259  mars 0.334  jupiter 0.415  saturn 0.500
 *     uranus 0.585  neptune 0.666  pluto 0.741
 *
 * The four that fall left of 0.527 are exactly the four reported missing. The
 * three that happened to land inside are why it looked like a per-stop bug
 * rather than a placement rule that was never written.
 */

const bandX = lightBandX;

describe("on a windowed screen the sun is inside the glass", () => {
  const WIN = { x: 1012, w: 812 };
  const FRAME_W = 1920;
  const at = (id: (typeof STOP_IDS)[number]): number =>
    lightPositionOf(paletteAt(id, false)).x;

  it("NEGATIVE CONTROL: the old full-frame placement missed the glass at four stops", () => {
    const outside = STOP_IDS.filter((id) => {
      const cx = FRAME_W * at(id);
      return cx < WIN.x || cx > WIN.x + WIN.w;
    });
    expect(outside).toEqual(["earth", "mars", "jupiter", "saturn"]);
  });

  it("every stop's disc now lands wholly within the aperture", () => {
    for (const id of STOP_IDS) {
      const r = radiusFor(id);
      const cx = bandX(at(id), r, FRAME_W, WIN);
      expect(cx - r, `${id}: the sun's left edge is outside the glass`).toBeGreaterThanOrEqual(
        WIN.x,
      );
      expect(cx + r, `${id}: the sun's right edge is outside the glass`).toBeLessThanOrEqual(
        WIN.x + WIN.w,
      );
    }
  });

  it("keeps the route's own left-to-right sweep, it does not bunch them", () => {
    // Remapping from the formula's theoretical +/-0.42 range instead of the
    // measured one would squeeze all seven into the middle of the glass.
    const xs = STOP_IDS.map((id) => bandX(at(id), radiusFor(id), FRAME_W, WIN));
    for (let i = 1; i < xs.length; i += 1) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(WIN.w * 0.5);
  });

  it("an unbanded screen is untouched, because the frame IS the view there", () => {
    // Flight and the Title pass no band and must keep the full-frame sweep.
    for (const id of STOP_IDS) {
      expect(bandX(at(id), radiusFor(id), FRAME_W)).toBeCloseTo(FRAME_W * at(id), 6);
    }
  });

  it("both windowed screens actually pass the band", () => {
    const briefing = readFileSync("src/game/scenes/BriefingScene.ts", "utf8");
    const preflight = readFileSync("src/game/scenes/PreflightScene.ts", "utf8");
    for (const [name, src] of [["Briefing", briefing], ["Pre-flight", preflight]] as const) {
      expect(src, `${name} masks the stack but places the light on the full frame`).toMatch(
        /lightBand:\s*\{\s*x:\s*WINDOW\.x,\s*w:\s*WINDOW\.w\s*\}/,
      );
    }
  });
});

/**
 * UR-152: the Title's sun clears the wordmark, and holds still.
 *
 * `lightPositionOf` says its y was chosen so the disc sits "clear of a headline
 * band" — true at the old radius 48, and NOT true once UR-119 took Earth's to
 * 80. Nothing asserted it: the prose was the only thing holding the constraint.
 */
describe("UR-152: the Title's sun stays out of the wordmark", () => {
  const FRAME_H = 1080;
  const earthR = radiusFor("earth");
  const sunCy = (): number => lightPositionOf(paletteAt("earth", false)).y * FRAME_H;

  it("sits behind the wordmark, which is the layer's own brief", async () => {
    // `layers.celestial` is "the stop's planet, large and partially framed", so
    // overlapping the mark is intended. What is NOT allowed is arriving there
    // later: the defect was the disc walking down into it over ~20 seconds.
    const { WORDMARK_Y } = await import("@game/scenes/support/titleLayout");
    expect(Number.isFinite(WORDMARK_Y)).toBe(true);
    expect(sunCy()).toBeGreaterThan(0);
    expect(sunCy() - earthR).toBeLessThan(WORDMARK_Y);
  });

  it("the celestial layer is pinned, so the sun does not walk into the mark", () => {
    // It is in SCROLLS and the Title runs a non-zero worldSpeed, so without a
    // pin it falls at speed * worldSpeed and arrives at the wordmark.
    const src = readFileSync("src/game/scenes/TitleScene.ts", "utf8");
    expect(src).toMatch(/pin: \["celestial"\]/);
    const par = readFileSync("src/game/render/parallax.ts", "utf8");
    expect(par).toMatch(/PINNED\.has\(spec\.id\) \|\| pinned\.has\(spec\.id\)/);
  });
});

describe("the route curve is applied exactly once (UR-160)", () => {
  it("draws Pluto at the radius the curve says, not at its square", () => {
    const pal = paletteAt("pluto", false);
    expect(sunGeometry(pal, 1920, 1080).r).toBeCloseTo(80 * sunScaleForStop("pluto"), 6);
  });

  it("has no second scale factor at the call site", () => {
    const src = readFileSync("src/game/render/parallax.ts", "utf8");
    expect(src).not.toMatch(/sunRadius\(pal\)\s*\*/);
    expect(src).not.toMatch(/sunScaleForStop/);
  });

  it("keeps decorative debris off the disc", () => {
    const src = readFileSync("src/game/render/parallax.ts", "utf8");
    expect(src).toMatch(/SUN_KEEP_CLEAR_R/);
    expect(src).toMatch(/cx: sunZone\.cx/);
  });
});

describe("the far stops are colder than the near ones (UR-162)", () => {
  it("mixes less warmth at every step out along the route", () => {
    const mixes = STOP_IDS.map(sunWarmthForStop);
    for (let i = 1; i < mixes.length; i += 1) {
      expect(mixes[i]!, `${STOP_IDS[i]} is not cooler than ${STOP_IDS[i - 1]}`).toBeLessThan(
        mixes[i - 1]!,
      );
    }
  });

  it("does not spend separation it does not need", () => {
    // The owner read Pluto's disc as a desert sun. Warmth is what buys the
    // deltaE, so the far end takes only as much as clears the bar with margin.
    const d = deltaE(hexToLab(coreFor("pluto")), hexToLab(skyTopOf("pluto")));
    expect(d).toBeGreaterThan(30);
    expect(d).toBeLessThan(45);
  });
});

describe("the lip is an edge, not a ring round the disc (UR-162)", () => {
  const lipFor = (id: (typeof STOP_IDS)[number]): string => {
    const pal = paletteAt(id, false);
    const skyTop = skyStops(pal)[0];
    const toward = isBrightStop(pal)
      ? mixHex(skyTop, SUN_WARM, Math.min(1, sunWarmthForStop(id) * 1.35))
      : "#FFFFFF";
    return mixHex(coreFor(id), toward, 0.7);
  };

  it("is not drawn at all on a bright stop", () => {
    // The owner read it as a border round the sun. The warm core already
    // clears its own sky by 32-52, so the stroke was buying nothing.
    const src = readFileSync("src/game/render/parallax.ts", "utf8");
    expect(src).toMatch(/if \(!isBrightStop\(pal\)\) \{\n    g\.lineStyle/);
  });

  it("stays on the dark stops, where white on near-black needs the edge", () => {
    for (const id of ["earth", "neptune"] as const) {
      const d = deltaE(hexToLab(lipFor(id)), hexToLab(coreFor(id)));
      expect(d, `${id}: lip is deltaE ${d.toFixed(1)} from its own core`).toBeGreaterThan(0);
    }
  });
});
