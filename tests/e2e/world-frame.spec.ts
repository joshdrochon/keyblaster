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
test("R-world: the Title frame, on a dark stop, has no pale frame around it", async ({
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
  const edges = (await page.evaluate(async (b64: string) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const off = document.createElement("canvas");
    off.width = img.naturalWidth;
    off.height = img.naturalHeight;
    const ctx = off.getContext("2d") as CanvasRenderingContext2D;
    ctx.drawImage(img, 0, 0);
    const mean = (x: number, y: number, w: number, h: number): number => {
      const d = ctx.getImageData(x, y, w, h).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) {
        sum +=
          0.2126 * (d[i] as number) + 0.7152 * (d[i + 1] as number) + 0.0722 * (d[i + 2] as number);
      }
      return sum / (d.length / 4) / 255;
    };
    const W = off.width;
    const H = off.height;
    const band = Math.round(W * 0.045);
    const top = Math.round(H * 0.25);
    const tall = Math.round(H * 0.5);
    return {
      left: mean(0, top, band, tall),
      right: mean(W - band, top, band, tall),
      centre: mean(Math.round(W * 0.45), top, Math.round(W * 0.1), tall),
      brightest: Math.max(
        mean(0, top, band, tall),
        mean(W - band, top, band, tall),
      ),
    };
  }, shot.toString("base64"))) as {
    left: number;
    right: number;
    centre: number;
    brightest: number;
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
        edgeLuminance: edges,
        capturedAt: new Date().toISOString(),
        note: "A reference compare is never auto-passed (D85). This records the measurable half: the near plane at the frame edges is not a pale border.",
      },
      null,
      2,
    )}\n`,
  );

  // THE ASSERTION THIS SCREEN EXISTS FOR. `canyonWalls` draws the near plane
  // down both edges. Before this round it was drawn in near-white on a dark
  // stop, and the Title came out with a pale border around it - reported by a
  // player as "two large near-white vertical masses framing the screen".
  //
  // A near plane on a dark stop is LIGHTER than the sky (art-direction s2) and
  // still dark in absolute terms, so both halves are checked.
  //
  // 0.42 is the threshold because that is where the unit-level rule lands once
  // it reaches pixels: `NEAR_PLANE_MAX_L` caps the near plane at L* 42, and the
  // rim highlight on its lit edge adds a little on top. The old near-white
  // foreground measured about 0.94 here, so the gap between pass and the defect
  // is enormous - this is not a threshold tuned to squeak past.
  expect(edges.left, "the left edge is not a pale frame").toBeLessThan(0.42);
  expect(edges.right, "the right edge is not a pale frame").toBeLessThan(0.42);
  // And it is still a PLANE, not the sky: art-direction section 2 wants the
  // near field lighter than the sky on a dark stop, so the edges have to differ
  // from the middle of the frame rather than merely being dark.
  expect(
    Math.abs(edges.left - edges.centre) + Math.abs(edges.right - edges.centre),
    "the near plane must be distinguishable from the sky behind it",
  ).toBeGreaterThan(0.01);
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
