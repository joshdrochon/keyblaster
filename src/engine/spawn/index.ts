/**
 * Where a rock enters the belt, across the screen (D23, D21, D31; FR-8).
 *
 * WHY THIS IS A RULE AND NOT A DRAWING. `FlightScene` used to choose a spawn
 * column with one line - `margin + rng() * (width - margin * 2)` - and that
 * line is a uniform distribution over the whole playfield, which means every
 * rock, including the ones the game itself put back on the belt, has the same
 * chance of arriving directly above the ship.
 *
 * The player named the problem exactly: a word comes back because they missed
 * it (D23, "a missed word comes back sooner") or because it is a retention
 * probe (D21, AC-9.3). Both are the GAME's decision to re-teach something. A
 * re-teaching rock aimed at the hull turns the pedagogy into a threat, which is
 * the direction D31 forbids - "the player should always feel like the best
 * typer in the world".
 *
 * WHAT THIS DOES AND DOES NOT CHANGE. It moves a rock's column. It does not
 * touch which word is chosen (`@engine/selection`), how long the rock falls
 * (`@engine/fallTime`, FR-8) or how many are in the air (`@engine/controller`).
 * A practice rock is exactly as typeable and exactly as fast as it would have
 * been; it simply is not on a collision course. That is the whole of the rule:
 * trajectory, never difficulty.
 *
 * Pure TypeScript: no Phaser, no DOM, no Math.random (CLAUDE.md).
 */

/** Clearance beyond the two silhouettes, so "off the lane" READS as off it. */
export const SHIP_LANE_CLEARANCE_PX = 24;

export interface LaneSpec {
  /** Playfield width, px. */
  readonly width: number;
  /** Keep-out either side of the playfield (the near-plane canyon walls). */
  readonly marginPx: number;
  /** The ship's centre, px from the left edge. AC-1.1: constant per stage. */
  readonly shipX: number;
  /** Half the ship's drawn width, px. */
  readonly shipHalfWidthPx: number;
  /** Half the rock's drawn width, px - the plate is narrower than the rock. */
  readonly rockHalfWidthPx: number;
  /** Extra separation. Defaults to `SHIP_LANE_CLEARANCE_PX`. */
  readonly clearancePx?: number;
}

/** A closed interval of screen x, in px. */
export interface Span {
  readonly from: number;
  readonly to: number;
}

const clearanceOf = (spec: LaneSpec): number =>
  spec.clearancePx ?? SHIP_LANE_CLEARANCE_PX;

/**
 * The band of spawn columns whose rock would come down ON the ship.
 *
 * Measured between CENTRES, which is why both half-widths are in it: a rock
 * centred one rock-half-width plus one ship-half-width away from the ship's
 * centre is exactly touching it, and anything nearer overlaps.
 */
export function shipLane(spec: LaneSpec): Span {
  const reach = spec.shipHalfWidthPx + spec.rockHalfWidthPx + clearanceOf(spec);
  return { from: spec.shipX - reach, to: spec.shipX + reach };
}

/** Is a rock spawned at this column on a collision course with the ship? */
export function isOnShipLane(x: number, spec: LaneSpec): boolean {
  const lane = shipLane(spec);
  return x >= lane.from && x <= lane.to;
}

/** The columns a rock may spawn in at all, before the ship is considered. */
export function playableSpan(spec: LaneSpec): Span {
  const from = spec.marginPx;
  const to = spec.width - spec.marginPx;
  // A margin wider than the screen is a configuration mistake, not a runtime
  // state. Collapsing to the centre keeps this total rather than producing a
  // reversed interval that would sample outside the screen.
  if (to <= from) {
    const middle = spec.width / 2;
    return { from: middle, to: middle };
  }
  return { from, to };
}

const widthOf = (span: Span): number => Math.max(0, span.to - span.from);

/**
 * The columns a PRACTICE rock may use: the playable span minus the ship's lane.
 *
 * Returns the pieces left over, which is zero, one or two spans. Two is the
 * normal case - the ship is in the middle, so there is room either side.
 */
export function offLaneSpans(spec: LaneSpec): readonly Span[] {
  const play = playableSpan(spec);
  const lane = shipLane(spec);
  const out: Span[] = [];
  if (lane.from > play.from) out.push({ from: play.from, to: Math.min(play.to, lane.from) });
  if (lane.to < play.to) out.push({ from: Math.max(play.from, lane.to), to: play.to });
  return out.filter((s) => widthOf(s) > 0);
}

/** Uniform sample from a span. A zero-width span yields its single point. */
function sampleSpan(span: Span, rng: () => number): number {
  return span.from + rng() * widthOf(span);
}

/**
 * Pick a spawn column.
 *
 * `avoidShipLane` is the practice flag from `@engine/selection` (`Picked.practice`).
 * With it false this is the ordinary uniform pick over the playable width, so
 * nothing about a first-time word moved.
 *
 * With it true the sample is uniform over the off-lane pieces WEIGHTED BY THEIR
 * WIDTH. Weighting matters: the ship is centred, but the lane is not
 * necessarily, and picking a side by coin flip would pile practice rocks into
 * whichever side is narrower.
 *
 * WHEN THERE IS NO ROOM. A huge rock on a narrow screen can leave no off-lane
 * column at all. The rule then degrades to "as far from the ship as the
 * playfield allows" - the end of the playable span that is furthest from the
 * ship - rather than throwing or silently falling back to uniform. That keeps
 * the function total and keeps the INTENT in the degenerate case, which is the
 * only case where the intent is hard to satisfy.
 */
export function spawnX(spec: LaneSpec, rng: () => number, avoidShipLane: boolean): number {
  const play = playableSpan(spec);
  if (!avoidShipLane) return sampleSpan(play, rng);

  const spans = offLaneSpans(spec);
  if (spans.length === 0) {
    const leftGap = Math.abs(play.from - spec.shipX);
    const rightGap = Math.abs(play.to - spec.shipX);
    return rightGap > leftGap ? play.to : play.from;
  }

  const total = spans.reduce((sum, s) => sum + widthOf(s), 0);
  let target = rng() * total;
  for (const span of spans) {
    const w = widthOf(span);
    if (target < w) return span.from + target;
    target -= w;
  }
  // Only reachable when `rng()` returns exactly 1, which the contract says it
  // does not. Answering with the last span's far edge rather than `undefined`
  // costs one line and removes a partial function from the hot path.
  return (spans[spans.length - 1] as Span).to;
}
