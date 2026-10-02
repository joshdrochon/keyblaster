import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { layer } from "@game/render/layers";
import { PLATE_LAYER_DEPTH } from "@game/flight/stage";

/**
 * UR-204. The nearest rocks pass IN FRONT of the ship and BEHIND the word.
 * Read out of the source because `FlightScene` imports Phaser.
 */
function nearOverShip(): { depth: number; alpha: number } {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/scenes/FlightScene.ts"),
    "utf8",
  );
  const d = /const NEAR_OVER_SHIP = PLATE_LAYER_DEPTH - ([\d.]+);/.exec(src);
  const a = /const NEAR_OVER_SHIP_ALPHA = ([\d.]+);/.exec(src);
  expect(d, "FlightScene no longer declares NEAR_OVER_SHIP this way").not.toBeNull();
  expect(a, "FlightScene no longer declares NEAR_OVER_SHIP_ALPHA this way").not.toBeNull();
  return { depth: PLATE_LAYER_DEPTH - Number(d?.[1]), alpha: Number(a?.[1]) };
}

describe("UR-204: the nearest rocks are foreground", () => {
  it("draws in FRONT of the ship", () => {
    expect(nearOverShip().depth).toBeGreaterThan(layer("shipFx").depth);
  });

  it("draws BEHIND the word plate, which the child is reading", () => {
    expect(nearOverShip().depth).toBeLessThan(PLATE_LAYER_DEPTH);
  });

  it("and behind the HUD, like everything else", () => {
    expect(nearOverShip().depth).toBeLessThan(layer("hud").depth);
  });

  it("still in front of the debris it crosses", () => {
    expect(nearOverShip().depth).toBeGreaterThan(layer("debris").depth);
  });

  it("is slightly see-through, because it now covers the ship", () => {
    const { alpha } = nearOverShip();
    expect(alpha).toBeLessThan(1);
    expect(alpha).toBeGreaterThan(0.7);
  });
});
