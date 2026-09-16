import { describe, expect, it } from "vitest";
import {
  FASTER_IMPROVEMENT_THRESHOLD,
  computeStageResults,
  meanOf,
  medianOf,
  previousStageProgress,
  retentionLine,
  wordProgressMarker,
} from "@engine/scoring/index.js";
import type { StageTally, WordExposure } from "@engine/scoring/index.js";
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

describe("medianOf / meanOf", () => {
  it("returns null for an empty sample set, not 0", () => {
    expect(medianOf([])).toBeNull();
    expect(meanOf([])).toBeNull();
  });

  it("takes the middle of an odd set and the mean of the middle two", () => {
    expect(medianOf([5, 1, 3])).toBe(3);
    expect(medianOf([4, 1, 3, 2])).toBe(2.5);
    expect(medianOf([7])).toBe(7);
  });

  it("does not mutate the input", () => {
    const samples = [3, 1, 2];
    medianOf(samples);
    expect(samples).toEqual([3, 1, 2]);
  });

  it("means a sample set", () => {
    expect(meanOf([2, 4, 6])).toBe(4);
    expect(meanOf([-10, 10])).toBe(0);
  });
});

describe("previousStageProgress (AC-20.1)", () => {
  it("AC-20.1: finds the nearest cleared earlier stop for this profile", () => {
    const p = profile([
      stopProgress("earth", { bestWpm: 10 }),
      stopProgress("mars", { bestWpm: 20 }),
      stopProgress("jupiter", { bestWpm: 30 }),
    ]);
    expect(previousStageProgress(p, "jupiter")?.stopId).toBe("mars");
  });

  it("AC-20.1: skips stops that were never cleared", () => {
    const p = profile([
      stopProgress("earth", { bestWpm: 10 }),
      stopProgress("mars", { cleared: false, bestWpm: 20 }),
    ]);
    expect(previousStageProgress(p, "jupiter")?.stopId).toBe("earth");
  });

  it("AC-20.1: returns null for the first stage with no previous stage", () => {
    expect(previousStageProgress(profile([]), "mars")).toBeNull();
    expect(previousStageProgress(profile([]), "earth")).toBeNull();
  });

  it("AC-20.1: returns null when every earlier stop is uncleared", () => {
    const p = profile([stopProgress("earth", { cleared: false })]);
    expect(previousStageProgress(p, "mars")).toBeNull();
  });

  it("does not depend on the order of the progress array", () => {
    const p = profile([
      stopProgress("jupiter", { bestWpm: 30 }),
      stopProgress("earth", { bestWpm: 10 }),
      stopProgress("mars", { bestWpm: 20 }),
    ]);
    expect(previousStageProgress(p, "jupiter")?.bestWpm).toBe(20);
  });

  it("returns null for an unknown stop id", () => {
    const p = profile([stopProgress("earth")]);
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
        // Newest last, so 1000 is the FIRST exposure. Delta = 700 - 1000.
        prior: wordRecord({ fkLatencyMs: [1000, 800] }),
      }),
      exposure({
        word: "cold",
        retention: true,
        hit: true,
        fkLatencyMs: [600],
        prior: wordRecord({ fkLatencyMs: [800, 650] }),
      }),
      exposure({
        word: "sky",
        retention: true,
        hit: false,
        fkLatencyMs: [1000],
        prior: wordRecord({ fkLatencyMs: [900] }),
      }),
    ]);
    expect(line.wordCount).toBe(3);
    expect(line.hitRate).toBeCloseTo(2 / 3, 10);
    // (-300 + -200 + 100) / 3 = -133.33; negative = faster than first time.
    expect(line.meanLatencyDeltaMs).toBeCloseTo(-400 / 3, 10);
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

  it("AC-20.3: retention words with no comparable pair still report a hit rate", () => {
    const line = retentionLine([
      exposure({ retention: true, hit: true, fkLatencyMs: [], prior: null }),
      exposure({ retention: true, hit: true, fkLatencyMs: [500], prior: null }),
      exposure({
        retention: true,
        hit: true,
        fkLatencyMs: [],
        prior: wordRecord({ fkLatencyMs: [700] }),
      }),
    ]);
    expect(line.wordCount).toBe(3);
    expect(line.hitRate).toBe(1);
    expect(line.meanLatencyDeltaMs).toBeNull();
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
        stopProgress("earth", { bestWpm: 10, bestAccuracy: 0.5 }),
        stopProgress("mars", { bestWpm: 45, bestAccuracy: 0.9 }),
      ]),
    });
    expect(r.previousStopId).toBe("mars");
    expect(r.wpmDelta).toBeCloseTo(15, 10);
    expect(r.accuracyDelta).toBeCloseTo(0.05, 10);
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
        stopProgress("earth", { bestWpm: 10 }),
        stopProgress("mars", { bestWpm: 80, bestAccuracy: 1 }),
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
          prior: wordRecord({ fkLatencyMs: [1000] }),
        }),
        exposure({
          word: "red",
          retention: true,
          hit: true,
          fkLatencyMs: [600],
          prior: wordRecord({ fkLatencyMs: [900] }),
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
    for (const v of Object.values(r)) {
      expect(typeof v === "number" ? Number.isFinite(v) : true).toBe(true);
    }
  });
});
