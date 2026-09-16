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

    const seen = new Map<string, RockView>();
    for (let i = 0; i < 24; i += 1) {
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

  test("FR-5 / AC-5.2: blasting a shield canister repairs one hull mark, capped at three", async ({
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

      api.strike();
      const damaged = api.state().hull;

      const first = api.makeCanister();
      type(first);
      const repaired = api.state().hull;

      // AC-5.2's cap: a canister blasted at full hull cannot push it past three.
      const second = api.makeCanister();
      type(second);
      const capped = api.state().hull;

      return { damaged, first, repaired, second, capped };
    });

    expect(run.damaged).toBe(2);
    expect(run.first).toBeTruthy();
    expect(run.repaired).toBe(3);
    expect(run.capped).toBe(3);
  });

  test("AC-4.3 + AC-18.1: an empty hull stalls to screen 6b, and Enter alone flies the stage again with the word history kept", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await bootFlight(page, { knobs: { maxLive: 2 } });

    // Fly one word so there is history to keep.
    const first = (await state(page)).rocks[0] as RockView;
    await typeWord(page, first.word);
    await page.waitForTimeout(120);
    const exposures = (await state(page)).bookExposures;
    expect(exposures).toBeGreaterThan(0);

    for (let i = 0; i < 3; i += 1) {
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
    expect(restarted.hull).toBe(3); // AC-4.1: hull is full at stage start
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

    const result = (await page.evaluate(async ([plateUrl, stageUrl]) => {
      const plate = (await import(plateUrl as string)) as {
        contrastRatio: (a: string, b: string) => number;
      };
      const stage = (await import(stageUrl as string)) as {
        allPalettes: () => [string, { plate: string; plateText: string }][];
      };
      const rows = stage.allPalettes().map(([stop, p]) => ({
        stop,
        ratio: plate.contrastRatio(p.plate, p.plateText),
      }));
      return {
        rows,
        minRatio: Math.min(...rows.map((r) => r.ratio)),
      };
    }, [PLATE_MODULE, STAGE_MODULE] as const)) as {
      rows: { stop: string; ratio: number }[];
      minRatio: number;
    };

    expect(result.rows.length).toBe(7);
    expect(result.minRatio).toBeGreaterThanOrEqual(4.5);
    writeEvidence("contrast.json", {
      minRatio: Number(result.minRatio.toFixed(2)),
      perStop: Object.fromEntries(
        result.rows.map((r) => [r.stop, Number(r.ratio.toFixed(2))]),
      ),
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

  test("V-22.4 / AC-22.4: the flight frame still reads when desaturated", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await bootFlight(page, {
      pixelReadback: true,
      knobs: { maxLive: 4 },
      stageWordCount: 40,
    });
    await page.waitForTimeout(2200);

    const contours = (await page.evaluate(() => {
      const canvas = document.querySelector("canvas") as HTMLCanvasElement;
      const W = 240;
      const H = 135;
      const off = document.createElement("canvas");
      off.width = W;
      off.height = H;
      const ctx = off.getContext("2d") as CanvasRenderingContext2D;
      ctx.drawImage(canvas, 0, 0, W, H);
      const { data } = ctx.getImageData(0, 0, W, H);

      // Desaturate.
      const grey = new Uint8Array(W * H);
      for (let i = 0; i < grey.length; i += 1) {
        const r = data[i * 4] as number;
        const g = data[i * 4 + 1] as number;
        const b = data[i * 4 + 2] as number;
        grey[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      }

      // Otsu threshold: the value that best separates light from dark, which
      // is what "does the silhouette still read" means with the colour gone.
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

      // Count connected regions of each class. A frame that reads has a
      // handful of separable shapes; a flat frame has one, and noise has
      // hundreds.
      const labels = new Int32Array(W * H).fill(-1);
      const minArea = 12;
      let contourCount = 0;
      const stack: number[] = [];
      for (let start = 0; start < W * H; start += 1) {
        if (labels[start] !== -1) continue;
        const cls = (grey[start] as number) > threshold ? 1 : 0;
        let area = 0;
        stack.length = 0;
        stack.push(start);
        labels[start] = cls;
        while (stack.length > 0) {
          const p = stack.pop() as number;
          area += 1;
          const x = p % W;
          const y = (p - x) / W;
          const neighbours = [
            x > 0 ? p - 1 : -1,
            x < W - 1 ? p + 1 : -1,
            y > 0 ? p - W : -1,
            y < H - 1 ? p + W : -1,
          ];
          for (const q of neighbours) {
            if (q < 0) continue;
            if (labels[q] !== -1) continue;
            const qc = (grey[q] as number) > threshold ? 1 : 0;
            if (qc !== cls) continue;
            labels[q] = cls;
            stack.push(q);
          }
        }
        if (area >= minArea) contourCount += 1;
      }
      return contourCount;
    })) as number;

    writeEvidence("desaturated-contours.json", { contours });
    expect(contours).toBeGreaterThanOrEqual(3);
    expect(contours).toBeLessThanOrEqual(60);
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

    writeEvidence("parallax-overlay.json", {
      movingLayers: distinct,
      observed: Object.fromEntries(rates),
    });
    expect(distinct).toBeGreaterThanOrEqual(5);
  });
});

