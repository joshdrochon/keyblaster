import type { Page } from "@playwright/test";
// Type-only: erased before Playwright loads this file, so the scene's debug
// contract is checked at compile time without bundling src into the runner.
import type { FlightDebugState, SpawnDebugOptions } from "../../../src/game/scenes/FlightScene.js";

/**
 * Booting screen 6 on its own, shared between the flight specs.
 *
 * `tests/e2e/flight.spec.ts` grew its own copy of this first; it is lifted here
 * rather than exported from a spec file because Playwright collects
 * `**\/*.spec.ts` as suites, and importing one suite from another runs it twice.
 */

export type FlightState = FlightDebugState;
export type RockView = FlightDebugState["rocks"][number];

const BOOT_MODULE = "/src/game/flight/boot.ts";

export interface BootOptions {
  stopId?: string;
  seed?: number;
  debug?: boolean;
  stageWordCount?: number;
  stageDurationMs?: number;
  reducedMotion?: boolean;
  colorblindPalette?: boolean;
  /**
   * UR-36: accepted and ignored, so the specs that still pass it keep
   * compiling. There is no second render config any more - see
   * `src/game/flight/boot.ts`. Pixels come from a decoded screenshot.
   */
  pixelReadback?: boolean;
  /**
   * FR-8 scales fall time by this, so it is also the only honest way for a spec
   * to give a rock more rendered frames on a box that renders at 4.5 fps. A
   * slow pilot's calibration is a shipped configuration, not a test hook.
   */
  calibration?: { ikiMs: number; fkLatencyMs: number };
  /** UR-33's hold, ms. See `FlightConfig.hitStopMs` for why a spec sets it. */
  hitStopMs?: number;
  knobs?: { maxLive?: number };
  book?: Record<string, unknown>;
}

/**
 * Vite's dev client is stubbed out, and so is the app entry.
 *
 * The dev server is shared: a save anywhere in src/ pushes a full reload to
 * every open page, and a reload mid-flight destroys the execution context.
 *
 * `src/main.ts` is stubbed for a DIFFERENT reason now, and the old one is worth
 * correcting because it was the argument that justified a second product.
 * It used to read "main.ts would start the WHOLE game alongside the one scene
 * under test, so two Phaser instances would share a canvas stack" - true, and
 * the answer to it was to build a second `Phaser.Game`, which is UR-36. Since
 * that boot is now an adapter over `bootGame`, letting `main.ts` run would
 * start the shipping game and then `bootFlight` would start a second copy OF
 * THE SAME GAME. One boot per page; the stub is what keeps it to one.
 */
export async function muteHmr(page: Page): Promise<void> {
  await page.route("**/src/main.ts", (route) =>
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
        "export const createHotContext = () => ({ accept(){}, dispose(){}, prune(){}, invalidate(){}, on(){}, off(){}, send(){} });",
        "export const updateStyle = () => {};",
        "export const removeStyle = () => {};",
        "export const injectQuery = (url) => url;",
        "export const ErrorOverlay = class {};",
      ].join("\n"),
    }),
  );
}

export async function bootFlight(page: Page, options: BootOptions = {}): Promise<void> {
  await muteHmr(page);
  await page.goto("/");
  await page.evaluate(
    async ([moduleUrl, opts]) => {
      const mod = (await import(moduleUrl as string)) as { bootFlight: (o: unknown) => void };
      mod.bootFlight({ debug: true, ...(opts as Record<string, unknown>) });
    },
    [BOOT_MODULE, options] as const,
  );
  await page.waitForFunction(() => window.__kbFlight !== undefined, null, { timeout: 30_000 });
  await page.waitForFunction(
    () => (window.__kbFlight?.state().rocks.length ?? 0) > 0,
    null,
    { timeout: 30_000 },
  );
}

export const flightState = (page: Page): Promise<FlightState> =>
  page.evaluate(() => window.__kbFlight?.state() as FlightState);

/**
 * The on-screen box of the canvas THIS BOOT created, by identity.
 *
 * `lane.gameCanvas` finds it with `canvas:not([data-testid="viewport-backdrop"])`,
 * which is a guess about the document rather than a handle on the game, and in
 * the full 3-worker run of 2026-09-16 the guess broke: a third canvas appeared
 * on the page and `locator.boundingBox` failed with
 *
 *   strict mode violation: resolved to 2 elements
 *
 * BEFORE the spec had asserted anything - so `plate-legibility.spec.ts:128` was
 * reported as a legibility failure while nothing about legibility had been
 * measured. See `test-results/69955/.../error-context.md`.
 *
 * `bootFlight` already publishes the game it started, and a Phaser game owns
 * its canvas, so the flight specs can ask the game under test which canvas is
 * theirs instead of asking the DOM which canvas looks right. This is narrower
 * than the locator, not looser: an extra canvas can no longer change the
 * answer, and neither can a missing test id.
 */
export async function flightCanvasBox(
  page: Page,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.evaluate(() => {
    const canvas = (window.__kbGame as unknown as { canvas?: HTMLCanvasElement } | undefined)
      ?.canvas;
    if (canvas === undefined) return null;
    const r = canvas.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  if (box === null) throw new Error("the flight game has no canvas");
  return box;
}

/** Put a KNOWN word on the belt, optionally at a KNOWN place. */
export async function spawnAt(
  page: Page,
  word: string,
  options: SpawnDebugOptions = {},
): Promise<void> {
  await page.evaluate(
    ([w, o]) => window.__kbFlight?.spawn(w as string, o as SpawnDebugOptions),
    [word, options] as const,
  );
  await page.waitForFunction(
    (w) => (window.__kbFlight?.state().rocks ?? []).some((r) => r.word === w),
    word,
    { timeout: 15_000 },
  );
}

/** Wait for N rendered frames. "Wait 40 ms" is not the same as "a new frame". */
export async function waitFrames(page: Page, count: number): Promise<void> {
  await page.evaluate(async (n) => {
    const game = window.__kbGame as unknown as {
      events: { on(e: string, f: () => void): void; off(e: string, f: () => void): void };
    };
    await new Promise<void>((resolve) => {
      let seen = 0;
      const onRender = (): void => {
        seen += 1;
        if (seen >= (n as number)) {
          game.events.off("postrender", onRender);
          resolve();
        }
      };
      game.events.on("postrender", onRender);
    });
  }, count);
}

/**
 * Freeze the belt.
 *
 * Rocks fall on the WALL CLOCK, and reading the scene state then taking a
 * screenshot is several CDP round trips - long enough on a loaded headless box
 * for a rock to move a hundred pixels. A spec that measures pixels against
 * coordinates it read a moment earlier is measuring two different frames, and
 * it will be green or red depending on how busy the machine is.
 *
 * `scene.pause()` stops `update` and leaves rendering alone, so the frame on
 * screen is exactly the frame the state describes.
 */
export async function freezeFlight(page: Page, paused = true): Promise<void> {
  await page.evaluate((stop) => {
    const game = window.__kbGame as unknown as {
      scene: { getScene(key: string): { scene: { pause(): void; resume(): void } } };
    };
    const flight = game.scene.getScene("Flight");
    if (stop) flight.scene.pause();
    else flight.scene.resume();
  }, paused);
}
