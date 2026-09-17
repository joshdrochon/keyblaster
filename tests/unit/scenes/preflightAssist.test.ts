import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PREFLIGHT_ASSIST_CEILING_MS,
  PREFLIGHT_ASSIST_GIVE_UP,
  RITUAL_BUDGET_MS,
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

  it("AC-11.6: a pilot who types nothing is off the launch ceremony in 19.1 s", () => {
    const beats =
      beat("LAUNCH_LEAD_MS") +
      2 * (beat("LAUNCH_ROW_INTRO_MS") + beat("LAUNCH_ROW_SETTLE_MS")) +
      (beat("LAUNCH_STEP_INTRO_MS") + beat("LAUNCH_STEP_SETTLE_MS")) +
      beat("LAUNCH_FINALE_MS");
    expect(beats).toBe(5_100);
    const worst = beats + 2 * PREFLIGHT_ASSIST_CEILING_MS;
    expect(worst).toBe(19_100);
    expect(worst).toBeLessThan(RITUAL_BUDGET_MS);
  });

  it("AC-11.8: the scene stores what computeCalibration believed, gate and all", () => {
    // The gate lives inside `computeCalibration` rather than in a second
    // wrapper, so there is no version of this the scene can call by accident
    // that skips it. If that ever splits into two functions, this goes red.
    expect(SCENE).toContain("computeCalibration(this.played).calibration");
    expect(SCENE).toContain("persistCalibration(this, this.calibration)");
  });
});
