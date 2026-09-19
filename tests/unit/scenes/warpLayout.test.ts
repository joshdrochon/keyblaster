import { describe, expect, it } from "vitest";
import * as LANTERN_GEOMETRY from "@game/render/lanternGeometry";
import { rectsOverlap, type Rect } from "@game/ui/layout";
import { GAME_HEIGHT, GAME_WIDTH } from "@game/sceneKeys";
import { readFileSync } from "node:fs";
import {
  COACH,
  FLIGHT_SHIP_BOTTOM_GAP,
  FLIGHT_SHIP_HALF_WIDTH_PX,
  INSTRUMENT,
  METER,
  PANEL,
  SHIP_ABOVE,
  SHIP_BELOW,
  SHIP_DESIGN_HALF_W,
  SENTENCE_MAX_LINES,
  SENTENCE_PX,
  SENTENCE_STEP,
  SHIP_HALF_W,
  WARP_CARDS,
  badgeRow,
  BOLT_GAP_PX,
  boltBesideLabel,
  chargeLabelX,
  coachRows,
  destinationRow,
  sentenceRow,
  shadowDrawnHeight,
  shadowOrigin,
  SHADOW_ABOVE_R,
  SHADOW_BELOW_R,
  SHADOW_COLUMN_W,
  SHADOW_LEFT_R,
  SHADOW_RIGHT_R,
  SHADOW_R,
  SHADOW_SCALE,
  instrumentChargedRow,
  instrumentContains,
  instrumentLabelRow,
  lanternBox,
  lanternStand,
  lanternPlumeBox,
  shipBandTop,
} from "@game/scenes/support/warpLayout";
import * as warpLayout from "@game/scenes/support/warpLayout";
import {
  MARK,
  PLATE_RHYTHM,
  PLATE_STACK_GAP,
  lineBox,
  plateContent,
  plateFooter,
  plateHeight,
} from "@game/ui/plateLayout";
import { STEP, TYPE } from "@game/ui/theme";
import { EDGE_TOLERANCE, legalLefts, offGrid } from "@game/ui/alignment";

/**
 * THE LANTERN IS NOT BEHIND THE WARP CARD.
 *
 * ================== THE DEFECT ==================
 * `warp.png`: the Lantern was drawn at (1660, 470), 300 px tall, so its body
 * filled x 1573..1747, y 296..596. The sentence panel was 1600 px wide from
 * x=160, i.e. x 160..1760, y 286..536 - and it is on the HUD layer while the
 * ship is on `shipFx`, one depth below. The hero asset was therefore covered by
 * a card on the screen the player sees at every stage transition, seven times a
 * playthrough, with only the nose and the fin tips protruding at the right.
 *
 * ================== WHY A GEOMETRY ASSERTION ==================
 * A depth assertion would not have caught it: the depths were always correct
 * and the layout was the bug. A screenshot comparison would have caught it and
 * then gone stale the first time the sky changed. What is actually being
 * claimed is that two rectangles do not intersect, so that is what is measured.
 *
 * Watch it fail: set `LANTERN.x` back to 1660 or `PANEL.w` back to 1600 in
 * `src/game/scenes/support/warpLayout.ts` and the first case goes red.
 *
 *   npx vitest run tests/unit/scenes/warpLayout.test.ts --coverage.enabled=false
 */

/**
 * The ship's real dimensions, IMPORTED FROM THE MODULE THAT DECLARES THEM.
 *
 * They used to be parsed out of `render/lantern.ts` with five regexes, because
 * that module pulls in Phaser, which touches `window` at import time and cannot
 * be loaded in the node environment these unit tests run in. Transcribing them
 * was not an option either - a transcription is exactly what this check exists
 * to catch.
 *
 * UR-53 put a Lantern on the Director map and had to prove it fits in the gap
 * between the header block and a beacon lamp, which is the same question asked
 * of a different frame. So the design-unit geometry moved to
 * `render/lanternGeometry.ts`, which imports nothing, and `lantern.ts` imports
 * and re-exports it. Both screens and this test now read ONE declaration, which
 * is strictly stronger than parsing it: there is no longer a second copy for
 * `warpLayout` to drift from, and a rename fails the typechecker instead of
 * throwing here at import time.
 */
const NOZZLE_BOTTOM = LANTERN_GEOMETRY.NOZZLE_BOTTOM;
const PIVOT_Y = LANTERN_GEOMETRY.PIVOT.y;
const LENS_LOCAL_Y = LANTERN_GEOMETRY.LENS_LOCAL.y;
const LENS_R = LANTERN_GEOMETRY.LENS_R;
const FIN_TIP_X = LANTERN_GEOMETRY.FIN_TIP.x;

const right = (r: Rect): number => r.x + r.w;
const bottom = (r: Rect): number => r.y + r.h;

const describeRect = (r: Rect): string =>
  `x ${Math.round(r.x)}..${Math.round(right(r))}, y ${Math.round(r.y)}..${Math.round(bottom(r))}`;

describe("the warp break's hero asset is visible", () => {
  it("the Lantern's body does not intersect any card", () => {
    const ship = lanternBox();
    for (const card of WARP_CARDS) {
      expect(
        rectsOverlap(ship, card),
        `ship (${describeRect(ship)}) overlaps card (${describeRect(card)})`,
      ).toBe(false);
    }
  });

  it("NEGATIVE CONTROL: the shipped geometry is red", () => {
    // Exactly what `warp.png` was captured from. If this ever stops overlapping
    // the panel, the numbers below have drifted and the case above is measuring
    // something other than the defect it was written for.
    const shipped = lanternBox({ x: 1660, y: 470, height: 300 });
    const shippedPanel: Rect = { x: 160, y: 286, w: 1600, h: 250 };
    expect(rectsOverlap(shipped, shippedPanel)).toBe(true);
  });

  it("UR-63 NEGATIVE CONTROL: the coach card as it shipped covered the ship", () => {
    // THE DEFECT ITSELF, not a restatement of it. The screen a child gets is
    // the overlay (D30), where the ship is Flight's and stands at the bottom
    // centre - and the coach card shipped at y 742..978 across the full column,
    // straight over the fuselage. Only the nozzle and the plume came out
    // underneath, which is exactly what UR-63 reported seeing.
    //
    // Watched failing: with `COACH.y` back at 742 and `COACH.h` at 236, the
    // first case in this block reports
    //   ship (x 913..1007, y 838..997) overlaps card (x 96..1560, y 742..978)
    const shippedCoach: Rect = { x: 96, y: 742, w: 1464, h: 236 };
    expect(rectsOverlap(lanternBox(), shippedCoach)).toBe(true);
    // And the fix is not "the ship moved": it stands where Flight stands it.
    expect(rectsOverlap(lanternBox(), COACH)).toBe(false);
  });

  it("UR-63: the ship stands where FLIGHT stands it", () => {
    // The two numbers `warpLayout` restates are PARSED BACK OUT of the scene
    // that owns them. Move the ship in `FlightScene.ts` and this goes red,
    // rather than the warp cards silently re-covering it.
    const flight = readFileSync("src/game/scenes/FlightScene.ts", "utf8");
    const halfWidth = /const SHIP_HALF_WIDTH_PX = (\d+);/.exec(flight);
    const shipY = /const shipY = height - (\d+);/.exec(flight);
    expect(halfWidth?.[1], "SHIP_HALF_WIDTH_PX not found in FlightScene.ts").toBeDefined();
    expect(shipY?.[1], "shipY not found in FlightScene.ts").toBeDefined();
    expect(Number(halfWidth?.[1])).toBe(FLIGHT_SHIP_HALF_WIDTH_PX);
    expect(Number(shipY?.[1])).toBe(FLIGHT_SHIP_BOTTOM_GAP);
    // Flight derives its scale as halfWidthPx / LANTERN_DESIGN_HALF_WIDTH, and
    // `SHIP_DESIGN_HALF_W` is that divisor restated. It is the fin span.
    expect(SHIP_DESIGN_HALF_W).toBe(FIN_TIP_X);

    const stand = lanternStand();
    expect(stand.x).toBe(GAME_WIDTH / 2);
    expect(stand.y).toBe(GAME_HEIGHT - FLIGHT_SHIP_BOTTOM_GAP);
    // The same drawn height Flight gets, so the two screens show one ship.
    expect(stand.height).toBeCloseTo(
      (SHIP_ABOVE + SHIP_BELOW) * (FLIGHT_SHIP_HALF_WIDTH_PX / FIN_TIP_X),
      6,
    );
  });

  it("UR-63: the ship is ON screen, not merely positioned", () => {
    // Coding standards rule 7: a thing rendering below the fold was invisible
    // to every assertion three separate times in one night. The BODY has to be
    // inside the frame - the plume may run off the bottom edge, which is what
    // an exhaust does.
    const body = lanternBox();
    expect(body.y).toBeGreaterThan(0);
    expect(body.y + body.h).toBeLessThan(GAME_HEIGHT);
    expect(body.x).toBeGreaterThan(0);
    expect(body.x + body.w).toBeLessThan(GAME_WIDTH);
    // And a real amount of it: a ship 20 px tall in the corner would pass every
    // line above and would not be the answer to "put the ship on the screen".
    expect(body.h).toBeGreaterThan(120);
    expect(shipBandTop()).toBe(body.y);
  });

  it("the exhaust plume clears the coach card", () => {
    // The plume is soft and additive, but a solid gold cone cut off by a card
    // edge is still a visible seam, and the coach card is the one it reaches.
    expect(rectsOverlap(lanternPlumeBox(), COACH)).toBe(false);
  });

  it("the whole ship is inside the frame at the narrowest world", () => {
    // 16:9 is the floor (sceneKeys MIN_ASPECT); the world only ever gets wider,
    // so clearing the right edge here clears it everywhere.
    expect(GAME_WIDTH).toBeGreaterThanOrEqual(1920);
    const ship = lanternPlumeBox();
    expect(ship.x).toBeGreaterThan(0);
    expect(right(ship)).toBeLessThan(1920);
    expect(ship.y).toBeGreaterThan(0);
    // The PLUME reaches the very bottom - Flight draws it there too, and an
    // exhaust cone running off the bottom edge is the ship flying, not a clip.
    // The body's own clearance is asserted above.
    expect(bottom(ship)).toBeLessThanOrEqual(GAME_HEIGHT);
  });

  it("the ship's footprint is derived from the ship that is actually drawn", () => {
    // The three ratios in `warpLayout` are restated from `render/lantern.ts`,
    // which this lane may not add exports to. This is what keeps the
    // restatement honest: redraw the ship taller and the numbers stop matching.
    expect(SHIP_ABOVE).toBe(-(PIVOT_Y + LENS_LOCAL_Y - LENS_R));
    expect(SHIP_BELOW).toBe(NOZZLE_BOTTOM);
    expect(SHIP_HALF_W).toBeGreaterThanOrEqual(FIN_TIP_X);
  });
});

describe("the three cards still read as one column", () => {
  it("share a left edge and a width", () => {
    for (const card of [INSTRUMENT, COACH]) {
      expect(card.x).toBe(PANEL.x);
      expect(card.w).toBe(PANEL.w);
    }
  });

  it("fit two lines of sentence inside the card", () => {
    // A composed sentence (D09) can be longer than any shipped one, so the card
    // has to hold a second line without printing it through the hint. Read off
    // the rows now rather than off `PANEL.y + 78` and `PANEL.h - 44`, which
    // were the two literals the card was laid out with before UR-70.
    //
    // AND THE SECOND LINE IS REACHABLE, which is why this is not paranoia. The
    // coach's gate caps a composed sentence at 56 characters
    // (`engine/coach/sentence.SENTENCE_LIMITS.maxChars`) and this card's
    // content box is 1648 px, which at the scene's own 0.58-em estimate holds
    // about 54 - so the reserved line is a case the screen really can reach,
    // and the card is sized for it whatever the sentence on screen is.
    //
    // THE HINT IS NO LONGER THE THING IT MUST CLEAR. It moved to the product's
    // hint line at the bottom left with the rest of the product's hints, so the
    // card's own foot is what the second line must stay above. Watched failing
    // with `SENTENCE_BLOCK` back on `2 * SENTENCE_STEP - SENTENCE_LEADING`:
    // `expected 445 to be greater than or equal to 453`.
    const band = sentenceRow();
    const secondLineBottom = band.y + SENTENCE_STEP + Math.round(SENTENCE_PX * 1.3);
    expect(bottom(PANEL) - PLATE_RHYTHM.card.padY).toBeGreaterThanOrEqual(
      secondLineBottom,
    );
  });

  it("do not overlap each other", () => {
    expect(rectsOverlap(PANEL, INSTRUMENT)).toBe(false);
    expect(rectsOverlap(INSTRUMENT, COACH)).toBe(false);
    expect(bottom(COACH)).toBeLessThan(GAME_HEIGHT);
  });

  it("the whole column ends above the ship's band", () => {
    // UR-63. One assertion for all three, against the ship's own top, so a card
    // that grows downward fails here instead of on a screenshot nobody took.
    for (const card of WARP_CARDS) {
      expect(
        bottom(card) < shipBandTop(),
        `${describeRect(card)} reaches the ship's band (top ${Math.round(shipBandTop())})`,
      ).toBe(true);
    }
  });
});

describe("UR-70: the column is condensed, and the gap is not a function of the sentence", () => {
  /**
   * THE DEFECT, AS A NUMBER.
   *
   * UR-70 reported "condensed space without excessive padding" against a screen
   * whose destination line was followed by a hole. The card was a fixed 280
   * sized for two lines and the sentence was CENTRED in the band under the
   * destination line, so half a one-line sentence's slack went above it:
   *
   *                    before        after
   *   one-line stop    70 px         26 px         18 px
   *   two-line stop    36 px         26 px         18 px
   *
   * The third column is this pass. The `card` rhythm moved from the `unit`
   * step (20) to the `glass` step (12) - condensation as a property of the
   * SHARED component (`ui/plateLayout.PLATE_RHYTHM`), not a literal on this
   * screen - and the hint stopped being pinned to the card's foot.
   *
   * Ink to ink, in Latin. The rows are sized on the DEVANAGARI line box (rule
   * 5: three languages), so the Latin gap reads 6 px wider than the step the
   * rhythm lays out.
   *
   * ================== WATCH THEM FAIL (rule 4) ==================
   * `sentenceRow()` put back to the shipped centring, `PANEL.y + 78 +
   * round((146 - block) / 2)` with a one-line block - three cases red, and the
   * third is the one that says the slack merely moved:
   *
   *   the three cards still read as one column > fit two lines of sentence
   *   above the hint
   *     expected 453 to be greater than 497
   *   puts one unit under the destination line, at any sentence length
   *     expected 68 to be 20
   *   names what a one-line stop pays for it
   *     expected 24 to be 72
   *
   * And this pass's own numbers, off the real red run that preceded it -
   * `PLATE_RHYTHM.card` back on the `unit` step and `hintRow` back to
   * `plateFooter`:
   *
   *   puts one unit under the destination line, at any sentence length
   *     expected 18 to be 26
   *   the card is no taller than the rows in it
   *     expected 265 to be 268
   *   the three plates are one unit apart, and the column got shorter
   *     expected 805 to be 808
   *   names what a one-line stop pays for it
   *     expected 93 to be 72
   */
  const INK_LATIN = (px: number): number => Math.round(px * 1.3);

  it("puts one unit under the destination line, at any sentence length", () => {
    const d = destinationRow();
    expect(sentenceRow().y - (d.y + d.h)).toBe(PLATE_RHYTHM.card.gap);
    // Ink to ink, which is the distance a person sees. 26 before this pass.
    expect(sentenceRow().y - (d.y + INK_LATIN(TYPE.label))).toBe(18);
  });

  it("the card is no taller than the rows in it", () => {
    // Derived, not picked. 280 was 250 plus 30 added after the hint was found
    // printing through; 268 was that derived on the `unit` step; 265 was that
    // with the caption row still in the card.
    //
    // 222 IS 265 LESS THE HINT'S ROW. The keyboard hint left this card for the
    // product's hint line (`ui/hintLine.drawHint`), so the third row and the
    // card gap above it went with it: 265 - 31 - 12 = 222. Read off the red run
    // this change produced - `expected 222 to be 265`.
    expect(PANEL.h).toBe(222);
    expect(PANEL.h).toBeLessThan(265);
  });

  it("the three plates are one unit apart, and the column got shorter", () => {
    expect(INSTRUMENT.y - bottom(PANEL)).toBe(PLATE_STACK_GAP);
    expect(COACH.y - bottom(INSTRUMENT)).toBe(PLATE_STACK_GAP);
    // 236..820 before UR-70, 236..808 after its first pass, 236..805 with the
    // hint still in the card, 236..762 once it left it.
    //
    // 236..795 NOW, and this is the one change in the sequence that made the
    // column LONGER: the coach card grew from a hand-picked 140 to the 173 its
    // figure actually needs (see the Shadow block below). Read off the red run
    // this change produced - `expected 795 to be 762`. The clearance over the
    // Lantern's band is spent down from 75.6 px to 42.6 px and is still well
    // over the 32 px floor, which is what this pair of lines is for.
    expect(bottom(COACH)).toBe(795);
    expect(shipBandTop() - bottom(COACH)).toBeGreaterThan(32);
  });

  it("no longer draws a keyboard hint inside the card at all", () => {
    // ================== WHAT THESE TWO CASES USED TO SAY ==================
    // `hintRow(lines)` put the hint one step under the sentence THAT WAS THERE
    // and clamped at the card's foot, so a one-line stop pulled it up and a
    // two-line stop got `plateFooter`. That closed UR-70's hole - 79.8 px of
    // nothing between the sentence and the line telling the child what to do
    // with it, measured ink to ink at Jupiter - and it is gone because the
    // Warp break was the only screen declared `placement: "grid"` in
    // `ui/hint.ts` with nothing on the grid line. See the note over
    // `sentenceRow` in warpLayout.ts and the entry in gauntlet/escalations.md.
    //
    // ================== WHAT REPLACES THEM ==================
    // The card has TWO rows and neither is a caption, so there is no reserved
    // line for a hint to be pulled up from and no foot for one to be pinned to.
    // Asserted against the module's exports rather than against a number: a
    // `hintRow` put back, or a caption row put back into `PANEL_ROWS`, fails
    // here. Watched failing with both restored:
    //   `expected 265 to be 222` and `expected [Function] to be undefined`.
    const mod = warpLayout as unknown as Record<string, unknown>;
    expect(mod["hintRow"]).toBeUndefined();
    // Two rows: the destination line and the sentence block. The card's height
    // is exactly what `plateHeight` makes of them, so a third row cannot be
    // added without this number moving.
    const sentenceBlock =
      (SENTENCE_MAX_LINES - 1) * SENTENCE_STEP + lineBox(SENTENCE_PX);
    expect(PANEL.h).toBe(
      plateHeight([lineBox(TYPE.label), sentenceBlock], "card"),
    );
  });

  /**
   * UR-70'S TWO PLACED MARKS. The prompt glyph and the dots hang off the header
   * lines, which are measured off live Text bounds and so belong to the scene;
   * these two are rectangles in the column and belong here.
   *
   * WATCHED FAILING - `badgeRow` reading the card on the `chip` rhythm, which
   * is the mistake a badge helper with a default rhythm invites, and `boltRow`
   * given `METER.y` instead of the centred y:
   *
   *   sets the destination badge inside the card's top right corner
   *     expected { x: 1758, y: 248, w: 44, h: 44 } to deeply equal
   *     { x: 1740, y: 248, w: 44, h: 44 }
   *   puts the charge bolt inside the track, at the end the fill starts from
   *     expected 573 to be 575
   */
  it("sets the destination badge inside the card's top right corner", () => {
    const badge = badgeRow();
    const box = plateContent(PANEL, "card");
    expect(badge).toEqual({ x: 1740, y: box.y, w: MARK.badge, h: MARK.badge });
    // INSIDE the padding, so it can collide with neither a bracket arm nor the
    // rim, whichever of them a screen turns on.
    expect(badge.x + badge.w).toBe(box.x + box.w);
    expect(badge.y).toBe(destinationRow().y);
    expect(badge.y + badge.h).toBeLessThanOrEqual(sentenceRow().y);
  });

  /**
   * UR-78 MOVED THE BOLT OUT OF THE TRACK. THIS PASS MOVED IT TO THE OTHER SIDE
   * OF THE WORDS.
   *
   * UR-70 set it in the track's left cap. Inside the track the mark is behind
   * the fill, so it had to be drawn twice - accent under, sunken ink over - and
   * at no charge level was it the gold the percentage is drawn in. UR-78 put it
   * beside the label, where it is one drawing in one colour; it put it five
   * pixels PAST the label, and the project owner asked for five pixels before.
   *
   * The ask and UR-78's own reasoning agree: the mark is "the left end of the
   * line whose right end is the number", and past the words it was the left end
   * of nothing - it sat between "warp drive" and 1500 px of empty track.
   *
   * MEASURED OFF THE LABEL, so this takes a box rather than reading a constant:
   * "warp drive" is a translated string at a themed size and the only honest
   * source for its edges is the object that drew it.
   *
   * ================== AND THIS PASS PUT THE BOLT ON THE LINE ==================
   * The mark still opens the line, but it no longer HANGS OFF it. The owner's
   * report is that the bolt sticks out into the gutter while the "w" sits on
   * the alignment line, so the lockup's left edge is the wrong object: what a
   * reader sees first is a glyph 18 px adrift of every other left edge on the
   * screen.
   *
   * The fix is one move: THE BOLT TAKES THE LINE THE LABEL HAD, and the words
   * step right by one vertical unit to make room for it. The left edge of the
   * lockup is now the mark, which is what the composition says it is.
   *
   * ================== WHY THE LEAD IS 20 AND THE GAP IS 7 ==================
   * NOT because 7 reads better than 5 - it is the remainder of a number that is
   * fixed elsewhere. The words land at `instrumentLabelRow().x + LEAD`, and
   * `ui/alignment.legalLefts` only names an inner line plus a WHOLE vertical
   * unit (`STEP.unit`, 20). A lead of `MARK.bolt.w + 5` = 18 puts the label at
   * 154, which is on no named line, so `left-edge-conformance.spec.ts` would
   * count a third off-model element on the warp break against a budget of 2.
   *
   * So the LEAD is the vertical unit and the gap is what is left of it once the
   * mark has taken its 13 px: `BOLT_GAP_PX = STEP.unit - MARK.bolt.w` = 7. Two
   * pixels of extra air, and in exchange both ends of the lockup are on a line
   * the rest of the game already uses.
   *
   * WATCHED FAILING, against the old geometry - the real printed values:
   *   the bolt takes the line the label used to sit on
   *     the bolt's left edge is at 118, not on the instrument's inner line 136:
   *     expected 118 to be 136
   *   the words start to the right of the bolt, one vertical unit in
   *     expected 136 to be 156
   *   the lead is one whole vertical unit, so the words stay on a named line
   *     expected 0 to be 20
   *   the words are still on a line the alignment model names
   *     "Warp Drive" starts at 136 and the bolt at 118 is off every named line:
   *     expected false to be true
   *   the gap is the vertical unit less the mark's own width
   *     expected 5 to be 7
   */
  it("the bolt takes the line the label used to sit on", () => {
    // THE POINT OF THE CASE, and the owner's report in one number: the mark's
    // LEFT EDGE is the alignment line - the x the "w" used to occupy - so the
    // lockup starts on the grid instead of hanging 18 px off it.
    const row = instrumentLabelRow();
    expect(row.x).toBe(INSTRUMENT.x + PLATE_RHYTHM.instrument.padX);
    const bolt = boltBesideLabel({ x: chargeLabelX(), y: row.y, w: 114, h: 28 });
    expect(
      bolt.x,
      `the bolt's left edge is at ${bolt.x}, not on the instrument's inner line ${row.x}`,
    ).toBe(row.x);
    expect(bolt.w).toBe(MARK.bolt.w);
    expect(bolt.h).toBe(MARK.bolt.h);
    // Still inside the plate's own padding, and no longer reaching past it.
    expect(bolt.x - INSTRUMENT.x).toBeGreaterThanOrEqual(16);
  });

  it("the words start to the right of the bolt, one vertical unit in", () => {
    const row = instrumentLabelRow();
    const bolt = boltBesideLabel({ x: chargeLabelX(), y: row.y, w: 114, h: 28 });
    expect(chargeLabelX()).toBe(row.x + STEP.unit);
    // Strictly right of the mark, ink clear of ink.
    expect(chargeLabelX()).toBeGreaterThan(bolt.x + bolt.w);
    expect(bolt.x + bolt.w + BOLT_GAP_PX).toBe(chargeLabelX());
  });

  it("the lead is one whole vertical unit, so the words stay on a named line", () => {
    expect(chargeLabelX() - instrumentLabelRow().x).toBe(STEP.unit);
  });

  it("the words are still on a line the alignment model names", () => {
    // THE GUARD ON THE GUARD. `left-edge-conformance.spec.ts` counts off-model
    // left edges on the warp break against a budget of exactly 2, and it only
    // measures Text - the bolt is a Graphics and is invisible to it. So moving
    // the WORDS is the half of this change that spec can see, and a lead that
    // is not a whole vertical unit fails it in Playwright twenty minutes later.
    // Asserted here, in the unit suite, off the same model that spec imports.
    const legal = legalLefts([INSTRUMENT.x, PANEL.x]);
    const bolt = boltBesideLabel({
      x: chargeLabelX(),
      y: instrumentLabelRow().y,
      w: 114,
      h: 28,
    });
    expect(
      offGrid(chargeLabelX(), legal) <= EDGE_TOLERANCE,
      `"Warp Drive" starts at ${chargeLabelX()} and the bolt at ${bolt.x} is off every named line`,
    ).toBe(true);
    // And the mark's own edge is a named line too, which is the whole ask.
    expect(offGrid(bolt.x, legal)).toBeLessThanOrEqual(EDGE_TOLERANCE);
  });

  it("the gap is the vertical unit less the mark's own width", () => {
    // Derived, not chosen. A future edit that nudges the gap has to move the
    // lead off the scale to do it, and the case above catches that.
    expect(BOLT_GAP_PX).toBe(STEP.unit - MARK.bolt.w);
    expect(BOLT_GAP_PX).toBe(7);
  });

  it("the bolt is still centred on the label's own line, not its baseline", () => {
    // UNCHANGED by this pass, and worth keeping said: a glyph does not sit on
    // the baseline a mark would share.
    const label = { x: 200, y: 100, w: 100, h: 24 };
    const bolt = boltBesideLabel(label);
    expect(bolt.y + bolt.h / 2).toBe(label.y + label.h / 2);
    expect(bolt.x + bolt.w + BOLT_GAP_PX).toBe(label.x);
  });

  it("keeps the bolt clear of the track it used to sit inside", () => {
    // The mark is now on the LABEL row, so it must not reach down into the
    // charge track - which is what it would do if a later edit centred it on
    // the instrument instead of on its line.
    const label = { x: METER.x, y: METER.y - 32, w: 120, h: 24 };
    const bolt = boltBesideLabel(label);
    expect(bolt.y + bolt.h).toBeLessThanOrEqual(METER.y);
  });

  it("measures its rows in Devanagari, so Hindi does not collide", () => {
    // Rule 5. A card sized on Latin metrics fits in English and collides in
    // Hindi, and no English capture shows it.
    expect(destinationRow().h).toBe(lineBox(TYPE.label));
    expect(destinationRow().h).toBeGreaterThan(INK_LATIN(TYPE.label));
  });
});

describe("UR-62: the warp drive is one instrument, not three pieces", () => {
  it("the label, the readout and the track are all inside one plate", () => {
    // ================== THE DEFECT ==================
    // "warp drive" sat on a pill of its own at METER.y - 52; the track spanned
    // the column below it; the percentage floated on a THIRD pill above the
    // track's right end. Three plates, three borders, no containing box.
    //
    // Watched failing: with METER back at `{ x: GUTTER, y: 650, w: CARD_W,
    // h: 30 }` and the label row back at `METER.y - 52`, this block reports
    //   the charge track sits outside its instrument: expected false to be true
    //   row 2 starts before row 1 ends: expected 680 to be <= 628
    //   expected 0 to be greater than or equal to 16   (flush to the border)
    for (const [name, inner] of [
      ["the charge track", METER],
      ["the label row", instrumentLabelRow()],
      ["the charged line", instrumentChargedRow()],
    ] as const) {
      expect(instrumentContains(inner), `${name} sits outside its instrument`).toBe(true);
    }
  });

  it("the label and the readout share one baseline and the track's two edges", () => {
    // This is the whole of "one element" rather than "three that line up": the
    // readout is the right end of the label's line AND the right end of the
    // bar, and there is exactly one y for both.
    const row = instrumentLabelRow();
    expect(row.x).toBe(METER.x);
    expect(row.x + row.w).toBe(METER.x + METER.w);
    // One row means one top. A second baseline would be a second piece.
    expect(row.y).toBe(instrumentLabelRow().y);
  });

  it("the three rows stack without printing through each other", () => {
    const rows = [instrumentLabelRow(), METER, instrumentChargedRow()];
    for (let i = 1; i < rows.length; i += 1) {
      const above = rows[i - 1] as Rect;
      const below = rows[i] as Rect;
      expect(bottom(above), `row ${i} starts before row ${i - 1} ends`).toBeLessThanOrEqual(
        below.y,
      );
    }
  });

  it("nothing in the instrument reaches its own border", () => {
    // A label flush against the plate edge reads as a clipped label.
    for (const inner of [instrumentLabelRow(), METER, instrumentChargedRow()]) {
      expect(inner.x - INSTRUMENT.x).toBeGreaterThanOrEqual(16);
      expect(right(INSTRUMENT) - right(inner)).toBeGreaterThanOrEqual(16);
    }
  });
});

describe("Shadow's card is built round Shadow", () => {
  /**
   * ================== THE DEFECT, AS MEASURED PIXELS ==================
   * The project owner reported that the coach card at the foot of the warp
   * break is too short for the figure in it. It was, and the note beside the
   * number said otherwise: "`SHADOW_HEIGHT` is 2.9 body radii, i.e. 186 design
   * units, so 0.66 draws 123 px inside a 140 px card."
   *
   * `render/shadow.SHADOW_HEIGHT` under-reads the drawing by half a radius, so
   * the reasoning was sound and the input was wrong. Measured in the SERVED
   * build (`npx vite build --outDir dist-warp`, port 4270) by differencing two
   * screenshots of the same frame with the figure switched off - a Phaser
   * `Graphics` has no bounds, and `shadow.root.getBounds()` comes back as a
   * zero-sized rect at the origin, which is what the first attempt at this
   * measurement got:
   *
   *                      before          after
   *   Shadow drawn       y 613..760      y 634..782
   *   the card           y 622..762      y 622..795
   *   the inner box      y 634..750      y 634..783
   *   drawn height       147 px          147 px
   *   inner height       116 px          149 px
   *   over the top edge  9 px            0
   *
   * ================== WATCH THEM FAIL (rule 4) ==================
   * Real printed values, from the red run with `COACH.h` put back to the
   * literal 140 and `drawShadow` back on `COACH.y + COACH.h / 2`:
   *
   *   the three plates are one unit apart, and the column got shorter
   *     expected 762 to be 795
   *   holds the whole of the figure inside its own padding
   *     expected 116 to be greater than or equal to 144.4608
   *   stands him so the DRAWING is centred, not his origin
   *     expected 692 to be close to 712.88, received difference is
   *     20.879999999999995, but expected 0.05
   *   puts the copy beside him rather than through him
   *     expected 623.5 to be greater than or equal to 634
   *
   * The 20.88 px in the third line is the defect stated exactly: his origin was
   * being centred, and the drawing is 0.11 radii top-heavy about it.
   */
  const innerTop = (): number => COACH.y + PLATE_RHYTHM.card.padY;
  const innerBottom = (): number => bottom(COACH) - PLATE_RHYTHM.card.padY;

  it("takes its four coefficients from the module that draws him", () => {
    // RESTATED AND GUARDED, the same arrangement as `SHIP_ABOVE` / `SHIP_BELOW`
    // above and for the same reason: `render/shadow.ts` imports Phaser, so it
    // can be neither imported here nor loaded in this node environment. Redraw
    // the antenna longer or drop the hover further and these stop matching,
    // rather than the card silently clipping him again.
    const shadow = readFileSync("src/game/render/shadow.ts", "utf8");

    const radius = /export const SHADOW_RADIUS = (\d+);/.exec(shadow);
    expect(radius?.[1], "SHADOW_RADIUS not found in shadow.ts").toBeDefined();
    expect(Number(radius?.[1])).toBe(SHADOW_R);

    // ABOVE: the antenna's tip, plus the outer circle of its glow.
    const tip = /const tipY = spec\.sink \* R - ([\d.]+) \* R;/.exec(shadow);
    const halo = /g\.fillCircle\(tipX, tipY, ([\d.]+) \* R\);/.exec(shadow);
    expect(tip?.[1], "the antenna tip's y is not where this test looks").toBeDefined();
    expect(halo?.[1], "the antenna glow's radius is not where this test looks").toBeDefined();
    expect(Number(tip?.[1]) + Number(halo?.[1])).toBeCloseTo(SHADOW_ABOVE_R, 6);

    // BELOW: the cast-shadow ellipse - its centre, and half its height.
    const hover = /const y = R \* \(1\.0 \+ spec\.sink\);/.test(shadow);
    const cast =
      /g\.fillEllipse\(0, y \+ ([\d.]+) \* R, [\d.]+ \* R, ([\d.]+) \* R\);/.exec(shadow);
    expect(hover, "the hover's baseline is not R * (1 + sink) any more").toBe(true);
    expect(cast?.[1], "the cast shadow's offset is not where this test looks").toBeDefined();
    expect(1 + Number(cast?.[1]) + Number(cast?.[2]) / 2).toBeCloseTo(SHADOW_BELOW_R, 6);
  });

  it("is NOT the height `render/shadow.SHADOW_HEIGHT` claims", () => {
    // THE NEGATIVE CONTROL, and the whole reason this block exists. The number
    // the old card was reasoned from is in the source, is called "full drawn
    // height", and is half a radius short of the drawing. Asserting the gap
    // keeps this test honest if a later pass fixes the constant: the day these
    // agree, the restatement above can be deleted for an import.
    const shadow = readFileSync("src/game/render/shadow.ts", "utf8");
    const claimed = /SHADOW_RADIUS \* ([\d.]+);/.exec(shadow);
    expect(claimed?.[1], "SHADOW_HEIGHT's multiplier is not where this test looks")
      .toBeDefined();
    expect(Number(claimed?.[1])).toBe(2.9);
    expect(SHADOW_ABOVE_R + SHADOW_BELOW_R).toBeCloseTo(3.42, 6);
    expect(SHADOW_ABOVE_R + SHADOW_BELOW_R).toBeGreaterThan(Number(claimed?.[1]));
  });

  it("holds the whole of the figure inside its own padding", () => {
    // THE CARD IS DERIVED FROM HIM. Not "is at least as tall as", which a
    // literal could satisfy by accident: the inner box is what the drawing
    // needs, and the only slack in it is the two pixels of additive glow the
    // screenshot difference found past the arithmetic on each side.
    const drawn = shadowDrawnHeight();
    expect(drawn).toBeCloseTo((1.82 + 1.6) * 64 * 0.66, 6);
    const inner = innerBottom() - innerTop();
    expect(inner).toBeGreaterThanOrEqual(drawn);
    expect(inner - drawn).toBeLessThan(PLATE_RHYTHM.card.padY);
    // And the card is the inner box plus the SHARED rhythm's padding, so a
    // padding change carries here like it carries everywhere else.
    expect(COACH.h).toBe(Math.ceil(drawn + 4) + PLATE_RHYTHM.card.padY * 2);
    expect(COACH.h).toBe(173);
  });

  it("stands him so the DRAWING is centred, not his origin", () => {
    // The other half of the same defect. His origin is his body's centre and
    // the drawing is not symmetric about it - 1.82 radii above, 1.60 below - so
    // centring the origin in the card pushed the figure 0.11 radii high, which
    // is the 9 px by which he came out over the card's top edge.
    const at = shadowOrigin();
    const top = at.y - SHADOW_ABOVE_R * SHADOW_R * SHADOW_SCALE;
    const foot = at.y + SHADOW_BELOW_R * SHADOW_R * SHADOW_SCALE;
    expect(at.y).toBeCloseTo(712.88, 1);
    expect(top).toBeGreaterThanOrEqual(innerTop());
    expect(foot).toBeLessThanOrEqual(innerBottom());
    // NOT the old placement, stated as a number so the literal cannot come back.
    expect(at.y).not.toBe(COACH.y + COACH.h / 2);
    // Inside the card's PADDING horizontally too, on his measured left reach
    // rather than on the cast shadow's - the drawing is not symmetric about his
    // origin, and the first pass at this centred him in the column and put him
    // 6 px inside the padding while his sparks crowded the copy.
    //
    // WATCHED FAILING, with the origin back on `COACH.x + SHADOW_COLUMN_W / 2`,
    // which is where the case below catches it:
    //   puts the copy beside him rather than through him
    //     expected 296 to be greater than or equal to 300.2048
    expect(at.x - SHADOW_LEFT_R * SHADOW_R * SHADOW_SCALE).toBeGreaterThanOrEqual(
      COACH.x + PLATE_RHYTHM.card.padX,
    );
  });

  it("puts the copy beside him rather than through him", () => {
    const [speaker, note] = coachRows(TYPE.body, TYPE.caption) as [Rect, Rect];
    const at = shadowOrigin();
    // Clear of the column he stands in, which is his own width plus padding -
    // `COACH.x + 230` was the literal this replaces.
    expect(speaker.x).toBe(COACH.x + SHADOW_COLUMN_W);
    expect(speaker.x).toBeGreaterThanOrEqual(
      at.x + SHADOW_RIGHT_R * SHADOW_R * SHADOW_SCALE + PLATE_RHYTHM.card.padX,
    );
    expect(note.x).toBe(speaker.x);
    // Both rows inside the card's padding, top and bottom.
    expect(speaker.y).toBeGreaterThanOrEqual(innerTop());
    expect(bottom(note)).toBeLessThanOrEqual(innerBottom());
    expect(right(note)).toBeLessThanOrEqual(right(COACH) - PLATE_RHYTHM.card.padX);
    // TWO LINES for the note, reserved before it arrives (AC-33). The longest
    // Spanish and Hindi fallback notes need both, and a card that grew when the
    // note landed is the thing AC-33 forbids.
    expect(note.h).toBe(lineBox(TYPE.body, 2));
    // Centred against the figure, so the copy does not sit in the top of a card
    // that is now sized for him.
    const above = speaker.y - innerTop();
    const below = innerBottom() - bottom(note);
    expect(Math.abs(above - below)).toBeLessThanOrEqual(1);
  });
});

describe("the sentence card's reserved second line", () => {
  /**
   * ================== THE REPORT, AND THE MEASUREMENT ==================
   * The project owner reported the sentence card as too big for the sentences
   * it holds. It is, and the slack is entirely the reserved second line.
   *
   * MEASURED IN THE SERVED BUILD, every belted stop, both letter-spacing
   * settings - twelve screens, read off the live `Text` objects' bounds:
   *
   *   stop       lines   ink top   ink bottom   ink height
   *   mars         1       297        357.2        60.2
   *   jupiter      1       297        357.2        60.2
   *   saturn       1       297        357.2        60.2
   *   uranus       1       297        357.2        60.2
   *   neptune      1       297        357.2        60.2
   *   pluto        1       297        357.2        60.2
   *
   * Identical with D41's increased letter spacing on: the setting widens the
   * line, and none of the six comes near the 1648 px content box, so nothing
   * wraps. 60.2 px of ink in a 149 px band - the card carries 88.8 px it never
   * draws on any of the twelve.
   *
   * ================== AND IT STILL CANNOT SHRINK ==================
   * Because the 149 IS the two lines: `(2 - 1) * SENTENCE_STEP + lineBox(52)`,
   * 68 + 81. There is no third thing in the band to take, which is what this
   * case exists to say - a one-line card would be 154 and the 68 px saved is
   * exactly the reserved line, not padding beside it.
   *
   * Dropping it is a change to D09's composed-sentence behaviour and not this
   * lane's to make; it is in gauntlet/escalations.md with the numbers and a
   * lean. `SENTENCE_MAX_LINES` is asserted here so it cannot be quietly
   * lowered instead.
   *
   * WATCHED FAILING, with `SENTENCE_MAX_LINES` set to 1 - the real printed
   * values, and note how far the damage reaches for one number:
   *   reserves exactly one extra line and nothing beside it
   *     expected 1 to be 2
   *   is the whole of the card's slack, and nothing else
   *     expected 154 to be 222
   *   fit two lines of sentence inside the card
   *     expected 378 to be greater than or equal to 433
   *   the three plates are one unit apart, and the column got shorter
   *     expected 727 to be 795
   *   stands him so the DRAWING is centred, not his origin
   *     expected 644.8768 to be close to 712.88, received difference is
   *     68.00319999999999, but expected 0.05
   */
  it("reserves exactly one extra line and nothing beside it", () => {
    expect(SENTENCE_MAX_LINES).toBe(2);
    const oneLine = plateHeight([lineBox(TYPE.label), lineBox(SENTENCE_PX)], "card");
    expect(PANEL.h - oneLine).toBe(SENTENCE_STEP);
    expect(sentenceRow().h - lineBox(SENTENCE_PX)).toBe(SENTENCE_STEP);
  });

  it("is the whole of the card's slack, and nothing else", () => {
    // 222 today, 154 with the reserve gone. The difference is one 68 px step,
    // so there is no smaller card available that keeps two lines.
    expect(PANEL.h).toBe(222);
    expect(plateHeight([lineBox(TYPE.label), lineBox(SENTENCE_PX)], "card")).toBe(154);
    // The gate that makes the second line reachable, restated from
    // `engine/coach/sentence.ts`: 56 characters at the scene's own 0.58-em
    // estimate is 1697 px, which does not fit the 1648 px content box.
    const contentW = plateContent(PANEL, "card").w;
    expect(contentW).toBe(1648);
    expect(56 * SENTENCE_PX * 0.58).toBeGreaterThan(contentW);
  });
});
