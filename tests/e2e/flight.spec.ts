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
import { flightCanvasBox } from "./support/flightBoot.js";
// @ts-expect-error - .mjs tooling module, no type declarations by design
import { measureSilhouettes } from "../gauntlet/silhouette.mjs";

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
    expect(run.score).toBe(run.word.length * 20);
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
    await bootFlight(page, {
      pixelReadback: true,
      stageDurationMs: 16_000,
      stageWordCount: 40,
    });

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
    const sampleSky = async (): Promise<[number, number, number]> => {
      const box = await flightCanvasBox(page);
      const shot = await page.screenshot({
        clip: { x: box.x, y: box.y, width: box.width, height: box.height },
      });
      return page.evaluate(async (b64: string) => {
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
        return [median(0), median(1), median(2)] as [number, number, number];
      }, shot.toString("base64"));
    };

    const start = await sampleSky();
    await page.waitForTimeout(17_000);
    const end = await sampleSky();

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
      [STAGE_MODULE, start, end] as const,
    )) as number;

    writeEvidence("sky-gradient-shift.json", {
      deltaE: Number(delta.toFixed(2)),
      startRgb: start.map((v) => Math.round(v)),
      endRgb: end.map((v) => Math.round(v)),
      stopId: "mars",
    });
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
    test.setTimeout(90_000);
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
    await bootFlight(page, {
      knobs: { maxLive: 4 },
      stageWordCount: 400,
    });
    await page.waitForFunction(
      () => (window.__kbFlight?.state().rocks.length ?? 0) > 0,
      null,
      { timeout: 20_000 },
    );
    await page.waitForTimeout(1500);

    /** FlightScene.ts:169 / :570-571 — the ship's anchor, in DESIGN pixels. */
    const SHIP = { cx: DESIGN.width / 2, cy: DESIGN.height - 150, halfWidth: 46 };

    /**
     * ONE PAGE TURN FOR BOTH. The positions and the pixels must come from the
     * same frame, and this is not a nicety: rocks fall on the wall clock, and
     * reading the state in one `page.evaluate` and the canvas in the next puts
     * two CDP round trips between them. Measured here, that gap was about a
     * second - the probe was drawing its rings 140 px above every rock and
     * reporting ~0.007 separation for a frame a human can read at a glance.
     * It looked exactly like a broken renderer, and it was a broken clock.
     */
    const grab = (): Promise<{
      w: number;
      h: number;
      b64: string;
      stalled: boolean;
      rocks: { word: string; sizePx: number; isCanister: boolean; plateLeft: number; plateRight: number; plateTop: number; plateBottom: number; rockBottom: number }[];
    }> =>
      (async () => {
        /**
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
        const box = await flightCanvasBox(page);
        const shot = await page.screenshot({
          clip: { x: box.x, y: box.y, width: box.width, height: box.height },
        });
        return page.evaluate(async (b64in: string) => {
        const live = window.__kbFlight?.state();
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
          rocks: (live?.rocks ?? []).map((r) => ({
            word: r.word,
            sizePx: r.sizePx,
            isCanister: r.isCanister,
            plateLeft: r.plateLeft,
            plateRight: r.plateRight,
            plateTop: r.plateTop,
            plateBottom: r.plateBottom,
            rockBottom: r.rockBottom,
          })),
        };
        }, shot.toString("base64"));
      })();

    interface FrameSample {
      frame: { w: number; h: number };
      objects: Record<string, unknown>[];
      unmeasurable: Record<string, unknown>[];
      minSeparation: number;
      rocks: number;
    }

    const samples: FrameSample[] = [];
    for (let i = 0; i < 5; i += 1) {
      const { w, h, b64, rocks, stalled } = await grab();
      // LOUD, and before anything is measured. A probe that cannot find its
      // object must say why; "0 samples" on a stalled belt is a fact about the
      // fixture, and reporting it as a silhouette measurement is how a check
      // starts lying.
      expect(
        stalled,
        `sample ${i}: the stage stalled, so the rocks are frozen (some off-frame) and the ship is mid-dim`,
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
       * The window is the object's own sampling ring, so an object is included
       * exactly when the probe has pixels to read.
       */
      const onFrame = (cy: number, radius: number): boolean =>
        cy + radius * 1.75 >= 0 && cy - radius * 1.75 <= h - 1;
      const allRocks = rocks.map((r, i2) => ({
        id: `rock-${i2}-${r.word}`,
        kind: r.isCanister ? "canister" : "rock",
        cx: ((r.plateLeft + r.plateRight) / 2) * scale,
        cy: (r.rockBottom - r.sizePx / 2) * scale,
        r: (r.sizePx / 2) * scale,
      }));
      const offFrame = allRocks.filter((o) => !onFrame(o.cy, o.r));
      const objects: ProbeObject[] = allRocks.filter((o) => onFrame(o.cy, o.r));
      // Recorded so the exclusion is visible in the artifact rather than being
      // a silent filter: a frame where everything was off-screen is a frame
      // this probe should not be believed about.
      void offFrame;
      objects.push({
        id: "ship",
        kind: "ship",
        cx: SHIP.cx * scale,
        cy: SHIP.cy * scale,
        r: SHIP.halfWidth * scale,
      });
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
      samples.push({
        frame: { w, h },
        objects: measured.objects,
        unmeasurable: measured.unmeasurable,
        minSeparation: measured.minSeparation,
        rocks: rocks.length,
      });
      if (i < 4) await page.waitForTimeout(1000);
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
        "position-anchored: the scene is asked where its objects are, and the desaturated frame is measured there. Mean luma in each object's core disc (0.45r) against a background ring (1.15r..1.75r) that excludes other objects and every word plate. No segmentation, no threshold chosen from the data. 5 frames 1 s apart.",
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
      byBand,
      unmeasurable,
      minSeparation: Number(minSeparation.toFixed(4)),
      weakest,
      perFrame: samples.map((s) => ({
        rocks: s.rocks,
        measured: s.objects.length,
        minSeparation: s.minSeparation,
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
    expect(shipReadings.length, "the ship must be measured in every frame").toBe(samples.length);
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

