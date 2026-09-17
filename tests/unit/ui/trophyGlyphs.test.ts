import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TROPHIES, TROPHY_GLYPH_IDS } from "@game/ui/catalog";

/**
 * TWELVE TROPHIES, TWELVE MARKS (D80, D74, D83).
 *
 * `beacon-log.png` showed twelve IDENTICAL person-shaped glyphs at about 10%
 * alpha. Twelve copies of one shape is not a set of icons - it carries no
 * information at all, so the only thing separating "sharp eye" from "long
 * memory" was the caption - and at 10% alpha over a #0E1116 panel the shape was
 * barely there. An unearned trophy is an INVITATION (D31/D74): a child has to
 * be able to see the thing they are being invited to.
 *
 * So each trophy names its own glyph, they are all different, and they are all
 * drawn in code (D83 - no raster is referenced from src/).
 */

const chrome = readFileSync(
  fileURLToPath(new URL("../../../src/game/ui/chrome.ts", import.meta.url)),
  "utf8",
);

describe("trophy glyphs", () => {
  it("every trophy names a glyph", () => {
    for (const trophy of TROPHIES) {
      expect(trophy.glyph, trophy.id).toBeTruthy();
    }
  });

  it("the twelve glyphs are twelve DIFFERENT glyphs", () => {
    expect(TROPHIES).toHaveLength(12);
    const glyphs = new Set(TROPHIES.map((t) => t.glyph));
    expect(glyphs.size).toBe(12);
  });

  it("every named glyph is one chrome.ts actually draws", () => {
    for (const trophy of TROPHIES) {
      expect(TROPHY_GLYPH_IDS).toContain(trophy.glyph);
      // The draw table is a switch on the id; a missing arm would silently
      // fall through to the default and put the same mark on two trophies.
      expect(chrome, trophy.glyph).toContain(`case "${trophy.glyph}"`);
    }
  });

  it("no raster asset is smuggled in (D83)", () => {
    expect(chrome).not.toMatch(/\.(png|jpg|jpeg|webp|gif|svg)\b/i);
    expect(chrome).not.toMatch(/scene\.add\.(image|sprite)\(/);
  });
});
