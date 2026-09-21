import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TABLES } from "@engine/i18n/strings";

/**
 * UR-78: WHAT THE WARP BREAK SAYS, AND WHAT HAPPENS WHEN IT IS ANSWERED.
 *
 * Four reports from the project owner against this screen, all in one place
 * because they are one change: the screen used to name itself, under-explain
 * the task, hide its charge mark inside the track, and answer a completed
 * sentence with a hard cut.
 *
 * `WarpScene.ts` extends a Phaser class and cannot be imported under vitest's
 * node environment, so the wiring half is a source guard - the same binding
 * `tests/unit/flight/plateSeparation.test.ts` uses for the same reason. The
 * COPY half is not: `@engine/i18n/strings` is pure data and is asserted
 * directly, because a string is the one thing here that can be checked rather
 * than grepped.
 */
const source = (): string =>
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/scenes/WarpScene.ts"),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

describe("UR-78: the warp break says what to do and then gets out of the way", () => {
  it("names the asteroid belt and points at the sentence", () => {
    // The old line said the belt was clear without saying WHICH belt, and told
    // the player to "type this" without saying what "this" was.
    //
    // WATCHED FAILING, with the old string restored:
    //   expected 'Belt cleared. Type this to charge the warp drive.' to contain
    //   'Asteroid belt cleared'
    //
    // IT CHARGES A BEACON NOW, NOT A DRIVE. The belt is AT the stop, so there
    // is nowhere to drive to; the sentence charges the beacon the very next
    // scene plants. Watched failing again when the fiction was recast:
    //   expected 'Asteroid belt cleared. Type the sentence below to charge the
    //   warp drive.' to contain 'charge the beacon'
    const line = TABLES.en["warp.beltCleared"];
    expect(line).toContain("Asteroid belt cleared");
    expect(line).toContain("Type the sentence below");
    expect(line).toContain("charge the beacon");
  });

  it("does not draw the screen's own name at the player", () => {
    // WATCHED FAILING, with the tab restored:
    //   the warp break tab is back; the screen names itself to a reader who is
    //   already looking at it: expected true to be false
    expect(
      /warp\.heading/.test(source()),
      "the warp break tab is back; the screen names itself to a reader who is " +
        "already looking at it",
    ).toBe(false);
    // The string itself is KEPT so restoring the tab stays a layout change
    // rather than a translation job - and it is kept IN STEP with the screen,
    // so the one string nobody draws cannot be where the old fiction survives.
    //   expected 'Warp Break' to be 'Charging The Beacon'
    expect(TABLES.en["warp.heading"]).toBe("Charging The Beacon");
  });

  it("draws the charge bolt once, in the gold the percentage is drawn in", () => {
    // Inside the track the mark was behind the fill, so it was painted twice -
    // the stop's accent under and the sunken ink over. Beside the label it is
    // one drawing, and it matches the number it is measuring with.
    //
    // WATCHED FAILING, with the two in-track draws restored:
    //   the charge bolt is painted more than once, which only the old in-track
    //   placement needed: expected 2 to be 1
    const painted = source().match(/paintBolt\(/g) ?? [];
    expect(
      painted.length,
      "the charge bolt is painted more than once, which only the old in-track " +
        "placement needed",
    ).toBe(1);
    expect(/paintBolt\([\s\S]{0,200}?INK\.accent/.test(source())).toBe(true);
    expect(
      /boltBesideLabel\(/.test(source()),
      "the bolt is no longer placed off the label's measured bounds",
    ).toBe(true);
  });

  it("clears the screen and flies the ship out before it cuts to Beacon", () => {
    const s = source();
    expect(
      /clearAndLaunch\(\)/.test(s),
      "the exit sequence is gone; a finished sentence cuts straight to Beacon",
    ).toBe(true);
    // THE CUT BELONGS TO THE EXIT, NOT TO THE WORLD'S ACCELERATION. This is the
    // assertion that actually holds the report: if `cutToBeacon` goes back on
    // the acceleration tween's onComplete, the ship is still on screen when the
    // scene changes and the takeoff is never seen.
    //
    // WATCHED FAILING, with the cut put back on the acceleration tween:
    //   the cut fires from the world's acceleration, so the scene changes while
    //   the ship is still on screen: expected 2 to be 1
    const cuts = s.match(/this\.cutToBeacon\(\)/g) ?? [];
    expect(
      cuts.length,
      "the cut fires from the world's acceleration, so the scene changes while " +
        "the ship is still on screen",
    ).toBe(1);
    // UR-166: AND IT IS NOT A NUMBER ANY MORE. It was
    // `delayedCall(SHIP_LAUNCH_DELAY_MS + SHIP_LAUNCH_MS)`, a constant that had
    // to be kept equal to the longest tween by hand and was not - Shadow's exit
    // was computed backwards off it. The cut waits on the tweens themselves.
    expect(
      /tween\.once\("complete", done\)/.test(s),
      "the cut is back on a timer rather than on the things it is waiting for",
    ).toBe(true);
    expect(
      /delayedCall\(\s*SHIP_LAUNCH_DELAY_MS \+ SHIP_LAUNCH_MS/.test(s),
      "the exit is timed by a constant again",
    ).toBe(false);
    // Up and OFF, not up and back: a negative target is past the top edge.
    expect(/y: -SHIP_EXIT_CLEARANCE_PX/.test(s)).toBe(true);
  });

  it("keeps the beat under reduced motion instead of skipping it", () => {
    // D41 is reduced MOTION, not reduced story. The one setting that exists for
    // children who are hurt by movement must not be the one setting that cuts
    // the reward for finishing the sentence.
    const s = source();
    expect(/reduced \? EASE\.arrive : "Cubic\.In"/.test(s)).toBe(true);
    expect(
      /reduced[\s\S]{0,60}\{ alpha: 0 \}/.test(s),
      "reduced motion no longer has its own exit; it either flies or skips",
    ).toBe(true);
  });
});
