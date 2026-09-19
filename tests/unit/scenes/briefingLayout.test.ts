import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { STOP_IDS, type Lang } from "@engine/types";
import { lineHeightEm, TYPE } from "@game/ui/theme";
import { advanceEmFor, wrapLineCount } from "@game/scenes/support/endingLayout";
import {
  ACTION_BOTTOM,
  PAGE_MAX_BOTTOM,
  PAGE_MIN_H,
  PAGE_TOP,
  PAGE_X,
  PAD_Y,
  LAUNCH,
  PAGE_W,
  RIGHT_MARGIN,
  SHELF,
  WINDOW,
  BACK_CHIP,
  SHADOW_AT,
  SHADOW_NOTCH,
  SHADOW_SCALE,
  ACTION_CX,
  backChip,
  launchButton,
  focusRingBox,
  controlStrip,
  briefingLayout,
  columnBottom,
  columnWidth,
  headerColumnWidth,
  shadowBox,
  type Rows,
} from "@game/scenes/support/briefingLayout";
import {
  CONTROL_SURFACE,
  controlSurfaceElementCount,
  controlSurfaceLayout,
} from "@game/ui/controlSurfaceLayout";
import { DESIGN_WIDTH, GAME_HEIGHT } from "@game/sceneKeys";
import {
  BACK_CORNER_BOTTOM,
  GUTTER,
  HEADING_TOP,
  HINT_TOP,
  backCorner,
  contentRight,
} from "@game/ui/grid";
import { setGameWidth } from "@game/sceneKeys";

/**
 * UR-20 - THE BRIEFING PAGE DOES NOT PRINT THROUGH ITSELF.
 *
 * ================== THE DEFECT ==================
 * UR-20, reported on Saturn: text drawn over other text. The
 * sentences flowed down from a fixed start with no bound and the footer line
 * ("The Lantern is fuelled and ready.") was drawn at an ABSOLUTE y near the
 * plate's bottom edge, so a stop with five sentences ran straight through it.
 * Measured off the live scene tree, one boot per stop:
 *
 *   earth    column reaches 956 against a plate ending at 868  (88 px over)
 *   jupiter, saturn, neptune, pluto                            (footer buried)
 *   mars     fits, with 39 px spare
 *
 * Mars is the stop the capture harness boots. That is why every screenshot
 * anybody looked at was clean.
 *
 * ================== WHAT THIS FILE HOLDS ==================
 * The column, for every shipped stop in every shipped language, against the
 * plate it has to fit in. Heights are BUDGETED from `endingLayout`'s measured
 * wrap model rather than transcribed, so new copy is checked by the same
 * arithmetic as old copy and a longer Saturn goes red here before it reaches a
 * child.
 *
 * Watch it fail: drop `PAGE_MAX_BOTTOM` to 868 (the shipped plate's bottom) and
 * every stop but Mars and Uranus reports overflow.
 *
 *   npx vitest run tests/unit/scenes/briefingLayout.test.ts --coverage.enabled=false
 */

const CONTENT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../src/content",
);

const LANGS: Lang[] = ["en", "es", "hi"];

interface Bundle {
  planetName: string;
  chapterTitle: string;
  briefing: string[];
}

/** The shipped bundle for a stop, read from `src/content`. */
function bundle(lang: Lang, stop: string): Bundle | null {
  const dir = resolve(CONTENT, lang);
  if (!readdirSync(dir).includes(`${stop}.json`)) return null;
  const raw = JSON.parse(readFileSync(resolve(dir, `${stop}.json`), "utf8")) as Record<
    string,
    unknown
  >;
  const briefing = raw["briefing"];
  return {
    planetName: String(raw["planetName"] ?? stop),
    chapterTitle: String(raw["chapterTitle"] ?? ""),
    briefing: Array.isArray(briefing) ? briefing.map(String) : [],
  };
}

/**
 * Budgeted height of one wrapped block, the way the scene would measure it.
 *
 * `width` is the block's OWN column: the header run is wrapped narrower than
 * the body because Shadow stands beside it (UR-58), and a model that wrapped
 * everything to the full column would be measuring a page the screen does not
 * draw.
 */
function blockHeight(
  text: string,
  fontPx: number,
  lang: Lang,
  width: number = columnWidth(),
): number {
  const lines = wrapLineCount(text, width, fontPx, advanceEmFor(lang));
  return Math.round(Math.max(1, lines) * fontPx * lineHeightEm(lang));
}

/** The page's blocks, in the order `BriefingScene.drawPage` draws them. */
function rowsFor(lang: Lang, stop: string): Rows[] | null {
  const b = bundle(lang, stop);
  if (b === null) return null;
  // UR-91: the briefing's reading type stepped one rung down the declared
  // scale, `TYPE.prose` 36 -> `TYPE.body` 30. Named rather than repeated as a
  // literal, so the model and the scene cannot drift apart again - this was a
  // hard 36 next to a `BriefingScene` that drew `TYPE.prose`, and the two only
  // agreed by coincidence.
  const SENTENCE_PX = TYPE.body;
  const head = headerColumnWidth();
  const rows: Rows[] = [
    {
      id: "eyebrow",
      height: blockHeight("mission briefing", TYPE.caption, lang, head),
      gapAfter: 14,
      group: "header",
    },
    {
      id: "planet",
      height: blockHeight(b.planetName, TYPE.heading, lang, head),
      gapAfter: 12,
      group: "header",
    },
    {
      id: "chapter",
      height: blockHeight(b.chapterTitle, TYPE.label, lang, head),
      gapAfter: 40,
      group: "header",
    },
  ];
  for (const [i, sentence] of b.briefing.entries()) {
    rows.push({
      id: `sentence-${i}`,
      height: blockHeight(sentence, SENTENCE_PX, lang),
      gapAfter: 16,
    });
  }
  rows.push({
    id: "shipReady",
    height: blockHeight("The Lantern is fuelled and ready.", TYPE.caption, lang),
    gapAfter: 0,
  });
  return rows;
}

describe("the briefing column fits its plate at every stop, in every language", () => {
  it("never overflows and never buries the footer", () => {
    const failures: string[] = [];
    for (const lang of LANGS) {
      for (const stop of STOP_IDS) {
        const rows = rowsFor(lang, stop);
        if (rows === null) continue;
        const laid = briefingLayout(rows);
        if (laid.overflow > 0) {
          failures.push(`${lang}/${stop}: ${laid.overflow}px over`);
          continue;
        }
        // The footer is the last row IN THE FLOW, so nothing can sit on it.
        const last = laid.rows[laid.rows.length - 1];
        expect(last?.id, `${lang}/${stop}`).toBe("shipReady");
        // ...and the column ends inside the plate it was flowed into.
        expect(columnBottom(laid), `${lang}/${stop} column`).toBeLessThanOrEqual(
          laid.page.y + laid.page.h - 4,
        );
      }
    }
    expect(failures).toEqual([]);
  });

  it("no two rows share a row of pixels", () => {
    for (const lang of LANGS) {
      for (const stop of STOP_IDS) {
        const rows = rowsFor(lang, stop);
        if (rows === null) continue;
        const laid = briefingLayout(rows);
        for (let i = 1; i < laid.rows.length; i += 1) {
          const above = laid.rows[i - 1];
          const here = laid.rows[i];
          if (above === undefined || here === undefined) continue;
          expect(
            here.y,
            `${lang}/${stop}: "${here.id}" starts before "${above.id}" ends`,
          ).toBeGreaterThanOrEqual(above.y + above.height);
        }
      }
    }
  });

  it("NEGATIVE CONTROL: the shipped pinned footer WAS overrun", () => {
    // What shipped: sentences from `PAGE.y + 200` on a 700 px plate at y=168,
    // and the footer pinned at `PAGE.y + PAGE.h - 62` = 806.
    const SHIPPED_FOOTER_Y = 806;
    let flowed = 168 + 200;
    const rows = rowsFor("en", "earth");
    expect(rows).not.toBeNull();
    for (const row of (rows as Rows[]).filter((r) => r.id.startsWith("sentence"))) {
      flowed += row.height + 16;
    }
    expect(flowed, "the flow used to reach past the pinned footer").toBeGreaterThan(
      SHIPPED_FOOTER_Y,
    );
  });

  it("spends white space before it spends plate, and never spends type", () => {
    // Mars is short: nothing is squeezed and the plate sits at its floor.
    const mars = briefingLayout(rowsFor("en", "mars") as Rows[]);
    expect(mars.gapScale).toBe(1);
    expect(mars.page.h).toBeGreaterThanOrEqual(PAGE_MIN_H);

    // Earth is the longest: the gaps give first.
    const earth = briefingLayout(rowsFor("en", "earth") as Rows[]);
    expect(earth.page.h).toBeGreaterThan(mars.page.h);
    expect(earth.gapScale).toBeLessThanOrEqual(1);

    // And in both cases the TYPE is untouched - there is no font size anywhere
    // in the layout's output, by construction.
    expect(Object.keys(earth.rows[0] ?? {})).not.toContain("fontPx");
  });
});

describe("UR-58: Shadow delivers the briefing from the page's top-right corner", () => {
  const overlaps = (
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
  ): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  /** The quadrant the report asks for: the top-right quarter of the plate. */
  const topRightQuadrant = (page: { x: number; y: number; w: number; h: number }) => ({
    x: page.x + page.w / 2,
    y: page.y,
    w: page.w / 2,
    h: page.h / 2,
  });

  const contains = (
    outer: { x: number; y: number; w: number; h: number },
    inner: { x: number; y: number; w: number; h: number },
  ): boolean =>
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h;

  it("stands INSIDE the page's top-right quadrant, at every stop, in every language", () => {
    // He used to stand at (1076, 992) - under the glass, on the button row,
    // 900 px from the page he is supposed to be reading out.
    //
    // WATCHED FAILING: put SHADOW_AT back to { x: 1076, y: 992, scale: 0.78 }
    // and all 42 checks go red - anchor and box at every one of the 21
    // stop/language pairs. His anchor reports x 1076 against a quadrant that
    // ends at x 980, and his box reports 996..1156 x 892..1077 against a
    // quadrant of 538..980 x 84..520.
    const failures: string[] = [];
    for (const lang of LANGS) {
      for (const stop of STOP_IDS) {
        const rows = rowsFor(lang, stop);
        if (rows === null) continue;
        const page = briefingLayout(rows).page;
        const quadrant = topRightQuadrant(page);
        const anchor = { x: SHADOW_AT.x, y: SHADOW_AT.y, w: 0, h: 0 };
        if (!contains(quadrant, anchor)) failures.push(`${lang}/${stop} anchor`);
        if (!contains(quadrant, shadowBox())) failures.push(`${lang}/${stop} box`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("never stands on a word, at any stop, in any language", () => {
    // The whole risk of moving him onto the page. His corner is reserved by the
    // FLOW - the header run is wrapped to `headerColumnWidth()` and the run is
    // floored at `SHADOW_NOTCH.h` - so this checks the reservation rather than
    // hoping the copy stays short.
    //
    // WATCHED FAILING: drop the `group: "header"` flags from `rowsFor` and 63
    // collisions come back, three per stop per language - every header row, at
    // every combination, because without the flag they wrap to the full 740 px
    // column and run straight under him:
    //
    //   en/earth: "eyebrow" at y 116   "planet" at y 156   "chapter" at y 225
    //
    // The first sentence is NOT among them, and that is worth being exact
    // about: with today's copy the run's HEIGHT floor is what is doing the
    // work at 21 of 21 combinations (it moves `en`'s first sentence from 296 to
    // 303 and `hi/neptune`'s from 276 to 277), and the WIDTH is what keeps the
    // header out of him. Both are asserted; neither is assumed.
    const hits: string[] = [];
    for (const lang of LANGS) {
      for (const stop of STOP_IDS) {
        const rows = rowsFor(lang, stop);
        if (rows === null) continue;
        for (const row of briefingLayout(rows).rows) {
          const box = { x: row.x, y: row.y, w: row.w, h: row.height };
          if (overlaps(shadowBox(), box)) {
            hits.push(`${lang}/${stop}: "${row.id}" at y ${row.y}`);
          }
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("starts the body BELOW his box, at every stop, in every language", () => {
    // The height half of the reservation, stated as the number a regression
    // would move.
    //
    // WATCHED FAILING: delete the `y = Math.max(y, SHADOW_NOTCH.h + gap)` line
    // from `flow()` in briefingLayout.ts and 18 of the 21 combinations go red -
    // "en/earth first body row: expected 296 to be greater than or equal to
    // 303", and `hi/neptune` at 276 against 277.
    //
    // The bar is his box PLUS the header's own trailing air, which is what the
    // flow reserves; `>= shadowBox().bottom` alone would be 263 and would pass
    // against the broken code at every stop, which is the shape of check this
    // repo has been burned by before.
    const HEADER_GAP_AFTER = 40;
    for (const lang of LANGS) {
      for (const stop of STOP_IDS) {
        const rows = rowsFor(lang, stop);
        if (rows === null) continue;
        const laid = briefingLayout(rows);
        const firstBody = laid.rows.find((r) => r.group !== "header");
        expect(firstBody, `${lang}/${stop}`).toBeDefined();
        const floor =
          PAGE_TOP +
          PAD_Y +
          SHADOW_NOTCH.h +
          Math.round(HEADER_GAP_AFTER * laid.gapScale);
        expect((firstBody as { y: number }).y, `${lang}/${stop} first body row`)
          .toBeGreaterThanOrEqual(floor);
        // ...which is below his box by construction, and this is the claim the
        // reader cares about.
        expect(floor).toBeGreaterThan(shadowBox().y + shadowBox().h);
      }
    }
  });

  it("is SMALLER than he was, and the notch reserves exactly what he draws", () => {
    // "A little smaller to fit" is the trade the report offers, and 0.62 is
    // what the tightest first sentence in the product allows. The notch is
    // derived from the scale rather than typed in, so he cannot be enlarged
    // without the room he is given growing with him.
    expect(SHADOW_SCALE).toBeLessThan(0.78);
    expect(SHADOW_NOTCH.w).toBeGreaterThanOrEqual(shadowBox().w);
    expect(SHADOW_NOTCH.h).toBeGreaterThanOrEqual(shadowBox().h);
    // ...and the header column is narrowed by exactly that much, not by a
    // number that happens to be near it.
    expect(headerColumnWidth()).toBe(columnWidth() - SHADOW_NOTCH.w - SHADOW_NOTCH.gap);
  });

  it("NEGATIVE CONTROL: there is a size at which he would not fit, and it is bigger than his", () => {
    /**
     * WHY THIS NO LONGER NAMES 0.78, AND WHAT THAT MEASURED.
     *
     * It used to read: his box at scale 0.78 is 160 x 185 and ends at y 301,
     * past the y 276 where `hi/neptune` starts its first sentence. UR-91
     * stepped the body type down one rung (`TYPE.prose` 36 -> `TYPE.body` 30)
     * and this went red - `expected 280.22400000000005 to be greater than 319`
     * - because a shorter column lets `briefingLayout` open its gaps, and the
     * tightest first sentence in the product moved DOWN from y 276 to y 319.
     *
     * That is a real result and it is worth stating plainly: the corner has
     * 43 px more headroom than it had, so the "a little smaller to fit" trade
     * UR-58 made could now be partly given back. Whether Shadow SHOULD grow is
     * a drawing decision and is logged in gauntlet/escalations.md rather than
     * taken here.
     *
     * The control itself is now derived rather than pinned, which is what stops
     * it needing a new magic number every time the type scale moves. The claim
     * it makes is unchanged and is the one that matters: a scale exists at
     * which he collides with the first sentence, and the shipped scale is
     * comfortably under it. If he ever grows past that, this goes red.
     */
    const tightest = briefingLayout(rowsFor("hi", "neptune") as Rows[]);
    const firstSentence = tightest.rows.find((r) => r.id === "sentence-0");
    expect(firstSentence).toBeDefined();
    const sentenceY = (firstSentence as { y: number }).y;

    const collides = (scale: number): boolean => {
      const box = shadowBox({ x: SHADOW_AT.x, y: SHADOW_AT.y, scale });
      return box.y + box.h > sentenceY;
    };

    // The smallest scale, to a hundredth, at which he would run into the copy.
    let breaks = Number.NaN;
    for (let scale = SHADOW_SCALE; scale <= 3; scale += 0.01) {
      if (collides(scale)) {
        breaks = scale;
        break;
      }
    }
    expect(breaks, "a colliding scale exists at all").not.toBeNaN();
    // The shipped size is on the safe side of it - the positive case above is
    // therefore measuring a live constraint, not a vacuous one.
    expect(collides(SHADOW_SCALE)).toBe(false);
    expect(SHADOW_SCALE).toBeLessThan(breaks);
  });

  it("clears the action band and stays inside the frame", () => {
    expect(overlaps(shadowBox(), launchButton())).toBe(false);
    expect(overlaps(shadowBox(), backChip())).toBe(false);
    expect(shadowBox().y + shadowBox().h).toBeLessThanOrEqual(GAME_HEIGHT);
    expect(shadowBox().x).toBeGreaterThan(0);
  });
});

/**
 * UR-50, reported from play on Saturn. Four of the five items are geometry and
 * are settled here, without booting Phaser.
 *
 * Every number below was READ OFF THE SHIPPED SCREEN before it was asserted,
 * because the report and the code disagreed on one of them and the report was
 * the one that turned out to be describing a real thing by the wrong name.
 */
describe("UR-50: the window, the shelf and the two actions", () => {
  const overlaps = (
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
  ): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  it("50.3: the page and the glass start on the same line", () => {
    // The alignment the caption was costing. It is the whole reason "delete the
    // caption" was the right call: the copy was filler, and the 56 px of hull
    // it occupied was the gap between the screen's two big objects.
    //
    // Watch it fail: put WINDOW.y back to 140.
    expect(WINDOW.y).toBe(PAGE_TOP);
    expect(WINDOW.y).toBe(HEADING_TOP);
  });

  it("50.3: the deleted caption's string is gone from the product", () => {
    // A copy change that leaves the key behind is a copy change that comes
    // back. `strings.ts` is the shipped key list and `ui.json` is the English
    // table; neither may still carry it.
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const keys = readFileSync(resolve(root, "src/game/scenes/lib/strings.ts"), "utf8");
    const en = readFileSync(resolve(root, "src/content/en/ui.json"), "utf8");
    expect(keys).not.toContain("briefing.window");
    expect(en).not.toContain("briefing.window");
    expect(en).not.toContain("through the window");
  });

  it("50.2/61: the strip is exactly the width of the glass, and its lamps are centred in it", () => {
    // THE 50.2 REPORT SAID "narrower than the window". The BAR was 60 px WIDER
    // (x-30, w+60 = 982..1854 against 1012..1824); what was narrow was the lamp
    // row, at 1042..1778, leaving 30 px of empty bar on the left and 46 on the
    // right. Both still hold, now that the strip is a control surface (UR-61)
    // rather than a bar: the hardware moved, the alignment did not.
    //
    // Watch it fail: restore `x - 30 / w + 60` and `x + 30 + i * 92`.
    expect(SHELF.x).toBe(WINDOW.x);
    expect(SHELF.w).toBe(WINDOW.w);

    const parts = controlSurfaceLayout(controlStrip(), SHELF.lamps);
    expect(parts.lamps.length).toBe(SHELF.lamps);
    const first = parts.lamps[0] as { x: number; w: number };
    const last = parts.lamps[parts.lamps.length - 1] as { x: number; w: number };
    const leftAir = first.x - SHELF.x;
    const rightAir = SHELF.x + SHELF.w - (last.x + last.w);
    expect(
      Math.abs(leftAir - rightAir),
      `lamp air: ${leftAir} left, ${rightAir} right`,
    ).toBeLessThanOrEqual(1);
    // ...and every lamp is inside the strip.
    for (const lamp of parts.lamps) {
      expect(lamp.x).toBeGreaterThanOrEqual(SHELF.x);
      expect(lamp.x + lamp.w).toBeLessThanOrEqual(SHELF.x + SHELF.w);
    }
  });

  it("NEGATIVE CONTROL: the shipped lamp row really was off-centre, and by how much", () => {
    // What was there, modelled: `WINDOW.x + 30 + i * 92`, nine lamps. If this
    // ever comes out symmetric, the case above is measuring nothing.
    const old = Array.from({ length: 9 }, (_, i) => WINDOW.x + 30 + i * 92);
    const oldBar = { x: WINDOW.x - 30, w: WINDOW.w + 60 };
    const leftAir = (old[0] as number) - oldBar.x;
    const rightAir = oldBar.x + oldBar.w - (old[8] as number);
    expect(leftAir).toBe(60);
    expect(rightAir).toBe(76);
    expect(oldBar.w - WINDOW.w).toBe(60);
  });
});

/**
 * UR-61 - THE STRIP UNDER THE WINDOW IS SHIP HARDWARE, AND STAYS THAT WAY.
 *
 * The report: the dark strip of blue dots is meant to read as the ship's
 * control panel and reads as a row of dots. What was drawn was one rounded
 * rectangle and nine filled circles - no frame, no fixings, no depth, no light.
 *
 * ================== WHY THIS IS A COUNT AND A SET OF BOXES ==================
 * "Reads as hardware" is not directly measurable, but the thing a regression
 * DOES is: it deletes the pieces. A strip that has quietly become a bar with
 * dots on it has lost its bezel, its screws and its vents and still renders,
 * still passes a screenshot nobody is diffing, and still has lamps on it. So
 * the pieces are counted and placed, and flattening the strip is a red test
 * rather than a thing somebody notices two months later.
 *
 *   npx vitest run tests/unit/scenes/briefingLayout.test.ts --coverage.enabled=false
 */
describe("UR-61: the control strip is a console, not a row of dots", () => {
  const parts = () => controlSurfaceLayout(controlStrip(), SHELF.lamps);

  it("carries a bezel, a milled face, four screws, two vent groups and a lamp bank", () => {
    // WATCHED FAILING: return `rivets: []` and `vents: []` from
    // `controlSurfaceLayout` - the exact shape of a redraw that flattens the
    // strip back to a plate with lamps on it - and this reports
    // "screws: expected +0 to be 4". The count drops from 26 to 10, which is
    // one piece fewer than the bar and nine circles that shipped.
    const p = parts();
    expect(p.rivets.length, "screws").toBe(4);
    expect(p.vents.length, "vent slots").toBe(CONTROL_SURFACE.ventCount * 2);
    expect(p.lamps.length, "stop lamps").toBe(7);
    expect(controlSurfaceElementCount(p)).toBe(
      2 + 4 + CONTROL_SURFACE.ventCount * 2 + 1 + 7,
    );
    // The shipped strip, for the record: one plate and nine circles.
    expect(controlSurfaceElementCount(p)).toBeGreaterThan(1 + 9);
  });

  it("keeps every piece of hardware inside the strip, with the face inside the bezel", () => {
    const p = parts();
    const strip = controlStrip();
    const inside = (b: { x: number; y: number; w: number; h: number }): boolean =>
      b.x >= strip.x &&
      b.y >= strip.y &&
      b.x + b.w <= strip.x + strip.w &&
      b.y + b.h <= strip.y + strip.h;

    expect(inside(p.face), "face").toBe(true);
    for (const [i, v] of p.vents.entries()) expect(inside(v), `vent ${i}`).toBe(true);
    expect(inside(p.bank), "lamp bank").toBe(true);
    for (const [i, l] of p.lamps.entries()) expect(inside(l), `lamp ${i}`).toBe(true);
    for (const [i, r] of p.rivets.entries()) {
      expect(r.x, `rivet ${i} x`).toBeGreaterThan(strip.x);
      expect(r.x, `rivet ${i} x`).toBeLessThan(strip.x + strip.w);
      expect(r.y, `rivet ${i} y`).toBeGreaterThan(strip.y);
      expect(r.y, `rivet ${i} y`).toBeLessThan(strip.y + strip.h);
    }
  });

  it("puts the vents outside the lamp bank, on both sides, and nothing through it", () => {
    // A vent drawn through the bank is a cut through a readout. The two groups
    // flank it; the bank owns the middle.
    const p = parts();
    const left = p.vents.slice(0, CONTROL_SURFACE.ventCount);
    const right = p.vents.slice(CONTROL_SURFACE.ventCount);
    for (const v of left) expect(v.x + v.w).toBeLessThan(p.bank.x);
    for (const v of right) expect(v.x).toBeGreaterThan(p.bank.x + p.bank.w);
    expect(left.length).toBe(right.length);
  });

  it("is tall enough to hold hardware, and clears the glass and the action band", () => {
    // 76 px of bar is what a row of dots fits in. The height came from space
    // that UR-56 and UR-60 freed under this column, not from the page.
    //
    // WATCHED FAILING: set SHELF.h back to 76 - "expected 76 to be greater
    // than 76".
    expect(SHELF.h).toBeGreaterThan(76);
    expect(SHELF.y).toBeGreaterThanOrEqual(WINDOW.y + WINDOW.h);
    expect(SHELF.y + SHELF.h).toBeLessThan(LAUNCH.y);
  });
});

/**
 * UR-60 - LAUNCH IS THE FOCUS.
 *
 * Centred horizontally on the screen, at its foot, with the way back reduced to
 * a small quiet control on the left. This SUPERSEDES the placement half of
 * UR-50.1, which stacked the two actions together under the glass; that was
 * done, and is deliberately revised.
 */
describe("UR-60: launch is centred on the screen and the way out is small and left", () => {
  const overlaps = (
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
  ): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  it("centres launch on the screen's centre line, at the bottom", () => {
    // Watch it fail: put ACTION_CX back to `WINDOW.x + WINDOW.w / 2`. The
    // button's centre then reports 1418 against a screen centre of 960 - 458 px
    // right of it, which is where it was.
    const btn = launchButton();
    expect(Math.abs(btn.x + btn.w / 2 - DESIGN_WIDTH / 2)).toBeLessThanOrEqual(1);
    expect(ACTION_CX).toBe(DESIGN_WIDTH / 2);
    // At the foot: nothing this screen draws is below it.
    expect(btn.y).toBeGreaterThan(SHELF.y + SHELF.h);
    expect(btn.y + btn.h).toBeLessThanOrEqual(GAME_HEIGHT);
  });

  it("puts the way out in the PRODUCT'S back corner, smaller, and not beside launch", () => {
    // ================== WHAT CHANGED, AND WHAT DID NOT ==================
    // The pairing UR-50.1 asked for and UR-60 revised: the two used to share a
    // centre line 24 px apart, and UR-60 separated them - launch alone on the
    // screen's centre line, the way out small and parked on the left gutter.
    //
    // C19 moves the CORNER and nothing else. The owner reported "back to the
    // map" as top-right on Pre-flight and bottom-left here, and bottom-left is
    // the keyboard hint's line on nine screens, so the way out takes the empty
    // corner. `ui/grid.backCorner` is the one definition; Pre-flight's chip
    // reads the same function, which is the property that makes this a product
    // rule rather than two screens that happen to agree today.
    //
    // WATCHED FAILING with `{ x: BACK_CHIP_X, y: ACTION_BOTTOM - 48 }` restored:
    //   expected 96 to be 1600
    const chip = backChip();
    const btn = launchButton();
    expect(chip).toEqual(backCorner(BACK_CHIP.w, BACK_CHIP.h));
    expect(chip.x).toBe(DESIGN_WIDTH - GUTTER - chip.w);
    // BOTTOM-right since UR-95: the top-right corner is not free on every
    // screen - the Briefing's cockpit glass reaches it (C19) - and a corner
    // that is only free on some screens is not a shared corner. The chip sits
    // on the hint's own foot line now, so instructions and the way out are one
    // row: text bottom-left, control bottom-right.
    expect(chip.y).toBe(BACK_CORNER_BOTTOM - chip.h);
    // UR-60'S SIZE ARGUMENT IS UNTOUCHED: still under half launch's area, and
    // still nowhere near it.
    expect(chip.w * chip.h).toBeLessThan((btn.w * btn.h) / 2);
    expect(overlaps(chip, btn)).toBe(false);
  });

  it("sits both actions the same distance from the foot of the screen (UR-76)", () => {
    // ================== THE DEFECT ==================
    // The two controls were centred on EACH OTHER, which is the right idea on
    // the wrong axis: two boxes of different heights sharing a middle do NOT
    // share a distance from the bottom of the screen. Launch (68 px) ended
    // 14 px off the artboard's foot while the chip (48 px) had 24, and launch
    // is the one wearing the focus ring, so it was the crowding the project
    // owner saw.
    //
    // This is the claim the old geometry could not make, and it is written as
    // a shared LINE rather than as two numbers, so it survives either control
    // being resized later.
    //
    // C19 TOOK THE CHIP OFF THIS LINE, so the line now governs launch alone and
    // the shared-bottom claim is gone with the sharing. What UR-76 was actually
    // about survives and is asserted below: launch's distance from the foot of
    // the artboard is a property of a NAMED LINE, not an accident of a height.
    //
    // WATCHED FAILING, with `h: 68` restored on LAUNCH:
    //   expected 1066 to be 1056
    const btn = launchButton();
    expect(btn.y + btn.h).toBe(ACTION_BOTTOM);
    // And the line is clear of the foot by more than a hairline. 24 px is what
    // the chip already had; the point is that launch now has it too.
    expect(GAME_HEIGHT - ACTION_BOTTOM).toBeGreaterThanOrEqual(24);
    // THE PAGE CLEARANCE IS NOT WHAT PAID FOR IT. Launch reached the line by
    // losing height, never by moving up into the page - there are exactly ten
    // pixels there and none are spare.
    expect(btn.y).toBeGreaterThan(PAGE_MAX_BOTTOM);
  });

  /**
   * UR-101: LAUNCH AND THE WAY OUT ARE BACK ON ONE LINE, AND IT IS THE CHIP'S.
   *
   * ================== WHAT WAS REPORTED ==================
   * The project owner, against this screen: launch and the back chip "bottom out
   * 24 px from the foot of a 1080 frame", and it needs more air.
   *
   * Half of that was already untrue and the untrue half is the fix. C19/UR-95
   * took the chip off `ACTION_BOTTOM` and put it in `ui/grid.backCorner`, whose
   * foot is `BACK_CORNER_BOTTOM` - the hint plate's own bottom edge, 1048, i.e.
   * 32 px off the frame. So the chip had 32 and launch had 24, the two controls
   * the owner named as a pair were EIGHT PIXELS OUT OF LINE, and launch was the
   * only one actually crowding the foot. Measured, not assumed.
   *
   * ================== WHERE THE AIR COMES FROM ==================
   * Not from above. `es/neptune` flows a page to y 987 and launch's focus ring
   * starts at `LAUNCH.y - 11`, so at `y` 998 the ring's top edge IS 987: there
   * is one pixel of headroom on the whole screen and the note on `LAUNCH` says
   * why none of it is spare. The air is therefore bought out of the button's
   * HEIGHT, the same trade UR-76 made, and the line it comes down to is the one
   * the chip is already on rather than a third number.
   *
   * ================== WHAT IT COSTS ==================
   * Launch loses 8 px of height (58 -> 50) and is WIDENED to hold its area
   * (420 x 58 = 24_360; 488 x 50 = 24_400). That is not decoration: UR-60's
   * "launch is the focus" is asserted below as "the chip is under half launch's
   * area", and at 420 x 50 the chip would be 10_752 against a half-area of
   * 10_500 - the focus claim would go red. The button had to get wider or the
   * invariant had to be weakened, and weakening it is not available.
   *
   * WATCHED FAILING, with `ACTION_BOTTOM = 1056` and `LAUNCH.w = 420`:
   *   launch is not on the chip's line: expected 1056 to be 1048
   */
  it("UR-101: puts launch on the chip's own foot line, with more air under both", () => {
    expect(ACTION_BOTTOM, "launch is not on the chip's line").toBe(BACK_CORNER_BOTTOM);
    const btn = launchButton();
    const chip = backChip();
    expect(btn.y + btn.h).toBe(chip.y + chip.h);
    // The air the report asked for, stated as the number the report used.
    expect(GAME_HEIGHT - (btn.y + btn.h)).toBeGreaterThan(24);
    expect(GAME_HEIGHT - (btn.y + btn.h)).toBe(32);
    // ...and it was NOT bought from the page above, which has none to give.
    expect(LAUNCH.y).toBe(998);
    expect(focusRingBox(btn).y).toBeGreaterThanOrEqual(987);
  });

  it("UR-101: launch keeps its weight when it loses height", () => {
    // The button is the screen's one forward action. Trading 8 px of height for
    // air is only acceptable while it stays the heaviest thing on the foot, so
    // the area is held rather than allowed to fall out of the arithmetic.
    // 420 x 58 = 24_360 shipped; this must not be meaningfully under it.
    const btn = launchButton();
    expect(btn.w * btn.h).toBeGreaterThanOrEqual(24_360);
    // And the focus claim the area buys, restated at the new size.
    const chip = backChip();
    expect(chip.w * chip.h).toBeLessThan((btn.w * btn.h) / 2);
  });

  it("keeps BOTH inside the frame WITH their focus rings, and off the page", () => {
    // AC-18.1, and the reason launch is 68 px tall rather than 92. The ring is
    // drawn outside the control and its halo wider again, so the band between
    // the longest page and the foot of the artboard is what sizes the button.
    //
    // Watch it fail: set LAUNCH.h back to 92. The ring then reports a bottom of
    // 1101 against a 1080 frame.
    let lowestPage = 0;
    for (const lang of LANGS) {
      for (const stop of STOP_IDS) {
        const rows = rowsFor(lang, stop);
        if (rows === null) continue;
        const page = briefingLayout(rows).page;
        lowestPage = Math.max(lowestPage, page.y + page.h);
      }
    }
    // LAUNCH IS THE ONE IN THAT BAND NOW. The chip left it for the top-right
    // corner (C19), so it is checked against the frame and against the PAGE it
    // now shares a top line with instead.
    const ring = focusRingBox(launchButton());
    expect(ring.y, `launch ring over the page (lowest ${lowestPage})`).toBeGreaterThanOrEqual(
      lowestPage - 1,
    );
    expect(ring.y + ring.h, "launch ring off the frame").toBeLessThanOrEqual(GAME_HEIGHT);
    expect(ring.x, "launch ring off the left").toBeGreaterThanOrEqual(0);

    // The chip's ring, in its new corner: inside the frame on all four sides,
    // and clear of the page's right edge so it cannot sit on the prose.
    const chipRing = focusRingBox(backChip());
    expect(chipRing.y, "chip ring off the top").toBeGreaterThanOrEqual(0);
    expect(chipRing.x + chipRing.w, "chip ring off the right").toBeLessThanOrEqual(
      DESIGN_WIDTH,
    );
    expect(chipRing.x, "chip ring over the page column").toBeGreaterThan(PAGE_X + PAGE_W);
  });

  it("does not shrink the focus ring to buy the quiet control its quiet", () => {
    // The one thing "small and quiet" may not cost. Both rings are the same
    // shape around their control, because `focusRingBox` is the kit's own
    // geometry and neither control gets a private version of it.
    const chip = backChip();
    const btn = launchButton();
    const chipRing = focusRingBox(chip);
    const btnRing = focusRingBox(btn);
    expect(chipRing.w - chip.w).toBe(btnRing.w - btn.w);
    expect(chipRing.h - chip.h).toBe(btnRing.h - btn.h);
  });

  it("does not move either control when the world gets wider", () => {
    // UR-19's rule, restated for the new placement: this screen is declared
    // "fixed" (grid-conformance.spec.ts) and every landmark on it is measured
    // against the artboard. At 16:9 and narrower - every window the game can
    // produce that is not ultrawide - the artboard centre IS the screen centre.
    const widths = [1920, 2561, 3840];
    const launches = widths.map((w) => {
      setGameWidth(w);
      return launchButton().x;
    });
    const chips = widths.map((w) => {
      setGameWidth(w);
      return backChip().x;
    });
    setGameWidth(1920);
    expect(new Set(launches).size, `launch x by width: ${launches.join(", ")}`).toBe(1);
    expect(new Set(chips).size, `chip x by width: ${chips.join(", ")}`).toBe(1);
  });

  it("NEGATIVE CONTROL: the stacked pair it replaced was NOT centred on the screen", () => {
    // What shipped, modelled: both boxes centred on the glass. If this ever
    // comes out centred, the case above is measuring nothing.
    const glassCentre = WINDOW.x + WINDOW.w / 2;
    expect(Math.abs(glassCentre - DESIGN_WIDTH / 2)).toBeGreaterThan(400);
    // ...and the old chip was as wide as a third of the button it sat under,
    // which is the "not distracting" half of the report.
    expect(BACK_CHIP.w).toBeLessThan(262);
  });
});

describe("the page is on the product's grid", () => {
  it("starts on the gutter and the heading line, and clears the hint", () => {
    expect(PAGE_X).toBe(GUTTER);
    // The page IS this screen's heading; it starts where every other screen's
    // title does.
    expect(PAGE_TOP).toBe(HEADING_TOP);
    // ...and stops above the keyboard hint every screen puts at the same y.
    expect(PAGE_MAX_BOTTOM).toBeLessThan(HINT_TOP);
    expect(PAD_Y).toBeGreaterThan(0);
  });
});

describe("C07: the ship's name is bound, not printed", () => {
  it("earth's opening line carries the token, and the table binds it", () => {
    // The token is real and shipped - this is the line that made the first
    // briefing in the game print "{shipName}" at a child.
    const earth = bundle("en", "earth");
    expect(earth?.briefing.some((s) => s.includes("{shipName}"))).toBe(true);
  });

  it("no shipped briefing sentence leaves a token unbound once filled", () => {
    // The scene now runs every sentence through `SceneText.fill`, which is the
    // one place C07 allows the ship's name to be bound. Anything still in
    // braces after that is a token nobody binds.
    for (const lang of LANGS) {
      for (const stop of STOP_IDS) {
        const b = bundle(lang, stop);
        if (b === null) continue;
        for (const sentence of b.briefing) {
          const filled = sentence.replaceAll("{shipName}", "Lantern");
          expect(filled, `${lang}/${stop}`).not.toMatch(/\{[a-zA-Z]+\}/);
        }
      }
    }
  });
});

describe("UR-19: the screen uses ONE anchoring model", () => {
  /**
   * THE DEFECT I SHIPPED, in the change that fixed UR-27.
   *
   * Every object on the briefing is fixed at artboard coordinates - the page at
   * x=96, the window at 1012..1824, the launch button centred under the glass.
   * The back chip was anchored to `grid.contentRight()`, which GROWS with the
   * window (D99). On a 2561-wide world the chip's text measured x=2246 while
   * the composition it belongs to had not moved: 641 px adrift, in the same
   * change that added it. A blind critic found it.
   *
   * ================== THE FIRST VERSION OF THIS TEST WAS USELESS ==================
   * It asserted `backChip().x + w === RIGHT_MARGIN` and PASSED against the
   * broken code, because `GAME_WIDTH` is 1920 in a unit test and at 1920
   * `contentRight()` IS 1824. That is precisely the camouflage the bug wore in
   * the first place, reproduced in the test written to catch it.
   *
   * So the test WIDENS THE WORLD. `setGameWidth` is the same function `bootGame`
   * calls once it has measured the window, and it is what makes a live binding
   * live. Anything that moves when it is called is viewport-anchored.
   *
   * Watch it fail: anchor `backChip()` to `contentRight()` again.
   */
  const widthsToTry = [1920, 2561, 3840];

  afterEach(() => {
    setGameWidth(1920);
  });

  it("does not move the chip when the world gets wider", () => {
    const positions = widthsToTry.map((w) => {
      setGameWidth(w);
      return backChip().x;
    });
    expect(new Set(positions).size, `chip x by world width: ${positions.join(", ")}`).toBe(
      1,
    );
    // In the product's back corner since C19, and still an ARTBOARD number:
    // `ui/grid.backCorner` measures from `DESIGN_WIDTH`, not from
    // `contentRight()`, precisely so this case keeps passing. That distinction
    // is the whole of this describe block and it is why the corner rule did not
    // reintroduce the 641 px drift above.
    expect(positions[0]).toBe(DESIGN_WIDTH - GUTTER - BACK_CHIP.w);
  });

  it("NEGATIVE CONTROL: a viewport-anchored chip DOES move, and by how much", () => {
    // What shipped, modelled: `contentRight() - w`. If this ever stops moving,
    // the grid has stopped being live and the case above is measuring nothing.
    const anchored = widthsToTry.map((w) => {
      setGameWidth(w);
      return contentRight() - 262;
    });
    expect(new Set(anchored).size).toBe(widthsToTry.length);
    expect((anchored[1] as number) - (anchored[0] as number)).toBe(2561 - 1920);
  });

  it("every fixed landmark on this screen shares one frame", () => {
    // The page, the window and the chip are all measured against the artboard.
    // None of them may quietly become viewport-relative on its own.
    expect(PAGE_X).toBe(GUTTER);
    expect(RIGHT_MARGIN).toBe(1920 - GUTTER);
    // The way out sits on the artboard's right margin (C19) and launch on its
    // centre line - both artboard numbers, neither viewport.
    expect(backChip().x + backChip().w).toBe(RIGHT_MARGIN);
    expect(launchButton().x + launchButton().w / 2).toBe(DESIGN_WIDTH / 2);
    expect(WINDOW.x + WINDOW.w).toBe(RIGHT_MARGIN);
  });
});

