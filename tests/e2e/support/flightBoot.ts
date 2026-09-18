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
/**
 * How many times the app-entry stub actually fired, per page.
 *
 * Kept because the failure it explains is otherwise a geometry riddle. When the
 * glob misses, `entryHits` is 0 and the page quietly holds two games; printing
 * the count next to the geometry turns "the canvas is at y=720" into "the app
 * entry booted alongside this one and pushed it into a second grid row".
 */
const entryHits = new WeakMap<Page, { n: number }>();

export async function muteHmr(page: Page): Promise<void> {
  const hits = { n: 0 };
  entryHits.set(page, hits);
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
  await page.route("**/src/main.ts*", (route) => {
    hits.n += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "export {};",
    });
  });
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

  await assertGameOnScreen(page, "boot");

  /**
   * AND AGAIN ONCE THE FRAMES HAVE SETTLED.
   *
   * The check above runs the moment the first rock exists. Layout that depends
   * on a stylesheet, a resize observer or a second canvas arriving late is not
   * settled then, so a boot-time pass is a statement about one moment. Two
   * rendered frames later it is a statement about the frame a measurement will
   * actually be taken from. Cheap, and it is the half that was missing when
   * V-22.4 died "always after `bootFlight`'s own layout check had passed".
   *
   * It is NOT what fixed the 4-in-9 - see the note on `assertGameOnScreen` -
   * but a check taken once and too early is worth fixing on its own terms.
   */
  await waitFrames(page, 2);
  await assertGameOnScreen(page, "settled");
}

// ---------------------------------------------------------------------------
// The page is showing what you think it is (coding-standards rule 7)
// ---------------------------------------------------------------------------

interface CanvasBox {
  /** Backing-store width. Kept because it is how the two games told apart. */
  readonly width: number;
  /** The ON-SCREEN rect, which is what "on screen" has to be judged against. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** True for the canvas `__kbGame` owns - the one this boot created. */
  readonly mine: boolean;
}

interface PageLayout {
  readonly games: readonly CanvasBox[];
  readonly backdrops: readonly CanvasBox[];
  readonly viewW: number;
  readonly viewH: number;
  readonly entryStubHits: number;
}

/**
 * How far off the edge a canvas may sit before a measurement of it is a lie.
 *
 * Two device-independent pixels. A sub-pixel rect during a resize is not a
 * defect and clamping it is right; half the picture hanging out of the window
 * is the instance-20 defect and clamping it silently returns a clip of the part
 * that happened to fit. The old code clamped BOTH and only threw when the
 * overlap reached zero, so a canvas half off the bottom produced numbers that
 * looked entirely normal.
 */
const EDGE_SLACK_PX = 2;

export async function readLayout(page: Page): Promise<Omit<PageLayout, "entryStubHits">> {
  return page.evaluate(() => {
    const own = (window.__kbGame as unknown as { canvas?: HTMLCanvasElement } | undefined)?.canvas;
    const all = [...document.querySelectorAll("canvas")];
    // NOT rounded: `flightCanvasBox` derives its screenshot clip from this and
    // every pixel measurement downstream is fractional across the canvas.
    // Rounding happens only in the failure message.
    const describe = (c: Element): CanvasBox => {
      const r = c.getBoundingClientRect();
      return {
        width: (c as HTMLCanvasElement).width,
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        mine: c === own,
      };
    };
    const isBackdrop = (c: Element): boolean =>
      (c as HTMLElement).dataset["testid"] === "viewport-backdrop";
    return {
      games: all.filter((c) => !isBackdrop(c)).map(describe),
      backdrops: all.filter(isBackdrop).map(describe),
      viewW: window.innerWidth,
      viewH: window.innerHeight,
    };
  });
}

/**
 * ============ THE PAGE IS SHOWING WHAT YOU THINK IT IS, AT THIS MOMENT ============
 *
 * `docs/verification-gaps.md` instance 20: the game canvas rendered entirely
 * below the fold, so every pixel measured was a clip to a canvas nobody could
 * see, and the scene booted and the state read fine the whole time. Rule 7 says
 * to assert one game canvas, at most one backdrop, and that it is on screen.
 * This is that rule as code, and it is called at BOOT, again once the frames
 * have settled, and again from `flightCanvasBox` - which is every measurement
 * this harness takes.
 *
 * ================== THE 4-IN-9, MEASURED ==================
 * V-22.4 died in four of nine runs with
 * `the game canvas is not on screen: {"x":0,"y":720,...}`, at a different stop
 * each time. The escalated lean was that the layout drifts after boot and the
 * check is taken too early. It is not. Nine boots per arm, `PW_WORKERS=1`,
 * `utimes` on `src/game/boot.ts` before each boot (the condition instance 17
 * names: a file in the graph saved while the dev server is up, which is the
 * normal state of a parallel build):
 *
 *   route "**\/src/main.ts"   entry stub hit on 1 boot of 9, FOUR canvases -
 *                             two backdrops and two games - and the game this
 *                             boot owns at y=720 in 6 of 9. In the other 3 it
 *                             was at y=0 and the OTHER game was at y=720: the
 *                             coin flip instance 17 recorded, not a drift.
 *   route "**\/src/main.ts*"  entry stub hit on 9 boots of 9, two canvases,
 *                             the game at y=0. 0 of 9 below the fold.
 *
 * So the second grid row is a second `Phaser.Game`, present from the first
 * frame, and `flight.spec.ts`, `flight-perf.spec.ts` and `world-frame.spec.ts`
 * each carried a private copy of `muteHmr` with the glob instance 17 had
 * already been fixed in HERE. The fix to the harness is this function; the fix
 * to those three is the trailing `*`, and `tests/unit/arch/oneBootPath.test.ts`
 * now fails if a fourth copy appears.
 */
export async function assertGameOnScreen(page: Page, when: string): Promise<CanvasBox> {
  return checkLayout(page, await readLayout(page), when);
}

/**
 * The judgement, separated from the round trip that feeds it.
 *
 * `flightCanvasBox` needs the geometry AND the verdict, and taking them in two
 * `page.evaluate` calls would be the two-round-trip mistake instance 14 is
 * about - one extra trip between the state and the picture, on a world that
 * falls in real seconds. One read, one verdict, derived from the same rects.
 */
function checkLayout(
  page: Page,
  seen: Omit<PageLayout, "entryStubHits">,
  when: string,
): CanvasBox {
  const layout: PageLayout = { ...seen, entryStubHits: entryHits.get(page)?.n ?? -1 };
  const round = (b: CanvasBox): Record<string, number | boolean> => ({
    width: b.width,
    x: Math.round(b.x),
    y: Math.round(b.y),
    w: Math.round(b.w),
    h: Math.round(b.h),
    mine: b.mine,
  });
  const where = `at ${when}: ${JSON.stringify({
    ...layout,
    games: layout.games.map(round),
    backdrops: layout.backdrops.map(round),
  })}`;

  if (layout.games.length !== 1) {
    throw new Error(
      `${layout.games.length} game canvases on the page, expected 1, ${where}. ` +
        (layout.entryStubHits === 0
          ? "The app-entry stub NEVER FIRED, so `/src/main.ts` booted the shipping game " +
            "alongside this one. Vite serves the entry as `/src/main.ts?t=<ts>` once any " +
            "file in the graph has been saved, and a glob without a trailing `*` does not " +
            "match a query string (instance 17). "
          : "The app entry booted alongside this one - see muteHmr. ") +
        "Every pixel measured from here would belong to whichever game won the race.",
    );
  }
  if (layout.backdrops.length > 1) {
    throw new Error(`${layout.backdrops.length} viewport backdrops on the page, ${where}.`);
  }

  const game = layout.games[0];
  if (game === undefined) throw new Error(`no game canvas on the page, ${where}`);
  if (!game.mine) {
    throw new Error(
      `the only game canvas on the page is not the one \`__kbGame\` owns, ${where}. ` +
        "Measuring it would be measuring a program this boot did not start.",
    );
  }

  const off = {
    left: Math.max(0, -game.x),
    top: Math.max(0, -game.y),
    right: Math.max(0, game.x + game.w - layout.viewW),
    bottom: Math.max(0, game.y + game.h - layout.viewH),
  };
  const worst = Math.max(off.left, off.top, off.right, off.bottom);
  if (worst > EDGE_SLACK_PX) {
    throw new Error(
      `the game canvas is ${Math.round(worst)}px outside the viewport ` +
        `(${JSON.stringify(off)}), ${where}. ` +
        "`#app` is a centred grid and the backdrop is absolutely positioned so it takes no " +
        "row; a second in-flow canvas makes two ROWS and pushes the game off the window. " +
        "Nothing measured from a screenshot clipped to this canvas is the game.",
    );
  }
  return game;
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
  /**
   * ASSERTED AT THE MOMENT OF THE MEASUREMENT, THEN CLAMPED - in that order.
   *
   * Every caller feeds this box straight to `page.screenshot({ clip })`, so
   * this function is where a measurement gets BOUND to a picture. It used to
   * clamp anything and throw only when the overlap reached zero, which meant a
   * canvas half outside the window returned a clip of the part that fitted and
   * the caller got a well-formed number for a picture of nothing in particular.
   * Instance 20's whole lesson is that the numbers come back looking normal.
   *
   * So the layout is judged HERE rather than inherited from a boot-time pass:
   * one game canvas, at most one backdrop, it is the canvas `__kbGame` owns,
   * and it is inside the viewport to within `EDGE_SLACK_PX`. Coding-standards
   * rule 7 in code instead of in words. The clamp then only ever absorbs that
   * 2px of sub-pixel slack.
   *
   * ONE ROUND TRIP, deliberately. The verdict is computed from the SAME rects
   * the clip is cut from, in Node, rather than by asking the page a second
   * question - a second trip here would put a wall-clock gap between the check
   * and the picture on a world that falls in real seconds, which is the defect
   * instance 14 is about. The check costs nothing the old code did not spend.
   */
  const layout = await readLayout(page);
  if (layout.games.length === 0) throw new Error("the flight game has no canvas");
  const game = checkLayout(page, layout, "measurement");

  const x = Math.max(0, Math.min(game.x, layout.viewW));
  const y = Math.max(0, Math.min(game.y, layout.viewH));
  const width = Math.max(0, Math.min(game.x + game.w, layout.viewW) - x);
  const height = Math.max(0, Math.min(game.y + game.h, layout.viewH) - y);
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
