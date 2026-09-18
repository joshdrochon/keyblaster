import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { FlightDebugState } from "../../src/game/scenes/FlightScene.js";
import { bootFlight, type FlightState, type RockView } from "./support/flightBoot.js";

/**
 * D101, AC-26.1: A TWO-LAYER ROCK, PLAYED IN A BROWSER.
 *
 * ================== WHY THIS EXISTS BESIDE THE UNIT TESTS ==================
 * `tests/unit/nested/` proves the arithmetic, `tests/unit/flight/plateSeparation`
 * proves the geometry over 3456 boards and `tests/unit/simulation/nestedRoute`
 * proves nobody loses a belt to it. All three are simulations. None of them
 * would notice if the SCENE never swapped the plate, never redrew the body,
 * never told the lock machine about the second word, or drew the core's plate
 * on top of the shell's - and this project has been bitten more than once by a
 * green suite sitting on top of a game a human breaks in thirty seconds
 * (`docs/verification-gaps.md`, and CLAUDE.md's note on the game-mechanics
 * agent).
 *
 * So this one does what a child does: finds the big rock, types the word on it,
 * looks at what is left, and types that.
 *
 * ================== WHAT IS ASSERTED, IN ORDER ==================
 *   1. a rock arrives with a shell (`shellIntact`) and a hidden second word
 *   2. the shell is visibly bigger than every ordinary rock on the board
 *   3. the two words start with DIFFERENT letters (AC-2.1 at the reveal)
 *   4. typing the shell's word does NOT destroy the rock
 *   5. the SAME rock is now carrying the other word, is smaller, and its plate
 *      moved with it
 *   6. the rock keeps falling on the same column - it does not jump or re-aim
 *   7. typing the second word destroys it, and the score moved twice
 */

test.use({ trace: "off" });

const EVIDENCE_DIR = resolve(process.cwd(), "gauntlet/evidence");

const state = (page: Page): Promise<FlightState> =>
  page.evaluate(() => window.__kbFlight?.state() as FlightDebugState);

/** The real keystroke path the scene listens on (`FlightScene.bindInput`). */
async function typeWord(page: Page, word: string): Promise<void> {
  await page.evaluate((text) => {
    for (const ch of text as string) {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: ch,
          code: `Key${ch.toUpperCase()}`,
          bubbles: true,
        }),
      );
    }
  }, word);
}

/** Wait until a rock with an unbroken shell is on the board. */
async function waitForShelledRock(page: Page): Promise<RockView> {
  await page.waitForFunction(
    () => (window.__kbFlight?.state().rocks ?? []).some((r) => r.shellIntact),
    null,
    { timeout: 60_000 },
  );
  const s = await state(page);
  return s.rocks.find((r) => r.shellIntact) as RockView;
}

test.describe("D101: two-layer rocks at Neptune", () => {
  test("AC-26.1: the shell breaks, a second word appears, and typing it destroys the rock", async ({
    page,
  }) => {
    // A SLOW PILOT'S CALIBRATION, which is a shipped configuration and not a
    // test hook: FR-8 scales fall time by it, and a headless software-GL page
    // renders this scene at a few frames a second. Without it the rock reaches
    // the breach line before the assertions do, which is the runner's problem
    // and not the game's.
    await bootFlight(page, {
      stopId: "neptune",
      seed: 20260918,
      stageWordCount: 40,
      calibration: { ikiMs: 1400, fkLatencyMs: 1600 },
      knobs: { maxLive: 3 },
    });

    // WAIT FOR IT TO COME DOWN BEFORE LOOKING AT IT. A rock spawns at
    // `-sizePx`, so a shell's centre starts 168 px ABOVE the frame and the
    // evidence frame would be an arc at the top edge - which is not a picture
    // of anything and is how a visual artifact comes to be trusted while
    // showing nothing.
    await page.waitForFunction(
      () => {
        const r = (window.__kbFlight?.state().rocks ?? []).find((x) => x.shellIntact);
        return r !== undefined && r.y > 300;
      },
      null,
      { timeout: 60_000 },
    );
    const shelled = await waitForShelledRock(page);

    // 1. It really is a two-layer rock, and the second word is real.
    expect(shelled.shellIntact, "the rock arrived with a shell").toBe(true);
    expect(shelled.coreWord, "the shell is hiding a word").not.toBeNull();
    expect(shelled.crackedShellWord).toBeNull();

    // 2. AC-26.2: bigger than every ordinary rock on this board, and bigger
    //    than the biggest an ordinary rock can be (render/asteroid MAX_SIZE_PX).
    const before = await state(page);
    const ordinary = before.rocks.filter((r) => r.id !== shelled.id);
    expect(shelled.sizePx, "a shell is bigger than the biggest ordinary rock").toBeGreaterThan(
      140,
    );
    for (const r of ordinary) {
      expect(shelled.sizePx, `bigger than "${r.word}"`).toBeGreaterThan(r.sizePx);
    }

    // 3. AC-2.1 AT THE REVEAL. The word about to appear must not collide with
    //    anything already falling, including the shell being typed right now.
    const liveFirstLetters = before.rocks.map((r) => r.word[0]);
    const coreWord = shelled.coreWord as string;
    expect(coreWord).not.toBe(shelled.word);
    expect(
      liveFirstLetters.includes(coreWord[0] as string),
      `the core "${coreWord}" collides with a live word on "${coreWord[0]}"`,
    ).toBe(false);

    const scoreBefore = before.score;
    const hitsBefore = before.hits;

    // D83: the shell is drawn in code, and a human has to be able to look at
    // it. No assertion can say "this reads as a rock with a skin", so the two
    // frames are captured and named instead - `render/asteroid.drawNestedShell`
    // is the wall and the joins, and this is what they came out as.
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    await page.screenshot({ path: join(EVIDENCE_DIR, "nested-shell.png") });

    // 4 + 5. Type the shell's word. The rock must SURVIVE and change.
    await typeWord(page, shelled.word);
    await page.waitForFunction(
      (id) => {
        const rock = (window.__kbFlight?.state().rocks ?? []).find((r) => r.id === id);
        return rock !== undefined && !rock.shellIntact;
      },
      shelled.id,
      { timeout: 10_000 },
    );

    const mid = await state(page);
    const cracked = mid.rocks.find((r) => r.id === shelled.id) as RockView;
    expect(cracked, "the rock survived the shell coming off").toBeDefined();
    expect(cracked.word, "the plate now carries the core's word").toBe(coreWord);
    expect(cracked.crackedShellWord, "and remembers which shell it was").toBe(shelled.word);
    expect(cracked.coreWord, "there is nothing left inside").toBeNull();
    expect(cracked.sizePx, "the core is smaller than its shell").toBeLessThan(shelled.sizePx);
    // The plate moved with it rather than being left where the shell's was.
    expect(Math.abs(cracked.plateY - cracked.y), "the plate hangs under the core").toBeLessThan(
      Math.abs(shelled.plateY - shelled.y),
    );
    // The shell scored as a completed word.
    expect(mid.score, "the shell paid").toBeGreaterThan(scoreBefore);
    expect(mid.hits).toBe(hitsBefore + 1);

    // 6. SAME TRAJECTORY. The rock does not jump sideways, does not re-aim and
    //    keeps the budget it was granted - `nestedFallMs` gave the pair one
    //    constant-rate descent for exactly this reason.
    expect(cracked.travelPx, "the angle is unchanged").toBeCloseTo(shelled.travelPx, 6);
    expect(cracked.fallMs, "the deadline is unchanged").toBeCloseTo(shelled.fallMs, 6);
    expect(cracked.y, "it kept falling rather than jumping").toBeGreaterThanOrEqual(shelled.y);

    // The shards, the ring and the smaller rock, once the burst has landed.
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(EVIDENCE_DIR, "nested-core.png") });

    // 7. Type the second word. NOW it dies.
    await typeWord(page, coreWord);
    await page.waitForFunction(
      (id) => !(window.__kbFlight?.state().rocks ?? []).some((r) => r.id === id),
      shelled.id,
      { timeout: 10_000 },
    );

    const after = await state(page);
    expect(after.rocks.some((r) => r.id === shelled.id), "the rock is gone").toBe(false);
    expect(after.hits, "both layers counted as words").toBe(hitsBefore + 2);
    // AC-26.5: the crack bonus lands on the core's blast, so the second
    // payment is bigger than the first even though the core is the shorter job
    // as often as not.
    expect(after.score, "the core paid too").toBeGreaterThan(mid.score);
    expect(after.blasted).toContain(shelled.word);
    expect(after.blasted).toContain(coreWord);

    writeFileSync(
      join(EVIDENCE_DIR, "nested-rock-play.json"),
      `${JSON.stringify(
        {
          decision: "D101",
          claim:
            "AC-26.1: at Neptune a rock arrives with a shell; typing the shell's word breaks only the shell and reveals a smaller rock carrying a different word on the same trajectory; typing that word destroys the rock.",
          measure: "tests/e2e/nested-rocks.spec.ts",
          shell: {
            word: shelled.word,
            sizePx: shelled.sizePx,
            y: Number(shelled.y.toFixed(1)),
            fallMs: Math.round(shelled.fallMs),
            travelPx: Number(shelled.travelPx.toFixed(2)),
          },
          core: {
            word: coreWord,
            sizePx: cracked.sizePx,
            y: Number(cracked.y.toFixed(1)),
            fallMs: Math.round(cracked.fallMs),
            travelPx: Number(cracked.travelPx.toFixed(2)),
          },
          firstLetters: [shelled.word[0], coreWord[0]],
          scoreShell: mid.score - scoreBefore,
          scoreCore: after.score - mid.score,
          hits: { before: hitsBefore, after: after.hits },
        },
        null,
        2,
      )}\n`,
    );
  });

  test("AC-26.1: Mars never puts a second word inside a rock", async ({ page }) => {
    // The other half of "Neptune and Pluto only", and the cheap one to get
    // wrong: a stop list that is read but never checked is a stop list that
    // quietly becomes every stop.
    await bootFlight(page, {
      stopId: "mars",
      seed: 20260918,
      stageWordCount: 40,
      calibration: { ikiMs: 900, fkLatencyMs: 1200 },
      knobs: { maxLive: 4 },
    });
    await page.waitForFunction(
      () => (window.__kbFlight?.state().rocks.length ?? 0) >= 3,
      null,
      { timeout: 30_000 },
    );
    for (let i = 0; i < 12; i += 1) {
      const s = await state(page);
      expect(
        s.rocks.some((r) => r.shellIntact),
        `Mars spawned a two-layer rock: ${JSON.stringify(
          s.rocks.filter((r) => r.shellIntact).map((r) => [r.word, r.coreWord]),
        )}`,
      ).toBe(false);
      await page.waitForTimeout(400);
    }
  });
});
