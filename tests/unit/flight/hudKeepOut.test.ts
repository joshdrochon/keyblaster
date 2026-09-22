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
import { plateSize } from "../../../src/game/render/wordPlateGeometry.js";


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
 * THOSE TWO NUMBERS ARE HISTORY NOW. The plate stopped laying its letters on a
 * fixed 0.62-em cell and started summing their real advances, so every plate is
 * about a fifth narrower and the worst case moved from "spinning" (8 letters,
 * the longest) to "enormous" (8 letters, the widest). Under the old rock-only
 * rule the overhang is 48.14 px rather than 60.4, and the leftmost plate now
 * misses the readout by 11.86 px instead of hitting it by 0.4. The control
 * below says so rather than being retuned until it passes.
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
 *   PLATE WIDTH used to be restated here too, because `wordPlate.ts` declares
 *   `class WordPlate extends Phaser.GameObjects.Container` and importing
 *   anything from it executed Phaser and died on `window is not defined` under
 *   vitest's node environment.
 *
 * THE MODULE SPLIT THIS FILE ASKED FOR HAS LANDED. `plateSize`, `cellWidthPx`,
 * `plateOffsetY` and the `PLATE_*` constants are pure arithmetic and now live in
 * a Phaser-free `render/wordPlateGeometry.ts` that `wordPlate.ts` re-exports, so
 * both halves of this check are the renderer's own functions and the duplication
 * is gone.
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
 * THE PROBE IS A WORD NOW, NOT A LETTER COUNT.
 *
 * `cellWidthPx` IS GONE. The plate used to lay every character on one fixed
 * cell, so its width was a function of letter COUNT and `"a".repeat(n)` stood
 * in for every n-letter word exactly. It now packs each glyph's own measured
 * advance, so "spinning" and "aaaaaaaa" are different widths and a probe made
 * of one letter would understate the worst case it exists to find.
 *
 * So this sweeps the REAL pools, which is what the docstring above always
 * claimed and what the arithmetic no longer let it do.
 */
const plateWidth = (word: string): number => plateSize(word, WIDEST_STYLE).width;

/** The renderer's own answer. */
const rockSizePx = (letters: number): number => asteroidSizePx(letters);

/** Every word a belt can put on the board, in any shipped pool. */
const everyWord = (): readonly string[] => {
  const out = new Set<string>();
  for (const stop of STOP_IDS) for (const word of stagePoolFor(stop)) out.add(word);
  return [...out];
};

const longestWord = (): number => {
  let longest = 1;
  for (const word of everyWord()) longest = Math.max(longest, [...word].length);
  return longest;
};

/**
 * How far past the spawn margin a plate's own edge reaches, over every word
 * that can be on a belt.
 *
 * `keepOutHalfWidth` is `FlightScene.laneSpec`'s rule, restated: the spawn
 * column is held that far inside the margin, and the plate then sticks out by
 * `plateHalf - keepOut`. Under the shipped `max` rule that is never positive.
 * Under the old rock-only rule it reaches 45.3 px, which is the control below.
 *
 * Maximised over every WORD rather than evaluated at the longest one, because
 * the two terms pull against each other: a longer word makes the plate wider
 * AND the rock bigger, and since the plate started measuring its own glyphs the
 * widest word is not necessarily the longest.
 */
const overhangPx = (keepOutHalfWidth: (word: string) => number): number => {
  let worst = 0;
  for (const word of everyWord()) {
    worst = Math.max(worst, plateWidth(word) / 2 - keepOutHalfWidth(word));
  }
  return worst;
};

/** The shipped rule: whichever of the rock and its plate is wider. */
const shippedKeepOut = (word: string): number =>
  Math.max(rockSizePx([...word].length) / 2, plateWidth(word) / 2);

/** The rule that shipped the defect: the rock alone. */
const rockOnlyKeepOut = (word: string): number => rockSizePx([...word].length) / 2;

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
    // 60 PX BECAME 48.14 PX, AND NOTHING ABOUT THE HUD MOVED.
    //
    // This file's header measured the old rule at "60 px a side at spinning",
    // when a plate was `letters * 23.6 + 28` wide at D41 spacing - one 0.62-em
    // cell per character. The plate now sums its glyphs' real advances, and
    // lowercase Latin averages about 0.51 em on the faces this stack resolves
    // to, so every plate is roughly a fifth narrower and the same rock-only
    // rule leaves 48.14 px of plate outside the keep-out instead of 60.4, on
    // "enormous" - which is the widest plate in any shipped pool now that width
    // is a function of the word rather than of its letter count.
    //
    // The floor is 40 because that is below the measurement and above nothing
    // - it is not "whatever passes". What it asserts is unchanged: the rule
    // that shipped lets TENS of px of a word out past the spawn margin.
    expect(
      reach,
      `the rock-only keep-out leaves ${reach.toFixed(2)} px of plate past the margin`,
    ).toBeGreaterThan(40);

    // AND THE HALF OF THIS CONTROL THAT NO LONGER FIRES, SAID OUT LOUD.
    //
    // It used to assert that the leftmost such plate reached UNDER the HUD's
    // left readout. It did, by four tenths of a pixel, on a plate 60.4 px past
    // the margin. At 48.14 px it reaches x=271.86 and the readout ends at
    // x=260, so the two now MISS by 11.86 px and `intrudesOnWordPlates` returns
    // false. Narrower plates bought that clearance; nothing was fixed.
    //
    // Asserting the clearance rather than the collision keeps the control
    // bound: if a pool gains a wider word, a face with wider metrics draws, or
    // the HUD grows rightwards, this goes red long before a letter is covered.
    const rockOnlySpan = wordPlateSpan(DESIGN_WIDTH, reach);
    const left = hudRects(DESIGN_WIDTH)[0];
    expect(left).toBeDefined();
    const readoutRight = (left?.x ?? 0) + (left?.w ?? 0);
    const clearance = rockOnlySpan.left - readoutRight;
    expect(
      clearance,
      `under the rock-only rule a plate reaches x=${rockOnlySpan.left.toFixed(2)} and the HUD readout ends at x=${readoutRight}`,
    ).toBeCloseTo(11.86, 1);

    // The mechanism still fires - a readout only 12 px wider would be covered.
    const widerReadout = {
      x: left?.x ?? 0,
      y: left?.y ?? 0,
      w: (left?.w ?? 0) + 12,
      h: left?.h ?? 0,
    };
    expect(intrudesOnWordPlates(widerReadout, rockOnlySpan)).toBe(true);
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
