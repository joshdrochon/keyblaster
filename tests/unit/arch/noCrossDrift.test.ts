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
    expect(members).toEqual([
      "world.starField",
      "world.atmosphere",
      "world.nearLight",
      "menu.backdrop",
    ]);
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
    // EMPTY, by the owner's ruling in round five. Flight held the only two
    // exceptions on the argument that the ship is genuinely moving there; the
    // ruling is that stars are far enough away that no visible movement should
    // exist, including in flight. Matter still parallaxes - see TILE_DRAWS -
    // so what is frozen is the sky, not the world.
    //
    // Watched failing at ['world.atmosphere@Flight', 'world.nearLight@Flight'].
    // An empty table is the only state where a NEW screen cannot inherit an
    // exception by accident, so buying one back is a deliberate edit here.
    expect(entries.map((e) => e[1])).toEqual([]);
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

/**
 * UR-14 ROUND FOUR: EVERY DRAWING IS CLASSIFIED, AND LIGHT GOES THROUGH THE SEAM.
 *
 * ================== WHAT ROUND FOUR WAS ==================
 * The rule the block above installed was correct about having ONE home and
 * wrong about where it drew the line. It classified by MECHANISM - a full-frame
 * overlay holds still, an object at a depth travels "because that is what
 * parallax means" - and it named `moteTile`'s motes and glints as things that
 * may travel. So 44 `mote` sprites and 14 `glint` sprites went on riding the
 * near plane at 1.30 x world speed: 96.2 px/s on the Title, 384.8 px in four
 * seconds, while all three guards stayed green.
 *
 * The line is now APPEARANCE - see `starField.ts` and `tiles.TILE_DRAWS`.
 *
 * ================== WHY THE SOURCE IS SWEPT AS WELL AS THE SCREEN ==========
 * The e2e next door recognises a point of light from the display list, by what
 * the node draws. That catches every mechanism it can classify and nothing it
 * cannot: a generator nobody has written yet, drawing specks nobody has told it
 * about, walks straight past. So the classification is a table in `tiles.ts`,
 * and these assertions require that (a) every generator in that file is IN the
 * table, so a new one is red until somebody decides what it draws, and (b)
 * every generator classified as LIGHT reaches the scene through the seam rather
 * than being added to a scrolling container directly.
 *
 * That is the pair round three was missing. Its guard asserted the one surface
 * it knew about; this asserts that the enumeration is exhaustive over the file
 * the drawings actually live in.
 *
 * Watch it fail: three ways, all recorded below with what they print.
 */

const TILES = readFileSync(resolve(SRC, "render/tiles.ts"), "utf8");

/** Every `*Tile` generator exported from `tiles.ts`, read from the source. */
function tileGenerators(): string[] {
  return [...TILES.matchAll(/export function (\w+Tile)\s*\(/g)].map((m) => m[1] as string);
}

/** The classification table, parsed from the source rather than imported. */
function tileDraws(): Record<string, string> {
  const block = TILES.match(/export const TILE_DRAWS[^=]*= \{([\s\S]*?)\n\};/);
  const out: Record<string, string> = {};
  for (const [, k, v] of (block?.[1] ?? "").matchAll(/(\w+):\s*"(light|matter)"/g)) {
    out[k as string] = v as string;
  }
  return out;
}

describe("UR-14: every drawing is classified, and light goes through the seam", () => {
  it("finds the generators, so the sweep cannot go quietly empty", () => {
    // Rule 5. If this collapses to one name the two assertions below are
    // passing on almost nothing and would say so here first.
    const gens = tileGenerators();
    expect(gens.length, `generators found: ${gens.join(", ")}`).toBeGreaterThanOrEqual(5);
    expect(gens).toContain("moteTile");
    expect(gens).toContain("driftTile");
  });

  it("every generator in tiles.ts is classified as light or matter", () => {
    /**
     * Watched failing: `veilTile` removed from `TILE_DRAWS` and this reported
     *
     *   unclassified drawings in tiles.ts: veilTile
     *   Expected: []
     *   Received: ["veilTile"]
     *
     * which is what a NEW generator gets on the day it is written.
     */
    const table = tileDraws();
    const unclassified = tileGenerators().filter((g) => !(g in table));
    expect(
      unclassified,
      `unclassified drawings in tiles.ts: ${unclassified.join(", ")}`,
    ).toEqual([]);
    // ...and no stale entry for a generator that no longer exists, which would
    // make the table look more exhaustive than it is.
    const gone = Object.keys(table).filter((k) => !tileGenerators().includes(k));
    expect(gone, `TILE_DRAWS names drawings that are gone: ${gone.join(", ")}`).toEqual([]);
    // Both kinds are populated. A table that is all "matter" classifies nothing.
    const kinds = Object.values(table);
    expect(kinds.filter((k) => k === "light").length).toBeGreaterThanOrEqual(2);
    expect(kinds.filter((k) => k === "matter").length).toBeGreaterThanOrEqual(2);
  });

  it("parallax.ts asks the seam for the near plane, exactly as it does for the weather", () => {
    expect(PARALLAX).toMatch(/starsMayTravel\("world\.nearLight", scene\.scene\.key\)/);
    // The pinned branch: its own container, at its own depth, never added to a
    // layer and never repositioned. If the specks went back onto `n` they would
    // scroll again and every word above this line would still be true.
    expect(PARALLAX).toMatch(/if \(!nearLightTravels\) \{[\s\S]{0,160}?scene\.add\.container\(0, 0\)/);
    expect(
      /nearLight\.(x|y|setPosition)\s*[=(]/.test(PARALLAX),
      "the pinned light container is being repositioned",
    ).toBe(false);
  });

  it("every LIGHT drawing reaches the scene through the seam, and no MATTER one does", () => {
    /**
     * Watched failing: the `accentTile` call in `parallax.ts` reverted to the
     * shipped `wrapY(accentTile(...), H)` on the `nearField` container, and
     * this reported
     *
     *   light drawings added without asking the star rule: accentTile (1 calls, 0 gated)
     *   Expected: []
     *   Received: ["accentTile (1 calls, 0 gated)"]
     *
     * The COUNTS are reported, not just the name, because a second ungated call
     * site is how this comes back: one gated call keeps every regex above this
     * one green, and `2 calls, 1 gated` is the only thing that says otherwise.
     *
     * And the other direction, watched failing by routing `driftTile` through
     * `lightOps` - freezing the world to fix the sky -
     *
     *   matter routed through the star rule; the world must keep moving:
     *   driftTile (1 gated)
     */
    const table = tileDraws();
    const ungated: string[] = [];
    const overGated: string[] = [];
    for (const [gen, kind] of Object.entries(table)) {
      const calls = [...PARALLAX.matchAll(new RegExp(`\\b${gen}\\(`, "g"))].length;
      const gated = [...PARALLAX.matchAll(new RegExp(`lightOps\\(${gen}\\(`, "g"))].length;
      if (calls === 0) continue;
      if (kind === "light" && gated !== calls)
        ungated.push(`${gen} (${calls} calls, ${gated} gated)`);
      if (kind === "matter" && gated !== 0) overGated.push(`${gen} (${gated} gated)`);
    }
    expect(
      ungated,
      `light drawings added without asking the star rule: ${ungated.join(", ")}`,
    ).toEqual([]);
    // The other direction, and it matters as much: freezing the rocks, the dust
    // or the veil would trade UR-14 for UR-50.4. Only light holds still.
    expect(
      overGated,
      `matter routed through the star rule; the world must keep moving: ${overGated.join(", ")}`,
    ).toEqual([]);
  });

  it("the menu backdrop's motes breathe where they stand, and they ask the seam", () => {
    /**
     * THE FIFTH MECHANISM, AS A REGEX.
     *
     * `Backdrop.spawnMotes` tweened 18 accent discs `60 + (i % 5) * 26` px up
     * the frame and back on all five menu screens. It was the first
     * tween-driven instance of this defect and therefore invisible to every
     * probe that steps `scene.update` by hand - which was all of them until the
     * real-frames pass in the e2e.
     *
     * Three halves, because two of them were true while it was broken: the menu
     * backdrop was already IN the `StarSurface` enumeration, and its star
     * Graphics was already asserted never to be repositioned. Neither said
     * anything about eighteen tweened discs beside it.
     *
     * Watched failing: the `y` term put back on the mote tween unconditionally,
     * and this reported
     *
     *   the backdrop motes have an unconditional travel term again: expected
     *   true to be false
     */
    // 1. It asks, from the scene key, like the other three surfaces.
    expect(CHROME).toMatch(/starsMayTravel\("menu\.backdrop", this\.scene\.scene\.key\)/);
    // 2. The defect itself first, so a revert reports the defect rather than
    // reporting that a helper variable is missing.
    expect(
      /targets: mote,\s*\n\s*y:/.test(CHROME),
      "the backdrop motes have an unconditional travel term again",
    ).toBe(false);
    // ...and the travel term exists only inside the branch the seam grants.
    expect(CHROME).toMatch(/const travel: Record<string, number> = mayTravel/);
    // 3. And they still animate, because a frozen menu reads as a crashed game
    // (rubric item 2). Alpha is the whole animation now.
    expect(CHROME).toMatch(/\.\.\.travel,\n\s*alpha: 0\.06,/);
  });

  it("the pinned specks are not wrapped, because a pinned plane has no seam", () => {
    // `wrapY` doubles a tile so a scrolling plane has something to bring in at
    // the seam. A pinned one never reaches one, so the second copy would be 29
    // Images parked above the top edge forever, against AC-22.9. Measured: the
    // Title's display list went from 123 nodes to 95.
    expect(PARALLAX).toMatch(/nearLightTravels \? wrapY\(ops, H\) : ops/);
  });
});
