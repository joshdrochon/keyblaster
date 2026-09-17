import { describe, expect, it } from "vitest";
import {
  DESIGN_WIDTH,
  GAME_HEIGHT,
  GAME_WIDTH,
  MAX_ASPECT,
  MAX_BUFFER_PIXELS,
  MIN_ASPECT,
  MIN_RENDER_SCALE,
  designWidthFor,
  renderScaleFor,
  setGameWidth,
  textResolutionFor,
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

/**
 * THE WORLD'S RESOLUTION (UR-18), which is not the world's SIZE.
 *
 * The canvas drew 1920x1080 whatever the display. Probed on the frozen build,
 * `deviceScaleFactor` 1 and 2 both gave a 1920x1080 drawing buffer in a
 * 1440x810 CSS box - so at 2x that canvas covered 2880x1620 real pixels while
 * being handed 1920x1080, and the browser upscaled it ~1.5x. Every edge and
 * every glyph soft, on a game whose art is entirely vector drawn in code and
 * would be pixel-perfect at any resolution.
 *
 * THIS FILE ASSERTS BOTH HALVES, and it has to be both or a future change
 * silently undoes one of them:
 *
 *   the BUFFER follows the screen        <- `renderScaleFor` below
 *   the DESIGN SPACE does not move       <- `designWidthFor` / `GAME_HEIGHT`
 *
 * The second half is the one with teeth. Sizing the game in device pixels is
 * the obvious fix and it is wrong here: `scene.scale.width/height` is read as
 * a design coordinate at 34 sites in the scene lane, and `scale.height` IS
 * FR-8's fall distance. `tests/e2e/dpi.spec.ts` asserts the same pair against
 * a real browser at `deviceScaleFactor` 2; this one asserts the arithmetic.
 */
describe("renderScaleFor", () => {
  it("asks for the pixels the canvas really occupies, so nothing is upscaled", () => {
    // The reported case: a 1440 CSS-px canvas on a 2x display is 2880 real
    // pixels, and a 1920 design space rasterised into 2880 needs 1.5.
    expect(renderScaleFor(1920, 1440, 2)).toBe(1.5);
    // The same canvas on a 1x display is 1440 real pixels for a 1920 design
    // space - already DOWNsampled, already sharp. Asking for 2 there would be
    // 4x the fill for nothing a child can see.
    expect(renderScaleFor(1920, 1440, 1)).toBe(MIN_RENDER_SCALE);
    // A window big enough that the world is drawn at or above 1:1 anyway.
    expect(renderScaleFor(2560, 2560, 1)).toBe(MIN_RENDER_SCALE);
  });

  it("never renders BELOW the design size", () => {
    // A floor, not a clamp for tidiness: rendering under 1:1 would be a new
    // softness bug wearing this fix's clothes.
    for (const [css, dpr] of [
      [640, 1],
      [1000, 0.5],
      [1440, 1],
    ] as const) {
      expect(renderScaleFor(DESIGN_WIDTH, css, dpr)).toBe(MIN_RENDER_SCALE);
    }
  });

  /**
   * THIS ASSERTION USED TO SAY `toBe(MAX_RENDER_SCALE)` WITH THE CAP AT 2, and
   * it was wrong - it pinned the defect in place and called it a budget. The
   * comment under it claimed 3x "would be 9x for nothing visible on any
   * shipping display"; measured against the real pre-fix build, going past 2
   * on a 5K display is worth the entire difference between the user's
   * complaint and the fix (see the UR-35 block at the bottom of this file).
   *
   * It is not relaxed here, it is re-pointed: the budget is now an AREA and is
   * asserted as one, everywhere, by the sweep in that block.
   */
  it("is bounded by the fragment budget rather than by a ratio (P-22.9)", () => {
    // Still bounded - a 3x-density phantom display does not get 9x the
    // fragments just for asking.
    const huge = renderScaleFor(1920, 2560, 3);
    expect(1920 * GAME_HEIGHT * huge * huge).toBeLessThanOrEqual(MAX_BUFFER_PIXELS + 1);
    // ...but a real 5K display is INSIDE the budget and now gets what it has.
    expect(renderScaleFor(1920, 2560, 2)).toBeGreaterThanOrEqual(2560 * 2 / 1920);
  });

  it("quantises UP to quarter steps, so a window drag is not a buffer realloc", () => {
    // Rounding UP is the direction that cannot reintroduce softness.
    expect(renderScaleFor(1920, 1930, 1)).toBe(1.25);
    expect(renderScaleFor(1920, 1080, 2)).toBe(1.25);
    expect(renderScaleFor(1920, 1200, 2)).toBe(1.25);
    // Every value it can return is a quarter step.
    for (let css = 900; css <= 2600; css += 7) {
      const s = renderScaleFor(DESIGN_WIDTH, css, 2);
      expect(s * 4).toBe(Math.round(s * 4));
      // And never LESS than the screen actually needs, up to the budget.
      const maxByArea = Math.sqrt(MAX_BUFFER_PIXELS / (DESIGN_WIDTH * GAME_HEIGHT));
      const needed = Math.min(maxByArea, (css * 2) / DESIGN_WIDTH);
      expect(s).toBeGreaterThanOrEqual(needed - 1e-9);
    }
  });

  it("falls back to 1 on a degenerate viewport or density", () => {
    for (const [dw, css, dpr] of [
      [1920, 0, 2],
      [1920, Number.NaN, 2],
      [0, 1440, 2],
      [Number.NaN, 1440, 2],
      [1920, -10, 2],
    ] as const) {
      expect(renderScaleFor(dw, css, dpr)).toBe(MIN_RENDER_SCALE);
    }
    // A missing or absurd DPR is read as 1 rather than poisoning the width.
    // NaN density is read as 1, so this is 3840/1920 = 2 on its own merits,
    // not because a cap clipped it.
    expect(renderScaleFor(1920, 3840, Number.NaN)).toBe(2);
    expect(renderScaleFor(1920, 1440, 0)).toBe(MIN_RENDER_SCALE);
  });

  it("DOES NOT MOVE THE DESIGN SPACE - the other half, and the one with teeth", () => {
    // `designWidthFor` and `GAME_HEIGHT` do not take a density and must never
    // learn to. A child's fall distance, every scene's constants and the
    // MIN_ASPECT lane guards are all measured in design px; the resolution
    // those px are rasterised at is a separate axis.
    expect(GAME_HEIGHT).toBe(1080);
    for (const [w, h] of [
      [1440, 810],
      [2000, 1010],
      [2560, 1080],
      [1024, 768],
    ] as const) {
      const width = designWidthFor(w, h);
      // Whatever the buffer ends up being, the world is the same world.
      for (const dpr of [1, 1.5, 2, 3]) {
        expect(renderScaleFor(width, w, dpr)).toBeGreaterThanOrEqual(MIN_RENDER_SCALE);
        expect(designWidthFor(w, h)).toBe(width);
        expect(GAME_HEIGHT).toBe(1080);
      }
    }
  });
});

describe("textResolutionFor", () => {
  it("sharpens the WORDS, which a bigger buffer alone does not", () => {
    // A Text object is not vector at draw time: it rasterises its string to a
    // private canvas texture at `style.resolution` and Phaser draws that
    // texture at `width / resolution`. So a denser buffer sharpens every SHAPE
    // and leaves every LETTER exactly as soft as it was.
    expect(textResolutionFor(1.5)).toBe(2);
    expect(textResolutionFor(2)).toBe(2);
    expect(textResolutionFor(1.25)).toBe(2);
  });

  it("is a whole number, because a fractional one clips glyphs", () => {
    // `canvas.width = w * resolution` truncates to an integer, so a fractional
    // resolution leaves the glyph texture and the frame's UVs disagreeing by
    // up to a pixel - a clipped right-hand column on some strings.
    for (const s of [1, 1.25, 1.5, 1.75, 2]) {
      const r = textResolutionFor(s);
      expect(r).toBe(Math.round(r));
    }
  });

  it("changes nothing on an ordinary display", () => {
    // Phaser's own default. At 1x this fix must be invisible, including in
    // texture memory.
    expect(textResolutionFor(MIN_RENDER_SCALE)).toBe(1);
    expect(textResolutionFor(0.5)).toBe(1);
    expect(textResolutionFor(Number.NaN)).toBe(1);
  });

  it("never asks for more than the buffer budget can produce", () => {
    const maxScale = Math.sqrt(MAX_BUFFER_PIXELS / (DESIGN_WIDTH * GAME_HEIGHT));
    expect(textResolutionFor(99)).toBe(Math.ceil(maxScale));
  });
});

/**
 * UR-35: THE CAP HAD TO BE AN AREA, NOT A RATIO.
 *
 * The first cut of UR-18 capped at `MAX_RENDER_SCALE = 2`, a RELATIVE ceiling
 * from design px to buffer px. A relative ceiling cannot express the thing it
 * was trying to express. The constraint is "this many fragments per frame is
 * too many", which is an AREA; a ratio against a design width that itself
 * grows with the window is not that, and it stops protecting sharpness exactly
 * where the display has the most pixels to protect.
 *
 * Measured, fixed build against the real pre-fix build (dist-play, built
 * before boot.ts changed), 10-90% glyph edge rise in physical px:
 *
 *   FIXED    1440x810 DSF2   upscale 1.00   rise p25 0.83   <- native, correct
 *   FIXED    1440x810 DSF1   upscale 0.75   rise p25 0.85   <- native reference
 *   FIXED    2560x1440 DSF2  upscale 1.33   rise p25 1.56   <- STILL BLURRED
 *   PRE-FIX  1440x810 DSF2   upscale 1.50   rise p25 1.60   <- the filed defect
 *
 * The third row is the second-to-last row. On a 5K Studio Display or a retina
 * iMac the "fixed" build was as soft as the build the user complained about.
 *
 * It also made the budget incoherent: at 32:9 the ratio of 2 already permitted
 * 7680x2160 = 16.6 Mpx, while denying a 16:9 5K display the 14.7 Mpx it needed
 * - refusing a SMALLER frame than it already allowed, purely because of the
 * shape of the window.
 */
describe("renderScaleFor caps on buffer AREA, not on a ratio (UR-35)", () => {
  /** design px the world occupies at a given design width; height is pinned. */
  const area = (designWidth: number, scale: number): number =>
    designWidth * GAME_HEIGHT * scale * scale;

  it("gives a 5K display its native resolution, which the ratio cap refused", () => {
    // 5120x2880 Studio Display / retina iMac: the browser reports a 2560x1440
    // CSS viewport at DPR 2. 16:9, so the world is the artboard.
    const scale = renderScaleFor(DESIGN_WIDTH, 2560, 2);
    // 2560 * 2 / 1920 = 2.667. The old cap of 2 gave a 3840x2160 buffer inside
    // a 5120x2880 canvas - a 1.33x magnification, i.e. the defect.
    expect(scale).toBeGreaterThanOrEqual(2560 * 2 / DESIGN_WIDTH);
    // Which is 14.7 Mpx - comfortably inside the budget, and LESS than the
    // 16.6 Mpx the old ratio cap already permitted at 32:9.
    expect(area(DESIGN_WIDTH, scale)).toBeLessThanOrEqual(MAX_BUFFER_PIXELS);
  });

  it("never exceeds the fragment budget, at any window shape", () => {
    // The property the cap exists for. Swept across every aspect the world can
    // take and every plausible density.
    for (let aspect = MIN_ASPECT; aspect <= MAX_ASPECT + 1e-9; aspect += 0.05) {
      const designWidth = Math.round(GAME_HEIGHT * aspect);
      for (const dpr of [1, 1.5, 2, 2.5, 3, 4]) {
        for (const cssWidth of [1024, 1440, 2560, 3440, 5120, 7680]) {
          const scale = renderScaleFor(designWidth, cssWidth, dpr);
          expect(area(designWidth, scale)).toBeLessThanOrEqual(MAX_BUFFER_PIXELS + 1);
          expect(scale).toBeGreaterThanOrEqual(MIN_RENDER_SCALE);
        }
      }
    }
  });

  it("spends the SAME budget whatever the window's shape", () => {
    // The incoherence the ratio had. A wide world and a narrow one are now
    // allowed the same number of fragments, so neither is privileged.
    const narrow = renderScaleFor(DESIGN_WIDTH, 99_999, 2);
    const wide = renderScaleFor(Math.round(GAME_HEIGHT * MAX_ASPECT), 99_999, 2);
    expect(area(DESIGN_WIDTH, narrow)).toBeCloseTo(MAX_BUFFER_PIXELS, -3);
    expect(area(Math.round(GAME_HEIGHT * MAX_ASPECT), wide)).toBeCloseTo(MAX_BUFFER_PIXELS, -3);
  });

  it("is never worse than the ratio cap it replaced, at any shape", () => {
    // THE NON-REGRESSION THIS CHANGE IS ALLOWED TO EXIST UNDER. The budget is
    // the old ratio's own theoretical maximum (32:9 at 2x), so no window can
    // now ask for a scale the old code would have refused as too expensive -
    // it can only ask for one the old code refused for the wrong reason.
    for (let aspect = MIN_ASPECT; aspect <= MAX_ASPECT + 1e-9; aspect += 0.05) {
      const designWidth = Math.round(GAME_HEIGHT * aspect);
      const now = renderScaleFor(designWidth, 99_999, 4);
      expect(now).toBeGreaterThanOrEqual(2 - 1e-9);
    }
  });

  it("still asks for exactly the pixels the canvas has, below the budget", () => {
    // The cap must not become a floor. Under budget, nothing changes.
    expect(renderScaleFor(DESIGN_WIDTH, 1440, 2)).toBe(1.5);
    expect(renderScaleFor(DESIGN_WIDTH, 1440, 1)).toBe(MIN_RENDER_SCALE);
    expect(renderScaleFor(DESIGN_WIDTH, 2560, 1)).toBe(1.5);
  });

  it("keeps the floor at 1 even if the budget would argue for less", () => {
    // A world so wide that the budget cannot afford 1:1 still renders at 1:1.
    // Sharpness is the feature; the budget is the constraint, and a buffer
    // below the design size is a NEW softness bug, not a saving.
    expect(renderScaleFor(50_000, 100_000, 2)).toBeGreaterThanOrEqual(MIN_RENDER_SCALE);
  });
});

describe("textResolutionFor tracks the new ceiling (UR-35)", () => {
  it("goes to 3 when the buffer does, so 5K words are not the soft thing left", () => {
    // The whole point of the text half: a denser buffer that the glyph texture
    // does not follow leaves every WORD as soft as it was.
    const fiveK = renderScaleFor(DESIGN_WIDTH, 2560, 2);
    expect(textResolutionFor(fiveK)).toBe(3);
  });

  it("is still a whole number, and still 1 on an ordinary display", () => {
    for (const s of [1, 1.25, 1.5, 2, 2.44, 2.83]) {
      expect(textResolutionFor(s)).toBe(Math.round(textResolutionFor(s)));
    }
    expect(textResolutionFor(MIN_RENDER_SCALE)).toBe(1);
  });

  it("never exceeds what the area budget can actually produce", () => {
    // The widest scale the budget permits is at the narrowest world.
    const maxScale = Math.sqrt(MAX_BUFFER_PIXELS / (DESIGN_WIDTH * GAME_HEIGHT));
    expect(textResolutionFor(99)).toBe(Math.ceil(maxScale));
  });
});
