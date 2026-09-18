import type { Calibration } from "../types.js";

/**
 * The three-step pre-flight ritual (D81, PRD AC-11.1).
 *
 * D81 fixes the steps and what each one is for:
 *   Hull check    - 1 short word      -> first-key latency
 *   Systems check - 3-4 short words   -> inter-key interval
 *                   (AMENDED to 4-5 by UR-101.3; see the spec below)
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
 * start latencies in too, giving six or seven samples (UR-101.3; it was five
 * or six before the systems check gained a word).
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
    /**
     * 4-5, NOT D81'S 3-4 (UR-101.3, a deliberate amendment to D81's word counts
     * rather than a drift).
     *
     * ================== WHY ANY MORE AT ALL ==================
     * The project owner asked for more words in the ritual. The ritual is what
     * measures `ikiMs` and `fkLatencyMs`, and both feed FR-8's fall budget, so
     * this is one of the few requests where "more game" and "better data" point
     * the same way.
     *
     * ================== WHY THEY LAND HERE ==================
     * Measured, not chosen. `engines` cannot grow: it wants a 7-13 letter word,
     * `en/mars` ships exactly ONE and `hi` ships none at four stops, so raising
     * it to 2 makes `planRitual` return null there - which is the screen with
     * nothing to type that UR-28 was about. `hull` sets `contributesIki` false
     * on purpose, so a word added there buys a latency and no intervals.
     * `systems` is the interval step and has the pool depth.
     *
     * ================== WHY ONE MORE AND NOT TWO ==================
     * THE OWNER ASKED FOR "A COUPLE" AND THE SECOND ONE DOES NOT FIT. 5-6 was
     * built, measured and backed out, because it turns
     * `launchCeremony.test.ts`'s slow-baseline budget check red:
     *
     *   estimateRitualTypingMs(plan, { ikiMs: 600, fkLatencyMs: 700 })
     *   expected 20_500 to be less than 20_000
     *
     * That is D51's whole ~20 s budget, blown by a grade-2 pilot, in the mode
     * that runs SIX times on a route out to Pluto (`planLaunchCeremony`
     * delegates here, UR-57). It is precisely the "do not make a grade-2 child
     * type an essay before they can play" the brief asked to be checked, and it
     * checked red. The budget is D51's number and is not this lane's to move.
     *
     * ================== WHAT ONE MORE BOUGHT, MEASURED ==================
     * Across all 18 stop/language pairs at 64 seeds each, per plan:
     *
     *            words   fk samples     iki samples    typing @ FR-8 default
     *   3-4      5-6     avg 5.5        avg 17.7       worst 13_150 ms
     *   4-5      6-7     avg 6.5        avg 20.8       worst 15_050 ms
     *   (5-6)    7-8     avg 7.5        avg 24.0       worst 16_950 ms
     *
     * +18% on both medians' sample counts, i.e. roughly 9% tighter, for 1.9 s of
     * worst-case typing. Plans that come back null: 256 of 1152 before and 256
     * of 1152 after - the same four Hindi stops with no long word, not one new
     * failure. 5-6 is in `gauntlet/escalations.md` with this table if the owner
     * wants the second word and is willing to move D51's budget for it.
     */
    minWords: 4,
    maxWords: 5,
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
 *
 * Exported because `launch.ts` picks the launch ceremony's words the same way
 * (D99) and a second copy of a randomness primitive is a second place for the
 * fixed-seed guarantee to drift.
 */
export function shuffleInPlace(arr: string[], rng: () => number): void {
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

  shuffleInPlace(short, rng);
  shuffleInPlace(long, rng);

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

// ---------------------------------------------------------------------------
// THE PROMPT ASSIST: the pre-flight screen never traps a child (D99, D100)
// ---------------------------------------------------------------------------

/**
 * How long a pre-flight prompt waits on a word before moving on by itself, as a
 * multiple of what the game estimates the word costs this child.
 *
 * WHY THIS EXISTS AT ALL. The pre-flight screen's typing phase used to be
 * driven entirely by keystrokes, with nothing timing it out, in BOTH of its
 * modes. A child who cannot type the prompt word never advanced - not after a
 * retry, not eventually. For the launch ceremony (D99) that meant six locked
 * doors on a route. For the FULL first-run ritual (D100, `UR-31`) it meant the
 * first screen with typing that a brand-new player ever sees was unreachable by
 * design for exactly the child this game is for: a seven-year-old who cannot
 * yet type `hull`.
 *
 * ONE MECHANISM, NOT TWO. D99 solved this for the ceremony and D100 adapts the
 * same numbers to the ritual rather than inventing a second rule, which is why
 * these constants live in `ritual.ts` and are named for the screen instead of
 * for either mode.
 *
 * Three times the estimate, so a child typing at their own measured pace is
 * never interrupted - they finish at 1x - while a child who is stuck, has
 * walked away, or cannot read the word is carried on anyway. Nothing about it
 * is punitive: no message, no mark, no tally, no "let's try that again"
 * (D31, AC-22b.1). The row lights and the sequence continues, exactly as it
 * does for a word that was typed.
 */
export const PREFLIGHT_ASSIST_FACTOR = 3;

/**
 * Floor under the assist window, ms. At the shipped baseline three times the
 * estimate of a four-letter word is 4.6 s, which is short enough to interrupt a
 * child who is simply reading. Five seconds is past that for every word the
 * screen can show at that baseline.
 */
export const PREFLIGHT_ASSIST_FLOOR_MS = 5_000;

/**
 * Ceiling on the assist window, ms - and the one place where two requirements
 * genuinely pull against each other.
 *
 * Without a ceiling the window scales without bound: a pilot with a 1200 ms
 * baseline gets 19.8 s on a single five-letter word, so a screen they never
 * touch outlasts D51's whole ~20 s ritual - and the first-run ritual shows six
 * words, which would strand them for two minutes. With one, the screen is
 * bounded, at the cost that a pilot slower than about 1000 ms per key can be
 * carried past a long word they were still working on.
 *
 * BOUNDED WINS, and the reason is that being carried past costs that child
 * nothing: the row lights, whatever they typed still counts toward the
 * measurement, nothing is marked, and they fly. Sitting on a screen they cannot
 * finish costs them the game. The clamp is on the cheap failure, the same way
 * `LAUNCH_MAX_TIGHTEN` is.
 *
 * At the baselines that actually occur this never fires on a short word: a
 * grade-2 pilot at 600 ms needs 3.1 s for a five-letter word and is given 7 s.
 */
export const PREFLIGHT_ASSIST_CEILING_MS = 7_000;

/**
 * How many words in a row the assist may carry a child past before the screen
 * stops asking altogether (D100).
 *
 * The ritual shows six words. Six untouched assist windows is 42 s of a child
 * watching a word they cannot type, on top of the sequence's own beats - twice
 * D51's budget, and every second of it after the second word tells the game
 * nothing it did not already know. Two in a row is the point at which the
 * screen has learned what it is going to learn; the remaining rows light on
 * their own, Shadow finishes his line, and the child flies.
 *
 * A single word carried past does NOT count against the next one: the counter
 * resets whenever a word is completed, so a child who stalls on `navigate` and
 * then types `sky` is still being measured.
 */
export const PREFLIGHT_ASSIST_GIVE_UP = 2;

/**
 * How long the screen should wait on one prompt before carrying the child past
 * it, ms.
 *
 * Pure, and derived from what the game already believes about this child, so a
 * slower pilot gets a proportionally longer window rather than one number that
 * suits the median and rushes everybody else - inside the floor and ceiling
 * above.
 */
export function promptAssistMs(word: string, calibration: Calibration): number {
  const estimate =
    calibration.fkLatencyMs + Math.max(0, word.length - 1) * calibration.ikiMs;
  const scaled = Math.round(PREFLIGHT_ASSIST_FACTOR * estimate);
  if (scaled < PREFLIGHT_ASSIST_FLOOR_MS) return PREFLIGHT_ASSIST_FLOOR_MS;
  if (scaled > PREFLIGHT_ASSIST_CEILING_MS) return PREFLIGHT_ASSIST_CEILING_MS;
  return scaled;
}
