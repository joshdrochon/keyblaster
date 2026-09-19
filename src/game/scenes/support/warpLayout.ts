import { GAME_HEIGHT, GAME_WIDTH } from "@game/sceneKeys";
import { GUTTER, contentRight } from "@game/ui/grid";
import type { Rect } from "@game/ui/layout";
import {
  MARK,
  PLATE_RHYTHM,
  PLATE_STACK_GAP,
  PLATE_STEP,
  badgeBox,
  lineBox,
  plateHeight,
  stackRows,
} from "@game/ui/plateLayout";
import { TYPE } from "@game/ui/theme";

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

/**
 * ================== UR-70 CONDENSED THE COLUMN ==================
 * UR-70 asks for condensed vertical space with no excessive padding, against
 * a screen whose destination line was followed by a 70 px hole.
 *
 * That hole was not padding. `PANEL.h` was a fixed 280 sized for a TWO-LINE
 * sentence, and a one-line sentence was CENTRED in the band left under the
 * destination line - so half the slack went above the sentence. Measured at
 * Saturn, whose shipped sentence is one line: the destination line's ink ended
 * at y 291 and the sentence began at y 361. On a two-line stop the same gap was
 * 36. A label's distance from the thing it labels is not supposed to be a
 * function of how long the thing is.
 *
 * ================== WHAT IT IS NOW ==================
 * Three rows on the shared plate's `card` rhythm (`ui/plateLayout.ts`), TOP
 * ALIGNED, one step apart, with the hint following the sentence:
 *
 *   destination   one line of TYPE.label
 *   the sentence  the worst case, which is two lines
 *   the hint      one line of TYPE.caption
 *
 * `PANEL.h` is DERIVED from those rows - 265, where it was 280 picked by trying
 * 250 and finding the hint printed through. The gap under the destination line
 * is one step by construction and is the same at one line and at two.
 *
 * ================== THE SECOND PASS CONDENSED IT AGAIN ==================
 * The first pass moved the hole; it did not close it. Two changes, both on the
 * SHARED component rather than on this screen:
 *
 *   the `card` rhythm moved from the `unit` step (20) to the `glass` step (12)
 *   the hint stopped being pinned to the card's foot (`flowFooter`)
 *
 * MEASURED IN THE SERVED BUILD at Jupiter, ink to ink, in Latin (the rows are
 * sized on the Devanagari line box so Hindi does not collide, so the Latin gap
 * reads a few px wider than the step):
 *
 *                              shipped   pass 1   pass 2
 *   destination -> sentence     70.0      29.2     21.2
 *   sentence -> the hint          -       79.8     32.8
 *
 * And the column as a whole: 236..820 -> 236..808 -> 236..805, with its
 * clearance over the Lantern's band up from 17.6 px to 32.6 px.
 *
 * ================== WHY THE CARD STILL DOES NOT RESIZE ==================
 * It is sized for the WORST CASE rather than for the sentence it holds, and
 * that is load-bearing rather than conservative: `relayoutSentence` swaps the
 * shipped string for a composed one (D09/E-AI-1) while the screen is on
 * screen, and its own contract is "same plate, same meter, same coach area,
 * same geometry". A card that sized to its content would jump the moment the
 * coach landed, which is the thing AC-33 exists to forbid one card over.
 *
 * And the worst case is REACHABLE, not paranoia: the coach's gate caps a
 * composed sentence at 56 characters (`engine/coach/sentence.ts`) and this
 * card's 1648 px content box holds about 54 at the scene's own width estimate.
 *
 * THE COST, STATED. A one-line stop's slack has to go somewhere and it now goes
 * BELOW the hint: 68 px - exactly the reserved second line - between the hint
 * and the card's bottom padding, where it reads as a deep foot rather than as a
 * hole in the reading order. Closing that last 68 px means capping the sentence
 * to one line, which is a change to D09's fallback behaviour and not this
 * lane's to make; it is in gauntlet/escalations.md with a lean.
 * `warpLayout.test.ts` asserts the number so it cannot grow quietly.
 */
const PANEL_Y = 236;

/**
 * The sentence's type size and the step between its wrapped lines.
 *
 * `TYPE.sentence`, not the literal 52 it used to be. It is the same number -
 * the scale was extended to name the sizes the world screens were already
 * drawing at - and naming it is what puts the line a child TYPES on the same
 * list as everything else, where `nearMissEdges.test.ts` checks it.
 *
 * THE LEADING IS STILL 16 AND IS STILL NOT ON `STEP`. Named, not fixed.
 * The scale's neighbours are 12 and 20. Rounding DOWN is the wrong direction -
 * at 52 px type Devanagari's measured line box is 81 px (`theme.LINE_HEIGHT`),
 * so 68 is already tighter than a Hindi line wants and 64 is worse. Rounding UP
 * to 72 is the safe direction and it moves the card's derived height, which
 * three of `warpLayout.test.ts`'s UR-70 cases pin to the pixel - the hole
 * between "destination: saturn" and the sentence is what those numbers exist to
 * hold. Changing them to buy one number off the scale, in a lane whose subject
 * is LEFT edges, is not a trade worth making tonight. It is in
 * gauntlet/escalations.md.
 */
export const SENTENCE_PX = TYPE.sentence;
export const SENTENCE_LEADING = 16;
export const SENTENCE_STEP = SENTENCE_PX + SENTENCE_LEADING;

/**
 * The most lines the card is built to hold.
 *
 * TWO, and it is the number the card's height is derived from. A composed
 * sentence (D09) can be longer than any shipped one, so this is the case the
 * card must survive rather than the case it usually draws.
 */
export const SENTENCE_MAX_LINES = 2;

/**
 * The sentence block at its worst case: two lines.
 *
 * THE LAST LINE IS A `lineBox`, NOT A STEP (UR-70). It used to be
 * `2 * SENTENCE_STEP - SENTENCE_LEADING` = 120, which is two 52 px steps with
 * the trailing leading taken back off - and 120 is smaller than two lines of
 * 52 px type actually are. Measured in Chromium, one line of 52 px Latin ink is
 * 60.2 px tall, so a two-line sentence's ink ran 8 px past the block it was
 * laid out in and the only thing keeping it off the hint was the 20 px the rows
 * used to be apart. Condensing the rhythm to 12 would have cut that clearance
 * to 3.8 px: the old under-reservation was invisible until the padding it was
 * hiding behind went away.
 *
 * So the block is now the steps BETWEEN the lines plus one real line box - and
 * the line box is the Devanagari one (rule 5), which is the tallest of the
 * three languages this ships in. 68 + 81 = 149.
 */
const SENTENCE_BLOCK =
  (SENTENCE_MAX_LINES - 1) * SENTENCE_STEP + lineBox(SENTENCE_PX);

/**
 * The card's rows, in order, as the heights the rhythm lays out.
 *
 * THE CAPTION ROW IS GONE, and with it the card's third row. It held the
 * keyboard hint, which now sits on the product's hint line at the bottom left
 * like the other eight screens' - see the note below `sentenceRow`. Removing the
 * row shortens the card by that line plus one card gap, which moves the
 * instrument and the coach card UP by the same amount and therefore only
 * increases their clearance from the Lantern's band.
 */
const PANEL_ROWS: readonly number[] = [
  lineBox(TYPE.label),
  SENTENCE_BLOCK,
];

export const PANEL: Rect = {
  x: GUTTER,
  y: PANEL_Y,
  w: CARD_W,
  h: plateHeight(PANEL_ROWS, "card"),
};

/** The destination line's row: "destination: saturn", at the card's top. */
export function destinationRow(): Rect {
  return stackRows(PANEL, PANEL_ROWS, "card")[0] as Rect;
}

/** The band the sentence is laid out in, one unit under the destination line. */
export function sentenceRow(): Rect {
  return stackRows(PANEL, PANEL_ROWS, "card")[1] as Rect;
}

/**
 * THE KEYBOARD HINT LEFT THIS CARD (the control-placement sweep).
 *
 * ================== WHAT IT WAS ==================
 * `hintRow(lines)` put "type the sentence..." one step under the sentence that
 * was actually on screen, inside the card, and `PANEL_ROWS` reserved a caption
 * row at the card's foot for it. UR-70 argued that placement and the argument
 * was a good one: the instruction sat beside the thing it instructed, and the
 * hole the fixed foot left on a one-line stop (79.8 px at Jupiter, measured ink
 * to ink) closed.
 *
 * ================== WHY IT MOVED ANYWAY ==================
 * The Warp break is declared `placement: "grid"` in `ui/hint.ts`, and it was
 * the only screen of the nine so declared that had nothing on the grid line at
 * all - the owner's sweep of the served build read the hint's position on seven
 * screens and "ABSENT" here. A contract that nine screens are measured against
 * cannot have one screen quietly meaning something else by it, which is the
 * whole defect that sweep was opened for. So the line is drawn by
 * `ui/hintLine.drawHint` at (96, 1004) like every other screen's, the card
 * gives back the row it reserved, and UR-70's proximity argument is traded for
 * the product-wide one. Logged with the numbers in `gauntlet/escalations.md`.
 *
 * What survives of UR-70 here is the part about the HOLE: there is no reserved
 * empty row at the card's foot any more, on a one-line stop or a two-line one.
 */

/**
 * The destination's badge: a square in the card's TOP RIGHT (UR-70).
 *
 * `plateLayout.badgeBox` is the shared geometry and this is the warp break
 * naming its size; the planet in it is drawn by `render/planetBadge.ts`. Inside
 * the card's own padding, so it can collide with neither the rim nor a bracket
 * arm, and on the destination line's row, because it is a picture of the word
 * that row ends with.
 */
export function badgeRow(): Rect {
  return badgeBox(PANEL, MARK.badge, "card");
}

/**
 * Where the first line of the sentence starts.
 *
 * NO LONGER A FUNCTION OF THE LINE COUNT, which is the fix. It used to centre
 * the block in a fixed band; see the note above `PANEL`.
 */
export function sentenceTop(): number {
  return sentenceRow().y;
}

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
/**
 * The instrument's three rows, on the shared plate's `instrument` rhythm - a
 * dense readout cluster, 12 px inset and 8 px between rows, which is TIGHTER
 * than a card by design. Air between the rows of one instrument is exactly what
 * made the warp drive read as three pieces (UR-62).
 *
 * The height is derived from them: 124, which is the number this instrument was
 * already drawn at. What UR-70 moved is the two leftover insets it was built
 * with - a 20 px top pad over a 6 px bottom one - onto the scale's 12.
 */
const INSTRUMENT_ROWS: readonly number[] = [
  /** "warp drive" and the percentage, one baseline. */
  32,
  /** The charge track. */
  26,
  /** "warp drive charged - next stop Jupiter". */
  26,
];

export const INSTRUMENT: Rect = {
  x: GUTTER,
  y: PANEL.y + PANEL.h + PLATE_STACK_GAP,
  w: CARD_W,
  h: plateHeight(INSTRUMENT_ROWS, "instrument"),
};

/** The charge track, INSET INSIDE the instrument. Not a card of its own. */
export const INSTRUMENT_INSET = PLATE_RHYTHM.instrument.padX;
export const METER: Rect = stackRows(INSTRUMENT, INSTRUMENT_ROWS, "instrument")[1] as Rect;

/** Ink-to-ink air between the charge label and its bolt (UR-78). */
export const BOLT_GAP_PX = 5;

/**
 * The charge bolt's box, set beside the words rather than inside the track
 * (UR-78, revising UR-70), and BEFORE them rather than after (this pass).
 *
 * ================== WHICH SIDE, AND WHY IT CHANGED ==================
 * UR-78 put the mark five pixels PAST the label. The project owner asked for it
 * five pixels before. The reading is better and the reason is the one UR-78
 * already wrote down for itself: the mark is "the left end of the line whose
 * right end is the number". Past the words it was not the left end of anything
 * - it sat between "warp drive" and 1500 px of empty track, with the percentage
 * far away on the right. Before the words it opens the line.
 *
 * THE GAP AND THE CENTRING ARE UNTOUCHED. `BOLT_GAP_PX` is the same 5 px of
 * ink-to-ink air and the box is still centred on the label's own middle; the
 * only thing that changed is the sign.
 *
 * AND NOTHING ELSE MOVED. The label's left edge is `INSTRUMENT.x` plus the
 * instrument rhythm's `padX`, which is `STEP.pad` - a grid line this screen
 * shares with the rest of the game, and `left-edge-conformance.spec.ts` is what
 * holds it. The bolt reaches 22 px left of the label to x 118, which is still
 * 22 px inside the instrument's own border, so the mark fits in the padding
 * that was already there and the words stay where they are.
 *
 * UR-70 put the mark in the track's left cap on the reasoning that a bolt is a
 * label for the bar's zero. That reasoning cost more than it bought: inside the
 * track the mark is behind the fill, so it had to be drawn twice - accent under
 * the fill, sunken ink over it - to stay legible on an empty bar and a charged
 * one, and at no charge level was it the same colour as the percentage it is
 * measuring with.
 *
 * Beside the label it is never overdrawn, so it is one drawing in one colour,
 * and it reads as what it is: the left end of the line whose right end is the
 * number.
 *
 * TAKES THE LABEL'S MEASURED BOUNDS rather than computing where the text ends.
 * "warp drive" is a translated string at a themed type size; the only honest
 * source for its right edge is the object that drew it. Vertically CENTRED on
 * that same box, so the mark shares the line's middle at any type size instead
 * of sharing a baseline the glyph does not sit on.
 */
export function boltBesideLabel(label: Rect): Rect {
  return {
    x: label.x - BOLT_GAP_PX - MARK.bolt.w,
    y: label.y + label.h / 2 - MARK.bolt.h / 2,
    w: MARK.bolt.w,
    h: MARK.bolt.h,
  };
}

// ---------------------------------------------------------------------------
// The coach card, and the figure it has to hold
// ---------------------------------------------------------------------------

/**
 * SHADOW'S DRAWN FOOTPRINT, in `render/shadow.ts`'s own design units.
 *
 * ================== THE DEFECT ==================
 * The card was `h: 140`, a literal, and the note beside it reasoned that
 * "`SHADOW_HEIGHT` is 2.9 body radii, i.e. 186 design units, so 0.66 draws
 * 123 px inside a 140 px card". Both halves of that are wrong, and the second
 * is wrong because the first is.
 *
 * MEASURED IN THE SERVED BUILD, by differencing two screenshots of the same
 * frame with the figure switched off (`__kb.warp.setShadowVisible`), because a
 * Phaser `Graphics` has no bounds and `shadow.root.getBounds()` comes back as a
 * zero-sized rect at the origin:
 *
 *   Shadow, drawn      y 613..760     147 px tall
 *   the coach card     y 622..762     140 px, inner box 634..750 = 116 px
 *
 * So he is 31 px taller than the box he is laid out in, he crosses the card's
 * top edge by 9 px into the sky above it, and he stops 2 px short of the bottom
 * edge. That is the crowding the project owner reported.
 *
 * ================== WHY `SHADOW_HEIGHT` UNDER-READS ==================
 * `render/shadow.SHADOW_HEIGHT` is declared as "full drawn height (hover shadow
 * to antenna tip)" and is 2.9 radii. The drawing is 3.42:
 *
 *   ABOVE  the antenna's tip is at `sink*R - 1.46R` and its outer glow circle
 *          adds `0.36R`, so the figure starts 1.82R over the origin
 *   BELOW  the cast-shadow ellipse is centred at `R*(1 + sink) + 0.42R` and is
 *          `0.36R` tall, so it ends 1.60R under it
 *
 * 3.42 * 64 * 0.66 = 144.5 px, which is the 147 measured less two pixels of
 * additive glow either side. `SHADOW_HEIGHT` is therefore not the number to
 * derive a box from, and this lane may not fix it - `render/shadow.ts` imports
 * Phaser, so it can be neither imported here nor loaded in a node unit test,
 * and it is another lane's file besides.
 *
 * DUPLICATED ON PURPOSE, AND GUARDED, exactly like `SHIP_ABOVE` / `SHIP_BELOW`
 * above: `warpLayout.test.ts` PARSES the four coefficients back out of
 * `render/shadow.ts` and compares. Redraw the antenna longer or the hover
 * lower and the suite goes red, rather than the card quietly clipping him
 * again.
 */
export const SHADOW_R = 64;
/** Antenna tip (`-1.46R`) plus its outer glow circle (`0.36R`). */
export const SHADOW_ABOVE_R = 1.82;
/** Hover cast shadow: `+1.0R`, offset `+0.42R`, half of its `0.36R` height. */
export const SHADOW_BELOW_R = 1.6;

/**
 * The scale the warp break draws him at.
 *
 * Unchanged. The card is what moves: the figure is the right size for this
 * screen - he reads at a glance beside two lines of 30 px body copy - and
 * shrinking him to fit a box that was picked by hand would be solving it from
 * the wrong end, the same way UR-63 did not answer "the ship is behind a card"
 * by drawing a smaller ship.
 */
export const SHADOW_SCALE = 0.66;

/** How tall Shadow is actually drawn on this screen, in screen pixels. */
export function shadowDrawnHeight(): number {
  return (SHADOW_ABOVE_R + SHADOW_BELOW_R) * SHADOW_R * SHADOW_SCALE;
}

/**
 * How far the antenna's and the hover's additive glows bleed past the
 * arithmetic, each side.
 *
 * NOT a safety margin and not a guess: the screenshot difference put the drawn
 * figure at 147 px where `(1.82 + 1.60) * 64 * 0.66` is 144.47, and the
 * two-pixel skirt is the antialiased edge of a soft circle. A box sized to the
 * arithmetic alone would clip exactly that edge, which is the visible part of
 * the complaint.
 */
const SHADOW_GLOW_BLEED_PX = 2;

/**
 * The card's height, DERIVED from the figure it holds plus the shared card
 * rhythm's padding - never a literal again.
 */
const COACH_H =
  Math.ceil(shadowDrawnHeight() + SHADOW_GLOW_BLEED_PX * 2) +
  PLATE_RHYTHM.card.padY * 2;

export const COACH: Rect = {
  x: GUTTER,
  y: INSTRUMENT.y + INSTRUMENT.h + PLATE_STACK_GAP,
  w: CARD_W,
  h: COACH_H,
};

/**
 * Where Shadow's ORIGIN goes, so that his drawing is centred in the card's
 * inner box.
 *
 * NOT `COACH.y + COACH.h / 2`, which is what the scene used to pass and is the
 * other half of the same defect. His origin is his body's centre and his
 * drawing is not symmetric about it - 1.82 radii of antenna and glow above,
 * 1.60 radii of hover and cast shadow below - so centring the ORIGIN in the
 * card pushes the whole figure 0.11 radii too high. Measured, that is the 9 px
 * by which he came out over the card's top edge.
 */
export function shadowOrigin(): { x: number; y: number } {
  return {
    // His LEFT reach clears the card's padding, rather than his origin sitting
    // in the middle of the column - the drawing is not symmetric about it.
    x: COACH.x + PLATE_RHYTHM.card.padX + SHADOW_LEFT_R * SHADOW_R * SHADOW_SCALE,
    y:
      COACH.y +
      PLATE_RHYTHM.card.padY +
      SHADOW_GLOW_BLEED_PX +
      SHADOW_ABOVE_R * SHADOW_R * SHADOW_SCALE,
  };
}

/**
 * How far he reaches either side of his origin, in radii.
 *
 * NOT SYMMETRIC, and not the cast shadow's `2.3R` either, which is what the
 * first pass at this assumed. The same screenshot difference that measured his
 * height measured his width: he came out x 130..249 about an origin at 185, so
 * 55 px left and 64 px right at scale 0.66 - 1.32 and 1.52 radii. The right is
 * the pointing pose's spark cluster and the left is the swung arm; the cast
 * shadow, at 1.15 radii each way, is inside both.
 *
 * Measured rather than parsed out of `render/shadow.ts` like the vertical pair,
 * because the horizontal extent is a UNION OVER POSES - this screen draws him
 * `pointing` and then `cheering` when the warp fires - and six pose entries
 * reduced to two numbers by regex would be a transcription pretending to be a
 * derivation. What the numbers are load-bearing for is also much weaker: this
 * card is 1728 px wide, so the only thing they decide is that he does not sit
 * in the card's own padding and that the copy starts clear of him.
 */
export const SHADOW_LEFT_R = 1.32;
export const SHADOW_RIGHT_R = 1.52;

/**
 * The width of the column Shadow stands in, at the card's left: the rhythm's
 * padding, his drawing, and the rhythm's padding again.
 *
 * `COACH.x + 230` was the literal this replaces, and `COACH.w - 290` was the
 * wrap width that had to agree with it by hand.
 */
export const SHADOW_COLUMN_W =
  PLATE_RHYTHM.card.padX * 2 +
  Math.ceil((SHADOW_LEFT_R + SHADOW_RIGHT_R) * SHADOW_R * SHADOW_SCALE);

/**
 * The two rows of copy beside him: the speaker label, then the note.
 *
 * The note is TWO LINES of `TYPE.body` and always has been - the longest
 * Spanish and Hindi fallback notes need both - and reserving them is the same
 * discipline the sentence card's second line is under (AC-33): the coach area
 * is laid out before the note arrives and must not move when it does.
 */
export function coachRows(bodyPx: number, captionPx: number): readonly Rect[] {
  const x = COACH.x + SHADOW_COLUMN_W;
  const w = COACH.w - SHADOW_COLUMN_W - PLATE_RHYTHM.card.padX;
  const rows = [lineBox(captionPx), lineBox(bodyPx, 2)];
  const h = rows.reduce((a, b) => a + b, 0) + PLATE_RHYTHM.card.gap;
  // Centred against the FIGURE rather than top-aligned in the card. The card is
  // now sized for him and he is the tallest thing in it, so copy pinned to the
  // inner top would leave the hole under it that UR-70 spent a whole pass
  // closing on the card above.
  let y = COACH.y + (COACH.h - h) / 2;
  return rows.map((rowH) => {
    const row: Rect = { x, y, w, h: rowH };
    y += rowH + PLATE_RHYTHM.card.gap;
    return row;
  });
}

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
export function instrumentLabelRow(): Rect {
  return stackRows(INSTRUMENT, INSTRUMENT_ROWS, "instrument")[0] as Rect;
}

/**
 * The line that appears under the track when the drive is full, inside the
 * instrument. It used to hang below the track on a pill of its own.
 */
export function instrumentChargedRow(): Rect {
  return stackRows(INSTRUMENT, INSTRUMENT_ROWS, "instrument")[2] as Rect;
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

