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
  SPEECH_TAIL_GAP,
  advanceEmFor,
  endingBlocks,
  endingLayout,
  rectsOverlap,
  rectWithin,
  shadowBox,
  wrapLineCount,
  type Rect,
} from "@game/scenes/support/endingLayout";
import { PLATE_STACK_GAP, lineBox } from "@game/ui/plateLayout";
import { legalLefts, offGrid } from "@game/ui/alignment";
import { GUTTER } from "@game/ui/grid";
import { speechCardHeight, speechCardWrapWidth } from "@game/ui/speechCard";
import { TYPE } from "@game/ui/theme";

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

describe("the closing card is budgeted from its own content", () => {
  it("holds one line of English in one line's worth of card, not 170px", () => {
    const l = layout();
    const lines = wrapLineCount(LINE, l.panelText!.wrapWidth, 30, advanceEmFor("en"));
    expect(lines).toBe(1);
    expect(l.panelLines).toBe(1);
    // A speaker row and a line row, and nothing but the rhythm's padding.
    expect(l.panelText!.h).toBe(lineBox(TYPE.body, 1));
    expect(l.panelSpeaker!.h).toBe(lineBox(TYPE.caption));
    expect(l.panel!.h).toBe(speechCardHeight(1));
    expect(l.panel!.h).toBe(114);
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
    expect(es.panelText!.h).toBe(lineBox(TYPE.body, 2));
  });

  it("grows for a Devanagari line, which is wider per character", () => {
    // The card's HEIGHT does not read `lineHeightEm` at all any more:
    // `speechCardHeight` is on the Devanagari line box in every language
    // (plateLayout rule 5). What Hindi changes is the WRAP - 0.6 em against
    // 0.5 - so the same sentence takes two rows instead of one.
    const deva = endingLayout({
      stopCount: 7,
      closingLine: LINE,
      headlineSize: 72,
      labelSize: 20,
      lineHeightEm: 1.56,
      advanceEm: advanceEmFor("hi"),
    });
    expect(deva.panelLines).toBe(2);
    expect(deva.panel!.h).toBeGreaterThan(layout().panel!.h);
  });

  it("keeps the same gap to Shadow's head however many lines it holds", () => {
    // The card grows UPWARD out of the figure, so the tail gap is the constant
    // now - it was the gap to the button while the panel sat on the frame.
    const gaps = [LINE, LINE_ES, `${LINE} ${LINE_ES} ${LINE}`].map((line) => {
      const l = endingLayout({
        stopCount: 7,
        closingLine: line,
        headlineSize: 72,
        labelSize: 20,
        lineHeightEm: 1.3,
      });
      return l.shadow.y - (l.panel!.y + l.panel!.h);
    });
    expect(new Set(gaps).size).toBe(1);
    expect(gaps[0]!).toBe(SPEECH_TAIL_GAP);
  });

  it("clears the route band at its tallest budgeted size, in every language", () => {
    // The Devanagari band is 23 px taller than the Latin one, so it is the
    // case that decides the budget and the one this has to be measured in.
    for (const em of [1.3, 1.56] as const) {
      const tall = endingLayout({
        stopCount: 7,
        closingLine: Array.from({ length: PANEL_MAX_LINES + 2 }, () => LINE_ES).join(" "),
        headlineSize: 72,
        labelSize: 20,
        lineHeightEm: em,
        advanceEm: advanceEmFor("hi"),
      });
      expect(tall.panelLines).toBe(PANEL_MAX_LINES);
      expect(tall.panel!.h).toBe(speechCardHeight(PANEL_MAX_LINES));
      expect(
        tall.panel!.y - (tall.routeBand.y + tall.routeBand.h),
        `${em}: card top ${tall.panel!.y}, band bottom ${tall.routeBand.y + tall.routeBand.h}`,
      ).toBeGreaterThanOrEqual(PLATE_STACK_GAP);
      expect(rectsOverlap(tall.panel!, tall.routeBand)).toBe(false);
      expect(rectsOverlap(tall.panel!, tall.button)).toBe(false);
    }
  });

  it("budgets 2 lines because a third would print into the route band", () => {
    // The number is MEASURED, not picked: one more line of card is 47 px and
    // there are only 25.3 to spare in the worst language. WATCHED FAILING with
    // PANEL_MAX_LINES at 3: "3 lines: 461.344 against a band bottom of 483:
    // expected -21.656 to be greater than or equal to 20".
    const worst = endingLayout({
      stopCount: 7,
      closingLine: LINE,
      headlineSize: 72,
      labelSize: 20,
      lineHeightEm: 1.56,
    });
    const bandBottom = worst.routeBand.y + worst.routeBand.h;
    const foot = shadowBox().y - SPEECH_TAIL_GAP;
    const room = foot - bandBottom - PLATE_STACK_GAP;
    expect(speechCardHeight(PANEL_MAX_LINES)).toBeLessThanOrEqual(room);
    expect(speechCardHeight(PANEL_MAX_LINES + 1)).toBeGreaterThan(room);
  });

  it("holds every shipped closing line inside the budget", () => {
    const wrap = speechCardWrapWidth(1080);
    for (const [line, lang] of [[LINE, "en"], [LINE_ES, "es"], [LINE, "hi"]] as const) {
      const lines = wrapLineCount(line, wrap, 30, advanceEmFor(lang));
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

describe("the frame's blocks share one centre line", () => {
  it("centres the headline, the route band and the button on the same x", () => {
    // The card is NOT in this list any more (UR-148): it is anchored to the
    // speaker, and the case below is the assertion that replaces it.
    const l = layout();
    const centres = endingBlocks(l)
      .filter((b) => b.id !== "panel")
      .map((b) => b.rect.x + b.rect.w / 2);
    expect(new Set(centres).size, `centres: ${centres.join(", ")}`).toBe(1);
    expect(centres[0]).toBe(ENDING_STAGE.width / 2);
  });
});

describe("the card belongs to the figure saying the line (UR-148)", () => {
  it("sits directly above Shadow, left-aligned to her column", () => {
    // WATCHED FAILING against the centred panel it replaced:
    //   expected 420 to be 199.744
    // and the tail gap read `-270.656` - the panel's foot was 270 px BELOW the
    // top of her head, i.e. drawn through the frame's middle, not over her.
    const l = layout();
    const figure = shadowBox();
    expect(l.shadow).toEqual(figure);
    expect(l.panel!.x).toBe(figure.x);
    expect(l.panel!.y + l.panel!.h).toBe(figure.y - SPEECH_TAIL_GAP);
    expect(rectsOverlap(l.panel!, figure)).toBe(false);
  });

  it("starts on the page margin, so both its rows are on a named line (UR-69)", () => {
    // Her drawn box's LEFT EDGE is the gutter, `earthLayout.shadowOrigin`'s own
    // construction, so the card starts at 96 and its type at 136. WATCHED
    // FAILING with SHADOW_AT.x back at the literal 280: "expected 199.744 to be
    // 96", and the two rows land at 240 - 44 px off the nearest legal line,
    // which `left-edge-conformance.spec.ts` counts as two off-model elements.
    const l = layout();
    const legal = legalLefts();
    expect(l.panel!.x).toBe(GUTTER);
    expect(offGrid(l.panel!.x, legal)).toBe(0);
    expect(offGrid(l.panelSpeaker!.x, legal)).toBe(0);
    expect(offGrid(l.panelText!.x, legal)).toBe(0);
  });

  it("holds her column whatever the closing line does, and at any stage width", () => {
    for (const line of [LINE, LINE_ES, `${LINE} ${LINE_ES}`]) {
      for (const width of [1440, 1920, 2560]) {
        const l = endingLayout({
          stopCount: 7,
          closingLine: line,
          headlineSize: 72,
          labelSize: 20,
          lineHeightEm: 1.3,
          width,
        });
        expect(l.panel!.x, `${width}`).toBe(shadowBox().x);
        // And never past the right margin, however narrow the frame.
        expect(l.panel!.x + l.panel!.w, `${width}`).toBeLessThanOrEqual(width - 96);
      }
    }
  });

  it("carries a speaker row over the line, the outline the other two screens wear", () => {
    const l = layout();
    expect(l.panelSpeaker!.y).toBeLessThan(l.panelText!.y);
    expect(l.panelSpeaker!.x).toBe(l.panelText!.x);
    expect(l.panelText!.wrapWidth).toBe(speechCardWrapWidth(l.panel!.w));
    // Both rows inside the card, and the card sized to exactly the two of them.
    expect(l.panelSpeaker!.y).toBeGreaterThan(l.panel!.y);
    expect(l.panelText!.y + l.panelText!.h).toBeLessThan(l.panel!.y + l.panel!.h);
  });

  it("emits no rows at all when there is nothing to say", () => {
    const l = layout("");
    expect(l.panelSpeaker).toBeNull();
    expect(l.panelLines).toBe(0);
  });
});
