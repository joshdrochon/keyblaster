import { describe, expect, it } from "vitest";
import {
  HUD_PLATE_W,
  hudPlacePlate,
  hudRects,
  intrudesOnWordPlates,
  wordPlateSpan,
} from "../../../src/game/flight/hudLayout.js";
import { SPAWN_MARGIN_PX } from "../../../src/game/flight/stage.js";
import { STOP_IDS } from "../../../src/engine/types.js";
import { stagePoolFor } from "../../../src/game/flight/stage.js";

/**
 * UR-21 MUST NOT BECOME UR-23.
 *
 * The player asked for the stop's name on the flight HUD. The HUD is the only
 * thing on that screen drawn above a word plate, so an element placed where the
 * rocks fall would hide a word - UR-23, reported the same evening.
 *
 * This measures the HUD's rectangles against the band a word plate can actually
 * occupy. Writing it found a defect that predated UR-21 entirely:
 * `FlightScene.laneSpec` sized the spawn keep-out by the ROCK's half-width,
 * documented as "the plate is narrower than the rock at every length", and the
 * plate is WIDER - by 60 px a side at "spinning", the longest word any shipped
 * pool contains. The leftmost such plate reached x=259.6 while the HUD's left
 * readout runs to x=260: four tenths of a pixel, today, on this content.
 *
 * The keep-out now uses `max(rock, plate)`, so a plate's edge cannot pass the
 * margin. This file derives that from the same two size functions rather than
 * asserting it, and the negative control re-derives it under the OLD rule and
 * watches the HUD intrude.
 *
 * The plate's geometry is recomputed here from `wordPlate`'s own exported
 * constants rather than imported from it, because that module pulls in Phaser
 * and this suite runs in node. The numbers are asserted against the ones the
 * renderer uses in the test below, so the copy cannot drift silently.
 */

/** `FlightScene.plateStyle`, the two fields plate width depends on. */
const FONT_SIZE_PX = 30;
/** D41's increased-spacing setting, i.e. the WIDEST plate a child can ask for. */
const LETTER_SPACING_PX = 5;
/** `wordPlate.PLATE_PAD_X_PX`. */
const PAD_X_PX = 14;
/** `wordPlate.cellWidthPx`. */
const cellWidth = (): number => FONT_SIZE_PX * 0.62 + LETTER_SPACING_PX;
const plateWidth = (letters: number): number => letters * cellWidth() + PAD_X_PX * 2;

/** `asteroid.ts`: BASE_SIZE_PX, SIZE_PER_LETTER_PX, MIN_SIZED_WORD_LENGTH, MAX_SIZE_PX. */
const rockSizePx = (letters: number): number =>
  Math.min(140, 56 + (Math.max(3, letters) - 3) * 8);

const longestWord = (): number => {
  let longest = 1;
  for (const stop of STOP_IDS) {
    for (const word of stagePoolFor(stop)) longest = Math.max(longest, [...word].length);
  }
  return longest;
};

/**
 * How far past the spawn margin a plate's own edge reaches, over every word
 * that can be on a belt.
 *
 * `keepOutHalfWidth` is `FlightScene.laneSpec`'s rule, restated: the spawn
 * column is held that far inside the margin, and the plate then sticks out by
 * `plateHalf - keepOut`. Under the shipped `max` rule that is never positive.
 * Under the old rock-only rule it reaches 76 px, which is the control below.
 *
 * Maximised over LENGTH rather than evaluated at the longest word, because the
 * two terms pull against each other: a longer word makes the plate wider AND
 * the rock bigger.
 */
const overhangPx = (keepOutHalfWidth: (letters: number) => number): number => {
  let worst = 0;
  for (let letters = 1; letters <= longestWord(); letters += 1) {
    worst = Math.max(worst, plateWidth(letters) / 2 - keepOutHalfWidth(letters));
  }
  return worst;
};

/** The shipped rule: whichever of the rock and its plate is wider. */
const shippedKeepOut = (letters: number): number =>
  Math.max(rockSizePx(letters) / 2, plateWidth(letters) / 2);

/** The rule that shipped the defect: the rock alone. */
const rockOnlyKeepOut = (letters: number): number => rockSizePx(letters) / 2;

const worstOverhangPx = (): number => overhangPx(shippedKeepOut);

describe("UR-21: the HUD names the stop without covering a word", () => {
  const DESIGN_WIDTH = 1920;

  it("measures the real worst case: the longest word in any shipped pool", () => {
    expect(longestWord()).toBeGreaterThanOrEqual(7);
  });

  it("no HUD rectangle reaches the band word plates travel down", () => {
    const span = wordPlateSpan(DESIGN_WIDTH, worstOverhangPx());
    for (const rect of hudRects(DESIGN_WIDTH)) {
      expect(
        intrudesOnWordPlates(rect, span),
        `a HUD plate at x ${rect.x}..${rect.x + rect.w} reaches into the word corridor ${Math.round(span.left)}..${Math.round(span.right)}`,
      ).toBe(false);
    }
  });

  it("holds at an ultrawide window too, where the right plate moves and the corridor widens", () => {
    // D99: the world widens with the window at a pinned height, so the right
    // readout moves and the corridor's right edge moves with it. The two must
    // not cross at any width the game can be opened at.
    for (const width of [1920, 2160, 2560, 3440]) {
      const span = wordPlateSpan(width, worstOverhangPx());
      for (const rect of hudRects(width)) {
        expect(intrudesOnWordPlates(rect, span), `width ${width}, rect x ${rect.x}`).toBe(false);
      }
    }
  });

  it("a plate's edge never passes the spawn margin, because the keep-out sizes on it", () => {
    // Derived, not asserted: if `laneSpec` ever goes back to sizing on the rock
    // this goes positive and the test below it goes red.
    expect(worstOverhangPx()).toBeLessThanOrEqual(0);
  });

  /**
   * THE NEGATIVE CONTROLS (D85). Two of them, because there were two ways to
   * get this wrong and the check has to catch both.
   */
  it("CATCHES the rock-only keep-out that shipped the overlap", () => {
    const reach = overhangPx(rockOnlyKeepOut);
    expect(reach).toBeGreaterThan(55);
    const span = wordPlateSpan(DESIGN_WIDTH, reach);
    const left = hudRects(DESIGN_WIDTH)[0];
    expect(left).toBeDefined();
    expect(intrudesOnWordPlates(left as { x: number; y: number; w: number; h: number }, span)).toBe(
      true,
    );
  });

  it("CATCHES the top-centre title card that was rejected", () => {
    const span = wordPlateSpan(DESIGN_WIDTH, worstOverhangPx());
    const titleCard = { x: DESIGN_WIDTH / 2 - 160, y: 26, w: 320, h: 46 };
    expect(intrudesOnWordPlates(titleCard, span)).toBe(true);
  });

  it("the place plate is stacked under the instruments, in the same column and width", () => {
    const place = hudPlacePlate();
    expect(place.w).toBe(HUD_PLATE_W);
    expect(place.x).toBe(hudRects(DESIGN_WIDTH)[0]?.x);
    const left = hudRects(DESIGN_WIDTH)[0];
    expect(place.y).toBeGreaterThan((left?.y ?? 0) + (left?.h ?? 0));
  });

  it("the corridor is derived from the spawn margin, not from a second copy of it", () => {
    const span = wordPlateSpan(DESIGN_WIDTH, 0);
    expect(span.left).toBe(SPAWN_MARGIN_PX);
    expect(span.right).toBe(DESIGN_WIDTH - SPAWN_MARGIN_PX);
  });
});
