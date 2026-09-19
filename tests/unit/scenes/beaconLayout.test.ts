import { describe, expect, it } from "vitest";
import { DESIGN_WIDTH, GAME_HEIGHT } from "@game/sceneKeys";
import { rectsOverlap, type Rect } from "@game/ui/layout";
import { ACTION_BUTTON, BLOCK_GAP, GUTTER, actionButton } from "@game/ui/grid";
import { PLATE_RHYTHM } from "@game/ui/plateLayout";
import {
  CARD_W,
  button,
  card,
  mastBounds,
  rows,
  shadowBox,
  shadowOrigin,
} from "@game/scenes/support/beaconLayout";

/**
 * BEACON PLACEMENT, AS GEOMETRY.
 *
 * The screen was four objects placed by literal: a 1728x268 black box at a
 * hand-picked y, a 420x64 button on the LEFT gutter, and Shadow standing loose
 * on the background at (300, 470) while the box he was talking over sat 200 px
 * to his right. Three of the four numbers appear nowhere else in the product.
 *
 * What is asserted here is what a screenshot cannot be made to say: that the
 * card's sections do not overlap each other, that Shadow is INSIDE the card
 * rather than beside it, that the text column clears his drawn reach, that the
 * card clears the beacon mast above it and the forward action below it, and
 * that the forward action is on `ui/grid.actionButton` - the one position every
 * screen with a single forward action is measured against.
 *
 * Every failure prints both rectangles. A layout assertion that fails with
 * `expected false to be true` is a test nobody can act on.
 */

const show = (r: Rect): string =>
  `x ${r.x.toFixed(1)}..${(r.x + r.w).toFixed(1)}  y ${r.y.toFixed(1)}..${(r.y + r.h).toFixed(1)}`;

const right = (r: Rect): number => r.x + r.w;
const bottom = (r: Rect): number => r.y + r.h;

/** One line of flavour in Latin, two when it wraps, three in the worst case. */
const LINE_COUNTS = [1, 2, 3] as const;

describe("Beacon placement - the card", () => {
  it("sits on both gutters of the artboard", () => {
    const c = card();
    expect(c.x, `card ${show(c)}`).toBe(GUTTER);
    expect(right(c), `card ${show(c)}`).toBe(DESIGN_WIDTH - GUTTER);
    expect(c.w).toBe(CARD_W);
  });

  it("clears the forward action by one block gap, at every flavour length", () => {
    for (const lines of LINE_COUNTS) {
      const c = card(lines);
      const b = button();
      expect(
        bottom(c) + BLOCK_GAP,
        `lines=${lines}\n  card   ${show(c)}\n  button ${show(b)}`,
      ).toBeLessThanOrEqual(b.y);
    }
  });

  it("never covers the beacon mast above it", () => {
    for (const lines of LINE_COUNTS) {
      const c = card(lines);
      const mast = mastBounds();
      expect(
        rectsOverlap(c, mast),
        `lines=${lines}\n  card ${show(c)}\n  mast ${show(mast)}`,
      ).toBe(false);
    }
  });

  it("grows upward, so the gap to the forward action never moves", () => {
    const bottoms = LINE_COUNTS.map((lines) => bottom(card(lines)));
    expect(new Set(bottoms).size, `bottoms ${bottoms.join(", ")}`).toBe(1);
    // One and two lines are the SAME card: the figure is 149 px and two lines
    // under a caption are 137, so the drawing is what sets the band until the
    // copy outgrows it. Three lines is where the card has to give, and it
    // gives upward.
    const tops = LINE_COUNTS.map((lines) => card(lines).y);
    expect(card(3).y, `tops ${tops.join(", ")}`).toBeLessThan(card(1).y);
    expect(tops, `tops ${tops.join(", ")}`).toEqual([...tops].sort((a, b) => b - a));
  });
});

describe("Beacon placement - the sections inside it", () => {
  it("holds exactly the coordinate row, the speaker and the line - no pulsar fix", () => {
    const ids = rows().map((r) => r.id);
    expect(ids, `rows: ${ids.join(", ")}`).toEqual(["coords", "speaker", "flavour"]);
  });

  it("never overlaps one section with another", () => {
    for (const lines of LINE_COUNTS) {
      const laid = rows(lines);
      for (let i = 0; i < laid.length; i += 1) {
        for (let j = i + 1; j < laid.length; j += 1) {
          const a = laid[i] as { id: string; rect: Rect };
          const b = laid[j] as { id: string; rect: Rect };
          expect(
            rectsOverlap(a.rect, b.rect),
            `lines=${lines}\n  ${a.id} ${show(a.rect)}\n  ${b.id} ${show(b.rect)}`,
          ).toBe(false);
        }
      }
    }
  });

  it("keeps every section inside the card's padding", () => {
    const pad = PLATE_RHYTHM.card;
    for (const lines of LINE_COUNTS) {
      const c = card(lines);
      for (const { id, rect } of rows(lines)) {
        const why = `lines=${lines} ${id}\n  row  ${show(rect)}\n  card ${show(c)}`;
        expect(rect.x, why).toBeGreaterThanOrEqual(c.x + pad.padX);
        expect(right(rect), why).toBeLessThanOrEqual(right(c) - pad.padX);
        expect(rect.y, why).toBeGreaterThanOrEqual(c.y + pad.padY);
        expect(bottom(rect), why).toBeLessThanOrEqual(bottom(c) - pad.padY);
      }
    }
  });
});

describe("Beacon placement - Shadow is inside the box", () => {
  it("draws his whole footprint within the card", () => {
    for (const lines of LINE_COUNTS) {
      const c = card(lines);
      const figure = shadowBox(lines);
      const why = `lines=${lines}\n  shadow ${show(figure)}\n  card   ${show(c)}`;
      expect(figure.x, why).toBeGreaterThanOrEqual(c.x);
      expect(right(figure), why).toBeLessThanOrEqual(right(c));
      expect(figure.y, why).toBeGreaterThanOrEqual(c.y);
      expect(bottom(figure), why).toBeLessThanOrEqual(bottom(c));
    }
  });

  it("stands on the card's own left padding, not centred in a column", () => {
    const c = card();
    const figure = shadowBox();
    expect(
      figure.x - c.x,
      `shadow ${show(figure)} card ${show(c)}`,
    ).toBeCloseTo(PLATE_RHYTHM.card.padX, 5);
  });

  it("never has a word printed through him", () => {
    for (const lines of LINE_COUNTS) {
      const figure = shadowBox(lines);
      for (const { id, rect } of rows(lines)) {
        if (id === "coords") continue;
        expect(
          rectsOverlap(figure, rect),
          `lines=${lines} ${id}\n  shadow ${show(figure)}\n  row    ${show(rect)}`,
        ).toBe(false);
      }
    }
  });

  it("is placed from his drawn reach, not from his origin", () => {
    const at = shadowOrigin();
    const figure = shadowBox();
    // 1.82 radii above the origin, 1.60 below: the drawing is not symmetric
    // about the point it is drawn at, so a centred origin lifts him out of the
    // card (warpLayout's measured coefficients).
    const above = at.y - figure.y;
    const below = bottom(figure) - at.y;
    expect(above / below, `above ${above.toFixed(1)} below ${below.toFixed(1)}`).toBeCloseTo(
      1.82 / 1.6,
      3,
    );
  });
});

describe("Beacon placement - the forward action", () => {
  it("is the product's shared action-button rectangle", () => {
    expect(button()).toEqual(actionButton());
  });

  it("is centred on the artboard", () => {
    const b = button();
    expect(b.x + b.w / 2, `button ${show(b)}`).toBeCloseTo(DESIGN_WIDTH / 2, 5);
  });

  it("is the size the launch button on the Earth beacon screen is", () => {
    const b = button();
    expect([b.w, b.h, b.y]).toEqual([420, 88, Math.round(GAME_HEIGHT * 0.87)]);
    expect(ACTION_BUTTON.y).toBe(940);
  });

  it("stays on the artboard at every window the game can be built at", () => {
    for (const width of [1920, 2561, 3440, 3840]) {
      const b = actionButton(width);
      // Half a pixel, because `x` is rounded and an odd world width has no
      // whole-pixel centre. Anything larger is a button that is not centred.
      expect(
        Math.abs(b.x + b.w / 2 - width / 2),
        `w=${width} button ${show(b)}`,
      ).toBeLessThanOrEqual(0.5);
    }
  });
});
