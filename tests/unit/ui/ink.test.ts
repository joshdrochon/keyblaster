import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@engine/contrast/index.js";
import { compositeOver } from "@engine/contrast/index.js";
import { INK } from "@game/ui/theme";

/**
 * WORDS A CHILD HAS TO READ CLEAR 4.5:1 (AC-22.8, D41).
 *
 * A pass over the captured screens measured the menu chrome and found two inks
 * failing wherever they carried TEXT:
 *
 *   INK.textFaint  #6A7A8E   ~3.4:1 on the panel   (the keyboard hint, a
 *                                                   name field's placeholder)
 *   INK.locked     #3A4656   ~1.6:1 on the panel   (every locked row and tile:
 *                                                   "pluto", "not lit yet",
 *                                                   and all twelve trophies)
 *
 * 1.6:1 is not dim, it is absent, and it was carrying the exact copy a child
 * needs most - the sentence that says how a locked thing is unlocked.
 *
 * BOTH INKS STAY LEGAL FOR STROKES, FILLS AND GLYPHS. A dim outline is a
 * drawing decision; a dim sentence is a reading failure. So the rule is scoped
 * to text colour, and it is enforced by reading the lane's own source rather
 * than by trusting a comment.
 */

const file = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../${name}`, import.meta.url)), "utf8");

/** The menu-scene family: this lane's files, and only this lane's files. */
const LANE = [
  "src/game/scenes/BeaconLogScene.ts",
  "src/game/scenes/PauseScene.ts",
  "src/game/ui/controls.ts",
  "src/game/ui/chrome.ts",
  "src/game/ui/MenuScene.ts",
  "src/game/ui/text.ts",
  "src/game/ui/layout.ts",
];

/** Surfaces text in this lane is drawn on, composited the way it is painted. */
const PANEL = compositeOver(INK.panel, 0.92, INK.bg);
const PANEL_SUNKEN = compositeOver(INK.panelSunken, 0.55, INK.bg);
const PANEL_RAISED = compositeOver(INK.panelRaised, 0.92, INK.bg);
const SKY = INK.bgDeep;

describe("menu chrome contrast", () => {
  const surfaces: Record<string, string> = {
    panel: PANEL,
    "locked plate": PANEL_SUNKEN,
    "focused plate": PANEL_RAISED,
    sky: SKY,
  };

  for (const [name, surface] of Object.entries(surfaces)) {
    it(`INK.text reads on the ${name}`, () => {
      expect(contrastRatio(INK.text, surface)).toBeGreaterThanOrEqual(4.5);
    });

    it(`INK.textDim reads on the ${name}`, () => {
      expect(contrastRatio(INK.textDim, surface)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("the two inks this lane moved off of are the ones that failed", () => {
    // A negative control: if someone "fixes" the bar by lightening the tokens,
    // this test says so instead of silently passing.
    expect(contrastRatio(INK.textFaint, PANEL)).toBeLessThan(4.5);
    expect(contrastRatio(INK.locked, PANEL)).toBeLessThan(4.5);
  });
});

/**
 * Every expression this lane hands to a TEXT COLOUR, whatever shape it is in:
 * `setColor(x)`, `color: x` in a `uiText` options object, and the ternaries
 * both of those are usually written as. Comments are stripped first, so the
 * paragraphs above - which name the failing inks on purpose - are not findings.
 */
function textColourExpressions(source: string): string[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const out: string[] = [];

  const readBalanced = (from: number, stop: (ch: string, depth: number) => boolean) => {
    let depth = 0;
    for (let i = from; i < code.length; i += 1) {
      const ch = code[i] as string;
      if (ch === "(" || ch === "[" || ch === "{") depth += 1;
      else if (ch === ")" || ch === "]" || ch === "}") {
        if (depth === 0 && stop(ch, depth)) return code.slice(from, i);
        depth -= 1;
      } else if (depth === 0 && stop(ch, depth)) return code.slice(from, i);
    }
    return code.slice(from);
  };

  for (const m of code.matchAll(/\.setColor\(/g)) {
    const at = (m.index ?? 0) + m[0].length;
    out.push(readBalanced(at, (ch, d) => ch === ")" && d === 0));
  }
  for (const m of code.matchAll(/\bcolor:\s*/g)) {
    const at = (m.index ?? 0) + m[0].length;
    out.push(
      readBalanced(at, (ch, d) => d === 0 && (ch === "," || ch === "}" || ch === ";")),
    );
  }
  return out;
}

describe("no menu-scene file paints words in a failing ink", () => {
  for (const name of LANE) {
    it(name, () => {
      const bad = textColourExpressions(file(name)).filter((expr) =>
        /INK\.(locked|textFaint)/.test(expr),
      );
      expect(bad.map((e) => e.replace(/\s+/g, " ").trim())).toEqual([]);
    });
  }

  it("the scanner would catch a regression", () => {
    expect(
      textColourExpressions("x.setColor(\n  this.locked ? INK.locked : INK.text,\n);")
        .filter((e) => /INK\.locked/.test(e)),
    ).toHaveLength(1);
    expect(
      textColourExpressions("uiText(s, 0, 0, t, {\n  color: INK.textFaint,\n});")
        .filter((e) => /INK\.textFaint/.test(e)),
    ).toHaveLength(1);
    // A stroke or a fill in the same ink is fine, and must not be reported.
    expect(
      textColourExpressions("g.lineStyle(3, hexToNum(INK.locked), 1);"),
    ).toEqual([]);
  });
});
