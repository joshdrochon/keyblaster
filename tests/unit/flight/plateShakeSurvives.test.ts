import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * AC-3.2 REGRESSION: THE SHAKE THAT WAS OVERWRITTEN EVERY FRAME.
 *
 * `WordPlate.shake()` was implemented and covered, and the coverage asserted
 * that a tween was created - which it was. What nothing asserted was that the
 * displacement ever reached the screen. It did not, for the whole life of the
 * feature.
 *
 * The plate is deliberately NOT a child of the rock's container: the rock
 * tumbles and the word must not (art-direction 4). So `FlightScene.updateRocks`
 * carries it by hand -
 *
 *     rock.plate.setPosition(rock.container.x, rock.container.y + offsetY);
 *
 * - on EVERY frame. The shake wrote straight into `this.x`, and the carrier
 * overwrote it one frame later. A mistyped key has never visibly moved the
 * word, which is what the owner reported.
 *
 * `WordPlate` extends a Phaser container and cannot be imported under vitest's
 * node environment (see that file's own header), which is precisely why the
 * defect was invisible to the suite. A source guard is what CAN be asserted
 * here, so it asserts the two halves of the fix by name rather than pretending
 * to a runtime check this environment cannot perform.
 */
const SRC = "src/game/render/wordPlate.ts";
const SCENE = "src/game/scenes/FlightScene.ts";

describe("AC-3.2: a mistype's shake survives the frame that carries the plate", () => {
  const src = readFileSync(SRC, "utf8");

  it("the carrier really does rewrite the plate's position every frame", () => {
    // If this stops being true the guard below is no longer needed - but it is
    // the reason the guard exists, so it is asserted rather than assumed.
    expect(readFileSync(SCENE, "utf8")).toMatch(/rock\.plate\.setPosition\(rock\.container\.x/);
  });

  it("shake moves an offset, never this.x directly", () => {
    const body = src.slice(src.indexOf("  shake("), src.indexOf("  get shakeOffsetX("));
    expect(
      body,
      "shake() assigns this.x, which the flight loop overwrites on the next frame",
    ).not.toMatch(/this\.x\s*=/);
    expect(body).toMatch(/setShakeOffsetX\(/);
  });

  it("setPosition re-applies the offset instead of wiping it", () => {
    expect(
      src,
      "setPosition is not overridden, so the carrier erases a shake in progress",
    ).toMatch(/override setPosition\([^)]*\)/);
    expect(src).toMatch(/super\.setPosition\(\(x \?\? 0\) \+ this\.shakeOffsetX_/);
  });
});
