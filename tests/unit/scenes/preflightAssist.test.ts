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

  it("AC-11.6: the ADVERSARIAL worst case is 55.1 s, and it is on the record", () => {
    // The give-up needs two CONSECUTIVE words nobody touched. A child who
    // completes a word (resetting the counter) and is carried past the next,
    // alternating, never trips it - so the true upper bound is every word
    // taking its full window. Every planned word at the ceiling, plus the beats.
    //
    // This is NOT trimmed to fit either. It needs a pilot who finishes some
    // words just inside 7 s and misses others, i.e. around 1200 ms per key;
    // the realistic slow-child figure is ~30.7 s (short words completed, the
    // long one carried). The number is asserted here so that a decision to
    // bound it - a whole-screen deadline - is a decision someone takes, not a
    // thing that quietly never got measured.
    //
    // UR-101.3 MOVED THIS NUMBER, and that is the point of asserting it. The
    // systems check went from 3-4 short words to 4-5, so the plan's ceiling
    // went 6 words -> 7 and this bound went 48.1 s -> 55.1 s. It is the
    // adversarial path, not a path any measured pilot takes, but it is 7 s
    // worse than it was and nobody would have noticed without this line.
    //
    // WATCHED FAILING, before the source change: "expected 6 to be 7".
    const beats =
      beat("LAUNCH_LEAD_MS") +
      3 * (beat("LAUNCH_STEP_INTRO_MS") + beat("LAUNCH_STEP_SETTLE_MS")) +
      beat("LAUNCH_FINALE_MS");
    const maxWords = RITUAL_STEPS.reduce((n, s) => n + s.maxWords, 0);
    expect(maxWords).toBe(7);
    expect(beats + maxWords * PREFLIGHT_ASSIST_CEILING_MS).toBe(55_140);
  });

  it("AC-11.8: the scene stores what computeCalibration believed, gate and all", () => {
    // The gate lives inside `computeCalibration` rather than in a second
    // wrapper, so there is no version of this the scene can call by accident
    // that skips it. If that ever splits into two functions, this goes red.
    expect(SCENE).toContain("computeCalibration(this.played).calibration");
    expect(SCENE).toContain("persistCalibration(this, this.calibration)");
  });
});

/**
 * UR-101.2 / UR-101.5: WHAT THE SCENE HAS TO DO WITH THE BAR AND THE ROW SOUND.
 *
 * The arithmetic is pure and tested in `preflightLayout.test.ts`
 * (`checkBarProgress`); the sound is tested in `tests/unit/audio/pitch.test.ts`.
 * What is left is the half that has burned this repo repeatedly and that no
 * unit test of a pure function can see: whether the scene CALLS any of it, and
 * on which path. `PreflightScene` imports Phaser, so - as everywhere else in
 * this file - the source is what is read.
 */
describe("PreflightScene's check rows (UR-101.2, UR-101.5)", () => {
  const CODE = SCENE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("UR-101.2: the bar is no longer drawn only for a lit row", () => {
    // THE DEFECT, as a source property. `paintRow` guarded the whole bar with
    // `if (row.state === "lit")`, which is a progress bar with two positions.
    expect(CODE).not.toMatch(/if \(row\.state === "lit"\) \{\s*g\.fillStyle/);
    // The track is always drawn and the fill is proportional to a value.
    expect(CODE).toContain("barW * row.barShown");
  });

  it("UR-101.2: the value comes from the shared pure rule, not a second one", () => {
    // If the scene grew its own arithmetic, the tested rule and the drawn rule
    // would be two things - which is the shape of every geometry defect this
    // screen has had.
    expect(CODE).toContain("checkBarProgress({");
    // ...fed by the step's TOTAL keystrokes, which is the denominator the
    // sharpened brief asks for: one continuous fill across a step's words.
    expect(CODE).toContain("stepKeysTotal");
    expect(CODE).toContain("this.stepKeysTyped += 1");
  });

  it("UR-101.2: the target is a running maximum, so the bar cannot retreat", () => {
    // D31 in one line. A typo advances nothing and the reading holds; without
    // the `max` a dip in either input would draw a punishment.
    expect(CODE).toMatch(/barTarget = Math\.max\(\s*[^)]*barTarget,[^)]*stepProgress/);
  });

  it("UR-101.2: it lands at exactly full when the row lights", () => {
    // The give-up path skips a step's remaining words, so the bar has to be
    // completed rather than left wherever the clock reached.
    expect(CODE).toContain("row.barTarget = 1;");
    // ...and the easing snaps rather than approaching 1 for ever.
    expect(CODE).toContain("BAR_SNAP");
  });

  it("UR-101.2: the ease is the shortest thing on the product's duration scale", () => {
    // Named, not a literal: `DUR.focus` is 140 ms and is the token already
    // meaning "a control responding to input". A longer one and the child stops
    // connecting their typing to the bar, which is the whole item.
    expect(SCENE).toContain("const BAR_EASE_MS = DUR.focus;");
    // Reduced motion takes the value straight (AC-19.3).
    expect(CODE).toContain("reducedMotion");
  });

  it("UR-101.5: a row that lights plays the check cue, transposed by its index", () => {
    expect(CODE).toContain('play("lock", "preflight:check-row"');
    expect(CODE).toContain("pitchSemitones: systemCheckSemitones(index)");
  });

  it("UR-101.5: the sound and the fill are ONE event, not two near each other", () => {
    // The seam this item could have opened: a chime fired from one place and a
    // bar completed from another would drift by a frame or by a branch. Both
    // are in `lightRow` and nothing else sets either.
    const lightRow = CODE.slice(CODE.indexOf("private lightRow(")).slice(0, 400);
    expect(lightRow).toContain("row.barTarget = 1;");
    expect(lightRow).toContain('play("lock"');
    expect((CODE.match(/row\.barTarget = 1;/g) ?? []).length).toBe(1);
    expect((CODE.match(/play\("lock"/g) ?? []).length).toBe(1);
  });

  it("UR-101.5: the returning sequence gets the same instrument as a typed one", () => {
    // The "none" fallback lights rows on a timer. A returning pilot seeing a
    // silent, empty bar where a typing pilot sees a filling one is the shape of
    // UR-28 - two experiences of one screen - and it is not being rebuilt.
    expect(CODE).toContain("this.lightRow(next, this.rows.indexOf(next))");
  });

  it("AC-11.3: nothing about the bar reaches the screen as a number", () => {
    // The counts exist on the snapshot, which is not rendered, and `paintRow`
    // draws a LENGTH. No `setText`, no label, no percentage anywhere near it.
    const paint = CODE.slice(CODE.indexOf("private paintRow(")).slice(0, 1400);
    expect(paint).not.toMatch(/setText|label\(|toFixed|%/);
  });
});
