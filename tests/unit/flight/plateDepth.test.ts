import { describe, expect, it } from "vitest";
import {
  LAYERS_BELOW_PLATES,
  PLATE_LAYER_DEPTH,
} from "../../../src/game/flight/stage.js";
import { LAYERS, layer } from "../../../src/game/render/layers.js";

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
 * foreground. This one compares it to the WHOLE STACK, derived from `LAYERS`,
 * so a layer added in front of the ship tomorrow fails here the day it is added
 * rather than the day a player reports a covered word.
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
