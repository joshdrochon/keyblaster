import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { PROGRESS_VARIANTS, charted, mount, snapshot } from "./story-lane";
import {
  bootScene,
  freezeReloads,
  restartScene,
  settle,
  snap,
} from "./support/lane";

const HERE = dirname(fileURLToPath(import.meta.url));

const earthBundle = JSON.parse(
  readFileSync(resolve(HERE, "../../src/content/en/earth.json"), "utf8"),
) as { activationWord: string };

/**
 * AC-18.1: THE FORWARD ACTION HOLDS FOCUS ON ENTRY.
 *
 * One spec for the whole rule rather than a line buried in each screen's own
 * suite, because the rule is about CONSISTENCY: the value of "continue is the
 * default" is that it is the default EVERYWHERE, and a rule that is asserted in
 * five separate files is a rule that gets half-changed.
 *
 * The defect this covers: the stage report opened with the ring on "fly it
 * again", so the obvious next action - carry on with the run - needed a key
 * press before Enter would do it, and a child pressing Enter on reflex silently
 * re-flew the stage they had just finished. Replay, retry and back are never
 * the default; the forward action always is.
 *
 * The mechanism is `FocusTarget.primary` in `scenes/lib/kit.ts`, so these tests
 * assert the OUTCOME (which id holds focus) rather than the flag - a screen
 * that got the forward action right by list order would pass too, and should.
 */

/**
 * Type Earth's activation word, one letter at a time, CONFIRMING EACH ONE.
 *
 * `typeWord` presses on a fixed delay, and this suite runs three workers
 * software-rendering 1920x1080 WebGL, so the game clock can fall far enough
 * behind wall time that a key lands before the prompt is listening and is
 * simply lost. Retrying against the screen's own `typed` readout makes the
 * test wait for the game rather than for a guess about the machine - the
 * alternative, a longer sleep, is a number that goes stale on the next laptop.
 */
async function typeActivationWord(page: Page, word: string): Promise<void> {
  const typed = async (): Promise<string> =>
    String((await snapshot(page, "EarthActivation"))["typed"] ?? "");

  for (let i = 0; i < word.length; i += 1) {
    const letter = word[i] as string;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if ((await typed()).length > i) break;
      await page.keyboard.press(letter);
      await page.waitForTimeout(60);
    }
  }
  expect(await typed()).toBe(word);
}

const STOPS = ["earth", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"] as const;

/**
 * A full profile for the Results screen.
 *
 * `relativeBoard` is the lever these specs care about: false means the D43
 * one-time opt-in prompt is on screen (and holds the caret), true means it is
 * not (and `continue` holds the caret). Handed to the scene explicitly so the
 * fixture cannot write itself into a real save.
 */
function resultsProfile(relativeBoard: boolean): Record<string, unknown> {
  return {
    id: "pilot-test",
    name: "Ada",
    avatar: "avatar-1",
    shipId: "ship-1",
    shipName: "Lantern",
    createdAt: 1,
    calibration: { ikiMs: 350, fkLatencyMs: 500 },
    settings: {
      musicVolume: 0.7,
      sfxVolume: 0.8,
      keyboardLayout: "qwerty",
      uiLang: "en",
      contentLang: "en",
      inputMethod: "latin",
      uppercase: false,
      increasedLetterSpacing: false,
      reducedMotion: false,
      colorblindPalette: false,
      relativeBoard,
    },
    progress: STOPS.map((stopId) => ({
      stopId,
      cleared: stopId === "earth" || stopId === "mars",
      stars: 3,
      bestWpm: stopId === "mars" ? 22 : 0,
      bestAccuracy: 0.95, // fraction, as the engine produces it
      lastWpm: 20,
      lastAccuracy: 94,
      beaconPlacedAt: stopId === "earth" || stopId === "mars" ? 1 : null,
    })),
    trophies: [],
    unlockedShips: ["ship-1"],
    unlockedSkins: [],
    words: {},
  };
}

const STAGE_TALLY = {
  characters: 210,
  elapsedMs: 60_000,
  hits: 12,
  typos: 3,
  hullHits: 0,
};

test.describe("AC-18.1: the forward action is focused on entry", () => {
  // Headless Chromium software-renders 1920x1080 WebGL, so in-game time runs
  // at a fraction of wall time. Every wait below is on a game-state condition,
  // but the ceiling still has to allow for it.
  test.setTimeout(120_000);

  test("AC-18.1: Results opens on `continue`, not on replay", async ({ page }) => {
    await bootScene(page, "Results", "results");
    // Opted in, so the one-time D43 prompt is NOT on screen and the only
    // choice is the one this test is about: replay versus continue.
    await restartScene(page, "Results", {
      stopId: "mars",
      profile: resultsProfile(true),
      tally: STAGE_TALLY,
      exposures: [],
    });
    await settle(page);

    const snapshotValue = await snap<{ focusId: string; focusIds: string[] }>(page, "results");

    // Both choices are on screen: this is a real fork, not a screen with one
    // button that trivially satisfies the rule.
    expect(snapshotValue.focusIds).toContain("replay");
    expect(snapshotValue.focusIds).toContain("continue");
    expect(snapshotValue.focusId).toBe("continue");
  });

  test("AC-18.1 + D43: the one-time prompt holds focus while it is asking, and `continue` takes it back", async ({
    page,
  }) => {
    // THE ONE EXCEPTION, and the reason it is one. "The forward action is the
    // default" is a rule about replay-versus-continue. It is not a licence to
    // focus past a question the screen is asking - a one-time opt-in the
    // default action skips is an opt-in nobody ever answers.
    await bootScene(page, "Results", "results");
    await restartScene(page, "Results", {
      stopId: "mars",
      profile: resultsProfile(false),
      tally: STAGE_TALLY,
      exposures: [],
      relativeBoard: [{ label: "a pilot", wpm: 20, isYou: false }],
    });
    await settle(page);

    const asking = await snap<{
      focusId: string;
      focusIds: string[];
      promptShown: boolean;
    }>(page, "results");

    expect(asking.promptShown).toBe(true);
    expect(asking.focusIds.slice(0, 2)).toEqual(["board-yes", "board-no"]);
    expect(asking.focusId).toBe("board-yes");

    // Answer it. The screen rebuilds, there is no longer a question, and the
    // forward action is the default again - never replay.
    //
    // Waits on `optedIn`, not on `promptShown`: the latter is sticky by design
    // (it records that the question WAS asked this session, which is what D43's
    // "ask once" claim is checked against) and never goes back to false.
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => {
        const bag = (window as unknown as { __kb: Record<string, unknown> }).__kb;
        const entry = bag["results"] as { snapshot(): { optedIn: boolean } };
        return entry.snapshot().optedIn === true;
      },
      null,
      { timeout: 60_000 },
    );

    const answered = await snap<{ focusId: string; focusIds: string[] }>(page, "results");
    expect(answered.focusIds).toContain("replay");
    expect(answered.focusId).toBe("continue");
  });

  test("AC-18.1: Stall opens on its one control, and that control is the forward one", async ({
    page,
  }) => {
    // A stall offers exactly one thing to do - fly the stage again - so the
    // forward action and the only action are the same control. The screen says
    // which one holds focus rather than leaving it implied by there being one.
    // `StallScene` publishes `window.__kbStall` rather than a slot inside
    // `__kb`, so it cannot use `bootScene`'s bag wait.
    await freezeReloads(page);
    await page.goto("/?scene=Stall");
    await page.waitForFunction(() => window.__kbStall !== undefined, null, {
      timeout: 60_000,
    });

    const focusId = await page.evaluate(() => window.__kbStall?.focusId() ?? null);
    expect(focusId).toBe("stall.restart");

    const texts = await page.evaluate(() => window.__kbStall?.texts() ?? []);
    expect(texts.length).toBe(3);
  });

  test("AC-18.1: Beacon opens on `beacon-continue`", async ({ page }) => {
    await bootScene(page, "Beacon", "beacon", "&stop=mars");
    await settle(page);
    const snapshotValue = await snap<{ focusId: string }>(page, "beacon");
    expect(snapshotValue.focusId).toBe("beacon-continue");
  });

  test("AC-18.1: Briefing opens on `launch`", async ({ page }) => {
    await mount(page, "Briefing", {
      stopId: "mars",
      progress: PROGRESS_VARIANTS.marsOnly,
    });
    const snapshotValue = await snapshot(page, "Briefing");
    expect(snapshotValue["focusId"]).toBe("launch");
  });

  test("AC-18.1: Earth activation opens on `continue` once the beacon is lit", async ({
    page,
  }) => {
    await mount(page, "EarthActivation");
    // Read once before typing. `mount` waits for a snapshot, but the word
    // prompt only starts accepting keys on the frame after that, and a key
    // pressed before it does is a key the screen never sees.
    const before = await snapshot(page, "EarthActivation");
    expect(before["beaconLit"]).toBe(false);

    // The continue button only exists after the beacon is lit; before that the
    // screen is a prompt and there is nothing to focus. Drive it the way a
    // child does - the keyboard - and then check where the caret landed.
    await typeActivationWord(page, earthBundle.activationWord);
    await page.waitForFunction(
      () => {
        const scene = window.__kb?.game.scene.getScene("EarthActivation") as
          | { snapshot(): { beaconLit: boolean } }
          | null;
        return scene?.snapshot().beaconLit === true;
      },
      null,
      { timeout: 60_000 },
    );

    // The button fades in 1100 ms of GAME time after the light; headless
    // Chromium runs that clock slow, so wait on the state, never on a sleep.
    await page.waitForFunction(
      () => {
        const scene = window.__kb?.game.scene.getScene("EarthActivation") as
          | { snapshot(): Record<string, unknown> }
          | null;
        return scene?.snapshot()["focusId"] === "continue";
      },
      null,
      { timeout: 60_000 },
    );

    const snapshotValue = await snapshot(page, "EarthActivation");
    expect(snapshotValue["focusId"]).toBe("continue");
  });
});
