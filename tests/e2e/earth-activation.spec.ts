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

test.describe("UR-17: the instruction leaves when it stops being true", () => {
  /**
   * THE SAME 120 s THE BLOCK ABOVE TAKES, AND FOR THE SAME REASON.
   *
   * This block was on Playwright's 30 s default while its sibling - which drives
   * the same screen through the same typed word - had `test.setTimeout(120_000)`
   * with a comment explaining that headless Chromium renders this scene in
   * software at about a quarter of real time. Alone this test takes 12.8 s. In a
   * 26-test run on one worker it took 34 s and reported:
   *
   *   Test timeout of 30000ms exceeded.
   *
   * which reads exactly like the collision assertion failing and is not
   * (coding-standards rule 9: an error message is not a measurement - the two
   * controls here were the same test alone at 12.8 s and under load at 34 s).
   * Nothing about the screen changed; one of two blocks driving it simply never
   * got the head-room the other one documented.
   */
  test.setTimeout(120_000);

  /**
   * UR-17, caught in play and attached as a screenshot: "the beacon is lit."
   * drawn ON TOP of "type launch to wake the beacon", both at GAME_HEIGHT * 0.76. no-user-quotes-ok: both strings are shipped game copy (`earth.lit` / `earth.typePrompt` in src/content/en/ui.json), quoted here because the defect IS which two strings collide
   *
   * The instruction was a LOCAL, so nothing could reach it to remove it — the
   * overlap was structurally guaranteed rather than a timing accident.
   *
   * It had also been reported hours earlier by an automated playthrough, in
   * almost those words, and was filed without being assigned. So this test is
   * not only a regression guard for one scene; it is the thing that should have
   * existed the first time it was found.
   *
   * The assertion is deliberately about OVERLAP rather than about one string:
   * any two visible texts sharing a line is the defect, whatever they say.
   */
  test("no two visible texts occupy the same line once the beacon is lit", async ({
    page,
  }) => {
    await mount(page, KEY);
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
    // Past litText's 650ms delay and its 520ms fade, so both are settled.
    await page.waitForTimeout(1600);

    const collisions = await page.evaluate((k) => {
      const scene = window.__kb?.game.scene.getScene(k) as unknown as {
        children: { list: unknown[] };
      };
      const texts = scene.children.list.filter(
        (o): o is { text: string; alpha: number; visible: boolean; getBounds: () => DOMRect } =>
          typeof (o as { text?: unknown }).text === "string" &&
          (o as { text: string }).text.trim().length > 0 &&
          (o as { visible: boolean }).visible === true &&
          (o as { alpha: number }).alpha > 0.05,
      );
      const hits: string[] = [];
      for (let i = 0; i < texts.length; i++) {
        for (let j = i + 1; j < texts.length; j++) {
          const a = texts[i]!.getBounds();
          const b = texts[j]!.getBounds();
          const overlaps =
            a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
          if (overlaps) hits.push(`"${texts[i]!.text}" over "${texts[j]!.text}"`);
        }
      }
      return hits;
    }, KEY);

    expect(collisions, `overlapping text: ${collisions.join("; ")}`).toEqual([]);
  });
});
