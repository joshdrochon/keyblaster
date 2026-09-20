import { expect, test, type Page } from "@playwright/test";
import { bootScene, settle } from "./support/lane";
// Read from the layout modules, never restated: a spec that types 136 and 156
// out by hand stops measuring the grid the moment the grid moves.
import { INSTRUMENT } from "../../src/game/scenes/support/warpLayout";
import { PLATE_RHYTHM } from "../../src/game/ui/plateLayout";
import { STEP } from "../../src/game/ui/theme";

/**
 * THE WARP BREAK'S CHROME, IN A REAL BROWSER.
 *
 * ================== WHY THESE THREE ARE NOT UNIT TESTS ==================
 * `warpLayout.test.ts` asserts every rectangle on this screen without a
 * browser, and that is the right place for a rectangle. Three of the project
 * owner's six reports are NOT rectangles:
 *
 *   THE RING     is a TIMING defect. The focus ring was left painted at full
 *                alpha over an empty frame for the whole 1160 ms exit. No
 *                screenshot shows that and no pure function has an opinion
 *                about it; the only way to see it is to sample the live object
 *                over the frames after the last keystroke.
 *   SHADOW       is a DRAWING, and a Phaser `Graphics` has no bounds -
 *                `shadow.root.getBounds()` comes back as a zero-sized rect at
 *                the origin, which the first attempt at this measurement got
 *                and very nearly believed. His height can only be had from the
 *                pixels, by differencing two frames with him switched off.
 *   THE SENTENCE is TEXT METRICS. How tall 52 px of Latin ink really is, and
 *                whether any shipped sentence wraps at either letter-spacing
 *                setting, is a property of the font in the browser.
 *
 * All three read `__kb.warp.boxes()`, which `WarpScene.publish()` exposes
 * beside the letter geometry UR-26 already publishes for the same reason.
 */

interface WarpBoxes {
  panel: { x: number; y: number; w: number; h: number };
  coach: { x: number; y: number; w: number; h: number };
  sentenceBand: { x: number; y: number; w: number; h: number };
  sentenceInk: { top: number; bottom: number; h: number } | null;
  sentenceLines: number;
  chargeLabel: { x: number; y: number; w: number; h: number };
  chargeLabelText: string;
  bolt: { x: number; y: number; w: number; h: number };
  ring: { alpha: number; visible: boolean; active: boolean };
  panelAlpha: number;
}

const boxes = (page: Page): Promise<WarpBoxes> =>
  page.evaluate(
    () =>
      (window as unknown as { __kb: { warp: { boxes(): WarpBoxes } } }).__kb.warp.boxes(),
  );

/** The card's own padding, from `plateLayout.PLATE_RHYTHM.card`. */
const CARD_PAD_Y = 12;
const CARD_PAD_X = 40;

test.describe("the focus ring leaves with the card it is around", () => {
  test.setTimeout(120_000);

  /**
   * THE DEFECT, AS THE NUMBERS THAT FOUND IT.
   *
   * Sampled every animation frame from the last keystroke, in the served build
   * before the fix:
   *
   *              panelRoot.alpha   ring.graphics.alpha
   *     +135 ms       0.000               1.000
   *     +701 ms       0.000               1.000
   *     +1601 ms      0.000               1.000
   *
   * and after it, from the same script against the same build:
   *
   *     +8 ms         0.019               0.019
   *     +135 ms       0.000               0.000
   *     +235 ms       0.000               0.000
   *
   * WATCHED FAILING, with the ring's tween removed from `clearAndLaunch` - the
   * real printed value of the red run this change produced:
   *   the ring fades on the same beat as the panels
   *     ring alpha 1 while the panels are at 0.04521313476562494, 22384 ms
   *     after the last keystroke
   *     expect(received).toBeLessThanOrEqual(0.09521313476562494)
   *     Received: 1
   */
  test("the ring fades on the same beat as the panels", async ({ page }) => {
    await bootScene(page, "Warp", "warp", "&stop=mars");
    await settle(page);

    const before = await boxes(page);
    expect(before.ring.alpha, "the ring should be lit while the sentence is typed").toBe(1);

    // Sample every frame across the exit. The trace is collected IN THE PAGE:
    // a round trip per frame is slower than the tween this is measuring.
    await page.evaluate(() => {
      const w = window as unknown as {
        __trace: { ms: number; ring: number; panel: number }[];
        __raf: number;
        __t0: number;
        __kb: { warp: { boxes(): WarpBoxes } };
      };
      w.__trace = [];
      w.__t0 = performance.now();
      const tick = (): void => {
        const b = w.__kb.warp.boxes();
        w.__trace.push({
          ms: Math.round(performance.now() - w.__t0),
          ring: b.ring.alpha,
          panel: b.panelAlpha,
        });
        w.__raf = requestAnimationFrame(tick);
      };
      tick();
    });

    for (const ch of "Mars is the red planet.") {
      await page.keyboard.press(ch === " " ? "Space" : ch);
    }
    await page.evaluate(() => {
      (window as unknown as { __t0: number }).__t0 = performance.now();
    });
    await page.waitForTimeout(1200);

    const trace = await page.evaluate(() => {
      const w = window as unknown as {
        __trace: { ms: number; ring: number; panel: number }[];
        __raf: number;
      };
      cancelAnimationFrame(w.__raf);
      return w.__trace.filter((f) => f.ms >= 0);
    });

    expect(trace.length, "no frames were sampled after the last keystroke").toBeGreaterThan(3);

    // THE ASSERTION IS THE PAIRING, not a deadline. "Gone on the same beat the
    // panels clear" is exactly this: at no sampled frame is the ring
    // meaningfully brighter than the panel it belongs to.
    for (const frame of trace) {
      expect(
        frame.ring,
        `ring alpha ${frame.ring} while the panels are at ${frame.panel}, ` +
          `${frame.ms} ms after the last keystroke`,
      ).toBeLessThanOrEqual(frame.panel + 0.05);
    }

    // And it really does go out, rather than the panel staying up too.
    const last = trace[trace.length - 1];
    expect(last?.ring).toBeLessThan(0.1);
    expect(last?.panel).toBeLessThan(0.1);
  });
});

test.describe("Shadow fits the card he stands in", () => {
  test.setTimeout(120_000);
  /**
   * AT THE DESIGN RESOLUTION, AND STILL. Two things the first run of this case
   * got wrong, both of them properties of the MEASUREMENT rather than of the
   * screen:
   *
   *   the default 1280x720 viewport scales the 1920 artboard by 0.667, so one
   *   device pixel is 1.5 design pixels and the figure's top read 633 for a
   *   real 634 - a rounding error indistinguishable from a 1 px clip
   *
   *   with motion on, the ambient parallax moves BETWEEN the two screenshots,
   *   and a drifting debris field changes runs of pixels exactly the way a
   *   solid figure does. The first run reported Shadow as 633..954, which is
   *   most of the lower half of the screen
   *
   * `reducedMotion` also damps his hover bob, which is the other thing that
   * would otherwise differ between the two frames.
   */
  test.use({ viewport: { width: 1920, height: 1080 } });

  /**
   * MEASURED BY DIFFERENCE. `setShadowVisible(false)` takes the figure off the
   * frame and the two screenshots are subtracted, so what is measured is the
   * pixels he is responsible for and nothing else. The star field twinkles
   * between frames, so a row only counts when a RUN of pixels changed - a solid
   * figure changes four or more on every row it occupies; a star changes one.
   *
   *                      before          after
   *   Shadow drawn       y 613..760      y 634..781
   *   the card           y 622..762      y 622..795
   *   the inner box      y 634..750      y 634..783
   *   over the top edge  9 px            0 px
   *
   * WATCHED FAILING, with `COACH.h` back at the literal 140 and the figure back
   * on `COACH.x + 120, COACH.y + COACH.h / 2` - the real printed value:
   *   is drawn inside the card's own padding
   *     Shadow is drawn 614..760, the card's inner box is 634..750
   *     expect(received).toBeGreaterThanOrEqual(634)
   *     Received: 614
   */
  test("is drawn inside the card's own padding", async ({ page }) => {
    await bootScene(page, "Warp", "warp", "&stop=mars&reducedMotion=1");
    await settle(page, 1200);

    const b = await boxes(page);
    const withHim = await page.screenshot({ animations: "disabled" });
    await page.evaluate(() =>
      (
        window as unknown as { __kb: { warp: { setShadowVisible(v: boolean): void } } }
      ).__kb.warp.setShadowVisible(false),
    );
    await settle(page, 400);
    const without = await page.screenshot({ animations: "disabled" });
    await page.evaluate(() =>
      (
        window as unknown as { __kb: { warp: { setShadowVisible(v: boolean): void } } }
      ).__kb.warp.setShadowVisible(true),
    );

    /**
     * THE WINDOW, AND WHY IT IS NOT THE WHOLE FRAME.
     *
     * The star field twinkles every frame and `reducedMotion` deliberately
     * does not stop it ("the stars do not get a line like the one above, and
     * that is the point" - `WarpScene.update`). A twinkling star's soft glow
     * changes a run of pixels exactly the way a solid figure's edge does, and
     * a whole-frame difference duly reported Shadow as reaching y 952.
     *
     * So the difference is taken in a box 60 px larger than the card on every
     * side. That is the margin this case can see: an overflow of up to 60 px
     * is measured and reported, and anything larger would be clamped to the
     * window - which is why the height assertion at the end is there.
     */
    const margin = 60;
    const window_ = {
      x0: b.coach.x - margin,
      x1: b.coach.x + 400,
      y0: b.coach.y - margin,
      y1: b.coach.y + b.coach.h + margin,
    };

    const drawn = await page.evaluate(
      async ([a64, b64, win]) => {
        const load = (d: string): Promise<HTMLImageElement> =>
          new Promise((res) => {
            const im = new Image();
            im.onload = () => res(im);
            im.src = `data:image/png;base64,${d}`;
          });
        const grab = (im: HTMLImageElement): ImageData => {
          const c = document.createElement("canvas");
          c.width = im.width;
          c.height = im.height;
          const g = c.getContext("2d", { willReadFrequently: true });
          g?.drawImage(im, 0, 0);
          return g!.getImageData(0, 0, im.width, im.height);
        };
        const [ia, ib] = await Promise.all([load(a64 as string), load(b64 as string)]);
        const A = grab(ia);
        const B = grab(ib);
        const scale = A.width / 1920;
        const w = win as { x0: number; x1: number; y0: number; y1: number };
        const rows = new Map<number, number>();
        const cols = new Map<number, number>();
        const y0 = Math.max(0, Math.round(w.y0 * scale));
        const y1 = Math.min(A.height, Math.round(w.y1 * scale));
        const x0 = Math.max(0, Math.round(w.x0 * scale));
        const x1 = Math.min(A.width, Math.round(w.x1 * scale));
        for (let y = y0; y < y1; y += 1) {
          for (let x = x0; x < x1; x += 1) {
            const i = (A.width * y + x) << 2;
            const d =
              Math.abs((A.data[i] ?? 0) - (B.data[i] ?? 0)) +
              Math.abs((A.data[i + 1] ?? 0) - (B.data[i + 1] ?? 0)) +
              Math.abs((A.data[i + 2] ?? 0) - (B.data[i + 2] ?? 0));
            if (d > 8) {
              rows.set(y, (rows.get(y) ?? 0) + 1);
              cols.set(x, (cols.get(x) ?? 0) + 1);
            }
          }
        }
        const solidRows = [...rows.entries()].filter(([, c]) => c >= 4).map(([y]) => y);
        const solidCols = [...cols.entries()].filter(([, c]) => c >= 4).map(([x]) => x);
        return {
          top: Math.min(...solidRows) / scale,
          bottom: (Math.max(...solidRows) + 1) / scale,
          left: Math.min(...solidCols) / scale,
          right: (Math.max(...solidCols) + 1) / scale,
        };
      },
      [withHim.toString("base64"), without.toString("base64"), window_] as const,
    );

    const innerTop = b.coach.y + CARD_PAD_Y;
    const innerBottom = b.coach.y + b.coach.h - CARD_PAD_Y;
    const where =
      `Shadow is drawn ${Math.round(drawn.top)}..${Math.round(drawn.bottom)}, ` +
      `the card's inner box is ${innerTop}..${innerBottom}`;

    expect(drawn.top, where).toBeGreaterThanOrEqual(innerTop);
    expect(drawn.bottom, where).toBeLessThanOrEqual(innerBottom);
    expect(drawn.left, where).toBeGreaterThanOrEqual(b.coach.x + CARD_PAD_X);
    // And a REAL figure, not a blank card that trivially contains nothing:
    // 3.42 radii at 0.66 is 144.5 px, plus the glow's antialiased skirt.
    expect(drawn.bottom - drawn.top).toBeGreaterThan(140);
  });
});

test.describe("what the warp break's chrome says, and where its bolt is", () => {
  test.setTimeout(180_000);

  /**
   * THE BOLT IS THE LOCKUP'S LEFT EDGE, AND IT IS ON THE LINE.
   *
   *                  in the track   beside, hanging   on the line
   *   bolt left           -               118             136
   *   label left         136              136             156
   *   label right        250              250             270
   *
   * 136 is `INSTRUMENT.x + PLATE_RHYTHM.instrument.padX` - the grid line this
   * screen shares with the rest of the game. The middle column is what the
   * owner reported: the mark hung 18 px off that line into the plate's padding
   * while the "w" sat on it, so the first ink on the row was the object that
   * was NOT aligned. The words now step one vertical unit right and the mark
   * takes the line.
   *
   * With D41's increased letter spacing on, the label is 27 px wider and both
   * of these numbers are unchanged - which is the point of placing the mark off
   * the label's LEFT edge rather than off a measured right edge.
   *
   * WATCHED FAILING, against the hanging geometry:
   *   the bolt's left edge is at 118, not on the instrument's inner line 136:
   *   expected 118 to be 136
   */
  test("puts the charge bolt on the line, and the words after it", async ({ page }) => {
    await bootScene(page, "Warp", "warp", "&stop=mars");
    await settle(page);
    const b = await boxes(page);
    const where =
      `the bolt is at ${Math.round(b.bolt.x)}..${Math.round(b.bolt.x + b.bolt.w)} ` +
      `and "Warp Drive" starts at ${Math.round(b.chargeLabel.x)}`;
    // THE MARK OPENS THE LINE, and its left edge is the instrument's inner
    // line - the x the label used to start at.
    expect(Math.round(b.bolt.x), where).toBe(INSTRUMENT.x + PLATE_RHYTHM.instrument.padX);
    // And the words start to the RIGHT of it, one whole vertical unit in.
    expect(b.bolt.x + b.bolt.w, where).toBeLessThanOrEqual(b.chargeLabel.x);
    expect(Math.round(b.chargeLabel.x - b.bolt.x)).toBe(STEP.unit);
    // The gap is the vertical unit less the mark's own width. Derived, not
    // chosen - `support/warpLayout.BOLT_GAP_PX` says why.
    expect(Math.round(b.chargeLabel.x - (b.bolt.x + b.bolt.w))).toBe(7);
    // Vertically centred on the label's line, unchanged by the move.
    expect(b.bolt.y + b.bolt.h / 2).toBeCloseTo(
      b.chargeLabel.y + b.chargeLabel.h / 2,
      1,
    );
  });

  /**
   * THE LABEL'S CASE, READ OFF THE SCREEN.
   *
   * `warpChrome.test.ts` asserts the table; this asserts the string the player
   * is actually shown, which is the half a table cannot promise - `ui/text`
   * puts chrome through `theme.chromeCase`, and under D41's increased-
   * legibility setting that still upper-cases everything.
   *
   * WATCHED FAILING, with the table's old string:
   *   expected 'warp drive' to be 'Warp Drive'
   *
   * AND IT NAMES A BEACON NOW. The belt is AT the stop, so nothing drives
   * anywhere; the meter charges the beacon the next scene plants. Watched
   * failing again on the recast, in the served build:
   *   Error: expect(received).toBe(expected)
   *   Expected: "Warp Drive"
   *   Received: "Beacon Charge"
   */
  test("draws the charge meter's label in Title Case", async ({ page }) => {
    await bootScene(page, "Warp", "warp", "&stop=mars");
    await settle(page);
    expect((await boxes(page)).chargeLabelText).toBe("Beacon Charge");
  });

  /**
   * THE SENTENCE CARD'S RESERVE, measured rather than argued.
   *
   * Every belted stop lays out on ONE line and its ink is 60.2 px tall, in a
   * 149 px band. The card carries 88.8 px it never draws - and that 88.8 is the
   * reserved second line, which is why this spec RECORDS it rather than
   * asserting the card should be smaller. The decision is in
   * gauntlet/escalations.md.
   *
   * WATCHED FAILING, with `SENTENCE_MAX_LINES` set to 1 - i.e. with the reserve
   * actually removed, which is the change this case exists to make visible:
   *   every shipped sentence is one line, and the card still reserves two
   *     mars: expected 60.163997650146484 to be less than 81
   *     (the band collapses to 81 and the assertion below stops having slack)
   */
  for (const stop of ["mars", "jupiter", "saturn", "uranus", "neptune", "pluto"]) {
    test(`every shipped sentence is one line at ${stop}`, async ({ page }) => {
      await bootScene(page, "Warp", "warp", `&stop=${stop}`);
      await settle(page);
      const b = await boxes(page);
      expect(b.sentenceLines, `${stop} wrapped`).toBe(1);
      expect(b.sentenceInk).not.toBeNull();
      // One line of 52 px Latin ink. The same to a tenth at all six stops.
      expect(b.sentenceInk?.h ?? 0).toBeCloseTo(60.2, 0);
      // The band is two lines and the ink is one, so the reserve is REAL and is
      // the whole of the card's slack.
      expect(b.sentenceBand.h).toBe(149);
      expect(b.sentenceBand.h - (b.sentenceInk?.h ?? 0)).toBeGreaterThan(80);
    });
  }
});
