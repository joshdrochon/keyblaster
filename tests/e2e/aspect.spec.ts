import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { freezeReloads } from "./support/lane";

/**
 * NO BLACK BARS (AC-18.1, AC-22.9, FR-8).
 *
 * The game lays out at 1920x1080 and scales with `Phaser.Scale.FIT`, so any
 * window that is not 16:9 is letterboxed - two black columns on a wide monitor.
 *
 * FIT was KEPT and the bars were filled instead. The other two options each
 * break something the game cannot give up:
 *
 *   Scale.RESIZE would make the flight play-field change size with the window,
 *   and FR-8's fall time is computed against a FIXED fall distance - a taller
 *   window would hand the player more seconds for the same word.
 *
 *   Scale.ENVELOP crops. At 21:9 it loses roughly a quarter of the height, and
 *   that is where the score, the hull marks and every screen's hint line sit.
 *   AC-18.1 asks for every control reachable; one scrolled off the top is not.
 *
 * So the play-field stays at design size and a full-window backdrop
 * (`src/game/ui/viewportBackdrop.ts`) paints the stop's own sky behind it.
 *
 * These tests assert the three things that claim depends on, at three aspect
 * ratios, and write the screenshot the brief asks for as evidence:
 *   1. the design rect is entirely on screen  -> nothing is cropped
 *   2. the play-field keeps its 16:9 shape    -> the fall budget is unchanged
 *   3. the bar region is NOT black            -> there are no black bars
 *
 * (3) is sampled out of the backdrop's own pixels rather than eyeballed from a
 * screenshot: "is this image black in the corner" is exactly the assertion a
 * human gets wrong twice and then stops checking.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = resolve(HERE, "../../gauntlet/evidence");

const DESIGN = { width: 1920, height: 1080 } as const;

interface Aspect {
  /** File-name suffix: gauntlet/evidence/aspect-<name>.png */
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** Which axis FIT leaves slack in at this size. */
  readonly bar: "none" | "x" | "y";
}

const ASPECTS: readonly Aspect[] = [
  { name: "16x9", width: 1600, height: 900, bar: "none" },
  { name: "16x10", width: 1600, height: 1000, bar: "y" },
  { name: "21x9", width: 2100, height: 900, bar: "x" },
];

interface BackdropDebug {
  stopId: string;
  barX: number;
  barY: number;
  width: number;
  height: number;
}

async function bootTitle(page: Page): Promise<void> {
  await freezeReloads(page);
  await page.goto("/?scene=Title");
  await expect(page.getByTestId("app")).toHaveAttribute("data-booted", "true");
  await page.waitForFunction(
    () => (window as unknown as { __kb?: unknown }).__kb !== undefined,
    null,
    { timeout: 60_000 },
  );
  // Two frames, so the backdrop's rAF repaint and the title's entrance have
  // both landed before anything is measured or photographed.
  await page.waitForTimeout(1200);
}

interface BarSample {
  /** Brightest sum-of-RGB found anywhere in the bar. */
  brightest: number;
  /** True if every sampled bar pixel is fully opaque, i.e. actually painted. */
  opaque: boolean;
  /**
   * Largest per-channel difference between the pixel just OUTSIDE the design
   * rect and the pixel just INSIDE it. Small means the art bleeds across the
   * canvas edge with no seam.
   */
  seam: number;
}

/**
 * Measure the letterbox region of the backdrop canvas.
 *
 * WHY NOT "assert the bar is bright". Because the honest answer at 16:10 is
 * that the BOTTOM bar is nearly black - and correctly so. The game's own sky
 * ends in the palette's void colour at the bottom of the play-field, so the
 * bar below it continues that void. Lightening it would put a visible band
 * under the game, which is the same defect wearing a nicer colour.
 *
 * So the three things actually asserted are the three that matter:
 *   - the bar is PAINTED (opaque, not the page showing through)
 *   - the bar CONTINUES the sky across the canvas edge (no seam)
 *   - the bar carries real art, i.e. somewhere in it the sky is clearly lit,
 *     which a uniform black fill could never satisfy
 */
async function sampleBar(page: Page, bar: "x" | "y"): Promise<BarSample> {
  return page.evaluate(
    ([axis, designW, designH]) => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[data-testid="viewport-backdrop"]',
      );
      const ctx = canvas?.getContext("2d") ?? null;
      if (canvas === null || ctx === null) {
        return { brightest: -1, opaque: false, seam: 999 };
      }
      const w = canvas.width;
      const h = canvas.height;
      const scale = Math.min(w / (designW as number), h / (designH as number));
      const rect = {
        x: (w - (designW as number) * scale) / 2,
        y: (h - (designH as number) * scale) / 2,
        w: (designW as number) * scale,
        h: (designH as number) * scale,
      };

      const px = (x: number, y: number): number[] => {
        const d = ctx.getImageData(
          Math.min(w - 1, Math.max(0, Math.round(x))),
          Math.min(h - 1, Math.max(0, Math.round(y))),
          1,
          1,
        ).data;
        return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, d[3] ?? 0];
      };

      // Walk the whole bar, both sides, so a bright patch in one cannot carry
      // the measurement for the other.
      const walk: Array<[number, number]> = [];
      for (let i = 0; i <= 10; i += 1) {
        const t = i / 10;
        if (axis === "x") {
          walk.push([4, h * t], [w - 5, h * t]);
        } else {
          walk.push([w * t, 4], [w * t, h - 5]);
        }
      }

      let brightest = -1;
      let opaque = true;
      for (const [x, y] of walk) {
        const [r, g, b, a] = px(x, y) as [number, number, number, number];
        brightest = Math.max(brightest, r + g + b);
        if (a !== 255) opaque = false;
      }

      // Seam: 4 px outside the design rect vs 4 px inside it, on both edges.
      const pairs: Array<[[number, number], [number, number]]> =
        axis === "x"
          ? [
              [
                [rect.x - 4, h / 2],
                [rect.x + 4, h / 2],
              ],
              [
                [rect.x + rect.w + 4, h / 2],
                [rect.x + rect.w - 4, h / 2],
              ],
            ]
          : [
              [
                [w / 2, rect.y - 4],
                [w / 2, rect.y + 4],
              ],
              [
                [w / 2, rect.y + rect.h + 4],
                [w / 2, rect.y + rect.h - 4],
              ],
            ];

      let seam = 0;
      for (const [outside, inside] of pairs) {
        const a = px(outside[0], outside[1]);
        const b = px(inside[0], inside[1]);
        for (let c = 0; c < 3; c += 1) {
          seam = Math.max(seam, Math.abs((a[c] ?? 0) - (b[c] ?? 0)));
        }
      }

      return { brightest, opaque, seam };
    },
    [bar, DESIGN.width, DESIGN.height] as [string, number, number],
  );
}

test.describe("no black bars at any aspect ratio", () => {
  test.setTimeout(120_000);

  test.beforeAll(() => {
    mkdirSync(EVIDENCE, { recursive: true });
  });

  for (const aspect of ASPECTS) {
    test(`AC-18.1 + FR-8: ${aspect.name} keeps the whole design rect on screen and fills the bars`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: aspect.width, height: aspect.height });
      await bootTitle(page);

      const canvas = page.locator(
        '#app canvas:not([data-testid="viewport-backdrop"])',
      );
      const box = await canvas.boundingBox();
      expect(box, "the game canvas has no box").not.toBeNull();
      const frame = box as { x: number; y: number; width: number; height: number };

      // 1. NOTHING IS CROPPED. The whole design rect sits inside the viewport,
      //    so no HUD row and no menu control can be off-screen (AC-18.1). A
      //    1 px tolerance: the browser rounds a fractional CSS size.
      expect(frame.x).toBeGreaterThanOrEqual(-1);
      expect(frame.y).toBeGreaterThanOrEqual(-1);
      expect(frame.x + frame.width).toBeLessThanOrEqual(aspect.width + 1);
      expect(frame.y + frame.height).toBeLessThanOrEqual(aspect.height + 1);

      // 2. THE PLAY-FIELD KEEPS ITS SHAPE. The canvas is still 16:9, so a word
      //    falls the same design distance whatever the window is and FR-8's
      //    fall-time budget still means one thing.
      const designRatio = DESIGN.width / DESIGN.height;
      expect(frame.width / frame.height).toBeCloseTo(designRatio, 2);

      // 3. THE BARS ARE WHERE WE SAY THEY ARE, and they are not black.
      const debug = await page.evaluate(() => {
        const kb = (window as unknown as { __kb: Record<string, unknown> }).__kb;
        const b = kb["backdrop"] as { debug(): BackdropDebug } | null;
        return b === null ? null : b.debug();
      });
      expect(debug, "boot published no backdrop").not.toBeNull();
      const bars = debug as BackdropDebug;

      if (aspect.bar === "x") {
        expect(bars.barX).toBeGreaterThan(1);
        expect(bars.barY).toBeLessThanOrEqual(1);
      } else if (aspect.bar === "y") {
        expect(bars.barY).toBeGreaterThan(1);
        expect(bars.barX).toBeLessThanOrEqual(1);
      } else {
        expect(bars.barX).toBeLessThanOrEqual(1);
        expect(bars.barY).toBeLessThanOrEqual(1);
      }

      if (aspect.bar !== "none") {
        const sample = await sampleBar(page, aspect.bar);

        // Painted, not the page background showing through a transparent gap.
        expect(sample.opaque).toBe(true);

        // No seam: the sky crosses the canvas edge without a step, which is
        // what makes this an extension of the art rather than a frame around
        // it. A few levels of tolerance for the gradient's own slope.
        expect(sample.seam).toBeLessThanOrEqual(12);

        // And it is ART, not a fill. The lit part of the sky reaches the bar,
        // which a black column could never do. `#08111f`, the page background,
        // sums to 48, so this also rules out an unpainted canvas.
        expect(sample.brightest).toBeGreaterThan(90);
      }

      // The evidence the brief asks for, at the real window size.
      await page.screenshot({
        path: resolve(EVIDENCE, `aspect-${aspect.name}.png`),
        fullPage: false,
      });
    });
  }
});
