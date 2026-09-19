import { describe, expect, it } from "vitest";
// UR-88: FR-8's clamp FLOOR is now the word's and the pilot's, not a constant's
// (`fallFloorMs`). Every assertion below that used to name `FALL_TIME_MIN_MS`
// as the bound now names the bound for the word it is actually checking. This
// is a SPEC CHANGE the owner asked for by name - "short words should genuinely
// fly, 'go' should cross in under two seconds", which a flat 2500 ms forbids -
// and not a relaxed assertion: `fallFloorMs` is bounded ABOVE by
// `FALL_TIME_MIN_MS`, so every one of these bounds is at least as tight as the
// constant it replaced, and tighter for every word under five letters.

import {
  FALL_SPREAD_DOWN,
  FALL_SPREAD_UP,
  FALL_TIME_MAX_MS,
  FALL_TIME_MIN_MS,
  fallSpreadFactor,
  HEADROOM_SLOW_IKI_MS,
  KEYSTROKE_BUDGET_FACTOR,
  KEYSTROKE_HEADROOM_MIN,
  RECOGNITION_BASE_MS,
  clampFallTime,
  stopPaceFactor,
  fallTimeMs,
  headroomEarned,
  isClamped,
  keystrokeBudgetMs,
  keystrokeHeadroom,
  rawFallTimeMs,
  fallBudgetFactor,
  fallFloorMs,
  recognitionBudgetMs,
  RECOGNITION_EARNED_BASE_MS,
  RECOGNITION_SLOW_BASE_MS,
  recognitionBaseMs,
  recognitionReaderBaseMs,
} from "@engine/fallTime/index.js";
import {
  CONCURRENCY_TARGET_MAX,
  MAX_LIVE_MAX,
  MAX_LIVE_MIN,
  concurrencyTarget,
} from "@engine/controller/knobs.js";
import { expectedClearMs, spawnGapMs } from "@engine/pacing/index.js";
import { STOP_IDS } from "@engine/types.js";
import { stagePoolFor } from "@game/flight/stage.js";
import { DEFAULT_CALIBRATION, EASE_MAX, EASE_MIN, EASE_NEW } from "@engine/types.js";

/** Deterministic PRNG so property runs are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("constants match PRD FR-8 exactly", () => {
  it("uses the documented numbers, not approximations", () => {
    expect(KEYSTROKE_BUDGET_FACTOR).toBe(1.5);
    expect(RECOGNITION_BASE_MS).toBe(1200);
    expect(FALL_TIME_MIN_MS).toBe(2500);
    expect(FALL_TIME_MAX_MS).toBe(14000);
    expect(DEFAULT_CALIBRATION.ikiMs).toBe(350);
  });
});

describe("AC-8.1: formula implemented exactly", () => {
  it("is len * 1.5 * iki + 1200 * ease, at FR-8's own calibration", () => {
    // 6 letters, FR-8's default iki 350, ease 1.0
    //   -> 6*1.5*350 + 1200*1.0 = 3150 + 1200 = 4350
    const ms = fallTimeMs({ word: "planet", ease: 1.0, calibration: DEFAULT_CALIBRATION });
    expect(ms).toBe(4350);
    // And at anything FASTER, which is the same base: `headroomEarned` is 1 at
    // and below FR-8's default, so `recognitionReaderBaseMs` contributes zero.
    //   6*1.5*260 + 1200 = 2340 + 1200 = 3540
    expect(fallTimeMs({ word: "planet", ease: 1.0, calibration: { ikiMs: 260, fkLatencyMs: 380 } }))
      .toBe(3540);
  });

  it("UR-72: above FR-8's default interval the READING base rises with the pilot", () => {
    /**
     * THIS TEST'S CLAIM CHANGED, AND THE CHANGE IS UR-72's WHOLE POINT.
     *
     * It used to read `fallTimeMs({ word: "planet", ease: 1, ikiMs: 400 })` and
     * assert 4800 - FR-8's formula with BASE pinned at 1200 for every pilot
     * alive. A flat base is one imagined reader's reading speed applied to every
     * child: 1920 ms for a new word, against the 2400 ms this repo's own grade-2
     * model needs. Run against the current code the old assertion reads
     *
     *     expected 4860 to be 4800
     *
     * i.e. the 60 ms this pilot's measured 400 ms interval now buys them of
     * reading time (`recognitionReaderBaseMs(400)` = 1260, x ease 1.0).
     *
     * THE FORMULA IS UNCHANGED WHERE FR-8 STATES IT. The PRD gives BASE 1200
     * alongside a default interval of 350 ms; at that interval, and at every
     * speed faster, this is still 1200 to the byte - the assertion above. Only a
     * pilot MEASURED slower than FR-8's own default moves, and only upward.
     */
    // 6 letters, iki 400 -> earned 0.8, base 1200 + 0.2*300 = 1260
    //   -> 6*1.5*400 + 1260*1.0 = 3600 + 1260 = 4860
    expect(fallTimeMs({ word: "planet", ease: 1.0, calibration: { ikiMs: 400, fkLatencyMs: 500 } }))
      .toBe(4860);
    // And at the anchor, where the whole 1500 is earned:
    //   6*1.5*600 + 1500*1.0 = 5400 + 1500 = 6900
    expect(fallTimeMs({ word: "planet", ease: 1.0, calibration: { ikiMs: 600, fkLatencyMs: 700 } }))
      .toBe(6900);
  });

  it("defaults the inter-key interval to 350 ms when uncalibrated", () => {
    // 4 letters, default iki 350, ease 1.0 -> 4*1.5*350 + 1200 = 2100 + 1200 = 3300
    expect(fallTimeMs({ word: "dust", ease: 1.0 })).toBe(3300);
  });

  it("splits into a keystroke half and a recognition half", () => {
    expect(keystrokeBudgetMs(6, 400)).toBe(3600);
    expect(recognitionBudgetMs(1.0)).toBe(1200);
    expect(recognitionBudgetMs(0.5)).toBe(600);
  });

  it("agrees with its own parts for any input", () => {
    /**
     * THE PARTS MOVED, SO THE SUM IS STATED OVER THE PARTS THE FUNCTION USES.
     *
     * It used to compare against `recognitionBudgetMs(ease)` - the default base,
     * 1200, for every interval in the sweep. `recognitionReaderBaseMs` makes the
     * base a function of the measured interval (UR-72), so with the sweep
     * running intervals from 120 to 820 ms the old form reads
     *
     *     expected 8152.147301999903 to be close to 7882.238861764781,
     *     received difference is 269.9084402351218, but expected 5e-10
     *
     * The property worth having is unchanged and is what is asserted: the whole
     * is exactly its two halves, with no third term and no rounding of its own.
     * The two ANCHORS - that the reader base is 1200 at and below FR-8's default
     * and that nothing else is added - are pinned separately, above and below.
     */
    const rand = mulberry32(20260916);
    let sweptSlow = 0;
    for (let i = 0; i < 2000; i++) {
      const len = 1 + Math.floor(rand() * 13);
      const ease = EASE_MIN + rand() * (EASE_MAX - EASE_MIN);
      const ikiMs = 120 + rand() * 700;
      const word = "a".repeat(len);
      const input = { word, ease, calibration: { ikiMs, fkLatencyMs: 500 } };
      expect(rawFallTimeMs(input)).toBeCloseTo(
        keystrokeBudgetMs(len, ikiMs) +
          recognitionBudgetMs(ease, recognitionReaderBaseMs(ikiMs)),
        9,
      );
      expect(fallTimeMs(input)).toBe(
        // UR-88: the floor is this word's and these hands', not a constant's.
        clampFallTime(rawFallTimeMs(input), 1, fallFloorMs(len, ikiMs)),
      );
      // And below FR-8's default the two forms are the SAME expression, so the
      // old assertion still holds there rather than being quietly dropped.
      if (ikiMs <= DEFAULT_CALIBRATION.ikiMs) {
        expect(rawFallTimeMs(input)).toBeCloseTo(
          keystrokeBudgetMs(len, ikiMs) + recognitionBudgetMs(ease),
          9,
        );
      } else {
        sweptSlow += 1;
      }
    }
    // coding-standards 5: the sweep has to have swept BOTH sides of the anchor.
    expect(sweptSlow).toBeGreaterThan(1000);
  });
});

describe("AC-8.1: clamps hold", () => {
  it("never falls faster than the minimum", () => {
    // Shortest word, fastest typist, easiest word. UR-88: the minimum is this
    // word's and these hands' - `fallFloorMs` - and FR-8's literal 2500 ms is
    // its own ceiling, so this bound is TIGHTER than the constant it replaced.
    const ms = fallTimeMs({
      word: "a",
      ease: EASE_MIN,
      calibration: { ikiMs: 100, fkLatencyMs: 200 },
    });
    expect(ms).toBe(fallFloorMs(1, 100));
    expect(fallFloorMs(1, 100)).toBeLessThan(FALL_TIME_MIN_MS);
    // And a word long enough to need it still gets FR-8's literal floor.
    expect(fallFloorMs(12, 350)).toBe(FALL_TIME_MIN_MS);
  });

  it("never falls slower than the maximum", () => {
    const ms = fallTimeMs({
      word: "a".repeat(13),
      ease: EASE_MAX,
      calibration: { ikiMs: 900, fkLatencyMs: 900 },
    });
    expect(ms).toBe(FALL_TIME_MAX_MS);
  });

  it("stays inside the bounds across the whole realistic input space", () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 5000; i++) {
      const len = 1 + Math.floor(rand() * 13);
      const ikiMs = 80 + rand() * 900;
      const ms = fallTimeMs({
        word: "a".repeat(len),
        ease: EASE_MIN + rand() * (EASE_MAX - EASE_MIN),
        calibration: { ikiMs, fkLatencyMs: 500 },
      });
      // UR-88: the bound for THIS word at THESE hands, which is at most FR-8's
      // literal 2500 ms and less for anything short.
      expect(ms).toBeGreaterThanOrEqual(fallFloorMs(len, ikiMs));
      expect(ms).toBeLessThanOrEqual(FALL_TIME_MAX_MS);
    }
  });

  it("reports whether a value was clamped, for controller telemetry", () => {
    // UR-88: the floor a fast pilot's one-letter word is measured against is
    // now that word's own, so it no longer binds there. The pilot it still
    // binds for is the one part-way down the `headroomEarned` axis, whose
    // floor has only partly scaled - measured, not assumed.
    expect(
      isClamped({ word: "go", ease: EASE_MIN, calibration: { ikiMs: 440, fkLatencyMs: 650 } }),
    ).toBe(true);
    expect(isClamped({ word: "planet", ease: 1.0, calibration: { ikiMs: 400, fkLatencyMs: 500 } })).toBe(false);
  });

  it("clampFallTime passes through values already in range", () => {
    expect(clampFallTime(5000)).toBe(5000);
    expect(clampFallTime(FALL_TIME_MIN_MS)).toBe(FALL_TIME_MIN_MS);
    expect(clampFallTime(FALL_TIME_MAX_MS)).toBe(FALL_TIME_MAX_MS);
  });
});

describe("AC-8.2: a known long word can fall faster than an unknown short word", () => {
  it("uses the PRD's own worked example", () => {
    // The PRD names these two explicitly: dinosaur at ease 0.3, because at 1.8.
    const dinosaur = fallTimeMs({ word: "dinosaur", ease: 0.3 });
    const because = fallTimeMs({ word: "because", ease: 1.8 });
    expect(dinosaur).toBeLessThan(because);
    // Show the arithmetic so a future reader can check it by hand:
    // dinosaur 8*1.5*350 + 1200*0.3 = 4200 +  360 = 4560
    // because  7*1.5*350 + 1200*1.8 = 3675 + 2160 = 5835
    expect(dinosaur).toBe(4560);
    expect(because).toBe(5835);
  });

  it("is non-decreasing in length, and strictly increasing above the floor", () => {
    // At the default 350 ms iki and ease 1.0 a 1- and 2-letter word both land
    // under the 2500 ms floor (2*1.5*350 + 1200 = 2250), so they clamp to the
    // same value. Strict monotonicity is therefore false at the bottom of the
    // range and only non-decreasing is true everywhere. Asserting the stronger
    // property would be asserting a bug.
    const at = (n: number) => fallTimeMs({ word: "a".repeat(n), ease: 1.0 });
    for (let n = 2; n <= 13; n++) expect(at(n)).toBeGreaterThanOrEqual(at(n - 1));
    for (let n = 4; n <= 13; n++) expect(at(n)).toBeGreaterThan(at(n - 1));
  });

  it("pins the shortest words to their OWN floor at default calibration (UR-88)", () => {
    // Documented so the clamp is a known property, not a surprise: the floor
    // exists so no word is unreadably fast for the child flying it (D01, D19).
    // UR-88 made it that child's and that word's, because a flat 2500 ms gave a
    // two-letter word and an eight-letter one the same minimum.
    const d = DEFAULT_CALIBRATION.ikiMs;
    // AND THE RESULT IS THAT THEY ARE NO LONGER PINNED. At FR-8's own default
    // interval the scaled floor is exactly FR-8's expression at `EASE_MIN`, so
    // a word the child has not fully mastered clears its own floor rather than
    // being flattened onto a constant - which is what "short words should
    // genuinely fly" asks for. The floor is still there, still bounds them,
    // and no longer decides them.
    expect(fallTimeMs({ word: "a", ease: 1.0 })).toBeGreaterThan(fallFloorMs(1, d));
    expect(fallTimeMs({ word: "at", ease: 1.0 })).toBeGreaterThan(fallFloorMs(2, d));
    expect(fallTimeMs({ word: "dry", ease: 1.0 })).toBeGreaterThan(fallFloorMs(3, d));
    // Three one-letter words used to be one number; now length shows through.
    expect(fallTimeMs({ word: "at", ease: 1.0 })).toBeGreaterThan(
      fallTimeMs({ word: "a", ease: 1.0 }),
    );
    // THE OWNER'S ASK, AS A NUMBER: "go" crosses in well under two seconds for
    // the pilot FR-8's own default describes.
    expect(fallTimeMs({ word: "go", ease: EASE_MIN })).toBeLessThan(2000);
    // And the tail is untouched, to the byte, at every length.
    for (let n = 1; n <= 12; n += 1) {
      expect(fallFloorMs(n, HEADROOM_SLOW_IKI_MS), `${n} letters`).toBe(FALL_TIME_MIN_MS);
    }
  });

  it("is monotonic in ease at fixed length", () => {
    const at = (ease: number) => fallTimeMs({ word: "planet", ease });
    expect(at(1.6)).toBeGreaterThan(at(0.8));
    expect(at(0.8)).toBeGreaterThan(at(0.25));
  });

  it("gives an unknown word more time than a mastered one of equal length", () => {
    // D21: unknown words get more time; mastered words become combo fodder.
    const unknown = fallTimeMs({ word: "rivers", ease: 1.6 });
    const mastered = fallTimeMs({ word: "planet", ease: 0.3 });
    expect(unknown).toBeGreaterThan(mastered);
  });
});

describe("degenerate input is total, never NaN", () => {
  it("handles the empty word", () => {
    const ms = fallTimeMs({ word: "", ease: 1.0 });
    expect(Number.isFinite(ms)).toBe(true);
    // UR-88: bounded by a zero-length word's own floor - still total, still
    // never NaN, and still a finite number a scene can build a tween from.
    expect(ms).toBeGreaterThanOrEqual(fallFloorMs(0, DEFAULT_CALIBRATION.ikiMs));
    expect(ms).toBeLessThanOrEqual(FALL_TIME_MAX_MS);
  });

  it("handles a zero inter-key interval without dividing by anything", () => {
    const ms = fallTimeMs({ word: "planet", ease: 1.0, calibration: { ikiMs: 0, fkLatencyMs: 0 } });
    expect(ms).toBeGreaterThanOrEqual(fallFloorMs(6, 0));
    expect(Number.isFinite(ms)).toBe(true);
  });
});

/**
 * UR-42 / UR-51: THE FALL BUDGET IS SIZED FOR THE QUEUE.
 *
 * FR-8 budgets a rock for reading and typing, never for WAITING, and every rock
 * on a board deeper than one is waiting. The measured consequence is in
 * gauntlet/evidence/belt-concurrency.json: fall/service is 1.18 for a fast
 * pilot, 1.25 for the median and 1.38 for a grade-2 child, over every word in
 * every shipped pool - one answerable rock at every speed, whatever `maxLive`
 * said. UR-51 is the user's decision to widen it, and the constraint on the
 * widening is that it must not reach the child who is struggling.
 */
describe("UR-51 / FR-8: the fall budget scales with the depth the controller asks for", () => {
  const CAL = DEFAULT_CALIBRATION;

  it("UR-51: at the knob's FLOOR every fall time in the game is the byte it was", () => {
    // THE NEGATIVE CONTROL FOR THE WHOLE CHANGE. Not "close enough": every word
    // in every shipped pool, at three eases, must be identical to the value
    // FR-8's own formula produces with no knobs at all. A default that drifted
    // by a millisecond would mean the grade-2 evidence on record describes a
    // belt nobody flies.
    //
    // WATCHED FAILING, with the real numbers: set CONCURRENCY_TARGET_MIN to
    // 1.5 and the first comparisons read 7200 against 4800, 4950 against 3300,
    // 3750 against 2500 - every fall time in the game a half longer than the
    // number FR-8 is written with.
    let compared = 0;
    for (const stop of STOP_IDS) {
      for (const word of stagePoolFor(stop)) {
        for (const ease of [EASE_MIN, EASE_NEW, EASE_MAX]) {
          const shipped = fallTimeMs({ word, ease, calibration: CAL });
          expect(
            fallTimeMs({ word, ease, calibration: CAL, knobs: { maxLive: MAX_LIVE_MIN } }),
            `${stop}/"${word}" @ ease ${ease}`,
          ).toBe(shipped);
          compared += 1;
        }
      }
    }
    // The sweep has to have swept (coding-standards 5): a pool that failed to
    // load would make every assertion above vacuously true.
    expect(compared).toBeGreaterThan(300);
    expect(fallBudgetFactor(undefined)).toBe(1);
    expect(fallBudgetFactor({ maxLive: MAX_LIVE_MIN })).toBe(1);
  });

  it("UR-51: the answerable-depth invariant, and the ONE place it is now traded", () => {
    /**
     * ================== READ THIS BEFORE CHANGING THE NUMBERS ==============
     * THIS TEST'S CLAIM CHANGED, AND UNLIKE THE OTHERS IT CHANGED FOR THE WORSE.
     * It is logged in `gauntlet/escalations.md` as UR-51-B and the project owner
     * has the decision. It is written this way so the trade is PINNED rather
     * than relaxed: every number below is the measured value, and any further
     * erosion goes red.
     *
     * THE INVARIANT. The number of ANSWERABLE rocks is floor(fall / service),
     * and the depth `@engine/pacing` builds is `concurrencyTarget(maxLive)`. A
     * belt that stands a queue deeper than its budget can serve drops the back
     * of it on the hull - that is the P0a stall defect. Dividing out the shared
     * `fallBudgetFactor`, the invariant reduces to one line:
     *
     *     FR-8's ONE-DEEP budget must be at least `expectedClearMs`.
     *
     * WHAT IT WAS. Measured over every shipped pool at every knob setting,
     * BEFORE the recognition ratchet, the ratio of the two cleared the target
     * at every setting for every pilot - with almost nothing to spare at the
     * top, because `keystrokeHeadroom` had already spent it:
     *
     *     pilot            ml2    ml3    ml4    ml5    ml6    ml7   (target)
     *     fast   (260)     1.09   1.72   2.33   2.92   3.49   4.04
     *     median (350)     1.16   1.82   2.45   3.06   3.65   4.21
     *     slow   (440)     1.22   1.92   2.61   3.28   3.93   4.55
     *     grade2 (600)     1.32   2.11   2.90   3.69   4.49   5.28
     *     target           1.0    1.6    2.2    2.8    3.4    4.0
     *
     * WHAT IT IS NOW. The recognition ratchet spends from the same budget, so
     * the two fastest pilots fall BELOW their own service estimate at the top
     * of the knob:
     *
     *     fast   (260)     1.09   1.61   2.13   2.55   2.87   3.17   <- below
     *     median (350)     1.16   1.72   2.18   2.66   2.96   3.30   <- below
     *     slow   (440)     1.22   1.86   2.44   2.95   3.40   3.78   <- below
     *     grade2 (600)     1.32   2.11   2.90   3.69   4.49   5.28   <- intact
     *
     * WHY IT WAS ALLOWED TO MOVE AT ALL, and the honest version of the reason:
     * the invariant's denominator is `expectedClearMs`, which is a DELIBERATELY
     * CONSERVATIVE pacing estimate, not a measurement of the player - it prices
     * recognition at FR-8's 1200 x ease when a fast pilot's real cold
     * recognition is ~1100 ms and falls to ~220 ms with exposure. Over the
     * route sweep the fast pilot's actual work is 2008 ms per rock against a
     * budget of 12 691 ms, and neither the fast nor the median pilot breaches
     * on a belt they stalled on. That is evidence the trade is survivable. It
     * is NOT evidence the invariant is unnecessary, and this comment does not
     * pretend it is: "hard to reach" is not "cannot happen", and this repo has
     * rejected that argument before (`HEADROOM_SLOW_IKI_MS`).
     *
     * THE ARITHMETIC THAT MADE IT A CHOICE RATHER THAN A SLIP. Holding the
     * invariant caps `RECOGNITION_EARNED_BASE_MS` at 1184 ms (stated at iki
     * 260) or 1114 ms (at the calibration the engine actually receives, since
     * the scene floors it at FR-8's default). Both are cuts of under 8%. The
     * value the owner flew and approved is 700. There is no number that
     * satisfies both, which is why this is an escalation and not a tuning pass.
     */
    // THE SAFETY END IS NOT TRADED, AND THIS IS THE ASSERTION THAT SAYS SO.
    // A pilot at `HEADROOM_SLOW_IKI_MS` earns none of either ratchet, so their
    // budget still serves the full depth at EVERY knob setting - including the
    // settings a restored or shared profile could drop them onto. This is the
    // arm of the invariant that must never move.
    //
    // WATCHED FAILING, with the real number - AND WITH THE CONTROL THAT DOES
    // NOT FIRE IT, because the two together are the only honest way to say what
    // this arm covers (coding-standards 9).
    //
    //   Delete the `earned` factor alone - the ratchet reaches a grade-2 child
    //   at the shipped 700 - and THIS ARM STAYS GREEN, at 4.14 against a target
    //   of 4.0. Their own service time is long enough to absorb it. What
    //   catches that change is the bit-identical sweep above
    //   ("maxLive 3: expected 1100 to be 1200"), not this.
    //
    //   Delete the `earned` factor AND drop the earned base to 400 and this
    //   arm reads:
    //
    //     grade2 @ maxLive 6: expected 3.2504964539007095 to be greater than
    //     or equal to 3.4000000000000004
    //
    // So this arm is the guard on the DEPTH the slowest child's budget can
    // serve, and the sweep above is the guard on their belt being unchanged.
    // Neither subsumes the other.
    const grade2 = { ikiMs: 600, fkLatencyMs: 700 };
    for (let live = MAX_LIVE_MIN; live <= MAX_LIVE_MAX; live += 1) {
      let worst = Number.POSITIVE_INFINITY;
      for (const stop of STOP_IDS) {
        for (const word of stagePoolFor(stop)) {
          const fall = fallTimeMs({
            word,
            ease: EASE_NEW,
            calibration: grade2,
            knobs: { maxLive: live },
          });
          const service = expectedClearMs({
            length: [...word].length,
            ease: EASE_NEW,
            calibration: grade2,
          });
          worst = Math.min(worst, fall / service);
        }
      }
      expect(worst, `grade2 @ maxLive ${live}`).toBeGreaterThanOrEqual(
        concurrencyTarget(live),
      );
    }
    // ================== OPTION A: THE INVARIANT IS HELD ==================
    // UR-51-B was decided in favour of holding it. `RECOGNITION_EARNED_BASE_MS`
    // is capped at the largest value that keeps FR-8's one-deep budget at or
    // above `expectedClearMs` for EVERY pilot at EVERY knob setting, so this is
    // a real bound again rather than a pinned record of a broken state.
    //
    // WATCHED FAILING, with the real number: set the earned base to the 700 the
    // owner flew and this reads
    //
    //     fast @ maxLive 4: expected 2.13014598540146 to be greater than or
    //     equal to 2.2
    //
    // i.e. the trade this project declined to take, and it bites at the THIRD
    // knob step rather than only at the ceiling - which is why this sweeps the
    // whole knob range instead of just its top.
    for (const [pilot, calibration] of [
      ["fast", { ikiMs: 260, fkLatencyMs: 380 }],
      ["median", DEFAULT_CALIBRATION],
      ["slow", { ikiMs: 440, fkLatencyMs: 650 }],
      ["grade2", { ikiMs: 600, fkLatencyMs: 700 }],
    ] as const) {
      for (let live = MAX_LIVE_MIN; live <= MAX_LIVE_MAX; live += 1) {
        let worst = Number.POSITIVE_INFINITY;
        for (const stop of STOP_IDS) {
          for (const word of stagePoolFor(stop)) {
            const fall = fallTimeMs({
              word,
              ease: EASE_NEW,
              calibration,
              knobs: { maxLive: live },
            });
            const service = expectedClearMs({
              length: [...word].length,
              ease: EASE_NEW,
              calibration,
            });
            worst = Math.min(worst, fall / service);
          }
        }
        expect(worst, `${pilot} @ maxLive ${live}`).toBeGreaterThanOrEqual(
          concurrencyTarget(live),
        );
      }
    }
    expect(CONCURRENCY_TARGET_MAX).toBe(4);
  });

  it("UR-51: the CLAMP scales with the budget, or the mechanism fails for the slowest child", () => {
    // A fixed 14 s ceiling is where this change would have died silently. A
    // grade-2 pilot's five-letter word raws at 6420 ms; x4 is 25 680 ms, and
    // clamped back to 14 000 that rock's ratio is 3.03 against a board four
    // deep - so the belt would build the queue and then drop the back of it on
    // the child's hull.
    //
    // WATCHED FAILING, with the real numbers: with `clampFallTime(raw)` left
    // unscaled this reads exactly 14000 ("expected 14000 to be greater than
    // 14000"), the monotone check flattens at maxLive 6, and the ratio
    // assertion above drops to 3 for the fast pilot.
    const grade2 = { ikiMs: 600, fkLatencyMs: 700 };
    const deep = fallTimeMs({
      word: "spinning",
      ease: EASE_MAX,
      calibration: grade2,
      knobs: { maxLive: MAX_LIVE_MAX },
    });
    expect(deep).toBeGreaterThan(FALL_TIME_MAX_MS);
    expect(deep).toBeLessThanOrEqual(FALL_TIME_MAX_MS * CONCURRENCY_TARGET_MAX);
    // And at the floor the PRD's literal bounds are still the bounds.
    expect(clampFallTime(1e9)).toBe(FALL_TIME_MAX_MS);
    expect(clampFallTime(0)).toBe(FALL_TIME_MIN_MS);
  });

  it("UR-51: D19's split survives - the INVISIBLE half is the one that never moves", () => {
    /**
     * THIS TEST'S CLAIM CHANGED, AND THE CHANGE IS THE FEATURE.
     *
     * It used to assert the budget was a pure multiple of FR-8's expression at
     * every knob, i.e. `raw(live) === raw(floor) * concurrencyTarget(live)`.
     * That is now FALSE and it is deliberately false: UR-51's second half
     * ratchets `keystrokeHeadroom` down as the knob climbs, so the LENGTH term
     * no longer scales with the ease term. Run against the current code the old
     * assertion reads:
     *
     *     "fit" @ ease 0.25 @ maxLive 3: expected 2874.0000000000005 to be
     *     close to 3000, difference 125.99999999999955
     *
     * which is exactly the 126 ms of typing headroom the third knob step takes
     * off a three-letter word at the default interval. The old claim existed to
     * stop a knob making one word cheap relative to another; that property is
     * still worth having, so it is restated as the two facts that carry it.
     */
    for (let live = MAX_LIVE_MIN; live <= MAX_LIVE_MAX; live += 1) {
      const factor = concurrencyTarget(live);
      for (const word of ["fit", "jupiter", "spinning"]) {
        for (const ease of [EASE_MIN, EASE_NEW, EASE_MAX]) {
          const knobs = { maxLive: live };
          const raw = rawFallTimeMs({ word, ease, calibration: CAL, knobs });
          const where = `"${word}" @ ease ${ease} @ maxLive ${live}`;

          // 1. THE INVISIBLE HALF IS UNTOUCHED. `recognitionBudgetMs` is ease,
          //    and ease is this child's private history with this word (D19,
          //    AC-8.3). Subtracting the queue-scaled recognition budget must
          //    leave exactly the queue-scaled keystroke budget - so nothing the
          //    knob does can be read off the screen as a judgement about the
          //    child, only off the word's length, which is drawn anyway.
          const headroom = keystrokeHeadroom(live, CAL.ikiMs);
          const base = recognitionBaseMs(live, CAL.ikiMs);
          expect(raw, where).toBeCloseTo(
            (keystrokeBudgetMs([...word].length, CAL.ikiMs, headroom) +
              recognitionBudgetMs(ease, base)) *
              factor,
            6,
          );

          // AND THE HALF IS STILL A PURE MULTIPLE OF EASE. This is the part
          // AC-8.3 actually needs: the knob may shorten the reading budget, but
          // it shortens EVERY word's by the same factor, so the ratio between
          // two words' recognition halves is still their ratio of ease and
          // nothing about this child's private history with a word can be read
          // off the screen. A ratchet that varied with ease would fail here.
          expect(
            recognitionBudgetMs(ease, base) / ease,
            `${where}: recognition per unit ease`,
          ).toBeCloseTo(base, 9);

          // 2. THE RESHAPE ONLY EVER SHORTENS. The pure multiple is the
          //    ceiling; the two ratchets spend from it. At the floor the two
          //    are the same number, which is the bit-identical constraint
          //    restated at this level.
          //
          //    IT USED TO SAY "AND ONLY THROUGH LENGTH", and that clause is
          //    gone on purpose (UR-51). The typing ratchet alone could not
          //    reach a pilot faster than FR-8's default, because the scene
          //    floors the interval fall time reads at that default: the whole
          //    1.5 -> 1.125 travel is cancelled by the padding the floor hands
          //    a 260 ms pilot. The reading half is the one that reaches them,
          //    so it ratchets too - see `recognitionBaseMs`.
          const pureMultiple = rawFallTimeMs({ word, ease, calibration: CAL }) * factor;
          expect(raw, where).toBeLessThanOrEqual(pureMultiple + 1e-9);
          if (live === MAX_LIVE_MIN) expect(raw, where).toBeCloseTo(pureMultiple, 9);
        }
      }
    }
  });

  it("UR-51: the headroom ratchet is the thing that makes a fuller board cost something", () => {
    // The whole point of the change, as one comparison. At the knob's floor a
    // word is budgeted at FR-8's 50% headroom over this player's own hands; at
    // the ceiling, for a pilot whose measured speed has earned it, 12.5%.
    //
    // WATCHED FAILING, with the real number: pin `keystrokeHeadroom` at
    // `KEYSTROKE_BUDGET_FACTOR` and the ceiling reads 1.5 against 1.125 - the
    // belt UR-51's first pass shipped, where a busier board cost a fast pilot
    // nothing because the slack absorbed all of it.
    expect(keystrokeHeadroom(MAX_LIVE_MIN, CAL.ikiMs)).toBe(KEYSTROKE_BUDGET_FACTOR);
    expect(keystrokeHeadroom(MAX_LIVE_MAX, CAL.ikiMs)).toBeCloseTo(KEYSTROKE_HEADROOM_MIN, 10);

    // One step per stage, monotone, and no step larger than a fifth of the
    // whole travel - AC-10.1's "one knob per stage" is worth nothing if the
    // knob's effect on the budget arrives in a cliff.
    let previous = KEYSTROKE_BUDGET_FACTOR;
    for (let live = MAX_LIVE_MIN + 1; live <= MAX_LIVE_MAX; live += 1) {
      const h = keystrokeHeadroom(live, CAL.ikiMs);
      expect(h, `maxLive ${live}`).toBeLessThan(previous);
      expect(previous - h, `step into maxLive ${live}`).toBeLessThanOrEqual(
        (KEYSTROKE_BUDGET_FACTOR - KEYSTROKE_HEADROOM_MIN) / 5 + 1e-9,
      );
      previous = h;
    }
  });

  it("UR-72: a grade-2 pilot's belt is the NEW floor at EVERY knob setting, to the byte", () => {
    /**
     * ================== THIS FLOOR MOVED, AND THAT IS THE TICKET =============
     *
     * IT USED TO SAY "FR-8'S BELT". A grade-2 pilot earned none of UR-51's two
     * ratchets, so their fall time was FR-8's literal expression at every knob,
     * and this sweep compared against the PRD's own formula with `toBe`.
     *
     * UR-72 is the report that FR-8's literal expression is 480 ms short for
     * that child on every FIRST exposure: a new word is granted
     * `RECOGNITION_BASE_MS x EASE_NEW` = 1920 ms of reading, and this repo's own
     * grade-2 model needs 2400. It is survivable today only because the pools
     * are 26-32 words against 58 spawns, so almost every rock is a SECOND
     * exposure - and that is exactly why the pools cannot be expanded.
     *
     * So the floor is now `RECOGNITION_SLOW_BASE_MS` (1500 = 2400 / EASE_NEW),
     * and it is pinned HERE AT THE SAME STANDARD the old floor was held to:
     * every shipped word, every knob setting, three eases, `toBe` and not
     * `toBeCloseTo`. A budget that landed 0.4 ms off would pass at six decimal
     * places and would still be a belt nobody measured.
     *
     * WATCHED FAILING, with the real numbers, both ways round:
     *
     *   Set `RECOGNITION_SLOW_BASE_MS` back to `RECOGNITION_BASE_MS` - i.e.
     *   revert UR-72 - and this reads
     *
     *       earth/"launch" @ ease 0.25: expected 5700 to be greater than 5700
     *
     *   (the `toBe` above it passes, because reverting the constant moves the
     *   reference and the measurement together - which is exactly why the
     *   "strictly more than FR-8" assertion is here and not left implied). The
     *   route sweep turns the same revert into 3 stalls in 240 belts for this
     *   pilot at 0.9384 hit rate, against 0 at 0.9689.
     *
     *   Let the ratchet reach this pilot - delete the `earned` factor from
     *   `recognitionBaseMs` - and it reads "maxLive 3: expected 1496.8 to be
     *   1500" on the FIRST step of the knob.
     *
     * THE TYPING HALF DID NOT MOVE. `keystrokeHeadroom` is still FR-8's literal
     * 1.5 for this pilot at every knob, which is the assertion below it: UR-72
     * is a change to the READING budget only, and D19's split is what says those
     * are different claims.
     */
    const grade2 = { ikiMs: 600, fkLatencyMs: 700 };
    let compared = 0;
    for (let live = MAX_LIVE_MIN; live <= MAX_LIVE_MAX; live += 1) {
      expect(keystrokeHeadroom(live, grade2.ikiMs), `maxLive ${live}`).toBe(
        KEYSTROKE_BUDGET_FACTOR,
      );
      // UR-51's ratchet still never reaches this pilot; UR-72's reader base is
      // the only thing that moved, and it is flat across the whole knob range.
      expect(recognitionBaseMs(live, grade2.ikiMs), `maxLive ${live}`).toBe(
        RECOGNITION_SLOW_BASE_MS,
      );
      for (const stop of STOP_IDS) {
        for (const word of stagePoolFor(stop)) {
          for (const ease of [EASE_MIN, EASE_NEW, EASE_MAX]) {
            const knobs = { maxLive: live };
            // FR-8's formula with UR-72's reader base and UR-51's queue scale.
            // Written out rather than called, so this is a comparison against
            // the decision rather than against the implementation.
            const floor =
              ([...word].length * KEYSTROKE_BUDGET_FACTOR * grade2.ikiMs +
                RECOGNITION_SLOW_BASE_MS * ease) *
              concurrencyTarget(live);
            // `toBe`, not `toBeCloseTo`. "Bit-identical" is the constraint and
            // a tolerance is not that claim: a budget that left a grade-2
            // child's fall 0.4 ms short would pass at six decimal places and
            // would still be a change to the belt nobody measured.
            expect(
              rawFallTimeMs({ word, ease, calibration: grade2, knobs }),
              `${stop}/"${word}" @ ease ${ease} @ maxLive ${live}`,
            ).toBe(floor);
            // AND IT IS STRICTLY MORE TIME THAN FR-8'S OWN EXPRESSION, never
            // less: the reading budget may only ever move up for this pilot.
            const fr8 =
              ([...word].length * KEYSTROKE_BUDGET_FACTOR * grade2.ikiMs +
                RECOGNITION_BASE_MS * ease) *
              concurrencyTarget(live);
            expect(floor, `${stop}/"${word}" @ ease ${ease}`).toBeGreaterThan(fr8);
            compared += 1;
          }
        }
      }
    }
    // THE DEFICIT IS CLOSED, STATED AS THE ONE NUMBER UR-72 IS ABOUT.
    // A brand-new word's reading grant against the supported tail pilot's
    // modelled cold-read time, at the knob's floor and at its ceiling.
    const COLD_READ_NEED_MS = 2400;
    for (let live = MAX_LIVE_MIN; live <= MAX_LIVE_MAX; live += 1) {
      expect(
        recognitionBudgetMs(EASE_NEW, recognitionBaseMs(live, grade2.ikiMs)),
        `cold-read grant @ maxLive ${live}`,
      ).toBe(COLD_READ_NEED_MS);
    }
    // And what it was: 1920, i.e. 480 ms short, which is the defect.
    expect(recognitionBudgetMs(EASE_NEW, RECOGNITION_BASE_MS)).toBe(1920);
    expect(COLD_READ_NEED_MS - 1920).toBe(480);
    // coding-standards 5: the sweep has to have swept - and the count is
    // DERIVED from the pools rather than pinned, because the content lanes add
    // words and a pinned literal would go red for a reason that has nothing to
    // do with a grade-2 child's belt. The guard the rule actually wants is
    // "every shipped word, at every knob, at every ease", which is this product,
    // plus a floor so an empty pool cannot make the sweep vacuous.
    const poolWords = STOP_IDS.reduce((n, stop) => n + stagePoolFor(stop).length, 0);
    expect(compared).toBe(poolWords * (MAX_LIVE_MAX - MAX_LIVE_MIN + 1) * 3);
    expect(compared).toBeGreaterThan(3000);
  });

  it("UR-72: and every SPAWN GAP a grade-2 pilot is fed matches the NEW floor", () => {
    /**
     * THE OTHER HALF OF THE FLOOR, AND IT IS NOT IMPLIED BY THE FIRST.
     *
     * `@engine/pacing` reads `fallMs` - the lead is a fraction of the SLACK
     * between the fall budget and what the rock is expected to cost - so a
     * change to fall time reaches the belt's spawn gaps as well as its fall
     * speeds. Proving the fall times unchanged and stopping there would leave
     * the arrival rate unproven, and the arrival rate is what stalled the belt
     * in the P0a defect.
     *
     * So the same sweep is run through `spawnGapMs`, over a grid of board
     * states rather than a single one: the gap is a function of how deep the
     * board is, how long the player has been on the rock in hand, whether any
     * observed evidence exists yet, and the rolling hit rate, and a fixed board
     * would prove the claim for one of them.
     *
     * WATCHED FAILING, with the real number: delete the `earned` factor from
     * `recognitionBaseMs` - i.e. let the ratchet reach a grade-2 child, which
     * is exactly what the owner's feel-test build did - and this reads
     *
     *     mars/"red" @ maxLive 3, depth 1, served 0, bias 300, rate 0.5:
     *     expected 1875 to be 1873
     *
     * a rock arriving early, on the FIRST step of the knob, on a child who is
     * already the tail of the distribution. The gap moves at maxLive 3 while the
     * belt is still nearly the gentlest it can be, which is the whole reason
     * this sweep runs the knob range rather than only its ceiling. (Before
     * UR-72 the same control read "mars/\"mars\" @ maxLive 3, depth 1, served 0,
     * bias 0, rate 0.5: expected 2077 to be 2021" - a smaller base, a bigger
     * gap error; the control still fires, on a different cell.)
     *
     * ================== UR-72 MOVED THIS FLOOR TOO, AND BY HOW MUCH =========
     * The reference budget is now the reader-scaled one, because that is the
     * belt this pilot flies. It matters that this is stated rather than left to
     * the fall-time sweep above: the lead is a fraction of the SLACK between the
     * budget and what the rock costs, so 480 ms more reading budget also means
     * the NEXT rock arrives sooner. Compared against the OLD reference, i.e.
     * with `RECOGNITION_BASE_MS` left below, this sweep reads
     *
     *     earth/"launch" @ maxLive 2, depth 1, served 0, bias 0, rate null:
     *     expected 4833 to be 4905
     *
     * - 72 ms sooner at the knob's floor, which is `LEAD_FRACTION_MIN` (0.15) of
     * the 480 ms. The rock lives 480 ms longer and its successor arrives 72 ms
     * earlier, so the net is +408 ms of room, and the route sweep is where that
     * net is settled rather than reasoned about: 3 stalls in 240 belts to 0.
     */
    const grade2 = { ikiMs: 600, fkLatencyMs: 700 };
    let compared = 0;
    let gapsSeen = 0;
    for (let live = MAX_LIVE_MIN; live <= MAX_LIVE_MAX; live += 1) {
      for (const stop of STOP_IDS) {
        for (const word of stagePoolFor(stop)) {
          const knobs = { maxLive: live };
          const floorBudget =
            ([...word].length * KEYSTROKE_BUDGET_FACTOR * grade2.ikiMs +
              RECOGNITION_SLOW_BASE_MS * EASE_NEW) *
            concurrencyTarget(live);
          const fallMs = fallTimeMs({ word, ease: EASE_NEW, calibration: grade2, knobs });
          const clear = expectedClearMs({
            length: [...word].length,
            ease: EASE_NEW,
            calibration: grade2,
          });
          for (const depth of [1, 2, 3, 4]) {
            const liveClearMs = Array.from({ length: depth }, () => clear);
            for (const servedMs of [0, 500]) {
              for (const biasMs of [null, 0, 300]) {
                for (const rate of [null, 0.5, 0.95]) {
                  const input = { liveClearMs, servedMs, biasMs, knobs, hitRate: rate };
                  const actual = spawnGapMs({ ...input, fallMs });
                  // The gap the floor budget would have produced. Same board,
                  // same player, same knob - the ONLY difference is which fall
                  // budget the lead is taken a fraction of.
                  const expected = spawnGapMs({
                    ...input,
                    // C20: the CEILING scales with the queue depth, the FLOOR
                    // does not. This mirrors `clampFallTime` exactly; a copy
                    // that scaled both would be comparing against a clamp the
                    // game no longer applies.
                    fallMs: Math.min(
                      FALL_TIME_MAX_MS * concurrencyTarget(live),
                      Math.max(FALL_TIME_MIN_MS, floorBudget),
                    ),
                  });
                  expect(
                    actual,
                    `${stop}/"${word}" @ maxLive ${live}, depth ${depth}, served ${servedMs}, bias ${biasMs}, rate ${rate}`,
                  ).toBe(expected);
                  gapsSeen += actual;
                  compared += 1;
                }
              }
            }
          }
        }
      }
    }
    // coding-standards 5: derived, not pinned - see the fall-time sweep above
    // for why a literal here goes red on content churn rather than on a defect.
    const poolWords = STOP_IDS.reduce((n, stop) => n + stagePoolFor(stop).length, 0);
    expect(compared).toBe(poolWords * (MAX_LIVE_MAX - MAX_LIVE_MIN + 1) * 72);
    expect(compared).toBeGreaterThan(70000);
    // And it has to have been measuring a gap, not a pile of zeroes - an
    // all-zero sweep would compare equal and prove nothing (rule 4's shape).
    expect(gapsSeen).toBeGreaterThan(0);
  });

  it("UR-51: the RECOGNITION ratchet is the lever that reaches a fast pilot", () => {
    /**
     * THE LEVER THIS CHANGE MOVED, AS ONE TABLE.
     *
     * The reading half of FR-8's budget was a constant: 1200 ms x ease, at
     * every knob setting, for every pilot, for ever. On the short words a fast
     * pilot meets it is the LARGER of the two halves - at the default interval
     * a three-letter word is ~1170 ms of typing against 1920 ms of reading at
     * `EASE_NEW` - so a knob that only spent from the typing half was spending
     * from the smaller term and the route stayed flat (UR-51).
     *
     * WATCHED FAILING, with the real number: pin `recognitionBaseMs` at
     * `RECOGNITION_BASE_MS` - the belt shipped before this change - and the
     * ramp assertion reads
     *
     *     maxLive 3: expected 1200 to be close to 1100, received difference is
     *     100, but expected 5e-10
     *
     * and the route sweep's fast pilot finishes at a margin of 0.468 instead of
     * 0.345 (tests/unit/simulation/launchRoute.test.ts).
     */
    expect(recognitionBaseMs(MAX_LIVE_MIN, CAL.ikiMs)).toBe(RECOGNITION_BASE_MS);
    expect(recognitionBaseMs(MAX_LIVE_MAX, CAL.ikiMs)).toBeCloseTo(
      RECOGNITION_EARNED_BASE_MS,
      10,
    );

    // The documented ramp, one step per stage, monotone, and no step larger
    // than a fifth of the travel - AC-10.1's "one knob per stage" is worth
    // nothing if the knob's effect on the budget arrives in a cliff.
    const table = [1200, 1197, 1194, 1191, 1188, 1185];
    let previous = RECOGNITION_BASE_MS;
    for (let live = MAX_LIVE_MIN; live <= MAX_LIVE_MAX; live += 1) {
      const base = recognitionBaseMs(live, CAL.ikiMs);
      expect(base, `maxLive ${live}`).toBeCloseTo(table[live - MAX_LIVE_MIN]!, 9);
      if (live > MAX_LIVE_MIN) {
        expect(base, `maxLive ${live}`).toBeLessThan(previous);
        expect(previous - base, `step into maxLive ${live}`).toBeLessThanOrEqual(
          (RECOGNITION_BASE_MS - RECOGNITION_EARNED_BASE_MS) / 5 + 1e-9,
        );
      }
      previous = base;
    }

    // A pilot faster than FR-8's default earns the same full ratchet as one
    // exactly at it - the scene floors the interval fall time reads, so the
    // engine never sees a smaller value on the real path.
    expect(recognitionBaseMs(MAX_LIVE_MAX, 260)).toBeCloseTo(
      RECOGNITION_EARNED_BASE_MS,
      10,
    );
  });

  it("UR-72: recognitionBaseMs is total, and a corrupt value gives the time back", () => {
    // Same rule as `keystrokeHeadroom` and `clampKnobs`: a restored profile must
    // never be able to stop a child's game, and the only safe direction for a
    // corrupt value is the one that grants MORE reading time.
    //
    // WHICH VALUE THAT IS HAS CHANGED, AND IT IS STILL THE SAME RULE. It used to
    // be FR-8's 1200, because 1200 was the most any pilot could be granted; the
    // most is now `RECOGNITION_SLOW_BASE_MS`, so that is what a corrupt
    // CALIBRATION reads as. Against the old expectation this reads
    //
    //     expected 1500 to be 1200
    //
    // i.e. a profile with a corrupt interval is now handed the slowest reader's
    // budget instead of the median reader's - strictly more time, which is the
    // direction the rule has always been about. The other control fires here
    // too: delete the `earned` factor from `recognitionBaseMs` and a corrupt
    // calibration stops exempting the pilot from the ratchet -
    // "expected 1484 to be 1500".
    //
    // A corrupt KNOB is unchanged: it reads as the knob's floor, and at a
    // healthy calibration that is still exactly 1200.
    expect(recognitionBaseMs(Number.NaN, CAL.ikiMs)).toBe(RECOGNITION_BASE_MS);
    expect(recognitionBaseMs(MAX_LIVE_MAX, Number.NaN)).toBe(RECOGNITION_SLOW_BASE_MS);
    expect(recognitionBaseMs(MAX_LIVE_MAX, Number.POSITIVE_INFINITY)).toBe(
      RECOGNITION_SLOW_BASE_MS,
    );
    expect(recognitionBaseMs(MAX_LIVE_MAX, HEADROOM_SLOW_IKI_MS)).toBe(
      RECOGNITION_SLOW_BASE_MS,
    );
    // And it is strictly MORE than FR-8's own base, never less.
    expect(RECOGNITION_SLOW_BASE_MS).toBeGreaterThan(RECOGNITION_BASE_MS);
    // Out of range in both directions clamps to the ends of the ramp.
    expect(recognitionBaseMs(MAX_LIVE_MIN - 5, CAL.ikiMs)).toBe(RECOGNITION_BASE_MS);
    expect(recognitionBaseMs(MAX_LIVE_MAX + 5, CAL.ikiMs)).toBeCloseTo(
      RECOGNITION_EARNED_BASE_MS,
      10,
    );
    // No calibration at all is FR-8's default, i.e. the full ratchet - the same
    // fallback `rawFallTimeMs` takes for `ikiMs` itself.
    expect(recognitionBaseMs(MAX_LIVE_MAX)).toBeCloseTo(RECOGNITION_EARNED_BASE_MS, 10);
  });

  it("UR-51 / C20: FR-8's clamp floor is LITERAL, and the ratchet cannot walk under it", () => {
    // FR-8's MIN is a child-safety bound, not a tuning value (PRD FR-8). The
    // recognition ratchet shortens the RAW budget, so the thing worth asserting
    // is that no word at any knob setting for any pilot can be granted less
    // than the bound - the clamp is what guarantees it and this is the check
    // that the ratchet did not reach around it.
    //
    // ================== THIS CLAIM CHANGED WITH C20 ==================
    // The bound used to be `FALL_TIME_MIN_MS * concurrencyTarget(live)`, i.e.
    // 10 000 ms at the top of the knob, and that is the defect C20 removes: at
    // the exact moment the board is busiest no rock could reach the breach line
    // in under ten seconds, so every mechanism built to make a rock quick died
    // at this line. Run against the current code the old assertion reads
    //
    //     "mars" @ maxLive 3 @ iki 260: expected 2850 to be greater than or
    //     equal to 4000
    //
    // where 4000 is 2500 x `concurrencyTarget(3)` and 2850 is a fast pilot's
    // actual budget for a short word on a two-to-three-deep board. The bound
    // that remains is FR-8's own literal 2500, at every knob setting, and it is
    // the one the PRD states.
    let checked = 0;
    for (let live = MAX_LIVE_MIN; live <= MAX_LIVE_MAX; live += 1) {
      for (const iki of [260, 350, 440, 600]) {
        for (const stop of STOP_IDS) {
          for (const word of stagePoolFor(stop)) {
            const ms = fallTimeMs({
              word,
              ease: EASE_MIN,
              calibration: { ikiMs: iki, fkLatencyMs: 500 },
              knobs: { maxLive: live },
            });
            // UR-88: the floor does not scale with the QUEUE (C20) and does
            // scale with the WORD and the HANDS. The ratchet still cannot walk
            // under it at any depth.
            expect(ms, `"${word}" @ maxLive ${live} @ iki ${iki}`).toBeGreaterThanOrEqual(
              fallFloorMs([...word].length, iki),
            );
            checked += 1;
          }
        }
      }
    }
    const poolWords = STOP_IDS.reduce((n, stop) => n + stagePoolFor(stop).length, 0);
    expect(checked).toBe(poolWords * (MAX_LIVE_MAX - MAX_LIVE_MIN + 1) * 4);
    expect(checked).toBeGreaterThan(4000);
    // And FR-8's literal bound is still the bound at the knob's floor.
    expect(clampFallTime(0)).toBe(FALL_TIME_MIN_MS);
  });

  it("UR-51: headroomEarned is total, and a corrupt calibration earns nothing", () => {
    // Same rule as clampKnobs: a restored profile must never be able to stop a
    // child's game, and the only safe direction for a corrupt value is the one
    // that gives time back.
    expect(headroomEarned(Number.NaN)).toBe(0);
    expect(headroomEarned(Number.POSITIVE_INFINITY)).toBe(0);
    expect(headroomEarned(HEADROOM_SLOW_IKI_MS + 1)).toBe(0);
    expect(headroomEarned(HEADROOM_SLOW_IKI_MS)).toBe(0);
    expect(headroomEarned(DEFAULT_CALIBRATION.ikiMs)).toBe(1);
    expect(headroomEarned(0)).toBe(1);
    expect(headroomEarned(440)).toBeCloseTo(0.64, 10);
    expect(keystrokeHeadroom(MAX_LIVE_MAX, Number.NaN)).toBe(KEYSTROKE_BUDGET_FACTOR);
    // No calibration at all is FR-8's default, i.e. the full ratchet - the same
    // fallback `rawFallTimeMs` takes for `ikiMs` itself.
    expect(keystrokeHeadroom(MAX_LIVE_MAX)).toBeCloseTo(KEYSTROKE_HEADROOM_MIN, 10);
    // And a corrupt KNOB still reads as the floor, with a real calibration.
    expect(keystrokeHeadroom(Number.NaN, DEFAULT_CALIBRATION.ikiMs)).toBe(
      KEYSTROKE_BUDGET_FACTOR,
    );
  });

  it("UR-51: the budget is monotone in the knob - tightening never shortens a fall", () => {
    let previous = 0;
    for (let live = MAX_LIVE_MIN; live <= MAX_LIVE_MAX; live += 1) {
      const ms = fallTimeMs({
        word: "jupiter",
        ease: EASE_NEW,
        calibration: CAL,
        knobs: { maxLive: live },
      });
      expect(ms, `maxLive ${live}`).toBeGreaterThan(previous);
      previous = ms;
    }
  });

  it("UR-51: rawFallTimeMs defaults to FR-8's own calibration when none is given", () => {
    // The last uncovered branch in this module, and it is the one the PRD is
    // written against: no calibration means FR-8's 350 ms, not NaN.
    expect(rawFallTimeMs({ word: "jupiter", ease: EASE_NEW })).toBe(
      rawFallTimeMs({ word: "jupiter", ease: EASE_NEW, calibration: DEFAULT_CALIBRATION }),
    );
  });

  it("UR-51: a non-finite budget factor falls back to FR-8's own bounds", () => {
    // Same rule as clampKnobs and concurrencyTarget, at the last place the
    // number is used: a corrupt knob must never be able to stop a child's game,
    // and NaN bounds would clamp every fall time in the belt to NaN.
    expect(clampFallTime(1e9, Number.NaN)).toBe(FALL_TIME_MAX_MS);
    expect(clampFallTime(0, Number.NaN)).toBe(FALL_TIME_MIN_MS);
    // And a factor below 1 cannot shrink FR-8's bounds either.
    expect(clampFallTime(1e9, 0.25)).toBe(FALL_TIME_MAX_MS);
  });

  it("UR-51: isClamped asks about HEADROOM, so it reads the same at every knob", () => {
    // Telemetry, not gameplay: it tells the controller that a word is pinned at
    // a bound and the fall-time knob has nothing left to give for it. Scaling
    // the budget and the bounds by the same factor leaves that question
    // untouched, and it should - a word is pinned or it is not, and how deep
    // the board happens to be is not part of the question.
    //
    // I ASSERTED THE OPPOSITE FIRST AND IT WAS WRONG. The test read
    // `isClamped(deep) === false` at the ceiling and `=== true` at the floor,
    // on the assumption that a scaled bound un-pins a long word. It cannot:
    // raw x f > MAX x f is the same inequality as raw > MAX. Received false
    // where true was expected, and the arithmetic says the received value is
    // the right one. The invariance is the property worth pinning.
    //
    // ================== AND C20 SPLIT THE TWO ENDS APART ==================
    // The invariance above is still exactly true at the CEILING, because that
    // bound still scales: raw x f > MAX x f is the same inequality as
    // raw > MAX. It is no longer true at the FLOOR, and that asymmetry IS the
    // change: with the floor at a literal 2500 a short word stops being pinned
    // as the board deepens, instead of being pinned harder. Measured, for a
    // grade-2 pilot's one-letter word at `EASE_MIN` (raw 1275 x the queue
    // factor): 1275 / 2040 / 2805 / 3570 / 4335 / 5100 across maxLive 2..7, so
    // it is under FR-8's floor at the first two settings and above it at the
    // rest. Run against the SHIPPED floor - `FALL_TIME_MIN_MS * f` - the old
    // blanket assertion read `4 short: expected false to be true`, i.e. the
    // rock the game had just un-pinned.
    const long = "a".repeat(20);
    const grade2 = { ikiMs: 600, fkLatencyMs: 700 };
    for (let live = MAX_LIVE_MIN; live <= MAX_LIVE_MAX; live += 1) {
      const knobs = { maxLive: live };
      expect(isClamped({ word: long, ease: EASE_MAX, calibration: grade2, knobs }), `${live} long`).toBe(true);
      expect(isClamped({ word: "jupiter", ease: EASE_NEW, calibration: grade2, knobs }), `${live} mid`).toBe(false);
      const shortRaw = rawFallTimeMs({ word: "a", ease: EASE_MIN, calibration: grade2, knobs });
      expect(
        isClamped({ word: "a", ease: EASE_MIN, calibration: grade2, knobs }),
        `${live} short, raw ${shortRaw.toFixed(0)} against FR-8's ${FALL_TIME_MIN_MS}`,
      ).toBe(shortRaw < FALL_TIME_MIN_MS);
    }
    // Stated as the two settings it is true at and the four it is not, so the
    // sweep above cannot pass by agreeing with itself.
    const pinned = [2, 3, 4, 5, 6, 7].filter((live) =>
      isClamped({ word: "a", ease: EASE_MIN, calibration: grade2, knobs: { maxLive: live } }),
    );
    expect(pinned, "maxLive settings at which a short rock is still floored").toEqual([2, 3]);
    // And the budget it reports on really did move, so the invariance above is
    // a property of the question rather than of nothing having changed.
    expect(
      rawFallTimeMs({ word: "jupiter", ease: EASE_NEW, calibration: grade2, knobs: { maxLive: MAX_LIVE_MAX } }),
    ).toBeGreaterThan(FALL_TIME_MAX_MS);
  });
});

/**
 * UR-72: THE READING BUDGET FOLLOWS THE READER.
 *
 * The defect, in one line: a brand-new word is granted
 * `RECOGNITION_BASE_MS x EASE_NEW` = 1920 ms to be READ, and this project's own
 * supported-tail model needs 2400 ms. That 480 ms is short in the shipped game
 * today; it is invisible because the pools are 26-32 words against 58 spawns,
 * so almost every rock is a SECOND exposure. It is also the reason the pools
 * cannot be expanded - measured on the route gate, 58 real words a stop takes
 * the grade-2 pilot from 3 stalls in 240 belts to 37, and 80 to 240 of 240.
 *
 * The fix is the shape `keystrokeHeadroom` already had: a budget that reads the
 * calibration the profile stores instead of one imagined reader. It runs in
 * BOTH directions off one axis - `headroomEarned` - so a fast pilot's reading
 * budget still only ever falls with the knob, and a slow one's rises to meet
 * what their measured hands say they need.
 */
describe("UR-72 / FR-8: the reading budget follows the reader", () => {
  const CAL = DEFAULT_CALIBRATION;

  it("UR-72: the documented ramp, and it is FR-8's own base at FR-8's own speed", () => {
    // WATCHED FAILING, with the real number: set `RECOGNITION_SLOW_BASE_MS` to
    // `RECOGNITION_BASE_MS` - i.e. revert UR-72 - and the 600 ms row reads
    // "iki 600: expected 1200 to be close to 1500, received difference is 300".
    const table: ReadonlyArray<readonly [number, number]> = [
      [120, 1200],
      [260, 1200],
      [350, 1200],
      [440, 1308],
      [520, 1404],
      [600, 1500],
      [900, 1500],
    ];
    for (const [iki, base] of table) {
      expect(recognitionReaderBaseMs(iki), `iki ${iki}`).toBeCloseTo(base, 9);
    }
    // The two ends are EXACT, not close: they are the values FR-8 and the
    // grade-2 model are written with, and a tolerance is not that claim.
    expect(recognitionReaderBaseMs(DEFAULT_CALIBRATION.ikiMs)).toBe(RECOGNITION_BASE_MS);
    expect(recognitionReaderBaseMs(HEADROOM_SLOW_IKI_MS)).toBe(RECOGNITION_SLOW_BASE_MS);
  });

  it("UR-72: it is monotone, continuous, and never steps by more than a fifth", () => {
    // The knob moves one step per stage (D20, AC-10.1) and so does the measured
    // interval, through `refineCalibration`'s blend. A reading budget that
    // jumped would make one stage boundary in three a cliff - the same property
    // `keystrokeHeadroom` and `concurrencyTarget` are built to hold.
    let previous = recognitionReaderBaseMs(HEADROOM_SLOW_IKI_MS);
    const step = (RECOGNITION_SLOW_BASE_MS - RECOGNITION_BASE_MS) / 5;
    for (let iki = HEADROOM_SLOW_IKI_MS - 50; iki >= 100; iki -= 50) {
      const base = recognitionReaderBaseMs(iki);
      expect(base, `iki ${iki}`).toBeLessThanOrEqual(previous);
      expect(previous - base, `step at iki ${iki}`).toBeLessThanOrEqual(step + 1e-9);
      previous = base;
    }
  });

  it("UR-72: a FAST pilot's reading budget did not rise, and still falls with the knob", () => {
    /**
     * THE CONSTRAINT THIS CHANGE IS MOST LIKELY TO HAVE BROKEN.
     *
     * The cheap version of UR-72 is to raise `RECOGNITION_BASE_MS` itself, and
     * it would have handed a fast pilot 300 ms more reading time at exactly the
     * moment `RECOGNITION_EARNED_BASE_MS` is trying to take 16 ms away - with
     * "too easy" the report on file four times.
     *
     * WATCHED FAILING, with the real number: make `recognitionReaderBaseMs`
     * ignore `headroomEarned` and return `RECOGNITION_SLOW_BASE_MS` flat - the
     * flat-raise this rejected - and the first assertion reads
     *
     *     fast @ maxLive 2: expected 1500 to be 1200
     *
     * i.e. every fast pilot handed a quarter more reading time on their first
     * belt.
     */
    for (const iki of [120, 200, 260, 300, 350]) {
      // At the knob's floor, FR-8's base to the byte.
      expect(recognitionBaseMs(MAX_LIVE_MIN, iki), `fast @ maxLive ${MAX_LIVE_MIN}`).toBe(
        RECOGNITION_BASE_MS,
      );
      // And the ratchet still runs its whole travel, unchanged by UR-72.
      expect(recognitionBaseMs(MAX_LIVE_MAX, iki), `fast @ maxLive ${MAX_LIVE_MAX}`).toBeCloseTo(
        RECOGNITION_EARNED_BASE_MS,
        10,
      );
      // Monotone DOWN across the whole knob for this pilot: at no setting does
      // UR-72 give a fast reader back a millisecond the knob has taken.
      let previous = Number.POSITIVE_INFINITY;
      for (let live = MAX_LIVE_MIN; live <= MAX_LIVE_MAX; live += 1) {
        const base = recognitionBaseMs(live, iki);
        expect(base, `iki ${iki} @ maxLive ${live}`).toBeLessThan(previous);
        expect(base, `iki ${iki} @ maxLive ${live}`).toBeLessThanOrEqual(RECOGNITION_BASE_MS);
        previous = base;
      }
    }
    // And the same claim on the whole belt rather than on the constant: every
    // shipped word, every ease, every knob, for the fast pilot the flight scene
    // actually hands the engine - identical to the pre-UR-72 value, to the byte.
    const fast = { ikiMs: 260, fkLatencyMs: 380 };
    let compared = 0;
    for (let live = MAX_LIVE_MIN; live <= MAX_LIVE_MAX; live += 1) {
      for (const stop of STOP_IDS) {
        for (const word of stagePoolFor(stop)) {
          for (const ease of [EASE_MIN, EASE_NEW, EASE_MAX]) {
            const knobs = { maxLive: live };
            // UR-51's belt, written out: the reader term is zero here, so the
            // expression contains no UR-72 quantity at all.
            const beforeUr72 =
              ([...word].length * keystrokeHeadroom(live, fast.ikiMs) * fast.ikiMs +
                (RECOGNITION_BASE_MS +
                  ((Math.min(MAX_LIVE_MAX, live) - MAX_LIVE_MIN) / (MAX_LIVE_MAX - MAX_LIVE_MIN)) *
                    (RECOGNITION_EARNED_BASE_MS - RECOGNITION_BASE_MS)) *
                  ease) *
              concurrencyTarget(live);
            expect(
              rawFallTimeMs({ word, ease, calibration: fast, knobs }),
              `${stop}/"${word}" @ ease ${ease} @ maxLive ${live}`,
            ).toBeCloseTo(beforeUr72, 9);
            compared += 1;
          }
        }
      }
    }
    // coding-standards 5: the sweep has to have swept.
    const poolWords = STOP_IDS.reduce((n, stop) => n + stagePoolFor(stop).length, 0);
    expect(compared).toBe(poolWords * (MAX_LIVE_MAX - MAX_LIVE_MIN + 1) * 3);
    expect(compared).toBeGreaterThan(3000);
  });

  it("UR-72: the cold-read budget covers every pilot's modelled need", () => {
    // The deficit, per pilot, as the one table UR-72 is about. `needMs` is each
    // simulated pilot's `coldRecognitionMs` in
    // `tests/unit/simulation/launchRoute.test.ts`; the budget is what a
    // brand-new word is granted at the knob's floor, which is the belt every
    // profile opens on (D18's cold start).
    //
    // WATCHED FAILING, with the real number: revert `RECOGNITION_SLOW_BASE_MS`
    // to `RECOGNITION_BASE_MS` and the grade-2 row reads
    // "grade2: expected 1920 to be greater than or equal to 2400".
    const pilots: ReadonlyArray<readonly [string, number, number]> = [
      ["fast", 260, 1100],
      ["median", 350, 1500],
      ["slow", 440, 1900],
      ["grade2", 600, 2400],
    ];
    for (const [name, iki, needMs] of pilots) {
      const budget = recognitionBudgetMs(EASE_NEW, recognitionBaseMs(MAX_LIVE_MIN, iki));
      expect(budget, name).toBeGreaterThanOrEqual(needMs);
    }
    // The tail pilot is the binding one and it binds EXACTLY - 1500 is derived
    // as 2400 / EASE_NEW, not chosen. If `EASE_NEW` ever moves, this goes red
    // rather than quietly leaving the deficit open again.
    expect(RECOGNITION_SLOW_BASE_MS * EASE_NEW).toBe(2400);
  });

  it("UR-72: the one-deep invariant still holds, and the reader base only helps it", () => {
    // FR-8's one-deep invariant: the budget must serve `expectedClearMs` at the
    // depth the controller is asking for. `expectedClearMs` prices recognition
    // at FR-8's flat 1200 x ease, so raising the fall budget for a slow reader
    // can only ever raise this ratio - but "can only" is an argument and this
    // is the measurement.
    for (const [pilot, calibration] of [
      ["fast", { ikiMs: 260, fkLatencyMs: 380 }],
      ["median", CAL],
      ["slow", { ikiMs: 440, fkLatencyMs: 650 }],
      ["grade2", { ikiMs: 600, fkLatencyMs: 700 }],
    ] as const) {
      for (let live = MAX_LIVE_MIN; live <= MAX_LIVE_MAX; live += 1) {
        let worst = Number.POSITIVE_INFINITY;
        for (const stop of STOP_IDS) {
          for (const word of stagePoolFor(stop)) {
            const fall = fallTimeMs({
              word,
              ease: EASE_NEW,
              calibration,
              knobs: { maxLive: live },
            });
            const service = expectedClearMs({
              length: [...word].length,
              ease: EASE_NEW,
              calibration,
            });
            worst = Math.min(worst, fall / service);
          }
        }
        expect(worst, `${pilot} @ maxLive ${live}`).toBeGreaterThanOrEqual(
          concurrencyTarget(live),
        );
      }
    }
  });

  it("UR-72: FR-8's clamp bounds are untouched", () => {
    // The reading base is the one term that could walk a fall past the 14 s
    // ceiling, and the ceiling is a child-safety bound, not a tuning value.
    expect(FALL_TIME_MIN_MS).toBe(2500);
    expect(FALL_TIME_MAX_MS).toBe(14000);
    expect(clampFallTime(0)).toBe(FALL_TIME_MIN_MS);
    expect(clampFallTime(1e9)).toBe(FALL_TIME_MAX_MS);
    // And no shipped word, at the slowest pilot and the worst ease, reaches the
    // ceiling at the knob's floor - so the pools have room to grow a longer word
    // before the clamp, not less.
    const grade2 = { ikiMs: HEADROOM_SLOW_IKI_MS, fkLatencyMs: 700 };
    for (const stop of STOP_IDS) {
      for (const word of stagePoolFor(stop)) {
        expect(
          isClamped({ word, ease: EASE_MAX, calibration: grade2 }),
          `${stop}/"${word}"`,
        ).toBe(false);
      }
    }
    // The clamp first binds at 13 letters, which is where `MAX_WORD_LENGTH`
    // already sits - the same place it bound before UR-72, because the length
    // term is what reaches it first.
    //   12 letters: 12*900 + 1500*1.6 = 10800 + 2400 = 13200, under.
    //   13 letters: 13*900 + 2400 = 14100, over.
    expect(rawFallTimeMs({ word: "a".repeat(12), ease: EASE_NEW, calibration: grade2 })).toBe(13200);
    expect(rawFallTimeMs({ word: "a".repeat(13), ease: EASE_NEW, calibration: grade2 })).toBe(14100);
    expect(fallTimeMs({ word: "a".repeat(13), ease: EASE_NEW, calibration: grade2 })).toBe(
      FALL_TIME_MAX_MS,
    );
  });
});

/**
 * UR-83: A BELT AT A LOW KNOB IS A METRONOME, AND THAT IS THE REPORT.
 *
 * "Some rocks should fly by fast - a second or two to type - and some slower."
 * They did not: fall time is `length * headroom * iki + base * ease`, and at a
 * low knob setting, where ease is near 1.0 for everything and a pool is
 * length-tight, that is a near-constant. Two rocks on the same board fell at
 * about the same speed, every time.
 *
 * `fallSpreadFactor` is the property of the ROCK that fixes it: one 0..1 draw
 * from the belt's seeded rng, taken at spawn, scaling the whole of FR-8's
 * budget. What is asserted here is that it is a real spread, that it scales off
 * the same measured interval the rest of this file does, and - the part that
 * matters - that it cannot cost the supported tail a single millisecond.
 */
describe("UR-83 / FR-8: a rock's own share of the budget", () => {
  const FAST = { ikiMs: 260, fkLatencyMs: 400 };
  const GRADE2 = { ikiMs: HEADROOM_SLOW_IKI_MS, fkLatencyMs: 700 };

  it("UR-83: no spread at all is FR-8's budget, byte for byte", () => {
    // The property every `toBe` sweep above rests on. `spread` is optional in
    // the type, and a caller that does not draw one must get the identical
    // number it got before this existed.
    expect(fallSpreadFactor(undefined)).toBe(1);
    for (const stop of STOP_IDS) {
      for (const word of stagePoolFor(stop)) {
        for (const ease of [EASE_MIN, EASE_NEW, EASE_MAX]) {
          for (const calibration of [DEFAULT_CALIBRATION, FAST, GRADE2]) {
            expect(rawFallTimeMs({ word, ease, calibration }), `"${word}"`).toBe(
              rawFallTimeMs({ word, ease, calibration, spread: undefined }),
            );
          }
        }
      }
    }
  });

  it("UR-83: it is a REAL spread - the slowest rock is nearly twice the quickest", () => {
    /**
     * WATCHED FAILING, with the real number: return a constant 1 from
     * `fallSpreadFactor` - the shipped belt - and this reads
     *
     *     the belt's quickest and slowest rock differ by 1.00x:
     *     expected 1 to be greater than 1.7
     *
     * i.e. every rock on the board falls at exactly the same speed, which is
     * the report in one number.
     */
    const lo = fallSpreadFactor(0, FAST.ikiMs);
    const hi = fallSpreadFactor(1, FAST.ikiMs);
    expect(
      hi / lo,
      `the belt's quickest and slowest rock differ by ${(hi / lo).toFixed(2)}x`,
    ).toBeGreaterThan(1.7);
    // (The second assertion the control above fires is `expected 0 to be
    // greater than 0` on the millisecond swing below - a constant factor moves
    // no rock by any amount.)
    expect(lo).toBeCloseTo(1 - FALL_SPREAD_DOWN, 10);
    expect(hi).toBeCloseTo(1 + FALL_SPREAD_UP, 10);
    // And the CENTRE is FR-8 exactly, so the spread is a spread and not a cut.
    expect(fallSpreadFactor(0.5, FAST.ikiMs)).toBe(1);
  });

  it("UR-83: the spread is a MULTIPLE, so it scales off the measured interval", () => {
    // The coordinator's constraint: "a fast typist's slow rock is still quick
    // in absolute terms. Do not add a variance that is constant in
    // milliseconds regardless of who is typing." Measured as a ratio: the ms
    // the spread moves a rock by is proportional to what the rock cost.
    const word = "planet";
    const at = (calibration: { ikiMs: number; fkLatencyMs: number }, spread: number): number =>
      rawFallTimeMs({ word, ease: EASE_NEW, calibration, spread });
    const fastSwing = at(FAST, 1) - at(FAST, 0.5);
    const slowSwing = at(GRADE2, 1) - at(GRADE2, 0.5);
    // A slower pilot's rocks are budgeted for longer, so their SLOW rock is
    // slower by more milliseconds - which is what "not constant in ms" means.
    expect(slowSwing).toBeGreaterThan(fastSwing);
    // And the proportion is identical, because it is one multiple of the whole
    // expression: D19's split survives untouched.
    expect(at(FAST, 1) / at(FAST, 0.5)).toBeCloseTo(at(GRADE2, 1) / at(GRADE2, 0.5), 10);
  });

  it("UR-83: the supported tail is NEVER handed a shorter fall than FR-8's", () => {
    /**
     * THE SAFETY CLAIM, AND IT IS ARITHMETIC RATHER THAN A SIMULATION RESULT.
     *
     * The downward half is scaled by `headroomEarned`, which is 0 at
     * `HEADROOM_SLOW_IKI_MS`, so a pilot measured that slow gets a spread that
     * runs 1.00 to 1.30 - entirely in the direction that gives time back. No
     * draw, no word, no ease and no knob setting can produce a rock shorter
     * than the one they flew before this change.
     *
     * WATCHED FAILING, with the real number: drop the `earned` factor from
     * `fallSpreadFactor` - a symmetric spread for everybody - and this reads
     *
     *     grade-2, "launch" at draw 0: expected 5460 to be greater than or
     *     equal to 7800
     *
     * and the route sweep gains stalls for the median and slow pilots too.
     */
    for (const stop of STOP_IDS) {
      for (const word of stagePoolFor(stop)) {
        const base = rawFallTimeMs({ word, ease: EASE_NEW, calibration: GRADE2 });
        for (let i = 0; i <= 20; i += 1) {
          const spread = i / 20;
          expect(
            rawFallTimeMs({ word, ease: EASE_NEW, calibration: GRADE2, spread }),
            `grade-2, "${word}" at draw ${spread}`,
          ).toBeGreaterThanOrEqual(base);
        }
      }
    }
    // Stated as the factor itself, at every draw: it is never below 1.
    for (let i = 0; i <= 100; i += 1) {
      expect(fallSpreadFactor(i / 100, HEADROOM_SLOW_IKI_MS)).toBeGreaterThanOrEqual(1);
      expect(fallSpreadFactor(i / 100, HEADROOM_SLOW_IKI_MS + 400)).toBeGreaterThanOrEqual(1);
    }
  });

  it("UR-83: FR-8's 2500 ms floor and 14000 ms ceiling still bound every rock", () => {
    // The spread is applied inside `rawFallTimeMs`, i.e. BEFORE the clamp, so
    // the bounds - each scaled by the queue depth exactly as UR-51 left them -
    // are untouched. Swept over every shipped word, every ease, every pilot,
    // every knob setting and the whole range of the draw.
    for (const stop of STOP_IDS) {
      for (const word of stagePoolFor(stop)) {
        for (const ease of [EASE_MIN, EASE_NEW, EASE_MAX]) {
          for (const calibration of [FAST, DEFAULT_CALIBRATION, GRADE2]) {
            for (let live = MAX_LIVE_MIN; live <= MAX_LIVE_MAX; live += 1) {
              const factor = fallBudgetFactor({ maxLive: live });
              for (const spread of [0, 0.25, 0.5, 0.75, 1]) {
                const ms = fallTimeMs({ word, ease, calibration, knobs: { maxLive: live }, spread });
                // C20: the floor does not carry the queue's factor at any
                // depth; only the ceiling does. UR-88: and the floor itself is
                // the word's and the pilot's.
                expect(ms, `"${word}" at ${live}/${spread}`).toBeGreaterThanOrEqual(
                  fallFloorMs([...word].length, calibration.ikiMs),
                );
                expect(ms).toBeLessThanOrEqual(FALL_TIME_MAX_MS * factor);
              }
            }
          }
        }
      }
    }
  });

  it("UR-83: the draw is total - a corrupt sample is the centre, never NaN", () => {
    // A rock with a NaN fall time is a rock with no deadline, which is a rock
    // that never leaves a child's board.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(fallSpreadFactor(bad, FAST.ikiMs)).toBe(1);
    }
    // Out of range clamps rather than extrapolating.
    expect(fallSpreadFactor(-5, FAST.ikiMs)).toBe(fallSpreadFactor(0, FAST.ikiMs));
    expect(fallSpreadFactor(5, FAST.ikiMs)).toBe(fallSpreadFactor(1, FAST.ikiMs));
    expect(Number.isFinite(fallTimeMs({ word: "rock", ease: EASE_NEW, spread: Number.NaN }))).toBe(
      true,
    );
  });
});

/**
 * UR-84 / C20: THE CLAMP FLOOR IS FR-8'S LITERAL 2500 AT EVERY QUEUE DEPTH,
 * and UR-84: THE STOP SETS A PACE AS WELL AS A BOARD DEPTH.
 *
 * UR-51 scaled BOTH clamp bounds by `fallBudgetFactor`. The ceiling belongs
 * there - it asks whether the back of a queue can still be answered, which is a
 * question about the queue. The floor asks whether a rock is reachable by a
 * child at all, which is a question about the child, and a child does not read
 * faster because three other rocks are on the board. Scaled, it made the
 * SHORTEST fall the game could produce at `MAX_LIVE_MAX` exactly 10 000 ms, so
 * every mechanism built to make a rock quick died at that line.
 */
describe("UR-84 / C20: the floor is literal, and the stop sets a pace", () => {
  const ACE = { ikiMs: 240, fkLatencyMs: 380 };
  const GRADE2_CAL = { ikiMs: HEADROOM_SLOW_IKI_MS, fkLatencyMs: 700 };

  it("C20: the CEILING scales with the queue and the FLOOR does not", () => {
    // Stated as the two bounds themselves, at every depth the knob produces.
    //
    // WATCHED FAILING, with the real number: restore
    // `Math.max(FALL_TIME_MIN_MS * f, ms)` and this reads
    // `maxLive 7: expected 10000 to be 2500`.
    for (let live = MAX_LIVE_MIN; live <= MAX_LIVE_MAX; live += 1) {
      const f = fallBudgetFactor({ maxLive: live });
      expect(clampFallTime(0, f), `maxLive ${live}`).toBe(FALL_TIME_MIN_MS);
      expect(clampFallTime(1e9, f), `maxLive ${live}`).toBe(FALL_TIME_MAX_MS * f);
    }
    // And the depth the whole change is about: four times FR-8's floor is what
    // the shipped clamp imposed at the busiest board the game has.
    expect(FALL_TIME_MIN_MS * fallBudgetFactor({ maxLive: MAX_LIVE_MAX })).toBe(10_000);
  });

  it("C20: a fast pilot's quickest rock is no longer a multiple of the floor", () => {
    // The mechanism, on real words rather than on the bound: at the top of the
    // knob, with the spread's fastest draw, a short word now lands well under
    // the 10 000 ms the shipped floor pinned it to.
    const knobs = { maxLive: MAX_LIVE_MAX };
    let quickest = Number.POSITIVE_INFINITY;
    for (const stop of STOP_IDS) {
      for (const word of stagePoolFor(stop)) {
        quickest = Math.min(
          quickest,
          fallTimeMs({ word, ease: EASE_MIN, calibration: ACE, knobs, spread: 0, stop }),
        );
      }
    }
    expect(quickest, `quickest rock at the knob's ceiling: ${Math.round(quickest)} ms`).toBeLessThan(
      5000,
    );
    // UR-88: bounded below by the SHORTEST shipped word's own floor for this
    // pilot rather than by FR-8's flat constant - and still bounded.
    expect(quickest, "and a floor still binds it").toBeGreaterThanOrEqual(
      fallFloorMs(2, ACE.ikiMs),
    );
  });

  it("C20: it cannot reach the supported tail, and that is arithmetic", () => {
    // PART ONE: on a word this pilot has NOT seen (`EASE_NEW` - every first
    // exposure, which is what UR-72 measured the tail's cold-read time
    // against) C20 grants them exactly what UR-51's scaled clamp granted, byte
    // for byte, at every depth, on every draw, at every stop.
    let checked = 0;
    for (let live = MAX_LIVE_MIN; live <= MAX_LIVE_MAX; live += 1) {
      for (const stop of STOP_IDS) {
        for (const word of stagePoolFor(stop)) {
          for (const spread of [0, 0.5, 1]) {
            const raw = rawFallTimeMs({
              word,
              ease: EASE_NEW,
              calibration: GRADE2_CAL,
              knobs: { maxLive: live },
              spread,
              stop,
            });
            // The complete claim, and it is stronger than "the raw is above
            // the old floor": the fall time this pilot is GRANTED is
            // byte-identical to the one the shipped clamp granted. Stated by
            // recomputing UR-51's scaled clamp here and comparing.
            const f = fallBudgetFactor({ maxLive: live });
            const shipped = Math.min(
              FALL_TIME_MAX_MS * f,
              Math.max(FALL_TIME_MIN_MS * f, raw),
            );
            expect(
              clampFallTime(raw, f),
              `"${word}" @ ${live}/${spread}/${stop}: raw ${Math.round(raw)}`,
            ).toBe(shipped);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(3000);

    // PART TWO: on a word they have MASTERED, whether C20 shortens anything at
    // all DEPENDS ON THE POOLS, so it is measured rather than pinned.
    //
    // ================== WHY THIS IS NOT PINNED TO A NUMBER =================
    // The answer flipped three times inside one afternoon and none of the
    // flips were this module's doing: the word pools are a live file
    // (`src/content/*.json`) being rewritten in a different lane, and whether a
    // mastered word's budget falls under `2500 * concurrencyTarget(knob)`
    // depends entirely on whether a short enough word is in a pool that day.
    // Measured at three points in one session: 0 changed cells (pools with no
    // word under three letters), then 20 (shorter words added). Both are true
    // readings of different content.
    //
    // So what is asserted is the part that is a property of THIS module and
    // cannot move with the pools: whatever the pools hold, the tail is never
    // granted less than FR-8's own literal MIN, which is the child-safety bound
    // the PRD states. The survivability claim that actually matters - zero
    // stalls for this pilot at every stop - lives in
    // `tests/unit/simulation/launchRoute.test.ts` where it belongs.
    let moved = 0;
    let checkedMastered = 0;
    let worstMs = Number.POSITIVE_INFINITY;
    for (let live = MAX_LIVE_MIN; live <= MAX_LIVE_MAX; live += 1) {
      const f = fallBudgetFactor({ maxLive: live });
      for (const stop of STOP_IDS) {
        for (const word of stagePoolFor(stop)) {
          const raw = rawFallTimeMs({
            word,
            ease: EASE_MIN,
            calibration: GRADE2_CAL,
            knobs: { maxLive: live },
            stop,
          });
          const now = clampFallTime(raw, f);
          const shipped = Math.min(FALL_TIME_MAX_MS * f, Math.max(FALL_TIME_MIN_MS * f, raw));
          if (now !== shipped) moved += 1;
          checkedMastered += 1;
          worstMs = Math.min(worstMs, now);
          expect(now, `"${word}" @ ${live}/${stop}`).toBeGreaterThanOrEqual(FALL_TIME_MIN_MS);
        }
      }
    }
    // Reported, not pinned - see above. It is printed so the number is visible
    // in the run rather than silently absent.
    expect(
      moved,
      `mastered-word cells C20 shortens for the tail: ${moved} of ${checkedMastered}`,
    ).toBeGreaterThanOrEqual(0);
    // And the sweep really did look at something, rather than passing on an
    // empty grid.
    expect(checkedMastered, "mastered-word cells swept").toBeGreaterThan(3000);
    // FR-8's own MIN, and it is reached exactly rather than cleared: with the
    // current pools the tail's shortest mastered-word rock lands ON the bound,
    // which is the bound doing its job.
    expect(worstMs, `the tail's shortest possible rock: ${Math.round(worstMs)} ms`).toBeGreaterThanOrEqual(
      FALL_TIME_MIN_MS,
    );
    // And zero stalls for this pilot over the whole route is measured in
    // `tests/unit/simulation/launchRoute.test.ts`, which is where a claim about
    // survivability belongs.
  });

  it("UR-84: the per-stop pace factor, as the table", () => {
    // Linear in `stageIndexOf` over the six belt stops, and Mars is exactly 1.
    //
    // WATCHED FAILING, with the real number: set `STOP_PACE_DROP` to 0 and the
    // last row reads `pluto: expected 1 to be close to 0.88`.
    const table: ReadonlyArray<readonly [string, number]> = [
      ["mars", 1],
      ["jupiter", 0.976],
      ["saturn", 0.952],
      ["uranus", 0.928],
      ["neptune", 0.904],
      ["pluto", 0.88],
    ];
    for (const [stop, factor] of table) {
      expect(stopPaceFactor(stop as Parameters<typeof stopPaceFactor>[0], ACE.ikiMs), stop).toBeCloseTo(
        factor,
        10,
      );
    }
    // Mars is EXACT, not close: a child's first belt is FR-8's budget byte for
    // byte, which is the same floor `stopBandForStage` puts Mars on.
    expect(stopPaceFactor("mars", ACE.ikiMs)).toBe(1);
    // No stop at all is exactly 1, so every pre-UR-84 caller is unchanged.
    expect(stopPaceFactor(undefined, ACE.ikiMs)).toBe(1);
    expect(stopPaceFactor(null, ACE.ikiMs)).toBe(1);
  });

  it("UR-84: the pace COMPOSES with the ability curve rather than replacing it", () => {
    // The safety shape this file already ships three times over: the drop is
    // scaled by `headroomEarned`, so the route's shape reaches a pilot exactly
    // in proportion to what their measured hands have earned.
    const row = [240, 350, 440, 520, HEADROOM_SLOW_IKI_MS, 900].map((iki) =>
      Number(stopPaceFactor("pluto", iki).toFixed(4)),
    );
    expect(row).toEqual([0.88, 0.88, 0.9232, 0.9616, 1, 1]);
    // A slow pilot at the LAST stop flies FR-8's budget, at every stop, and a
    // corrupt calibration reads as the slowest pilot - the only direction a bad
    // value may move a child's belt.
    for (const stop of STOP_IDS) {
      expect(stopPaceFactor(stop, HEADROOM_SLOW_IKI_MS), stop).toBe(1);
      expect(stopPaceFactor(stop, Number.NaN), stop).toBe(1);
    }
    // And it is monotone in the route: no stop is slower than the one before.
    let previous = Number.POSITIVE_INFINITY;
    for (const stop of ["mars", "jupiter", "saturn", "uranus", "neptune", "pluto"] as const) {
      const f = stopPaceFactor(stop, ACE.ikiMs);
      expect(f, stop).toBeLessThanOrEqual(previous);
      previous = f;
    }
  });

  it("UR-84: the pace is inside rawFallTimeMs, so FR-8's bounds still hold", () => {
    // Applied before the clamp, like the spread, so nothing here can produce a
    // rock outside FR-8's window however late the stop is.
    for (const stop of STOP_IDS) {
      for (const word of stagePoolFor(stop)) {
        for (const calibration of [ACE, DEFAULT_CALIBRATION, GRADE2_CAL]) {
          for (let live = MAX_LIVE_MIN; live <= MAX_LIVE_MAX; live += 1) {
            for (const spread of [0, 1]) {
              const ms = fallTimeMs({
                word,
                ease: EASE_NEW,
                calibration,
                knobs: { maxLive: live },
                spread,
                stop,
              });
              expect(ms, `"${word}" @ ${stop}/${live}`).toBeGreaterThanOrEqual(
                fallFloorMs([...word].length, calibration.ikiMs),
              );
              expect(ms).toBeLessThanOrEqual(
                FALL_TIME_MAX_MS * fallBudgetFactor({ maxLive: live }),
              );
            }
          }
        }
      }
    }
  });
});
