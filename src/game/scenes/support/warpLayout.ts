import { GAME_HEIGHT, GAME_WIDTH } from "@game/sceneKeys";
import { GUTTER, contentRight } from "@game/ui/grid";
import type { Rect } from "@game/ui/layout";

/**
 * THE WARP BREAK'S GEOMETRY (screen 8), as numbers rather than as literals
 * inside a Phaser scene.
 *
 * ================== WHY IT MOVED OUT OF `WarpScene.ts` ==================
 * The scene imports Phaser, so nothing in it can be asserted without a browser,
 * and the defect this module exists to prevent is PURELY a question of
 * rectangles:
 *
 *   the Lantern was drawn at (1660, 470) at 300 px tall, and the sentence panel
 *   was `{ x: 160, y: 286, w: 1600, h: 250 }`.
 *
 * Those two rectangles overlap by about 240 x 175 px, the panel is on the HUD
 * layer (depth 7) and the ship is on `shipFx` (depth 6), so the hero asset was
 * drawn BEHIND the card on the screen a player sees seven times a playthrough.
 * Only the nose and the fin tips came out past the panel's right edge. It read
 * as a z-order accident, which is exactly what it was.
 *
 * The fix is not a depth change - a ship drawn OVER the sentence would cover
 * the destination line and the composed-sentence mark, which live in the
 * panel's top-right corner - it is a BAY: the three stacked cards give up the
 * right ~380 px of the frame and the Lantern stands in it, unoccluded, at full
 * size. `tests/unit/scenes/warpLayout.test.ts` asserts the rectangles are
 * disjoint, so a future width change cannot quietly re-cover it.
 *
 * Everything here is pure: no Phaser, no DOM, numbers in and numbers out.
 */

// ---------------------------------------------------------------------------
// The cards
// ---------------------------------------------------------------------------

/**
 * The three stacked cards. `COACH`'s numbers are AC-33's contract: the coach
 * area is laid out BEFORE the note arrives and does not change when it does, so
 * the live and fallback screens are byte-identical. Changing the WIDTH here
 * changes both of them together, which is what AC-33 asks for; what it forbids
 * is the layout reacting to what the transport returned.
 *
 * WIDTH 1464 AND NOT 1600. What the cards gave up on the right is the
 * Lantern's bay; what they gained on the left is the 64 px between the old
 * x=160 and the product's gutter at 96 (`ui/grid.ts`).
 *
 * HEIGHT 288 AND NOT 250, for the same reason and in the other direction. A
 * narrower card wraps sooner, and the sentence is not always the stop's shipped
 * one: a composed sentence (D09/E-AI-1) can be longer than anything in
 * `src/content`. At 250 the hint sat at `PANEL.h - 44` = 206, and a second line
 * of 52 px type starting at 146 reaches 214 - the hint would have been printed
 * through. 288 fits two lines with 30 px to spare, which `warpLayout.test.ts`
 * asserts directly rather than trusting the longest string anybody has counted.
 */
/**
 * The cards start on the product's gutter (`ui/grid.GUTTER`) - they were at
 * x=160, which no menu screen shared - and stop short of the Lantern's bay.
 */
const CARD_W = 1464;
export const PANEL: Rect = { x: GUTTER, y: 286, w: CARD_W, h: 288 };
export const METER: Rect = { x: GUTTER, y: 650, w: CARD_W, h: 30 };
export const COACH: Rect = { x: GUTTER, y: 742, w: CARD_W, h: 236 };

// ---------------------------------------------------------------------------
// The Lantern
// ---------------------------------------------------------------------------

/**
 * The ship's drawn footprint, in `render/lantern.ts`'s own design units.
 *
 * DUPLICATED ON PURPOSE, AND GUARDED. `lantern.ts` keeps these as module-local
 * constants and imports Phaser, so they can be neither imported here nor loaded
 * in a node unit test. `warpLayout.test.ts` therefore PARSES them back out of
 * `render/lantern.ts` and compares: redraw the ship taller and the numbers stop
 * matching and the suite goes red, rather than the bay silently becoming too
 * small.
 *
 *   ABOVE   beam head (`PIVOT.y + LENS_LOCAL.y - LENS_R` = -247) to the origin
 *   BELOW   the origin to the nozzle bell (`NOZZLE_BOTTOM` = 178)
 *   PLUME   the solid exhaust cone (`NOZZLE_BOTTOM + 152` = 330)
 *   HALF_W  the fin tips at +/-123, widened to the exhaust glow's +/-125
 */
export const SHIP_ABOVE = 247;
export const SHIP_BELOW = 178;
export const SHIP_PLUME = 330;
export const SHIP_HALF_W = 125;

/** Where the Lantern stands, and how tall it is drawn. */
export const LANTERN = { x: 1720, y: 470, height: 300 } as const;

/**
 * The rectangle the ship's BODY occupies: beam head to nozzle bell.
 *
 * This is the box that must be clear of every card. The exhaust plume is
 * separately available as `lanternPlumeBox` because it is a soft additive cone
 * rather than a silhouette - a few pixels of it behind a card edge is not the
 * defect; the fuselage behind a card is.
 */
export function lanternBox(
  at: { readonly x: number; readonly y: number; readonly height: number } = LANTERN,
): Rect {
  const s = at.height / (SHIP_ABOVE + SHIP_BELOW);
  return {
    x: at.x - SHIP_HALF_W * s,
    y: at.y - SHIP_ABOVE * s,
    w: SHIP_HALF_W * 2 * s,
    h: (SHIP_ABOVE + SHIP_BELOW) * s,
  };
}

/** The body plus the solid part of the exhaust cone. */
export function lanternPlumeBox(
  at: { readonly x: number; readonly y: number; readonly height: number } = LANTERN,
): Rect {
  const s = at.height / (SHIP_ABOVE + SHIP_BELOW);
  const box = lanternBox(at);
  return { ...box, h: (SHIP_ABOVE + SHIP_PLUME) * s };
}

/** Every card the ship has to stay out of. */
export const WARP_CARDS: readonly Rect[] = [PANEL, METER, COACH];

/**
 * The band the meter's two plated labels occupy.
 *
 * `WarpScene.buildMeter` draws "warp drive" and the percentage at
 * `METER.y - 52`, on `skyText` plates with 8 px of padding, so they reach
 * roughly 60 px above the track. They are not part of a card and nothing
 * measured them against one: growing `PANEL.h` to fit a second line of sentence
 * printed the sentence card's bottom border straight through both of them, and
 * the capture showed it. `warpLayout.test.ts` now asserts the gap.
 */
export const METER_LABEL_TOP = 60;

export function meterLabelBand(): Rect {
  return { x: METER.x, y: METER.y - METER_LABEL_TOP, w: METER.w, h: METER_LABEL_TOP };
}

/**
 * The frame the whole composition has to fit inside.
 *
 * Read at call time, never captured at module scope: `GAME_WIDTH` is a live
 * binding that `bootGame` sets once it has measured the window (sceneKeys.ts),
 * and a top-level `const` would freeze it at the artboard's 1920 forever.
 */
export function warpFrame(): Rect {
  return { x: 0, y: 0, w: GAME_WIDTH, h: GAME_HEIGHT };
}

// ---------------------------------------------------------------------------
// The completed-word pulse (UR-26)
// ---------------------------------------------------------------------------

/**
 * UR-26: A COMPLETED WORD EXPANDS SLIGHTLY AND SETTLES BACK, so the child can
 * see it has been typed out. Requested unprompted; the word "slightly" is the
 * specification.
 *
 * ================== WHY THE RULE IS HERE AND NOT IN THE SCENE ==================
 * Two halves, and both of them are arithmetic:
 *
 *   WHEN     given the sentence and the caret, has a word just been finished,
 *            and which characters were it. A boundary rule over a string.
 *   WHERE    given the letters' boxes and a scale, where each letter goes so
 *            that the word grows about ITS OWN CENTRE.
 *
 * Neither needs Phaser, and the defect this is written to avoid is purely a
 * question of rectangles - which is the same reason the rest of this file
 * exists. `warpWordPulse.test.ts` walks a whole sentence character by character
 * without booting a browser.
 *
 * ================== THE TRAP, WHICH IS THE WHOLE DESIGN ==================
 * The sentence is a LAID-OUT LINE. `WarpScene.layoutLetters` places one Text
 * per character at a fixed x, walking left to right, and those x values are
 * computed once at layout time and never recomputed. So the naive version of
 * this effect - grow the word's glyphs and let the line reflow - would shove
 * every word after it sideways, and the sentence would jitter under the eyes of
 * a child who is in the middle of reading and typing it. That is strictly worse
 * than no effect at all.
 *
 * The rule is therefore: THE GLYPHS MOVE, THE METRICS DO NOT.
 *
 *   - only the letters INSIDE the completed word are touched. Every other Text
 *     keeps the x it was laid out at, so nothing downstream can move, whatever
 *     the scale is. This is structural rather than tuned: there is no path
 *     through `pulsedPosition` that can reach a letter outside the range.
 *   - inside the word, each letter is moved to `centre + (origin - centre) * s`
 *     and scaled by `s`, which grows the word symmetrically about its own
 *     middle instead of shoving it to the right off a top-left origin (Phaser
 *     Text's default origin is (0, 0), so a bare `setScale` would do exactly
 *     that and squash the word into its own trailing space).
 *   - the scale returns to exactly 1 and the letters are restored from the
 *     ORIGINS CAPTURED AT PULSE START, not recomputed at s = 1, so a rounding
 *     residue cannot accumulate over the six or seven words of a sentence.
 */

/**
 * How far a finished word grows at the top of the pulse.
 *
 * SMALL ON PURPOSE. UR-26 asks for "slightly", and this fires once per word in a
 * sentence the child types straight through without pausing - seven times on
 * Mars' sentence - so anything that reads as a celebration is exhausting by the
 * third word. This is a CONFIRMATION: about a two-pixel grow on a 52 px word,
 * enough to catch the eye in motion and not enough to be a thing you look at.
 * Compare `WarpScene.askAgain`, which pops a single letter to 1.22 - that is a
 * correction, it happens rarely, and it is meant to be noticed.
 */
export const WORD_PULSE_SCALE = 1.07;

/**
 * Out, and then back, in milliseconds. The tween yoyos, so a word is at its own
 * size again `2 * WORD_PULSE_MS` after the keystroke that finished it.
 *
 * Under the median child's inter-keystroke interval (`DEFAULT_CALIBRATION.ikiMs`
 * is 350 ms) the whole pulse is over before the next letter lands, so two words
 * do not normally pulse at once - and if a fast typist makes them overlap, the
 * two letter sets are disjoint and the two tweens cannot fight.
 */
export const WORD_PULSE_MS = 120;

/**
 * What counts as part of a word here.
 *
 * Deliberately the same class `warpSentence.ts` uses for its blasted-word
 * highlights: letters, digits and the apostrophe. The apostrophe matters -
 * without it "don't" would pulse twice, once at "don" and once at "t", which
 * announces a word boundary that is not there. Punctuation and spaces are not
 * word characters, so "planet." pulses on the "t" and the full stop after it
 * finishes nothing.
 */
const PULSE_WORD_CHAR = /[\p{L}\p{N}']/u;

/**
 * The half-open [start, end) range of the word the caret has just FINISHED, or
 * null if it has not finished one.
 *
 * `index` is `WarpSentenceState.index`: the number of characters accepted so
 * far, i.e. the position of the next character to type. A word is complete when
 * the character just accepted is a word character and the one after it is not -
 * including "there is no character after it", which is how the last word of a
 * sentence with no closing punctuation is caught.
 *
 * Called once per accepted keystroke, this returns non-null EXACTLY once per
 * word: every other keystroke is either mid-word (the next character is a word
 * character) or on punctuation (the accepted character is not one).
 */
export function completedWordRange(
  text: string,
  index: number,
): readonly [number, number] | null {
  if (index <= 0 || index > text.length) return null;
  const accepted = text[index - 1];
  if (accepted === undefined || !PULSE_WORD_CHAR.test(accepted)) return null;
  const next = text[index];
  if (next !== undefined && PULSE_WORD_CHAR.test(next)) return null;
  let start = index - 1;
  while (start > 0) {
    const before = text[start - 1];
    if (before === undefined || !PULSE_WORD_CHAR.test(before)) break;
    start -= 1;
  }
  return [start, index] as const;
}

/** One letter's drawn box, at rest. Phaser Text origin is top-left. */
export interface PulseBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * The centre of a word, as the union of its letters' boxes.
 *
 * The union rather than "first letter's left to last letter's right" because
 * the letters of one word always share a line (`layoutLetters` wraps on word
 * boundaries, so a word never breaks) but nothing in this file needs to assume
 * that to be true.
 */
export function wordPulseCentre(boxes: readonly PulseBox[]): { x: number; y: number } {
  if (boxes.length === 0) return { x: 0, y: 0 };
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const b of boxes) {
    left = Math.min(left, b.x);
    top = Math.min(top, b.y);
    right = Math.max(right, b.x + b.w);
    bottom = Math.max(bottom, b.y + b.h);
  }
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

/**
 * Where a letter of a pulsing word is drawn at scale `s`.
 *
 * The letter keeps its offset from the word's centre, scaled - which is what
 * "grow about the centre" means for an object whose own origin is its top-left
 * corner. At `s === 1` this is the letter's resting position (to within
 * floating-point noise; the scene restores from the captured origins rather
 * than trusting that, see the header note).
 */
export function pulsedPosition(
  box: PulseBox,
  centre: { readonly x: number; readonly y: number },
  scale: number,
): { x: number; y: number } {
  return {
    x: centre.x + (box.x - centre.x) * scale,
    y: centre.y + (box.y - centre.y) * scale,
  };
}

/** `pulsedPosition` plus the scaled size, for measuring what the word covers. */
export function pulsedBox(
  box: PulseBox,
  centre: { readonly x: number; readonly y: number },
  scale: number,
): PulseBox {
  const at = pulsedPosition(box, centre, scale);
  return { x: at.x, y: at.y, w: box.w * scale, h: box.h * scale };
}

// ---------------------------------------------------------------------------
// Inside the sentence card
// ---------------------------------------------------------------------------

/** The sentence's type size and the step between its wrapped lines. */
export const SENTENCE_PX = 52;
export const SENTENCE_STEP = SENTENCE_PX + 16;

/** The band the sentence may occupy: under the destination line, above the hint. */
export const SENTENCE_BAND_TOP = 78;
export const SENTENCE_BAND_BOTTOM = 56;

/**
 * Where the first line of the sentence starts, CENTRED in its band.
 *
 * The card is a fixed 288 so that it does not change shape between stops - a
 * frame that resizes under the same heading reads as the screen reloading - but
 * a one-line sentence pinned to the top of a two-line card leaves 140 px of
 * hole under it, which is the "large dead space below their content" the player
 * reported on the stage report. So the card keeps its shape and the content is
 * distributed inside it, the same way `resultsLayout.fitPanel` centres a short
 * report in a floored panel.
 */
export function sentenceTop(lineCount: number): number {
  const band = PANEL.h - SENTENCE_BAND_TOP - SENTENCE_BAND_BOTTOM;
  const block = Math.max(1, lineCount) * SENTENCE_STEP - 16;
  return PANEL.y + SENTENCE_BAND_TOP + Math.max(0, Math.round((band - block) / 2));
}
