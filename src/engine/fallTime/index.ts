import { DEFAULT_CALIBRATION, type Calibration, type StopId } from "../types.js";
import { stopPaceDrop } from "../controller/stopBand.js";
import {
  MAX_LIVE_MAX,
  MAX_LIVE_MIN,
  concurrencyTarget,
  type Knobs,
} from "../controller/knobs.js";

/**
 * Fall time (D19, PRD FR-8, architecture section 4.1).
 *
 *   fallTime = clamp(len * 1.5 * player.ikiMs + 1200 * ease(word), 2500, 14000)
 *
 * The split is the whole idea (D19). Word LENGTH is motor cost and is VISIBLE:
 * the asteroid is bigger, so the player can see that a long word is a bigger
 * job. EASE is recognition cost and is INVISIBLE: it is this player's history
 * with this word. That is why AC-8.3 forbids any UI that maps size to speed -
 * showing the rule would turn an adaptive system into a judgement about the
 * child.
 *
 * Constants are first-pass and tunable (D69). They are exported so tests and
 * the PRD can be diffed against each other rather than against magic numbers.
 *
 * UR-51: THE FORMULA ABOVE IS THE BUDGET FOR A ONE-DEEP BOARD. It budgets a
 * rock for reading and typing and not for WAITING, and every rock on a deeper
 * board is waiting. The whole expression is therefore multiplied by
 * `fallBudgetFactor`, which is the controller's own `concurrencyTarget` and is
 * exactly 1 at `MAX_LIVE_MIN` - so the line above is still, byte for byte, the
 * fall time the gentlest belt flies. See `fallBudgetFactor` for why this is not
 * a new global constant.
 *
 * UR-72: AND THE 1200 IS ONE IMAGINED READER'S READING SPEED. It is the budget
 * for a pilot typing at FR-8's own default interval, and it was applied flat to
 * every child - so it over-served a fast reader and under-served a slow one out
 * of the same constant. A new word is granted 1200 x `EASE_NEW` = 1920 ms to be
 * READ, and this project's own grade-2 model needs 2400. Both halves of FR-8
 * now follow the pilot's MEASURED interval, on one axis (`headroomEarned`):
 * `keystrokeHeadroom` for the typing half, `recognitionBaseMs` for the reading
 * half. At FR-8's default interval, and at everything faster, the line above is
 * unchanged to the byte. See `recognitionReaderBaseMs`.
 */

/**
 * Multiplier on the player's median inter-key interval (PRD FR-8), i.e. the
 * typing budget with 50% headroom. This is the value at `MAX_LIVE_MIN` and it
 * is FR-8's literal constant; `keystrokeHeadroom` is what a pilot who has
 * earned it flies instead.
 */
export const KEYSTROKE_BUDGET_FACTOR = 1.5;

/**
 * The headroom a pilot at the top of the knob gets instead: 12.5% (UR-51).
 *
 * ================== WHY THE HEADROOM HAD TO MOVE ==================
 * FR-8 budgets a word at `len * 1.5 * iki`, so a pilot who types at their own
 * measured speed spends two thirds of the typing budget and the other third is
 * slack - and measured over a route, a fast pilot's rocks left the board with
 * 53% of the WHOLE budget unused (`./margin.ts` has the four-pilot table). That
 * is why every difficulty change before this one could only ever add words and
 * never take away time: a busier board cost a fast pilot nothing, because the
 * slack absorbed it. `gauntlet/evidence/route-occupancy.json` recorded the
 * board going from 1.00 rocks to 3.35 with the closest approach to the breach
 * line barely moving.
 *
 * So the headroom is the thing that gets spent. At `MAX_LIVE_MIN` it is FR-8's
 * 1.5 exactly - the same byte, for a new profile and for any pilot the
 * controller has not moved - and it ratchets to 1.125 at `MAX_LIVE_MAX` for a
 * pilot whose measured speed has earned it (`HEADROOM_SLOW_IKI_MS`).
 *
 * ================== IT IS NOT A NEW KNOB (AC-10.4) ==================
 * The knob set is still exactly {maxLive, lengthBias}. This is a FUNCTION of
 * the primary knob, the way `concurrencyTarget` is, so it inherits every
 * property the knob already has: it moves one step per stage (D20, AC-10.1),
 * it is persisted on the profile with the knob, and a loosen - including the
 * one `beginStall` forces - ratchets it straight back. Adding a third knob
 * would have needed its own schema field, its own migration, and its own
 * proof that all three never move in one stage.
 *
 * ================== AND IT IS WHY THE CLIMB TERMINATES ==================
 * `@engine/controller` now tightens on margin rather than on hit rate, and this
 * is the term that spends margin. Without it the controller would read a
 * quantity no knob could move and climb to the cap for everybody, which is the
 * defect it was changed to fix. The two halves are one loop.
 */
export const KEYSTROKE_HEADROOM_MIN = 1.125;

/**
 * The typing speed at which NONE of the ratchet is available, ms between keys.
 *
 * ================== WHY THE KNOB IS NOT ENOUGH ON ITS OWN ==================
 * The knob says how deep the board is; it does not say who is flying it. Forced
 * to `MAX_LIVE_MAX` with the ratchet on the knob alone, the grade-2 pilot
 * stalled 23 of 240 route-belts against the 3 on record - measured, in
 * `tests/unit/simulation/launchRoute.test.ts`, not predicted. The margin gate in
 * `@engine/controller` makes that state hard to reach, and "hard to reach" is
 * not the same claim as "safe", and UR-51's constraint is the second one.
 *
 * ================== WHERE 600 COMES FROM ==================
 * It is the grade-2 model this repo has measured against since the belt-stall
 * investigation - `ikiMs: 600`, used by `tests/unit/simulation/belt.test.ts`,
 * `tests/unit/flight/beltConcurrency.test.ts` and the route sweep. At that speed
 * the measured margin is 0.171, below `TIGHTEN_MARGIN_ABOVE` (0.35): by the
 * controller's own measure that pilot has no slack to spend, so none is taken.
 * The interpolation runs from FR-8's own default (350 ms) to here, so:
 *
 *     iki      260*   350    440    600+
 *     earned   1.00   1.00   0.64   0.00
 *
 * (*) The flight scene floors the calibration it hands fall time at
 * FR-8's default, so the engine never sees a value below 350 on the real path -
 * that clamp is a LOOSENING rule and predates this. It is why the ratchet is
 * full at the default rather than only below it, and why a pilot faster than
 * the default earns the same full ratchet as one exactly at it.
 */
export const HEADROOM_SLOW_IKI_MS = 600;

/** Recognition budget at ease 1.0, in ms (PRD FR-8: BASE). */
export const RECOGNITION_BASE_MS = 1200;

/**
 * Recognition budget at ease 1.0 for a pilot measured at `HEADROOM_SLOW_IKI_MS`
 * or slower, in ms (UR-72).
 *
 * ================== THE DEFICIT THIS CLOSES ==================
 * A brand-new word is granted `RECOGNITION_BASE_MS x EASE_NEW` = 1920 ms to be
 * READ. This repo's own supported-tail model - the grade-2 pilot that
 * `tests/unit/simulation/belt.test.ts`, `tests/unit/flight/beltConcurrency.test.ts`
 * and the route sweep have measured against since the belt-stall investigation -
 * needs `coldRecognitionMs` 2400 ms for a word it has not seen. The shipped
 * budget is 480 ms short of that on EVERY first exposure, and it has always
 * been short: a flat base is one imagined reader's reading speed applied to
 * every child.
 *
 * ================== WHY NOBODY SAW IT ==================
 * The pools are 26-32 words against 58 spawns, so a child meets almost every
 * word TWICE inside one belt and the second exposure is what clears it. The
 * deficit is real in the shipped game and invisible in it, and the thing it
 * blocks is word variety: measured on the route gate, 58 words a stop takes the
 * grade-2 pilot from 3 stalls in 240 belts to 37, and 80 words a stop to 240 of
 * 240. Capping word length does not move it (max 12 -> 74, max 9 -> 77 at a
 * fixed 30 words a stop); adding only three- and four-letter words still moves
 * it. The bound is pool SIZE, because size is what surfaces cold reads. UR-72
 * has the whole measurement.
 *
 * ================== WHERE 1500 COMES FROM ==================
 * It is DERIVED, not judged: 2400 / `EASE_NEW` = 1500, i.e. the base at which a
 * new word's reading budget exactly meets the supported tail pilot's modelled
 * cold-read time. It is anchored at `HEADROOM_SLOW_IKI_MS` for the same reason
 * the ratchet is - that is the speed at which this project's own controller
 * measures no slack left to spend (margin 0.171, below `TIGHTEN_MARGIN_ABOVE`).
 *
 * ================== AND WHY IT IS NOT A FLAT RAISE ==================
 * Raising `RECOGNITION_BASE_MS` itself would hand a fast pilot 300 ms more
 * reading time at exactly the moment `RECOGNITION_EARNED_BASE_MS` is trying to
 * take 16 ms away, and "too easy" is the report on file four times. So this is
 * the SLOW END of the same axis `headroomEarned` already measures: at FR-8's
 * default interval and anything faster it contributes exactly nothing, and a
 * pilot only reaches it by being measured slower than FR-8's own default. See
 * `recognitionReaderBaseMs`.
 */
export const RECOGNITION_SLOW_BASE_MS = 1500;

/**
 * Recognition budget at ease 1.0 for a pilot at the top of the knob whose
 * measured speed has earned it, in ms (UR-51).
 *
 * ================== WHY THE READING HALF HAD TO MOVE TOO ==================
 * `keystrokeHeadroom` ratchets the TYPING half and nothing ratchets this one,
 * and on the words a fast pilot actually meets this one is the larger term. At
 * FR-8's default interval a three-letter word budgets ~1170 ms of typing
 * against 1920 ms of reading at `EASE_NEW`: more than half the grant is a
 * constant that no knob, no calibration and no amount of skill can move. That
 * is why the route stayed flat after the first pass - the knob was spending
 * from the smaller of the two halves.
 *
 * ================== AND WHY THE TYPING HALF COULD NOT DO IT ALONE =========
 * Measured, not assumed. `FlightScene.fallTimeCalibration` floors the interval
 * fall time reads at FR-8's default, because calibration is a LOOSENING rule
 * and may never shorten a fall. So a pilot who types at 260 ms is budgeted at
 * 350 ms, and `keystrokeHeadroom`'s whole travel - 1.5 down to 1.125, a 25% cut
 * - is almost exactly the 35% padding that floor already handed them. Against
 * their real hands the ratchet lands back on FR-8's original 50% headroom. The
 * typing lever is therefore already spent at the top of the route for exactly
 * the pilot this ticket is about, and the reading half is the only one left
 * that reaches them.
 *
 * ================== WHERE 700 COMES FROM ==================
 * It is the one number in this file that was not computed. The project owner
 * flew a build with `RECOGNITION_BASE_MS` flat at 700 after finishing the whole
 * route at 1200 and reporting it very easy, and reported the 700 build as much
 * better (UR-51). Every other value here is measured; this one is a judgement
 * about feel, which is the thing a simulation cannot return.
 *
 * WHAT THE OWNER FLEW IS NOT WHAT THIS SHIPS, and the difference is the safety.
 * That build applied 700 to every pilot at every stop, including a grade-2
 * child on their first belt - measured over the route sweep, that is a hit rate
 * of 0.5939 and 196 stalls in 240 belts against the 3 on record. So 700 is
 * taken as the FLOOR of a ratchet rather than as a new constant: 1200 at
 * `MAX_LIVE_MIN`, 1200 at `HEADROOM_SLOW_IKI_MS` whatever the knob says, and
 * 700 only at the top of the knob for a pilot whose measured interval and whose
 * margin have both earned it.
 *
 * ================== WHY IT IS 1185 AND WAS 1184 (C20) ==================
 * This value is the SMALLEST the recognition ratchet may reach while UR-51-B's
 * answerable-depth invariant still holds: FR-8's one-deep budget must be at
 * least `expectedClearMs` for every pilot at every knob setting, or the belt
 * stands a queue deeper than the budget can serve and drops the back of it on
 * the child's hull. 1184 was computed against the clamp floor UR-51 scaled by
 * the queue depth, and that floor was MASKING a shortfall rather than
 * satisfying the invariant: with C20's literal floor the worst cell is a fast
 * pilot's two-letter word "go" at `MAX_LIVE_MAX`, which read
 *
 *     fast @ maxLive 7: expected 3.999032258064516 to be greater than or
 *     equal to 4
 *
 * i.e. the invariant was 0.024% short in the budget and held only by a clamp.
 * At 1185 the same cell reads 4.002 and every other cell in the four-pilot x
 * six-setting grid clears with room. It costs a fast pilot 1.6 ms of fall time
 * at the top of the knob - `tests/unit/fallTime/fallTime.test.ts` sweeps the
 * grid - and it buys back an invariant that was being satisfied by the wrong
 * mechanism.
 */
export const RECOGNITION_EARNED_BASE_MS = 1185;

/**
 * Floor on the inter-key interval FALL TIME may be computed from, ms (UR-51).
 *
 * ================== WHAT THIS REPLACED, AND WHY IT WAS THE BUG ============
 * `FlightScene.fallTimeCalibration` floored the interval at FR-8's DEFAULT,
 * 350 ms. Calibration is a loosening rule - it may lengthen a fall for a child
 * the default is too quick for and never shorten one - and that rule is right.
 * Using the DEFAULT as its floor was not: it capped every child at the speed of
 * a beginner for ever. A pilot who types at 260 ms, and whose stored baseline
 * had correctly refined to 260 ms through `refineStoredCalibration` at every
 * stage end, was still budgeted at 350. Downward refinement was measured,
 * persisted, and then discarded at the one place it would have been felt.
 *
 * That is why every difficulty pass before this one left the early stops
 * untouched: measured over a route, a fast pilot's budget ran 2.31x their own
 * work at Mars and no knob could move it, because the knob scales a term the
 * floor had already inflated by 35%.
 *
 * ================== WHY 120 IS A SAFETY BOUND AND 350 WAS NOT =============
 * The floor's legitimate job is to stop a corrupt or absurd baseline making the
 * game impossible. 120 ms/key is a sustained ~100 WPM. `MIN_IKI_MS` (40 ms, the
 * per-SAMPLE bound) is documented as "roughly 300 WPM sustained; no child
 * produces that"; 120 is three times that bound and still far beyond any child
 * this game is for, and beyond most adults. A stored median below it is not a
 * fast typist, it is a corrupted profile - so the floor still catches exactly
 * what it was built to catch, and stops catching competence.
 *
 * It remains a FLOOR, in the loosening direction only. Nothing here lets a
 * measurement lengthen into a shorter fall than the child's own hands justify,
 * and `headroomEarned` still exempts a slow pilot from every ratchet.
 */
export const FALL_TIME_MIN_IKI_MS = 120;

/**
 * The interval fall time may be computed from, given what the profile stores.
 *
 * Lives here rather than in the scene because it is a rule about FR-8's budget,
 * and a rule about the budget that lives in a Phaser scene is a rule no unit
 * test sweeps. `FlightScene.fallTimeCalibration` is now a call to this.
 */
export function fallTimeIkiMs(ikiMs: number): number {
  return Number.isFinite(ikiMs)
    ? Math.max(FALL_TIME_MIN_IKI_MS, ikiMs)
    : DEFAULT_CALIBRATION.ikiMs;
}

/** Clamp bounds, ms (PRD FR-8: MIN 2.5 s, MAX 14 s). */
export const FALL_TIME_MIN_MS = 2500;
export const FALL_TIME_MAX_MS = 14000;

// ---------------------------------------------------------------------------
// PER-ROCK SPREAD (UR-83)
// ---------------------------------------------------------------------------

/**
 * How much SLOWER than FR-8's budget a rock may be granted, as a fraction.
 *
 * ================== THE REPORT ==================
 * "Some rocks should fly by fast - a second or two to type - and some slower."
 * They do not. A rock's fall time is a near-deterministic function of its
 * length and its ease, so at a low knob setting, where ease is near 1.0 for
 * everything and the pools are length-tight, every rock on the board falls at
 * about the same speed. A belt with no variance is a metronome, and a metronome
 * is the thing the owner has been calling boring.
 *
 * ================== WHY IT IS A MULTIPLE AND NOT MILLISECONDS ============
 * Because it has to scale off the same measured interval the rest of this file
 * does. A flat "+/- 900 ms" is a huge change for a fast pilot's 2.8 s rock and
 * noise on a grade-2 pilot's 9 s one, which is the SAME defect
 * `RECOGNITION_BASE_MS` had before UR-72: one imagined reader's numbers applied
 * to every child. A multiple of the whole expression keeps D19's split intact -
 * length is still motor cost, ease is still recognition cost, their ratio is
 * FR-8's ratio - and it means a fast typist's "slow rock" is still quick in
 * absolute terms, and a slow typist's "fast rock" is still one they can reach.
 *
 * ================== FR-8'S BOUNDS ARE UNTOUCHED ==================
 * The spread is applied inside `rawFallTimeMs`, i.e. BEFORE `clampFallTime`, so
 * the 2500 ms floor and the 14000 ms ceiling (each scaled by the queue depth,
 * as they already were) bound the result exactly as they did. Nothing here can
 * produce a rock outside FR-8's window.
 */
export const FALL_SPREAD_UP = 0.3;

/**
 * How much FASTER than FR-8's budget a rock may be granted, as a fraction -
 * and it is EARNED, which is the whole safety argument.
 *
 * The downward half is scaled by `headroomEarned`, the same axis
 * `keystrokeHeadroom` and `recognitionBaseMs` ratchet on. So:
 *
 *     iki      260*   350    440    520    600+
 *     range    0.70   0.70   0.81   0.90   1.00   .. 1.30
 *              -----  -----  -----  -----  ----
 *              (the fastest rock this pilot can be handed, as a multiple)
 *
 * A pilot measured at `HEADROOM_SLOW_IKI_MS` or slower is NEVER handed a rock
 * shorter than FR-8's budget: their spread runs 1.00 to 1.30, i.e. entirely in
 * the direction that gives time back. That is not a hope about a simulation -
 * it is arithmetic, and it means the variance cannot raise the grade-2 stall
 * rate at any knob setting, on any stop, for any word.
 *
 * Symmetric with `FALL_SPREAD_UP` at the fast end, so a pilot who has earned
 * the whole range gets a belt whose rocks run 0.70x to 1.30x - a factor of
 * nearly two between the quickest and the slowest rock on the same board, which
 * is what "some fly by, some are slow" has to mean to be visible.
 *
 * ================== 0.3 IS MEASURED, NOT CHOSEN ==================
 * It is the widest spread that costs NO pilot a belt anywhere on the route.
 * The route sweep (40 seeds x 6 belts x 5 pilots, the real controller carried
 * stop to stop) reads 0 stalls out of 240 for every pilot at 0.3. At 0.45 the
 * identical sweep reads
 *
 *     median  3 stalls at jupiter      slow  2 stalls at saturn
 *
 * and it is the MEDIAN pilot that breaks first, not the grade-2 one - the
 * `earned` scaling exempts the tail completely, so the pilot at risk is the one
 * at FR-8's own default interval who has earned the whole ratchet and types at
 * 93% accuracy. The 0.02 of margin that width bought at the ceiling (0.426 ->
 * 0.406 for a ~100% pilot at Mars' ceiling) is not worth a belt.
 */
export const FALL_SPREAD_DOWN = 0.3;

/**
 * The multiple this rock's fall budget is scaled by, from one uniform draw.
 *
 * `spread` is a 0..1 sample from the belt's own SEEDED rng, taken once at spawn
 * and stored on the rock, so a replay of the same seed is identical - the rule
 * `@engine/spawn` follows for the column and `FlightScene` follows for the
 * drift phase. `undefined` returns exactly 1, so every caller that does not
 * draw one flies FR-8's budget byte for byte; that is what keeps
 * `tests/unit/fallTime/fallTime.test.ts`'s `toBe` sweeps meaningful.
 *
 * Total: a non-finite draw reads as the CENTRE rather than as NaN, because a
 * corrupt sample must never be able to hand a child a rock with no deadline.
 */
export function fallSpreadFactor(spread?: number, ikiMs?: number): number {
  if (spread === undefined || !Number.isFinite(spread)) return 1;
  const u = Math.min(1, Math.max(0, spread));
  const t = 2 * u - 1;
  if (t >= 0) return 1 + t * FALL_SPREAD_UP;
  const earned = headroomEarned(ikiMs ?? DEFAULT_CALIBRATION.ikiMs);
  return 1 + t * FALL_SPREAD_DOWN * earned;
}

/**
 * How much of the ratchet this player's measured typing speed has earned, 0..1.
 *
 * See `HEADROOM_SLOW_IKI_MS` for the anchor and the measurement. Total: a
 * non-finite calibration reads as the slowest pilot, i.e. earns nothing, which
 * is the only direction a corrupt value may move a child's belt.
 */
export function headroomEarned(ikiMs: number): number {
  const iki = Number.isFinite(ikiMs) ? ikiMs : HEADROOM_SLOW_IKI_MS;
  // `Math.max(1, ...)` rather than a guard: the span is a difference of two
  // constants, so a guard on it would be a branch no test could ever reach and
  // an uncoverable branch is how the 95% gate gets argued with instead of met.
  const span = Math.max(1, HEADROOM_SLOW_IKI_MS - DEFAULT_CALIBRATION.ikiMs);
  return Math.min(1, Math.max(0, (HEADROOM_SLOW_IKI_MS - iki) / span));
}

/**
 * How much headroom over this player's own typing speed the budget grants, at
 * this setting of the primary knob and this measured speed (UR-51).
 *
 * At FR-8's default interval, or anything faster:
 *
 *     maxLive   2      3      4      5      6      7
 *     headroom  1.500  1.425  1.350  1.275  1.200  1.125
 *
 * A slower pilot keeps more of it at every setting, in proportion to
 * `headroomEarned`; at `HEADROOM_SLOW_IKI_MS` and beyond the row above is
 * flat 1.500 and the belt is FR-8's, whatever the knob says.
 *
 * Continuous across FR-10's 2..7 for the reason `concurrencyTarget` is: the
 * knob moves one step per stage (D20, AC-10.1) and a headroom that dropped in
 * visible jumps would make one stage boundary in three a cliff.
 *
 * TWO INDEPENDENT FLOORS, AND BOTH ARE EXACT. At `MAX_LIVE_MIN` this is exactly
 * `KEYSTROKE_BUDGET_FACTOR` for every pilot, and at `HEADROOM_SLOW_IKI_MS` it
 * is exactly `KEYSTROKE_BUDGET_FACTOR` at every knob setting. So the belt a new
 * profile flies and the belt a grade-2 pilot flies are both FR-8's formula
 * unchanged, byte for byte - UR-51's hard constraint, as a property of this
 * function rather than as a hope about a simulation.
 * `tests/unit/fallTime/fallTime.test.ts` sweeps every shipped word at every
 * pilot speed against the pre-change value.
 *
 * A corrupt knob reads as the floor rather than as NaN - same rule as
 * `clampKnobs` and `concurrencyTarget`: a restored profile must never be able
 * to stop a child's game.
 */
export function keystrokeHeadroom(maxLive: number, ikiMs?: number): number {
  const span = MAX_LIVE_MAX - MAX_LIVE_MIN;
  const live = Number.isFinite(maxLive) ? Math.floor(maxLive) : MAX_LIVE_MIN;
  const steps = Math.min(span, Math.max(0, live - MAX_LIVE_MIN));
  const earned = headroomEarned(ikiMs ?? DEFAULT_CALIBRATION.ikiMs);
  return (
    KEYSTROKE_BUDGET_FACTOR +
    (steps / span) * earned * (KEYSTROKE_HEADROOM_MIN - KEYSTROKE_BUDGET_FACTOR)
  );
}

/**
 * The typing half of the budget: how long we expect THIS player to need to
 * physically type a word of this length, with headroom.
 *
 * `headroom` defaults to FR-8's literal 50%, so every existing caller and the
 * PRD's own formula are unchanged. `fallTimeMs` passes `keystrokeHeadroom` of
 * the current knob instead (UR-51).
 */
export function keystrokeBudgetMs(
  length: number,
  ikiMs: number,
  headroom: number = KEYSTROKE_BUDGET_FACTOR,
): number {
  return length * headroom * ikiMs;
}

/**
 * The recognition half: how long we expect them to need to READ it.
 *
 * `base` defaults to FR-8's literal 1200 ms, so every existing caller and the
 * PRD's own formula are unchanged. `rawFallTimeMs` passes `recognitionBaseMs`
 * of the current knob and this player's measured interval instead (UR-51,
 * UR-72), which is 1200 exactly at FR-8's own default interval.
 */
export function recognitionBudgetMs(
  ease: number,
  base: number = RECOGNITION_BASE_MS,
): number {
  return base * ease;
}

/**
 * The recognition base this rock is budgeted against, at this setting of the
 * primary knob and this measured speed (UR-51, UR-72), in ms.
 *
 * ================== THE WHOLE SURFACE, IN ONE TABLE ==================
 *
 *     maxLive        2       3       4       5       6       7
 *     iki 260/350  1200    1197.0  1194.0  1191.0  1188.0  1185     (ratchets)
 *     iki 440      1308    1306.1  1304.2  1302.2  1300.3  1298.4
 *     iki 520      1404    1403.1  1402.1  1401.2  1400.2  1399.3
 *     iki 600+     1500    1500    1500    1500    1500    1500     (flat)
 *
 * TWO ENDS OF ONE AXIS, AND BOTH ARE THE SAME DEFECT. `headroomEarned` is the
 * only thing either end reads. Above it, the knob ratchets the reading budget
 * down for a pilot whose measured speed has earned it (UR-51). Below it,
 * `recognitionReaderBaseMs` raises it for a pilot FR-8's default does not
 * describe (UR-72). A flat 1200 over-served the first and under-served the
 * second simultaneously, out of one constant.
 *
 * THE TWO FLOORS THAT REMAIN EXACT. At `MAX_LIVE_MIN` this is exactly
 * `RECOGNITION_BASE_MS` for every pilot at or faster than FR-8's default
 * interval - so the belt a NEW PROFILE flies (D18's cold start, which is the
 * one moment the game has measured nobody) is FR-8's formula byte for byte. And
 * the knob can only ever take reading time away, never add it: the ratchet term
 * is scaled by `headroomEarned`, which is zero for exactly the pilot the reader
 * base has raised.
 *
 * THE GRADE-2 FLOOR MOVED, ON PURPOSE, AND IT IS PINNED WHERE IT LANDED. It
 * used to be flat 1200 at `HEADROOM_SLOW_IKI_MS`, i.e. FR-8's formula unchanged
 * for that child; it is now flat 1500, which is 2400 ms of reading time for a
 * new word against the 1920 ms that was 480 ms short of this project's own
 * grade-2 model (UR-72). `tests/unit/fallTime/fallTime.test.ts` sweeps every
 * shipped word at every knob setting against the NEW floor and compares with
 * `toBe`, at the same standard the old floor was held to.
 *
 * IT IS NOT A NEW KNOB (AC-10.4). The knob set is still exactly
 * {maxLive, lengthBias}; this is a FUNCTION of the primary knob, like
 * `concurrencyTarget` and `keystrokeHeadroom`, so it moves one step per stage
 * (D20, AC-10.1), it is persisted with the knob, and a loosen ratchets it back.
 * The reader term is not a knob at all - it is a reading of the calibration the
 * profile already stores, exactly as `keystrokeHeadroom`'s is.
 *
 * Continuous across FR-10's 2..7 for the reason the other two are: the knob
 * moves one step per stage and a base that dropped in visible jumps would make
 * one stage boundary in three a cliff.
 *
 * A corrupt knob reads as the knob's floor and a corrupt calibration reads as
 * the SLOWEST pilot - both the direction that grants more reading time, which is
 * the only direction a bad value may move a child's belt.
 */
export function recognitionBaseMs(maxLive: number, ikiMs?: number): number {
  const span = MAX_LIVE_MAX - MAX_LIVE_MIN;
  const live = Number.isFinite(maxLive) ? Math.floor(maxLive) : MAX_LIVE_MIN;
  const steps = Math.min(span, Math.max(0, live - MAX_LIVE_MIN));
  const iki = ikiMs ?? DEFAULT_CALIBRATION.ikiMs;
  const earned = headroomEarned(iki);
  return (
    recognitionReaderBaseMs(iki) +
    (steps / span) * earned * (RECOGNITION_EARNED_BASE_MS - RECOGNITION_BASE_MS)
  );
}

/**
 * The reading budget this PILOT is owed at ease 1.0, before the knob touches
 * it, in ms (UR-72).
 *
 *     iki     260*   350    440    520    600+
 *     base    1200   1200   1308   1404   1500
 *
 * (*) A pilot faster than FR-8's default reads the same base as one exactly at
 * it, the same way `headroomEarned` treats them the same - and for the same
 * reason: this is a LOOSENING rule, and a measurement may never shorten a fall.
 *
 * ================== WHY THIS IS THE SAME FIX IN BOTH DIRECTIONS ============
 * A flat 1200 ms over-serves a fast reader and under-serves a slow one at the
 * same moment, out of the same constant. `keystrokeHeadroom` already makes the
 * TYPING budget follow the pilot; this is the reading budget doing it, on the
 * SAME `headroomEarned` axis so the two cannot disagree about who is slow. At the
 * FAST end of that axis the knob still ratchets 1200 -> 1184 for a pilot whose
 * measured speed has earned it (`recognitionBaseMs`); at the SLOW end, a pilot
 * the ratchet never reaches gets the reading time their measured hands say they
 * need. One axis, both ends, no new knob.
 *
 * ================== WHAT IT DOES NOT DO ==================
 * It cannot LOOSEN a fast pilot's belt. `headroomEarned` is 1 at FR-8's default
 * interval and at everything faster, so the second term is zero and the value is
 * `RECOGNITION_BASE_MS` to the byte, for every profile the game has not measured
 * as slower than its own default - which is every new profile (D18's cold
 * start), and every pilot whose measured interval is 350 ms or shorter. The
 * ratchet is therefore still the only thing that moves for them, and it still
 * only moves down.
 *
 * FR-8'S FORMULA IS UNCHANGED AT FR-8'S OWN CALIBRATION. The PRD states BASE as
 * 1200 alongside a default interval of 350 ms; at that interval this returns
 * 1200, so `fallTimeMs` is byte-for-byte the PRD's expression for the pilot the
 * PRD describes. A pilot measured SLOWER than FR-8's default is one the default
 * does not describe, and they are the only pilot this moves - upward, which is
 * the only direction a reading budget may safely move a child's belt.
 *
 * A corrupt or non-finite calibration reads as the SLOWEST pilot here, i.e. the
 * most reading time - the same rule `headroomEarned` follows, pointed the way
 * that gives a child time back rather than taking it.
 */
export function recognitionReaderBaseMs(ikiMs: number): number {
  return (
    RECOGNITION_BASE_MS +
    (1 - headroomEarned(ikiMs)) * (RECOGNITION_SLOW_BASE_MS - RECOGNITION_BASE_MS)
  );
}

/**
 * How much of FR-8's budget this rock gets, as a multiple (UR-42, UR-51).
 *
 * ================== THE BUDGET IS PER QUEUE, NOT PER ROCK ==================
 * FR-8's formula budgets a rock for the player to READ it and TYPE it. It does
 * not budget for the rock to WAIT, and on a board holding more than one rock
 * every rock but the front one is waiting. A player is a single server
 * (AC-2.1), so the Nth rock on the board waits N-1 service times before anyone
 * can touch it, and it falls throughout. FR-8's budget therefore affords
 * exactly floor(fall / service) answerable rocks, which at the shipped
 * constants is 1 for every pilot in every shipped pool
 * (gauntlet/evidence/belt-concurrency.json: 1.18 fast, 1.25 median, 1.38
 * grade-2). That is why UR-42's report - a board that never holds more than one
 * word-asteroid - could not be answered with `maxLive`, and it is what UR-51
 * decided to change.
 *
 * So the budget scales with the depth the controller is asking for. This is the
 * reason the scale is NOT a new global constant: a global would widen the
 * budget for the grade-2 child as well, which is precisely the trade UR-42
 * refused and the hard constraint on UR-51 forbids. At `MAX_LIVE_MIN` the
 * factor is exactly 1 and every fall time in the game is the byte it was.
 *
 * ================== THE SHAPE OF FR-8 IS UNTOUCHED ==================
 * A multiple, applied to the whole expression, so D19's split survives: length
 * is still motor cost and still visible, ease is still recognition cost and
 * still invisible, and their ratio at any knob setting is FR-8's ratio. Nothing
 * here can make one word cheap relative to another.
 *
 * ================== C22: THE DEPTH IS THE BOARD'S, NOT THE KNOB'S =========
 * `liveCount` is how many rocks were ALREADY on the board when this one
 * spawned, and it is the quantity this factor was always about.
 *
 * The multiplier exists so a rock can survive the queue AHEAD OF IT. It was
 * taken from `concurrencyTarget(maxLive)` - the depth the knob is ASKING FOR -
 * so a rock spawning onto an EMPTY board at Pluto was granted the same 3.5x
 * queueing allowance as a rock spawning behind four others, because the knob
 * said the board was allowed to hold seven. A rock with nothing ahead of it has
 * no queue to survive, and 3.5x of FR-8's budget for a rock that is served
 * immediately is simply 3.5x too long. Flown in a browser at Pluto at ~100%
 * accuracy, that is what 42-second rocks were made of.
 *
 *     rocks already live   0     1     2     3+
 *     factor (at ml 7)     1.0   2.0   3.0   3.5
 *     factor (at ml 4)     1.0   2.0   2.2   2.2
 *
 * THE CAP IS THE KNOB'S, so nothing here can grant MORE than UR-51 granted:
 * a rock that genuinely is at the back of a full board gets exactly what it
 * gets today, and at `MAX_LIVE_MIN` the cap is 1 so the cold-start belt (D18's
 * one measured moment) is FR-8's formula byte for byte whatever the board is
 * doing. Every caller that does not pass a count reads the knob's factor
 * exactly as before, which is what keeps the `toBe` sweeps in
 * `tests/unit/fallTime/fallTime.test.ts` meaningful.
 *
 * AND IT IS THE VARIANCE THE OWNER ASKED FOR, out of the game's own state
 * rather than out of a random draw: the first rocks of a belt fall fast and the
 * board slows as it fills, so "some rocks are genuinely much faster than
 * others" is a thing the belt DOES rather than a number a spread was asked to
 * fake. It costs no pilot anything on an empty board, because on an empty board
 * there is nothing to wait for.
 *
 * Total: a non-finite count reads as the knob's factor, i.e. the old behaviour,
 * which is the direction that gives a child more time.
 */
export function fallBudgetFactor(
  knobs?: Pick<Knobs, "maxLive">,
  liveCount?: number,
): number {
  const cap = concurrencyTarget(knobs?.maxLive ?? MAX_LIVE_MIN);
  if (liveCount === undefined || !Number.isFinite(liveCount)) return cap;
  return Math.min(cap, Math.max(1, Math.floor(liveCount) + 1));
}

/**
 * The multiple this STOP's belt scales the whole budget by (UR-84).
 *
 * ================== THE HALF OF THE ROUTE THAT WAS NOT THERE ==============
 * UR-83 gave the stop a `maxLive` band, so a later stop is a BUSIER board. It
 * gave the stop nothing about SPEED, so Pluto and Mars granted the same pilot
 * the same milliseconds for the same word - and "the game does not push me" is
 * a report about speed, raised repeatedly against a route whose only
 * progression was occupancy.
 *
 * `@engine/controller/stopBand.stopPaceDrop` owns the route's shape (0 at Mars,
 * `STOP_PACE_DROP` at Pluto, linear in `stageIndexOf` between them), for the
 * reason that file gives: one place for the route to be written down. This
 * function owns who EARNS it, which is the rule the rest of this file already
 * follows.
 *
 * ================== IT COMPOSES, IT DOES NOT REPLACE ==================
 * Scaled by `headroomEarned`, the same axis as `keystrokeHeadroom`,
 * `recognitionBaseMs` and `fallSpreadFactor`'s downward half. So the pace at
 * the last stop reads
 *
 *     iki      260*   350    440    520    600+
 *     pluto    0.80   0.80   0.87   0.94   1.00
 *
 * and a pilot measured at `HEADROOM_SLOW_IKI_MS` or slower flies EVERY stop at
 * FR-8's budget to the byte. A slow pilot at Pluto is therefore still given a
 * fall they can answer - by arithmetic, not by a simulation result - and the
 * ability curve is what decides how much of the route's shape reaches them.
 *
 * Absent or null is exactly 1, so every caller with no stop in hand flies FR-8's
 * budget byte for byte, which is what keeps the `toBe` sweeps in
 * `tests/unit/fallTime/fallTime.test.ts` meaningful.
 *
 * Total: a corrupt calibration reads as the SLOWEST pilot through
 * `headroomEarned`, i.e. no drop at all - the only direction a bad value may
 * move a child's belt.
 */
export function stopPaceFactor(stop?: StopId | null, ikiMs?: number): number {
  if (stop === null || stop === undefined) return 1;
  const earned = headroomEarned(ikiMs ?? DEFAULT_CALIBRATION.ikiMs);
  return 1 - stopPaceDrop(stop) * earned;
}

/**
 * Clamp against FR-8's MIN/MAX. The CEILING scales with the queue depth; the
 * FLOOR is FR-8's literal 2500 ms at every depth (UR-84, collision C20).
 *
 * ================== WHY THE CEILING SCALES ==================
 * It has to, or the mechanism fails silently for exactly the pilot it must not
 * fail for. A grade-2 pilot's five-letter word raws at 6420 ms; at a depth of 4
 * that is 25 680 ms, and against a fixed 14 000 ms ceiling it clamps back to a
 * fall/service ratio of 3.03 - so the belt would build a 4-deep queue and then
 * drop the back of it on the child's hull. That bound is part of the budget,
 * not a separate policy about it, so it moves with the budget. UR-51 is the
 * report and nothing here weakens it.
 *
 * ================== WHY THE FLOOR NO LONGER DOES (C20) ==================
 * UR-51 scaled BOTH bounds by `fallBudgetFactor`, and the floor was the half
 * that did not belong there. `concurrencyTarget` is 4 at `MAX_LIVE_MAX`, so the
 * SHORTEST fall the game could produce at Pluto's ceiling was 2500 x 4 =
 * 10 000 ms: at the exact moment the board is busiest, no rock could reach the
 * breach line in under ten seconds. Every mechanism built to make a rock quick
 * died at this line - UR-83's per-rock spread is applied before the clamp, so a
 * "fast" rock at a deep board was clamped straight back up to the floor and the
 * variance never reached the screen. The owner has reported "zero adrenaline"
 * against a belt whose floor rose every time it got busier.
 *
 * THE TWO BOUNDS ANSWER DIFFERENT QUESTIONS, which is why only one of them is
 * a function of the queue:
 *
 *   - the CEILING asks "can the back of the queue still be answered?". That is
 *     a question about the QUEUE, so it scales with the queue. UR-51's actual
 *     protection is this bound plus `@engine/pacing`'s spawn gap, and both are
 *     untouched.
 *   - the FLOOR asks "is this rock physically reachable by a child at all?".
 *     That is a question about the CHILD, and a child does not read faster
 *     because three other rocks are on the board. FR-8 states it as a literal
 *     2.5 s and it is a literal 2.5 s.
 *
 * AND IT CANNOT REACH THE TAIL, swept rather than argued. The floor only ever
 * binds a rock whose raw budget is already under 2500 ms. A pilot at
 * `HEADROOM_SLOW_IKI_MS` earns none of the shortening terms in this file, so
 * over every shipped word at every ease at every knob setting their shortest
 * raw budget is 3075 ms at `MAX_LIVE_MIN` and 12 300 ms at `MAX_LIVE_MAX`,
 * against scaled floors of 2500 and 10 000 - clear at both ends and at every
 * setting between. Lowering a bound the tail never touches cannot cost the tail
 * anything. `tests/unit/fallTime/fallTime.test.ts` sweeps it as a count of
 * ZERO changed cells, so a shorter word added to a pool turns it red.
 *
 * At `MAX_LIVE_MIN` the factor is 1, so the bounds are FR-8's literal 2.5 s and
 * 14 s, exactly as before.
 */
export const clampFallTime = (ms: number, factor = 1): number => {
  const f = Number.isFinite(factor) ? Math.max(1, factor) : 1;
  return Math.min(FALL_TIME_MAX_MS * f, Math.max(FALL_TIME_MIN_MS, ms));
};

export interface FallTimeInput {
  /** The word as it will be typed; only its length is used. */
  readonly word: string;
  /** This player's ease for this word, already clamped to [0.25, 2.0]. */
  readonly ease: number;
  /** The player's calibration; defaults to 350 ms iki per PRD FR-8. */
  readonly calibration?: Calibration;
  /**
   * The controller's current knobs; only `maxLive` is read, and only to size
   * the queue this rock may have to wait in (`fallBudgetFactor`). Absent means
   * `MAX_LIVE_MIN`, i.e. FR-8's budget exactly as written.
   */
  readonly knobs?: Pick<Knobs, "maxLive">;
  /**
   * This rock's own 0..1 draw from the belt's seeded rng (UR-83), taken once at
   * spawn. Absent means no spread at all, i.e. FR-8's budget exactly as
   * written. See `fallSpreadFactor`.
   */
  readonly spread?: number;
  /**
   * Which stop's belt this rock is falling on (UR-84). Only its stage index is
   * read, and only to scale the whole budget by `stopPaceFactor`. Absent or
   * null means no per-stop pace at all, i.e. FR-8's budget exactly as written.
   */
  readonly stop?: StopId | null;
  /**
   * How many rocks were ALREADY on the board when this one spawned (C22).
   *
   * Absent means "size the budget from the knob", i.e. UR-51's behaviour
   * byte for byte - which is what every caller without a board in hand gets.
   * See `fallBudgetFactor`.
   */
  readonly liveCount?: number;
}

/**
 * AC-8.1: the formula exactly as documented, with the clamps holding.
 * Pure and total - no clock, no randomness, no NaN escapes.
 */
export function fallTimeMs({
  word,
  ease,
  calibration,
  knobs,
  spread,
  stop,
  liveCount,
}: FallTimeInput): number {
  return clampFallTime(
    rawFallTimeMs({ word, ease, calibration, knobs, spread, stop, liveCount }),
    fallBudgetFactor(knobs, liveCount),
  );
}

/**
 * The unclamped value, for tests and for the gauntlet's difficulty telemetry.
 * Useful because a word pinned at a clamp bound tells the controller that the
 * fall-time knob has no headroom left for that word.
 */
export function rawFallTimeMs({
  word,
  ease,
  calibration,
  knobs,
  spread,
  stop,
  liveCount,
}: FallTimeInput): number {
  const iki = calibration?.ikiMs ?? DEFAULT_CALIBRATION.ikiMs;
  const live = knobs?.maxLive ?? MAX_LIVE_MIN;
  const headroom = keystrokeHeadroom(live, iki);
  return (
    (keystrokeBudgetMs(word.length, iki, headroom) +
      recognitionBudgetMs(ease, recognitionBaseMs(live, iki))) *
    fallBudgetFactor(knobs, liveCount) *
    fallSpreadFactor(spread, iki) *
    stopPaceFactor(stop, iki)
  );
}

/** True if the computed value hit either clamp (telemetry, not gameplay). */
export function isClamped(input: FallTimeInput): boolean {
  const factor = fallBudgetFactor(input.knobs, input.liveCount);
  const raw = rawFallTimeMs(input);
  // The floor is unscaled (C20) and the ceiling is not, so this asks the same
  // two questions `clampFallTime` answers rather than a third one.
  return raw < FALL_TIME_MIN_MS || raw > FALL_TIME_MAX_MS * factor;
}
