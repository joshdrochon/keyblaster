import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Type-only: erased before Playwright loads this file, so the scene's own debug
// contract is checked at compile time without bundling src into the runner.
import type { FlightDebugState } from "../../src/game/scenes/FlightScene.js";
import {
  freezeReloads,
  restartScene,
  snap,
  waitForScene,
  type GameHandle,
} from "./support/lane";

/**
 * ============================================================================
 * D09 - THE WARP SENTENCE IS MADE OF THE WORDS THE PLAYER BLASTED.
 * ============================================================================
 *
 * This is the one thing the game exists to do better than the reference
 * product. The decision log's Origin section names the defect: in Type Storm
 * the end-of-level sentence does not reuse the words just typed. D09 is the
 * fix, PRD section 8 tells the write-up to claim it, and the 1:45 beat of the
 * scripted demo is this screen.
 *
 * IT WAS NOT HAPPENING, and nothing failed. `FlightScene` spawned from a
 * private stand-in table in `flight/stage.ts`; `WarpScene` highlighted the
 * CONTENT BUNDLE'S POOL. Two different word lists, and the highlight was pool
 * membership rather than blast history - so a child could blast twenty words
 * and watch a different set light up, and a word they MISSED lit up exactly
 * like one they destroyed. Every existing warp test passed throughout, because
 * every one of them asserted the pool against itself.
 *
 * THIS SPEC IS THE TEST THAT WOULD HAVE CAUGHT IT. It flies a real belt, blasts
 * a chosen subset, deliberately lets one word of the warp sentence through, and
 * then asserts the DISTINCTION: the blasted words are highlighted and the
 * missed word is not. A highlight rule based on pool membership cannot pass it,
 * because "planet" is in Mars' pool and is never blasted here.
 *
 * Mars' sentence is "Mars is the red planet." (src/content/en/mars.json). Its
 * three content words - mars, red, planet - are all in the pool, which is what
 * AC-12.3 requires, and which is exactly why pool membership looked right.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EVIDENCE = join(REPO, "gauntlet", "evidence");

function writeEvidence(name: string, body: string): void {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, name), body);
}

const MARS_SENTENCE = "Mars is the red planet.";
/** The word the player will deliberately miss. It IS in Mars' pool. */
const MISSED_WORD = "planet";
/** The words the player will deliberately blast. Both are in the sentence. */
const BLASTED_WORDS = ["mars", "red"] as const;

type WarpSnapshot = {
  scene: string;
  stopId: string;
  sentence: string;
  highlightedText: string[];
  blastedWords: string[];
  missedWords: string[];
  letters: { char: string; color: string; alpha: number }[];
  coach: {
    note: string;
    source: string | null;
    failure: string | null;
    transport: string | null;
    calls: number;
  };
};

const flightState = (page: Page): Promise<FlightDebugState> =>
  page.evaluate(() => window.__kbFlight?.state() as FlightDebugState);

/**
 * Boot the WHOLE game, not the flight lane's own launcher.
 *
 * `src/game/flight/boot.ts` registers Flight, Hud and Stall only, so the
 * Flight -> Warp hand-off - the thing under test - is skipped there
 * (`checkStageEnd` finds no Warp scene and stays put). Booting through
 * `src/game/boot.ts` registers every discovered scene, so what runs here is
 * the shipped path.
 */
async function bootRealGame(page: Page): Promise<void> {
  await freezeReloads(page);
  // reducedMotion: the letter entrance tween is skipped, so letter alpha is the
  // steady-state highlight value from the first frame and not a tween sample.
  await page.goto("/?scene=Flight&reducedMotion=1");
  await expect(page.getByTestId("app")).toHaveAttribute("data-booted", "true");
  await page.waitForFunction(() => {
    const bag = (window as unknown as { __kb?: Record<string, unknown> }).__kb;
    return bag !== undefined && bag["game"] !== undefined;
  });
}

test.describe("D09 - the warp sentence is built from the blast history", () => {
  test("D09 + AC-12.3: a word the player MISSED is not highlighted, and the words they blasted are", async ({
    page,
  }) => {
    // A full belt plus a real breach plus a scene transition, on a canvas that
    // headless Chromium rasterises in software.
    test.setTimeout(180_000);

    await bootRealGame(page);

    // stageWordCount 3 so the stage ends once the board clears; maxLive is at
    // its floor so the belt serves as few words of its own as possible. The
    // three words this test cares about are put on the belt explicitly.
    await restartScene(page, "Flight", {
      stopId: "mars",
      debug: true,
      seed: 20260916,
      stageWordCount: 3,
      knobs: { maxLive: 2 },
      reducedMotion: true,
    });

    await page.waitForFunction(() => window.__kbFlight !== undefined, null, {
      timeout: 30_000,
    });
    await page.waitForFunction(
      () => (window.__kbFlight?.state().rocks.length ?? 0) > 0,
      null,
      { timeout: 30_000 },
    );

    // Put the three sentence words on the belt. `spawn` is the scene's existing
    // debug hook (gated behind `debug`), the same one the D25 park test uses;
    // it goes through `spawnRock`, so these are ordinary rocks in every way.
    const spawned = await page.evaluate(
      ([blast, miss]) => {
        const api = window.__kbFlight as NonNullable<typeof window.__kbFlight>;
        for (const word of blast as string[]) api.spawn(word);
        api.spawn(miss as string);
        return api.state().rocks.map((r) => r.word);
      },
      [[...BLASTED_WORDS], MISSED_WORD] as [string[], string],
    );
    expect(spawned).toEqual(expect.arrayContaining([...BLASTED_WORDS, MISSED_WORD]));

    // Blast everything on the belt EXCEPT the word we are deliberately missing.
    // Typed through the real window keydown listener, in one round trip, so no
    // rock can cross the breach line between two keystrokes of the same word.
    await page.evaluate((miss) => {
      const api = window.__kbFlight as NonNullable<typeof window.__kbFlight>;
      const press = (ch: string): void => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: ch, code: `Key${ch.toUpperCase()}` }),
        );
      };
      for (const rock of api.state().rocks) {
        if (rock.word === (miss as string)) continue;
        for (const ch of rock.word) press(ch);
      }
    }, MISSED_WORD);

    // Any rock that parked behind a longer rival fires on its own; give the
    // board a chance to settle down to just the missed word.
    await page.waitForFunction(
      (miss) =>
        (window.__kbFlight?.state().rocks ?? []).every(
          (r) => r.word === (miss as string),
        ),
      MISSED_WORD,
      { timeout: 30_000 },
    );

    // ---- The belt's own record, read before the hand-off tears it down. ----
    const flown = await flightState(page);
    for (const word of BLASTED_WORDS) expect(flown.blasted).toContain(word);
    expect(flown.blasted).not.toContain(MISSED_WORD);
    expect(flown.hull).toBe(3); // nothing has breached yet

    // Now let it through. This is the "deliberately miss one" step: no key is
    // pressed, the rock crosses the breach line, and the hull takes the hit.
    await page.waitForFunction(
      () => (window.__kbFlight?.state().hull ?? 3) < 3,
      null,
      { timeout: 60_000 },
    );

    // ---- The hand-off. ----
    await waitForScene(page, "Warp", 60_000);
    await page.waitForFunction(() => {
      const bag = (window as unknown as { __kb: Record<string, unknown> }).__kb;
      return bag["warp"] !== undefined;
    });
    // One more frame so `create()` has finished laying the letters out.
    await page.waitForTimeout(500);

    const warp = await snap<WarpSnapshot>(page, "warp");

    // The screen really is Mars' warp break with Mars' sentence.
    expect(warp.stopId).toBe("mars");
    expect(warp.sentence).toBe(MARS_SENTENCE);

    // === THE ASSERTION THIS SPEC EXISTS FOR ===
    //
    // "planet" is in Mars' asteroid pool and in Mars' warp sentence. Under the
    // old rule it was highlighted because the pool contained it. Under D09 it
    // is dark, because the player never shot it down.
    expect(warp.highlightedText).not.toContain("planet");
    expect(warp.blastedWords).not.toContain("planet");
    expect(warp.missedWords).toContain("planet");

    // ...and the words they DID blast are lit, in sentence order.
    expect(warp.highlightedText).toEqual(["Mars", "red"]);

    // The same claim in ink rather than in state: a highlighted word is drawn
    // brighter than a word the player never hit (WarpScene.paintLetters).
    const alphaOf = (word: string): number => {
      const at = MARS_SENTENCE.indexOf(word);
      // +1 skips the caret, which is on character 0 and is always full alpha.
      const letter = warp.letters[at + 1];
      if (letter === undefined) throw new Error(`no letter for "${word}"`);
      return letter.alpha;
    };
    expect(alphaOf("red")).toBeGreaterThan(alphaOf("planet"));
    expect(alphaOf("Mars")).toBeGreaterThan(alphaOf("planet"));

    // AC-15.5: Shadow is handed the word that got through, so the note can
    // name it. Before the hand-off carried `missed`, it never could.
    expect(warp.coach.calls).toBe(1);
    // D87: the build loop never makes a live paid call.
    expect(warp.coach.transport).toBe("mock");

    writeEvidence(
      "warp-blast-history.json",
      `${JSON.stringify(
        {
          decision: "D09",
          sentence: warp.sentence,
          blastedInFlight: flown.blasted,
          // Read from the hand-off, not from the belt: `__kbFlight` is torn
          // down by the transition, so the belt's own copy is pre-breach.
          missedHandedToWarp: warp.missedWords,
          highlightedInWarp: warp.highlightedText,
          deliberatelyMissed: MISSED_WORD,
          missedWordIsInStagePool: true,
          missedWordHighlighted: warp.highlightedText.includes("planet"),
          coachNote: warp.coach.note,
          coachSource: warp.coach.source,
          coachFailure: warp.coach.failure,
          coachTransport: warp.coach.transport,
          capturedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
  });

  // -------------------------------------------------------------------------
  // The same rule, isolated. These run in a second and are the ones that will
  // fail first if the pool ever creeps back in as a fallback.
  // -------------------------------------------------------------------------

  test("D09: the highlight follows the history it is given, word for word", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await freezeReloads(page);
    await page.goto("/?scene=Warp&stop=mars&reducedMotion=1");
    await expect(page.getByTestId("app")).toHaveAttribute("data-booted", "true");
    await page.waitForFunction(() => {
      const bag = (window as unknown as { __kb: Record<string, unknown> }).__kb;
      return bag["warp"] !== undefined;
    });

    // Three runs over the SAME stop and the SAME sentence. The only thing that
    // differs is what the player blasted, and the highlight tracks it exactly.
    // Under pool-membership highlighting all three would be identical.
    const runs: { blasted: string[]; expected: string[] }[] = [
      { blasted: ["mars", "red", "planet"], expected: ["Mars", "red", "planet"] },
      { blasted: ["red"], expected: ["red"] },
      { blasted: ["planet", "dust", "rust"], expected: ["planet"] },
    ];

    for (const run of runs) {
      await restartScene(page, "Warp", {
        stopId: "mars",
        blastHistory: {
          blasts: run.blasted.map((word, order) => ({
            word,
            order,
            atMs: order * 1000,
            fkLatencyMs: 400,
            ikiMs: [200, 200],
            wasCanister: false,
          })),
          misses: [],
        },
      });
      await page.waitForTimeout(500);
      const s = await snap<WarpSnapshot>(page, "warp");
      expect(s.sentence).toBe(MARS_SENTENCE);
      expect(s.highlightedText, `blasted ${run.blasted.join(",")}`).toEqual(
        run.expected,
      );
    }
  });

  test("D09: with no run behind it the sentence highlights NOTHING, not the pool", async ({
    page,
  }) => {
    // The regression guard. "Fall back to the pool when there is no history" is
    // the tempting fix, and it is the bug with a friendlier face: it makes the
    // screen claim the child blasted words it has no evidence they ever saw.
    test.setTimeout(90_000);
    await freezeReloads(page);
    await page.goto("/?scene=Warp&stop=mars&reducedMotion=1");
    await expect(page.getByTestId("app")).toHaveAttribute("data-booted", "true");
    await page.waitForFunction(() => {
      const bag = (window as unknown as { __kb: Record<string, unknown> }).__kb;
      return bag["warp"] !== undefined;
    });
    await page.waitForTimeout(500);

    const s = await snap<WarpSnapshot>(page, "warp");
    expect(s.sentence).toBe(MARS_SENTENCE);
    expect(s.blastedWords).toEqual([]);
    expect(s.highlightedText).toEqual([]);
  });

  test("D09: Flight spawns from the SHIPPED stage bundle, not a private table", async ({
    page,
  }) => {
    // The other half of the finding. Even a correct highlight rule is theatre
    // if the belt and the sentence are drawn from different vocabularies, so
    // the pool the belt flies is compared against the shipped content file.
    test.setTimeout(90_000);
    await freezeReloads(page);
    await page.goto("/?scene=Flight");
    await expect(page.getByTestId("app")).toHaveAttribute("data-booted", "true");

    // The module URLs are passed in rather than written as literals: a literal
    // makes tsc try to resolve a dev-server path that does not exist on disk.
    const { flownPool, bundlePool, sentence } = await page.evaluate(
      async ([stageUrl, contentUrl]) => {
        const stage = (await import(stageUrl as string)) as {
          stagePoolFor: (stop: string) => string[];
        };
        const content = (await import(contentUrl as string)) as {
          stageBundle: (stop: string) => {
            pool: string[];
            warpSentence: string | null;
          };
        };
        const bundle = content.stageBundle("mars");
        return {
          flownPool: [...stage.stagePoolFor("mars")],
          bundlePool: [...bundle.pool],
          sentence: bundle.warpSentence,
        };
      },
      ["/src/game/flight/stage.ts", "/src/game/scenes/lib/content.ts"] as const,
    );

    expect(flownPool).toEqual(bundlePool);
    // AC-12.3, restated as the reason the two lists must be the same one: every
    // content word of the sentence has to be spawnable by the belt.
    const contentWords = (sentence ?? "")
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.replace(/[^a-z']/g, ""))
      .filter((w) => w.length > 0 && !["is", "the", "of", "a", "and"].includes(w));
    for (const word of contentWords) expect(flownPool).toContain(word);
  });
});
