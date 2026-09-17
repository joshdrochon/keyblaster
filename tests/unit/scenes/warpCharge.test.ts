/**
 * The warp drive's CHARGING SOUND (AC-21.3, AC-22.5; the player's own words:
 * "the warp drive progress bar should actually make noise when its charging
 * up, and the progress bar should ease, not just jolt forward").
 *
 * The rule was written inside `WarpScene.soundCharge`, where it could not be
 * tested without booting Phaser - so it never was. It is a pure function of two
 * numbers, so it lives here instead and the scene calls it.
 *
 * WHAT THE RULE HAS TO GET RIGHT, and why each one is a real bug if it does not:
 *
 *   THE STEP TRACKS THE FILL. The pitch of the tick under each keystroke IS the
 *   meter. A child watching their hands hears how close they are; a flat tick
 *   tells them nothing and is what the screen used to do.
 *   THE SPOOL LANDS THREE TIMES. Once per third, rising a fifth each time, so
 *   it reads as a drive spooling up rather than as a metronome.
 *   NOTHING SPOOLS AT 100%. `beginWarp` fires the stinger there and the stinger
 *   has to arrive into a gap it owns.
 *   A STAGE NEVER REPEATS OR GOES BACKWARDS. A typo leaves the fill where it
 *   was (AC-16.2), and re-spooling on every keystroke at the same fill is the
 *   "ticking" failure this replaced.
 */

import { describe, expect, it } from "vitest";
import {
  CHARGE_SPOOL_STAGES,
  CHARGE_STEP_SEMITONE_RANGE,
  chargeSoundPlan,
} from "../../../src/game/scenes/support/warpCharge.js";

describe("the charge step tracks the fill", () => {
  it("rises monotonically with the fill, across the whole bar", () => {
    let previous = -1;
    for (let i = 0; i <= 20; i += 1) {
      const pitch = chargeSoundPlan(1, i / 20).step.pitchSemitones;
      expect(pitch).toBeGreaterThanOrEqual(previous);
      previous = pitch;
    }
  });

  it("spans exactly the declared range: silence to an octave", () => {
    expect(chargeSoundPlan(1, 0).step.pitchSemitones).toBe(0);
    expect(chargeSoundPlan(1, 1).step.pitchSemitones).toBe(CHARGE_STEP_SEMITONE_RANGE);
    expect(chargeSoundPlan(1, 0.5).step.pitchSemitones).toBeCloseTo(
      CHARGE_STEP_SEMITONE_RANGE / 2,
      6,
    );
  });

  it("clamps rather than transposing into nonsense", () => {
    // `chargeFraction` cannot exceed 1, but a scene is not the place to find
    // out what happens if it ever does.
    expect(chargeSoundPlan(1, 4).step.pitchSemitones).toBe(CHARGE_STEP_SEMITONE_RANGE);
    expect(chargeSoundPlan(1, -2).step.pitchSemitones).toBe(0);
    expect(chargeSoundPlan(1, Number.NaN).step.pitchSemitones).toBe(0);
  });

  it("a step is played for every accepted character, including the last", () => {
    for (const f of [0, 0.01, 0.5, 0.99, 1]) {
      expect(chargeSoundPlan(1, f).step.gainScale).toBeGreaterThan(0);
    }
  });
});

describe("the drive spools once per third, rising", () => {
  it("the first accepted character spools at the bottom of the range", () => {
    const plan = chargeSoundPlan(0, 0);
    expect(plan.spool).not.toBe(null);
    expect(plan.spool?.pitchSemitones).toBe(0);
    expect(plan.stage).toBe(1);
  });

  it("crossing a third spools again, a fifth higher each time", () => {
    const first = chargeSoundPlan(0, 0);
    const second = chargeSoundPlan(first.stage, 0.4);
    const third = chargeSoundPlan(second.stage, 0.7);
    expect(second.spool?.pitchSemitones).toBe(7);
    expect(third.spool?.pitchSemitones).toBe(14);
    expect(third.stage).toBe(CHARGE_SPOOL_STAGES);
  });

  it("does not spool again inside a third it has already sounded", () => {
    const first = chargeSoundPlan(0, 0);
    for (const f of [0.05, 0.1, 0.2, 0.32]) {
      expect(chargeSoundPlan(first.stage, f).spool).toBe(null);
    }
  });

  it("never spools at a full bar - the stinger owns that moment", () => {
    expect(chargeSoundPlan(2, 1).spool).toBe(null);
    expect(chargeSoundPlan(1, 1).spool).toBe(null);
    expect(chargeSoundPlan(0, 1).spool).not.toBe(null); // ...unless nothing has
    // sounded at all, which is a one-character sentence: it still gets a sound.
  });

  it("a stage never goes backwards, so a typo cannot re-spool", () => {
    // AC-16.2: a typo leaves the fill exactly where it was.
    const at = chargeSoundPlan(0, 0.8);
    const again = chargeSoundPlan(3, 0.8);
    expect(again.spool).toBe(null);
    expect(again.stage).toBe(3);
    expect(at.stage).toBeGreaterThan(0);
  });

  it("a fast typist who jumps a third still only spools once", () => {
    // Paste-speed input can cross two thirds between frames. One landing, not
    // two stacked on the same tick.
    const plan = chargeSoundPlan(1, 0.99);
    expect(plan.spool).not.toBe(null);
    expect(plan.stage).toBe(CHARGE_SPOOL_STAGES);
  });

  it("the spool gets louder as it climbs, and never exceeds unity", () => {
    const stages = [chargeSoundPlan(0, 0), chargeSoundPlan(1, 0.4), chargeSoundPlan(2, 0.7)];
    const gains = stages.map((s) => s.spool?.gainScale ?? 0);
    expect(gains[0]).toBeLessThan(gains[1] as number);
    expect(gains[1]).toBeLessThan(gains[2] as number);
    for (const g of gains) expect(g).toBeLessThanOrEqual(1);
  });
});

describe("AC-22.5: the meter EASES, and never on a linear curve", () => {
  it("the scene's meter tween is not configured with a Linear ease", () => {
    // AC-22.5 forbids Linear anywhere in a tween config. The warp meter is the
    // one bar in this game that moves on every keystroke, so it is the most
    // likely place for one to appear.
    const source = readWarpScene();
    const tweens = source.match(/ease:\s*[^,\n]+/g) ?? [];
    expect(tweens.length).toBeGreaterThan(0);
    expect(tweens.filter((t) => /linear/i.test(t))).toEqual([]);
  });

  it("the meter is painted from the EASED value, never from the raw fraction", () => {
    // The distinction is the whole feature: the state is exact and instant
    // (AC-16.3 reads exactly 1 on the final character) and only the pixels lag.
    // A `paintMeter` that read `chargeFraction` directly would jolt again, and
    // the AC-16.3 tests would not notice because they read the state.
    const source = readWarpScene();
    const paint = source.slice(source.indexOf("private paintMeter"));
    const body = paint.slice(0, paint.indexOf("\n  }"));
    expect(body).toContain("this.meterShown");
    expect(body).not.toContain("chargeFraction");
  });

  it("every accepted keystroke goes through the easing call, not a direct paint", () => {
    const source = readWarpScene();
    expect(source).toContain("this.easeMeterTo(chargeFraction(this.sentence))");
  });
});

function readWarpScene(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("node:fs").readFileSync(
    require("node:path").join(process.cwd(), "src/game/scenes/WarpScene.ts"),
    "utf8",
  ) as string;
}
