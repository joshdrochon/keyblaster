import { describe, expect, it } from "vitest";
import {
  LAYERS_BELOW_PLATES,
  PLATE_LAYER_DEPTH,
} from "../../../src/game/flight/stage.js";
import { LAYERS, layer } from "../../../src/game/render/layers.js";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * UR-23 / AC-22.8: NOTHING THE WORLD DRAWS MAY REACH A WORD.
 *
 * ================== WHY THIS IS A UNIT TEST AT ALL ==================
 * The pixel proof is `tests/e2e/plate-legibility.spec.ts` and it is the one
 * that matters, because it measures the frame rather than a number. This file
 * exists because of HOW the defect survived: the plate layer sat at
 * `debris + 0.5` = 4.5, which is above every gameplay rock and below five other
 * things that draw over the playfield, and the only check on that number was an
 * e2e assertion comparing it to `debris` - the one layer it was already above.
 *
 * A check that only ever compares the plate to the rocks cannot see the
 * foreground. This one compares it to the whole of `LAYERS`.
 *
 * ================== `LAYERS` IS NOT THE WHOLE STACK ==================
 * An earlier version of this comment said it was, and that was a claim the file
 * did not hold up. `render/parallax.ts` draws two planes at depths that appear
 * NOWHERE in `LAYERS`, as private module constants:
 *
 *     VIGNETTE_DEPTH    5.6
 *     ATMOSPHERE_DEPTH  6.8
 *
 * The plate layer clears the atmosphere pass by 0.1 and nothing held that
 * margin, so a `setDepth(7.0)` added to `parallax.ts` tomorrow would ship UR-23
 * a third time with this file green. Neither constant is exported, so the
 * binding cannot be an import - it is a scan of the source that draws them,
 * which is exact because the thing to find is a numeric literal handed to
 * `setDepth` or assigned to a `*_DEPTH` constant.
 */
describe("UR-23: the word plate outranks every layer the world draws in", () => {
  it("draws above every world layer, named one by one", () => {
    expect(LAYERS_BELOW_PLATES.length).toBeGreaterThanOrEqual(8);
    for (const spec of LAYERS_BELOW_PLATES) {
      expect(
        PLATE_LAYER_DEPTH,
        `${spec.id} (${spec.note}) draws over a word plate`,
      ).toBeGreaterThan(spec.depth);
    }
  });

  it("stays UNDER the HUD, which is a different scene in its own keep-out", () => {
    // L7's rule is "own contrast plate, never over debris": the readouts live
    // in corners no rock enters, so putting plates above them would buy nothing
    // and would let a falling word cross the score.
    expect(PLATE_LAYER_DEPTH).toBeLessThan(layer("hud").depth);
  });

  /**
   * THE DEPTHS `LAYERS` DOES NOT KNOW ABOUT.
   *
   * Scans the renderer for depths written as literals and asserts every one is
   * below the plate layer, the HUD's own 7 excepted. This is the assertion that
   * would have caught the atmosphere pass at 6.8 if it had arrived after the
   * plate layer rather than before it.
   */
  it("no depth literal in the renderer outranks the plate layer", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const renderDir = path.resolve(here, "../../../src/game/render");
    const offenders: string[] = [];
    for (const entry of readdirSync(renderDir)) {
      if (!entry.endsWith(".ts")) continue;
      const src = readFileSync(path.join(renderDir, entry), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      const found = [
        ...src.matchAll(/setDepth\(\s*(\d+(?:\.\d+)?)\s*\)/g),
        ...src.matchAll(/\b[A-Z_]*DEPTH[A-Z_]*\s*=\s*(\d+(?:\.\d+)?)\s*;/g),
      ];
      for (const m of found) {
        const value = Number(m[1]);
        // `layer("hud").depth` is 7 and the HUD is a different scene that is
        // SUPPOSED to be on top; anything else at or above the plates is a
        // world layer that would cover a word.
        if (value >= PLATE_LAYER_DEPTH && value !== layer("hud").depth) {
          offenders.push(`${entry}: ${String(value)}`);
        }
      }
    }
    expect(offenders, "a renderer depth outranks the word plates (UR-23)").toEqual([]);
  });

  it("the scan can see the depths LAYERS does not carry", () => {
    // Anti-vacuity: if the scan finds nothing at all it is not scanning. The
    // atmosphere pass and the floor vignette are the two it exists for.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const parallax = readFileSync(
      path.resolve(here, "../../../src/game/render/parallax.ts"),
      "utf8",
    );
    expect(parallax).toMatch(/ATMOSPHERE_DEPTH\s*=\s*6\.8/);
    expect(parallax).toMatch(/VIGNETTE_DEPTH\s*=\s*5\.6/);
    // ...and both are under the plates, which is the property being protected.
    expect(PLATE_LAYER_DEPTH).toBeGreaterThan(6.8);
  });

  it("the HUD is the only thing it is under", () => {
    const above = LAYERS.filter((l) => l.depth >= PLATE_LAYER_DEPTH).map((l) => l.id);
    expect(above).toEqual(["hud"]);
  });

  /**
   * THE NEGATIVE CONTROL (D85, and the queue's "a check that cannot be made to
   * fail is not a check").
   *
   * The shipped value before UR-23, restated here rather than imported so that
   * reverting the constant cannot also revert the control. If the predicate
   * above passed at 4.5 it would be measuring nothing, because 4.5 is the value
   * a player looked at and reported.
   */
  it("would have FAILED at the value that shipped the defect", () => {
    const shippedDefect = layer("debris").depth + 0.5;
    expect(shippedDefect).toBe(4.5);
    const covered = LAYERS_BELOW_PLATES.filter((l) => l.depth > shippedDefect);
    expect(covered.map((l) => l.id)).toEqual(["nearField", "shipFx", "foreVeil"]);
  });
});
