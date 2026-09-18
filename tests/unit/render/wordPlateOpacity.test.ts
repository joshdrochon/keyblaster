import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * THE WORD PLATE IS A SURFACE. NOTHING IS VISIBLE THROUGH ONE. (UR-23, AC-22.8)
 *
 * ================== WHY THIS EXISTS SEPARATELY ==================
 * `tests/unit/scenes/plateOpacity.test.ts` already asserts this for every UI
 * card, after a critic found the moon showing through a results card at L* 11.9
 * against a body of L* 10.0. That guard sweeps `src/game/scenes`, so it never
 * looked at `src/game/render/wordPlate.ts` - and the word plate, the one plate
 * in this game whose entire job is to be read, was still filling at 0.92.
 *
 * ================== WHAT THE 8% COST ==================
 * 1. The evidence for V-22.8 is computed with `contrastRatio` /
 *    `meetsPlateContrast`, which take the flat swatch. A plate drawn at 0.92 is
 *    that swatch composited over whatever is behind it, so the ratio in the
 *    artifact is not the ratio on the screen. Same sentence as the UI cards:
 *    the evidence was not wrong about the intent, the drawing was wrong about
 *    the evidence.
 * 2. UR-23 is "a rock is covering a word". Putting the plate layer above the
 *    whole world (`FlightScene.PLATE_DEPTH`) stops anything drawing OVER a
 *    plate; it does nothing about the near-black `foreVeil` silhouette showing
 *    THROUGH one. At the board depths the belt now reaches, more plates pass
 *    over more of the near planes, so the odds go up rather than down.
 *
 * ================== WHY IT READS THE SOURCE ==================
 * `wordPlate.ts` declares `class WordPlate extends Phaser.GameObjects.Container`,
 * so importing anything from it executes Phaser and dies on "window is not
 * defined" under vitest's node environment (the same wall
 * `tests/unit/flight/hudKeepOut.test.ts` documents). Until that module is split,
 * a source guard is the only binding available - and it is the same one the UI
 * card guard uses, for the same reason.
 *
 * WATCHED FAILING, with `PLATE_FILL_ALPHA` put back to the shipped 0.92:
 *
 *   the word plate is drawn at 0.92 of a surface: expected '0.92' to be '1'
 *
 * and with the constant left at 1 but the draw call reverted to the literal
 * (`fillStyle(hexToInt(this.style.plate), 0.92 * alpha)`):
 *
 *   the word plate's backing fills at a literal alpha rather than
 *   PLATE_FILL_ALPHA: expected false to be true
 *
 *   npx vitest run tests/unit/render/wordPlateOpacity.test.ts --coverage.enabled=false
 */

const SOURCE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../src/game/render/wordPlate.ts",
);

/** Comments stripped, so a guard cannot be satisfied by a promise in prose. */
function code(): string {
  return readFileSync(SOURCE, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("AC-22.8: the word plate is opaque", () => {
  it("declares a fill alpha of exactly 1", () => {
    const match = /PLATE_FILL_ALPHA\s*=\s*([0-9.]+)/.exec(code());
    expect(match, "PLATE_FILL_ALPHA is gone from wordPlate.ts").not.toBeNull();
    const declared = (match as RegExpExecArray)[1] as string;
    expect(declared, `the word plate is drawn at ${declared} of a surface`).toBe("1");
  });

  it("fills the backing through that constant, not through a literal", () => {
    const src = code();
    expect(
      /fillStyle\(\s*hexToInt\(this\.style\.plate\)\s*,\s*PLATE_FILL_ALPHA/.test(src),
      "the word plate's backing fills at a literal alpha rather than PLATE_FILL_ALPHA",
    ).toBe(true);
  });

  it("puts no other partial alpha on the plate body", () => {
    /**
     * The charge wash (AC-2.2) is drawn OVER an opaque backing and is meant to
     * be partial - it is the plate brightening toward the accent, not the sky
     * coming through. So this looks only at fills of the plate SWATCH.
     */
    const bodyFills = [...code().matchAll(/fillStyle\(\s*hexToInt\(this\.style\.plate\)\s*,([^)]*)\)/g)];
    expect(bodyFills.length, "nothing fills the plate body any more").toBeGreaterThan(0);
    for (const fill of bodyFills) {
      expect(
        (fill[1] as string).trim(),
        "a second fill of the plate body is partially transparent",
      ).toBe("PLATE_FILL_ALPHA * alpha");
    }
  });
});
