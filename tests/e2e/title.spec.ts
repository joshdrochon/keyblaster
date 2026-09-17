/**
 * TITLE e2e - screen 1 of the screen inventory.
 *
 * Three of these tests are the ONLY producers of evidence the gauntlet reads:
 *   gauntlet/evidence/title-idle-diff.json   -> rubric V-22.2  (AC-22.2)
 *   gauntlet/evidence/parallax-overlay.json  -> rubric V-22.1b (AC-22.1)
 *   gauntlet/evidence/lantern-render.png     -> rubric R-lantern (AC-24.2)
 * The key names below are the ones rubric.mjs asserts on; they are a contract,
 * not a convenience.
 *
 * The pixel diff is computed from two REAL screenshots of the canvas, decoded
 * and compared inside the page (the repo has no image-diff dependency and this
 * lane may not add one). Decoding a PNG in a browser is not an approximation.
 */

import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * TEMPORARY: traces off for this file. Remove when the note below is actioned.
 *
 * `playwright.config.ts` now gives each invocation its own `outputDir`, but
 * three lane configs at the repo root - `pw.lane-flight.config.ts`,
 * `pw.lane.tmp.config.ts`, `pw.story.config.ts` - set no `outputDir` at all, so
 * they default to `test-results/` ITSELF. Playwright clears its outputDir when a
 * run starts, so any of those three wipes the whole tree including another
 * run's per-invocation subdirectory. The victim run then dies in
 * `browserContext.close` with ENOENT writing its trace - AFTER its assertions
 * have passed, which is what makes it look like a flaky test.
 *
 * The fix is one line in each of those three configs (the same
 * `outputDir: path.join("test-results", runId)` the main config uses). Once
 * they have it, delete this `test.use` and the traces come back.
 */
test.use({ trace: "off" });

/**
 * One WebGL context at a time for this file.
 *
 * `fullyParallel: true` spreads these eight tests across eight workers, each
 * booting its own Phaser WebGL canvas. Eight live contexts on one GPU - plus
 * whatever other lanes are running - starve the render loop, and a test that
 * measures ANIMATION then fails on a machine that is merely busy. Running the
 * file in one worker costs a few seconds and removes the whole class of
 * false failure. `default` rather than `serial` on purpose: one test failing
 * must not skip the rest, because each writes a different evidence artifact.
 */
test.describe.configure({
  mode: "default",
  // 30 s (the default) is not enough for a suite that deliberately waits out
  // two seconds of real animation per test; alone these run in ~20 s, and a
  // loaded machine pushes them past the limit.
  timeout: 150_000,
});

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EVIDENCE = join(REPO, "gauntlet", "evidence");

function writeEvidence(name: string, body: string | Buffer): void {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, name), body);
}

/**
 * Kill Vite's HMR socket before anything loads.
 *
 * Six lanes write into src/ while this suite runs, and every save makes the dev
 * server push a full reload. A reload mid-measurement detaches the canvas and
 * fails the test for a reason that has nothing to do with the screen. The game
 * itself opens no WebSocket, so stubbing the constructor costs nothing.
 */
async function freezeReloads(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class DeadSocket extends EventTarget {
      readonly readyState = 3;
      send(): void {}
      close(): void {}
    }
    (window as unknown as Record<string, unknown>)["WebSocket"] = DeadSocket;
  });
}

/** A frame of the game. Viewport-level, so an HMR swap cannot detach it. */
async function frame(page: Page): Promise<Buffer> {
  return page.screenshot({ timeout: 60_000 });
}

/** Game-clock reading, in ms. */
async function elapsed(page: Page): Promise<number> {
  return page.evaluate(() => {
    const t = (window as unknown as Record<string, Record<string, unknown>>)["__kb"]?.[
      "title"
    ] as { motion: () => { elapsedMs: number } };
    return t.motion().elapsedMs;
  });
}

/**
 * Wait for the RENDER LOOP to advance by `ms`, not just the wall clock.
 *
 * Eight WebGL contexts run in parallel in this suite and a headless GPU can
 * stall one of them. Sleeping on the wall clock through a stall would compare
 * two identical frames and fail AC-22.2 for a reason that has nothing to do
 * with the screen; "one second apart" means one second of the animation.
 */
async function advanceGameTime(page: Page, ms: number): Promise<void> {
  const from = await elapsed(page);
  await page.waitForFunction(
    ([start, span]: [number, number]) => {
      const t = (window as unknown as Record<string, Record<string, unknown>>)["__kb"]?.[
        "title"
      ] as { motion: () => { elapsedMs: number } };
      return t.motion().elapsedMs - start >= span;
    },
    [from, ms] as [number, number],
    { timeout: 60_000 },
  );
}

/** Wait for boot AND for the Title scene to have published its debug bag. */
async function openTitle(page: Page, query = ""): Promise<void> {
  await freezeReloads(page);
  await page.goto(`/?scene=Title${query}`);
  await expect(page.getByTestId("app")).toHaveAttribute("data-booted", "true");
  await page.waitForFunction(() => {
    const bag = (window as unknown as Record<string, Record<string, unknown>>)["__kb"];
    return bag !== undefined && bag["title"] !== undefined;
  });
  // One extra beat so the entrance tweens have settled before anything is measured.
  await page.waitForTimeout(700);
}

/** Percentage of pixels that differ between two base64 PNGs, decoded in-page. */
async function pixelDiffPercent(page: Page, a: string, b: string): Promise<number> {
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
      // 12/255 ignores encoder noise; anything a person could see clears it.
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

// ---------------------------------------------------------------------------

test("AC-22.2 two Title frames 1 s apart differ by more than 2% of pixels", async ({ page }) => {
  await openTitle(page);

  const shotA = await frame(page);
  await advanceGameTime(page, 1000);
  const shotB = await frame(page);

  const diffPercent = await pixelDiffPercent(
    page,
    shotA.toString("base64"),
    shotB.toString("base64"),
  );

  // The judge step wants to SEE the two frames, not just the number (D85).
  writeEvidence("title-idle-a.png", shotA);
  writeEvidence("title-idle-b.png", shotB);
  // Shape is fixed by tests/gauntlet/rubric.mjs item V-22.2: key "diffPercent".
  writeEvidence(
    "title-idle-diff.json",
    `${JSON.stringify(
      {
        diffPercent,
        gapMs: 1000,
        threshold: 2,
        channelTolerance: 12,
        frames: ["gauntlet/evidence/title-idle-a.png", "gauntlet/evidence/title-idle-b.png"],
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );

  expect(diffPercent).toBeGreaterThan(2);
});

test("AC-22.1 at least five parallax layers actually move on the Title", async ({ page }) => {
  await openTitle(page);

  const read = (): Promise<Record<string, { x: number; y: number }>> =>
    page.evaluate(() => {
      const t = (window as unknown as Record<string, Record<string, unknown>>)["__kb"]?.[
        "title"
      ] as { parallaxOffsets: () => Record<string, { x: number; y: number }> };
      return t.parallaxOffsets();
    });

  const before = await read();
  await advanceGameTime(page, 600);
  const after = await read();

  const moved = Object.keys(before).filter((id) => {
    const a = before[id];
    const b = after[id];
    if (a === undefined || b === undefined) return false;
    return Math.abs(a.x - b.x) > 0.05 || Math.abs(a.y - b.y) > 0.05;
  });

  // A SEPARATE PATH FROM THE FLIGHT CAPTURE, deliberately.
  //
  // This test and `flight.spec.ts`'s V-22.1b both used to write
  // `parallax-overlay.json`, and rubric item V-22.1b - "the five speeds
  // ACTUALLY MOVING" - read whichever won the race. This one only measures
  // "did the layer move at all", which is a weaker claim, so when it won, the
  // rubric passed on evidence that did not measure its own item. The Flight
  // capture owns `parallax-overlay-flight.json` and the rubric reads that.
  writeEvidence(
    "parallax-overlay-title.json",
    `${JSON.stringify(
      {
        movingLayers: moved.length,
        layers: moved,
        sampleGapMs: 600,
        scene: "Title",
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );

  expect(moved.length).toBeGreaterThanOrEqual(5);
});

test("AC-18.1 the Title is operable with the keyboard alone and shows focus", async ({ page }) => {
  await openTitle(page);

  const focus = (): Promise<number> =>
    page.evaluate(
      () =>
        (
          (window as unknown as Record<string, Record<string, unknown>>)["__kb"]?.["title"] as {
            focusIndex: number;
          }
        ).focusIndex,
    );

  // D95: the Title carries two items, not three. The language row is omitted
  // when only one language ships, because a one-option selector is noise on
  // the first screen a child sees. The property AC-18.1 asserts - arrows and
  // Tab move a visible focus, and the list WRAPS so a child cannot get stuck
  // at the end - is unchanged and is what is checked here. `last` is derived
  // rather than written as a literal so this survives the row coming back.
  const last = await page.evaluate(
    () =>
      (
        (window as unknown as Record<string, Record<string, unknown>>)["__kb"]?.["title"] as {
          items: string[];
        }
      ).items.length - 1,
  );
  expect(last).toBeGreaterThan(0);

  const count = last + 1;
  expect(await focus()).toBe(0);
  await page.keyboard.press("ArrowDown");
  expect(await focus()).toBe(1 % count);
  // Tab is a second way to move the same focus, and it advances by one.
  await page.keyboard.press("Tab");
  expect(await focus()).toBe(2 % count);
  // Wraps at both ends, so a child cannot get stuck.
  while ((await focus()) !== last) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  expect(await focus()).toBe(0);
  await page.keyboard.press("ArrowUp");
  expect(await focus()).toBe(last);

  // The focus ring is drawn, not implied: the frame must change when focus moves.
  const a = await frame(page);
  await page.keyboard.press("ArrowUp");
  await advanceGameTime(page, 350);
  const b = await frame(page);
  expect(await pixelDiffPercent(page, a.toString("base64"), b.toString("base64"))).toBeGreaterThan(0);
});

test("AC-14.4 / D95 the Title offers no unshipped language", async ({ page }) => {
  // This was "D45 the language switch is visible and changes the UI language",
  // driving the row to Spanish. D95 ships English only, so there is no second
  // language to switch to and the row is not drawn at all.
  //
  // NOT deleted. Deleting it would make the cut invisible, and a check that
  // passes by having nothing left to measure is this repo's signature failure.
  // It now asserts the cut, and goes red the day SHIPPED_LANGS grows - which
  // is exactly when the switch assertions above should come back.
  await openTitle(page);

  const state = (): Promise<{ lang: string; items: string[] }> =>
    page.evaluate(
      () =>
        (window as unknown as Record<string, Record<string, unknown>>)["__kb"]?.["title"] as {
          lang: string;
          items: string[];
        },
    );

  expect((await state()).lang).toBe("en");
  // The language row is not among the focusable items at all.
  expect((await state()).items).toEqual(["primary", "settings"]);

  // Walking the whole list and pressing Right anywhere cannot change it.
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowRight");
  }
  await page.waitForTimeout(400);
  expect((await state()).lang).toBe("en");
});

test("AC-19.3 reduced motion removes camera sway and keeps ambient drift", async ({ page }) => {
  await openTitle(page, "&reducedMotion=1");

  const motion = (): Promise<{ swayPx: number; reducedMotion: boolean }> =>
    page.evaluate(() => {
      const t = (window as unknown as Record<string, Record<string, unknown>>)["__kb"]?.[
        "title"
      ] as { motion: () => { swayPx: number; reducedMotion: boolean } };
      return t.motion();
    });

  const first = await motion();
  expect(first.reducedMotion).toBe(true);
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(250);
    expect((await motion()).swayPx).toBe(0);
  }

  // Drift is KEPT: the world must still be alive, just not swaying.
  const a = await frame(page);
  await advanceGameTime(page, 1000);
  const b = await frame(page);
  const diff = await pixelDiffPercent(page, a.toString("base64"), b.toString("base64"));
  writeEvidence(
    "title-reduced-motion.json",
    `${JSON.stringify({ diffPercent: diff, swayPx: 0, reducedMotion: true }, null, 2)}\n`,
  );
  expect(diff).toBeGreaterThan(2);
});

test("returning pilots get Continue and their furthest beacon", async ({ page }) => {
  const progress = [
    "earth",
    "mars",
    "jupiter",
    "saturn",
    "uranus",
    "neptune",
    "pluto",
  ].map((stopId, i) => ({
    stopId,
    cleared: i <= 2,
    stars: i <= 2 ? 3 : 0,
    bestWpm: 0,
    bestAccuracy: 0,
    lastWpm: 0,
    lastAccuracy: 0,
    beaconPlacedAt: i <= 2 ? 1_700_000_000_000 + i : null,
  }));

  await page.addInitScript(
    ([key, payload]: [string, string]) => {
      window.localStorage.setItem(key, payload);
    },
    [
      "kb:v1:profiles",
      JSON.stringify({
        version: 2,
        activeProfileId: "pilot-test",
        profiles: [
          {
            id: "pilot-test",
            name: "Ada",
            avatar: "avatar-1",
            shipId: "ship-1",
            shipName: "Lantern",
            createdAt: 1_700_000_000_000,
            calibration: { ikiMs: 350, fkLatencyMs: 500 },
            progress,
            trophies: [],
            unlockedShips: ["ship-1"],
            unlockedSkins: [],
            words: {},
          },
        ],
      }),
    ] as [string, string],
  );

  await openTitle(page);
  const bag = await page.evaluate(
    () =>
      (window as unknown as Record<string, Record<string, unknown>>)["__kb"]?.["title"] as {
        primary: string;
        furthestBeacon: string | null;
      },
  );
  expect(bag.primary).toBe("continue");
  expect(bag.furthestBeacon).toBe("jupiter");
});

test("AC-24.2 the vector Lantern renders for the reference compare", async ({ page }) => {
  await freezeReloads(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?lantern=1");
  // index.html paints the page dark; clearing it lets omitBackground produce a
  // genuinely transparent PNG, so the judge sees silhouette and nothing else.
  await page.addStyleTag({ content: "html,body{background:transparent !important}" });
  await expect(page.getByTestId("app")).toHaveAttribute("data-booted", "true");
  await page.waitForFunction(
    () => (window as unknown as { __kbLanternShot?: boolean }).__kbLanternShot === true,
  );
  await page.waitForTimeout(600);

  // Filename is fixed by rubric.mjs item R-lantern.
  writeEvidence(
    "lantern-render.png",
    await page.screenshot({ omitBackground: true, timeout: 60_000 }),
  );
});

test("no UI string is missing from the active language table", async ({ page }) => {
  await openTitle(page);
  const misses = await page.evaluate(
    () =>
      ((window as unknown as Record<string, Record<string, unknown>>)["__kb"]?.[
        "i18nMisses"
      ] as string[]) ?? [],
  );
  expect(misses).toEqual([]);
});
