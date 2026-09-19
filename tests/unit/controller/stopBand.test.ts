import { describe, expect, it } from "vitest";
import {
  DEFAULT_KNOBS,
  MAX_LIVE_MAX,
  MAX_LIVE_MIN,
  RAMP_OPEN_LIVE,
  STAGE_RAMP_FAST_MS,
  STAGE_RAMP_SLOW_MS,
  bandOf,
  bandPosition,
  clampBand,
  createController,
  decideStage,
  endStage,
  rampedMaxLive,
  recordOutcome,
  stageRampMs,
  stopBand,
  stopBandForStage,
  type ControllerState,
} from "@engine/controller/index.js";
import { BELT_STOP_IDS, DEFAULT_CALIBRATION, STOP_IDS, type StopId } from "@engine/types.js";
import { HEADROOM_SLOW_IKI_MS } from "@engine/fallTime/index.js";

/**
 * UR-83: THE STOP IS AN INPUT TO DIFFICULTY, AND IT IS A RANGE.
 *
 * ================== THE REPORT, FIVE TIMES ==================
 * "I finish every level first try at ~100% accuracy and the game has no
 * challenge. You would not expect seven rocks at once on Mars; you absolutely
 * should on Pluto. Each stop must be inherently harder than the one before it."
 *
 * ================== THE CAUSE WAS STRUCTURAL ==================
 * `@engine/controller` had NO STOP INPUT. `stageIndexOf` has been in
 * `@engine/types` since the route was built and nothing in the controller ever
 * read it, so Mars and Pluto were the same board for an equally good typist,
 * and `DEFAULT_KNOBS.maxLive` is `MAX_LIVE_MIN` so every fresh pilot's belt at
 * every stop opened at the gentlest setting the game has. Difficulty was 100%
 * adaptive and 0% progression.
 *
 * ================== WHAT IS ASSERTED HERE ==================
 * That the band is a RANGE and not a schedule, in four parts, because each one
 * is a different way the change could be got wrong:
 *
 *   1. the floor makes each stop inherently harder than the last;
 *   2. the ceiling stops an early stop being a late stop (Mars never reaches
 *      FR-10's cap);
 *   3. adjacent bands OVERLAP, so a strong pilot on an early stop and a weak
 *      pilot on a late one can meet - nobody is handed a difficulty for being
 *      at a stop;
 *   4. the first belt of a first route is FR-10's own floor, so a grade-2
 *      child's first belt is the one already measured at zero stalls.
 *
 * The route-level measurement - stalls, hit rate, occupancy and margin per
 * stop, per pilot - is `tests/unit/simulation/launchRoute.test.ts`. This file
 * is the arithmetic that route rests on.
 */

const BELTS: readonly StopId[] = BELT_STOP_IDS;

describe("UR-83 / FR-10: every stop is a band of maxLive, not a value", () => {
  it("reads something: the route is six belts and seven stops", () => {
    // Anti-vacuity. Every assertion below is a loop over these.
    expect(STOP_IDS.length).toBe(7);
    expect(BELTS.length).toBe(6);
    expect(BELTS[0]).toBe("mars");
    expect(BELTS[BELTS.length - 1]).toBe("pluto");
  });

  it("UR-83: the band is inside FR-10's range and is never empty", () => {
    for (const stop of STOP_IDS) {
      const band = stopBand(stop);
      expect(band.floor, stop).toBeGreaterThanOrEqual(MAX_LIVE_MIN);
      expect(band.ceiling, stop).toBeLessThanOrEqual(MAX_LIVE_MAX);
      // A band of width zero is a schedule with no alternative, which is the
      // thing this whole file exists to forbid.
      expect(band.ceiling - band.floor, `${stop} band width`).toBeGreaterThanOrEqual(1);
    }
  });

  it("UR-83: each stop is inherently harder than the one before it", () => {
    /**
     * WATCHED FAILING, with the real numbers: this is the assertion that fired
     * on the FIRST band shape tried, and on the pre-UR-83 controller.
     *
     * Against the shipped controller (no band at all, `bandOf` for every stop
     * being FR-10's 2..7) it reads
     *
     *     jupiter is no harder than mars: expected 9 to be greater than 9
     *
     * i.e. every stop's floor AND ceiling are the same two numbers (9 is
     * `floor + ceiling` = 2 + 7), which is the defect in one line. Under the
     * same control the ceiling assertion below reads `mars ceiling: expected 7
     * to be less than 7`.
     */
    for (let i = 1; i < BELTS.length; i += 1) {
      const prev = stopBand(BELTS[i - 1]!);
      const here = stopBand(BELTS[i]!);
      expect(here.floor, `${BELTS[i]} floor`).toBeGreaterThanOrEqual(prev.floor);
      expect(here.ceiling, `${BELTS[i]} ceiling`).toBeGreaterThanOrEqual(prev.ceiling);
      expect(
        here.floor + here.ceiling,
        `${BELTS[i]} is no harder than ${BELTS[i - 1]}`,
      ).toBeGreaterThan(prev.floor + prev.ceiling);
    }
  });

  it("UR-83: adjacent bands OVERLAP, so nobody is scheduled a difficulty", () => {
    // The owner's own words: "if Mars' ceiling is below Neptune's floor with no
    // overlap, a strong Mars pilot and a weak Neptune pilot are being scheduled
    // rather than measured". Measured: every adjacent pair shares at least
    // three settings.
    for (let i = 1; i < BELTS.length; i += 1) {
      const prev = stopBand(BELTS[i - 1]!);
      const here = stopBand(BELTS[i]!);
      const shared = Math.min(prev.ceiling, here.ceiling) - Math.max(prev.floor, here.floor) + 1;
      expect(
        shared,
        `${BELTS[i - 1]} ${prev.floor}-${prev.ceiling} and ${BELTS[i]} ${here.floor}-${here.ceiling} share ${shared} settings`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("UR-83: Mars never reaches the top of the range and Pluto opens near it", () => {
    // "You would not expect 7 rocks at once on Mars; you absolutely should on
    // Pluto", as arithmetic.
    const mars = stopBand("mars");
    const pluto = stopBand("pluto");
    expect(mars.ceiling, "mars ceiling").toBeLessThan(MAX_LIVE_MAX);
    expect(pluto.ceiling, "pluto ceiling").toBe(MAX_LIVE_MAX);
    expect(pluto.floor, "pluto floor").toBeGreaterThan(mars.ceiling);
  });

  it("UR-83 / D18: a first-time child's FIRST belt is FR-10's own floor", () => {
    // THE SAFETY PROPERTY, at the one moment it is unconditional. A new profile
    // has been watched by nobody, and Mars is where it starts, so Mars' floor
    // must be the cold start that `tests/unit/simulation/launchRoute.test.ts`
    // already measures at zero stalls for a grade-2 pilot. Nothing in this file
    // may make a child's first belt busier than the one on record.
    expect(stopBand("mars").floor).toBe(MAX_LIVE_MIN);
    expect(DEFAULT_KNOBS.maxLive).toBe(MAX_LIVE_MIN);
    const opened = createController({ knobs: DEFAULT_KNOBS, stopId: "mars" });
    expect(opened.knobs.maxLive).toBe(MAX_LIVE_MIN);
  });

  it("UR-83: a corrupt or absent stage is the gentlest band, never a throw", () => {
    // Same rule as `clampKnobs`: a restored profile must never be able to stop
    // a child's game, and the direction a bad value moves a belt is always the
    // safe one.
    for (const stage of [Number.NaN, Number.POSITIVE_INFINITY, -99, 999]) {
      const band = stopBandForStage(stage);
      expect(band.floor, String(stage)).toBeGreaterThanOrEqual(MAX_LIVE_MIN);
      expect(band.ceiling, String(stage)).toBeLessThanOrEqual(MAX_LIVE_MAX);
      expect(band.floor).toBeLessThanOrEqual(band.ceiling);
    }
    expect(stopBandForStage(Number.NaN).floor).toBe(MAX_LIVE_MIN);
    // No stop at all is FR-10's whole range - the pre-UR-83 controller, exactly.
    expect(bandOf(null)).toEqual({ floor: MAX_LIVE_MIN, ceiling: MAX_LIVE_MAX });
    expect(bandOf(undefined)).toEqual({ floor: MAX_LIVE_MIN, ceiling: MAX_LIVE_MAX });
    // And a band that arrived the wrong way round is turned round rather than
    // clamping every knob onto one number.
    expect(clampBand({ floor: 6, ceiling: 3 })).toEqual({ floor: 3, ceiling: 6 });
    expect(clampBand({ floor: Number.NaN, ceiling: 99 })).toEqual({
      floor: MAX_LIVE_MIN,
      ceiling: MAX_LIVE_MAX,
    });
  });
});

describe("UR-83: the band clamps the knob, and the adaptive rules are untouched", () => {
  /**
   * UR-84 / C21: `recordOutcome` now adapts WITHIN the belt as well, so a
   * thirty-rock belt moves the knob before either helper returns. Every
   * assertion in this block is about what the BAND does to a STAGE BOUNDARY, so
   * the knob is restored to the one the belt opened on; the within-belt arm has
   * its own file (`tests/unit/controller/midStage.test.ts`), including the
   * assertion that a mid-belt move cannot leave the band either.
   *
   * WATCHED FAILING, with the real number: return `c` unchanged and
   * "a tighten stops at the stop's ceiling and says so" reads
   * `expected 'hold' to be 'tighten'` - the knob was already at Mars' ceiling
   * when the boundary was asked, so the boundary correctly held.
   */
  const atOpeningKnob = (opened: ControllerState, flown: ControllerState): ControllerState => ({
    ...flown,
    knobs: opened.knobs,
    stageMidMoveAt: 0,
    stageMidMoves: 0,
    lastMidDecision: null,
  });
  /** A belt whose every rock was blasted with most of its budget unused. */
  function cruised(state: ControllerState): ControllerState {
    let c = state;
    for (let i = 0; i < 30; i += 1) c = recordOutcome(c, "blasted", 0.9);
    return atOpeningKnob(state, c);
  }
  /** A belt that went badly: a quarter missed, every rock taken at the line. */
  function struggled(state: ControllerState): ControllerState {
    let c = state;
    for (let i = 0; i < 30; i += 1) c = recordOutcome(c, i % 4 === 0 ? "missed" : "blasted", 0.02);
    return atOpeningKnob(state, c);
  }

  it("UR-83: a child arriving on the cold start is LIFTED to the stop's floor", () => {
    // Progression, and the only thing in the controller a pilot cannot talk it
    // out of. WATCHED FAILING, with the real number: drop `stopId` from the
    // `createController` call and it reads
    //
    //     saturn opened at 2: expected 2 to be 3
    //
    // which is the shipped behaviour - a child flies Saturn, and every stop
    // after it, on the belt Mars handed them. The replay assertion below reads
    // `mars: expected 7 to be 4` under the same control.
    for (const stop of BELTS) {
      const band = stopBand(stop);
      const opened = createController({ knobs: { maxLive: MAX_LIVE_MIN }, stopId: stop });
      expect(opened.knobs.maxLive, `${stop} opened at ${opened.knobs.maxLive}`).toBe(band.floor);
    }
  });

  it("UR-83: a strong pilot REPLAYING an early stop is pushed back to its ceiling", () => {
    // The other half of the same clamp, and the half that makes an early stop
    // stay an early stop. A pilot who ended the route at the cap and comes back
    // to Mars flies Mars' board, not Pluto's.
    for (const stop of BELTS) {
      const band = stopBand(stop);
      const opened = createController({ knobs: { maxLive: MAX_LIVE_MAX }, stopId: stop });
      expect(opened.knobs.maxLive, stop).toBe(band.ceiling);
    }
  });

  it("UR-83: a tighten stops at the stop's ceiling and says so", () => {
    // The adaptive rule is untouched - it simply has a different top. The hold
    // reason has to be the honest one, or a debug overlay reports a knob that
    // moved when nothing did.
    const mars = stopBand("mars");
    // D53's ORDER IS UNCHANGED: the primary knob is at its bound, so the
    // SECONDARY one moves instead, exactly as it does at FR-10's own cap. That
    // is the first thing to pin, because a band that swallowed the secondary
    // step would be taking authority away from FR-10 rather than shaping it.
    const primaryAtTop = cruised(
      createController({ knobs: { maxLive: mars.ceiling, lengthBias: 0 }, stopId: "mars" }),
    );
    expect(decideStage(primaryAtTop).action).toBe("tighten");
    expect(decideStage(primaryAtTop).change?.knob).toBe("lengthBias");
    expect(endStage(primaryAtTop).knobs.maxLive).toBe(mars.ceiling);

    // And with BOTH at their cap there is nothing left to give, and the hold
    // reason has to be the honest one or a debug overlay reports a knob that
    // moved when nothing did.
    const at = cruised(
      createController({ knobs: { maxLive: mars.ceiling, lengthBias: 1 }, stopId: "mars" }),
    );
    const decision = decideStage(at);
    expect(decision.action, `at mars' ceiling ${mars.ceiling}`).toBe("hold");
    expect(decision.holdReason).toBe("at-tighten-ceiling");
    expect(endStage(at).knobs.maxLive).toBe(mars.ceiling);

    // And one step below it, the identical evidence moves the PRIMARY knob.
    // Without this the assertion above could be passing because the pilot is
    // not good enough rather than because the ceiling is in the way.
    const below = cruised(
      createController({ knobs: { maxLive: mars.ceiling - 1, lengthBias: 1 }, stopId: "mars" }),
    );
    expect(decideStage(below).action).toBe("tighten");
    expect(decideStage(below).change?.knob).toBe("maxLive");
    expect(endStage(below).knobs.maxLive).toBe(mars.ceiling);
  });

  it("UR-83: a loosen stops at the stop's floor, so progression cannot be unwound", () => {
    const pluto = stopBand("pluto");
    const at = struggled(
      createController({ knobs: { maxLive: pluto.floor, lengthBias: -1 }, stopId: "pluto" }),
    );
    const decision = decideStage(at);
    expect(decision.action, `at pluto's floor ${pluto.floor}`).toBe("hold");
    expect(decision.holdReason).toBe("at-loosen-floor");
    expect(endStage(at).knobs.maxLive).toBe(pluto.floor);

    // One step above it the identical evidence loosens, so the floor is what is
    // stopping it and not the evidence.
    const above = struggled(
      createController({ knobs: { maxLive: pluto.floor + 1, lengthBias: -1 }, stopId: "pluto" }),
    );
    expect(decideStage(above).action).toBe("loosen");
    expect(endStage(above).knobs.maxLive).toBe(pluto.floor);
  });

  it("AC-10.1 / D20: the band never lets more than one knob move at a stage end", () => {
    // The clamp happens when a belt OPENS, not at the boundary, so it can never
    // combine with a knob step. Swept over every stop and every setting.
    for (const stop of BELTS) {
      for (let live = MAX_LIVE_MIN; live <= MAX_LIVE_MAX; live += 1) {
        for (const bias of [-1, 0, 1] as const) {
          const opened = createController({ knobs: { maxLive: live, lengthBias: bias }, stopId: stop });
          for (const belt of [cruised, struggled]) {
            const after = endStage(belt(opened)).knobs;
            const moved =
              (after.maxLive === opened.knobs.maxLive ? 0 : 1) +
              (after.lengthBias === opened.knobs.lengthBias ? 0 : 1);
            expect(moved, `${stop} at ${live}/${bias}`).toBeLessThanOrEqual(1);
            expect(after.maxLive).toBeGreaterThanOrEqual(stopBand(stop).floor);
            expect(after.maxLive).toBeLessThanOrEqual(stopBand(stop).ceiling);
          }
        }
      }
    }
  });
});

describe("UR-83: a belt OPENS at one rock and widens over the first 5-10 seconds", () => {
  it("UR-83: the opening is the window the report asked for, at both ends", () => {
    // "Mars should open with ONE rock for the first 5-10 seconds." Both ends of
    // the ramp are inside that window, so the slowest child gets the most
    // generous reading of it rather than the average of it.
    expect(STAGE_RAMP_FAST_MS).toBe(5000);
    expect(STAGE_RAMP_SLOW_MS).toBe(10000);
    expect(RAMP_OPEN_LIVE).toBe(1);
  });

  it("UR-83: the opening is SHORTER for a pilot the controller knows is fast", () => {
    /**
     * The coordinator's clarification, as arithmetic: "the widening should
     * reach the floor sooner for a pilot the controller already knows is fast,
     * and take the full time for one it does not. It is an opening, not a fixed
     * animation."
     *
     * WATCHED FAILING, with the real numbers: return a constant
     * `STAGE_RAMP_SLOW_MS` from `stageRampMs` - a fixed animation - and this
     * reads
     *
     *     a fast pilot's opening: expected 10000 to be less than 10000
     */
    const fast = stageRampMs(260);
    const dflt = stageRampMs(DEFAULT_CALIBRATION.ikiMs);
    const mid = stageRampMs(440);
    const slow = stageRampMs(HEADROOM_SLOW_IKI_MS);
    expect(fast, "a fast pilot's opening").toBeLessThan(slow);
    expect(fast).toBe(STAGE_RAMP_FAST_MS);
    expect(dflt, "FR-8's own default interval").toBe(STAGE_RAMP_FAST_MS);
    expect(slow).toBe(STAGE_RAMP_SLOW_MS);
    // Continuous in between, on the same `headroomEarned` axis the fall budget
    // uses, so the two can never disagree about who is fast.
    expect(mid).toBeGreaterThan(fast);
    expect(mid).toBeLessThan(slow);
    // An unmeasured or corrupt calibration gets the LONGEST opening.
    expect(stageRampMs(undefined)).toBe(STAGE_RAMP_FAST_MS);
    expect(stageRampMs(Number.NaN)).toBe(STAGE_RAMP_SLOW_MS);
  });

  it("UR-83: Mars opens on ONE rock and stays there for the whole opening", () => {
    /**
     * The report, literally. At Mars' floor the cap is 2, so the board holds
     * one rock until the opening is over.
     *
     * WATCHED FAILING, with the real number: delete the `liveCap` call from
     * `FlightScene.trySpawn` - i.e. gate on `this.controller.knobs.maxLive`
     * again - and the board holds two rocks from the first frame:
     *
     *     the instant the belt opens: expected 2 to be 1
     */
    const cap = stopBand("mars").floor;
    const rampMs = stageRampMs(DEFAULT_CALIBRATION.ikiMs);
    expect(rampedMaxLive(cap, 0, rampMs), "the instant the belt opens").toBe(1);
    expect(rampedMaxLive(cap, 1000, rampMs), "one second into the belt").toBe(1);
    expect(rampedMaxLive(cap, rampMs - 1, rampMs), "just before the opening ends").toBe(1);
    expect(rampedMaxLive(cap, rampMs, rampMs), "at the end of the opening").toBe(cap);
    expect(rampedMaxLive(cap, rampMs * 10, rampMs), "long after").toBe(cap);
  });

  it("UR-83: a deep board widens GRADUALLY rather than in one jump", () => {
    // "then gradually increase". At Pluto's ceiling the board takes six steps
    // to open, one per equal slice of the ramp.
    const cap = MAX_LIVE_MAX;
    const rampMs = STAGE_RAMP_SLOW_MS;
    const seen = new Set<number>();
    let previous = 0;
    for (let t = 0; t <= rampMs; t += 100) {
      const live = rampedMaxLive(cap, t, rampMs);
      // Monotonic: an opening that ever narrowed would take a rock off a board
      // a child is already looking at.
      expect(live, `at ${t} ms`).toBeGreaterThanOrEqual(previous);
      previous = live;
      seen.add(live);
    }
    expect(seen.size, `the board passed through ${seen.size} depths`).toBe(cap);
    expect(Math.min(...seen)).toBe(RAMP_OPEN_LIVE);
    expect(Math.max(...seen)).toBe(cap);
  });

  it("UR-83: the opening can only ever hold a board SHALLOWER than the knob", () => {
    // The safety claim, swept rather than argued: there is no clock, no cap and
    // no duration at which this returns more rocks than the knob already
    // allowed, so no belt anywhere can be made busier by it.
    for (const cap of [Number.NaN, Number.POSITIVE_INFINITY]) {
      // A corrupt cap is ONE rock, not an unbounded board: the same rule
      // `clampKnobs` follows, pointed the way that cannot hurt a child.
      expect(rampedMaxLive(cap, 60_000, STAGE_RAMP_FAST_MS), String(cap)).toBe(RAMP_OPEN_LIVE);
    }
    for (let cap = MAX_LIVE_MIN; cap <= MAX_LIVE_MAX; cap += 1) {
      for (const rampMs of [0, -1, STAGE_RAMP_FAST_MS, STAGE_RAMP_SLOW_MS, Number.NaN]) {
        for (const t of [-5000, 0, 1, 2500, 9999, 60_000, Number.NaN]) {
          const live = rampedMaxLive(cap, t, rampMs);
          expect(live, `cap ${cap}, ramp ${rampMs}, t ${t}`).toBeLessThanOrEqual(cap);
          expect(live).toBeGreaterThanOrEqual(RAMP_OPEN_LIVE);
        }
      }
    }
  });
});

describe("UR-89: position inside the stop's own band", () => {
  it("is 0 at the floor, 1 at the ceiling, and linear between", () => {
    // THE SIGNAL `headroomEarned` CANNOT SEE. That axis reads the measured
    // typing interval and returns 1.0 at FR-8's own default and at everything
    // faster, so an ace and a median child are the same pilot to it. This
    // reads the quantity `decideStage` actually decided - where in the stop's
    // range it put this child - and it separates them cleanly.
    const pluto = stopBand("pluto");
    expect(bandPosition("pluto", pluto.floor)).toBe(0);
    expect(bandPosition("pluto", pluto.ceiling)).toBe(1);
    expect(bandPosition("pluto", pluto.floor + 1)).toBeCloseTo(0.5, 10);
    const uranus = stopBand("uranus");
    expect(bandPosition("uranus", uranus.floor + 1)).toBeCloseTo(0.25, 10);
  });

  it("is total: a corrupt, absent or out-of-range knob reads as the floor", () => {
    // The only direction a bad value may move a child's belt is the one that
    // takes nothing away - the rule `clampKnobs` and `concurrencyTarget` follow.
    expect(bandPosition("mars")).toBe(0);
    expect(bandPosition("mars", Number.NaN)).toBe(0);
    expect(bandPosition("mars", -50)).toBe(0);
    expect(bandPosition("mars", 999)).toBe(1);
    expect(bandPosition(null, MAX_LIVE_MIN)).toBe(0);
    expect(bandPosition(undefined, MAX_LIVE_MAX)).toBe(1);
    // Earth has no belt (D57) and answers a band rather than throwing, so this
    // answers a position rather than dividing by a zero-width range.
    expect(Number.isFinite(bandPosition("earth" as never, 3))).toBe(true);
  });
});
