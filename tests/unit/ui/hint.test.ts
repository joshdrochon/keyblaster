import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  HINT_CONTRACT,
  SCREEN_HINTS,
  hintOrigin,
  repeatedWords,
  significantWords,
  teachesSomethingNew,
  type ScreenHint,
} from "@game/ui/hint";
import { GUTTER } from "@game/ui/grid";
import { SKY_PLATE } from "@game/ui/theme";
import { LANE_COPY_EN } from "@game/scenes/support/copy";
import { EN } from "@engine/i18n/strings";
import UI_EN from "../../../src/content/en/ui.json";

/**
 * UR-56: A HINT THAT REPEATS THE BUTTON BESIDE IT.
 *
 * ================== WHAT WAS REPORTED ==================
 * A keyboard hint reported as redundant, with outright removal asked for rather
 * than relocation. It sat 28 px to the right of a focused button whose label
 * already carried its verb.
 *
 * The follow-up on the ticket is the part this file exists for: check whether
 * the same hint is redundant on OTHER screens, because a hint that repeats the
 * button beside it is noise everywhere rather than only here. Two defects in this project have
 * already been fixed on the screen they were reported against and come back on
 * the next one - the Title keep-clear (UR-06 -> UR-52) and the stationary
 * starfield (UR-14 -> UR-50.5). A repeated report is a rule.
 *
 * ================== THE SWEEP ==================
 * `SCREEN_HINTS` carries EVERY scene, not the ones anybody remembered, and the
 * completeness case below fails if a scene file exists with no row. That is
 * coding-standards rule 5: a harness sweeps, it does not sample.
 *
 * ================== WATCH THEM FAIL ==================
 * Every number and message below was READ OFF A RED RUN.
 *
 *   BeaconScene's row put back to { placement: "beside-button",
 *   hintKey: "beacon.hint" } - i.e. the screen as reported
 *   -> "no screen draws a hint beside a button":
 *      `expected [ 'BeaconScene.ts: beacon.hint' ] to deeply equal []`
 *   -> "a hint must teach something the buttons do not":
 *      `BeaconScene.ts: "enter to continue" says nothing "continue" does not`
 *   -> "the two removals are recorded":
 *      `expected [ 'BriefingScene.ts' ] to deeply equal [ Array(2) ]`.
 *      Three independent cases catch it, which is deliberate: the placement,
 *      the copy and the record are three different ways to reintroduce it.
 *
 *   BriefingScene.ts's row deleted from SCREEN_HINTS
 *   -> "every scene has a row - the sweep does not sample":
 *      `a scene with no hint decision recorded: expected
 *      [ 'BriefingScene.ts' ] to deeply equal []`.
 *      This is the case that makes the file a sweep rather than a sample.
 *
 *   `beacon.hint` re-rendered in BeaconScene.ts (a skyText call put back)
 *   -> "a removed hint is not still being drawn":
 *      `expected [ 'BeaconScene.ts renders beacon.hint' ] to deeply equal []`.
 *      A row saying "none" over a scene that still draws it is exactly the
 *      status nobody re-measures (coding-standards rule 10).
 *
 *   npx vitest run tests/unit/ui/hint.test.ts --coverage.enabled=false
 */

const SCENES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/scenes");
const sceneFiles = (): string[] => readdirSync(SCENES).filter((f) => f.endsWith("Scene.ts"));
const code = (f: string): string =>
  readFileSync(resolve(SCENES, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

/** The shipped English for a key, from whichever of the three tables owns it. */
function copy(key: string): string {
  const lane = LANE_COPY_EN[key];
  if (lane !== undefined) return lane;
  const scene = (UI_EN.strings as Record<string, string>)[key];
  if (scene !== undefined) return scene;
  const engine = (EN as Record<string, string>)[key];
  if (engine !== undefined) return engine;
  const ui = UI_COMMON[key];
  if (ui !== undefined) return ui;
  throw new Error(`no shipped copy for "${key}"`);
}

/**
 * `ui/strings.ts` is a 700-line table the menu kit reads through its own
 * translator; only these two keys are hints, so they are lifted rather than
 * importing the whole module. The test below asserts they still match.
 */
const UI_COMMON: Record<string, string> = {
  "ui.common.hintKeys": "Arrows to move · enter to choose · esc to go back",
  "ui.common.hintAdjust": "Left and Right to Change",
};

describe("the hint copy this file reasons about is the copy that ships", () => {
  it("the two menu-kit hints are quoted correctly", () => {
    const src = readFileSync(resolve(SCENES, "../ui/strings.ts"), "utf8");
    for (const [key, value] of Object.entries(UI_COMMON)) {
      expect(src, key).toContain(`"${key}": "${value}"`);
    }
  });

  it("every declared hint key resolves to shipped copy", () => {
    for (const row of SCREEN_HINTS) {
      if (row.hintKey === null) continue;
      expect(copy(row.hintKey).length, row.hintKey).toBeGreaterThan(0);
    }
    for (const row of SCREEN_HINTS) {
      for (const key of row.actionKeys) {
        expect(copy(key).length, key).toBeGreaterThan(0);
      }
    }
  });
});

describe("UR-56: no hint repeats the button beside it", () => {
  it("no screen draws a hint beside a button", () => {
    // The placement IS the defect: two pieces of text saying one thing, read as
    // one object. Banning the placement is what stops the tenth screen doing it.
    const offenders = SCREEN_HINTS.filter((r) => r.placement === "beside-button").map(
      (r) => `${r.file}: ${r.hintKey}`,
    );
    expect(offenders).toEqual([]);
  });

  it("NEGATIVE CONTROL: the rule catches the line that was reported", () => {
    // "enter to continue" beside "continue". Without this the rule above could
    // be vacuous - it passes trivially once the two rows say "none".
    expect(repeatedWords("enter to continue", "continue")).toEqual(["continue"]);
    expect(teachesSomethingNew("enter to continue", ["continue"])).toBe(false);
    // ...and the Briefing's, which is the same shape one screen over. Both of
    // its clauses repeat a plate that is already on the screen: the button
    // reads "launch" and, since UR-27 made it visible, the chip reads "back to
    // the map". Asserted clause by clause rather than through
    // `teachesSomethingNew`, which the filler "go" in "go back" would let past.
    const briefing = "enter to launch · esc to go back";
    expect(repeatedWords(briefing, "launch")).toEqual(["launch"]);
    expect(repeatedWords(briefing, "back to the map")).toEqual(["back"]);
  });

  it("a hint may name a KEY the button cannot", () => {
    // The rule is about the VERB, not about the whole line. "enter" is what a
    // hint is for and no button label says it, so it must not count as a repeat
    // or the sweep would delete every keyboard instruction in the game.
    expect(repeatedWords("arrows to move · enter to choose", "back")).toEqual([]);
    expect(significantWords("enter to choose")).toEqual(["choose"]);
  });

  it("a hint must teach something the buttons do not, on every screen", () => {
    const offenders: string[] = [];
    for (const row of SCREEN_HINTS) {
      if (row.hintKey === null) continue;
      const hint = copy(row.hintKey);
      const labels = row.actionKeys.map(copy);
      if (!teachesSomethingNew(hint, labels)) {
        offenders.push(`${row.file}: "${hint}" says nothing ${labels.map((l) => `"${l}"`).join(" / ")} does not`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("a removed hint is not still being drawn", () => {
    // A row saying "none" while the scene still renders the key would be a
    // status nobody re-measured (coding-standards rule 10).
    const offenders: string[] = [];
    for (const row of SCREEN_HINTS) {
      if (row.hintKey !== null) continue;
      const src = code(row.file);
      for (const m of src.matchAll(/text\(\s*"([a-z]+\.hint)"/gi)) {
        offenders.push(`${row.file} renders ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the two removals are recorded with the report that caused them", () => {
    const removed = SCREEN_HINTS.filter(
      (r): r is ScreenHint => r.hintKey === null && (r.note ?? "").includes("UR-56"),
    ).map((r) => r.file);
    expect(removed.sort()).toEqual(["BeaconScene.ts", "BriefingScene.ts"]);
  });
});

describe("the hint line is one line, on every screen that has one", () => {
  it("every scene has a row - the sweep does not sample", () => {
    const declared = new Set(SCREEN_HINTS.map((r) => r.file));
    const missing = sceneFiles().filter((f) => !declared.has(f));
    expect(missing, "a scene with no hint decision recorded").toEqual([]);
  });

  it("no row names a scene that does not exist", () => {
    const real = new Set(sceneFiles());
    expect(SCREEN_HINTS.map((r) => r.file).filter((f) => !real.has(f))).toEqual([]);
  });

  it("every screen without a hint says why", () => {
    const silent = SCREEN_HINTS.filter((r) => r.placement === "none" && (r.note ?? "") === "");
    expect(silent.map((r) => r.file)).toEqual([]);
  });

  it("the shared origin puts the plate on the contract's corner", () => {
    const at = hintOrigin();
    expect(at.x - SKY_PLATE.padX).toBe(GUTTER);
    expect(at.x - SKY_PLATE.padX).toBe(HINT_CONTRACT.x);
    expect(at.y - SKY_PLATE.padY).toBe(HINT_CONTRACT.top);
  });
});
