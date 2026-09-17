/**
 * THE ENDING CARD'S LAYOUT (screen 12).
 *
 * The captured ending was the worst screen in the build and every one of its
 * defects was a layout fact that nothing measured:
 *
 *   - an 838x105 EMPTY BLACK PANEL dead centre. It was the plate for Shadow's
 *     closing line, drawn opaque in `create()` while the line itself was held
 *     at alpha 0 behind a ~3 s delayed call. Nothing asserted "a plate is only
 *     drawn when it has something in it", so a plate with no content shipped.
 *   - the route band sat at y=470, straight through the terrain silhouette, so
 *     seven lamps disappeared into a mountain.
 *   - the headline floated top-left on bare sky.
 *
 * The second capture then showed two things no number in the first pass
 * described:
 *
 *   - the closing panel was a CONSTANT 1380x170 holding one line of text, so
 *     ~110 px of it was dead black. A constant height is the defect; the panel
 *     has to be budgeted from its own content the way the route band already is.
 *   - the three blocks shared neither a left edge nor a centre (band 110-1810,
 *     panel 420-1800, button 680-1240) and read as three unrelated rectangles.
 *
 * So the maths moved out of the scene into a pure module and these are the
 * rules it has to keep. Every assertion here is about a rect, which is the
 * thing a screenshot shows and a Phaser unit test cannot reach.
 */

import { describe, expect, it } from "vitest";
import {
  ENDING_STAGE,
  PANEL_MAX_LINES,
  advanceEmFor,
  endingBlocks,
  endingLayout,
  rectsOverlap,
  rectWithin,
  wrapLineCount,
  type Rect,
} from "@game/scenes/support/endingLayout";

const LINE = "Every ship that comes after us will see these. You drew the map.";
/** The shipped Spanish, which is the one that wraps. */
const LINE_ES =
  "Todas las naves que vengan después verán estas luces. Tú trazaste el mapa.";

const layout = (closingLine = LINE, stopCount = 7) =>
  endingLayout({ stopCount, closingLine, headlineSize: 72, labelSize: 20, lineHeightEm: 1.3 });

describe("the ending card's blocks never collide", () => {
  it("keeps every pair of blocks apart", () => {
    const blocks = endingBlocks(layout());
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < blocks.length; i += 1) {
      for (let j = i + 1; j < blocks.length; j += 1) {
        const a = blocks[i]!;
        const b = blocks[j]!;
        expect(
          rectsOverlap(a.rect, b.rect),
          `"${a.id}" overlaps "${b.id}"`,
        ).toBe(false);
      }
    }
  });

  it("moves the route band off the headline and off the closing panel", () => {
    const l = layout();
    expect(l.routeBand.y).toBeGreaterThan(l.headline.y + l.headline.h);
    expect(l.panel).not.toBeNull();
    expect(l.routeBand.y + l.routeBand.h).toBeLessThan(l.panel!.y);
  });

  it("keeps every block inside the 1920x1080 design space", () => {
    const l = layout();
    for (const block of endingBlocks(l)) {
      expect(
        rectWithin(block.rect, ENDING_STAGE.width, ENDING_STAGE.height),
        `"${block.id}" leaves the stage`,
      ).toBe(true);
    }
  });
});

describe("a plate with no content is never emitted", () => {
  it("returns no panel at all for an empty closing line", () => {
    const l = layout("");
    expect(l.panel).toBeNull();
    expect(l.panelText).toBeNull();
    expect(endingBlocks(l).some((b) => b.id === "panel")).toBe(false);
  });

  it("returns no panel for a whitespace-only closing line", () => {
    expect(layout("   ").panel).toBeNull();
  });

  it("returns a panel with room for the line when there is one", () => {
    const l = layout();
    expect(l.panel).not.toBeNull();
    expect(l.panelText).not.toBeNull();
    expect(l.panelText!.wrapWidth).toBeGreaterThan(0);
    expect(l.panelText!.wrapWidth).toBeLessThan(l.panel!.w);
    expect(rectWithin(l.panelText!, ENDING_STAGE.width, ENDING_STAGE.height)).toBe(true);
    expect(rectsOverlap(l.panelText!, l.button)).toBe(false);
  });
});

describe("the seven-stop route reads end to end", () => {
  it("spaces the lamps evenly inside the band and in route order", () => {
    const l = layout();
    expect(l.lampX).toHaveLength(7);
    for (let i = 1; i < l.lampX.length; i += 1) {
      expect(l.lampX[i]!).toBeGreaterThan(l.lampX[i - 1]!);
    }
    expect(l.lampX[0]!).toBeGreaterThanOrEqual(l.routeBand.x);
    expect(l.lampX[6]!).toBeLessThanOrEqual(l.routeBand.x + l.routeBand.w);
    expect(l.rail.from).toBe(l.lampX[0]);
    expect(l.rail.to).toBe(l.lampX[6]);
  });

  it("keeps the rail, the lamp haloes and the stop names inside the band's own plate", () => {
    const l = layout();
    const band = l.routeBand;
    expect(l.rail.y - l.lampHaloRadius).toBeGreaterThan(band.y);
    expect(l.labelY).toBeGreaterThan(l.rail.y + l.lampHaloRadius);
    const labelBottom = l.labelY + Math.round(20 * 1.3);
    expect(labelBottom).toBeLessThan(band.y + band.h);
  });

  it("survives a one-stop route without dividing by zero", () => {
    const l = layout(LINE, 1);
    expect(l.lampX).toHaveLength(1);
    expect(Number.isFinite(l.lampX[0]!)).toBe(true);
  });

  it("grows the Devanagari band rather than shrinking the type", () => {
    const latin = endingLayout({
      stopCount: 7,
      closingLine: LINE,
      headlineSize: 72,
      labelSize: 20,
      lineHeightEm: 1.3,
    });
    const deva = endingLayout({
      stopCount: 7,
      closingLine: LINE,
      headlineSize: 72,
      labelSize: 20,
      lineHeightEm: 1.56,
    });
    expect(deva.routeBand.h).toBeGreaterThan(latin.routeBand.h);
  });
});

describe("the forward action", () => {
  it("is the widest single control on the screen and sits below everything else", () => {
    const l = layout();
    const others: Rect[] = [l.headline, l.routeBand, l.panel!];
    for (const r of others) {
      expect(l.button.y).toBeGreaterThanOrEqual(r.y + r.h);
    }
    expect(l.button.w).toBeGreaterThanOrEqual(480);
    expect(l.button.h).toBeGreaterThanOrEqual(64);
  });
});

describe("the closing panel is budgeted from its own content", () => {
  const lineH = (lineHeightEm: number) => Math.round(30 * lineHeightEm);

  it("holds one line of English in one line's worth of panel, not 170px", () => {
    const l = layout();
    const lines = wrapLineCount(LINE, l.panelText!.wrapWidth, 30, advanceEmFor("en"));
    expect(lines).toBe(1);
    // Nothing but the padding either side of the ink. No dead black.
    expect(l.panel!.h - lines * lineH(1.3)).toBe(l.panel!.h - l.panelText!.h);
    expect(l.panelText!.h).toBe(lines * lineH(1.3));
    expect(l.panel!.h).toBeLessThan(120);
  });

  it("grows for the Spanish line rather than clipping it", () => {
    const en = layout();
    const es = endingLayout({
      stopCount: 7,
      closingLine: LINE_ES,
      headlineSize: 72,
      labelSize: 20,
      lineHeightEm: 1.3,
      advanceEm: advanceEmFor("es"),
    });
    expect(wrapLineCount(LINE_ES, es.panelText!.wrapWidth, 30, advanceEmFor("es"))).toBe(2);
    expect(es.panel!.h).toBeGreaterThan(en.panel!.h);
    expect(es.panelText!.h).toBe(2 * lineH(1.3));
  });

  it("grows for a Devanagari line, which is taller per line as well as wider", () => {
    const deva = endingLayout({
      stopCount: 7,
      closingLine: LINE,
      headlineSize: 72,
      labelSize: 20,
      lineHeightEm: 1.56,
      advanceEm: advanceEmFor("hi"),
    });
    expect(deva.panel!.h).toBeGreaterThan(layout().panel!.h);
  });

  it("keeps the same gap to the forward action however many lines it holds", () => {
    const gaps = [LINE, LINE_ES, `${LINE} ${LINE_ES} ${LINE}`].map((line) => {
      const l = endingLayout({
        stopCount: 7,
        closingLine: line,
        headlineSize: 72,
        labelSize: 20,
        lineHeightEm: 1.3,
      });
      return l.button.y - (l.panel!.y + l.panel!.h);
    });
    expect(new Set(gaps).size).toBe(1);
    expect(gaps[0]!).toBeGreaterThan(0);
  });

  it("still clears the route band at its tallest budgeted size", () => {
    const tall = endingLayout({
      stopCount: 7,
      closingLine: Array.from({ length: PANEL_MAX_LINES }, () => LINE_ES).join(" "),
      headlineSize: 72,
      labelSize: 20,
      lineHeightEm: 1.56,
      advanceEm: advanceEmFor("hi"),
    });
    expect(tall.panelText!.h).toBe(PANEL_MAX_LINES * Math.round(30 * 1.56));
    expect(tall.panel!.y).toBeGreaterThan(tall.routeBand.y + tall.routeBand.h);
    expect(rectsOverlap(tall.panel!, tall.routeBand)).toBe(false);
    expect(rectsOverlap(tall.panel!, tall.button)).toBe(false);
  });

  it("holds every shipped closing line inside the budget", () => {
    for (const [line, lang] of [[LINE, "en"], [LINE_ES, "es"], [LINE, "hi"]] as const) {
      const lines = wrapLineCount(line, 1000, 30, advanceEmFor(lang));
      expect(lines, `${lang} wraps to ${lines} lines`).toBeLessThanOrEqual(PANEL_MAX_LINES);
    }
  });
});

describe("wrapping is budgeted, never guessed mid-word", () => {
  it("never breaks a word, even one wider than the wrap width", () => {
    expect(wrapLineCount("supercalifragilisticexpialidocious".repeat(4), 200, 30, 0.5)).toBe(1);
  });

  it("counts an empty line as no lines at all", () => {
    expect(wrapLineCount("", 1000, 30, 0.5)).toBe(0);
    expect(wrapLineCount("   ", 1000, 30, 0.5)).toBe(0);
  });

  it("wraps on whole words as the width shrinks", () => {
    const one = wrapLineCount(LINE, 1000, 30, 0.5);
    const narrow = wrapLineCount(LINE, 500, 30, 0.5);
    const narrower = wrapLineCount(LINE, 250, 30, 0.5);
    expect(one).toBeLessThan(narrow);
    expect(narrow).toBeLessThan(narrower);
  });

  it("budgets wider per character for Devanagari than for Latin", () => {
    expect(advanceEmFor("hi")).toBeGreaterThan(advanceEmFor("en"));
    expect(advanceEmFor("es")).toBe(advanceEmFor("en"));
  });
});

describe("the blocks share one centre line", () => {
  it("centres the headline, the route band, the closing panel and the button on the same x", () => {
    const l = layout();
    const centres = endingBlocks(l).map((b) => b.rect.x + b.rect.w / 2);
    expect(new Set(centres).size, `centres: ${centres.join(", ")}`).toBe(1);
    expect(centres[0]).toBe(ENDING_STAGE.width / 2);
  });

  it("holds the centre whatever the closing line does", () => {
    for (const line of [LINE, LINE_ES, `${LINE} ${LINE_ES}`]) {
      const l = endingLayout({
        stopCount: 7,
        closingLine: line,
        headlineSize: 72,
        labelSize: 20,
        lineHeightEm: 1.3,
      });
      expect(l.panel!.x + l.panel!.w / 2).toBe(ENDING_STAGE.width / 2);
    }
  });

  it("leaves the left gutter Shadow stands in clear of the panel", () => {
    const l = layout();
    // Shadow is drawn at x 280 and is about 160px wide at 0.95 scale.
    expect(l.panel!.x).toBeGreaterThan(280 + 90);
  });
});
