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
  pixelReadback?: boolean;
  stageWordCount?: number;
  stageDurationMs?: number;
  reducedMotion?: boolean;
  colorblindPalette?: boolean;
  knobs?: { maxLive?: number };
  book?: Record<string, unknown>;
}

/**
 * Vite's dev client and the app entry are stubbed out.
 *
 * The dev server is shared: a save anywhere in src/ pushes a full reload to
 * every open page, and a reload mid-flight destroys the execution context. And
 * `src/main.ts` would start the WHOLE game alongside the one scene under test,
 * so two Phaser instances would share a canvas stack, a keyboard and a frame
 * budget - and every number measured here would be measuring both.
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
