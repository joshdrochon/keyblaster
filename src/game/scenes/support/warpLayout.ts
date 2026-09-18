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
 * panel's top-right corner - it is a CLEAR BAND: the cards give up the bottom
 * of the frame and the Lantern stands in it, unoccluded.
 * `tests/unit/scenes/warpLayout.test.ts` asserts the rectangles are disjoint,
 * so a future height change cannot quietly re-cover it.
 *
 * The band was a bay on the RIGHT until UR-63, which is a different sentence
 * with the same shape and was wrong for a reason worth keeping written down:
 * the bay was only ever reached by a standalone boot, and the screen a child
 * gets is the overlay, where the ship is Flight's and stands at the bottom
 * centre. See `lanternStand`.
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
 * HEIGHT 280 AND NOT 250. A card wraps the sentence, and the sentence is not
 * always the stop's shipped one: a composed sentence (D09/E-AI-1) can be longer
 * than anything in `src/content`. At 250 the hint sat at `PANEL.h - 44` = 206,
 * and a second line of 52 px type starting at 146 reaches 214 - the hint would
 * have been printed through. 280 fits two lines with 22 px to spare, which
 * `warpLayout.test.ts` asserts directly rather than trusting the longest string
 * anybody has counted.
 *
 * ================== UR-63 MOVED THE WHOLE STACK UP ==================
 * The bottom of the frame is no longer the cards' to use. It belongs to the
 * ship - see `lanternStand` below - so every card ends above `SHIP_BAND_TOP`
 * and the column is laid out inside what is left. The old stack ran
 * 286..978, which put the coach card straight across the Lantern's fuselage.
 *
 * WIDTH IS NOW THE GUTTER-TO-GUTTER CONTENT WIDTH. It was 1464, which stopped
 * short of a bay on the right that the ship used to stand in. The ship does not
 * stand there any more, so the bay would have been 360 px of nothing beside
 * three cards; the column runs the full content width instead, like every other
 * screen's.
 */
const CARD_W = 1728;
export const PANEL: Rect = { x: GUTTER, y: 236, w: CARD_W, h: 280 };

/**
 * UR-62 - THE WARP DRIVE IS ONE INSTRUMENT, NOT THREE PIECES.
 *
 * ================== THE DEFECT ==================
 * The readout was assembled from three independently positioned objects: a
 * "warp drive" label pinned left on a pill of its own, a track spanning the
 * column 52 px below it, and a percentage on a THIRD pill floating above the
 * track's right end. Three plates, three edges, no shared box - nothing on
 * screen said they were one control, and because each was placed from its own
 * anchor they did not line up with each other either.
 *
 * ================== THE FIX IS A CONTAINING BOX ==================
 * `INSTRUMENT` is the instrument: one plate with one border. The label and the
 * readout are drawn INSIDE it, on one baseline (`instrumentLabelRow`), and the
 * track is inset inside the same box (`METER`). The pills are gone - text on a
 * panel the scene drew itself does not need a plate of its own, and `skyText`'s
 * `plated` / `plateFill` pair is how it stays measured for AC-22.8 anyway.
 *
 * The EASING IS UNTOUCHED (AC-22.5). `easeMeterTo` tweens `meterShown` and
 * `paintMeter` draws from it; this change moves the rectangle that is painted
 * and nothing about what drives it. `meterEaseFrames` still counts frames the
 * fill was redrawn mid-move, and still reads 0 for a bar that steps.
 */
export const INSTRUMENT: Rect = { x: GUTTER, y: 536, w: CARD_W, h: 124 };

/** The charge track, INSET INSIDE the instrument. Not a card of its own. */
export const INSTRUMENT_INSET = 32;
export const METER: Rect = {
  x: INSTRUMENT.x + INSTRUMENT_INSET,
  y: INSTRUMENT.y + 60,
  w: INSTRUMENT.w - INSTRUMENT_INSET * 2,
  h: 26,
};

export const COACH: Rect = { x: GUTTER, y: 680, w: CARD_W, h: 140 };

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

/**
 * The fin span in design units, i.e. `lantern.ts`'s own
 * `LANTERN_DESIGN_HALF_WIDTH`. Restated here for the same reason as the four
 * above and guarded the same way (`warpLayout.test.ts` compares it against
 * `render/lanternGeometry.FIN_TIP.x`), because it is the DIVISOR in the scale
 * below and a wrong one silently draws the warp break's ship at a different
 * size from the one the player has been flying.
 */
export const SHIP_DESIGN_HALF_W = 123;

// ---------------------------------------------------------------------------
// UR-63 - the ship is ON this screen
// ---------------------------------------------------------------------------

/**
 * WHERE THE LANTERN STANDS, AND WHY IT IS FLIGHT'S PLACE AND NOT A BAY.
 *
 * ================== THE DEFECT ==================
 * UR-63: the warp break showed a charge meter for a warp drive with no ship
 * under it, and the only part of the Lantern a player could see was a sliver of
 * exhaust at the very bottom edge of the frame.
 *
 * It was not that nothing drew a ship. It was that the screen the player
 * actually gets is the OVERLAY (D30, `overlay: true`): Flight launches this
 * scene over itself and keeps running, so the Lantern on screen is Flight's,
 * standing at (width/2, height - 150). The warp cards ran 286..978 across the
 * full column, and Flight's ship occupies y 838..997 - so the coach card was
 * drawn straight over the fuselage and only the nozzle and the plume came out
 * underneath it. The `LANTERN` constant that used to live here, at (1720, 470)
 * in a bay on the right, was only ever reached by a STANDALONE `?scene=Warp`
 * boot, which is to say by the e2e suite and never by a child. Every capture
 * therefore showed a ship no player had.
 *
 * ================== ONE SHIP, ONE PLACE, BOTH MODES ==================
 * So the bay is gone and the ship stands where Flight puts it, in both modes:
 * overlaid, that is Flight's own rig and this scene draws nothing; standalone,
 * this scene draws the same rig at the same point at the same scale. The two
 * modes now show the same picture, which is what makes a standalone capture
 * evidence about the game rather than about the harness.
 *
 * `SHIP_BAND_TOP` is the consequence: the cards may not come below it.
 *
 * ================== THE TWO RESTATED FLIGHT NUMBERS ==================
 * `FlightScene.ts` imports Phaser and belongs to another lane, so its ship
 * placement can be neither imported here nor loaded in a node test. Both
 * numbers are therefore restated and `warpLayout.test.ts` PARSES THEM BACK OUT
 * of `FlightScene.ts` and compares - move the ship there and the suite goes red
 * rather than the warp cards silently re-covering it.
 */
export const FLIGHT_SHIP_HALF_WIDTH_PX = 46;
export const FLIGHT_SHIP_BOTTOM_GAP = 150;

/**
 * The scale Flight draws the rig at, derived exactly as Flight derives it:
 * `SHIP_HALF_WIDTH_PX / LANTERN_DESIGN_HALF_WIDTH`. Never a literal - see the
 * note on `SHIP_DESIGN_HALF_W`.
 */
export const SHIP_SCALE = FLIGHT_SHIP_HALF_WIDTH_PX / SHIP_DESIGN_HALF_W;

/**
 * Where the Lantern stands, and how tall it is drawn.
 *
 * A FUNCTION, NOT A CONST. `GAME_WIDTH` and `GAME_HEIGHT` are live bindings
 * that `bootGame` sets once it has measured the window (`sceneKeys.ts`), and a
 * top-level object literal would freeze the ship at the artboard's 1920x1080
 * for ever - which is the same bug as the frame note on `warpFrame` below.
 */
export function lanternStand(): { x: number; y: number; height: number } {
  return {
    x: GAME_WIDTH / 2,
    y: GAME_HEIGHT - FLIGHT_SHIP_BOTTOM_GAP,
    height: (SHIP_ABOVE + SHIP_BELOW) * SHIP_SCALE,
  };
}

/**
 * The top of the band the ship owns. No card may reach it.
 *
 * Derived from the stand rather than picked, so moving the ship moves the floor
 * the cards are laid out against instead of quietly re-covering it.
 */
export function shipBandTop(): number {
  return lanternStand().y - SHIP_ABOVE * SHIP_SCALE;
}

/**
 * The rectangle the ship's BODY occupies: beam head to nozzle bell.
 *
 * This is the box that must be clear of every card. The exhaust plume is
 * separately available as `lanternPlumeBox` because it is a soft additive cone
 * rather than a silhouette - a few pixels of it behind a card edge is not the
 * defect; the fuselage behind a card is.
 */
export function lanternBox(
  at: { readonly x: number; readonly y: number; readonly height: number } = lanternStand(),
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
  at: { readonly x: number; readonly y: number; readonly height: number } = lanternStand(),
): Rect {
  const s = at.height / (SHIP_ABOVE + SHIP_BELOW);
  const box = lanternBox(at);
  return { ...box, h: (SHIP_ABOVE + SHIP_PLUME) * s };
}

/**
 * Every card the ship has to stay out of.
 *
 * `METER` IS DELIBERATELY NOT IN THIS LIST ANY MORE. It used to be a card in
 * its own right; it is now a rectangle INSIDE `INSTRUMENT` (UR-62), so listing
 * both would assert the same clearance twice and, worse, would let a future
 * edit that took the track outside its own instrument still pass.
 * `instrumentContains` is the check that replaces it.
 */
export const WARP_CARDS: readonly Rect[] = [PANEL, INSTRUMENT, COACH];

/**
 * The row the instrument's label and readout share, INSIDE the instrument.
 *
 * ONE ROW AND ONE BASELINE is the whole of UR-62's ask: "warp drive" on the
 * left and the percentage on the right are two ends of one line, not two
 * objects that happen to be near each other. They were 52 px above the track on
 * separate pills at separate baselines, anchored from opposite sides, and read
 * as three pieces because that is what they were.
 */
export const INSTRUMENT_LABEL_TOP = 20;
export const INSTRUMENT_LABEL_H = 32;

export function instrumentLabelRow(): Rect {
  return {
    x: METER.x,
    y: INSTRUMENT.y + INSTRUMENT_LABEL_TOP,
    w: METER.w,
    h: INSTRUMENT_LABEL_H,
  };
}

/**
 * The line that appears under the track when the drive is full, inside the
 * instrument. It used to hang below the track on a pill of its own.
 */
export const INSTRUMENT_CHARGED_TOP = 92;

export function instrumentChargedRow(): Rect {
  return {
    x: METER.x,
    y: INSTRUMENT.y + INSTRUMENT_CHARGED_TOP,
    w: METER.w,
    h: 26,
  };
}

/** True when `inner` is wholly inside the instrument's plate. */
export function instrumentContains(inner: Rect): boolean {
  return (
    inner.x >= INSTRUMENT.x &&
    inner.y >= INSTRUMENT.y &&
    inner.x + inner.w <= INSTRUMENT.x + INSTRUMENT.w &&
    inner.y + inner.h <= INSTRUMENT.y + INSTRUMENT.h
  );
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
