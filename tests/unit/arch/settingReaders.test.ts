import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@engine/types";

/**
 * THE "SETTABLE, PERSISTED, AND NOTHING DRAWS WITH IT" DETECTOR (UR-38).
 *
 * ================== WHY A SECOND GUARD ==================
 * `profileWriters.test.ts` asks whether every persisted field has a live
 * WRITER, and it closed five real defects. It cannot see this one, because the
 * question is the other way round:
 *
 *   uppercase              had a control, validated, persisted, survived a
 *   increasedLetterSpacing reload - and CHANGED NOTHING on nine story screens.
 *
 * Both were read by the menu kit and by nothing else. `grep -c
 * increasedLetterSpacing src/game/scenes/*.ts` was 0 for Briefing, Pre-flight,
 * Warp, Beacon, Results, Map, Title, Earth activation, Ending, Stall and Hud.
 * A blind critic set both flags true, reloaded, and measured the Earth briefing
 * body unchanged at w=728 with the Title still lowercase.
 *
 * That is the SIXTH instance tonight of one class: something complete, settable
 * and persisted, with no live consumer on the path that matters. This is the
 * guard for the reading half of it.
 *
 * ================== TWO CHECKS, BOTH NARROW ==================
 * 1. Every PRESENTATION setting is read somewhere that draws. Cheap, and it
 *    would have caught nothing here on its own - `uppercase` WAS read, by the
 *    menu kit - which is why there is a second one.
 *
 * 2. EVERY `Text` a screen creates goes through one of the two text factories.
 *    That is the check with teeth: a setting applied inside a factory reaches
 *    every screen that uses the factory, and a screen that calls
 *    `scene.add.text` directly is a screen the factory cannot help. It is the
 *    structural reason eleven scenes could be missed one at a time.
 *
 * Watch it fail: delete `typographyOf` from `lib/kit.label`, or add a raw
 * `this.add.text(...)` to any scene.
 *
 *   npx vitest run tests/unit/arch/settingReaders.test.ts --coverage.enabled=false
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const GAME = path.join(ROOT, "src", "game");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

/** A file's code with comments stripped, so a guard cannot read an excuse. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

const gameFiles = walk(GAME).map((file) => ({ file, code: code(file) }));
const rel = (file: string): string => path.relative(ROOT, file);

// ---------------------------------------------------------------------------
// 1. Every presentation setting is read by something that draws
// ---------------------------------------------------------------------------

/**
 * The settings that change WHAT IS DRAWN, and therefore need a reader on a
 * rendering path. The audio volumes and `relativeBoard` are deliberately
 * absent: the first two are consumed by the audio graph, and the third is the
 * nearby-pilots opt-in, whose UI was deleted in UR-102 - the field is still
 * persisted so an existing save decodes unchanged, and nothing reads it. A
 * guard that flags things it cannot judge is noise.
 */
const PRESENTATION_SETTINGS = [
  "uppercase",
  "increasedLetterSpacing",
  "reducedMotion",
  "colorblindPalette",
] as const;

describe("every presentation setting is read on a path that draws", () => {
  it("names only real fields of Settings", () => {
    for (const key of PRESENTATION_SETTINGS) {
      expect(Object.keys(DEFAULT_SETTINGS), key).toContain(key);
    }
  });

  it("has at least one reader under src/game", () => {
    const missing = PRESENTATION_SETTINGS.filter(
      (key) =>
        !gameFiles.some(
          (f) => !f.file.includes(`${path.sep}audio${path.sep}`) && f.code.includes(key),
        ),
    );
    expect(missing).toEqual([]);
  });

  it("is read by the STORY lane too, not only by the menu kit", () => {
    // The defect exactly: both typography settings were read by `src/game/ui`
    // and by nothing the story screens go through. `lib/typography.ts` is the
    // story lane's reader and `lib/kit` is what makes it total.
    const story = gameFiles.filter((f) => f.file.includes(`${path.sep}scenes${path.sep}`));
    for (const key of ["uppercase", "increasedLetterSpacing"] as const) {
      expect(
        story.some((f) => f.code.includes(key)),
        `${key} is read nowhere under src/game/scenes`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Every Text goes through a factory that applies them
// ---------------------------------------------------------------------------

/**
 * Files allowed to call `scene.add.text` directly, each with its reason.
 *
 * This list may only shrink. An entry is a claim that the text in question is
 * NOT chrome and NOT prose, so the two typography settings do not apply to it;
 * anything else has to go through a factory.
 */
const RAW_TEXT_ALLOWED: Readonly<Record<string, string>> = {
  "src/game/scenes/lib/kit.ts":
    "the story lane's text factory - this IS where the settings are applied",
  "src/game/ui/text.ts": "the menu kit's text factory, same role",
  "src/game/scenes/lib/typedWord.ts":
    "one Text per GLYPH of the word being typed: the letters are positioned by " +
    "measured advance and lit individually, so letter spacing is carried by the " +
    "layout rather than by the style, and a word a child is copying is content " +
    "rather than chrome (D41 - never a name, never a word to type)",
  "src/game/scenes/TitleScene.ts":
    "the KEYBLASTER wordmark. A logo is not chrome: it is the same six letters " +
    "in every locale, drawn rather than translated, and D41's letter case does " +
    "not apply to it. Every OTHER string on the Title goes through skyText",
  "src/game/render/wordPlate.ts":
    "the word falling on a rock. It is the thing the child is typing, so it is " +
    "content rather than chrome and D41's letter case must never touch it; its " +
    "tracking is set by the plate's own measured layout",
  "src/game/render/lantern.ts":
    "the ship-name decal on the hull (AC-24.3). A pilot's ship name is the " +
    "child's own words - D41 excludes a name from letter case by name",
  "src/game/scenes/FlightScene.ts":
    "the floating '+points' that pops off a blasted rock. A number that appears " +
    "for 600 ms and drifts away is not copy; tracking it would make it jitter",
  "src/game/scenes/HudScene.ts":
    "applies both settings ITSELF, per call, with a three-way split the " +
    "factories cannot express: the labels (wpm, combo, score, hull) take case " +
    "and spacing; the numerals take neither, because tracking them reflows a " +
    "fixed 236px instrument plate whose values already run to within 26px of " +
    "its edge; and the stop name takes spacing but NOT case, because " +
    "chromeCase(x, false) lowercases and would render 'saturn' for every child " +
    "with the setting off. Asserted below rather than taken on trust",
};

/**
 * KNOWN GAPS: files that bypass the factories and SHOULD NOT.
 *
 * Not the same list as the one above, and the difference is the point. An entry
 * here is an admission, not a justification: this text is chrome, the two
 * typography settings ought to reach it, and they do not. The list may only
 * shrink, and the stale check below fails if an entry is fixed and left here.
 *
 * The one entry is the flight lane's file, which this lane may not edit
 * (CLAUDE.md lane rules). Raised in gauntlet/escalations.md so the owner gets a
 * ticket rather than a surprise. `StallScene` was here too and is closed: it is
 * this lane's file, so it was fixed rather than declared.
 */
const RAW_TEXT_OPEN: Readonly<Record<string, string>> = {};

describe("no screen creates text the factories cannot reach", () => {
  it("routes every Text through a factory, or declares why not", () => {
    const offenders = gameFiles
      .filter((f) => /\.add\s*\.\s*text\(|\badd\.text\(/.test(f.code))
      .map((f) => rel(f.file))
      .filter((r) => {
        const key = r.split(path.sep).join("/");
        return RAW_TEXT_ALLOWED[key] === undefined && RAW_TEXT_OPEN[key] === undefined;
      });
    expect(offenders).toEqual([]);
  });

  it("the open gaps are named, owned, and only ever shrink", () => {
    // The count is asserted so closing one is a deliberate edit here, and
    // ADDING one cannot happen quietly.
    // EMPTY, and that is the point of asserting it rather than iterating it.
    // HudScene was the one entry; it now applies both settings itself and has
    // moved to RAW_TEXT_ALLOWED with the split written down. An empty list here
    // means every remaining bypass is a claim somebody made on purpose.
    expect(Object.keys(RAW_TEXT_OPEN).sort()).toEqual([]);
    for (const [file, reason] of Object.entries(RAW_TEXT_OPEN)) {
      expect(reason.length, `${file} needs a real reason`).toBeGreaterThan(40);
    }
  });

  it("keeps the exemption list honest", () => {
    // A stale entry is how an allowlist rots into a permission slip.
    for (const declared of [...Object.keys(RAW_TEXT_ALLOWED), ...Object.keys(RAW_TEXT_OPEN)]) {
      const full = path.join(ROOT, declared);
      const found = gameFiles.find((f) => f.file === full);
      expect(found, `${declared} is declared but does not exist`).toBeDefined();
      expect(
        /\.add\s*\.\s*text\(|\badd\.text\(/.test(found?.code ?? ""),
        `${declared} no longer calls add.text; remove its exemption`,
      ).toBe(true);
    }
  });

  it("HudScene's exemption is earned: it reads the settings and splits the three kinds", () => {
    // An allowlist entry that says "this file applies the settings itself" is
    // worth nothing unless somebody checks that it does. This is the check.
    const hud = gameFiles.find((f) => f.file.endsWith(`scenes${path.sep}HudScene.ts`));
    expect(hud?.code, "HudScene no longer reads the typography settings").toContain(
      "typographyOf",
    );
    expect(hud?.code).toContain("chromeCase");
    expect(hud?.code).toContain("setLetterSpacing");
    // The split itself: the three kinds have to still exist, or the file has
    // quietly become all-or-nothing again.
    for (const kind of ['"label"', '"readout"', '"place"']) {
      expect(hud?.code, `HudScene lost the ${kind} kind`).toContain(kind);
    }
  });

  it("both factories actually apply both settings", () => {
    const kit = gameFiles.find((f) => f.file.endsWith(`lib${path.sep}kit.ts`));
    const uiText = gameFiles.find((f) => f.file.endsWith(`ui${path.sep}text.ts`));
    // The story lane's factory reads the settings itself (`typographyOf`);
    // the menu kit's is handed them by `MenuScene` as a `ControlStyle`.
    expect(kit?.code).toContain("typographyOf");
    expect(kit?.code).toContain("setLetterSpacing");
    expect(kit?.code).toContain("chromeCase");
    expect(uiText?.code).toContain("increasedLetterSpacing");
    expect(uiText?.code).toContain("chromeCase");
  });

  it("NEGATIVE CONTROL: the shipped default was to ignore the setting", () => {
    // `options.letterSpacing ?? false` is what shipped, and it is why eleven
    // scenes were dead: the factory defaulted the accessibility setting OFF and
    // every caller took the default.
    const kit = gameFiles.find((f) => f.file.endsWith(`lib${path.sep}kit.ts`));
    expect(kit?.code, "the factory defaults the setting to off again").not.toMatch(
      /letterSpacing \?\? false/,
    );
  });
});
