import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Shadow's reference-compare evidence (D91, AC-25.1/25.2, rubric item R-shadow).
 *
 * R-shadow in `tests/gauntlet/rubric.mjs` looks for exactly
 * `gauntlet/evidence/shadow-render.png` and then REFUSES to auto-pass: the
 * judge places it beside `design-reference/refs/shadow-sheet.png` and either
 * calls the match or lists concrete differences. So this test's job is to hand
 * the judge the fairest possible comparison:
 *
 *   - Shadow alone, nothing else on screen, no UI, no scene chrome;
 *   - one large figure for silhouette, proportion and detail, plus all six
 *     poses big enough to read, so AC-25.2 is visible in the same image;
 *   - a TRANSPARENT background, not a coloured field. A field either flatters
 *     or fights the figure depending on what it is, and the same PNG feeds the
 *     desaturated-silhouette comparison later, where a background would be
 *     counted as part of the shape.
 *
 * WHY A SECOND Phaser.Game. `bootGame` builds its context with
 * `transparent: false`, so that canvas has no alpha channel and can never
 * screenshot transparent; `game.config` is read at construction, so there is
 * nothing to toggle afterwards. A second game with `transparent: true` is the
 * only way to get an alpha-backed canvas, and Phaser's constructor is
 * reachable through the booted game without importing Phaser into a Node file.
 *
 * The scene is built here, in the test, rather than shipped: a pose sheet is
 * evidence, not a screen, and it has no screen-inventory row (D78).
 */

const HERE = dirname(fileURLToPath(import.meta.url));

const EVIDENCE = resolve(HERE, "../../gauntlet/evidence");

/** Served by the Vite dev server; resolved in the browser, never by tsc. */
const SHADOW_MODULE = "/src/game/render/shadow.ts";

const SHEET_W = 1920;
const SHEET_H = 1080;

test("R-shadow / AC-25.2 renders all six poses and writes shadow-render.png", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/?scene=Title");
  await page.waitForFunction(() => window.__kb !== undefined, null, { timeout: 20_000 });

  const poses = await page.evaluate(
    async ({ modPath, w, h }) => {
      // The specifier is a variable so TypeScript treats it as an opaque
      // runtime path: it is a Vite dev-server URL, not a module tsc can see.
      const mod = (await import(/* @vite-ignore */ modPath)) as {
        drawShadow: (
          scene: unknown,
          x: number,
          y: number,
          pose: string,
          opts?: Record<string, unknown>,
        ) => { update(t: number): void };
        SHADOW_POSES: string[];
      };
      const kb = window.__kb as unknown as {
        game: {
          constructor: new (config: unknown) => unknown;
          scene: { getScenes(active: boolean): { scene: { stop(): void } }[] };
          canvas: HTMLCanvasElement;
        };
      };

      // Quiet the real game and clear the page, so nothing but the sheet is
      // captured and omitBackground has a transparent page to work with.
      for (const active of kb.game.scene.getScenes(true)) active.scene.stop();
      kb.game.canvas.style.display = "none";
      document.documentElement.style.background = "transparent";
      document.body.style.background = "transparent";

      const host = document.createElement("div");
      host.id = "shadow-sheet";
      host.style.cssText = "position:fixed;inset:0;background:transparent";
      document.body.appendChild(host);

      const figures: { update(t: number): void }[] = [];
      const Game = kb.game.constructor;
      const sheet = new Game({
        // Phaser.AUTO is 0; the enum is not reachable without importing Phaser.
        type: 0,
        width: w,
        height: h,
        parent: host.id,
        transparent: true,
        antialias: true,
        scene: {
          create(this: unknown) {
            // The hero: one Shadow, large, for silhouette and detail.
            figures.push(mod.drawShadow(this, w * 0.5, h * 0.3, "idle", { scale: 2.5 }));
            // The six poses, in the sheet's own order, big enough to read.
            const n = mod.SHADOW_POSES.length;
            mod.SHADOW_POSES.forEach((pose, i) => {
              const x = (w / (n + 1)) * (i + 1);
              figures.push(mod.drawShadow(this, x, h * 0.78, pose, { scale: 1.3 }));
            });
          },
          update(time: number) {
            // FROZEN_AT is set by the test before the screenshot. Shadow's
            // hover bob and face-plate pulse are clock-driven, so a capture
            // taken at wall-clock "whenever" lands on an arbitrary phase and
            // the render differs every run. That made the judge verdict go
            // stale on renders where the ART had not changed at all - which
            // trains a judge to re-approve without looking.
            const frozen = (window as unknown as Record<string, unknown>)["__kbFrozenAt"];
            for (const f of figures) f.update(typeof frozen === "number" ? frozen : time);
          },
        },
      });
      (window as unknown as Record<string, unknown>)["__kbSheet"] = sheet;
      return mod.SHADOW_POSES;
    },
    { modPath: SHADOW_MODULE, w: SHEET_W, h: SHEET_H },
  );

  // AC-25.2: six poses, and the sheet's bottom-row colourways are not among
  // them - the module exports one palette and takes no colour argument.
  expect(poses).toEqual([
    "idle",
    "pointing",
    "cheering",
    "worried",
    "asleep",
    "saluting",
  ]);

  const canvas = page.locator("#shadow-sheet canvas");
  await canvas.waitFor({ state: "visible", timeout: 20_000 });

  // Pin the animation phase before capturing. A reference compare should be a
  // controlled still, not a live frame: the verdict in judge-verdicts.json is
  // bound to this file, so a phase-dependent capture expires the verdict on
  // every run whether or not the art moved.
  //
  // 1400 is an arbitrary but FIXED point in the bob/pulse cycle, chosen once.
  const FROZEN_AT = 1400;
  await page.evaluate((t) => {
    (window as unknown as Record<string, unknown>)["__kbFrozenAt"] = t;
  }, FROZEN_AT);
  // Two rendered frames so the frozen phase is definitely what is on screen.
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );

  mkdirSync(EVIDENCE, { recursive: true });
  await canvas.screenshot({
    path: `${EVIDENCE}/shadow-render.png`,
    omitBackground: true,
  });
});
