import { expect, test, type Page } from "@playwright/test";
import { DESIGN, bootScene, gameCanvas, settle, snap } from "./support/lane";

/**
 * NOTHING IS VISIBLE THROUGH THE STAGE REPORT.
 *
 * ================== THE DEFECT ==================
 * A blind critic probed `results.png` and found the card body reading #1c1b1d
 * (L* 10.0) everywhere except inside the moon's footprint, where it read
 * #1d2024 (L* 11.9). A circle was visible inside a panel that is supposed to be
 * a solid surface. Nothing was mis-ordered - the card is on the HUD layer and
 * the celestial disc is six depths below it - the fill carried alpha 0.94, so
 * 6% of a near-white body came through.
 *
 * ================== WHY THIS IS PIXELS ==================
 * `tests/unit/scenes/resultsInk.test.ts` asserts the constant, which is the
 * cause, and that is the test that will fail first if somebody edits it. This
 * one asserts the CONSEQUENCE, because the constant is not the only way a shape
 * can appear inside the card: a second translucent object drawn over it, a
 * blend mode, a parallax layer promoted above the HUD, or the panel graphics
 * being given an alpha of its own would all reproduce the exact defect the
 * critic reported and leave `PANEL_ALPHA` at 1.
 *
 * So the frame is measured, at the place the critic measured it: the card's own
 * top band, which is where the moon sits and is the one strip of the panel with
 * no text in it. A solid fill has no spread. Anything showing through does.
 *
 * THE NEGATIVE CONTROL IS THE SAME STRIP OF SKY, directly above the card. The
 * disc reaches above the panel's top edge, so that strip MUST vary - which is
 * what proves the probe can see a disc at all. Without it, a flat green result
 * would be equally consistent with the probe being pointed at nothing.
 *
 *   npx playwright test tests/e2e/results-panel-opacity.spec.ts
 */

test.use({ trace: "off" });

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The spread of relative luminance across a rectangle of the canvas, as a
 * contrast ratio between its 2nd and 98th percentile.
 *
 * Percentiles rather than min/max: one antialiased pixel on a rounded corner is
 * not "a shape showing through", and letting a single outlier set the number
 * would make the measure noise. 1.0 is a perfectly flat fill.
 */
async function spread(page: Page, rect: Rect): Promise<number> {
  const box = await gameCanvas(page).boundingBox();
  if (box === null) throw new Error("no canvas");
  const scale = box.width / DESIGN.width;
  const shot = await page.screenshot({
    clip: {
      x: box.x + rect.x * scale,
      y: box.y + rect.y * scale,
      width: Math.max(1, rect.w * scale),
      height: Math.max(1, rect.h * scale),
    },
  });
  return page.evaluate(async (data: string) => {
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
    const px = ctx.getImageData(0, 0, img.width, img.height).data;
    const channel = (v: number): number => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const lums: number[] = [];
    for (let i = 0; i < px.length; i += 4) {
      lums.push(
        0.2126 * channel(px[i] ?? 0) +
          0.7152 * channel(px[i + 1] ?? 0) +
          0.0722 * channel(px[i + 2] ?? 0),
      );
    }
    lums.sort((a, b) => a - b);
    const at = (q: number): number => lums[Math.floor((lums.length - 1) * q)] ?? 0;
    return (at(0.98) + 0.05) / (at(0.02) + 0.05);
  }, shot.toString("base64"));
}

/**
 * The card's top band: inside the border, above the first line of type.
 *
 * `PANEL_PAD_Y` is 44, so 30 px below the edge is still padding on every stop
 * and in every language. This is the strip the moon sits in.
 */
const topBand = (report: Rect): Rect => ({
  x: report.x + 6,
  y: report.y + 6,
  w: report.w - 12,
  h: 30,
});

/** The same strip of bare sky, immediately above the card. */
const skyAbove = (report: Rect): Rect => ({
  x: report.x + 6,
  y: Math.max(0, report.y - 40),
  w: report.w - 12,
  h: 30,
});

test("the stage report is opaque: no celestial body shows through it", async ({
  page,
}) => {
  test.setTimeout(90_000);
  // Mars is the stop the defect was captured at, and its light sits at the top
  // left of the frame - behind the stage report's corner.
  await bootScene(page, "Results", "results", "&stop=mars");
  await settle(page, 1400);

  const s = await snap<{ panels: { report: Rect | null } }>(page, "results");
  const report = s.panels.report;
  expect(report, "Results did not publish the card it drew").not.toBeNull();
  const card = report as Rect;

  const inside = await spread(page, topBand(card));
  const above = await spread(page, skyAbove(card));

  // THE NEGATIVE CONTROL FIRST. If the sky above the card is flat, there is no
  // disc in this frame and the green result below would mean nothing.
  expect(
    above,
    "the sky above the card is flat, so this probe cannot see a disc at all",
  ).toBeGreaterThan(1.08);

  // The card body. Measured: 1.00 with the panel opaque, 1.049 at the shipped
  // alpha of 0.94 - so 1.02 sits between the two with room either side and is
  // not a threshold tuned to make a run pass.
  expect(inside, "something is visible through the stage report card").toBeLessThan(
    1.02,
  );
});
