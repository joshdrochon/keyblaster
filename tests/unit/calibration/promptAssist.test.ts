import { describe, expect, it } from "vitest";
import {
  LAUNCH_CEREMONY_STEP,
  LAUNCH_MAX_TIGHTEN,
  PREFLIGHT_ASSIST_CEILING_MS,
  PREFLIGHT_ASSIST_FLOOR_MS,
  PREFLIGHT_ASSIST_GIVE_UP,
  RITUAL_BUDGET_MS,
  RITUAL_MIN_FK_SAMPLES,
  RITUAL_MIN_IKI_SAMPLES,
  RITUAL_STEPS,
  computeCalibration,
  foldLaunchCeremony,
  promptAssistMs,
  type Keystroke,
  type RitualStepInput,
} from "@engine/calibration/index.js";
import { DEFAULT_CALIBRATION, type Calibration } from "@engine/types.js";

/**
 * D99 / D100 - THE PRE-FLIGHT SCREEN NEVER TRAPS A CHILD.
 *
 * `UR-28` was the launch ceremony being a locked door six times on a route.
 * `UR-31` is the same defect on the FULL first-run ritual, and it is worse:
 * that screen is the first typing a brand-new player ever meets, and a
 * seven-year-old who cannot yet type `hull` never reached a single belt - not
 * after a retry, not eventually.
 *
 * Two things have to hold at once and they pull against each other. The screen
 * must always end (D100/AC-11.7), and what it stores must still be a
 * MEASUREMENT (D100/AC-11.8) - a child who is carried past every word must not
 * leave the game believing they type fast, which is the shape of the defect
 * that pinned `ikiMs` at 350 ms.
 */

function typed(
  shownAtMs: number,
  firstKeyAfterMs: number,
  gaps: readonly number[],
): Keystroke[] {
  let at = shownAtMs + firstKeyAfterMs;
  const out: Keystroke[] = [{ charIndex: 0, atMs: at }];
  gaps.forEach((gap, i) => {
    at += gap;
    out.push({ charIndex: i + 1, atMs: at });
  });
  return out;
}

const MEASURED: Calibration = { ikiMs: 600, fkLatencyMs: 700 };

/**
 * The scene's own beats, mirrored from `PreflightScene.PREFLIGHT_TIMING`.
 *
 * Duplicated rather than imported because that module pulls in Phaser and this
 * suite is `src/engine`-only. The numbers are asserted against the scene's
 * exported constants by `tests/unit/scenes/preflightAssist.test.ts`, so a drift
 * in either direction goes red rather than quietly invalidating the arithmetic
 * below.
 */
const RITUAL_BEATS_MS = 1400 + 3 * (900 + 620) + 1500;
const LAUNCH_BEATS_MS = 1000 + 2 * (420 + 340) + (760 + 520) + 1300;

// ---------------------------------------------------------------------------
// AC-11.6 / AC-11.7 - neither mode is a gate
// ---------------------------------------------------------------------------

describe("promptAssistMs (AC-11.6, AC-11.7, D99/D100)", () => {
  it("AC-11.7: a child typing at their own measured pace is never interrupted", () => {
    // Every baseline that actually occurs: FR-8's default, which is what a
    // brand-new profile carries into the first-run ritual, and the grade-2
    // pilot the belt work was about. Both finish at 1x and are given 2x or more.
    for (const cal of [DEFAULT_CALIBRATION, MEASURED]) {
      for (const word of ["go", "hull", "storm", "surface"]) {
        const cost = cal.fkLatencyMs + (word.length - 1) * cal.ikiMs;
        // 1.5x and not 3x, because the ceiling squeezes the margin on the
        // longest word at the slowest belief - `surface` at 600 ms costs
        // 4300 ms against a 7000 ms window. That is the trade
        // PREFLIGHT_ASSIST_CEILING_MS documents, and half as long again as the
        // word costs is still a window a child finishes without noticing.
        expect(
          promptAssistMs(word, cal),
          `${word} at iki ${cal.ikiMs} costs ${cost} ms`,
        ).toBeGreaterThan(cost * 1.5);
      }
    }
  });

  it("AC-11.7: the longest word the ritual can show still fits for a grade-2 pilot", () => {
    // D81's engines step is one 7-13 letter word, and the assist is computed
    // from what the game BELIEVES - which on a brand-new profile is FR-8's
    // 350 ms, not the child's real speed. So the window has to cover a slow
    // child typing a long word at a fast belief, or the ritual's richest step
    // is the one nobody ever completes.
    const window = promptAssistMs("surface", DEFAULT_CALIBRATION);
    const grade2Cost = MEASURED.fkLatencyMs + 6 * MEASURED.ikiMs;
    expect(window).toBeGreaterThan(grade2Cost);
  });

  it("AC-11.7: the window scales with the child, not with one number that suits the median", () => {
    const fast = promptAssistMs("storm", { ikiMs: 200, fkLatencyMs: 300 });
    const mid = promptAssistMs("storm", { ikiMs: 600, fkLatencyMs: 700 });
    expect(mid).toBeGreaterThan(fast);
  });

  it("AC-11.7: it never drops below a floor a child could be reading through", () => {
    expect(promptAssistMs("go", { ikiMs: 40, fkLatencyMs: 80 })).toBe(
      PREFLIGHT_ASSIST_FLOOR_MS,
    );
  });

  it("AC-11.7: the window is capped, so a screen nobody touches still ends", () => {
    const verySlow = promptAssistMs("storm", { ikiMs: 1200, fkLatencyMs: 1800 });
    expect(verySlow).toBe(PREFLIGHT_ASSIST_CEILING_MS);
    expect(PREFLIGHT_ASSIST_CEILING_MS).toBeGreaterThan(PREFLIGHT_ASSIST_FLOOR_MS);
  });

  it("AC-11.7: a pilot who types NOTHING is off the first-run ritual inside D51's budget", () => {
    // THE CASE THAT TRAPPED THEM. Six words, none touched. Without the give-up
    // this is 6 x 7 s = 42 s of a child watching a word they cannot type, on
    // top of the sequence's own beats - more than twice D51's ~20 s.
    const worstNoGiveUp = RITUAL_BEATS_MS + 6 * PREFLIGHT_ASSIST_CEILING_MS;
    expect(worstNoGiveUp).toBeGreaterThan(2 * RITUAL_BUDGET_MS);

    // With it, the screen stops asking after two untouched words and the
    // remaining rows light on their own.
    const worst = RITUAL_BEATS_MS + PREFLIGHT_ASSIST_GIVE_UP * PREFLIGHT_ASSIST_CEILING_MS;
    expect(worst).toBe(21_460);
    // "~20 s" (D51), not a second over half a minute, and bounded whatever the
    // profile says - the ceiling is what makes this arithmetic and not a hope.
    expect(worst).toBeLessThan(RITUAL_BUDGET_MS * 1.1);
  });

  it("AC-11.6: a pilot who types NOTHING is off the launch ceremony inside D51's budget too", () => {
    const worst = LAUNCH_BEATS_MS + 2 * PREFLIGHT_ASSIST_CEILING_MS;
    expect(worst).toBe(19_100);
    expect(worst).toBeLessThan(RITUAL_BUDGET_MS);
  });

  it("AC-11.7: the give-up counter is about words NOBODY touched, not words that were hard", () => {
    // A child who stalls on one word and types the next is still being
    // measured - the scene resets the counter on any completion. Asserted here
    // as the rule the scene implements: two IN A ROW, not two in total.
    expect(PREFLIGHT_ASSIST_GIVE_UP).toBe(2);
    expect(PREFLIGHT_ASSIST_GIVE_UP).toBeLessThan(RITUAL_STEPS.length);
  });
});

// ---------------------------------------------------------------------------
// AC-11.8 - being carried past must not become a way to fake a measurement
// ---------------------------------------------------------------------------

describe("computeCalibration's sample gate (AC-11.8, D100)", () => {
  /** A ritual where every word was carried past with nothing typed. */
  const untouched: RitualStepInput[] = RITUAL_STEPS.map((spec) => ({
    id: spec.id,
    words: [{ word: "hull", shownAtMs: 0, keystrokes: [] }],
  }));

  it("AC-11.8: a ritual nobody typed stores no measurement at all", () => {
    const result = computeCalibration(untouched);
    expect(result.usedDefaultIki).toBe(true);
    expect(result.usedDefaultFkLatency).toBe(true);
    expect(result.calibration).toEqual(DEFAULT_CALIBRATION);
    // And it says so. A caller cannot tell a measured baseline from an assumed
    // one by looking at the numbers, so the flags are the only honest signal.
    expect(result.steps.every((s) => !s.attempted)).toBe(true);
  });

  it("AC-11.8: one stray interval is not a baseline", () => {
    // The case D100's assist creates that did not exist before: a sequence that
    // ran to the end having collected a single usable sample. A median of one
    // is not a median, and storing it would put a number on the profile that
    // means nothing while looking exactly like a measurement.
    const oneInterval: RitualStepInput[] = [
      {
        id: "systems",
        words: [{ word: "set", shownAtMs: 0, keystrokes: typed(0, 900, [410]) }],
      },
    ];
    const result = computeCalibration(oneInterval);
    expect(result.steps[1]!.ikiSamplesMs).toEqual([410]);
    // Measured, and reported, and NOT believed.
    expect(result.usedDefaultIki).toBe(true);
    expect(result.calibration.ikiMs).toBe(DEFAULT_CALIBRATION.ikiMs);
  });

  it("AC-11.8: one word-start latency is not a baseline either", () => {
    const oneLatency: RitualStepInput[] = [
      {
        id: "hull",
        words: [{ word: "hull", shownAtMs: 0, keystrokes: [{ charIndex: 0, atMs: 640 }] }],
      },
    ];
    const result = computeCalibration(oneLatency);
    expect(result.steps[0]!.fkLatencySamplesMs).toEqual([640]);
    expect(result.usedDefaultFkLatency).toBe(true);
    expect(result.calibration.fkLatencyMs).toBe(DEFAULT_CALIBRATION.fkLatencyMs);
  });

  it("AC-11.8: the gate opens exactly at the documented sample counts", () => {
    // One short of the gate: held. At the gate: believed. A threshold nobody
    // has watched move is a threshold nobody has tested.
    const withIntervals = (n: number): RitualStepInput[] => [
      {
        id: "systems",
        words: [
          {
            word: "checks",
            shownAtMs: 0,
            keystrokes: typed(0, 900, new Array(n).fill(410) as number[]),
          },
        ],
      },
    ];
    const held = computeCalibration(withIntervals(RITUAL_MIN_IKI_SAMPLES - 1));
    expect(held.usedDefaultIki).toBe(true);
    expect(held.calibration.ikiMs).toBe(DEFAULT_CALIBRATION.ikiMs);

    const believed = computeCalibration(withIntervals(RITUAL_MIN_IKI_SAMPLES));
    expect(believed.usedDefaultIki).toBe(false);
    expect(believed.calibration.ikiMs).toBe(410);
  });

  it("AC-11.8: the gate is the same one the launch ceremony folds behind", () => {
    // D100 adapts D99's numbers rather than inventing a second rule, which is
    // the whole reason there is one assist mechanism and not two.
    expect(RITUAL_MIN_IKI_SAMPLES).toBe(3);
    expect(RITUAL_MIN_FK_SAMPLES).toBe(2);
  });

  it("AC-11.8: a partial word carried past still counts toward the measurement", () => {
    // The assist banks whatever was typed before it fires. This is the half
    // that keeps the fix from costing the child their measurement: three
    // letters of `navigate` is three letters of evidence, not a failure.
    const partial: RitualStepInput[] = [
      {
        id: "engines",
        words: [{ word: "navigate", shownAtMs: 0, keystrokes: typed(0, 700, [520, 540, 500]) }],
      },
    ];
    const result = computeCalibration(partial);
    expect(result.steps[2]!.ikiSamplesMs).toHaveLength(3);
    expect(result.usedDefaultIki).toBe(false);
    expect(result.calibration.ikiMs).toBe(520);
  });

  it("AC-11.8: being carried past every ceremony word cannot move a stored baseline", () => {
    // The returning-pilot half of the same question (D99). The ceremony's fold
    // has its own gate, and an untouched ceremony leaves the profile exactly
    // where it was rather than sliding it toward a number nobody produced.
    const fold = foldLaunchCeremony(MEASURED, [
      {
        id: LAUNCH_CEREMONY_STEP,
        words: [
          { word: "fly", shownAtMs: 0, keystrokes: [] },
          { word: "rings", shownAtMs: 8_000, keystrokes: [] },
        ],
      },
    ]);
    expect(fold.calibration).toEqual(MEASURED);
    expect(fold.foldedIki).toBe(false);
    expect(fold.foldedFkLatency).toBe(false);
    expect(fold.calibration.ikiMs).toBeGreaterThan(MEASURED.ikiMs * (1 - LAUNCH_MAX_TIGHTEN));
  });
});
