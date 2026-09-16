import { describe, expect, it } from "vitest";
import {
  LAYERS,
  SCROLLING_LAYERS,
  cameraSwayPx,
  distinctSpeedCount,
  idleDriftPx,
  layer,
} from "../../../src/game/render/layers.js";
import {
  PARTICLES,
  particleSpec,
  signatureAxes,
} from "../../../src/game/render/particles.js";

describe("AC-22.1: parallax depth (D60 rubric 1)", () => {
  it("AC-22.1: at least five scrolling layers", () => {
    expect(SCROLLING_LAYERS.length).toBeGreaterThanOrEqual(5);
  });

  it("AC-22.1: at least five DISTINCT scroll speeds", () => {
    // Not "all distinct". debris and shipFx deliberately share 1.00: the rocks
    // and the Lantern occupy the same gameplay plane, and art-direction s2
    // gives them the same speed. Depth comes from the five distinct speeds
    // behind and in front of that plane.
    expect(distinctSpeedCount()).toBeGreaterThanOrEqual(5);
  });

  it("keeps the ship and the debris on one plane", () => {
    expect(layer("shipFx").speed).toBe(layer("debris").speed);
  });

  it("AC-22.1: speeds match art-direction section 2 exactly", () => {
    // These numbers ARE the rubric; changing one is an art-direction edit.
    //
    // `foreVeil` at 1.80 is an ADDITION to the doc's eight, documented in
    // layers.ts. Every layer the art direction lists is behind the ship, so
    // nothing had ever passed in FRONT of the Lantern and it read as pasted on
    // top of a moving picture. The AC is a floor ("at least five distinct
    // speeds"), so a sixth is the direction of travel, not a violation.
    const byId = Object.fromEntries(LAYERS.map((l) => [l.id, l.speed]));
    expect(byId).toEqual({
      sky: 0.0, celestial: 0.05, farField: 0.15, midField: 0.35,
      debris: 1.0, nearField: 1.3, shipFx: 1.0, foreVeil: 1.8, hud: 0.0,
    });
  });

  it("puts exactly one world layer in FRONT of the ship, under the HUD", () => {
    // The whole reason L6.5 exists. If this ever inverts, the ship is pasted on
    // top of the world again; if it climbs over the HUD, a readout gets veiled.
    expect(layer("foreVeil").depth).toBeGreaterThan(layer("shipFx").depth);
    expect(layer("foreVeil").depth).toBeLessThan(layer("hud").depth);
    expect(layer("foreVeil").speed).toBeGreaterThan(layer("nearField").speed);
    const inFront = LAYERS.filter(
      (l) => l.depth > layer("shipFx").depth && l.depth < layer("hud").depth,
    );
    expect(inFront.map((l) => l.id)).toEqual(["foreVeil"]);
  });

  it("orders depth back to front with no collisions", () => {
    const depths = LAYERS.map((l) => l.depth);
    expect(new Set(depths).size).toBe(depths.length);
    expect([...depths].sort((a, b) => a - b)).toEqual(depths);
  });

  it("keeps the HUD out of the scroll so it never rides over debris", () => {
    expect(layer("hud").speed).toBe(0);
    expect(layer("hud").depth).toBeGreaterThan(layer("debris").depth);
  });

  it("throws on an unknown layer rather than returning undefined", () => {
    // @ts-expect-error deliberately invalid
    expect(() => layer("nope")).toThrow();
  });
});

describe("AC-22.2: the idle frame is never still (D60 rubric 2)", () => {
  it("AC-22.2: at least two layers drift with no world scroll", () => {
    expect(LAYERS.filter((l) => l.idleDrift).length).toBeGreaterThanOrEqual(2);
  });

  it("AC-22.2: a drifting layer differs between two frames one second apart", () => {
    const mid = layer("midField");
    expect(idleDriftPx(mid, 0, false)).not.toBe(idleDriftPx(mid, 1000, false));
  });

  it("does not drift a layer that is not marked for it", () => {
    expect(idleDriftPx(layer("sky"), 1234, false)).toBe(0);
  });

  it("AC-19.3: drift survives reduced motion, sway does not", () => {
    // D41 removes shake and camera sway. It does not freeze the world: a
    // motionless starfield reads as a broken game, not a calm one.
    const near = layer("nearField");
    expect(cameraSwayPx(1500, true)).toBe(0);
    expect(cameraSwayPx(1500, false)).not.toBe(0);
    expect(idleDriftPx(near, 0, true)).not.toBe(idleDriftPx(near, 6000, true));
  });

  it("keeps camera sway inside the documented +/-2px", () => {
    for (let t = 0; t <= 12000; t += 97) {
      expect(Math.abs(cameraSwayPx(t, false))).toBeLessThanOrEqual(2 + 1e-9);
    }
  });

  it("completes one sway cycle every 6 seconds", () => {
    expect(cameraSwayPx(0, false)).toBeCloseTo(cameraSwayPx(6000, false), 9);
  });
});

describe("AC-22.6: particle signatures are distinguishable (D60 rubric 6)", () => {
  it("AC-22.6: the three named event systems all exist", () => {
    for (const id of ["blastShards", "strikeSpark", "warpStreaks"] as const) {
      expect(particleSpec(id).id).toBe(id);
    }
  });

  it("AC-22.6: each pair differs on at least three perceptual axes", () => {
    // Presence is not the bar. A shared emitter with three tints would pass a
    // naive check and fail the player.
    const ids = ["blastShards", "strikeSpark", "warpStreaks"] as const;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const axes = signatureAxes(particleSpec(ids[i]!), particleSpec(ids[j]!));
        expect(axes, `${ids[i]} vs ${ids[j]}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("gives warp the only directional spread, which is what makes it unmistakable", () => {
    const warp = particleSpec("warpStreaks");
    expect(warp.angle[1] - warp.angle[0]).toBeLessThan(20);
    expect(particleSpec("blastShards").angle).toEqual([0, 360]);
    expect(particleSpec("strikeSpark").angle).toEqual([0, 360]);
  });

  it("D28: the strike has no gravity and no explosion-length lifetime", () => {
    const strike = particleSpec("strikeSpark");
    expect(strike.gravityY).toBe(0);
    expect(strike.lifespanMs[1]).toBeLessThanOrEqual(300);
  });

  it("colours blast shards from the rock so the player sees which one died", () => {
    expect(particleSpec("blastShards").colorSource).toBe("debris");
  });

  it("AC-22.5: every particle system uses an eased curve, never Linear", () => {
    for (const p of PARTICLES) {
      expect(p.ease, p.id).not.toMatch(/linear/i);
      expect(["Cubic.Out", "Back.Out", "Sine.InOut", "Expo.Out"]).toContain(p.ease);
    }
  });

  it("throws on an unknown system rather than returning undefined", () => {
    // @ts-expect-error deliberately invalid
    expect(() => particleSpec("sparkles")).toThrow();
  });

  it("carries an ambient system so the flight frame is never still", () => {
    expect(particleSpec("dustMotes").lifespanMs[0]).toBeGreaterThan(1000);
  });
});
