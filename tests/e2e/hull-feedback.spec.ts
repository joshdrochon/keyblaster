import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bootFlight, flightCanvasBox, flightState } from "./support/flightBoot.js";
import { DESIGN } from "./support/lane.js";

/**
 * UR-22 "noticed the hull can take infinite damage?" and
 * UR-21 "name of the map should probably shown somewhere".
 *
 * Both are about what the flight screen SHOWS, so both are measured off the
 * frame. The arithmetic behind UR-22 lives in `tests/unit/flight/hullLamp` -
 * how far the Lantern's light moves per hit, and how that compares to the three
 * dimming pips a player looked at and called infinite. This file is the part
 * that cannot be argued with: a rectangle of the screen, before and after a
 * hit, decoded from a PNG.
 *
 * NOTHING HERE READS PIXELS OFF THE LIVE CANVAS. Without
 * `preserveDrawingBuffer` a WebGL canvas hands back uniform garbage, which has
 * already produced two wrong measurements on this project. Every number below
 * comes from decoding a screenshot.
 */

test.use({ trace: "off" });

const EVIDENCE_DIR = resolve(process.cwd(), "gauntlet/evidence");

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Mean relative luminance of a rectangle, and the frame it came from. */
async function shoot(page: Page): Promise<string> {
  return (await page.screenshot()).toString("base64");
}

async function stats(
  page: Page,
  frames: readonly string[],
  rects: readonly Rect[],
  scale: number,
  ox: number,
  oy: number,
): Promise<{ mean: number[][]; absDelta: number[][] }> {
  return page.evaluate(
    async ([shots, rs, sc, x0, y0]: [readonly string[], readonly Rect[], number, number, number]) => {
      const load = (d: string): Promise<HTMLImageElement> =>
        new Promise((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = rej;
          i.src = `data:image/png;base64,${d}`;
        });
      const lin = (v: number): number => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      const planes: number[][][] = [];
      for (const shot of shots) {
        const img = await load(shot);
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext("2d");
        if (g === null) throw new Error("no 2d context");
        g.drawImage(img, 0, 0);
        const perRect: number[][] = [];
        for (const r of rs) {
          const px = g.getImageData(
            Math.round(x0 + r.x * sc),
            Math.round(y0 + r.y * sc),
            Math.max(1, Math.round(r.w * sc)),
            Math.max(1, Math.round(r.h * sc)),
          ).data;
          const lums: number[] = [];
          for (let i = 0; i < px.length; i += 4) {
            lums.push(
              0.2126 * lin(px[i] ?? 0) + 0.7152 * lin(px[i + 1] ?? 0) + 0.0722 * lin(px[i + 2] ?? 0),
            );
          }
          perRect.push(lums);
        }
        planes.push(perRect);
      }
      const mean = planes.map((frame) =>
        frame.map((lums) => lums.reduce((s, v) => s + v, 0) / lums.length),
      );
      // Sum of |change| per pixel between consecutive frames, normalised by
      // pixel count: "how much of this rectangle moved", which is the quantity
      // a player's eye is actually sensitive to.
      const absDelta: number[][] = [];
      for (let f = 1; f < planes.length; f += 1) {
        const row: number[] = [];
        for (let r = 0; r < rs.length; r += 1) {
          const a = planes[f - 1]?.[r] ?? [];
          const b = planes[f]?.[r] ?? [];
          let sum = 0;
          for (let i = 0; i < a.length; i += 1) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
          row.push(sum / Math.max(1, a.length));
        }
        absDelta.push(row);
      }
      return { mean, absDelta };
    },
    [frames, rects, scale, ox, oy] as [readonly string[], readonly Rect[], number, number, number],
  );
}

test.describe("UR-22 / UR-21: the flight screen shows the hull and the place", () => {
  test("UR-22: one hull hit changes the ship, not just a corner pip", async ({ page }) => {
    test.setTimeout(240_000);
    await bootFlight(page, {
      // reducedMotion: the shake and the gutter flicker are framing (AC-19.3),
      // and this measures the SETTLED state - what the screen looks like after
      // the moment, which is the half the player has to be able to keep reading.
      // Measuring it with reduced motion ON is the harder case on purpose.
      reducedMotion: true,
      pixelReadback: true,
      knobs: { maxLive: 1 },
      // THE SHIPPED STAGE LENGTH, and that is load-bearing. `hullForStage`
      // scales the hull with it, so a longer stage would hand this test a
      // 66-mark hull in which one hit moves the lamp by 1/66 instead of 1/9 -
      // a fixture that dilutes the very quantity it is measuring. The first run
      // of this spec did exactly that, at stageWordCount 400.
      stageWordCount: 58,
      // A very slow pilot, so FR-8 clamps every rock to its 14 s maximum fall.
      // Nobody is typing during this measurement, so a rock that reaches the
      // breach line takes a hull mark THE TEST DID NOT ASK FOR - and the first
      // run of this spec lost two that way, inside the control window, where a
      // hit is the one thing that must not happen. Slowing the belt does not
      // change anything about what a hit looks like; it just keeps the belt out
      // of the experiment.
      calibration: { ikiMs: 4000, fkLatencyMs: 2000 },
      seed: 0x2201,
    });

    const before = await flightState(page);
    // The exact case UR-22 is about: nine marks behind three drawn pips.
    expect(before.maxHull, "this is not the hull the player reported on").toBe(9);

    const box = await flightCanvasBox(page);
    const scale = box.width / DESIGN.width;
    const shipX = DESIGN.width / 2;
    const shipY = DESIGN.height - 150;
    // The ship and the light around it. `drawHullLamp`'s outermost ring is 132.
    const SHIP: Rect = { x: shipX - 150, y: shipY - 160, w: 300, h: 300 };
    // The three hull marks: `HudScene.buildHullMarks(width - 132, 48, ...)`,
    // three 16 px squares on a 24 px pitch.
    const PIPS: Rect = { x: DESIGN.width - 136, y: 44, w: 76, h: 24 };
    /**
     * THE SAME RECTANGLE, SOMEWHERE THE SHIP IS NOT.
     *
     * Without this the measurement is a lie by omission. The sky TRAVELS across
     * a stage (AC-22.3, deltaE > 10 by design), the parallax scrolls, and the
     * bottom of the frame darkens as the belt runs - so the ship's rectangle
     * gets darker over twenty seconds whether or not anything hits it. The
     * first run of this spec produced a beautiful monotone ladder that the sky
     * alone could have drawn.
     *
     * Same size, same rows, no ship: every global change lands on both, so
     * subtracting one from the other leaves only what happened to the ship.
     */
    const SKY: Rect = { x: shipX - 150 - 430, y: shipY - 160, w: 300, h: 300 };
    const rects = [SHIP, PIPS, SKY];

    // The lamp settles on a 260 ms tween under reduced motion; this is room for
    // that plus a frame or two on a slow renderer, and short enough that the
    // whole sequence fits inside one rock's 14 s fall.
    const settle = async (): Promise<void> => {
      await page.waitForTimeout(800);
    };
    const hullNow = async (): Promise<number> => (await flightState(page)).hull;

    // 1. THE CONTROL. Two frames with no hit between them, the same wait apart.
    // The belt is running - the sky travels, rocks fall, the exhaust flickers -
    // so some of this rectangle changes on its own, and a measurement that does
    // not know how much is not a measurement.
    const hullAtC0 = await hullNow();
    const c0 = await shoot(page);
    await settle();
    const c1 = await shoot(page);
    const hullAtC1 = await hullNow();
    // The control window has to contain NO hit, or it is not a control - it is
    // a second measurement of the thing being measured.
    expect(
      hullAtC1,
      "the belt landed a rock during the control window, so the control is not one",
    ).toBe(hullAtC0);

    // 2. ONE HIT.
    await page.evaluate(() => window.__kbFlight?.strike());
    await settle();
    const h1 = await shoot(page);

    const { mean, absDelta } = await stats(page, [c0, c1, h1], rects, scale, box.x, box.y);
    // Differential: what moved on the ship, over and above what moved on an
    // identical patch of the same world in the same two frames.
    const driftShip = (absDelta[0]?.[0] ?? 0) - (absDelta[0]?.[2] ?? 0);
    const hitShip = (absDelta[1]?.[0] ?? 0) - (absDelta[1]?.[2] ?? 0);
    const driftPips = absDelta[0]?.[1] ?? 0;
    const hitPips = absDelta[1]?.[1] ?? 0;

    const after = await flightState(page);
    expect(after.hull, "the strike did not land").toBe(hullAtC1 - 1);

    // 3. ACCUMULATION. Four more hits, reading the ship's mean brightness after
    // each: the light has to keep going down, or the hull still reads as
    // bottomless however visible the first hit was.
    // Ship MINUS sky, so the ladder measures the ship rather than the hour.
    const ladder: number[] = [(mean[2]?.[0] ?? 0) - (mean[2]?.[2] ?? 0)];
    const hulls: number[] = [after.hull];
    for (let i = 0; i < 3; i += 1) {
      await page.evaluate(() => window.__kbFlight?.strike());
      await settle();
      const shot = await shoot(page);
      const s = await stats(page, [shot], rects, scale, box.x, box.y);
      ladder.push((s.mean[0]?.[0] ?? 0) - (s.mean[0]?.[2] ?? 0));
      hulls.push(await hullNow());
    }
    // Every reading is a DIFFERENT hull, or the ladder below is comparing a
    // rectangle to itself.
    expect(new Set(hulls).size, `hull readings: ${JSON.stringify(hulls)}`).toBe(hulls.length);

    const report = {
      ticket: "UR-22",
      maxHull: before.maxHull,
      shipRect: SHIP,
      pipRect: PIPS,
      driftShip,
      hitShip,
      driftPips,
      hitPips,
      skyRect: SKY,
      shipMinusSkyLuminanceByHullHits: ladder,
      hullAtEachReading: hulls,
      source: "tests/e2e/hull-feedback.spec.ts",
    };
    console.log("UR-22 hull feedback:", JSON.stringify(report));
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(join(EVIDENCE_DIR, "hull-feedback.json"), `${JSON.stringify(report, null, 2)}\n`);

    // THE ASSERTIONS.
    //
    // (a) A hit moves the ship's own rectangle by much more than the belt moves
    //     it on its own. The control is in the same frame sequence, on the same
    //     rectangle, so this cannot drift with the palette or the sky.
    expect(
      hitShip,
      `a hit moved the ship rect by ${hitShip.toFixed(5)} over the world's own motion, against ${driftShip.toFixed(5)} when nothing hit it`,
    ).toBeGreaterThan(Math.max(Math.abs(driftShip) * 3, 0.002));

    // (b) IT IS ON THE SHIP AND NOT ONLY IN THE CORNER. The corner pip moves
    //     too - it should - but the defect was that the corner was ALL there
    //     was. Comparing the two rectangles in the same pair of frames is the
    //     measurement that says this fix is different from the one that failed.
    expect(
      hitShip * SHIP.w * SHIP.h,
      "the hit is still only in the HUD corner",
    ).toBeGreaterThan(hitPips * PIPS.w * PIPS.h * 10);

    // (c) DAMAGE ACCUMULATES VISIBLY. Five hits, five readings, each darker
    //     than the last. This is the literal content of the player's report:
    //     if these were flat, the hull would read as infinite.
    for (let i = 1; i < ladder.length; i += 1) {
      expect(
        ladder[i] as number,
        `hull hit ${i + 1} did not dim the ship further (ship minus sky): ${JSON.stringify(ladder)}`,
      ).toBeLessThan(ladder[i - 1] as number);
    }
  });

  test("UR-21: the HUD names the stop, on its own plate, above 4.5:1", async ({ page }) => {
    test.setTimeout(180_000);
    await bootFlight(page, {
      stopId: "saturn",
      reducedMotion: true,
      pixelReadback: true,
      knobs: { maxLive: 1 },
      stageWordCount: 60,
      seed: 0x2102,
    });

    // The name the story bundle uses on the briefing page is the name the belt
    // must show; a HUD that invented its own would be a second source of truth.
    const shown = await page.evaluate(() => {
      const game = window.__kbGame as unknown as {
        scene: { getScene(k: string): { children: { list: unknown[] } } };
      };
      const hud = game.scene.getScene("Hud");
      return (hud.children.list as { type: string; text?: string }[])
        .filter((c) => c.type === "Text")
        .map((c) => c.text ?? "");
    });
    expect(shown, `the HUD draws: ${JSON.stringify(shown)}`).toContain("Saturn");

    // AC-22b.1: a place name, not a readout. Nothing captions it.
    const captions = shown.filter((t) => /location|stop|map|planet|where/i.test(t));
    expect(captions, "the place name has grown a worksheet label").toEqual([]);

    const box = await flightCanvasBox(page);
    const scale = box.width / DESIGN.width;
    // `hudLayout.hudPlacePlate()`, inset past the rounded corners.
    const plate = { x: 24 + 8, y: 124 + 8, w: 236 - 16, h: 46 - 16 };
    const shot = await page.screenshot({
      clip: {
        x: box.x + plate.x * scale,
        y: box.y + plate.y * scale,
        width: plate.w * scale,
        height: plate.h * scale,
      },
    });
    const contrast = await page.evaluate(async (data: string) => {
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = `data:image/png;base64,${data}`;
      });
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d");
      if (g === null) throw new Error("no 2d context");
      g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, img.width, img.height).data;
      const lin = (v: number): number => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      const lums: number[] = [];
      for (let i = 0; i < px.length; i += 4) {
        lums.push(
          0.2126 * lin(px[i] ?? 0) + 0.7152 * lin(px[i + 1] ?? 0) + 0.0722 * lin(px[i + 2] ?? 0),
        );
      }
      lums.sort((a, b) => a - b);
      const at = (q: number): number => lums[Math.floor((lums.length - 1) * q)] ?? 0;
      // Same asymmetric percentiles the word-plate spec uses, and for the same
      // reason: a plate is mostly plate, so the ink is in the top few percent.
      return (at(0.98) + 0.05) / (at(0.2) + 0.05);
    }, shot.toString("base64"));

    console.log(`UR-21 place plate contrast: ${contrast.toFixed(2)}:1`);
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(
      join(EVIDENCE_DIR, "hud-place-name.json"),
      `${JSON.stringify(
        { ticket: "UR-21", stop: "saturn", texts: shown, plate, contrast, minRatio: 4.5 },
        null,
        2,
      )}\n`,
    );
    expect(contrast, `the stop name measured ${contrast.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });
});
