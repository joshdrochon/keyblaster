import type { Calibration } from "../types.js";
import { RITUAL_STEPS, planRitual, type RitualPlan } from "./ritual.js";
import { REFINE_ALPHA } from "./history.js";
import { measureStep, type RitualStepInput } from "./measure.js";
import {
  MAX_FK_LATENCY_MS,
  MAX_IKI_MS,
  MIN_FK_LATENCY_MS,
  MIN_IKI_MS,
  median,
  settleMs,
} from "./stats.js";

/**
 * THE LAUNCH CEREMONY (D99, UR-28). A short typed ritual at every stop after
 * the first, and a real re-measurement rather than set dressing.
 *
 * WHAT WAS WRONG. D51 made the ~20 s ritual a once-per-profile event, and
 * `PreflightScene` honoured that literally: the first stop that ran it consumed
 * it and every later stop mounted a Pre-flight screen with `plan = null` - the
 * rows lit themselves on a timer, Shadow said his line, and there was nothing
 * to type. The source comment described it as a costume with nothing underneath.
 * UR-28 reports exactly that, and the choice made was a short ritual at every stop.
 *
 * WHY IT IS ALSO THE TECHNICALLY BETTER ANSWER. Calibration was taken ONCE, at
 * the coldest moment a child will ever have, and never updated as they warmed
 * up over a session. Measuring once and never again is the same defect class
 * that left `calibration.ikiMs` pinned at FR-8's 350 ms default and made the
 * belt unsurvivable for a grade-2 typist. This module's samples flow back to
 * the profile by exactly the route the full ritual's do.
 *
 * WHY THE FOLD IS NOT `computeCalibration`. The full ritual types five or six
 * words. The ceremony types TWO - about six inter-key intervals and two
 * word-start latencies. Six samples is a real measurement and a poor baseline:
 * REPLACING the stored figure with a median of six would let one fumbled word
 * at Neptune set the difficulty of Pluto. So the ceremony BLENDS, at a smaller
 * alpha than a whole stage of play earns, behind a minimum-sample gate and an
 * asymmetric clamp. See LAUNCH_REFINE_ALPHA and LAUNCH_MAX_TIGHTEN.
 *
 * Every rule of `index.ts` still holds here: no clock, medians never means, and
 * nothing grade-shaped - the inputs are the same character-free `Keystroke`s,
 * so an accuracy is uncomputable from what this module is given (AC-11.3).
 */

/**
 * UR-57: THE CEREMONY RUNS ALL THREE OF D81'S STEPS.
 *
 * It used to run ONE - two short words on `systems`, with `hull` and `engines`
 * lighting on their own - and a player counted the steps and reported that the
 * belt started after two. Not a bug, but the number was wrong, and it was wrong
 * in two ways that matter more than screen time.
 *
 * FIRST, IT OVERRODE ITS OWN SPEC. `RITUAL_STEPS` declares `systems` as 3-4
 * words; the ceremony handed it 2.
 *
 * SECOND, AND THIS IS THE ONE THAT DECIDED IT: the three steps measure
 * DIFFERENT THINGS. `hull` sets `contributesFkLatency` true and
 * `contributesIki` false; `systems` and `engines` feed both. With only `systems`
 * live, the ceremony collected about 6 inter-key intervals and exactly 2
 * word-start latencies - so at six of seven stops the re-measurement D99 exists
 * for was running on half its inputs, and a median of two is not a median.
 * Running all three steps takes that to roughly 12-24 intervals and 5-6
 * latencies, and FR-8's fall budget is being reworked on top of it (`UR-51`),
 * so the quality of this sample is now load-bearing.
 *
 * SO THERE IS NO SEPARATE PLANNER ANY MORE. `planLaunchCeremony` delegates to
 * `planRitual`, which is what "each step honours its own declared
 * minWords/maxWords" looks like when it is structural rather than promised. The
 * two modes now differ in the one place the difference was ever load-bearing:
 * the full ritual REPLACES the stored baseline (`computeCalibration`), the
 * ceremony BLENDS into it (`foldLaunchCeremony`).
 *
 * WHAT THIS COSTS, STATED PLAINLY: the ceremony now asks for the same 5-6 words
 * the ritual does, so D51's "~20 s once per profile" is not a once-per-profile
 * cost in any sense any more. There is no separate typing budget either - the
 * ceremony's words ARE the ritual's words, so `RITUAL_BUDGET_MS` is the only
 * budget. See the amendment on collision C15.
 */

/**
 * How much of the gap one ceremony may close.
 *
 * `next = (1 - alpha) * stored + alpha * median(this ceremony's samples)`.
 *
 * UR-57 RE-DERIVED THIS RATHER THAN INHERITING IT, and the answer changed. D99
 * set 0.12 - deliberately below a stage of play's `REFINE_ALPHA` - for the
 * stated reason that "a stage offers dozens of samples and a ceremony offers
 * six". Running all three steps makes that reason false: a ceremony now yields
 * **18.2 inter-key intervals and 5.7 word-start latencies** on average across
 * the six stops, measured, which is a stage-sized sample. So the special case is
 * retired and the ceremony folds at the same weight ordinary play does.
 *
 * WHAT THE MEASUREMENT ACTUALLY SHOWED, because it is not what was expected.
 * Across alpha 0.12 to 0.40, over 120 belts per cell:
 *
 *   - STALLS DO NOT MOVE AT ALL. 2/120 at every alpha, honest ceremony. The
 *     belt re-folds from the player's own keystrokes after the first spawn, so
 *     it owns everything except the belief the belt OPENS on.
 *   - BELIEF AT BELT OPEN improves, and only slightly: mean error 33.2 ms at
 *     0.12 against 30.5 ms at 0.20 and 23.0 ms at 0.40, for a child speeding up
 *     from 600 to 380 ms across the route. Through FR-8 that is about 100 ms of
 *     fall time on a seven-letter word - below anything a child perceives.
 *   - THE DAMAGE FROM A GARBAGE CEREMONY IS CONTROLLED BY THE CLAMP, NOT BY
 *     ALPHA. See LAUNCH_MAX_TIGHTEN.
 *
 * So alpha is chosen on the honesty of the sample rather than on an outcome it
 * measurably moves: 18 samples deserve a stage's weight, and one constant is
 * better than two that mean the same thing. It is kept as its own name so the
 * ceremony can diverge again on evidence rather than by accident.
 */
export const LAUNCH_REFINE_ALPHA = REFINE_ALPHA;

/**
 * Intervals the ceremony must produce before `ikiMs` is touched at all.
 *
 * Three, so the median has something to stand on. Below it the measure is left
 * EXACTLY as it was - a child who typed one letter and stopped has told the
 * game nothing, and "nothing" must not be read as "fast".
 */
export const LAUNCH_MIN_IKI_SAMPLES = 3;

/** Word-start latencies required before `fkLatencyMs` is touched. Same rule. */
export const LAUNCH_MIN_FK_SAMPLES = 2;

/**
 * THE ASYMMETRY, and it is deliberate - and UR-57 measured that it is the knob
 * that actually does the work here.
 *
 * One ceremony may never lower a baseline by more than 5%. It may raise it by
 * whatever the alpha allows.
 *
 * The two directions are not equally dangerous. Fall time is
 * `len * 1.5 * ikiMs + 1200 * ease`, so a baseline that moves DOWN gives the
 * child less time for every word of the next belt - that is the direction in
 * which a wrong number makes the game unplayable, and it is the exact failure
 * that stalled a grade-2 pilot at spawn 18 of 58. A baseline that moves UP
 * gives them more time than they need, which costs nothing but a slightly easy
 * belt that the FR-10 controller tightens back within twenty spawns.
 *
 * THE NUMBERS THAT KEPT IT AT 5%. A ceremony of pure garbage - every interval
 * at the physical floor, which is what mashing looks like to the measure - flown
 * at every stop of the route, 120 belts per cell:
 *
 *   clamp       alpha 0.12   0.20   0.25   0.30
 *   5% (ships)       1/120   1/120  1/120  1/120
 *   8%               3/120   3/120  3/120  3/120
 *   off              2/120   4/120  6/120  9/120
 *
 * With the clamp on, damage is flat in alpha. With it off, damage scales with
 * alpha - which is precisely why raising alpha was safe to do and why this
 * number was not raised with it.
 */
export const LAUNCH_MAX_TIGHTEN = 0.05;

/**
 * Choose the ceremony's words - which is to say, plan a ritual (UR-57).
 *
 * A delegation and not a copy. Every reason the ceremony could have had for its
 * own word-selection logic was a reason to give a step fewer words than
 * `RITUAL_STEPS` declares, and UR-57 removed all of them, so a second planner
 * would now exist only to drift out of step with the first. `planRitual` is
 * pure and takes its RNG, so the caller varies the words per stop by varying
 * the seed - the scene already does, which is why a pilot who ran the full
 * ritual at a stop is not handed the same words when they come back to it.
 *
 * Returns null when the pool cannot fill every step (Earth ships `pool: []`,
 * D57). The caller then falls back to the untyped sequence, so a thin pool
 * degrades to the screen the game showed yesterday and never to a crash or to a
 * child stuck on a prompt the content could not fill.
 */
export function planLaunchCeremony(
  pool: Iterable<string>,
  rng: () => number,
): RitualPlan | null {
  return planRitual(pool, rng);
}

/** What one ceremony did to the baseline, and why. Nothing here is a grade. */
export interface LaunchFoldResult {
  /** The baseline to store. Identical to the input when nothing was usable. */
  readonly calibration: Calibration;
  /** Usable inter-key intervals the ceremony produced, after bounding. */
  readonly ikiSamples: number;
  /** Usable word-start latencies the ceremony produced, after bounding. */
  readonly fkSamples: number;
  /** False when the sample gate held `ikiMs` exactly where it was. */
  readonly foldedIki: boolean;
  /** False when the sample gate held `fkLatencyMs` exactly where it was. */
  readonly foldedFkLatency: boolean;
  /** True when a downward move was held at LAUNCH_MAX_TIGHTEN. */
  readonly tightenClamped: boolean;
}

export interface LaunchFoldOptions {
  /** Override the blend weight. Default LAUNCH_REFINE_ALPHA. */
  readonly alpha?: number;
  /** Override the downward rate limit. Default LAUNCH_MAX_TIGHTEN. */
  readonly maxTighten?: number;
}

interface MeasureFold {
  readonly value: number;
  readonly folded: boolean;
  readonly clamped: boolean;
}

function foldMeasure(
  stored: number,
  samples: readonly number[],
  minSamples: number,
  alpha: number,
  maxTighten: number,
  floor: number,
  ceiling: number,
): MeasureFold {
  // `max(1, ...)` states the invariant the assertion below relies on rather
  // than leaving a dead null-branch nobody can ever make fail: past this guard
  // there is at least one sample, so `median` cannot return null.
  if (samples.length < Math.max(1, minSamples)) {
    return { value: settleMs(stored, floor, ceiling), folded: false, clamped: false };
  }
  const observed = median(samples)!;
  const blended = (1 - alpha) * stored + alpha * observed;
  const tightestAllowed = stored * (1 - maxTighten);
  const clamped = blended < tightestAllowed;
  const next = clamped ? tightestAllowed : blended;
  return { value: settleMs(next, floor, ceiling), folded: true, clamped };
}

/**
 * Fold a played ceremony into the stored baseline (D99, AC-11.4).
 *
 * `played` is the same `RitualStepInput[]` the full ritual hands
 * `computeCalibration`, so the two paths measure identically and differ only in
 * what they do with the answer: the ritual replaces the baseline, the ceremony
 * blends into it.
 *
 * A step that was never played, or that produced nothing usable, contributes
 * nothing and leaves its measure exactly as it was.
 */
export function foldLaunchCeremony(
  stored: Calibration,
  played: readonly RitualStepInput[],
  options: LaunchFoldOptions = {},
): LaunchFoldResult {
  const alpha = Number.isFinite(options.alpha ?? NaN)
    ? Math.min(1, Math.max(0, options.alpha as number))
    : LAUNCH_REFINE_ALPHA;
  const maxTighten = Number.isFinite(options.maxTighten ?? NaN)
    ? Math.min(1, Math.max(0, options.maxTighten as number))
    : LAUNCH_MAX_TIGHTEN;

  const ikiSamples: number[] = [];
  const fkSamples: number[] = [];
  for (const spec of RITUAL_STEPS) {
    // filter, not find: a scene that split a step across two payloads, or
    // omitted one entirely, must both work (same rule as computeCalibration).
    const merged: RitualStepInput = {
      id: spec.id,
      words: played.filter((s) => s.id === spec.id).flatMap((s) => s.words),
    };
    const outcome = measureStep(merged);
    ikiSamples.push(...outcome.ikiSamplesMs);
    fkSamples.push(...outcome.fkLatencySamplesMs);
  }

  const iki = foldMeasure(
    stored.ikiMs,
    ikiSamples,
    LAUNCH_MIN_IKI_SAMPLES,
    alpha,
    maxTighten,
    MIN_IKI_MS,
    MAX_IKI_MS,
  );
  const fk = foldMeasure(
    stored.fkLatencyMs,
    fkSamples,
    LAUNCH_MIN_FK_SAMPLES,
    alpha,
    maxTighten,
    MIN_FK_LATENCY_MS,
    MAX_FK_LATENCY_MS,
  );

  return {
    calibration: { ikiMs: iki.value, fkLatencyMs: fk.value },
    ikiSamples: ikiSamples.length,
    fkSamples: fkSamples.length,
    foldedIki: iki.folded,
    foldedFkLatency: fk.folded,
    tightenClamped: iki.clamped || fk.clamped,
  };
}
