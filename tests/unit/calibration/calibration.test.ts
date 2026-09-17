import { describe, expect, it } from "vitest";
import {
  HISTORY_SAMPLE_WINDOW,
  LONG_WORD_MAX_LENGTH,
  LONG_WORD_MIN_LENGTH,
  MAX_FK_LATENCY_MS,
  MAX_IKI_MS,
  MIN_FK_LATENCY_MS,
  MIN_IKI_MS,
  REFINE_ALPHA,
  RITUAL_BUDGET_MS,
  RITUAL_STEPS,
  SHORT_WORD_MAX_LENGTH,
  applyCalibration,
  boundSamples,
  calibrationFromHistory,
  clamp,
  computeCalibration,
  estimateRitualTypingMs,
  hasTypingHistory,
  isDefaultCalibration,
  measureStep,
  median,
  needsCalibration,
  planRitual,
  refineCalibration,
  settleMs,
  stepSpec,
  wordFitsStep,
  type CalibratableProfile,
  type Keystroke,
  type RitualStepInput,
} from "@engine/calibration/index.js";
import {
  DEFAULT_CALIBRATION,
  EASE_NEW,
  type StopProgress,
  type WordRecord,
} from "@engine/types.js";

// ---------------------------------------------------------------------------
// Fixtures. No Date.now(), no Math.random: every clock and every die is
// injected, per CLAUDE.md and the lane brief.
// ---------------------------------------------------------------------------

/** mulberry32: a tiny deterministic PRNG so plan tests are fixed-seed. */
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

function record(partial: Partial<WordRecord> = {}): WordRecord {
  return {
    exposures: 0,
    hits: 0,
    misses: 0,
    typos: 0,
    fkLatencyMs: [],
    ikiMs: [],
    firstFkLatencyMs: null,
    ease: EASE_NEW,
    lastSeen: null,
    nextEligibleStage: 0,
    ...partial,
  };
}

function stop(partial: Partial<StopProgress> = {}): StopProgress {
  return {
    stopId: "mars",
    cleared: false,
    stars: 0,
    bestWpm: 0,
    bestAccuracy: 0,
    lastWpm: 0,
    lastAccuracy: 0,
    beaconPlacedAt: null,
    ...partial,
  };
}

function profile(partial: Partial<CalibratableProfile> = {}): CalibratableProfile {
  return {
    calibration: { ...DEFAULT_CALIBRATION },
    words: {},
    progress: [],
    ...partial,
  };
}

/** Pre-flight words in the register of story-draft-v1.md's Shadow lines. */
const POOL = [
  "hull",
  "check",
  "ready",
  "set",
  "go",
  "fix",
  "lift",
  "warm",
  "seal",
  "air",
  "blaster",
  "systems",
  "navigate",
];

// ---------------------------------------------------------------------------
// stats
// ---------------------------------------------------------------------------

describe("median", () => {
  it("returns null for no samples, so a fallback can be chosen by the caller", () => {
    expect(median([])).toBeNull();
  });

  it("takes the middle of an odd run and the mean of the two middles of an even one", () => {
    expect(median([300, 100, 200])).toBe(200);
    expect(median([400, 100, 200, 300])).toBe(250);
  });

  it("does not mutate its input", () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });

  it("ignores one absurd outlier where a mean would not (D18)", () => {
    const steady = [300, 310, 320, 330, 340];
    const distracted = [...steady, 30_000];
    expect(median(distracted)).toBeLessThan(400);
  });
});

describe("boundSamples", () => {
  it("caps above the ceiling instead of discarding, so slow stays slow", () => {
    const b = boundSamples([300, 9000], MIN_IKI_MS, MAX_IKI_MS);
    expect(b.values).toEqual([300, MAX_IKI_MS]);
    expect(b.capped).toBe(1);
    expect(b.discarded).toBe(0);
  });

  it("discards sub-floor, negative and non-finite samples as non-physical", () => {
    // Infinity is discarded, not capped: the ceiling policy exists for a child
    // who paused, and Infinity is a broken clock, not a slow child.
    const b = boundSamples([300, 5, -40, Number.NaN, Infinity], MIN_IKI_MS, MAX_IKI_MS);
    expect(b.values).toEqual([300]);
    expect(b.discarded).toBe(4);
    expect(b.capped).toBe(0);
  });

  it("passes a sample exactly on each bound", () => {
    const b = boundSamples([MIN_IKI_MS, MAX_IKI_MS], MIN_IKI_MS, MAX_IKI_MS);
    expect(b.values).toEqual([MIN_IKI_MS, MAX_IKI_MS]);
    expect(b.capped).toBe(0);
    expect(b.discarded).toBe(0);
  });
});

describe("clamp / settleMs", () => {
  it("clamps both ends and resolves non-finite input to the low bound", () => {
    expect(clamp(5, 10, 20)).toBe(10);
    expect(clamp(25, 10, 20)).toBe(20);
    expect(clamp(15, 10, 20)).toBe(15);
    expect(clamp(Number.NaN, 10, 20)).toBe(10);
  });

  it("settles to whole milliseconds inside the bounds", () => {
    expect(settleMs(250.5, MIN_IKI_MS, MAX_IKI_MS)).toBe(251);
    expect(settleMs(99_999, MIN_IKI_MS, MAX_IKI_MS)).toBe(MAX_IKI_MS);
  });
});

describe("documented ceilings", () => {
  it("the iki ceiling is the point past which FR-8 cannot fall any slower", () => {
    // fallTime = len * 1.5 * iki + ..., clamped to MAX 14000. For the shortest
    // word we would serve (3 letters) that saturates at 14000 / 4.5 = 3111 ms.
    expect(MAX_IKI_MS).toBeLessThanOrEqual(14_000 / (3 * 1.5));
  });

  it("the first-key ceiling leaves room inside D51's ~20 s ritual", () => {
    expect(MAX_FK_LATENCY_MS).toBeLessThan(RITUAL_BUDGET_MS);
    expect(MIN_FK_LATENCY_MS).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ritual shape (D81)
// ---------------------------------------------------------------------------

describe("RITUAL_STEPS (AC-11.1, D81)", () => {
  it("AC-11.1: models D81's three steps explicitly, in order, not as one blob", () => {
    expect(RITUAL_STEPS.map((s) => s.id)).toEqual(["hull", "systems", "engines"]);
    expect(RITUAL_STEPS.map((s) => s.order)).toEqual([0, 1, 2]);
  });

  it("AC-11.1: hull check is 1 short word measuring first-key latency (D81)", () => {
    const hull = stepSpec("hull");
    expect(hull).not.toBeNull();
    expect(hull?.minWords).toBe(1);
    expect(hull?.maxWords).toBe(1);
    expect(hull?.wordLength).toBe("short");
    expect(hull?.measures).toBe("fkLatency");
  });

  it("AC-11.1: systems check is 3-4 short words measuring inter-key interval (D81)", () => {
    const systems = stepSpec("systems");
    expect(systems?.minWords).toBe(3);
    expect(systems?.maxWords).toBe(4);
    expect(systems?.wordLength).toBe("short");
    expect(systems?.measures).toBe("iki");
  });

  it("AC-11.1: engines is 1 long word (D81)", () => {
    const engines = stepSpec("engines");
    expect(engines?.minWords).toBe(1);
    expect(engines?.maxWords).toBe(1);
    expect(engines?.wordLength).toBe("long");
  });

  it("excludes the hull check's cold-start intervals from the iki median", () => {
    expect(stepSpec("hull")?.contributesIki).toBe(false);
    expect(stepSpec("systems")?.contributesIki).toBe(true);
    expect(stepSpec("engines")?.contributesIki).toBe(true);
  });

  it("returns null for a step id the ritual does not define", () => {
    expect(stepSpec("warp")).toBeNull();
  });
});

describe("wordFitsStep", () => {
  const hull = stepSpec("hull")!;
  const engines = stepSpec("engines")!;

  it("accepts short words only for short steps", () => {
    expect(wordFitsStep("hull", hull)).toBe(true);
    expect(wordFitsStep("a".repeat(SHORT_WORD_MAX_LENGTH), hull)).toBe(true);
    expect(wordFitsStep("a".repeat(SHORT_WORD_MAX_LENGTH + 1), hull)).toBe(false);
    expect(wordFitsStep("", hull)).toBe(false);
  });

  it("accepts long words only inside the plate limit", () => {
    expect(wordFitsStep("a".repeat(LONG_WORD_MIN_LENGTH), engines)).toBe(true);
    expect(wordFitsStep("a".repeat(LONG_WORD_MIN_LENGTH - 1), engines)).toBe(false);
    expect(wordFitsStep("a".repeat(LONG_WORD_MAX_LENGTH), engines)).toBe(true);
    expect(wordFitsStep("a".repeat(LONG_WORD_MAX_LENGTH + 1), engines)).toBe(false);
  });
});

describe("planRitual", () => {
  it("fills every step with words of the right length and never repeats one", () => {
    for (let seed = 1; seed <= 64; seed += 1) {
      const plan = planRitual(POOL, mulberry32(seed));
      expect(plan).not.toBeNull();
      const used: string[] = [];
      plan!.steps.forEach((step, i) => {
        const spec = RITUAL_STEPS[i]!;
        expect(step.id).toBe(spec.id);
        expect(step.words.length).toBeGreaterThanOrEqual(spec.minWords);
        expect(step.words.length).toBeLessThanOrEqual(spec.maxWords);
        for (const word of step.words) {
          expect(wordFitsStep(word, spec)).toBe(true);
          used.push(word);
        }
      });
      expect(new Set(used).size).toBe(used.length);
    }
  });

  it("is deterministic for a fixed seed and injected RNG", () => {
    expect(planRitual(POOL, mulberry32(7))).toEqual(planRitual(POOL, mulberry32(7)));
  });

  it("normalises and de-duplicates the pool", () => {
    const plan = planRitual([" HULL ", "hull", ...POOL], mulberry32(3));
    const words = plan!.steps.flatMap((s) => s.words);
    expect(words).toEqual(words.map((w) => w.toLowerCase().trim()));
    expect(new Set(words).size).toBe(words.length);
  });

  it("survives a degenerate RNG that returns 1", () => {
    const plan = planRitual(POOL, () => 1);
    expect(plan).not.toBeNull();
    plan!.steps.forEach((step, i) => {
      expect(step.words.length).toBe(RITUAL_STEPS[i]!.maxWords);
    });
  });

  it("returns null rather than throwing when the pool has too few short words", () => {
    expect(planRitual(["hull", "blaster"], mulberry32(1))).toBeNull();
  });

  it("returns null when the pool has no long word for the engines step", () => {
    expect(planRitual(["hull", "check", "ready", "set", "go", "fix"], mulberry32(1))).toBeNull();
  });

  it("D51: the typing fits well inside the ~20 s pre-flight budget", () => {
    for (let seed = 1; seed <= 64; seed += 1) {
      const plan = planRitual(POOL, mulberry32(seed))!;
      expect(estimateRitualTypingMs(plan, DEFAULT_CALIBRATION)).toBeLessThan(
        RITUAL_BUDGET_MS,
      );
    }
  });

  it("a slower baseline costs more time, which is what the budget guards", () => {
    const plan = planRitual(POOL, () => 1)!;
    const slow = estimateRitualTypingMs(plan, { ikiMs: 700, fkLatencyMs: 900 });
    const fast = estimateRitualTypingMs(plan, DEFAULT_CALIBRATION);
    expect(slow).toBeGreaterThan(fast);
  });
});

// ---------------------------------------------------------------------------
// measurement (AC-11.1)
// ---------------------------------------------------------------------------

/** A clean, unremarkable ritual: hull, 3 systems words, engines. */
function cleanRitual(): RitualStepInput[] {
  return [
    {
      id: "hull",
      words: [{ word: "hull", shownAtMs: 0, keystrokes: typed(0, 600, [400, 400, 400]) }],
    },
    {
      id: "systems",
      words: [
        { word: "check", shownAtMs: 5_000, keystrokes: typed(5_000, 500, [300, 300, 300, 300]) },
        { word: "ready", shownAtMs: 8_000, keystrokes: typed(8_000, 450, [320, 280, 300, 300]) },
        { word: "seal", shownAtMs: 11_000, keystrokes: typed(11_000, 400, [310, 290, 300]) },
      ],
    },
    {
      id: "engines",
      words: [
        {
          word: "navigate",
          shownAtMs: 14_000,
          keystrokes: typed(14_000, 520, [300, 300, 300, 300, 300, 300, 300]),
        },
      ],
    },
  ];
}

describe("computeCalibration (AC-11.1)", () => {
  it("AC-11.1: produces a median inter-key interval and first-key latency", () => {
    const result = computeCalibration(cleanRitual());
    expect(result.calibration.ikiMs).toBe(300);
    expect(result.calibration.fkLatencyMs).toBe(500);
    expect(result.usedDefaultIki).toBe(false);
    expect(result.usedDefaultFkLatency).toBe(false);
  });

  it("AC-11.1: reports all three steps separately, never one undifferentiated blob", () => {
    const result = computeCalibration(cleanRitual());
    expect(result.steps.map((s) => s.id)).toEqual(["hull", "systems", "engines"]);
    expect(result.steps.every((s) => s.attempted)).toBe(true);
    // Each step carries its own samples, so the scene can react per step.
    expect(result.steps[1]!.ikiSamplesMs.length).toBe(11);
    expect(result.steps[2]!.ikiSamplesMs.length).toBe(7);
  });

  it("D81: the hull check contributes a first-key latency but no intervals", () => {
    const hull = computeCalibration(cleanRitual()).steps[0]!;
    expect(hull.fkLatencySamplesMs).toEqual([600]);
    expect(hull.ikiSamplesMs).toEqual([]);
  });

  it("uses the median, not the mean, when one keystroke is distracted", () => {
    const steps = cleanRitual();
    const ruined: RitualStepInput[] = steps.map((step) =>
      step.id !== "engines"
        ? step
        : {
            id: "engines",
            words: [
              {
                word: "navigate",
                shownAtMs: 14_000,
                // The child looks away halfway through the long word.
                keystrokes: typed(14_000, 520, [300, 300, 45_000, 300, 300, 300, 300]),
              },
            ],
          },
    );
    // A mean over these samples would land far above 300 ms.
    expect(computeCalibration(ruined).calibration.ikiMs).toBe(300);
  });

  it("caps an absurd outlier instead of discarding it, so slow children stay slow", () => {
    const steps: RitualStepInput[] = [
      {
        id: "systems",
        words: [
          { word: "check", shownAtMs: 0, keystrokes: typed(0, 700, [2_800, 60_000, 2_900]) },
        ],
      },
    ];
    const result = computeCalibration(steps);
    // Samples: 2800, capped 3000, 2900 -> median 2900, not the fast default.
    expect(result.calibration.ikiMs).toBe(2_900);
    expect(result.steps[1]!.cappedSamples).toBe(1);
  });

  it("caps a runaway first-key latency at the documented ceiling", () => {
    // Two words, because D100's RITUAL_MIN_FK_SAMPLES will not believe one -
    // the claim under test is the CAP, so the gate is fed rather than fought.
    const steps: RitualStepInput[] = [
      {
        id: "hull",
        words: [{ word: "hull", shownAtMs: 0, keystrokes: typed(0, 90_000, []) }],
      },
      {
        id: "systems",
        words: [{ word: "set", shownAtMs: 100_000, keystrokes: typed(100_000, 90_000, []) }],
      },
    ];
    expect(computeCalibration(steps).calibration.fkLatencyMs).toBe(MAX_FK_LATENCY_MS);
  });

  it("falls back to DEFAULT_CALIBRATION when the ritual produced nothing (FR-8)", () => {
    const result = computeCalibration([]);
    expect(result.calibration).toEqual(DEFAULT_CALIBRATION);
    expect(result.usedDefaultIki).toBe(true);
    expect(result.usedDefaultFkLatency).toBe(true);
    expect(result.steps.map((s) => s.id)).toEqual(["hull", "systems", "engines"]);
    expect(result.steps.every((s) => !s.attempted)).toBe(true);
  });

  it("falls back per measure, keeping a real iki when no latency was clean", () => {
    const steps: RitualStepInput[] = [
      {
        id: "engines",
        words: [
          // No shownAtMs: the scene could not stamp the prompt.
          { word: "navigate", keystrokes: typed(0, 500, [280, 300, 320, 300]) },
        ],
      },
    ];
    const result = computeCalibration(steps);
    expect(result.calibration.ikiMs).toBe(300);
    expect(result.calibration.fkLatencyMs).toBe(DEFAULT_CALIBRATION.fkLatencyMs);
    expect(result.usedDefaultIki).toBe(false);
    expect(result.usedDefaultFkLatency).toBe(true);
  });

  it("handles a single keystroke: a latency, and no interval to measure", () => {
    const steps: RitualStepInput[] = [
      {
        id: "systems",
        words: [{ word: "set", shownAtMs: 0, keystrokes: [{ charIndex: 0, atMs: 640 }] }],
      },
    ];
    const result = computeCalibration(steps);
    // One keystroke is one latency and no interval - that much is unchanged.
    expect(result.steps[1]!.fkLatencySamplesMs).toEqual([640]);
    expect(result.steps[1]!.ikiSamplesMs).toEqual([]);
    // D100/AC-11.8: it is MEASURED and reported, and it is not BELIEVED. One
    // sample is not a median, and after the assist landed this is the ordinary
    // way a sequence reaches its end having learned nothing.
    expect(result.usedDefaultFkLatency).toBe(true);
    expect(result.calibration.fkLatencyMs).toBe(DEFAULT_CALIBRATION.fkLatencyMs);
    expect(result.calibration.ikiMs).toBe(DEFAULT_CALIBRATION.ikiMs);
  });

  it("handles an abandoned step: no keystrokes at all", () => {
    const steps: RitualStepInput[] = [
      ...cleanRitual().slice(0, 2),
      { id: "engines", words: [{ word: "navigate", shownAtMs: 14_000, keystrokes: [] }] },
    ];
    const result = computeCalibration(steps);
    expect(result.steps[2]!.attempted).toBe(false);
    expect(result.steps[2]!.keystrokeCount).toBe(0);
    expect(result.calibration.ikiMs).toBe(300);
  });

  it("ignores a prompt stamped after the first key (clock skew, not a fast child)", () => {
    const steps: RitualStepInput[] = [
      {
        id: "hull",
        words: [{ word: "hull", shownAtMs: 1_000, keystrokes: [{ charIndex: 0, atMs: 900 }] }],
      },
    ];
    const result = computeCalibration(steps);
    expect(result.usedDefaultFkLatency).toBe(true);
  });

  it("ignores non-finite timestamps rather than poisoning the median", () => {
    const steps: RitualStepInput[] = [
      {
        id: "systems",
        words: [
          {
            word: "check",
            shownAtMs: Number.NaN,
            keystrokes: [
              { charIndex: 0, atMs: 100 },
              { charIndex: 1, atMs: Number.NaN },
              { charIndex: 2, atMs: 800 },
            ],
          },
          {
            word: "ready",
            shownAtMs: 2_000,
            keystrokes: [{ charIndex: 0, atMs: Number.POSITIVE_INFINITY }],
          },
        ],
      },
    ];
    const result = computeCalibration(steps);
    expect(result.usedDefaultIki).toBe(true);
    expect(result.usedDefaultFkLatency).toBe(true);
  });

  it("skips the gap around a correction, where charIndex does not advance by one", () => {
    const steps: RitualStepInput[] = [
      {
        id: "engines",
        words: [
          {
            word: "navigate",
            shownAtMs: 0,
            keystrokes: [
              { charIndex: 0, atMs: 500 },
              { charIndex: 1, atMs: 800 },
              // backspace-and-retype: index 1 again, after a long think
              { charIndex: 1, atMs: 4_000 },
              { charIndex: 2, atMs: 4_300 },
              { charIndex: 3, atMs: 4_600 },
            ],
          },
        ],
      },
    ];
    const result = computeCalibration(steps);
    // Three clean intervals; the 3.2 s think around the correction is not one
    // of them. Three is also D100's gate, so the median is believed.
    expect(result.steps[2]!.ikiSamplesMs).toEqual([300, 300, 300]);
    expect(result.usedDefaultIki).toBe(false);
    expect(result.calibration.ikiMs).toBe(300);
  });

  it("merges a step delivered across two payloads, and tolerates a missing one", () => {
    const steps: RitualStepInput[] = [
      { id: "systems", words: [{ word: "check", shownAtMs: 0, keystrokes: typed(0, 500, [200, 200]) }] },
      { id: "systems", words: [{ word: "ready", shownAtMs: 3_000, keystrokes: typed(3_000, 500, [400, 400]) }] },
    ];
    const result = computeCalibration(steps);
    expect(result.steps[1]!.keystrokeCount).toBe(6);
    expect(result.steps[1]!.ikiSamplesMs).toEqual([200, 200, 400, 400]);
    expect(result.calibration.ikiMs).toBe(300);
  });

  it("discards sub-floor intervals from key repeat", () => {
    const steps: RitualStepInput[] = [
      {
        id: "engines",
        words: [
          {
            word: "navigate",
            shownAtMs: 0,
            keystrokes: [
              { charIndex: 0, atMs: 500 },
              { charIndex: 1, atMs: 505 },
              { charIndex: 2, atMs: 805 },
            ],
          },
        ],
      },
    ];
    const result = computeCalibration(steps);
    expect(result.steps[2]!.ikiSamplesMs).toEqual([300]);
    expect(result.steps[2]!.discardedSamples).toBe(1);
  });
});

describe("measureStep", () => {
  it("contributes nothing for a step id the ritual does not define", () => {
    const outcome = measureStep({
      // A content bug must not crash a child's first twenty seconds.
      id: "warp" as never,
      words: [{ word: "charge", shownAtMs: 0, keystrokes: typed(0, 500, [300, 300]) }],
    });
    expect(outcome.attempted).toBe(true);
    expect(outcome.fkLatencySamplesMs).toEqual([]);
    expect(outcome.ikiSamplesMs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-11.3 - nothing grade-shaped anywhere in the output
// ---------------------------------------------------------------------------

const GRADE_LIKE =
  /score|accuracy|correct|wrong|grade|pass|fail|rating|rank|star|wpm|percent|mistake|typo|point|streak|level|best|error|success/i;

function everyKey(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) everyKey(item, out);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      out.push(key);
      everyKey(child, out);
    }
  }
  return out;
}

describe("AC-11.3 - the ritual is narrative, not a test (D31)", () => {
  const result = computeCalibration(cleanRitual());

  it("AC-11.3: the result exposes no key shaped like a score, accuracy or verdict", () => {
    const offenders = everyKey(result).filter((k) => GRADE_LIKE.test(k));
    expect(offenders).toEqual([]);
  });

  it("AC-11.3: the result's surface is exactly the four measurement fields", () => {
    expect(Object.keys(result).sort()).toEqual([
      "calibration",
      "steps",
      "usedDefaultFkLatency",
      "usedDefaultIki",
    ]);
    expect(Object.keys(result.calibration).sort()).toEqual(["fkLatencyMs", "ikiMs"]);
    expect(Object.keys(result.steps[0]!).sort()).toEqual([
      "attempted",
      "cappedSamples",
      "discardedSamples",
      "fkLatencySamplesMs",
      "id",
      "ikiSamplesMs",
      "keystrokeCount",
    ]);
  });

  it("AC-11.3: accuracy is uncomputable - the calibration ignores what was shown", () => {
    // The same timings under a completely different prompt give the identical
    // result. Nothing in this module compares a keystroke to a target letter,
    // so there is no score to withhold: there is no score to compute.
    const real = cleanRitual();
    const nonsense: RitualStepInput[] = real.map((step) => ({
      id: step.id,
      words: step.words.map((w) => ({ ...w, word: "zzzzzzzz" })),
    }));
    expect(computeCalibration(nonsense)).toEqual(computeCalibration(real));
  });

  it("AC-11.3: a child who types badly and a child who types well calibrate the same", () => {
    // Identical rhythm, and that is all the ritual ever sees.
    const result2 = computeCalibration(cleanRitual());
    expect(result2.calibration).toEqual(result.calibration);
  });
});

// ---------------------------------------------------------------------------
// AC-11.2 - new profiles only
// ---------------------------------------------------------------------------

describe("needsCalibration (AC-11.2, D51)", () => {
  it("AC-11.2: true for a brand-new profile with no history and the default baseline", () => {
    expect(needsCalibration(profile())).toBe(true);
  });

  it("AC-11.2: false for a returning profile - it is calibrated by history (D51)", () => {
    const returning = profile({
      words: { en: { mars: record({ exposures: 4, ikiMs: [300], lastSeen: 10 }) } },
    });
    expect(needsCalibration(returning)).toBe(false);
  });

  it("AC-11.2: false once the ritual has stored a measured baseline", () => {
    const calibrated = applyCalibration(profile(), { ikiMs: 420, fkLatencyMs: 610 });
    expect(needsCalibration(calibrated)).toBe(false);
  });

  it("counts exposures, stored samples and cleared stops as history", () => {
    expect(hasTypingHistory(profile())).toBe(false);
    expect(hasTypingHistory(profile({ words: { en: { a: record() } } }))).toBe(false);
    expect(hasTypingHistory(profile({ words: { en: { a: record({ exposures: 1 }) } } }))).toBe(true);
    expect(hasTypingHistory(profile({ words: { en: { a: record({ ikiMs: [300] }) } } }))).toBe(true);
    expect(
      hasTypingHistory(profile({ words: { en: { a: record({ fkLatencyMs: [500] }) } } })),
    ).toBe(true);
    expect(hasTypingHistory(profile({ progress: [stop({ cleared: true })] }))).toBe(true);
    expect(hasTypingHistory(profile({ progress: [stop({ bestWpm: 12 })] }))).toBe(true);
    expect(hasTypingHistory(profile({ progress: [stop()] }))).toBe(false);
  });

  it("recognises the shipped default baseline and only that", () => {
    expect(isDefaultCalibration(DEFAULT_CALIBRATION)).toBe(true);
    expect(isDefaultCalibration({ ikiMs: 350, fkLatencyMs: 501 })).toBe(false);
    expect(isDefaultCalibration({ ikiMs: 351, fkLatencyMs: 500 })).toBe(false);
  });
});

describe("applyCalibration (AC-11.1 - stored on the profile)", () => {
  it("returns a new profile carrying the calibration, leaving the original alone", () => {
    const before = profile();
    const after = applyCalibration(before, { ikiMs: 420, fkLatencyMs: 610 });
    expect(after.calibration).toEqual({ ikiMs: 420, fkLatencyMs: 610 });
    expect(before.calibration).toEqual(DEFAULT_CALIBRATION);
    expect(after).not.toBe(before);
  });

  it("copies the calibration, so later edits cannot reach into the profile", () => {
    const source = { ikiMs: 420, fkLatencyMs: 610 };
    const after = applyCalibration(profile(), source);
    expect(after.calibration).not.toBe(source);
  });
});

// ---------------------------------------------------------------------------
// D51 - returning players are calibrated by history
// ---------------------------------------------------------------------------

describe("refineCalibration (D51)", () => {
  it("moves the baseline toward observed play by exactly REFINE_ALPHA", () => {
    const next = refineCalibration(
      { ikiMs: 400, fkLatencyMs: 600 },
      { ikiMs: [300, 300, 300], fkLatencyMs: [500, 500] },
    );
    // 0.8 * 400 + 0.2 * 300 = 380; 0.8 * 600 + 0.2 * 500 = 580.
    expect(next).toEqual({ ikiMs: 380, fkLatencyMs: 580 });
    expect(REFINE_ALPHA).toBe(0.2);
  });

  it("leaves a measure untouched when the stage offered no usable sample", () => {
    const current = { ikiMs: 400, fkLatencyMs: 600 };
    expect(refineCalibration(current, {})).toEqual(current);
    expect(refineCalibration(current, { ikiMs: [] })).toEqual(current);
  });

  it("is bounded by one stage: a hijacked keyboard cannot swing the baseline", () => {
    const current = { ikiMs: 350, fkLatencyMs: 500 };
    const hijacked = refineCalibration(current, {
      ikiMs: [2_900, 2_950, 3_100],
      fkLatencyMs: [4_800],
    });
    // Even a maximally slow stage moves iki by at most alpha of the gap.
    expect(hijacked.ikiMs).toBeLessThanOrEqual(350 + REFINE_ALPHA * (MAX_IKI_MS - 350));
    expect(hijacked.ikiMs).toBeGreaterThan(350);
  });

  it("converges on a steady true speed over repeated stages", () => {
    let calibration = { ...DEFAULT_CALIBRATION };
    for (let stage = 0; stage < 25; stage += 1) {
      calibration = refineCalibration(calibration, { ikiMs: [220, 230, 210, 225] });
    }
    // True median is 222.5. Rounding to whole ms parks the baseline inside a
    // dead zone of ~1/(2*alpha) ms around it - see REFINE_ALPHA.
    const deadZone = 1 / (2 * REFINE_ALPHA);
    expect(calibration.ikiMs).toBeGreaterThanOrEqual(222.5 - deadZone);
    expect(calibration.ikiMs).toBeLessThanOrEqual(222.5 + deadZone);
  });

  it("settles within one trip to Pluto: the half-life is about three stages", () => {
    // D57: six belts. A child who arrives faster than their stored baseline
    // should be mostly caught up by the time they reach Pluto.
    let calibration = { ikiMs: 600, fkLatencyMs: 800 };
    for (let belt = 0; belt < 6; belt += 1) {
      calibration = refineCalibration(calibration, { ikiMs: [300, 300, 300] });
    }
    expect(calibration.ikiMs).toBeLessThan(300 + 0.3 * (600 - 300));
  });

  it("takes the median of the stage first, so one in-stage outlier does nothing", () => {
    const clean = refineCalibration(DEFAULT_CALIBRATION, { ikiMs: [300, 300, 300] });
    const withOutlier = refineCalibration(DEFAULT_CALIBRATION, {
      ikiMs: [300, 300, 300, 59_000],
    });
    expect(withOutlier.ikiMs).toBe(clean.ikiMs);
  });

  it("accepts an explicit alpha and defends against a nonsensical one", () => {
    const current = { ikiMs: 400, fkLatencyMs: 600 };
    expect(refineCalibration(current, { ikiMs: [300] }, 1).ikiMs).toBe(300);
    expect(refineCalibration(current, { ikiMs: [300] }, 0).ikiMs).toBe(400);
    expect(refineCalibration(current, { ikiMs: [300] }, 5).ikiMs).toBe(300);
    expect(refineCalibration(current, { ikiMs: [300] }, -2).ikiMs).toBe(400);
    expect(refineCalibration(current, { ikiMs: [300] }, Number.NaN)).toEqual(
      refineCalibration(current, { ikiMs: [300] }),
    );
  });

  it("holds the result inside the documented bounds", () => {
    const wild = refineCalibration({ ikiMs: 99_999, fkLatencyMs: -5 }, {});
    expect(wild.ikiMs).toBe(MAX_IKI_MS);
    expect(wild.fkLatencyMs).toBe(MIN_FK_LATENCY_MS);
  });
});

describe("calibrationFromHistory (D51)", () => {
  const played: CalibratableProfile = profile({
    words: {
      en: {
        mars: record({ exposures: 3, lastSeen: 300, ikiMs: [260, 270, 280], fkLatencyMs: [450] }),
        dust: record({ exposures: 2, lastSeen: 200, ikiMs: [700, 700], fkLatencyMs: [900] }),
        never: record(),
      },
      es: {
        rojo: record({ exposures: 1, lastSeen: 100, ikiMs: [900], fkLatencyMs: [1_100] }),
      },
    },
  });

  it("rebuilds a baseline from stored samples instead of re-running the ritual", () => {
    const calibration = calibrationFromHistory(played);
    // iki samples pooled: 280,270,260,700,700,900 -> median 490.
    expect(calibration.ikiMs).toBe(490);
    expect(calibration.fkLatencyMs).toBe(900);
  });

  it("can be restricted to one content language", () => {
    const es = calibrationFromHistory(played, { lang: "es" });
    expect(es.ikiMs).toBe(900);
    expect(es.fkLatencyMs).toBe(1_100);
  });

  it("visits the most recently seen words first when the window is small", () => {
    const recent = calibrationFromHistory(played, { window: 2 });
    // Newest word is "mars" (lastSeen 300), newest-last samples 280 then 270.
    expect(recent.ikiMs).toBe(275);
  });

  it("stops at the window even when it spans more than one word", () => {
    const recent = calibrationFromHistory(played, { window: 4 });
    // mars 280,270,260 then dust 700 -> median of 260,270,280,700 = 275.
    expect(recent.ikiMs).toBe(275);
  });

  it("keeps the stored baseline when history has nothing to say", () => {
    const fresh = profile({
      calibration: { ikiMs: 410, fkLatencyMs: 620 },
      words: { en: { never: record() } },
    });
    expect(calibrationFromHistory(fresh)).toEqual({ ikiMs: 410, fkLatencyMs: 620 });
  });

  it("applies the same ceilings as the ritual", () => {
    const slow = profile({
      words: { en: { mars: record({ lastSeen: 1, ikiMs: [90_000], fkLatencyMs: [90_000] }) } },
    });
    expect(calibrationFromHistory(slow)).toEqual({
      ikiMs: MAX_IKI_MS,
      fkLatencyMs: MAX_FK_LATENCY_MS,
    });
  });

  it("defaults to the documented sample window", () => {
    expect(HISTORY_SAMPLE_WINDOW).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// End to end: the two paths a profile can take (AC-11.2)
// ---------------------------------------------------------------------------

describe("the two calibration paths", () => {
  it("AC-11.2: a new pilot rituals once, then is never asked again", () => {
    const fresh = profile();
    expect(needsCalibration(fresh)).toBe(true);

    const result = computeCalibration(cleanRitual());
    const stored = applyCalibration(fresh, result.calibration);
    expect(stored.calibration).toEqual({ ikiMs: 300, fkLatencyMs: 500 });
    expect(needsCalibration(stored)).toBe(false);

    // And ordinary play keeps the baseline current, without another ritual.
    const afterAStage = applyCalibration(
      stored,
      refineCalibration(stored.calibration, { ikiMs: [240, 250, 245] }),
    );
    expect(afterAStage.calibration.ikiMs).toBeLessThan(300);
    expect(needsCalibration(afterAStage)).toBe(false);
  });
});
