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
  /**
   * The arriving rock's plate, for the plate-on-plate rule below (UR-23).
   *
   * OPTIONAL, and the omission is the honest default rather than a convenience:
   * a caller that does not describe the plate is not asserting that there is no
   * plate, so the rule cannot pretend to a guarantee it has no data for. With
   * both this and `livePlates` absent, `spawnX` is byte-for-byte the column
   * rule it was.
   */
  readonly plate?: PlateTrack;
  /** Every plate already falling. Ignored unless `plate` is given too. */
  readonly livePlates?: readonly LivePlateTrack[];
  /** Sway amplitude either side of a column. Defaults to `ROCK_DRIFT_PX`. */
  readonly driftPx?: number;
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
 *
 * THE PLATE KEEP-OUT IS SUBTRACTED LAST, and that order is deliberate. The ship
 * lane is about the hull and the plate bands are about legibility; a practice
 * rock that could only stay off the ship's lane by landing on another word
 * keeps the off-lane promise and takes the least-covered column inside it
 * (`leastCoveredColumn`). D31's "never aim a re-teaching rock at the child" is
 * the stronger claim of the two and it is the one that does not degrade.
 */
interface ColumnChoice {
  /** The columns the SHIP-lane rule leaves open, before plates are considered. */
  readonly allowed: readonly Span[];
  /** One band per live plate this rock will come level with. */
  readonly blocks: readonly Span[];
  /** `allowed` minus `blocks`: the columns that cover no other word. */
  readonly spans: readonly Span[];
}

/**
 * The column arithmetic `spawnX` and `hasCleanColumn` share.
 *
 * `null` is the ship-lane degenerate case - a rock so wide on a board so narrow
 * that no off-lane column exists at all. `spawnX` answers that from the ship
 * alone and never reaches the plate keep-out, so there is no plate question to
 * ask and `hasCleanColumn` must not invent one.
 *
 * ONE FUNCTION BECAUSE TWO WOULD DRIFT. `hasCleanColumn` is the belt's licence
 * to spawn and `spawnX` is where the rock actually goes; if they computed the
 * bands separately then the belt could clear a board the column rule then
 * failed to place, which is the exact defect class this project has been bitten
 * by - a check that exercises something ADJACENT to the shipped thing.
 */
function cleanSpans(spec: LaneSpec, avoidShipLane: boolean): ColumnChoice | null {
  const play = playableSpan(spec);
  const allowed = avoidShipLane ? offLaneSpans(spec) : [play];
  if (allowed.length === 0) return null;
  const blocks =
    spec.plate === undefined
      ? []
      : plateKeepOuts(spec.plate, spec.livePlates ?? [], spec.driftPx);
  const spans = blocks.length === 0 ? allowed : subtractSpans(allowed, blocks);
  return { allowed, blocks, spans };
}

/**
 * Is there a column on this board that puts this word over no other word?
 *
 * ================== WHY THE BELT HAS TO ASK (AC-22.8) ==================
 * The column rule cannot always win, and no column rule could. The playable
 * span is 1280 px at the 16:9 floor; seven plates of the longest words a pool
 * carries need about 1516 px of it with D41's increased letter spacing, 1326
 * without. When a board is over-subscribed like that, EVERY column covers
 * something, `spawnX` falls back to `leastCoveredColumn`, and a child reads a
 * word with a piece of it behind another word.
 *
 * AC-22.8 says zero, and zero is not reachable by choosing x. It IS reachable
 * by choosing WHEN: which live plates this rock comes level with depends on
 * when it is launched, and live plates retire, so waiting always empties the
 * conflict set eventually. So the belt asks this before it commits to a word,
 * and holds the rock for one short retry instead of drawing it over a
 * neighbour. `FlightScene.trySpawn` already had exactly this shape for
 * "no-legal-word"; this is the second reason to wait a tick.
 *
 * The cost is a board that occasionally runs one rock shallower than `maxLive`
 * while several long words are level with each other, which is the truthful
 * depth for a board that cannot hold them - `maxLive` is a ceiling, never a
 * quota. Measured at one board in 3456 over the AC-22.8 sweep.
 */
export function hasCleanColumn(spec: LaneSpec, avoidShipLane: boolean): boolean {
  const choice = cleanSpans(spec, avoidShipLane);
  return choice === null || choice.spans.length > 0;
}

export function spawnX(spec: LaneSpec, rng: () => number, avoidShipLane: boolean): number {
  const choice = cleanSpans(spec, avoidShipLane);
  if (choice === null) {
    const play = playableSpan(spec);
    const leftGap = Math.abs(play.from - spec.shipX);
    const rightGap = Math.abs(play.to - spec.shipX);
    return rightGap > leftGap ? play.to : play.from;
  }
  const { allowed, blocks, spans } = choice;
  // Every column on this board would put this word over another one. Take the
  // one that covers least rather than the uniform pick that put it there.
  //
  // STILL REACHABLE, AND DELIBERATELY SO. `hasCleanColumn` lets the belt avoid
  // this case, but `spawnX` is also called by the debug spawn hook and by any
  // caller that has already decided a rock must appear NOW. A rule that threw
  // here would turn a legibility problem into a crash.
  if (spans.length === 0) return leastCoveredColumn(allowed, blocks);

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

// ---------------------------------------------------------------------------
// PLATE ON PLATE (UR-23, second face)
// ---------------------------------------------------------------------------

/**
 * ================== THE SAME COMPLAINT, ONE OBJECT ALONG ==================
 *
 * UR-23 is "a rock is covering a word". It was answered by making the plate
 * opaque and putting the plate layer above the whole world, so nothing the
 * WORLD draws can reach a word. That left the one thing the depth fix cannot
 * help with: a plate drawing over another plate. Both are in the same
 * container in the same order in every frame, so a pixel diff cancels it, and
 * `plate-legibility.spec.ts` counts it geometrically instead. At `maxLive` 7,
 * belt plates only, it counted two overlapping pairs across six boards with
 * 34.7% of a word covered by its neighbour. A child cannot type a word they
 * cannot read, and a four-letter word with a third of it behind another plate
 * is a letter and a half gone.
 *
 * ================== WHY THE COLUMN RULE AND NOT THE PLATE ==================
 * Three places could carry this. Narrowing the plate shrinks the type, and the
 * plate is wide because a seven-year-old has to read it. Nudging a plate
 * sideways off its own rock breaks AC-2.3, which says the word hangs under the
 * silhouette it belongs to. What is left is where the rock is put, and the
 * column is decided exactly once, here, before anything is drawn.
 *
 * ================== WHY IT IS NOT A FLAT KEEP-OUT ==================
 * The obvious rule - "never spawn within a plate-width of any live rock" - does
 * not fit on the board. The playable span is `width - 2 * marginPx`, 1280 px at
 * the 16:9 floor, and a plate is `letters * cell + 2 * pad` wide: 243.6 px at
 * the longest word any shipped pool carries, 287.6 px with D41's increased
 * letter spacing. Seven of those plus their sway need about 2150 px of a 1280
 * px board. A flat rule would therefore spend most of a deep board in its own
 * degenerate fallback, which is a rule that stops holding exactly when the
 * board gets busy - and the whole point of `maxLive` is that the board is
 * allowed to get busy.
 *
 * It is also far more separation than the defect needs. Two plates 700 px apart
 * vertically do not overlap however close their columns are. So the rule asks
 * the narrower question: of the rocks already falling, WHICH ONES will this new
 * rock's plate ever come level with? Those, and only those, take a column
 * keep-out. Usually that is none or one, so a deep board keeps almost all of
 * its width, and the guarantee is exact rather than approximate.
 *
 * ================== WHY THE ANSWER IS KNOWN AT SPAWN ==================
 * A rock's whole trajectory is fixed the instant it is made: it falls from
 * `fromY` to `toY` over `fallMs`, both decided before the column is. So the
 * vertical distance between two plates is an affine function of time over the
 * window both are in flight, and "do they ever come within a plate height of
 * each other" is arithmetic, not a simulation. Plate height is a function of
 * the STYLE alone - `plateSize` puts the word only in the width - so every
 * plate on a board is the same height and the test is `|dy| < ha + hb`.
 *
 * The x is not fixed: `FlightScene.updateRocks` sways a rock
 * `sin(t) * ROCK_DRIFT_PX` either side of its column. Two rocks can sway
 * towards each other, so the keep-out carries `2 * driftPx` on top of the two
 * half-widths, and the guarantee holds at every phase rather than at most of
 * them.
 */

/** How far a rock sways either side of its column. `FlightScene.updateRocks`. */
export const ROCK_DRIFT_PX = 10;

/**
 * One plate's flight, in the terms the column rule needs.
 *
 * `fromY`/`toY` are the PLATE's centre, not the rock's - the plate hangs a
 * rock-dependent distance below its rock (`plateOffsetY`), so two rocks level
 * with each other do not have plates level with each other.
 */
export interface PlateTrack {
  readonly halfWidthPx: number;
  readonly halfHeightPx: number;
  /** Plate centre y the instant the rock arrives. */
  readonly fromY: number;
  /** Plate centre y the instant the rock reaches the breach line. */
  readonly toY: number;
  readonly spawnedAtMs: number;
  readonly fallMs: number;
}

/** A plate already on the belt: a track that has had its column chosen. */
export interface LivePlateTrack extends PlateTrack {
  readonly homeX: number;
}

/**
 * Where a plate's centre is at `atMs`.
 *
 * Clamped at both ends. A rock that has passed its deadline is being retired
 * rather than falling further, and a `fallMs` of zero is a configuration
 * mistake rather than an infinitely fast rock - answering with the breach line
 * keeps this total instead of returning NaN into a comparison, where it would
 * silently read as "no conflict" and drop the keep-out.
 */
export function plateCentreYAt(track: PlateTrack, atMs: number): number {
  if (!(track.fallMs > 0)) return track.toY;
  const progress = (atMs - track.spawnedAtMs) / track.fallMs;
  const clamped = Math.max(0, Math.min(1, progress));
  return track.fromY + (track.toY - track.fromY) * clamped;
}

/**
 * Do these two plates ever come level enough to overlap, if their columns were
 * the same?
 *
 * The separation is affine in time over the window both are in flight, so it is
 * enough to look at the two ends of that window: if the sign changes they cross
 * and the separation passes through zero; otherwise the closest they come is at
 * one end or the other.
 */
export function platesCanMeetVertically(a: PlateTrack, b: PlateTrack): boolean {
  const from = Math.max(a.spawnedAtMs, b.spawnedAtMs);
  const to = Math.min(a.spawnedAtMs + Math.max(0, a.fallMs), b.spawnedAtMs + Math.max(0, b.fallMs));
  if (to < from) return false;
  const reach = a.halfHeightPx + b.halfHeightPx;
  const atFrom = plateCentreYAt(a, from) - plateCentreYAt(b, from);
  const atTo = plateCentreYAt(a, to) - plateCentreYAt(b, to);
  // They swap sides, so at some instant between the two they are level.
  if (atFrom <= 0 !== atTo <= 0) return true;
  return Math.min(Math.abs(atFrom), Math.abs(atTo)) < reach;
}

/**
 * The columns this rock may NOT take, one band per live plate it will come
 * level with.
 *
 * A band is centred on the live rock's own column and is as wide as the two
 * plates' half-widths plus the sway they can each put on top of it, so a column
 * outside every band cannot produce an overlapping frame at any time or at any
 * drift phase.
 */
export function plateKeepOuts(
  incoming: PlateTrack,
  live: readonly LivePlateTrack[],
  driftPx: number = ROCK_DRIFT_PX,
): readonly Span[] {
  const out: Span[] = [];
  for (const other of live) {
    if (!platesCanMeetVertically(incoming, other)) continue;
    const reach = incoming.halfWidthPx + other.halfWidthPx + 2 * Math.max(0, driftPx);
    out.push({ from: other.homeX - reach, to: other.homeX + reach });
  }
  return out;
}

/** The parts of `spans` that no block covers. Zero-width leftovers are dropped. */
export function subtractSpans(
  spans: readonly Span[],
  blocks: readonly Span[],
): readonly Span[] {
  let kept: Span[] = [...spans];
  for (const block of blocks) {
    const next: Span[] = [];
    for (const span of kept) {
      if (block.to <= span.from || block.from >= span.to) {
        next.push(span);
        continue;
      }
      if (block.from > span.from) next.push({ from: span.from, to: block.from });
      if (block.to < span.to) next.push({ from: block.to, to: span.to });
    }
    kept = next;
  }
  return kept.filter((s) => widthOf(s) > 0);
}

/** How far outside every block `x` is; negative means inside one of them. */
function slackAt(x: number, blocks: readonly Span[]): number {
  let worst = Number.POSITIVE_INFINITY;
  for (const block of blocks) {
    const centre = (block.from + block.to) / 2;
    const radius = widthOf(block) / 2;
    worst = Math.min(worst, Math.abs(x - centre) - radius);
  }
  return worst;
}

/**
 * The least bad column, for the board that has no good one.
 *
 * WHY THIS IS NOT A THROW AND NOT A UNIFORM PICK. A board can genuinely run out
 * of room - a very long word arriving while several long words are already
 * level with where it will be - and when it does, the rock still has to go
 * somewhere. Falling back to a uniform pick would put it on top of a neighbour
 * as often as the unfixed rule did; throwing would turn a legibility problem
 * into a crash. So the fallback keeps the INTENT: the column that is furthest
 * outside the bands it cannot avoid, which covers as little of a neighbour as
 * the board allows.
 *
 * `min(|x - c| - r)` over the bands is piecewise linear in x, so its maximum
 * over the allowed span sits either at an end of that span or where two bands'
 * constraints cross. Both sets are enumerated; there is no search and no
 * tolerance. Ties go to the leftmost, so the answer is deterministic and a test
 * can name it.
 */
export function leastCoveredColumn(
  spans: readonly Span[],
  blocks: readonly Span[],
): number {
  const candidates: number[] = [];
  for (const span of spans) candidates.push(span.from, span.to);
  for (const block of blocks) candidates.push(block.from, block.to);
  for (const a of blocks) {
    for (const b of blocks) {
      if (a === b) continue;
      const ca = (a.from + a.to) / 2;
      const cb = (b.from + b.to) / 2;
      const ra = widthOf(a) / 2;
      const rb = widthOf(b) / 2;
      candidates.push((ca + cb + ra - rb) / 2, (ca + cb - ra + rb) / 2);
    }
  }
  const inside = (x: number): boolean =>
    spans.some((s) => x >= s.from && x <= s.to);
  let best = (spans[0] as Span).from;
  let bestSlack = Number.NEGATIVE_INFINITY;
  for (const x of candidates) {
    if (!inside(x)) continue;
    const slack = slackAt(x, blocks);
    if (slack > bestSlack) {
      bestSlack = slack;
      best = x;
    }
  }
  return best;
}
