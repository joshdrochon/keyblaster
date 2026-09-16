import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  expectNoPunishment,
  mount,
  snapshot,
  transitions,
  typeWord,
} from "./story-lane";

/**
 * Screen inventory row 2b - Earth activation (D57).
 *
 * ACs covered: AC-12.1 (typing `launch` activates Earth's beacon and advances
 * to the Director map), AC-18.1 (keyboard alone, visible focus), AC-22b.1
 * (nothing reads as punishment), AC-14.3 (copy comes from content, not code).
 */

const HERE = dirname(fileURLToPath(import.meta.url));

const KEY = "EarthActivation";

const bundle = JSON.parse(
  readFileSync(resolve(HERE, "../../src/content/en/earth.json"), "utf8"),
) as { activationWord: string; preflightLine: string };

test.describe("Earth activation (row 2b, D57)", () => {
  // Phaser's clock advances with the SMOOTHED frame delta, and headless
  // Chromium renders a 1920x1080 WebGL scene in software at ~15 fps. In-game
  // time therefore runs at roughly a quarter of wall time, so every wait here
  // is on a game-state condition with generous head-room, never on a sleep.
  test.setTimeout(120_000);

  test("AC-12.1 the beacon starts dark, one word lights it, and the map opens", async ({
    page,
  }) => {
    await mount(page, KEY);

    const before = await snapshot(page, KEY);
    expect(before.beaconLit).toBe(false);
    expect(before.activationWord).toBe(bundle.activationWord);
    // The dark state is stated in words, not implied by a colour.
    expect(before.text.join(" ")).toContain("offline");

    await typeWord(page, bundle.activationWord);

    await page.waitForFunction(
      (k) => {
        const s = window.__kb?.game.scene.getScene(k) as
          | { snapshot: () => { beaconLit: boolean } }
          | null;
        return s?.snapshot().beaconLit === true;
      },
      KEY,
      { timeout: 30_000 },
    );

    const lit = await snapshot(page, KEY);
    expect(lit.beaconLit).toBe(true);
    expect(lit.typed).toBe(bundle.activationWord);
    expect(lit.text.join(" ")).toContain("online");

    // AC-12.1's second half: it advances to the Director map.
    await page.waitForFunction(
      (k) => {
        const s = window.__kb?.game.scene.getScene(k) as
          | { snapshot: () => { canContinue: boolean } }
          | null;
        return s?.snapshot().canContinue === true;
      },
      KEY,
      { timeout: 30_000 },
    );
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => {
      const s = window.__kb?.game.scene.getScene("DirectorMap") as
        | { scene: { isActive(): boolean } }
        | null;
      return s?.scene.isActive() === true;
    }, null, { timeout: 10_000 });
    expect(await transitions(page)).toContain("DirectorMap");
  });

  test("AC-18.1 the screen is operable by keyboard alone with a visible focus state", async ({
    page,
  }) => {
    await mount(page, KEY);
    await typeWord(page, bundle.activationWord);
    await page.waitForFunction(
      (k) => {
        const s = window.__kb?.game.scene.getScene(k) as
          | { snapshot: () => { canContinue: boolean } }
          | null;
        return s?.snapshot().canContinue === true;
      },
      KEY,
      { timeout: 30_000 },
    );
    const after = await snapshot(page, KEY);
    // A focused target is what the ring is drawn around; there is exactly one
    // action on this screen and the keyboard already owns it.
    expect(after.focusId).toBe("continue");
  });

  test("AC-22b.1 a key that is not the next letter produces no failure state", async ({
    page,
  }) => {
    await mount(page, KEY);
    // "q" cannot start `launch`; the engine reports it and the scene nudges.
    await page.keyboard.press("q");
    await page.waitForTimeout(250);

    const after = await snapshot(page, KEY);
    expect(after.typed).toBe("");
    expect(after.beaconLit).toBe(false);
    expectNoPunishment(after.text);

    // And the word still completes normally afterwards: the lock was never lost.
    await typeWord(page, bundle.activationWord);
    await page.waitForFunction(
      (k) => {
        const s = window.__kb?.game.scene.getScene(k) as
          | { snapshot: () => { beaconLit: boolean } }
          | null;
        return s?.snapshot().beaconLit === true;
      },
      KEY,
      { timeout: 30_000 },
    );
  });

  test("AC-14.3 Shadow's line is content, not a literal in the scene", async ({ page }) => {
    await mount(page, KEY);
    const s = await snapshot(page, KEY);
    expect(s.text.join(" ")).toContain(bundle.preflightLine);
  });
});
