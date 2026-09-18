/**
 * MARGIN TO THE BREACH LINE - the difficulty signal that has range (UR-51).
 *
 * ================== WHY HIT RATE COULD NOT DRIVE THE CLIMB ==================
 * D53 gives the controller one signal: hit rate over the last 20 spawns, tighten
 * above 0.90. Measured over a whole route, 40 seeds, a brand-new profile per
 * seed, with the real controller carried stop to stop
 * (`gauntlet/evidence/difficulty-ramp.json`):
 *
 *     pilot     hit rate      margin p25 (this file)
 *     fast      1.0000        0.532
 *     median    1.0000        0.362
 *     slow      0.9945        0.260
 *     grade-2   0.9521        0.171
 *
 * Every pilot clears 0.90, so every pilot tightened on the same cadence and
 * every pilot landed on `MAX_LIVE_MAX` by the last stop. Four pilots, 2.3x apart
 * in typing speed, separated by FOUR HUNDREDTHS of the signal - inside the seed
 * noise. An adaptive controller reading a saturated signal is a stage counter,
 * and that is UR-51's "the game is the same for every child".
 *
 * Hit rate is not a bad measurement; it is a bad THROTTLE. It is bounded above
 * by 1 and every pilot who can fly the belt at all is pinned against that bound.
 * It stays in `index.ts` as the SAFETY FLOOR that AC-10.3 / D18 require - a
 * child who is missing must never be given more - and this file supplies the
 * quantity that decides whether a child who is NOT missing has earned more.
 *
 * ================== WHAT THIS MEASURES ==================
 * A rock is granted `fallTimeMs` to live (FR-8/D19). The margin is the fraction
 * of that grant still unspent at the moment the rock left the board:
 *
 *     margin = 1 - (leftAtMs - spawnedAtMs) / fallMs
 *
 * 1.0 is "blasted the instant it appeared"; 0.0 is "reached the breach line".
 * It is the same quantity for a blast and for a breach, which is the point: a
 * breach is a margin of zero, not a missing sample, so a belt that is landing
 * rocks drives this DOWN rather than merely failing to push it up.
 *
 * Unlike hit rate it is not bounded by the player's accuracy, it is bounded by
 * the CLOCK, and the clock is what the difficulty spends. Both sides are the
 * game's own numbers - `fallTimeMs` granted it, the player spent it - so the
 * spread above is a property of FR-8 and of the child, not of a tuning value.
 *
 * ================== WHY A LOW QUANTILE AND NOT A MEAN ==================
 * Read at `MARGIN_QUANTILE`, i.e. the worst quarter of the window, for the same
 * asymmetry `@engine/pacing`'s `CLEAR_BIAS_QUANTILE` argues: being wrong about
 * the comfortable rocks costs a duller sky, being wrong about the tight ones
 * costs a hull mark. A mean is dragged up by the three-letter words the child
 * already knows and would tighten the belt on evidence from the rocks that were
 * never in doubt. A minimum chases one bad sample. The lower quartile answers
 * "even the tight rocks still had this much left", which is the question a
 * tighten has to be able to answer yes to.
 *
 * Pure and total like the rest of src/engine: no clock, no randomness, no
 * storage. The clock reading is the CALLER's - it hands over the two instants.
 */

/**
 * How many recent rocks the margin is read over. The same 20 as D53's hit-rate
 * window, and deliberately the same: the two quantities gate one decision, and
 * reading them over different spans would let the guard and the throttle
 * disagree about which stretch of play they are describing.
 */
export const MARGIN_WINDOW_SIZE = 20;

/**
 * Which quantile of the window the controller reads. The lower quartile - see
 * the header for why this is not a mean and not a minimum.
 */
export const MARGIN_QUANTILE = 0.25;

/** The last `MARGIN_WINDOW_SIZE` margins, oldest first. */
export type MarginWindow = readonly number[];

export interface ClearanceInput {
  /** When the rock arrived on the board, ms on the caller's clock. */
  readonly spawnedAtMs: number;
  /** When it left - blasted or breached. Same clock. */
  readonly leftAtMs: number;
  /** The fall budget `@engine/fallTime` granted it, ms. */
  readonly fallMs: number;
}

/**
 * Fraction of a rock's fall budget that was still unspent when it left.
 *
 * Clamped to [0, 1] and total. A non-finite or non-positive `fallMs` yields 0
 * rather than NaN or Infinity: a corrupt sample must read as "no margin", which
 * is the direction that can only ever make the belt gentler. The same rule the
 * knobs take on a corrupt persisted value.
 */
export function clearanceMargin({ spawnedAtMs, leftAtMs, fallMs }: ClearanceInput): number {
  if (!Number.isFinite(fallMs) || fallMs <= 0) return 0;
  if (!Number.isFinite(spawnedAtMs) || !Number.isFinite(leftAtMs)) return 0;
  const spent = (leftAtMs - spawnedAtMs) / fallMs;
  if (!Number.isFinite(spent)) return 0;
  return Math.min(1, Math.max(0, 1 - spent));
}

/** A window, optionally seeded from a persisted or test-supplied list. */
export function createMarginWindow(seed: MarginWindow = []): MarginWindow {
  return seed.filter((m) => Number.isFinite(m)).slice(-MARGIN_WINDOW_SIZE);
}

/** Append one margin, dropping the oldest once the window is full. */
export function pushMargin(window: MarginWindow, margin: number): MarginWindow {
  if (!Number.isFinite(margin)) return window;
  const next = [...window, Math.min(1, Math.max(0, margin))];
  return next.length <= MARGIN_WINDOW_SIZE ? next : next.slice(-MARGIN_WINDOW_SIZE);
}

/**
 * The window read at `MARGIN_QUANTILE`, or null when nothing has been recorded.
 *
 * NULL IS NOT ZERO AND IT IS NOT "FINE". `index.ts` refuses to tighten on a null
 * (`HoldReason` "no-margin"). That is the fail-safe direction, and it is also
 * the liveness check: a caller that stops reporting margins gets a belt that
 * never gets harder rather than a belt that quietly reverts to the saturated
 * signal this file exists to replace. `tests/unit/flight/knobWiring.test.ts`
 * asserts the real call sites for the same reason.
 *
 * Interpolated between neighbours so a window of four does not jump a whole
 * sample's width when one value changes - the same reading `observedBiasMs`
 * uses, deliberately, so the two quantiles in this engine mean one thing.
 */
export function marginFloor(window: MarginWindow): number | null {
  if (window.length === 0) return null;
  const sorted = [...window].sort((a, b) => a - b);
  const pos = MARGIN_QUANTILE * (sorted.length - 1);
  const lo = sorted[Math.floor(pos)]!;
  const hi = sorted[Math.ceil(pos)]!;
  return lo + (hi - lo) * (pos - Math.floor(pos));
}
