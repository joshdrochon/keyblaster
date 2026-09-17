import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { STOP_IDS, type Lang } from "@engine/types";
import { lineHeightEm, TYPE } from "@game/ui/theme";
import { advanceEmFor, wrapLineCount } from "@game/scenes/support/endingLayout";
import {
  PAGE_MAX_BOTTOM,
  PAGE_MIN_H,
  PAGE_TOP,
  PAGE_X,
  PAD_Y,
  LAUNCH,
  RIGHT_MARGIN,
  SHELF,
  WINDOW,
  backChip,
  launchButton,
  shelfLamps,
  briefingLayout,
  columnBottom,
  columnWidth,
  shadowBox,
  type Rows,
} from "@game/scenes/support/briefingLayout";
import { GUTTER, HEADING_TOP, HINT_TOP, contentRight } from "@game/ui/grid";
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

/** Budgeted height of one wrapped block, the way the scene would measure it. */
function blockHeight(text: string, fontPx: number, lang: Lang): number {
  const lines = wrapLineCount(text, columnWidth(), fontPx, advanceEmFor(lang));
  return Math.round(Math.max(1, lines) * fontPx * lineHeightEm(lang));
}

/** The page's blocks, in the order `BriefingScene.drawPage` draws them. */
function rowsFor(lang: Lang, stop: string): Rows[] | null {
  const b = bundle(lang, stop);
  if (b === null) return null;
  const SENTENCE_PX = 36;
  const rows: Rows[] = [
    { id: "eyebrow", height: blockHeight("mission briefing", TYPE.caption, lang), gapAfter: 14 },
    { id: "planet", height: blockHeight(b.planetName, TYPE.heading, lang), gapAfter: 12 },
    { id: "chapter", height: blockHeight(b.chapterTitle, TYPE.label, lang), gapAfter: 40 },
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

describe("nothing on the screen stands on anything else", () => {
  const overlaps = (a: {x:number;y:number;w:number;h:number}, b: {x:number;y:number;w:number;h:number}): boolean =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  const launchRect = () => ({
    x: 1012 + 812 / 2 - LAUNCH.w / 2,
    y: LAUNCH.y,
    w: LAUNCH.w,
    h: LAUNCH.h,
  });

  it("Shadow clears the page at every stop, the launch button and the frame", () => {
    for (const lang of LANGS) {
      for (const stop of STOP_IDS) {
        const rows = rowsFor(lang, stop);
        if (rows === null) continue;
        const page = briefingLayout(rows).page;
        expect(overlaps(shadowBox(), page), `${lang}/${stop} page`).toBe(false);
      }
    }
    expect(overlaps(shadowBox(), launchRect())).toBe(false);
    expect(shadowBox().y + shadowBox().h).toBeLessThanOrEqual(1080);
    expect(shadowBox().x).toBeGreaterThan(0);
  });

  it("NEGATIVE CONTROL: where Shadow used to stand IS inside the page now", () => {
    // (176, 964) - directly under the text column. Keeping him there is what
    // capped the page and left the briefing no room for its own last line.
    const wasThere = shadowBox({ x: 176, y: 964, scale: 0.84 });
    const longest = briefingLayout(rowsFor("en", "earth") as Rows[]).page;
    expect(overlaps(wasThere, longest)).toBe(true);
  });

  it("the back chip is clear of the page at every stop, in every language", () => {
    // The chip moved from the top-right corner to the action stack (UR-50.1),
    // so its y is no longer HEADING_TOP - but "it never lands on the page" is
    // the invariant that mattered, and it is checked across the whole sweep
    // rather than at the one stop anybody looks at (standards rule 5).
    const chip = backChip();
    for (const lang of LANGS) {
      for (const stop of STOP_IDS) {
        const rows = rowsFor(lang, stop);
        if (rows === null) continue;
        expect(overlaps(chip, briefingLayout(rows).page), `${lang}/${stop}`).toBe(false);
      }
    }
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

  it("50.2: the shelf is exactly the width of the glass, and its lamps are centred in it", () => {
    // THE REPORT SAID "narrower than the window". The BAR was 60 px WIDER
    // (x-30, w+60 = 982..1854 against 1012..1824); what was narrow was the lamp
    // row, at 1042..1778, leaving 30 px of empty bar on the left and 46 on the
    // right. Both are asserted, because fixing only the bar would leave the
    // thing the player actually saw.
    //
    // Watch it fail: restore `x - 30 / w + 60` and `x + 30 + i * 92`.
    expect(SHELF.x).toBe(WINDOW.x);
    expect(SHELF.w).toBe(WINDOW.w);

    const lamps = shelfLamps();
    expect(lamps.length).toBe(SHELF.lamps);
    const first = lamps[0] as number;
    const last = lamps[lamps.length - 1] as number;
    const leftAir = first - SHELF.x;
    const rightAir = SHELF.x + SHELF.w - last;
    expect(
      Math.abs(leftAir - rightAir),
      `lamp air: ${leftAir} left, ${rightAir} right`,
    ).toBeLessThanOrEqual(1);
    // ...and every lamp is inside the bar, circle included.
    for (const cx of lamps) {
      expect(cx - SHELF.lampR).toBeGreaterThanOrEqual(SHELF.x);
      expect(cx + SHELF.lampR).toBeLessThanOrEqual(SHELF.x + SHELF.w);
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

  it("50.1: the two actions are adjacent, and the way out is not in a corner", () => {
    // The complaint: launch bottom-centre, the way back top-right, 820 px of
    // screen between a question and its answer.
    //
    // Watch it fail: anchor the chip at { x: RIGHT_MARGIN - w, y: HEADING_TOP }.
    const chip = backChip();
    const btn = launchButton();

    // Same centre line.
    expect(chip.x + chip.w / 2).toBe(btn.x + btn.w / 2);
    // Stacked, in reading order, with real air between them and no overlap.
    const gap = btn.y - (chip.y + chip.h);
    expect(gap, `gap between the two actions: ${gap}`).toBeGreaterThan(0);
    expect(gap).toBeLessThanOrEqual(40);
    // The old placement, for the record: this is the distance that was wrong.
    const wasAt = { x: RIGHT_MARGIN - chip.w, y: HEADING_TOP };
    const wasFar = Math.hypot(wasAt.x - btn.x, wasAt.y - btn.y);
    const nowFar = Math.hypot(chip.x - btn.x, chip.y - btn.y);
    expect(wasFar, `old separation ${Math.round(wasFar)} px`).toBeGreaterThan(800);
    expect(nowFar, `new separation ${Math.round(nowFar)} px`).toBeLessThan(120);
  });

  it("50.1: the actions clear Shadow and the shelf, and stay on the screen", () => {
    // Why they are STACKED and not side by side: Shadow's drawn box reaches
    // x 1156 and the glass centre is 1418, so a 380 + 24 + 262 row centred on
    // the glass would start at 1085 and run the primary action through him.
    const chip = backChip();
    const btn = launchButton();
    const shadow = shadowBox();

    expect(overlaps(chip, shadow)).toBe(false);
    expect(overlaps(btn, shadow)).toBe(false);
    expect(chip.y).toBeGreaterThanOrEqual(SHELF.y + SHELF.h);
    // The hint line sits 14 px under the button and still fits on the artboard.
    expect(btn.y + btn.h + 14).toBeLessThan(1080);

    // The side-by-side row this replaced, modelled, so the reason is checked
    // rather than only written down.
    const rowW = btn.w + 24 + chip.w;
    const rowX = WINDOW.x + WINDOW.w / 2 - rowW / 2;
    expect(overlaps({ x: rowX, y: btn.y, w: btn.w, h: btn.h }, shadow)).toBe(true);
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
    // Centred on the glass since UR-50.1, not pinned to the right margin.
    expect(positions[0]).toBe(WINDOW.x + WINDOW.w / 2 - 262 / 2);
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
    expect(backChip().x).toBeGreaterThan(PAGE_X + 884);
    expect(WINDOW.x + WINDOW.w).toBe(RIGHT_MARGIN);
  });
});
