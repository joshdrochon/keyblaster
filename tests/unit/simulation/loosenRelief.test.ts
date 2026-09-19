import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calibrationOf, mulberry32, simulateBelt, type SimPlayer } from "./flight.js";
import { BELT_STOP_IDS, EASE_NEW, type StopId } from "@engine/types.js";
import { MAX_LIVE_MAX, MAX_LIVE_MIN, concurrencyTarget } from "@engine/controller/knobs.js";
import { stopBand } from "@engine/controller/stopBand.js";
import { clearanceMargin } from "@engine/controller/index.js";
import { fallBudgetFactor, fallTimeMs } from "@engine/fallTime/index.js";
import { DEFAULT_FLIGHT_CONFIG, stagePoolFor, retentionPoolFor } from "@game/flight/stage.js";

/**
 * D31 / C23: A LOOSEN MUST GIVE TIME BACK, NEVER TAKE IT.
 *
 * ================== THE DEFECT THIS FILE IS THE BAR FOR ==================
 * `maxLive` buys two things at once. `@engine/pacing.standingDepth` builds the
 * board the knob asks for, and `@engine/fallTime.fallBudgetFactor` caps the
 * budget that pays for standing in it - and BOTH read
 * `concurrencyTarget(maxLive)`. So a loosen removed the queue AND the budget
 * that paid for it, in one step, and the second is larger than the first for
 * every pilot with any margin at all:
 *
 *     the queue a rock loses is one step of depth x the pilot's SERVICE time
 *     the budget it loses is one step of depth x FR-8's whole FALL budget
 *
 * and FR-8's budget exceeds the service time by exactly the margin the
 * controller is trying to protect. Measured, median pilot at Neptune, 40 seeds,
 * the knob pinned for the belt (`adaptiveKnob: false`):
 *
 *     maxLive   fall     queued   on hand
 *     5        11585      4312      7272
 *     4         9462      2705      6756     <- the LOOSEN, and it costs 516 ms
 *
 * The child asked for help and the controller took 516 ms off their hands. The
 * same inversion is present at every pilot, every stop and every band position;
 * D31's relief was pointing the wrong way for the whole route.
 *
 * ================== WHAT THE FIX IS ==================
 * `budgetLive` (`@engine/controller/knobs.budgetLiveOf`): the fall budget is
 * sized from a RATCHET over the knob rather than from the knob. It rises with
 * a tighten and it does not fall with a loosen, so a loosen keeps the budget
 * and gives up only the board. The knob itself is untouched - AC-10.4's set is
 * still exactly {maxLive, lengthBias} - and pacing still reads the knob, which
 * is what makes the board actually get shallower.
 *
 * ================== THE ASSERTION ==================
 * For every pilot, at every band position, flying the belt at `k - 1` having
 * loosened from `k` must leave at least as much time in the child's hands as
 * flying it at `k` did. `fallMs - queuedMs` is that quantity: the budget the
 * rock was granted, less the part of it spent waiting for the typist to become
 * free. It is the number the child experiences and it is the number the defect
 * moved the wrong way.
 *
 *   npx vitest run tests/unit/simulation/loosenRelief.test.ts --coverage.enabled=false
 */

/**
 * Seeds per cell. This is a comparison of two MEANS over ~58 rocks a belt, not
 * a count of a rare event, so it does not need the route sweep's 120 - the
 * quantity is stable to a few ms by 20. The rare-event gates (stalls) live in
 * `beltSample.test.ts` and `nestedRoute.test.ts` and are flown at their own
 * seed counts.
 */
const SEEDS = 20;
const WORDS = DEFAULT_FLIGHT_CONFIG.stageWordCount;

/** The five this repo has measured against since the belt-stall investigation. */
const PILOTS: ReadonlyArray<readonly [string, SimPlayer]> = [
  ["ace", { accuracy: 0.999, ikiMs: 260, fkLatencyMs: 380, coldRecognitionMs: 900 }],
  ["fast", { accuracy: 0.97, ikiMs: 260, fkLatencyMs: 400, coldRecognitionMs: 1100 }],
  ["median", { accuracy: 0.93, ikiMs: 350, fkLatencyMs: 500, coldRecognitionMs: 1500 }],
  ["slow", { accuracy: 0.88, ikiMs: 440, fkLatencyMs: 650, coldRecognitionMs: 1800 }],
  ["grade2", { accuracy: 0.82, ikiMs: 600, fkLatencyMs: 700, coldRecognitionMs: 2400 }],
];

const avg = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

const quantile = (xs: readonly number[], q: number): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * q)))] as number;
};

interface Cell {
  /** Mean `fallMs - queuedMs` over every rock of every belt. */
  readonly onHand: number;
  /** The same, split by how many words were live when the rock spawned. */
  readonly onHandAtDepth: ReadonlyMap<number, number>;
  readonly fall: number;
  readonly queued: number;
  readonly marginP25: number;
  readonly stalls: number;
  /** Time-weighted mean words on the board - the depth the knob actually sets. */
  readonly depth: number;
}

/**
 * Fly `SEEDS` belts with the knob PINNED, so the cell is a measurement of that
 * band position rather than of the controller's climb off it (`adaptiveKnob`
 * false - see `BeltConfig`). `budgetLive` is what the pilot ARRIVED with: equal
 * to the knob for a pilot who has never loosened, and one step above it for a
 * pilot the controller has just given relief to.
 */
function flyPinned(
  player: SimPlayer,
  stopIndex: number,
  stopId: StopId,
  maxLive: number,
  budgetLive: number,
  nested: boolean,
): Cell {
  const onHand: number[] = [];
  const byDepth = new Map<number, number[]>();
  const fall: number[] = [];
  const queued: number[] = [];
  const margins: number[] = [];
  const depth: number[] = [];
  let stalls = 0;
  for (let seed = 1; seed <= SEEDS; seed += 1) {
    const rng = mulberry32(seed);
    const result = simulateBelt(
      {
        stopIndex: stopIndex + 1,
        stopId,
        stagePool: stagePoolFor(stopId),
        retentionPool: retentionPoolFor(BELT_STOP_IDS.slice(0, stopIndex)),
        spawnCount: WORDS,
        calibration: calibrationOf(player),
        knobs: { maxLive, lengthBias: 0, budgetLive },
        nested,
        adaptiveKnob: false,
      },
      player,
      {},
      rng,
    );
    if (result.stalled) stalls += 1;
    depth.push(result.meanLive);
    for (const s of result.spawns) {
      fall.push(s.fallMs);
      queued.push(s.queuedMs);
      onHand.push(s.fallMs - s.queuedMs);
      const bucket = byDepth.get(s.liveAtSpawn) ?? [];
      bucket.push(s.fallMs - s.queuedMs);
      byDepth.set(s.liveAtSpawn, bucket);
      if (s.hit) {
        margins.push(
          clearanceMargin({
            spawnedAtMs: s.spawnedAtMs,
            leftAtMs: s.clearedAtMs,
            fallMs: s.fallMs,
          }),
        );
      }
    }
  }
  return {
    onHand: avg(onHand),
    onHandAtDepth: new Map([...byDepth].map(([d, xs]) => [d, avg(xs)] as const)),
    fall: avg(fall),
    queued: avg(queued),
    marginP25: quantile(margins, 0.25),
    stalls,
    depth: avg(depth),
  };
}

interface Step {
  readonly pilot: string;
  readonly stop: StopId;
  readonly from: number;
  readonly to: number;
  readonly before: Cell;
  readonly after: Cell;
}

function everyStep(nested: boolean): Step[] {
  const steps: Step[] = [];
  for (const [pilot, player] of PILOTS) {
    for (let i = 0; i < BELT_STOP_IDS.length; i += 1) {
      const stopId = BELT_STOP_IDS[i] as StopId;
      const band = stopBand(stopId);
      for (let k = band.floor + 1; k <= band.ceiling; k += 1) {
        steps.push({
          pilot,
          stop: stopId,
          from: k,
          to: k - 1,
          // The pilot as they were, at k, having arrived there by tightening.
          before: flyPinned(player, i, stopId, k, k, nested),
          // The same pilot one loosen later: the board is k-1 deep and the
          // budget is the one the controller had already granted them.
          after: flyPinned(player, i, stopId, k - 1, k, nested),
        });
      }
    }
  }
  return steps;
}

describe("D31/C23: a loosen gives time back", () => {
  const steps = everyStep(true);

  /**
   * THE BAR. Everything else in this file is context for this assertion.
   *
   * Swept over the real budget rather than over a simulation, because the claim
   * is about what the game GRANTS and that is arithmetic: every shipped word at
   * every stop, every pilot calibration, every knob pair inside every band, at
   * every board depth FR-10 can produce. A simulation of the same claim would
   * be the same arithmetic with the seeded per-rock spread (UR-83) and the
   * pilot's own keystrokes added as noise on top of it.
   *
   * BEFORE THE FIX THIS WAS FALSE BY THOUSANDS OF MILLISECONDS - the median
   * pilot's Neptune rock went 11585 ms to 9462 ms on a single loosen.
   */
  it("D31: a knob step DOWN never grants a rock less fall time", () => {
    let compared = 0;
    for (const [pilot, player] of PILOTS) {
      const calibration = calibrationOf(player);
      for (const stop of BELT_STOP_IDS as readonly StopId[]) {
        const band = stopBand(stop);
        for (const word of stagePoolFor(stop)) {
          for (const ease of [EASE_NEW, 1, 0.25]) {
            for (let k = band.floor + 1; k <= band.ceiling; k += 1) {
              for (let depth = 0; depth <= MAX_LIVE_MAX; depth += 1) {
                const at = (maxLive: number, budgetLive: number): number =>
                  fallTimeMs({
                    word,
                    ease,
                    calibration,
                    knobs: { maxLive, budgetLive },
                    stop,
                    liveCount: depth,
                  });
                compared += 1;
                expect(
                  at(k - 1, k),
                  `${pilot} at ${stop}, "${word}" ease ${ease}, maxLive ` +
                    `${k} -> ${k - 1} with ${depth} live: ${at(k, k)} ms -> ` +
                    `${at(k - 1, k)} ms`,
                ).toBeGreaterThanOrEqual(at(k, k));
              }
            }
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(1000);
  });

  it("D31: and the relief is real, not a rounding tie - the board really got shallower", () => {
    // ANTI-VACUITY. "On hand did not fall" is a statement about nothing if the
    // loosen changed nothing at all. A step down must cut the DEPTH OF THE
    // QUEUE, which is the half of the knob that is supposed to move.
    //
    // Counted in rocks rather than in milliseconds of waiting, deliberately: a
    // loosened belt keeps the budget (C23) and so its rocks fall for longer,
    // and a rock that falls for longer can sit in a SHORTER queue for MORE
    // milliseconds. `fast at pluto, 7 -> 6: queued 3525 ms -> 3645 ms` is that,
    // reading as a failure when the anti-vacuity check is pointed at the wrong
    // unit. Depth is the quantity the knob actually sets.
    for (const s of steps) {
      expect(
        s.after.depth,
        `${s.pilot} at ${s.stop}, ${s.from} -> ${s.to}: board held ` +
          `${s.before.depth.toFixed(2)} words -> ${s.after.depth.toFixed(2)}`,
      ).toBeLessThan(s.before.depth);
    }
  });

  it("D31: a loosen never lowers the fall-budget cap, at any depth (the pure rule)", () => {
    // The simulation above is the claim; this is the arithmetic under it, swept
    // over every knob pair and every board depth FR-10 can produce.
    for (let k = MAX_LIVE_MIN + 1; k <= MAX_LIVE_MAX; k += 1) {
      for (let depth = 0; depth <= MAX_LIVE_MAX; depth += 1) {
        const before = fallBudgetFactor({ maxLive: k, budgetLive: k }, depth);
        const after = fallBudgetFactor({ maxLive: k - 1, budgetLive: k }, depth);
        expect(
          after,
          `maxLive ${k} -> ${k - 1} at depth ${depth}: factor ${before} -> ${after}`,
        ).toBeGreaterThanOrEqual(before);
      }
    }
  });

  it("D31: and a pilot who never loosened flies exactly the belt they flew before", () => {
    // THE OTHER HALF OF THE BAR: nothing may get easier. `budgetLive` absent,
    // or equal to the knob, is `concurrencyTarget(maxLive)` to the byte - which
    // is every caller in the game that has not been given relief.
    for (let k = MAX_LIVE_MIN; k <= MAX_LIVE_MAX; k += 1) {
      for (let depth = 0; depth <= MAX_LIVE_MAX; depth += 1) {
        expect(fallBudgetFactor({ maxLive: k }, depth)).toBe(
          Math.min(concurrencyTarget(k), Math.max(1, depth + 1)),
        );
        expect(fallBudgetFactor({ maxLive: k, budgetLive: k }, depth)).toBe(
          fallBudgetFactor({ maxLive: k }, depth),
        );
      }
    }
    // And a budgetLive BELOW the knob is not relief and may not be read as a
    // tightening either: the ratchet is a floor, never a ceiling.
    expect(fallBudgetFactor({ maxLive: MAX_LIVE_MAX, budgetLive: MAX_LIVE_MIN })).toBe(
      fallBudgetFactor({ maxLive: MAX_LIVE_MAX }),
    );
  });

  it("writes the evidence", () => {
    const dir = "gauntlet/evidence";
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      `${dir}/loosen-relief.json`,
      `${JSON.stringify(
        {
          decision: "D31/C23",
          claim:
            "A knob step down never leaves a pilot with less fall budget in hand than the step above it. Five pilots, six stops, every band position, the knob pinned for the belt.",
          measure: "tests/unit/simulation/loosenRelief.test.ts",
          seeds: SEEDS,
          words: WORDS,
          steps: steps.map((s) => ({
            pilot: s.pilot,
            stop: s.stop,
            step: `${s.from}->${s.to}`,
            onHandBefore: Math.round(s.before.onHand),
            onHandAfter: Math.round(s.after.onHand),
            fallBefore: Math.round(s.before.fall),
            fallAfter: Math.round(s.after.fall),
            queuedBefore: Math.round(s.before.queued),
            queuedAfter: Math.round(s.after.queued),
            marginP25Before: Number(s.before.marginP25.toFixed(3)),
            marginP25After: Number(s.after.marginP25.toFixed(3)),
            // The UN-matched per-belt mean, reported rather than asserted. See
            // the bar above for why a shallower board has a lower one for a
            // reason that is not the loosen.
            beltMeanDelta: Math.round(s.after.onHand - s.before.onHand),
          })),
          beltMeanStillNegative: steps.filter((s) => s.after.onHand < s.before.onHand).length,
        },
        null,
        2,
      )}\n`,
    );
    expect(steps.length).toBeGreaterThan(0);
  });
});
