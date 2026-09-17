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
 * profile is never shown it), AC-11.3 (no score, accuracy or pass/fail appears
 * during it), AC-22b.1, D51 (5-20 seconds).
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

  test("AC-11.2 a returning profile is not calibrated and never types", async ({ page }) => {
    test.setTimeout(240_000);
    await mountReturning(page, { stopId: "mars" });

    const first = await snapshot(page, KEY);
    expect(first.calibrating).toBe(false);

    const samples = await sample(page, (s) => s.phase !== "done", async () => {});
    // No word was ever shown to type: the ritual is pure narrative here.
    expect(samples.every((s) => s.currentWord === null)).toBe(true);
    const final = await snapshot(page, KEY);
    expect(final["stepsMeasured"]).toBe(0);
    expectNoGrades(samples);
  });

  test("AC-11.2 a returning pilot keeps the baseline they were measured at", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await mountReturning(page, { stopId: "mars" });
    await sample(page, (s) => s.phase !== "done", async () => {});
    // The narrative ritual must not overwrite a real measurement with the
    // default it never took.
    expect(await storedCalibration(page)).toEqual(MEASURED);
    const final = await snapshot(page, KEY);
    expect(final["calibration"]).toEqual(MEASURED);
  });

  test("D51 the returning ritual lasts between 5 and 20 seconds", async ({ page }) => {
    test.setTimeout(240_000);
    await mountReturning(page, { stopId: "saturn" });
    const samples = await sample(page, (s) => s.phase !== "done", async () => {});
    const last = samples[samples.length - 1];
    expect(last).toBeDefined();
    expect(last?.elapsedMs ?? 0).toBeGreaterThanOrEqual(5_000);
    expect(last?.elapsedMs ?? 0).toBeLessThanOrEqual(20_000);
  });

  test("it reads as a sequence: the systems light in D81's order", async ({ page }) => {
    test.setTimeout(240_000);
    await mountReturning(page, { stopId: "mars" });

    mkdirSync(EVIDENCE, { recursive: true });
    await page.waitForTimeout(2_600);
    await gameCanvas(page).screenshot({ path: `${EVIDENCE}/preflight-sequence.png` });

    const samples = await sample(page, (s) => s.phase !== "done", async () => {});
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
