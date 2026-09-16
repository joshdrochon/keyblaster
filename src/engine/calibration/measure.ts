import { DEFAULT_CALIBRATION, type Calibration } from "../types.js";
import {
  MAX_FK_LATENCY_MS,
  MAX_IKI_MS,
  MIN_FK_LATENCY_MS,
  MIN_IKI_MS,
  boundSamples,
  median,
  settleMs,
} from "./stats.js";
import { RITUAL_STEPS, type CalibrationStepId } from "./ritual.js";

/**
 * Turning the pre-flight ritual into a Calibration (D51, PRD FR-11).
 *
 * AC-11.3 is enforced by the shape of the input, not by discipline: a
 * Keystroke carries a position and a time and nothing else. There is no
 * character on it, no "correct" flag, and the target word is never compared
 * against anything. A score, an accuracy or a pass/fail is therefore not
 * merely unreported during the ritual - it is uncomputable from what this
 * module is given.
 */

/**
 * One keypress during the ritual. `atMs` comes from the caller's clock:
 * src/engine never reads Date.now() (CLAUDE.md hard rule), so the Preflight
 * scene stamps events and hands them over.
 */
export interface Keystroke {
  /** Index of the character this press produced, 0-based within the word. */
  readonly charIndex: number;
  /** Caller-supplied timestamp, ms. Only differences are ever used. */
  readonly atMs: number;
}

/** One prompt inside a step: a word, when it appeared, and what was typed. */
export interface RitualWordInput {
  readonly word: string;
  /**
   * When the word became visible. First-key latency is measured from here.
   * Omit (or pass a non-finite value) if the scene could not stamp it; the
   * word still contributes its inter-key intervals.
   */
  readonly shownAtMs?: number;
  /** Keystrokes in emission order. May be empty: the child may have stalled. */
  readonly keystrokes: readonly Keystroke[];
}

/** One step of the ritual as actually played. */
export interface RitualStepInput {
  readonly id: CalibrationStepId;
  readonly words: readonly RitualWordInput[];
}

/**
 * What one step contributed. Every field here is a count or a duration.
 * Nothing on it is a grade, a rank or a verdict (AC-11.3).
 */
export interface CalibrationStepOutcome {
  readonly id: CalibrationStepId;
  /** Did the child press any key at all during this step? */
  readonly attempted: boolean;
  readonly keystrokeCount: number;
  /** Word-start latencies this step offered, after bounding. */
  readonly fkLatencySamplesMs: readonly number[];
  /** Inter-key intervals this step offered, after bounding. */
  readonly ikiSamplesMs: readonly number[];
  /** Samples pulled down to a ceiling (child paused mid-word). */
  readonly cappedSamples: number;
  /** Samples thrown out as non-physical (duplicate or out-of-order events). */
  readonly discardedSamples: number;
}

/** The ritual's whole output. `calibration` is what lands on the profile. */
export interface CalibrationResult {
  readonly calibration: Calibration;
  /** Always all three of D81's steps, present even when never played. */
  readonly steps: readonly CalibrationStepOutcome[];
  /** True when no usable interval was seen and FR-8's 350 ms default stands. */
  readonly usedDefaultIki: boolean;
  /** True when no usable word-start latency was seen and 500 ms stands. */
  readonly usedDefaultFkLatency: boolean;
}

/**
 * Raw first-key latency for one word, or null.
 *
 * The first record in emission order is the first key: callers deliver
 * keystrokes in the order they fired. A non-positive latency means the scene
 * stamped `shownAtMs` after the press, which is clock skew, not a fast child.
 */
function rawFirstKeyLatency(word: RitualWordInput): number | null {
  const shown = word.shownAtMs;
  if (shown === undefined || !Number.isFinite(shown)) return null;
  const first = word.keystrokes[0];
  if (first === undefined || !Number.isFinite(first.atMs)) return null;
  const latency = first.atMs - shown;
  return latency > 0 ? latency : null;
}

/**
 * Raw inter-key intervals for one word.
 *
 * A pair counts only when `charIndex` advances by exactly one. A repeated or
 * decreasing index is a backspace-and-retype, and the gap around a correction
 * is thinking time, not typing speed - folding it in would tell FR-8 the child
 * is slower than they are. A single keystroke yields no interval at all, which
 * is a normal outcome, not an error.
 */
function rawIntervals(word: RitualWordInput): number[] {
  const out: number[] = [];
  for (let i = 1; i < word.keystrokes.length; i += 1) {
    const prev = word.keystrokes[i - 1]!;
    const curr = word.keystrokes[i]!;
    if (curr.charIndex !== prev.charIndex + 1) continue;
    if (!Number.isFinite(prev.atMs) || !Number.isFinite(curr.atMs)) continue;
    out.push(curr.atMs - prev.atMs);
  }
  return out;
}

function countKeystrokes(step: readonly RitualWordInput[]): number {
  let n = 0;
  for (const word of step) n += word.keystrokes.length;
  return n;
}

/**
 * Measure one step of the ritual in isolation.
 *
 * Exported so the Preflight scene can show Shadow reacting after each step
 * without waiting for the whole sequence, and so AC-11.1's "the three steps
 * are modelled explicitly" is testable step by step.
 */
export function measureStep(step: RitualStepInput): CalibrationStepOutcome {
  const spec = RITUAL_STEPS.find((s) => s.id === step.id);
  const rawFk: number[] = [];
  const rawIki: number[] = [];

  for (const word of step.words) {
    const fk = rawFirstKeyLatency(word);
    if (fk !== null) rawFk.push(fk);
    rawIki.push(...rawIntervals(word));
  }

  // A step only feeds the measure D81 gives it (plus word-start latencies,
  // see RITUAL_STEPS). An unknown step id feeds nothing rather than throwing:
  // a content bug must never crash a child's first twenty seconds.
  const useFk = spec?.contributesFkLatency ?? false;
  const useIki = spec?.contributesIki ?? false;

  const fk = boundSamples(
    useFk ? rawFk : [],
    MIN_FK_LATENCY_MS,
    MAX_FK_LATENCY_MS,
  );
  const iki = boundSamples(useIki ? rawIki : [], MIN_IKI_MS, MAX_IKI_MS);

  return {
    id: step.id,
    attempted: countKeystrokes(step.words) > 0,
    keystrokeCount: countKeystrokes(step.words),
    fkLatencySamplesMs: fk.values,
    ikiSamplesMs: iki.values,
    cappedSamples: fk.capped + iki.capped,
    discardedSamples: fk.discarded + iki.discarded,
  };
}

/**
 * AC-11.1: produce the median inter-key interval and first-key latency from a
 * played ritual.
 *
 * The result always describes all three of D81's steps, in order, whether or
 * not the child reached them - an abandoned or missing step shows up as
 * `attempted: false` with empty samples rather than vanishing. Each measure
 * falls back to DEFAULT_CALIBRATION independently, so a ritual that produced
 * intervals but no clean word-start latency keeps its real ikiMs instead of
 * throwing both away.
 */
export function computeCalibration(
  steps: readonly RitualStepInput[],
): CalibrationResult {
  const outcomes: CalibrationStepOutcome[] = [];
  const fkSamples: number[] = [];
  const ikiSamples: number[] = [];

  for (const spec of RITUAL_STEPS) {
    // filter, not find: a scene that split a step across two payloads, or
    // omitted one entirely, must both work.
    const played = steps.filter((s) => s.id === spec.id);
    const merged: RitualStepInput = {
      id: spec.id,
      words: played.flatMap((s) => s.words),
    };
    const outcome = measureStep(merged);
    outcomes.push(outcome);
    fkSamples.push(...outcome.fkLatencySamplesMs);
    ikiSamples.push(...outcome.ikiSamplesMs);
  }

  const fkMedian = median(fkSamples);
  const ikiMedian = median(ikiSamples);

  return {
    calibration: {
      ikiMs:
        ikiMedian === null
          ? DEFAULT_CALIBRATION.ikiMs
          : settleMs(ikiMedian, MIN_IKI_MS, MAX_IKI_MS),
      fkLatencyMs:
        fkMedian === null
          ? DEFAULT_CALIBRATION.fkLatencyMs
          : settleMs(fkMedian, MIN_FK_LATENCY_MS, MAX_FK_LATENCY_MS),
    },
    steps: outcomes,
    usedDefaultIki: ikiMedian === null,
    usedDefaultFkLatency: fkMedian === null,
  };
}

/**
 * AC-11.1 "stored on the profile": fold a calibration into a profile record
 * without mutating it. Structural, so persistence/ can use it on whatever it
 * calls a profile as long as it carries a calibration.
 */
export function applyCalibration<T extends { calibration: Calibration }>(
  profile: T,
  calibration: Calibration,
): T {
  return { ...profile, calibration: { ...calibration } };
}
