import { expect, test } from "@playwright/test";
import { activeScenes, freezeReloads, settle, waitForScene } from "./support/lane.js";
import { mount } from "./story-lane.js";

/**
 * ONE PLACE AT A TIME.
 *
 * `ScenePlugin.start` stops the scene that CALLED it and nothing else, so any
 * screen left by another route simply keeps running, invisible under whatever
 * is drawn next - still updating, still holding the keyboard. A real
 * playthrough found two of them: `["Briefing","Flight","Hud"]` after Results ->
 * "fly it again", and `["Preflight","Flight","Settings","Hud"]` on opening
 * Settings from the pause menu, where the Settings panel answered nothing
 * because a leaked scene underneath was eating Left, Right and Tab.
 *
 * The HUD half is reproduced directly below: nothing in the game stopped it
 * except the warp break and the stall restart, so quitting to the map left the
 * readouts drawn over the Director map. The other half is a transition-time
 * invariant - whatever made a scene stale, the next transition ends it - and is
 * asserted against a leak this spec induces, because a backstop that is only
 * tested by the bug it backstops is a backstop nobody can test.
 */

test.describe.configure({ mode: "default", timeout: 300_000 });

async function toFlight(page: import("@playwright/test").Page): Promise<void> {
  await freezeReloads(page);
  await mount(page, "Preflight", { stopId: "mars" });
  await waitForScene(page, "Flight", 120_000);
  await settle(page, 1200);
}

/** Pause -> the Nth menu row (Resume, Settings, Quit). */
async function pauseAndChoose(
  page: import("@playwright/test").Page,
  index: number,
): Promise<void> {
  await page.keyboard.press("Escape");
  await settle(page, 900);
  expect(await activeScenes(page), "Escape did not open the pause menu").toContain("Pause");
  for (let i = 0; i < index; i += 1) {
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(220);
  }
  await page.keyboard.press("Enter");
  await settle(page, 900);
}

test("the HUD does not outlive the belt it belongs to", async ({ page }) => {
  await toFlight(page);
  expect(await activeScenes(page)).toEqual(expect.arrayContaining(["Flight", "Hud"]));

  // Quit to map. The confirm asks once, with "keep flying" focused (design
  // brief 13), so the quit answer is one step to the right.
  await pauseAndChoose(page, 2);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(220);
  await page.keyboard.press("Enter");
  await settle(page, 1400);

  const scenes = await activeScenes(page);
  expect(scenes, "the belt was quit but is still running").not.toContain("Flight");
  // THE DEFECT. `PauseScene.quitToMap` stops the belt and never the HUD, so the
  // wpm/score/hull readouts were still drawn on top of the Director map - and
  // on top of the Settings panel opened from there.
  expect(scenes, "the HUD is still drawn over the map").not.toContain("Hud");
});

test("opening Settings from the pause menu leaves nothing drawing over it", async ({
  page,
}) => {
  await toFlight(page);
  await pauseAndChoose(page, 1);
  const scenes = await activeScenes(page);
  expect(scenes, "Settings did not open").toContain("Settings");
  // Flight is PAUSED under the overlay on purpose - it is a pause, not an exit
  // - so it is correctly absent from the active list. The HUD was not.
  expect(scenes, "the HUD is drawn over the Settings panel").not.toContain("Hud");

  // And the panel has the keyboard: a leaked scene underneath is what made
  // Left / Right / Tab do nothing at all.
  const before = await page.evaluate(() => {
    const s = window.__kb?.game.scene.getScene("Settings") as
      | { snapshot?: () => { focusId?: string | null } }
      | null;
    return s?.snapshot?.().focusId ?? null;
  });
  await page.keyboard.press("Tab");
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => {
    const s = window.__kb?.game.scene.getScene("Settings") as
      | { snapshot?: () => { focusId?: string | null } }
      | null;
    return s?.snapshot?.().focusId ?? null;
  });
  expect(after, "Tab moved nothing on the Settings panel").not.toBe(before);
});

test("a stale place scene does not survive the next transition", async ({ page }) => {
  await toFlight(page);

  // Induce the leak. This is what every reported leak looked like from the
  // outside - a place scene running that nothing on screen belongs to - and
  // inducing it is the only way to assert the backstop without also asserting
  // whichever route happened to produce it that evening.
  await page.evaluate(() => {
    const game = window.__kb?.game as unknown as {
      scene: { launch(key: string, data?: unknown): void };
    };
    game.scene.launch("Briefing", { stopId: "mars" });
  });
  await settle(page, 900);
  expect(await activeScenes(page), "the leak was not induced").toContain("Briefing");

  // Now leave for a different place by a real, keyboard-driven route.
  await pauseAndChoose(page, 2);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(220);
  await page.keyboard.press("Enter");
  await settle(page, 1400);

  const scenes = await activeScenes(page);
  expect(scenes).toContain("DirectorMap");
  expect(scenes, "a stale place scene is still running under the map").not.toContain(
    "Briefing",
  );
  expect(scenes, "the belt is still running under the map").not.toContain("Flight");
  expect(scenes, "the HUD is still running under the map").not.toContain("Hud");
});
