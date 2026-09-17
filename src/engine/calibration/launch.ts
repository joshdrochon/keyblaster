import type { Calibration } from "../types.js";
import {
  RITUAL_STEPS,
  SHORT_WORD_MAX_LENGTH,
  shuffleInPlace,
  type CalibrationStepId,
  type RitualPlan,
  type RitualPlanStep,
} from "./ritual.js";
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
 * Which of D81's three steps carries the typed words.
 *
 * `systems` and not `hull`, because the hull check's intervals are deliberately
 * excluded from `ikiMs` (see RITUAL_STEPS) - putting the ceremony there would
 * throw away every interval it collects. `systems` and not `engines`, because
 * engines wants a 7-13 letter word and one long word yields a single word-start
 * latency, which is not a median. `systems` takes short words and feeds both
 * measures, which is exactly what two words in five seconds can offer.
 *
 * The other two rows still light, in D81's order, so the screen is the same
 * screen; they simply carry no prompt. The typed beat therefore lands in the
 * middle and the engines row lights immediately after it, which is the launch.
 */
export const LAUNCH_CEREMONY_STEP: CalibrationStepId = "systems";

/**
 * How many words the ceremony asks for.
 *
 * TWO, not one. One word yields exactly one word-start latency, and a median of
 * one sample is not a median - it is the single distracted keystroke D18 exists
 * to defend against, promoted to the whole measurement. Two short words cost
 * about 3.1 s at the shipped baseline and 5-6 s for a grade-2 typist, and
 * yield ~6 intervals and 2 latencies.
 */
export const LAUNCH_CEREMONY_WORDS = 2;

/**
 * What the ceremony's TYPING is allowed to cost, ms - the words themselves, not
 * the beats around them.
 *
 * D51 budgets the full ritual at ~20 s once per profile, of which the typing is
 * most. This is the per-stop toll that replaces "nothing to type", and it is
 * paid six times on a route out to Pluto, so the words are held to a different
 * order of magnitude: two short ones, about 3.1 s at the shipped baseline and
 * about 6.2 s for a grade-2 pilot. `PreflightScene.PREFLIGHT_TIMING` holds the
 * surrounding beats, and the whole screen still lands inside D51's 5-20 s.
 */
export const LAUNCH_CEREMONY_BUDGET_MS = 8_000;

/**
 * How much of the gap one ceremony may close.
 *
 * `next = (1 - alpha) * stored + alpha * median(this ceremony's samples)`, the
 * same shape as `refineCalibration`, at a SMALLER alpha: 0.12 against a stage
 * of play's 0.2, because a stage offers dozens of samples and a ceremony offers
 * six. Over the six stops of a route (D57) that closes 1 - 0.88^6 = 53% of the
 * gap, so a child who genuinely speeds up over a session is tracked inside one
 * trip; a single unlucky stop moves the baseline by at most an eighth of the
 * distance to whatever it thought it saw.
 */
export const LAUNCH_REFINE_ALPHA = 0.12;

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
 * THE ASYMMETRY, and it is deliberate.
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
 * So the cheap error is left unclamped and the expensive one is rate-limited.
 * Five percent per stop still allows a 26% tightening across a full route,
 * which is more movement than a child's hands make in one session.
 */
export const LAUNCH_MAX_TIGHTEN = 0.05;

/**
 * Choose the ceremony's words from a stop's content pool.
 *
 * Returns a plan aligned with `RITUAL_STEPS` - all three steps, in D81's order,
 * with words on exactly one of them - so the Pre-flight scene walks the same
 * sequence for a ceremony as for a full ritual and the two rows that carry no
 * prompt simply light as they always did.
 *
 * Returns null when the pool cannot supply the words (Earth ships an empty
 * pool, D57). The caller then falls back to the untyped sequence, so a thin
 * pool degrades to the screen the game showed yesterday and never to a crash
 * or to a child stuck on a prompt the content could not fill.
 */
export function planLaunchCeremony(
  pool: Iterable<string>,
  rng: () => number,
  wordCount: number = LAUNCH_CEREMONY_WORDS,
): RitualPlan | null {
  const count = Math.max(1, Math.floor(wordCount));
  const seen = new Set<string>();
  const short: string[] = [];
  for (const raw of pool) {
    const word = raw.trim().toLowerCase();
    if (word.length === 0 || word.length > SHORT_WORD_MAX_LENGTH) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    short.push(word);
  }
  if (short.length < count) return null;
  shuffleInPlace(short, rng);
  const chosen = short.slice(0, count);

  const steps: RitualPlanStep[] = RITUAL_STEPS.map((spec) => ({
    id: spec.id,
    words: spec.id === LAUNCH_CEREMONY_STEP ? chosen : [],
  }));
  return { steps };
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
