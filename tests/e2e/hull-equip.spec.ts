import { expect, test } from "@playwright/test";
import {
  activeProfile,
  assertVisibleFocus,
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

/**
 * ================== WHY THIS FILE NO LONGER PRESSES KEYS ==================
 * UR-132: `SettingsScene.SHOW_HULL_ROW` is `false` on the owner's instruction,
 * so the row this file was written to drive is not built. Four tests here were
 * waiting 90s for `settings.hull` to attach and then timing out.
 *
 * The RULE and the STORE round trip are unaffected and still covered, by the
 * sixteen tests in `tests/unit/ui/hulls.test.ts` and
 * `tests/unit/unlocks/equip.test.ts`. What is gone is the browser half - real
 * arrow keys on the row, the canvas ring, the reload - because there is no row
 * to press. Asserting it anyway would be a test of a fixture.
 *
 * So this file now measures THE CUT: the row is absent, the console still laps
 * cleanly without it, and the worn hull is untouched by a visit to Settings.
 * It fails the day the flag flips, which is when the four tests above it in
 * git history should come back. See gauntlet/escalations.md (UR-132-e2e).
 */

test.describe("UR-132: the hull row is not on the console", () => {
  test.slow();

  test("the hull row is not built, and nothing else lost its place", async ({
    page,
  }) => {
    await seed(page, [FIVE_BEACONS], SETTINGS);

    const ids = await screen(page, SETTINGS)
      .locator('[data-testid="ui-item"]')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-id") ?? ""));

    expect(ids, "the hull row is drawn again - restore this file").not.toContain(
      HULL,
    );
    // UR-185 turned the other one-choice row off in the same column.
    expect(ids).not.toContain("settings.uiLang");
    expect(ids).toContain("settings.keyboardLayout");

    // A lap of the list that comes back where it started is what says nothing
    // fell off the focus order when the two rows went. Counted off the rows
    // actually drawn rather than a fixed number, which is what broke here.
    const first = await screen(page, SETTINGS).getAttribute("data-focus");
    await press(page, "ArrowDown", ids.length);
    expect(await screen(page, SETTINGS).getAttribute("data-focus")).toBe(first);
    await assertVisibleFocus(page, SETTINGS);
  });

  test("a visit to the console cannot change the hull a pilot is wearing", async ({
    page,
  }) => {
    await seed(page, [FIVE_BEACONS], SETTINGS);
    expect(await wornHull(page)).toBe("ship-1");

    // Every key the kit operates a control with, on a panel that has no equip
    // surface. AC-6d.1b's claim survives the cut: no input wears a hull.
    await press(page, "Enter");
    await press(page, " ");
    await press(page, "ArrowRight");
    await press(page, "ArrowDown");

    expect(await wornHull(page), "Settings equipped a hull with no hull row").toBe(
      "ship-1",
    );
    expect((await snapshot(page, SETTINGS))["shipId"]).toBe("ship-1");
  });
});
