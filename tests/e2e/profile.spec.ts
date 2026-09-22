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

    // Three pilots plus the "new pilot" action, which is the FIRST row since
    // UR-82 - "it was under the list, which reads as an afterthought". The
    // indices below were never moved with it, so this test and AC-7.2 below
    // have been red since that change: they asserted the old order, not a
    // defect in the screen.
    await expect(items(page, PICKER)).toHaveCount(4);
    await expect(items(page, PICKER).nth(0)).toContainText("New Pilot");
    await expect(items(page, PICKER).nth(1)).toContainText("Ana");
    // Case-insensitive because the CASE of a label belongs to the copy rules
    // (labels are Title Case), not to this claim, which is that the row names
    // the pilot's furthest beacon at all.
    await expect(items(page, PICKER).nth(1)).toContainText(/mars/i);
    await expect(items(page, PICKER).nth(2)).toContainText(/earth/i);
    // A pilot with no beacon says so rather than showing an empty slot.
    await expect(items(page, PICKER).nth(3)).toContainText(/no beacons yet/i);
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

  /**
   * UR-112: THE THREE THINGS THE OWNER MEASURED ON THIS SCREEN.
   *
   * A playtest: the owner's brother took several seconds to work out that he
   * could press Enter or click "New Pilot". Everything below is one of the
   * reasons, asserted against the SCREEN rather than against a helper - the
   * scene's own `rowRects` and `shadowOrigin` are published for exactly this,
   * because a Phaser canvas shows Playwright nothing and a `Graphics` carries
   * no text for `grid-conformance.spec.ts` to measure.
   */
  test("UR-112: the picker opens with the caret on 'new pilot', not on the last pilot", async ({
    page,
  }) => {
    // Three pilots, and one of them is the ACTIVE one - the row the screen used
    // to steal focus to ("open on the pilot who last flew"). A first-time
    // player has no such pilot and was the person this screen cost.
    await seed(page, [{ name: "Ana" }, { name: "Bo" }, { name: "Cy" }], PICKER);
    await assertVisibleFocus(page, PICKER);

    expect((await snapshot(page, PICKER))["focusId"]).toBe("pick.new");
    expect(await focused(page, PICKER).getAttribute("data-id")).toBe("pick.new");

    // And Enter on arrival does the thing the label says.
    await press(page, "Enter");
    await screen(page, CREATE).waitFor({ state: "attached" });
  });

  test("UR-112: 'new pilot' is the same size as a pilot row, so the column is one list", async ({
    page,
  }) => {
    await seed(page, [{ name: "Ana", beacons: ["earth"] }, { name: "Bo" }], PICKER);

    const rects = (await snapshot(page, PICKER))["rowRects"] as {
      id: string;
      x: number;
      y: number;
      w: number;
      h: number;
    }[];

    const newPilot = rects.find((r) => r.id === "pick.new");
    const pilots = rects.filter((r) => r.id.startsWith("pick.profile."));
    expect(newPilot, "the picker did not report a rect for pick.new").toBeDefined();
    expect(pilots.length).toBe(2);

    for (const row of pilots) {
      // SAME BOX, not "about the same". A list whose first row is a different
      // height is a button parked on top of a list.
      expect({ w: newPilot?.w, h: newPilot?.h }).toEqual({ w: row.w, h: row.h });
      // One left edge, too.
      expect(newPilot?.x).toBe(row.x);
    }

    // And they stack on one rhythm: every gap between consecutive rows equal.
    const ordered = [...rects].sort((a, b) => a.y - b.y);
    const gaps = ordered
      .slice(1)
      .map((row, i) => row.y - ((ordered[i]?.y ?? 0) + (ordered[i]?.h ?? 0)));
    expect(new Set(gaps).size).toBe(1);
  });

  test("UR-112: Shadow stands in the bottom-right corner, not in the middle of space", async ({
    page,
  }) => {
    await seed(page, [{ name: "Ana" }, { name: "Bo" }], PICKER);

    const snap = await snapshot(page, PICKER);
    const shadows = snap["shadowOrigin"] as { x: number; y: number; scale: number }[];
    expect(shadows.length).toBe(1);
    const at = shadows[0] as { x: number; y: number; scale: number };

    // His drawn reach about his origin, in radii - the four coefficients
    // `scenes/support/pickerLayout.ts` places him by, which that module's unit
    // test pins. Written out rather than imported: this spec asserts the
    // SCREEN, and importing the module would let a wrong screen pass by
    // agreeing with it.
    const r = 64 * at.scale;
    const box = {
      x: at.x - 1.32 * r,
      y: at.y - 1.82 * r,
      w: (1.32 + 1.52) * r,
      h: (1.82 + 1.6) * r,
    };

    // `ui/grid`: GUTTER 96, HINT_TOP = 1080 - 76, BACK_CORNER_BOTTOM = +44.
    expect(Math.round(box.x + box.w)).toBe(1920 - 96);
    expect(Math.round(box.y + box.h)).toBe(1080 - 76 + 44);

    // The defect, as a claim: he was at (1660, 620), above the middle of the
    // world and on no named line.
    expect(at.y).toBeGreaterThan(1080 / 2);
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

/**
 * ROW 2, TRIMMED TO THE BEAT THAT IS FINISHED.
 *
 * Pilot creation is one screen today - the name field and the six marks, with a
 * confirm - because the ship pick and the ship-name beat are unfinished and the
 * owner asked for the flow to stop at what a child can complete. The list of
 * live beats is `src/game/scenes/support/createFlow.ts`; restoring the full
 * three is the one line marked in that file, and these tests read the list
 * rather than assuming it, so the restored flow is walked by the same code.
 *
 * WHAT MOVED OUT OF THIS FILE. The locked ship/skin gallery lived on the hidden
 * beat, so "a locked thing is visible, dim, and says what unlocks it" (D73/D79,
 * AC-6d.1b) is asserted where it is still reachable: `hull-equip.spec.ts`, on
 * the Settings equip surface. The catalogue rule itself - four ships, one skin
 * each, at the four milestones - is `tests/unit/catalog/unlocks.test.ts`. The
 * four SKINS are drawn nowhere else in the shipped game while the beat is
 * hidden; that is a cost of the trim and it is recorded here rather than lost.
 */
test.describe("row 2 - profile create", () => {
  test("AC-18.2 no email field exists on the create screen", async ({ page }) => {
    await seed(page, [{ name: "Ana" }], CREATE);
    await assertNoEmailField(page);
    // Every beat that is live, checked one at a time. One today; three when the
    // flow is restored, walked by the same loop.
    const steps = (await snapshot(page, CREATE))["enabledSteps"] as string[];
    for (let i = 0; i < steps.length; i += 1) {
      expect((await snapshot(page, CREATE))["step"]).toBe(i);
      await assertNoEmailField(page);
      if (i < steps.length - 1) {
        await focusItem(page, CREATE, `create.next.${i}`);
        await press(page, "Enter");
      }
    }
  });

  test("D72 keyboard only: a name, a mark, and the confirm takes off", async ({
    page,
  }) => {
    test.slow();
    await seed(page, [], CREATE);

    // The name field has focus on arrival, so typing just works.
    await assertVisibleFocus(page, CREATE);
    expect(await focused(page, CREATE).getAttribute("data-id")).toBe("create.name");
    await page.keyboard.type("Rin");
    await page.waitForTimeout(80);
    expect((await snapshot(page, CREATE))["pilotName"]).toBe("Rin");

    // A mark, chosen with the keyboard. Same screen: "choose your look" is the
    // second half of this beat, not a beat of its own.
    await focusItem(page, CREATE, "create.avatar.avatar-3");
    await press(page, "Enter");
    expect((await snapshot(page, CREATE))["avatarId"]).toBe("avatar-3");

    // The confirm is an ordinary focusable control on this screen, reached by
    // the same keyboard walk as everything else (AC-18.1).
    await focusItem(page, CREATE, "create.launch");
    await assertVisibleFocus(page, CREATE);
    await press(page, "Enter");
    await page.waitForTimeout(300);

    const profile = await activeProfile(page);
    expect(profile?.["name"]).toBe("Rin");
    expect(profile?.["avatar"]).toBe("avatar-3");
    // The hidden beats' answers are the defaults a blank profile would have had
    // anyway: the starting hull, and C07's ship name from the string table.
    expect(profile?.["shipId"]).toBe("ship-1");
    expect(profile?.["shipName"]).toBe("Lantern");
  });

  test("the hidden beats are unreachable: nothing on this screen leads to them", async ({
    page,
  }) => {
    await seed(page, [], CREATE);
    expect((await snapshot(page, CREATE))["enabledSteps"]).toEqual(["pilot"]);
    expect((await snapshot(page, CREATE))["stepName"]).toBe("pilot");

    // No "Next" of any beat, and none of the hidden beats' controls exist.
    await expect(item(page, CREATE, "create.next.0")).toHaveCount(0);
    await expect(item(page, CREATE, "create.next.1")).toHaveCount(0);
    await expect(item(page, CREATE, "create.ship.ship-1")).toHaveCount(0);
    await expect(item(page, CREATE, "create.skin.skin-1")).toHaveCount(0);
    await expect(item(page, CREATE, "create.shipName")).toHaveCount(0);

    // The step counter is gone with them. It said "Step 1 of 3" over a flow
    // with one step in it.
    await expect(screen(page, CREATE)).not.toContainText("Step 1 of");

    // And the confirm does not walk into one. It also does not fire on a blank
    // screen any more: 1a839ee locks it until the name is usable
    // (MIN_NAME_LENGTH = 2), which is why this used to press Enter on nothing
    // and then ask why no pilot existed.
    await focusItem(page, CREATE, "create.launch");
    await press(page, "Enter");
    await page.waitForTimeout(200);
    expect(await activeProfile(page), "a nameless pilot was created").toBeNull();
    await expect(screen(page, CREATE)).toHaveCount(1);

    // Given a name, it creates the pilot and leaves - straight out, not into a
    // second beat.
    await focusItem(page, CREATE, "create.name");
    await page.keyboard.type("Rin");
    await page.waitForTimeout(80);
    await focusItem(page, CREATE, "create.launch");
    await press(page, "Enter");
    await page.waitForTimeout(300);
    expect(await activeProfile(page)).not.toBeNull();
    await expect(screen(page, CREATE)).toHaveCount(0);
  });

  test("AC-18.1 Esc leaves the trimmed screen in one press", async ({ page }) => {
    await seed(page, [{ name: "Ana" }], PICKER);
    await focusItem(page, PICKER, "pick.new");
    await press(page, "Enter");
    await screen(page, CREATE).waitFor({ state: "attached" });
    await press(page, "Escape");
    await screen(page, PICKER).waitFor({ state: "attached" });
    // Nothing was created on the way out.
    expect((await activeProfile(page))?.["name"]).toBe("Ana");
  });

  test("AC-7.2 the new pilot survives a reload (D44)", async ({ page }) => {
    await seed(page, [], CREATE);
    await page.keyboard.type("Kit");
    await page.waitForTimeout(80);
    await focusItem(page, CREATE, "create.launch");
    await press(page, "Enter");
    await page.waitForTimeout(300);

    // The pilot is in the list after a full reload. WHICH row it is on is the
    // picker's claim, asserted by the D13 variant above; this one is about the
    // write surviving.
    await open(page, PICKER);
    await expect(items(page, PICKER)).toHaveCount(2);
    await expect(screen(page, PICKER)).toContainText("Kit");
  });

  test("D31 nothing on these screens reads as punishment", async ({ page }) => {
    await seed(page, [{ name: "Ana" }], PICKER);
    const text = (await screen(page, PICKER).textContent()) ?? "";
    for (const banned of ["wrong", "error", "invalid", "failed", "lives"]) {
      expect(text.toLowerCase()).not.toContain(banned);
    }
  });
});

/**
 * THE SCREEN THAT REMEMBERED THE LAST CHILD.
 *
 * `ProfileCreateScene` kept the name, the mark and the current beat in class
 * FIELDS. Phaser builds each scene once per page (`boot.ts`:
 * `game.scene.add(key, klass, false)`) and `scene.start` re-runs `create()` on
 * that same instance, so those initialisers ran once per page load and never
 * again. Measured against the build before this change, re-entering creation
 * after making "Rin" reported:
 *
 *     pilotName: "Rin"   avatarId: "avatar-3"   step: 2
 *
 * A second child was shown the first child's name on the one screen whose
 * entire purpose is a NEW pilot, could ship it into a profile with one key, and
 * arrived on a beat they had never visited.
 *
 * THE RE-ENTRY IS IN-SESSION ON PURPOSE. A `page.goto` would rebuild the game
 * and hide the defect completely: the stale value only exists in a live page,
 * which is exactly the page a second child sits down to.
 */
test.describe("row 2 - a new pilot screen starts blank", () => {
  test("a fresh visit after a completed creation shows the placeholder, not the last name", async ({
    page,
  }) => {
    test.slow();
    await seed(page, [], CREATE);
    await page.keyboard.type("Rin");
    await page.waitForTimeout(80);
    await focusItem(page, CREATE, "create.avatar.avatar-3");
    await press(page, "Enter");
    await focusItem(page, CREATE, "create.launch");
    await press(page, "Enter");
    await page.waitForTimeout(300);
    expect((await activeProfile(page))?.["name"]).toBe("Rin");

    // Same page, same Phaser game: the picker, then "new pilot", as the next
    // child would.
    await page.evaluate(() => {
      const kb = (window as unknown as {
        __kb?: { game: { scene: { start(key: string): void } } };
      }).__kb;
      kb?.game.scene.start("ProfilePicker");
    });
    await screen(page, PICKER).waitFor({ state: "attached" });
    await focusItem(page, PICKER, "pick.new");
    await press(page, "Enter");
    await screen(page, CREATE).waitFor({ state: "attached" });

    const snap = await snapshot(page, CREATE);
    expect(snap["pilotName"], "the create screen opened holding a name").toBe("");
    expect(snap["avatarId"], "the create screen opened holding a mark").toBe("avatar-1");
    expect(snap["step"], "the create screen opened on a later beat").toBe(0);
    // The mirror carries the field's VALUE, and the field draws the placeholder
    // exactly when the value is empty (`ui/controls.ts` TextField.setValue).
    await expect(item(page, CREATE, "create.name")).toHaveAttribute("data-value", "");
    await expect(item(page, CREATE, "create.name")).toContainText("Type Your Name");
  });

  test("an abandoned name does not follow the next child in either (Esc, not a commit)", async ({
    page,
  }) => {
    await seed(page, [{ name: "Ana" }], PICKER);
    await focusItem(page, PICKER, "pick.new");
    await press(page, "Enter");
    await screen(page, CREATE).waitFor({ state: "attached" });
    await page.keyboard.type("Bo");
    await page.waitForTimeout(80);
    expect((await snapshot(page, CREATE))["pilotName"]).toBe("Bo");

    await press(page, "Escape");
    await screen(page, PICKER).waitFor({ state: "attached" });
    await focusItem(page, PICKER, "pick.new");
    await press(page, "Enter");
    await screen(page, CREATE).waitFor({ state: "attached" });

    expect(
      (await snapshot(page, CREATE))["pilotName"],
      "a name typed and abandoned came back on the next visit",
    ).toBe("");
  });
});
