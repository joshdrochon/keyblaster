import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bootFlight, flightCanvasBox, freezeFlight } from "./support/flightBoot.js";
// @ts-expect-error - .mjs tooling module, no type declarations by design
import { longestFlatBase } from "../gauntlet/flatBase.mjs";

/**
 * AC-22.10, THE PIXEL HALF (D97): the world is space, not terrain.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SPEC EXISTS
 *
 * AC-22.10 had NO TEST. It was one of the two acceptance criteria `G-trace
 * --strict` reported as asserted by nothing at all, and it is the criterion that
 * holds a decision the user drove: the terrain came out after they looked at the
 * world three times and said the shapes read as noise. A mesa painter, a sine
 * hill or a flat-based mass added tomorrow would have shipped with every gate
 * green - which is `docs/verification-gaps.md` instances 2 and 18 in a different
 * costume: a decision with no guard is a decision that expires quietly.
 *
 * The source half is `tests/unit/render/noTerrain.test.ts`, and on its own it is
 * weak: an allowlist of tile painters catches a NAMED painter and cannot see a
 * landform drawn inline. This half measures the SHAPE, where the name of the
 * function that drew it does not matter.
 *
 * ---------------------------------------------------------------------------
 * WATCHED FAIL AGAINST THE REAL RENDERER, not only against a synthetic frame.
 *
 * A mesa was put back on the mid plane in `parallax.ts` - twelve lines, a filled
 * rect at `W*0.14, H*0.30, W*0.62, H*0.16`, which is a landform terminating in a
 * flat base with sky beneath it - and this spec was run:
 *
 *   mars      0.0344 -> 0.6203      (794 px wide, base at row 333)
 *   jupiter   0.0336 -> 0.6203
 *   saturn    0.0234 -> 0.6203
 *   uranus    0.0281 -> 0.6203
 *   pluto     0.0281 -> 0.6203
 *   neptune   0.0242 -> 0.0813      <- see below
 *
 *   Error: mars: a mass 794px wide ends in a flat base at row 333 (from x=178)
 *   with sky beneath it - D97 says the world is space, not terrain
 *
 * NEPTUNE DID NOT MOVE, and it is the informative one. The injected mass was
 * luminance 27; Neptune's sky in that band is 30-55, so the step never reaches
 * `MIN_STEP` and there is no VISIBLE base to find. That is the criterion working
 * rather than failing - AC-22.10 says "with sky visible beneath it" - but it is
 * also a real limit, recorded in `limitations` below: a landform drawn at a dark
 * stop in nearly the sky's own value is a landform this measure cannot see, and
 * only the source half would catch it.
 *
 * ---------------------------------------------------------------------------
 * THE SIGNATURE, AND THE FORM IT MUST NOT FIRE ON
 *
 * A landform terminating in a flat base is a long horizontal run of columns at
 * which a mass ends and brighter pixels begin, all at the same row. The measure
 * is `tests/gauntlet/flatBase.mjs`, pure and browser-free, and its own negative
 * control lives in `tests/unit/gauntlet/flatBase.test.ts` where a flat-based
 * mass, a ring plane and a planet limb are composited into the same synthetic
 * sky and scored. The hard part was not detecting the defect, it was NOT firing
 * on the ring planes D97 put in terrain's place - a naive fixed-row detector
 * scored an allowed ring plane 0.420 of frame width, above any bar that would
 * still catch the defect.
 *
 * ---------------------------------------------------------------------------
 * EVERY STOP, and the reason is on the record twice.
 *
 * Instances 2 and 3 in `verification-gaps.md` are both "the harness boots Mars
 * only", and instance 18 is the third - inside the gate for UR-47. The layer
 * build is parameterised by palette and by `veilFor(stopId)`, so one stop is one
 * stop, and all six that have a belt are swept.
 *
 * EARTH IS EXCLUDED, AND NOT BECAUSE IT WAS INCONVENIENT. D57 makes Earth the
 * launchpad: no belt, one typed word to light the beacon, and
 * `DEBRIS_BY_STOP.earth` is empty by construction. `FlightScene.spawnRock` picks
 * its debris with `types[i % Math.max(1, types.length)]`, which on an empty table
 * is `undefined`, so the Flight scene at Earth cannot spawn a rock at all - it is
 * an unreachable state, the same shape as the coverage gap `text-collision.spec`
 * was found asserting against. Guard 4 in `verification-gaps.md` asks a spec that
 * drives a screen state to say whether a player can reach it; this is that
 * sentence. Earth's WORLD is drawn by the same parameterised layer build as the
 * other six, and the source half checks the build itself.
 */

const EVIDENCE = resolve(process.cwd(), "gauntlet/evidence");
const DESIGN_H = 1080;

/**
 * The bar, as a fraction of frame width.
 *
 * NOT CHOSEN FOR COMFORT, and the floor under it is geometry rather than taste.
 * Measured with each shape composited into a real frame (see `flatBase.mjs`):
 *
 *   flat-based mass (the defect)      0.562
 *   ring plane, near edge-on          0.204   <- ALLOWED by D97
 *   planet limb                       0.123   <- ALLOWED by D97
 *   real frames, HUD and plates in    0.055 - 0.084
 *
 * 0.30 sits 1.5x above the widest allowed form and 1.9x below the defect. It
 * cannot go much lower without failing a ring plane, and that is a real limit of
 * this signature rather than a number someone liked: A FLAT BASE NARROWER THAN
 * 30% OF THE FRAME IS NOT CAUGHT HERE. The source half is the complement.
 */
const BAR = 0.3;

const STOPS = ["mars", "jupiter", "saturn", "uranus", "neptune", "pluto"];

test("AC-22.10 / D97: no parallax layer renders a flat-based mass, at any stop", async ({
  page,
}) => {
  test.setTimeout(420_000);
  const readings: Record<string, unknown>[] = [];

  for (const stopId of STOPS) {
    await bootFlight(page, { stopId, stageWordCount: 400, knobs: { maxLive: 3 } });
    // FROZEN, so the pixels and the mask rectangles describe one frame. The
    // planes drift sideways continuously (art-direction L3), so a mask read a
    // round trip after the screenshot masks where a plate WAS.
    await freezeFlight(page, true);
    const box = await flightCanvasBox(page);
    const shot = await page.screenshot({
      clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    });

    const decoded = await page.evaluate(
      async ([b64in, hudUrl]: [string, string]) => {
        const hud = (await import(hudUrl)) as {
          hudRects: (screenWidth: number) => { x: number; y: number; w: number; h: number }[];
        };
        const game = window.__kbGame as unknown as { scale: { width: number } };
        const live = window.__kbFlight?.state();
        const img = new Image();
        img.src = `data:image/png;base64,${b64in}`;
        await img.decode();
        const W = img.naturalWidth;
        const H = img.naturalHeight;
        const off = document.createElement("canvas");
        off.width = W;
        off.height = H;
        const ctx = off.getContext("2d") as CanvasRenderingContext2D;
        ctx.drawImage(img, 0, 0, W, H);
        const { data } = ctx.getImageData(0, 0, W, H);
        const bytes = new Uint8Array(W * H);
        for (let i = 0; i < bytes.length; i += 1) {
          bytes[i] = Math.round(
            0.299 * (data[i * 4] as number) +
              0.587 * (data[i * 4 + 1] as number) +
              0.114 * (data[i * 4 + 2] as number),
          );
        }
        let s = "";
        for (const v of bytes) s += String.fromCharCode(v);
        return {
          w: W,
          h: H,
          b64: btoa(s),
          designW: game.scale.width,
          stalled: live?.stalled ?? true,
          // The HUD's own rectangles, from the module the HUD is drawn from, so
          // the mask cannot drift from the panels. A dark rounded panel on sky
          // IS a flat-based mass; it is UI, not world.
          hud: hud.hudRects(game.scale.width),
          plates: (live?.rocks ?? []).map((r) => ({
            x0: r.plateLeft,
            y0: r.plateTop,
            x1: r.plateRight,
            y1: r.plateBottom,
          })),
        };
      },
      [shot.toString("base64"), "/src/game/flight/hudLayout.ts"] as [string, string],
    );

    expect(decoded.stalled, `${stopId}: the stage stalled before the frame was taken`).toBe(false);
    const scale = decoded.w / decoded.designW;
    const vScale = decoded.h / DESIGN_H;
    const pad = 6;
    const exclude = [
      ...decoded.hud.map((r) => ({
        x0: r.x * scale - pad,
        y0: r.y * vScale - pad,
        x1: (r.x + r.w) * scale + pad,
        y1: (r.y + r.h) * vScale + pad,
      })),
      ...decoded.plates.map((r) => ({
        x0: r.x0 * scale - pad,
        y0: r.y0 * vScale - pad,
        x1: r.x1 * scale + pad,
        y1: r.y1 * vScale + pad,
      })),
    ];

    const grey = Uint8Array.from(Buffer.from(decoded.b64, "base64"));
    const found = longestFlatBase({
      grey,
      w: decoded.w,
      h: decoded.h,
      exclude,
    }) as { runPx: number; runFraction: number; atRow: number; fromX: number };

    readings.push({
      stopId,
      frame: { w: decoded.w, h: decoded.h },
      masked: { hud: decoded.hud.length, plates: decoded.plates.length },
      longestFlatBasePx: found.runPx,
      longestFlatBaseFraction: found.runFraction,
      atRow: found.atRow,
      fromX: found.fromX,
    });
  }

  const worst = readings.reduce(
    (a, b) =>
      (a.longestFlatBaseFraction as number) >= (b.longestFlatBaseFraction as number) ? a : b,
    readings[0] as Record<string, unknown>,
  );

  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(
    join(EVIDENCE, "no-terrain.json"),
    `${JSON.stringify(
      {
        claim:
          "AC-22.10 / D97: no parallax layer renders a landform silhouette that terminates in a flat base with sky visible beneath it, at any stop",
        measure: "tests/gauntlet/flatBase.mjs longestFlatBase",
        method:
          "frozen frame per stop, screenshot decoded as PNG (never read off a live WebGL canvas), HUD rectangles taken from src/game/flight/hudLayout.ts and every word plate from the scene's own debug state, both masked. Longest run of columns whose mass ends at the same row +/- 1.",
        bar: BAR,
        barSource:
          "composited into a real frame: flat-based mass 0.562, ring plane near edge-on 0.204 (ALLOWED by D97), planet limb 0.123 (ALLOWED). The bar cannot go much below 0.204 without failing an allowed form.",
        negativeControl:
          "tests/unit/gauntlet/flatBase.test.ts composites a flat-based mass, a ring plane and a planet limb into the same synthetic sky and asserts the first exceeds the bar while the other two do not. Runs in vitest, no browser: npx vitest run tests/unit/gauntlet/flatBase.test.ts --coverage.enabled=false",
        sourceHalf: "tests/unit/render/noTerrain.test.ts",
        stops: STOPS,
        worst,
        readings,
        limitations: [
          "a flat base narrower than the bar is not caught by this signature; the source half's painter allowlist is the complement",
          "it measures the BASE of a mass, which is what AC-22.10 names; a mass that meets the top of the frame has no base to find",
          "a mass drawn within MIN_STEP of the sky's own luminance has no visible base and is not caught: the injected-mesa control moved five stops from ~0.03 to 0.6203 and left Neptune at 0.0813, because the mass was luminance 27 against a Neptune sky of 30-55",
        ],
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );

  expect(readings.length, "every stop measured").toBe(STOPS.length);
  for (const r of readings) {
    expect(
      r.longestFlatBaseFraction as number,
      `${r.stopId as string}: a mass ${r.longestFlatBasePx as number}px wide ends in a flat base at row ${r.atRow as number} (from x=${r.fromX as number}) with sky beneath it - D97 says the world is space, not terrain`,
    ).toBeLessThan(BAR);
  }
});
