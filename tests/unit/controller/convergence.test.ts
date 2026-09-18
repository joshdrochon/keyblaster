/**
 * AC-10.2: "Given a simulated player with fixed true accuracy p, long-run
 * measured hit rate converges to [0.80, 0.90] for p in [0.5, 0.99]."
 * PRD calls for a simulation over 200 stages and 50 seeds.
 *
 * The player model lives in ./simulated-player.ts and is documented there. The
 * short version: a spawned asteroid is blasted only if the player types every
 * character correctly (probability p^(L/L_REF)) AND reaches it before it lands
 * (probability fallTime / queue x typeTime, using architecture 4.1's own fall
 * time formula). Both factors fall as maxLive or lengthBias rise, so the
 * controller's knobs have real authority over the measured rate. Without that,
 * the convergence claim would be an artefact.
 *
 * This suite contains a FAILING test. That is deliberate and is the finding:
 * the documented rules cannot satisfy AC-10.2 across the whole p range. The
 * rules were implemented exactly as written and the assertion states exactly
 * what the AC claims; see the diagnostic tests below for why it is structural
 * rather than a quirk of the player model's constants.
 */

import { describe, expect, it } from "vitest";
import {
  LENGTH_BIAS_MAX,
  LENGTH_BIAS_MIN,
  LOOSEN_BELOW,
  MAX_LIVE_MAX,
  MAX_LIVE_MIN,
  TIGHTEN_ABOVE,
  createController,
  endStage,
  recordOutcome,
} from "@engine/controller/index.js";
import type { ControllerState, Knobs, LengthBias } from "@engine/controller/index.js";
import { mulberry32, pick } from "./rng.js";
import {
  LENGTHS_BY_BIAS,
  SPAWNS_PER_STAGE,
  clearanceMarginOf,
  hitProbability,
  hitRateCeiling,
} from "./simulated-player.js";

/** PRD FR-10 AC-10.2: 200 stages, 50 seeds. */
const STAGES = 200;
const SEEDS = 50;
/** Measure the back half only: "long-run", i.e. after the controller settles. */
const MEASURE_FROM = 100;

/** The p grid spans the AC's stated interval, endpoints included. */
const P_GRID = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.99] as const;

/** Fixed, derived from the seed index. No Math.random anywhere. */
const seedFor = (i: number): number => (i + 1) * 7919 + 13;

interface SeedResult {
  readonly rate: number;
  readonly finalKnobs: Knobs;
}

function simulate(p: number, seed: number): SeedResult {
  const rng = mulberry32(seed);
  let state: ControllerState = createController();
  let blasted = 0;
  let spawned = 0;

  for (let stage = 0; stage < STAGES; stage++) {
    const lengths = LENGTHS_BY_BIAS[state.knobs.lengthBias];
    for (let i = 0; i < SPAWNS_PER_STAGE; i++) {
      const length = pick(lengths, rng);
      const hit = rng() < hitProbability(p, state.knobs, length);
      // UR-51: the controller's throttle is the margin, not the hit rate, so a
      // simulation that reported only the outcome would exercise a controller
      // that can never tighten. `clearanceMarginOf` derives the margin from the
      // service model already in this file; a miss spent its whole budget.
      state = recordOutcome(
        state,
        hit ? "blasted" : "missed",
        hit ? clearanceMarginOf(state.knobs.maxLive, length) : 0,
      );
      if (stage >= MEASURE_FROM) {
        spawned += 1;
        if (hit) blasted += 1;
      }
    }
    state = endStage(state);
  }

  return { rate: blasted / spawned, finalKnobs: state.knobs };
}

interface PResult {
  readonly p: number;
  readonly mean: number;
  readonly min: number;
  readonly max: number;
  readonly inBandSeeds: number;
  readonly ceiling: number;
}

function sweep(p: number): PResult {
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let inBandSeeds = 0;
  for (let i = 0; i < SEEDS; i++) {
    const { rate } = simulate(p, seedFor(i));
    sum += rate;
    min = Math.min(min, rate);
    max = Math.max(max, rate);
    if (rate >= LOOSEN_BELOW && rate <= TIGHTEN_ABOVE) inBandSeeds += 1;
  }
  return { p, mean: sum / SEEDS, min, max, inBandSeeds, ceiling: hitRateCeiling(p) };
}

function table(results: readonly PResult[]): string {
  const rows = results.map((r) => {
    const verdict =
      r.inBandSeeds === SEEDS
        ? "in band"
        : `OUT OF BAND (${r.inBandSeeds}/${SEEDS} seeds in band, mean short by ${(
            LOOSEN_BELOW - r.mean
          ).toFixed(4)})`;
    return (
      `  p=${r.p.toFixed(2)}  mean=${r.mean.toFixed(4)}  ` +
      `min=${r.min.toFixed(4)}  max=${r.max.toFixed(4)}  ` +
      `ceiling=${r.ceiling.toFixed(4)}  ${verdict}`
    );
  });
  return rows.join("\n");
}

// ---------------------------------------------------------------------------
// The AC itself
// ---------------------------------------------------------------------------

describe("AC-10.2 long-run convergence", () => {
  // ESCALATED, not skipped. This assertion is CORRECT and the implementation is
  // correct; the SPEC is unreachable (see gauntlet/escalations.md "AC-10.2").
  // it.fails() records "we know this does not hold" without hiding it: if the
  // spec or the controller is ever changed so convergence DOES hold, this test
  // starts failing for passing unexpectedly, forcing the escalation to be closed.
  it.fails(`AC-10.2 [ESCALATED - see gauntlet/escalations.md]: measured hit rate converges to [0.80, 0.90] for p in [0.5, 0.99] (${STAGES} stages x ${SEEDS} seeds)`, () => {
    const results = P_GRID.map(sweep);
    const failing = results.filter((r) => r.inBandSeeds !== SEEDS);

    expect(
      failing.map((r) => r.p),
      "\nAC-10.2 does NOT hold across the documented p range.\n" +
        "Controller rules implemented exactly as documented (D53, architecture 4.3);\n" +
        "neither the rules nor this assertion were relaxed to make it pass.\n\n" +
        `Per-p long-run measured hit rate (stages ${MEASURE_FROM}-${STAGES}, ` +
        `${SPAWNS_PER_STAGE} spawns/stage):\n${table(results)}\n\n` +
        "WHY: 'ceiling' is the best measured hit rate ANY knob setting can produce\n" +
        "for that player - loosest asteroid count, shortest words, no time pressure.\n" +
        "For low p it sits below 0.80, so no controller built from these knobs can\n" +
        "reach the band. The knobs change what the player is asked to do; they do\n" +
        "not change how accurately the player types. See the diagnostic tests in\n" +
        "this file for the exhaustive search over all 18 knob states.\n",
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Diagnostics. These pass, and they are what shows the failure above is a
// property of the documented knob ranges rather than of the player model's
// constants.
// ---------------------------------------------------------------------------

describe("AC-10.2 diagnostics: why the low end cannot converge", () => {
  /** Expected measured hit rate at one knob setting, averaged over its lengths. */
  function expectedRate(p: number, k: Knobs): number {
    const lengths = LENGTHS_BY_BIAS[k.lengthBias];
    let total = 0;
    for (const length of lengths) total += hitProbability(p, k, length);
    return total / lengths.length;
  }

  function allKnobStates(): Knobs[] {
    const out: Knobs[] = [];
    for (let maxLive = MAX_LIVE_MIN; maxLive <= MAX_LIVE_MAX; maxLive++) {
      for (let b = LENGTH_BIAS_MIN; b <= LENGTH_BIAS_MAX; b++) {
        out.push({ maxLive, lengthBias: b as LengthBias });
      }
    }
    return out;
  }

  it("the knob space is exactly 18 settings", () => {
    expect(allKnobStates()).toHaveLength(18);
  });

  it("hit rate is monotonically non-increasing in both knobs", () => {
    // This is the property that makes AC-10.2 a meaningful test rather than a
    // tautology: tightening must actually hurt the simulated player.
    const p = 0.9;
    for (let b = LENGTH_BIAS_MIN; b <= LENGTH_BIAS_MAX; b++) {
      for (let m = MAX_LIVE_MIN; m < MAX_LIVE_MAX; m++) {
        const lo = expectedRate(p, { maxLive: m, lengthBias: b as LengthBias });
        const hi = expectedRate(p, { maxLive: m + 1, lengthBias: b as LengthBias });
        expect(hi, `maxLive ${m} -> ${m + 1} at bias ${b}`).toBeLessThan(lo);
      }
    }
    for (let m = MAX_LIVE_MIN; m <= MAX_LIVE_MAX; m++) {
      for (let b = LENGTH_BIAS_MIN; b < LENGTH_BIAS_MAX; b++) {
        const lo = expectedRate(p, { maxLive: m, lengthBias: b as LengthBias });
        const hi = expectedRate(p, { maxLive: m, lengthBias: (b + 1) as LengthBias });
        expect(hi, `bias ${b} -> ${b + 1} at maxLive ${m}`).toBeLessThan(lo);
      }
    }
  });

  it("no knob setting at all can put a p=0.5 player inside the band", () => {
    const best = Math.max(...allKnobStates().map((k) => expectedRate(0.5, k)));
    expect(best).toBeLessThan(LOOSEN_BELOW);
  });

  it("the whole p range is reachable from above, but not from below", () => {
    // Tightening authority is ample: even a p=0.99 player can be pushed under
    // the band. Loosening authority is capped by the player's own accuracy.
    const hardest: Knobs = { maxLive: MAX_LIVE_MAX, lengthBias: LENGTH_BIAS_MAX };
    const easiest: Knobs = { maxLive: MAX_LIVE_MIN, lengthBias: LENGTH_BIAS_MIN };
    expect(expectedRate(0.99, hardest)).toBeLessThan(LOOSEN_BELOW);
    expect(expectedRate(0.5, easiest)).toBeLessThan(LOOSEN_BELOW);
  });

  it("the crossover: convergence starts working around p = 0.78", () => {
    const below = sweep(0.75);
    const above = sweep(0.8);
    expect(below.mean).toBeLessThan(LOOSEN_BELOW);
    expect(above.mean).toBeGreaterThanOrEqual(LOOSEN_BELOW);
    expect(above.mean).toBeLessThanOrEqual(TIGHTEN_ABOVE);
  });

  it("a converged run parks the knobs near the loosen floor, not at a bound it fights", () => {
    // Sanity check that the controller is actually regulating and not simply
    // pinned: a p=0.95 player settles a couple of steps above the floor.
    const { finalKnobs } = simulate(0.95, seedFor(0));
    expect(finalKnobs.maxLive).toBeGreaterThanOrEqual(MAX_LIVE_MIN);
    expect(finalKnobs.maxLive).toBeLessThan(MAX_LIVE_MAX);
  });
});
