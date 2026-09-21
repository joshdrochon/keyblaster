import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearGlyphAdvanceCache,
  fontStringOf,
  glyphAdvancePx,
  installGlyphMeasurer,
} from "@game/render/glyphAdvance.js";
import {
  canvasGlyphMeasurer,
  installCanvasGlyphMeasurer,
} from "@game/render/measureGlyphAdvances.js";

/**
 * THE CANVAS HALF OF THE PLATE'S SPACING, UNDER THE UNIT GATE.
 *
 * `measureGlyphAdvances.ts` is the only DOM in the word plate's layout path and
 * it is one function, but it is the function that decides whether the number
 * the layout reserves is the number the renderer draws. Two things about it are
 * load-bearing and neither is visible from a screenshot:
 *
 *   1. THE FONT STRING MUST MATCH PHASER'S. `Phaser.GameObjects.Text` builds
 *      `<fontStyle> <fontSize> <fontFamily>` and measures and draws with it. If
 *      this file sets a different string on its context it measures a different
 *      face and the plate goes back to laying letters on numbers that are not
 *      about the glyphs it draws - the original defect, wearing a measurement.
 *   2. NO DOM MUST NOT THROW. The geometry is imported by a dozen node-side
 *      unit tests and by `scripts/`; an unguarded `document` there takes the
 *      whole suite out.
 *
 * The context is faked rather than mocked out of the module, so the assertions
 * are about the real code path: `document.createElement("canvas").getContext`
 * is what it calls, and that is what is stood up here.
 *
 * WATCHED FAILING is recorded per assertion.
 *
 * RUN IT ALONE:
 *   npx vitest run tests/unit/render/glyphMeasurer.test.ts --coverage.enabled=false
 */

const SRC = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../src/game/render/measureGlyphAdvances.ts",
);

interface FakeCtx {
  font: string;
  readonly seen: { font: string; text: string }[];
  measureText(text: string): { width: number };
}

const installFakeCanvas = (
  make: () => FakeCtx | null,
): { ctx: FakeCtx | null; restore: () => void } => {
  const ctx = make();
  const previous = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    createElement: (tag: string) => {
      expect(tag, "the measurer asked for something that is not a canvas").toBe("canvas");
      return { getContext: (kind: string) => (kind === "2d" ? ctx : null) };
    },
  };
  return {
    ctx,
    restore: () => {
      if (previous === undefined) delete (globalThis as { document?: unknown }).document;
      else (globalThis as { document?: unknown }).document = previous;
    },
  };
};

const makeCtx = (widths: Readonly<Record<string, number>>): FakeCtx => ({
  font: "",
  seen: [],
  measureText(text: string) {
    this.seen.push({ font: this.font, text });
    return { width: widths[text] ?? 1 };
  },
});

afterEach(() => {
  installGlyphMeasurer(null);
  clearGlyphAdvanceCache();
});

describe("the canvas measurer", () => {
  /**
   * WATCHED FAILING - `canvasGlyphMeasurer` setting
   * `context.font = fontFamily` without the size:
   *   AssertionError: the measurer set the canvas font to "Comic" and Phaser
   *     will draw with "30px Comic": expected 'Comic' to be '30px Comic'
   */
  it("sets the same font string Phaser's Text builds, and measures with it", () => {
    const fake = installFakeCanvas(() => makeCtx({ m: 24.5, i: 6.5 }));
    try {
      const measurer = canvasGlyphMeasurer();
      expect(measurer).not.toBeNull();
      const out = measurer?.("Comic", 30, ["m", "i"]) ?? [];
      expect(out).toEqual([24.5, 6.5]);
      const ctx = fake.ctx;
      expect(ctx?.seen.length).toBe(2);
      for (const call of ctx?.seen ?? []) {
        expect(
          call.font,
          `the measurer set the canvas font to "${call.font}" and Phaser will draw with "30px Comic"`,
        ).toBe("30px Comic");
      }
      // The same builder both halves use, so the two strings cannot drift.
      expect(fontStringOf("Comic", 30)).toBe("30px Comic");
    } finally {
      fake.restore();
    }
  });

  /**
   * The measured number has to reach `plateSize`, or the wiring is decorative.
   *
   * WATCHED FAILING - `installCanvasGlyphMeasurer` returning without calling
   * `installGlyphMeasurer`:
   *   AssertionError: expected 24.4923 to be 24.5 // Object.is equality
   */
  it("install() puts the canvas behind glyphAdvancePx", () => {
    const fake = installFakeCanvas(() => makeCtx({ m: 24.5 }));
    try {
      expect(installCanvasGlyphMeasurer()).toBe(true);
      expect(glyphAdvancePx("m", "Comic", 30)).toBe(24.5);
    } finally {
      fake.restore();
    }
  });

  /**
   * WATCHED FAILING - the `typeof document === "undefined"` guard AND the
   * catch below it both removed (either one alone holds this case up, which is
   * the point of having both):
   *   Error: 0
   *    ❯ measuringContext src/game/render/measureGlyphAdvances.ts
   */
  it("says so rather than throwing where there is no DOM", () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe("undefined");
    expect(canvasGlyphMeasurer()).toBeNull();
    expect(installCanvasGlyphMeasurer()).toBe(false);
    // And the plate still lays itself out, on the shipped table.
    expect(glyphAdvancePx("m", "Comic", 30)).toBeGreaterThan(20);
  });

  /**
   * A browser that cannot hand back a 2d context - out of contexts, a hardened
   * profile - must not take the layout down with it. Both shapes: one that
   * answers null and one that throws, because only the second reaches the
   * catch and a guard that never reaches its own case is not a guard.
   *
   * WATCHED FAILING - `catch { return null; }` changed to rethrow:
   *   Error: 0
   *    ❯ Object.createElement tests/unit/render/glyphMeasurer.test.ts
   */
  it("survives a canvas that refuses a 2d context", () => {
    const refusing = installFakeCanvas(() => null);
    try {
      expect(() => canvasGlyphMeasurer()).not.toThrow();
      expect(installCanvasGlyphMeasurer()).toBe(false);
    } finally {
      refusing.restore();
    }

    const previous = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      createElement: () => {
        throw new Error("this profile has no canvas");
      },
    };
    try {
      expect(() => canvasGlyphMeasurer()).not.toThrow();
      expect(installCanvasGlyphMeasurer()).toBe(false);
    } finally {
      if (previous === undefined) delete (globalThis as { document?: unknown }).document;
      else (globalThis as { document?: unknown }).document = previous;
    }
  });

  /**
   * THE PURITY LINE, ASSERTED AS SOURCE.
   *
   * `wordPlateGeometry.ts` imports `glyphAdvance.ts`; a `document` reference
   * that reached either of those would kill every node-side test that lays a
   * plate out, and the split exists precisely to stop that. A source guard is
   * the only binding available - a passing import proves nothing once the
   * reference is inside a branch that this environment does not take.
   *
   * WATCHED FAILING - `document.createElement` moved into `glyphAdvance.ts`:
   *   AssertionError: glyphAdvance.ts reaches for document; it is imported by
   *     the pure geometry: expected true to be false // Object.is equality
   */
  it("keeps the DOM out of glyphAdvance.ts and wordPlateGeometry.ts", () => {
    for (const name of ["glyphAdvance.ts", "wordPlateGeometry.ts"]) {
      const src = readFileSync(resolve(dirname(SRC), name), "utf8");
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      for (const forbidden of ["document", "window", "phaser", "Phaser", "canvas"]) {
        expect(
          code.includes(forbidden),
          `${name} reaches for ${forbidden}; it is imported by the pure geometry`,
        ).toBe(false);
      }
    }
  });

  /**
   * And the one place that IS allowed to touch the DOM is wired up, once, at
   * boot - before any scene starts, because `FlightScene` asks `plateSize` for
   * a word's plate while choosing a rock's spawn column.
   *
   * WATCHED FAILING - the `installCanvasGlyphMeasurer()` call deleted from
   * `bootGame`:
   *   AssertionError: boot.ts never installs the glyph measurer, so every plate
   *     in the game is laid out on the node fallback table: expected false to be true
   */
  it("boot.ts installs it", () => {
    const boot = readFileSync(resolve(dirname(SRC), "../boot.ts"), "utf8");
    expect(
      /installCanvasGlyphMeasurer\(\)\s*;/.test(boot),
      "boot.ts never installs the glyph measurer, so every plate in the game is laid out on the node fallback table",
    ).toBe(true);
  });
});
