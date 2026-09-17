import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  activeScenes,
  freezeReloads,
  restartScene,
  waitForScene,
} from "./support/lane.js";

const BOOT_MODULE = "/src/game/flight/boot.ts";

/**
 * R-world's evidence (design-reference/refs/WORLD-BAR.md).
 *
 * The rubric item compares `gauntlet/evidence/flight-frame.png` against a real
 * Alto's Odyssey frame and CANNOT be auto-passed - a person looks at both, the
 * way the Lantern and Shadow were judged. This spec's whole job is to produce
 * the render honestly: the shipped Flight scene, the shipped Mars palette, a
 * belt with rocks actually on it, at design resolution.
 *
 * It also asserts the two things about the frame that CAN be checked without a
 * pair of eyes, because an evidence producer that cannot fail is a screenshot
 * script, not a test:
 *   - the frame has a real value range end to end (WORLD-BAR items 1-3)
 *   - the depth ladder the scene reports matches the one the pixels show
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EVIDENCE = join(REPO, "gauntlet", "evidence");

/** Sample grid: 5 rows x 9 columns of 12px patches, as mean luminance 0..1. */
type Grid = { rows: number[][]; min: number; max: number };

test("R-world: the flight frame has a real value range, and a render to judge", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await freezeReloads(page);
  // The flight lane's own launcher, for the same reason flight.spec.ts uses it:
  // `src/main.ts` boots the WHOLE game on page load, and two Phaser instances
  // on one canvas stack is not the screen anyone wants to look at.
  // `pixelReadback` keeps a back buffer so the canvas can be read back at all;
  // it is gated because it costs frame time.
  await page.route("**/src/main.ts", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: "export {};" }),
  );
  await page.goto("/");
  await page.evaluate(async (moduleUrl) => {
    const mod = (await import(moduleUrl)) as { bootFlight: (o: unknown) => void };
    mod.bootFlight({ debug: true, pixelReadback: true, stopId: "mars", seed: 20260916 });
  }, BOOT_MODULE);
  // `window.__kbFlight` is declared by `src/game/scenes/FlightScene.ts`; these
  // predicates run in the page, so the shape only has to be right there.
  await page.waitForFunction(
    () => (window as unknown as { __kbFlight?: unknown }).__kbFlight !== undefined,
    null,
    { timeout: 20_000 },
  );

  // Let a belt actually populate: an empty sky is not the screen being judged.
  await page.waitForFunction(
    () => {
      const api = (window as unknown as {
        __kbFlight?: { state(): { rocks: unknown[] } };
      }).__kbFlight;
      return (api?.state().rocks.length ?? 0) > 0;
    },
    null,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(2500);

  const grid = (await page.evaluate(() => {
    const canvas = document.querySelector("canvas") as HTMLCanvasElement;
    const off = document.createElement("canvas");
    off.width = canvas.width;
    off.height = canvas.height;
    const ctx = off.getContext("2d") as CanvasRenderingContext2D;
    ctx.drawImage(canvas, 0, 0);
    const rows: number[][] = [];
    let min = 1;
    let max = 0;
    for (let r = 0; r < 5; r += 1) {
      const row: number[] = [];
      for (let c = 0; c < 9; c += 1) {
        const x = Math.round(canvas.width * (0.06 + 0.11 * c));
        const y = Math.round(canvas.height * (0.08 + 0.2 * r));
        const patch = ctx.getImageData(x, y, 12, 12).data;
        let sum = 0;
        for (let i = 0; i < patch.length; i += 4) {
          sum +=
            0.2126 * (patch[i] as number) +
            0.7152 * (patch[i + 1] as number) +
            0.0722 * (patch[i + 2] as number);
        }
        const v = sum / (patch.length / 4) / 255;
        row.push(Number(v.toFixed(4)));
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
      rows.push(row);
    }
    return { rows, min, max };
  })) as Grid;

  const shot = await page.screenshot({ type: "png" });

  /**
   * THE MEASUREMENT THAT REPLACED "does it look flat".
   *
   * A blind critic measured our frame and `alto-03` into L* buckets and found
   * the gap nobody's eye had named in three judge rounds:
   *
   *   L* bucket   0-40    40-60   60-80   80+
   *   ours        14.5%   16.9%   67.8%   0.9%
   *   alto-03     48.3%   32.1%   17.4%   2.4%
   *
   * Two thirds of the picture in one twenty-point box. The global L*5-95 range
   * looked fine at the time - it was an artifact of the near-edge cliffs, which
   * have since been removed for a separate reason.
   *
   * The thresholds below are BASELINED ON THE CURRENT FRAME, not on the bar, and
   * that is deliberate and stated: the bar's 48% below L*40 comes from land
   * filling the lower half of a side-scroller's frame, and this is a vertical
   * scroller where a plane that fills the lower half of the tile becomes a band
   * (see `massifTile`). What is asserted is the ground taken so far, so it
   * cannot be given back silently.
   */
  const value = (await page.evaluate(async (b64: string) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const cx2 = c.getContext("2d") as CanvasRenderingContext2D;
    cx2.drawImage(img, 0, 0);
    const px = cx2.getImageData(0, 0, c.width, c.height).data;
    const lin = (v: number): number => {
      const u = v / 255;
      return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
    };
    const buckets = [0, 0, 0, 0];
    let above90 = 0;
    const n = px.length / 4;
    for (let i = 0; i < n; i += 1) {
      const y =
        0.2126 * lin(px[i * 4] as number) +
        0.7152 * lin(px[i * 4 + 1] as number) +
        0.0722 * lin(px[i * 4 + 2] as number);
      const L = 116 * (y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116) - 16;
      if (L >= 90) above90 += 1;
      const k = L < 40 ? 0 : L < 60 ? 1 : L < 80 ? 2 : 3;
      buckets[k] = (buckets[k] as number) + 1;
    }
    const pct = (v: number): number => Number((((v ?? 0) / n) * 100).toFixed(1));
    return {
      below40: pct(buckets[0] as number),
      mid: pct(buckets[1] as number),
      upper: pct(buckets[2] as number),
      above80: pct(buckets[3] as number),
      above90: Number(((above90 / n) * 100).toFixed(2)),
    };
  }, shot.toString("base64"))) as {
    below40: number;
    mid: number;
    upper: number;
    above80: number;
    above90: number;
  };

  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, "flight-frame.png"), shot);
  writeFileSync(
    join(EVIDENCE, "flight-frame.json"),
    `${JSON.stringify(
      {
        item: "R-world",
        reference: "design-reference/refs/world-bar.png",
        render: "gauntlet/evidence/flight-frame.png",
        stopId: "mars",
        valueRange: { min: Number(grid.min.toFixed(4)), max: Number(grid.max.toFixed(4)) },
        lightnessBuckets: value,
        barForComparison: {
          source: "design-reference/refs/alto-03_PalmKicker.png",
          below40: 48.2,
          mid: 32.0,
          upper: 17.3,
          above80: 2.4,
          above90: 2.09,
        },
        sampleGrid: grid.rows,
        capturedAt: new Date().toISOString(),
        note: "A reference compare is never auto-passed (D85). This file records the measurable half only.",
      },
      null,
      2,
    )}\n`,
  );

  // WORLD-BAR item 2. The frame this replaced spanned about three steps of one
  // brown; every patch of it sat in the same third of the range. A frame with a
  // front and a back has both ends of the range in it somewhere.
  expect(grid.max - grid.min, "value range across the frame").toBeGreaterThan(0.35);
  expect(grid.min, "somewhere in the frame is genuinely dark").toBeLessThan(0.2);

  // RE-BASELINED, AND SAID OUT LOUD. The frame measured 13.1 / 19.2 / 66.7 / 1.0
  // before this round's sky and depth-ramp work and 33.4 / 22.8 / 41.7 / 2.1
  // after it, against the bar's 48.2 / 32.0 / 17.3 / 2.4. These floors sit just
  // under what was achieved, so the ground cannot be given back quietly - they
  // are NOT set at the bar, because the bar's dark half is land filling the
  // bottom of a side-scroller's frame and this is a vertical scroller.
  expect(value.below40, "share of the frame below L*40").toBeGreaterThan(28);
  expect(value.upper, "share of the frame in the L*60-80 box").toBeLessThan(48);
  // WORLD-BAR item 4: there is a light in the frame and it is the brightest
  // thing in it. Before this round the brightest non-UI pixel was a 3 px star
  // sparkle and 0.9% of the frame was above L*90.
  expect(value.above90, "share of the frame above L*90 (the light)").toBeGreaterThan(1.1);
});

/**
 * THE TITLE, as a judged frame.
 *
 * The player is looking at this screen, and it is the first thing a hackathon
 * judge sees - so R-world's evidence cannot be a Flight capture alone. It also
 * exercises the one stop the Flight capture never does: Title opens on the
 * furthest beacon, which for a first-time player is EARTH, and Earth is a dark
 * stop. Every defect in the dark branch of `foregroundInk` - including the
 * near-white slabs this round fixes - was invisible on Mars.
 *
 * This lives here rather than in `title.spec.ts` on purpose: that file is the
 * UI lane's, and its three evidence artifacts are a named contract with
 * `rubric.mjs`. This one is R-world's evidence and belongs with R-world's.
 */
test("R-world: the Title frame is ONE SEAMLESS SCREEN - no vertical bar down either edge", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await freezeReloads(page);
  await page.goto("/?scene=Title");
  await expect(page.getByTestId("app")).toHaveAttribute("data-booted", "true");
  await waitForScene(page, "Title", 30_000);
  // Let the entrance tweens land and the world scroll a little, so the frame
  // being judged is the screen as played rather than as constructed.
  await page.waitForTimeout(2200);

  const shot = await page.screenshot({ type: "png" });

  // SAMPLED FROM THE SCREENSHOT, not from the live canvas.
  //
  // The first version of this read the canvas back directly, the way the Flight
  // capture above does - and the three regions came back equal to five decimal
  // places, i.e. it was measuring an empty buffer and the assertion could not
  // fail. That path only works because the Flight launcher opts into
  // `pixelReadback`, which keeps a back buffer; Title boots normally, so its
  // WebGL drawing buffer is gone by the time script runs. Decoding the PNG that
  // is being written as evidence measures exactly the frame being judged, needs
  // no image dependency, and cannot silently read nothing.
  /**
   * THE MEASUREMENT THIS SCREEN EXISTS FOR, AND WHY IT CHANGED DIRECTION.
   *
   * The old version of this test asserted that the frame's edge bands were
   * DARKER than 0.42 and that they DIFFERED from the centre by more than 0.01 -
   * the second clause on the reasoning that "the near plane must be
   * distinguishable from the sky behind it" (art-direction section 2 puts a dark
   * stop's near plane above its sky in value).
   *
   * That second clause was requiring the defect. A near plane that runs down
   * both vertical edges and is distinguishable from what is behind it IS a
   * border, and on Earth - a dark stop, so the near plane is the LIGHTER of the
   * two - it is a pale border. A player reported it three times, the last time
   * as: "the bars on the left and right are still there... should be one
   * seamless screen." The test was green through all three reports.
   *
   * So the claim is inverted, and it is measured as a BAR rather than as a
   * brightness. A landform that happens to reach an edge is fine and the
   * reference is full of them; what is not fine is a band present at nearly
   * every height. So: for each row of the picture, is the edge sample far from
   * that row's own middle? A bar answers yes on almost every row. A landform
   * answers yes on some of them.
   */
  const bars = (await page.evaluate(async (b64: string) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const off = document.createElement("canvas");
    off.width = img.naturalWidth;
    off.height = img.naturalHeight;
    const ctx = off.getContext("2d") as CanvasRenderingContext2D;
    ctx.drawImage(img, 0, 0);
    const W = off.width;
    const H = off.height;
    const d = ctx.getImageData(0, 0, W, H).data;
    const lum = (x: number, y: number): number => {
      const i = (y * W + x) * 4;
      return (
        (0.2126 * (d[i] as number) +
          0.7152 * (d[i + 1] as number) +
          0.0722 * (d[i + 2] as number)) /
        255
      );
    };
    const meanRow = (y: number, x0: number, x1: number): number => {
      let sum = 0;
      for (let x = x0; x < x1; x += 1) sum += lum(x, y);
      return sum / Math.max(1, x1 - x0);
    };

    const band = Math.round(W * 0.035);
    // Rows are sampled across the whole height. The HUD-free Title has type on
    // the left, so the "middle" reference is taken from the centre fifth, which
    // no chrome occupies on any screen in the game.
    const rows: { y: number; left: number; right: number; mid: number }[] = [];
    for (let i = 0; i < 64; i += 1) {
      const y = Math.round(((i + 0.5) / 64) * (H - 1));
      rows.push({
        y,
        left: meanRow(y, 0, band),
        right: meanRow(y, W - band, W),
        mid: meanRow(y, Math.round(W * 0.4), Math.round(W * 0.6)),
      });
    }
    // 0.035 of the luminance range is roughly nine 8-bit levels: below that an
    // edge is not reading as a separate thing at all.
    const DIFFERENT = 0.035;
    const leftRows = rows.filter((r) => Math.abs(r.left - r.mid) > DIFFERENT).length;
    const rightRows = rows.filter((r) => Math.abs(r.right - r.mid) > DIFFERENT).length;
    return {
      rows: rows.length,
      leftRowsDifferent: leftRows,
      rightRowsDifferent: rightRows,
      leftFraction: Number((leftRows / rows.length).toFixed(3)),
      rightFraction: Number((rightRows / rows.length).toFixed(3)),
      meanLeft: Number((rows.reduce((a, r) => a + r.left, 0) / rows.length).toFixed(4)),
      meanRight: Number((rows.reduce((a, r) => a + r.right, 0) / rows.length).toFixed(4)),
      meanMid: Number((rows.reduce((a, r) => a + r.mid, 0) / rows.length).toFixed(4)),
    };
  }, shot.toString("base64"))) as {
    rows: number;
    leftRowsDifferent: number;
    rightRowsDifferent: number;
    leftFraction: number;
    rightFraction: number;
    meanLeft: number;
    meanRight: number;
    meanMid: number;
  };

  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, "title-frame.png"), shot);
  writeFileSync(
    join(EVIDENCE, "title-frame.json"),
    `${JSON.stringify(
      {
        item: "R-world (Title)",
        render: "gauntlet/evidence/title-frame.png",
        stopId: "earth",
        claim: "one seamless screen: neither vertical edge carries a band at most heights",
        edgeBands: bars,
        capturedAt: new Date().toISOString(),
        note: "A reference compare is never auto-passed (D85). This records the measurable half.",
      },
      null,
      2,
    )}\n`,
  );

  // A LANDFORM MAY TOUCH AN EDGE. A BAND MAY NOT RUN DOWN ONE.
  //
  // 0.45 is the line: terrain reaching an edge over a third of the height is
  // scenery, and something present over nearly half of it is a frame. The
  // `canyonWalls` this replaces scored close to 1.0 on both edges, so the gap
  // between passing and the defect is not a tuned margin.
  expect(
    bars.leftFraction,
    `left edge differs from the middle on ${bars.leftRowsDifferent}/${bars.rows} rows`,
  ).toBeLessThan(0.45);
  expect(
    bars.rightFraction,
    `right edge differs from the middle on ${bars.rightRowsDifferent}/${bars.rows} rows`,
  ).toBeLessThan(0.45);
  // And neither edge is a PALE frame in the average, which is the original
  // complaint and is worth keeping as a second, independent bound.
  expect(bars.meanLeft, "the left edge is not a pale frame").toBeLessThan(0.42);
  expect(bars.meanRight, "the right edge is not a pale frame").toBeLessThan(0.42);
});

/**
 * D30's evidence: the warp break is an OVERLAY, and the world is still there.
 *
 * The claim has a visible half and a structural half, and this asserts both.
 * STRUCTURALLY, Flight is still a running scene while Warp is on screen - which
 * is the whole difference between `launch` and `start`, and the difference a
 * screenshot alone cannot tell you, because a scene that had been torn down and
 * a scene that is merely behind a panel look identical in a still.
 * VISIBLY, the frame is written out so the panel can be seen sitting over the
 * belt rather than replacing it.
 */
test("D30: the warp break runs OVER a live Flight, not in place of it", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await freezeReloads(page);
  await page.goto("/?scene=Flight");
  await expect(page.getByTestId("app")).toHaveAttribute("data-booted", "true");
  await page.waitForFunction(
    () => (window as unknown as { __kb?: Record<string, unknown> }).__kb?.["game"] !== undefined,
  );

  // A two-word belt, so the break arrives without flying two minutes of rocks.
  await restartScene(page, "Flight", {
    stopId: "mars",
    debug: true,
    seed: 20260916,
    stageWordCount: 2,
    knobs: { maxLive: 2 },
  });
  await page.waitForFunction(
    () => {
      const api = (window as unknown as {
        __kbFlight?: { state(): { rocks: { word: string }[] } };
      }).__kbFlight;
      return (api?.state().rocks.length ?? 0) > 0;
    },
    null,
    { timeout: 30_000 },
  );

  // Clear the belt with real keystrokes through the scene's own window listener.
  await page.evaluate(() => {
    const api = (window as unknown as {
      __kbFlight: { state(): { rocks: { word: string }[] } };
    }).__kbFlight;
    for (const rock of api.state().rocks) {
      for (const ch of rock.word) {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: ch, code: `Key${ch.toUpperCase()}` }),
        );
      }
    }
  });

  await waitForScene(page, "Warp", 90_000);
  // The slide-in, and a moment of the calmed belt drifting behind it.
  await page.waitForTimeout(1600);

  const live = await activeScenes(page);
  // THE ASSERTION. `scene.start` would have shut Flight down; `scene.launch`
  // leaves it running underneath, which is what keeps the world on screen.
  expect(live, "Flight must still be running behind the warp panel").toContain("Flight");
  expect(live, "and the warp panel must be on top of it").toContain("Warp");

  const shot = await page.screenshot({ type: "png" });
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, "warp-overlay.png"), shot);
});
