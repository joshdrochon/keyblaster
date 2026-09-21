import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FALLBACK_ADVANCE_EM,
  SYSTEM_SANS_ADVANCE_EM,
  clearGlyphAdvanceCache,
  fontStringOf,
  glyphAdvancePx,
  glyphAdvanceSource,
  installGlyphMeasurer,
  type GlyphMeasurer,
} from "@game/render/glyphAdvance.js";
import {
  PLATE_PAD_X_PX,
  type WordPlateStyle,
  letterAdvancesPx,
  letterCentresPx,
  plateGlyphs,
  plateSize,
  textRunWidthPx,
} from "@game/render/wordPlateGeometry.js";
import { retentionPoolFor, stagePoolFor } from "@game/flight/stage.js";
import { STOP_IDS } from "@engine/types.js";

/**
 * UR: "THE LETTERS ON THE ROCKS ARE UNEVENLY SPACED", AND SOME OF THEM TOUCH.
 *
 * ================== THE DEFECT, AS IT SHIPPED ==================
 * `wordPlate.ts` created one `Text` per character - it has to, the typed-letter
 * cue is per character - and placed them at `startX + i * cell` with
 * `setOrigin(0.5, 0.5)`. `cell` was `wordPlateGeometry.cellWidthPx`:
 *
 *     fontSizePx * 0.62 + letterSpacingPx
 *
 * ONE NUMBER FOR EVERY CHARACTER - 19.6 px at Flight's `fontSizePx: 30`,
 * `letterSpacingPx: 1` - while the face is proportional. Measured advances at
 * 30 px in "Avenir Next" run from 7.50 px (`i`) to 26.49 px (`m`): a spread of
 * 18.99 px on a 19.6 px cell, so `m` overflowed its cell by 6.89 px and `w` by
 * 2.78 px, and adjacent glyphs overlapped.
 *
 * ================== WHAT IS ASSERTED, AND WHY IT IS FONT-FREE ==================
 * The fix is not a better constant, so this file does not test one. The plate
 * now packs each glyph's own ADVANCE BOX and puts `letterSpacingPx` between
 * boxes - which is what an advance width is for - so the property is:
 *
 *     every gap between adjacent glyphs, on every plate, is exactly
 *     `letterSpacingPx`, whatever the word, the metrics or the script.
 *
 * That holds for ANY advance table, so the sweep below runs the same assertions
 * under three sets of metrics: the shipped node fallback, the real "Avenir Next"
 * advances the report was measured with, and a deliberately extreme synthetic
 * table. A guard that only held for one font is the defect wearing a test.
 *
 * ================== THE NEGATIVE CONTROL ==================
 * `oldCellGapsPx` below is the SHIPPED rule, restored: `i * cell`, centred
 * glyphs. It is not a restatement of the fix - it is the arithmetic that was
 * deleted - and it reproduces the reported numbers to 0.01 px, including the
 * three negative ones. It runs on every invocation, so a revert to a fixed cell
 * turns this file red rather than quietly returning the overlap.
 *
 * ================== WATCHED FAILING ==================
 * Recorded per assertion below. The whole-file control: with
 * `letterCentresPx` put back to `pen += cellWidthPx(style)` (the shipped rule),
 * this file reports
 *
 *   FAIL  every gap on a plate is exactly the letter spacing, avenir-next / will / spacing 1
 *   AssertionError: will [avenir-next, spacing 1]: gap w|i is -2.78 px, not 1:
 *     expected -2.7799999999999976 to be close to 1
 *
 * and 33 more assertions with it, including
 *
 *   AssertionError: will [shipped-table]: w|i overlaps by 2.26 px:
 *     expected -2.2555999999999976 to be greater than 0
 *   AssertionError: will [shipped-table]: gaps run -2.26..13.08, a spread of
 *     15.34 px: expected 15.336900000000004 to be less than 1e-9
 *   AssertionError: 1507 letter gaps across 381 shipped words [shipped-table,
 *     spacing 1] are not 1 px; worst "stormy" m|y at -4.89: expected 1507 to be +0
 *
 * ================== RUN IT ALONE ==================
 *   npx vitest run tests/unit/render/wordPlateSpacing.test.ts --coverage.enabled=false
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = resolve(HERE, "../../../gauntlet/evidence/word-plate-spacing.json");

/** `FlightScene.plateStyle`, D41 spacing off. */
const FLIGHT_STYLE: WordPlateStyle = {
  plate: "#0E1116",
  plateText: "#F7FAFF",
  accent: "#FFC857",
  fontFamily: "'Atkinson Hyperlegible', 'Noto Sans', 'Segoe UI', system-ui, sans-serif",
  fontSizePx: 30,
  letterSpacingPx: 1,
  uppercase: false,
  reducedMotion: false,
};

/** D41's increased letter spacing. `FlightScene` uses 5. */
const SPACED_STYLE: WordPlateStyle = { ...FLIGHT_STYLE, letterSpacingPx: 5 };

/**
 * THE WORDS FROM THE REPORT. `jump`, `time` and `small` are the three that were
 * drawn with letters overlapping.
 */
const REPORTED_WORDS = ["will", "little", "time", "jump", "small"] as const;

/**
 * "Avenir Next" at 30 px, `canvas.measureText(ch).width` in headless Chromium.
 *
 * These are the advances the defect report was measured with, kept as px at 30
 * px rather than as em ratios so they can be checked against the report's own
 * figures by eye: `i` 7.50, `j` 7.53, `l` 7.56, `f` 8.85, `t` 9.51, `q` 19.05,
 * `b` 19.11, `d` 19.11, `w` 22.38, `m` 26.49.
 */
const AVENIR_NEXT_30: Readonly<Record<string, number>> = {
  a: 16.02, b: 19.11, c: 15.0, d: 19.11, e: 17.16, f: 8.85, g: 18.96,
  h: 17.49, i: 7.5, j: 7.53, k: 15.3, l: 7.56, m: 26.49, n: 17.43,
  o: 18.33, p: 19.05, q: 19.05, r: 10.8, s: 13.32, t: 9.51, u: 17.43,
  v: 14.64, w: 22.38, x: 14.52, y: 14.64, z: 13.26,
};

/**
 * A face nothing would ship, so the property cannot be passing on the shape of
 * a real font: every vowel a hairline, every other letter three times the em.
 */
const EXTREME_30: Readonly<Record<string, number>> = Object.fromEntries(
  [..."abcdefghijklmnopqrstuvwxyz"].map((c) => [c, "aeiou".includes(c) ? 1.5 : 90]),
);

const tableMeasurer = (table: Readonly<Record<string, number>>): GlyphMeasurer =>
  (_family, sizePx, glyphs) =>
    glyphs.map((g) => ((table[g] ?? 0.62 * 30) / 30) * sizePx);

interface Metrics {
  readonly name: string;
  /** null installs no measurer, so the shipped node table answers. */
  readonly table: Readonly<Record<string, number>> | null;
}

const METRICS: readonly Metrics[] = [
  { name: "shipped-table", table: null },
  { name: "avenir-next", table: AVENIR_NEXT_30 },
  { name: "extreme", table: EXTREME_30 },
];

const use = (m: Metrics): void => {
  installGlyphMeasurer(m.table === null ? null : tableMeasurer(m.table));
};

afterEach(() => {
  installGlyphMeasurer(null);
});

// ---------------------------------------------------------------------------
// The two layout rules, side by side
// ---------------------------------------------------------------------------

/**
 * Gaps between adjacent glyphs under the SHIPPED rule: one fixed cell per
 * character, glyph centred in it. This is `wordPlateGeometry.cellWidthPx` and
 * `wordPlate.ts`'s `startX + i * cell`, restored verbatim, not re-derived from
 * the replacement.
 */
function oldCellGapsPx(word: string, style: WordPlateStyle): readonly number[] {
  const cell = style.fontSizePx * 0.62 + style.letterSpacingPx;
  const advances = [...word].map((g) =>
    glyphAdvancePx(g, style.fontFamily, style.fontSizePx),
  );
  const out: number[] = [];
  for (let i = 0; i + 1 < advances.length; i += 1) {
    const left = i * cell + (advances[i] ?? 0) / 2;
    const right = (i + 1) * cell - (advances[i + 1] ?? 0) / 2;
    out.push(right - left);
  }
  return out;
}

/** The same measurement on what the plate draws NOW. */
function gapsPx(word: string, style: WordPlateStyle): readonly number[] {
  const centres = letterCentresPx(word, style);
  const advances = letterAdvancesPx(word, style);
  const out: number[] = [];
  for (let i = 0; i + 1 < centres.length; i += 1) {
    const left = (centres[i] ?? 0) + (advances[i] ?? 0) / 2;
    const right = (centres[i + 1] ?? 0) - (advances[i + 1] ?? 0) / 2;
    out.push(right - left);
  }
  return out;
}

const pairNames = (word: string): readonly string[] => {
  const g = [...word];
  return g.slice(0, -1).map((c, i) => `${c}|${g[i + 1] ?? ""}`);
};

// ---------------------------------------------------------------------------

describe("the word plate sets letters on their own advances", () => {
  /**
   * WATCHED FAILING - `letterCentresPx` reverted to `pen += cellWidthPx(style)`,
   * which is the shipped rule. All 30 of these go red; the first is
   *   AssertionError: will [shipped-table, spacing 1]: gap w|i is -2.26 px, not 1:
   *     expected -2.2555999999999976 to be close to 1
   * and the extreme table shows what a fixed cell does to a face it was not
   * measured for:
   *   AssertionError: will [extreme, spacing 1]: gap w|i is -70.40 px, not 1
   */
  for (const m of METRICS) {
    for (const style of [FLIGHT_STYLE, SPACED_STYLE]) {
      for (const word of REPORTED_WORDS) {
        it(`every gap on a plate is exactly the letter spacing, ${m.name} / ${word} / spacing ${style.letterSpacingPx}`, () => {
          use(m);
          const gaps = gapsPx(word, style);
          const names = pairNames(word);
          expect(gaps.length).toBe([...word].length - 1);
          gaps.forEach((gap, i) => {
            expect(
              gap,
              `${word} [${m.name}, spacing ${style.letterSpacingPx}]: gap ${names[i]} is ${gap.toFixed(2)} px, not ${style.letterSpacingPx}`,
            ).toBeCloseTo(style.letterSpacingPx, 9);
          });
        });
      }
    }
  }

  /**
   * THE REPORTED DEFECT, REPRODUCED. If this stops reproducing, the numbers the
   * fix was measured against are not the numbers the code produced and this
   * whole file is measuring something else.
   *
   * WATCHED FAILING - `glyphAdvancePx` made to ignore the installed measurer,
   * so the reproduction runs on the wrong face:
   *   AssertionError: the shipped fixed cell drew will's w|i at 5.384 px, not the
   *     reported 4.66: expected 0.7236000000000029 to be less than or equal to 0.01
   */
  it("REPRODUCES the shipped fixed-cell gaps, to the 0.01 px the report quotes", () => {
    use({ name: "avenir-next", table: AVENIR_NEXT_30 });
    const reported: Readonly<Record<string, readonly number[]>> = {
      will: [4.66, 12.07, 12.04],
      little: [12.07, 11.1, 10.09, 11.07, 7.24],
      time: [11.1, 2.61, -2.22],
      jump: [7.12, -2.36, -3.17],
      small: [-0.3, -1.65, 7.81, 12.04],
    };
    for (const [word, want] of Object.entries(reported)) {
      const got = oldCellGapsPx(word, FLIGHT_STYLE);
      const names = pairNames(word);
      expect(got.length).toBe(want.length);
      got.forEach((gap, i) => {
        // 0.01 px, because that is the precision the report quotes to. `little`
        // lands on 11.095 exactly and the report rounds it to 11.10, so a
        // tolerance of half a quoted digit is the wrong bar here.
        expect(
          Math.abs(gap - (want[i] ?? Number.NaN)),
          `the shipped fixed cell drew ${word}'s ${names[i]} at ${gap.toFixed(3)} px, not the reported ${want[i]}`,
        ).toBeLessThanOrEqual(0.01);
      });
    }
  });

  /**
   * WATCHED FAILING - same revert as above:
   *   AssertionError: will [shipped-table]: w|i overlaps by 2.26 px
   *     expected -2.2555999999999976 to be greater than 0
   */
  it("no two glyphs on a plate overlap, on any of the reported words", () => {
    for (const m of METRICS) {
      use(m);
      for (const style of [FLIGHT_STYLE, SPACED_STYLE]) {
        for (const word of REPORTED_WORDS) {
          const gaps = gapsPx(word, style);
          const names = pairNames(word);
          gaps.forEach((gap, i) => {
            expect(
              gap,
              `${word} [${m.name}]: ${names[i]} overlaps by ${(-gap).toFixed(2)} px`,
            ).toBeGreaterThan(0);
          });
        }
      }
    }
  });

  /**
   * THE COMPLAINT WAS UNEVENNESS, NOT ONLY OVERLAP. "will" had 4.66 px between
   * `w` and `i` and 12.07 px between `i` and `l` - a 7.41 px spread inside one
   * four-letter word.
   *
   * WATCHED FAILING - same revert:
   *   AssertionError: will [shipped-table]: gaps run -2.26..13.08, a spread of
   *     15.34 px: expected 15.336900000000004 to be less than 1e-9
   */
  it("the spread of gaps inside one word is zero", () => {
    for (const m of METRICS) {
      use(m);
      for (const word of [...REPORTED_WORDS, "spinning", "superficie"]) {
        const gaps = gapsPx(word, FLIGHT_STYLE);
        if (gaps.length < 2) continue;
        const spread = Math.max(...gaps) - Math.min(...gaps);
        expect(
          spread,
          `${word} [${m.name}]: gaps run ${Math.min(...gaps).toFixed(2)}..${Math.max(...gaps).toFixed(2)}, a spread of ${spread.toFixed(2)} px`,
        ).toBeLessThan(1e-9);
      }
    }
  });

  /**
   * EVERY WORD A BELT CAN SPAWN, not just the five in the report. The pools
   * belong to the content lane and gain words; this is what stops the next one
   * arriving with an overlap nobody looked for.
   *
   * WATCHED FAILING - same revert:
   *   AssertionError: 1507 letter gaps across 381 shipped words [shipped-table,
   *     spacing 1] are not 1 px; worst "stormy" m|y at -4.89: expected 1507 to be +0
   */
  it("sweeps every word in every shipped pool and finds no overlap and no unevenness", () => {
    const words = new Set<string>([
      ...STOP_IDS.flatMap((s) => stagePoolFor(s)),
      ...retentionPoolFor(STOP_IDS),
    ]);
    expect(words.size, "the shipped pools are empty; this sweep proves nothing").toBeGreaterThan(
      50,
    );
    for (const m of METRICS) {
      use(m);
      for (const style of [FLIGHT_STYLE, SPACED_STYLE]) {
        let bad = 0;
        let worst = { word: "", pair: "", gap: Number.POSITIVE_INFINITY };
        for (const word of words) {
          const gaps = gapsPx(word, style);
          const names = pairNames(word);
          gaps.forEach((gap, i) => {
            if (gap < worst.gap) worst = { word, pair: names[i] ?? "", gap };
            if (Math.abs(gap - style.letterSpacingPx) > 1e-9) bad += 1;
          });
        }
        expect(
          bad,
          `${bad} letter gaps across ${words.size} shipped words [${m.name}, spacing ${style.letterSpacingPx}] are not ${style.letterSpacingPx} px; worst "${worst.word}" ${worst.pair} at ${worst.gap.toFixed(2)}`,
        ).toBe(0);
      }
    }
  });
});

describe("the plate is as wide as the word it carries", () => {
  /**
   * The old width was `letters * cell + 2 * pad` - a function of COUNT. It is
   * now a function of the WORD, and it has to be exactly the ink it holds plus
   * the padding, or the plate is loose at one end and tight at the other.
   *
   * WATCHED FAILING - `plateSize.width` put back to
   * `glyphs * cellWidthPx + 2 * PLATE_PAD_X_PX`:
   *   AssertionError: plate for "will" is 106.40 wide; its 4 advances sum to 44.47
   *     and the padding is 2*14: expected 106.4 to be close to 72.4702
   */
  it("the plate width is the set text plus PLATE_PAD_X_PX at each end", () => {
    for (const m of METRICS) {
      use(m);
      for (const style of [FLIGHT_STYLE, SPACED_STYLE]) {
        for (const word of REPORTED_WORDS) {
          // Summed HERE from the advances rather than taken from
          // `textRunWidthPx`, or this asserts that a function equals itself.
          const advances = letterAdvancesPx(word, style);
          const ink =
            advances.reduce((a, b) => a + b, 0) +
            style.letterSpacingPx * (advances.length - 1);
          expect(textRunWidthPx(word, style)).toBeCloseTo(ink, 9);
          expect(
            plateSize(word, style).width,
            `plate for "${word}" is ${plateSize(word, style).width.toFixed(2)} wide; its ${advances.length} advances sum to ${ink.toFixed(2)} and the padding is 2*${PLATE_PAD_X_PX}`,
          ).toBeCloseTo(ink + PLATE_PAD_X_PX * 2, 9);
        }
      }
    }
  });

  /**
   * `n - 1` gaps, not `n`. The fixed cell folded the letter spacing into every
   * character including the last, so every plate carried one trailing gap of
   * dead space that the padding was already providing.
   *
   * WATCHED FAILING - `textRunWidthPx` with `advances.length` gaps:
   *   AssertionError: one-letter plate carries a letter gap it has no letters to
   *     separate: expected 20.4542 to be close to 15.454200000000002
   */
  it("a one-letter word carries no letter spacing at all", () => {
    for (const m of METRICS) {
      use(m);
      const advance = glyphAdvancePx("a", SPACED_STYLE.fontFamily, SPACED_STYLE.fontSizePx);
      expect(
        textRunWidthPx("a", SPACED_STYLE),
        "one-letter plate carries a letter gap it has no letters to separate",
      ).toBeCloseTo(advance, 9);
    }
  });

  /**
   * THE HEIGHT DID NOT MOVE. `plateHalfHeightPx`, `plateOffsetY` and
   * `@engine/spawn`'s vertical overlap test all rest on "plate height is a
   * function of the style alone"; a width change that quietly made the height
   * word-dependent would break the column rule without touching it.
   *
   * WATCHED FAILING - `plateSize` height given a `textRunWidthPx` term:
   *   AssertionError: "mmmmmmmmmm" is 56.03923 high and "l" is 53.565187; plate
   *     height has become a function of the word: expected 56.03923 to be 53.565187
   */
  it("plate height is still a function of the style alone", () => {
    for (const m of METRICS) {
      use(m);
      const h = (w: string): number => plateSize(w, FLIGHT_STYLE).height;
      const widest = "mmmmmmmmmm";
      const narrowest = "l";
      expect(
        h(widest),
        `"${widest}" is ${h(widest)} high and "${narrowest}" is ${h(narrowest)}; plate height has become a function of the word`,
      ).toBe(h(narrowest));
      expect(h("a")).toBe(FLIGHT_STYLE.fontSizePx * 1.25 + 8 * 2);
    }
  });

  /**
   * D41 letter case goes through the same seam the drawing does, so an
   * uppercase plate is sized for the uppercase glyphs it draws rather than for
   * the lowercase ones it was given.
   *
   * WATCHED FAILING - `plateGlyphs` returning `[...word]` without `displayWord`:
   *   AssertionError: expected 'time' to be 'TIME' // Object.is equality
   */
  it("an uppercase plate is sized for the capitals it draws", () => {
    use({ name: "avenir-next", table: AVENIR_NEXT_30 });
    // Capitals are wider in every face the game can pick, so a plate that did
    // not run the case setting through would come out too narrow.
    const upper = { ...FLIGHT_STYLE, uppercase: true };
    expect(plateGlyphs("time", upper).join("")).toBe("TIME");
    expect(
      plateSize("time", upper).width,
      "uppercase plate sized for lowercase letters",
    ).toBeGreaterThan(plateSize("time", FLIGHT_STYLE).width);
  });
});

describe("where the advance number comes from", () => {
  /**
   * The point of the whole change: the layout asks the FONT. With a measurer
   * installed the table is not consulted at all.
   *
   * WATCHED FAILING - `glyphAdvancePx` ignoring the measurer:
   *   AssertionError: a measured "m" came back as the table's 24.4923, not 26.49:
   *     expected 24.4923 to be close to 26.49
   */
  it("a measured advance beats the shipped table", () => {
    use({ name: "avenir-next", table: AVENIR_NEXT_30 });
    const m = glyphAdvancePx("m", FLIGHT_STYLE.fontFamily, 30);
    expect(m, `a measured "m" came back as the table's ${(SYSTEM_SANS_ADVANCE_EM["m"] ?? 0) * 30}, not 26.49`).toBeCloseTo(26.49, 6);
    expect(glyphAdvanceSource("m", FLIGHT_STYLE.fontFamily, 30)).toBe("measured");
  });

  /**
   * In node there is no canvas, and the answer has to be deterministic rather
   * than absent - unit tests and `scripts/` both lay plates out.
   *
   * WATCHED FAILING - `SYSTEM_SANS_ADVANCE_EM` emptied:
   *   AssertionError: expected 'fallback' to be 'table' // Object.is equality
   *   (the 4 px floor below is the second half of it: the shipped table has to
   *   actually disagree with the flat cell, or this assertion is decoration)
   */
  it("with no measurer the shipped table answers, and it is not the old flat cell", () => {
    installGlyphMeasurer(null);
    const m = glyphAdvancePx("m", FLIGHT_STYLE.fontFamily, 30);
    expect(m, 'with no measurer, "m" fell through to the 0.62 cell').toBeCloseTo(
      (SYSTEM_SANS_ADVANCE_EM["m"] ?? 0) * 30,
      9,
    );
    expect(glyphAdvanceSource("m", FLIGHT_STYLE.fontFamily, 30)).toBe("table");
    // The table has to actually disagree with the flat cell, or "the plate uses
    // real advances" is true of a file that does not.
    expect(Math.abs(m - FALLBACK_ADVANCE_EM * 30)).toBeGreaterThan(4);
  });

  /**
   * A MEASURER THAT ANSWERS 0 MUST NOT STACK THE WORD ON ONE POINT. That is the
   * shape of the original defect - a plausible-looking number applied to every
   * glyph - and a 2d context whose font has not resolved can return it.
   *
   * WATCHED FAILING - the `Number.isFinite(raw) && raw > 0` guard removed:
   *   AssertionError: a 0-width measurer collapsed "jump" onto one point:
   *     expected 3 to be greater than 40
   */
  it("a measurer that answers nonsense is ignored rather than believed", () => {
    for (const nonsense of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      installGlyphMeasurer(() => [nonsense]);
      const width = textRunWidthPx("jump", FLIGHT_STYLE);
      expect(
        width,
        `a ${nonsense}-width measurer collapsed "jump" onto one point`,
      ).toBeGreaterThan(40);
    }
  });

  /**
   * A glyph in neither the measurer nor the table lands exactly where the old
   * code would have put it, so an unknown script gets no worse than it was.
   *
   * WATCHED FAILING - `FALLBACK_ADVANCE_EM` changed to 1:
   *   AssertionError: an unmeasured, untabulated glyph no longer lands where the
   *     old code put it: expected 30 to be close to 18.6
   */
  it("an unknown glyph falls back to the 0.62 cell the old code used for everything", () => {
    installGlyphMeasurer(null);
    const exotic = "\u{13000}"; // Egyptian hieroglyph A001: in no table here.
    expect(glyphAdvanceSource(exotic, FLIGHT_STYLE.fontFamily, 30)).toBe("fallback");
    // 18.6 as a LITERAL, not as `FALLBACK_ADVANCE_EM * 30`: the point is that
    // it is the old `cellWidthPx` cell less its letter spacing, and an
    // assertion written in terms of the constant moves when the constant does.
    expect(
      glyphAdvancePx(exotic, FLIGHT_STYLE.fontFamily, 30),
      "an unmeasured, untabulated glyph no longer lands where the old code put it",
    ).toBeCloseTo(18.6, 9);
    expect(FALLBACK_ADVANCE_EM).toBe(0.62);
  });

  /**
   * THE CACHE MUST BE KEYED ON THE SIZE AS WELL AS THE FACE. Advances are not
   * linear in font size on the faces that draw here - measured on this machine,
   * `adv(30)/30` and `adv(100)/100` differ by up to 1.3e-2 em on San Francisco -
   * so a cache keyed on family alone would serve a 30 px answer to a 52 px
   * plate.
   *
   * WATCHED FAILING - `fontStringOf` reduced to `${fontFamily}`:
   *   AssertionError: the 52 px plate was served the 30 px advance:
   *     expected 30 to be 52 // Object.is equality
   */
  it("caches per font size, not per family", () => {
    installGlyphMeasurer((_f, size, gs) => gs.map(() => size));
    expect(glyphAdvancePx("m", "X", 30)).toBe(30);
    expect(glyphAdvancePx("m", "X", 52), "the 52 px plate was served the 30 px advance").toBe(
      52,
    );
    expect(fontStringOf("X", 52)).toBe("52px X");
  });

  /**
   * The measurer is asked ONCE per (glyph, family, size). A layout call runs
   * per frame in `drawUnderline`; a `measureText` per glyph per frame is not a
   * cost this plate can carry.
   *
   * WATCHED FAILING - the `table.set(glyph, entry)` line removed:
   *   AssertionError: the measurer was asked 20 times for 4 distinct glyphs:
   *     expected 20 to be 4 // Object.is equality
   */
  it("asks the font once per glyph and remembers", () => {
    let calls = 0;
    installGlyphMeasurer((_f, size, gs) => {
      calls += gs.length;
      return gs.map(() => size * 0.5);
    });
    for (let i = 0; i < 5; i += 1) letterCentresPx("jump", FLIGHT_STYLE);
    expect(calls, `the measurer was asked ${calls} times for 4 distinct glyphs`).toBe(4);
    clearGlyphAdvanceCache();
    letterCentresPx("jump", FLIGHT_STYLE);
    expect(calls).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// The evidence artifact (D85)
// ---------------------------------------------------------------------------

/**
 * The before/after table, WRITTEN BY THE RUN rather than typed into a report.
 * `before` is `oldCellGapsPx` - the deleted rule - and `after` is what the
 * plate draws now, both over the same metrics in the same process.
 */
it("writes the before/after gap table", () => {
  const rows: unknown[] = [];
  for (const m of METRICS.filter((x) => x.name !== "extreme")) {
    use(m);
    for (const word of REPORTED_WORDS) {
      const before = oldCellGapsPx(word, FLIGHT_STYLE);
      const after = gapsPx(word, FLIGHT_STYLE);
      rows.push({
        metrics: m.name,
        word,
        pairs: pairNames(word),
        before: before.map((g) => Number(g.toFixed(2))),
        after: after.map((g) => Number(g.toFixed(2))),
        beforeSpread: Number((Math.max(...before) - Math.min(...before)).toFixed(2)),
        afterSpread: Number((Math.max(...after) - Math.min(...after)).toFixed(2)),
        beforeOverlaps: before.filter((g) => g < 0).length,
        afterOverlaps: after.filter((g) => g < 0).length,
        plateWidthBefore: Number(
          ([...word].length * (30 * 0.62 + 1) + PLATE_PAD_X_PX * 2).toFixed(2),
        ),
        plateWidthAfter: Number(plateSize(word, FLIGHT_STYLE).width.toFixed(2)),
      });
    }
  }
  installGlyphMeasurer(null);
  mkdirSync(dirname(EVIDENCE), { recursive: true });
  writeFileSync(EVIDENCE, `${JSON.stringify({ rows }, null, 1)}\n`);
  expect(rows.length).toBe(10);
  // The artifact has to SHOW the defect and its absence, or it is decoration.
  expect(rows.filter((r) => (r as { beforeOverlaps: number }).beforeOverlaps > 0).length)
    .toBeGreaterThan(0);
  expect(rows.every((r) => (r as { afterOverlaps: number }).afterOverlaps === 0)).toBe(true);
});
