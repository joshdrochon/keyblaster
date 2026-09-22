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
  open,
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
    /**
     * Slow for the same reason as the three tests below it: a full lap of the
     * console is TWELVE real keystrokes, and this row has eleven controls.
     *
     * Measured from the trace of a failing full-suite run (three workers, each
     * driving a software-rendered WebGL game): every protocol round trip costs
     * 0.5-1.1s, so `press` is ~1.55s per key and the lap alone is ~18s of a
     * 30s budget - seed's two boots have already spent 5.5s of it. The test
     * needed ~33s and the clock stopped it at 30.
     *
     * The failure that produced is worth naming, because it cost a lane a day:
     * Playwright blamed whichever call was in flight when the budget ran out,
     * and reported `data-focus-ring` as `Received: ""`. That reads exactly like
     * "the console does not publish a focus ring" and is nothing of the kind -
     * `""` is what an unread attribute reports after `session closed`. The same
     * run timed out inside `page.evaluate` and blamed that instead.
     *
     * Two negative controls separate the two readings, because they look
     * identical in a report and mean opposite things:
     *  - force `data-focus-ring` to "false" in `publishMirror` -> the failure
     *    says `Received: "false"`. That is a ring that is not drawn.
     *  - leave the code alone and pass `--timeout=12000` -> the failure says
     *    `Received: ""`, at this line, on a quiet machine. That is a clock that
     *    ran out before the attribute was ever read.
     * The full-suite failures are the second one. The ring IS drawn and the
     * attribute IS published: a fresh boot of this scene reports
     * `data-focus-ring="true"`, `data-focus="settings.music"` and eleven items.
     */
    test.slow();
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
    await expect(heading).toContainText("ship controls", { ignoreCase: true });

    // UR-185: with SHIPPED_LANGS at ["en"] the row is not drawn at all - a
    // selector with one choice is arrows that move nothing. The cut is still
    // measured here, one step earlier than it used to be: the row is absent
    // and the stored language is unchanged.
    expect((await settings(page))["uiLang"]).toBe("en");

    const ids = await items(page, SETTINGS).evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-id") ?? ""),
    );
    expect(ids, "the one-choice language row is drawn again").not.toContain(
      "settings.uiLang",
    );
    await expect(heading).toContainText("ship controls", { ignoreCase: true });
  });

  test("the two rows that could not change anything are GONE from the screen", async ({
    page,
  }) => {
    // This test replaces "AC-19.1 / AC-14.1 content language is filtered by
    // input method", which exercised two controls that wrote to the save and
    // reached nothing else.
    //
    // `contentLang` is collision C14: `FlightScene` reads `cfg.contentLang`,
    // but neither `PreflightScene.complete` nor `ResultsScene.replay` carries
    // it into the `FlightConfig`, so the belt built an English allowlist
    // whatever the row said. `inputMethod` is the identical break one field
    // over, and is additionally a control for typing a language D95 cut from
    // the shipped menu.
    //
    // What AC-14.1 asserts is unchanged and is asserted in two better places:
    // its input-method RULE by `tests/unit/i18n/shippedLangs.test.ts` over all
    // three languages, and its stored-pair REPAIR by the test directly below,
    // which still runs on the real screen.
    await seed(page, [{ name: "Ana" }], SETTINGS);

    const ids = await items(page, SETTINGS).evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-id") ?? ""),
    );
    expect(ids, "a removed row is still on the panel").not.toContain(
      "settings.contentLang",
    );
    expect(ids, "a removed row is still on the panel").not.toContain(
      "settings.inputMethod",
    );
    // `keyboardLayout` reaches the lock machine and is untouched. `uiLang` has
    // readers throughout but is HIDDEN while one language ships (UR-185), so
    // the panel is one row shorter than the save is.
    expect(ids).toContain("settings.keyboardLayout");
    expect(ids).not.toContain("settings.uiLang");
    // And the two new rows are here and operable.
    expect(ids).toContain("settings.dashColor");
    expect(ids).toContain("settings.avatar");
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
    await expect(heading).toHaveText("ship controls", { ignoreCase: true });

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
    // ...and then UR-123 landed, which is why the next four lines are not the
    // obvious ones. THIS screen's accent is the pilot's DASH COLOUR, not the
    // palette's (`SettingsScene.accentOverride`), so the colourblind palette
    // cannot move it and asserting that it does is asserting against a
    // deliberate decision. On Settings the correct claim is that the accent
    // stays the player's.
    const after = (await snapshot(page, SETTINGS))["accent"] as string;
    expect(after, "the dash colour stopped owning this screen").toBe(before);

    const live = await page.evaluate(
      () => (window as any).__kb.services.context.colorblindPalette as boolean,
    );
    expect(live).toBe(true);

    // The RE-DRESS half of AC-19.1 still has to be measured, so it is measured
    // on a screen that does not override its accent. The Beacon Log wears the
    // palette straight.
    await open(page, "BeaconLog");
    const logAccent = (await snapshot(page, "BeaconLog"))["accent"] as string;
    expect(logAccent).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(logAccent, "the colourblind palette re-dressed nothing").not.toBe(
      "#FFC857",
    );
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
    // UR-146 recased the clause after the full stop; the claim is unchanged.
    await expect(dialog(page, SETTINGS)).toContainText("The pilot stays");
    expect((await snapshot(page, SETTINGS))["resetStage"]).toBe(1);
    // The safe answer has focus, so Enter on reflex destroys nothing.
    expect(await screen(page, SETTINGS).getAttribute("data-focus")).toBe(
      "dialog.cancel",
    );

    await press(page, "ArrowDown");
    await press(page, "Enter");

    // Step two is a DIFFERENT question, not the same one twice.
    await expect(dialog(page, SETTINGS)).toContainText("one more time", {
      ignoreCase: true,
    });
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
