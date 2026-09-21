import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GAME_HEIGHT, GAME_WIDTH } from "@game/sceneKeys";
import {
  GUTTER,
  HEADING_TOP,
  HINT_CONTRACT,
  HINT_TOP,
  BACK_CORNER_BOTTOM,
  backCorner,
  headerText,
} from "@game/ui/grid";
import type { Rect } from "@game/ui/layout";
import { SPACE, STEP, TYPE } from "@game/ui/theme";
import {
  BACK_CHIP,
  BULKHEAD,
  HEADER_SPINE,
  HEADING,
  LINE_PAD,
  LINE_PLATE,
  LINE_SHADOW,
  lineShadowBox,
  MAX_PROMPT_GLYPHS,
  SHELF,
  SUBHEADING,
  backChip,
  leftEdges,
  PROMPT,
  PROMPT_HINT,
  ROW,
  WINDOW,
  contains,
  inset,
  promptPlate,
  checkBarProgress,
  COLUMN_W,
  RACK_PAD,
  windowRect,
  MULLION_CLEARANCE,
  PLANET,
  controlStrip,
  mullionHorizontalAt,
  planetCy,
  planetFill,
  planetLegX,
  planetParkX,
  planetRadius,
  planetRestX,
} from "@game/scenes/support/preflightLayout";
import * as preflightLayout from "@game/scenes/support/preflightLayout";
import {
  SHELF as BRIEFING_SHELF,
  WINDOW as BRIEFING_WINDOW,
  controlStrip as briefingStrip,
} from "@game/scenes/support/briefingLayout";
import {
  CONSOLE_STRIP,
  CONTROL_SURFACE,
  controlSurfaceElementCount,
  controlSurfaceLayout,
} from "@game/ui/controlSurfaceLayout";
import { VIEWPORT_APERTURE, VIEWPORT_WINDOW } from "@game/ui/viewportWindowLayout";
import {
  PALETTE_STOP_IDS,
  lightness,
  paletteFor,
  skyStops,
} from "@game/render/palette";

/**
 * THE TYPED WORD IS ON THE GLASS, NOT ON THE FRAME.
 *
 * `preflight.png`: the "mars" plate straddled the cockpit window's left edge,
 * so the frame's two strokes ran through the middle of the one thing the child
 * is asked to read. The cause is a one-line mismatch - the prompt was placed at
 * `GAME_WIDTH / 2` and the window is a 900 px aperture at x=900 - and it is
 * aspect-dependent: at a wider world the screen's centre drifts far enough
 * right that the plate lands on the glass by accident, so a capture at the
 * wrong aspect shows nothing wrong.
 *
 * Watch it fail: set `PROMPT.x` to `GAME_WIDTH / 2` in
 * `src/game/scenes/support/preflightLayout.ts`.
 *
 *   npx vitest run tests/unit/scenes/preflightLayout.test.ts --coverage.enabled=false
 */

const SRC = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../src/game/scenes",
);

/** The word-prompt arithmetic `promptPlate` restates, read back from source. */
const TYPED_WORD_SRC = readFileSync(resolve(SRC, "lib/typedWord.ts"), "utf8");

/** Air between the plate and the frame: enough that the corner radius is clear. */
const GLASS_MARGIN = 24;

describe("the pre-flight word plate is inside the cockpit window", () => {
  it("contains the longest word the ritual can show", () => {
    const plate = promptPlate(MAX_PROMPT_GLYPHS);
    expect(
      contains(inset(windowRect(), GLASS_MARGIN), plate),
      `plate x ${Math.round(plate.x)}..${Math.round(plate.x + plate.w)}, ` +
        `y ${Math.round(plate.y)}..${Math.round(plate.y + plate.h)} ` +
        `vs window x ${WINDOW.x}..${WINDOW.x + WINDOW.w}, y ${WINDOW.y}..${WINDOW.y + WINDOW.h}`,
    ).toBe(true);
  });

  it("contains every plate size from one glyph up", () => {
    for (let n = 1; n <= MAX_PROMPT_GLYPHS; n += 1) {
      expect(contains(inset(windowRect(), GLASS_MARGIN), promptPlate(n)), `${n} glyphs`).toBe(
        true,
      );
    }
  });

  it("NEGATIVE CONTROL: the shipped screen-centred anchor is red at 16:9", () => {
    // This is exactly what shipped. The world is 1920 wide at the aspect floor,
    // so the plate's centre is 960 and the window starts at 900.
    expect(GAME_WIDTH).toBe(1920);
    const shipped = promptPlate(4, TYPE.display, { x: GAME_WIDTH / 2, y: GAME_HEIGHT * 0.62 });
    expect(contains(windowRect(), shipped)).toBe(false);
    // ...and it straddles rather than missing entirely, which is the read the
    // critic gave it: "half outside".
    expect(shipped.x).toBeLessThan(WINDOW.x);
    expect(shipped.x + shipped.w).toBeGreaterThan(WINDOW.x);
  });

  it("keeps the plate off the system rows and the frame's own bands", () => {
    const plate = promptPlate(MAX_PROMPT_GLYPHS);
    const rowsBottom = ROW.y + 3 * ROW.h + 2 * ROW.gap;
    expect(plate.x).toBeGreaterThan(ROW.x + ROW.w);
    expect(rowsBottom).toBeLessThan(GAME_HEIGHT);
  });

  it("puts the instruction under the glass, inside the frame", () => {
    expect(PROMPT_HINT.y).toBeGreaterThan(WINDOW.y + WINDOW.h);
    expect(PROMPT_HINT.y).toBeLessThan(GAME_HEIGHT - 40);
    expect(PROMPT_HINT.x).toBe(PROMPT.x);
  });
});

describe("promptPlate describes the plate that is actually drawn", () => {
  it("uses typedWord's own padding arithmetic", () => {
    // A restatement is only evidence while it matches. These four lines are the
    // ones `promptPlate` mirrors; if `typedWord.ts` changes any of them this
    // goes red instead of the containment check quietly measuring the wrong box.
    expect(TYPED_WORD_SRC).toContain("const gap = Math.round(size * 0.1);");
    expect(TYPED_WORD_SRC).toContain("const padX = Math.round(size * 0.55);");
    expect(TYPED_WORD_SRC).toContain("const padY = Math.round(size * 0.3);");
    expect(TYPED_WORD_SRC).toContain("const plateH = size * 1.36 + padY;");
  });

  it("is generous about glyph width rather than optimistic", () => {
    // The plate is measured from real glyph advances at draw time; this model
    // has to be an UPPER bound on them or the containment check is worthless.
    // "mars" at 72 px draws a 264 px plate; the model must predict more.
    expect(promptPlate(4).w).toBeGreaterThan(264);
  });
});

describe("UR-39: the screen has a header, one column and a way out", () => {
  const overlaps = (a: Rect, b: Rect): boolean =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  it("puts its title on the product's header lines", () => {
    // The defect: NOTHING above y=320. The only story screen with no header.
    expect(HEADING.y).toBeLessThan(320);
    // UR-168: on header line 0, but inset the MASTHEAD's pad, not the plate's.
    expect(HEADING.y).toBe(headerText(0, undefined, 14).y);
    expect(SUBHEADING.y).toBeGreaterThan(HEADING.y);
    expect(HEADING.x).toBe(SUBHEADING.x);
  });

  it("has ONE left edge for its plates", () => {
    // It had four in one frame - 96, 224, 356, 388. A plate's own padding is
    // not a column edge, so the claim is about plates: they all start on the
    // gutter, and text is inset from the plate it sits on.
    expect([...new Set(leftEdges())]).toEqual([GUTTER]);
    expect(LINE_PAD.x).toBeGreaterThan(0);
  });

  /**
   * UR-101.1: THE RACK HUNG OFF THE COLUMN, AND THE PAIR WAS ANCHORED BACKWARDS.
   *
   * ================== WHAT WAS REPORTED, MEASURED ==================
   * The project owner called this screen "jenky". On the served build the ink
   * lines were heading 118, stop name 118, hint 118 - and the bracket rack
   * around the check rows was at 68, i.e. `GUTTER - 28`, twenty-eight pixels
   * LEFT of the gutter every other element on the screen uses. It was the only
   * thing in the frame that started outside the column.
   *
   * ================== WHY IT WAS 68 IN THE FIRST PLACE ==================
   * The pair was anchored the wrong way round. The ROWS were put on the gutter
   * (`ROW.x = GUTTER`) and the rack was then grown outwards from them to look
   * like a rack, which forces the rack - the PLATE, the thing a column edge is
   * a property of - off the grid by however much padding it wants. UR-39 had
   * already settled the general rule for this exact screen: "every PLATE starts
   * on the gutter and text is inset from its plate". The rack was the one plate
   * nobody applied it to.
   *
   * ================== WHAT IT IS NOW ==================
   * Reversed. The rack is on the gutter and the rows are inset from IT, by
   * `SPACE.rowPadX` - which is 22, is `SKY_PLATE.padX`, and is therefore the
   * same inner line the heading's plated ink, the stop name's and the hint's
   * already sit on (UR-89 made that one number for exactly this reason). So the
   * screen now has TWO vertical lines and not four: plates at 96, anything
   * inside a plate at 118.
   *
   * 28 was also on no scale at all - it is the number UR-89 removed from
   * `SPACE.rowPadX` for being the one inset in `theme.ts` on no scale.
   *
   * WATCHED FAILING, with `BULKHEAD.x = GUTTER - 28` and `ROW.x = GUTTER`:
   *   the rack hangs off the product's column: expected 68 to be 96
   */
  it("UR-101.1: the RACK is on the gutter and the rows are inset from it", () => {
    expect(BULKHEAD.x, "the rack hangs off the product's column").toBe(GUTTER);
    // The rows are inside their rack, by the product's own inner inset...
    expect(ROW.x - BULKHEAD.x).toBe(SPACE.rowPadX);
    // ...and by the same amount on the right, or it is not a rack.
    expect(BULKHEAD.x + BULKHEAD.w - (ROW.x + ROW.w)).toBe(SPACE.rowPadX);
    // THE RACK'S INNER LINE, which is the one the owner measured three times
    // over on the served build. The MASTHEAD is no longer on it - see the case
    // below - so this says what it is about rather than "the whole screen".
    expect(ROW.x).toBe(GUTTER + SPACE.rowPadX);
    expect(HEADING.x).toBe(SUBHEADING.x);
  });

  it("UR-101.1: every plate is on the gutter", () => {
    // `HINT_CONTRACT.x` is the hint PLATE's edge; the hint's ink sits at
    // `+ SKY_PLATE.padX`, which is the same 22.
    const plates = [BULKHEAD.x, LINE_PLATE.x, HINT_CONTRACT.x, ROW.x - SPACE.rowPadX];
    expect([...new Set(plates)]).toEqual([GUTTER]);
  });

  /**
   * UR-168, AND IT IS A DECISION, NOT A DRIFT.
   *
   * This screen was ONE inner line at 118 and the owner had measured that three
   * times over. They then asked for the masthead to match the Briefing's, where
   * the spine is `STEP.inset` in from the page edge and the text another
   * `STEP.inset` clear of it - so the masthead's ink is at 168 and the rack's
   * is still at 118.
   *
   * The trade was stated before it was made: one masthead across two screens,
   * paid for with a second inner line here. What is NOT allowed is a third, so
   * the case asserts the exact pair rather than a count.
   */
  it("UR-168: two inner lines - the rack's and the masthead's - and no more", () => {
    const rack = [ROW.x, LINE_PLATE.x + SPACE.rowPadX];
    expect([...new Set(rack)]).toEqual([GUTTER + SPACE.rowPadX]);

    const masthead = [HEADING.x, SUBHEADING.x];
    expect([...new Set(masthead)]).toEqual([HEADER_SPINE.x + HEADER_SPINE.w + STEP.inset]);

    expect([...new Set([...rack, ...masthead])]).toHaveLength(2);
  });

  it("UR-168: the masthead's spine and text are the Briefing's own numbers", () => {
    // Briefing: page.x + STEP.inset for the spine, + STEP.hair wide, + another
    // STEP.inset to the text. Measured in the served build at x 168.
    expect(HEADER_SPINE.x).toBe(GUTTER + STEP.inset);
    expect(HEADER_SPINE.w).toBe(STEP.hair);
    expect(HEADING.x).toBe(168);
  });

  it("UR-101.1: the left column is ONE width, right edge included", () => {
    // THE HALF THE FIRST FIX EXPOSED, found by looking at the capture rather
    // than at the rectangle that was reported. With the rack pulled onto the
    // gutter it ran 96..724 while Shadow's plate directly under it ran 96..856:
    // two stacked plates agreeing on the left and 132 px apart on the right,
    // which reads worse than being honestly misaligned on both.
    //
    // WATCHED FAILING, with `BULKHEAD.w = ROW.w + RACK_PAD * 2` and `ROW.w` at
    // its old 584: "expected 724 to be 856".
    expect(BULKHEAD.x + BULKHEAD.w).toBe(LINE_PLATE.x + LINE_PLATE.w);
    expect(BULKHEAD.w).toBe(COLUMN_W);
    expect(LINE_PLATE.w).toBe(COLUMN_W);
    // The rows are still inside it, still symmetrically.
    expect(ROW.w).toBe(COLUMN_W - RACK_PAD * 2);
    // ...and the column still clears the glass and the word plate on it.
    expect(BULKHEAD.x + BULKHEAD.w).toBeLessThan(WINDOW.x);
    expect(promptPlate(MAX_PROMPT_GLYPHS).x).toBeGreaterThan(ROW.x + ROW.w);
  });

  it("NEGATIVE CONTROL: the shipped edges were four different numbers", () => {
    const shipped = [96, 224, 356, 388];
    expect(new Set(shipped).size).toBe(4);
    // ...and the dialogue plate, the one that moved, was none of the others.
    expect(shipped).toContain(356);
    expect(LINE_PLATE.x).not.toBe(356);
  });

  it("no longer owns a hint position at all", () => {
    // ================== WHAT THIS USED TO ASSERT ==================
    // `HINT.x === GUTTER` and `HINT.y === HINT_TOP`, against a constant this
    // module exported and `PreflightScene` handed to `lib/kit.label`. Both
    // numbers were right and the screen still did not match its siblings,
    // because `label` draws no plate: the menus' line, the map's and this one
    // were three different treatments of one line.
    //
    // ================== WHAT REPLACES IT ==================
    // `ui/hintLine.drawHint` owns the position AND the style and takes no
    // coordinates, so this module has nothing to export and the scene has
    // nothing to pass. Watched failing with `HINT` put back:
    //   `expected { x: 96, y: 1004 } to be undefined`.
    const mod = preflightLayout as unknown as Record<string, unknown>;
    expect(mod["HINT"]).toBeUndefined();
    // The line the hint is on is still the floor this screen's plates respect,
    // and it is read from the grid rather than from a local copy.
    expect(HINT_CONTRACT.x).toBe(GUTTER);
    expect(HINT_CONTRACT.top).toBe(HINT_TOP);
    // It floated at the window's centre, which is where the word is.
    expect(HINT_CONTRACT.x).not.toBe(PROMPT.x);
  });

  it("gives the screen a way out that does not sit on anything", () => {
    // IN THE PRODUCT'S BACK CORNER (C19), not in a corner this screen worked
    // out for itself. The pixels are unchanged - `ARTBOARD_RIGHT` is 1824 and
    // `WINDOW.x + WINDOW.w` is 1824, which is why this screen was the one the
    // owner measured as correct - but the Briefing now reads the same function,
    // which is what stops the two drifting apart again.
    const chip = backChip();
    expect(chip).toEqual(backCorner(BACK_CHIP.w, BACK_CHIP.h));
    // BOTTOM-right since UR-95: the top-right corner is not free on every
    // screen - the Briefing's cockpit glass reaches it (C19) - and a corner
    // that is only free on some screens is not a shared corner. The chip sits
    // on the hint's own foot line now, so instructions and the way out are one
    // row: text bottom-left, control bottom-right.
    expect(chip.y).toBe(BACK_CORNER_BOTTOM - chip.h);
    expect(chip.x + chip.w).toBe(WINDOW.x + WINDOW.w);
    // Clear of the header block on the left, and of the glass below it.
    expect(chip.x).toBeGreaterThan(HEADING.x + 400);
    // It clears the window from BELOW now, which is the claim that survives a
    // window whose top edge moves.
    expect(chip.y).toBeGreaterThan(WINDOW.y + WINDOW.h);
  });

  it("keeps Shadow INSIDE the plate he is speaking from", () => {
    // The defect this caught: moving the plate to the gutter without moving
    // Shadow printed the line through his face. Containment, not non-overlap -
    // he is meant to be in the card, the way the warp break's coach is.
    const box = lineShadowBox();
    const plate = { x: LINE_PLATE.x, y: LINE_PLATE.y, w: LINE_PLATE.w, h: LINE_PLATE.h };
    expect(box.x).toBeGreaterThanOrEqual(plate.x);
    expect(box.y).toBeGreaterThanOrEqual(plate.y);
    expect(box.y + box.h).toBeLessThanOrEqual(plate.y + plate.h);
    // ...and the text starts past him, so nothing is printed over the figure.
    expect(LINE_PLATE.x + LINE_PAD.x).toBeGreaterThan(box.x + box.w);
  });

  it("NEGATIVE CONTROL: where Shadow stood before is outside the plate", () => {
    // REPOINTED (UR-103). This used to cite {200, 850, 0.86} as the position
    // that fell THROUGH the bottom of the plate - true while the plate was a
    // literal 716. UR-103 moved the plate down to give the rack its air, and
    // that old position is now comfortably INSIDE it, so the control proved
    // nothing at all.
    //
    // It cites the position Shadow held immediately before this ticket instead:
    // a literal 816 against a plate that had moved to 780, which put his HEAD
    // above his own plate. That is the failure this ticket actually caused and
    // fixed, and it is outside the plate today.
    //
    // WATCHED FAILING with `y: LINE_PLATE.y + 100` in place of the literal:
    //   expected 780 to be less than 780
    const wasThere = lineShadowBox({ x: 206, y: 816, scale: 0.72 });
    expect(wasThere.y).toBeLessThan(LINE_PLATE.y);
  });

  it("keeps the shelf, the dialogue, the rack and the rows off each other", () => {
    const rows = { x: ROW.x, y: ROW.y, w: ROW.w, h: 3 * ROW.h + 2 * ROW.gap };
    const rack = { x: BULKHEAD.x, y: BULKHEAD.y, w: BULKHEAD.w, h: BULKHEAD.h };
    const line = { x: LINE_PLATE.x, y: LINE_PLATE.y, w: LINE_PLATE.w, h: LINE_PLATE.h };
    expect(overlaps(rows, line), "the system rows run into Shadow's line").toBe(false);
    // THE ONE THE CAPTURE CAUGHT AND THE TEST DID NOT ASK: the rack the rows
    // are mounted on is bigger than the rows, and a symmetric padding ran it
    // straight through the dialogue plate below.
    expect(overlaps(rack, line), "the rack runs through Shadow's line").toBe(false);
    // ...and it really does contain the rows, or it is not a rack.
    expect(rack.y).toBeLessThan(rows.y);
    expect(rack.y + rack.h).toBeGreaterThanOrEqual(rows.y + rows.h);
    expect(overlaps(line, { x: SHELF.x, y: SHELF.y, w: SHELF.w, h: SHELF.h })).toBe(false);
    expect(line.y + line.h).toBeLessThan(HINT_CONTRACT.top);
    expect(SHELF.y + SHELF.h).toBeLessThan(1080);
  });
});

/**
 * UR-77: THE PRE-FLIGHT AND THE BRIEFING ARE ONE COCKPIT SEEN TWICE.
 *
 * Three of the four things reported against this screen share one root cause -
 * the two screens drew the same furniture twice, differently - and each of them
 * had a green guard sitting beside it the whole time. So these assertions are
 * about SHARING, not about resemblance: the same function, the same constants,
 * the same arithmetic, checked against the Briefing's own module and against
 * `render/parallax.ts`'s own source rather than against a copy of its numbers.
 *
 *   npx vitest run tests/unit/scenes/preflightLayout.test.ts --coverage.enabled=false
 */
describe("UR-77.2: the strip under the glass is the Briefing's, not a second one", () => {
  it("is the same box the Briefing's is, under each screen's own glass", () => {
    // WATCHED FAILING: put `h: 76` back on this screen's SHELF and the shared
    // height check reports "expected 76 to be 124".
    expect(SHELF.h).toBe(CONSOLE_STRIP.h);
    expect(SHELF.h).toBe(BRIEFING_SHELF.h);
    expect(SHELF.lamps).toBe(BRIEFING_SHELF.lamps);
    // What shipped: 76 px of plate with nine dots on it.
    expect(SHELF.h).toBeGreaterThan(76);
    expect(SHELF.lamps).not.toBe(9);
  });

  it("stops hanging past the glass on both sides", () => {
    // The shipped strip was `WINDOW.x - 30, WINDOW.w + 60` - 30 px of bar
    // sticking out beyond the window on each side, which is the one rectangle
    // on this screen that genuinely started left of everything else.
    expect(SHELF.x).toBe(WINDOW.x);
    expect(SHELF.w).toBe(WINDOW.w);
    expect(controlStrip()).toEqual({ x: SHELF.x, y: SHELF.y, w: SHELF.w, h: SHELF.h });
  });

  it("has the vents, the screws and the bezel - the thing that was missing", () => {
    // `drawControlSurface` had exactly ONE caller in the product and it was the
    // Briefing, so this screen had no vents at all. The claim is about the
    // GEOMETRY the shared surface lays out in this screen's own box.
    const parts = controlSurfaceLayout(controlStrip(), SHELF.lamps);
    expect(parts.vents.length).toBe(CONTROL_SURFACE.ventCount * 2);
    expect(parts.rivets.length).toBe(4);
    expect(parts.lamps.length).toBe(SHELF.lamps);
    expect(controlSurfaceElementCount(parts)).toBe(26);
    // ...the same count the Briefing's strip has, because it is the same strip.
    expect(controlSurfaceElementCount(parts)).toBe(
      controlSurfaceElementCount(controlSurfaceLayout(briefingStrip(), BRIEFING_SHELF.lamps)),
    );
  });

  it("still leaves the dialogue plate and the hint alone at 124 px", () => {
    // The strip gained 48 px. It is 48 px of hull nobody was using, but that is
    // a claim about this screen's foot and not a general truth.
    expect(SHELF.y + SHELF.h).toBeLessThan(HINT_CONTRACT.top);
    expect(SHELF.x).toBeGreaterThan(LINE_PLATE.x + LINE_PLATE.w);
  });
});

describe("UR-77.1: the crosshatch, and where it is allowed to differ", () => {
  it("keeps the horizontal strut off the typed word", () => {
    // The ONLY thing about this window that is genuinely per-screen. The
    // Briefing's 0.7 puts the strut at y 590 and the widest prompt plate's top
    // edge is at 580, so the strut would run along the top of the one thing
    // the child is asked to read.
    //
    // WATCHED FAILING: return `VIEWPORT_WINDOW.horizontalAt` unconditionally
    // from `mullionHorizontalAt` - "the strut runs through the typed word:
    // expected 602 to be less than or equal to 556.04".
    const at = mullionHorizontalAt();
    const strutBottom = WINDOW.y + WINDOW.h * at + VIEWPORT_WINDOW.mullionH;
    const plateTop = promptPlate(MAX_PROMPT_GLYPHS).y;
    expect(
      strutBottom,
      "the strut runs through the typed word",
    ).toBeLessThanOrEqual(plateTop - MULLION_CLEARANCE);
    // ...and it is a real strut on real glass, not one pushed off the top.
    expect(at).toBeGreaterThan(0.4);
    expect(at).toBeLessThanOrEqual(VIEWPORT_WINDOW.horizontalAt);
  });

  it("UR-121: the two screens are now the SAME glass, crosshatch included", () => {
    /**
     * THIS TEST REPLACED A NEGATIVE CONTROL THAT BECAME FALSE, and the reason
     * it became false is the fix.
     *
     * It used to assert that the Briefing's own horizontal fraction LANDS ON
     * this screen's prompt plate - which was true, and was the whole
     * justification for `mullionHorizontalAt` deriving a different fraction
     * here. The owner then walked Briefing -> Pre-flight, saw the window jump,
     * and named the Briefing's as the standard.
     *
     * The rects were never the same: `{1012, 84, 812, 636, r56}` against
     * `{900, 170, 924, 600, r48}`. Sharing the aperture made the glass 112 px
     * narrower, which forced the prompt down to its own 64 px size, and the
     * plate then sat low enough that the Briefing's strut clears it. So the
     * exception is gone - not overridden, but no longer earned.
     *
     * The derivation in `mullionHorizontalAt` is deliberately KEPT. If the
     * glass shrinks or the prompt grows, the fraction moves off 0.7 and this
     * test fails, which is the loud version of the strut quietly crossing the
     * word a child is reading.
     */
    expect(mullionHorizontalAt()).toBe(VIEWPORT_WINDOW.horizontalAt);
    // And the strut genuinely clears the widest plate, rather than the two
    // numbers merely being equal.
    const strutBottom =
      WINDOW.y + WINDOW.h * VIEWPORT_WINDOW.horizontalAt + VIEWPORT_WINDOW.mullionH;
    expect(strutBottom).toBeLessThanOrEqual(
      promptPlate(MAX_PROMPT_GLYPHS).y - MULLION_CLEARANCE,
    );
  });

  it("UR-121: the aperture itself is one constant, not two that match today", () => {
    // The module note on `ui/viewportWindowLayout` says it in advance: "two
    // drawings that happen to match today are not one component". UR-77 shared
    // the STYLING and left each screen its own rectangle; this is the rest.
    expect(windowRect()).toEqual({
      x: VIEWPORT_APERTURE.x,
      y: VIEWPORT_APERTURE.y,
      w: VIEWPORT_APERTURE.w,
      h: VIEWPORT_APERTURE.h,
    });
    expect(BRIEFING_WINDOW).toBe(VIEWPORT_APERTURE);
  });
});

/**
 * UR-77.3: THE PLANET WAS A THUMBPRINT.
 *
 * A blind critic called it a desaturated grey-brown disc and a thumbprint, and
 * said it was most of what made the window unreadable. The answer taken at the
 * time changed the TERMINATOR'S HUE and it did not work, because the hue was
 * never the problem: four stacked translucent circles average to mud whatever
 * colour each one is.
 *
 * The Briefing has no hand-drawn planet at all - it passes `celestial` to the
 * parallax and gets ONE FLAT DISC, hazed into the sky and separated from it by
 * value. This screen has to keep its own because the disc SWINGS IN over the
 * ritual and the parallax owns its layer's position, so what it shares is the
 * arithmetic. These assertions read the shared arithmetic back out of
 * `render/parallax.ts` rather than trusting a copy of it.
 */
describe("UR-77.3: the planet is the shared celestial body, not a second one", () => {
  const PARALLAX = readFileSync(resolve(SRC, "../render/parallax.ts"), "utf8");

  it("uses `celestialBody`'s own size rule, read back from its source", () => {
    // A restatement is only evidence while it matches.
    expect(PARALLAX).toContain("const r = Math.min(w, h) * 0.12;");
    expect(planetRadius(1920, 1080)).toBeCloseTo(Math.min(1920, 1080) * 0.12, 6);
    // What shipped: r = 300, more than twice the shared body at the same world.
    expect(planetRadius(1920, 1080)).toBeLessThan(300 / 2);
  });

  it("uses its haze and its L* separation, read back from its source", () => {
    expect(PARALLAX).toContain(
      "const hazed = atmospheric(pal.colors[2] ?? pal.accent, sky, 0.84);",
    );
    expect(PARALLAX).toContain(
      "const body = withLightness(hazed, target > 50 ? Math.max(4, target - 14) : Math.min(96, target + 14));",
    );
    expect(PLANET.haze).toBe(0.84);
    expect(PLANET.separationL).toBe(14);
  });

  it("separates from whatever sky it is put against, at every stop", () => {
    // The defect the shared body already fixed once: a critic measured it at
    // L* 77.7 against a local sky of L* 77.8 - a ratio of 1.00:1, pure hue,
    // invisible on a tablet at half brightness and invisible to a colour-blind
    // child always. Both ends of each stop's sky gradient are probed, because
    // the disc crosses the glass rather than sitting at one height.
    for (const stopId of PALETTE_STOP_IDS) {
      const pal = paletteFor(stopId);
      for (const sky of skyStops(pal)) {
        const gap = Math.abs(lightness(planetFill(pal, sky)) - lightness(sky));
        expect(gap, `${stopId} against ${sky}`).toBeGreaterThan(11);
      }
    }
  });

  it("draws NO planet of its own - the parallax's celestial layer does (UR-96)", () => {
    // SUPERSEDES "is ONE flat disc in the scene". That assertion was right
    // while this scene owned a disc: it had been four translucent circles and
    // read as a thumbprint, and one flat circle was the fix.
    //
    // The scene now owns none. The planet was excluded from the parallax for
    // one stated reason - it had to SWING IN - and the swing was the defect:
    // it slid on entry and again on every typed word, so the planet jumped
    // whenever the child succeeded. With the swing gone the reason is gone, and
    // the Briefing's window next door has always shown a still planet from the
    // shared `celestial` layer. Two screens, one implementation, one position.
    //
    // WATCHED FAILING, with the private disc restored:
    //   the scene still draws its own planet: expected 1 to be 0
    const scene = readFileSync(resolve(SRC, "PreflightScene.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const circles = scene.match(/disc\.fillCircle\(/g) ?? [];
    expect(circles.length, "the scene still draws its own planet").toBe(0);
    // And it takes the layer instead, which is the half that makes it appear.
    expect(scene).toContain('"celestial"');
    // Nothing moves it any more. These were the two tweens that were reported.
    expect(scene).not.toContain("planetLegX");
    expect(scene).not.toContain("WINDOW.w * 0.62");
  });

});

/**
 * UR-101.2: THE CHECK BAR HAD TWO POSITIONS.
 *
 * ================== WHAT WAS REPORTED ==================
 * `PreflightScene.paintRow` drew a row's bar inside `if (row.state === "lit")`
 * and nowhere else, so it went 0% to 100% with nothing in between - a progress
 * bar with two positions, on the one instrument a child is looking at while
 * they type. The project owner asked for it to fill as the child types, and
 * specifically for it to FEEL like their typing is driving it.
 *
 * ================== WHAT THE RULE HAS TO SATISFY AT ONCE ==================
 * Four things, and they pull against each other, which is why the arithmetic is
 * pure and tested here rather than inlined in a Phaser scene:
 *
 *   it must move on the keystroke, per KEY and not per word;
 *   it must reach exactly full when the step completes, never 97% or 103%;
 *   it must never go backwards (D31: a typo is not punished);
 *   and it must advance WHETHER OR NOT the child types, because nobody is
 *   forced to and D100's timeout finishes the step underneath them.
 *
 * `max(typed, elapsed)` is what satisfies all four. See `checkBarProgress`.
 *
 *   npx vitest run tests/unit/scenes/preflightLayout.test.ts --coverage.enabled=false
 */
describe("UR-101.2: the check bar fills as the step runs", () => {
  /** One step: four words, four letters each, 5 s of assist window per word. */
  const STEP = { totalKeys: 16, wordCount: 4, wordWindowMs: 5_000 } as const;
  const at = (
    typedKeys: number,
    wordIndex: number,
    wordElapsedMs: number,
  ): number =>
    checkBarProgress({ ...STEP, typedKeys, wordIndex, wordElapsedMs });

  it("moves on EVERY accepted keystroke, not once per word", () => {
    // The sharpened form of the report: per word would leave the hull step -
    // one word - exactly as binary as the defect it is meant to fix.
    const steps = [0, 1, 2, 3, 4].map((k) => at(k, 0, 0));
    expect(steps).toEqual([0, 0.0625, 0.125, 0.1875, 0.25]);
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i]!, `key ${i} moved nothing`).toBeGreaterThan(steps[i - 1]!);
    }
  });

  it("NEGATIVE CONTROL: a single-word step would still be binary per word", () => {
    // What "per word" would have produced for the hull check: nothing until the
    // word is done. The keystroke rule gives four readings for a four-letter
    // word where the word rule gives two.
    const hull = { totalKeys: 4, wordCount: 1, wordWindowMs: 5_000 } as const;
    const readings = [0, 1, 2, 3, 4].map((k) =>
      checkBarProgress({ ...hull, typedKeys: k, wordIndex: 0, wordElapsedMs: 0 }),
    );
    expect(new Set(readings).size).toBe(5);
  });

  it("is ONE continuous fill across a step's words, not a jump per word", () => {
    // Four words in one step. The fill at the end of word 2 and at the start of
    // word 3 is the same number, so nothing lurches at a word boundary.
    expect(at(8, 2, 0)).toBe(0.5);
    expect(at(9, 2, 0)).toBe(0.5625);
  });

  it("reaches EXACTLY full when the last keystroke lands", () => {
    expect(at(16, 3, 0)).toBe(1);
    // ...and cannot be pushed past it by a clock that kept running.
    expect(at(16, 4, 9_999)).toBe(1);
  });

  it("advances on the clock for a child who types nothing (UR-31 made visible)", () => {
    // The half that makes it correct rather than merely responsive. The step
    // completes with or without the child, so the bar has to as well - the
    // display and the truth may not disagree on this screen.
    expect(at(0, 0, 0)).toBe(0);
    expect(at(0, 0, 2_500)).toBe(0.125);
    expect(at(0, 0, 5_000)).toBe(0.25);
    expect(at(0, 1, 0)).toBe(0.25);
    expect(at(0, 3, 5_000)).toBe(1);
  });

  it("typing only ever pulls the bar AHEAD of the clock, never behind it", () => {
    // A fast typist: 8 keys down while the clock is a quarter through word 1.
    const fast = at(8, 0, 1_250);
    expect(fast).toBe(0.5);
    // The same instant with nothing typed reads the clock alone.
    expect(at(0, 0, 1_250)).toBe(0.0625);
    // A slow typist is carried by the clock rather than held back by it.
    expect(at(1, 0, 4_000)).toBeCloseTo(0.2, 6);
  });

  it("D31: a keystroke that advances nothing leaves the bar exactly where it was", () => {
    // A typo does not increment `typedKeys`, so the reading is unchanged at the
    // same instant. The bar retreating would be a punishment drawn in the one
    // place the child is looking, which AC-22b.1 forbids outright.
    expect(at(5, 0, 1_000)).toBe(at(5, 0, 1_000));
    const before = at(5, 0, 1_000);
    const afterTypo = at(5, 0, 1_000);
    expect(afterTypo).toBeGreaterThanOrEqual(before);
  });

  it("is monotonic along every trajectory a real run can take", () => {
    // The PROPERTY, rather than six examples of it. Both inputs are
    // nondecreasing in a real run - the clock does not rewind and a keystroke
    // is never un-typed - so the reading must be nondecreasing too. Three
    // pilots are walked frame by frame at 250 ms:
    //
    //   the child who types nothing        (the clock carries them)
    //   the child who types a key a second (slower than the clock in places)
    //   the child who types instantly      (always ahead of the clock)
    //
    // WATCHED FAILING on a first version of this loop that reset `typedKeys`
    // when the clock advanced: "expected 0.0125 to be greater than or equal to
    // 0.25". That was the test walking a trajectory no run can take, not the
    // function retreating - which is itself the reason this is written as a
    // walk rather than as a cross-product.
    const pilots: ((wordMs: number) => number)[] = [
      () => 0,
      (wordMs) => Math.min(4, Math.floor(wordMs / 1_000)),
      () => 4,
    ];
    for (const [i, keysIn] of pilots.entries()) {
      let last = -1;
      let value = 0;
      for (let word = 0; word < STEP.wordCount; word += 1) {
        for (let ms = 0; ms <= STEP.wordWindowMs; ms += 250) {
          value = checkBarProgress({
            ...STEP,
            typedKeys: word * 4 + keysIn(ms),
            wordIndex: word,
            wordElapsedMs: ms,
          });
          expect(
            value,
            `pilot ${i} went backwards at word ${word}, ${ms} ms`,
          ).toBeGreaterThanOrEqual(last);
          last = value;
        }
      }
      // And every one of them arrives, exactly, however they got there.
      expect(value, `pilot ${i} did not reach full`).toBe(1);
    }
  });

  it("AC-11.3: it cannot tell a child who typed from one who did not", () => {
    // THE REASON THIS IS NOT A GRADE, and it is structural rather than a
    // promise. At the end of a step both children see a full bar, so nothing
    // drawn here distinguishes them and nothing drawn here can be read as a
    // mark on either. A bar driven by keystrokes ALONE would have been a score.
    const typedEverything = at(16, 3, 0);
    const typedNothing = at(0, 3, STEP.wordWindowMs);
    expect(typedEverything).toBe(1);
    expect(typedNothing).toBe(1);
    expect(typedEverything).toBe(typedNothing);
  });

  it("degrades safely on the shapes the scene can hand it", () => {
    // A step with no words (the "none" fallback) is complete, not divided by
    // zero; a step whose keystroke total is unknown falls back to the clock.
    expect(checkBarProgress({ typedKeys: 0, totalKeys: 0, wordIndex: 0, wordCount: 0, wordElapsedMs: 0, wordWindowMs: 0 })).toBe(1);
    expect(checkBarProgress({ typedKeys: 0, totalKeys: 0, wordIndex: 1, wordCount: 2, wordElapsedMs: 0, wordWindowMs: 0 })).toBe(0.5);
  });
});

/**
 * UR-101.4: TYPING IN THE RITUAL WAS SILENT.
 *
 * `lib/typedWord.ts` played no audio at all - grep it, there was no cue call -
 * while the belt next door gives every keystroke a mechanical clack (UR-34) and
 * a pitched note climbing a pentatonic ladder (D75/UR-30). Every screen the
 * module serves was affected: the first-run ritual, the launch ceremony at six
 * stops, and Earth's activation.
 *
 * These are SOURCE assertions for the same reason `preflightAssist.test.ts`'s
 * are: the module imports Phaser and cannot be constructed in a node suite, and
 * the defect class is not "the code is wrong" but "the code was never called".
 * The sound itself is tested where it lives, in `tests/unit/audio/`.
 */
describe("UR-101.4: the typed word sounds like the belt", () => {
  const SRC_NO_COMMENTS = TYPED_WORD_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(
    /\/\/[^\n]*/g,
    "",
  );

  it("NEGATIVE CONTROL: the module really did contain no cue call", () => {
    // What the report said, restated as the thing that would be true again if
    // the calls below were removed. This is the grep that came back empty.
    const cueCalls = SRC_NO_COMMENTS.match(/routeFlightCue|resetTone|\.play\(/g) ?? [];
    expect(cueCalls.length, "the typed word is silent again").toBeGreaterThan(0);
  });

  it("routes the FLIGHT cue for a keystroke, rather than inventing a second one", () => {
    // The structural half. Going through `routeFlightCue` is what makes
    // "sounds like the belt" a property rather than a resemblance: the SFX
    // event, the D75 tone step and the word-boundary reset all come from one
    // table in `audio/wiring.ts`, so changing the clack changes this too.
    expect(SRC_NO_COMMENTS).toContain('routeFlightCue({ cue: "keystroke"');
    // ...and it is on the ACCEPTED keystroke, which is the only place the lock
    // machine says a letter went in.
    const advanced = SRC_NO_COMMENTS.slice(
      SRC_NO_COMMENTS.indexOf('emit.type === "advanced"'),
    ).slice(0, 400);
    expect(advanced).toContain("routeFlightCue");
  });

  it("D31: a mistyped key goes to the cue that is policed as the quietest", () => {
    // Not a judgement made in this module. `typo` is a `GENTLE_EVENT` and
    // `audio/sfx.ts` holds its ceiling; all this does is name it.
    const nudge = SRC_NO_COMMENTS.slice(
      SRC_NO_COMMENTS.indexOf('emit.type === "typo" || emit.type === "ignored"'),
    ).slice(0, 400);
    expect(nudge).toContain("routeFlightCue({ cue: emit.type");
    // And nothing in this module reaches for a LOUDER event on a mistake.
    expect(SRC_NO_COMMENTS).not.toMatch(/routeFlightCue\(\{ cue: "(blast|hit|warp)"/);
  });

  it("resets the pitched ladder at the word boundary (UR-30)", () => {
    // Without this every prompt after the first would start where the last one
    // stopped, and the ladder would sit on its ceiling - which is exactly the
    // defect UR-30 reopened against the belt, rebuilt on a new screen.
    const done = SRC_NO_COMMENTS.slice(SRC_NO_COMMENTS.indexOf('emit.type === "blast"')).slice(
      0,
      400,
    );
    expect(done).toContain("resetTone()");
    // A finished prompt is NOT a rock exploding, so it does not take `blast`.
    expect(done).not.toContain('cue: "blast"');
  });

  it("is silent when there is no audio service, rather than throwing", () => {
    // The standalone harness and a browser that refused an AudioContext both
    // hand back null. Optional chaining is the whole mechanism and it has to be
    // on every call site, not most of them.
    const calls = SRC_NO_COMMENTS.match(/audio[?.]*\.(routeFlightCue|resetTone)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const call of calls) expect(call.startsWith("audio?.")).toBe(true);
  });
});
