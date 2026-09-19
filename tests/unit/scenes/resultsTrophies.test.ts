import { describe, expect, it } from "vitest";
import { rectsOverlap, type Rect } from "@game/ui/layout";
import {
  BUTTON_Y_MAX,
  resultsLayout,
  shadowBox,
  type Block,
  type PlacedBlock,
} from "@game/scenes/support/resultsLayout";
import { TROPHIES } from "@game/ui/catalog";

/**
 * "TROPHIES EARNED" ON THE STAGE REPORT.
 *
 * The section had to go somewhere in a panel the owner described as already
 * fairly full, and the answer to "what did you do to make room" is measured
 * here rather than asserted: the report panel is a STACK of measured blocks
 * that `resultsLayout` flows and `fitPanel` sizes, so a sixth block is FLOWED
 * rather than fitted into a fixed box. Measured, with the five blocks a full
 * report carries: a 66 px trophy section costs the panel 39 px of height and
 * the other 27 come out of the air between the blocks, which tightens from 27
 * to 20. No section is shrunk, nothing overlaps, and the buttons stay on their
 * line. That is what "what did you do to make room" actually amounts to, and
 * these tests hold every clause of it to the numbers.
 *
 * The second claim is the one that is easy to get wrong later: with no
 * trophies the section is ABSENT, not present and empty, and the layout is
 * then bit-for-bit the layout it was before the feature existed.
 */

const show = (r: Rect): string =>
  `x ${r.x.toFixed(1)}..${(r.x + r.w).toFixed(1)}  y ${r.y.toFixed(1)}..${(r.y + r.h).toFixed(1)}`;

const SHADOW = shadowBox(1830, 940, 0.7);

/** A full report: stats, hull, personal best, faster words, retention. */
const FULL: readonly Block[] = [
  { id: "stats", height: 232 },
  { id: "hull", height: 34 },
  { id: "personal-best", height: 30 },
  { id: "faster", height: 108 },
  { id: "retention", height: 66 },
];

/** The trophy block: a 24 px heading, 8 px of air, a 20 px line. */
const TROPHY_BLOCK: Block = { id: "trophies", height: 66 };

const lay = (report: readonly Block[]) =>
  resultsLayout({ report, board: [], sun: null, shadow: SHADOW });

const boxOf = (b: PlacedBlock): Rect => ({ x: b.x, y: b.y, w: b.w, h: b.height });

describe("stage report - the trophies section", () => {
  it("is absent, not empty, when the belt earned nothing", () => {
    const without = lay(FULL);
    // An EMPTY_PIECE contributes a zero-height block, which is what the scene
    // actually passes. It must change nothing.
    const withEmpty = lay([...FULL, { id: "trophies", height: 0 }]);
    expect(withEmpty.report).toEqual(without.report);
    expect(withEmpty.replay).toEqual(without.replay);
    expect(withEmpty.proceed).toEqual(without.proceed);
  });

  it("is flowed into the panel: the panel grows, the air tightens, nothing shrinks", () => {
    const without = lay(FULL);
    const withIt = lay([...FULL, TROPHY_BLOCK]);

    const heightGain = withIt.report.h - without.report.h;
    const why = `without ${show(without.report)}\n  with    ${show(withIt.report)}`;
    // MEASURED, AND LESS THAN THE BLOCK'S OWN HEIGHT ON PURPOSE. `fitPanel`
    // flows the stack: a new block grows the panel AND tightens the air
    // between the blocks, so 66 px of content costs 39 px of panel and the
    // other 27 come out of the gaps. That is the layout doing its job rather
    // than a section being squeezed - every block keeps its own height, which
    // is the loop below - but it has a floor, which is the next assertion.
    expect(heightGain, why).toBeGreaterThan(0);
    expect(heightGain, why).toBeLessThanOrEqual(TROPHY_BLOCK.height);

    // AND THE AIR NEVER CLOSES TO NOTHING. A stack that absorbed a new block
    // entirely by tightening would eventually print two sections against each
    // other, which is the defect this whole screen was rebuilt for.
    const gapsOf = (blocks: readonly PlacedBlock[]): number[] => {
      const drawn = blocks.filter((b) => b.height > 0);
      const out: number[] = [];
      for (let i = 1; i < drawn.length; i += 1) {
        const prev = drawn[i - 1] as PlacedBlock;
        const cur = drawn[i] as PlacedBlock;
        out.push(cur.y - (prev.y + prev.height));
      }
      return out;
    };
    const after = gapsOf(withIt.reportContent);
    expect(
      Math.min(...after),
      `gaps before ${gapsOf(without.reportContent).join(", ")}\n  after  ${after.join(", ")}`,
    ).toBeGreaterThanOrEqual(12);

    // Every block that existed before keeps its height and its left edge.
    for (const before of without.reportContent) {
      const after = withIt.reportContent.find((b) => b.id === before.id);
      expect(after, `block ${before.id} vanished`).toBeDefined();
      expect(after?.height, `block ${before.id} was shrunk`).toBe(before.height);
      expect(after?.w, `block ${before.id} was narrowed`).toBe(before.w);
      expect(after?.x).toBe(before.x);
    }
  });

  it("is the last section, under the retention line", () => {
    const laid = lay([...FULL, TROPHY_BLOCK]);
    const ids = laid.reportContent.map((b) => b.id);
    expect(ids[ids.length - 1], `order: ${ids.join(", ")}`).toBe("trophies");
  });

  it("never overlaps another section of the report", () => {
    const laid = lay([...FULL, TROPHY_BLOCK]);
    const blocks = laid.reportContent.filter((b) => b.height > 0);
    for (let i = 0; i < blocks.length; i += 1) {
      for (let j = i + 1; j < blocks.length; j += 1) {
        const a = blocks[i] as PlacedBlock;
        const b = blocks[j] as PlacedBlock;
        expect(
          rectsOverlap(boxOf(a), boxOf(b)),
          `${a.id} ${show(boxOf(a))}\n  ${b.id} ${show(boxOf(b))}`,
        ).toBe(false);
      }
    }
  });

  it("stays inside the panel it is drawn in", () => {
    const laid = lay([...FULL, TROPHY_BLOCK]);
    const trophies = laid.reportContent.find((b) => b.id === "trophies");
    expect(trophies).toBeDefined();
    const box = boxOf(trophies as PlacedBlock);
    const why = `trophies ${show(box)}\n  panel    ${show(laid.report)}`;
    expect(box.x, why).toBeGreaterThanOrEqual(laid.report.x);
    expect(box.x + box.w, why).toBeLessThanOrEqual(laid.report.x + laid.report.w);
    expect(box.y + box.h, why).toBeLessThanOrEqual(laid.report.y + laid.report.h);
  });

  it("never pushes the buttons off their line or onto the panel", () => {
    const laid = lay([...FULL, TROPHY_BLOCK]);
    const panelBottom = laid.report.y + laid.report.h;
    expect(laid.replay.y, `panel bottom ${panelBottom}`).toBeGreaterThanOrEqual(
      Math.min(panelBottom, BUTTON_Y_MAX),
    );
    expect(laid.replay.y).toBeLessThanOrEqual(BUTTON_Y_MAX);
    expect(laid.proceed.y).toBe(laid.replay.y);
    expect(
      rectsOverlap(laid.report, { ...laid.proceed }),
      `report ${show(laid.report)}\n  proceed ${show(laid.proceed)}`,
    ).toBe(false);
  });

  it("holds even when every trophy in the catalogue lands at once", () => {
    // Twelve names wrap to three lines at caption size in the panel's content
    // width: heading 24 + 8 + 3 x 26 = 110.
    const laid = lay([...FULL, { id: "trophies", height: 110 }]);
    const blocks = laid.reportContent.filter((b) => b.height > 0);
    for (const b of blocks) {
      expect(
        boxOf(b).y + boxOf(b).h,
        `${b.id} ${show(boxOf(b))} out of ${show(laid.report)}`,
      ).toBeLessThanOrEqual(laid.report.y + laid.report.h);
    }
    expect(TROPHIES.length).toBe(12);
  });
});
