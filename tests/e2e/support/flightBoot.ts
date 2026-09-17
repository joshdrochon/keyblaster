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
  /**
   * Which hull to fly (D79). A standalone mount has no profile, so this is the
   * only way to put a specific ship on the belt - and the only way to check
   * that picking a different one changes what is drawn.
   */
  shipId?: string;
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
  /**
   * THE TRAILING `*` IS LOAD-BEARING (instance 17).
   *
   * This was `**\/src/main.ts`, and it matched nothing the moment anybody saved
   * a file. Vite invalidates the module graph on a save and then serves the
   * entry as `/src/main.ts?t=<timestamp>`; Playwright's glob does not match a
   * query string, so the stub fell through and the REAL entry booted.
   *
   * Measured, not inferred. Cold boot: 1 game, 2 canvases. After one `utimes`
   * on a file in the graph, the same boot requests
   * `/src/main.ts?t=1789643211779` and the page ends up with FOUR canvases -
   * two viewport backdrops and two 1920-wide games, one at y=0 and one at
   * y=720. That is the parallel-boot defect UR-36 deleted from `src/`,
   * re-created at RUNTIME, where `tests/unit/arch/oneBootPath.test.ts` greps
   * source and cannot possibly see it.
   *
   * The condition is "a file was saved while the dev server was up", which is
   * the normal state of an overnight build with lanes working - so the e2e
   * evidence has been trustworthy when nobody was working and unreliable
   * exactly when everybody was.
   */
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

  /**
   * ONE GAME ON THE PAGE, CHECKED AT RUNTIME.
   *
   * `oneBootPath.test.ts` asserts there is one `new Phaser.Game` in `src/`, and
   * that is true and was not enough: a second game can arrive because the entry
   * point booted alongside this one, which is a fact about the network rather
   * than about the source. Two games share a canvas stack, a keyboard and a
   * frame budget, and `__kbGame` then points at whichever won - measured as a
   * coin flip, the game canvas landing at y=0 in half the runs and y=720 in the
   * other half. A capture taken then is of whichever game is on top, which is
   * how a spec asking for a Saturn belt got back the Title screen.
   *
   * Checked here because every flight spec goes through this function, and
   * checked LOUDLY because the failure it catches is invisible in every other
   * way: the scene boots, the state reads, the assertions run, and the pixels
   * belong to a different program.
   */
  const layout = await page.evaluate(() => {
    const all = [...document.querySelectorAll("canvas")];
    const describe = (c: Element): { width: number; y: number; height: number } => {
      const r = c.getBoundingClientRect();
      return {
        width: (c as HTMLCanvasElement).width,
        y: Math.round(r.y),
        height: Math.round(r.height),
      };
    };
    return {
      games: all
        .filter((c) => (c as HTMLElement).dataset["testid"] !== "viewport-backdrop")
        .map(describe),
      backdrops: all
        .filter((c) => (c as HTMLElement).dataset["testid"] === "viewport-backdrop")
        .map(describe),
      viewH: window.innerHeight,
    };
  });
  if (layout.games.length !== 1) {
    throw new Error(
      `${layout.games.length} game canvases on the page, expected 1: ${JSON.stringify(layout)}. ` +
        "The app entry booted alongside this one - see muteHmr. Every pixel measured " +
        "from here would belong to whichever game won the race.",
    );
  }
  /**
   * AND IT HAS TO BE ON SCREEN.
   *
   * `#app` is `display:grid; place-items:center` and the viewport backdrop is
   * absolutely positioned so it does not take a grid row. When that goes wrong -
   * a second backdrop, or one that has not had its positioning applied yet - the
   * two canvases become two ROWS and the game is pushed entirely below the fold.
   * Caught in a 3-worker run as `{"y":720, "height":720, "viewH":720}`: the
   * game's top edge exactly at the bottom of the window.
   *
   * Every pixel this harness measures is a screenshot clipped to that canvas, so
   * a canvas off the fold is a measurement of nothing. Asserted at BOOT, with
   * the geometry, rather than surfacing later as a Playwright clip error in the
   * middle of somebody's rubric item.
   */
  const game = layout.games[0];
  if (game !== undefined && game.y >= layout.viewH) {
    throw new Error(
      `the game canvas is below the fold: ${JSON.stringify(layout)}. Two canvases have ` +
        "become two grid rows; nothing measured from a clip to this canvas is the game.",
    );
  }
  if (layout.backdrops.length > 1) {
    throw new Error(
      `${layout.backdrops.length} viewport backdrops on the page: ${JSON.stringify(layout)}.`,
    );
  }
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
    return {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      viewW: window.innerWidth,
      viewH: window.innerHeight,
    };
  });
  if (box === null) throw new Error("the flight game has no canvas");

  /**
   * CLAMPED TO THE VIEWPORT, because `page.screenshot({ clip })` refuses a
   * rectangle that reaches outside the image: "Clipped area is either empty or
   * outside the resulting image". A canvas can sit partly outside it - during a
   * resize, or before layout has settled - and every caller here feeds this box
   * straight to `clip`, so the failure surfaces as a Playwright error in the
   * middle of a measurement rather than as anything diagnosable.
   *
   * Clamped rather than asserted: a few pixels off the edge is not a defect, and
   * the measurements that use this are fractional across the canvas. A box with
   * NO overlap at all is a different thing and throws, because measuring it
   * would return whatever happened to be at the origin.
   */
  const x = Math.max(0, Math.min(box.x, box.viewW));
  const y = Math.max(0, Math.min(box.y, box.viewH));
  const width = Math.max(0, Math.min(box.x + box.width, box.viewW) - x);
  const height = Math.max(0, Math.min(box.y + box.height, box.viewH) - y);
  if (width < 1 || height < 1) {
    throw new Error(
      `the game canvas is not on screen: ${JSON.stringify(box)}. Nothing measured ` +
        "from a screenshot clipped to it would be the game.",
    );
  }
  return { x, y, width, height };
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

/**
 * ========================= THE BELT HOLDS ONE ROCK =========================
 *
 * Three specs in three files failed with one root cause, and a fourth was
 * suspected. Each assumed a rock would be there at the moment it looked:
 *
 *   world-frame-invariants  read `rocks[0]`, typed its first letter, and asked
 *                           the iris what it did - "nothing was blasted"
 *   the audio lane's spec   typed a whole word (which DESTROYS the rock), waited
 *                           400 ms, then read once and hoped a replacement had
 *                           spawned AND fallen into frame
 *
 * The belt holds ONE word rock (`gauntlet/evidence/belt-concurrency.json`
 * measures `floor(fallTime / expectedClearMs) == 1` at every pilot speed), and
 * that rock spends the first part of its life above the visible frame and then
 * leaves at the breach line. So "is a rock available right now" is false a
 * large fraction of the time, more so on a loaded machine - which is why these
 * looked like flakes and were not.
 *
 * TWO RULES, both learned the hard way in this file's history:
 *
 *   NEVER CONDITIONAL. If no rock arrives, this THROWS with what the belt was
 *   doing. A silent skip is how an assertion stops meaning anything - the audio
 *   lane found an `if (canister !== null)` that had been quietly skipping a
 *   whole cue for who knows how long.
 *
 *   WAIT ON THE THING, NOT ON A CLOCK. Every wait below is on the state that
 *   has to be true (a rock exists; `hits` went up), never on a duration that
 *   somebody guessed. `waitForTimeout` is how the specs above were written and
 *   it is why they were load-dependent.
 */

/** What the belt was doing, for a failure message that is worth reading. */
async function beltSummary(page: Page): Promise<string> {
  const live = await page.evaluate(() => {
    const s = window.__kbFlight?.state();
    if (s === undefined) return null;
    return {
      stalled: s.stalled,
      stageComplete: s.stageComplete,
      hull: `${s.hull}/${s.maxHull}`,
      hits: s.hits,
      maxLive: s.maxLive,
      rocks: s.rocks.map((r) => ({ word: r.word, y: Math.round(r.y), size: r.sizePx })),
    };
  });
  return live === null ? "no flight debug api on the page" : JSON.stringify(live);
}

export interface BlastableOptions {
  readonly timeout?: number;
  /**
   * Require the rock to be FULLY inside the 1080-tall design frame. On by
   * default: a rock above the top of the picture is typeable but invisible, and
   * a spec measuring pixels wants one it can see.
   */
  readonly onScreen?: boolean;
}

/**
 * Wait until the belt is carrying a rock that can be blasted, and return it.
 *
 * Throws with the belt's state if none arrives - see the rules above.
 */
export async function waitForBlastableRock(
  page: Page,
  options: BlastableOptions = {},
): Promise<RockView> {
  const { timeout = 25_000, onScreen = true } = options;
  const handle = await page
    .waitForFunction(
      (needOnScreen: boolean) => {
        const live = window.__kbFlight?.state();
        if (live === undefined || live.stalled || live.stageComplete) return null;
        const usable = live.rocks.find(
          (r) =>
            !needOnScreen || (r.y - r.sizePx / 2 > 0 && r.y + r.sizePx / 2 < 1080),
        );
        return usable ?? null;
      },
      onScreen,
      { timeout, polling: "raf" },
    )
    .catch(() => null);
  if (handle === null) {
    throw new Error(
      `no blastable rock arrived within ${timeout}ms. The belt: ${await beltSummary(page)}`,
    );
  }
  return (await handle.jsonValue()) as RockView;
}

/**
 * Destroy one rock with real keystrokes, and return the word that was blasted.
 *
 * THE WHOLE TYPING HAPPENS IN ONE `page.evaluate`, and that is the other half of
 * the fix. `world-frame-invariants` read the board, took `rocks[0].word[0]`, and
 * then dispatched it a round trip later - by which time the board could hold a
 * different rock whose first letter is different, so the keystroke was a typo,
 * nothing locked, and the loop that followed typed an empty string. Reading the
 * lock LIVE, in the same task as the keystrokes, removes that window.
 *
 * The first letter resolves the lock among every live rock (AC-2.1 guarantees
 * distinct first letters), so the remainder is typed from the word the game
 * CHOSE rather than the one the spec picked.
 */
export async function blastOneRock(
  page: Page,
  options: BlastableOptions = {},
): Promise<string> {
  const target = await waitForBlastableRock(page, options);
  const before = await page.evaluate(() => window.__kbFlight?.state().hits ?? 0);

  const typed = await page.evaluate((wanted: string) => {
    const api = window.__kbFlight;
    if (api === undefined) return null;
    const press = (ch: string): void => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: ch, code: `Key${ch.toUpperCase()}`, bubbles: true }),
      );
    };
    // Re-read: `wanted` came from the wait and is one round trip old. If it has
    // left the board, take whatever is live now rather than typing at a ghost.
    const live = api.state();
    const rock = live.rocks.find((r) => r.word === wanted) ?? live.rocks[0];
    if (rock === undefined) return null;
    press(rock.word[0] as string);
    const locked = api.state();
    const chosen = locked.rocks.find((r) => r.id === locked.lockedId);
    if (chosen === undefined) return null;
    for (const ch of chosen.word.slice(locked.typed.length)) press(ch);
    return chosen.word;
  }, target.word);

  if (typed === null) {
    throw new Error(`the keystrokes locked nothing. The belt: ${await beltSummary(page)}`);
  }

  // Wait on the BLAST, not on frames: `hits` is what "the ship fired" means.
  await page
    .waitForFunction(
      (was: number) => (window.__kbFlight?.state().hits ?? 0) > was,
      before,
      { timeout: 15_000, polling: "raf" },
    )
    .catch(() => null);
  const after = await page.evaluate(() => window.__kbFlight?.state().hits ?? 0);
  if (after <= before) {
    throw new Error(
      `typed "${typed}" and nothing was blasted (hits ${before} -> ${after}). ` +
        `The belt: ${await beltSummary(page)}`,
    );
  }
  return typed;
}
