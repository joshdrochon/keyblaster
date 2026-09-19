import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CREATE_STEPS,
  ENABLED_CREATE_STEPS,
  type CreateStep,
  backFromCreateStep,
  createStepAt,
  freshCreateDraft,
  isCreateStepEnabled,
  nextCreateStep,
  showsCreateStepCounter,
} from "@game/scenes/support/createFlow";

/**
 * SCREEN 2, TRIMMED TO WHAT IS FINISHED - AND THE NAME FIELD THAT REMEMBERED
 * THE LAST CHILD.
 *
 * ================== THE TWO DEFECTS ==================
 * 1. THE FLOW LIED ABOUT ITSELF. Pilot creation was three beats, two of them
 *    unfinished, and the first screen printed "Step 1 of 3" over a journey the
 *    owner did not want a child taking tonight.
 * 2. THE NAME FIELD WAS PRE-FILLED WITH THE PREVIOUS PILOT'S NAME. Phaser
 *    builds each scene ONCE (`boot.ts`: `game.scene.add(key, klass, false)`)
 *    and `scene.start` re-runs `create()` on that same instance, so
 *    `private pilotName = ""` ran once per page load, not once per visit. The
 *    second child to open "new pilot" was shown the first child's name, on the
 *    one screen in the game whose entire purpose is a NEW pilot. The mark they
 *    chose and the beat the screen opened on came back with it.
 *
 * ================== WHAT THIS FILE CAN AND CANNOT PROVE ==================
 * `ProfileCreateScene.ts` extends a Phaser class and cannot be driven under
 * vitest's node environment - the same boundary `tests/unit/scenes/warpExit`
 * and `titleFocusHold` state for the same reason. So it is two halves, and the
 * seam is drawn where it can be checked rather than glossed:
 *
 *   1. THE DECISIONS ARE REAL AND PURE. Which beat is next, which beat commits
 *      the profile, whether Esc leaves the screen, whether a step counter is
 *      honest, and what a freshly mounted screen holds are all
 *      `support/createFlow.ts`, exercised here on BOTH step lists - the one
 *      that ships and the full one the owner restores with a single line.
 *   2. THE WIRING IS A SOURCE GUARD, aimed at the two ways this comes back:
 *      the scene hard-coding a beat index again, and any draft value surviving
 *      as a class-field initialiser.
 *
 * The end-to-end proof - a pilot created, the screen re-entered, the
 * placeholder back - is `tests/e2e/profile.spec.ts`, with screenshots.
 *
 * ================== WATCHED FAILING ==================
 * Printed values are recorded in the report for this change; each assertion
 * below was run first against the shipped three-beat scene.
 */

const source = (): string =>
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../src/game/scenes/ProfileCreateScene.ts",
    ),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

/** The full flow, as the one-line restore brings it back. */
const RESTORED: readonly CreateStep[] = CREATE_STEPS;

describe("the trimmed pilot-creation flow is two questions and a confirm", () => {
  it("ships only the beat that is finished, and names the two that are hidden", () => {
    expect(ENABLED_CREATE_STEPS).toEqual(["pilot"]);
    // Stated positively as well, so a typo in the list is a named failure
    // rather than a screen that quietly loses a beat.
    expect(isCreateStepEnabled("pilot")).toBe(true);
    expect(isCreateStepEnabled("ship")).toBe(false);
    expect(isCreateStepEnabled("shipName")).toBe(false);
  });

  it("completes creation from the look step: the last enabled beat commits", () => {
    // The pilot beat IS the look beat - the name field and the six marks are
    // one screen - so with the flow trimmed the forward button on it is not a
    // "next" at all. It creates the pilot.
    expect(nextCreateStep(0)).toBe("commit");
    // And with the full flow restored, the same call is a step forward and the
    // commit moves to the last beat. One list drives both.
    expect(nextCreateStep(0, RESTORED)).toBe(1);
    expect(nextCreateStep(1, RESTORED)).toBe(2);
    expect(nextCreateStep(2, RESTORED)).toBe("commit");
  });

  it("makes the hidden beats unreachable: no index addresses them", () => {
    expect(createStepAt(0)).toBe("pilot");
    expect(createStepAt(1)).toBeNull();
    expect(createStepAt(2)).toBeNull();
    // Nothing can walk forward into one either: the only forward move from the
    // last enabled index is the commit.
    for (let i = 0; i < ENABLED_CREATE_STEPS.length; i += 1) {
      const next = nextCreateStep(i);
      if (next !== "commit") expect(createStepAt(next)).not.toBeNull();
    }
    expect(createStepAt(1, RESTORED)).toBe("ship");
    expect(createStepAt(2, RESTORED)).toBe("shipName");
  });

  it("AC-18.1 keeps the screen returnable: Esc from the first beat leaves", () => {
    expect(backFromCreateStep(0)).toBe("exit");
    expect(backFromCreateStep(0, RESTORED)).toBe("exit");
    expect(backFromCreateStep(1, RESTORED)).toBe(0);
    expect(backFromCreateStep(2, RESTORED)).toBe(1);
  });

  it("draws no step counter over a single-step flow, and draws one again when the flow returns", () => {
    // The removed line. It said "Step 1 of 3" on a screen that was the whole
    // journey; the total was a literal `3` in the scene.
    expect(showsCreateStepCounter()).toBe(false);
    expect(showsCreateStepCounter(RESTORED)).toBe(true);
  });

  it("takes its beat and its counter from the list, never from a literal index", () => {
    const text = source();
    expect(
      /createStepAt\(/.test(text),
      "the create scene no longer asks createFlow which beat it is on",
    ).toBe(true);
    expect(
      /nextCreateStep\(/.test(text),
      "the create scene decides for itself where 'next' goes, so the hidden " +
        "beats can be walked into again",
    ).toBe(true);
    expect(
      /showsCreateStepCounter\(/.test(text),
      "the step counter is drawn unconditionally again, so it can lie about " +
        "how many beats there are",
    ).toBe(true);
    // The specific line that lied: a hard-coded total of three.
    expect(
      /total:\s*3\b/.test(text),
      "the step counter is back to a literal total of 3",
    ).toBe(false);
    // And the beats are addressed by name, not by the index they happen to sit
    // at once two of them are hidden.
    expect(
      /this\.step\s*===\s*[0-9]/.test(text),
      "a beat is selected by a literal index again",
    ).toBe(false);
  });
});

describe("a freshly mounted create screen holds nobody's name", () => {
  const blank = { avatarId: "avatar-1", shipId: "ship-1", shipName: "Lantern" };

  it("starts empty, on the first beat, whatever the last visit left behind", () => {
    const draft = freshCreateDraft(blank);
    // A completed creation, exactly as the previous child left it.
    draft.pilotName = "Rin";
    draft.avatarId = "avatar-3";
    draft.step = 0;

    const second = freshCreateDraft(blank);
    expect(second.pilotName).toBe("");
    expect(second.avatarId).toBe("avatar-1");
    expect(second.shipId).toBe("ship-1");
    expect(second.shipName).toBe("Lantern");
    expect(second.step).toBe(0);
    // Two mounts are two objects: filling one in cannot reach the other.
    expect(second).not.toBe(draft);
  });

  it("rebuilds the draft on every mount, and keeps no draft value in a class field", () => {
    const text = source();
    expect(
      /this\.draft\s*=\s*freshCreateDraft\(/.test(text),
      "the create screen no longer starts each visit from a blank draft, so " +
        "the previous child's name comes back",
    ).toBe(true);
    // `build()` is what runs on every `scene.start`; a reset anywhere else is
    // a reset that does not happen on re-entry.
    const build = /protected build\(\): void \{([\s\S]*?)\n  \}/.exec(text)?.[1] ?? "";
    expect(
      /this\.draft\s*=\s*freshCreateDraft\(/.test(build),
      "the draft is rebuilt somewhere other than build(), which is the only " +
        "method Phaser re-runs when the scene is re-entered",
    ).toBe(true);
    // The original defect in its exact shape: typed state as a class field
    // initialiser, which runs once per page load and never again.
    expect(
      /private\s+pilotName\s*=/.test(text),
      "the pilot's name is a class field again; Phaser reuses the scene " +
        "instance, so that value outlives the visit that typed it",
    ).toBe(false);
    expect(
      /private\s+avatarId\s*=/.test(text),
      "the chosen mark is a class field again, with the same lifetime bug",
    ).toBe(false);
  });
});
