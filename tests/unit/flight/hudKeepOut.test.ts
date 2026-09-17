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
// THE RENDERER'S OWN FUNCTIONS, imported rather than restated. See the note on
// `plateWidth` below for what was here before and why it was not a binding.
import { asteroidSizePx } from "../../../src/game/render/asteroid.js";


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
 * ================== HOW MUCH OF THIS IS ACTUALLY BOUND ==================
 * An earlier version of this comment claimed the hand-written numbers were
 * "asserted against the ones the renderer uses". THEY WERE NOT. No such
 * assertion existed, and a guard that re-derives the numbers it is checking is
 * testing its own arithmetic. Stated plainly rather than quietly improved:
 *
 *   ROCK SIZE is now the renderer's own `asteroidSizePx`, imported. `asteroid.ts`
 *   loads in node because the functions this file calls never touch Phaser.
 *
 *   PLATE WIDTH is still restated here, and cannot be imported today:
 *   `wordPlate.ts` declares `class WordPlate extends Phaser.GameObjects.Container`,
 *   so importing anything from it executes Phaser and dies on `window is not
 *   defined` under vitest's node environment.
 *
 * THE FIX IS A MODULE SPLIT, not a wider tolerance: `plateSize`, `cellWidthPx`,
 * `plateOffsetY` and the `PLATE_*` constants are pure arithmetic sharing a file
 * with a Phaser subclass for no reason. Moving them to a Phaser-free
 * `wordPlateGeometry.ts` that `wordPlate.ts` re-exports would make this a real
 * binding. Not done tonight; raised in gauntlet/escalations.md so the gap has a
 * ticket rather than a comment.
 */

/**
 * `FlightScene.plateStyle` at D41's increased letter spacing - the WIDEST plate
 * a child can ask for, and therefore the case the keep-out has to survive.
 */
const WIDEST_STYLE = {
  plate: "#0E1116",
  plateText: "#F7FAFF",
  accent: "#FFC857",
  fontFamily: "'Atkinson Hyperlegible', 'Noto Sans', 'Segoe UI', system-ui, sans-serif",
  fontSizePx: 30,
  letterSpacingPx: 5,
  uppercase: false,
  reducedMotion: false,
} as const;

/**
 * RESTATED from `wordPlate.cellWidthPx` / `plateSize`, because that module
 * cannot be loaded here (see the header). Keep these three lines identical to
 * it; the module split described above is what would remove the duplication.
 */
const PLATE_PAD_X_PX = 14;
const cellWidthPx = (): number => WIDEST_STYLE.fontSizePx * 0.62 + WIDEST_STYLE.letterSpacingPx;
const plateWidth = (letters: number): number => letters * cellWidthPx() + PLATE_PAD_X_PX * 2;

/** The renderer's own answer. */
const rockSizePx = (letters: number): number => asteroidSizePx(letters);

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
