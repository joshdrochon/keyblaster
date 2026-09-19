/**
 * Difficulty knobs (D20, D53, PRD FR-10, architecture section 4.3).
 *
 * D20 fixes the working rule: one knob per stage. D53 fixes which knobs exist
 * and in which order they move. This file owns the knob *values* and the step
 * ordering; index.ts owns when a step is allowed to happen.
 *
 * AC-10.4 is a statement about this file: the set of knobs is exactly
 * {maxLive, lengthBias}. World scroll speed is constant per stage and is
 * deliberately absent, so no code path can ever reach for it.
 */

/** Word-length mix bias (PRD FR-10: "-1/0/+1"). */
export type LengthBias = -1 | 0 | 1;

/** Max simultaneous asteroids. PRD FR-10 range 2-7 inclusive. */
export const MAX_LIVE_MIN = 2;
export const MAX_LIVE_MAX = 7;

export const LENGTH_BIAS_MIN: LengthBias = -1;
export const LENGTH_BIAS_MAX: LengthBias = 1;

/**
 * A closed sub-range of FR-10's 2..7 that the primary knob may move inside
 * (UR-83).
 *
 * ================== WHY THE RANGE IS NO LONGER ALWAYS GLOBAL ==============
 * `maxLive` was a single 2..7 range for the whole route, and the controller is
 * 100% adaptive - so Mars and Pluto were the SAME BOARD for an equally good
 * typist, and a fresh pilot's first belt at any stop opened at the gentlest
 * setting the game has. Six stops' worth of progression rested on the pools
 * alone. `./stopBand.ts` derives one of these per stop; everything in this file
 * takes it as a parameter and defaults to `GLOBAL_LIVE_BAND`, so every caller
 * that has no stop in hand is byte-for-byte the rule it was.
 *
 * IT IS A RANGE AND NEVER A SCHEDULE. The stop sets the two ends; the adaptive
 * controller still decides where inside them this particular child sits, on
 * exactly the evidence it used before. Adjacent stops' bands OVERLAP, so a
 * strong pilot on an early stop and a weak pilot on a late one can meet in the
 * middle - nobody is handed a difficulty for being at a stop.
 */
export interface LiveBand {
  readonly floor: number;
  readonly ceiling: number;
}

/** FR-10's own 2..7: the band every caller without a stop still flies. */
export const GLOBAL_LIVE_BAND: LiveBand = {
  floor: MAX_LIVE_MIN,
  ceiling: MAX_LIVE_MAX,
};

/**
 * Force a band inside FR-10's range and the right way round.
 *
 * Total, like `clampKnobs`: a corrupt band reads as the global range rather
 * than as a reversed interval that would clamp every knob onto one number.
 */
export function clampBand(band: LiveBand): LiveBand {
  const floor = clampInt(band.floor, MAX_LIVE_MIN, MAX_LIVE_MAX);
  const ceiling = clampInt(band.ceiling, MAX_LIVE_MIN, MAX_LIVE_MAX);
  return floor <= ceiling ? { floor, ceiling } : { floor: ceiling, ceiling: floor };
}

/**
 * The complete knob set. Adding a field here is a spec change: AC-10.4 asserts
 * this shape, so a scroll-speed knob cannot be introduced without failing a
 * test that names the AC.
 */
export interface Knobs {
  /** Primary knob (D53): max simultaneous asteroids. */
  readonly maxLive: number;
  /** Secondary knob (D53): word-length mix bias. */
  readonly lengthBias: LengthBias;
}

export type KnobName = keyof Knobs;

/** Exhaustive, ordered knob list. AC-10.4 compares against this literal. */
export const KNOB_NAMES: readonly KnobName[] = ["maxLive", "lengthBias"] as const;

/**
 * Cold start (D18): difficulty increases only as the player gets better, so a
 * fresh profile starts at the gentlest simultaneous-asteroid count and a
 * neutral length mix. The warm-up wave, not the controller, carries the first
 * impression.
 */
export const DEFAULT_KNOBS: Knobs = {
  maxLive: MAX_LIVE_MIN,
  lengthBias: 0,
};

// ---------------------------------------------------------------------------
// What `maxLive` actually BUYS (UR-42, UR-51)
// ---------------------------------------------------------------------------

/**
 * How many word-asteroids the belt INTENDS to hold answerable at once, at this
 * setting of the primary knob.
 *
 * ================== WHY THIS EXISTS ==================
 * `maxLive` was a ceiling nothing reached. `gauntlet/evidence/belt-survivability.json`
 * recorded `peakLive: 2` at maxLive 7 exactly as at maxLive 2, over 40 seeds and
 * three player speeds, and the time-weighted occupancy was 1.00-1.04 rocks at
 * both ends. A knob whose two extremes are indistinguishable is not a
 * difficulty range, and UR-51 is the report that says so.
 *
 * THE CONSTRAINT THE KNOB COULD NOT SEE. A player is a single server (AC-2.1
 * gives every live word a distinct first letter so the lock is unambiguous), so
 * a board holding N rocks is a board where the last one WAITS N-1 service times
 * before anyone can touch it - and it falls the whole time. By Little's law a
 * belt running at the player's own throughput holds N rocks only if each rock
 * lives N service times, so N is bounded by
 *
 *     N  <=  fallTimeMs / expectedClearMs
 *
 * At FR-8's shipped budget that ratio is 1.18 (fast), 1.25 (median) and 1.38
 * (grade-2) - one, at every pilot speed, in every shipped pool. Raising
 * `maxLive` could not put a second answerable rock on the board because FR-8's
 * fall budget bound first. That is UR-42; UR-51 is the decision taken on it -
 * widen the budget, and make the knob express the range.
 *
 * ================== SO THE KNOB NOW MEANS A DEPTH ==================
 * This is the one number both halves read. `@engine/fallTime` scales FR-8's
 * budget by it, so a rock granted a place in a 4-deep queue is granted the fall
 * time to survive the queue; `@engine/pacing` holds that many rocks' worth of
 * work standing on the board, so the queue is actually built. Neither half is
 * meaningful without the other: budget without pacing is a slower game, pacing
 * without budget is the P0a stall defect.
 *
 * ================== THE FLOOR IS EXACTLY 1, AND THAT IS THE SAFETY ==========
 * At `MAX_LIVE_MIN` this returns 1, so the fall-budget scale is x1 and the
 * pacing allowance is zero: the belt a struggling child flies is BIT-IDENTICAL
 * to the one measured at 3 stalls in 240 route-belts. The hard constraint on
 * UR-51 - harder for a fast typist, not unsurvivable for a grade-2 child - is
 * therefore a property of this function's floor rather than a hope about a
 * simulation. `tests/unit/controller/controller.test.ts` pins it.
 */
export const CONCURRENCY_TARGET_MIN = 1;

/**
 * Depth at `MAX_LIVE_MAX`. Four, per UR-51, and because the fall budget it
 * implies still clears `expectedClearMs` for the grade-2 pilot with margin -
 * measured, in gauntlet/evidence/belt-concurrency.json, not assumed.
 *
 * ================== IT WAS SWEPT DOWNWARD AND PUT BACK (UR-84, C22) =======
 * This value multiplies the WHOLE of FR-8's fall budget through
 * `@engine/fallTime.fallBudgetFactor`, so it was the prime suspect for "the
 * game has no adrenaline": flown in a browser at Pluto at ~100% accuracy,
 * consecutive rocks ran 8.6 s to 42 s and got SLOWER as the controller climbed,
 * because every difficulty pass made the board busier and on this engine a
 * busier board is how the game GRANTS MORE TIME.
 *
 * It was swept, 40 seeds x 6 belts x 5 pilots, the real controller carried stop
 * to stop. Stalls per pilot, WITHOUT C22's live-count fix:
 *
 *     value   ace  fast  median  slow  grade2   P0a (knob pinned at ceiling)
 *     4.0      0    0      0      0      0      all clear
 *     3.5      0    0      0      0      0      all clear
 *     3.4      0    0      3      2      0      all clear
 *     3.25     0    0      4      4      0      all clear
 *     3.0      0    0      1      3      0      all clear
 *     2.5      0    0     12     13      0      all clear
 *     2.0      0    0      5     12      0      median 1, slow 2
 *
 * 3.5 was the largest safe step and it bought about 12% - real, and not "fast".
 * WITH C22's live-count fix the same sweep reads 3.5 costing the median pilot
 * two belts at Pluto while 4.0 costs nobody anything and produces a QUICKER
 * first rock (2851 ms against 2851 ms) and a wider belt (5.9x against 5.1x).
 * So the blunt constant is not what was wrong: the wrong QUANTITY was, and once
 * `fallBudgetFactor` reads the board's actual depth instead of the knob's
 * target this value is right where UR-51 put it. Left at 4 deliberately, with
 * the curve recorded here so the next pass does not sweep it again.
 *
 * ================== AND THE PILOT THAT BINDS IS NOT THE TAIL =============
 * Worth writing down, because it corrects an assumption this project has been
 * steering by. The grade-2 pilot is at ZERO stalls at every value down to 2.0 -
 * `headroomEarned` exempts them from every shortening term in
 * `@engine/fallTime`, so their budget never approaches the bound. The pilots
 * that break first are the MEDIAN (93% accuracy at FR-8's own 350 ms interval)
 * and the SLOW (88% at 440 ms), who are also children. A gate written as "the
 * grade-2 pilot must not stall" would have licensed 2.0 and cost the median
 * child five belts and the slow child twelve.
 */
export const CONCURRENCY_TARGET_MAX = 4;

/**
 * Intended board depth for a knob setting, interpolated across FR-10's 2..7.
 *
 * Continuous rather than integral on purpose: the knob moves one step per stage
 * (D20, AC-10.1) and a depth that jumped a whole rock every step would make one
 * stage boundary in three a cliff. A fractional target moves the fall budget and
 * the standing allowance smoothly, and the board's own integer depth falls out.
 *
 *     maxLive  2    3    4    5    6    7
 *     target   1.0  1.6  2.2  2.8  3.4  4.0
 */
export function concurrencyTarget(maxLive: number): number {
  const span = MAX_LIVE_MAX - MAX_LIVE_MIN;
  // A corrupt knob reads as the floor rather than as NaN: a restored profile
  // must never be able to stop a child's game (clampKnobs, same rule).
  const live = Number.isFinite(maxLive) ? Math.floor(maxLive) : MAX_LIVE_MIN;
  const steps = Math.min(span, Math.max(0, live - MAX_LIVE_MIN));
  return (
    CONCURRENCY_TARGET_MIN +
    (steps / span) * (CONCURRENCY_TARGET_MAX - CONCURRENCY_TARGET_MIN)
  );
}

// ---------------------------------------------------------------------------
// THE BUDGET RATCHET (C23, D31)
// ---------------------------------------------------------------------------

/**
 * The knob pair plus the DEPTH THE FALL BUDGET IS SIZED FROM.
 *
 * ================== WHY THE TWO HAD TO COME APART ==================
 * `maxLive` was buying two things with one number. `@engine/pacing.standingDepth`
 * builds the board the knob asks for and `@engine/fallTime.fallBudgetFactor`
 * caps the budget that pays for standing in it, and both read
 * `concurrencyTarget(maxLive)`. So a LOOSEN removed the queue and the budget
 * that paid for it in the same step - and the second is bigger than the first
 * for every pilot with any margin at all, because the queue a rock gives up is
 * one step of depth x the pilot's SERVICE time while the budget it gives up is
 * one step of depth x FR-8's whole FALL budget, and FR-8's budget exceeds the
 * service time by exactly the margin the controller is trying to protect.
 *
 * Measured, median pilot at Neptune, 40 seeds, the knob pinned for the belt:
 *
 *     maxLive   fall     queued   on hand
 *     5        11585      4312      7272
 *     4         9462      2705      6756    <- the LOOSEN, and it costs 516 ms
 *
 * D31's relief was pointing the wrong way, at every pilot, every stop and every
 * band position. `tests/unit/simulation/loosenRelief.test.ts` is the bar.
 *
 * ================== IT IS NOT A THIRD KNOB (AC-10.4) ==================
 * `Knobs` is untouched and `KNOB_NAMES` is still exactly {maxLive, lengthBias}.
 * This is a RATCHET OVER the primary knob, carried on the controller's own
 * state for the length of a belt, in the same spirit as `keystrokeHeadroom` and
 * `concurrencyTarget` being functions of the knob rather than knobs. It is not
 * persisted: `clampKnobs` drops it and `@engine/persistence/schema` writes the
 * two fields by name, so a belt opens with `budgetLive` equal to the knob and
 * a restored profile cannot carry relief it did not earn on the belt it is on.
 *
 * ================== AND IT IS A FLOOR, NEVER A CEILING ==================
 * `budgetLiveOf` takes the MAXIMUM of the two, so a value below the knob reads
 * as the knob. Nothing here can make a belt harder than the knob already made
 * it, and a caller that never sets it flies `concurrencyTarget(maxLive)` byte
 * for byte - which is every caller in the game that has not been given relief.
 */
export interface BudgetKnobs extends Knobs {
  /**
   * The `maxLive` the fall budget is sized from: the highest the knob has been
   * this belt, plus any relief D31 granted below the band's floor. Absent means
   * "the knob", i.e. the pre-C23 rule exactly.
   */
  readonly budgetLive?: number;
}

/**
 * The depth the fall budget is sized from, given a knob pair that may carry a
 * ratchet.
 *
 * Total, and the totality is the safety: a non-finite knob reads as
 * `MAX_LIVE_MIN` (the same rule `concurrencyTarget` and `clampKnobs` follow, so
 * a restored profile can never stop a child's game), a non-finite or absent
 * ratchet reads as the knob, and the result is the larger of the two clamped
 * into FR-10's range.
 */
export function budgetLiveOf(
  knobs?: { readonly maxLive?: number; readonly budgetLive?: number } | null,
): number {
  const raw = knobs?.maxLive;
  const live = Number.isFinite(raw) ? Math.floor(raw as number) : MAX_LIVE_MIN;
  const held = knobs?.budgetLive;
  const ratchet = Number.isFinite(held) ? Math.floor(held as number) : live;
  return Math.min(MAX_LIVE_MAX, Math.max(MAX_LIVE_MIN, Math.max(live, ratchet)));
}

/**
 * Carry the ratchet across a knob move: the budget depth never falls.
 *
 * A TIGHTEN raises it, because the board really is deeper and the rocks at the
 * back of it really do need the budget. A LOOSEN leaves it where it was, which
 * is the whole of C23 - the child gives up the queue and keeps the time.
 *
 * `ceiling` bounds the ratchet at the stop's own busiest board
 * (`./stopBand.ts`), so relief can never grant a rock more than it would have
 * had at the top of the band it is flying in. Mars cannot hand out Pluto's
 * budget however badly the belt is going.
 */
export function ratchetBudget(
  before: BudgetKnobs,
  after: Knobs,
  band: LiveBand = GLOBAL_LIVE_BAND,
): BudgetKnobs {
  const b = clampBand(band);
  const held = Math.min(b.ceiling, budgetLiveOf(before));
  return withBudgetLive(after, Math.max(held, after.maxLive));
}

/**
 * Attach the ratchet, AND OMIT IT ENTIRELY WHEN IT IS THE KNOB.
 *
 * ================== WHY THE ABSENCE MATTERS (AC-10.4) ==================
 * `tests/unit/controller/controller.test.ts` reads AC-10.4 off the runtime
 * object - `Object.keys(createController().knobs).sort()` must be exactly
 * `["lengthBias", "maxLive"]` - and it is right to: an AC about a knob SET that
 * only checked a constant would not notice a third field being added to the
 * thing the scene actually flies. So a pilot who has been given no relief
 * carries no field, and the knob pair a fresh controller hands out is the same
 * two-key object it has always been, byte for byte, down to its key list.
 *
 * The field appears only once the ratchet is genuinely ABOVE the knob, i.e.
 * only on the loosen path, which is the only place it means anything.
 */
function withBudgetLive(knobs: Knobs, budgetLive: number): BudgetKnobs {
  return budgetLive > knobs.maxLive ? { ...knobs, budgetLive } : { ...knobs };
}

/**
 * One step of relief for a pilot the knob can no longer help (D31).
 *
 * ================== THE CASE THIS EXISTS FOR ==================
 * `loosenStep` returns null once `lengthBias` is at its floor and `maxLive` is
 * at the STOP's floor, and `decideStage` reports it as `at-loosen-floor`. Until
 * C23 that hold was the end of the road: the controller had decided the belt
 * was landing on the child, and it had nothing left to give. Measured, that is
 * exactly where the route's last failing cell lives - the median pilot at
 * Pluto, whose knob is pinned at the band floor of 5 for the whole belt and
 * whose hit rate inside a stalling belt reads 0.774, well under `LOOSEN_BELOW`.
 *
 * So when the knob has no room left, the BUDGET takes the step instead: the
 * board stays exactly as deep as the stop's floor says it must be, and the
 * rocks standing in it are granted the budget they would have had at a busier
 * setting. It is the same trade a loosen already makes, made in the one channel
 * that still has travel.
 *
 * ================== WHY IT CANNOT RUN AWAY ==================
 *   - it is bounded by the stop's own CEILING, so the most a belt can ever
 *     grant is the budget its busiest legal board would have paid.
 *   - it only fires on `at-loosen-floor`, i.e. when the controller has already
 *     decided to loosen on `LOOSEN_BELOW` or `LOOSEN_MARGIN_BELOW`. A pilot who
 *     never triggers a loosen never sees one millisecond of it - swept, the ace
 *     and fast pilots never reach either trigger at any stop on the route.
 *   - it is rate-limited by `MIDSTAGE_LOOSEN_SAMPLE` like any other mid-belt
 *     move, and it resets with the belt.
 *
 * Returns the knobs unchanged when there is no travel left, so the caller can
 * tell "gave relief" from "had none to give" by identity.
 */
/**
 * ================== WHAT WAS TRIED BELOW THE KNOB'S FLOOR, AND REJECTED =====
 * `loosenStep` returns null once `lengthBias` is at its floor and `maxLive` is
 * at the STOP's floor, and `decideStage` reports that as `at-loosen-floor`: the
 * controller has decided the belt is landing on the child and has nothing left
 * to give. That is exactly where the route's last stalling cell lives - the
 * median pilot at Pluto, knob pinned at the band floor of 5 for the whole belt,
 * hit rate 0.774 inside the belts that empty the hull.
 *
 * So a further step was built and measured: when the knob has no room left, walk
 * `budgetLive` one setting ABOVE it and let the budget take the step the knob
 * cannot. It works, and it costs too much. Route sweep, 120 seeds x 6 belts x 5
 * pilots, both nesting arms, the real controller carried stop to stop:
 *
 *     lever                         stalls   what else moved
 *     shipped ratchet only             5     nothing
 *     + one step below the floor       0     grade-2's hit rate at Neptune
 *                                            0.915 -> 0.959, back OVER D17's
 *                                            0.90 band ceiling; UR-51's skill
 *                                            separation 27/40 routes -> 19/40,
 *                                            with grade-2 ending ABOVE fast on
 *                                            some seeds; grade-2 opens Pluto at
 *                                            its floor on 23 of 40 routes
 *                                            against the 38 on record.
 *     + walked to the band ceiling     0     grade-2 Neptune 0.961, same
 *                                            separation loss, more of it.
 *
 * The relief leaks. Margins are read against the budget `@engine/fallTime`
 * granted, and the margin window is carried stop to stop (D53), so a belt flown
 * on relief hands the NEXT belt evidence that the child has room. Gating the
 * tighten while the ratchet is up (`HoldReason` "on-relief") stops the leak
 * inside a belt and not across one. The owner's standing report is that the game
 * is too easy; a lever that moves the supported-tail pilot back above D17's band
 * is the wrong trade, and it is logged in gauntlet/escalations.md rather than
 * shipped.
 */

/** A single knob move. AC-10.1: at most one of these per stage, ever. */
export interface KnobChange {
  readonly knob: KnobName;
  readonly from: number;
  readonly to: number;
}

function clampInt(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(value)));
}

/** Narrow an arbitrary number onto the LengthBias union, clamping to bounds. */
export function asLengthBias(value: number): LengthBias {
  const n = clampInt(value, LENGTH_BIAS_MIN, LENGTH_BIAS_MAX);
  return n === -1 || n === 1 ? n : 0;
}

/**
 * Force a knob pair into range. Callers may hand us persisted values from an
 * older schema version; we clamp rather than throw, because a corrupt knob
 * must never stop a child's game (CLAUDE.md, same spirit as AC-13.1 prod mode).
 */
export function clampKnobs(knobs: Knobs, band: LiveBand = GLOBAL_LIVE_BAND): Knobs {
  const b = clampBand(band);
  return {
    maxLive: clampInt(knobs.maxLive, b.floor, b.ceiling),
    lengthBias: asLengthBias(knobs.lengthBias),
  };
}

/**
 * Next tighten step, or null when both knobs are already at their hard cap.
 *
 * Order is fixed by D53/architecture 4.3: maxLive +1 (cap 7), else
 * lengthBias +1 (cap +1). Primary first, secondary only when the primary is at
 * its bound (PRD FR-10: "knob choice alternates primary -> secondary when
 * primary is at its bound").
 */
export function tightenStep(knobs: Knobs, band: LiveBand = GLOBAL_LIVE_BAND): KnobChange | null {
  const b = clampBand(band);
  const k = clampKnobs(knobs, b);
  if (k.maxLive < b.ceiling) {
    return { knob: "maxLive", from: k.maxLive, to: k.maxLive + 1 };
  }
  if (k.lengthBias < LENGTH_BIAS_MAX) {
    return { knob: "lengthBias", from: k.lengthBias, to: k.lengthBias + 1 };
  }
  return null;
}

/**
 * Next loosen step, or null when both knobs are already at their hard floor.
 *
 * Order is deliberately the mirror image, not the reverse, of tightenStep:
 * lengthBias -1 (floor -1), else maxLive -1 (floor 2). Shorter words are the
 * cheapest relief to give, and giving it first means a struggling player keeps
 * the asteroid count they have already learned to track.
 *
 * The asymmetry is load-bearing: it makes lengthBias ratchet down to its floor
 * and stay there, so maxLive ends up carrying the steady-state control. That is
 * what D53 means by calling maxLive the primary knob.
 */
export function loosenStep(knobs: Knobs, band: LiveBand = GLOBAL_LIVE_BAND): KnobChange | null {
  const b = clampBand(band);
  const k = clampKnobs(knobs, b);
  if (k.lengthBias > LENGTH_BIAS_MIN) {
    return { knob: "lengthBias", from: k.lengthBias, to: k.lengthBias - 1 };
  }
  if (k.maxLive > b.floor) {
    return { knob: "maxLive", from: k.maxLive, to: k.maxLive - 1 };
  }
  return null;
}

/** Apply a step. `null` is the hold case and returns the knobs untouched. */
export function applyChange(
  knobs: Knobs,
  change: KnobChange | null,
  band: LiveBand = GLOBAL_LIVE_BAND,
): Knobs {
  const b = clampBand(band);
  const k = clampKnobs(knobs, b);
  if (change === null) return k;
  return change.knob === "maxLive"
    ? { maxLive: clampInt(change.to, b.floor, b.ceiling), lengthBias: k.lengthBias }
    : { maxLive: k.maxLive, lengthBias: asLengthBias(change.to) };
}

/** How many knob fields differ. AC-10.1 asserts this is never greater than 1. */
export function knobsDiffCount(a: Knobs, b: Knobs): number {
  let n = 0;
  if (a.maxLive !== b.maxLive) n += 1;
  if (a.lengthBias !== b.lengthBias) n += 1;
  return n;
}

/**
 * Write a knob pair onto anything that carries one - the profile, in practice
 * (UR-51). Generic and structural for the same reason `applyCalibration` is:
 * the engine must not import the persistence module to write a persisted field,
 * and a test wants to hand it a bare `{ knobs }` rather than a whole Profile.
 *
 * Clamps on the way in. A knob arrives here from `endStage`, which cannot
 * produce an out-of-range value - but it is the LAST gate before a number is
 * written to a child's save, and a corrupt value stored is a corrupt value for
 * ever, while a corrupt value rejected is one stage of difficulty.
 *
 * THE PARAMETER IS CALLED `profile` ON PURPOSE. `tests/unit/arch/profileWriters`
 * finds a writer by looking for an exported function whose parameter is named
 * `profile` or `p` and which returns a spread of it with a Profile field
 * replaced - the shape every pure updater here uses. Named anything else, this
 * function is invisible to the guard, `knobs` reads as an orphan field, and the
 * one check in this repo that would catch UR-51's defect happening again is
 * blind to the field it was added for.
 */
export function applyKnobs<T extends { knobs: Knobs }>(profile: T, knobs: Knobs): T {
  return { ...profile, knobs: clampKnobs(knobs) };
}
