import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WORST_CASE_SKY, compositeOver } from "@engine/contrast/index.js";
import { INK, SKY_PLATE } from "@game/ui/theme";

/**
 * A CARD IS A SURFACE. NOTHING IS VISIBLE THROUGH ONE.
 *
 * ================== THE DEFECT, AND ITS SPREAD ==================
 * `lib/kit.plate` filled at alpha 0.94 by default, and four scenes asked for
 * 0.92 explicitly. At the size these plates are drawn, what comes through is
 * not a tint, it is a SHAPE. Probed off the captures:
 *
 *   results.png   card body L* 10.0, and L* 11.9 inside the moon's footprint
 *   warp.png      card body L*  9.9, and L* 12.1 in the sliver of the same moon
 *
 * The critic reported the first. The second is the same bug on the screen a
 * player sees seven times a playthrough, which is why this is a check about
 * EVERY caller rather than an edit to one scene.
 *
 * ================== WHY IT MATTERED TWICE ==================
 * `skyText` registers text drawn on a scene's own panel as
 * `{ plateFill: <the panel's swatch>, plateAlpha: 1 }`. So V-22.8 has been
 * measuring these surfaces as opaque all along while they were drawn at 0.94
 * over whatever sky was behind them. The evidence was not wrong about the
 * intent; the drawing was wrong about the evidence.
 *
 * Watch it fail: put `?? 0.94` back in `lib/kit.plate`, or `{ alpha: 0.92 }`
 * back on the Director map's panel.
 *
 *   npx vitest run tests/unit/scenes/plateOpacity.test.ts --coverage.enabled=false
 */

const SCENES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../src/game/scenes",
);

const KIT = readFileSync(resolve(SCENES, "lib/kit.ts"), "utf8");

/** Every scene file, with comments stripped so a guard cannot read an excuse. */
function sceneSources(): { file: string; code: string }[] {
  return readdirSync(SCENES)
    .filter((f) => f.endsWith("Scene.ts"))
    .map((file) => ({
      file,
      code: readFileSync(resolve(SCENES, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, ""),
    }));
}

describe("the shared plate is opaque", () => {
  it("defaults to alpha 1", () => {
    expect(KIT).toContain("options.alpha ?? 1");
    expect(KIT, "the shipped 0.94 default is back").not.toContain("options.alpha ?? 0.94");
  });

  it("is never asked for a translucent fill by a scene", () => {
    const offenders: string[] = [];
    for (const { file, code } of sceneSources()) {
      // `plate(this, ...)` is the kit's; the alpha, if any, is in its options
      // object. A number below 1 there is the defect.
      for (const call of code.matchAll(/\bplate\(\s*this[\s\S]{0,400}?\)\s*[.;]/g)) {
        const m = call[0].match(/alpha:\s*([\d.]+)/);
        if (m?.[1] !== undefined && Number(m[1]) < 1) {
          offenders.push(`${file}: alpha ${m[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("NEGATIVE CONTROL: the guard catches a translucent call", () => {
    const shipped = `plate(this, PANEL.x, PANEL.y, PANEL.w, PANEL.h, { alpha: 0.92 }).setDepth(9);`;
    const found = [...shipped.matchAll(/\bplate\(\s*this[\s\S]{0,400}?\)\s*[.;]/g)]
      .map((c) => c[0].match(/alpha:\s*([\d.]+)/)?.[1])
      .filter((a) => a !== undefined);
    expect(found).toEqual(["0.92"]);
  });

  it("composites to its own swatch over any sky", () => {
    const swatch = INK.panel.toLowerCase();
    expect(compositeOver(INK.panel, 1, WORST_CASE_SKY)).toBe(swatch);
    // What shipped: 6% of a near-white celestial body, which is the ~2 L* of
    // ghost the critic measured.
    expect(compositeOver(INK.panel, 0.94, WORST_CASE_SKY)).not.toBe(swatch);
  });
});

describe("the sky plate is a different object and keeps its glass", () => {
  it("is still 0.97, because a strip of type is not a card", () => {
    // The word plate measures 15.58:1 and is at bar; this lane does not touch
    // it. 3% of sky through a 40 px strip behind one line is a tint, and the
    // contrast module composites it over white so the reported ratio is
    // already the worst case any sky can produce.
    expect(SKY_PLATE.alpha).toBe(0.97);
    expect(SKY_PLATE.fill).toBe(INK.panel);
  });
});
