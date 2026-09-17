import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
// Type-only: erased before Playwright ever loads this file, so the scenes'
// own debug contract is checked at compile time without bundling src into the
// test runner.
import type { FlightDebugState } from "../../src/game/scenes/FlightScene.js";

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
        bootFlight: (o: unknown) => void;
      };
      mod.bootFlight({ debug: true, ...(opts as Record<string, unknown>) });
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

    const sampleSky = (): Promise<[number, number, number]> =>
      page.evaluate(() => {
        const canvas = document.querySelector("canvas") as HTMLCanvasElement;
        const off = document.createElement("canvas");
        off.width = canvas.width;
        off.height = canvas.height;
        const ctx = off.getContext("2d") as CanvasRenderingContext2D;
        ctx.drawImage(canvas, 0, 0);
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
      });

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
   * WHY THIS WAS REWRITTEN
   *
   * The old version desaturated the frame, Otsu-thresholded it and counted
   * connected regions, then asserted the count was between 3 and 60. Its whole
   * evidence artifact was `{"contours": 14}`.
   *
   * That number cannot fail for the reason the AC cares about. Fourteen blobs in
   * a frame says nothing about whether ANY of them is the rocket, or a rock.
   * Fourteen clouds would pass it. A frame in which every asteroid had dissolved
   * into the terrain behind it would pass it, as long as the terrain itself had
   * a few contours - and dissolving into the terrain is precisely the failure
   * the AC exists to catch.
   *
   * So the measurement is now per OBJECT, against objects the scene names. The
   * live rocks come from `__kbFlight.state()`; the ship is at the anchor
   * `FlightScene` puts it at. For each, in the DESATURATED frame, we compare the
   * mean luminance inside the object with the mean luminance of a ring just
   * outside it. That difference IS "identifiable by silhouette" - it is what
   * your eye does when the colour is gone - and an object that has dissolved
   * into its background scores zero however many contours the frame has.
   */
  interface Region {
    area: number;
    /** Centroid y as a fraction of frame height. Which band it is in. */
    at: number;
    inside: number;
    outside: number;
    separation: number;
  }
  interface Sample {
    frame: { w: number; h: number };
    threshold: number;
    regions: Region[];
    /** Object-sized regions whose centroid is in the bottom third. */
    bottomBand: number;
  }

  /**
   * AC-22.4: "Desaturated flight screenshot: rocket and asteroids identifiable
   * by silhouette."
   *
   * ---------------------------------------------------------------------------
   * WHY THIS WAS REWRITTEN
   *
   * The old version desaturated the frame, Otsu-thresholded it, counted
   * connected regions and asserted the count was between 3 and 60. Its entire
   * evidence artifact was `{"contours": 14}`.
   *
   * That number cannot fail for the reason the AC exists. Fourteen regions says
   * nothing about whether any of them separates from what is behind it, and a
   * frame in which every asteroid had dissolved into the terrain would still
   * score a dozen contours off the terrain alone - which is precisely the
   * failure the AC is there to catch.
   *
   * So the measurement is now per REGION and it is about EDGES. Each
   * object-sized region in the thresholded frame is compared against a ring of
   * background just outside it, and the weakest of those steps is the number.
   * A dissolved object has no step, whatever the region count is.
   *
   * ---------------------------------------------------------------------------
   * HOW SENSITIVE IT ACTUALLY IS, MEASURED RATHER THAN ASSERTED
   *
   * A real regression was available to test this against: a floor vignette that
   * washed 58% near-black across the full width at the ship's own height, so a
   * rock down there measured luminance 76 against a background of 76. A probe
   * that knew where the objects were scored that at 0.002.
   *
   * THIS CHECK DOES NOT FAIL ON IT. Run against that vignette it reports
   * minSeparation 0.239, regions 6-8 per frame and 1-2 in the bottom band -
   * degraded against the healthy frame's 0.187 / 8-9 / 2-4, but inside every
   * threshold here. Otsu is adaptive, so it re-splits a crushed frame and still
   * finds regions with a step across them.
   *
   * That is recorded rather than tuned away. Thresholds fitted to one known
   * defect are how a check ends up green and meaningless, which is the whole
   * reason this item was on the false-pass list. So: this version is strictly
   * stronger than a contour count - it requires object-sized, uncropped regions,
   * a real luminance step across every one of them, and shapes present in the
   * bottom third where the player is looking - and it is NOT a proof that the
   * frame reads. The judge's eye is still the gate for that.
   *
   * WHAT IT DOES NOT CLAIM, stated because the last version of this overclaimed
   * and that is how it got into the false-pass list. It does not identify which
   * region is the rocket. The scene's debug state reports rock positions in
   * their parallax container's local space, not in screen space, so there is no
   * honest way from here to say "this blob is rock-3" without reaching into
   * another lane's scene internals. What it does assert is the property the AC
   * turns on: that the frame contains several object-sized shapes and that every
   * one of them still separates from its background with the colour gone.
   */
  test("V-22.4 / AC-22.4: object-sized shapes still separate from their background, desaturated", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await bootFlight(page, {
      pixelReadback: true,
      knobs: { maxLive: 4 },
      stageWordCount: 40,
    });
    await page.waitForFunction(
      () => (window.__kbFlight?.state().rocks.length ?? 0) > 0,
      null,
      { timeout: 20_000 },
    );
    await page.waitForTimeout(1500);

    const sample = (): Promise<Sample> =>
      page.evaluate(() => {
        const canvas = document.querySelector("canvas") as HTMLCanvasElement;
        // Half resolution: enough to resolve a rock, cheap enough to flood-fill
        // five times without the page stuttering.
        const W = Math.round(canvas.width / 2);
        const H = Math.round(canvas.height / 2);
        const off = document.createElement("canvas");
        off.width = W;
        off.height = H;
        const ctx = off.getContext("2d") as CanvasRenderingContext2D;
        ctx.drawImage(canvas, 0, 0, W, H);
        const { data } = ctx.getImageData(0, 0, W, H);

        const grey = new Uint8Array(W * H);
        for (let i = 0; i < grey.length; i += 1) {
          grey[i] = Math.round(
            0.299 * (data[i * 4] as number) +
              0.587 * (data[i * 4 + 1] as number) +
              0.114 * (data[i * 4 + 2] as number),
          );
        }

        // Otsu: the split that best separates light from dark, which is what
        // "does it still read" means once the colour is gone.
        const hist = new Array<number>(256).fill(0);
        for (const v of grey) hist[v] = (hist[v] as number) + 1;
        const total = grey.length;
        let sum = 0;
        for (let i = 0; i < 256; i += 1) sum += i * (hist[i] as number);
        let sumB = 0;
        let wB = 0;
        let best = 0;
        let threshold = 128;
        for (let t = 0; t < 256; t += 1) {
          wB += hist[t] as number;
          if (wB === 0) continue;
          const wF = total - wB;
          if (wF === 0) break;
          sumB += t * (hist[t] as number);
          const mB = sumB / wB;
          const mF = (sum - sumB) / wF;
          const between = wB * wF * (mB - mF) * (mB - mF);
          if (between > best) {
            best = between;
            threshold = t;
          }
        }

        // Connected components of each class.
        const label = new Int32Array(W * H).fill(-1);
        const regions: Region[] = [];
        const stack: number[] = [];
        // OBJECT-SIZED, in pixels of this half-res buffer. A rock is 40-130 px
        // across at design resolution, so 20-65 here: an area band of 250..9000
        // takes rocks and the ship and excludes both the sky and a stray speck.
        const MIN_AREA = 250;
        const MAX_AREA = 9000;
        for (let start = 0; start < W * H; start += 1) {
          if (label[start] !== -1) continue;
          const cls = (grey[start] as number) > threshold ? 1 : 0;
          const id = regions.length;
          const members: number[] = [];
          stack.length = 0;
          stack.push(start);
          label[start] = id;
          while (stack.length > 0) {
            const p = stack.pop() as number;
            members.push(p);
            const x = p % W;
            const y = (p - x) / W;
            const neighbours = [
              x > 0 ? p - 1 : -1,
              x < W - 1 ? p + 1 : -1,
              y > 0 ? p - W : -1,
              y < H - 1 ? p + W : -1,
            ];
            for (const q of neighbours) {
              if (q < 0 || label[q] !== -1) continue;
              if (((grey[q] as number) > threshold ? 1 : 0) !== cls) continue;
              label[q] = id;
              stack.push(q);
            }
          }
          // Reserve the id whether or not we keep the region, so labels stay
          // unique; only object-sized ones are measured.
          regions.push({ area: members.length, at: 0, inside: 0, outside: 0, separation: 0 });
          if (members.length < MIN_AREA || members.length > MAX_AREA) continue;

          // A region touching the frame edge is a crop, not an object.
          let touchesEdge = false;
          let minX = W;
          let maxX = 0;
          let minY = H;
          let maxY = 0;
          for (const p of members) {
            const x = p % W;
            const y = (p - x) / W;
            if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touchesEdge = true;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
          if (touchesEdge) continue;

          let insideSum = 0;
          for (const p of members) insideSum += grey[p] as number;
          // The background ring: everything within a 6 px band of the region's
          // bounding box that is NOT this region. That is what the eye compares
          // the shape against.
          const pad = 6;
          let outSum = 0;
          let outN = 0;
          for (let y = Math.max(0, minY - pad); y <= Math.min(H - 1, maxY + pad); y += 1) {
            for (let x = Math.max(0, minX - pad); x <= Math.min(W - 1, maxX + pad); x += 1) {
              const p = y * W + x;
              if (label[p] === id) continue;
              const insideBox = x >= minX && x <= maxX && y >= minY && y <= maxY;
              if (insideBox) continue;
              outSum += grey[p] as number;
              outN += 1;
            }
          }
          if (outN === 0) continue;
          const inside = insideSum / members.length;
          const outside = outSum / outN;
          let ySum = 0;
          for (const p of members) ySum += (p - (p % W)) / W;
          regions[id] = {
            area: members.length,
            at: Number((ySum / members.length / H).toFixed(3)),
            inside: Number(inside.toFixed(1)),
            outside: Number(outside.toFixed(1)),
            separation: Number((Math.abs(inside - outside) / 255).toFixed(4)),
          };
        }

        const kept = regions.filter((r) => r.separation > 0);
        return {
          frame: { w: W, h: H },
          threshold,
          regions: kept,
          bottomBand: kept.filter((r) => r.at > 0.667).length,
        };
      });

    // FIVE FRAMES A SECOND APART, because the belt's own pacing decides how many
    // rocks are live (FR-8 / D19) and a single still can catch a nearly empty
    // sky. Sampling over time puts what the belt actually produced in front of
    // the measurement, at several positions and against several backgrounds.
    const samples: Sample[] = [];
    for (let i = 0; i < 5; i += 1) {
      samples.push(await sample());
      if (i < 4) await page.waitForTimeout(1000);
    }
    const regions = samples.flatMap((s) => s.regions);
    const separations = regions.map((r) => r.separation);
    const minSeparation = separations.length === 0 ? 0 : Math.min(...separations);
    const weakest = regions.reduce(
      (a, b) => (b.separation < a.separation ? b : a),
      regions[0] ?? { area: 0, inside: 0, outside: 0, separation: 0 },
    );
    const perFrame = samples.map((s) => s.regions.length);

    writeEvidence("desaturated-silhouettes.json", {
      claim:
        "AC-22.4: with the colour removed, every object-sized shape in the frame still separates from its background",
      method:
        "desaturate, Otsu threshold, connected components in an object-sized area band, then mean luminance inside each region vs a 6 px background ring outside its bounding box; 5 frames 1 s apart",
      limitations: [
        "regions are not identified as specific rocks: the scene reports rock positions in parallax-container space, not screen space",
        "measured sensitivity: a floor vignette that crushed the play area to a 0.002 object/background step still scores 0.239 here, because Otsu re-splits a crushed frame. Stronger than the contour count it replaced; not a proof that the frame reads.",
      ],
      frame: samples[0]?.frame,
      frames: samples.length,
      threshold: samples[0]?.threshold,
      regionsPerFrame: perFrame,
      bottomBandPerFrame: samples.map((s) => s.bottomBand),
      regionsMeasured: regions.length,
      minSeparation: Number(minSeparation.toFixed(4)),
      weakest,
      regions,
    });

    // Anti-vacuity: a frame with no object-sized shapes in it has nothing to say
    // about silhouettes, and a minimum over one region is not a minimum.
    expect(regions.length, "object-sized regions measured").toBeGreaterThanOrEqual(8);
    expect(
      Math.min(...perFrame),
      "every sampled frame has object-sized shapes in it",
    ).toBeGreaterThanOrEqual(2);
    // AND IN THE BOTTOM THIRD SPECIFICALLY, which is where the ship flies and
    // where a full-width darkening wash does its damage. The ship alone
    // guarantees one there in a healthy frame; zero means something has
    // flattened the band the player is actually looking at.
    expect(
      Math.min(...samples.map((x) => x.bottomBand)),
      "every sampled frame has an object-sized shape in its bottom third",
    ).toBeGreaterThanOrEqual(1);
    // 0.06 of the 8-bit range is about 15 levels: well above dither, and far
    // below what a real silhouette against terrain gives.
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

