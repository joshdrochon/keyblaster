import { expect, test } from "@playwright/test";
import {
  assertNoEmailField,
  assertVisibleFocus,
  focusItem,
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

  test("D74 trophies are informational: earned reads earned, unearned says how", async ({
    page,
  }) => {
    await seed(page, [{ name: "Ana", trophies: ["pathfinder"] }], LOG);

    const earned = item(page, LOG, "log.trophy.pathfinder");
    await expect(earned).toHaveAttribute("data-locked", "false");
    await expect(earned).toContainText("earned");

    // An unearned trophy is an invitation with its criterion attached, not a
    // blank or a cross.
    const notYet = item(page, LOG, "log.trophy.mapMaker");
    await expect(notYet).toHaveAttribute("data-locked", "true");
    await expect(notYet).toContainText("light all seven beacons");
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

  test("AC-17.0 a placed beacon shows its coordinates in the D81 format", async ({
    page,
  }) => {
    await seed(page, [{ name: "Ana", beacons: ["earth", "mars"] }], LOG);

    const mars = item(page, LOG, "log.beacon.mars");
    await expect(mars).toHaveAttribute("data-locked", "false");
    // "λ 214.6°  β −1.2°  r 1.52 AU" - lambda, beta, distance in AU.
    await expect(mars).toContainText("λ");
    await expect(mars).toContainText("β");
    await expect(mars).toContainText("AU");
    const text = (await mars.textContent()) ?? "";
    expect(text).toMatch(/λ\s*\d+\.\d°/);
    expect(text).toMatch(/r\s*\d+\.\d{2} AU/);
    expect(text).not.toContain("NaN");
  });

  test("an unlit stop is visible, dim, and says it is not lit yet", async ({
    page,
  }) => {
    await seed(page, [{ name: "Ana", beacons: ["earth"] }], LOG);
    const pluto = item(page, LOG, "log.beacon.pluto");
    await expect(pluto).toHaveCount(1);
    await expect(pluto).toHaveAttribute("data-locked", "true");
    await expect(pluto).toContainText("not lit yet");
  });

  test("all seven stops are always listed, in route order", async ({ page }) => {
    await seed(page, [{ name: "Ana", beacons: ["earth", "mars"] }], LOG);
    const ids = await items(page, LOG).evaluateAll((nodes) =>
      nodes
        .map((n) => n.getAttribute("data-id") ?? "")
        .filter((id) => id.startsWith("log.beacon.")),
    );
    expect(ids).toEqual([
      "log.beacon.earth",
      "log.beacon.mars",
      "log.beacon.jupiter",
      "log.beacon.saturn",
      "log.beacon.uranus",
      "log.beacon.neptune",
      "log.beacon.pluto",
    ]);
    expect((await snapshot(page, LOG))["beaconsLit"]).toBe(2);
  });

  test("empty state: only Earth lit, with Shadow's line about the six to come", async ({
    page,
  }) => {
    await seed(page, [{ name: "Ana", beacons: ["earth"] }], LOG);
    const snap = await snapshot(page, LOG);
    expect(snap["empty"]).toBe(true);
    expect(String(snap["emptyLine"])).toContain("six more");
    expect((await screen(page, LOG).textContent()) ?? "").toContain("not lit yet");
  });

  test("a full log is not the empty state", async ({ page }) => {
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
    expect(snap["beaconsLit"]).toBe(7);
    expect(snap["trophiesEarned"]).toBe(12);
    for (const id of TROPHY_IDS) {
      await expect(item(page, LOG, `log.trophy.${id}`)).toHaveAttribute(
        "data-locked",
        "false",
      );
    }
  });

  test("AC-18.1 keyboard only: every row reachable with a visible focus state", async ({
    page,
  }) => {
    await seed(page, [{ name: "Ana", beacons: ["earth"] }], LOG);
    await assertVisibleFocus(page, LOG);

    // A locked row is still focusable, which is how an unearned trophy gets
    // read at all.
    await focusItem(page, LOG, "log.trophy.lastLight");
    await assertVisibleFocus(page, LOG);
    await expect(item(page, LOG, "log.trophy.lastLight")).toHaveAttribute(
      "data-focused",
      "true",
    );

    await focusItem(page, LOG, "log.beacon.earth");
    await assertVisibleFocus(page, LOG);
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
