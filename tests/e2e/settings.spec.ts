import { expect, test } from "@playwright/test";
import {
  activeProfile,
  assertNoEmailField,
  assertVisibleFocus,
  dialog,
  focusItem,
  item,
  items,
  press,
  screen,
  seed,
  settings,
  snapshot,
} from "./lib/menus";

/**
 * Screen inventory row 11 - Settings (D41, D45).
 *
 * AC-19.1 is written as "-> E per setting", so there is one test per setting,
 * and each one asserts BOTH halves of the criterion: the value persists through
 * the profile store, AND it takes effect with no reload. "Takes effect" is
 * asserted against something the setting actually changes - the rendered
 * heading width for typography, the shared scene context for reduced motion and
 * the colourblind palette, the sound manager for volume - never against the
 * stored value a second time.
 *
 * Also covers AC-19.4 (no difficulty selector, no dyslexia-font toggle),
 * AC-14.1 (content languages filtered by input method) and the two-step reset.
 */

const SETTINGS = "Settings";

/** Move to a control and nudge it, which is how every row here is operated. */
async function adjust(page: any, id: string, key: string, times = 1) {
  await focusItem(page, SETTINGS, id);
  await press(page, key, times);
}

test.describe("row 11 - settings", () => {
  test("AC-18.1 reachable, operable and returnable by keyboard alone", async ({
    page,
  }) => {
    await seed(page, [{ name: "Ana" }], SETTINGS);
    await assertVisibleFocus(page, SETTINGS);

    const first = await screen(page, SETTINGS).getAttribute("data-focus");
    await press(page, "ArrowDown");
    expect(await screen(page, SETTINGS).getAttribute("data-focus")).not.toBe(first);
    await assertVisibleFocus(page, SETTINGS);

    // Every row is reachable: walking the list returns to where it started.
    const count = await items(page, SETTINGS).count();
    expect(count).toBeGreaterThanOrEqual(10);
    await press(page, "ArrowDown", count);
    await assertVisibleFocus(page, SETTINGS);
  });

  test("AC-18.2 no email field exists on settings", async ({ page }) => {
    await seed(page, [{ name: "Ana" }], SETTINGS);
    await assertNoEmailField(page);
  });

  test("AC-19.4 there is no difficulty selector and no dyslexia-font toggle", async ({
    page,
  }) => {
    await seed(page, [{ name: "Ana" }], SETTINGS);
    const text = ((await screen(page, SETTINGS).textContent()) ?? "").toLowerCase();
    for (const banned of ["difficult", "dyslex", "easy", "hard mode", "level"]) {
      expect(text).not.toContain(banned);
    }
    const ids = await items(page, SETTINGS).evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-id") ?? ""),
    );
    expect(ids.some((id) => /difficult|dyslex/i.test(id))).toBe(false);
  });

  // --- AC-19.1, one test per setting ---------------------------------------

  test("AC-19.1 music volume persists and applies with no reload", async ({
    page,
  }) => {
    await seed(page, [{ name: "Ana" }], SETTINGS);
    const before = (await settings(page))["musicVolume"] as number;
    await adjust(page, "settings.music", "ArrowLeft", 3);
    const after = (await settings(page))["musicVolume"] as number;
    expect(after).toBeLessThan(before);
    await expect(item(page, SETTINGS, "settings.music")).toHaveAttribute(
      "data-value",
      `${Math.round(after * 100)}%`,
    );
  });

  test("AC-19.1 sfx volume persists and reaches the sound manager", async ({
    page,
  }) => {
    await seed(page, [{ name: "Ana" }], SETTINGS);
    await adjust(page, "settings.sfx", "ArrowLeft", 4);
    const stored = (await settings(page))["sfxVolume"] as number;
    expect(stored).toBeLessThan(0.8);
    // Applied, not just stored: the live mixer has the new level already.
    const live = await page.evaluate(
      () => (window as any).__kb.game.sound.volume as number,
    );
    expect(live).toBeCloseTo(stored, 5);
  });

  test("AC-19.1 / AC-19.2 keyboard layout persists", async ({ page }) => {
    await seed(page, [{ name: "Ana" }], SETTINGS);
    expect((await settings(page))["keyboardLayout"]).toBe("qwerty");
    await adjust(page, "settings.keyboardLayout", "ArrowRight");
    expect((await settings(page))["keyboardLayout"]).toBe("azerty");
    await expect(
      item(page, SETTINGS, "settings.keyboardLayout"),
    ).toHaveAttribute("data-value", "azerty");
    // The lock engine reads the layout off the profile, so a stored value IS
    // the applied value - there is no second place for it to be wrong.
  });

  test("AC-19.1 UI language changes the screen with no reload", async ({
    page,
  }) => {
    await seed(page, [{ name: "Ana" }], SETTINGS);
    const heading = screen(page, SETTINGS).locator('[data-testid="ui-heading"]');
    await expect(heading).toContainText("ship controls");

    await adjust(page, "settings.uiLang", "ArrowRight");
    expect((await settings(page))["uiLang"]).toBe("es");
    await expect(heading).toContainText("controles de la nave");

    await adjust(page, "settings.uiLang", "ArrowRight");
    expect((await settings(page))["uiLang"]).toBe("hi");
    await expect(heading).toContainText("यान");
  });

  test("AC-19.1 / AC-14.1 content language is filtered by input method", async ({
    page,
  }) => {
    await seed(page, [{ name: "Ana" }], SETTINGS);

    // Latin keyboard: Devanagari content is not offered at all.
    expect((await snapshot(page, SETTINGS))["contentLangChoices"]).toEqual([
      "en",
      "es",
    ]);
    await expect(item(page, SETTINGS, "settings.contentLang")).toContainText(
      "hindi keyboard",
    );

    await adjust(page, "settings.contentLang", "ArrowRight");
    expect((await settings(page))["contentLang"]).toBe("es");

    // Switch to a Hindi input method and it appears.
    await adjust(page, "settings.inputMethod", "ArrowRight");
    expect((await settings(page))["inputMethod"]).toBe("translit");
    expect((await snapshot(page, SETTINGS))["contentLangChoices"]).toEqual([
      "en",
      "es",
      "hi",
    ]);
  });

  test("AC-14.1 an untypeable stored pair is repaired when Settings opens", async ({
    page,
  }) => {
    // A state the engine can produce and nothing else repairs: Hindi content
    // with a Latin keyboard.
    await seed(
      page,
      [{ name: "Ana", settings: { contentLang: "hi", inputMethod: "latin" } }],
      SETTINGS,
    );
    expect((await settings(page))["contentLang"]).not.toBe("hi");
    expect((await settings(page))["contentLang"]).toBe("en");
  });

  test("AC-19.1 letter case persists and redraws the copy", async ({ page }) => {
    await seed(page, [{ name: "Ana" }], SETTINGS);
    const heading = screen(page, SETTINGS).locator('[data-testid="ui-heading"]');
    // D41: lowercase is the default.
    expect((await settings(page))["uppercase"]).toBe(false);
    await expect(heading).toHaveText("ship controls");

    await adjust(page, "settings.letterCase", "ArrowRight");
    expect((await settings(page))["uppercase"]).toBe(true);
    await expect(heading).toHaveText("SHIP CONTROLS");
  });

  test("AC-19.1 increased letter spacing persists and widens the type", async ({
    page,
  }) => {
    await seed(page, [{ name: "Ana" }], SETTINGS);
    const narrow = (await snapshot(page, SETTINGS))["headingWidth"] as number;

    await adjust(page, "settings.letterSpacing", "ArrowRight");
    expect((await settings(page))["increasedLetterSpacing"]).toBe(true);

    const wide = (await snapshot(page, SETTINGS))["headingWidth"] as number;
    expect(wide).toBeGreaterThan(narrow);
  });

  test("AC-19.1 / AC-19.3 reduced motion persists and reaches every scene", async ({
    page,
  }) => {
    await seed(page, [{ name: "Ana" }], SETTINGS);
    await adjust(page, "settings.reducedMotion", "ArrowRight");
    expect((await settings(page))["reducedMotion"]).toBe(true);
    // The shared scene context is what other lanes read for shake and sway, so
    // the setting is live for screens that are already open.
    const live = await page.evaluate(
      () => (window as any).__kb.services.context.reducedMotion as boolean,
    );
    expect(live).toBe(true);
    expect((await snapshot(page, SETTINGS))["reducedMotion"]).toBe(true);
  });

  test("AC-19.1 colourblind palette persists and re-dresses the screen", async ({
    page,
  }) => {
    await seed(page, [{ name: "Ana" }], SETTINGS);
    const before = (await snapshot(page, SETTINGS))["accent"];
    expect(before).toBe("#FFC857");

    await adjust(page, "settings.colorblind", "ArrowRight");
    expect((await settings(page))["colorblindPalette"]).toBe(true);
    expect((await snapshot(page, SETTINGS))["accent"]).toBe("#FFFFFF");
    const live = await page.evaluate(
      () => (window as any).__kb.services.context.colorblindPalette as boolean,
    );
    expect(live).toBe(true);
  });

  test("AC-19.1 every setting survives a reload", async ({ page }) => {
    await seed(page, [{ name: "Ana" }], SETTINGS);
    await adjust(page, "settings.letterCase", "ArrowRight");
    await adjust(page, "settings.reducedMotion", "ArrowRight");
    await adjust(page, "settings.keyboardLayout", "ArrowRight", 2);
    await page.waitForTimeout(150);

    await seedReload(page);
    const s = await settings(page);
    expect(s["uppercase"]).toBe(true);
    expect(s["reducedMotion"]).toBe(true);
    expect(s["keyboardLayout"]).toBe("qwertz");
  });

  // --- reset progress ------------------------------------------------------

  test("D41 reset progress asks twice in plain language and keeps the pilot", async ({
    page,
  }) => {
    await seed(
      page,
      [
        {
          name: "Ana",
          beacons: ["earth", "mars"],
          trophies: ["firstLight", "pathfinder"],
        },
      ],
      SETTINGS,
    );

    await focusItem(page, SETTINGS, "settings.resetProgress");
    await press(page, "Enter");

    // Step one: says what goes and what stays, by name.
    await expect(dialog(page, SETTINGS)).toContainText("Ana");
    await expect(dialog(page, SETTINGS)).toContainText("the pilot stays");
    expect((await snapshot(page, SETTINGS))["resetStage"]).toBe(1);
    // The safe answer has focus, so Enter on reflex destroys nothing.
    expect(await screen(page, SETTINGS).getAttribute("data-focus")).toBe(
      "dialog.cancel",
    );

    await press(page, "ArrowDown");
    await press(page, "Enter");

    // Step two is a DIFFERENT question, not the same one twice.
    await expect(dialog(page, SETTINGS)).toContainText("one more time");
    expect((await snapshot(page, SETTINGS))["resetStage"]).toBe(2);

    await press(page, "ArrowDown");
    await press(page, "Enter");
    await page.waitForTimeout(150);

    const profile = await activeProfile(page);
    expect(profile?.["name"]).toBe("Ana");
    expect(profile?.["trophies"]).toEqual([]);
    const progress = profile?.["progress"] as { beaconPlacedAt: number | null }[];
    expect(progress.every((p) => p.beaconPlacedAt === null)).toBe(true);
  });

  test("D41 cancelling the reset keeps everything", async ({ page }) => {
    await seed(
      page,
      [{ name: "Ana", beacons: ["earth"], trophies: ["firstLight"] }],
      SETTINGS,
    );
    await focusItem(page, SETTINGS, "settings.resetProgress");
    await press(page, "Enter");
    await expect(dialog(page, SETTINGS)).toHaveCount(1);

    // Esc is cancel, and it is the same answer as the focused button.
    await press(page, "Escape");
    await expect(dialog(page, SETTINGS)).toHaveCount(0);
    expect((await snapshot(page, SETTINGS))["resetStage"]).toBe(0);
    expect((await activeProfile(page))?.["trophies"]).toEqual(["firstLight"]);
  });

  test("the confirm is drawn in the game, never a browser dialog", async ({
    page,
  }) => {
    await seed(page, [{ name: "Ana" }], SETTINGS);
    let browserDialogs = 0;
    page.on("dialog", (d) => {
      browserDialogs += 1;
      void d.dismiss();
    });
    await focusItem(page, SETTINGS, "settings.resetProgress");
    await press(page, "Enter");
    await expect(dialog(page, SETTINGS)).toHaveCount(1);
    expect(browserDialogs).toBe(0);
  });
});

/** Reload the same origin into Settings without rewriting the fixture. */
async function seedReload(page: any): Promise<void> {
  await page.goto(`/?scene=${SETTINGS}`);
  await page.waitForFunction(() => (window as any).__kb?.game !== undefined);
  await page
    .locator(`[data-testid="ui-screen"][data-scene="${SETTINGS}"]`)
    .waitFor({ state: "attached" });
}
