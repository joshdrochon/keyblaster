import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { freezeReloads } from "./support/lane";

/**
 * THE GAME RENDERS AT THE SCREEN'S RESOLUTION (UR-18), AND THE WORLD DOES NOT
 * MOVE. Both halves, in one file, on purpose.
 *
 * ================== WHAT WAS WRONG ==================
 * The canvas drew 1920x1080 whatever the display. Probed on the frozen build:
 *
 *   deviceScaleFactor 1   drawing buffer 1920x1080   CSS box 1440x810
 *   deviceScaleFactor 2   drawing buffer 1920x1080   CSS box 1440x810
 *
 * Identical. At 2x that canvas covers 2880x1620 REAL pixels while being handed
 * 1920x1080, so the browser upscales everything about 1.5x - which is what
 * UR-18 was seeing when it reported the type and art looking soft on a retina
 * display. Nothing in `src/` had ever
 * read `devicePixelRatio`. All the art here is vector drawn in code (D83) and
 * would be pixel-perfect at any resolution; we were never asking for one.
 *
 * ================== WHY BOTH HALVES OR NEITHER ==================
 * The obvious fix - size the game in device pixels - is wrong here, and a test
 * that only checked sharpness would wave it through. `scene.scale.width` and
 * `scale.height` are read as DESIGN coordinates at 34 sites in the scene lane
 * (`this.scale.width - 260` anchors the HUD), and `scale.height` IS the fall
 * distance FR-8 measures its budget against. Moving the design space to get
 * pixels would relight the defect the whole D99 scale rebuild closed - the one
 * reported six times.
 *
 * So the resolution and the design space are separated: the projection stays
 * in design units and only the viewport and the drawing buffer become real
 * pixels (`boot.installPixelDensity`). This file asserts the pair:
 *
 *   BUFFER UP     the drawing buffer covers every physical pixel the canvas
 *                 occupies, so nothing is ever magnified
 *   WORLD STILL   `scale.width`, `scale.height`, the renderer's projection and
 *                 every camera are bit-identical at 1x and at 2x
 *
 * plus the two things the fix could plausibly break: the letterbox must not
 * come back, and TEXT must get sharper too without any layout moving.
 *
 * ================== HOW IT IS MEASURED ==================
 * The picture is read out of `page.screenshot()`, a compositor capture.
 * Reading the live WebGL canvas returns uniform garbage without
 * `preserveDrawingBuffer`, and that produced two wrong measurements of this
 * very defect before it was noticed.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = resolve(HERE, "../../gauntlet/evidence");

/** Pinned by FR-8, at every density. */
const DESIGN_HEIGHT = 1080;

/** The artboard width, which a 16:9 window gets exactly. */
const DESIGN_WIDTH = 1920;

/**
 * Mirrors `sceneKeys.MAX_BUFFER_PIXELS`: the fragment budget, as an AREA
 * (UR-35). It used to be a ratio of 2, which is what left a 5K display as
 * blurred as the build the user complained about.
 */
const MAX_BUFFER_PIXELS = 3840 * 1080 * 4;

/** A 16:9 window, so the world is exactly the artboard and nothing is clamped. */
const VIEWPORT = { width: 1440, height: 810 } as const;

interface Probe {
  /** `canvas.width/height` - the drawing buffer, in real pixels. */
  buffer: [number, number];
  /** The canvas's CSS box, in CSS px. */
  css: [number, number];
  /** Where that box sits in the viewport. Both zero means it starts at the corner. */
  origin: [number, number];
  dpr: number;
  renderScale: number;
  /** `scene.scale.width/height` - THE DESIGN SPACE. Must not move. */
  design: [number, number];
  /** The renderer's own size, which is what the projection is built from. */
  projection: [number, number];
  /** Every live camera: size, zoom and scroll, all in design units. */
  cameras: { key: string; box: [number, number]; zoom: number; scroll: [number, number] }[];
  /** Distinct `style.resolution` values across every live Text object. */
  textResolutions: number[];
  /** `x + displayWidth` of every Text, to prove no layout moved. */
  textLayout: number[];
}

async function probe(page: Page): Promise<Probe> {
  await freezeReloads(page);
  await page.goto("/?scene=Title");
  await expect(page.getByTestId("app")).toHaveAttribute("data-booted", "true");
  await page.waitForFunction(
    () => (window as unknown as { __kb?: unknown }).__kb !== undefined,
    null,
    { timeout: 60_000 },
  );
  // The scale manager's refresh, the first rendered frames, and the title's
  // entrance tweens.
  await page.waitForTimeout(1500);

  return page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const kb = (window as any).__kb;
    const game = kb.game;
    const canvas = game.canvas as HTMLCanvasElement;
    const box = canvas.getBoundingClientRect();

    const texts: any[] = [];
    const walk = (list: any[]): void => {
      for (const child of list) {
        if (child.type === "Text") texts.push(child);
        else if (child.type === "Container") walk(child.list);
      }
    };
    for (const scene of game.scene.getScenes(true)) walk(scene.children.list);

    return {
      buffer: [canvas.width, canvas.height],
      css: [Math.round(box.width), Math.round(box.height)],
      origin: [Math.round(box.left), Math.round(box.top)],
      dpr: window.devicePixelRatio,
      renderScale: typeof kb.renderScale === "function" ? kb.renderScale() : 1,
      design: [game.scale.width, game.scale.height],
      projection: [game.renderer.width, game.renderer.height],
      cameras: game.scene.getScenes(true).map((s: any) => ({
        key: s.sys.settings.key,
        box: [s.cameras.main.width, s.cameras.main.height],
        zoom: s.cameras.main.zoom,
        scroll: [s.cameras.main.scrollX, s.cameras.main.scrollY],
      })),
      textResolutions: [...new Set(texts.map((t) => t.style.resolution))].sort(),
      textLayout: texts.map((t) => Math.round((t.x + t.displayWidth) * 100) / 100),
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });
}

/**
 * The picture still reaches all four edges.
 *
 * Not a general goodness check - the specific regression this change could
 * cause. Getting the viewport and the buffer out of step draws the world into
 * one corner of the canvas and leaves the rest as clear colour, which is a
 * letterbox by another name, and that defect has been reported six times. It
 * happened once during this very fix: `renderer.resize` re-issued `gl.viewport`
 * at the design size after the buffer had been enlarged, and the whole game
 * rendered into the bottom-left 1920x1080 of a 2880x1620 buffer.
 *
 * A bar is FLAT down its length; the picture is not. So the outermost column
 * and row on each side are measured for vertical/horizontal spread.
 */
async function edgesAreLive(page: Page): Promise<Record<string, number>> {
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
    const lum = (x: number, y: number): number => {
      const i = (y * c.width + x) * 4;
      return 0.299 * (d[i] ?? 0) + 0.587 * (d[i + 1] ?? 0) + 0.114 * (d[i + 2] ?? 0);
    };
    const spreadDown = (x: number): number => {
      const v: number[] = [];
      for (let y = 0; y < c.height; y += 8) v.push(lum(x, y));
      return Math.max(...v) - Math.min(...v);
    };
    const spreadAcross = (y: number): number => {
      const v: number[] = [];
      for (let x = 0; x < c.width; x += 8) v.push(lum(x, y));
      return Math.max(...v) - Math.min(...v);
    };
    return {
      left: spreadDown(3),
      right: spreadDown(c.width - 4),
      top: spreadAcross(3),
      bottom: spreadAcross(c.height - 4),
    };
  }, shot);
}

/**
 * EVERY TEST HERE BOOTS A FULL WebGL GAME, and two of them boot a second one
 * at the other density. Headless Chromium rasterises in software - which is
 * why `playwright.config.ts` pins the worker count rather than letting
 * Playwright pick CPU/2 - and lanes run specs concurrently, so the default
 * 30 s budget is not the product's budget, it is the machine's.
 *
 * Measured: with six workers from another lane competing, the buffer test
 * timed out at 30 s having asserted nothing, which reads as a product failure
 * and is not one. The budget is widened; not one assertion is relaxed.
 */
test.describe.configure({ timeout: 120_000 });

test.describe("at an ordinary 1x display", () => {
  test.use({ viewport: VIEWPORT, deviceScaleFactor: 1 });

  test("renders at the design size, because the canvas is already downsampled", async ({
    page,
  }) => {
    const p = await probe(page);
    // 1440 CSS px of canvas on a 1x screen is 1440 real pixels for a 1920
    // design space: already sharper than 1:1. Asking for more here would be
    // pure fill cost (P-22.9) for nothing a child can see.
    expect(p.renderScale).toBe(1);
    expect(p.buffer).toEqual([DESIGN_WIDTH, DESIGN_HEIGHT]);
    // And Phaser's own default for text is untouched, texture memory included.
    expect(p.textResolutions).toEqual([1]);
  });
});

test.describe("at a 2x display", () => {
  test.use({ viewport: VIEWPORT, deviceScaleFactor: 2 });

  test("THE BUFFER COVERS EVERY PHYSICAL PIXEL, so nothing is magnified", async ({
    page,
  }) => {
    const p = await probe(page);
    const [cssW, cssH] = p.css;
    const [bufW, bufH] = p.buffer;

    expect(p.dpr).toBe(2);
    // The defect, stated as the assertion that would have caught it: the
    // buffer used to be 1920x1080 here, for a canvas covering 2880x1620.
    expect(bufW).toBeGreaterThanOrEqual(Math.round(cssW * p.dpr));
    expect(bufH).toBeGreaterThanOrEqual(Math.round(cssH * p.dpr));
    expect(bufW).toBeGreaterThan(DESIGN_WIDTH);
    expect(bufH).toBeGreaterThan(DESIGN_HEIGHT);
    // ...and not wastefully more. Pixels are fill, and the budget is an area.
    expect(bufW * bufH).toBeLessThanOrEqual(MAX_BUFFER_PIXELS);

    mkdirSync(EVIDENCE, { recursive: true });
    writeFileSync(resolve(EVIDENCE, "dpi-dsf2.png"), await page.screenshot());
  });

  test("THE DESIGN SPACE DOES NOT MOVE - the half that protects FR-8", async ({
    page,
  }) => {
    const p = await probe(page);
    // The world is the same world it is at 1x. If this ever goes red because
    // someone sized the game in device pixels, the fall distance FR-8 measures
    // its budget against has just doubled and every `this.scale.width - 260`
    // in the scene lane is anchored off-screen. Fix the resolution, not this.
    expect(p.design).toEqual([DESIGN_WIDTH, DESIGN_HEIGHT]);
    // The projection is built from the renderer's size, which is what keeps
    // design coordinates meaning design coordinates.
    expect(p.projection).toEqual([DESIGN_WIDTH, DESIGN_HEIGHT]);
    // No camera was zoomed or scrolled to compensate. `EndingScene` owns its
    // camera's zoom and reports it in the snapshot the rubric reads, so a
    // global camera zoom would be both stomped and visible as evidence drift.
    expect(p.cameras.length).toBeGreaterThan(0);
    for (const cam of p.cameras) {
      expect(cam.box).toEqual([DESIGN_WIDTH, DESIGN_HEIGHT]);
      expect(cam.zoom).toBe(1);
      expect(cam.scroll).toEqual([0, 0]);
    }
  });

  test("the WORDS get sharper too, and no layout moves", async ({
    page,
    browser,
    baseURL,
  }) => {
    const dense = await probe(page);
    // A Text object rasterises its string to a private canvas texture at
    // `style.resolution` and Phaser draws that texture at `width / resolution`.
    // A bigger buffer alone sharpens every SHAPE and leaves every LETTER
    // exactly as soft as it was - which is most of what a child is looking at.
    expect(dense.textResolutions.length).toBeGreaterThan(0);
    for (const res of dense.textResolutions) expect(res).toBeGreaterThan(1);

    // And the display size is resolution-independent, so NOTHING MOVED. The
    // same right-hand edge for every string as at 1x, to the hundredth of a
    // pixel. This is the assertion that stops the text fix becoming a layout
    // change in the UI lane's screens.
    // `browser.newContext` does NOT inherit the project's `use`, so the base
    // URL has to be handed over explicitly or the second page navigates
    // nowhere and the failure reads as a missing `__kb`.
    const plain = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      ...(baseURL === undefined ? {} : { baseURL }),
    });
    const sparse = await probe(await plain.newPage());
    await plain.close();

    expect(sparse.textResolutions).toEqual([1]);
    expect(dense.textLayout.length).toBeGreaterThan(0);
    expect(dense.textLayout).toEqual(sparse.textLayout);
  });

  test("the letterbox does not come back", async ({ page }) => {
    const p = await probe(page);

    // FIRST, THE PART THAT NEEDS NO PIXELS. This viewport is exactly 16:9, so
    // the world takes its shape and `FIT` has nothing to letterbox: the canvas
    // must start at the corner and cover the window. Deterministic - it does
    // not depend on what the Title happens to be drawing.
    expect(p.origin).toEqual([0, 0]);
    expect(p.css).toEqual([VIEWPORT.width, VIEWPORT.height]);

    // THEN THE PIXELS, for the failure the box check cannot see. Getting the
    // viewport and the buffer out of step draws the world into one CORNER of
    // a correctly sized canvas and leaves the rest as clear colour - which
    // happened once while this fix was being built: `renderer.resize`
    // re-issued `gl.viewport` at the design size after the buffer had been
    // enlarged, and the whole game rendered into the bottom-left 1920x1080 of
    // a 2880x1620 buffer, with a flat black bar across the top and down the
    // right. A bar is FLAT down its length; the picture is not.
    const edges = await edgesAreLive(page);

    // Left and right catch the six-times-reported SIDE bars, and the top row
    // catches the corner failure above. All three carry the sky gradient and
    // the wordmark, so all three vary by 38+ in practice.
    //
    // THE BOTTOM ROW IS NOT ASSERTED, deliberately. It is the ground band -
    // flat dark by art direction, and it measured a spread of 0 to 2 across
    // every aspect probed. An assertion on it would be asserting the art, and
    // it would pass or fail on where the parallax happened to have drifted to.
    // It went in as one, passed once, and was measured out again rather than
    // left to fail on someone else's night.
    for (const side of ["left", "right", "top"] as const) {
      expect(
        edges[side],
        `${side} edge is flat - the picture does not reach it`,
      ).toBeGreaterThan(8);
    }
  });
});

/**
 * UR-35: A LARGE RETINA DISPLAY, which is where the first fix stopped working.
 *
 * 2560x1440 at DPR 2 is what the browser reports on a 5K Studio Display or a
 * retina iMac - 5120x2880 real pixels. The first cut of this fix capped the
 * buffer at a RATIO of 2, so it handed that canvas a 3840x2160 buffer and the
 * browser magnified it 1.33x. Measured against the real pre-fix build, the
 * 10-90% glyph edge rise came out at p25 1.56 physical px, against the FILED
 * DEFECT's 1.60 and a native render's 0.85. The user's own complaint, intact,
 * on the displays with the most pixels to lose.
 *
 * This is the test that would have caught it. It is deliberately a separate
 * viewport rather than another assertion in the 2x block, because the whole
 * defect was that one window size passed and another did not.
 */
test.describe("at a 5K-class retina display (UR-35)", () => {
  test.use({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 2 });

  test("THE BUFFER STILL COVERS EVERY PHYSICAL PIXEL - no magnification", async ({
    page,
  }) => {
    const p = await probe(page);
    const [cssW, cssH] = p.css;
    const [bufW, bufH] = p.buffer;

    expect(p.dpr).toBe(2);
    // 2560 CSS px at DPR 2 is 5120 real pixels for a 1920 design space, so the
    // scale needed is 2.667 - past the ratio of 2 that used to be the cap.
    expect(p.renderScale).toBeGreaterThan(2);
    // The assertion the ratio cap failed: cover the canvas, do not magnify it.
    expect(bufW).toBeGreaterThanOrEqual(Math.round(cssW * p.dpr));
    expect(bufH).toBeGreaterThanOrEqual(Math.round(cssH * p.dpr));
    // And still inside the fragment budget - 14.7 Mpx against 16.6.
    expect(bufW * bufH).toBeLessThanOrEqual(MAX_BUFFER_PIXELS);

    mkdirSync(EVIDENCE, { recursive: true });
    writeFileSync(resolve(EVIDENCE, "dpi-5k.png"), await page.screenshot());
  });

  test("the design space is STILL unmoved at 2.67x, and the words follow", async ({
    page,
  }) => {
    const p = await probe(page);
    // The half that protects FR-8 has to hold at the new ceiling too - a
    // bigger buffer is only ever allowed to buy resolution.
    expect(p.design).toEqual([DESIGN_WIDTH, DESIGN_HEIGHT]);
    expect(p.projection).toEqual([DESIGN_WIDTH, DESIGN_HEIGHT]);
    for (const cam of p.cameras) {
      expect(cam.box).toEqual([DESIGN_WIDTH, DESIGN_HEIGHT]);
      expect(cam.zoom).toBe(1);
      expect(cam.scroll).toEqual([0, 0]);
    }
    // Text has to follow the buffer past 2 as well, or a 5K display gets sharp
    // shapes and soft words - the complaint surviving in the half that matters.
    expect(p.textResolutions.length).toBeGreaterThan(0);
    for (const res of p.textResolutions) expect(res).toBeGreaterThanOrEqual(3);
  });
});
