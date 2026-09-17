import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  TEXT_MIN_CONTRAST,
  contrastRatio,
  measureTexts,
  type TextSample,
} from "@engine/contrast/index.js";
import { PALETTE_STOP_IDS, paletteAt } from "@game/render/palette";
import { INK } from "@game/ui/theme";
import {
  highlightSpans,
  prefixOf,
  quotedWords,
} from "@game/scenes/support/coachHighlight";

/**
 * UR-24 - THE WORDS SHADOW NAMES STAND OUT.
 *
 * UR-24 asked for the words Shadow names to be drawn in a colour that stands
 * out from the rest of the line. They are the words the child meets again on
 * the next belt, so this is a learning affordance, not a swatch.
 *
 * Two things can go wrong and both are checked here:
 *
 *   1. THE SPAN IS IN THE WRONG PLACE. A highlight computed from the unwrapped
 *      note lands in the middle of nowhere the moment the paragraph wraps, and
 *      a coloured smear across the wrong word is worse than no colour at all.
 *   2. THE COLOUR CANNOT BE READ. "Gold" on a charcoal panel is the classic way
 *      to ship 2:1, and AC-22.8's 4.5:1 applies to this run exactly as it
 *      applies to the rest of the line.
 *
 *   npx vitest run tests/unit/scenes/coachHighlight.test.ts --coverage.enabled=false
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../../src");

/** The shipped mock templates, read from the engine rather than transcribed. */
function shippedTemplates(): string[] {
  const src = readFileSync(resolve(SRC, "engine/coach/mock.ts"), "utf8");
  return [...src.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/'([^'\n]*\{a\}[^'\n]*)'/g)]
    .map((m) => m[1])
    .filter((t): t is string => t !== undefined);
}

describe("finding the words in the note", () => {
  it("reads the quoted words, without their quotes", () => {
    expect(quotedWords('You had that one. Keep an eye on "solid" and "rock".')).toEqual([
      "solid",
      "rock",
    ]);
    expect(quotedWords("That was a clean run, pilot.")).toEqual([]);
  });

  it("covers every template the shipped mock can produce", () => {
    const templates = shippedTemplates();
    expect(templates.length).toBeGreaterThan(0);
    for (const template of templates) {
      const filled = template.replace("{a}", "solid").replace("{b}", "rock");
      const found = quotedWords(filled);
      expect(found.length, filled).toBe(template.includes("{b}") ? 2 : 1);
      expect(found[0], filled).toBe("solid");
    }
  });
});

describe("placing the highlight on the WRAPPED paragraph", () => {
  const lines = [
    'You had that one. Keep an eye on "solid"',
    'and "rock".',
  ];

  it("reports the line and the offset within it", () => {
    const spans = highlightSpans(lines, ["solid", "rock"]);
    expect(spans).toEqual([
      { line: 0, start: 34, text: "solid" },
      { line: 1, start: 5, text: "rock" },
    ]);
    expect(prefixOf(lines, spans[0]!)).toBe('You had that one. Keep an eye on "');
    expect(prefixOf(lines, spans[1]!)).toBe('and "');
  });

  it("NEGATIVE CONTROL: the unwrapped string puts the second word off the line", () => {
    // What a naive implementation does: index into the whole note. "rock" is at
    // character 46 there, which is past the end of the line it is drawn on.
    const flat = 'You had that one. Keep an eye on "solid" and "rock".';
    expect(flat.indexOf("rock")).toBeGreaterThan((lines[0] as string).length);
  });

  it("drops a span it cannot find rather than guessing at one", () => {
    // Wrapping split the word, so there is nothing honest to colour.
    expect(highlightSpans(["a bro", "ken word"], ["broken"])).toEqual([]);
    expect(highlightSpans([], ["solid"])).toEqual([]);
  });

  it("does not let one word steal another's occurrence", () => {
    const repeated = ['"rock" and "rock"'];
    const spans = highlightSpans(repeated, ["rock", "rock"]);
    expect(spans.map((s) => s.start)).toEqual([1, 12]);
  });

  it("finds a word that also appears unquoted earlier in the line", () => {
    // The highlight is drawn over whichever occurrence comes first on the line;
    // what matters is that it is a REAL occurrence of the word, so the coloured
    // glyphs cover the base glyphs exactly.
    const spans = highlightSpans(['rocks fall. watch "rock".'], ["rock"]);
    expect(spans).toHaveLength(1);
    expect(prefixOf(['rocks fall. watch "rock".'], spans[0]!)).toBe("");
  });
});

describe("the highlight ink clears AC-22.8 on the coach panel", () => {
  it("passes for every stop, in both palettes", () => {
    const rows: TextSample[] = [];
    for (const stop of PALETTE_STOP_IDS) {
      for (const colorblind of [false, true]) {
        rows.push({
          screen: "warp",
          id: `warp.coachNote.named@${stop}${colorblind ? "-cb" : ""}`,
          color: paletteAt(stop, colorblind).accent,
          // `WarpScene.buildCoachArea` fills the coach plate flat with INK.panel.
          plateFill: INK.panel,
          plateAlpha: 1,
        });
      }
    }
    const report = measureTexts(rows);
    expect(
      report.failing.map((r) => `${r.id} ${r.color} on ${r.backdrop} = ${r.ratio}:1`),
    ).toEqual([]);
  });

  /**
   * Perceptual distance, CIE76, because a WCAG ratio is the wrong question
   * here. On a charcoal panel every readable ink is light, so a gold word and a
   * white word are ~1.2:1 apart in LUMINANCE and unmistakable to look at: what
   * separates them is hue and chroma, which is what dE measures. A first cut of
   * this test asserted the ratio and would have rejected gold.
   */
  function deltaE(a: string, b: string): number {
    const lin = (c: number): number => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const lab = (hex: string): [number, number, number] => {
      const [r, g, bl] = [0, 2, 4].map((i) =>
        lin(Number.parseInt(hex.replace("#", "").slice(i, i + 2), 16)),
      ) as [number, number, number];
      const X = (0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.95047;
      const Y = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
      const Z = (0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.08883;
      const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
      return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
    };
    const A = lab(a);
    const B = lab(b);
    return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
  }

  it("is visibly a different colour from the line it sits in", () => {
    // The point of the change: the named word must not read as more of the
    // same sentence. The base ink is `plateText`; the named run is the stop
    // accent, and the two have to be separable at a glance.
    //
    // NOT `INK.accent` CHOSEN DIRECTLY, on purpose: that is the one saturated
    // colour the menu system reserves for "you are here" (the focus ring), and
    // a named word is not a focus state. The STOP accent happens to equal it at
    // Earth - which has no belt and therefore no warp break - and differs
    // everywhere a child will actually see this.
    for (const stop of PALETTE_STOP_IDS) {
      for (const colorblind of [false, true]) {
        const pal = paletteAt(stop, colorblind);
        // dE 15 is comfortably past the ~5 where a difference becomes
        // noticeable; the weakest pair the palettes can produce is Saturn's
        // pale blue under the colourblind palette, at 16.
        expect(
          deltaE(pal.accent, pal.plateText),
          `${stop}${colorblind ? "-cb" : ""}`,
        ).toBeGreaterThan(15);
      }
    }
    // NEGATIVE CONTROL: the base ink against itself is no distance at all.
    expect(deltaE(INK.text, INK.text)).toBe(0);
  });

  it("NEGATIVE CONTROL: a plausible 'gold' fails on this panel", () => {
    // The trap the brief named: a warm mid gold on charcoal is 2-4:1.
    expect(contrastRatio("#8A6D1F", INK.panel)).toBeLessThan(TEXT_MIN_CONTRAST);
  });
});

/**
 * UR-41 - THE WARP SENTENCE'S UNTYPED LETTERS.
 *
 * A blind critic measured them at 4.33:1 and reported them as the only text in
 * the game under the stated bar. `paintLetters` dims the filler with ALPHA, and
 * an alpha is a contrast change that no swatch-based check can see - which is
 * why 69 sky-borne rows and every ink table in this suite missed it.
 *
 * ================== THE DECISION, MADE EXPLICITLY ==================
 * It is 52 px type, so WCAG 2.1 would allow 3:1 and the shipped value would
 * pass. The bar on this project is 4.5:1 AT EVERY SIZE - `engine/contrast`
 * states it and gives the reason: this is read by 7-to-11 year olds under D41's
 * legibility rules, and the word plate already clears 17:1. Re-baselining the
 * bar to 3:1 for large type would silently move every other large string in the
 * game too, on the day one string failed. So the ALPHA moved, not the bar.
 */
describe("the warp sentence's dimmed letters clear the bar", () => {
  const PANEL_FILL = INK.panel;
  const over = (alpha: number, ink: string): string => {
    const ch = (h: string): number[] =>
      [0, 2, 4].map((i) => Number.parseInt(h.replace("#", "").slice(i, i + 2), 16));
    const f = ch(ink);
    const b = ch(PANEL_FILL);
    return `#${[0, 1, 2]
      .map((i) =>
        Math.round((f[i] as number) * alpha + (b[i] as number) * (1 - alpha))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
  };

  /**
   * The alphas `WarpScene.paintLetters` puts on a letter, READ OUT OF THE
   * SCENE rather than transcribed.
   *
   * A first version pasted 0.55 in here and stayed green when the scene was put
   * back to the shipped 0.45 - only the source guard below noticed. A contrast
   * assertion against a number the code no longer uses is not a contrast
   * assertion; it is a second copy of an opinion.
   */
  const alphas = ((): { filler: number; blasted: number } => {
    const src = readFileSync(resolve(SRC, "game/scenes/WarpScene.ts"), "utf8");
    const m = src.match(/setAlpha\(cell\.blasted \? ([\d.]+) : ([\d.]+)\)/);
    if (m?.[1] === undefined || m?.[2] === undefined) {
      throw new Error("WarpScene no longer dims its letters with a literal alpha");
    }
    return { blasted: Number(m[1]), filler: Number(m[2]) };
  })();
  const FILLER = alphas.filler;
  const BLASTED = alphas.blasted;

  it("every stop's filler clears 4.5:1, in both palettes", () => {
    const rows: TextSample[] = [];
    for (const stop of PALETTE_STOP_IDS) {
      for (const colorblind of [false, true]) {
        const pal = paletteAt(stop, colorblind);
        rows.push({
          screen: "warp",
          id: `warp.sentence.filler@${stop}${colorblind ? "-cb" : ""}`,
          color: over(FILLER, pal.plateText),
          plateFill: PANEL_FILL,
          plateAlpha: 1,
        });
      }
    }
    expect(
      measureTexts(rows).failing.map((r) => `${r.id} = ${r.ratio}:1`),
    ).toEqual([]);
  });

  it("NEGATIVE CONTROL: the shipped 0.45 is under the bar", () => {
    expect(contrastRatio(over(0.45, "#F7FAFF"), PANEL_FILL)).toBeLessThan(
      TEXT_MIN_CONTRAST,
    );
  });

  it("keeps the three states readable as three states", () => {
    // D30's highlight only means something if filler, blasted and current are
    // still three distinguishable steps after the floor was raised.
    const filler = contrastRatio(over(FILLER, "#F7FAFF"), PANEL_FILL);
    const blasted = contrastRatio(over(BLASTED, "#F7FAFF"), PANEL_FILL);
    const current = contrastRatio("#F7FAFF", PANEL_FILL);
    expect(filler).toBeLessThan(blasted);
    expect(blasted).toBeLessThan(current);
    expect(blasted / filler).toBeGreaterThan(1.5);
  });

  it("is the alpha that moved, not the bar", () => {
    // If anyone ever lowers `TEXT_MIN_CONTRAST` to buy a large-type exemption,
    // this is the line that says no.
    expect(TEXT_MIN_CONTRAST).toBe(4.5);
    const src = readFileSync(resolve(SRC, "game/scenes/WarpScene.ts"), "utf8");
    expect(src).toContain("cell.blasted ? 0.8 : 0.55");
  });
});
