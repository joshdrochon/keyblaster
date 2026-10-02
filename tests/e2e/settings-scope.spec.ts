import { expect, test } from "@playwright/test";
import { mount, snapshot } from "./story-lane";

/**
 * D108: the Settings screen shows the half that belongs to where it was opened.
 *
 * THE DEFECT THIS EXISTS FOR: Phaser reuses the scene instance, and `init` only
 * assigned `returnTo` when one was passed. Opening from the Title set it, and
 * the map - which passes none - inherited it, so the map's Settings drew the
 * DEVICE half. A single capture of each route passes; only the SEQUENCE fails.
 */
test.describe("D108: settings scope follows the opener, every time", () => {
  const DEVICE = ["settings.music", "settings.sfx", "settings.keyboardLayout",
    "settings.reducedMotion", "settings.colorblind"];
  const PILOT = ["settings.dashColor", "settings.avatar", "settings.letterCase",
    "settings.letterSpacing"];

  const scopeOf = async (page: import("@playwright/test").Page) => {
    const s = await snapshot(page, "Settings");
    return { scope: s["scope"] as string, rows: (s["rowIds"] as string[]) ?? [] };
  };

  test("from the Title: the machine's settings, named for nobody", async ({ page }) => {
    await mount(page, "Settings", { returnTo: "Title" } as never);
    const { scope, rows } = await scopeOf(page);
    expect(scope).toBe("device");
    for (const id of DEVICE) expect(rows, `${id} missing`).toContain(id);
    for (const id of PILOT) expect(rows, `${id} should not be here`).not.toContain(id);
  });

  test("from the map: the pilot's, named for them", async ({ page }) => {
    await mount(page, "Settings", { returnTo: "DirectorMap" } as never);
    const { scope, rows } = await scopeOf(page);
    expect(scope).toBe("pilot");
    for (const id of PILOT) expect(rows, `${id} missing`).toContain(id);
    for (const id of DEVICE) expect(rows, `${id} should not be here`).not.toContain(id);
  });

  test("THE SEQUENCE: Title then map does not leave the Title's half behind", async ({ page }) => {
    await mount(page, "Settings", { returnTo: "Title" } as never);
    expect((await scopeOf(page)).scope).toBe("device");
    // Re-open from the map WITHOUT passing returnTo, exactly as the map does.
    await page.evaluate(() => {
      const kb = (window as unknown as { __kb: Record<string, unknown> }).__kb;
      const game = kb["game"] as { scene: { start(k: string, d?: unknown): void } };
      game.scene.start("Settings", {});
    });
    await page.waitForTimeout(900);
    const after = await scopeOf(page);
    expect(after.scope, "the map inherited the Title's half").toBe("pilot");
    expect(after.rows).toContain("settings.dashColor");
  });

  test("and back again: map then Title does not leave the pilot's half behind", async ({ page }) => {
    await mount(page, "Settings", { returnTo: "DirectorMap" } as never);
    expect((await scopeOf(page)).scope).toBe("pilot");
    await page.evaluate(() => {
      const kb = (window as unknown as { __kb: Record<string, unknown> }).__kb;
      const game = kb["game"] as { scene: { start(k: string, d?: unknown): void } };
      game.scene.start("Settings", { returnTo: "Title" });
    });
    await page.waitForTimeout(900);
    const after = await scopeOf(page);
    expect(after.scope).toBe("device");
    expect(after.rows).not.toContain("settings.dashColor");
  });
});
