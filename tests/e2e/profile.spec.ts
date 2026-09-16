import { expect, test } from "@playwright/test";
import {
  activeProfile,
  assertNoEmailField,
  assertVisibleFocus,
  focusItem,
  focused,
  item,
  items,
  notice,
  open,
  press,
  screen,
  seed,
  snapshot,
} from "./lib/menus";

/**
 * Screen inventory rows 1b (Profile picker) and 2 (Profile create).
 *
 * Covers AC-18.1 (keyboard reachable and returnable, visible focus),
 * AC-18.2 (no email field exists anywhere), AC-18.4 (corrupt storage yields a
 * fresh profile plus a calm non-blocking notice), AC-6b.1 / C07 (ship name
 * defaults from the string table), AC-6d.1b / D73 / D79 (locked skins visible
 * but dim with what unlocks them), and D43 (profiles, not accounts).
 */

const PICKER = "ProfilePicker";
const CREATE = "ProfileCreate";

test.describe("row 1b - profile picker", () => {
  test("AC-18.2 no email field exists on the picker (DOM assertion)", async ({
    page,
  }) => {
    await seed(page, [{ name: "Ana" }], PICKER);
    await assertNoEmailField(page);
  });

  test("variant: several pilots, each showing their furthest beacon (D13)", async ({
    page,
  }) => {
    await seed(
      page,
      [
        { name: "Ana", beacons: ["earth", "mars"] },
        { name: "Bo", beacons: ["earth"] },
        { name: "Cy" },
      ],
      PICKER,
    );

    const snap = await snapshot(page, PICKER);
    expect(snap["profileCount"]).toBe(3);

    // Three pilots plus the "new pilot" action.
    await expect(items(page, PICKER)).toHaveCount(4);
    await expect(items(page, PICKER).nth(0)).toContainText("Ana");
    await expect(items(page, PICKER).nth(0)).toContainText("mars");
    await expect(items(page, PICKER).nth(1)).toContainText("earth");
    // A pilot with no beacon says so rather than showing an empty slot.
    await expect(items(page, PICKER).nth(2)).toContainText("no beacons yet");
  });

  test("variant: exactly one pilot", async ({ page }) => {
    await seed(page, [{ name: "Solo", beacons: ["earth"] }], PICKER);
    expect((await snapshot(page, PICKER))["profileCount"]).toBe(1);
    await expect(items(page, PICKER)).toHaveCount(2);
  });

  test("variant: none - an empty hangar offers only 'new pilot'", async ({
    page,
  }) => {
    await seed(page, [], PICKER);
    expect((await snapshot(page, PICKER))["profileCount"]).toBe(0);
    await expect(items(page, PICKER)).toHaveCount(1);
    await expect(item(page, PICKER, "pick.new")).toHaveCount(1);
  });

  test("AC-18.1 keyboard only: arrows move focus and the ring is visible", async ({
    page,
  }) => {
    await seed(page, [{ name: "Ana" }, { name: "Bo" }], PICKER);
    await assertVisibleFocus(page, PICKER);

    const first = await focused(page, PICKER).getAttribute("data-id");
    await press(page, "ArrowDown");
    const second = await focused(page, PICKER).getAttribute("data-id");
    expect(second).not.toBe(first);
    await assertVisibleFocus(page, PICKER);

    // Tab is handled by the game, not by the browser: focus must stay inside.
    await press(page, "Tab");
    await assertVisibleFocus(page, PICKER);
    await expect(focused(page, PICKER)).toHaveCount(1);
  });

  test("AC-18.1 keyboard only: 'new pilot' reaches screen 2 and Esc returns", async ({
    page,
  }) => {
    await seed(page, [{ name: "Ana" }], PICKER);
    await focusItem(page, PICKER, "pick.new");
    await press(page, "Enter");
    await screen(page, CREATE).waitFor({ state: "attached" });

    await press(page, "Escape");
    await screen(page, PICKER).waitFor({ state: "attached" });
  });

  test("AC-18.4 corrupt storage: fresh profile plus one calm non-blocking line", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("kb:v1:profiles", "{ this is not json");
      } catch {
        /* private mode: the loader treats that as unreadable too */
      }
    });
    await open(page, PICKER);

    // The game is usable: a profile exists and the picker is operable.
    expect(await activeProfile(page)).not.toBeNull();
    await assertVisibleFocus(page, PICKER);

    // One line, and only one. Not a dialog: nothing blocks the controls.
    const line = notice(page, PICKER);
    await expect(line).toHaveCount(1);
    await expect(line).toContainText("fresh");
    await expect(screen(page, PICKER).locator('[data-testid="ui-dialog"]')).toHaveCount(0);
  });
});

test.describe("row 2 - profile create", () => {
  test("AC-18.2 no email field exists on any step of create", async ({ page }) => {
    await seed(page, [{ name: "Ana" }], CREATE);
    await assertNoEmailField(page);
    await press(page, "Escape"); // back out is step-wise; step 0 leaves the screen
    await open(page, CREATE);

    // Walk all three beats and re-check each one.
    for (const step of [0, 1, 2]) {
      expect((await snapshot(page, CREATE))["step"]).toBe(step);
      await assertNoEmailField(page);
      if (step < 2) {
        await focusItem(page, CREATE, step === 0 ? "create.next" : "create.next");
        await press(page, "Enter");
      }
    }
  });

  test("D72 keyboard only: name, mark, ship and ship name, then take off", async ({
    page,
  }) => {
    // Three beats, two name fields and a gallery: the longest keyboard journey
    // in the game, and slow on a throttled headless frame rate.
    test.slow();
    await seed(page, [], CREATE);

    // Beat 1: the name field has focus on arrival, so typing just works.
    await assertVisibleFocus(page, CREATE);
    expect(await focused(page, CREATE).getAttribute("data-id")).toBe("create.name");
    await page.keyboard.type("Rin");
    await page.waitForTimeout(80);
    expect((await snapshot(page, CREATE))["pilotName"]).toBe("Rin");

    // A mark, chosen with the keyboard.
    await focusItem(page, CREATE, "create.avatar.avatar-3");
    await press(page, "Enter");
    expect((await snapshot(page, CREATE))["avatarId"]).toBe("avatar-3");

    await focusItem(page, CREATE, "create.next");
    await press(page, "Enter");
    expect((await snapshot(page, CREATE))["step"]).toBe(1);

    // Beat 2: the starting hull is the only choosable one on a new pilot.
    await focusItem(page, CREATE, "create.ship.ship-1");
    await press(page, "Enter");
    expect((await snapshot(page, CREATE))["shipId"]).toBe("ship-1");

    await focusItem(page, CREATE, "create.next");
    await press(page, "Enter");
    expect((await snapshot(page, CREATE))["step"]).toBe(2);

    // Beat 3: C07 - the default ship name comes from the string table, never
    // from a literal in a scene.
    expect((await snapshot(page, CREATE))["shipName"]).toBe("Lantern");
    await focusItem(page, CREATE, "create.shipName");
    await press(page, "Backspace", 7);
    await page.keyboard.type("Comet");
    await page.waitForTimeout(80);

    await focusItem(page, CREATE, "create.launch");
    await press(page, "Enter");
    await page.waitForTimeout(200);

    const profile = await activeProfile(page);
    expect(profile?.["name"]).toBe("Rin");
    expect(profile?.["avatar"]).toBe("avatar-3");
    expect(profile?.["shipId"]).toBe("ship-1");
    expect(profile?.["shipName"]).toBe("Comet");
  });

  test("AC-7.2 the new pilot survives a reload (D44)", async ({ page }) => {
    await seed(page, [], CREATE);
    await page.keyboard.type("Kit");
    await page.waitForTimeout(80);
    await focusItem(page, CREATE, "create.next");
    await press(page, "Enter");
    await focusItem(page, CREATE, "create.next");
    await press(page, "Enter");
    await focusItem(page, CREATE, "create.launch");
    await press(page, "Enter");
    await page.waitForTimeout(300);

    await open(page, PICKER);
    await expect(items(page, PICKER).nth(0)).toContainText("Kit");
  });

  test("D73/D79 locked skins are visible, dim, and say what unlocks them", async ({
    page,
  }) => {
    await seed(page, [], CREATE);
    await focusItem(page, CREATE, "create.next");
    await press(page, "Enter");

    // All four ships and all four skins are on screen for a brand-new pilot.
    await expect(item(page, CREATE, "create.ship.ship-1")).toHaveCount(1);
    await expect(item(page, CREATE, "create.ship.ship-4")).toHaveCount(1);
    await expect(item(page, CREATE, "create.skin.skin-1")).toHaveCount(1);
    await expect(item(page, CREATE, "create.skin.skin-4")).toHaveCount(1);

    // Ship 1 is the starting hull; 2-4 are locked and say what earns them.
    await expect(item(page, CREATE, "create.ship.ship-1")).toHaveAttribute(
      "data-locked",
      "false",
    );
    await expect(item(page, CREATE, "create.ship.ship-3")).toHaveAttribute(
      "data-locked",
      "true",
    );
    await expect(item(page, CREATE, "create.ship.ship-3")).toContainText(
      "unlocks after 5 beacons",
    );
    await expect(item(page, CREATE, "create.skin.skin-2")).toHaveAttribute(
      "data-locked",
      "true",
    );
    await expect(item(page, CREATE, "create.skin.skin-2")).toContainText(
      "25 chain",
    );

    // AC-18.1: a locked tile is still reachable, so it can be read. Focus lands
    // on it and the ring is drawn.
    await focusItem(page, CREATE, "create.ship.ship-4");
    await assertVisibleFocus(page, CREATE);
    // ...but Enter does not choose it.
    await press(page, "Enter");
    expect((await snapshot(page, CREATE))["shipId"]).toBe("ship-1");
  });

  test("D31 nothing on these screens reads as punishment", async ({ page }) => {
    await seed(page, [{ name: "Ana" }], PICKER);
    const text = (await screen(page, PICKER).textContent()) ?? "";
    for (const banned of ["wrong", "error", "invalid", "failed", "lives"]) {
      expect(text.toLowerCase()).not.toContain(banned);
    }
  });
});
