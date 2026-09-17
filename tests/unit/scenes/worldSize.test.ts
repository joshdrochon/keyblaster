import { describe, expect, it } from "vitest";
import {
  DESIGN_WIDTH,
  GAME_HEIGHT,
  GAME_WIDTH,
  MAX_ASPECT,
  MIN_ASPECT,
  designWidthFor,
  setGameWidth,
} from "@game/sceneKeys";

/**
 * THE WORLD'S SIZE (D99, FR-8, AC-18.1).
 *
 * The letterbox was made by fitting a fixed 16:9 rect into a window that is
 * not 16:9. `designWidthFor` is the arithmetic that removes the condition: the
 * world takes the window's own aspect at a pinned 1080 height, so
 * `Phaser.Scale.FIT` has nothing left to letterbox.
 *
 * It is pure, so it is tested here rather than only through the browser. The
 * browser test (tests/e2e/aspect.spec.ts) asserts the picture actually reaches
 * both edges; this one asserts the two properties that make that possible and
 * the one invariant it is not allowed to buy it with.
 */
describe("designWidthFor", () => {
  it("gives the window's own aspect, so FIT has no slack to letterbox", () => {
    // Only at or above 16:9. Below it the world is clamped and FIT does
    // letterbox, on purpose - see the clamp test below for why.
    for (const [w, h] of [
      [1600, 900],
      [2000, 1010],
      [2560, 1080],
      [1920, 1080],
      [3440, 1440],
    ] as const) {
      const width = designWidthFor(w, h);
      // Within half a pixel of the window's aspect - the only error is the
      // rounding to an integer design width.
      expect(Math.abs(width / GAME_HEIGHT - w / h)).toBeLessThan(0.5 / GAME_HEIGHT);
      // Which is what "no bar" means: FIT scales by the smaller of the two
      // ratios, and here they agree.
      const slackX = w - width * Math.min(w / width, h / GAME_HEIGHT);
      const slackY = h - GAME_HEIGHT * Math.min(w / width, h / GAME_HEIGHT);
      expect(Math.max(slackX, slackY)).toBeLessThanOrEqual(1);
    }
  });

  it("never changes the height, because FR-8's fall distance is fixed", () => {
    // The whole reason the WIDTH is the axis that flexes. If this constant
    // ever moves, `len x keystrokeBudget + recognitionBudget` stops describing
    // one fall.
    expect(GAME_HEIGHT).toBe(1080);
  });

  it("is exactly the artboard width at 16:9", () => {
    expect(designWidthFor(1920, 1080)).toBe(DESIGN_WIDTH);
    expect(designWidthFor(1600, 900)).toBe(DESIGN_WIDTH);
  });

  it("NEVER narrows below the artboard, because narrower crops content", () => {
    // THE ASSERTION THIS FILE EXISTS FOR. A world narrower than 1920 pushes
    // the Beacon Log's trophy block (3 x 340 + 2 x 24, starting at 708, so
    // 1776 px wide however wide the window is) off the right edge. Measured
    // off the live scene tree: at a 1440-wide world the Beacon Log overflowed
    // by 384 px, Results by 272 and Briefing by 168.
    //
    // Cropped content is exactly what AC-18.1 rejected `Scale.ENVELOP` for.
    // Doing it sideways is not better. So below 16:9 the world stops and the
    // window letterboxes top and bottom instead, which is visible but not
    // unreachable.
    expect(MIN_ASPECT).toBe(16 / 9);
    for (const [w, h] of [
      [1024, 768],
      [1600, 1000],
      [1280, 1024],
      [600, 1000],
    ] as const) {
      expect(designWidthFor(w, h)).toBe(DESIGN_WIDTH);
    }
    // Wider than 32:9: stops widening.
    expect(designWidthFor(7680, 1080)).toBe(Math.round(GAME_HEIGHT * MAX_ASPECT));
  });

  it("falls back to the artboard on a degenerate viewport", () => {
    // A hidden tab, a window being created, a headless harness with no layout.
    for (const [w, h] of [
      [0, 0],
      [1920, 0],
      [Number.NaN, 1080],
      [-100, 1080],
    ] as const) {
      expect(designWidthFor(w, h)).toBe(DESIGN_WIDTH);
    }
  });
});

describe("GAME_WIDTH is a live binding", () => {
  it("opens at the artboard width for anything that reads it before boot", () => {
    // A unit test, or a module imported in Node, must not see a 0-wide world.
    expect(GAME_WIDTH).toBe(DESIGN_WIDTH);
  });

  it("is what `setGameWidth` last applied, rounded", () => {
    try {
      expect(setGameWidth(2138.6)).toBe(2139);
      // The live binding, re-read through the module namespace rather than the
      // value captured by this file's own import - which is the trap the
      // header warns about and the reason three module-level `const`s had to
      // become functions.
      expect(GAME_WIDTH).toBe(2139);
    } finally {
      setGameWidth(DESIGN_WIDTH);
    }
    expect(GAME_WIDTH).toBe(DESIGN_WIDTH);
  });
});
