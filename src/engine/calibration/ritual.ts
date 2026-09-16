import type { Calibration } from "../types.js";

/**
 * The three-step pre-flight ritual (D81, PRD AC-11.1).
 *
 * D81 fixes the steps and what each one is for:
 *   Hull check    - 1 short word      -> first-key latency
 *   Systems check - 3-4 short words   -> inter-key interval
 *   Engines       - 1 long word
 *
 * The steps are modelled as data, not as three hard-coded branches, because
 * AC-11.1 asks for them explicitly and because the Preflight scene needs to
 * narrate them one at a time in Shadow's voice (story-draft-v1.md: "Hull,
 * check. Blaster, check. Pilot... that's you.").
 *
 * Nothing in this file knows what a correct keystroke is. That is deliberate
 * and it is what makes AC-11.3 structural rather than a promise: there is no
 * comparison against the target word anywhere in this module, so no score,
 * accuracy or pass/fail can be computed even by accident.
 */

export type CalibrationStepId = "hull" | "systems" | "engines";

/** The two things the ritual measures. Both feed FR-8 and the words model. */
export type CalibrationMeasure = "fkLatency" | "iki";

/**
 * Longest word that still counts as "short" for D81's hull and systems checks.
 * A word of five letters or fewer is over in about a second and a half at the
 * default baseline, which keeps each step a beat of story rather than an
 * exercise, and keeps all three inside D51's ~20 s.
 */
export const SHORT_WORD_MAX_LENGTH = 5;

/**
 * Shortest word that counts as "long" for D81's engines step. Seven letters
 * yields six inter-key intervals from that one word, so the engines step still
 * produces a usable median on its own if the systems check was abandoned.
 */
export const LONG_WORD_MIN_LENGTH = 7;

/**
 * Longest word the ritual will ever show. Matches the asteroid plate limit
 * (13 letters, art-direction.md section 4, mirrored by allowlist/normalize.ts);
 * duplicated here rather than imported so this module owns its own bounds.
 */
export const LONG_WORD_MAX_LENGTH = 13;

/**
 * Six-letter words are deliberately neither short nor long. The gap keeps the
 * two measures distinguishable: a hull check and an engines step that could be
 * the same length would measure the same thing twice.
 */

/** D51: the whole ritual is a ~20 s pre-flight sequence. */
export const RITUAL_BUDGET_MS = 20_000;

export interface CalibrationStepSpec {
  readonly id: CalibrationStepId;
  /** Position in the sequence. Shadow narrates them in this order. */
  readonly order: number;
  /** What D81 says this step exists to measure. */
  readonly measures: CalibrationMeasure;
  readonly minWords: number;
  readonly maxWords: number;
  readonly wordLength: "short" | "long";
  /** Whether this step's first-key latencies enter the median. */
  readonly contributesFkLatency: boolean;
  /** Whether this step's inter-key intervals enter the median. */
  readonly contributesIki: boolean;
}

/**
 * D81's three steps, verbatim in word counts and purpose.
 *
 * On `contributes*`: D81 assigns each step a purpose, not an exclusive one.
 * Every prompt structurally yields one first-key latency, and the hull check
 * alone would leave `fkLatencyMs` a median of a single sample - which is not a
 * median at all, and is exactly the "one distracted keystroke" case the brief
 * says to defend against. So the systems and engines steps feed their word-
 * start latencies in too, giving five or six samples.
 *
 * The one exclusion runs the other way: the hull check's intervals are NOT
 * folded into `ikiMs`. It is the child's very first word of the whole game, on
 * a keyboard they have not touched yet, and D81 assigns inter-key interval to
 * the systems check. Its two or three cold-start intervals are the least
 * representative data the ritual produces.
 */
export const RITUAL_STEPS: readonly CalibrationStepSpec[] = [
  {
    id: "hull",
    order: 0,
    measures: "fkLatency",
    minWords: 1,
    maxWords: 1,
    wordLength: "short",
    contributesFkLatency: true,
    contributesIki: false,
  },
  {
    id: "systems",
    order: 1,
    measures: "iki",
    minWords: 3,
    maxWords: 4,
    wordLength: "short",
    contributesFkLatency: true,
    contributesIki: true,
  },
  {
    id: "engines",
    order: 2,
    measures: "iki",
    minWords: 1,
    maxWords: 1,
    wordLength: "long",
    contributesFkLatency: true,
    contributesIki: true,
  },
] as const;

/** Look up a step spec. Returns null for an id the ritual does not define. */
export function stepSpec(id: string): CalibrationStepSpec | null {
  return RITUAL_STEPS.find((s) => s.id === id) ?? null;
}

/** True if a word may be used for the given step's length class. */
export function wordFitsStep(word: string, spec: CalibrationStepSpec): boolean {
  const n = word.length;
  if (spec.wordLength === "short") return n > 0 && n <= SHORT_WORD_MAX_LENGTH;
  return n >= LONG_WORD_MIN_LENGTH && n <= LONG_WORD_MAX_LENGTH;
}

export interface RitualPlanStep {
  readonly id: CalibrationStepId;
  readonly words: readonly string[];
}

export interface RitualPlan {
  readonly steps: readonly RitualPlanStep[];
}

/**
 * Deterministic in-place shuffle. Randomness is injected (CLAUDE.md hard rule)
 * so the Preflight scene varies between children while tests stay fixed-seed.
 */
function shuffle(arr: string[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    // rng() is specified over [0,1) but a badly behaved source returning
    // exactly 1 must not produce an out-of-range swap.
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    const a = arr[i]!;
    const b = arr[j]!;
    arr[i] = b;
    arr[j] = a;
  }
}

/**
 * Choose the words for one run of the ritual from a content pool (FR-11:
 * "high-frequency words"). Pure: the pool and the RNG are both injected, and
 * no word is reused across steps, so the child never types the same word twice
 * in twenty seconds.
 *
 * Returns null when the pool cannot fill every step. The caller keeps
 * DEFAULT_CALIBRATION in that case, which is the documented FR-8 default, so a
 * thin pool degrades to "slightly generic difficulty", never to a crash.
 */
export function planRitual(
  pool: Iterable<string>,
  rng: () => number,
): RitualPlan | null {
  const seen = new Set<string>();
  const short: string[] = [];
  const long: string[] = [];

  for (const raw of pool) {
    const word = raw.trim().toLowerCase();
    if (word.length === 0 || seen.has(word)) continue;
    seen.add(word);
    if (word.length <= SHORT_WORD_MAX_LENGTH) short.push(word);
    else if (
      word.length >= LONG_WORD_MIN_LENGTH &&
      word.length <= LONG_WORD_MAX_LENGTH
    ) {
      long.push(word);
    }
  }

  shuffle(short, rng);
  shuffle(long, rng);

  const steps: RitualPlanStep[] = [];
  let shortCursor = 0;
  let longCursor = 0;

  for (const spec of RITUAL_STEPS) {
    const span = spec.maxWords - spec.minWords + 1;
    const count = Math.min(
      spec.maxWords,
      spec.minWords + Math.floor(rng() * span),
    );
    if (spec.wordLength === "short") {
      if (shortCursor + count > short.length) return null;
      steps.push({ id: spec.id, words: short.slice(shortCursor, shortCursor + count) });
      shortCursor += count;
    } else {
      if (longCursor + count > long.length) return null;
      steps.push({ id: spec.id, words: long.slice(longCursor, longCursor + count) });
      longCursor += count;
    }
  }

  return { steps };
}

/**
 * Typing time the plan asks of a player at the given baseline, ms.
 *
 * Used to hold D51's "~20 s" to account: the remainder of the budget is
 * Shadow's three spoken lines and the transitions between them, so the typing
 * itself must fit well inside RITUAL_BUDGET_MS.
 */
export function estimateRitualTypingMs(
  plan: RitualPlan,
  calibration: Calibration,
): number {
  let total = 0;
  for (const step of plan.steps) {
    for (const word of step.words) {
      total +=
        calibration.fkLatencyMs + Math.max(0, word.length - 1) * calibration.ikiMs;
    }
  }
  return total;
}
