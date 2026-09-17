import { describe, expect, it } from "vitest";
import {
  CONCURRENCY_TARGET_MAX,
  CONCURRENCY_TARGET_MIN,
  DEFAULT_KNOBS,
  KNOB_NAMES,
  LENGTH_BIAS_MAX,
  LENGTH_BIAS_MIN,
  LOOSEN_BELOW,
  MAX_LIVE_MAX,
  MAX_LIVE_MIN,
  TIGHTEN_ABOVE,
  TIGHTEN_FLOOR,
  WINDOW_SIZE,
  applyChange,
  asLengthBias,
  clampKnobs,
  concurrencyTarget,
  createController,
  createWindow,
  decideStage,
  endStage,
  hitRate,
  knobsDiffCount,
  loosenStep,
  mayTighten,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Feed a controller `hits` blasted then `misses` missed. */
function play(
  state: ControllerState,
  hits: number,
  misses: number,
): ControllerState {
  let s = state;
  for (let i = 0; i < hits; i++) s = recordOutcome(s, "blasted");
  for (let i = 0; i < misses; i++) s = recordOutcome(s, "missed");
  return s;
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
    expect(s.knobs).toEqual(knobs(MAX_LIVE_MIN, LENGTH_BIAS_MIN));
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
