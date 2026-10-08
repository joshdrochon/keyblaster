import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTE_STOP_IDS } from "@engine/types.js";
import { endingLayout, ENDING_TYPE } from "@game/scenes/support/endingLayout";
import { TYPE } from "@game/ui/theme";

/**
 * THE ENDING DRAWS ITS OWN MAP (owner, Oct 7).
 *
 * It opened on a camera zoom from 1.5, which scaled the whole frame - card,
 * type and button - and showed the finished layout CROPPED: the rail ran past
 * both edges, Shadow was half off the left and the button was cut off. The
 * beacon sweep then ran underneath it rather than after it. The rail draws
 * itself instead, one pulse at its head, a beacon blooming as it arrives.
 *
 *   npx vitest run tests/unit/scenes/endingRail.test.ts --coverage.enabled=false
 */

const SCENE = join(process.cwd(), "src/game/scenes/EndingScene.ts");
const scene = (): string => readFileSync(SCENE, "utf8");

const layout = () =>
  endingLayout({
    stopCount: ROUTE_STOP_IDS.length,
    closingLine: "Every ship that comes after us will see these. You drew the map.",
    headlineSize: ENDING_TYPE.heading,
    labelSize: 20,
    lineHeightEm: 1.3,
  });

describe("the camera no longer moves", () => {
  it("nothing zooms the frame", () => {
    const src = scene();
    expect(src).not.toContain("setZoom");
    expect(src).not.toMatch(/zoom:\s*1,/);
  });
});

describe("the rail draws itself, and the lamps follow the pulse", () => {
  it("travels at a CONSTANT speed, so every leg takes the same time", () => {
    // An ease that is slow at both ends made the first and last legs twice the
    // middle ones (measured 201-611 ms), and the blooms fell out of step with
    // the pulse - reported as drift from Uranus to Pluto.
    expect(scene()).toContain('ease: "Linear",');
  });

  it("the lamps are evenly spaced, which is what makes constant speed enough", () => {
    const xs = layout().lampX;
    expect(xs.length).toBe(ROUTE_STOP_IDS.length);
    const legs = xs.slice(1).map((x, i) => Math.round(x - (xs[i] as number)));
    expect(new Set(legs).size, `legs: ${legs.join(", ")}`).toBe(1);
  });

  it("a bloom lasts exactly one leg, derived rather than chosen", () => {
    const src = scene();
    expect(src).toContain(
      "const HALO_BLOOM_MS = Math.round(RAIL_DRAW_MS / (ROUTE_STOP_IDS.length - 1));",
    );
  });

  it("ONE pulse, at the head of the line, not one per leg", () => {
    const src = scene();
    // Drawn at the pen's own x, and only while the line is still being drawn.
    expect(src).toContain("if (!drawing) return;");
    expect(src).toContain("g.fillCircle(x, y, 6);");
    expect(src).not.toContain("routePulseX");
  });

  it("a leg wears the accent of the stop it LEAVES, like the map's route", () => {
    const src = scene();
    expect(src).toContain("const from = ROUTE_STOP_IDS[i - 1];");
    expect(src).toContain("g.lineStyle(4, hexToNum(paletteFor(from).accent), 0.55);");
  });
});

describe("a beacon blooms open, it does not simply appear", () => {
  it("opens from nothing to its resting size and stops there", () => {
    const src = scene();
    expect(src).toContain("const HALO_FROM = 0;");
    expect(src).toContain("scale: { from: HALO_FROM, to: 1 },");
  });

  it("uses an ease that cannot overshoot its resting radius", () => {
    // `pop` is a back-ease: it would carry the light past the radius it keeps.
    const bloom = scene().slice(scene().indexOf("scale: { from: HALO_FROM, to: 1 },"));
    expect(bloom.slice(0, 200)).toContain("ease: EASE.arrive,");
  });

  it("the halo is drawn at the origin so it swells around the bead", () => {
    // A Graphics scales about its own origin; circles cut at (cx, y) would have
    // bloomed away from the lamp instead of around it.
    const src = scene();
    expect(src).toContain("halo.fillCircle(0, 0, this.layout.lampHaloRadius);");
    expect(src).toContain("halo.setPosition(cx, y);");
  });

  it("reduced motion keeps the seven lit and drops only the drawing", () => {
    const src = scene();
    expect(src).toContain("lamp.halo.setAlpha(1).setScale(1);");
  });
});

describe("the title sits in the card, like every other card title", () => {
  it("is the shared heading size, not the stage report's STAT size", () => {
    expect(ENDING_TYPE.heading).toBe(TYPE.heading);
    expect(ENDING_TYPE.heading).not.toBe(TYPE.display);
  });

  it("is inside the route card, with the rail below it", () => {
    const l = layout();
    expect(l.headline.x).toBeGreaterThanOrEqual(l.routeBand.x);
    expect(l.headline.y).toBeGreaterThanOrEqual(l.routeBand.y);
    expect(l.headline.y + l.headline.h).toBeLessThanOrEqual(l.routeBand.y + l.routeBand.h);
    expect(l.rail.y).toBeGreaterThan(l.headline.y + l.headline.h);
  });

  it("is left-aligned on the card's inset, and carries no plate of its own", () => {
    const l = layout();
    expect(l.headlineAnchor.x).toBe(l.headline.x);
    expect(l.headlineAnchor.y).toBe(l.headline.y);
    expect(scene()).toContain("plated: true,");
  });
});
