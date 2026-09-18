import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { FlightDebugState } from "../../src/game/scenes/FlightScene.js";
import { assertGameOnScreen } from "./support/flightBoot.js";

/**
 * The two measured core-loop numbers: P-22.9 (frame time) and L-6e.1 (input
 * latency). They live in their own spec file because they need the browser's
 * frame limiter off, and Playwright only accepts `launchOptions` at file level.
 *
 * WHY THE LIMITER IS OFF, stated plainly because it changes what the numbers
 * mean. Headless Chromium paces requestAnimationFrame against a virtual
 * display. With it on, every sample is quantised to the compositor's interval
 * and the measurement reports the display, not the game: p95 comes out at ~16.7
 * ms whatever the game does, and input latency is dominated by the wait for the
 * next vsync, which no amount of engine work can shorten. With it off, the
 * per-frame numbers below are the app's own work and the app's own response
 * time - which is what AC-22.9 ("60 fps: effects must be cheap") and AC-6e.1
 * ("input-to-visual latency") are about. Both artifacts record the method.
 */

test.use({
  launchOptions: {
    args: [
      "--disable-gpu-vsync",
      "--disable-frame-rate-limit",
      "--disable-background-timer-throttling",
    ],
  },
});

/**
 * Tracing off for this lane's specs.
 *
 * Playwright's trace recorder screenshots every action, and against a
 * full-resolution WebGL canvas that costs more than the game does: with it on,
 * this file runs about four times slower and the rocks - which fall on the wall
 * clock, because the learning engine's fall time is real seconds - reach the
 * breach line before the assertions do. The failures that produces are the
 * recorder's, not the game's. Failure screenshots are still captured.
 */
test.use({ trace: "off" });

const EVIDENCE_DIR = resolve(process.cwd(), "gauntlet/evidence");

function writeEvidence(file: string, data: Record<string, unknown>): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(join(EVIDENCE_DIR, file), `${JSON.stringify(data, null, 2)}\n`);
}

type FlightState = FlightDebugState;

const BOOT_MODULE = "/src/game/flight/boot.ts";

interface BootOptions {
  stopId?: string;
  debug?: boolean;
  stageWordCount?: number;
  stageDurationMs?: number;
  knobs?: { maxLive?: number };
}

/**
 * Vite's dev client is stubbed out for these tests.
 *
 * The dev server is shared, and a save anywhere in src/ makes it push a
 * full-reload to every open page. A reload in the middle of a flight destroys
 * the execution context and the test fails for a reason that has nothing to do
 * with the game. HMR is a authoring convenience, not a behaviour under test, so
 * the client is replaced with inert no-ops.
 */
async function muteHmr(page: Page): Promise<void> {
  // The Boot lane's `src/main.ts` starts the full game on page load. These
  // tests boot ONE game - screen 6 with a known config - so the app entry is
  // stubbed out: two Phaser instances on one page share a canvas stack, a
  // keyboard and a frame budget, and every number measured here would be
  // measuring both.
  // THE TRAILING `*` IS LOAD-BEARING (verification-gaps instance 17).
  // Vite serves the entry as `/src/main.ts?t=<ts>` once any file in the graph
  // has been saved, and a Playwright glob does not match a query string - so
  // without it this stub silently stops firing and the shipping game boots
  // alongside the one under test. Measured here, 9 boots per arm at
  // PW_WORKERS=1 with a `utimes` on src/game/boot.ts before each: without the
  // `*` the stub fired on 1 boot of 9, the page held FOUR canvases, and the
  // game this boot owns was below the fold in 6 of 9. With it, 9 of 9 fired,
  // two canvases, y=0 every time. `tests/unit/arch/oneBootPath.test.ts` now
  // fails if a copy of this stub loses the `*` again.
  await page.route("**/src/main.ts*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "export {};",
    }),
  );
  await page.route("**/@vite/client", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: [
        "export const createHotContext = () => ({ accept(){}, acceptExports(){}, dispose(){}, prune(){}, decline(){}, invalidate(){}, on(){}, off(){}, send(){}, data:{} });",
        "export const updateStyle = () => {};",
        "export const removeStyle = () => {};",
        "export const injectQuery = (url) => url;",
        "export const ErrorOverlay = class {};",
      ].join("\n"),
    }),
  );
}

async function bootFlight(page: Page, options: BootOptions = {}): Promise<void> {
  await muteHmr(page);
  await page.goto("/");
  await page.evaluate(
    async ([moduleUrl, opts]) => {
      const mod = (await import(moduleUrl as string)) as {
        // UR-36: the launcher now awaits `bootGame`, so this must be awaited.
        // Before the fix it returned void and the spec raced a second game
        // into existence; the boot it raced was not the shipping one either.
        bootFlight: (o: unknown) => Promise<unknown>;
      };
      await mod.bootFlight({ debug: true, ...(opts as Record<string, unknown>) });
    },
    [BOOT_MODULE, options] as const,
  );
  await page.waitForFunction(() => window.__kbFlight !== undefined, null, {
    timeout: 15_000,
  });
  await page.waitForFunction(
    () => (window.__kbFlight?.state().rocks.length ?? 0) > 0,
    null,
    { timeout: 15_000 },
  );
  // One game on the page, and on screen (instance 17 + 20). A frame-time
  // number measured while the shipping entry is rendering a second game
  // alongside this one is a number about two programs sharing a core.
  await assertGameOnScreen(page, "boot");
}

const state = (page: Page): Promise<FlightState> =>
  page.evaluate(() => window.__kbFlight?.state() as FlightState);

/**
 * SWEPT, NOT SAMPLED (coding-standards rule 5).
 *
 * This spec booted `maxLive: 5` alone for as long as it has existed, and that
 * was a fair worst case at the time: the difficulty controller's knob never
 * reached the running game, so every belt ran at the floor of 2 and a depth of
 * 5 was already generous. Closing that wiring changed what the shipping game
 * can produce - a route now climbs to 7, and time-weighted occupancy goes from
 * 1.00 rocks to 3.4-3.9. The board the budget has to survive is no longer the
 * board this spec was measuring.
 *
 * So it runs at both the depth it always did and the deepest the game can now
 * reach. 5 keeps writing `frametime.json`, which the rubric reads by name.
 */
for (const maxLive of [5, 7] as const) {
  const evidenceFile = maxLive === 5 ? "frametime.json" : `frametime-maxlive${maxLive}.json`;

  test(`P-22.9 / AC-22.9: p95 frame time over a scripted 60 s flight (maxLive ${maxLive})`, async ({
    page,
  }) => {
  test.setTimeout(180_000);
  const durationMs = 60_000;

  await bootFlight(page, {
    stageWordCount: 400,
    stageDurationMs: durationMs,
    knobs: { maxLive },
  });

  await page.evaluate(() => {
    const samples: number[] = [];
    const intervals: number[] = [];
    let frameStart = 0;
    let last = 0;
    const game = window.__kbGame as unknown as {
      events: {
        on(event: string, fn: () => void): void;
      };
    };
    game.events.on("prestep", () => {
      frameStart = performance.now();
    });
    game.events.on("postrender", () => {
      const now = performance.now();
      samples.push(now - frameStart);
      if (last > 0) intervals.push(now - last);
      last = now;
    });
    (window as unknown as { __kbFrames: { samples: number[]; intervals: number[] } }).__kbFrames =
      { samples, intervals };
  });

  // A scripted flight, not an idle one: keep typing for the whole window so
  // blasts, shards, plates and spawns are all in the measurement.
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    // One round trip per word, not per key: the measurement window is wall
    // clock, and a per-key round trip on a loaded box would spend the whole
    // minute waiting on the harness instead of flying.
    await page.evaluate(() => {
      const api = window.__kbFlight as NonNullable<typeof window.__kbFlight>;
      const target = api.state().rocks[0];
      if (target === undefined) return;
      for (const ch of target.word) {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: ch, code: `Key${ch.toUpperCase()}` }),
        );
      }
    });
    await page.waitForTimeout(120);
  }

  const measured = (await page.evaluate(() => {
    const { samples, intervals } = (
      window as unknown as {
        __kbFrames: { samples: number[]; intervals: number[] };
      }
    ).__kbFrames;
    const p95 = (values: number[]): number => {
      if (values.length === 0) return 0;
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] as number;
    };
    return {
      frames: samples.length,
      p95Work: p95(samples),
      p95Interval: p95(intervals),
      medianWork: p95(samples.slice()).valueOf(),
    };
  })) as {
    frames: number;
    p95Work: number;
    p95Interval: number;
  };

  writeEvidence(evidenceFile, {
    maxLive,
    p95Ms: Number(measured.p95Work.toFixed(2)),
    p95FrameIntervalMs: Number(measured.p95Interval.toFixed(2)),
    frames: measured.frames,
    observedFps: Number(((measured.frames / durationMs) * 1000).toFixed(1)),
    durationMs,
    method:
      "per-frame work measured from Phaser prestep to postrender, headless Chromium with the frame limiter off",
  });

  // Sample-size guard, not a frame-rate assertion: the wall-clock rate in a
  // headless software-GL page is the harness's, not the game's, and is recorded
  // beside the result as p95FrameIntervalMs rather than asserted on.
  expect(measured.frames).toBeGreaterThan(60);
  const flown = await state(page);
  expect(flown.hits).toBeGreaterThan(5); // it was a flight, not an idle screen
  expect(measured.p95Work).toBeLessThanOrEqual(16.7);
  });
}

test("L-6e.1 / AC-6e.1: p95 keydown-to-render latency", async ({ page }) => {
  test.setTimeout(240_000);
  await bootFlight(page, { stageWordCount: 200, knobs: { maxLive: 4 } });

  await page.evaluate(() => {
    const pending: number[] = [];
    const latencies: number[] = [];
    window.addEventListener(
      "keydown",
      () => pending.push(performance.now()),
      true,
    );
    const game = window.__kbGame as unknown as {
      events: { on(event: string, fn: () => void): void };
    };
    game.events.on("postrender", () => {
      const now = performance.now();
      while (pending.length > 0) latencies.push(now - (pending.shift() as number));
    });
    (window as unknown as { __kbLatency: number[] }).__kbLatency = latencies;
  });

  for (let i = 0; i < 40; i += 1) {
    const snapshot = await state(page);
    const target = snapshot.rocks[0];
    const key = target === undefined ? "a" : (target.word[0] as string);
    await page.keyboard.press(key);
    await page.waitForTimeout(45);
  }

  const measured = (await page.evaluate(() => {
    const values = (window as unknown as { __kbLatency: number[] }).__kbLatency;
    const sorted = [...values].sort((a, b) => a - b);
    return {
      samples: sorted.length,
      p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0,
      median: sorted[Math.floor(sorted.length / 2)] ?? 0,
    };
  })) as { samples: number; p95: number; median: number };

  writeEvidence("input-latency.json", {
    p95Ms: Number(measured.p95.toFixed(2)),
    medianMs: Number(measured.median.toFixed(2)),
    samples: measured.samples,
    method:
      "window keydown (capture) to the first Phaser postrender that follows it, headless Chromium with the frame limiter off",
  });

  expect(measured.samples).toBeGreaterThan(20);
  expect(measured.p95).toBeLessThanOrEqual(16.7);
});
