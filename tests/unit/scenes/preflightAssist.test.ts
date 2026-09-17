import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PREFLIGHT_ASSIST_CEILING_MS,
  PREFLIGHT_ASSIST_GIVE_UP,
  RITUAL_BUDGET_MS,
  RITUAL_STEPS,
} from "@engine/calibration/index.js";

/**
 * D100 / `UR-31`: THE FIRST-RUN RITUAL IS NOT A GATE, AND STAYS NOT A GATE.
 *
 * `PreflightScene` imports Phaser, so the scene itself cannot be constructed in
 * this suite (CLAUDE.md: `src/engine` never imports Phaser, and the unit suite
 * runs in node). The two things worth holding about it are both properties of
 * the SOURCE, so the source is what is read - the same technique
 * `tests/unit/arch/profileWriters.test.ts` uses, and for the same reason: the
 * defect class this repo keeps hitting is code that is complete and correct and
 * simply never reached.
 *
 * THE REGRESSION THIS FILE EXISTS FOR. The assist window was originally written
 * for D99's launch ceremony and guarded with `this.mode === "launch" ? ... :
 * null`, which left the full first-run ritual exactly as trapped as it had
 * always been - the one screen where being stranded costs a child the entire
 * game, because they have not reached a belt yet. That guard is what this file
 * watches for. Re-introduce it and these assertions go red; that is the
 * negative control, and it has been seen to fail.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SCENE = readFileSync(
  resolve(HERE, "../../../src/game/scenes/PreflightScene.ts"),
  "utf8",
);

/** Read a `const NAME = 1_234;` out of the scene. */
function beat(name: string): number {
  const m = SCENE.match(new RegExp(`^const ${name} = ([\\d_]+);`, "m"));
  expect(m, `PreflightScene has no constant ${name}`).not.toBeNull();
  return Number(m![1]!.replace(/_/g, ""));
}

describe("PreflightScene's prompt assist (AC-11.7, D100)", () => {
  it("AC-11.7: the assist is armed for EVERY prompt, not only the launch ceremony", () => {
    // `=\s*` and not `= `, because prettier wraps the guarded form onto the
    // next line - which is exactly how it was written the first time, so a
    // pattern that only matched the one-line form would have missed the defect.
    const assignments =
      SCENE.match(/this\.assistAtMs =\s*[^;]+;/g)?.join("\n") ?? "";
    expect(assignments, "the scene never arms an assist window").toContain(
      "promptAssistMs",
    );
    // The guard that made UR-31: an assist that only exists in one mode.
    // `[^;]` spans newlines and stops at the end of the statement, so this
    // cannot be satisfied by a `mode === "launch"` somewhere else in the file.
    expect(
      /this\.assistAtMs =[^;]*mode === "launch"[^;]*;/.test(SCENE),
      "the assist is gated on mode again - the full ritual is a hard gate once more",
    ).toBe(false);
  });

  it("AC-11.7: the screen stops asking after PREFLIGHT_ASSIST_GIVE_UP untouched words", () => {
    expect(SCENE).toContain("PREFLIGHT_ASSIST_GIVE_UP");
    expect(SCENE).toContain("this.stoppedAsking = true");
    // And a completed word clears the counter, so one hard word is not two.
    expect(SCENE).toContain("this.assistedInARow = 0");
  });

  it("AC-11.7: nothing about being carried past is drawn (D31, AC-22b.1)", () => {
    // The assist branch may bank a word and move on. It may not say anything.
    const branch = SCENE.slice(
      SCENE.indexOf("if (this.assistAtMs !== null && time >= this.assistAtMs)"),
    ).slice(0, 700);
    expect(branch).not.toMatch(/setText|this\.say\(|label\(|retry|again/i);
  });

  it("AC-11.7: a pilot who types nothing is off the first-run ritual in 21.5 s", () => {
    // The arithmetic `tests/unit/calibration/promptAssist.test.ts` asserts,
    // pinned to the scene's OWN beats so the two cannot drift apart: lead, three
    // steps of intro+settle, finale, plus the two windows the give-up allows.
    const beats =
      beat("LEAD_MS") +
      3 * (beat("STEP_INTRO_MS") + beat("STEP_SETTLE_MS")) +
      beat("FINALE_MS");
    expect(beats).toBe(7_460);
    const worst = beats + PREFLIGHT_ASSIST_GIVE_UP * PREFLIGHT_ASSIST_CEILING_MS;
    expect(worst).toBe(21_460);
    expect(worst).toBeLessThan(RITUAL_BUDGET_MS * 1.1);
  });

  it("AC-11.6: a pilot who types nothing is off the launch ceremony in 20.1 s", () => {
    // UR-57 put words on all three steps, so all three now pay the TYPED beats;
    // the two that used to be spectators cost 760 ms each. 5.1 s -> 6.14 s.
    const beats =
      beat("LAUNCH_LEAD_MS") +
      3 * (beat("LAUNCH_STEP_INTRO_MS") + beat("LAUNCH_STEP_SETTLE_MS")) +
      beat("LAUNCH_FINALE_MS");
    expect(beats).toBe(6_140);
    const worst = beats + PREFLIGHT_ASSIST_GIVE_UP * PREFLIGHT_ASSIST_CEILING_MS;
    expect(worst).toBe(20_140);
    // 140 ms OVER D51's 20 s, and reported rather than trimmed to fit: the
    // ceremony was not shortened to buy back a seventh of a second on the one
    // path where a child types nothing at all. Same 10% latitude the ritual has.
    expect(worst).toBeGreaterThan(RITUAL_BUDGET_MS);
    expect(worst).toBeLessThan(RITUAL_BUDGET_MS * 1.1);
  });

  it("AC-11.6: the ADVERSARIAL worst case is 48.1 s, and it is on the record", () => {
    // The give-up needs two CONSECUTIVE words nobody touched. A child who
    // completes a word (resetting the counter) and is carried past the next,
    // alternating, never trips it - so the true upper bound is every word
    // taking its full window. Six words at the ceiling plus the beats.
    //
    // This is NOT trimmed to fit either. It needs a pilot who finishes some
    // words just inside 7 s and misses others, i.e. around 1200 ms per key;
    // the realistic slow-child figure is ~30.7 s (short words completed, the
    // long one carried). The number is asserted here so that a decision to
    // bound it - a whole-screen deadline - is a decision someone takes, not a
    // thing that quietly never got measured.
    const beats =
      beat("LAUNCH_LEAD_MS") +
      3 * (beat("LAUNCH_STEP_INTRO_MS") + beat("LAUNCH_STEP_SETTLE_MS")) +
      beat("LAUNCH_FINALE_MS");
    const maxWords = RITUAL_STEPS.reduce((n, s) => n + s.maxWords, 0);
    expect(maxWords).toBe(6);
    expect(beats + maxWords * PREFLIGHT_ASSIST_CEILING_MS).toBe(48_140);
  });

  it("AC-11.8: the scene stores what computeCalibration believed, gate and all", () => {
    // The gate lives inside `computeCalibration` rather than in a second
    // wrapper, so there is no version of this the scene can call by accident
    // that skips it. If that ever splits into two functions, this goes red.
    expect(SCENE).toContain("computeCalibration(this.played).calibration");
    expect(SCENE).toContain("persistCalibration(this, this.calibration)");
  });
});
