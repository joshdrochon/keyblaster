import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * UR-50.5 AS A RULE: NO SCREEN WITHOUT A LANE LETS ITS PLANES TRAVEL.
 *
 * ================== THE DEFECT, TWICE ==================
 * UR-14, from play on the Title: stars must not ride the parallax. They should
 * hold position and flicker slowly, each on its own interval. That was fixed -
 * `render/starField.ts` pins the
 * field to the `sky` container, which `PINNED` holds at (0,0) forever.
 *
 * UR-50.5, from play on the Briefing, months later: stars in the window were
 * STILL crossing the frame left to right.
 *
 * Both reports were right and the first fix was not wrong. The travelling
 * objects were never the starfield. They are the DECORATIVE DEBRIS planes, and
 * `DRIFT_X` in `render/parallax.ts` gives each of them a pixels-per-second
 * FLOOR that runs at any world speed:
 *
 *     farField  +5    midField  -8    nearField  +11    foreVeil  -15
 *
 * A small pale speck of far-field debris crossing a window at 5 px/s is a
 * travelling star to anyone who is not reading the source. Two screens had a
 * comment next to `worldSpeed: 0` claiming the world "does not travel"
 * (`WarpScene`) and "breathes; it does not travel" (`BeaconScene`) - both were
 * false, because `worldSpeed` was never what drove the crossing.
 *
 * ================== WHY THIS GUARD IS A SOURCE SWEEP ==================
 * The coordinator's brief: "ship a guard, or it surfaces a third time on
 * whichever screen nobody checked." The failure mode is therefore a screen that
 * does not exist yet, which no runtime test can visit. So this reads the source
 * and requires the opt-out at every call site, which makes a NEW screen fail
 * until somebody decides which kind of screen it is.
 *
 * Flight is the one exception and it is deliberate: `DRIFT_X`'s own comment
 * explains at length that the sideways crossing is the "you cannot type this"
 * signal, taught by watching a rock drift past rather than by being told. A
 * gameplay rock falls down the ship's lane (FR-8 / D19); a decorative one
 * leaves by the side. Deleting that to fix a menu would trade a mechanic for a
 * layout, so `crossDrift` is a switch and Flight keeps it on.
 *
 * Watch it fail: drop `crossDrift: false` from any scene below.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game");
const SCENES = resolve(SRC, "scenes");

/** Scenes allowed to let their decorative planes cross the frame, and why. */
const HAS_A_LANE: Readonly<Record<string, string>> = {
  "FlightScene.ts":
    "the crossing IS the not-typeable signal (DRIFT_X, FR-8/D19): a gameplay " +
    "rock falls down the lane, a decorative one leaves by the side",
};

function sceneFiles(): string[] {
  return readdirSync(SCENES).filter((f) => f.endsWith("Scene.ts"));
}

function read(file: string): string {
  return readFileSync(resolve(SCENES, file), "utf8");
}

/** Scenes that actually build a parallax stack. */
function callers(): string[] {
  return sceneFiles().filter((f) => read(f).includes("buildParallax(this, {"));
}

describe("UR-50.5: no decorative plane travels on a screen without a lane", () => {
  it("finds the screens that build a world, so the sweep cannot go quietly empty", () => {
    // Rule 5: a harness sweeps, it does not sample. If this list collapses to
    // one or two, every assertion below is passing on an empty set.
    const found = callers();
    expect(found.length, `buildParallax callers: ${found.join(", ")}`).toBeGreaterThanOrEqual(
      10,
    );
    expect(found).toContain("FlightScene.ts");
    expect(found).toContain("BriefingScene.ts");
  });

  it("every screen but Flight opts out of sideways travel", () => {
    const offenders: string[] = [];
    for (const file of callers()) {
      if (file in HAS_A_LANE) continue;
      if (!/crossDrift:\s*false/.test(read(file))) offenders.push(file);
    }
    expect(
      offenders,
      `these screens still let their planes cross the frame: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("Flight keeps it, and that is on purpose rather than by omission", () => {
    // The exception is asserted too. If somebody "fixes" Flight by copying the
    // opt-out into it, the mechanic goes silently and this says so.
    const flight = read("FlightScene.ts");
    expect(/crossDrift:\s*false/.test(flight), HAS_A_LANE["FlightScene.ts"]).toBe(false);
  });

  it("the switch exists, defaults to the old behaviour, and is actually read", () => {
    // A flag every scene passes and nothing consumes is the shape of a fix that
    // was never wired up. All three halves are checked: the option is declared,
    // its default preserves what Flight had, and the update loop gates the
    // drift-plane advance on it.
    const px = readFileSync(resolve(SRC, "render/parallax.ts"), "utf8");
    expect(px).toMatch(/readonly crossDrift\?:\s*boolean/);
    expect(px).toMatch(/const crossDrift = options\.crossDrift \?\? true/);
    expect(px).toMatch(/if \(crossDrift\) \{[\s\S]{0,200}?for \(const p of driftPlanes\)/);
  });

  it("the starfield is still pinned, which is the OTHER thing these reports blamed", () => {
    // UR-14's fix must not be quietly undone by this one. The field lives on
    // the sky container and `sky` is in PINNED, so it neither scrolls nor sways.
    const px = readFileSync(resolve(SRC, "render/parallax.ts"), "utf8");
    expect(px).toMatch(/const PINNED[^=]*=\s*new Set<LayerId>\(\["sky", "hud"\]\)/);
    expect(px).toMatch(/skyLayer\.add\(starField\.graphics\)/);
  });
});

/**
 * UR-14 ROUND THREE: THE STAR RULE HAS ONE HOME, AND EVERY SURFACE ASKS IT.
 *
 * ================== WHY THIS BLOCK EXISTS ==================
 * The guards above are round two's, and they are not wrong. They are ABOUT THE
 * WRONG THING. Both of them - this file's `crossDrift` sweep and
 * `tests/e2e/no-star-travel.spec.ts` - assert that no OBJECT translates. The
 * third report was a full-frame `TileSprite` advancing `tilePositionY` at
 * `worldSpeed * 1.45 + 26` px/s: nothing translates, and 24 diagonal lines
 * 150-310 px long cross the Briefing pane anyway.
 *
 * That is the same shape as UR-06 (a keep-clear built for the Title wordmark,
 * then debris over the Director map's planets, then a shared mechanism) and it
 * has the same answer: stop fixing the screen, state the rule once. The rule
 * lives in `render/starField.ts` and it is `starsMayTravel(surface, sceneKey)`.
 * This block asserts the three things that make it a rule rather than a
 * function nobody calls:
 *
 *   1. every surface that draws specks routes its decision through it
 *   2. the exception table is empty except for entries with a reason attached
 *   3. the e2e's screen list and that table agree, so a screen cannot leave the
 *      sweep without buying an exception
 *
 * Watch it fail: delete `starsMayTravel` from `parallax.ts`'s weather branch,
 * or add a screen to `TRAVELLING_LIGHT` with an empty string for its reason.
 */

const STARFIELD = readFileSync(resolve(SRC, "render/starField.ts"), "utf8");
const PARALLAX = readFileSync(resolve(SRC, "render/parallax.ts"), "utf8");
const CHROME = readFileSync(resolve(SRC, "ui/chrome.ts"), "utf8");
const UI_STARS = readFileSync(resolve(SRC, "ui/starfield.ts"), "utf8");

/** The e2e's enumeration, read rather than restated, so the two cannot drift. */
const E2E = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../e2e/no-star-travel.spec.ts"),
  "utf8",
);

describe("UR-14: one rule decides whether stars translate", () => {
  it("the seam exists, and it is a lookup rather than a hardcoded answer", () => {
    expect(STARFIELD).toMatch(
      /export function starsMayTravel\(surface: StarSurface, sceneKey: string\): boolean/,
    );
    expect(STARFIELD).toMatch(/const TRAVELLING_LIGHT: Readonly<Record<string, string>>/);
    // A `return false` would pass every assertion below and make the exception
    // table decorative, which is the shape of a rule that was never wired up.
    expect(STARFIELD).toMatch(/return `\$\{surface\}@\$\{sceneKey\}` in TRAVELLING_LIGHT/);
  });

  it("every star surface is named in one enumeration", () => {
    // Rule 5: a harness sweeps. If this type collapses to one member, the
    // question "have we found all the places that draw specks" stops being
    // asked. The three are: the pinned field, the atmosphere pass, the menu
    // backdrop.
    const m = STARFIELD.match(/export type StarSurface =([^;]+);/);
    expect(m, "StarSurface is gone; the enumeration was the coverage").not.toBeNull();
    const members = [...(m?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect(members).toEqual(["world.starField", "world.atmosphere", "menu.backdrop"]);
  });

  it("the atmosphere pass asks the seam instead of scrolling unconditionally", () => {
    // THE DEFECT, AS A REGEX. This line had no condition on it at all.
    expect(PARALLAX).toMatch(/starsMayTravel\("world\.atmosphere", scene\.scene\.key\)/);
    expect(PARALLAX).toMatch(/if \(weatherTravels\) \{/);
    // ...and the px/s FLOOR is gone from the travel term. `+ 26` is what made
    // `worldSpeed: 0` a lie on nine screens, exactly as `DRIFT_X.base` did.
    expect(
      /tilePositionY -= \(worldSpeed \* 1\.45 \+ 26\)/.test(PARALLAX),
      "the atmosphere pass has its px/s floor back; worldSpeed: 0 no longer means still",
    ).toBe(false);
  });

  it("the menu backdrop's stars are redrawn in place, never repositioned", () => {
    // The other surface. Its stars are painted into `starsG`, and the only
    // per-frame term anywhere near them is the alpha.
    expect(CHROME).toMatch(/twinkleAlpha\(/);
    expect(CHROME).toMatch(/this\.starsG\.clear\(\)/);
    expect(
      /starsG\.(x|y) *=/.test(CHROME),
      "the menu star layer is being repositioned",
    ).toBe(false);
    // `menuStars` is placement only: no caller may add a time term to it.
    expect(/function menuStars\([^)]*elapsed/.test(UI_STARS), "menuStars took a clock").toBe(
      false,
    );
  });

  it("...and it flickers, which is the half of the report that was never done", () => {
    // Round one and two both read "stars must not travel" and stopped there.
    // The sentence has a second clause, and on five menu screens the stars were
    // painted once into the sky Graphics and never touched again.
    expect(UI_STARS).toMatch(/twinkleFor\(next\)/);
    expect(CHROME).toMatch(/paintStars\(elapsedMs\)/);
  });

  it("every exception is named, scoped to a screen, and carries a reason", () => {
    const table = STARFIELD.match(/const TRAVELLING_LIGHT[^=]*= \{([\s\S]*?)\n\};/);
    expect(table).not.toBeNull();
    const entries = [...(table?.[1] ?? "").matchAll(/"([^"]+)":\s*([\s\S]*?)(?=\n  "|$)/g)];
    for (const [, key, body] of entries) {
      expect(key, `an exception must be surface@SceneKey, got ${key}`).toMatch(
        /^[a-z]+\.[A-Za-z]+@[A-Z][A-Za-z]+$/,
      );
      // A reason, not a placeholder. Under 40 characters is a label.
      const prose = (body ?? "").replace(/[^A-Za-z ]/g, "").trim();
      expect(prose.length, `exception ${key} has no justification`).toBeGreaterThan(40);
    }
    // One exception, and it is Flight. Adding a second is a decision somebody
    // makes on purpose, in front of this line.
    expect(entries.map((e) => e[1])).toEqual(["world.atmosphere@Flight"]);
  });

  it("NOTHING ELSE in the game scrolls a texture, gated or otherwise", () => {
    /**
     * THE MECHANISM, SWEPT ACROSS THE WHOLE SOURCE TREE.
     *
     * The assertions above cover the one full-frame overlay we know about. This
     * covers the next one: `tilePositionX/Y` is the only way in Phaser to move
     * drawn content without moving an object, it is therefore the only way to
     * defeat every position-based guard in this repo, and there is exactly one
     * line in `src/game` allowed to write it.
     *
     * A second scrolling texture anywhere - a new weather pass, a moving grid,
     * a scrolling nebula on a screen that does not exist yet - fails here on
     * the day it is written rather than on the day somebody plays it.
     *
     * Watched failing: one stray `s.tilePositionX += 1;` added to
     * `render/tiles.ts` and this reported, naming the file and the line -
     *
     *   Array [
     *     "render/parallax.ts: weather.tilePositionY -= worldSpeed * 1.45 ...",
     *   +  "render/tiles.ts: s.tilePositionX += 1;",
     *   ]
     */
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts")) files.push(full);
      }
    };
    walk(SRC);
    const writers: string[] = [];
    for (const f of files) {
      const body = readFileSync(f, "utf8");
      for (const line of body.split("\n")) {
        if (/tilePosition[XY]\s*(-|\+)?=/.test(line)) writers.push(`${f.slice(SRC.length + 1)}: ${line.trim()}`);
      }
    }
    expect(
      writers,
      `every texture scroll must go through the star rule:\n${writers.join("\n")}`,
    ).toEqual([
      "render/parallax.ts: weather.tilePositionY -= worldSpeed * 1.45 * (dt / 1000);",
    ]);
  });

  it("the runtime sweep covers every screen that is not excepted", () => {
    // THE JOIN. The e2e can only visit screens that exist; this checks that the
    // list it visits is the complement of the exception table, so a screen
    // cannot be quietly dropped from the sweep - which, with fourteen screens
    // all returning zero, nobody would notice.
    const list = E2E.match(/const STAR_SCREENS = \[([\s\S]*?)\] as const;/);
    expect(list, "the e2e's enumeration was renamed or removed").not.toBeNull();
    const swept = [...(list?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect(swept.length, `screens swept: ${swept.join(", ")}`).toBeGreaterThanOrEqual(14);
    const excepted = [
      ...STARFIELD.matchAll(/"[a-z]+\.[A-Za-z]+@([A-Z][A-Za-z]+)":/g),
    ].map((m) => m[1]);
    for (const screen of excepted) {
      expect(swept, `${screen} is excepted, so it must not be in the sweep`).not.toContain(
        screen,
      );
    }
    // Every scene file that draws a world or a menu backdrop is either swept or
    // excepted. This is the part that fails for a screen nobody has written yet.
    const drawsStars = sceneFiles().filter(
      (f) => read(f).includes("buildParallax(this, {") || /extends MenuScene/.test(read(f)),
    );
    for (const file of drawsStars) {
      const key = file.replace(/Scene\.ts$/, "");
      const covered = swept.includes(key) || excepted.includes(key);
      expect(covered, `${file} draws stars and is neither swept nor excepted`).toBe(true);
    }
  });
});
