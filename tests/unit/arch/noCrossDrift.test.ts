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
