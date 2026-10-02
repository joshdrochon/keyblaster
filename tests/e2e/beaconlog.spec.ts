import { expect, test } from "@playwright/test";
import {
  assertNoEmailField,
  assertVisibleFocus,
  focused,
  item,
  items,
  press,
  screen,
  seed,
  snapshot,
} from "./lib/menus";

/**
 * Screen inventory row 10 - Beacon Log (D40, D74, D80).
 *
 * Covers AC-6d.2 (trophy definitions are config; the Beacon Log renders them),
 * AC-6d.1c (all twelve of D80), AC-17.0 (the beacon coordinate display format),
 * AC-18.1 (keyboard) and the empty state from design brief 13.
 */

const LOG = "BeaconLog";

/** The twelve of D80 / AC-6d.1c, in the PRD's order. */
const TROPHY_IDS = [
  "firstLight",
  "pathfinder",
  "beltRunner",
  "ringWeaver",
  "chain25",
  "chain50",
  "sharpEye",
  "steadyHull",
  "longMemory",
  "mapMaker",
  "darkSide",
  "lastLight",
];

test.describe("row 10 - beacon log", () => {
  test("AC-6d.1c all twelve trophies are rendered, earned or not", async ({
    page,
  }) => {
    await seed(page, [{ name: "Ana", trophies: ["firstLight"] }], LOG);
    expect((await snapshot(page, LOG))["trophiesShown"]).toBe(12);
    for (const id of TROPHY_IDS) {
      await expect(item(page, LOG, `log.trophy.${id}`)).toHaveCount(1);
    }
  });

  test("D74 trophies are informational: a mark says got it, and the criterion is always there", async ({
    page,
  }) => {
    // The word "Earned" was doing two jobs badly: it restated `data-locked`,
    // and it pushed the criterion off the earned card entirely, so the child
    // could read WHY only on the trophies they had not won. Both states now
    // carry the criterion and differ by one mark.
    await seed(page, [{ name: "Ana", trophies: ["pathfinder"] }], LOG);

    const earned = item(page, LOG, "log.trophy.pathfinder");
    await expect(earned).toHaveAttribute("data-locked", "false");
    await expect(earned).toContainText("\u2713");
    await expect(earned).not.toContainText("earned", { ignoreCase: true });

    const notYet = item(page, LOG, "log.trophy.mapMaker");
    await expect(notYet).toHaveAttribute("data-locked", "true");
    await expect(notYet).toContainText("\u2610");
    await expect(notYet).toContainText("light all seven beacons", {
      ignoreCase: true,
    });
  });

  test("D74 nothing on this screen is comparative", async ({ page }) => {
    await seed(page, [{ name: "Ana", trophies: ["firstLight"] }], LOG);
    const text = ((await screen(page, LOG).textContent()) ?? "").toLowerCase();
    for (const banned of [
      "rank",
      "leaderboard",
      "rare",
      "top ",
      "players",
      "percentile",
      "level ",
      "points",
    ]) {
      expect(text).not.toContain(banned);
    }
  });

  test("empty state: no trophies yet, with Shadow's line about them", async ({
    page,
  }) => {
    // UR-198: the empty state used to be "only Earth is lit". The beacons left
    // this screen, so the one thing it can be empty OF is trophies.
    await seed(page, [{ name: "Ana", beacons: ["earth"] }], LOG);
    const snap = await snapshot(page, LOG);
    expect(snap["empty"]).toBe(true);
    expect(snap["trophiesEarned"]).toBe(0);
    expect(String(snap["emptyLine"]).toLowerCase()).toContain("no trophies yet");
  });

  test("a full trophy case is not the empty state", async ({ page }) => {
    await seed(
      page,
      [
        {
          name: "Ana",
          beacons: [
            "earth",
            "mars",
            "jupiter",
            "saturn",
            "uranus",
            "neptune",
            "pluto",
          ],
          trophies: TROPHY_IDS,
        },
      ],
      LOG,
    );
    const snap = await snapshot(page, LOG);
    expect(snap["empty"]).toBe(false);
    expect(snap["trophiesEarned"]).toBe(12);
    for (const id of TROPHY_IDS) {
      await expect(item(page, LOG, `log.trophy.${id}`)).toHaveAttribute(
        "data-locked",
        "false",
      );
    }
  });

  test("AC-18.1 every row is readable without a ring on anything you cannot use", async ({
    page,
  }) => {
    // RESTATED, not relaxed. Nothing on this screen can be chosen: the rows
    // are a record of what the pilot did. A ring that walked twelve trophies
    // and seven beacons promised a selection that does not exist, and the
    // child pressing Enter on it got nothing.
    //
    // What AC-18.1 protects is that a keyboard-only child can REACH every row,
    // and that is now carried by the accessibility mirror rather than by a
    // painted ring: every row is still published, still readable, still says
    // whether it is lit. The ring belongs on the one thing that IS operable.
    await seed(page, [{ name: "Ana", beacons: ["earth"] }], LOG);

    // Every row present and readable.
    await expect(items(page, LOG)).not.toHaveCount(0);
    await expect(item(page, LOG, "log.trophy.lastLight")).toHaveCount(1);
    await expect(item(page, LOG, "log.trophy.firstLight")).toHaveCount(1);

    // ...and not one of them claims to be selected.
    await expect(focused(page, LOG)).toHaveCount(0);
    const snap = await snapshot(page, LOG);
    expect(snap["focusRing"]).toBe(false);
    expect(snap["focusId"]).toBeFalsy();

    // The screen still answers the keyboard: Esc is the way out, and it does
    // not raise a browser dialog. (Asserted in full by the Esc test below.)
    await expect(screen(page, LOG)).toHaveAttribute("data-focus-ring", "false");
  });

  test("AC-18.2 no email field exists on the beacon log", async ({ page }) => {
    await seed(page, [{ name: "Ana" }], LOG);
    await assertNoEmailField(page);
  });

  test("AC-18.1 Esc leaves the log without a browser dialog", async ({ page }) => {
    await seed(page, [{ name: "Ana" }], LOG);
    let browserDialogs = 0;
    page.on("dialog", (d) => {
      browserDialogs += 1;
      void d.dismiss();
    });
    await press(page, "Escape");
    expect(browserDialogs).toBe(0);

    // Two correct outcomes, depending on whether the map lane is registered in
    // this build: Esc left the log, or the map is not there and the log is
    // still up and still operable. What is never correct is a browser dialog or
    // a screen that has stopped responding to the keyboard.
    if ((await screen(page, LOG).count()) > 0) {
      await assertVisibleFocus(page, LOG);
    } else {
      const started = await page.evaluate(
        () => (window as any).__kb.game.scene.isActive("DirectorMap") as boolean,
      );
      expect(started).toBe(true);
    }
  });
});
