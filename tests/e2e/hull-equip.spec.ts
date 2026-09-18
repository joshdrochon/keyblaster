import { expect, test } from "@playwright/test";
import {
  activeProfile,
  assertVisibleFocus,
  focusItem,
  item,
  open,
  press,
  screen,
  seed,
  snapshot,
} from "./lib/menus";

/**
 * UR-48: THE EQUIP SURFACE - A HULL A CHILD EARNED CAN BE PUT ON, BY KEYBOARD,
 * AND IS STILL ON TOMORROW (D73, D79; AC-6d.1b, AC-18.1, AC-19.1).
 *
 * ================== THE DEFECT ==================
 * Earning worked and equipping was dead. Hulls unlock at 1 / 3 / 5 / 7 beacons
 * through `@engine/unlocks.applyUnlocks`, and the only writer of
 * `profile.shipId` outside the schema was `ProfileCreateScene` at creation
 * time, where a pilot who does not exist yet holds `ship-1` alone. So `shipId`
 * could only ever be `ship-1` for any real save and ships 2, 3 and 4 were
 * drawn, catalogued, earnable and unwearable for the life of the profile.
 *
 * ================== WHY SETTINGS AND NOT A NEW SCREEN ==================
 * This screen is already "ship controls" and already reads as the inside of the
 * Lantern (UR-11). It is reached from the Director map AND from Pause, so one
 * row lands the surface on both routes. The row is the last module built into
 * the flight-deck column, `SettingsScene.hullRow` says why at length.
 *
 * ================== WHAT THIS FILE ADDS OVER THE UNIT TESTS ==================
 * `tests/unit/ui/hulls.test.ts` runs the RULE (all four offered, locked ones
 * refused) and `tests/unit/unlocks/equip.test.ts` runs the STORE round trip.
 * Neither can press a key or see a focus ring, because the unit suite has no
 * DOM. This is the part that needs a browser: real arrow keys, the canvas ring,
 * and a real page reload rather than a second store over the same bytes.
 */

const SETTINGS = "Settings";
const HULL = "settings.hull";

/**
 * A pilot five beacons in.
 *
 * `unlockedShips` is stated as well as `beacons` because `lib/menus.seed`
 * writes the two independently - and the list it is given here is EXACTLY what
 * `applyUnlocks` produces from five lit beacons, which
 * `tests/unit/ui/hulls.test.ts > every hull opens at its own threshold` asserts
 * against the real granter. A fixture that grants what no run can grant is a
 * test of the fixture (`story-lane.charted` learned that one the hard way).
 */
const FIVE_BEACONS = {
  name: "Ren",
  beacons: ["earth", "mars", "jupiter", "saturn", "uranus"],
  unlockedShips: ["ship-1", "ship-2", "ship-3"],
};

/** The hull the profile is actually wearing, read off the real store. */
async function wornHull(page: import("@playwright/test").Page): Promise<unknown> {
  return (await activeProfile(page))?.["shipId"];
}

/** Walk the row's cursor to a hull by pressing Right, and say where it got to. */
async function cursorTo(
  page: import("@playwright/test").Page,
  label: string,
): Promise<void> {
  await focusItem(page, SETTINGS, HULL);
  // Four hulls, so at most four presses gets anywhere from anywhere. Polled on
  // the mirror rather than counted blindly: the row opens on whichever hull is
  // WORN, which is not a fixed starting index (rule 6 - wait for the thing).
  for (let i = 0; i < 5; i += 1) {
    const value = await item(page, SETTINGS, HULL).getAttribute("data-value");
    if (value === label) return;
    await press(page, "ArrowRight");
  }
  throw new Error(`the hull row's cursor never reached ${label}`);
}

test.describe("UR-48: equipping a hull from the ship-controls console", () => {
  // Software WebGL under parallel workers, same as the rest of the menu lane.
  test.slow();

  test("AC-18.1 the hull row is reachable by keyboard, with a visible ring", async ({
    page,
  }) => {
    await seed(page, [FIVE_BEACONS], SETTINGS);
    await item(page, SETTINGS, HULL).waitFor({ state: "attached" });

    // Reached by arrow keys alone - `focusItem` walks the real focus list with
    // real keystrokes, it does not call into the scene.
    await focusItem(page, SETTINGS, HULL);
    await expect(screen(page, SETTINGS)).toHaveAttribute("data-focus", HULL);
    // AC-18.1's other half: the ring is DRAWN on the canvas, not merely a DOM
    // attribute. `assertVisibleFocus` reads both, and the scene's own snapshot.
    await assertVisibleFocus(page, SETTINGS);

    // The arrows belong to the row: Right moves its cursor and does NOT move
    // focus off it, which is what `adjustable` means in `focus.ts`.
    const first = await item(page, SETTINGS, HULL).getAttribute("data-value");
    await press(page, "ArrowRight");
    await expect(screen(page, SETTINGS)).toHaveAttribute("data-focus", HULL);
    expect(
      await item(page, SETTINGS, HULL).getAttribute("data-value"),
      "Right did not move the hull cursor",
    ).not.toBe(first);
  });

  test("D73/D79 a locked hull is visible, dim, and says what unlocks it", async ({
    page,
  }) => {
    await seed(page, [FIVE_BEACONS], SETTINGS);
    // The same treatment the create screen gives a locked tile, asserted the
    // same way `profile.spec.ts` asserts it there - one vocabulary, two screens.
    await cursorTo(page, "albatross");
    await expect(item(page, SETTINGS, HULL)).toHaveAttribute("data-locked", "true");
    await expect(item(page, SETTINGS, HULL)).toContainText("unlocks after 7 beacons");
    // And it is still focusable while locked, so a screen reader can read it.
    await assertVisibleFocus(page, SETTINGS);
  });

  test("AC-6d.1b a locked hull cannot be equipped by any input", async ({ page }) => {
    await seed(page, [FIVE_BEACONS], SETTINGS);
    expect(await wornHull(page)).toBe("ship-1");

    await cursorTo(page, "albatross");
    // Enter, Space and a click on the row are the three ways a control in this
    // kit is operated (`focus.ts`: Enter and Space both call `activate`, and
    // `bindPointer` gives every focusable a hit area). None of them may wear a
    // ship this pilot has not earned.
    await press(page, "Enter");
    await press(page, " ");
    expect(await wornHull(page), "a locked hull was equipped by the keyboard").toBe("ship-1");
    expect((await snapshot(page, SETTINGS))["shipId"]).toBe("ship-1");
    // The row did not quietly move on either - it is still showing the locked
    // hull with its sentence, which is the state a child is left in.
    await expect(item(page, SETTINGS, HULL)).toHaveAttribute("data-locked", "true");
  });

  test("AC-19.1 an earned hull is equipped and survives a real reload", async ({
    page,
  }) => {
    await seed(page, [FIVE_BEACONS], SETTINGS);
    expect(await wornHull(page)).toBe("ship-1");

    await cursorTo(page, "harrier");
    await expect(item(page, SETTINGS, HULL)).toHaveAttribute("data-locked", "false");
    await press(page, "Enter");

    // The write, through the real store.
    await expect
      .poll(() => wornHull(page), { message: "Enter did not equip the earned hull" })
      .toBe("ship-3");
    // The row now says this one is being flown, which is the feedback the press
    // gives - there is no toast and no dialog (D31: calm).
    await expect(item(page, SETTINGS, HULL)).toContainText("flying now");

    // THE RELOAD. A new page, a new boot, a new store over what localStorage
    // actually holds. This is the half a value assertion cannot see, and it is
    // the half that matters: a hull that resets when a child closes the tab is
    // worse than a knob that does, because they earned it.
    await open(page, SETTINGS);
    expect(await wornHull(page), "the equipped hull did not survive the reload").toBe(
      "ship-3",
    );
    expect((await snapshot(page, SETTINGS))["shipId"]).toBe("ship-3");
    // And the row comes back OPEN ON IT, so the screen and the save agree.
    await expect(item(page, SETTINGS, HULL)).toHaveAttribute("data-value", "harrier");
    await expect(item(page, SETTINGS, HULL)).toContainText("flying now");
  });

  test("AC-18.1 the console still walks end to end with the hull row on it", async ({
    page,
  }) => {
    // The row is a twelfth control on a panel that already had eleven, and the
    // column is flowed rather than stacked at a fixed pitch. A lap of the list
    // that comes back to where it started is what says nothing fell off the
    // focus order (the frame itself is measured in tests/unit/ui/cockpit.test.ts,
    // in Devanagari, where this column runs out of room first).
    await seed(page, [FIVE_BEACONS], SETTINGS);
    const count = await screen(page, SETTINGS)
      .locator('[data-testid="ui-item"]')
      .count();
    expect(count).toBeGreaterThanOrEqual(11);
    const first = await screen(page, SETTINGS).getAttribute("data-focus");
    await press(page, "ArrowDown", count);
    expect(await screen(page, SETTINGS).getAttribute("data-focus")).toBe(first);
    await assertVisibleFocus(page, SETTINGS);
  });
});
