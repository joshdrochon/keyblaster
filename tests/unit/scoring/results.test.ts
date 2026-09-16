import { describe, expect, it } from "vitest";
import {
  FASTER_IMPROVEMENT_THRESHOLD,
  computeStageResults,
  meanOf,
  previousStageProgress,
  retentionLine,
  wordProgressMarker,
} from "@engine/scoring/index.js";
import type { StageTally, WordExposure } from "@engine/scoring/index.js";
import { SAMPLE_CAP, pushCapped } from "@engine/words/index.js";
import { profile, stopProgress, wordRecord } from "./fixtures.js";

const TALLY: StageTally = {
  characters: 300,
  elapsedMs: 60_000,
  hits: 19,
  typos: 1,
  hullHits: 0,
};

function exposure(over: Partial<WordExposure> = {}): WordExposure {
  return {
    word: "dust",
    fkLatencyMs: [],
    hit: true,
    retention: false,
    prior: null,
    ...over,
  };
}

/** Recursively assert no NaN/Infinity hides in a nested results object. */
function expectAllFinite(value: unknown, path = "$"): void {
  if (typeof value === "number") {
    expect(Number.isFinite(value), `${path} = ${value}`).toBe(true);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => expectAllFinite(v, `${path}[${i}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      expectAllFinite(v, `${path}.${k}`);
    }
  }
}

describe("meanOf", () => {
  it("returns null for an empty sample set, not 0", () => {
    expect(meanOf([])).toBeNull();
  });

  it("means a sample set", () => {
    expect(meanOf([2, 4, 6])).toBe(4);
    expect(meanOf([-10, 10])).toBe(0);
  });

  it("discards non-finite samples instead of returning NaN (AC-18.4)", () => {
    expect(meanOf([2, Number.NaN, 4])).toBe(3);
    expect(meanOf([Number.POSITIVE_INFINITY, 10])).toBe(10);
    expect(meanOf([Number.NaN])).toBeNull();
  });

  it("does not mutate the input", () => {
    const samples = [3, 1, 2];
    meanOf(samples);
    expect(samples).toEqual([3, 1, 2]);
  });
});

describe("previousStageProgress (AC-20.1)", () => {
  it("AC-20.1: finds the nearest cleared earlier belt stop for this profile", () => {
    const p = profile([
      stopProgress("earth"),
      stopProgress("mars", { lastWpm: 20 }),
      stopProgress("jupiter", { lastWpm: 30 }),
    ]);
    expect(previousStageProgress(p, "jupiter")?.stopId).toBe("mars");
  });

  it("AC-20.1 / D57: Earth is never a previous stage - it has no belt", () => {
    // Earth is cleared by typing one word (AC-12.1) and has no flight, so its
    // WPM and accuracy are structurally absent. Treating it as a previous stage
    // invents a delta out of stored zeroes. It stays excluded even when the
    // profile has (wrongly) recorded figures against it.
    const p = profile([
      stopProgress("earth", { lastWpm: 999, lastAccuracy: 1, bestWpm: 999 }),
    ]);
    expect(previousStageProgress(p, "mars")).toBeNull();
    expect(previousStageProgress(p, "jupiter")).toBeNull();
  });

  it("AC-20.1: skips belt stops that were never cleared", () => {
    const p = profile([
      stopProgress("earth"),
      stopProgress("mars", { cleared: false, lastWpm: 20 }),
    ]);
    expect(previousStageProgress(p, "jupiter")).toBeNull();
  });

  it("AC-20.1: walks past an uncleared stop to an earlier cleared one", () => {
    const p = profile([
      stopProgress("mars", { lastWpm: 20 }),
      stopProgress("jupiter", { cleared: false }),
    ]);
    expect(previousStageProgress(p, "saturn")?.stopId).toBe("mars");
  });

  it("AC-20.1: returns null for the first stage with no previous stage", () => {
    expect(previousStageProgress(profile([]), "mars")).toBeNull();
  });

  it("AC-20.1: Earth itself has no previous stage", () => {
    expect(previousStageProgress(profile([]), "earth")).toBeNull();
  });

  it("does not depend on the order of the progress array", () => {
    const p = profile([
      stopProgress("jupiter", { lastWpm: 30 }),
      stopProgress("earth"),
      stopProgress("mars", { lastWpm: 20 }),
    ]);
    expect(previousStageProgress(p, "jupiter")?.lastWpm).toBe(20);
  });

  it("returns null for an unknown stop id", () => {
    const p = profile([stopProgress("mars")]);
    // Deliberately outside StopId to exercise the defensive branch.
    expect(previousStageProgress(p, "ceres" as never)).toBeNull();
  });
});

describe("wordProgressMarker (AC-20.2)", () => {
  it("AC-20.2: marks a word faster when the median improves by exactly 15%", () => {
    expect(FASTER_IMPROVEMENT_THRESHOLD).toBe(0.15);
    const m = wordProgressMarker(
      exposure({
        fkLatencyMs: [850],
        prior: wordRecord({ fkLatencyMs: [1000] }),
      }),
    );
    expect(m.faster).toBe(true);
    expect(m.improvement).toBeCloseTo(0.15, 10);
  });

  it("AC-20.2: does not mark a word faster below the 15% threshold", () => {
    const m = wordProgressMarker(
      exposure({
        fkLatencyMs: [860],
        prior: wordRecord({ fkLatencyMs: [1000] }),
      }),
    );
    expect(m.faster).toBe(false);
    expect(m.improvement).toBeCloseTo(0.14, 10);
  });

  it("AC-20.2: compares medians, not single samples", () => {
    // Prior median 1000, current median 600 => 40% faster, even though one
    // current sample (1200) is slower than every prior sample.
    const m = wordProgressMarker(
      exposure({
        fkLatencyMs: [400, 600, 1200],
        prior: wordRecord({ fkLatencyMs: [900, 1000, 1100] }),
      }),
    );
    expect(m.priorMedianLatencyMs).toBe(1000);
    expect(m.medianLatencyMs).toBe(600);
    expect(m.faster).toBe(true);
  });

  it("AC-20.2: a word with no prior exposure is never marked faster", () => {
    const m = wordProgressMarker(exposure({ fkLatencyMs: [500], prior: null }));
    expect(m.faster).toBe(false);
    expect(m.priorMedianLatencyMs).toBeNull();
    expect(m.improvement).toBeNull();
    expect(m.medianLatencyMs).toBe(500);
  });

  it("AC-20.2: a prior record with no samples yet is treated as no prior", () => {
    const m = wordProgressMarker(
      exposure({ fkLatencyMs: [500], prior: wordRecord({ fkLatencyMs: [] }) }),
    );
    expect(m.faster).toBe(false);
    expect(m.improvement).toBeNull();
  });

  it("AC-20.2: a word with no sample this stage yields nulls, not zeros", () => {
    const m = wordProgressMarker(
      exposure({ fkLatencyMs: [], prior: wordRecord({ fkLatencyMs: [900] }) }),
    );
    expect(m.medianLatencyMs).toBeNull();
    expect(m.faster).toBe(false);
    expect(m.improvement).toBeNull();
  });

  it("guards a zero prior median instead of dividing by zero", () => {
    const m = wordProgressMarker(
      exposure({ fkLatencyMs: [100], prior: wordRecord({ fkLatencyMs: [0] }) }),
    );
    expect(m.faster).toBe(false);
    expect(m.improvement).toBeNull();
  });

  it("AC-18.4: corrupt NaN samples never reach `improvement` as NaN", () => {
    // words/median discards non-finite samples; anything it still can't answer
    // must come back null. `improvement` is typed `number | null`, and a NaN
    // there would render as "NaN% faster".
    const allJunk = wordProgressMarker(
      exposure({
        fkLatencyMs: [Number.NaN],
        prior: wordRecord({ fkLatencyMs: [Number.NaN, Number.NaN] }),
      }),
    );
    expect(allJunk.improvement).toBeNull();
    expect(allJunk.medianLatencyMs).toBeNull();
    expect(allJunk.priorMedianLatencyMs).toBeNull();
    expect(allJunk.faster).toBe(false);

    const halfJunk = wordProgressMarker(
      exposure({
        fkLatencyMs: [500, Number.NaN],
        prior: wordRecord({ fkLatencyMs: [1000, Number.POSITIVE_INFINITY] }),
      }),
    );
    expect(halfJunk.improvement).toBeCloseTo(0.5, 10);
    expect(halfJunk.faster).toBe(true);
  });

  it("AC-20.2: a slower word reports a negative improvement and no marker", () => {
    const m = wordProgressMarker(
      exposure({
        fkLatencyMs: [1200],
        prior: wordRecord({ fkLatencyMs: [1000] }),
      }),
    );
    expect(m.faster).toBe(false);
    expect(m.improvement).toBeCloseTo(-0.2, 10);
  });

  it("carries the word through unchanged", () => {
    expect(wordProgressMarker(exposure({ word: "rivers" })).word).toBe("rivers");
  });
});

describe("retentionLine (AC-20.3)", () => {
  it("AC-20.3: reports % hit and mean latency delta vs FIRST exposure", () => {
    const line = retentionLine([
      // Not retention: must be ignored entirely.
      exposure({ word: "dust", hit: false, fkLatencyMs: [900] }),
      exposure({
        word: "red",
        retention: true,
        hit: true,
        fkLatencyMs: [700],
        prior: wordRecord({ firstFkLatencyMs: 1000, fkLatencyMs: [820, 800] }),
      }),
      exposure({
        word: "cold",
        retention: true,
        hit: true,
        fkLatencyMs: [600],
        prior: wordRecord({ firstFkLatencyMs: 800, fkLatencyMs: [700, 650] }),
      }),
      exposure({
        word: "sky",
        retention: true,
        hit: false,
        fkLatencyMs: [1000],
        prior: wordRecord({ firstFkLatencyMs: 900, fkLatencyMs: [900] }),
      }),
    ]);
    expect(line.wordCount).toBe(3);
    expect(line.hitRate).toBeCloseTo(2 / 3, 10);
    // (-300 + -200 + 100) / 3 = -133.33; negative = faster than first time.
    expect(line.meanLatencyDeltaMs).toBeCloseTo(-400 / 3, 10);
  });

  it("AC-20.3: the baseline survives the rolling-window cap (words/SAMPLE_CAP)", () => {
    // This is the case the retention line exists for: a high-exposure word
    // (D21) whose first exposure has long been evicted from fkLatencyMs. Reading
    // fkLatencyMs[0] here reports roughly -10 ms; the true improvement since the
    // word was first met is roughly -1410 ms.
    let window: number[] = [2000];
    for (let i = 0; i < SAMPLE_CAP + 5; i++) {
      window = pushCapped(window, 600 - (i % 3) * 5, SAMPLE_CAP);
    }
    expect(window.length).toBe(SAMPLE_CAP);
    expect(window).not.toContain(2000);

    const line = retentionLine([
      exposure({
        word: "beacon",
        retention: true,
        hit: true,
        fkLatencyMs: [590],
        prior: wordRecord({
          exposures: SAMPLE_CAP + 6,
          firstFkLatencyMs: 2000,
          fkLatencyMs: window,
        }),
      }),
    ]);
    expect(line.meanLatencyDeltaMs).toBe(590 - 2000);
    expect(line.meanLatencyDeltaMs).toBeLessThan(-1000);
  });

  it("AC-20.3: first stage with no retention words returns nulls, not zeros", () => {
    const line = retentionLine([exposure(), exposure({ word: "rust" })]);
    expect(line).toEqual({
      wordCount: 0,
      hitRate: null,
      meanLatencyDeltaMs: null,
    });
  });

  it("AC-20.3: an empty exposure list is safe", () => {
    expect(retentionLine([])).toEqual({
      wordCount: 0,
      hitRate: null,
      meanLatencyDeltaMs: null,
    });
  });

  it("AC-20.3: retention words with no usable baseline still report a hit rate", () => {
    const line = retentionLine([
      exposure({ retention: true, hit: true, fkLatencyMs: [], prior: null }),
      exposure({ retention: true, hit: true, fkLatencyMs: [500], prior: null }),
      // Has a window but no recorded first exposure (legacy/corrupt record).
      exposure({
        retention: true,
        hit: true,
        fkLatencyMs: [500],
        prior: wordRecord({ firstFkLatencyMs: null, fkLatencyMs: [700] }),
      }),
      // Has a first exposure but no sample this stage.
      exposure({
        retention: true,
        hit: true,
        fkLatencyMs: [],
        prior: wordRecord({ firstFkLatencyMs: 700 }),
      }),
    ]);
    expect(line.wordCount).toBe(4);
    expect(line.hitRate).toBe(1);
    expect(line.meanLatencyDeltaMs).toBeNull();
  });

  it("AC-18.4: a corrupt first-exposure latency is ignored, not propagated", () => {
    const line = retentionLine([
      exposure({
        retention: true,
        hit: true,
        fkLatencyMs: [500],
        prior: wordRecord({ firstFkLatencyMs: Number.NaN }),
      }),
      exposure({
        retention: true,
        hit: true,
        fkLatencyMs: [500],
        prior: wordRecord({ firstFkLatencyMs: 0 }),
      }),
      exposure({
        retention: true,
        hit: true,
        fkLatencyMs: [500],
        prior: wordRecord({ firstFkLatencyMs: 900 }),
      }),
    ]);
    expect(line.meanLatencyDeltaMs).toBe(-400);
  });

  it("AC-20.3: a fully missed retention set reports 0% hit without NaN", () => {
    const line = retentionLine([
      exposure({ retention: true, hit: false, fkLatencyMs: [900] }),
    ]);
    expect(line.hitRate).toBe(0);
    expect(line.meanLatencyDeltaMs).toBeNull();
  });
});

describe("computeStageResults", () => {
  it("AC-20.1: reports stage WPM and accuracy", () => {
    const r = computeStageResults({
      stopId: "mars",
      tally: TALLY,
      exposures: [],
      profile: profile([]),
    });
    expect(r.stopId).toBe("mars");
    expect(r.wpm).toBe(60);
    expect(r.accuracy).toBe(0.95);
  });

  it("AC-20.1: reports the delta vs the same profile's previous stage", () => {
    const r = computeStageResults({
      stopId: "jupiter",
      tally: TALLY,
      exposures: [],
      profile: profile([
        stopProgress("earth"),
        stopProgress("mars", { lastWpm: 45, lastAccuracy: 0.9 }),
      ]),
    });
    expect(r.previousStopId).toBe("mars");
    expect(r.wpmDelta).toBeCloseTo(15, 10);
    expect(r.accuracyDelta).toBeCloseTo(0.05, 10);
  });

  it("AC-20.1 / D31: the delta is vs the previous LAST run, not its best", () => {
    // Mars peaked at 70 once and settled at 50. Jupiter at 60 is an improvement
    // on current form. A best-based delta would render that as "-10" - steady
    // improvement shown as regression, which is the D31 failure mode.
    const r = computeStageResults({
      stopId: "jupiter",
      tally: TALLY,
      exposures: [],
      profile: profile([
        stopProgress("mars", {
          bestWpm: 70,
          bestAccuracy: 0.99,
          lastWpm: 50,
          lastAccuracy: 0.9,
        }),
      ]),
    });
    expect(r.wpmDelta).toBeCloseTo(10, 10);
    expect(r.accuracyDelta).toBeCloseTo(0.05, 10);
  });

  it("AC-20.1 / D57: Mars shows no delta - Earth is not a previous stage", () => {
    // The first results screen a child ever sees. Earth's stored figures are
    // structurally zero, so a delta against them would read "+60 WPM, +95%
    // accuracy" out of nothing at all.
    const r = computeStageResults({
      stopId: "mars",
      tally: TALLY,
      exposures: [],
      profile: profile([stopProgress("earth")]),
    });
    expect(r.previousStopId).toBeNull();
    expect(r.wpmDelta).toBeNull();
    expect(r.accuracyDelta).toBeNull();
  });

  it("AC-20.1: a first stage with no previous stage reports null deltas", () => {
    const r = computeStageResults({
      stopId: "mars",
      tally: TALLY,
      exposures: [],
      profile: profile([]),
    });
    expect(r.previousStopId).toBeNull();
    expect(r.wpmDelta).toBeNull();
    expect(r.accuracyDelta).toBeNull();
  });

  it("AC-20.1: a delta may be negative without being a failure value", () => {
    const r = computeStageResults({
      stopId: "jupiter",
      tally: TALLY,
      exposures: [],
      profile: profile([
        stopProgress("mars", { lastWpm: 80, lastAccuracy: 1 }),
      ]),
    });
    expect(r.wpmDelta).toBeCloseTo(-20, 10);
    expect(r.accuracyDelta).toBeCloseTo(-0.05, 10);
  });

  it("AC-20.4: stars are wired through from the hull-hit tally", () => {
    const stars = [0, 1, 2].map(
      (hullHits) =>
        computeStageResults({
          stopId: "mars",
          tally: { ...TALLY, hullHits },
          exposures: [],
          profile: profile([]),
        }).stars,
    );
    expect(stars).toEqual([3, 2, 1]);
  });

  it("AC-20.4: the stall tally (3 hits, D29) surfaces as 0, never as a rating", () => {
    const r = computeStageResults({
      stopId: "mars",
      tally: { ...TALLY, hullHits: 3 },
      exposures: [],
      profile: profile([]),
    });
    expect(r.stars).toBe(0);
  });

  it("AC-20.2 + AC-20.3: per-word markers and the retention line are included", () => {
    const r = computeStageResults({
      stopId: "jupiter",
      tally: TALLY,
      exposures: [
        exposure({
          word: "ice",
          fkLatencyMs: [500],
          prior: wordRecord({ firstFkLatencyMs: 1000, fkLatencyMs: [1000] }),
        }),
        exposure({
          word: "red",
          retention: true,
          hit: true,
          fkLatencyMs: [600],
          prior: wordRecord({ firstFkLatencyMs: 900, fkLatencyMs: [900] }),
        }),
      ],
      profile: profile([]),
    });
    expect(r.words.map((w) => w.word)).toEqual(["ice", "red"]);
    expect(r.words.every((w) => w.faster)).toBe(true);
    expect(r.retention.wordCount).toBe(1);
    expect(r.retention.hitRate).toBe(1);
    expect(r.retention.meanLatencyDeltaMs).toBe(-300);
  });

  it("survives a zero-length stage with no words at all", () => {
    const r = computeStageResults({
      stopId: "mars",
      tally: { characters: 0, elapsedMs: 0, hits: 0, typos: 0, hullHits: 0 },
      exposures: [],
      profile: profile([]),
    });
    expect(r.wpm).toBe(0);
    expect(r.accuracy).toBe(1);
    expect(r.stars).toBe(3);
    expect(r.words).toEqual([]);
    expect(r.retention.wordCount).toBe(0);
    expectAllFinite(r);
  });

  it("AC-18.4: a fully corrupt stage produces no NaN anywhere, at any depth", () => {
    const r = computeStageResults({
      stopId: "jupiter",
      tally: {
        characters: Number.NaN,
        elapsedMs: Number.NaN,
        hits: Number.NaN,
        typos: Number.NaN,
        hullHits: Number.NaN,
      },
      exposures: [
        exposure({
          word: "ice",
          retention: true,
          fkLatencyMs: [Number.NaN, Number.POSITIVE_INFINITY],
          prior: wordRecord({
            firstFkLatencyMs: Number.NaN,
            fkLatencyMs: [Number.NaN],
          }),
        }),
      ],
      profile: profile([
        stopProgress("mars", { lastWpm: 40, lastAccuracy: 0.8 }),
      ]),
    });
    // The nested `words[0].improvement` is exactly where NaN used to hide.
    expectAllFinite(r);
    expect(r.words[0]?.improvement).toBeNull();
    expect(r.retention.meanLatencyDeltaMs).toBeNull();
    expect(r.stars).toBe(0);
  });
});
