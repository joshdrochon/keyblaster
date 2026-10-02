import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LAYERS, layer } from "@game/render/layers";

/**
 * UR-197. A gold accent diamond drew on top of a falling asteroid.
 *
 * Two earlier attempts moved the light tile to 4.99 and then 3.99 and changed
 * nothing, because the rocks are drawn on FOUR planes (2, 3, 4, 5) and both
 * depths still sat above the lower two. Verified by sliding a diamond onto a
 * grey rock: visible at 4.99 and 3.99, hidden at 1.5.
 */
function nearLightDepth(): number {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/render/parallax.ts"),
    "utf8",
  );
  const m = /const NEAR_LIGHT_DEPTH = layer\("(\w+)"\)\.depth - (\d+(?:\.\d+)?);/.exec(src);
  expect(m, "parallax.ts no longer declares NEAR_LIGHT_DEPTH this way").not.toBeNull();
  return layer(m?.[1] as never).depth - Number(m?.[2]);
}

/** Every plane that draws rock silhouettes, from `DEBRIS_SPEC`. */
const ROCK_PLANES = ["farField", "midField", "debris", "nearField"] as const;

describe("UR-197: a point of light never covers a rock", () => {
  it("draws behind EVERY plane that carries rocks, not just the debris plane", () => {
    for (const id of ROCK_PLANES) {
      expect(nearLightDepth(), `${id} rocks draw behind the lights`).toBeLessThan(layer(id).depth);
    }
  });

  it("the two depths that shipped and did not fix it both fail this", () => {
    for (const bad of [4.99, 3.99]) {
      expect(ROCK_PLANES.some((id) => layer(id).depth < bad)).toBe(true);
    }
  });

  it("still draws over the sky and the planet, so it is not buried", () => {
    expect(nearLightDepth()).toBeGreaterThan(layer("celestial").depth);
  });

  it("no rock plane is added below the lights without this failing", () => {
    const lowestRock = Math.min(...ROCK_PLANES.map((id) => layer(id).depth));
    const below = LAYERS.filter((l) => l.depth < lowestRock).map((l) => l.id);
    expect(below).toEqual(["sky", "celestial"]);
  });
});
