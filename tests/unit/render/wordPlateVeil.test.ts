import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STOP_IDS } from "@engine/types.js";
import { paletteAt } from "@game/render/palette";
import {
  PLATE_MIN_CONTRAST,
  VEIL_MAX_MIX,
  contrastRatio,
  mixToward,
  veiledTextColor,
  type WordPlateStyle,
} from "@game/render/wordPlateGeometry";

/**
 * D109: the colour a veiled letter takes is DERIVED from the contrast bar.
 *
 * The failure mode of Venus's cloud is a seven-year-old looking at a word they
 * cannot read, so the thickness is not a number somebody picked - it is walked
 * toward the plate until the next step would breach AC-22.8, then stepped back.
 * That is why this is swept over every shipped palette rather than checked on
 * Venus: a palette edit elsewhere must not quietly thicken the cloud.
 */
const style = (plate: string, text: string): WordPlateStyle => ({
  plate,
  plateText: text,
  accent: "#FFB03A",
  fontFamily: "sans-serif",
  fontSizePx: 30,
  letterSpacingPx: 0,
  uppercase: false,
  reducedMotion: false,
});

describe("AC-27.6: the cloud is as thick as legibility allows and no thicker", () => {
  it("still clears AC-22.8 on every shipped palette", () => {
    for (const id of STOP_IDS) {
      const p = paletteAt(id, false);
      const veiled = veiledTextColor(style(p.plate, p.plateText));
      const ratio = contrastRatio(p.plate, veiled);
      expect(ratio, `${id}: veiled text is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        PLATE_MIN_CONTRAST,
      );
    }
  });

  it("and clears it under the colourblind palette too", () => {
    for (const id of STOP_IDS) {
      const p = paletteAt(id, true);
      const veiled = veiledTextColor(style(p.plate, p.plateText));
      expect(contrastRatio(p.plate, veiled), `${id} colourblind`).toBeGreaterThanOrEqual(
        PLATE_MIN_CONTRAST,
      );
    }
  });

  it("is actually dimmer than resting text, or there is no cloud to see", () => {
    const p = paletteAt("venus", false);
    expect(contrastRatio(p.plate, veiledTextColor(style(p.plate, p.plateText)))).toBeLessThan(
      contrastRatio(p.plate, p.plateText),
    );
  });

  it("falls back to resting text rather than breaching, on a cramped palette", () => {
    // Plate and text already AT the bar: any veil would breach, so there is no
    // cloud. "No mechanic" beats "a word nobody can read" (D31).
    const got = veiledTextColor(style("#0E1116", "#83868B"));
    expect(contrastRatio("#0E1116", got)).toBeGreaterThanOrEqual(PLATE_MIN_CONTRAST);
  });

  it("never walks past VEIL_MAX_MIX, even where contrast would allow it", () => {
    const p = paletteAt("venus", false);
    const floor = contrastRatio(p.plate, mixToward(p.plateText, p.plate, VEIL_MAX_MIX));
    expect(contrastRatio(p.plate, veiledTextColor(style(p.plate, p.plateText)))).toBeGreaterThanOrEqual(
      floor - 0.01,
    );
  });

  it("mixToward is clamped, so junk cannot produce a colour off the ramp", () => {
    expect(mixToward("#FFFFFF", "#000000", -5)).toBe("#ffffff");
    expect(mixToward("#FFFFFF", "#000000", 5)).toBe("#000000");
  });
});

/**
 * The bug this caught, and the shape of it.
 *
 * `setVeilWindow` first repainted by calling `setTypedCount(this.typedCount_)`
 * - its own current value - and `setTypedCount` opens with an
 * unchanged-value early-out, so the call returned immediately and Venus flew
 * uncloaked until the player's first keystroke. Every unit test passed; the
 * Playwright probe read ten plateText letters off the live canvas.
 *
 * So the guard is on the SHAPE, not on the veil: re-entering a guarded setter
 * with the field it guards is a no-op by construction. WordPlate extends a
 * Phaser container and cannot be imported under vitest (see
 * wordPlateOpacity.test.ts), which is why this reads source.
 */
const SRC = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../src/game/render/wordPlate.ts",
);

/** Setters that open with `if (x === this.x_) return` and so swallow a self-call. */
function guardedSetters(source: string): string[] {
  const out: string[] = [];
  const re = /set([A-Z]\w*)\(([a-zA-Z]\w*)[^)]*\):\s*\w+\s*\{\s*(?:const\s+(\w+)[^;]*;\s*)?if\s*\(\s*(\w+)\s*===\s*this\.(\w+)\s*\)\s*return;/g;
  for (const m of source.matchAll(re)) out.push(`set${m[1] ?? ""}`);
  return out;
}

/** Calls of the form `this.setFoo(this.anything)` - a setter re-entered with a field. */
function selfCalls(source: string): string[] {
  return [...source.matchAll(/this\.(set[A-Z]\w*)\(\s*this\.\w+\s*\)/g)].map(
    (m) => m[1] ?? "",
  );
}

describe("AC-27.6: a guarded setter is never re-entered to force a repaint", () => {
  const source = readFileSync(SRC, "utf8");

  it("finds the early-out setters it is meant to be watching", () => {
    expect(guardedSetters(source)).toContain("setTypedCount");
  });

  it("no setter in wordPlate.ts is called with one of the plate's own fields", () => {
    const guarded = new Set(guardedSetters(source));
    const offenders = selfCalls(source).filter((name) => guarded.has(name));
    expect(offenders, `${offenders.join(", ")} would return without repainting`).toEqual([]);
  });

  it("negative control: FLAGS the form that shipped Venus uncloaked", () => {
    const broken = source.replace(
      /setVeilWindow\(window: number \| null\): void \{[\s\S]*?\n  \}/,
      [
        "setVeilWindow(window: number | null): void {",
        "    this.veilWindow = window;",
        "    this.setTypedCount(this.typedCount_);",
        "  }",
      ].join("\n"),
    );
    const guarded = new Set(guardedSetters(broken));
    expect(selfCalls(broken).filter((n) => guarded.has(n))).toEqual(["setTypedCount"]);
  });
});
