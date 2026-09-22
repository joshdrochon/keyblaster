import { describe, expect, it } from "vitest";
import {
  CONCURRENCY_TARGET_MAX,
  CONCURRENCY_TARGET_MIN,
  DEFAULT_KNOBS,
  KNOB_NAMES,
  LENGTH_BIAS_MAX,
  LENGTH_BIAS_MIN,
  LOOSEN_BELOW,
  LOOSEN_MARGIN_BELOW,
  MARGIN_QUANTILE,
  MARGIN_WINDOW_SIZE,
  MAX_LIVE_MAX,
  MAX_LIVE_MIN,
  TIGHTEN_ABOVE,
  TIGHTEN_FLOOR,
  TIGHTEN_MARGIN_ABOVE,
  WINDOW_SIZE,
  applyChange,
  asLengthBias,
  budgetLiveOf,
  clampKnobs,
  clearanceMargin,
  concurrencyTarget,
  createController,
  createMarginWindow,
  createWindow,
  decideStage,
  endStage,
  hitRate,
  knobsDiffCount,
  loosenStep,
  marginFloor,
  marginFloorOf,
  mayTighten,
  pushMargin,
  pushOutcome,
  recordOutcome,
  stageHitRate,
  tightenStep,
  windowHits,
  windowRate,
} from "@engine/controller/index.js";
import type {
  ControllerState,
  Knobs,
  LengthBias,
  SpawnOutcome,
} from "@engine/controller/index.js";
import { mulberry32 } from "./rng.js";
import { hullForStage } from "@engine/hull/index.js";
import { DEFAULT_FLIGHT_CONFIG } from "@game/flight/stage.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The margin a blast in these tests is assumed to have cleared with (UR-51).
 *
 * Not a round number picked to pass: it is the measured lower quartile of a
 * fast pilot's own margins over a whole route (0.532, and a mean of 0.62 - see
 * `@engine/controller/margin`). A test that says "twenty clean blasts" means a
 * player who is comfortable, and this is what comfortable measures.
 */
const COMFORTABLE = 0.6;

/**
 * Feed a controller `hits` blasted then `misses` missed.
 *
 * `margin` is the clearance every BLAST is reported with; a miss is a margin of
 * zero by definition, because a rock that breached spent its whole budget. The
 * controller refuses to tighten without margin evidence (UR-51), so a helper
 * that omitted it would make every tighten assertion in this file vacuous.
 */
function play(
  state: ControllerState,
  hits: number,
  misses: number,
  margin: number = COMFORTABLE,
): ControllerState {
  let s = state;
  for (let i = 0; i < hits; i++) s = recordOutcome(s, "blasted", margin);
  for (let i = 0; i < misses; i++) s = recordOutcome(s, "missed", 0);
  // UR-84 / C21: `recordOutcome` now ALSO adapts inside the belt, so "twenty
  // clean blasts" moves the knob two settings before this helper returns. Every
  // assertion in this file is about the STAGE BOUNDARY - what `decideStage` and
  // `endStage` do with the evidence they were handed - so the knob is put back
  // where the caller set it and the within-belt arm is measured on its own, in
  // `tests/unit/controller/midStage.test.ts`. Restoring the knob here is not a
  // weakened assertion: it is the difference between the two events, and
  // `play` would otherwise be asserting both at once and attributing neither.
  //
  // WATCHED FAILING, with the real numbers: return `s` unchanged and this file
  // reads `tightens above 0.90: expected { knob: 'maxLive', from: 4, to: 5 } to
  // deeply equal { knob: 'maxLive', from: 2, to: 3 }` - the knob already two
  // steps up the band before the boundary was ever asked.
  return {
    ...s,
    knobs: state.knobs,
    stageMidMoveAt: 0,
    stageMidMoves: 0,
    lastMidDecision: null,
  };
}

const knobs = (maxLive: number, lengthBias: LengthBias): Knobs => ({
  maxLive,
  lengthBias,
});

// ---------------------------------------------------------------------------
// Documented constants
// ---------------------------------------------------------------------------

describe("constants match the spec literals", () => {
  it("uses the D53 / FR-10 thresholds and window size", () => {
    expect(WINDOW_SIZE).toBe(20);
    expect(TIGHTEN_ABOVE).toBe(0.9);
    expect(LOOSEN_BELOW).toBe(0.8);
    expect(TIGHTEN_FLOOR).toBe(0.85);
  });

  it("uses the FR-10 knob ranges", () => {
    expect([MAX_LIVE_MIN, MAX_LIVE_MAX]).toEqual([2, 7]);
    expect([LENGTH_BIAS_MIN, LENGTH_BIAS_MAX]).toEqual([-1, 1]);
  });

  it("starts at the gentlest asteroid count (D18 cold start)", () => {
    expect(DEFAULT_KNOBS).toEqual({ maxLive: 2, lengthBias: 0 });
  });
});

// ---------------------------------------------------------------------------
// Rolling window
// ---------------------------------------------------------------------------

describe("rolling hit-rate window (D53)", () => {
  it("is empty and rateless before any outcome", () => {
    const w = createWindow();
    expect(w.outcomes).toEqual([]);
    expect(windowRate(w)).toBeNull();
    expect(windowHits(w)).toBe(0);
  });

  it("fills correctly before 20 outcomes: rate is over the partial window", () => {
    let w = createWindow();
    const seen: number[] = [];
    // 3 blasted, then 1 missed, then 1 blasted -> 1.0, 1.0, 1.0, 0.75, 0.8
    for (const o of ["blasted", "blasted", "blasted", "missed", "blasted"] as const) {
      w = pushOutcome(w, o);
      seen.push(windowRate(w) ?? -1);
    }
    expect(w.outcomes).toHaveLength(5);
    expect(seen).toEqual([1, 1, 1, 0.75, 0.8]);
  });

  it("caps at 20 and evicts oldest first", () => {
    let w = createWindow();
    for (let i = 0; i < WINDOW_SIZE; i++) w = pushOutcome(w, "missed");
    expect(w.outcomes).toHaveLength(WINDOW_SIZE);
    expect(windowRate(w)).toBe(0);

    for (let i = 0; i < WINDOW_SIZE; i++) w = pushOutcome(w, "blasted");
    expect(w.outcomes).toHaveLength(WINDOW_SIZE);
    expect(windowRate(w)).toBe(1);
    expect(windowHits(w)).toBe(WINDOW_SIZE);
  });

  it("truncates an over-long restored window to the last 20", () => {
    const seed: SpawnOutcome[] = Array.from({ length: 50 }, (_, i) =>
      i < 30 ? "missed" : "blasted",
    );
    const w = createWindow(seed);
    expect(w.outcomes).toHaveLength(WINDOW_SIZE);
    expect(windowRate(w)).toBe(1);
  });

  it("is rolling, not per-stage: it survives a stage boundary (D53)", () => {
    let s = play(createController(), 12, 0);
    s = endStage(s);
    expect(s.stageSpawned).toBe(0);
    // The window still remembers the 12 blasts from the previous stage.
    expect(s.window.outcomes).toHaveLength(12);
    expect(hitRate(s)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Knob stepping
// ---------------------------------------------------------------------------

describe("knob stepping order (D53, architecture 4.3)", () => {
  it("tightens maxLive first, lengthBias only at the maxLive cap", () => {
    expect(tightenStep(knobs(2, 0))).toEqual({ knob: "maxLive", from: 2, to: 3 });
    expect(tightenStep(knobs(6, -1))).toEqual({ knob: "maxLive", from: 6, to: 7 });
    expect(tightenStep(knobs(7, -1))).toEqual({ knob: "lengthBias", from: -1, to: 0 });
    expect(tightenStep(knobs(7, 0))).toEqual({ knob: "lengthBias", from: 0, to: 1 });
  });

  it("loosens lengthBias first, maxLive only at the lengthBias floor", () => {
    expect(loosenStep(knobs(5, 1))).toEqual({ knob: "lengthBias", from: 1, to: 0 });
    expect(loosenStep(knobs(5, 0))).toEqual({ knob: "lengthBias", from: 0, to: -1 });
    expect(loosenStep(knobs(5, -1))).toEqual({ knob: "maxLive", from: 5, to: 4 });
    expect(loosenStep(knobs(3, -1))).toEqual({ knob: "maxLive", from: 3, to: 2 });
  });

  it("returns null at the hard ceiling and hard floor (bounds clamp)", () => {
    expect(tightenStep(knobs(MAX_LIVE_MAX, LENGTH_BIAS_MAX))).toBeNull();
    expect(loosenStep(knobs(MAX_LIVE_MIN, LENGTH_BIAS_MIN))).toBeNull();
  });

  it("applyChange moves exactly the named knob, and null is a no-op", () => {
    expect(applyChange(knobs(4, 0), null)).toEqual(knobs(4, 0));
    expect(applyChange(knobs(4, 0), { knob: "maxLive", from: 4, to: 5 })).toEqual(knobs(5, 0));
    expect(applyChange(knobs(4, 0), { knob: "lengthBias", from: 0, to: -1 })).toEqual(knobs(4, -1));
  });

  it("applyChange re-clamps an out-of-range target", () => {
    expect(applyChange(knobs(7, 0), { knob: "maxLive", from: 7, to: 99 })).toEqual(knobs(7, 0));
    expect(applyChange(knobs(2, 0), { knob: "maxLive", from: 2, to: -5 })).toEqual(knobs(2, 0));
    expect(applyChange(knobs(4, 1), { knob: "lengthBias", from: 1, to: 9 })).toEqual(knobs(4, 1));
  });

  it("clampKnobs repairs values restored from an older schema", () => {
    expect(clampKnobs({ maxLive: 99, lengthBias: 5 as LengthBias })).toEqual(knobs(7, 1));
    expect(clampKnobs({ maxLive: 0, lengthBias: -9 as LengthBias })).toEqual(knobs(2, -1));
    expect(clampKnobs({ maxLive: 4.4, lengthBias: 0 })).toEqual(knobs(4, 0));
    expect(clampKnobs({ maxLive: Number.NaN, lengthBias: 0 })).toEqual(knobs(2, 0));
  });

  it("asLengthBias narrows onto -1 / 0 / +1", () => {
    expect(asLengthBias(-4)).toBe(-1);
    expect(asLengthBias(-1)).toBe(-1);
    expect(asLengthBias(0)).toBe(0);
    expect(asLengthBias(0.4)).toBe(0);
    expect(asLengthBias(1)).toBe(1);
    expect(asLengthBias(4)).toBe(1);
    expect(asLengthBias(Number.POSITIVE_INFINITY)).toBe(-1);
  });

  it("knobsDiffCount counts changed fields", () => {
    expect(knobsDiffCount(knobs(4, 0), knobs(4, 0))).toBe(0);
    expect(knobsDiffCount(knobs(4, 0), knobs(5, 0))).toBe(1);
    expect(knobsDiffCount(knobs(4, 0), knobs(4, 1))).toBe(1);
    expect(knobsDiffCount(knobs(4, 0), knobs(5, 1))).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Controller state
// ---------------------------------------------------------------------------

describe("controller state", () => {
  it("starts at the default knobs with an empty window", () => {
    const s = createController();
    expect(s.knobs).toEqual(DEFAULT_KNOBS);
    expect(s.window.outcomes).toEqual([]);
    expect(s.stagesCompleted).toBe(0);
    expect(s.lastDecision).toBeNull();
    expect(hitRate(s)).toBeNull();
    expect(stageHitRate(s)).toBeNull();
  });

  it("accepts and clamps restored knobs and a restored window", () => {
    const s = createController({
      knobs: { maxLive: 42 },
      window: ["blasted", "missed"],
    });
    expect(s.knobs).toEqual(knobs(7, 0));
    expect(hitRate(s)).toBe(0.5);
  });

  it("records blasted and missed into both the window and the stage tally", () => {
    const s = play(createController(), 3, 1);
    expect(s.stageSpawned).toBe(4);
    expect(s.stageBlasted).toBe(3);
    expect(stageHitRate(s)).toBe(0.75);
    expect(hitRate(s)).toBe(0.75);
  });
});

// ---------------------------------------------------------------------------
// The decision rule
// ---------------------------------------------------------------------------

describe("stage decision (D53, architecture 4.3)", () => {
  it("tightens above 0.90", () => {
    const s = play(createController(), 20, 0);
    const d = decideStage(s);
    expect(d.action).toBe("tighten");
    expect(d.change).toEqual({ knob: "maxLive", from: 2, to: 3 });
    expect(endStage(s).knobs).toEqual(knobs(3, 0));
  });

  it("loosens below 0.80", () => {
    const s = play(createController(), 15, 5); // 0.75
    const d = decideStage(s);
    expect(d.action).toBe("loosen");
    expect(d.change).toEqual({ knob: "lengthBias", from: 0, to: -1 });
    expect(endStage(s).knobs).toEqual(knobs(2, -1));
  });

  it("holds inside the 0.80-0.90 band (D17 target zone)", () => {
    // Both edges are exclusive: 0.80 and 0.90 themselves are holds.
    for (const [hits, misses] of [
      [16, 4], // 0.80 exactly
      [17, 3], // 0.85, the D17 centre
      [18, 2], // 0.90 exactly
    ] as const) {
      const s = play(createController(), hits, misses);
      const d = decideStage(s);
      expect(d.action, `rate ${hits / (hits + misses)}`).toBe("hold");
      expect(d.holdReason).toBe("in-band");
      expect(d.change).toBeNull();
      expect(endStage(s).knobs).toEqual(DEFAULT_KNOBS);
    }
  });

  it("holds at the tighten ceiling when both knobs are capped", () => {
    const s = play(
      createController({ knobs: { maxLive: MAX_LIVE_MAX, lengthBias: LENGTH_BIAS_MAX } }),
      20,
      0,
    );
    const d = decideStage(s);
    expect(d.action).toBe("hold");
    expect(d.holdReason).toBe("at-tighten-ceiling");
    expect(endStage(s).knobs).toEqual(knobs(7, 1));
  });

  it("holds at the loosen floor when both knobs are bottomed out", () => {
    const s = play(
      createController({ knobs: { maxLive: MAX_LIVE_MIN, lengthBias: LENGTH_BIAS_MIN } }),
      0,
      20,
    );
    const d = decideStage(s);
    expect(d.action).toBe("hold");
    expect(d.holdReason).toBe("at-loosen-floor");
    expect(endStage(s).knobs).toEqual(knobs(2, -1));
  });

  it("records the decision and advances the stage counter", () => {
    const s = endStage(play(createController(), 20, 0));
    expect(s.stagesCompleted).toBe(1);
    expect(s.lastDecision?.action).toBe("tighten");
    expect(s.lastDecision?.windowRate).toBe(1);
    expect(s.lastDecision?.stageRate).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC-10.1
// ---------------------------------------------------------------------------

describe("AC-10.1 one knob change per stage", () => {
  it("AC-10.1: never two knob changes in one stage", () => {
    // 400 stages of pseudo-random play across the whole knob space. Every
    // boundary must move at most one knob, and the reported change must be the
    // only difference between the before and after knobs.
    const rng = mulberry32(0xc0ffee);
    let s = createController();
    for (let stage = 0; stage < 400; stage++) {
      const spawns = 1 + Math.floor(rng() * 30);
      for (let i = 0; i < spawns; i++) {
        s = recordOutcome(s, rng() < 0.87 ? "blasted" : "missed");
      }
      const before = s.knobs;
      s = endStage(s);
      const diff = knobsDiffCount(before, s.knobs);
      expect(diff).toBeLessThanOrEqual(1);
      const change = s.lastDecision?.change ?? null;
      expect(diff).toBe(change === null ? 0 : 1);
      if (change !== null) {
        expect(before[change.knob]).toBe(change.from);
        expect(s.knobs[change.knob]).toBe(change.to);
      }
    }
  });

  it("AC-10.1: a stage with zero spawns changes nothing", () => {
    // Prime the rolling window at 1.0, then end a stage that spawned nothing.
    // The window alone would say "tighten"; the empty stage vetoes it.
    let s = play(createController(), 20, 0);
    s = endStage(s);
    expect(s.knobs).toEqual(knobs(3, 0));

    const before = s.knobs;
    s = endStage(s);
    expect(s.knobs).toEqual(before);
    expect(s.lastDecision?.action).toBe("hold");
    expect(s.lastDecision?.holdReason).toBe("no-spawns");
    expect(s.lastDecision?.stageRate).toBeNull();
    expect(s.lastDecision?.windowRate).toBe(1);
  });

  it("AC-10.1: a zero-spawn first stage is also a no-op", () => {
    const s = endStage(createController());
    expect(s.knobs).toEqual(DEFAULT_KNOBS);
    expect(s.lastDecision?.holdReason).toBe("no-spawns");
    expect(s.lastDecision?.windowRate).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-10.3 / D18
// ---------------------------------------------------------------------------

describe("AC-10.3 difficulty never increases while hit rate < 0.85 (D18)", () => {
  it("AC-10.3: the guard blocks a tighten the lagging window would have allowed", () => {
    // 18 blasts banked, then a short 2-spawn stage at 0.50.
    // Window = 19/20 = 0.95 -> trigger says tighten.
    // Stage  = 1/2  = 0.50 -> D18 says the player is not getting better.
    let s = play(createController(), 18, 0);
    s = endStage(s);
    const before = s.knobs;
    s = play(s, 1, 1);
    const d = decideStage(s);
    expect(d.windowRate).toBeCloseTo(0.95, 10);
    expect(d.stageRate).toBe(0.5);
    expect(d.action).toBe("hold");
    expect(d.holdReason).toBe("d18-guard");
    expect(endStage(s).knobs).toEqual(before);
  });

  it("AC-10.3: the guard allows a tighten once the current stage is back at 0.85", () => {
    let s = play(createController(), 18, 0);
    s = endStage(s);
    s = play(s, 17, 3); // stage 0.85 exactly, window 0.85 -> in band, so hold
    expect(decideStage(s).action).toBe("hold");

    // A long stage at 0.95, with the window agreeing, does tighten.
    let t = play(createController(), 18, 0);
    t = endStage(t);
    t = play(t, 19, 1);
    expect(decideStage(t).windowRate).toBeGreaterThan(0.9);
    expect(decideStage(t).stageRate).toBeGreaterThanOrEqual(TIGHTEN_FLOOR);
    expect(decideStage(t).action).toBe("tighten");
  });

  it("AC-10.3: mayTighten is false below 0.85 on either input, and needs both", () => {
    expect(mayTighten(null, 1)).toBe(false);
    expect(mayTighten(1, null)).toBe(false);
    expect(mayTighten(null, null)).toBe(false);
    expect(mayTighten(0.84, 1)).toBe(false);
    expect(mayTighten(1, 0.84)).toBe(false);
    expect(mayTighten(0.85, 0.85)).toBe(true);
    expect(mayTighten(1, 1)).toBe(true);
  });

  it("AC-10.3: over 2000 randomised stage boundaries, no tighten ever fires below 0.85", () => {
    const rng = mulberry32(0x18d18);
    let s = createController();
    for (let stage = 0; stage < 2000; stage++) {
      // Deliberately lumpy: short stages let the window and the stage disagree.
      const spawns = 1 + Math.floor(rng() * 6);
      const skill = 0.4 + rng() * 0.6;
      for (let i = 0; i < spawns; i++) {
        s = recordOutcome(s, rng() < skill ? "blasted" : "missed");
      }
      const before = s.knobs;
      const rolling = hitRate(s) ?? 0;
      const stageRate = stageHitRate(s) ?? 0;
      s = endStage(s);
      const tightened =
        s.knobs.maxLive > before.maxLive || s.knobs.lengthBias > before.lengthBias;
      if (tightened) {
        expect(rolling).toBeGreaterThanOrEqual(TIGHTEN_FLOOR);
        expect(stageRate).toBeGreaterThanOrEqual(TIGHTEN_FLOOR);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// AC-10.4
// ---------------------------------------------------------------------------

describe("AC-10.4 scroll speed is constant per stage and not a knob", () => {
  it("AC-10.4: the knob set is exactly maxLive and lengthBias", () => {
    expect([...KNOB_NAMES]).toEqual(["maxLive", "lengthBias"]);
    const s = createController();
    expect(Object.keys(s.knobs).sort()).toEqual(["lengthBias", "maxLive"]);
  });

  it("AC-10.4: no scroll-speed field exists anywhere in controller state", () => {
    // Structural, not nominal: walk the whole serialisable state and fail on
    // any key that looks like a world-motion control. If someone ever adds one,
    // this test names the AC that forbids it.
    const banned = /scroll|speed|velocity|parallax|tempo/i;
    const seen: string[] = [];
    const walk = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      if (Array.isArray(value)) {
        for (const v of value) walk(v);
        return;
      }
      for (const [k, v] of Object.entries(value)) {
        seen.push(k);
        walk(v);
      }
    };
    let s = play(createController(), 18, 2);
    s = endStage(s);
    walk(s);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((k) => banned.test(k))).toEqual([]);
  });

  it("AC-10.4: no decision can ever produce a change outside the knob set", () => {
    const rng = mulberry32(0x5c0);
    let s = createController();
    for (let stage = 0; stage < 300; stage++) {
      const spawns = 1 + Math.floor(rng() * 25);
      for (let i = 0; i < spawns; i++) {
        s = recordOutcome(s, rng() < 0.9 ? "blasted" : "missed");
      }
      s = endStage(s);
      const change = s.lastDecision?.change ?? null;
      if (change !== null) expect(KNOB_NAMES).toContain(change.knob);
    }
  });
});

// ---------------------------------------------------------------------------
// Bounds under sustained pressure
// ---------------------------------------------------------------------------

describe("knob bounds clamp under sustained pressure", () => {
  it("a perfect player stops at maxLive 7 / lengthBias +1 and goes no further", () => {
    let s = createController();
    for (let stage = 0; stage < 40; stage++) {
      s = play(s, 20, 0);
      s = endStage(s);
      expect(s.knobs.maxLive).toBeLessThanOrEqual(MAX_LIVE_MAX);
      expect(s.knobs.lengthBias).toBeLessThanOrEqual(LENGTH_BIAS_MAX);
    }
    expect(s.knobs).toEqual(knobs(MAX_LIVE_MAX, LENGTH_BIAS_MAX));
    expect(s.lastDecision?.holdReason).toBe("at-tighten-ceiling");
  });

  it("a failing player stops at maxLive 2 / lengthBias -1 and goes no further", () => {
    let s = createController({ knobs: { maxLive: 7, lengthBias: 1 } });
    for (let stage = 0; stage < 40; stage++) {
      s = play(s, 0, 20);
      s = endStage(s);
      expect(s.knobs.maxLive).toBeGreaterThanOrEqual(MAX_LIVE_MIN);
      expect(s.knobs.lengthBias).toBeGreaterThanOrEqual(LENGTH_BIAS_MIN);
    }
    // C23: THE KNOB BOTTOMS OUT AND THE BUDGET DOES NOT COME DOWN WITH IT.
    // This pilot opened at `MAX_LIVE_MAX` and was loosened all the way to the
    // floor, so every rock they are now handed is budgeted for the 7-deep board
    // they used to fly while the board itself is 2 deep. That is the whole of
    // D31's inversion fix stated as a value: before it, each of those loosens
    // took MORE fall time off the child than it gave back in queue.
    expect(s.knobs).toEqual({ ...knobs(MAX_LIVE_MIN, LENGTH_BIAS_MIN), budgetLive: MAX_LIVE_MAX });
    expect(budgetLiveOf(s.knobs)).toBe(MAX_LIVE_MAX);
    expect(s.lastDecision?.holdReason).toBe("at-loosen-floor");
  });

  it("tighten and loosen paths are asymmetric, so lengthBias settles at its floor", () => {
    // From the default, one loosen drops lengthBias to -1; a later tighten
    // spends itself on maxLive, never on lengthBias, until maxLive is capped.
    let s = endStage(play(createController(), 0, 20));
    expect(s.knobs).toEqual(knobs(2, -1));
    for (let i = 0; i < 5; i++) s = endStage(play(s, 20, 0));
    expect(s.knobs).toEqual(knobs(7, -1));
  });
});

/**
 * UR-42 / UR-51: WHAT `maxLive` BUYS.
 *
 * The knob moved and nothing on the board did. `belt-survivability.json`
 * recorded `peakLive: 2` at maxLive 7 exactly as at maxLive 2, and the
 * time-weighted occupancy of the board read 1.00-1.04 rocks at both ends of the
 * range - so the primary difficulty knob had two indistinguishable extremes.
 * `concurrencyTarget` is the number that makes it mean something, and these are
 * the properties the rest of the engine leans on.
 */
describe("UR-51 / FR-10: concurrencyTarget turns the primary knob into a board depth", () => {
  it("UR-51: the FLOOR is exactly 1, so the gentlest belt is the shipped belt", () => {
    // THE HARD CONSTRAINT, AS ARITHMETIC. Every other part of this change -
    // the fall budget in @engine/fallTime, the standing queue in @engine/pacing
    // - multiplies by this number or by (this number - 1). Exactly 1 here is
    // what makes a struggling child's belt byte-identical to the one measured
    // at 3 stalls in 240 route-belts, rather than something a simulation has to
    // vouch for afterwards.
    //
    // WATCHED FAILING, with the real numbers: set CONCURRENCY_TARGET_MIN to 1.5
    // and this reads 1.5, and the grade-2 child at the knob's floor stops
    // flying the belt that was measured. Occupancy 1.021 -> 1.344 rocks, hit
    // rate 0.9099 -> 0.9435, belt 250.27 s -> 249.02 s, route stalls 3/240 ->
    // 0/240 over 40 seeds.
    //
    // NOTE THE DIRECTION, because it is the trap. Breaking the floor made the
    // grade-2 child's belt EASIER, not harder - a deeper board comes with a
    // deeper fall budget. So "the child still survives" is not evidence the
    // floor is intact; only the floor itself is. That is why this is asserted
    // on the constant rather than inferred from a stall rate.
    expect(concurrencyTarget(MAX_LIVE_MIN)).toBe(1);
    expect(CONCURRENCY_TARGET_MIN).toBe(1);
  });

  it("UR-51: the CEILING is 4, which is the depth UR-51 settles on", () => {
    // UR-84 swept it downward and put it back - see `CONCURRENCY_TARGET_MAX`
    // for the whole curve and for why the wrong QUANTITY (the knob's target
    // depth rather than the board's actual one) was the defect rather than
    // this value.
    expect(concurrencyTarget(MAX_LIVE_MAX)).toBe(4);
    expect(CONCURRENCY_TARGET_MAX).toBe(4);
  });

  it("UR-51: it is monotone across FR-10's whole range, with no step larger than one rock", () => {
    // A jump of a whole rock at one boundary would make one stage end in six a
    // cliff and the rest of them nothing, which is the ramp being invisible by
    // another route.
    let previous = concurrencyTarget(MAX_LIVE_MIN);
    for (let live = MAX_LIVE_MIN + 1; live <= MAX_LIVE_MAX; live += 1) {
      const here = concurrencyTarget(live);
      expect(here, `maxLive ${live}`).toBeGreaterThan(previous);
      expect(here - previous, `maxLive ${live}`).toBeLessThan(1);
      previous = here;
    }
  });

  it("UR-51: a corrupt or out-of-range knob reads as the floor, never as NaN", () => {
    // clampKnobs' rule, restated where it is consumed: a restored profile must
    // never be able to stop a child's game. NaN here would propagate into the
    // fall budget and every rock would fall for NaN ms.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) {
      expect(concurrencyTarget(bad), String(bad)).toBe(1);
    }
    // Above the cap it saturates rather than extrapolating.
    expect(concurrencyTarget(MAX_LIVE_MAX + 5)).toBe(CONCURRENCY_TARGET_MAX);
  });
});

// ---------------------------------------------------------------------------
// UR-51: the throttle
// ---------------------------------------------------------------------------

/**
 * UR-51: THE SIGNAL THE CONTROLLER CLIMBS ON HAS TO HAVE RANGE.
 *
 * The defect these tests exist for: `TIGHTEN_ABOVE` is 0.90 and AC-10.3's guard
 * is 0.85, and measured over a whole route a fast pilot's hit rate is 1.0000
 * while a grade-2 pilot's is 0.9521. Both clear both bars, so both tightened on
 * the same cadence and both arrived at `MAX_LIVE_MAX`. The margin window is
 * what separates them - 0.532 against 0.171 on the same route - and these are
 * the properties the rest of the engine leans on.
 */
describe("UR-51 / margin: the throttle, and the floor that is not one", () => {
  it("UR-51: clearanceMargin is the unspent fraction of the fall budget", () => {
    // 4000 ms granted, gone at 1000 ms in: three quarters of it unused.
    expect(clearanceMargin({ spawnedAtMs: 0, leftAtMs: 1000, fallMs: 4000 })).toBe(0.75);
    // Blasted on the instant it appeared.
    expect(clearanceMargin({ spawnedAtMs: 500, leftAtMs: 500, fallMs: 4000 })).toBe(1);
    // Reached the breach line: a miss is a margin of zero, not a missing sample.
    expect(clearanceMargin({ spawnedAtMs: 0, leftAtMs: 4000, fallMs: 4000 })).toBe(0);
    // Past it, which the scene can produce by a frame: clamped, never negative.
    expect(clearanceMargin({ spawnedAtMs: 0, leftAtMs: 9000, fallMs: 4000 })).toBe(0);
  });

  it("UR-51: a corrupt clearance reads as no margin, never as NaN", () => {
    // Same rule as clampKnobs: a corrupt value must only ever move a child's
    // belt in the gentler direction, and here that direction is zero.
    for (const bad of [
      { spawnedAtMs: 0, leftAtMs: 1000, fallMs: 0 },
      { spawnedAtMs: 0, leftAtMs: 1000, fallMs: -5 },
      { spawnedAtMs: 0, leftAtMs: 1000, fallMs: Number.NaN },
      { spawnedAtMs: Number.NaN, leftAtMs: 1000, fallMs: 4000 },
      { spawnedAtMs: 0, leftAtMs: Number.NaN, fallMs: 4000 },
      { spawnedAtMs: Number.NEGATIVE_INFINITY, leftAtMs: Number.POSITIVE_INFINITY, fallMs: 4000 },
    ]) {
      expect(clearanceMargin(bad), JSON.stringify(bad)).toBe(0);
    }
    expect(clearanceMargin({ spawnedAtMs: 0, leftAtMs: 0, fallMs: Number.POSITIVE_INFINITY })).toBe(0);
  });

  it("UR-51: the window rolls at 20 and reads the lower quartile", () => {
    expect(MARGIN_WINDOW_SIZE).toBe(WINDOW_SIZE);
    expect(MARGIN_QUANTILE).toBe(0.25);
    expect(marginFloor(createMarginWindow())).toBeNull();

    // A window of one reads that one.
    expect(marginFloor(pushMargin(createMarginWindow(), 0.4))).toBe(0.4);

    // Five values: the quartile sits exactly on the second-smallest.
    let w = createMarginWindow();
    for (const m of [0.9, 0.1, 0.5, 0.3, 0.7]) w = pushMargin(w, m);
    expect(marginFloor(w)).toBeCloseTo(0.3, 10);

    // It is the LOWER quartile and not a mean, which is the whole reason it is
    // safe to tighten on: one comfortable rock cannot carry three tight ones.
    let mixed = createMarginWindow();
    for (const m of [0.0, 0.0, 0.0, 0.9]) mixed = pushMargin(mixed, m);
    expect(marginFloor(mixed)).toBe(0);

    // Rolling, oldest evicted first, and a restored over-long list truncated.
    let full = createMarginWindow();
    for (let i = 0; i < MARGIN_WINDOW_SIZE + 5; i += 1) full = pushMargin(full, 1);
    expect(full).toHaveLength(MARGIN_WINDOW_SIZE);
    expect(createMarginWindow(new Array(50).fill(0.5) as number[])).toHaveLength(
      MARGIN_WINDOW_SIZE,
    );
    // Non-finite values are refused rather than stored, on both routes in.
    expect(pushMargin(createMarginWindow(), Number.NaN)).toHaveLength(0);
    expect(createMarginWindow([0.5, Number.NaN, 0.5])).toHaveLength(2);
    // And a value outside [0,1] is clamped rather than trusted.
    expect(marginFloor(pushMargin(createMarginWindow(), 9))).toBe(1);
    expect(marginFloor(pushMargin(createMarginWindow(), -9))).toBe(0);
  });

  it("UR-51: the margin window is rolling, not per-stage, exactly like the hit window", () => {
    // A boundary that wiped it would hand every stage a "no-margin" hold on its
    // first decision, making the throttle a function of stage length.
    const s = endStage(play(createController(), 20, 0));
    expect(s.margins).toHaveLength(MARGIN_WINDOW_SIZE);
    expect(marginFloorOf(s)).toBe(COMFORTABLE);
  });

  it("UR-51 / D18: with no margin evidence at all, nothing tightens - the fail-safe", () => {
    // THE LIVENESS PROPERTY. `recordOutcome`'s third argument is optional in
    // the type because the engine cannot import the scene that supplies it, so
    // the question "what happens when nobody supplies it" has to have an
    // answer, and the answer has to be the safe one.
    //
    // WATCHED FAILING, with the real text: default the missing margin to 1
    // instead of holding, and this reads action "tighten" / holdReason null -
    // which is the saturated controller UR-51 replaced, silently restored by a
    // deleted call site.
    let s = createController();
    for (let i = 0; i < 20; i += 1) s = recordOutcome(s, "blasted");
    const d = decideStage(s);
    expect(d.windowRate).toBe(1);
    expect(d.marginFloor).toBeNull();
    expect(d.action).toBe("hold");
    expect(d.holdReason).toBe("no-margin");
    expect(endStage(s).knobs).toEqual(DEFAULT_KNOBS);
  });

  it("UR-51: a player clearing every rock at the last instant does not tighten", () => {
    // The case hit rate cannot see and the whole reason the throttle exists: a
    // perfect 1.0 with every rock taken just above the breach line.
    const s = play(createController(), 20, 0, 0.05);
    const d = decideStage(s);
    expect(d.windowRate).toBe(1);
    expect(d.stageRate).toBe(1);
    expect(d.marginFloor).toBeCloseTo(0.05, 10);
    // Below LOOSEN_MARGIN_BELOW, so it does not merely hold - it gives time back.
    expect(d.action).toBe("loosen");
  });

  it("UR-51: between the two thresholds it holds, and the hold is labelled", () => {
    const s = play(createController(), 20, 0, 0.25);
    const d = decideStage(s);
    expect(d.action).toBe("hold");
    expect(d.holdReason).toBe("margin-tight");
    expect(d.marginFloor).toBeCloseTo(0.25, 10);
    // Exactly at the gate is a hold too: the trigger is strictly above, the
    // same way TIGHTEN_ABOVE is.
    expect(decideStage(play(createController(), 20, 0, TIGHTEN_MARGIN_ABOVE)).action).toBe("hold");
    expect(decideStage(play(createController(), 20, 0, TIGHTEN_MARGIN_ABOVE + 0.01)).action).toBe(
      "tighten",
    );
  });

  it("UR-51: the margin can only ever make the belt SAFER than FR-10's own rules", () => {
    // The property that keeps D17's band and D18's direction intact: there is
    // no margin at all that produces a tighten the hit-rate rules would have
    // refused. Swept over the whole cross product rather than argued.
    const rng = mulberry32(0x5eed51);
    let checked = 0;
    for (let trial = 0; trial < 3000; trial += 1) {
      const hits = Math.floor(rng() * 21);
      const margin = rng();
      const s = play(
        createController({ knobs: { maxLive: 2 + Math.floor(rng() * 6) } }),
        hits,
        20 - hits,
        margin,
      );
      const d = decideStage(s);
      if (d.action === "tighten") {
        expect(d.windowRate!, `margin ${margin}`).toBeGreaterThan(TIGHTEN_ABOVE);
        expect(mayTighten(d.windowRate, d.stageRate)).toBe(true);
      }
      checked += 1;
    }
    expect(checked).toBe(3000);
  });

  it("UR-51 / D31: a stall RATCHETS THE KNOB BACK, where FR-10's rules alone only held", () => {
    /**
     * `beginStall` ends the stage precisely so a belt a child could not finish
     * hands the next one back easier. Under FR-10's rules alone that only
     * worked when the rolling rate had already fallen under 0.80, and a stall
     * does not guarantee it: the window is the last 20 outcomes, the hull is
     * `hullForStage(58)` = 6 marks taken anywhere across 58 words (C26), and a belt
     * that took its marks EARLY leaves a window of nothing but blasts. The
     * decision there is `d18-guard` - a hold - so the child who just lost the
     * hull is handed the same belt back. Proven by the control below.
     *
     * The knob carries `keystrokeHeadroom` as well as the board depth
     * (`@engine/fallTime`), so a hold is not a neutral outcome any more: it
     * leaves the shortened fall budget in place too.
     *
     * WATCHED FAILING, with the real text: delete the `marginSaysLoosen` arm
     * from `decideStage` and the first block reads action "hold" / holdReason
     * "d18-guard", identical to the control, with the knob still on maxLive 6.
     */
    const MARKS = hullForStage(DEFAULT_FLIGHT_CONFIG.stageWordCount);
    expect(MARKS).toBe(6);

    /** A belt that took every hull mark early, then flew 20 clean words. */
    const stalledBelt = (blastMargin: number): ControllerState => {
      const opened = createController({ knobs: { maxLive: 6, lengthBias: 0 } });
      let s = opened;
      for (let i = 0; i < MARKS; i += 1) s = recordOutcome(s, "missed", 0);
      for (let i = 0; i < WINDOW_SIZE; i += 1) s = recordOutcome(s, "blasted", blastMargin);
      // UR-84 / C21, AND THIS IS THE TEST WHERE THE WITHIN-BELT ARM SHOWS ITS
      // VALUE MOST PLAINLY. Six hull marks at margin 0 now loosen the belt
      // WHILE it is being lost, so by the time this helper returns the knob is
      // already down - `expected { maxLive: 2, lengthBias: -1 } to deeply equal
      // { maxLive: 6, lengthBias: 0 }` is what the boundary assertion below
      // reads without this line. That relief is strictly new and strictly in
      // the child's favour; it is asserted where it belongs, in
      // `tests/unit/controller/midStage.test.ts`. Here the knob is put back so
      // that what is measured is the STAGE BOUNDARY's own decision, which is
      // D31's claim and is unchanged.
      return {
        ...s,
        knobs: opened.knobs,
        stageMidMoveAt: 0,
        stageMidMoves: 0,
        lastMidDecision: null,
      };
    };

    // THE CONTROL FIRST. A pilot whose rocks were comfortable: the window is
    // 1.0, the stage rate is `WINDOW_SIZE / (WINDOW_SIZE + MARKS)` - 20/26 =
    // 0.77 at the six-mark hull C26 shipped, 20/29 = 0.69 at the nine it
    // replaced - D18 refuses the tighten, and that is the whole decision.
    // Nothing moves. Written as the relation rather than as the fraction,
    // because the fraction is a function of the hull size and moved with it.
    const comfortable = stalledBelt(COMFORTABLE);
    const control = decideStage(comfortable);
    expect(control.windowRate).toBe(1);
    expect(control.stageRate).toBeCloseTo(WINDOW_SIZE / (WINDOW_SIZE + MARKS), 10);
    expect(control.action).toBe("hold");
    expect(control.holdReason).toBe("d18-guard");
    expect(endStage(comfortable).knobs).toEqual(knobs(6, 0));

    // THE SAME BELT, flown by the pilot the route simulation actually stalls:
    // a grade-2 child, whose measured lower-quartile margin at Jupiter is
    // 0.101 (gauntlet/evidence/difficulty-ramp.json). Same hit rate, same
    // stage rate, same hull - and now the knob comes back.
    const struggling = stalledBelt(0.101);
    const d = decideStage(struggling);
    expect(d.windowRate).toBe(control.windowRate);
    expect(d.stageRate).toBe(control.stageRate);
    expect(d.marginFloor).toBeCloseTo(0.101, 10);
    expect(d.marginFloor!).toBeLessThan(LOOSEN_MARGIN_BELOW);
    expect(d.action).toBe("loosen");

    const after = endStage(struggling).knobs;
    expect(knobsDiffCount(knobs(6, 0), after)).toBe(1); // AC-10.1 on the stall path
    expect(after.lengthBias).toBe(LENGTH_BIAS_MIN); // cheapest relief first (D53)

    // A second stalled belt spends the knob that owns BOTH the board depth and
    // the keystroke headroom, so the fall budget comes back too.
    const secondBeltOpened = endStage(struggling);
    let t = secondBeltOpened;
    for (let i = 0; i < MARKS; i += 1) t = recordOutcome(t, "missed", 0);
    for (let i = 0; i < WINDOW_SIZE; i += 1) t = recordOutcome(t, "blasted", 0.101);
    // UR-84: the relief on this second belt now arrives DURING it. Nine hull
    // marks at margin 0 are four times `MIDSTAGE_LOOSEN_SAMPLE`, so the knob is
    // already walking back before the belt ends - which is exactly what D31
    // wants and is strictly earlier than the boundary could deliver it.
    expect(t.stageMidMoves, "mid-belt relief on a belt being lost").toBeGreaterThan(0);
    expect(t.lastMidDecision?.action).toBe("loosen");
    expect(t.knobs.maxLive, "knob after the mid-belt arm").toBeLessThan(
      secondBeltOpened.knobs.maxLive,
    );
    // And the stage boundary still never tightens a belt that went this badly.
    expect(decideStage(t).action).not.toBe("tighten");
    expect(endStage(t).knobs.maxLive).toBeLessThanOrEqual(5);
  });

  it("UR-51: two pilots with the SAME hit rate and different margins diverge", () => {
    /**
     * THE ASSERTION THAT MUST GO RED IF THE SIGNAL SATURATES AGAIN.
     *
     * Both players blast every rock - hit rate 1.0000 for both, which is the
     * measured reality for the fast and the median pilot and within four
     * hundredths of the grade-2 one. The ONLY thing that differs is how much of
     * the fall budget they had left, and that is the measured 0.532 against
     * 0.171 from the route sweep.
     *
     * WATCHED FAILING, with the real numbers: delete the margin arms from
     * `decideStage` and the second block reads "expected 7 to be 2" - both
     * pilots at `MAX_LIVE_MAX` after six stages, a gap of 0, because a hit rate
     * of 1.0 cannot tell them apart. That is UR-51.
     */
    const route = (margin: number): Knobs => {
      let s = createController();
      for (let stage = 0; stage < 6; stage += 1) s = endStage(play(s, 20, 0, margin));
      return s.knobs;
    };
    const roomy = route(0.532);
    const tight = route(0.171);
    expect(roomy.maxLive, "a pilot with room climbs").toBe(MAX_LIVE_MAX);
    expect(tight.maxLive, "a pilot without it does not").toBe(MAX_LIVE_MIN);
    expect(roomy.maxLive - tight.maxLive).toBe(MAX_LIVE_MAX - MAX_LIVE_MIN);
  });
});

describe("C23: the budget ratchet, and the tighten it has to refuse", () => {
  it("C23: a loosen keeps the budget and gives up only the board", () => {
    // THE DEFECT, AS A VALUE. `maxLive` bought two things with one number -
    // `@engine/pacing.standingDepth` builds the board and
    // `@engine/fallTime.fallBudgetFactor` caps the budget that pays for
    // standing in it - so a loosen removed the queue AND the budget, and the
    // budget is the bigger of the two for any pilot with margin. Measured,
    // median pilot at Neptune, the knob pinned for the belt: maxLive 5 -> 4
    // took fall time from 11585 ms to 9462 ms while the queue only shrank
    // 1607 ms, i.e. 516 ms OFF the child's hands on a move meant to help them.
    let s = createController({ knobs: { maxLive: 6, lengthBias: LENGTH_BIAS_MIN } });
    expect(budgetLiveOf(s.knobs)).toBe(6);
    expect(s.knobs.budgetLive).toBeUndefined(); // absent until it means something
    s = endStage(play(s, 0, 20));
    expect(s.knobs.maxLive, "the board came down").toBe(5);
    expect(budgetLiveOf(s.knobs), "and the budget did not").toBe(6);
    expect(concurrencyTarget(budgetLiveOf(s.knobs))).toBe(concurrencyTarget(6));
  });

  it("C23: and it is bounded by the stop's own ceiling, never above it", () => {
    // Relief may not hand out a budget the stop's busiest legal board would
    // not have paid. Mars tops out at 4 (`stopBand`), so a Mars belt cannot
    // carry Pluto's budget however badly it goes.
    let s = createController({ knobs: { maxLive: 4, lengthBias: LENGTH_BIAS_MIN }, stopId: "mars" });
    for (let i = 0; i < 6; i += 1) s = endStage(play(s, 0, 20));
    expect(s.knobs.maxLive).toBe(s.band.floor);
    expect(budgetLiveOf(s.knobs)).toBeLessThanOrEqual(s.band.ceiling);
  });

  it("C23: a pilot flying on relief cannot tighten - the servo may not eat its own gift", () => {
    // `TIGHTEN_MARGIN_ABOVE` is a servo on margin, and margin is measured
    // against the budget `@engine/fallTime` granted. So without this gate every
    // millisecond of ratcheted budget reads back as evidence the child can take
    // more, and the relief is spent on a tighten.
    //
    // WATCHED FAILING, with the real numbers: drop the "on-relief" arm from
    // `decideStage` and the route sweep moves the median pilot's Uranus knob
    // from 3.16 to 3.68, breaks `AC-10.1 / D20 / C21`'s mid-belt rate limit
    // (7 moves against 6) and costs that pilot a Pluto belt they did not lose
    // before the relief existed.
    let s = createController({ knobs: { maxLive: 5, lengthBias: LENGTH_BIAS_MIN } });
    s = endStage(play(s, 0, 20)); // loosen: 5 -> 4, ratchet holds at 5
    expect(budgetLiveOf(s.knobs)).toBeGreaterThan(s.knobs.maxLive);
    // Now fly a stretch that would otherwise tighten: well above 0.90 on both
    // rates, and a margin quartile well above the gate.
    const comfortable = play(s, 20, 0, 0.9);
    const decision = decideStage(comfortable);
    expect(decision.action).toBe("hold");
    expect(decision.holdReason).toBe("on-relief");
    expect(decision.marginFloor).toBeGreaterThan(TIGHTEN_MARGIN_ABOVE);
    // And the same evidence DOES tighten a pilot who is not on relief, which is
    // what says the gate is the thing refusing rather than the thresholds.
    const notOnRelief = play(
      createController({ knobs: { maxLive: 4, lengthBias: LENGTH_BIAS_MIN } }),
      20,
      0,
      0.9,
    );
    expect(decideStage(notOnRelief).action).toBe("tighten");
  });
});
