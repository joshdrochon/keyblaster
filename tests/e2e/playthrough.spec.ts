import { expect, test } from "@playwright/test";
import { activeScenes, freezeReloads, settle, waitForScene } from "./support/lane.js";

/**
 * THE TEST THAT WAS MISSING.
 *
 * Every other spec in this suite boots ONE scene directly with `?scene=X` and
 * exercises it in isolation. All 172 of them passed while the game could not
 * actually be played: nothing walked the SEAMS between scenes, so a transition
 * that never fired looked exactly like a transition nobody had tried.
 *
 * This spec starts at `/` like a player does, presses only real keys, and walks
 * the whole route from the Title to a placed beacon and back to the map. It
 * uses no debug hooks to move between scenes - only to observe where it is.
 *
 * If this is red, the game is not playable, whatever the rest of the board says.
 */

/**
 * This walks a dozen scenes in one test, so it is the longest-running spec in
 * the suite and the most exposed to the load-dependence documented in
 * gauntlet/escalations.md. Its internal waits are therefore generous: under
 * three workers of software-GL contention a transition that takes 300ms alone
 * can take several seconds. Patience measures the same thing here - this test
 * asserts that transitions HAPPEN, never that they are fast. P-22.9 is where
 * speed is measured, and it correctly refuses a headless number.
 */
test.describe.configure({ mode: "default", timeout: 300_000 });

/** Press a key and let the transition it triggers actually run. */
async function press(page: import("@playwright/test").Page, key: string): Promise<void> {
  await page.keyboard.press(key);
  await page.waitForTimeout(120);
}

/** Type a word one key at a time, as a child would. */
async function typeWord(page: import("@playwright/test").Page, word: string): Promise<void> {
  for (const ch of word) {
    await page.keyboard.press(ch === " " ? "Space" : ch);
    await page.waitForTimeout(45);
  }
}

test("a player can get from the Title to a placed beacon using only the keyboard", async ({
  page,
}) => {
  // A dozen scenes in one test means a bare timeout tells you nothing. `step`
  // is carried into every failure message so a red run says WHERE the route
  // died, not just that it did.
  const trail: string[] = [];
  let step = "boot";
  const mark = async (name: string): Promise<void> => {
    step = name;
    trail.push(`${name} @ ${(await activeScenes(page)).join("+") || "none"}`);
  };
  const where = (): string => `failed during "${step}"\ntrail:\n  ${trail.join("\n  ")}`;

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await freezeReloads(page);
  await page.goto("/");
  await expect(page.getByTestId("app")).toHaveAttribute("data-booted", "true");
  await waitForScene(page, "Title");
  await settle(page, 900);
  await mark("title shown");

  // --- Title -------------------------------------------------------------
  expect(await activeScenes(page)).toContain("Title");
  await mark("pressing Enter on Title");
  await press(page, "Enter");

  // Whatever the Title routes to, it must LEAVE the Title. This is the exact
  // step that was silently dead: the camera fade started and never completed,
  // so Enter did nothing and there was no error to see.
  await page.waitForFunction(
    () => {
      const g = (window as unknown as { __kb: { game: { scene: { getScenes(a: boolean): { scene: { key: string } }[] } } } }).__kb.game;
      return !g.scene.getScenes(true).some((s) => s.scene.key === "Title");
    },
    undefined,
    { timeout: 60_000 },
  ).catch(async (e) => {
    throw new Error(`Title never handed off. ${where()}\n${String(e)}`);
  });
  await mark("left Title");

  const afterTitle = (await activeScenes(page))[0];
  expect(
    ["ProfilePicker", "ProfileCreate", "EarthActivation", "DirectorMap"],
    `Title routed to ${afterTitle}`,
  ).toContain(afterTitle);

  // --- Profile, if this build shows one ----------------------------------
  if (afterTitle === "ProfilePicker" || afterTitle === "ProfileCreate") {
    // Walk the create flow with real keys until something else is on screen.
    for (let i = 0; i < 40; i++) {
      const here = (await activeScenes(page))[0];
      if (here !== "ProfilePicker" && here !== "ProfileCreate") break;
      await press(page, "Enter");
    }
  }

  const beforeEarth = (await activeScenes(page))[0];
  expect(
    ["EarthActivation", "DirectorMap"],
    `profile flow ended on ${beforeEarth}`,
  ).toContain(beforeEarth);

  // --- Earth: type the activation word -----------------------------------
  if (beforeEarth === "EarthActivation") {
    await settle(page, 600);
    await typeWord(page, "launch");
    await waitForScene(page, "DirectorMap", 60_000);
  }

  // --- Director map: fly the first belt ----------------------------------
  await waitForScene(page, "DirectorMap", 60_000).catch(async (e) => {
    throw new Error(`never reached the Director map. ${where()}\n${String(e)}`);
  });
  await mark("director map");
  await settle(page, 700);

  // The map must be able to LEAVE for a stop. Try Enter on the focused stop,
  // then arrow onward if Enter does nothing - a map you cannot leave is the
  // dead end the player reported.
  let left = false;
  for (let i = 0; i < 12 && !left; i++) {
    await press(page, "Enter");
    await page.waitForTimeout(400);
    const here = await activeScenes(page);
    if (!here.includes("DirectorMap")) {
      left = true;
      break;
    }
    await press(page, "ArrowRight");
  }
  expect(left, "the Director map never routed to a stop - the run dead-ends here").toBe(true);

  let afterMap = (await activeScenes(page))[0];

  // Earth is the launchpad, so the FIRST thing the map routes to is Earth's
  // activation. Light it, come back, and the map must now send us onward -
  // this is the loop the player was trapped in: Earth never recorded as
  // cleared, so the map kept re-focusing Earth forever.
  if (afterMap === "EarthActivation") {
    await settle(page, 700);
    await typeWord(page, "launch");
    await settle(page, 900);
    await press(page, "Enter");
    await waitForScene(page, "DirectorMap", 60_000);
    await settle(page, 800);

    let leftAgain = false;
    for (let i = 0; i < 12 && !leftAgain; i++) {
      await press(page, "Enter");
      await page.waitForTimeout(400);
      if (!(await activeScenes(page)).includes("DirectorMap")) {
        leftAgain = true;
        break;
      }
      await press(page, "ArrowRight");
    }
    expect(
      leftAgain,
      "after lighting Earth the map still would not route onward",
    ).toBe(true);

    afterMap = (await activeScenes(page))[0];
    expect(
      afterMap,
      "the map sent us back to Earth after Earth was already lit - this is the dead-end loop",
    ).not.toBe("EarthActivation");

    // AC-7.2 / D44: the clear has to reach the STORE, not just the init
    // payload, or the loop comes back on reload.
    const stored = await page.evaluate(() => {
      const kb = (window as unknown as { __kb: { services?: { store?: { activeProfile(): unknown } } } }).__kb;
      const profile = kb.services?.store?.activeProfile() as
        | { progress?: { stopId: string; cleared: boolean; beaconPlacedAt: number | null }[] }
        | null
        | undefined;
      return profile?.progress?.find((p) => p.stopId === "earth") ?? null;
    });
    expect(stored, "Earth's clear never reached the profile store").not.toBeNull();
    expect(stored?.cleared, "Earth is not recorded as cleared in the store").toBe(true);
    expect(stored?.beaconPlacedAt, "Earth's beacon has no placement date").not.toBeNull();
  }

  expect(["Briefing", "Preflight", "Flight"], `map routed to ${afterMap}`).toContain(afterMap);

  // --- Briefing -> Preflight -> Flight ------------------------------------
  if (afterMap === "Briefing") {
    await settle(page, 600);
    await press(page, "Enter");
  }
  await waitForScene(page, "Preflight", 60_000).catch(() => {});
  if ((await activeScenes(page)).includes("Preflight")) {
    // The ritual is a timed sequence; it may want keys or may run itself.
    for (let i = 0; i < 30; i++) {
      if (!(await activeScenes(page)).includes("Preflight")) break;
      await press(page, "Enter");
      await page.waitForTimeout(400);
    }
  }

  await mark("waiting for Flight");
  await waitForScene(page, "Flight", 90_000).catch(async (e) => {
    throw new Error(`never reached Flight. ${where()}\n${String(e)}`);
  });
  await mark("flight reached");
  expect(await activeScenes(page)).toContain("Flight");

  await expect(errors, `console/page errors during the run:\n${errors.join("\n")}`).toEqual([]);
});
