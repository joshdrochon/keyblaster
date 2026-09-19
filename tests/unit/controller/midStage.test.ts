import { describe, expect, it } from "vitest";
import {
  LOOSEN_MARGIN_BELOW,
  MAX_LIVE_MAX,
  MAX_LIVE_MIN,
  MIDSTAGE_LOOSEN_SAMPLE,
  MIDSTAGE_TIGHTEN_SAMPLE,
  TIGHTEN_MARGIN_ABOVE,
  createController,
  decideMidStage,
  decideStage,
  endStage,
  recordOutcome,
  stopBand,
} from "@engine/controller/index.js";
import type { ControllerState } from "@engine/controller/index.js";

/**
 * UR-84 / COLLISION C21: THE CONTROLLER ADAPTS INSIDE A BELT.
 *
 * ================== THE STRUCTURAL DEFECT ==================
 * D20 / AC-10.1 move at most one knob per STAGE, and a stage is a belt. UR-83's
 * bands are two to five settings wide, so a pilot standing at a stop's floor
 * needed two to five clean belts to reach its ceiling - on a six-stop route.
 * Measured on the route sweep, a ~100%-accuracy pilot finished the whole game
 * with about a third of every rock's budget unspent, because the difficulty
 * that was meant to meet them was always four belts away. The band set the
 * range; nothing made the climb through it fast enough to be felt.
 *
 * ================== WHAT REPLACES D20'S GUARD ==================
 * D20's rule exists to stop the knob oscillating on a noisy sample, and "wait
 * for the belt to end" was its guard. That guard is what made the controller
 * too slow, so it is replaced rather than removed:
 *
 *   SAMPLE       `MIDSTAGE_TIGHTEN_SAMPLE` outcomes before the first mid-belt
 *                tighten and between any two of them.
 *   LOOSEN       `MIDSTAGE_LOOSEN_SAMPLE`, half of it, so a struggling child is
 *                helped twice as fast as a strong one is pressed.
 *   SIGNALS      unchanged. `decideMidStage` calls `decideStage` verbatim, so
 *                FR-10's band, D18's floor and UR-51's margin throttle all
 *                still gate every move.
 *
 * Everything below is a property of those three, and the last block is the one
 * that matters: a tighten is arithmetically unreachable for the supported tail.
 */
describe("UR-84 / C21: the controller adapts WITHIN a belt", () => {
  /** A belt flown well: every rock blasted with most of its budget unused. */
  const cruise = (state: ControllerState, rocks: number, margin = 0.6): ControllerState => {
    let s = state;
    for (let i = 0; i < rocks; i += 1) s = recordOutcome(s, "blasted", margin);
    return s;
  };

  it("UR-84: a ~100% pilot climbs the band INSIDE one belt, not over five", () => {
    /**
     * THE REPORT, AS ONE NUMBER.
     *
     * WATCHED FAILING, with the real numbers: make `decideMidStage` return
     * `decideStage`'s hold unconditionally - i.e. the shipped one-move-per-belt
     * controller - and this reads
     *
     *     mars: reached maxLive 2 after 58 rocks, against the ceiling 4:
     *     expected 2 to be 4
     *
     * and, at the last stop,
     *
     *     pluto: reached maxLive 5 after 58 rocks, against the ceiling 7:
     *     expected 5 to be 7
     *
     * i.e. the pilot flies the whole belt on the knob it opened with, which is
     * the defect.
     */
    for (const stop of ["mars", "pluto"] as const) {
      const band = stopBand(stop);
      const opened = createController({ knobs: { maxLive: band.floor }, stopId: stop });
      const flown = cruise(opened, 58);
      expect(
        flown.knobs.maxLive,
        `${stop}: reached maxLive ${flown.knobs.maxLive} after 58 rocks, against the ceiling ${band.ceiling}`,
      ).toBe(band.ceiling);
      // And it arrives EARLY in the belt rather than on its last rock: one step
      // per `MIDSTAGE_TIGHTEN_SAMPLE` rocks, so the whole width of the widest
      // band costs `(ceiling - floor) * MIDSTAGE_TIGHTEN_SAMPLE` rocks.
      let s = opened;
      let rocks = 0;
      while (s.knobs.maxLive < band.ceiling && rocks < 58) {
        s = recordOutcome(s, "blasted", 0.6);
        rocks += 1;
      }
      expect(rocks, `${stop}: rocks to the ceiling`).toBe(
        (band.ceiling - band.floor) * MIDSTAGE_TIGHTEN_SAMPLE,
      );
      expect(rocks, `${stop}: rocks to the ceiling`).toBeLessThan(58);
    }
  });

  it("UR-84: the SAMPLE gate holds the first move off, and says why", () => {
    // A hold with a reason, not an unlabelled no-op: a debug overlay and this
    // test read the same field.
    const opened = createController({ knobs: { maxLive: MAX_LIVE_MIN } });
    let s = opened;
    for (let i = 1; i < MIDSTAGE_TIGHTEN_SAMPLE; i += 1) {
      s = recordOutcome(s, "blasted", 0.6);
      expect(s.knobs.maxLive, `after ${i} rocks`).toBe(MAX_LIVE_MIN);
    }
    // The decision itself says the signals are ready and the sample is not.
    const held = decideMidStage(s);
    expect(held.action).toBe("hold");
    expect(held.holdReason).toBe("too-soon");
    expect(decideStage(s).action, "and the STAGE rule would have moved").toBe("tighten");
    // One more rock and it goes.
    s = recordOutcome(s, "blasted", 0.6);
    expect(s.knobs.maxLive).toBe(MAX_LIVE_MIN + 1);
    expect(s.stageMidMoves).toBe(1);
    expect(s.lastMidDecision?.action).toBe("tighten");
  });

  it("UR-84: the LOOSEN arm is twice as responsive as the tighten arm", () => {
    // The safety posture, stated as a number rather than as an intention.
    expect(MIDSTAGE_LOOSEN_SAMPLE * 2).toBe(MIDSTAGE_TIGHTEN_SAMPLE);
    const opened = createController({ knobs: { maxLive: MAX_LIVE_MAX, lengthBias: 0 } });
    let s = opened;
    for (let i = 1; i < MIDSTAGE_LOOSEN_SAMPLE; i += 1) {
      s = recordOutcome(s, "missed", 0);
      expect(s.knobs.maxLive, `after ${i} breaches`).toBe(MAX_LIVE_MAX);
    }
    s = recordOutcome(s, "missed", 0);
    // Cheapest relief first (D53): `loosenStep` takes lengthBias before maxLive.
    expect(s.stageMidMoves, "relief arrived on the 4th breach").toBe(1);
    expect(s.lastMidDecision?.action).toBe("loosen");
    expect(s.lastMidDecision!.marginFloor!).toBeLessThan(LOOSEN_MARGIN_BELOW);
    // And it keeps giving, one step per four rocks, until it runs out of band.
    for (let i = 0; i < 40; i += 1) s = recordOutcome(s, "missed", 0);
    expect(s.knobs.maxLive, "a belt being lost ends at FR-10's floor").toBe(MAX_LIVE_MIN);
  });

  it("UR-84: a mid-belt move can never leave the STOP'S BAND", () => {
    // The band is UR-83's progression and a new event must not be able to walk
    // out of it. Swept over every stop in both directions.
    for (const stop of ["mars", "jupiter", "saturn", "uranus", "neptune", "pluto"] as const) {
      const band = stopBand(stop);
      let up = createController({ knobs: { maxLive: band.floor }, stopId: stop });
      let down = createController({ knobs: { maxLive: band.ceiling }, stopId: stop });
      for (let i = 0; i < 120; i += 1) {
        up = recordOutcome(up, "blasted", 0.9);
        down = recordOutcome(down, "missed", 0);
        expect(up.knobs.maxLive, `${stop} climbing`).toBeLessThanOrEqual(band.ceiling);
        expect(up.knobs.maxLive, `${stop} climbing`).toBeGreaterThanOrEqual(band.floor);
        expect(down.knobs.maxLive, `${stop} falling`).toBeGreaterThanOrEqual(band.floor);
        expect(down.knobs.maxLive, `${stop} falling`).toBeLessThanOrEqual(band.ceiling);
      }
    }
  });

  it("UR-84: the SUPPORTED TAIL can never be tightened mid-belt, as arithmetic", () => {
    /**
     * THE SAFETY CLAIM, AND IT IS NOT A SIMULATION RESULT.
     *
     * `decideMidStage` delegates to `decideStage`, whose tighten arm requires
     * the margin quartile to be strictly above `TIGHTEN_MARGIN_ABOVE` (0.35).
     * This project's grade-2 model measures 0.171-0.21 over the whole route
     * (`@engine/controller/margin`, and the route sweep's `marginP25` column),
     * so the gate is shut for them at every sample size, on every rock, at
     * every stop. Swept here as the property rather than asserted as a hope:
     * no number of clean rocks at that margin produces a tighten.
     */
    for (const margin of [0, 0.05, 0.171, 0.21, TIGHTEN_MARGIN_ABOVE]) {
      const opened = createController({ knobs: { maxLive: MAX_LIVE_MIN }, stopId: "pluto" });
      const flown = cruise(opened, 200, margin);
      expect(
        flown.knobs.maxLive,
        `200 clean rocks at margin ${margin} must not tighten`,
      ).toBeLessThanOrEqual(opened.knobs.maxLive);
    }
    // And the control: one hundredth above the gate and the climb happens, so
    // the sweep above is measuring the gate rather than a dead code path.
    const control = cruise(
      createController({ knobs: { maxLive: MAX_LIVE_MIN }, stopId: "pluto" }),
      200,
      TIGHTEN_MARGIN_ABOVE + 0.01,
    );
    expect(control.knobs.maxLive).toBe(stopBand("pluto").ceiling);
  });

  it("UR-84: a belt's mid-belt budget is per BELT and endStage resets it", () => {
    // Carrying it would make the second belt of a route adapt more slowly than
    // the first for no reason anyone could state.
    const flown = cruise(createController({ knobs: { maxLive: MAX_LIVE_MIN } }), 40);
    expect(flown.stageMidMoves).toBeGreaterThan(0);
    const next = endStage(flown);
    expect(next.stageMidMoves).toBe(0);
    expect(next.stageMidMoveAt).toBe(0);
    expect(next.lastMidDecision).toBeNull();
    // `lastDecision` is the BOUNDARY's, and the two fields stay distinct.
    expect(next.lastDecision).not.toBeNull();
  });

  it("UR-84: it is total - a belt that spawns nothing moves nothing", () => {
    const empty = createController({ knobs: { maxLive: MAX_LIVE_MIN } });
    expect(decideMidStage(empty).action).toBe("hold");
    expect(decideMidStage(empty).holdReason).toBe("no-spawns");
    // And a caller that reports no margin still cannot tighten (UR-51's
    // fail-safe), however many clean rocks it reports.
    let s = empty;
    for (let i = 0; i < 60; i += 1) s = recordOutcome(s, "blasted");
    expect(s.knobs.maxLive).toBe(MAX_LIVE_MIN);
    expect(decideMidStage(s).holdReason).toBe("no-margin");
  });
});
