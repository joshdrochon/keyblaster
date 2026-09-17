import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { freezeReloads } from "./support/lane";

/**
 * THERE IS NO LETTERBOX (AC-18.1, AC-22.9, FR-8, D99).
 *
 * ================== SIX REPORTS, FIVE DECORATIONS ==================
 * The game used to lay out at a FIXED 1920x1080 and scale with
 * `Phaser.Scale.FIT`, so every window that was not exactly 16:9 got a gap. Five
 * fixes landed and every one of them answered the question "what colour should
 * the gap be":
 *
 *   1. the game was centred twice, so the two gaps were different widths
 *      (375 left against 125 right at 21:9) - a real bug, fixed, still gaps
 *   2. the gap was painted with the stop's sky gradient - a bright bar beside a
 *      dark picture, measured rgb(16,41,80) against rgb(5,10,18) at y=300
 *   3. the frame's outermost 1px column was stretched outward - the seam closed
 *      and a 1px column stretched 100px wide is a flat band, so: still a bar
 *   4. the whole frame was drawn cover-scaled into the gap - the magnified copy
 *      has its OWN boundary, so a new vertical edge appeared at the join
 *   5. that copy was dimmed to 0.92 - the alpha step became the visible line
 *
 * The gap is created by the SCALE MODE, not by its colour. So the condition is
 * gone: the design width now follows the window's aspect at a pinned 1080
 * height (`sceneKeys.designWidthFor`), and `FIT` has nothing left to letterbox.
 *
 * ================== WITH ONE MEASURED EXCEPTION ==================
 * The world may get wider than the 1920 artboard. It may NOT get narrower. A
 * first cut let it narrow so a 4:3 window would fill too, and booting every
 * screen at that size and reading the live scene tree found content off the
 * right edge:
 *
 *   world 1440 (4:3)    Beacon Log +384 px   Results +272   Briefing +168
 *   world 1728 (16:10)  Beacon Log  +96 px   Results   +3
 *   world 1920 and up   nothing overflows
 *
 * Cropped content is what `Scale.ENVELOP` was rejected for under AC-18.1, and
 * doing the cropping sideways is not an improvement. So below 16:9 the world
 * stops narrowing and the window letterboxes TOP AND BOTTOM, where the
 * backdrop paints the stop's sky. Those windows are asserted differently here
 * and the difference is stated, not hidden: `fills: false` means "this ratio
 * still has a bar, and here is the invariant that earns it". `noOverflow`
 * below is that invariant, and it is what stops anyone removing the floor.
 *
 * ================== WHY NOT THE OTHER TWO ==================
 *   Scale.ENVELOP crops. At 21:9 it loses roughly 24% of the height, top and
 *   bottom, and that is exactly where the score, the hull marks and every
 *   screen's hint line live. AC-18.1 wants every control reachable; one
 *   scrolled off the top is not.
 *
 *   A taller world would break FR-8. The fall time is
 *   `len x keystrokeBudget + recognitionBudget` measured against a FIXED fall
 *   distance, so a taller world hands the player more seconds for the same
 *   word and the budget stops meaning one thing. Hence: flexible WIDTH, and
 *   the height stays pinned at 1080 - which this file asserts directly,
 *   because it is the invariant the width flex is allowed to exist under.
 *
 * ================== WHAT IS ASSERTED ==================
 * The property, not any one of the five causes:
 *
 *   1. the game canvas fills the viewport HORIZONTALLY at every ratio, and on
 *      every ratio at or above 16:9 it fills it on all four edges
 *   2. it is still centred, i.e. any slack is shared evenly
 *   3. the world is 1080 tall at every window (FR-8) and its width is the
 *      window's own aspect within the clamp, so nothing is stretched
 *   4. the picture actually REACHES the left and right edges, read out of a
 *      decoded screenshot rather than eyeballed
 *   5. and, separately, no screen's content runs off the world at any ratio -
 *      the property the 16:9 floor exists to protect
 *
 * (4) is measured off `page.screenshot()`, which is a compositor capture, not a
 * readback of the live WebGL canvas - reading the canvas directly returns
 * uniform garbage unless `preserveDrawingBuffer` is set, and two earlier
 * measurements of this very defect came back uniform for that reason.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = resolve(HERE, "../../gauntlet/evidence");

/** Pinned by FR-8. The width flexes; this does not. */
const DESIGN_HEIGHT = 1080;

/** The art-direction artboard width, and the floor the world never goes under. */
const DESIGN_WIDTH = 1920;

/** Mirrors `sceneKeys.MIN_ASPECT` / `MAX_ASPECT`. */
const MIN_ASPECT = 16 / 9;
const MAX_ASPECT = 32 / 9;

interface Aspect {
  /** File-name suffix: gauntlet/evidence/aspect-<name>.png */
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /**
   * True when the world can take this window's exact shape, i.e. 16:9 or
   * wider. False means the 16:9 floor applies and the window keeps a top and
   * bottom bar - stated here rather than quietly tolerated.
   */
  readonly fills: boolean;
}

const ASPECTS: readonly Aspect[] = [
  { name: "16x9", width: 1600, height: 900, fills: true },
  { name: "21x9", width: 2560, height: 1080, fills: true },
  // The window the defect was reported from: 2000x1010, aspect 1.98, which
  // used to yield 102 px of bar on each side.
  { name: "user-1.98", width: 2000, height: 1010, fills: true },
  { name: "ultrawide", width: 3440, height: 1440, fills: true },
  // Below the floor. The SIDE bars - the six-times-reported defect - are gone
  // at these too, because the world is exactly as wide as it needs to be; what
  // remains is a top and bottom bar, and `noOverflow` is why.
  { name: "16x10", width: 1600, height: 1000, fills: false },
  // 4:3 is the one shape a school laptop or an old classroom projector is
  // actually likely to be.
  { name: "4x3", width: 1024, height: 768, fills: false },
];

async function bootTitle(page: Page): Promise<void> {
  await freezeReloads(page);
  await page.goto("/?scene=Title");
  await expect(page.getByTestId("app")).toHaveAttribute("data-booted", "true");
  await page.waitForFunction(
    () => (window as unknown as { __kb?: unknown }).__kb !== undefined,
    null,
    { timeout: 60_000 },
  );
  // The scale manager's own refresh plus the title's entrance tweens.
  await page.waitForTimeout(1500);
}

interface EdgeSample {
  /** Vertical luminance spread down the 3px-in column, per edge. */
  leftSpread: number;
  rightSpread: number;
  /** Fraction of the edge column that is the bare page background. */
  leftVoid: number;
  rightVoid: number;
}

/**
 * Read the two vertical edges out of a decoded screenshot.
 *
 * A LETTERBOX BAR, whatever it is painted with, is FLAT down its length: a
 * fill, or a 1px column stretched a hundred px wide. The picture is not. So
 * the vertical spread of the outermost column is measured at both edges, plus
 * a second check for the degenerate case the first would pass - a uniform
 * strip of the page's own background colour, which has no spread either.
 */
async function sampleEdges(page: Page): Promise<EdgeSample> {
  const shot = (await page.screenshot()).toString("base64");
  return page.evaluate(async (data) => {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = `data:image/png;base64,${data}`;
    });
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    if (ctx === null) throw new Error("no 2d context");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;

    const at = (x: number, y: number): [number, number, number] => {
      const i = (y * c.width + x) * 4;
      return [d[i] ?? 0, d[i + 1] ?? 0, d[i + 2] ?? 0];
    };
    const lum = (x: number, y: number): number => {
      const [r, g, b] = at(x, y);
      return 0.299 * r + 0.587 * g + 0.114 * b;
    };
    const spread = (x: number): number => {
      const v: number[] = [];
      for (let y = 0; y < c.height; y += 8) v.push(lum(x, y));
      return Math.max(...v) - Math.min(...v);
    };
    // `#08111f` is index.html's page background and `INK.panel` is the WebGL
    // clear colour; either one filling an edge column means the picture did
    // not reach it.
    const voided = (x: number): number => {
      let n = 0;
      let total = 0;
      for (let y = 0; y < c.height; y += 4) {
        const [r, g, b] = at(x, y);
        total += 1;
        if (r <= 12 && g <= 20 && b <= 36) n += 1;
      }
      return n / Math.max(1, total);
    };

    const w = c.width;
    return {
      leftSpread: spread(3),
      rightSpread: spread(w - 4),
      leftVoid: voided(3),
      rightVoid: voided(w - 4),
    };
  }, shot);
}

test.describe("D99: the game fills the window at every aspect ratio", () => {
  test.setTimeout(120_000);

  test.beforeAll(() => {
    mkdirSync(EVIDENCE, { recursive: true });
  });

  for (const aspect of ASPECTS) {
    test(`${aspect.fills ? "no gap" : "no side gap"} at ${aspect.name} (${
      aspect.width
    }x${aspect.height}, aspect ${(aspect.width / aspect.height).toFixed(
      2,
    )})`, async ({ page }) => {
      await page.setViewportSize({ width: aspect.width, height: aspect.height });
      await bootTitle(page);

      const canvas = page.locator(
        '#app canvas:not([data-testid="viewport-backdrop"])',
      );
      const box = await canvas.boundingBox();
      expect(box, "the game canvas has no box").not.toBeNull();
      const frame = box as { x: number; y: number; width: number; height: number };

      const left = frame.x;
      const top = frame.y;
      const right = aspect.width - (frame.x + frame.width);
      const bottom = aspect.height - (frame.y + frame.height);

      // 1. NO SIDE GAP, EVER. Not "a nicely painted gap" - no gap. This is the
      //    defect that was reported six times, at every ratio in the list, and
      //    it is unconditional. One device-independent pixel of tolerance,
      //    because the design width is rounded to an integer and a browser
      //    rounds a fractional CSS size; anything an eye could resolve as a
      //    bar fails here.
      expect(left, `left gap of ${left}px`).toBeLessThanOrEqual(1);
      expect(right, `right gap of ${right}px`).toBeLessThanOrEqual(1);

      if (aspect.fills) {
        // At or above 16:9 the world takes the window's exact shape, so there
        // is nothing left on any edge.
        expect(top, `top gap of ${top}px`).toBeLessThanOrEqual(1);
        expect(bottom, `bottom gap of ${bottom}px`).toBeLessThanOrEqual(1);
      } else {
        // Below the floor: a top and bottom bar, and it is exactly the size
        // the 16:9 floor predicts - not some other amount that would mean
        // something else is wrong. See the header for the measurement that
        // put the floor there.
        const scale = aspect.width / DESIGN_WIDTH;
        const expected = (aspect.height - DESIGN_HEIGHT * scale) / 2;
        expect(Math.abs(top - expected), `top bar ${top}px, expected ${expected}px`).toBeLessThanOrEqual(1);
        // And it is PAINTED, not the page showing through - the backdrop is
        // still earning its place on these windows.
        const filled = await page.evaluate(() => {
          const c = document.querySelector<HTMLCanvasElement>(
            '[data-testid="viewport-backdrop"]',
          );
          const ctx = c?.getContext("2d") ?? null;
          if (c === null || ctx === null) return null;
          const d = ctx.getImageData(Math.round(c.width / 2), 4, 1, 1).data;
          return { a: d[3] ?? 0, sum: (d[0] ?? 0) + (d[1] ?? 0) + (d[2] ?? 0) };
        });
        expect(filled, "no backdrop canvas").not.toBeNull();
        expect((filled as { a: number }).a, "the top bar is not painted").toBe(255);
      }

      // 2. STILL CENTRED. Whatever sub-pixel slack rounding leaves is shared,
      //    which is the 2024 double-centring bug's assertion, kept.
      expect(
        Math.abs(left - right),
        `horizontal slack is asymmetric: ${left} left vs ${right} right`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(top - bottom),
        `vertical slack is asymmetric: ${top} top vs ${bottom} bottom`,
      ).toBeLessThanOrEqual(1);

      // 3. THE WORLD IS WIDER, NOT TALLER AND NOT STRETCHED.
      const world = await page.evaluate(() => {
        const kb = (window as unknown as { __kb: { game: Phaser.Game } }).__kb;
        return { w: kb.game.scale.width, h: kb.game.scale.height };
      });
      // FR-8: the fall distance is fixed, so the world height is fixed.
      expect(world.h, "FR-8: the world height must stay 1080").toBe(DESIGN_HEIGHT);
      // And the width is the window's own aspect, so the pixels are square:
      // the canvas's aspect and the world's aspect agree.
      const wanted = Math.min(
        MAX_ASPECT,
        Math.max(MIN_ASPECT, aspect.width / aspect.height),
      );
      expect(world.w, "the world narrowed below the artboard and will crop")
        .toBeGreaterThanOrEqual(DESIGN_WIDTH);
      expect(world.w / world.h).toBeCloseTo(wanted, 2);
      expect(
        frame.width / frame.height,
        "the canvas is stretched: its shape does not match the world's",
      ).toBeCloseTo(world.w / world.h, 2);

      // 4. THE PICTURE REACHES BOTH EDGES.
      const edge = await sampleEdges(page);

      // Not a flat slab. A painted-on bar has almost no vertical variation;
      // the game's own sky, with its gradient and its star field, has plenty.
      expect(edge.leftSpread, "the left edge is a flat slab").toBeGreaterThan(8);
      expect(edge.rightSpread, "the right edge is a flat slab").toBeGreaterThan(8);

      // And the edge is not simply the page showing through.
      expect(edge.leftVoid, "the left edge is bare background").toBeLessThan(0.5);
      expect(edge.rightVoid, "the right edge is bare background").toBeLessThan(0.5);

      // NO SEAM ASSERTION HERE, deliberately. A first draft compared the
      // outermost column against the picture 40 px in and required them to be
      // close. That measures the PICTURE, not a bar: run against a plain 16:9
      // window, which has never had a letterbox at all, it read 83 - asteroids
      // and terrain silhouettes legitimately differ from one column to the
      // next. An assertion that fails on the known-good configuration is
      // measuring the wrong thing, so it is gone rather than loosened. What
      // rules out a seam now is (1): with no gap there is no join to see.

      // 5. The backdrop's own arithmetic agrees there is no SIDE bar - it and
      //    the browser are measuring the same thing two different ways, so a
      //    disagreement means one of them is wrong about where the game is.
      const bars = await page.evaluate(() => {
        const kb = (window as unknown as { __kb: Record<string, unknown> }).__kb;
        const b = kb["backdrop"] as
          | { debug(): { barX: number; barY: number } }
          | null;
        return b === null ? null : b.debug();
      });
      expect(bars, "boot published no backdrop").not.toBeNull();
      const measured = bars as { barX: number; barY: number };
      expect(measured.barX, "the backdrop still computes a horizontal bar").toBeLessThanOrEqual(1);
      if (aspect.fills) {
        expect(measured.barY, "the backdrop still computes a vertical bar").toBeLessThanOrEqual(1);
      }

      await page.screenshot({
        path: resolve(EVIDENCE, `aspect-${aspect.name}.png`),
        fullPage: false,
      });
    });
  }
});

/**
 * DRAGGING THE WINDOW. The design width follows the window, so it has to keep
 * following it after boot - otherwise the first drag puts the bars straight
 * back and the fix only ever held for the size the page loaded at.
 */
test.describe("D99: the world follows a resized window", () => {
  test.setTimeout(120_000);

  test("widening and then narrowing the window leaves no gap", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await bootTitle(page);

    const gaps = async (w: number, h: number) => {
      await page.setViewportSize({ width: w, height: h });
      // Past the resize debounce and the relayout it triggers.
      await page.waitForTimeout(1500);
      return page.evaluate(
        ([vw, vh]) => {
          const el = document.querySelector<HTMLCanvasElement>(
            '#app canvas:not([data-testid="viewport-backdrop"])',
          );
          if (el === null) return null;
          const r = el.getBoundingClientRect();
          const kb = (window as unknown as { __kb: { game: Phaser.Game } }).__kb;
          return {
            left: r.left,
            right: (vw as number) - r.right,
            top: r.top,
            bottom: (vh as number) - r.bottom,
            worldW: kb.game.scale.width,
            worldH: kb.game.scale.height,
          };
        },
        [w, h] as [number, number],
      );
    };

    // All at or above 16:9, which is the range the world takes the window's
    // exact shape in. Below the floor a top bar is expected and the static
    // tests above cover it.
    for (const [w, h] of [
      [2560, 1080],
      [2000, 1010],
      [2200, 1000],
      [1600, 900],
    ] as const) {
      const g = await gaps(w, h);
      expect(g, `no canvas at ${w}x${h}`).not.toBeNull();
      const m = g as NonNullable<typeof g>;
      expect(m.left, `left gap ${m.left} at ${w}x${h}`).toBeLessThanOrEqual(1);
      expect(m.right, `right gap ${m.right} at ${w}x${h}`).toBeLessThanOrEqual(1);
      expect(m.top, `top gap ${m.top} at ${w}x${h}`).toBeLessThanOrEqual(1);
      expect(m.bottom, `bottom gap ${m.bottom} at ${w}x${h}`).toBeLessThanOrEqual(1);
      expect(m.worldH, "FR-8: the world height must stay 1080").toBe(DESIGN_HEIGHT);
    }
  });
});

/**
 * NOTHING RUNS OFF THE WORLD (AC-18.1).
 *
 * This is the invariant the 16:9 floor exists to protect, and it is asserted
 * separately so that the floor can never be quietly lowered to make the "no
 * gap" tests above pass at 4:3. It would: a 1440-wide world fills a 4:3 window
 * perfectly and pushes 384 px of the Beacon Log off the right-hand side.
 *
 * WHY IT READS THE SCENE TREE AND NOT A SCREENSHOT. "Is anything cut off" is
 * not answerable from a picture - the thing that is cut off is, by definition,
 * not in it. Every visible display object's world bounds are compared against
 * the world's own width instead, which is the same question asked where it can
 * actually be answered.
 *
 * WHAT IT LOOKS AT, AND WHY NOT EVERYTHING. Text and Zones: the words a child
 * reads and the hit areas a child reaches, which is AC-18.1's own wording. Not
 * the ambient art. The atmosphere layer drifts `kb/tex/mote` dust across the
 * frame at alpha ~0.18 and those motes overhang the right edge by 22 px and
 * the bottom by 20 px on a plain 1920x1080 window - deliberately, because a
 * particle field that stops dead at the frame edge reads as a wall. A first
 * draft of this test measured every display object and failed on those at
 * EVERY ratio including the one that has never had a defect, which is the
 * signature of an assertion measuring the wrong thing. Restricting it to Text
 * and Zone keeps every real failure: the overflows that put the 16:9 floor
 * there were a Zone at +384, +272 and +168 px.
 */
const OVERFLOW_SCREENS = [
  "Title",
  "DirectorMap",
  "BeaconLog",
  "Settings",
  "ProfilePicker",
  "Results",
  "Briefing",
] as const;

test.describe("AC-18.1: no screen's content runs off a flexed world", () => {
  test.setTimeout(240_000);

  for (const [w, h] of [
    [1024, 768],
    [1600, 1000],
    [1920, 1080],
    [2000, 1010],
    [2560, 1080],
    [3440, 1440],
  ] as const) {
    test(`nothing is cropped at ${w}x${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });

      for (const scene of OVERFLOW_SCREENS) {
        await freezeReloads(page);
        await page.goto(`/?scene=${scene}`);
        await page.waitForFunction(
          () => (window as unknown as { __kb?: unknown }).__kb !== undefined,
          null,
          { timeout: 60_000 },
        );
        await page.waitForTimeout(1200);

        const worst = await page.evaluate(() => {
          const game = (window as unknown as { __kb: { game: Phaser.Game } }).__kb
            .game;
          const W = game.scale.width;
          let right = 0;
          let left = 0;
          let culprit = "";
          const walk = (list: readonly Phaser.GameObjects.GameObject[]): void => {
            for (const o of list) {
              const kid = o as unknown as {
                list?: Phaser.GameObjects.GameObject[];
                visible?: boolean;
                type?: string;
                text?: string;
                getBounds?: () => Phaser.Geom.Rectangle;
              };
              if (Array.isArray(kid.list)) walk(kid.list);
              if (typeof kid.getBounds !== "function") continue;
              if (kid.visible === false) continue;
              // See the header: words and hit areas, not ambient particles.
              if (kid.type !== "Text" && kid.type !== "Zone") continue;
              let b: Phaser.Geom.Rectangle;
              try {
                b = kid.getBounds();
              } catch {
                continue;
              }
              // Skip degenerate and absurd boxes: an unsized graphics object
              // reports the whole float range and would drown the signal.
              if (!Number.isFinite(b.x) || b.width <= 0 || b.width > 100_000) {
                continue;
              }
              if (b.right - W > right) {
                right = b.right - W;
                culprit = `${kid.type ?? "?"} ${(kid.text ?? "").slice(0, 40)}`;
              }
              if (-b.left > left) left = -b.left;
            }
          };
          for (const s of game.scene.getScenes(true)) walk(s.children.list);
          return { W, right: Math.round(right), left: Math.round(left), culprit };
        });

        expect(
          worst.right,
          `${scene} runs ${worst.right}px past the right edge of a ${worst.W}-wide world (${worst.culprit})`,
        ).toBeLessThanOrEqual(4);
        expect(
          worst.left,
          `${scene} runs ${worst.left}px past the left edge`,
        ).toBeLessThanOrEqual(4);
      }
    });
  }
});
