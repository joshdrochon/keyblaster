import { expect, test, type Page } from "@playwright/test";
import { freezeReloads } from "./support/lane.js";

/**
 * UR-50.5 / UR-14: NOTHING IN THE SKY TRAVELS SIDEWAYS, ON ANY SCREEN.
 *
 * ================== THE DEFECT, REPORTED TWICE ==================
 * UR-14, from play on the Title: "the stars should not actually be moving in
 * the parallax. Keep the stars just keep them stationary and flickering slowly
 * at different intervals." Fixed - `render/starField.ts` pins the field to the
 * `sky` container, which never scrolls or sways.
 *
 * UR-50.5, from play on the Briefing, months later: "THE STARS IN THE WINDOW
 * STILL TRAVEL LEFT TO RIGHT."
 *
 * Both reports were right and the first fix was not wrong, because the
 * travelling objects were never the starfield. They are the decorative debris
 * planes, and `DRIFT_X` gives each a px/s FLOOR that runs at any world speed.
 * A pale far-field speck crossing a window at 5 px/s is a travelling star to
 * anyone not reading the source.
 *
 * ================== HOW THIS MEASURES IT ==================
 * IT STEPS THE WORLD BY HAND rather than waiting on a clock. Under three
 * Playwright workers this machine renders the briefing at about two frames a
 * second, so the first three attempts at this measurement sampled two frames
 * 4 s apart, found them identical, and would have certified the defect as
 * fixed. `scene.update(t, dt)` is public on every screen here and drives the
 * parallax directly, so 1200 x 16 ms is a deterministic 19.2 s of world in
 * whatever wall time the machine can spare. Standards rule 6: wait for the
 * thing, never for a clock - and where you cannot wait for it, drive it.
 *
 * THE DISTINCTION IT DRAWS is between breathing and travelling, because the
 * frame must keep moving (AC-22.2: two frames a second apart differ by >2% of
 * pixels) while nothing crosses it. Those look the same in one sample and are
 * told apart by doubling the clock:
 *
 *   BREATHING  `cameraSwayPx` +/-2 px on a 6 s sine, `idleDriftPx` +/-speed*6
 *              on a 12 s sine. Bounded: 10x the world time does not grow it.
 *   TRAVELLING `p.offset = mod(p.offset + rate * dt, W)`. Linear: 10x the
 *              world time is 10x the distance.
 *
 * ================== THE NEGATIVE CONTROL, MEASURED ==================
 * Run against the shipped Briefing (no `worldSpeed`, no `crossDrift: false`),
 * three nested drift planes travelled, and the numbers are `DRIFT_X` exactly:
 *
 *              1.92 s of world     19.2 s of world
 *   farField        +9.60 px            +96.0 px     (+5 px/s)
 *   midField       -15.36 px           -153.6 px     (-8 px/s)
 *   nearField      +21.12 px           +211.2 px     (+11 px/s)
 *   maxDy            0                    0          <- nothing ever fell
 *
 * Ten times the clock, ten times the distance: travel, not breathing. 211 px
 * is a quarter of the way across an 812 px window. After the fix the same
 * measurement gives `nestedMoved: 0` and a maxDx that goes DOWN from 12.02 to
 * 3.65 as the clock grows, which is a sine coming back round.
 *
 * Watch it fail: drop `crossDrift: false` from any scene below.
 *
 * The companion guard is `tests/unit/arch/noCrossDrift.test.ts`, and it is the
 * one that covers the screen nobody has written yet: this file can only visit
 * screens that exist, so it proves the mechanism while the source sweep proves
 * the coverage.
 */

/**
 * The widest a layer root may legitimately swing sideways, from `layers.ts`.
 *
 * `idleDriftPx` is a sine of amplitude `speed * 6` and `cameraSwayPx` one of
 * `2 * (0.25 + speed)`. The fastest layer is `foreVeil` at speed 1.8, so the
 * amplitude is 10.8 + 4.1 = 14.9 and a measurement taken between two arbitrary
 * phases can be up to twice that. Anything past it is not breathing.
 */
const SWAY_PEAK_TO_PEAK = 29.8;

/** Every screen that builds a world and has no gameplay lane. Flight is not here. */
const SCREENS = [
  "Title",
  "Briefing",
  "Preflight",
  "DirectorMap",
  "EarthActivation",
  "Warp",
  "Results",
  "Beacon",
  "Ending",
] as const;

interface Motion {
  worldSec: number;
  containers: number;
  /** Sub-planes of a layer. These are the ones that march; they must not. */
  nestedMoved: number;
  nested: { path: string; dx: number; dy: number }[];
  maxDx: number;
  maxDy: number;
}

async function motionOf(page: Page, scene: string, frames: number): Promise<Motion> {
  return page.evaluate(
    ([key, n]) => {
      const kb = (window as unknown as { __kb: { game: { scene: { getScene(k: string): unknown } } } })
        .__kb;
      const s = kb.game.scene.getScene(key) as {
        update(t: number, d: number): void;
        children: { list: unknown[] };
      };
      type Node = { type: string; x: number; y: number; list?: Node[] };
      const walk = (): { path: string; x: number; y: number }[] => {
        const acc: { path: string; x: number; y: number }[] = [];
        const rec = (node: Node, path: string): void => {
          if (node.type === "Container") acc.push({ path, x: node.x, y: node.y });
          node.list?.forEach((c, i) => rec(c, `${path}/${i}`));
        };
        (s.children.list as Node[]).forEach((c, i) => rec(c, `${i}`));
        return acc;
      };
      const before = walk();
      // 16 ms is the frame the game is built for; `update` clamps its own dt.
      for (let i = 0; i < (n as number); i += 1) s.update(i * 16, 16);
      const after = walk();
      const moved: { path: string; dx: number; dy: number }[] = [];
      for (const a of before) {
        const c = after.find((z) => z.path === a.path);
        if (c === undefined) continue;
        const dx = Number((c.x - a.x).toFixed(2));
        // WRAP-CORRECTED. A scrolling layer's y is `mod(H)`, so a run that
        // crosses 1080 comes back as a small or negative difference and reads
        // as "it stopped falling" - which cost this file one red run at a
        // ratio of 7.22 where the arithmetic says 10. Vertical travel is
        // always downward here, so a negative difference is one wrap.
        // Only sound while a single call travels less than H; callers below
        // stay well under it.
        const rawDy = c.y - a.y;
        const dy = Number((rawDy < -0.01 ? rawDy + 1080 : rawDy).toFixed(2));
        if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) moved.push({ path: a.path, dx, dy });
      }
      const nested = moved.filter((r) => r.path.includes("/"));
      return {
        worldSec: Number((((n as number) * 16) / 1000).toFixed(2)),
        containers: before.length,
        nestedMoved: nested.length,
        nested: nested.slice(0, 6),
        maxDx: moved.reduce((m, r) => Math.max(m, Math.abs(r.dx)), 0),
        maxDy: moved.reduce((m, r) => Math.max(m, Math.abs(r.dy)), 0),
      };
    },
    [scene, frames] as [string, number],
  );
}

async function boot(page: Page, scene: string): Promise<void> {
  await freezeReloads(page);
  await page.goto(`/?scene=${scene}`);
  await page.waitForFunction(() => (window as unknown as { __kb?: unknown }).__kb !== undefined, null, {
    timeout: 60_000,
  });
  await page.waitForFunction(
    (k) => {
      const kb = (window as unknown as {
        __kb?: { game: { scene: { getScene(key: string): { scene?: { isActive(): boolean } } | null } } };
      }).__kb;
      const s = kb?.game.scene.getScene(k);
      return s !== null && s !== undefined && s.scene?.isActive() === true;
    },
    scene,
    { timeout: 60_000 },
  );
}

test.describe("UR-50.5: no star layer travels on any screen", () => {
  for (const scene of SCREENS) {
    test(`${scene}: nothing crosses the frame`, async ({ page }) => {
      test.slow();
      await boot(page, scene);

      const short = await motionOf(page, scene, 120);
      const long = await motionOf(page, scene, 1200);

      // THE ASSERTION. A drift sub-plane that moves at all is travelling: its
      // only motion is the `mod(W)` march, so there is no bounded case to
      // allow for and the bar is zero rather than a tolerance.
      expect(
        short.nestedMoved,
        `${scene} planes travelling after 1.92 s: ${JSON.stringify(short.nested)}`,
      ).toBe(0);
      expect(
        long.nestedMoved,
        `${scene} planes travelling after 19.2 s: ${JSON.stringify(long.nested)}`,
      ).toBe(0);

      // The layer roots still sway, and that sway is BOUNDED by the motion
      // model rather than by a number somebody watched once.
      //
      // I set this bar at 16 on the first pass, from a single 3.65 px sample,
      // and all ten screens failed it at 24.7-25.0 px. The sample was right and
      // the bar was wrong: `maxDx` is a difference between two points on a sine,
      // so it can be anything up to the PEAK-TO-PEAK, and where it lands depends
      // only on which phase the two samples caught. Derived from `layers.ts`
      // instead, for the fastest layer (foreVeil, speed 1.8):
      //
      //   idleDriftPx  speed * 6            = 10.8
      //   cameraSwayPx 2 * (0.25 + speed)   =  4.1
      //   amplitude                          = 14.9  ->  peak-to-peak 29.8
      //
      // A travelling plane blows through this in three seconds, so the bar
      // still fails the defect; it just no longer fails the fix.
      expect(long.maxDx, `${scene} sideways: ${long.maxDx} px over 19.2 s`).toBeLessThanOrEqual(
        SWAY_PEAK_TO_PEAK,
      );
      expect(short.maxDx).toBeLessThanOrEqual(SWAY_PEAK_TO_PEAK);
    });
  }

  test("the sideways sway is BOUNDED, which is what tells it from travel", async ({
    page,
  }) => {
    test.slow();
    // The distinction the whole file rests on, measured directly rather than
    // argued: run the clock out by 8x and watch the sideways figure refuse to
    // grow, while the vertical one (Briefing scrolls at 30 px/s) multiplies.
    // A single sample cannot tell a sine from a ramp; four can.
    await boot(page, "Briefing");
    const runs: { sec: number; dx: number }[] = [];
    for (const frames of [600, 1200, 2400, 4800]) {
      const m = await motionOf(page, "Briefing", frames);
      runs.push({ sec: m.worldSec, dx: m.maxDx });
      expect(m.nestedMoved, `planes travelling at ${m.worldSec}s`).toBe(0);
    }
    const report = runs.map((r) => `${r.sec}s:${r.dx}px`).join("  ");
    for (const r of runs) {
      expect(r.dx, `sideways never exceeds the sway model - ${report}`).toBeLessThanOrEqual(
        SWAY_PEAK_TO_PEAK,
      );
    }
    // ...and it does not grow WITH the clock. A travelling plane would be 8x
    // bigger at the end of this list than at the start; measured, the figures
    // wander inside the sine (13.88, 3.85, 11.43, 2.55).
    const first = runs[0] as { dx: number };
    const last = runs[runs.length - 1] as { dx: number };
    expect(last.dx, `8x the clock must not be 8x the distance - ${report}`).toBeLessThan(
      first.dx * 8,
    );
  });

  test("Briefing: the belt moves, and it moves DOWN (UR-50.4)", async ({ page }) => {
    test.slow();
    // The other half of the report: "add debris drifting slowly DOWN inside the
    // window, so it reads as a view of a moving belt rather than a still
    // picture." The window took the default `worldSpeed` of 0, so the measured
    // vertical travel was exactly 0 px at every duration - the only thing
    // moving in the glass was the sideways march this file forbids.
    await boot(page, "Briefing");
    await page.evaluate(() => {
      const kb = (window as unknown as {
        __kb: { game: { scene: { getScene(k: string): { scene: { restart(d: unknown): void } } } } };
      }).__kb;
      kb.game.scene.getScene("Briefing").scene.restart({ stopId: "saturn" });
    });
    await page.waitForTimeout(1500);

    // 1.92 s and 9.6 s: both stay under one 1080 px wrap at this world speed
    // (the fastest layer covers 54 px/s, so 518 px at the long end).
    const short = await motionOf(page, "Briefing", 120);
    const long = await motionOf(page, "Briefing", 600);

    // Something falls...
    expect(short.maxDy, `vertical travel over 1.92 s: ${short.maxDy} px`).toBeGreaterThan(20);
    // ...and it falls at a CONSTANT RATE, which is what makes it a belt going
    // past rather than a layer rocking. Rate, not ratio: a rate survives the
    // wrap and says what the screen is actually doing in px/s.
    const rateShort = short.maxDy / short.worldSec;
    const rateLong = long.maxDy / long.worldSec;
    const report = `${rateShort.toFixed(1)} px/s at 1.92 s, ${rateLong.toFixed(1)} px/s at 9.6 s`;
    expect(rateShort, report).toBeGreaterThan(20);
    expect(Math.abs(rateLong - rateShort) / rateShort, report).toBeLessThan(0.1);
    // ...while the sideways axis stays put.
    expect(long.nestedMoved).toBe(0);
    expect(long.maxDy).toBeGreaterThan(long.maxDx * 10);
  });
});
