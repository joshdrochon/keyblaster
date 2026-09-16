import { type Page, expect, test } from "@playwright/test";
import {
  assertNoEmailField,
  assertVisibleFocus,
  dialog,
  focusItem,
  item,
  press,
  screen,
  seed,
  snapshot,
  toasts,
} from "./lib/menus";

/**
 * Screen inventory row 13 - Pause (flight paused, quit confirm) and Toasts.
 *
 * WHAT "ASTEROIDS FREEZE" IS TESTED AGAINST. Pause freezes the scene underneath
 * by pausing its update loop; the belt stopping is a consequence of that, not a
 * separate mechanism. The flight lane's scene is not on disk in this lane's
 * working tree, so these tests open the pause overlay over a scene that IS, and
 * assert the underlying scene is paused, resumed and stopped at the right
 * moments. That is the whole contract PauseScene owns - what is underneath is
 * the flight lane's to render.
 */

const PAUSE = "Pause";
const BELOW = "BeaconLog";

/** Launch the pause overlay over a live scene, the way Flight's Esc will. */
async function pauseOver(page: Page, below: string): Promise<void> {
  await page.evaluate((key) => {
    (window as any).__kb.game.scene.launch("Pause", { from: key });
  }, below);
  await screen(page, PAUSE).waitFor({ state: "attached" });
  await page.waitForTimeout(120);
}

test.describe("row 13 - pause", () => {
  test("the scene underneath freezes while the overlay is up", async ({
    page,
  }) => {
    await seed(page, [{ name: "Ana" }], BELOW);
    await pauseOver(page, BELOW);

    const snap = await snapshot(page, PAUSE);
    expect(snap["from"]).toBe(BELOW);
    expect(snap["frozen"]).toBe(true);
    expect(snap["belowPaused"]).toBe(true);

    // It is a PAUSE, not a stop: what was underneath is still on screen.
    await expect(screen(page, BELOW)).toHaveCount(1);
  });

  test("Resume / Settings / Quit to map, in that order", async ({ page }) => {
    await seed(page, [{ name: "Ana" }], BELOW);
    await pauseOver(page, BELOW);

    await expect(item(page, PAUSE, "pause.resume")).toHaveCount(1);
    await expect(item(page, PAUSE, "pause.settings")).toHaveCount(1);
    await expect(item(page, PAUSE, "pause.quit")).toHaveCount(1);
    await expect(screen(page, PAUSE)).toHaveAttribute("data-item-count", "3");
  });

  test("AC-18.1 keyboard only, with a visible focus state", async ({ page }) => {
    await seed(page, [{ name: "Ana" }], BELOW);
    await pauseOver(page, BELOW);
    await assertVisibleFocus(page, PAUSE);

    const first = await screen(page, PAUSE).getAttribute("data-focus");
    await press(page, "ArrowDown");
    expect(await screen(page, PAUSE).getAttribute("data-focus")).not.toBe(first);
    await assertVisibleFocus(page, PAUSE);
  });

  test("Resume un-freezes what was underneath and closes the overlay", async ({
    page,
  }) => {
    await seed(page, [{ name: "Ana" }], BELOW);
    await pauseOver(page, BELOW);

    await focusItem(page, PAUSE, "pause.resume");
    await press(page, "Enter");
    await screen(page, PAUSE).waitFor({ state: "detached" });

    const paused = await page.evaluate(
      (key) => (window as any).__kb.game.scene.isPaused(key) as boolean,
      BELOW,
    );
    expect(paused).toBe(false);
    await expect(screen(page, BELOW)).toHaveCount(1);
  });

  test("Esc on the pause menu is Resume", async ({ page }) => {
    await seed(page, [{ name: "Ana" }], BELOW);
    await pauseOver(page, BELOW);
    await press(page, "Escape");
    await screen(page, PAUSE).waitFor({ state: "detached" });
    const paused = await page.evaluate(
      (key) => (window as any).__kb.game.scene.isPaused(key) as boolean,
      BELOW,
    );
    expect(paused).toBe(false);
  });

  test("quit asks once, in the game, never in a browser dialog", async ({
    page,
  }) => {
    await seed(page, [{ name: "Ana" }], BELOW);
    let browserDialogs = 0;
    page.on("dialog", (d) => {
      browserDialogs += 1;
      void d.dismiss();
    });
    await pauseOver(page, BELOW);

    await focusItem(page, PAUSE, "pause.quit");
    await press(page, "Enter");

    await expect(dialog(page, PAUSE)).toHaveCount(1);
    await expect(dialog(page, PAUSE)).toContainText("quit to the map");
    expect(browserDialogs).toBe(0);
    // The safe answer has focus: Enter on reflex keeps you flying.
    expect(await screen(page, PAUSE).getAttribute("data-focus")).toBe(
      "dialog.cancel",
    );
  });

  test("quit confirm: cancelling returns to the paused belt", async ({ page }) => {
    await seed(page, [{ name: "Ana" }], BELOW);
    await pauseOver(page, BELOW);
    await focusItem(page, PAUSE, "pause.quit");
    await press(page, "Enter");
    await expect(dialog(page, PAUSE)).toHaveCount(1);

    await press(page, "Escape");
    await expect(dialog(page, PAUSE)).toHaveCount(0);
    await expect(screen(page, PAUSE)).toHaveCount(1);
    expect((await snapshot(page, PAUSE))["belowPaused"]).toBe(true);
  });

  test("quit confirm: confirming stops the belt and leaves the overlay", async ({
    page,
  }) => {
    await seed(page, [{ name: "Ana" }], BELOW);
    await pauseOver(page, BELOW);
    await focusItem(page, PAUSE, "pause.quit");
    await press(page, "Enter");
    await press(page, "ArrowDown");
    await press(page, "Enter");
    await page.waitForTimeout(150);

    await screen(page, PAUSE).waitFor({ state: "detached" });
    const active = await page.evaluate(
      (key) => (window as any).__kb.game.scene.isActive(key) as boolean,
      BELOW,
    );
    expect(active).toBe(false);
  });

  test("Settings opens over the pause and Esc comes back to it", async ({
    page,
  }) => {
    await seed(page, [{ name: "Ana" }], BELOW);
    await pauseOver(page, BELOW);

    await focusItem(page, PAUSE, "pause.settings");
    await press(page, "Enter");
    await screen(page, "Settings").waitFor({ state: "attached" });
    // The belt stays frozen the whole time.
    const paused = await page.evaluate(
      (key) => (window as any).__kb.game.scene.isPaused(key) as boolean,
      BELOW,
    );
    expect(paused).toBe(true);

    await press(page, "Escape");
    await screen(page, PAUSE).waitFor({ state: "attached" });
    await assertVisibleFocus(page, PAUSE);
  });

  test("AC-18.2 no email field exists on the pause overlay", async ({ page }) => {
    await seed(page, [{ name: "Ana" }], BELOW);
    await pauseOver(page, BELOW);
    await assertNoEmailField(page);
  });
});

test.describe("row 13 - unlock toasts", () => {
  test("a trophy toast is brief, celebratory and non-blocking", async ({
    page,
  }) => {
    await seed(page, [{ name: "Ana" }], BELOW);
    const focusBefore = await screen(page, BELOW).getAttribute("data-focus");

    await page.evaluate(() => {
      (window as any).__kb.game.scene
        .getScene("BeaconLog")
        .raiseToast("trophy earned — first light");
    });
    await expect(toasts(page)).toHaveCount(1);
    await expect(toasts(page).first()).toContainText("first light");

    // Non-blocking: focus did not move, no dialog opened, the screen still works.
    expect(await screen(page, BELOW).getAttribute("data-focus")).toBe(focusBefore);
    await expect(dialog(page, BELOW)).toHaveCount(0);
    await press(page, "ArrowDown");
    await assertVisibleFocus(page, BELOW);

    // Brief: it leaves on its own.
    await expect(toasts(page)).toHaveCount(0, { timeout: 8000 });
  });

  test("a skin toast stacks under a trophy toast", async ({ page }) => {
    await seed(page, [{ name: "Ana" }], BELOW);
    await page.evaluate(() => {
      const scene = (window as any).__kb.game.scene.getScene("BeaconLog");
      scene.raiseToast("trophy earned — pathfinder");
      scene.raiseToast("new skin — dawn trim");
    });
    await expect(toasts(page)).toHaveCount(2);
    await expect(toasts(page).nth(1)).toContainText("dawn trim");
  });
});
