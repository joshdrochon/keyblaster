import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The constants are READ OUT OF THE SOURCE rather than imported: `MenuScene`
 * extends a Phaser class, so importing it under vitest's node environment
 * throws `window is not defined`. Parsing them keeps the claim tied to the real
 * numbers - if someone edits `HEADING_TOP`, this file sees the edit.
 */
const UI = resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/ui");
const constant = (name: string, file: string): number => {
  const m = new RegExp(`export const ${name} = (\\d+);`).exec(
    readFileSync(join(UI, file), "utf8"),
  );
  if (m === null) throw new Error(`${name} is gone from ${file}`);
  return Number(m[1]);
};
// The two shared lines live in `layout.ts`, because two of the four menu
// screens are laid out by a plan in that module rather than by the scene.
const HEADING_TOP = constant("HEADING_TOP", "layout.ts");
const CONTENT_TOP = constant("CONTENT_TOP", "layout.ts");
const HEADING_EYEBROW_TOP = constant("HEADING_EYEBROW_TOP", "MenuScene.ts");

/**
 * UR-85: EVERY MENU PUTS ITS TITLE ON ONE LINE.
 *
 * ================== THE DEFECT ==================
 * `MenuScene.addHeading` existed and four screens used it. `ProfileCreateScene`
 * did not: it drew its own title with `uiText` at y 116, so a step counter
 * could sit above it at 74. The picker and the create screen are CONSECUTIVE -
 * a child presses New Pilot and goes straight from one to the other - so the
 * title visibly jumped 32 px on the way in. Measured on the served build at 84
 * and 116.
 *
 * The counter is an eyebrow above the shared line now, in space the header band
 * already had, and the heading comes from the one function again.
 *
 * ================== WHY A SOURCE GUARD ==================
 * These scenes extend Phaser classes and cannot be imported under vitest's node
 * environment. What this file can do that a regex alone cannot is check the
 * scenes against the REAL exported constants, so moving `HEADING_TOP` moves the
 * claim with it.
 *
 * WATCHED FAILING, with the hand-drawn heading restored in
 * `ProfileCreateScene`:
 *
 *   ProfileCreateScene draws its own display-size heading instead of calling
 *   addHeading, so its title can sit on a different line from every other
 *   menu's: expected [ 'ProfileCreateScene.ts' ] to deeply equal []
 */
const SCENES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/scenes");

/** Every scene that extends `MenuScene` - the ones this contract binds. */
const menuScenes = (): { file: string; source: string }[] =>
  readdirSync(SCENES)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => ({ file: f, source: readFileSync(join(SCENES, f), "utf8") }))
    .filter((s) => /extends MenuScene\b/.test(s.source));

const stripped = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("UR-85: one heading line across every menu screen", () => {
  it("finds the menu screens at all, so the sweep is not vacuous", () => {
    expect(menuScenes().map((s) => s.file).sort()).toEqual([
      "BeaconLogScene.ts",
      "PauseScene.ts",
      "ProfileCreateScene.ts",
      "ProfilePickerScene.ts",
      "SettingsScene.ts",
    ]);
  });

  it("lets no menu screen draw its own display-size heading", () => {
    // `addHeading` is the only thing allowed to draw at `TYPE.display` on these
    // screens. A screen that draws its own is a screen that has chosen its own
    // y, which is the whole defect.
    const offenders = menuScenes()
      .filter((s) => /uiText\([\s\S]{0,400}?size:\s*TYPE\.display/.test(stripped(s.source)))
      .map((s) => s.file);
    expect(
      offenders,
      "a menu screen draws its own display-size heading instead of calling " +
        "addHeading, so its title can sit on a different line from every other menu's",
    ).toEqual([]);
  });

  it("puts the content line below the heading, and only one of each exists", () => {
    // ONE LINE PER ROLE. Four screens a child moves between started their
    // controls at 250, 240 and 216 before this; the shared line is the TIGHTEST
    // screen's, because settings cannot reach 250 in Hindi without printing
    // through the hint.
    expect(CONTENT_TOP).toBeGreaterThan(HEADING_TOP);
    const layout = readFileSync(join(UI, "layout.ts"), "utf8");
    // No menu block may carry its own content top any more.
    expect(/top: 240,/.test(layout), "a layout block kept its own content top").toBe(false);
    expect(/top: 216,/.test(layout), "a layout block kept its own content top").toBe(false);
  });

  it("keeps the eyebrow above the heading, with room for it", () => {
    // A step counter that collided with the title would be the same defect
    // wearing a fix's clothes.
    expect(HEADING_EYEBROW_TOP).toBeLessThan(HEADING_TOP);
    expect(HEADING_TOP - HEADING_EYEBROW_TOP).toBeGreaterThanOrEqual(32);
  });

  it("passes the shared line when a screen needs a narrower wrap", () => {
    // `ProfileCreateScene` wraps short of full width because Shadow stands at
    // the right. That is a fact about its furniture and belongs in a PROP - the
    // moment it becomes a reason to draw a second heading, the line moves.
    const create = menuScenes().find((s) => s.file === "ProfileCreateScene.ts");
    expect(create).toBeDefined();
    expect(
      /this\.addHeading\(heading, HEADING_TOP, /.test(stripped(create?.source ?? "")),
      "the create screen no longer takes the shared heading line",
    ).toBe(true);
  });
});
