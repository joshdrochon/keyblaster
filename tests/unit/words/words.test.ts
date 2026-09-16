import { describe, expect, it } from "vitest";
import {
  EASE_FACTOR,
  FAST_HIT_FK_LATENCY_MS,
  SAMPLE_CAP,
  type WordEvent,
  applyEvent,
  applyToBook,
  blankRecord,
  bookOf,
  clampEase,
  easeAfterHit,
  easeAfterMiss,
  easeAfterTypo,
  intervalStages,
  isEligible,
  masteryOf,
  median,
  medianFkLatency,
  medianIki,
  newEase,
  nextStageAfterHit,
  nextStageAfterMiss,
  pushCapped,
  recordFor,
  withRecord,
} from "@engine/words/index.js";
import { EASE_MAX, EASE_MIN, EASE_NEW, type WordRecord } from "@engine/types.js";

const hit = (fk: number, stage = 1, atMs = 1000, ikiMs: number[] = []): WordEvent =>
  ({ kind: "hit", fkLatencyMs: fk, ikiMs, atMs, stage });
const miss = (stage = 1, atMs = 1000): WordEvent => ({ kind: "miss", atMs, stage });
const typo = (stage = 1, atMs = 1000): WordEvent => ({ kind: "typo", atMs, stage });

describe("median", () => {
  it("returns null for an empty sample, never NaN", () => {
    expect(median([])).toBeNull();
  });
  it("takes the middle of an odd sample", () => {
    expect(median([300, 100, 200])).toBe(200);
  });
  it("averages the two middles of an even sample", () => {
    expect(median([100, 200, 300, 400])).toBe(250);
  });
  it("does not mutate its input", () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
  it("resists a single wild outlier, which a mean would not", () => {
    // The reason the engine uses medians at all (D51): a child looks away.
    const normal = [300, 320, 310, 305];
    const withOutlier = [...normal, 45000];
    expect(median(withOutlier)).toBeLessThan(400);
  });
});

describe("pushCapped", () => {
  it("keeps the most recent samples only", () => {
    expect(pushCapped([1, 2, 3], 4, 3)).toEqual([2, 3, 4]);
  });
  it("appends while under the cap", () => {
    expect(pushCapped([1], 2, 3)).toEqual([1, 2]);
  });
  it("does not mutate its input", () => {
    const xs = [1, 2];
    pushCapped(xs, 3, 2);
    expect(xs).toEqual([1, 2]);
  });
});

describe("ease updates (architecture 4.1)", () => {
  it("uses the documented multipliers", () => {
    expect(EASE_FACTOR.fastHit).toBe(0.85);
    expect(EASE_FACTOR.slowHit).toBe(0.95);
    expect(EASE_FACTOR.miss).toBe(1.25);
    expect(EASE_FACTOR.typo).toBe(1.05);
    expect(FAST_HIT_FK_LATENCY_MS).toBe(800);
    expect(newEase()).toBe(EASE_NEW);
    expect(EASE_NEW).toBe(1.6);
  });

  it("a fast hit makes a word easier", () => {
    expect(easeAfterHit(1.0, 500)).toBeCloseTo(0.85, 10);
  });

  it("a slow hit makes it only slightly easier", () => {
    expect(easeAfterHit(1.0, 1500)).toBeCloseTo(0.95, 10);
  });

  it("treats exactly the threshold as slow, not fast", () => {
    // Boundary pinned so a future edit cannot flip it silently.
    expect(easeAfterHit(1.0, FAST_HIT_FK_LATENCY_MS)).toBeCloseTo(0.95, 10);
    expect(easeAfterHit(1.0, FAST_HIT_FK_LATENCY_MS - 1)).toBeCloseTo(0.85, 10);
  });

  it("a miss makes it harder", () => {
    expect(easeAfterMiss(1.0)).toBeCloseTo(1.25, 10);
  });

  it("a typo is the gentlest nudge of the four (D31)", () => {
    expect(easeAfterTypo(1.0)).toBeCloseTo(1.05, 10);
    const deltas = [
      Math.abs(1 - EASE_FACTOR.typo),
      Math.abs(1 - EASE_FACTOR.fastHit),
      Math.abs(1 - EASE_FACTOR.slowHit),
      Math.abs(1 - EASE_FACTOR.miss),
    ];
    expect(Math.min(...deltas)).toBe(Math.abs(1 - EASE_FACTOR.slowHit));
    // typo must be gentler than a miss: missing is informative, fumbling is not
    expect(Math.abs(1 - EASE_FACTOR.typo)).toBeLessThan(Math.abs(1 - EASE_FACTOR.miss));
  });

  it("clamps to [0.25, 2.0] in both directions", () => {
    expect(clampEase(-5)).toBe(EASE_MIN);
    expect(clampEase(99)).toBe(EASE_MAX);
    expect(clampEase(1.0)).toBe(1.0);
    // and the update functions respect the clamp
    let e = 2.0;
    for (let i = 0; i < 20; i++) e = easeAfterMiss(e);
    expect(e).toBe(EASE_MAX);
    let f = 0.25;
    for (let i = 0; i < 20; i++) f = easeAfterHit(f, 100);
    expect(f).toBe(EASE_MIN);
  });
});

describe("AC-7.1: every outcome updates the record deterministically", () => {
  it("a hit increments exposures and hits and records timings", () => {
    const r = applyEvent(blankRecord(), hit(400, 2, 5000, [200, 220]));
    expect(r.exposures).toBe(1);
    expect(r.hits).toBe(1);
    expect(r.misses).toBe(0);
    expect(r.fkLatencyMs).toEqual([400]);
    expect(r.ikiMs).toEqual([200, 220]);
    expect(r.lastSeen).toBe(5000);
    expect(r.ease).toBeCloseTo(EASE_NEW * 0.85, 10);
  });

  it("a miss increments exposures and misses and raises ease", () => {
    const r = applyEvent(blankRecord(), miss(2, 5000));
    expect(r.exposures).toBe(1);
    expect(r.misses).toBe(1);
    expect(r.hits).toBe(0);
    expect(r.ease).toBe(EASE_MAX); // 1.6 * 1.25 = 2.0
    expect(r.lastSeen).toBe(5000);
  });

  it("a typo is NOT an exposure", () => {
    // The player is mid-word and still holds the lock (AC-3.2). Counting it
    // would inflate the retention denominator with one clumsy word.
    const r = applyEvent(blankRecord(), typo(1, 5000));
    expect(r.exposures).toBe(0);
    expect(r.typos).toBe(1);
    expect(r.lastSeen).toBeNull();
    expect(r.ease).toBeCloseTo(EASE_NEW * 1.05, 10);
  });

  it("is pure: the input record is never mutated", () => {
    const before = blankRecord();
    const snapshot = JSON.parse(JSON.stringify(before));
    applyEvent(before, hit(300, 1, 1000, [100]));
    applyEvent(before, miss());
    applyEvent(before, typo());
    expect(before).toEqual(snapshot);
  });

  it("is deterministic: same record and event give the same result", () => {
    const r = blankRecord();
    const e = hit(412, 3, 9999, [180, 190]);
    expect(applyEvent(r, e)).toEqual(applyEvent(r, e));
  });

  it("caps stored samples so old history cannot outvote current skill", () => {
    let r = blankRecord();
    for (let i = 0; i < SAMPLE_CAP + 10; i++) {
      r = applyEvent(r, hit(300 + i, 1, 1000 + i, [200 + i]));
    }
    expect(r.fkLatencyMs).toHaveLength(SAMPLE_CAP);
    expect(r.ikiMs).toHaveLength(SAMPLE_CAP);
    expect(r.exposures).toBe(SAMPLE_CAP + 10);
    expect(r.fkLatencyMs.at(-1)).toBe(300 + SAMPLE_CAP + 9);
  });

  it("exposes medians, or null before any hit", () => {
    expect(medianFkLatency(blankRecord())).toBeNull();
    expect(medianIki(blankRecord())).toBeNull();
    const r = applyEvent(applyEvent(blankRecord(), hit(300, 1, 1, [100])), hit(500, 1, 2, [200]));
    expect(medianFkLatency(r)).toBe(400);
    expect(medianIki(r)).toBe(150);
  });
});

describe("AC-9.3 / AC-9.4: retention eligibility (D21, D23)", () => {
  it("uses the documented stage intervals", () => {
    expect(intervalStages(1.6)).toBe(1); // weak
    expect(intervalStages(1.0)).toBe(2); // learning
    expect(intervalStages(0.3)).toBe(4); // mastered
  });

  it("pins the interval boundaries", () => {
    expect(intervalStages(1.2)).toBe(2); // not > 1.2, so learning
    expect(intervalStages(1.21)).toBe(1);
    expect(intervalStages(0.5)).toBe(2);
    expect(intervalStages(0.49)).toBe(4);
  });

  it("a never-seen word is always eligible", () => {
    expect(isEligible(undefined, undefined, 0)).toBe(true);
    expect(isEligible(blankRecord(), undefined, 0)).toBe(true);
  });

  it("AC-9.4: a missed word is eligible again the very next stage (D23)", () => {
    const missed = applyEvent(blankRecord(), miss(2, 1000));
    expect(missed.nextEligibleStage).toBe(3);
    expect(nextStageAfterMiss(2)).toBe(3);
    expect(isEligible(missed, 2, 3)).toBe(true);
    expect(isEligible(missed, 2, 2)).toBe(false);
  });

  it("a mastered word waits four stages", () => {
    const mastered: WordRecord = { ...blankRecord(), exposures: 5, ease: 0.3 };
    expect(nextStageAfterHit(1, 0.3)).toBe(5);
    expect(isEligible(mastered, 1, 4)).toBe(false);
    expect(isEligible(mastered, 1, 5)).toBe(true);
  });

  it("respects nextEligibleStage even when the gap looks long enough", () => {
    const r: WordRecord = { ...blankRecord(), exposures: 3, ease: 1.6, nextEligibleStage: 9 };
    expect(isEligible(r, 1, 8)).toBe(false);
    expect(isEligible(r, 1, 9)).toBe(true);
  });
});

describe("mastery buckets (architecture 4.2 weighting)", () => {
  it("classifies by ease and exposure", () => {
    expect(masteryOf(undefined)).toBe("unknown");
    expect(masteryOf(blankRecord())).toBe("unknown");
    expect(masteryOf({ ...blankRecord(), exposures: 1, ease: 1.5 })).toBe("weak");
    expect(masteryOf({ ...blankRecord(), exposures: 1, ease: 1.0 })).toBe("learning");
    expect(masteryOf({ ...blankRecord(), exposures: 1, ease: 0.3 })).toBe("mastered");
  });

  it("pins the bucket boundaries against the weighting table", () => {
    expect(masteryOf({ ...blankRecord(), exposures: 1, ease: 1.2 })).toBe("learning");
    expect(masteryOf({ ...blankRecord(), exposures: 1, ease: 1.21 })).toBe("weak");
    expect(masteryOf({ ...blankRecord(), exposures: 1, ease: 0.5 })).toBe("learning");
    expect(masteryOf({ ...blankRecord(), exposures: 1, ease: 0.49 })).toBe("mastered");
  });
});

describe("word book helpers", () => {
  it("returns a blank record for an unseen word", () => {
    expect(recordFor(undefined, "rust")).toEqual(blankRecord());
    expect(recordFor({}, "rust")).toEqual(blankRecord());
  });

  it("writes without mutating the book", () => {
    const book = { rust: blankRecord() };
    const next = withRecord(book, "dust", blankRecord());
    expect(Object.keys(book)).toEqual(["rust"]);
    expect(Object.keys(next).sort()).toEqual(["dust", "rust"]);
  });

  it("applies an event straight into a book", () => {
    const next = applyToBook({}, "rivers", miss(1, 500));
    expect(next["rivers"]!.misses).toBe(1);
  });

  it("selects the per-language book, defaulting to empty", () => {
    expect(bookOf(undefined, "en")).toEqual({});
    expect(bookOf({ en: { red: blankRecord() } }, "en")["red"]).toBeDefined();
    expect(bookOf({ en: {} }, "hi")).toEqual({});
  });
});

describe("D31: a word's record carries no notion of failure", () => {
  it("counts misses and typos as signal, never as a score", () => {
    // misses/typos exist so the engine can help. Nothing here may be shaped
    // like a grade the child could be shown.
    const r = blankRecord();
    expect(Object.keys(r).sort()).toEqual([
      "ease", "exposures", "fkLatencyMs", "hits", "ikiMs",
      "lastSeen", "misses", "nextEligibleStage", "typos",
    ]);
  });
});
