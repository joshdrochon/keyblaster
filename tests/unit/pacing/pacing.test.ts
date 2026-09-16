import { describe, expect, it } from "vitest";
import {
  CLEAR_BIAS_QUANTILE,
  CLEAR_SAMPLE_WINDOW,
  LEAD_FRACTION_MAX,
  LEAD_FRACTION_MIN,
  MAX_LEAD_MS,
  MAX_SPAWN_GAP_MS,
  MIN_SPAWN_GAP_MS,
  RELIEF_MAX,
  SELECTION_BEAT_MS,
  expectedClearMs,
  hitRateRelief,
  leadFraction,
  observedBiasMs,
  paceSpawn,
  recognitionCostMs,
  spawnGapMs,
} from "@engine/pacing/index.js";
import { RECOGNITION_BASE_MS, fallTimeMs } from "@engine/fallTime/index.js";
import { KNOB_NAMES, MAX_LIVE_MAX, MAX_LIVE_MIN } from "@engine/controller/knobs.js";
import { LOOSEN_BELOW } from "@engine/controller/index.js";
import { DEFAULT_CALIBRATION, EASE_NEW } from "@engine/types.js";

/**
 * SPAWN PACING. The unit half of the fix; the whole-belt half is in
 * `tests/unit/simulation/belt.test.ts`, because "is a stage survivable" is an
 * emergent property and cannot be asserted about one function.
 *
 * What these tests are FOR: the constant that used to sit in `FlightScene` was
 * not wrong by a number, it was wrong by a KIND. A gap that does not read the
 * player cannot be tuned into a gap that does. So the properties asserted here
 * are the ones that make it a different kind of thing - it moves with the
 * player, it never moves against them, and it is not a difficulty knob.
 */

const CAL = DEFAULT_CALIBRATION;
const knobs = (maxLive: number): { maxLive: number } => ({ maxLive });

describe("AC-4.3 / D31: the gap is derived from the player, never a constant", () => {
  it("AC-4.3: a slower typist gets a slower belt, at the same word and ease", () => {
    const quick = expectedClearMs({ length: 5, ease: 1, calibration: { ikiMs: 260, fkLatencyMs: 400 } });
    const median = expectedClearMs({ length: 5, ease: 1, calibration: CAL });
    const slow = expectedClearMs({ length: 5, ease: 1, calibration: { ikiMs: 440, fkLatencyMs: 650 } });
    expect(quick).toBeLessThan(median);
    expect(median).toBeLessThan(slow);
  });

  it("AC-8.1: recognition is fall time's own budget, floored at measured latency", () => {
    // The two halves of FR-8 are the two halves of this: a cold word costs what
    // the fall-time formula already budgets for recognising it, and a mastered
    // one never costs less than the ritual measured (D51).
    expect(recognitionCostMs(EASE_NEW, CAL.fkLatencyMs)).toBe(RECOGNITION_BASE_MS * EASE_NEW);
    expect(recognitionCostMs(0.25, CAL.fkLatencyMs)).toBe(CAL.fkLatencyMs);
  });

  it("AC-4.3: a longer word costs the keystrokes it has, minus the first", () => {
    const three = expectedClearMs({ length: 3, ease: 1, calibration: CAL });
    const seven = expectedClearMs({ length: 7, ease: 1, calibration: CAL });
    expect(seven - three).toBe(4 * CAL.ikiMs);
    // The first key is inside recognition, and the beat is the cost of choosing.
    expect(three).toBe(recognitionCostMs(1, CAL.fkLatencyMs) + 2 * CAL.ikiMs + SELECTION_BEAT_MS);
  });

  it("AC-4.3: the estimate is total - a nonsense length or ease still returns a number", () => {
    for (const length of [Number.NaN, -3, 0, Number.POSITIVE_INFINITY]) {
      const ms = expectedClearMs({ length, ease: 1, calibration: CAL });
      expect(Number.isFinite(ms), `length ${length}`).toBe(true);
      expect(ms).toBeGreaterThan(0);
    }
    expect(expectedClearMs({ length: 4, ease: 1 })).toBe(
      expectedClearMs({ length: 4, ease: 1, calibration: DEFAULT_CALIBRATION }),
    );
  });

  it("AC-4.3: the estimate stays inside the fall time it is paced against", () => {
    // If clearing a word were expected to take longer than the rock's whole
    // fall, no gap could save it. This is the invariant the pacing rests on,
    // over every length and ease the game can produce.
    for (let length = 3; length <= 12; length += 1) {
      for (const ease of [0.25, 0.5, 1, 1.6, 2]) {
        const word = "a".repeat(length);
        const fall = fallTimeMs({ word, ease, calibration: CAL });
        const clear = expectedClearMs({ length, ease, calibration: CAL });
        expect(clear, `len ${length} ease ${ease}`).toBeLessThan(fall);
      }
    }
  });
});

describe("AC-4.3: the belt learns what the player actually costs", () => {
  it("AC-4.3: no evidence reads as null, not as zero", () => {
    expect(observedBiasMs([])).toBeNull();
    expect(observedBiasMs([Number.NaN])).toBeNull();
  });

  it("AC-4.3: a player slower than their estimate stretches the belt", () => {
    const bias = observedBiasMs([600, 700, 650, 800]);
    expect(bias).not.toBeNull();
    expect(bias!).toBeGreaterThan(600);
  });

  it("AC-4.3: a player FASTER than their estimate never speeds it up", () => {
    // Negative residuals are evidence of slack, and slack is spent by the
    // caller's empty-board fast path, never by shortening the gap.
    expect(observedBiasMs([-400, -900, -250])).toBe(0);
  });

  it("AC-4.3: the bias reads the recent window, so a stage can recover", () => {
    const old = Array.from({ length: CLEAR_SAMPLE_WINDOW }, () => 2000);
    const recovered = [...old, ...Array.from({ length: CLEAR_SAMPLE_WINDOW }, () => 0)];
    expect(observedBiasMs(recovered)).toBe(0);
  });

  it("AC-4.3: it paces to the slow end of the window, not the middle", () => {
    // Seven easy rocks and one hard one: a median would ignore the hard one.
    const samples = [0, 0, 0, 0, 0, 0, 0, 1000];
    const bias = observedBiasMs(samples)!;
    expect(CLEAR_BIAS_QUANTILE).toBeGreaterThan(0.5);
    expect(bias).toBeGreaterThan(0);
    expect(bias).toBeLessThanOrEqual(1000);
  });

  it("AC-4.3: one sample is usable - the second rock of a stage already learns", () => {
    expect(observedBiasMs([450])).toBe(450);
  });
});

describe("D31 / AC-10.3: missing makes the belt gentler, never faster", () => {
  it("D31: below the D17 band the gap stretches in proportion to the shortfall", () => {
    expect(hitRateRelief(LOOSEN_BELOW)).toBe(1);
    expect(hitRateRelief(0.7)).toBeCloseTo(1.1, 5);
    expect(hitRateRelief(0.5)).toBeCloseTo(1.3, 5);
  });

  it("D31: the relief is bounded, so one terrible stretch cannot empty the sky", () => {
    expect(hitRateRelief(0)).toBe(RELIEF_MAX);
    expect(hitRateRelief(-5)).toBe(RELIEF_MAX);
  });

  it("D31: no hit rate, however good, shortens the gap through this term", () => {
    for (const rate of [0.8, 0.9, 0.95, 1]) {
      expect(hitRateRelief(rate), `rate ${rate}`).toBe(1);
    }
    expect(hitRateRelief(null)).toBe(1);
    expect(hitRateRelief(Number.NaN)).toBe(1);
  });

  it("D31: a struggling player's belt is strictly slower than a comfortable one's", () => {
    const base = {
      liveClearMs: [2400],
      fallMs: 4000,
      knobs: knobs(MAX_LIVE_MIN),
      biasMs: 0,
    };
    const comfortable = spawnGapMs({ ...base, hitRate: 0.95 });
    const struggling = spawnGapMs({ ...base, hitRate: 0.5 });
    expect(struggling).toBeGreaterThan(comfortable);
  });
});

describe("AC-10.1 / AC-10.4: pacing reads the knobs, it is not one", () => {
  it("AC-10.4: the knob set is unchanged - pacing adds nothing to it", () => {
    expect([...KNOB_NAMES]).toEqual(["maxLive", "lengthBias"]);
  });

  it("AC-10.4: world scroll speed is nowhere in the pacing inputs", () => {
    const pace = paceSpawn({
      liveClearMs: [2400],
      fallMs: 4000,
      knobs: knobs(4),
      biasMs: 0,
      hitRate: 0.85,
    });
    expect(Object.keys(pace).sort()).toEqual(["gapMs", "leadMs", "outstandingMs"]);
  });

  it("AC-10.1: tightening maxLive buys overlap, never a faster feed", () => {
    // The gap shortens with maxLive, but only by the lead - which is taken out
    // of the rock's own spare fall time, so the work per second is unchanged.
    const base = {
      liveClearMs: [2400],
      fallMs: 4600,
      biasMs: 0,
      hitRate: 0.95,
    };
    const loose = paceSpawn({ ...base, knobs: knobs(MAX_LIVE_MIN) });
    const tight = paceSpawn({ ...base, knobs: knobs(MAX_LIVE_MAX) });
    expect(tight.gapMs).toBeLessThan(loose.gapMs);
    expect(tight.outstandingMs).toBe(loose.outstandingMs);
    expect(loose.gapMs - tight.gapMs).toBe(tight.leadMs - loose.leadMs);
  });

  it("AC-10.1: the overlap is bounded by the rock's own slack, at every knob", () => {
    for (let maxLive = MAX_LIVE_MIN; maxLive <= MAX_LIVE_MAX; maxLive += 1) {
      const clear = 2400;
      const fall = 4000;
      const pace = paceSpawn({
        liveClearMs: [clear],
        fallMs: fall,
        knobs: knobs(maxLive),
        biasMs: 0,
        hitRate: 1,
      });
      expect(pace.leadMs, `maxLive ${maxLive}`).toBeLessThanOrEqual(fall - clear);
      expect(pace.leadMs).toBeLessThanOrEqual(MAX_LEAD_MS);
    }
  });

  it("AC-10.4: the lead fraction spans the knob's range and clamps outside it", () => {
    expect(leadFraction(MAX_LIVE_MIN)).toBeCloseTo(LEAD_FRACTION_MIN, 5);
    expect(leadFraction(MAX_LIVE_MAX)).toBeCloseTo(LEAD_FRACTION_MAX, 5);
    expect(leadFraction(0)).toBeCloseTo(LEAD_FRACTION_MIN, 5);
    expect(leadFraction(99)).toBeCloseTo(LEAD_FRACTION_MAX, 5);
    expect(leadFraction(4)).toBeGreaterThan(leadFraction(3));
  });
});

describe("AC-6e.3 / AC-4.3: the gap itself", () => {
  it("AC-4.3: it is the board's outstanding work, less the overlap", () => {
    const pace = paceSpawn({
      liveClearMs: [2000, 2500],
      servedMs: 500,
      fallMs: 5000,
      knobs: knobs(MAX_LIVE_MIN),
      biasMs: 0,
      hitRate: 1,
    });
    expect(pace.outstandingMs).toBe(2000 + 2500 - 500);
    expect(pace.gapMs).toBe(pace.outstandingMs - pace.leadMs);
  });

  it("AC-4.3: work already spent on the rock in hand is not charged twice", () => {
    const base = {
      liveClearMs: [2400, 2400],
      fallMs: 4600,
      knobs: knobs(MAX_LIVE_MIN),
      biasMs: 0,
      hitRate: 1,
    };
    const fresh = spawnGapMs({ ...base, servedMs: 0 });
    const halfway = spawnGapMs({ ...base, servedMs: 1200 });
    expect(fresh - halfway).toBe(1200);
  });

  it("AC-4.3: a backlog the player has already worked off cannot go negative", () => {
    expect(
      paceSpawn({
        liveClearMs: [2400],
        servedMs: 99_000,
        fallMs: 4600,
        knobs: knobs(MAX_LIVE_MIN),
        biasMs: 0,
      }).outstandingMs,
    ).toBe(0);
  });

  it("AC-6e.3: the gap is bounded at both ends", () => {
    const floor = spawnGapMs({
      liveClearMs: [1],
      fallMs: 2500,
      knobs: knobs(MAX_LIVE_MIN),
      biasMs: 0,
    });
    expect(floor).toBe(MIN_SPAWN_GAP_MS);
    const ceiling = spawnGapMs({
      liveClearMs: [60_000, 60_000],
      fallMs: 2500,
      knobs: knobs(MAX_LIVE_MIN),
      biasMs: 40_000,
    });
    expect(ceiling).toBe(MAX_SPAWN_GAP_MS);
  });

  it("AC-6e.3: the belt never waits longer than the player is busy", () => {
    // The property that keeps a gentler gap from becoming dead air: the wait is
    // bounded by the work the board is holding, so the belt can only be quiet
    // while the player has something to do. (An empty board never waits at all -
    // that fast path is the caller's, and `simulation/belt.test.ts` measures it.)
    for (const clear of [800, 2400, 4000]) {
      for (const maxLive of [MAX_LIVE_MIN, 4, MAX_LIVE_MAX]) {
        for (const rate of [null, 0.4, 0.85, 1]) {
          const pace = paceSpawn({
            liveClearMs: [clear, clear],
            servedMs: 300,
            fallMs: clear * 1.6,
            knobs: knobs(maxLive),
            biasMs: 250,
            hitRate: rate,
          });
          expect(
            pace.gapMs,
            `clear ${clear} maxLive ${maxLive} rate ${rate}`,
          ).toBeLessThanOrEqual(Math.max(MIN_SPAWN_GAP_MS, pace.outstandingMs));
        }
      }
    }
  });

  it("AC-4.3: with no evidence the belt declines to overlap at all", () => {
    const blind = paceSpawn({
      liveClearMs: [2400],
      fallMs: 4600,
      knobs: knobs(MAX_LIVE_MAX),
      biasMs: null,
    });
    expect(blind.leadMs).toBe(0);
    const watched = paceSpawn({
      liveClearMs: [2400],
      fallMs: 4600,
      knobs: knobs(MAX_LIVE_MAX),
      biasMs: 0,
    });
    expect(watched.leadMs).toBeGreaterThan(0);
  });

  it("AC-4.3: an empty board asks for the floor, not for NaN", () => {
    const pace = paceSpawn({ liveClearMs: [], fallMs: 4000, knobs: knobs(3), biasMs: 0 });
    expect(pace.gapMs).toBe(MIN_SPAWN_GAP_MS);
    expect(pace.outstandingMs).toBe(0);
  });

  it("AC-4.3: a rock with no slack lends no overlap", () => {
    const pace = paceSpawn({
      liveClearMs: [4000],
      fallMs: 3000,
      knobs: knobs(MAX_LIVE_MAX),
      biasMs: 0,
      hitRate: 1,
    });
    expect(pace.leadMs).toBe(0);
  });

  it("AC-4.3: nonsense inputs cannot produce a gap outside the bounds", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1000]) {
      const gap = spawnGapMs({
        liveClearMs: [bad],
        servedMs: bad,
        fallMs: bad,
        biasMs: bad,
        knobs: knobs(bad),
        hitRate: bad,
      });
      expect(Number.isFinite(gap), `input ${bad}`).toBe(true);
      expect(gap).toBeGreaterThanOrEqual(MIN_SPAWN_GAP_MS);
      expect(gap).toBeLessThanOrEqual(MAX_SPAWN_GAP_MS);
    }
  });

  it("AC-4.3: THE REGRESSION - a median typist's gap is nothing like 850 ms", () => {
    // The defect, in one number. A median child at DEFAULT_CALIBRATION needs
    // roughly two seconds a word; the belt used to feed one every 850 ms.
    const clear = expectedClearMs({ length: 5, ease: EASE_NEW, calibration: CAL });
    const gap = spawnGapMs({
      liveClearMs: [clear],
      fallMs: fallTimeMs({ word: "abcde", ease: EASE_NEW, calibration: CAL }),
      knobs: knobs(MAX_LIVE_MIN),
      biasMs: 0,
      hitRate: null,
    });
    expect(gap).toBeGreaterThan(1800);
    expect(gap / 850).toBeGreaterThan(2);
  });
});
