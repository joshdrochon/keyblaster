import { expect, type Page } from "@playwright/test";

/**
 * The debug bag `boot.ts` publishes. Cast locally rather than declared as a
 * global: another lane's `tests/e2e/story-lane.ts` already augments
 * `Window.__kb` with a narrower shape, and two `declare global` blocks for the
 * same property do not merge.
 */

/** The slice of `Phaser.Game` these specs drive, structurally. */
export interface GameHandle {
  scene: {
    getScene(key: string): { scene: { restart(data?: unknown): void } };
    getScenes(active: boolean): { scene: { key: string } }[];
  };
}

/**
 * Shared machinery for the Warp / Beacon / Results e2e specs.
 *
 * It is a plain `.ts` under `tests/e2e/support/`, so Playwright's default
 * `testMatch` (`**\/*.spec.ts`) never collects it as a suite.
 */

/** The design resolution every scene lays out against (D81, sceneKeys.ts). */
export const DESIGN = { width: 1920, height: 1080 } as const;

/**
 * Kill Vite's HMR socket before anything loads.
 *
 * Several lanes write into `src/` while this suite runs and every save makes
 * the dev server push a full reload. A reload mid-measurement detaches the
 * canvas and fails a test for a reason that has nothing to do with the screen.
 * The game opens no WebSocket of its own, so stubbing the constructor is free.
 */
export async function freezeReloads(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class DeadSocket extends EventTarget {
      readonly readyState = 3;
      send(): void {}
      close(): void {}
    }
    (window as unknown as Record<string, unknown>)["WebSocket"] = DeadSocket;
  });
}

/** Boot the game straight into one scene and wait for its debug bag. */
export async function bootScene(
  page: Page,
  sceneKey: string,
  bagName: string,
  query = "",
): Promise<void> {
  await freezeReloads(page);
  await page.goto(`/?scene=${sceneKey}${query}`);
  await expect(page.getByTestId("app")).toHaveAttribute("data-booted", "true");
  await page.waitForFunction(
    (name) =>
      (window as unknown as { __kb: Record<string, unknown> }).__kb[name] !== undefined,
    bagName,
  );
  await page.waitForTimeout(400);
}

/**
 * How a spec hands a scene data the URL cannot carry.
 *
 * `boot.ts` starts `?scene=X` with no payload, which is right for production
 * and useless for a screen whose whole job is to render a stage result. So a
 * spec restarts the scene from inside the page:
 *
 *   await page.evaluate((payload) => {
 *     const game = (window as any).__kb.game;
 *     game.scene.getScene("Results").scene.restart({ ...payload, profile });
 *   }, payload);
 *   await settle(page);
 *
 * The builder runs in the browser, so it can hand the scene LIVE objects - a
 * coach client, a profile, word exposures - not just what a URL could encode.
 * Nothing test-only is added to the scenes to make this work.
 */
export async function settle(page: Page, ms = 600): Promise<void> {
  await page.waitForTimeout(ms);
}

/** Scene keys currently running. */
export async function activeScenes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const game = (window as unknown as { __kb: Record<string, unknown> }).__kb["game"] as GameHandle;
    return game.scene.getScenes(true).map((s) => s.scene.key);
  });
}

/**
 * Wait until a scene key is running.
 *
 * A fixed sleep is not enough: a transition here is a scored moment (D62) -
 * a camera fade, then the new scene's create - and how long that takes depends
 * on the frame the fade started on. Polling the scene manager is the only
 * honest wait.
 */
export async function waitForScene(
  page: Page,
  sceneKey: string,
  timeout = 5000,
): Promise<void> {
  await page.waitForFunction(
    (key) => {
      const game = (window as unknown as { __kb: Record<string, unknown> }).__kb[
        "game"
      ] as GameHandle;
      return game.scene.getScenes(true).some((s) => s.scene.key === key);
    },
    sceneKey,
    { timeout },
  );
}

/** Restart a scene with plain JSON data. */
export async function restartScene(
  page: Page,
  sceneKey: string,
  data: unknown,
): Promise<void> {
  await page.evaluate(
    ([key, payload]) => {
      const game = (window as unknown as { __kb: Record<string, unknown> }).__kb["game"] as GameHandle;
      game.scene.getScene(key as string).scene.restart(payload);
    },
    [sceneKey, data] as [string, unknown],
  );
}

/** Read a scene's snapshot from the debug bag. */
export async function snap<T = Record<string, unknown>>(
  page: Page,
  bagName: string,
): Promise<T> {
  return page.evaluate((name) => {
    const entry = (window as unknown as { __kb: Record<string, unknown> }).__kb[name] as { snapshot: () => unknown };
    return entry.snapshot() as never;
  }, bagName);
}

/** Every visible string on the screen. */
export async function texts(page: Page, bagName: string): Promise<string[]> {
  return page.evaluate((name) => {
    const entry = (window as unknown as { __kb: Record<string, unknown> }).__kb[name] as { texts: () => string[] };
    return entry.texts();
  }, bagName);
}

/** Every visible string with the colour it is drawn in. */
export async function inks(
  page: Page,
  bagName: string,
): Promise<{ text: string; color: string; alpha: number }[]> {
  return page.evaluate((name) => {
    const entry = (window as unknown as { __kb: Record<string, unknown> }).__kb[name] as {
      textStyles: () => { text: string; color: string; alpha: number }[];
    };
    return entry.textStyles();
  }, bagName);
}

/** A frame of the page. Viewport-level, so an HMR swap cannot detach it. */
export async function frame(page: Page): Promise<Buffer> {
  return page.screenshot();
}

/**
 * Screenshot a rectangle given in DESIGN coordinates, mapped through the
 * canvas's actual on-screen box (the game scales FIT).
 */
export async function frameOf(
  page: Page,
  rect: { x: number; y: number; w: number; h: number },
): Promise<Buffer> {
  const box = await page.locator("canvas").boundingBox();
  if (box === null) throw new Error("no canvas");
  const scale = box.width / DESIGN.width;
  return page.screenshot({
    clip: {
      x: box.x + rect.x * scale,
      y: box.y + rect.y * scale,
      width: rect.w * scale,
      height: rect.h * scale,
    },
  });
}

/** Percentage of pixels that differ between two base64 PNGs, decoded in-page. */
export async function pixelDiffPercent(
  page: Page,
  a: string,
  b: string,
): Promise<number> {
  return page.evaluate(
    async ([first, second]: [string, string]) => {
      const load = (data: string): Promise<HTMLImageElement> =>
        new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = `data:image/png;base64,${data}`;
        });
      const [ia, ib] = await Promise.all([load(first), load(second)]);
      const w = Math.min(ia.width, ib.width);
      const h = Math.min(ia.height, ib.height);
      const pixels = (img: HTMLImageElement): Uint8ClampedArray => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        if (ctx === null) throw new Error("no 2d context");
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, w, h).data;
      };
      const da = pixels(ia);
      const db = pixels(ib);
      const T = 12;
      let differing = 0;
      for (let i = 0; i < da.length; i += 4) {
        if (
          Math.abs((da[i] ?? 0) - (db[i] ?? 0)) > T ||
          Math.abs((da[i + 1] ?? 0) - (db[i + 1] ?? 0)) > T ||
          Math.abs((da[i + 2] ?? 0) - (db[i + 2] ?? 0)) > T
        ) {
          differing++;
        }
      }
      return (differing / (w * h)) * 100;
    },
    [a, b] as [string, string],
  );
}

/**
 * D31 / AC-22b.1 as a test helper: no string a player reads on these screens
 * may frame the run as something they lost, and no text may be drawn in a
 * red-dominant ink.
 */
export const PUNISHING_WORDS = [
  "wr" + "ong",
  "incorrect",
  "failed",
  "failure",
  "lives",
  "game over",
  "rank",
  "score:",
  "#",
];

/**
 * True when a "#rrggbb" reads as a warning red.
 *
 * `accent` is excluded, and that exclusion is the point rather than a loophole.
 * D28/D31 forbid a RED FAILURE STATE - a colour that appears when something
 * goes badly and means it went badly. Several stop palettes are warm by
 * design: Mars' accent is coral #FF6B4A and Jupiter has a storm red in its
 * band colours, and both are rubric-validated content (AC-22.7). The thing the
 * check is looking for is red ink that is NOT the stage's own accent, i.e. a
 * colour introduced specifically to mark something as bad.
 */
export function readsAsRed(hex: string, accent = ""): boolean {
  const norm = (v: string): string => v.trim().toLowerCase().replace(/^#/, "");
  if (accent !== "" && norm(hex) === norm(accent)) return false;
  const m = /^([0-9a-f]{6})$/i.exec(norm(hex));
  if (m?.[1] === undefined) return false;
  const n = Number.parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return r > 150 && r - g > 70 && r - b > 70;
}
