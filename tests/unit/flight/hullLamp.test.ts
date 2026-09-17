import { describe, expect, it } from "vitest";
import {
  HULL_MARK_COUNT,
  HULL_MARK_DIM,
  LAMP_GUTTER_FRACTION,
  LAMP_MIN,
  hullAfterShield,
  hullAfterStrike,
  hullForStage,
  hullLampLevel,
  hullLampStep,
  hullMarkAlpha,
} from "../../../src/engine/hull/index.js";

/**
 * UR-22 - "noticed the hull can take infinite damage?"
 *
 * The rule was never the defect. `isStalled` has always ended the belt at zero
 * and `FlightScene.breach` has always called it. What the player was reporting
 * is that TAKING DAMAGE DID NOT LOOK LIKE ANYTHING, so the hull read as
 * bottomless.
 *
 * The number underneath that: a 58-word stage carries nine marks and the HUD
 * draws three, so one hit moved a 16x16 square from alpha 1.00 to 0.72. This
 * file is about the quantity that replaced it - how much the Lantern's own
 * light moves per hit - and about the comparison, because a fix that moved
 * something by a similarly invisible amount would look identical in code.
 */
describe("UR-22: one hit has to be visible", () => {
  /** `hullForStage`: an 18-word stage, the shipped 58, and the long tail. */
  const STAGES = [18, 40, 58, 120];

  it("the lamp is full at a full hull and never goes out at an empty one", () => {
    for (const words of STAGES) {
      const max = hullForStage(words);
      expect(hullLampLevel(max, max), `${words} words`).toBeCloseTo(1, 10);
      // D31: it dims, it does not disappear. The ship is still flying.
      expect(hullLampLevel(0, max), `${words} words`).toBeCloseTo(LAMP_MIN, 10);
      expect(hullLampLevel(0, max)).toBeGreaterThan(0);
    }
  });

  it("EVERY hit moves it, at every stage length", () => {
    for (const words of STAGES) {
      const max = hullForStage(words);
      let hull = max;
      const levels = [hullLampLevel(hull, max)];
      while (hull > 0) {
        hull = hullAfterStrike(hull, max);
        levels.push(hullLampLevel(hull, max));
      }
      expect(levels.length, `${words} words`).toBe(max + 1);
      for (let i = 1; i < levels.length; i += 1) {
        const step = (levels[i - 1] as number) - (levels[i] as number);
        expect(step, `${words} words, hit ${i}`).toBeCloseTo(hullLampStep(max), 10);
        expect(step, `${words} words, hit ${i}`).toBeGreaterThan(0);
      }
    }
  });

  /**
   * THE BAR, and it is a comparison rather than a constant.
   *
   * "Visible" is not a number anyone can derive from first principles, so this
   * does not invent one. It measures the new feedback against the feedback the
   * player CALLED INVISIBLE, in the two ways the old one failed: how much the
   * alpha moves, and how much painted area that alpha applies to.
   *
   * Old: 0.28 of alpha on a 16x16 square = 256 px, so 72 alpha-px.
   * New: 0.087 of alpha on a glow of radius 132 = 54,700 px, so 4,700 alpha-px.
   *
   * ALPHA x AREA IS A PROXY AND IS NAMED AS ONE. It is not a model of vision;
   * it is the two quantities that differ between the feedback the player called
   * invisible and the feedback replacing it, multiplied. The alpha step is
   * deliberately SMALLER than the old one - the defect was never that the number
   * was too small, it was that the number was applied to a hundredth of a
   * percent of the screen, in a corner, while the player was reading a word in
   * the middle of it. The area is the fix.
   *
   * The pixel measurement is `tests/e2e/hull-feedback.spec.ts`, which reads the
   * frame; this is the arithmetic that says what that frame should show.
   */
  it("applies its step to a surface the player is already looking at", () => {
    const max = hullForStage(58);
    expect(max).toBe(9);

    // Read out of the shipped function, not recomputed: three marks over nine
    // hull means the mark carrying the hit moves by a third of its own range,
    // which is 0.28 and not (1 - HULL_MARK_DIM) / 9.
    const markStep = hullMarkAlpha(2, max, max) - hullMarkAlpha(2, hullAfterStrike(max, max), max);
    expect(markStep).toBeGreaterThan(HULL_MARK_DIM);
    const markAreaPx = 16 * 16;
    const lampStep = hullLampStep(max);
    // `FlightScene.drawHullLamp`: the outermost ring.
    const lampAreaPx = Math.PI * 132 * 132;

    expect(lampStep).toBeGreaterThan(0.05);
    expect(lampStep * lampAreaPx).toBeGreaterThan(markStep * markAreaPx * 50);
  });

  it("the moment is a drop-out, not a flash: a hit never ADDS light", () => {
    const max = hullForStage(58);
    for (let hull = max; hull > 0; hull -= 1) {
      const after = hullAfterStrike(hull, max);
      const settled = hullLampLevel(after, max);
      const atTheInstant = settled * LAMP_GUTTER_FRACTION;
      // Below where it was, and well below where it is going: a light that
      // brightened on damage would be an alarm, and D31 has no alarms.
      expect(atTheInstant).toBeLessThan(settled);
      expect(atTheInstant).toBeLessThan(hullLampLevel(hull, max));
    }
  });

  it("a canister brightens it again, by exactly what a hit took", () => {
    const max = hullForStage(58);
    const damaged = hullAfterStrike(hullAfterStrike(max, max), max);
    const repaired = hullAfterShield(damaged, max);
    expect(hullLampLevel(repaired, max) - hullLampLevel(damaged, max)).toBeCloseTo(
      hullLampStep(max),
      10,
    );
  });

  /**
   * THE NEGATIVE CONTROL (D85): the shipped feedback, measured, failing the bar
   * it was given. Without this the test above is a tautology about two numbers
   * nobody has compared to the thing that went wrong.
   */
  it("the three dimming pips - the feedback that was reported - do NOT clear it", () => {
    const max = hullForStage(58);
    expect(HULL_MARK_COUNT).toBe(3);
    const before = hullMarkAlpha(2, max, max);
    const after = hullMarkAlpha(2, hullAfterStrike(max, max), max);
    const step = before - after;
    // The exact number a player looked at and called infinite.
    expect(before).toBeCloseTo(1, 10);
    expect(after).toBeCloseTo(0.72, 2);
    expect(step * 16 * 16).toBeLessThan(hullLampStep(max) * Math.PI * 132 * 132 * 0.02);
  });
});
