import { expect, test, type Page } from "@playwright/test";
import { gameCanvas } from "./support/lane.js";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GRADE_WORDS,
  expectNoPunishment,
  mount,
  remount,
  setStoredCalibration,
  snapshot,
  storedCalibration,
  transitions,
  typeWord,
} from "./story-lane";

/**
 * Screen inventory row 5 - Pre-flight (D51, D81, PRD FR-11).
 *
 * ACs covered: AC-11.1 (the ritual produces a median inter-key interval and a
 * median first-key latency from D81's three steps), AC-11.2 (a returning
 * profile is never shown the full ~20 s ritual again), AC-11.3 (no score,
 * accuracy or pass/fail appears during it), AC-11.4 / AC-11.5 / AC-11.6 (D99's
 * launch ceremony), AC-22b.1, D51 (5-20 seconds).
 *
 * WHAT D99 CHANGED IN THIS FILE. Two tests here used to assert that a returning
 * pilot "never types" and that `stepsMeasured` is 0 - they were the check that
 * a returning pilot gets the costume with nothing underneath, which is exactly
 * what UR-28 reports as a bug and asks to have replaced. They are
 * rewritten, not deleted: what survives is the part D51 was actually protecting
 * - the returning pilot is never made to pay the ~20 s ritual again - and what
 * replaces the rest is the ceremony's own contract.
 *
 * AC-11.3 is tested by SAMPLING THE WHOLE SEQUENCE, not by looking once at the
 * end: the failure mode it guards against is a number that flashes up between
 * steps. `snapshot().text` carries every string the scene is rendering at that
 * instant, so the sampler sees what a child would see.
 *
 * WHAT DECIDES WHETHER THE RITUAL RUNS, AND WHY THIS FILE CHANGED.
 *
 * It used to be `newProfile`, an init-payload flag - and NOTHING IN `src/` EVER
 * SET IT. Every screen that can reach Pre-flight passes `false`, so the ritual
 * never ran for any child and `calibration.ikiMs` stayed on FR-8's 350 ms
 * default for ever. These tests passed throughout, because they set the flag
 * themselves: the suite was the only caller the feature had.
 *
 * So the question is now asked of the PROFILE, and these tests put the profile
 * in the state they are about. "A new pilot" is a profile the game has never
 * measured; "a returning pilot" is one it has. A flag a test sets cannot be the
 * definition of either, which is the whole lesson of the defect.
 */

/** A pilot the game has already measured - i.e. a returning one (AC-11.2). */
const MEASURED = { ikiMs: 412, fkLatencyMs: 538 };

/**
 * Mount Pre-flight for a pilot with a stored baseline.
 *
 * Mount first, then write the baseline, then rebuild: `create()` reads the
 * store, so the profile has to be in the right state before the scene is built,
 * and a page boot is the only thing that creates the profile in the first place.
 */
async function mountReturning(
  page: Page,
  data: { stopId: string },
): Promise<void> {
  await mount(page, KEY, data);
  await setStoredCalibration(page, MEASURED);
  await remount(page, KEY, data);
}

const HERE = dirname(fileURLToPath(import.meta.url));

const KEY = "Preflight";
const EVIDENCE = resolve(HERE, "../../gauntlet/evidence");

interface Sample {
  text: string[];
  phase: string;
  rowStates: string[];
  currentWord: string | null;
  elapsedMs: number;
}

/** Poll the scene while `keepGoing` holds, collecting everything drawn. */
async function sample(
  page: Page,
  keepGoing: (s: Sample) => boolean,
  onTick: (s: Sample) => Promise<void>,
  limitMs = 150_000,
): Promise<Sample[]> {
  const out: Sample[] = [];
  const deadline = Date.now() + limitMs;
  for (;;) {
    const raw = (await snapshot(page, KEY)) as unknown as Sample & { scene: string };
    out.push(raw);
    if (!keepGoing(raw)) return out;
    if (Date.now() > deadline) throw new Error(`pre-flight did not finish in ${limitMs} ms`);
    await onTick(raw);
    await page.waitForTimeout(200);
  }
}

function expectNoGrades(samples: readonly Sample[]): void {
  for (const s of samples) {
    for (const line of s.text) {
      for (const re of GRADE_WORDS) {
        expect(line, `AC-11.3: grade-shaped text on screen during "${s.phase}": ${line}`).not.toMatch(re);
      }
    }
    expectNoPunishment(s.text);
  }
}

test.describe("Pre-flight (row 5, D51/FR-11)", () => {
  test("AC-11.1 a new profile runs D81's three steps and yields both medians", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    // No flag. A freshly booted page has a profile the game has never measured,
    // which is exactly the pilot AC-11.1 is about - and, before this round, the
    // pilot the shipped game silently skipped.
    await mount(page, KEY, { stopId: "mars" });

    const first = await snapshot(page, KEY);
    expect(first.calibrating).toBe(true);
    expect(first["stepIds"]).toEqual(["hull", "systems", "engines"]);

    const typed = new Set<string>();
    const samples = await sample(
      page,
      (s) => s.phase !== "done",
      async (s) => {
        if (s.phase === "typing" && s.currentWord !== null && !typed.has(s.currentWord)) {
          typed.add(s.currentWord);
          await typeWord(page, s.currentWord, 40);
        }
      },
    );

    const final = await snapshot(page, KEY);
    expect(final["stepsMeasured"]).toBe(3);
    expect(final["rowStates"]).toEqual(["lit", "lit", "lit"]);

    // AC-11.1: both medians exist and are physically plausible.
    const cal = final["calibration"] as { ikiMs: number; fkLatencyMs: number };
    expect(Number.isFinite(cal.ikiMs)).toBe(true);
    expect(Number.isFinite(cal.fkLatencyMs)).toBe(true);
    expect(cal.ikiMs).toBeGreaterThan(0);
    expect(cal.fkLatencyMs).toBeGreaterThan(0);

    // AC-11.1 "stored on the profile". THIS IS THE HALF THAT WAS MISSING: the
    // ritual's answer used to travel to Flight as scene data and nowhere else,
    // so twenty seconds of measurement bought one stage and was gone on reload.
    // Nothing in `src/` called `applyCalibration` at all.
    const stored = await storedCalibration(page);
    expect(stored, "the ritual measured the pilot and told nobody").not.toBeNull();
    expect(stored?.ikiMs).toBe(cal.ikiMs);
    expect(stored?.fkLatencyMs).toBe(cal.fkLatencyMs);
    // And it is no longer the shipped default, or the belt is still being flown
    // for a child who is not there (FR-8: 350 / 500).
    expect(stored?.ikiMs === 350 && stored?.fkLatencyMs === 500).toBe(false);

    // AC-11.3, over every frame we sampled, including the ones between steps.
    expectNoGrades(samples);
    expect(await transitions(page)).toContain("Flight");
  });

  test("AC-11.3 nothing on screen is a score, an accuracy or a pass/fail", async ({ page }) => {
    test.setTimeout(240_000);
    await mount(page, KEY, { stopId: "jupiter" });

    const typed = new Set<string>();
    const samples = await sample(
      page,
      (s) => s.phase !== "done",
      async (s) => {
        if (s.phase === "typing" && s.currentWord !== null && !typed.has(s.currentWord)) {
          typed.add(s.currentWord);
          // Deliberately fumble the first key: a mistyped key must produce no
          // tally, no colour change and nothing that reads as a verdict.
          await page.keyboard.press("z");
          await typeWord(page, s.currentWord, 36);
        }
      },
    );
    expectNoGrades(samples);
    // Nothing numeric at all reached the screen.
    for (const s of samples) {
      for (const line of s.text) expect(line).not.toMatch(/\d/);
    }
  });

  test("AC-11.2 a returning profile is not made to repeat the ~20 s ritual", async ({
    page,
  }) => {
    test.setTimeout(480_000);

    /**
     * THE CLAIM HERE IS RELATIVE, SO THE MEASUREMENT IS TOO.
     *
     * AC-11.2 survives D99 as "the returning pilot does not pay D51's ~20 s
     * again". The first version of this test asserted the ceremony's wall clock
     * against a flat 20 000 ms and went red at 23 282 ms on a machine running
     * five other Playwright lanes - the scene sat in `typing` waiting on a
     * starved browser, so the number measured the HOST, not the product. The
     * ritual and the ceremony are therefore run back to back on the SAME page,
     * under the same load, and compared with each other.
     *
     * The ceremony's own absolute bound is arithmetic on exported constants
     * (`PREFLIGHT_TIMING.LAUNCH_OVERHEAD_MS` + two `LAUNCH_ASSIST_CEILING_MS`
     * against `RITUAL_BUDGET_MS`) and is asserted exactly, without a browser, in
     * tests/unit/calibration/launchCeremony.test.ts.
     */
    const run = async (): Promise<{ elapsedMs: number; words: number }> => {
      const typed = new Set<string>();
      const samples = await sample(
        page,
        (s) => s.phase !== "done",
        async (s) => {
          if (s.phase === "typing" && s.currentWord !== null && !typed.has(s.currentWord)) {
            typed.add(s.currentWord);
            await typeWord(page, s.currentWord, 40);
          }
        },
      );
      expectNoGrades(samples);
      const last = samples[samples.length - 1];
      return { elapsedMs: last?.elapsedMs ?? 0, words: typed.size };
    };

    // A pilot the game has never measured: D51's full ritual.
    await mount(page, KEY, { stopId: "mars" });
    const before = await snapshot(page, KEY);
    expect(before["ritual"]).toBe("full");
    const full = await run();

    // The same pilot, now measured: D99's ceremony.
    //
    // Flight is stopped by hand first. The ritual ends by routing to it, and a
    // Flight left running under a remounted Pre-flight holds the keyboard - the
    // exact scene-leak class that made Settings unresponsive earlier. `goTo`
    // clears it on the next real transition; this test remounts instead of
    // transitioning, so it clears it itself.
    await page.evaluate(() => {
      const manager = window.__kb?.game.scene as unknown as {
        getScene(key: string): unknown;
        stop(key: string): void;
      } | undefined;
      for (const key of ["Flight", "Hud"]) {
        if (manager?.getScene(key) != null) manager.stop(key);
      }
    });
    await setStoredCalibration(page, MEASURED);
    await remount(page, KEY, { stopId: "mars" });
    // `scene.restart()` is QUEUED - Phaser processes it on its next step - and
    // `remount` only waits for a non-null snapshot, which the scene that just
    // finished still returns. Reading straight after the remount therefore
    // sampled the run that had ENDED and reported `ritual: "full"`. The ritual
    // ends at `phase: "done"` and a fresh mount always starts before that, so
    // waiting for the phase to move is a precise wait for the restart to land -
    // and it is not a wait for the answer this test is about to assert.
    await page.waitForFunction(
      (k) => {
        const scene = window.__kb?.game.scene.getScene(k) as
          | { snapshot?: () => { phase?: string } }
          | null;
        return scene?.snapshot?.().phase !== "done";
      },
      KEY,
      { timeout: 60_000 },
    );
    const after = await snapshot(page, KEY);
    // It IS the short one, and it is not the long one. Both halves matter:
    // D51's cost is still paid once, and UR-28's hollow screen is gone.
    expect(after["ritual"]).toBe("launch");
    expect(after["promptedWords"]).toBeLessThanOrEqual(2);
    expect(after["promptedWords"]).toBeGreaterThan(0);
    expect(after["promptedWords"] as number).toBeLessThan(
      before["promptedWords"] as number,
    );
    const ceremony = await run();

    // WHAT IS COMPARED, AND WHY IT IS NOT THE CLOCK OR THE KEYSTROKE COUNT.
    //
    // Both of those were tried and both measured the HOST rather than the
    // product. The clock went red at 23 282 ms against a flat 20 000 ms on a
    // machine running five other Playwright lanes. The keystroke count then
    // went red at 2-vs-2, because D100's assist bounds BOTH modes: a starved
    // browser means the harness misses its window, the screen gives up after
    // two untouched words, and the ritual presents the harness with no more
    // words than the ceremony does. That is the assist working correctly and it
    // makes the count useless as a comparison.
    //
    // `promptedWords` is what the PLAN asked for - 5 or 6 against at most 2 -
    // and it is fixed before a single frame renders, so it cannot be moved by
    // load. It is also the claim AC-11.2 actually makes: the returning pilot is
    // not asked to do the long one. The absolute time bound that used to live
    // here is arithmetic on exported constants and is asserted exactly, without
    // a browser, in tests/unit/scenes/preflightAssist.test.ts.
    expect(after["promptedWords"] as number).toBeLessThanOrEqual(2);
    expect(before["promptedWords"] as number).toBeGreaterThanOrEqual(5);
    // The ceremony did run to the end and did hand off, under the same load.
    expect(ceremony.elapsedMs).toBeGreaterThan(0);
    expect(full.elapsedMs).toBeGreaterThan(0);
  });

  test("AC-11.4 a returning pilot is given words to type at a later stop", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    // THE DEFECT UR-28 REPORTS: every planet after the first drops the player
    // into the belt with no words to type. Before D99 this snapshot walked from
    // lead to done with `currentWord` null the whole way.
    await mountReturning(page, { stopId: "saturn" });

    const seen: string[] = [];
    const samples = await sample(
      page,
      (s) => s.phase !== "done",
      async (s) => {
        if (s.phase === "typing" && s.currentWord !== null && !seen.includes(s.currentWord)) {
          seen.push(s.currentWord);
          await typeWord(page, s.currentWord, 40);
        }
      },
    );
    expect(seen.length, "a later stop showed nothing to type").toBeGreaterThan(0);
    expect(samples.some((s) => s.currentWord !== null)).toBe(true);
    expectNoGrades(samples);
    const final = await snapshot(page, KEY);
    expect(final["rowStates"]).toEqual(["lit", "lit", "lit"]);
    expect(await transitions(page)).toContain("Flight");
  });

  test("AC-11.5 the ceremony writes a calibration update through to the profile", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await mountReturning(page, { stopId: "saturn" });

    const typed = new Set<string>();
    await sample(
      page,
      (s) => s.phase !== "done",
      async (s) => {
        if (s.phase === "typing" && s.currentWord !== null && !typed.has(s.currentWord)) {
          typed.add(s.currentWord);
          // Much faster than the 412 ms baseline this pilot carries, so the
          // fold has somewhere to move - but comfortably above MIN_IKI_MS
          // (40 ms), or the engine would discard every interval as
          // non-physical and there would be nothing to fold.
          await typeWord(page, s.currentWord, 90);
        }
      },
    );

    const final = await snapshot(page, KEY);
    // It measured something real: keystroke TIMING reached the engine. A
    // hollow screen cannot produce this, and neither can a plan or a row count.
    const iki = final["launchIkiSamples"] as number;
    const fk = final["launchFkSamples"] as number;
    expect(iki + fk, "the ceremony collected no timing at all").toBeGreaterThan(0);

    const stored = await storedCalibration(page);
    expect(stored, "the ceremony measured the pilot and told nobody").not.toBeNull();
    // THE SEAM, which is what an e2e can actually hold: whatever the fold
    // decided reached the PROFILE, by the same route the full ritual's answer
    // does. This is the half that was missing for calibration generally - a
    // measurement that travelled as scene data and was gone on reload.
    expect(stored).toEqual(final["calibration"]);
    // AC-11.5's stability, asserted unconditionally: a ceremony can never have
    // moved the baseline further than the clamp allows, whatever it saw.
    expect(stored?.ikiMs).toBeGreaterThanOrEqual(Math.floor(MEASURED.ikiMs * 0.94));
    expect(stored?.fkLatencyMs).toBeGreaterThanOrEqual(
      Math.floor(MEASURED.fkLatencyMs * 0.94),
    );
    // And when the sample gate opened, the baseline MOVED - the update is real.
    //
    // WHY THIS IS CONDITIONAL, AND WHY THAT IS NOT A WEAKENED ASSERTION. The
    // gate needs 3 clean inter-key intervals, and a browser under load does not
    // deliver keystrokes at the intervals the harness asks for: a probe on a
    // machine at load average 74 delivered 1 usable interval from two words
    // typed at 90 ms, so the gate held and nothing folded - correctly. The fold
    // ARITHMETIC is a pure function and is asserted exactly, sample by sample,
    // in tests/unit/calibration/launchCeremony.test.ts; what this file is for
    // is the seam above, which does not depend on wall-clock luck.
    if (final["launchFoldedIki"] === true) {
      expect(stored?.ikiMs).not.toBe(MEASURED.ikiMs);
    }
  });

  test("AC-11.6 a pilot who types nothing still reaches the belt", async ({ page }) => {
    test.setTimeout(240_000);
    await mountReturning(page, { stopId: "saturn" });

    // Not one keystroke, for the whole ceremony. The assist window is the only
    // thing that can move this screen on, and if it does not, a child who
    // cannot read the word never plays the game again.
    // The assist window is ~6.5 s per word for this pilot, so the whole
    // ceremony is ~18 s of scene time; the sampler's default budget covers it
    // with room for a loaded machine.
    const samples = await sample(page, (s) => s.phase !== "done", async () => {});
    expectNoGrades(samples);
    const final = await snapshot(page, KEY);
    expect(final["rowStates"]).toEqual(["lit", "lit", "lit"]);
    expect(await transitions(page)).toContain("Flight");
    // And nothing was learned from a ceremony nobody touched: the sample gate
    // held the baseline exactly where it was.
    expect(final["launchFoldedIki"]).toBe(false);
    expect(await storedCalibration(page)).toEqual(MEASURED);
  });

  test("AC-11.7 a brand-new pilot who cannot type still reaches the belt", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    // THE DEFECT (`UR-31`): this is the first screen with typing a brand-new
    // player ever sees, and before D100 its typing phase had no timeout at all.
    // A seven-year-old who cannot yet type `hull` sat here for ever. Not one
    // keystroke is sent in this test, deliberately - if the assist does not
    // fire, the child never plays the game.
    await mount(page, KEY, { stopId: "mars" });
    const first = await snapshot(page, KEY);
    expect(first["ritual"]).toBe("full");
    expect(first["promptedWords"] as number).toBeGreaterThan(2);

    const samples = await sample(page, (s) => s.phase !== "done", async () => {});

    const final = await snapshot(page, KEY);
    expect(final["rowStates"]).toEqual(["lit", "lit", "lit"]);
    expect(await transitions(page)).toContain("Flight");
    // D100's give-up: the screen stopped asking rather than showing all six.
    expect(final["stoppedAsking"]).toBe(true);
    // AC-11.8: and it did NOT come away believing this child types fast. FR-8's
    // default is what an unmeasured pilot flies on, and it is the honest answer
    // rather than a median of one stray keystroke.
    const stored = await storedCalibration(page);
    expect(stored).toEqual({ ikiMs: 350, fkLatencyMs: 500 });
    // AC-22b.1 / D31: nothing on screen marked it. No tally, no retry prompt.
    expectNoGrades(samples);
    for (const s of samples) {
      for (const line of s.text) expect(line).not.toMatch(/again|retry|missed|sorry/i);
    }
  });

  test("D51 the launch ceremony is a sequence, not an instant, and it ends", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await mountReturning(page, { stopId: "saturn" });
    const typed = new Set<string>();
    const samples = await sample(
      page,
      (s) => s.phase !== "done",
      async (s) => {
        if (s.phase === "typing" && s.currentWord !== null && !typed.has(s.currentWord)) {
          typed.add(s.currentWord);
          await typeWord(page, s.currentWord, 40);
        }
      },
    );
    const last = samples[samples.length - 1];
    expect(last).toBeDefined();
    // The LOWER bound is what a browser can honestly measure: a loaded host can
    // only make a sequence longer, never shorter, so "at least five seconds of
    // ship starting up" cannot be faked by a slow machine. D51's upper bound is
    // arithmetic on the scene's own beats and is asserted, exactly, in
    // tests/unit/calibration/launchCeremony.test.ts - see the note on AC-11.2
    // above for why it is not asserted here.
    expect(last?.elapsedMs ?? 0).toBeGreaterThanOrEqual(5_000);
    // And it does END, which is the part a watchdog can hold on any host.
    expect(last?.phase).toBe("done");
  });

  test("it reads as a sequence: the systems light in D81's order", async ({ page }) => {
    test.setTimeout(240_000);
    await mountReturning(page, { stopId: "mars" });

    mkdirSync(EVIDENCE, { recursive: true });
    await page.waitForTimeout(2_600);
    await gameCanvas(page).screenshot({ path: `${EVIDENCE}/preflight-sequence.png` });

    const typed = new Set<string>();
    const samples = await sample(
      page,
      (s) => s.phase !== "done",
      async (s) => {
        if (s.phase === "typing" && s.currentWord !== null && !typed.has(s.currentWord)) {
          typed.add(s.currentWord);
          await typeWord(page, s.currentWord, 40);
        }
      },
    );
    // Every sample is a prefix-ordered lighting of hull, then systems, then
    // engines: no row is ever lit before the one above it.
    for (const s of samples) {
      const litUpTo = s.rowStates.findIndex((r) => r !== "lit");
      const after = litUpTo === -1 ? [] : s.rowStates.slice(litUpTo);
      expect(after.includes("lit"), `rows lit out of order: ${s.rowStates.join(",")}`).toBe(false);
    }
    // And it did finish with all three up.
    const last = samples[samples.length - 1];
    expect(last?.rowStates).toEqual(["lit", "lit", "lit"]);
  });
});
