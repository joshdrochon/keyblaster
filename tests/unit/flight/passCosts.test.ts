import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HULL_PASS_COST, HULL_STRIKE_COST, hullAfterStrike, isStalled } from "@engine/hull/index.js";

/**
 * UR-91 / C20: A WORD THAT PASSES THE SHIP IS A FAILURE.
 *
 * ================== WHAT WAS REPORTED ==================
 * A belt could be finished without typing. The owner left Mars running and it
 * took about a minute to end; on another run they passed Mars without typing a
 * single word.
 *
 * ================== THE CAUSE ==================
 * `FlightScene.resolveAtBreachLine` sends a PRACTICE rock to `passBy` and
 * everything else to `breach`. `breach` costs a hull mark; `passBy` cost
 * nothing at all. The reasoning was D31/AC-22b.1 - the game put a practice word
 * back, so charging the child for the game's own re-teaching is the direction
 * D31 forbids. But once a few words are missed, most of what is falling IS
 * practice (D23 brings a missed word back sooner), so most of the belt was
 * free, and a child who types nothing misses everything and is charged for
 * almost none of it.
 *
 * ================== THE RULE NOW ==================
 * A direct hit costs a whole mark. A word that goes past the ship costs half of
 * one - still a failure, not the same event as a hit. Zero marks ends the run.
 *
 * C20 is logged against `@engine/hull`'s own header, which says there is no
 * deduction or penalty anywhere in the surface. The owner has overruled that
 * for the miss; D31 still governs the wording and the re-teaching.
 */
const source = (): string =>
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/scenes/FlightScene.ts"),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

describe("UR-91: a word past the ship costs half a mark", () => {
  it("prices a pass at half a strike, and both above zero", () => {
    expect(HULL_PASS_COST).toBe(0.5);
    expect(HULL_STRIKE_COST).toBe(1);
    expect(HULL_PASS_COST * 2).toBe(HULL_STRIKE_COST);
  });

  it("empties a full stage hull on passes alone, which is the whole report", () => {
    // Nine marks, eighteen passed words. Before this it was NEVER: a hull could
    // not be emptied by words going past, so a child who typed nothing finished
    // the belt.
    //
    // WATCHED FAILING, with `passBy` charging nothing:
    //   a belt of words nobody typed never empties the hull: expected 9 to be 0
    let hull = 9;
    for (let i = 0; i < 18; i += 1) hull = hullAfterStrike(hull, 9, HULL_PASS_COST);
    expect(hull, "a belt of words nobody typed never empties the hull").toBe(0);
    expect(isStalled(hull)).toBe(true);
    // And it takes twice as many as direct hits would, which is what "half"
    // has to mean.
    let byHits = 9;
    for (let i = 0; i < 9; i += 1) byHits = hullAfterStrike(byHits, 9);
    expect(isStalled(byHits)).toBe(true);
  });

  it("charges the pass in FlightScene, and ends the run when it empties", () => {
    // `FlightScene` extends a Phaser class and cannot be imported here, so the
    // wiring is a source guard - the arithmetic above proves nothing about
    // whether the scene calls it.
    //
    // WATCHED FAILING, with the free `passBy` restored:
    //   passBy costs the hull nothing, so a word can go past for free:
    //   expected false to be true
    const s = source();
    expect(
      /hullAfterStrike\(this\.hull, this\.maxHull, HULL_PASS_COST\)/.test(s),
      "passBy costs the hull nothing, so a word can go past for free",
    ).toBe(true);
    // A pass must be able to END the run, not merely dent it.
    const passBy = s.slice(s.indexOf("private passBy("), s.indexOf("private breach("));
    expect(
      /isStalled\(this\.hull\)/.test(passBy),
      "a pass can empty the hull without ending the run",
    ).toBe(true);
    expect(/this\.shakeBy\(/.test(passBy), "a pass gives no feedback at all").toBe(true);
  });

  it("drops a passed rock straight down rather than sliding it sideways", () => {
    // It used to tween `x: target.x + drift` with drift +/-80, which reads as
    // the rock being deflected by something. Nothing deflects it.
    //
    // WATCHED FAILING, with the drift restored:
    //   a passed rock still slides sideways on its way off screen:
    //   expected true to be false
    const s = source();
    const passBy = s.slice(s.indexOf("private passBy("), s.indexOf("private breach("));
    expect(
      /drift/.test(passBy),
      "a passed rock still slides sideways on its way off screen",
    ).toBe(false);
    // DOWN, and by the rock's own fall distance rather than to a fixed point
    // off the bottom of the frame. It used to read `y: this.scale.height + 160`
    // - a constant 384 px from the breach line on `Cubic.Out`, which is the
    // UR-92 lurch (`./rockMotion.test.ts` has the px/s). The claim this test
    // makes is unchanged: the rock moves in y and never in x. What it can no
    // longer do is pin the destination, because the destination is now a
    // function of how fast the rock was falling.
    expect(/y: target\.y \+ exitPx/.test(passBy)).toBe(true);
    expect(/passByExitPx\(rock\.fromY, rock\.toY, rock\.fallMs/.test(passBy)).toBe(true);
    expect(
      /ease: "Linear"/.test(passBy),
      "the exit is back on an easing curve, which is where the speed-up was",
    ).toBe(true);
    expect(/x: /.test(passBy), "a passed rock is being moved in x").toBe(false);
  });
});
