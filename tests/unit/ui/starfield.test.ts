import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { menuDebris, menuStars, type Mote } from "@game/ui/starfield";

/**
 * THE MENUS DO NOT DRAW HILLS.
 *
 * ================== THE DEFECT ==================
 * `chrome.ts` `paintMidfield` drew a rolling landform along the bottom of five
 * menu screens - pause, settings, beacon log, profile picker, profile create:
 *
 *   const h = 190 + Math.sin(x / 260) * 46 + Math.cos(x / 97) * 22;
 *
 * That is terrain, in a space game, on screens that sit between two flights.
 * D97 dropped terrain grammar for space grammar everywhere else; this survived
 * because it lives in the UI kit rather than in `render/`, and a blind critic
 * named it as one of three distinct visual languages the product speaks.
 *
 * ================== WHAT IS ASSERTED ==================
 * Three things, all of them numbers rather than opinions:
 *
 *   1. the field is SCATTERED - two rocks share an x range at different
 *      heights, which a height-per-x profile cannot do. That is the formal
 *      difference between debris and a hillside.
 *   2. it is DETERMINISTIC - a menu that reshuffles its background between
 *      navigations flickers.
 *   3. it SCALES WITH THE WORLD - the world widens with the window (D99), and
 *      a field that stops at 1920 leaves a 32:9 monitor half empty.
 *
 * Plus a source guard, because the old band could be reintroduced without
 * touching this module at all.
 *
 *   npx vitest run tests/unit/ui/starfield.test.ts --coverage.enabled=false
 */

const CHROME = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/ui/chrome.ts"),
  "utf8",
);

const W = 1920;
const H = 1080;

/** The shipped hillside, restated so the control is the real formula. */
const hillHeight = (x: number): number =>
  190 + Math.sin(x / 260) * 46 + Math.cos(x / 97) * 22;

describe("the menu backdrop is a debris field, not a landform", () => {
  it("scatters: two rocks share an x range at different heights", () => {
    const rocks = menuDebris(W, H);
    const found = rocks.some((a: Mote) =>
      rocks.some(
        (b: Mote) => b !== a && Math.abs(b.x - a.x) < 40 && Math.abs(b.y - a.y) > 120,
      ),
    );
    expect(found, "every rock is at a single height per x, i.e. it is a profile").toBe(
      true,
    );
  });

  it("NEGATIVE CONTROL: the shipped band was a height-per-x profile", () => {
    // One y for every x, and the y never leaves a 136 px band. That is a
    // horizon, and it is what a scattered field must not look like.
    const ys = [];
    for (let x = 0; x <= W; x += 120) ys.push(hillHeight(x));
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(140);
  });

  it("covers the height of the frame rather than hugging the floor", () => {
    const rocks = menuDebris(W, H);
    const ys = rocks.map((r) => r.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(H * 0.4);
  });

  it("is deterministic", () => {
    expect(menuDebris(W, H)).toEqual(menuDebris(W, H));
    expect(menuStars(W, H)).toEqual(menuStars(W, H));
  });

  it("fills the world it is given, however wide", () => {
    for (const width of [1920, 2560, 3840]) {
      const rocks = menuDebris(width, H);
      const stars = menuStars(width, H);
      expect(Math.max(...rocks.map((r) => r.x)), `${width} debris`).toBeGreaterThan(
        width * 0.8,
      );
      expect(Math.max(...stars.map((s) => s.x)), `${width} stars`).toBeGreaterThan(
        width * 0.8,
      );
      expect(Math.min(...rocks.map((r) => r.x))).toBeGreaterThanOrEqual(0);
    }
  });

  it("gets more rocks on a wider monitor, not a bigger gap", () => {
    expect(menuDebris(3840, H).length).toBeGreaterThan(menuDebris(1920, H).length);
  });
});

describe("chrome.ts no longer contains the hillside", () => {
  it("has no height-per-x band profile", () => {
    expect(CHROME, "the rolling-hill formula is back").not.toMatch(
      /Math\.sin\(x \/ \d+\)/,
    );
    expect(CHROME, "a filled band is being traced along the bottom edge").not.toMatch(
      /lineTo\([^)]*GAME_HEIGHT - h\)/,
    );
  });

  it("does not describe itself as a silhouette band any more", () => {
    expect(CHROME).not.toContain("flat silhouette band");
  });
});
