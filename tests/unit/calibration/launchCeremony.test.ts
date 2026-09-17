import { describe, expect, it } from "vitest";
import {
  LAUNCH_MAX_TIGHTEN,
  LAUNCH_MIN_FK_SAMPLES,
  LAUNCH_MIN_IKI_SAMPLES,
  LAUNCH_REFINE_ALPHA,
  MIN_IKI_MS,
  REFINE_ALPHA,
  RITUAL_MIN_FK_SAMPLES,
  RITUAL_MIN_IKI_SAMPLES,
  RITUAL_BUDGET_MS,
  RITUAL_STEPS,
  SHORT_WORD_MAX_LENGTH,
  computeCalibration,
  estimateRitualTypingMs,
  foldLaunchCeremony,
  planLaunchCeremony,
  wordFitsStep,
  type Keystroke,
  type RitualStepInput,
} from "@engine/calibration/index.js";
import { DEFAULT_CALIBRATION, type Calibration } from "@engine/types.js";

/**
 * D99 / UR-28: THE LAUNCH CEREMONY.
 *
 * UR-28 reports that the typed launch sequence happens once and never again;
 * the choice made was a short ritual at every stop. These tests are about the two
 * halves of that: the ceremony EXISTS at a later stop (which is what the player
 * asked for), and the samples it takes reach the baseline SAFELY (which is why
 * it is worth doing rather than drawing).
 *
 * No clock and no die: every timestamp and every random source is injected,
 * per CLAUDE.md.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Keystrokes that land `gaps` ms apart, starting `firstAt` after the prompt. */
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

/**
 * One played ceremony: two four-letter words typed at `ikiMs` between keys,
 * `fkMs` before the first. Six intervals, two word-start latencies - exactly
 * what the shipped ceremony collects.
 */
function ceremony(ikiMs: number, fkMs: number): RitualStepInput[] {
  const gaps = [ikiMs, ikiMs, ikiMs];
  return [
    {
      id: "systems",
      words: [
        { word: "lift", shownAtMs: 0, keystrokes: typed(0, fkMs, gaps) },
        { word: "beam", shownAtMs: 10_000, keystrokes: typed(10_000, fkMs, gaps) },
      ],
    },
  ];
}

const POOL = [
  "dust",
  "rust",
  "ridge",
  "storm",
  "iron",
  "cold",
  "canyon",
  "volcano",
  "crater",
];

const MEASURED: Calibration = { ikiMs: 600, fkLatencyMs: 700 };

// ---------------------------------------------------------------------------
// AC-11.4 - there is something to type at every stop
// ---------------------------------------------------------------------------

describe("planLaunchCeremony (AC-11.4, D99, UR-57)", () => {
  it("AC-11.4: plans words to type from an ordinary stop pool", () => {
    const plan = planLaunchCeremony(POOL, mulberry32(7));
    expect(plan).not.toBeNull();
    // The whole of UR-28: the screen must not mount with nothing to type.
    expect(plan!.steps.flatMap((s) => s.words).length).toBeGreaterThan(0);
  });

  it("AC-11.4: EVERY step carries words, and each honours its own declared count", () => {
    // UR-57. The ceremony used to put two words on `systems` and leave `hull`
    // and `engines` as spectators - a player counted the steps and reported the
    // belt starting after two. Each step's minWords/maxWords is the spec, and
    // the ceremony now obeys it rather than a constant of its own.
    for (let seed = 1; seed <= 100; seed += 1) {
      const plan = planLaunchCeremony(POOL, mulberry32(seed))!;
      expect(plan.steps.map((s) => s.id)).toEqual(RITUAL_STEPS.map((s) => s.id));
      for (const spec of RITUAL_STEPS) {
        const step = plan.steps.find((s) => s.id === spec.id)!;
        expect(
          step.words.length,
          `${spec.id} wants ${spec.minWords}-${spec.maxWords}, got ${step.words.length}`,
        ).toBeGreaterThanOrEqual(spec.minWords);
        expect(step.words.length).toBeLessThanOrEqual(spec.maxWords);
      }
    }
  });

  it("AC-11.4: every ceremony word fits the length class of the step that carries it", () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const plan = planLaunchCeremony(POOL, mulberry32(seed))!;
      for (const spec of RITUAL_STEPS) {
        const step = plan.steps.find((s) => s.id === spec.id)!;
        for (const word of step.words) {
          expect(wordFitsStep(word, spec), `${word} on ${spec.id}`).toBe(true);
        }
      }
    }
  });

  it("AC-11.4: it collects BOTH measures, which is why all three steps run", () => {
    // The reason UR-57 matters more than step-counting. `hull` contributes
    // first-key latency and no intervals; `systems` and `engines` feed both. A
    // ceremony on `systems` alone produced 2 word-start latencies, and a median
    // of two is not a median. All three steps put a latency behind every word.
    const plan = planLaunchCeremony(POOL, mulberry32(21))!;
    const fkSteps = RITUAL_STEPS.filter((spec) => spec.contributesFkLatency);
    const ikiSteps = RITUAL_STEPS.filter((spec) => spec.contributesIki);
    const wordsOn = (ids: readonly string[]): number =>
      plan.steps.filter((s) => ids.includes(s.id)).reduce((n, s) => n + s.words.length, 0);
    expect(wordsOn(fkSteps.map((x) => x.id))).toBeGreaterThanOrEqual(RITUAL_MIN_FK_SAMPLES);
    expect(wordsOn(ikiSteps.map((x) => x.id))).toBeGreaterThanOrEqual(2);
    // And the hull step is genuinely live, which is the step that was passive.
    expect(plan.steps.find((s) => s.id === "hull")!.words.length).toBeGreaterThan(0);
  });

  it("AC-11.4: the ceremony never repeats a word inside one run", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const words = planLaunchCeremony(POOL, mulberry32(seed))!.steps.flatMap(
        (s) => s.words,
      );
      expect(new Set(words).size).toBe(words.length);
    }
  });

  it("AC-11.4: a pool that cannot supply the words degrades to null, never to a crash", () => {
    // Earth ships `pool: []` (D57). The caller falls back to the untyped
    // sequence rather than stranding a child on a prompt content cannot fill.
    // A pool with no LONG word now fails too, because `engines` is live.
    expect(planLaunchCeremony([], mulberry32(1))).toBeNull();
    expect(planLaunchCeremony(["dust", "rust", "cold", "iron"], mulberry32(1))).toBeNull();
    expect(planLaunchCeremony(["volcano"], mulberry32(1))).toBeNull();
    expect(planLaunchCeremony(["dust", "dust", "dust"], mulberry32(1))).toBeNull();
  });

  it("AC-11.2: the ceremony's words are the ritual's words, and cost the same", () => {
    // UR-57 removed the ceremony's separate word budget along with its separate
    // planner: there is one set of steps and one budget, `RITUAL_BUDGET_MS`.
    // This is the claim D51's "once per profile" used to carry and no longer
    // does - see the amendment on collision C15.
    const plan = planLaunchCeremony(POOL, mulberry32(11))!;
    for (const cal of [DEFAULT_CALIBRATION, MEASURED]) {
      expect(estimateRitualTypingMs(plan, cal)).toBeLessThan(RITUAL_BUDGET_MS);
    }
    // A grade-2 pilot types it in about fourteen seconds; the shipped baseline
    // in about nine. Both are the ritual's order of magnitude, not a fraction.
    expect(estimateRitualTypingMs(plan, DEFAULT_CALIBRATION)).toBeGreaterThan(6_000);
  });

  it("AC-11.5: the sample it yields is stage-sized, which is what re-set the alpha", () => {
    // The measurement behind LAUNCH_REFINE_ALPHA: the one-step ceremony offered
    // ~6 intervals and 2 latencies, which is why D99 folded below a stage's
    // weight. Three steps offer a stage-sized sample, so it folds at a stage's
    // weight. If this ever drops back, the alpha's justification drops with it.
    const plan = planLaunchCeremony(POOL, mulberry32(5))!;
    let intervals = 0;
    let latencies = 0;
    for (const spec of RITUAL_STEPS) {
      const step = plan.steps.find((s) => s.id === spec.id)!;
      if (spec.contributesIki) {
        for (const w of step.words) intervals += w.length - 1;
      }
      if (spec.contributesFkLatency) latencies += step.words.length;
    }
    expect(intervals).toBeGreaterThanOrEqual(10);
    expect(latencies).toBeGreaterThanOrEqual(5);
    expect(latencies).toBeGreaterThan(RITUAL_MIN_FK_SAMPLES);
    expect(intervals).toBeGreaterThan(RITUAL_MIN_IKI_SAMPLES * 3);
  });
});

// ---------------------------------------------------------------------------
// AC-11.5 - the fold is a blend, and it is stable
// ---------------------------------------------------------------------------

describe("foldLaunchCeremony (AC-11.5, D99)", () => {
  it("AC-11.5: a ceremony updates the stored baseline - it is a measurement, not set dressing", () => {
    const fold = foldLaunchCeremony(DEFAULT_CALIBRATION, ceremony(600, 700));
    expect(fold.foldedIki).toBe(true);
    expect(fold.foldedFkLatency).toBe(true);
    // It moved, and it moved TOWARD what was observed.
    expect(fold.calibration.ikiMs).toBeGreaterThan(DEFAULT_CALIBRATION.ikiMs);
    expect(fold.calibration.ikiMs).toBeLessThan(600);
    expect(fold.calibration.fkLatencyMs).toBeGreaterThan(
      DEFAULT_CALIBRATION.fkLatencyMs,
    );
  });

  it("AC-11.5: it BLENDS rather than replacing - the same samples through computeCalibration would jump", () => {
    const played = ceremony(600, 700);
    const replaced = computeCalibration(played).calibration;
    const blended = foldLaunchCeremony(DEFAULT_CALIBRATION, played).calibration;
    // Replacement lands on the observed median; the blend lands a twelfth of
    // the way there. This is the difference UR-28's fix turns on.
    expect(replaced.ikiMs).toBe(600);
    const expected = Math.round(
      (1 - LAUNCH_REFINE_ALPHA) * DEFAULT_CALIBRATION.ikiMs + LAUNCH_REFINE_ALPHA * 600,
    );
    expect(blended.ikiMs).toBe(expected);
    expect(Math.abs(blended.ikiMs - DEFAULT_CALIBRATION.ikiMs)).toBeLessThan(
      Math.abs(replaced.ikiMs - DEFAULT_CALIBRATION.ikiMs),
    );
  });

  it("AC-11.5: the ceremony folds at a stage's weight, because its sample is stage-sized", () => {
    // D99 folded BELOW a stage of play - 0.12 against 0.2 - for the stated
    // reason that "a ceremony offers six samples". UR-57 made that reason false:
    // three steps yield 18.2 intervals and 5.7 latencies on the shipped pools,
    // measured across the six stops. The special case is retired rather than
    // inherited, and this is where it goes red if the sample ever shrinks back.
    expect(LAUNCH_REFINE_ALPHA).toBe(REFINE_ALPHA);
  });

  it("AC-11.5: raising the alpha did not raise what a garbage ceremony costs", () => {
    // The measurement that made the raise safe. Damage from a pure-garbage
    // ceremony is controlled by the CLAMP, not by the weight: at the shipped
    // clamp it is flat in alpha (1/120 belts at 0.12 and at 0.30), and only
    // with the clamp off does it scale (2/120 to 9/120 over the same range).
    const mashed: RitualStepInput[] = [
      {
        id: "systems",
        words: [
          { word: "lift", shownAtMs: 0, keystrokes: typed(0, 90, [MIN_IKI_MS, MIN_IKI_MS, MIN_IKI_MS]) },
          { word: "beam", shownAtMs: 5_000, keystrokes: typed(5_000, 90, [MIN_IKI_MS, MIN_IKI_MS, MIN_IKI_MS]) },
        ],
      },
    ];
    const atOld = foldLaunchCeremony(MEASURED, mashed, { alpha: 0.12 }).calibration.ikiMs;
    const atNew = foldLaunchCeremony(MEASURED, mashed, { alpha: REFINE_ALPHA }).calibration.ikiMs;
    // Identical, because both are held by the clamp rather than by the weight.
    expect(atNew).toBe(atOld);
    expect(atNew).toBeGreaterThanOrEqual(MEASURED.ikiMs * (1 - LAUNCH_MAX_TIGHTEN));
  });

  it("AC-11.5: one fumbled stop cannot wreck the baseline", () => {
    // The worst case the machine can produce: every interval at the physical
    // floor, i.e. a child mashing keys or a burst of duplicate events that
    // survived bounding. Unblended this says "this child types at 40 ms".
    const mashed: RitualStepInput[] = [
      {
        id: "systems",
        words: [
          { word: "lift", shownAtMs: 0, keystrokes: typed(0, 90, [MIN_IKI_MS, MIN_IKI_MS, MIN_IKI_MS]) },
          { word: "beam", shownAtMs: 5_000, keystrokes: typed(5_000, 90, [MIN_IKI_MS, MIN_IKI_MS, MIN_IKI_MS]) },
        ],
      },
    ];
    const fold = foldLaunchCeremony(MEASURED, mashed);
    // A grade-2 pilot must not walk out of Neptune's ceremony with Pluto
    // priced for a child who types at 40 ms between keys.
    expect(fold.calibration.ikiMs).toBeGreaterThanOrEqual(
      MEASURED.ikiMs * (1 - LAUNCH_MAX_TIGHTEN),
    );
    expect(fold.tightenClamped).toBe(true);
    // And the negative control: the unclamped blend WOULD have gone further,
    // so the clamp is doing work rather than describing what already happened.
    const unclamped = foldLaunchCeremony(MEASURED, mashed, { maxTighten: 1 });
    expect(unclamped.calibration.ikiMs).toBeLessThan(fold.calibration.ikiMs);
  });

  it("AC-11.5: six stops of the worst possible ceremony still leave a survivable baseline", () => {
    let cal = MEASURED;
    for (let stop = 0; stop < 6; stop += 1) {
      cal = foldLaunchCeremony(
        cal,
        [
          {
            id: "systems",
            words: [
              { word: "lift", shownAtMs: 0, keystrokes: typed(0, 90, [MIN_IKI_MS, MIN_IKI_MS, MIN_IKI_MS]) },
              { word: "beam", shownAtMs: 5_000, keystrokes: typed(5_000, 90, [MIN_IKI_MS, MIN_IKI_MS, MIN_IKI_MS]) },
            ],
          },
        ],
      ).calibration;
    }
    // 5% per stop, compounded six times, is 26% - not the 93% drop the raw
    // observation asks for.
    expect(cal.ikiMs).toBeGreaterThan(MEASURED.ikiMs * 0.73);
  });

  it("AC-11.5: the rate limit is asymmetric - getting EASIER is not rate-limited", () => {
    // A child who slows down (tired, harder words) gets the full blend, because
    // an error toward "more time than they need" costs them nothing, while an
    // error toward "less time" is what made the belt unsurvivable.
    const slowed = foldLaunchCeremony(
      { ikiMs: 300, fkLatencyMs: 400 },
      ceremony(2_400, 3_000),
    );
    const expected = Math.round((1 - LAUNCH_REFINE_ALPHA) * 300 + LAUNCH_REFINE_ALPHA * 2_400);
    expect(slowed.calibration.ikiMs).toBe(expected);
    expect(slowed.tightenClamped).toBe(false);
    // Which is a bigger relative move than the tighten clamp would ever allow.
    expect(slowed.calibration.ikiMs / 300 - 1).toBeGreaterThan(LAUNCH_MAX_TIGHTEN);
  });

  it("AC-11.5: too few samples leaves the measure exactly where it was", () => {
    // One letter typed and then nothing: no intervals at all. "Nothing" must
    // never be read as "fast".
    const stalled: RitualStepInput[] = [
      {
        id: "systems",
        words: [{ word: "lift", shownAtMs: 0, keystrokes: [{ charIndex: 0, atMs: 900 }] }],
      },
    ];
    const fold = foldLaunchCeremony(MEASURED, stalled);
    expect(fold.calibration).toEqual(MEASURED);
    expect(fold.foldedIki).toBe(false);
    expect(fold.foldedFkLatency).toBe(false);
    expect(fold.ikiSamples).toBe(0);
    expect(fold.fkSamples).toBe(1);
    expect(fold.fkSamples).toBeLessThan(LAUNCH_MIN_FK_SAMPLES);
  });

  it("AC-11.5: a ceremony nobody touched changes nothing", () => {
    const fold = foldLaunchCeremony(MEASURED, [
      { id: "systems", words: [{ word: "lift", shownAtMs: 0, keystrokes: [] }] },
    ]);
    expect(fold.calibration).toEqual(MEASURED);
    expect(fold.foldedIki).toBe(false);
    expect(fold.foldedFkLatency).toBe(false);
  });

  it("AC-11.5: the sample gate is what holds it, not luck", () => {
    // Exactly at the gate it folds; one sample short it does not.
    const atGate: RitualStepInput[] = [
      {
        id: "systems",
        words: [
          { word: "lift", shownAtMs: 0, keystrokes: typed(0, 700, [600, 600, 600]) },
          { word: "beam", shownAtMs: 9_000, keystrokes: typed(9_000, 700, []) },
        ],
      },
    ];
    const gated = foldLaunchCeremony(DEFAULT_CALIBRATION, atGate);
    expect(gated.ikiSamples).toBeGreaterThanOrEqual(LAUNCH_MIN_IKI_SAMPLES);
    expect(gated.foldedIki).toBe(true);

    const belowGate: RitualStepInput[] = [
      {
        id: "systems",
        words: [{ word: "lift", shownAtMs: 0, keystrokes: typed(0, 700, [600, 600]) }],
      },
    ];
    const held = foldLaunchCeremony(DEFAULT_CALIBRATION, belowGate);
    expect(held.ikiSamples).toBe(LAUNCH_MIN_IKI_SAMPLES - 1);
    expect(held.foldedIki).toBe(false);
    expect(held.calibration.ikiMs).toBe(DEFAULT_CALIBRATION.ikiMs);
  });

  it("AC-11.5: a nonsense alpha or clamp falls back to the documented one, never to chaos", () => {
    const played = ceremony(600, 700);
    const shipped = foldLaunchCeremony(DEFAULT_CALIBRATION, played).calibration;
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
      expect(
        foldLaunchCeremony(DEFAULT_CALIBRATION, played, { alpha: bad as number }).calibration,
      ).toEqual(shipped);
      expect(
        foldLaunchCeremony(DEFAULT_CALIBRATION, played, { maxTighten: bad as number })
          .calibration,
      ).toEqual(shipped);
    }
    // And an out-of-range one is held at the bounds rather than inverted.
    expect(
      foldLaunchCeremony(DEFAULT_CALIBRATION, played, { alpha: -3 }).calibration,
    ).toEqual(DEFAULT_CALIBRATION);
    expect(
      foldLaunchCeremony(DEFAULT_CALIBRATION, played, { alpha: 9 }).calibration.ikiMs,
    ).toBe(600);
  });

  it("AC-11.5: a ceremony tracks a child who really is getting faster", () => {
    // Six stops of consistent 420 ms typing from a 600 ms baseline: the game
    // must actually follow them, or the re-measurement is decoration.
    let cal = MEASURED;
    for (let stop = 0; stop < 6; stop += 1) {
      cal = foldLaunchCeremony(cal, ceremony(420, 520)).calibration;
    }
    expect(cal.ikiMs).toBeLessThan(MEASURED.ikiMs);
    // Half the gap or better, and never past the truth.
    expect(cal.ikiMs).toBeLessThan(MEASURED.ikiMs - (MEASURED.ikiMs - 420) * 0.4);
    expect(cal.ikiMs).toBeGreaterThan(420);
  });

  it("AC-11.3: the fold is blind to what was shown, so no accuracy is computable from it", () => {
    const right = foldLaunchCeremony(DEFAULT_CALIBRATION, ceremony(500, 600));
    const wrongWords: RitualStepInput[] = [
      {
        id: "systems",
        words: [
          { word: "zzzz", shownAtMs: 0, keystrokes: typed(0, 600, [500, 500, 500]) },
          { word: "qqqq", shownAtMs: 10_000, keystrokes: typed(10_000, 600, [500, 500, 500]) },
        ],
      },
    ];
    expect(foldLaunchCeremony(DEFAULT_CALIBRATION, wrongWords).calibration).toEqual(
      right.calibration,
    );
    expect(Object.keys(right).sort()).toEqual([
      "calibration",
      "fkSamples",
      "foldedFkLatency",
      "foldedIki",
      "ikiSamples",
      "tightenClamped",
    ]);
  });
});
