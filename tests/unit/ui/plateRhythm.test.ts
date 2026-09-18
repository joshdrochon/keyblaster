import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BRACKET,
  PLATE_RHYTHM,
  PLATE_STACK_GAP,
  PLATE_STEP,
  badgeBox,
  bracketArm,
  flowFooter,
  bracketSegments,
  lineBox,
  plateContent,
  plateFooter,
  plateHeight,
  rhythmOf,
  rimRect,
  stackRows,
} from "@game/ui/plateLayout";
import { LINE_HEIGHT, SKY_PLATE, SPACE, TYPE } from "@game/ui/theme";

/**
 * THE PLATE'S RHYTHM (UR-69, UR-70).
 *
 * ================== WHAT IS BEING DEFENDED ==================
 * UR-70's most transferable sentence is about PADDING: "how its nice and
 * condensed space without excessive padding". Padding is now a property of one
 * shared component, so this file is where the numbers are held still.
 *
 * Three claims, and they fail for different reasons:
 *
 *   1. THERE ARE THREE STEPS AND THEY ARE THESE. A fourth spacing value is a
 *      design decision; it may not arrive as a literal in a scene.
 *   2. A ROW STACK IS TOP-ALIGNED AND EVENLY SPACED. The warp sentence was
 *      CENTRED in a fixed band, which is what put a 70 px hole between
 *      "destination: saturn" and the sentence on a one-line stop.
 *   3. HEIGHT IS DERIVED FROM CONTENT. `plateHeight` is the exact inverse of
 *      `stackRows`, so a card cannot be 60 px taller than the thing in it.
 *
 * ================== WATCH IT FAIL (rule 4) ==================
 * Every value below was read off a real red run.
 *
 *   `PLATE_RHYTHM.card.gap` 20 -> 24 (a fourth step, which is what nine scenes
 *   drifting looks like) - three cases red:
 *
 *     every rhythm's gap and pad is one of the three steps
 *       card.gap 24 is not one of 8, 12, 20
 *       button.padY 14 is not one of 8, 12, 20: expected [ ...(2) ] to deeply
 *       equal [ Array(1) ]
 *     puts the same air under the label whether the body is one line or two
 *       expected 24 to be 20
 *     gives the warp card the height its own rows ask for
 *       expected 276 to be 268
 *
 *   `stackRows` rewritten to CENTRE its block in the content box - i.e. what
 *   `support/warpLayout.sentenceTop` used to do:
 *
 *     the first row starts one pad below the plate's top edge
 *       expected 290 to be 256
 *
 *   THE FIRST CUT OF THIS FILE DID NOT CATCH THAT, and the miss is the reason
 *   the rows in that describe are what they are. It used the card's own
 *   worst-case rows, a two-line sentence, and a stack that exactly fills its
 *   box centres to the same place it top-aligns to - so the sabotage came back
 *   `22 passed`. Knowing the trap does not stop you falling in; only reverting
 *   the code and watching red does (standards rule 4). The rows are now a
 *   ONE-LINE sentence in the card sized for two, which is Saturn, which is the
 *   stop UR-70 was reported on.
 *
 *   `plateHeight` with `r.gap * heights.length` instead of `length - 1` - two
 *   cases red:
 *
 *     plateHeight is the exact inverse of stackRows
 *       expected 484 to be 504
 *     gives the warp card the height its own rows ask for
 *       expected 288 to be 268
 *
 *   `BRACKET.fraction` 0.14 -> 0.44, i.e. arms that reach for the next corner:
 *
 *     two arms of one edge never meet
 *       expected 56 to be 38
 *
 *   `lineBox` measured on `LINE_HEIGHT.latin` instead of `devanagari` - two
 *   cases red, and this is the rule-5 one: an English-only reading of this card
 *   is 11 px short and nothing in an English capture shows it:
 *
 *     gives the warp card the height its own rows ask for
 *       expected 257 to be 268   (that run's card; it is 265 since UR-70
 *                                 condensed the card onto the `glass` step)
 *     uses the Devanagari line box whatever is loaded
 *       expected 31 to be 37
 *
 *   npx vitest run tests/unit/ui/plateRhythm.test.ts --coverage.enabled=false
 */

const STEPS = Object.values(PLATE_STEP);

/**
  * The warp break's sentence card, which is the screen UR-70 was reported on.
  * 265 tall since the `card` rhythm moved onto the `glass` step; it was 268 on
  * the `unit` step and 280 before it was derived at all.
  */
const CARD = { x: 96, y: 236, w: 1728, h: 265 };

describe("the rhythm is three steps and nothing between them", () => {
  it("names exactly three, and they are the ones already in the tokens", () => {
    expect(STEPS).toEqual([8, 12, 20]);
    // Not invented: two of the three are tokens this project already measures
    // evidence against, and the third is the step UR-62 built the warp
    // instrument on.
    expect(PLATE_STEP.glass).toBe(SKY_PLATE.padY);
    expect(PLATE_STEP.card).toBe(SPACE.gap);
  });

  it("every rhythm's gap and pad is one of the three steps", () => {
    const stray: string[] = [];
    for (const [name, r] of Object.entries(PLATE_RHYTHM)) {
      if (!STEPS.includes(r.padY as (typeof STEPS)[number])) {
        stray.push(`${name}.padY ${r.padY} is not one of ${STEPS.join(", ")}`);
      }
      if (!STEPS.includes(r.gap as (typeof STEPS)[number])) {
        stray.push(`${name}.gap ${r.gap} is not one of ${STEPS.join(", ")}`);
      }
    }
    // `button` is the menu kit's row padding and predates this rhythm; it is
    // named here rather than exempted silently.
    expect(stray, stray.join("\n")).toEqual([`button.padY ${SPACE.rowPadY} is not one of 8, 12, 20`]);
  });

  it("stacks two plates on the same step it stacks two rows on", () => {
    expect(PLATE_STACK_GAP).toBe(PLATE_STEP.card);
  });

  it("keeps the chip identical to SKY_PLATE, so V-22.8's geometry is untouched", () => {
    // `skyText` draws its plate at these two numbers and registers the colour
    // pair the contrast evidence reads. A rhythm that quietly re-cut that plate
    // would move an AC-22.8 measurement without anyone editing the measurement.
    expect(PLATE_RHYTHM.chip.padX).toBe(SKY_PLATE.padX);
    expect(PLATE_RHYTHM.chip.padY).toBe(SKY_PLATE.padY);
  });

  /**
   * WHY THIS ASSERTION CHANGED (it used to pin the instrument at 32).
   *
   * UR-70 was a vertical complaint and this case used to say so: "the x insets
   * are the numbers the screens already drew at - the warp card's 40, the
   * instrument's 32". The near-miss census is the horizontal ticket, and it
   * found what leaving them alone cost: the warp break stacks a card and an
   * instrument in ONE column, both on `GUTTER`, and drew content at 136 and
   * 128. Eight pixels apart is not two lines, it is one line drawn twice.
   *
   * WATCHED FAIL: `instrument: { padX: STEP.inset, ... }` restored -
   *   two plates stacked in one column share one content line:
   *     expected 32 to be 40
   */
  it("two plates stacked in one column share one content line", () => {
    expect(PLATE_RHYTHM.card.padX).toBe(40);
    expect(PLATE_RHYTHM.instrument.padX).toBe(PLATE_RHYTHM.card.padX);
  });

  /**
   * The inner lines, as a set. THREE, down from four.
   *
   * `alignment.INNER_LINES` is derived from these, and it is the closed set an
   * element's left edge is checked against - so every entry here is a distinct
   * left edge the app is allowed to draw at, and the shortest honest list is
   * the goal. `chip` (22) is `SKY_PLATE` and V-22.8's evidence geometry;
   * `button` was 28 - `SPACE.rowPadX`, the one number here on no scale at
   * all - and UR-89 moved it onto `SKY_PLATE.padX` (22), which is why this list
   * is two entries rather than three.
   *
   * WATCHED FAIL: with the instrument back at 32 -
   *   expected [ 22, 32, 40 ] to deeply equal [ 22, 40 ]
   *
   * TWO NOW, down from three: UR-89 moved `SPACE.rowPadX` from 28 to 22, so the
   * button line and the chip line are one line. The list only ever shrinks.
   */
  it("draws at three inner lines, and the list only ever shrinks", () => {
    const lines = [...new Set(Object.values(PLATE_RHYTHM).map((r) => r.padX))].sort(
      (a, b) => a - b,
    );
    expect(lines).toEqual([22, 40]);
  });
});

describe("a stack of rows is top-aligned", () => {
  /**
   * A SHORT BODY IN A FIXED CARD, which is the only shape that can tell
   * top-aligned from centred.
   *
   * The first cut of this file used the card's own worst-case rows - a
   * two-line sentence - and `stackRows` rewritten to centre its block PASSED
   * every case in this describe, because a stack that exactly fills its box
   * centres to the same place it top-aligns to. That is the warp card on a
   * two-line stop; the defect only exists on a ONE-LINE stop, which is Saturn,
   * which is the stop UR-70 was reported on. So the rows here are a one-line
   * sentence, 52 px, in the 268 px card sized for two.
   */
  const rows = [lineBox(TYPE.label), 52, lineBox(TYPE.caption)];

  it("the first row starts one pad below the plate's top edge", () => {
    const laid = stackRows(CARD, rows);
    expect(laid[0]?.y).toBe(CARD.y + PLATE_RHYTHM.card.padY);
    expect(laid[0]?.y).toBe(248);
  });

  it("rows are exactly one gap apart, whatever is in them", () => {
    const laid = stackRows(CARD, rows);
    for (let i = 1; i < laid.length; i += 1) {
      const prev = laid[i - 1] as { y: number; h: number };
      const next = laid[i] as { y: number };
      expect(next.y - (prev.y + prev.h), `row ${i}`).toBe(PLATE_RHYTHM.card.gap);
    }
  });

  it("puts the same air under the label whether the body is one line or two", () => {
    // THE DEFECT, AS A NUMBER. The warp card's band was fixed and its sentence
    // was centred in it, so the distance between the destination line and the
    // sentence depended on how long the sentence was: 70 px at one line, 36 at
    // two. A label's distance from the thing it labels is not a function of the
    // thing's length.
    const one = stackRows(CARD, [lineBox(TYPE.label), 52]);
    const two = stackRows(CARD, [lineBox(TYPE.label), 120]);
    const gapOf = (laid: { y: number; h: number }[]): number =>
      (laid[1] as { y: number }).y - ((laid[0] as { y: number; h: number }).y + (laid[0] as { h: number }).h);
    expect(gapOf(one)).toBe(gapOf(two));
    // 12 since UR-70 condensed the card onto the `glass` step; 20 before.
    expect(gapOf(one)).toBe(12);
  });

  it("shares the content box's left edge and width", () => {
    const box = plateContent(CARD);
    for (const row of stackRows(CARD, rows)) {
      expect(row.x).toBe(box.x);
      expect(row.w).toBe(box.w);
    }
  });

  it("pins a footer to the foot, so a short body's slack lands below it", () => {
    const foot = plateFooter(CARD, lineBox(TYPE.caption));
    const box = plateContent(CARD);
    expect(foot.y + foot.h).toBe(box.y + box.h);
    expect(foot.y + foot.h).toBe(CARD.y + CARD.h - PLATE_RHYTHM.card.padY);
  });
});

/**
 * UR-70's CONDENSATION, AND THE HOLE ON THE OTHER SIDE OF IT.
 *
 * Two claims, and they are the two halves of "nice and condensed without
 * excessive padding":
 *
 *   1. A CARD IS ON THE `glass` STEP. Not a fourth number - the three steps are
 *      unchanged - but the card's pad and row gap moved from `unit` (20) to
 *      `glass` (12), which is the condensation applied to the COMPONENT rather
 *      than to one screen.
 *   2. A FOOTER FOLLOWS THE CONTENT WHEN THE CONTENT IS SHORT. `plateFooter`
 *      alone leaves a card sized for its worst case with a hole in the middle
 *      of its reading order; `flowFooter` moves that slack to the foot and
 *      clamps, so a full card is byte-identical to what it was.
 *
 * ================== WATCH THEM FAIL (rule 4) ==================
 * Read off real red runs. `PLATE_RHYTHM.card` put back on `PLATE_STEP.card` -
 * six cases red across this file, which is the blast radius of one step:
 *
 *   the first row starts one pad below the plate's top edge
 *     expected 256 to be 248
 *   puts the same air under the label whether the body is one line or two
 *     expected 20 to be 12
 *   a card is on the condensed step, and it is still one of the three
 *     expected 20 to be 12
 *   the whole point: a card gets shorter without a new number
 *     expected 268 to be 236
 *   pulls a footer up to a short body instead of leaving a hole
 *     expected 414 to be 390
 *   gives the warp card the height its own rows ask for
 *     expected 297 to be 265
 *
 * `flowFooter` rewritten to return `plateFooter`'s y unconditionally, which is
 * what it replaced:
 *
 *   pulls a footer up to a short body instead of leaving a hole
 *     expected 458 to be 390
 *   never puts the footer above the content box
 *     expected -3 to be greater than or equal to 12
 */
describe("UR-70: a card is condensed, and its footer follows its content", () => {
  it("a card is on the condensed step, and it is still one of the three", () => {
    expect(PLATE_RHYTHM.card.padY).toBe(PLATE_STEP.glass);
    expect(PLATE_RHYTHM.card.gap).toBe(PLATE_STEP.glass);
    expect(PLATE_RHYTHM.card.padY).toBe(12);
    // No fourth step arrived to buy this.
    expect(STEPS).toEqual([8, 12, 20]);
    // And the HORIZONTAL inset did not move: UR-70 is a vertical complaint, and
    // a wider or narrower card rewraps the sentence, which is a different
    // defect wearing this fix's clothes.
    expect(PLATE_RHYTHM.card.padX).toBe(40);
  });

  it("the whole point: a card gets shorter without a new number", () => {
    const rows = [lineBox(TYPE.label), 120, lineBox(TYPE.caption)];
    expect(plateHeight(rows, "card")).toBe(236);
    // 16 off the pads and 16 off the two gaps, against the same three rows on
    // the `unit` step.
    const onUnit = PLATE_STEP.card * 2 + rows.reduce((a, b) => a + b, 0) + PLATE_STEP.card * 2;
    expect(onUnit - plateHeight(rows, "card")).toBe(32);
  });

  it("pulls a footer up to a short body instead of leaving a hole", () => {
    // The warp break's own case: a card sized for a two-line sentence showing a
    // one-line one. The body ends at `oneLine`; the footer used to sit at the
    // card's foot regardless, which is the 79.8 px hole UR-70 reported.
    const box = plateContent(CARD);
    const oneLine = box.y + lineBox(TYPE.label) + PLATE_RHYTHM.card.gap + lineBox(52);
    const foot = flowFooter(CARD, oneLine, lineBox(TYPE.caption));
    expect(foot.y).toBe(oneLine + PLATE_RHYTHM.card.gap);
    expect(foot.y).toBe(390);
    expect(foot.y).toBeLessThan(plateFooter(CARD, lineBox(TYPE.caption)).y);
    // Same x and width as any other row - it is a row, not a floating label.
    expect(foot.x).toBe(box.x);
    expect(foot.w).toBe(box.w);
  });

  it("clamps at the foot, so a full card is exactly what it always was", () => {
    // THE HALF THAT PROTECTS THE OTHER EIGHT SCREENS. A card whose rows reach
    // its foot must be untouched by this, or `flowFooter` is a second layout
    // rather than one behaviour with a short case.
    const height = lineBox(TYPE.caption);
    const foot = plateFooter(CARD, height);
    for (const bottom of [foot.y, foot.y + 100, CARD.y + CARD.h * 2]) {
      expect(flowFooter(CARD, bottom, height)).toEqual(foot);
    }
  });

  it("never puts the footer above the content box", () => {
    // A plate short enough that one row does not fit cannot be made to draw its
    // footer outside itself.
    const tiny = { x: 0, y: 0, w: 200, h: 40 };
    const foot = flowFooter(tiny, -500, lineBox(TYPE.caption));
    expect(foot.y).toBeGreaterThanOrEqual(plateContent(tiny).y);
  });
});

describe("height is derived from content", () => {
  it("plateHeight is the exact inverse of stackRows", () => {
    const rows = [lineBox(TYPE.label), 120, lineBox(TYPE.caption)];
    const h = plateHeight(rows);
    const laid = stackRows({ ...CARD, h }, rows);
    const last = laid[laid.length - 1] as { y: number; h: number };
    expect(last.y + last.h).toBe(CARD.y + h - PLATE_RHYTHM.card.padY);
  });

  it("an empty plate is two pads tall and nothing else", () => {
    expect(plateHeight([])).toBe(PLATE_RHYTHM.card.padY * 2);
  });

  it("gives the warp card the height its own rows ask for", () => {
    // The number the screen now draws, derived rather than picked. It was 280,
    // which was 250 plus 30 added after the hint was found printing through.
    const rows = [lineBox(TYPE.label), (52 + 16) + lineBox(52), lineBox(TYPE.caption)];
    expect(plateHeight(rows)).toBe(265);
  });
});

describe("a row is measured in the worst language, not in English", () => {
  it("uses the Devanagari line box whatever is loaded", () => {
    // Rule 5: three languages. A card laid out on Latin metrics fits in English
    // and collides in Hindi, and the collision is invisible to anyone reading
    // the screen in English - the same shape as the briefing page that fit at
    // Mars and collided at five of the other six stops.
    expect(lineBox(TYPE.label)).toBe(Math.round(TYPE.label * LINE_HEIGHT.devanagari));
    expect(lineBox(TYPE.label)).toBeGreaterThan(Math.round(TYPE.label * LINE_HEIGHT.latin));
    expect(lineBox(TYPE.body, 2)).toBe(lineBox(TYPE.body) * 2);
  });
});

describe("the corner bracket is four corners, not a border", () => {
  const radius = SPACE.radius;

  it("draws eight arms, two per corner", () => {
    expect(bracketSegments(CARD, radius).length).toBe(8);
  });

  it("keeps every arm on the plate's own edge", () => {
    for (const s of bracketSegments(CARD, radius)) {
      const onVertical = s.x1 === s.x2 && (s.x1 === CARD.x || s.x1 === CARD.x + CARD.w);
      const onHorizontal = s.y1 === s.y2 && (s.y1 === CARD.y || s.y1 === CARD.y + CARD.h);
      expect(onVertical || onHorizontal, `${s.x1},${s.y1} -> ${s.x2},${s.y2}`).toBe(true);
    }
  });

  it("two arms of one edge never meet", () => {
    // An arm that reaches the next corner is not a bracket, it is the border
    // again. Bounded rather than tuned per screen, because one component draws
    // a 96 px chip and a 1728 px card.
    const arm = bracketArm(CARD);
    expect(arm * 2).toBeLessThan(CARD.w - radius * 2);
    expect(arm * 2).toBeLessThan(CARD.h - radius * 2);
    // 37 on a 265 px card; it was 38 when the card was 268, because the arm is
    // a fraction of the plate's shorter side rather than a fixed length.
    expect(arm).toBe(37);
  });

  it("does not shrink to a speck or grow to half an edge", () => {
    expect(bracketArm({ x: 0, y: 0, w: 96, h: 40 })).toBe(BRACKET.min);
    expect(bracketArm({ x: 0, y: 0, w: 4000, h: 4000 })).toBe(BRACKET.max);
  });
});

describe("the rim is outside the plate and the badge is inside it", () => {
  it("clears the plate's edge on all four sides", () => {
    const outer = rimRect(CARD);
    expect(outer.x).toBeLessThan(CARD.x);
    expect(outer.y).toBeLessThan(CARD.y);
    expect(outer.x + outer.w).toBeGreaterThan(CARD.x + CARD.w);
    expect(outer.y + outer.h).toBeGreaterThan(CARD.y + CARD.h);
  });

  it("tucks the badge inside the plate's own padding", () => {
    const badge = badgeBox(CARD, 44);
    const box = plateContent(CARD);
    expect(badge.x + badge.w).toBe(box.x + box.w);
    expect(badge.y).toBe(box.y);
    expect(badge.x).toBeGreaterThan(CARD.x);
    expect(badge.y + badge.h).toBeLessThan(CARD.y + CARD.h);
  });
});

describe("no ink can dodge the contrast test", () => {
  it("holds no colour literal", () => {
    // The same guard `controlSurface.ts` is held to: a hex literal is the only
    // way an unmeasured ink reaches the screen, and AC-22.8 measures pairs.
    const code = (name: string): string =>
      readFileSync(fileURLToPath(new URL(`../../../src/game/ui/${name}`, import.meta.url)), "utf8")
        .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    expect(code("plateLayout.ts")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code("plate.ts")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("defaults the rhythm to the card, so an unnamed plate is not a chip", () => {
    expect(rhythmOf()).toBe(PLATE_RHYTHM.card);
  });
});
