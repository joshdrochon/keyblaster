import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GAME_HEIGHT, GAME_WIDTH } from "@game/sceneKeys";
import { GUTTER, HEADING_TOP, HINT_TOP, headerText } from "@game/ui/grid";
import type { Rect } from "@game/ui/layout";
import { TYPE } from "@game/ui/theme";
import {
  BACK_CHIP,
  BULKHEAD,
  HEADING,
  HINT,
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
  windowRect,
} from "@game/scenes/support/preflightLayout";

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
    expect(HEADING).toEqual(headerText(0, undefined, 14));
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

  it("NEGATIVE CONTROL: the shipped edges were four different numbers", () => {
    const shipped = [96, 224, 356, 388];
    expect(new Set(shipped).size).toBe(4);
    // ...and the dialogue plate, the one that moved, was none of the others.
    expect(shipped).toContain(356);
    expect(LINE_PLATE.x).not.toBe(356);
  });

  it("puts the hint in the band every sibling uses", () => {
    expect(HINT.x).toBe(GUTTER);
    expect(HINT.y).toBe(HINT_TOP);
    // It floated at the window's centre, which is where the word is.
    expect(HINT.x).not.toBe(PROMPT.x);
  });

  it("gives the screen a way out that does not sit on anything", () => {
    const chip = backChip();
    expect(chip.y).toBe(HEADING_TOP);
    expect(chip.x + chip.w).toBe(WINDOW.x + WINDOW.w);
    // Clear of the header block on the left, and of the glass below it.
    expect(chip.x).toBeGreaterThan(HEADING.x + 400);
    expect(chip.y + chip.h).toBeLessThan(WINDOW.y);
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
    const wasThere = lineShadowBox({ x: 200, y: 850, scale: 0.86 });
    expect(wasThere.y + wasThere.h).toBeGreaterThan(LINE_PLATE.y + LINE_PLATE.h);
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
    expect(line.y + line.h).toBeLessThan(HINT.y);
    expect(SHELF.y + SHELF.h).toBeLessThan(1080);
  });
});
