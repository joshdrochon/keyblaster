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
  type SpawnPace,
  standingDepth,
} from "@engine/pacing/index.js";
import { RECOGNITION_BASE_MS, fallTimeMs } from "@engine/fallTime/index.js";
import {
  CONCURRENCY_TARGET_MAX,
  KNOB_NAMES,
  MAX_LIVE_MAX,
  MAX_LIVE_MIN,
} from "@engine/controller/knobs.js";
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
    expect(Object.keys(pace).sort()).toEqual([
      "gapMs",
      "leadMs",
      "outstandingMs",
      "standingMs",
    ]);
  });

  it("AC-10.1 / UR-51: tightening maxLive buys a QUEUE and an overlap, and nothing else", () => {
    // The gap shortens with maxLive, and this pins what it shortens BY, to the
    // millisecond, so a third term can never be smuggled into the belt's speed.
    //
    // WHAT CHANGED AND WHY (UR-51). This used to read
    //     loose.gapMs - tight.gapMs === tight.leadMs - loose.leadMs
    // i.e. "the only thing maxLive buys is overlap". That was true, and it was
    // the defect: overlap is capped at MAX_LEAD_MS and taken from one rock's
    // slack, so it could never put a second rock on the board. Watched failing
    // against the shipped assertion, this expression reads 1470 where the old
    // one expects 470 - the extra 1000 ms is the standing queue, which is the
    // whole of the fix. The accounting identity is kept rather than deleted:
    // every millisecond of the difference is still named.
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
    const reconstruct = (p: SpawnPace): number =>
      Math.min(
        MAX_SPAWN_GAP_MS,
        Math.max(MIN_SPAWN_GAP_MS, p.outstandingMs - p.standingMs - p.leadMs),
      );
    expect(loose.gapMs).toBe(reconstruct(loose));
    expect(tight.gapMs).toBe(reconstruct(tight));
    // The floor of the knob is the shipped belt, exactly: no queue at all.
    expect(loose.standingMs).toBe(0);
    // And the queue the top of the knob asks for is three more rocks' work.
    expect(tight.standingMs).toBe(2400 * (CONCURRENCY_TARGET_MAX - 1));
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

/**
 * UR-42 / UR-51: THE BELT HAS TO BUILD THE QUEUE, NOT JUST ALLOW IT.
 *
 * The gap was `outstanding - lead`, which schedules the next rock for the
 * moment the board is expected to be EMPTY. That is a steady state of one rock
 * at every knob setting, and it is why `peakLive` read 2 at maxLive 7 exactly
 * as at maxLive 2. A board of N rocks is a board with N-1 rocks' work standing
 * on it; there is no other way to have one.
 */
describe("UR-51 / FR-10: the belt holds a standing queue sized by the primary knob", () => {
  it("UR-51: at the knob's FLOOR it holds nothing, so the gentlest belt is the shipped belt", () => {
    // The whole safety argument, in one number. Everything the change does to
    // the pacing is multiplied by this, so zero here is the grade-2 child's
    // belt being the one already measured rather than one a simulation has to
    // vouch for.
    //
    // WATCHED FAILING, with the real numbers: seed CONCURRENCY_TARGET_MIN at
    // 1.5 and `standingDepth` reads 0.5 where 0 is expected, `standingMs` reads
    // 1200 where 0 is expected, the floor's own gap moves 3625 -> 2375, and the
    // grade-2 child's board occupancy moves 1.021 -> 1.344 rocks over 40 seeds.
    expect(standingDepth(MAX_LIVE_MIN, 1)).toBe(0);
    const pace = paceSpawn({
      liveClearMs: [2400],
      fallMs: 4600,
      biasMs: 0,
      hitRate: 0.95,
      knobs: knobs(MAX_LIVE_MIN),
    });
    expect(pace.standingMs).toBe(0);
  });

  it("UR-51: at the knob's CEILING it holds three more rocks' work", () => {
    expect(standingDepth(MAX_LIVE_MAX, 1)).toBe(CONCURRENCY_TARGET_MAX - 1);
  });

  it("UR-51: the queue is monotone in the knob and never negative", () => {
    let previous = -1;
    for (let live = MAX_LIVE_MIN; live <= MAX_LIVE_MAX; live += 1) {
      const depth = standingDepth(live, 1);
      expect(depth, `maxLive ${live}`).toBeGreaterThan(previous);
      expect(depth, `maxLive ${live}`).toBeGreaterThanOrEqual(0);
      previous = depth;
    }
  });

  it("D31 / UR-51: a player below the band gets a SHALLOWER board, immediately", () => {
    // D31 in the channel that is now the difficulty. Relief already stretched
    // the gap; without this it would also have stretched the queue the gap is
    // measured against, because both scale with the same service estimate - so
    // the child who is missing would have kept the deep board that is missing
    // them. At the maximum relief a target of 4 is flown as a target of 3.
    //
    // WATCHED FAILING, with the real number: take the relief term out of the
    // divisor and the struggling player's standing depth reads 3 where 2 is
    // expected.
    expect(standingDepth(MAX_LIVE_MAX, RELIEF_MAX)).toBe(
      (CONCURRENCY_TARGET_MAX - 1) / RELIEF_MAX,
    );
    expect(standingDepth(MAX_LIVE_MAX, RELIEF_MAX)).toBeLessThan(
      standingDepth(MAX_LIVE_MAX, 1),
    );
    // And it is bounded below by the shipped belt: relief may shallow the
    // board, never deepen it, and never below zero.
    expect(standingDepth(MAX_LIVE_MIN, RELIEF_MAX)).toBe(0);
  });

  it("UR-51: a non-finite relief reads as no relief, never as NaN", () => {
    expect(standingDepth(MAX_LIVE_MAX, Number.NaN)).toBe(CONCURRENCY_TARGET_MAX - 1);
    // Below 1 is clamped up: relief may shallow the board, never deepen it.
    expect(standingDepth(MAX_LIVE_MAX, 0.5)).toBe(CONCURRENCY_TARGET_MAX - 1);
  });

  it("UR-51: the queue is priced in the PLAYER's own service time, not in a constant", () => {
    // A constant here would be the 850 ms defect by another route: a queue
    // three rocks deep means three rocks' worth of THIS child's work, and a
    // slow child's rock is worth more than a fast one's.
    const fast = paceSpawn({
      liveClearMs: [1200],
      fallMs: 9000,
      biasMs: 0,
      hitRate: 0.95,
      knobs: knobs(MAX_LIVE_MAX),
    });
    const slow = paceSpawn({
      liveClearMs: [4800],
      fallMs: 22000,
      biasMs: 0,
      hitRate: 0.95,
      knobs: knobs(MAX_LIVE_MAX),
    });
    expect(fast.standingMs).toBe(1200 * (CONCURRENCY_TARGET_MAX - 1));
    expect(slow.standingMs).toBe(4800 * (CONCURRENCY_TARGET_MAX - 1));
  });

  it("UR-51: the queue never lets the belt outrun the gap's own floor", () => {
    // However deep the board is asked to be, MIN_SPAWN_GAP_MS still bounds how
    // fast it may be filled. Without that the queue would be built in one
    // frame, which is a wall and not a belt.
    for (let live = MAX_LIVE_MIN; live <= MAX_LIVE_MAX; live += 1) {
      const pace = paceSpawn({
        liveClearMs: [2400],
        fallMs: 4600,
        biasMs: 0,
        hitRate: 0.95,
        knobs: knobs(live),
      });
      expect(pace.gapMs, `maxLive ${live}`).toBeGreaterThanOrEqual(MIN_SPAWN_GAP_MS);
      expect(pace.gapMs, `maxLive ${live}`).toBeLessThanOrEqual(MAX_SPAWN_GAP_MS);
    }
  });
});
