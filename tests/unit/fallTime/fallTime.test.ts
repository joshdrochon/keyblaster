import { describe, expect, it } from "vitest";
import {
  FALL_TIME_MAX_MS,
  FALL_TIME_MIN_MS,
  HEADROOM_SLOW_IKI_MS,
  KEYSTROKE_BUDGET_FACTOR,
  KEYSTROKE_HEADROOM_MIN,
  RECOGNITION_BASE_MS,
  clampFallTime,
  fallTimeMs,
  headroomEarned,
  isClamped,
  keystrokeBudgetMs,
  keystrokeHeadroom,
  rawFallTimeMs,
  fallBudgetFactor,
  recognitionBudgetMs,
} from "@engine/fallTime/index.js";
import {
  CONCURRENCY_TARGET_MAX,
  MAX_LIVE_MAX,
  MAX_LIVE_MIN,
  concurrencyTarget,
} from "@engine/controller/knobs.js";
import { expectedClearMs } from "@engine/pacing/index.js";
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
  it("is len * 1.5 * iki + 1200 * ease", () => {
    // 6 letters, iki 400, ease 1.0 -> 6*1.5*400 + 1200 = 3600 + 1200 = 4800
    const ms = fallTimeMs({
      word: "planet",
      ease: 1.0,
      calibration: { ikiMs: 400, fkLatencyMs: 500 },
    });
    expect(ms).toBe(4800);
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
    const rand = mulberry32(20260916);
    for (let i = 0; i < 2000; i++) {
      const len = 1 + Math.floor(rand() * 13);
      const ease = EASE_MIN + rand() * (EASE_MAX - EASE_MIN);
      const ikiMs = 120 + rand() * 700;
      const word = "a".repeat(len);
      const input = { word, ease, calibration: { ikiMs, fkLatencyMs: 500 } };
      expect(rawFallTimeMs(input)).toBeCloseTo(
        keystrokeBudgetMs(len, ikiMs) + recognitionBudgetMs(ease),
        9,
      );
      expect(fallTimeMs(input)).toBe(clampFallTime(rawFallTimeMs(input)));
    }
  });
});

describe("AC-8.1: clamps hold", () => {
  it("never falls faster than the minimum", () => {
    // Shortest word, fastest typist, easiest word -> well under 2500
    const ms = fallTimeMs({
      word: "a",
      ease: EASE_MIN,
      calibration: { ikiMs: 100, fkLatencyMs: 200 },
    });
    expect(ms).toBe(FALL_TIME_MIN_MS);
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
      const ms = fallTimeMs({
        word: "a".repeat(1 + Math.floor(rand() * 13)),
        ease: EASE_MIN + rand() * (EASE_MAX - EASE_MIN),
        calibration: { ikiMs: 80 + rand() * 900, fkLatencyMs: 500 },
      });
      expect(ms).toBeGreaterThanOrEqual(FALL_TIME_MIN_MS);
      expect(ms).toBeLessThanOrEqual(FALL_TIME_MAX_MS);
    }
  });

  it("reports whether a value was clamped, for controller telemetry", () => {
    expect(isClamped({ word: "a", ease: EASE_MIN, calibration: { ikiMs: 100, fkLatencyMs: 200 } })).toBe(true);
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

  it("pins the shortest words to the floor at default calibration", () => {
    // Documented so the clamp is a known property, not a surprise: the floor
    // exists so no word is unreadably fast for a grade-2 reader (D01, D19).
    expect(fallTimeMs({ word: "a", ease: 1.0 })).toBe(FALL_TIME_MIN_MS);
    expect(fallTimeMs({ word: "at", ease: 1.0 })).toBe(FALL_TIME_MIN_MS);
    expect(fallTimeMs({ word: "dry", ease: 1.0 })).toBeGreaterThan(FALL_TIME_MIN_MS);
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
    expect(ms).toBe(FALL_TIME_MIN_MS);
  });

  it("handles a zero inter-key interval without dividing by anything", () => {
    const ms = fallTimeMs({ word: "planet", ease: 1.0, calibration: { ikiMs: 0, fkLatencyMs: 0 } });
    expect(ms).toBe(FALL_TIME_MIN_MS);
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

  it("UR-51: at the knob's CEILING a rock can wait three words and still be typed", () => {
    // The claim UR-42 measured as impossible, restated as the arithmetic that
    // makes it possible: the number of ANSWERABLE rocks is
    // floor(fall / service), and at the top of the knob that has to reach the
    // depth the pacing module builds.
    //
    // WATCHED FAILING, with the real numbers: drop the clamp's scaling and the
    // fast pilot's worst word reads 3 against the 4 required, because a 14 s
    // ceiling cuts the budget off before the queue is paid for. Drop `knobs`
    // from the call entirely and every pilot reads 1 - the figure in
    // belt-concurrency.json today.
    for (const [pilot, calibration] of [
      ["fast", { ikiMs: 260, fkLatencyMs: 380 }],
      ["median", DEFAULT_CALIBRATION],
      ["grade2", { ikiMs: 600, fkLatencyMs: 700 }],
    ] as const) {
      let worst = Number.POSITIVE_INFINITY;
      for (const stop of STOP_IDS) {
        for (const word of stagePoolFor(stop)) {
          const fall = fallTimeMs({
            word,
            ease: EASE_NEW,
            calibration,
            knobs: { maxLive: MAX_LIVE_MAX },
          });
          const service = expectedClearMs({
            length: [...word].length,
            ease: EASE_NEW,
            calibration,
          });
          worst = Math.min(worst, fall / service);
        }
      }
      expect(Math.floor(worst), pilot).toBeGreaterThanOrEqual(CONCURRENCY_TARGET_MAX);
    }
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
          expect(raw, where).toBeCloseTo(
            (keystrokeBudgetMs([...word].length, CAL.ikiMs, headroom) +
              recognitionBudgetMs(ease)) *
              factor,
            6,
          );

          // 2. THE RESHAPE ONLY EVER SHORTENS, AND ONLY THROUGH LENGTH. The
          //    pure multiple is the ceiling; the ratchet spends from it. At the
          //    floor the two are the same number, which is the bit-identical
          //    constraint restated at this level.
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

  it("UR-51: a grade-2 pilot's belt is FR-8's belt at EVERY knob setting, not just the floor", () => {
    // THE HARD CONSTRAINT, and the reason the ratchet reads a calibration at
    // all. A knob-only ratchet is safe while the margin gate keeps a slow pilot
    // near the floor, and "hard to reach" is not "cannot happen": a knob is
    // persisted, and a profile restored from an older save or shared with a
    // faster sibling can open a belt anywhere in FR-10's range.
    //
    // WATCHED FAILING, with the real numbers: make `keystrokeHeadroom` ignore
    // its `ikiMs` argument and this reads "maxLive 3: expected 1.425 to be
    // 1.5" on the first step of the knob - and the route sweep turns the same
    // change into 23 stalls in 240 belts for the grade-2 pilot at the knob's
    // ceiling, against the 3 on record ("expected 23 to be less than or equal
    // to 3", tests/unit/simulation/launchRoute.test.ts).
    const grade2 = { ikiMs: 600, fkLatencyMs: 700 };
    let compared = 0;
    for (let live = MAX_LIVE_MIN; live <= MAX_LIVE_MAX; live += 1) {
      expect(keystrokeHeadroom(live, grade2.ikiMs), `maxLive ${live}`).toBe(
        KEYSTROKE_BUDGET_FACTOR,
      );
      for (const stop of STOP_IDS) {
        for (const word of stagePoolFor(stop)) {
          const knobs = { maxLive: live };
          // FR-8's own formula, with only the queue scaling UR-51's first pass
          // already shipped. Written out rather than called, so this is a
          // comparison against the PRD rather than against the implementation.
          const fr8 =
            ([...word].length * KEYSTROKE_BUDGET_FACTOR * grade2.ikiMs +
              RECOGNITION_BASE_MS * EASE_NEW) *
            concurrencyTarget(live);
          expect(
            rawFallTimeMs({ word, ease: EASE_NEW, calibration: grade2, knobs }),
            `${stop}/"${word}" @ maxLive ${live}`,
          ).toBeCloseTo(fr8, 6);
          compared += 1;
        }
      }
    }
    // coding-standards 5: the sweep has to have swept.
    expect(compared).toBeGreaterThan(600);
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
    const long = "a".repeat(20);
    const grade2 = { ikiMs: 600, fkLatencyMs: 700 };
    for (let live = MAX_LIVE_MIN; live <= MAX_LIVE_MAX; live += 1) {
      const knobs = { maxLive: live };
      expect(isClamped({ word: long, ease: EASE_MAX, calibration: grade2, knobs }), `${live} long`).toBe(true);
      expect(isClamped({ word: "a", ease: EASE_MIN, calibration: grade2, knobs }), `${live} short`).toBe(true);
      expect(isClamped({ word: "jupiter", ease: EASE_NEW, calibration: grade2, knobs }), `${live} mid`).toBe(false);
    }
    // And the budget it reports on really did move, so the invariance above is
    // a property of the question rather than of nothing having changed.
    expect(
      rawFallTimeMs({ word: "jupiter", ease: EASE_NEW, calibration: grade2, knobs: { maxLive: MAX_LIVE_MAX } }),
    ).toBeGreaterThan(FALL_TIME_MAX_MS);
  });
});
