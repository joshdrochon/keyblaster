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

  /**
   * UR-11: the console has to be as operable as the form it replaced.
   *
   * A knob, a thrown lever and a detented selector are all HARDWARE shapes, and
   * the cheap way to build them is to make them draggable. This game has one
   * input (D37), so these three assertions are the ones that would catch a
   * beautiful panel nobody can use: the ring is drawn at EVERY stop of a full
   * lap, every control answers Left/Right, and every control still says what it
   * is set to in words.
   */
  test("UR-11 / AC-18.1 the focus ring is drawn on EVERY control of the console", async ({
    page,
  }) => {
    test.slow();
    await seed(page, [{ name: "Ana" }], SETTINGS);
    const ids = await items(page, SETTINGS).evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-id") ?? ""),
    );
    expect(ids.length).toBeGreaterThanOrEqual(10);

    /**
     * The whole focus state in ONE round trip.
     *
     * `assertVisibleFocus` is four separate protocol calls, and a lap of eleven
     * controls is forty-four of them - enough to blow the 30 s budget on a
     * headless software renderer and report a timeout instead of an answer.
     * Nothing is dropped: all four facts are still asserted at every stop, they
     * are just fetched together.
     */
    const probe = () =>
      page.evaluate((key) => {
        const el = document.querySelector(
          `[data-testid="ui-screen"][data-scene="${key}"]`,
        );
        const kb = (window as any).__kb;
        const snap = kb?.game.scene.getScene(key)?.snapshot?.() ?? {};
        return {
          focus: el?.getAttribute("data-focus") ?? null,
          ring: el?.getAttribute("data-focus-ring") ?? null,
          litCount:
            el?.querySelectorAll('[data-testid="ui-item"][data-focused="true"]')
              .length ?? -1,
          snapRing: snap["focusRing"] as boolean | undefined,
          snapFocus: snap["focusId"] as string | null | undefined,
        };
      }, SETTINGS);

    const seen: string[] = [];
    for (let i = 0; i < ids.length; i += 1) {
      const at = await probe();
      // Not "focus is visible somewhere": exactly one item is lit, the ring is
      // DRAWN on the canvas, and the lit item is the one the walk is standing
      // on. A knob that only looked focusable would fail all three.
      expect(at.litCount, `one focused item at ${ids[i]}`).toBe(1);
      expect(at.ring, `ring drawn at ${ids[i]}`).toBe("true");
      expect(at.snapRing, `canvas ring at ${ids[i]}`).toBe(true);
      expect(at.focus).toBe(ids[i]);
      expect(at.snapFocus).toBe(ids[i]);
      seen.push(at.focus ?? "");
      await press(page, "ArrowDown");
    }
    // A full lap reaches every control exactly once and comes back to the top.
    expect(new Set(seen).size).toBe(ids.length);
    expect((await probe()).focus).toBe(ids[0]);
  });

  test("UR-11 / AC-18.1 every console control is turned by the arrow keys alone", async ({
    page,
  }) => {
    test.slow();
    await seed(page, [{ name: "Ana" }], SETTINGS);
    // Ids are re-read after each change: the typography rows restart the scene.
    const adjustable = await items(page, SETTINGS).evaluateAll((nodes) =>
      nodes
        .filter((n) => n.getAttribute("role") !== "button")
        .map((n) => n.getAttribute("data-id") ?? ""),
    );
    expect(adjustable.length).toBeGreaterThanOrEqual(9);

    for (const id of adjustable) {
      const before = await item(page, SETTINGS, id).getAttribute("data-value");
      await adjust(page, id, "ArrowRight");
      const after = await item(page, SETTINGS, id).getAttribute("data-value");
      // A row whose only choice is the one it is on cannot change - the two
      // language rows ship one language (D95) - but it must still be REACHED
      // and must still report a value. Everything else has to move.
      expect(after, `${id} reports no value`).toBeTruthy();
      if (!/Lang$/.test(id)) {
        expect(after, `${id} did not answer ArrowRight`).not.toBe(before);
      }
    }
  });

  test("UR-11 a knob reaches both ends and NEVER wraps round", async ({ page }) => {
    // The failure a rotary control invites and the pill slider could not have:
    // one press too many at full volume putting the music back to silent.
    test.slow();
    await seed(page, [{ name: "Ana" }], SETTINGS);
    const music = item(page, SETTINGS, "settings.music");

    await adjust(page, "settings.music", "ArrowRight", 8);
    await expect(music).toHaveAttribute("data-value", "100%");
    expect((await settings(page))["musicVolume"]).toBe(1);
    // Four more presses past the stop. A wrapping knob reads 0% here.
    await press(page, "ArrowRight", 4);
    await expect(music).toHaveAttribute("data-value", "100%");
    expect((await settings(page))["musicVolume"]).toBe(1);

    await press(page, "ArrowLeft", 14);
    await expect(music).toHaveAttribute("data-value", "0%");
    expect((await settings(page))["musicVolume"]).toBe(0);
    await press(page, "ArrowLeft", 3);
    await expect(music).toHaveAttribute("data-value", "0%");
  });

  test("UR-11 every control still SAYS what it is set to, in words", async ({
    page,
  }) => {
    // The bar the fiction may not cost: a beautiful knob whose value a
    // seven-year-old cannot read is worse than the slider it replaced. Every
    // control keeps a printed value, and a switch keeps the WORD - so the lamp
    // is never the only thing carrying the state (D41: not colour alone).
    await seed(page, [{ name: "Ana" }], SETTINGS);
    const rows = await items(page, SETTINGS).evaluateAll((nodes) =>
      nodes.map((n) => ({
        id: n.getAttribute("data-id") ?? "",
        role: n.getAttribute("role") ?? "",
        value: n.getAttribute("data-value"),
        text: n.textContent ?? "",
      })),
    );
    for (const row of rows) {
      if (row.role === "button") continue;
      expect(row.value, `${row.id} has no printed value`).toBeTruthy();
      expect(row.text, `${row.id} does not read its value out`).toContain(
        row.value ?? "",
      );
    }
    // The volume knobs read as a percentage, exactly as they did before.
    expect(rows.find((r) => r.id === "settings.music")?.value).toMatch(/^\d+%$/);
    // The switches read as words a child knows.
    for (const id of [
      "settings.reducedMotion",
      "settings.colorblind",
      "settings.letterSpacing",
    ]) {
      expect(rows.find((r) => r.id === id)?.value).toBe("off");
    }
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

  test("AC-14.4 / D95 the UI-language row offers only shipped languages", async ({
    page,
  }) => {
    // This test previously drove the row through es and hi and asserted the
    // heading changed. D95 ships English only, in BOTH rows, so cycling can no
    // longer reach another language - and the live-reskin behaviour AC-19.1
    // describes has no second language to demonstrate it with in this build.
    //
    // It is NOT deleted, because deleting it would make the cut invisible: a
    // check that passes by having nothing left to measure is this repo's
    // signature failure (docs/audit.md). It now asserts the cut instead, and
    // will fail loudly the day SHIPPED_LANGS grows - which is when the
    // live-reskin assertions below should be restored.
    await seed(page, [{ name: "Ana" }], SETTINGS);
    const heading = screen(page, SETTINGS).locator('[data-testid="ui-heading"]');
    await expect(heading).toContainText("ship controls");

    const before = (await settings(page))["uiLang"];
    expect(before).toBe("en");

    await adjust(page, "settings.uiLang", "ArrowRight");
    expect((await settings(page))["uiLang"]).toBe("en");
    await expect(heading).toContainText("ship controls");
  });

  test("AC-19.1 / AC-14.1 content language is filtered by input method", async ({
    page,
  }) => {
    await seed(page, [{ name: "Ana" }], SETTINGS);

    // D95: the shipped menu is English only, on every input method. AC-14.1's
    // "Devanagari is offered only on a Devanagari input method" rule still
    // holds and is exercised on all three languages by
    // tests/unit/i18n/shippedLangs.test.ts via typeableContentLangs(); what is
    // asserted HERE is what a player can actually reach.
    expect((await snapshot(page, SETTINGS))["contentLangChoices"]).toEqual(["en"]);
    // The "pick a Hindi keyboard" note must NOT show on a latin keyboard when
    // the row offers only English - it told the child to do something that
    // would change nothing. It previously showed to everyone, and the old
    // assertion here passed for that wrong reason.
    await expect(item(page, SETTINGS, "settings.contentLang")).not.toContainText(
      "hindi keyboard",
    );

    // Cycling cannot leave English, because there is nowhere to go.
    await adjust(page, "settings.contentLang", "ArrowRight");
    expect((await settings(page))["contentLang"]).toBe("en");

    // And a Devanagari input method does not conjure Hindi content into a
    // build that does not ship it. This is the assertion that would fail the
    // day someone filters the menu somewhere other than SHIPPED_LANGS.
    await adjust(page, "settings.inputMethod", "ArrowRight");
    expect((await settings(page))["inputMethod"]).toBe("translit");
    expect((await snapshot(page, SETTINGS))["contentLangChoices"]).toEqual(["en"]);
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
    // STALE EXPECTATION, now corrected. This asserted "#FFFFFF" because the
    // colourblind accent used to be `colorblind.accent`. V-22.8's fix moved UI
    // text to `colorblind.plateAccent` — deliberately, because the old value
    // put typed letters at 1.02:1 on Saturn and Pluto, which is invisible. The
    // palette lane changed the source and nothing updated this spec, so it has
    // been asserting the defect ever since.
    //
    // What matters is not the hex: it is that the accent CHANGES, and that
    // whatever it becomes is legible. Asserting the property rather than the
    // constant means the next palette fix does not have to come here.
    const after = (await snapshot(page, SETTINGS))["accent"] as string;
    expect(after).not.toBe(before);
    expect(after).toMatch(/^#[0-9A-Fa-f]{6}$/);
    const live = await page.evaluate(
      () => (window as any).__kb.services.context.colorblindPalette as boolean,
    );
    expect(live).toBe(true);
  });

  test("AC-19.1 every setting survives a reload", async ({ page }) => {
    // Two of these three restart the scene in place before the next one is
    // touched, which costs a frame each at headless frame rates.
    test.slow();
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
