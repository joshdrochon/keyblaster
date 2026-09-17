import { expect, test } from "@playwright/test";
import {
  activeScenes,
  freezeReloads,
  settle,
  snap,
  texts,
  waitForScene,
} from "./support/lane.js";

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
 *
 * It also flies a WHOLE Mars belt with real keystrokes - 58 words at the
 * current stage length - so its budget is minutes, not seconds. That is the
 * price of proving the stage actually completes, and the stage completing is
 * the precondition for everything this spec asserts afterwards. The belt alone
 * is ~50 s of SCENE time, and headless software GL steps Phaser's clock at a
 * fraction of wall time that gets worse as the box gets busier, so the budget
 * is set for a loaded machine. It bounds a hang; it is not a speed target.
 */
test.describe.configure({ mode: "default", timeout: 1_800_000 });

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


/**
 * OBSERVING a live flight, which is not the same as driving it.
 *
 * This spec's rule is "no debug hooks to move between scenes, only to see where
 * you are", and reading the belt keeps that rule: the words come off the scene,
 * every keystroke that answers them goes through `page.keyboard`, and the stage
 * ends because the player cleared it. `FlightScene` publishes no debug bag
 * unless it was booted with `debug: true`, which the real Pre-flight hand-off
 * does not do - so the live rocks are read directly. `private` in TypeScript is
 * a compile-time claim, not a runtime one.
 */
interface BeltState {
  /** Live, unresolved rocks, with how far each has fallen. */
  rocks: { word: string; y: number }[];
  /** Words spawned so far, and how many the stage will spawn in total. */
  spawned: number;
  total: number;
  /** The scene's own "this stage is over" flag - the real end signal. */
  stageComplete: boolean;
}

async function beltState(page: import("@playwright/test").Page): Promise<BeltState> {
  return page.evaluate(() => {
    const kb = (window as unknown as {
      __kb: { game: { scene: { getScene(k: string): unknown } } };
    }).__kb;
    const scene = kb.game.scene.getScene("Flight") as
      | {
          rocks?: { word: string; container: { y: number }; resolved: boolean }[];
          spawnedCount?: number;
          stageComplete?: boolean;
          cfg?: { stageWordCount?: number };
        }
      | null;
    return {
      rocks: (scene?.rocks ?? [])
        .filter((r) => !r.resolved)
        .map((r) => ({ word: r.word, y: r.container.y })),
      spawned: scene?.spawnedCount ?? 0,
      total: scene?.cfg?.stageWordCount ?? 0,
      stageComplete: scene?.stageComplete === true,
    };
  });
}

/**
 * Clear the belt with real keystrokes until the stage ends.
 *
 * LOWEST ROCK FIRST. Whichever word is nearest the breach line is the one with
 * the least time left, so typing it first is both what a player does and what
 * keeps this test measuring the game instead of measuring CDP round-trip
 * latency. A rock that gets through is not a failure - the stage still ends,
 * the results still compute, and D31 says a miss is not a penalty - so the loop
 * does not assert on misses. It only has to reach the end of the stage.
 */
async function clearTheBelt(
  page: import("@playwright/test").Page,
  where: () => string,
): Promise<number> {
  let stallRestarts = 0;
  let last: BeltState = { rocks: [], spawned: 0, total: 0, stageComplete: false };
  for (let i = 0; i < 2000; i++) {
    const here = await activeScenes(page);
    // D30: the warp break is an OVERLAY launched on top of Flight, which keeps
    // running behind it. "Flight is gone" is therefore not the end of the
    // stage - the break opening is. Waiting on the wrong one of those spins
    // here until the test times out, and says nothing about the game.
    if (here.includes("Warp")) return stallRestarts;
    if (!here.includes("Flight")) return stallRestarts;
    // Three hull hits sink the ship into the stall card (D27/D29, never a
    // "game over"). Restarting the stage is the card's only action and is the
    // documented recovery (AC-4.3), so take it and keep flying. Capped, because
    // a stall LOOP is a real failure and must not look like a slow machine.
    if (here.includes("Stall")) {
      stallRestarts += 1;
      if (stallRestarts > 4) {
        throw new Error(
          `the belt stalled ${stallRestarts} times and never completed. ${where()}`,
        );
      }
      await page.keyboard.press("Enter");
      await page.waitForTimeout(600);
      continue;
    }
    last = await beltState(page);
    // The scene's own end-of-stage flag, which is set before Warp is launched.
    if (last.stageComplete) return stallRestarts;
    if (last.rocks.length === 0) {
      await page.waitForTimeout(120);
      continue;
    }
    // Lowest first, then the rest of the board in the same pass. Every live
    // word has a distinct first letter (AC-2.1), so typing them back to back is
    // unambiguous, and doing so keeps the number of CDP round trips down to
    // roughly one per word - which is what stops this measuring the harness.
    last.rocks.sort((a, b) => b.y - a.y);
    for (const rock of last.rocks) {
      await page.keyboard.type(rock.word);
    }
    await page.waitForTimeout(40);
  }
  throw new Error(
    `the Mars belt never ended (spawned ${last.spawned} of ${last.total}, ` +
      `${last.rocks.length} still live, ${stallRestarts} stall restarts). ${where()}`,
  );
}

/** Retype the warp sentence, which is built from the words just blasted (D09). */
async function typeTheWarpSentence(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __kb: Record<string, unknown> }).__kb["warp"] !== undefined,
    undefined,
    { timeout: 120_000 },
  );
  await settle(page, 600);
  const sentence = (await snap<{ sentence: string }>(page, "warp")).sentence;
  expect(sentence.length, "the warp break had no sentence to type").toBeGreaterThan(0);
  await page.keyboard.type(sentence);
}

/** Enter on the beacon's one button, until the Results screen is up. */
async function leaveBeaconForResults(
  page: import("@playwright/test").Page,
  where: () => string,
): Promise<{ wpm: number; accuracy: number }> {
  await pressUntilGone(page, "Beacon", 10);
  await waitForScene(page, "Results", 120_000).catch(async (e) => {
    throw new Error(`the beacon was placed but Results never opened. ${where()}\n${String(e)}`);
  });
  await page.waitForFunction(
    () => (window as unknown as { __kb: Record<string, unknown> }).__kb["results"] !== undefined,
    undefined,
    { timeout: 120_000 },
  );
  await settle(page, 900);
  return snap<{ wpm: number; accuracy: number }>(page, "results");
}

/**
 * Press Enter until a scene is no longer running.
 *
 * More than one press may be needed and that is not a workaround: Results can
 * raise the one-time relative-board prompt (D43) before its buttons, so the
 * first Enter answers the prompt and the second takes CONTINUE, which is the
 * primary target on purpose.
 */
async function pressUntilGone(
  page: import("@playwright/test").Page,
  sceneKey: string,
  tries: number,
): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (!(await activeScenes(page)).includes(sceneKey)) return;
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
  }
}

interface MapStop {
  stopId: string;
  charted: boolean;
  locked: boolean;
}

/** The map's own view of the route: what is lit and what is still shut. */
async function mapStops(page: import("@playwright/test").Page): Promise<MapStop[]> {
  return page.evaluate(() => {
    const kb = (window as unknown as {
      __kb: { game: { scene: { getScene(k: string): unknown } } };
    }).__kb;
    const scene = kb.game.scene.getScene("DirectorMap") as
      | { snapshot(): { stops: MapStopShape[] } }
      | null;
    interface MapStopShape {
      stopId: string;
      charted: boolean;
      locked: boolean;
    }
    return scene === null ? [] : scene.snapshot().stops;
  });
}

/** One stop as the PROFILE STORE holds it - the copy that survives a reload. */
async function storedStop(
  page: import("@playwright/test").Page,
  stopId: string,
): Promise<{ cleared: boolean; beaconPlacedAt: number | null } | null> {
  return page.evaluate((id) => {
    const kb = (window as unknown as {
      __kb: { services?: { store?: { activeProfile(): unknown } } };
    }).__kb;
    const profile = kb.services?.store?.activeProfile() as
      | { progress?: { stopId: string; cleared: boolean; beaconPlacedAt: number | null }[] }
      | null
      | undefined;
    return profile?.progress?.find((p) => p.stopId === id) ?? null;
  }, stopId);
}


/**
 * Light Earth's beacon and come back to the map.
 *
 * RETRIED, because one attempt is an assumption about timing, not about the
 * game. `typeWord` only registers once the word prompt is live, and on a loaded
 * box the scene's create + entrance tweens can still be running after a fixed
 * settle - so the keystrokes land nowhere, no Continue button appears, Enter
 * does nothing, and the wait for the map then fails 120 s later pointing at the
 * wait instead of at the cause. Re-checking the live scene each pass makes the
 * step wait for the screen to be READY rather than for a guessed duration.
 *
 * It still asserts the same thing: Earth must light and must hand back to the
 * map. Only the patience changed.
 */
async function lightEarth(
  page: import("@playwright/test").Page,
  where: () => string,
): Promise<void> {
  for (let i = 0; i < 8; i++) {
    if (!(await activeScenes(page)).includes("EarthActivation")) return;
    await typeWord(page, "launch");
    await settle(page, 700);
    await press(page, "Enter");
    await page.waitForTimeout(900);
  }
  if ((await activeScenes(page)).includes("EarthActivation")) {
    throw new Error(`Earth's beacon never lit after 8 attempts. ${where()}`);
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
    { timeout: 120_000 },
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
    await lightEarth(page, where);
    await waitForScene(page, "DirectorMap", 120_000);
  }

  // --- Director map: fly the first belt ----------------------------------
  await waitForScene(page, "DirectorMap", 120_000).catch(async (e) => {
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
    await lightEarth(page, where);
    await waitForScene(page, "DirectorMap", 120_000).catch(async (e) => {
      throw new Error(`Earth lit but never handed back to the map. ${where()}\n${String(e)}`);
    });
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
  await waitForScene(page, "Preflight", 120_000).catch(() => {});
  if ((await activeScenes(page)).includes("Preflight")) {
    // The ritual is a timed sequence; it may want keys or may run itself.
    for (let i = 0; i < 30; i++) {
      if (!(await activeScenes(page)).includes("Preflight")) break;
      await press(page, "Enter");
      await page.waitForTimeout(400);
    }
  }

  await mark("waiting for Flight");
  await waitForScene(page, "Flight", 120_000).catch(async (e) => {
    throw new Error(`never reached Flight. ${where()}\n${String(e)}`);
  });
  await mark("flight reached");
  expect(await activeScenes(page)).toContain("Flight");

  // --- Fly the Mars belt to the end of the stage --------------------------
  const stalls = await clearTheBelt(page, where);
  await mark("belt cleared");

  /**
   * SURVIVABILITY, MEASURED AGAINST THE REAL SCENE.
   *
   * `tests/unit/simulation/belt.test.ts` answers "is a belt survivable" with a
   * simulation that shares the ENGINE with `FlightScene` and shares none of its
   * loop. That simulation reported zero stalls while this spec was red with
   * "the belt stalled 5 times and never completed", and both were telling the
   * truth: the three players it asserts about (accuracy 0.88-0.97) all sit
   * above the 94.8% a three-mark hull demanded of a 58-word stage, so the
   * population it measured excluded every player who could fail. The grade-2
   * tail was not in it. Asked about that child, the same harness reports 58
   * stalls in 100.
   *
   * So the loop below now RECORDS what it always tolerated. The restart path
   * stays - a stall must not hang this spec - but a stage that stalls at all is
   * a failure here, and this is the only check in the suite where that claim is
   * made about the scene the child actually flies rather than about a model of
   * it.
   */
  expect(
    stalls,
    `the belt stalled ${stalls} time(s) on the real scene. ${where()}`,
  ).toBe(0);

  // --- Warp break: retype the sentence made of the words just blasted -----
  await waitForScene(page, "Warp", 120_000).catch(async (e) => {
    throw new Error(`the belt ended but the warp break never opened. ${where()}\n${String(e)}`);
  });
  await mark("warp break");
  await typeTheWarpSentence(page);

  // --- Beacon placement --------------------------------------------------
  await waitForScene(page, "Beacon", 120_000).catch(async (e) => {
    throw new Error(`the warp charged but the beacon never dropped. ${where()}\n${String(e)}`);
  });
  await mark("beacon");
  await settle(page, 900);

  // --- Results -----------------------------------------------------------
  const results = await leaveBeaconForResults(page, where);
  await mark("results");

  // BUG 2. "words per minute 0" next to three stars, after a real stage. The
  // tally never left FlightScene, so `computeStageResults` was handed zeroes.
  // A results screen that always says 0 is worse than no results screen.
  expect(
    results.wpm,
    `the results screen reported ${results.wpm} wpm after a played stage`,
  ).toBeGreaterThan(0);
  expect(Number.isFinite(results.wpm)).toBe(true);
  expect(results.accuracy).toBeGreaterThan(0);

  // First run at Mars: there is no previous best here, so the screen must say
  // nothing rather than "your best here: 0 wpm".
  const resultsText = (await texts(page, "results")).join(" ").toLowerCase();
  expect(
    resultsText,
    'a first run has no previous best, so "your best here: 0 wpm" must not appear',
  ).not.toContain("best here: 0");

  // --- Back to the map: Jupiter must be open -----------------------------
  await pressUntilGone(page, "Results", 8);
  await waitForScene(page, "DirectorMap", 120_000).catch(async (e) => {
    throw new Error(`Results never returned to the map. ${where()}\n${String(e)}`);
  });
  await mark("back on the map");
  await settle(page, 900);

  // BUG 1. The player cleared Mars, placed its beacon, and the map still read
  // "Jupiter: Locked". The rule in @engine/progress was right the whole time;
  // the cleared array was dropped somewhere between Flight and the map.
  const afterRun = await mapStops(page);
  expect(
    afterRun.find((r) => r.stopId === "mars")?.charted,
    "Mars' beacon is placed but the map does not show it charted",
  ).toBe(true);
  expect(
    afterRun.find((r) => r.stopId === "jupiter")?.locked,
    "Mars is cleared and its beacon is placed, so Jupiter must be unlocked",
  ).toBe(false);

  // --- And it has to survive a reload ------------------------------------
  // AC-7.2 / D44. An in-session unlock that evaporates on reload is the same
  // dead end one page refresh later, so the payload chain is not enough on its
  // own: the clear has to be in the profile store.
  await page.reload();
  await expect(page.getByTestId("app")).toHaveAttribute("data-booted", "true");
  const storedMars = await storedStop(page, "mars");
  expect(storedMars, "Mars' clear never reached the profile store").not.toBeNull();
  expect(storedMars?.cleared, "Mars is not recorded as cleared in the store").toBe(true);
  expect(storedMars?.beaconPlacedAt, "Mars' beacon has no placement date").not.toBeNull();

  // The map drawn from a cold boot - no init payload anywhere - must agree.
  await page.goto("/?scene=DirectorMap");
  await expect(page.getByTestId("app")).toHaveAttribute("data-booted", "true");
  await waitForScene(page, "DirectorMap", 120_000);
  await settle(page, 900);
  const afterReload = await mapStops(page);
  expect(
    afterReload.find((r) => r.stopId === "jupiter")?.locked,
    "Jupiter locked again after a reload - the clear did not survive",
  ).toBe(false);
  expect(
    afterReload.filter((r) => r.charted).map((r) => r.stopId),
    "Earth and Mars should both be lit after a reload",
  ).toEqual(expect.arrayContaining(["earth", "mars"]));

  await expect(errors, `console/page errors during the run:\n${errors.join("\n")}`).toEqual([]);
});
