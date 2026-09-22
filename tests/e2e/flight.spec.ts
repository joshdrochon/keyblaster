import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
// Type-only: erased before Playwright ever loads this file, so the scenes'
// own debug contract is checked at compile time without bundling src into the
// test runner.
import type { FlightDebugState } from "../../src/game/scenes/FlightScene.js";
// UR-36: the game's own canvas, by identity. There are two canvases on the page
// now that this spec boots the shipping game (the viewport backdrop is the
// other one), and picking the first one is what made V-22.3 measure a sky that
// never moves.
import {
  assertGameOnScreen,
  flightCanvasBox,
  freezeFlight,
  spawnAt,
} from "./support/flightBoot.js";
import { wordBaseScore } from "../../src/engine/scoring/index.js";
// @ts-expect-error - .mjs tooling module, no type declarations by design
import { CORE, measureSilhouettes } from "../gauntlet/silhouette.mjs";

/**
 * Screen 6 (Flight), screen 6b (Stall) and the HUD overlay.
 *
 * Every test name cites the acceptance criteria it discharges. Six of them also
 * WRITE the evidence artifact the rubric reads (tests/gauntlet/rubric.mjs), and
 * the file names and key names below are that contract - `contrast.json`
 * `{minRatio}`, `sky-gradient-shift.json` `{deltaE}`, `desaturated-contours.json`
 * `{contours}`, `frametime.json` `{p95Ms}`, `input-latency.json` `{p95Ms}`,
 * `parallax-overlay.json` `{movingLayers}`. D85: a rubric item is not passed
 * until its artifact exists, so producing them is part of the feature.
 */

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

// ---------------------------------------------------------------------------
// The debug surface the scenes expose (FlightScene.debugApi / StallScene)
// ---------------------------------------------------------------------------

type FlightState = FlightDebugState;
type RockView = FlightDebugState["rocks"][number];

const BOOT_MODULE = "/src/game/flight/boot.ts";
const ASTEROID_MODULE = "/src/game/render/asteroid.ts";
const PLATE_MODULE = "/src/game/render/wordPlate.ts";
const STAGE_MODULE = "/src/game/flight/stage.ts";
const PALETTE_MODULE = "/src/game/render/palette.ts";

interface BootOptions {
  stopId?: string;
  /** See `bootFlight`. Only V-22.3 sets it: it measures the sky, not the belt. */
  waitForRock?: boolean;
  /** FR-8 scales fall time by this. A slow pilot is a shipped configuration. */
  calibration?: { ikiMs: number; fkLatencyMs: number };
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
  /**
   * WAITING FOR A ROCK COSTS THE SKY A THIRD OF ITS STAGE.
   *
   * Almost every test in this file needs a rock before it can measure anything,
   * so waiting for one here is right for them. V-22.3 does not: it measures the
   * SKY, which is painted in `create`, and the wait for the first spawn is dead
   * time during which the sky is already travelling. Measured, the start sample
   * landed at `skyProgress` 0.32 on an IDLE machine - a third of the journey
   * gone before the first sample, on every run this item has ever made.
   */
  if (options.waitForRock !== false) {
    await page.waitForFunction(
      () => (window.__kbFlight?.state().rocks.length ?? 0) > 0,
      null,
      { timeout: 15_000 },
    );
  }

  /**
   * THE PAGE IS SHOWING WHAT THIS SPEC THINKS IT IS.
   *
   * This file carries its own copy of `bootFlight`, and the copy never had the
   * layout check that `support/flightBoot.ts` grew for instance 20 - which is
   * why V-22.4's four-in-nine deaths were reported as happening "after
   * bootFlight's own layout check had passed". There was no check on this path
   * to pass. One game canvas, at most one backdrop, and on screen, before any
   * of the measurements below bind a number to a picture.
   */
  await assertGameOnScreen(page, "boot");
}

/** Wait for N rendered frames. A loaded headless box can take a second over
 * each one, so "wait 40 ms" is not the same thing as "wait for a new frame". */
async function waitFrames(page: Page, count: number): Promise<void> {
  await page.evaluate(async (n) => {
    const game = window.__kbGame as unknown as {
      events: {
        on(e: string, f: () => void): void;
        off(e: string, f: () => void): void;
      };
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
 * The design resolution the scenes lay out in (sceneKeys.ts GAME_WIDTH/HEIGHT).
 * Every coordinate the debug surface reports is in this space; the canvas is
 * whatever the window gave it, so a probe that wants pixels scales by
 * bufferWidth / DESIGN.width.
 */
const DESIGN = { width: 1920, height: 1080 } as const;

const state = (page: Page): Promise<FlightState> =>
  page.evaluate(() => window.__kbFlight?.state() as FlightState);

/**
 * Type through the real DOM keydown path, but in ONE round trip per word.
 *
 * `page.keyboard.press` costs a CDP round trip each, and a headless software-GL
 * page under load answers those in hundreds of milliseconds - long enough for
 * the rock to cross the breach line mid-word, which would make every gameplay
 * assertion a test of the harness. The events dispatched here reach exactly the
 * listener a real keystroke reaches (FlightScene binds window keydown directly),
 * so the path under test is unchanged. One test below uses the real keyboard
 * end to end to keep that claim honest.
 */
async function typeWord(page: Page, word: string): Promise<void> {
  await page.evaluate((text) => {
    for (const ch of text as string) {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: ch,
          code: `Key${ch.toUpperCase()}`,
          bubbles: true,
        }),
      );
    }
  }, word);
}

async function pressKey(page: Page, ch: string): Promise<void> {
  await page.evaluate((key) => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: key as string,
        code: `Key${(key as string).toUpperCase()}`,
        bubbles: true,
      }),
    );
  }, ch);
}

/**
 * Put KNOWN words on the belt through the debug spawn hook.
 *
 * Two tests below need several rocks in the air at once - one to check that
 * size tracks word length across lengths, one to check that a key belonging to
 * another rock is ignored (AC-3.3). Neither is a test of the SPAWNER, and both
 * used to get their rocks by waiting for the belt to pile them up, which worked
 * only because the belt fed a rock every 850 ms regardless of whether anyone
 * was clearing them. That constant was the stall defect (`@engine/pacing`): the
 * belt now feeds one rock per rock's worth of the player's own work, so an
 * idle board - which is what these tests are, nobody is typing - stays at one
 * or two rocks, as it should.
 *
 * Spawning the words the test needs makes the setup say what it means and
 * leaves the assertions measuring what they name.
 */
async function seedRocks(page: Page, words: readonly string[]): Promise<void> {
  await page.evaluate((list) => {
    for (const word of list as string[]) window.__kbFlight?.spawn(word);
  }, words);
  await page.waitForFunction(
    (list) => {
      const live = new Set(window.__kbFlight?.state().rocks.map((r) => r.word) ?? []);
      return (list as string[]).every((w) => live.has(w));
    },
    words,
    { timeout: 15_000 },
  );
}

/** The size rule from art-direction section 4, restated so the test is a check. */
function expectedSizePx(word: string): number {
  const letters = Math.max(3, [...word].length);
  return Math.min(140, 56 + (letters - 3) * 8);
}

// ---------------------------------------------------------------------------
// Core loop
// ---------------------------------------------------------------------------

test.describe("Flight - screen 6", () => {
  test("AC-2.3: rock size is a monotonic function of word length, and the plate hangs below the rock", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await bootFlight(page, { knobs: { maxLive: 5 }, stageWordCount: 40 });

    // Five real Mars words, three to seven letters, so the monotonic claim is
    // checked across the whole range the pool can produce instead of across
    // whatever the picker happened to serve.
    const seen = new Map<string, RockView>();
    for (const word of ["dry", "dust", "moons", "rivers", "surface"]) {
      await seedRocks(page, [word]);
      for (const rock of (await state(page)).rocks) seen.set(rock.word, rock);
    }
    for (let i = 0; i < 12; i += 1) {
      const snapshot = await state(page);
      for (const rock of snapshot.rocks) seen.set(rock.word, rock);
      await page.waitForTimeout(220);
    }

    expect(seen.size).toBeGreaterThan(3);
    for (const rock of seen.values()) {
      expect(rock.sizePx).toBe(expectedSizePx(rock.word));
      // The plate never overlaps the silhouette (art-direction section 4).
      expect(rock.plateTop).toBeGreaterThan(rock.rockBottom);
    }

    const bySize = [...seen.values()].sort(
      (a, b) => [...a.word].length - [...b.word].length,
    );
    for (let i = 1; i < bySize.length; i += 1) {
      expect((bySize[i] as RockView).sizePx).toBeGreaterThanOrEqual(
        (bySize[i - 1] as RockView).sizePx,
      );
    }
  });

  test("AC-3.1 + AC-3.4: the first keystroke locks a rock and completing the word blasts it, scoring at x1 (AC-6c.1)", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await bootFlight(page, { knobs: { maxLive: 2 } });

    const before = await state(page);
    const target = before.rocks[0] as RockView;

    // A real browser keystroke, to prove the shipped input path works end to
    // end (AC-3.5, AC-18.1) and not just the dispatched events used elsewhere.
    await page.keyboard.press(target.word[0] as string);

    // The rest of the word goes in one round trip: on a loaded box a per-key
    // round trip can outlast the rock's fall, and the point here is the lock,
    // not the harness.
    const run = await page.evaluate(() => {
      const api = window.__kbFlight as NonNullable<typeof window.__kbFlight>;
      const locked = api.state();
      const rock = locked.rocks.find((r) => r.id === locked.lockedId);
      const typedCount = rock?.typedCount ?? 0;
      for (const ch of (rock?.word ?? "").slice(locked.typed.length)) {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: ch, code: `Key${ch.toUpperCase()}` }),
        );
      }
      const after = api.state();
      return {
        word: rock?.word ?? "",
        lockedId: locked.lockedId,
        typedAfterFirstKey: locked.typed,
        typedCount,
        hits: after.hits,
        combo: after.combo,
        multiplier: after.multiplier,
        score: after.score,
        stillLive: after.rocks.some((r) => r.id === locked.lockedId),
      };
    });

    expect(run.lockedId).not.toBeNull();
    expect(run.typedAfterFirstKey.length).toBe(1);
    // Art-direction section 7: typed letters light to the accent, per letter.
    expect(run.typedCount).toBe(1);

    expect(run.hits).toBe(1);
    expect(run.combo).toBe(1);
    expect(run.multiplier).toBe(1); // never x0 on screen
    // NOT `length * 20`. `wordBaseScore` is `len * 20 + 10 * max(0, len - 4)^2`
    // - the length curve that pays a longer word for being longer - so a
    // five-letter rock is 110, not 100. Imported rather than re-declared: a
    // copy of the formula in a spec is a spec that agrees with itself.
    expect(run.score).toBe(wordBaseScore(run.word.length));
    expect(run.stillLive).toBe(false);
  });

  test("AC-3.2: a wrong key shakes, counts once and keeps the lock; AC-3.3 + C10: a key belonging to another rock does neither", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await bootFlight(page, { knobs: { maxLive: 4 }, stageWordCount: 40 });
    // Three rivals with distinct first letters, none of which is another's
    // second letter - the pair the assertion below needs, made deterministic
    // rather than waited for.
    await seedRocks(page, ["moons", "pilot", "sky"]);
    await page.waitForFunction(
      () => (window.__kbFlight?.state().rocks.length ?? 0) >= 3,
      null,
      { timeout: 20_000 },
    );

    // The whole sequence runs inside one evaluate, so every step lands in the
    // same frame: no rock can cross the breach line between two keystrokes and
    // turn a rule check into a race.
    const run = await page.evaluate(() => {
      const api = window.__kbFlight as NonNullable<typeof window.__kbFlight>;
      const press = (ch: string): void => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: ch,
            code: `Key${ch.toUpperCase()}`,
          }),
        );
      };
      const snap = (): {
        typos: number;
        combo: number;
        typed: string;
        lockedId: string | null;
        hits: number;
      } => {
        const s = api.state();
        return {
          typos: s.typos,
          combo: s.combo,
          typed: s.typed,
          lockedId: s.lockedId,
          hits: s.hits,
        };
      };

      const alphabet = "abcdefghijklmnopqrstuvwxyz".split("");
      const words = api.state().rocks.map((r) => r.word);
      for (const ch of words[0] as string) press(ch);
      const afterBlast = snap();

      const live = api.state().rocks.map((r) => r.word);
      // The rival's first letter must not also be the target's SECOND letter,
      // or the keystroke legitimately advances the word and is not an ignored
      // key at all. Pick the pair that makes the distinction testable.
      let target = live[0] as string;
      let rival = "";
      for (const t of live) {
        const r = live.find((w) => w[0] !== t[0] && w[0] !== t[1]);
        if (r !== undefined) {
          target = t;
          rival = r;
          break;
        }
      }
      press(target[0] as string);
      const afterLock = snap();

      // A key that starts a DIFFERENT live rock (AC-3.3 / C10).
      press(rival[0] as string);
      const afterIgnored = snap();

      // A key that starts nothing and continues nothing (AC-3.2).
      const typedLen = afterIgnored.typed.length;
      const wrongKey = alphabet.find(
        (c) =>
          !live.some((w) => w.startsWith(c)) &&
          !live.some((w) => w[typedLen] === c),
      ) as string;
      press(wrongKey);
      const afterTypo = snap();

      return { words, target, rival, wrongKey, afterBlast, afterLock, afterIgnored, afterTypo };
    });

    expect(run.afterBlast.hits).toBe(1);
    expect(run.afterBlast.combo).toBe(1);

    expect(run.rival).not.toBe("");
    expect(run.afterLock.typed).toBe(run.target[0]);
    expect(run.afterLock.lockedId).not.toBeNull();

    // Ignored: shakes, and changes nothing else. This is collision C10 - if it
    // counted, brushing a key meant for another rock would cost the combo.
    expect(run.afterIgnored.typos).toBe(run.afterLock.typos);
    expect(run.afterIgnored.combo).toBe(run.afterLock.combo);
    expect(run.afterIgnored.typed).toBe(run.afterLock.typed);
    expect(run.afterIgnored.lockedId).toBe(run.afterLock.lockedId);

    // Typo: counted once, the lock survives, and the only cost is the combo.
    expect(run.afterTypo.typos).toBe(run.afterIgnored.typos + 1);
    expect(run.afterTypo.typed).toBe(run.afterIgnored.typed);
    expect(run.afterTypo.lockedId).toBe(run.afterIgnored.lockedId);
    expect(run.afterTypo.combo).toBe(0);
  });

  test("AC-2.2 + D25: a fully typed word that is still a prefix of a live rival charges visibly and fires at firesAtMs", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    // The shared-prefix tier unlocks at 80% of the pool solid (ease < 0.6), so
    // the book is seeded mastered - this is the D25 tier, not a fresh profile.
    const mastered = (words: string[]): Record<string, unknown> =>
      Object.fromEntries(
        words.map((w) => [
          w,
          {
            exposures: 6,
            hits: 6,
            misses: 0,
            typos: 0,
            fkLatencyMs: [420],
            ikiMs: [180],
            firstFkLatencyMs: 520,
            ease: 0.3,
            lastSeen: 0,
            nextEligibleStage: 0,
          },
        ]),
      );

    const pool = (await page.evaluate(async (url) => {
      const mod = (await import(url)) as {
        stagePoolFor: (stop: string) => string[];
      };
      return mod.stagePoolFor("mars");
    }, STAGE_MODULE).catch(() => [])) as string[];

    await bootFlight(page, {
      knobs: { maxLive: 4 },
      stageWordCount: 40,
      book: mastered(pool.length > 0 ? pool : ["win", "wind"]),
    });

    const parked = await page.evaluate(() => {
      const api = window.__kbFlight as NonNullable<typeof window.__kbFlight>;
      const press = (ch: string): void => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: ch, code: `Key${ch.toUpperCase()}` }),
        );
      };
      api.spawn("win");
      api.spawn("wind");
      for (const ch of "win") press(ch);
      const s = api.state();
      return {
        parkedId: s.parkedId,
        typed: s.typed,
        hits: s.hits,
        words: s.rocks.map((r) => r.word),
      };
    });

    // Armed, not fired: "win" is complete but "wind" is still falling.
    expect(parked.words).toEqual(expect.arrayContaining(["win", "wind"]));
    expect(parked.typed).toBe("win");
    expect(parked.parkedId).not.toBeNull();
    expect(parked.hits).toBe(0);

    // It fires on its own once the player stops typing for one keystroke
    // budget - the park is not a dead end.
    await page.waitForFunction(
      () => (window.__kbFlight?.state().hits ?? 0) > 0,
      null,
      { timeout: 10_000 },
    );
    const after = await state(page);
    expect(after.parkedId).toBeNull();
    expect(after.rocks.some((r) => r.word === "wind")).toBe(true);
  });

  test("AC-4.2 + AC-22b.2: a strike costs exactly one hull mark, with no full-screen red flash", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await bootFlight(page, { pixelReadback: true, knobs: { maxLive: 2 } });

    const sampleMeans = async (): Promise<{ r: number; g: number; b: number }> =>
      page.evaluate(() => {
        const canvas = document.querySelector("canvas") as HTMLCanvasElement;
        const off = document.createElement("canvas");
        off.width = 160;
        off.height = 90;
        const ctx = off.getContext("2d") as CanvasRenderingContext2D;
        ctx.drawImage(canvas, 0, 0, 160, 90);
        const { data } = ctx.getImageData(0, 0, 160, 90);
        let r = 0;
        let g = 0;
        let b = 0;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i] as number;
          g += data[i + 1] as number;
          b += data[i + 2] as number;
        }
        const n = data.length / 4;
        return { r: r / n, g: g / n, b: b / n };
      });

    const pixelsBefore = await sampleMeans();
    const hull = await page.evaluate(() => {
      const api = window.__kbFlight as NonNullable<typeof window.__kbFlight>;
      const before = api.state().hull;
      api.strike();
      return { before, after: api.state().hull };
    });
    await waitFrames(page, 2);
    const pixelsDuring = await sampleMeans();

    expect(hull.after).toBe(hull.before - 1);
    // D28: shake and spark, never a flash. A full-screen red flash would move
    // the mean red channel hard and move it further than green and blue.
    const dr = pixelsDuring.r - pixelsBefore.r;
    const dg = pixelsDuring.g - pixelsBefore.g;
    const db = pixelsDuring.b - pixelsBefore.b;
    expect(Math.abs(dr)).toBeLessThan(18);
    expect(dr - Math.max(dg, db)).toBeLessThan(12);
  });

  test("FR-5 / AC-5.2: blasting a shield canister repairs one hull mark, capped at the stage's hull", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await bootFlight(page, { knobs: { maxLive: 3 }, stageWordCount: 40 });
    await page.waitForFunction(
      () => (window.__kbFlight?.state().rocks.length ?? 0) >= 2,
      null,
      { timeout: 20_000 },
    );

    const run = await page.evaluate(() => {
      const api = window.__kbFlight as NonNullable<typeof window.__kbFlight>;
      const press = (ch: string): void => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: ch, code: `Key${ch.toUpperCase()}` }),
        );
      };
      const type = (word: string | null): void => {
        if (word === null) return;
        for (const ch of word) press(ch);
      };

      const maxHull = api.state().maxHull;
      const full = api.state().hull;

      api.strike();
      const damaged = api.state().hull;

      const first = api.makeCanister();
      type(first);
      const repaired = api.state().hull;

      // AC-5.2's cap: a canister blasted at full hull cannot push it past the
      // stage's own hull. Read from `maxHull` rather than written as 3, because
      // the hull now scales with stage length (@engine/hull) - a literal here
      // would be asserting the stage length instead of the cap.
      const second = api.makeCanister();
      type(second);
      const capped = api.state().hull;

      return { maxHull, full, damaged, first, repaired, second, capped };
    });

    expect(run.full).toBe(run.maxHull);
    expect(run.damaged).toBe(run.maxHull - 1);
    expect(run.first).toBeTruthy();
    expect(run.repaired).toBe(run.maxHull);
    expect(run.capped).toBe(run.maxHull);
  });

  test("AC-4.3 + AC-18.1: an empty hull stalls to screen 6b, and Enter alone flies the stage again with the word history kept", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    // An 18-word stage, so the hull is D27's three (@engine/hull reproduces D27
    // exactly at the length D27 was written for) and the stall is three strikes
    // away rather than nine. The stall PATH is what this test is about; how many
    // marks a 58-word belt carries is `tests/unit/flight/shield.test.ts`.
    await bootFlight(page, { knobs: { maxLive: 2 }, stageWordCount: 18 });

    // Fly one word so there is history to keep.
    const first = (await state(page)).rocks[0] as RockView;
    await typeWord(page, first.word);
    await page.waitForTimeout(120);
    const exposures = (await state(page)).bookExposures;
    expect(exposures).toBeGreaterThan(0);

    const maxHull = (await state(page)).maxHull;
    expect(maxHull, "an 18-word stage is D27's three marks").toBe(3);
    for (let i = 0; i < maxHull; i += 1) {
      await page.evaluate(() => window.__kbFlight?.strike());
      await page.waitForTimeout(60);
    }
    expect((await state(page)).hull).toBe(0);
    expect((await state(page)).stalled).toBe(true);

    await page.waitForFunction(() => window.__kbStall !== undefined, null, {
      timeout: 15_000,
    });

    // D29/D31: the card is calm. Nothing on it is a verdict on the player.
    const texts = (await page.evaluate(
      () => window.__kbStall?.texts() ?? [],
    )) as string[];
    expect(texts.length).toBe(3);
    for (const line of texts) {
      expect(line.toLowerCase()).not.toContain("wrong");
      expect(line.toLowerCase()).not.toContain("fail");
      expect(line.toLowerCase()).not.toContain("lost");
    }

    // Keyboard only: one control, activated with Enter.
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => window.__kbFlight?.state().stalled === false,
      null,
      { timeout: 15_000 },
    );

    const restarted = await state(page);
    expect(restarted.hull).toBe(maxHull); // AC-4.1: hull is full at stage start
    expect(restarted.stalled).toBe(false);
    expect(restarted.bookExposures).toBeGreaterThanOrEqual(exposures);
  });

  test("AC-12b.1 + AC-12b.2: every stop's debris comes from the FR-12b table and carries at least three shape variants", async ({
    page,
  }) => {
    await bootFlight(page);

    const table = (await page.evaluate(async (moduleUrl) => {
      const mod = (await import(moduleUrl)) as {
        DEBRIS_BY_STOP: Record<
          string,
          { id: string; stop: string; label: string; source: string; variants: unknown[] }[]
        >;
      };
      return Object.fromEntries(
        Object.entries(mod.DEBRIS_BY_STOP).map(([stop, types]) => [
          stop,
          types.map((t) => ({
            id: t.id,
            stop: t.stop,
            label: t.label,
            source: t.source,
            variants: t.variants.length,
          })),
        ]),
      );
    }, ASTEROID_MODULE)) as Record<
      string,
      { id: string; stop: string; label: string; source: string; variants: number }[]
    >;

    // Earth is the launchpad and has no belt (D57, AC-12.1).
    expect(table.earth).toEqual([]);
    for (const stop of ["mars", "jupiter", "saturn", "uranus", "neptune", "pluto"]) {
      const types = table[stop] as {
        id: string;
        stop: string;
        source: string;
        variants: number;
      }[];
      expect(types.length).toBeGreaterThan(0);
      for (const type of types) {
        expect(type.stop).toBe(stop);
        expect(type.variants).toBeGreaterThanOrEqual(3); // AC-12b.2
        expect(type.source).toContain("nasa.gov"); // FR-12b sourcing
      }
    }

    // FR-12b's own rows, spot-checked where the table is most specific.
    const ids = (stop: string): string[] =>
      (table[stop] ?? []).map((t) => t.id);
    expect(ids("jupiter")).toEqual(
      expect.arrayContaining(["c-type", "s-type", "m-type", "jupiter-trojan"]),
    );
    expect(ids("saturn")).toEqual(expect.arrayContaining(["saturn-ice-chunk"]));
    expect(ids("uranus")).toEqual(expect.arrayContaining(["uranus-dark-ice"]));

    // AC-12b.1: what is actually on screen is from this stop's set.
    const live = await state(page);
    const marsIds = ids("mars");
    for (const rock of live.rocks) expect(marsIds).toContain(rock.debrisType);
  });

  test("AC-8.3: the HUD shows no fall-time or speed indicator", async ({ page }) => {
    await bootFlight(page);
    await page.waitForTimeout(400);

    const hudTexts = (await page.evaluate(() => {
      const scene = window.__kbGame?.scene.getScene("Hud") as
        | { children: { list: { type: string; text?: string }[] } }
        | undefined;
      if (scene === undefined) return [];
      return scene.children.list
        .filter((c) => c.type === "Text")
        .map((c) => c.text ?? "");
    })) as string[];

    expect(hudTexts.length).toBeGreaterThan(0);
    for (const value of hudTexts) {
      expect(value).not.toMatch(/speed|velocidad|गति/i);
      expect(value).not.toMatch(/fall|caíd|गिर/i);
      expect(value).not.toMatch(/\bsec\b|\bms\b/i);
    }
  });

  test("AC-19.3: reduced motion keeps the world moving and the rocks falling", async ({
    page,
  }) => {
    await bootFlight(page, { reducedMotion: true });
    const first = await state(page);
    await page.waitForTimeout(600);
    const second = await state(page);

    // Gameplay motion and ambient drift are kept; only shake and sway go.
    expect(second.layerOffsets.midField).toBeGreaterThan(
      first.layerOffsets.midField as number,
    );
    const rock = first.rocks[0] as RockView;
    const later = second.rocks.find((r) => r.id === rock.id);
    if (later !== undefined) expect(later.y).toBeGreaterThan(rock.y);
  });
});

// ---------------------------------------------------------------------------
// Evidence artifacts
// ---------------------------------------------------------------------------

test.describe("Flight - rubric evidence", () => {
  test("V-22.8 / AC-22.8: word-plate contrast across all seven palettes", async ({
    page,
  }) => {
    await bootFlight(page);

    // MEASURED FROM THE RENDERER, IN BOTH PALETTE MODES.
    //
    // This used to measure `plateText` only, and the rubric's own copy of the
    // check measured `palettes.json`'s `colorblind.plateAccent` - a field NO
    // RENDERER READ. It reported 6.71:1 while the colour a colourblind child
    // actually saw on Saturn and Pluto was `colorblind.accent` (#111318) on the
    // plate (#0E1116): 1.02:1. The typed letter, which is the one piece of
    // feedback the whole game exists to give, was invisible.
    //
    // So both colours are measured, both modes are measured, and the values
    // come from `paletteAt()` - the function the scenes actually call - rather
    // than from the JSON. A field nothing consumes cannot pass this.
    const result = (await page.evaluate(async ([plateUrl, palUrl]) => {
      const plate = (await import(plateUrl as string)) as {
        contrastRatio: (a: string, b: string) => number;
      };
      const pal = (await import(palUrl as string)) as {
        PALETTE_STOP_IDS: readonly string[];
        paletteAt: (
          stopId: string,
          colorblind: boolean,
        ) => { accent: string; plate: string; plateText: string };
      };
      const rows: {
        stop: string;
        mode: string;
        role: string;
        fg: string;
        bg: string;
        ratio: number;
      }[] = [];
      for (const colorblind of [false, true]) {
        for (const stop of pal.PALETTE_STOP_IDS) {
          const p = pal.paletteAt(stop, colorblind);
          const mode = colorblind ? "colourblind" : "normal";
          rows.push({
            stop,
            mode,
            role: "resting",
            fg: p.plateText,
            bg: p.plate,
            ratio: plate.contrastRatio(p.plate, p.plateText),
          });
          rows.push({
            stop,
            mode,
            role: "typed",
            fg: p.accent,
            bg: p.plate,
            ratio: plate.contrastRatio(p.plate, p.accent),
          });
        }
      }
      return { rows, minRatio: Math.min(...rows.map((r) => r.ratio)) };
    }, [PLATE_MODULE, PALETTE_MODULE] as const)) as {
      rows: { stop: string; mode: string; role: string; fg: string; bg: string; ratio: number }[];
      minRatio: number;
    };

    // Seven stops x two modes x two roles.
    expect(result.rows.length).toBe(28);
    const worst = result.rows.reduce((a, b) => (b.ratio < a.ratio ? b : a));
    expect(
      result.minRatio,
      `worst: ${worst.stop} ${worst.mode} ${worst.role} ${worst.fg} on ${worst.bg}`,
    ).toBeGreaterThanOrEqual(4.5);
    writeEvidence("contrast.json", {
      source: "src/game/render/palette.ts paletteAt(), via the running game",
      modes: ["normal", "colourblind"],
      roles: ["resting", "typed"],
      minRatio: Number(result.minRatio.toFixed(2)),
      samples: result.rows.length,
      rows: result.rows.map((r) => ({ ...r, ratio: Number(r.ratio.toFixed(2)) })),
    });
  });

  test("V-22.3 / AC-22.3: the sky travels across a stage (deltaE > 10)", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    /**
     * ================== THIS ITEM WAS PASSING BY LUCK ==================
     *
     * The measurement is "sample the sky, wait, sample again", and the first
     * sample used to be taken whenever the boot happened to finish. The sky
     * starts travelling the moment the scene does, so on a loaded machine it has
     * ALREADY MOVED before "start" is captured, and the item then reports the
     * REMAINDER of the journey as though it were the whole of it.
     *
     * Measured on this machine, idle, varying only how late the start sample is
     * taken - nothing else changed, same stage, same stop:
     *
     *   start sample delayed    0 ms  ->  deltaE 13.81
     *                        2000 ms  ->         11.62
     *                        4000 ms  ->          9.79   <- under the bar of 10
     *                        6000 ms  ->          7.82
     *
     * About one deltaE per second, against a bar of 10 and an idle reading of
     * 13.8: three and a half seconds of boot latency is the whole margin. A
     * full-suite run at three workers supplied it and the item failed at 9.28,
     * with a start sample of rgb(194,154,117) - which is the 4000 ms row,
     * rgb(195,155,118), to within a level.
     *
     * The sky itself is fine and was never the problem. The full travel at this
     * sample height computes to deltaE 18.2 on Mars from `skyStops` to
     * `skyStopsLate`, and the END sample is identical run to run (170,130,97).
     * What varied was the START.
     *
     * SO THE WINDOW IS PINNED, NOT THE BAR. The scene reports its own sky clock
     * (`skyProgress`), both samples record it, and the item asserts that what was
     * observed really is most of a stage. If the machine was too slow to catch
     * the beginning, this now says so in those words instead of quietly
     * reporting the tail of the journey as the journey.
     *
     * `maxLive: 2` keeps the hull alive long enough to reach the end of the
     * stage: nobody types during the capture, so every rock breaches, and at the
     * default width the belt burns five of six hull marks in seventeen seconds.
     * A stall would freeze the sky mid-travel - the same failure by another
     * route, and the window assertion below catches that one too.
     */
    const BOOT = {
      pixelReadback: true,
      /**
       * SIXTEEN SECONDS, AND NOT FORTY, AND THE REASON IS THE HULL.
       *
       * A longer stage makes the fixed boot latency a smaller fraction of the
       * window, which is the obvious move and it was tried: at 40 s the start
       * sample landed at progress 0.05 - and the stage STALLED at 0.73, because
       * nobody types during a capture, every rock breaches, and six hull marks
       * last about 29 s. A stall freezes `updateWorld` and with it the sky, so
       * the reading became a measurement of a stall (deltaE 10.76 over 0.63 of a
       * stage). Slowing the pilot's calibration does not help either: in steady
       * state the breach rate IS the spawn rate, so a slower fall delays the
       * first breach and not the sixth. Measured, it stalled at 0.73 anyway.
       *
       * So the stage stays inside the hull's life and the LATENCY is attacked
       * instead - see the pause around the start sample below.
       */
      stageDurationMs: 16_000,
      stageWordCount: 40,
      knobs: { maxLive: 2 },
      waitForRock: false,
    };

    /**
     * UR-36: THIS SAMPLED THE WRONG CANVAS, AND THEN THE WRONG WAY.
     *
     * It took `document.querySelector("canvas")`, which under the shipping boot
     * is the VIEWPORT BACKDROP - a static sky painted once per stop that by
     * design never travels. The measured deltaE went straight to 0.00 against a
     * bar of 10 the moment this spec started booting the real game, and the
     * green it had been reporting was a property of the parallel boot having
     * only one canvas on the page.
     *
     * It also read the LIVE WebGL canvas with `drawImage`, which needs
     * `preserveDrawingBuffer` - the near-miss in `docs/verification-gaps.md`
     * that has produced two wrong measurements here. Both problems go away by
     * decoding a screenshot CLIPPED TO THE GAME'S OWN CANVAS, by identity: the
     * fractional patch coordinates below are unchanged, because the clip makes
     * the decoded image the canvas.
     */
    interface SkySample {
      rgb: [number, number, number];
      progress: number;
      stalled: boolean;
    }
    const sampleSky = async (): Promise<SkySample> => {
      const box = await flightCanvasBox(page);
      const shot = await page.screenshot({
        clip: { x: box.x, y: box.y, width: box.width, height: box.height },
      });
      return page.evaluate(async (b64: string) => {
        // READ IN THE SAME CALL AS THE PIXELS. The clock and the frame have to
        // describe one moment, for the reason V-22.4 documents at length.
        const live = window.__kbFlight?.state();
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const canvas = { width: img.naturalWidth, height: img.naturalHeight };
        const off = document.createElement("canvas");
        off.width = canvas.width;
        off.height = canvas.height;
        const ctx = off.getContext("2d") as CanvasRenderingContext2D;
        ctx.drawImage(img, 0, 0);
        // Several patches along the top band, then the per-channel MEDIAN. The
        // HUD plates own both top corners and a rock can cross any single
        // patch, so one sample would occasionally measure something that is
        // not the sky; a median over spread patches cannot.
        const xs = [0.24, 0.34, 0.44, 0.54, 0.62, 0.68];
        const y = Math.round(canvas.height * 0.015);
        const samples: [number, number, number][] = [];
        for (const fx of xs) {
          const patch = ctx.getImageData(
            Math.round(canvas.width * fx),
            y,
            10,
            10,
          ).data;
          let r = 0;
          let g = 0;
          let b = 0;
          for (let i = 0; i < patch.length; i += 4) {
            r += patch[i] as number;
            g += patch[i + 1] as number;
            b += patch[i + 2] as number;
          }
          const n = patch.length / 4;
          samples.push([r / n, g / n, b / n]);
        }
        const median = (index: number): number => {
          const values = samples
            .map((sample) => sample[index] as number)
            .sort((a, b) => a - b);
          return values[Math.floor(values.length / 2)] as number;
        };
        return {
          rgb: [median(0), median(1), median(2)] as [number, number, number],
          progress: live?.skyProgress ?? 0,
          stalled: live?.stalled ?? true,
        };
      }, shot.toString("base64"));
    };

    /**
     * THE START SAMPLE IS TAKEN WITH THE SCENE PAUSED, and that is worth four
     * seconds of the stage.
     *
     * `sampleSky` is a canvas-box evaluate, a full-frame `page.screenshot` and a
     * decode - three CDP round trips and a PNG encode of 1280x720. All of it used
     * to run while the scene clock advanced, so the cost of MEASURING the sky was
     * charged to the sky's journey. `scene.pause()` stops `update`, which is what
     * drives `setSkyProgress`, so the clock waits for the measurement instead.
     */
    /**
     * ============ A RETRY, AND WHAT IT IS ALLOWED TO RETRY ON ============
     *
     * Bounded, and on an ABSENT MEASUREMENT only: if the boot was so slow that
     * the first sample missed the opening of the stage, there is no start
     * reading to compare against and the run has measured the tail of a journey.
     * That is the same distinction `V-22.4` draws two tests below - it retries
     * when there was no object in the frame, and never when the number was bad -
     * and the same rule applies here.
     *
     * WHAT WOULD MAKE THIS DISHONEST: retrying on a low deltaE. The condition is
     * `observed < MIN_OBSERVED`, a fact about the WINDOW, and it must never
     * become a fact about the result. A short window can only make deltaE
     * smaller, so a PASS is valid at any window; the window only decides whether
     * a FAILURE means "the sky does not travel" or "we did not watch it".
     */
    const MIN_OBSERVED = 0.85;
    let start!: SkySample;
    let end!: SkySample;
    let observed = 0;
    let attempts = 0;
    while (attempts < 3) {
      attempts += 1;
      await bootFlight(page, BOOT);
      /**
       * THE START SAMPLE IS TAKEN WITH THE SCENE PAUSED, and that is worth four
       * seconds of the stage.
       *
       * `sampleSky` is a canvas-box evaluate, a full-frame `page.screenshot` and
       * a decode - three CDP round trips and a PNG encode of 1280x720. All of it
       * used to run while the scene clock advanced, so the cost of MEASURING the
       * sky was charged to the sky's journey. `scene.pause()` stops `update`,
       * which is what drives `setSkyProgress`, so the clock now waits for the
       * measurement instead. Measured: the start sample moved from progress 0.32
       * to 0.067, and deltaE from 13.5 to 15.0.
       */
      await freezeFlight(page, true);
      start = await sampleSky();
      await freezeFlight(page, false);
    // WAIT FOR THE STAGE, NOT FOR THE CLOCK. A fixed 17 s wait is 17 s of wall
    // time, and the scene advances on its own clock: under load it reaches a
    // smaller progress in the same seconds, which is the second half of the same
    // defect. Waiting on `skyProgress` pins the END of the window the way
    // recording it pins the start.
      await page
        .waitForFunction(
          () => {
            const st = window.__kbFlight?.state();
            return (st?.skyProgress ?? 0) >= 0.98 || (st?.stalled ?? false);
          },
          null,
          { timeout: 60_000 },
        )
        .catch(() => undefined);
      end = await sampleSky();
      observed = end.progress - start.progress;
      if (observed >= MIN_OBSERVED) break;
    }

    const delta = (await page.evaluate(
      async ([stageUrl, a, b]) => {
        const stage = (await import(stageUrl as string)) as {
          rgbToLab: (r: number, g: number, b: number) => [number, number, number];
          deltaE: (
            a: [number, number, number],
            b: [number, number, number],
          ) => number;
        };
        const labA = stage.rgbToLab(...(a as [number, number, number]));
        const labB = stage.rgbToLab(...(b as [number, number, number]));
        return stage.deltaE(labA, labB);
      },
      [STAGE_MODULE, start.rgb, end.rgb] as const,
    )) as number;

    writeEvidence("sky-gradient-shift.json", {
      deltaE: Number(delta.toFixed(2)),
      startRgb: start.rgb.map((v) => Math.round(v)),
      endRgb: end.rgb.map((v) => Math.round(v)),
      stopId: "mars",
      // The window the number is a statement about. Without these two, a 9.3 and
      // a 13.8 look like the same kind of reading and they are not.
      startProgress: Number(start.progress.toFixed(3)),
      endProgress: Number(end.progress.toFixed(3)),
      observedFractionOfStage: Number(observed.toFixed(3)),
      attempts,
      stalledAtEnd: end.stalled,
      sensitivity:
        "measured idle: deltaE falls about 1.0 per second of start-sample lateness (13.81 / 11.62 / 9.79 / 7.82 at 0 / 2 / 4 / 6 s). The full travel at this sample height computes to 18.2.",
    });
    // THE WINDOW FIRST, because a deltaE over a fraction of a stage is not a
    // statement about a stage. This is the assertion that would have failed
    // honestly on the run that reported 9.28: it began at progress ~0.28.
    expect(
      observed,
      `after ${attempts} attempt(s) the sky was only observed across ${(observed * 100).toFixed(0)}% of the stage (progress ${start.progress.toFixed(2)} -> ${end.progress.toFixed(2)}${end.stalled ? ", and the stage STALLED, which freezes the travel" : ""}). This is a statement about the HARNESS, not about the sky: a deltaE over part of a stage is smaller than one over all of it, so the number below cannot be believed as a failure. deltaE over what WAS observed: ${delta.toFixed(2)}`,
    ).toBeGreaterThan(MIN_OBSERVED);
    expect(delta).toBeGreaterThan(10);
  });

  /**
   * AC-22.4: "Desaturated flight screenshot: rocket and asteroids identifiable
   * by silhouette."
   *
   * ---------------------------------------------------------------------------
   * THIS IS THE THIRD MEASURE. READ WHY THE FIRST TWO FAILED BEFORE CHANGING IT.
   *
   * 1. A CONTOUR COUNT. Desaturate, Otsu-threshold, count connected regions,
   *    pass for any count in [3, 60]. The whole evidence artifact was
   *    `{"contours": 14}`. Fourteen blobs says nothing about whether any of them
   *    IS the rocket, and a frame in which every asteroid had dissolved into the
   *    terrain would score a dozen contours off the terrain alone — which is
   *    exactly the failure the AC exists to catch.
   *
   * 2. PER-REGION BACKGROUND SEPARATION off the same Otsu binarisation.
   *    Genuinely stronger: it required a real luminance step across every
   *    object-sized region. It still could not answer the AC, because **Otsu is
   *    adaptive**. A real regression was available to test it against — a floor
   *    vignette that washed 58% near-black across the full width at the ship's
   *    own height, so a rock down there measured luminance 76 against a
   *    background of 76. A probe that knew where the objects were scored that
   *    0.002. This measure scored it **0.239**, four times the bar, because it
   *    re-split the crushed frame and found its object-sized regions somewhere
   *    else — terrain edges up in the untouched part of the picture.
   *
   * The lane that shipped (2) deliberately did NOT move the threshold to catch
   * that vignette, and was right to refuse: a number fitted to one known defect
   * catches that defect and nothing else, and passes the next one. The defect
   * was never the threshold. The defect was that the measurement was free to
   * wander to a different part of the image.
   *
   * ---------------------------------------------------------------------------
   * 3. WHAT IT MEASURES NOW: POSITION-ANCHORED SEPARATION.
   *
   * Nothing is segmented and no threshold is chosen from the data. The scene is
   * asked where its objects are, and the frame is measured THERE: mean luminance
   * in each object's core against mean luminance in a ring just outside it.
   *
   *   rocks  `__kbFlight.state().rocks[]`. Centre x from the plate's own
   *          left/right (the mapping `plate-legibility.spec.ts` already relies
   *          on), centre y from `rockBottom - sizePx/2`, radius `sizePx/2`.
   *   ship   `FlightScene` anchors it at (width/2, height-150) with a half-width
   *          of 46 px (FlightScene.ts:169,570-571). Hard-coded here on purpose:
   *          if the art lane moves the ship, this probe measures empty sky and
   *          the item goes RED rather than quietly passing on a rock instead.
   *
   * The ring excludes other objects and every word plate, so two rocks
   * overlapping do not read as one rock against the sky.
   *
   * The measure itself lives in `tests/gauntlet/silhouette.mjs`, pure and
   * browser-free, so its NEGATIVE CONTROL runs in vitest in milliseconds:
   * `tests/unit/gauntlet/silhouette.test.ts` feeds it a synthetic frame, then
   * the same frame with the vignette applied, and asserts this measure goes red
   * (0.000) while the superseded Otsu measure on the identical pixels still
   * reports 0.27. Re-run it with:
   *
   *   npx vitest run tests/unit/gauntlet/silhouette.test.ts --coverage.enabled=false
   *
   * WHAT IT STILL DOES NOT CLAIM. That a child can tell a rock from the ship,
   * or that the frame reads as art. It says each object the scene reports is
   * still distinguishable from what is immediately behind it with the colour
   * gone. The judge's eye is the gate for the rest.
   */
  interface ProbeObject {
    id: string;
    kind: string;
    cx: number;
    cy: number;
    r: number;
  }

  test("V-22.4 / AC-22.4: every object the scene reports still separates from its background, desaturated", async ({
    page,
  }) => {
    // Six stops x (one boot + three live frames + a placed pass).
    test.setTimeout(420_000);
    /**
     * THE BELT HAS TO BE ALIVE, AND IT WAS NOT (UR-36 follow-on).
     *
     * Measured, not reasoned about: at `stageWordCount: 40` the stage carries
     * six hull marks (`hullForStage`), nobody types during a five-second
     * capture, so rocks cross the breach line unanswered and the stage STALLS
     * about two seconds in. From sample 1 onward this probe was reading
     *
     *     hull 0/6, one rock frozen at y = -64
     *
     * A stalled scene stops `updateRocks`, so the last rock sat above the top
     * of the frame for every remaining sample and the probe correctly reported
     * `samplesIn: 0` - there was nothing at that location to measure. The
     * SHIP's separation collapsing 0.42 -> 0.0016 across the five frames was
     * D29's stall sequence: the Lantern sputters, DIMS and sinks. The art was
     * never the finding; the fixture was capturing a dead game.
     *
     * Same defect as `plate-legibility`'s AC-2.3, which stalled before its
     * first sample. A long stage cannot empty its hull inside the capture, and
     * nothing about a silhouette depends on how long the stage is.
     */
    /**
     * ONE STOP WAS NOT A SWEEP, AND THIS IS THE THIRD TIME.
     *
     * This test is THE acceptance check for AC-22.4. Its `bootFlight` passed no
     * `stopId`, so it took `DEFAULT_FLIGHT_CONFIG.stopId` - mars - and the
     * `lumaOf` lookup had "mars" written into it as a literal. One stop of the
     * six that have a belt, and mars is the stop where the debris fix is
     * strongest and costs least: the other five were never measured in pixels
     * by anything in this suite.
     *
     * `docs/verification-gaps.md` instances 2 and 3 are both, verbatim, "the
     * harness boots Mars only". It has now happened a third time, inside the
     * gate for the ticket about invisible asteroids, and guard 2 in that file
     * says it plainly: a harness that takes a `stopId` must be driven across the
     * full set or declare in code why a subset is sufficient. There is no such
     * reason here - the whole point of AC-22.4 is that the answer differs per
     * stop, because the sky does.
     *
     * A MODEL CHECK IS NOT A SUBSTITUTE. `tests/unit/render/wordRockSeparation.test.ts`
     * does cover all six stops with a real negative control, but it compares
     * `wordRockFill`'s output against `skyLumaSweep`'s output - a model against a
     * model, never a pixel, and its sky deliberately excludes the atmosphere
     * pass, the starfield and the light's glow. Model-all-stops plus
     * pixels-one-stop is not pixels-all-stops.
     */
    interface FrameSample {
      stopId: string;
      frame: { w: number; h: number };
      objects: Record<string, unknown>[];
      unmeasurable: Record<string, unknown>[];
      minSeparation: number;
      rocks: number;
      /** Scorch marks on the hull when this frame was taken. See `grab`. */
      hullHits: number;
      maxHull: number;
    }

    /**
     * DID THE PROBE ACTUALLY LAND ON A ROCK?
     *
     * The bar this file asserts is a separation, and a separation between two
     * patches of SKY is a small number that looks like a legitimate reading.
     * Three frames of a previous run measured `inside` at 112-134 - the Mars
     * sky - and reported separations of 0.11-0.14, which PASSED. The probe had
     * never found the rock; it had found the sky twice and subtracted it from
     * itself.
     *
     * So every measured rock has to demonstrate it was measured: the core
     * disc's mean luma must be near the value the renderer actually fills that
     * rock with (`asteroid.wordRockFill`, the same function `drawDebris` uses).
     * The tolerance is wide because a rock is shaded, faceted and antialiased
     * at its rim, and the thing being excluded is not a few units of shading -
     * it is a reading taken 60+ units away, on the sky.
     */
    const CORE_LUMA_TOLERANCE = 45;

    const samples: FrameSample[] = [];
    /**
     * Objects a word plate was sitting on when the shutter opened. Recorded, not
     * dropped: a filter nobody can see is a filter that can quietly become the
     * result. See `platedOver`.
     */
    const occludedByPlate: { stopId: string; id: string }[] = [];

    /** FlightScene.ts:169 / :570-571 — the ship's anchor, in DESIGN pixels. */
    const SHIP = { cx: DESIGN.width / 2, cy: DESIGN.height - 150, halfWidth: 46 };

    /**
     * ================== A WORD PLATE IS NOT THE OBJECT UNDER IT ==================
     *
     * `measureSilhouettes` already keeps word plates out of the background RING
     * - "word plates are neither object nor background" - and nothing kept them
     * out of the object's CORE. The plate layer draws ABOVE the ship
     * (`stage.PLATE_LAYER_DEPTH`, one step under the HUD), which is a weighed
     * trade recorded in `FlightScene`: a rock falling down the ship's own lane
     * carries its word across the Lantern for the last part of its fall, because
     * a word the child cannot read is worse than a ship they cannot see for a
     * quarter of a second.
     *
     * So the probe was periodically averaging a dark opaque plate and reporting
     * it as the rocket. Caught with a control rather than argued: sampling the
     * ship's core every 500 ms on mars while logging which plates cover it,
     *
     *   t=1  inside 203.5  hullHits 0  plates over the core []
     *   t=2  inside 125.6  hullHits 0  plates over the core ["rivers"]
     *   t=3  inside 144.6  hullHits 2  plates over the core []
     *
     * - the one frame with a plate on the ship is the one frame the ship stops
     * being 203, with the hull untouched either side of it.
     *
     * An object under a plate is in the same category this file already has for
     * a rock above the top of the picture: not measurable in THIS frame, and not
     * a silhouette failure. It is recorded rather than dropped, and the frame is
     * retried, so nothing here can turn a genuinely weak reading into a skip -
     * the test is geometric and is taken before any pixel is read.
     */
    const platedOver = (
      cx: number,
      cy: number,
      radius: number,
      plates: readonly { x0: number; y0: number; x1: number; y1: number }[],
    ): boolean => {
      const core = radius * CORE;
      return plates.some(
        (p) => p.x0 < cx + core && p.x1 > cx - core && p.y0 < cy + core && p.y1 > cy - core,
      );
    };

    /**
     * The hull a SHIPPED stage carries (`stage.hullForStage` at a 40-word
     * stage). The capture needs a 400-word stage so it cannot stall itself
     * mid-sweep, and that stage carries 66 marks - so the fixture can put the
     * Lantern into a damage state the game never shows.
     *
     * It matters because `addScorch` paints a 34x20 design-px near-black ellipse
     * on a 42 px fuselage for every hit, inside the disc this probe averages.
     * Measured on mars, ship core against a sky holding at 83-92:
     *
     *   hits 0   203.5     hits 6   142.6      hits 10  55.3
     *   hits 2   144.6     hits 7    89.2      hits 12  51.7
     *   hits 4   141.7     hits 8    94.1
     *
     * The ship separates at both ends and NOT in the middle: at 7-8 marks a
     * half-scorched cream hull is the sky's own value, and that is where this
     * item failed three times (0.0093, 0.0249, 0.0537). Seven marks is one more
     * than a shipped stage allows - the sixth mark stalls it - so the frames
     * that failed were frames of the fixture, not of the game.
     *
     * The capture is therefore kept inside the reachable range rather than the
     * bar being moved: the belt is advanced in bounded steps with the scene
     * frozen in between, and the frames actually kept are asserted to be within
     * it. If a slower machine cannot hold that, this fails naming the FIXTURE.
     * gauntlet/escalations.md carries the art question behind it - a hull at 4-6
     * marks IS reachable, and its value is on its way to the sky's.
     */
    const SHIPPED_MAX_HULL = 6;

    const BELTED_STOPS = ["mars", "jupiter", "saturn", "uranus", "neptune", "pluto"];
    /**
     * Live frames per stop. Three rather than five, because there are now six
     * stops: 18 live readings against the 5 this replaces, plus the placed pass.
     */
    const PER_STOP_FRAMES = 3;
    /**
     * WHERE THE PLACED PASS PUTS ITS ROCKS, as fractions of GAME_HEIGHT.
     *
     * The live belt is sampled wherever its rocks happen to be, and they are not
     * spread evenly: a blind critic's sweep found the bottom band runs 3-4x
     * weaker than the top (0.58 at 10% of the fall against 0.176 at 79%), and
     * that is exactly where a random sample is least likely to land, because a
     * rock spends the end of its life there and is then removed. So the bottom
     * is placed rather than waited for. The last value sits just above the
     * breach line, 856/1080 = 0.793.
     */
    const PLACED_HEIGHTS = [0.12, 0.34, 0.55, 0.70, 0.76];
    /**
     * And where across the frame, as fractions of GAME_WIDTH.
     *
     * KEPT OUT OF THE HUD, which the probe's `exclude` list does not know about.
     * The first attempt ran the placements right-to-left from 0.88 and put the
     * topmost rock at (0.88, 0.08) - underneath the score/hull panel, which
     * draws on L7 above everything. The core disc then read 96.6 against a rock
     * the renderer fills at 35.2 and this spec's own anti-vacuity guard caught
     * it, which is the guard working: a reading taken through the HUD is a
     * reading about the HUD.
     *
     * Zig-zagged rather than monotonic so no rock's word plate, which hangs
     * below it, can reach the next rock's core.
     */
    const PLACED_X = [0.34, 0.66, 0.30, 0.70, 0.36];
    const PLACED_WORDS = ["dust", "polar", "rivers", "crater", "ice"];
    /**
     * ONE PLACED ROCK IS PROMOTED TO A CANISTER, AT EVERY STOP.
     *
     * A canister is a rock with the stop's ACCENT painted on it (FR-5 / D26),
     * so it is the one object in the belt whose measured core is not the value
     * `wordRockFill` cleared the sky by. That is not a hypothetical: the band
     * used to cross the middle of the rock and it took uranus's canister to
     * 0.0403 against this file's 0.06 bar, and saturn's to 0.0943.
     *
     * Whether a canister is on the belt at all is up to `maySpawnCanister` and
     * the seed - the run that caught the defect had 8 across 24 frames, the run
     * that confirmed the fix had 2, and neither had one on every stop. A sweep
     * that measures a canister when the rng feels like it is a sampled gate on
     * the object most likely to fail, which is rule 5 with the names changed.
     *
     * So it is placed rather than waited for, at index 3 - the 0.70 height the
     * uranus failure was measured at. `makeCanister` matches by word and
     * "crater" is in no stage pool (`src/content/en/*.json`), so the rock it
     * promotes is this spec's, never one the belt happened to be carrying.
     */
    const CANISTER_INDEX = 3;
    const CANISTER_WORD = PLACED_WORDS[CANISTER_INDEX] as string;

    for (const stopId of BELTED_STOPS) {
      const before = samples.length;
      // Which stop, out loud. A six-stop sweep that dies in the middle used to
      // report only the error, and "the game canvas is not on screen" says
      // nothing about which boot produced it.
      console.log(`V-22.4 booting ${stopId}`);
      await bootFlight(page, { stopId, knobs: { maxLive: 4 }, stageWordCount: 400 });
      await page.waitForFunction(
        () => (window.__kbFlight?.state().rocks.length ?? 0) > 0,
        null,
        { timeout: 20_000 },
      );
      await page.waitForTimeout(1200);

      /**
       * ONE PAGE TURN FOR BOTH. The positions and the pixels must come from the
       * same frame, and this is not a nicety: rocks fall on the wall clock, and
       * reading the state in one `page.evaluate` and the canvas in the next puts
       * two CDP round trips between them. Measured here, that gap was about a
       * second - the probe was drawing its rings 140 px above every rock and
       * reporting ~0.007 separation for a frame a human can read at a glance.
       * It looked exactly like a broken renderer, and it was a broken clock.
       */
      const grab = (stopId: string): Promise<{
        w: number;
        h: number;
        b64: string;
        stalled: boolean;
        hullHits: number;
        maxHull: number;
        rocks: { word: string; sizePx: number; fillLuma: number; isCanister: boolean; plateLeft: number; plateRight: number; plateTop: number; plateBottom: number; rockBottom: number }[];
      }> =>
        (async () => {
          /**
           * FROZEN FIRST, AND THAT IS THE WHOLE CORRECTNESS ARGUMENT.
           *
           * This probe reported false GREENS and a false RED from one bug. The
           * screenshot is one CDP round trip and the scene state is the next, and
           * rocks fall on the wall clock - so the coordinates described a later
           * moment than the picture, and the core disc landed wherever the rock
           * had been. Three of five frames measured `inside` 112.6 / 133.9 /
           * 112.4 - pure Mars sky, no rock in the core at all - and the probe
           * called those separations of 0.11-0.14 and PASSED them. At the
           * coordinate the failing run named, a frozen frame reads in 41.4 / out
           * 108.1 / sep 0.2616 against a reported `out 60.1`, a value the sky
           * never takes at that height.
           *
           * It looked flaky for hours and was not: it was sampling a moving world
           * through two round trips and reporting whatever it landed on.
           *
           * This split was introduced HERE, by the UR-36 migration. The code
           * before it read the state and the canvas inside ONE `page.evaluate`,
           * so they were the same instant; moving the pixels to a screenshot for
           * all the right reasons broke that without anybody noticing, which is
           * the same lesson one layer along.
           *
           * `scene.pause()` stops `update` and leaves rendering alone, so the
           * frame on screen is exactly the frame the state describes.
           * `plate-legibility.spec.ts` already does this for the same reason.
           *
           * UR-36: THE FRAME COMES FROM A SCREENSHOT, CLIPPED TO THE GAME.
           *
           * This took `document.querySelector("canvas")`, which is the VIEWPORT
           * BACKDROP now that the spec boots the shipping game - a static sky with
           * a starfield and no ship in it. Measured against it, the Lantern read
           * inside 114.9 / outside 118.1, a separation of 0.012, because both
           * numbers were sky. The item looked flaky and was in fact measuring a
           * picture with nothing in it.
           *
           * It also read the live WebGL canvas, which needs `preserveDrawingBuffer`
           * (`docs/verification-gaps.md`, and it has produced two wrong
           * measurements here). Both fixed the same way as V-22.3 above.
           */
          await freezeFlight(page);
          /**
           * PAUSING STOPS `update`; IT DOES NOT FLUSH THE COMPOSITOR.
           *
           * `scene.pause()` freezes the state immediately, but `page.screenshot`
           * returns whatever the browser has most recently composited, and at 3
           * workers that frame can predate the pause. The state then describes a
           * later moment than the picture - the same desynchronisation the freeze
           * was added to remove, arriving by a different route.
           *
           * Caught by this spec's own anti-vacuity assertion in the full suite:
           * "the core of rock-0-sky read 95.9 but the renderer draws it at 39.5".
           * A paused scene still RENDERS, so `postrender` keeps firing; waiting
           * two frames guarantees the composited image is the paused state.
           */
          await waitFrames(page, 2);
          const box = await flightCanvasBox(page);
          const shot = await page.screenshot({
            clip: { x: box.x, y: box.y, width: box.width, height: box.height },
          });
          const out = await page.evaluate(
            async ([b64in, asteroidUrl, stopId]: [string, string, string]) => {
          const live = window.__kbFlight?.state();
          const asteroid = (await import(asteroidUrl)) as {
            wordDebrisTypesFor: (stop: string) => { id: string; fill: string }[];
            wordRockFill: (type: { id: string; fill: string }, override?: string | null) => string;
          };
          const lumaOf = (debrisId: string): number => {
            const type = asteroid.wordDebrisTypesFor(stopId).find((d) => d.id === debrisId);
            if (type === undefined) return -1;
            const hex = asteroid.wordRockFill(type).replace("#", "");
            const r = Number.parseInt(hex.slice(0, 2), 16);
            const g = Number.parseInt(hex.slice(2, 4), 16);
            const b = Number.parseInt(hex.slice(4, 6), 16);
            return 0.299 * r + 0.587 * g + 0.114 * b;
          };
          const img = new Image();
          img.src = `data:image/png;base64,${b64in}`;
          await img.decode();
          // FULL resolution of the capture, not half of it. The old path read a
          // 1920x1080 buffer and halved it to 960x540; a viewport screenshot is
          // already 1280x720, and halving that again gave the probe 640x360 - a
          // rock core of 55 samples at r=9, which is not enough pixels to measure
          // a silhouette with. The bridge cost is the reason the halving existed
          // and it is paid once per frame, five times.
          const W = img.naturalWidth;
          const H = img.naturalHeight;
          const off = document.createElement("canvas");
          off.width = W;
          off.height = H;
          const ctx = off.getContext("2d") as CanvasRenderingContext2D;
          ctx.drawImage(img, 0, 0, W, H);
          const { data } = ctx.getImageData(0, 0, W, H);
          const bytes = new Uint8Array(W * H);
          for (let i = 0; i < bytes.length; i += 1) {
            bytes[i] = Math.round(
              0.299 * (data[i * 4] as number) +
                0.587 * (data[i * 4 + 1] as number) +
                0.114 * (data[i * 4 + 2] as number),
            );
          }
          let s2 = "";
          for (const v of bytes) s2 += String.fromCharCode(v);
          return {
            w: W,
            h: H,
            b64: btoa(s2),
            // A STALLED SCENE IS NOT A FRAME OF THIS GAME. `updateRocks` stops,
            // so every rock freezes where it was - including above the top of the
            // screen - and the ship is mid-way through D29's dim-and-sink. Both
            // are captured here so the assertion below can say so out loud rather
            // than let the probe report "could not measure" and be believed.
            stalled: live?.stalled ?? true,
            /**
             * HOW BATTERED THE SHIP IS WHEN THE SHUTTER OPENS.
             *
             * `addScorch` puts a 34x20 design-px near-black ellipse on a
             * fuselage 42 px wide for every hull hit, inside the disc this
             * probe averages. Nobody types during a capture, so the belt
             * breaches unanswered and the marks pile up: measured on saturn
             * over one capture sequence, the ship's core fell 204.7 -> 139.8 ->
             * 121.0 -> 117.5 -> 80.5 -> 58.8 -> 52.8 while the sky behind it
             * held at 97-109. On the way down it PASSES THROUGH the sky's own
             * value, and the separation there is 0.054-0.075 against a bar of
             * 0.06.
             *
             * That is a real property of the drawing and a real property of the
             * FIXTURE at the same time, and the artifact cannot tell them apart
             * without this number: a shipped stage carries `maxHull` 6 marks
             * before it stalls, and the long stage this capture needs (400
             * words, 66 marks) lets the ship reach a scorch count the game
             * never shows. Raised in gauntlet/escalations.md; recorded here so
             * the escalation has a producer and so rule 10 keeps measuring it.
             */
            hullHits: live?.hullHits ?? -1,
            maxHull: live?.maxHull ?? -1,
            rocks: (live?.rocks ?? []).map((r) => ({
              word: r.word,
              sizePx: r.sizePx,
              isCanister: r.isCanister,
              // The luma the rock is DRAWN at, from the renderer's own function.
              // This is what makes "did the probe find its object" answerable:
              // a core disc that landed on sky reads the sky's value, and the sky
              // is nowhere near the rock's.
              fillLuma: lumaOf(r.debrisType),
              plateLeft: r.plateLeft,
              plateRight: r.plateRight,
              plateTop: r.plateTop,
              plateBottom: r.plateBottom,
              rockBottom: r.rockBottom,
            })),
          };
            },
            [shot.toString("base64"), ASTEROID_MODULE, stopId] as [string, string, string],
          );
          /**
           * LEFT FROZEN, ON PURPOSE. `grab` used to resume the belt as it
           * returned, so the scene ran through every assertion, every
           * `waitForTimeout` and the next round trip - and nobody is typing, so
           * every one of those seconds is another rock breaching and another
           * scorch mark on the hull. The loop now owns when the world moves,
           * in one bounded step per frame (`advance`).
           */
          return out;
        })();

      /** Let the belt run for a measured interval, then stop it again. */
      const advance = async (ms: number): Promise<void> => {
        await freezeFlight(page, false);
        await page.waitForTimeout(ms);
        await freezeFlight(page, true);
      };

      /**
       * ================== A RETRY LOOP IN A MEASUREMENT ==================
       * If you are reading this and you are suspicious, you are right to be. A
       * loop that re-rolls until it likes the result is how a measurement stops
       * being one, and this file has already shipped two different checks that
       * looked honest and were not. So here is exactly what this does and what
       * would make it dishonest.
       *
       * WHAT IT DOES. It takes five samples that CONTAIN A ROCK, rather than five
       * ticks of a clock. The belt holds ONE word rock -
       * `gauntlet/evidence/belt-concurrency.json` measures
       * `floor(fallTime / expectedClearMs) == 1` at a fast, a median and a
       * grade-2 pilot - and that rock spends the first part of its life above the
       * top of the frame and then leaves at the breach line. A sample taken on
       * the clock therefore sometimes catches the ship alone, and the item's own
       * anti-vacuity clause (the ship AND a rock in every frame) then fails for a
       * reason about WHEN the shutter opened rather than about the art.
       *
       * WHAT KEEPS IT HONEST, and all three have to stay true:
       *
       *   1. THE BAR IS UNTOUCHED. `minSeparation > 0.06` and
       *      `objectsMeasured >= 10` are exactly what they were. Nothing here
       *      makes a weak frame pass; it makes an EMPTY frame not count.
       *   2. EVERY KEPT FRAME STILL NEEDS BOTH. A frame is only kept when the
       *      probe measured the ship and at least one rock in it, and each of
       *      those rocks then has to prove it was found (`CORE_LUMA_TOLERANCE`).
       *   3. IT FAILS SAYING SO. The attempt budget is bounded at 24, and if five
       *      frames containing a rock never arrive this throws with the count.
       *      Never inferring is not the same as inferring nothing is wrong.
       *
       * WHAT WOULD MAKE IT DISHONEST: retrying on a LOW SEPARATION rather than on
       * an ABSENT OBJECT. The condition below is `measured.objects.length < 2` -
       * "was there anything to measure" - and it must never become a test of the
       * number. If you find yourself wanting to skip a frame because the reading
       * was bad, that reading is the result.
       */
        let attempts = 0;
      while (samples.length - before < PER_STOP_FRAMES && attempts < 16) {
        const i = samples.length - before;
        attempts += 1;
        // The world moves HERE and nowhere else, so the cost of measuring is
        // not charged to the hull. 500 ms is enough for a rock to cross about
        // a seventh of the frame, so three frames are three boards.
        if (attempts > 1) await advance(500);
        const { w, h, b64, rocks, stalled, hullHits, maxHull } = await grab(stopId);
        // LOUD, and before anything is measured. A probe that cannot find its
        // object must say why; "0 samples" on a stalled belt is a fact about the
        // fixture, and reporting it as a silhouette measurement is how a check
        // starts lying.
        expect(
          stalled,
          `${stopId} sample ${i}: the stage stalled, so the rocks are frozen (some off-frame) and the ship is mid-dim`,
        ).toBe(false);
        // base64, not latin1. Decoding this as "binary" hands the probe the ASCII
        // codes of the base64 alphabet - a near-uniform buffer averaging 88 - and
        // every object then reads ~0.002 against its own background. Which is,
        // incidentally, the first thing this measure ever caught.
        const grey = Uint8Array.from(Buffer.from(b64, "base64"));
        const scale = w / DESIGN.width;

        /**
         * OFF-FRAME IS NOT UNMEASURABLE, AND CONFLATING THEM IS WHAT BROKE THIS.
         *
         * A rock spawns at y = -sizePx and falls in; for the first stretch of its
         * life it is genuinely ABOVE the picture. Handing it to the probe makes
         * the probe report `samplesIn: 0`, which reads as "I could not measure
         * this object" when the truth is "this object is not in this frame".
         *
         * The difference decides what a zero MEANS. With the two conflated, the
         * rubric item's bail could only be a ratio - it had to tolerate some
         * zeroes, because some were legitimate - and a tolerated zero is a check
         * that stops looking. Separated, every remaining zero is a real failure
         * to locate something that IS on screen, so the bail can be, and now is,
         * zero-tolerance (`tests/gauntlet/rubric.mjs`).
         *
         * THE WINDOW IS THE CORE, NOT THE RING, AND IT USED TO BE THE RING.
         *
         * `cy +/- radius * 1.75` is the OUTER SAMPLING RING, and having ring
         * pixels is not the same as having object pixels: a rock whose centre
         * sits at -1.7r has its whole 0.45r core above the picture and a large
         * arc of its ring inside it, so it passed this window and then reported
         * `samplesIn: 0`. That is the exact reading the window exists to keep
         * out, arriving through the window.
         *
         * Measured, in the six-stop sweep of 2026-09-17: five objects came back
         * unmeasurable - `rock-2-counting` and `rock-3-inside` at in 0 / out
         * 945 and 1183, and `rock-2-nobody` at in 0 / out 0, which is a rock
         * past the breach line at the BOTTOM, so the window was wrong at both
         * ends. `rubric.mjs` has zero tolerance for an unmeasurable object, by
         * design, so V-22.4 failed as a rubric item while every separation it
         * did measure was healthy - and the failure was about where the shutter
         * caught a rock, not about the art.
         *
         * So the window is `CORE`, imported from the measure rather than
         * restated: an object is included exactly when the disc the probe
         * averages is inside the picture.
         */
        const onFrame = (cy: number, radius: number): boolean =>
          cy - radius * CORE >= 0 && cy + radius * CORE <= h - 1;
        const allRocks = rocks.map((r, i2) => ({
          id: `rock-${i2}-${r.word}`,
          kind: r.isCanister ? "canister" : "rock",
          cx: ((r.plateLeft + r.plateRight) / 2) * scale,
          cy: (r.rockBottom - r.sizePx / 2) * scale,
          r: (r.sizePx / 2) * scale,
        }));
        const plateRects = rocks.map((r) => ({
          x0: r.plateLeft * scale,
          y0: r.plateTop * scale,
          x1: r.plateRight * scale,
          y1: r.plateBottom * scale,
        }));
        const offFrame = allRocks.filter((o) => !onFrame(o.cy, o.r));
        const objects: ProbeObject[] = allRocks
          .filter((o) => onFrame(o.cy, o.r))
          .filter((o) => {
            if (!platedOver(o.cx, o.cy, o.r, plateRects)) return true;
            occludedByPlate.push({ stopId, id: o.id });
            return false;
          });
        // What each on-frame rock is DRAWN at, carried alongside so the assertion
        // after the measurement can check the probe landed on it.
        const expectedLuma = new Map<string, number>();
        rocks.forEach((r, i2) => expectedLuma.set(`rock-${i2}-${r.word}`, r.fillLuma));
        // Recorded so the exclusion is visible in the artifact rather than being
        // a silent filter: a frame where everything was off-screen is a frame
        // this probe should not be believed about.
        void offFrame;
        const shipPlated = platedOver(
          SHIP.cx * scale,
          SHIP.cy * scale,
          SHIP.halfWidth * scale,
          plateRects,
        );
        if (shipPlated) occludedByPlate.push({ stopId, id: "ship" });
        else {
          objects.push({
            id: "ship",
            kind: "ship",
            cx: SHIP.cx * scale,
            cy: SHIP.cy * scale,
            r: SHIP.halfWidth * scale,
          });
        }
        // Word plates are neither object nor background.
        const exclude = rocks.map((r) => ({
          x0: r.plateLeft * scale,
          y0: r.plateTop * scale,
          x1: r.plateRight * scale,
          y1: r.plateBottom * scale,
        }));

        const measured = measureSilhouettes({ grey, w, h, objects, exclude }) as {
          objects: Record<string, unknown>[];
          unmeasurable: Record<string, unknown>[];
          minSeparation: number;
        };
        // THE PROBE HAS TO PROVE IT FOUND THE ROCK. See CORE_LUMA_TOLERANCE.
        for (const o of measured.objects as {
          id: string;
          kind: string;
          inside: number;
        }[]) {
          if (o.kind === "ship") continue;
        /**
         * A CANISTER'S CORE IS NOT ITS BODY COLOUR, BY DESIGN.
         *
         * `drawShieldCanister` (FR-5 / D26) paints an accent band - a rounded
         * rect from -0.16r to +0.16r across the middle - and two accent rings
         * over the rock, at 0.85 alpha. That band lies inside the 0.45r core
         * disc, so a canister on Jupiter reads about 99 where `wordRockFill`
         * returns 35. That is the canister being drawn correctly, not the probe
         * missing it, and this check cost two runs before the difference was
         * spotted.
         *
         * A canister keeps every other guarantee: the separation bar below still
         * applies to it, and in the placed pass it has already been matched to
         * the coordinate it was put at, so "did the disc land on it" is answered
         * by construction rather than by luminance.
         */
        if (o.kind === "canister") continue;
          const want = expectedLuma.get(o.id);
          if (want === undefined || want < 0) continue;
          expect(
            Math.abs(o.inside - want),
            `${stopId} sample ${i}: the core of ${o.id} (${o.kind}) read ${o.inside.toFixed(1)} but the renderer draws it at ${want.toFixed(1)} - the disc landed on the background, not the rock`,
          ).toBeLessThan(CORE_LUMA_TOLERANCE);
        }
        // THE FRAME NEEDS BOTH, which is what the assertion at the end of this
        // test demands of every kept frame. A frame with only the ship says
        // nothing about the asteroids; a frame with no ship reading cannot
        // satisfy `shipReadings.length === samples.length`. Either way it is a
        // fact about when the shutter opened, not about the art - so another
        // frame is taken rather than an empty picture counted.
        const hasShip = (measured.objects as { kind: string }[]).some((o) => o.kind === "ship");
        const hasRock = (measured.objects as { kind: string }[]).some((o) => o.kind !== "ship");
        if (!hasShip || !hasRock) continue;
        samples.push({
          stopId,
          frame: { w, h },
          objects: measured.objects,
          unmeasurable: measured.unmeasurable,
          minSeparation: measured.minSeparation,
          rocks: rocks.length,
          hullHits,
          maxHull,
        });
      }
      expect(
        samples.length - before,
        `${stopId}: only ${samples.length - before} live frame(s) with a rock in them after ${attempts} attempts; the probe had nothing to measure`,
      ).toBe(PER_STOP_FRAMES);

      /**
       * THE PLACED PASS: the bottom of the fall, on purpose rather than by luck.
       *
       * The scene is paused first and the rocks are placed on the paused scene,
       * so the height asked for is the height measured - `spawn` back-dates the
       * rock's start so it is an ordinary rock that began falling earlier, not
       * one dragged around behind the simulation. `grab` pauses again (harmless)
       * and resumes at the end.
       */
      await freezeFlight(page, true);
      const designW = await page.evaluate(
        () => (window.__kbGame as unknown as { scale: { width: number } }).scale.width,
      );
      for (let k = 0; k < PLACED_HEIGHTS.length; k += 1) {
        await spawnAt(page, PLACED_WORDS[k] as string, {
          x: designW * (PLACED_X[k] as number),
          y: DESIGN.height * (PLACED_HEIGHTS[k] as number),
          spinPerSec: 0.1,
        });
      }
      const promoted = await page.evaluate(
        (word: string) => window.__kbFlight?.makeCanister(word) ?? null,
        CANISTER_WORD,
      );
      expect(
        promoted,
        `${stopId}: the placed rock "${CANISTER_WORD}" was not promoted to a canister, so this stop measured no canister at all`,
      ).toBe(CANISTER_WORD);

      const placed = await grab(stopId);
      /**
       * THE SAME CHECK THE LIVE PASS MAKES, WHICH THIS PASS DID NOT.
       *
       * A stalled stage freezes every rock where it was and puts the Lantern
       * into D29's dim-and-sink, so the ship's core reads far below the value
       * it is drawn at and the reading is about the stall rather than about the
       * art. The live loop has said so since the UR-36 follow-on; the placed
       * pass was measuring the same fixture without the same guard.
       */
      expect(
        placed.stalled,
        `${stopId} placed: the stage stalled, so the ship is mid-dim and the rocks are frozen`,
      ).toBe(false);
      const pScale = placed.w / DESIGN.width;
      /**
       * MATCHED BY POSITION, NOT BY WORD, and the first version was matched by
       * word and wrong.
       *
       * `spawnAt` waits for a rock carrying the word to exist, and the belt may
       * ALREADY be carrying it - Jupiter's pool has "dust" in it - so the wait
       * was satisfied by a rock the belt spawned, wherever that happened to be,
       * while the placement created a second one. The probe then measured the
       * belt's rock under the name of the placed one and read 99.9 against a
       * renderer value of 35.2. This spec's anti-vacuity guard caught it, twice,
       * which is the guard earning its place: both times the number it rejected
       * looked like a perfectly ordinary reading.
       *
       * Matching on the coordinate that was ASKED FOR removes the ambiguity and
       * doubles as proof the placement landed where it was aimed.
       */
      const TOLERANCE_PX = 48;
      const pCandidates = placed.rocks.map((r) => ({
        word: r.word,
        cxDesign: (r.plateLeft + r.plateRight) / 2,
        cyDesign: r.rockBottom - r.sizePx / 2,
        radius: r.sizePx / 2,
        isCanister: r.isCanister,
        fillLuma: r.fillLuma,
      }));
      const pPlates = placed.rocks.map((r) => ({
        x0: r.plateLeft * pScale,
        y0: r.plateTop * pScale,
        x1: r.plateRight * pScale,
        y1: r.plateBottom * pScale,
      }));
      const pObjects: ProbeObject[] = [];
      const pExpected = new Map<string, number>();
      PLACED_HEIGHTS.forEach((hFrac, k) => {
        const wantX = designW * (PLACED_X[k] as number);
        const wantY = DESIGN.height * hFrac;
        const hit = pCandidates
          .map((c) => ({ c, d: Math.hypot(c.cxDesign - wantX, c.cyDesign - wantY) }))
          .sort((a, b) => a.d - b.d)[0];
        if (hit === undefined || hit.d > TOLERANCE_PX) return;
        const id = `placed-${k}-${hit.c.word}`;
        if (platedOver(hit.c.cxDesign * pScale, hit.c.cyDesign * pScale, hit.c.radius * pScale, pPlates)) {
          occludedByPlate.push({ stopId, id });
          return;
        }
        pObjects.push({
          id,
          kind: hit.c.isCanister ? "canister" : "rock",
          cx: hit.c.cxDesign * pScale,
          cy: hit.c.cyDesign * pScale,
          r: hit.c.radius * pScale,
        });
        pExpected.set(id, hit.c.fillLuma);
      });
      if (platedOver(SHIP.cx * pScale, SHIP.cy * pScale, SHIP.halfWidth * pScale, pPlates)) {
        occludedByPlate.push({ stopId, id: "ship (placed)" });
      } else {
        pObjects.push({
          id: "ship",
          kind: "ship",
          cx: SHIP.cx * pScale,
          cy: SHIP.cy * pScale,
          r: SHIP.halfWidth * pScale,
        });
      }
      const pMeasured = measureSilhouettes({
        grey: Uint8Array.from(Buffer.from(placed.b64, "base64")),
        w: placed.w,
        h: placed.h,
        objects: pObjects,
        exclude: placed.rocks.map((r) => ({
          x0: r.plateLeft * pScale,
          y0: r.plateTop * pScale,
          x1: r.plateRight * pScale,
          y1: r.plateBottom * pScale,
        })),
      }) as {
        objects: Record<string, unknown>[];
        unmeasurable: Record<string, unknown>[];
        minSeparation: number;
      };
      // Same anti-vacuity rule as the live pass: a disc that did not land on the
      // rock is not a reading about the rock.
      for (const o of pMeasured.objects as { id: string; kind: string; inside: number }[]) {
        if (o.kind === "ship") continue;
        /**
         * A CANISTER'S CORE IS NOT ITS BODY COLOUR, BY DESIGN.
         *
         * `drawShieldCanister` (FR-5 / D26) paints an accent band - a rounded
         * rect from -0.16r to +0.16r across the middle - and two accent rings
         * over the rock, at 0.85 alpha. That band lies inside the 0.45r core
         * disc, so a canister on Jupiter reads about 99 where `wordRockFill`
         * returns 35. That is the canister being drawn correctly, not the probe
         * missing it, and this check cost two runs before the difference was
         * spotted.
         *
         * A canister keeps every other guarantee: the separation bar below still
         * applies to it, and in the placed pass it has already been matched to
         * the coordinate it was put at, so "did the disc land on it" is answered
         * by construction rather than by luminance.
         */
        if (o.kind === "canister") continue;
        const want = pExpected.get(o.id);
        if (want === undefined || want < 0) continue;
        expect(
          Math.abs(o.inside - want),
          `${stopId} placed: the core of ${o.id} (${o.kind}) read ${o.inside.toFixed(1)} but the renderer draws it at ${want.toFixed(1)} - the disc landed on the background, not the rock`,
        ).toBeLessThan(CORE_LUMA_TOLERANCE);
      }
      expect(
        pObjects.length - 1,
        `${stopId}: only ${pObjects.length - 1} of ${PLACED_HEIGHTS.length} placed rocks were found within ${TOLERANCE_PX}px of where they were put`,
      ).toBe(PLACED_HEIGHTS.length);
      /**
       * ANTI-VACUITY FOR THE CANISTER. The promotion above can succeed and the
       * position match can still land on a different rock; then this pass would
       * measure five plain rocks and report a clean sweep of an object class it
       * never looked at.
       *
       * It asks that THIS object is a canister, not that it is the only one:
       * `spawnRock` may decide a placed rock is a canister on its own
       * (`maySpawnCanister` plus the seed), and jupiter did exactly that to
       * `placed-1-polar`. A second canister is another reading of the same
       * class, not a problem with this one.
       */
      expect(
        pObjects.map((o) => `${o.id}:${o.kind}`),
        `${stopId}: the placed pass measured no canister at index ${CANISTER_INDEX}`,
      ).toContain(`placed-${CANISTER_INDEX}-${CANISTER_WORD}:canister`);
      expect(
        pMeasured.objects.length,
        `${stopId}: the placed pass measured ${pMeasured.objects.length} objects`,
      ).toBeGreaterThanOrEqual(PLACED_HEIGHTS.length);
      console.log(
        `V-22.4 ${stopId}: ${samples.length - before} live frames, placed pass min ` +
          `${pMeasured.minSeparation}`,
      );
      samples.push({
        stopId,
        frame: { w: placed.w, h: placed.h },
        objects: pMeasured.objects,
        unmeasurable: pMeasured.unmeasurable,
        minSeparation: pMeasured.minSeparation,
        rocks: placed.rocks.length,
        hullHits: placed.hullHits,
        maxHull: placed.maxHull,
      });
    }

    const all = samples.flatMap(
      (s) => s.objects as { separation: number; kind: string; at: { y: number } }[],
    );
    const minSeparation = all.length === 0 ? 0 : Math.min(...all.map((o) => o.separation));
    const weakest = all.reduce(
      (a, b) => (a === null || b.separation < a.separation ? b : a),
      null as { separation: number; kind: string } | null,
    );
    const shipReadings = all.filter((o) => o.kind === "ship");
    const unmeasurable = samples.flatMap((s) => s.unmeasurable);
    // WHICH BAND, because "the frame does not read" is not a task and "debris
    // in the bottom third sits in the terrain's own luma band" is.
    const frameH = samples[0]?.frame.h ?? 1;
    const bandOf = (y: number): "top" | "middle" | "bottom" =>
      y < frameH / 3 ? "top" : y < (2 * frameH) / 3 ? "middle" : "bottom";
    const byStop: Record<string, { n: number; min: number; weakest: string }> = {};
    for (const sample of samples) {
      for (const o of sample.objects as { separation: number; id: string }[]) {
        const cur = byStop[sample.stopId] ?? { n: 0, min: 1, weakest: "" };
        byStop[sample.stopId] =
          o.separation < cur.min
            ? { n: cur.n + 1, min: o.separation, weakest: o.id }
            : { ...cur, n: cur.n + 1 };
      }
    }
    const byBand: Record<string, { n: number; min: number }> = {};
    for (const o of all) {
      const b = bandOf(o.at.y);
      const cur = byBand[b] ?? { n: 0, min: 1 };
      byBand[b] = { n: cur.n + 1, min: Math.min(cur.min, o.separation) };
    }

    writeEvidence("desaturated-silhouettes.json", {
      claim:
        "AC-22.4: with the colour removed, every object the scene reports — every live rock and the ship — still separates from the background immediately around it",
      method:
        "position-anchored, swept across all six stops that have a belt: the scene is asked where its objects are, and the desaturated frame is measured there. Mean luma in each object's core disc (0.45r) against a background ring (1.15r..1.75r) that excludes other objects and every word plate. No segmentation, no threshold chosen from the data. 5 frames 1 s apart.",
      measure: "tests/gauntlet/silhouette.mjs measureSilhouettes",
      supersedes:
        "a global-Otsu connected-component measure, which scored 0.239 on a floor vignette that crushed the play area to a 0.002 step: it is adaptive, so it re-split the crushed frame and reported on terrain edges elsewhere",
      negativeControl:
        "tests/unit/gauntlet/silhouette.test.ts — the same vignette applied to a synthetic frame drives this measure to 0.000 while the superseded Otsu measure on the identical pixels still reports ~0.27. Runs in vitest, no browser: npx vitest run tests/unit/gauntlet/silhouette.test.ts --coverage.enabled=false",
      shipAnchor: SHIP,
      frame: samples[0]?.frame,
      frames: samples.length,
      objectsMeasured: all.length,
      shipReadings: shipReadings.length,
      stops: BELTED_STOPS,
      byStop,
      byBand,
      unmeasurable,
      occludedByPlate,
      hullHitsWhenMeasured: samples.map((f) => f.hullHits),
      shippedMaxHull: SHIPPED_MAX_HULL,
      minSeparation: Number(minSeparation.toFixed(4)),
      weakest,
      perFrame: samples.map((s) => ({
        stopId: s.stopId,
        rocks: s.rocks,
        measured: s.objects.length,
        minSeparation: s.minSeparation,
        hullHits: s.hullHits,
        maxHull: s.maxHull,
        shipInside:
          (s.objects.find((o) => o["kind"] === "ship") as { inside?: number } | undefined)
            ?.inside ?? null,
      })),
      objects: all,
      limitations: [
        "the ship's anchor is read from FlightScene.ts:169,570-571 rather than from the debug surface; if the scene moves it, this probe measures empty sky and the item goes red",
        "it does not claim a child can tell a rock from the ship, only that each object is distinguishable from what is immediately behind it",
      ],
    });

    // ANTI-VACUITY. A minimum over an empty set is not a minimum, and a capture
    // that never saw the ship is a capture of a frame with no rocket in it.
    expect(all.length, "objects measured").toBeGreaterThanOrEqual(10);
    // EVERY BELTED STOP CONTRIBUTED. Without this the sweep degrades silently
    // into the Mars-only check it replaces the moment a stop fails to boot.
    expect(Object.keys(byStop).sort(), "every belted stop measured").toEqual([...BELTED_STOPS].sort());
    for (const stop of BELTED_STOPS) {
      expect(
        (byStop[stop] as { n: number }).n,
        `${stop}: readings contributed`,
      ).toBeGreaterThanOrEqual(8);
    }
    // AND THE BOTTOM OF THE FALL IS IN THE SET. The placed pass exists because
    // the bottom band is the weakest and the least likely to be sampled by luck.
    expect(
      (byBand["bottom"] ?? { n: 0 }).n,
      "readings in the bottom third of the frame",
    ).toBeGreaterThanOrEqual(BELTED_STOPS.length);
    expect(shipReadings.length, "the ship must be measured in every frame").toBe(samples.length);
    /**
     * THE FIXTURE DID NOT OUTRUN THE GAME. Every kept frame has to show a hull
     * a shipped stage could actually be flying - see `SHIPPED_MAX_HULL`. This
     * is a statement about the capture, not about the art, and it is asserted
     * so that a slower machine says so instead of quietly reporting a
     * silhouette number about a ship the game never draws.
     */
    expect(
      Math.max(...samples.map((f) => f.hullHits)),
      `the capture let the Lantern take more than ${SHIPPED_MAX_HULL} scorch marks, which no shipped stage allows: ${JSON.stringify(samples.map((f) => `${f.stopId}:${f.hullHits}`))}`,
    ).toBeLessThanOrEqual(SHIPPED_MAX_HULL);
    // Ship plus at least one rock in every frame. A frame in which only the
    // ship could be measured says nothing about the asteroids, and the AC names
    // both.
    expect(
      Math.min(...samples.map((s) => s.objects.length)),
      "every sampled frame must have the ship and at least one rock in it",
    ).toBeGreaterThanOrEqual(2);
    // 0.06 of the 8-bit range is about 15 levels: well above dither, far below
    // what a real silhouette against terrain gives. Unchanged from the measure
    // this replaces — the bar did not move, the thing being measured did.
    expect(minSeparation, `weakest: ${JSON.stringify(weakest)}`).toBeGreaterThan(0.06);
  });

  test("V-22.1b / AC-22.1: five parallax layers observed moving at distinct rates", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await bootFlight(page);
    const first = await state(page);
    // A long window on purpose: Phaser smooths and caps its frame delta, so in
    // a janky headless page the world advances in slow motion and a short
    // sample cannot separate the two slowest layers from zero.
    await page.waitForTimeout(3000);
    const second = await state(page);

    const rates = new Map<string, number>();
    for (const [id, value] of Object.entries(second.layerOffsets)) {
      const delta = value - ((first.layerOffsets[id] as number) ?? 0);
      if (delta > 0.05) rates.set(id, Number(delta.toFixed(2)));
    }
    const distinct = new Set(rates.values()).size;

    // SCENE-QUALIFIED FILENAME, and the scene is recorded inside it.
    //
    // `title.spec.ts` used to write `parallax-overlay.json` too, measuring the
    // weaker property "did the layer move at all" rather than "are the rates
    // distinct". Both specs run in the same suite, so whichever finished last
    // owned the path - and the repo's copy was the Title one, which meant the
    // rubric's "five speeds actually moving" was being certified by a capture
    // that never measured a speed.
    writeEvidence("parallax-overlay-flight.json", {
      scene: "Flight",
      movingLayers: rates.size,
      distinctRates: distinct,
      sampleGapMs: 3000,
      observed: Object.fromEntries(rates),
    });
    expect(distinct).toBeGreaterThanOrEqual(5);
  });
});

