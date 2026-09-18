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
  SENTENCE_PX,
  SENTENCE_STEP,
  SHIP_HALF_W,
  WARP_CARDS,
  destinationRow,
  hintRow,
  sentenceRow,
  instrumentChargedRow,
  instrumentContains,
  instrumentLabelRow,
  lanternBox,
  lanternStand,
  lanternPlumeBox,
  shipBandTop,
} from "@game/scenes/support/warpLayout";
import { PLATE_RHYTHM, PLATE_STACK_GAP, lineBox } from "@game/ui/plateLayout";
import { TYPE } from "@game/ui/theme";

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

  it("fit two lines of sentence above the hint", () => {
    // A composed sentence (D09) can be longer than any shipped one, so the card
    // has to hold a second line without printing it through the hint. Read off
    // the rows now rather than off `PANEL.y + 78` and `PANEL.h - 44`, which
    // were the two literals the card was laid out with before UR-70.
    const band = sentenceRow();
    const secondLineBottom = band.y + SENTENCE_STEP + Math.round(SENTENCE_PX * 1.3);
    expect(hintRow().y).toBeGreaterThan(secondLineBottom);
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
   *   one-line stop    70 px         26 px
   *   two-line stop    36 px         26 px
   *
   * Ink to ink, in Latin. The rows are sized on the DEVANAGARI line box (rule
   * 5: three languages), so the Latin gap reads 6 px wider than the 20 px unit
   * the rhythm lays out.
   *
   * WATCHED FAILING - `sentenceRow()` put back to the shipped centring,
   * `PANEL.y + 78 + round((146 - block) / 2)` with a one-line block - three
   * cases red, and the third is the one that says the slack merely moved:
   *
   *   the three cards still read as one column > fit two lines of sentence
   *   above the hint
   *     expected 453 to be greater than 497
   *   puts one unit under the destination line, at any sentence length
   *     expected 68 to be 20
   *   names what a one-line stop pays for it
   *     expected 24 to be 72
   */
  const INK_LATIN = (px: number): number => Math.round(px * 1.3);

  it("puts one unit under the destination line, at any sentence length", () => {
    const d = destinationRow();
    expect(sentenceRow().y - (d.y + d.h)).toBe(PLATE_RHYTHM.card.gap);
    // Ink to ink, which is the distance a person sees.
    expect(sentenceRow().y - (d.y + INK_LATIN(TYPE.label))).toBe(26);
  });

  it("the card is no taller than the rows in it", () => {
    // Derived, not picked. 280 was 250 plus 30 added after the hint was found
    // printing through.
    expect(PANEL.h).toBe(268);
    expect(PANEL.h).toBeLessThan(280);
  });

  it("the three plates are one unit apart, and the column got shorter", () => {
    expect(INSTRUMENT.y - bottom(PANEL)).toBe(PLATE_STACK_GAP);
    expect(COACH.y - bottom(INSTRUMENT)).toBe(PLATE_STACK_GAP);
    // 236..820 before; the whole column is 12 px shorter and its clearance over
    // the Lantern's band went from 17.6 px to 29.6 px.
    expect(bottom(COACH)).toBe(808);
    expect(shipBandTop() - bottom(COACH)).toBeGreaterThan(29);
  });

  it("names what a one-line stop pays for it", () => {
    // THE TRADE, ASSERTED SO IT CANNOT GROW QUIETLY. The card cannot resize -
    // `relayoutSentence` swaps in a composed sentence live and its contract is
    // "same geometry" - so a one-line stop's slack has to go somewhere. It goes
    // between the sentence and the FOOTER rather than between the destination
    // line and the sentence, because the second separates a label from the
    // thing it labels.
    const oneLineBottom = sentenceRow().y + INK_LATIN(SENTENCE_PX);
    expect(hintRow().y - oneLineBottom).toBe(72);
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
