/**
 * TILE GEOMETRY - the wrapping content of every parallax plane, as pure data.
 *
 * WHY THIS FILE EXISTS
 *
 * A scrolling plane wraps by drawing its content TWICE, one tile above the
 * other, and taking the container's y modulo the stage height. That only works
 * if the two copies are THE SAME CONTENT. `parallax.ts` used to generate them
 * like this:
 *
 *     for (const dy of [0, -h])
 *       for (let i = 0; i < count; i++) {
 *         const halfW = (110 + rand() * 190) * scale;   // <- fresh rand per copy
 *         ...
 *
 * so the tile at `dy = 0` and the tile at `dy = -h` were two different
 * landscapes. The wrap arithmetic was right and the loop still jolted, because
 * at the seam a completely different arrangement snapped into frame. A player
 * described it exactly: "it has a real jolt to it, like it's reached the end and
 * then it restarts."
 *
 * THE FIX IS STRUCTURAL, not a patch. Every generator here builds ONE tile of
 * geometry, consuming `rand()` exactly once per feature, and returns it as a
 * list of primitive draw ops. `wrapY` then produces the second copy by
 * TRANSLATION. There is no code path that can re-roll a copy, so the seam
 * cannot come back by someone adding a generator later and forgetting - the only
 * way to get a wrapping plane is to call `wrapY`, and `wrapY` translates.
 *
 * It also makes the whole thing testable: this module imports no Phaser and
 * touches no canvas, so `tests/unit/render/tiles.test.ts` can assert the seam
 * property directly on the geometry instead of eyeballing a screenshot.
 *
 * `parallax.ts` owns the replay: one `drawOps` that walks the list.
 */

import {
  atmospheric,
  desaturate,
  mixHex,
  relativeLuminance,
} from "./palette.js";
import { hitsKeepClear, type KeepClearShape } from "./keepClear.js";

export {
  hitsKeepClear,
  type KeepClearShape,
  type KeepClearRect,
  type KeepClearCircle,
} from "./keepClear.js";

// ---------------------------------------------------------------------------
// Ops
// ---------------------------------------------------------------------------

export interface Vec {
  readonly x: number;
  readonly y: number;
}

/** The generated-texture keys a tile may place. Maps to `TEX` in textures.ts. */
export type TileSpriteKey = "mote" | "glint" | "glow";

/**
 * One primitive draw. Deliberately tiny: four shapes cover every plane in the
 * game, and a small vocabulary is what makes the translate-to-wrap rule
 * mechanical rather than a per-generator promise.
 */
export type TileOp =
  | { readonly kind: "poly"; readonly color: string; readonly alpha: number; readonly points: readonly Vec[] }
  | { readonly kind: "circle"; readonly color: string; readonly alpha: number; readonly x: number; readonly y: number; readonly r: number }
  | { readonly kind: "ellipse"; readonly color: string; readonly alpha: number; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | {
      readonly kind: "sprite";
      readonly tex: TileSpriteKey;
      readonly color: string;
      readonly alpha: number;
      readonly x: number;
      readonly y: number;
      readonly size: number;
      readonly additive: boolean;
    };

/** Move a whole op list. The ONLY way a wrapped copy is ever produced. */
export function translateOps(ops: readonly TileOp[], dx: number, dy: number): TileOp[] {
  return ops.map((op) => {
    switch (op.kind) {
      case "poly":
        return { ...op, points: op.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
      default:
        return { ...op, x: op.x + dx, y: op.y + dy };
    }
  });
}

/**
 * One tile, plus the same tile one stage-height above it.
 *
 * This is the seam. `parallax.update` keeps the container's y in [0, h), so the
 * copy at `-h` is what is on screen as the offset approaches h - and because it
 * is a translation of the first, the frame at offset h-1 and the frame at offset
 * 0 differ by one pixel of scroll and nothing else.
 */
export function wrapY(ops: readonly TileOp[], h: number): TileOp[] {
  return [...ops, ...translateOps(ops, 0, -h)];
}

/**
 * Wrapped on BOTH axes, for the decorative debris fields.
 *
 * Those planes drift sideways as well as scrolling (see `driftTile`), so they
 * have a seam on the x axis too and it fails the same way.
 */
export function wrapXY(ops: readonly TileOp[], w: number, h: number): TileOp[] {
  return wrapY([...ops, ...translateOps(ops, -w, 0)], h);
}

// ---------------------------------------------------------------------------
// COMPOSITING: why every silhouette op below is drawn at alpha 1
// ---------------------------------------------------------------------------

/**
 * The white seams a player asked about ("is that on purpose?") were not on
 * purpose. Each plane's shapes were drawn at 0.9-0.95 alpha into one Graphics,
 * so wherever two of them overlapped the pixel was composited twice and came out
 * LIGHTER - a pale ghost line down every join, which is exactly what a seam
 * looks like.
 *
 * The fix is a rule rather than a tuning, and it is stated here because it has
 * to hold for every generator in this file:
 *
 *   1. EVERY SILHOUETTE OP IS OPAQUE. Distance is carried by COLOUR (see
 *      `atmospheric` in palette.ts), never by transparency. A far ridge is not a
 *      near one at 40% - it is a near one mixed into the sky, which is what air
 *      actually does and which composites identically however many shapes
 *      overlap.
 *   2. RIMS FIRST, THEN FILLS, THEN DETAIL. A rim is an offset copy drawn BEHIND
 *      its mass. If rims and fills interleave, mass B's lit edge lands on top of
 *      mass A's body and the plane grows an internal outline - a different way
 *      of getting the same pale join. Emitting all rims, then all fills, makes
 *      the whole plane ONE opaque silhouette with its lit edge on the outside,
 *      which is what the reference's planes are.
 *
 * `tests/unit/render/tiles.test.ts` asserts both, so a generator added later
 * cannot quietly reintroduce the seam.
 */

/** Alpha for anything that is part of a silhouette. There is only one value. */
const SOLID = 1;


interface Layered {
  readonly rims: TileOp[];
  readonly fills: TileOp[];
  readonly detail: TileOp[];
}

const layered = (): Layered => ({ rims: [], fills: [], detail: [] });
const flatten = (l: Layered): TileOp[] => [...l.rims, ...l.fills, ...l.detail];

/** Offset a point list toward the light, for the rim copy drawn behind a mass. */
function towardLight(points: readonly Vec[], light: number, px: number): Vec[] {
  const dx = -Math.cos(light) * px;
  const dy = -Math.sin(light) * px;
  return points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

// ---------------------------------------------------------------------------
// Plane tiles
// ---------------------------------------------------------------------------

/**
 * THE SILHOUETTE PLANES CARRY NO MASSES AT ALL NOW.
 *
 * This file has held three generations of them: generated `massifPoints` blobs,
 * authored terrain profiles traced from silhouette sheets, and then `spaceTile`
 * - ring planes seen edge-on and a planet limb, under D97.
 *
 * The first two failed structurally. A plane that wraps every tile height can
 * only be a partial fill, and a partial fill repeated vertically is a band with
 * sky above and below it; and near-black mass lane-guarded out of the word
 * column collapses onto the frame's edges and reads as a border. Six playtest
 * reports came out of those two facts.
 *
 * The third failed on taste, after three rounds of review: the bright right-hand
 * portion never resolved into a readable object, and the horizontal forms beside
 * it read as noise rather than structure. Both were cut.
 *
 * The depth planes are not empty - they carry DEBRIS at their own ramp value,
 * which is why `depthRamp` and `BANDS_BEHIND_DEBRIS` survive untouched. What
 * they no longer carry is anything the eye reads as a landform or a structure.
 *
 * Anyone adding mass back: the two structural results above are not opinions,
 * and the third is the user's. Read them before drawing.
 */

/**
 * WHAT EACH GENERATOR IN THIS FILE DRAWS, as the star rule sees it (UR-14).
 *
 * ================== WHY A TABLE AND NOT A COMMENT ==================
 * UR-14 has now been reported four times and every round was the same shape: a
 * surface drew points of light, nobody had classified it, and the guard written
 * that round only knew about the mechanism that round had found. Round four's
 * was this file's `moteTile` - 44 motes and 14 glints replayed onto a plane
 * that scrolls at 1.30 x world speed, travelling 96.2 px/s on the Title.
 *
 * So the classification is data rather than prose. `starsMayTravel` in
 * `starField.ts` decides whether light may translate on a given screen; this
 * says which of the drawings below ARE light, and `tests/unit/arch` asserts
 * that the two agree - that every generator here is classified, and that every
 * LIGHT one reaches the scene through the seam rather than straight onto a
 * scrolling container. A new generator is unclassified, and unclassified is
 * red, on the day it is written rather than the day somebody plays it.
 *
 * ================== WHERE THE LINE IS ==================
 * LIGHT is a small, bright, self-luminous speck with no internal structure:
 * the `mote` dots and `glint` sparkles, and the accent diamonds, which at 4-9
 * px of opaque saturated colour are the most speck-like marks in the frame.
 *
 * MATTER is a thing a light falls on. A decorative rock has a silhouette, a
 * facet and a rim; the mid-field dust is a 240-660 px soft ellipse at alpha
 * 0.035-0.09, which reads as haze; the foreground veil is a sheet. These keep
 * their parallax everywhere, because a plane moving past the camera is what
 * UR-50.4 asked for and no report has ever objected to it.
 */
export const TILE_DRAWS: Readonly<Record<string, "light" | "matter">> = {
  moteTile: "light",
  accentTile: "light",
  dustTile: "matter",
  driftTile: "matter",
  veilTile: "matter",
};

/** Mid-field dust: bigger, softer, lower-contrast than the near field. */
export function dustTile(w: number, h: number, fill: string, rand: () => number): TileOp[] {
  const out: TileOp[] = [];
  for (let i = 0; i < 20; i++) {
    out.push({
      kind: "ellipse",
      color: fill,
      alpha: 0.035 + rand() * 0.055,
      x: rand() * w,
      y: rand() * h,
      w: 240 + rand() * 420,
      h: 34 + rand() * 60,
    });
  }
  return out;
}

/**
 * `starTile` is gone (UR-14). Stars are no longer tiled, wrapped or scrolled -
 * they are a PINNED field that twinkles, in `starField.ts`. The report was that
 * the stars must not move with the parallax, and it is right about the physics
 * as well as the look: nothing at interstellar distance has perceptible
 * parallax.
 */

/** Foreground motes and glints: sparse, blurred BY SIZE, never by a filter. */
export function moteTile(
  w: number,
  h: number,
  fill: string,
  accent: string,
  rand: () => number,
): TileOp[] {
  const out: TileOp[] = [];
  for (let i = 0; i < 22; i++) {
    const s = 18 + rand() * 54;
    out.push({
      kind: "sprite",
      tex: "mote",
      color: mixHex(fill, "#FFFFFF", 0.12),
      alpha: 0.1 + rand() * 0.16,
      x: rand() * w,
      y: rand() * h,
      size: s,
      additive: false,
    });
  }
  for (let i = 0; i < 7; i++) {
    const s = 14 + rand() * 20;
    out.push({
      kind: "sprite",
      tex: "glint",
      color: accent,
      alpha: 0.3 + rand() * 0.35,
      x: rand() * w,
      y: rand() * h,
      size: s,
      additive: true,
    });
  }
  return out;
}

/**
 * WORLD-BAR item 7: sparse, high-contrast accents. Three per tile, tiny, in the
 * stop's accent. Their whole job is to be the one saturated thing in frame.
 */
export function accentTile(
  w: number,
  h: number,
  bright: string,
  rand: () => number,
  keepClear?: readonly KeepClearShape[],
): TileOp[] {
  const out: TileOp[] = [];
  for (let i = 0; i < 3; i++) {
    let cx = w * (0.1 + rand() * 0.8);
    let cy = ((i + rand()) / 3) * h;
    // The accents were the one decoration no zone could steer, so a diamond
    // could land on the hint line or behind Shadow. A cluster spans ~52 px
    // below its anchor, so it is tested at that reach.
    for (let tries = 0; tries < 12 && hitsKeepClear(cx, cy + 26, 52, keepClear); tries += 1) {
      cx = w * (0.1 + rand() * 0.8);
      cy = ((i + rand()) / 3) * h;
    }
    if (hitsKeepClear(cx, cy + 26, 52, keepClear)) continue;
    for (const [ox, oy, s] of [
      [0, 0, 9],
      [22, 34, 5],
      [-18, 52, 4],
    ] as const) {
      out.push({
        kind: "poly",
        color: bright,
        // Opaque, like every other silhouette op: the accents are the one
        // saturated thing in frame and a translucent one is a dull one.
        alpha: SOLID,
        points: [
          { x: cx + ox, y: cy + oy - s },
          { x: cx + ox + s, y: cy + oy },
          { x: cx + ox, y: cy + oy + s },
          { x: cx + ox - s, y: cy + oy },
        ],
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Decorative debris (the player's note: nothing OBJECT-like passes the camera)
// ---------------------------------------------------------------------------

/**
 * One debris material, as this module needs it.
 *
 * `parallax.ts` builds these from `asteroid.ts`'s FR-12b table so the shapes and
 * the two-tone fill are the stop's REAL material - the same rock, seen from
 * further away. It is passed in rather than imported because `asteroid.ts`
 * imports Phaser, and this module has to stay loadable in a unit test.
 */
export interface DriftMaterial {
  /** Radius profile in [0.7, 1.0], sampled at equal angles from -90 degrees. */
  readonly radii: readonly number[];
  readonly facets: readonly { readonly x: number; readonly y: number; readonly r: number }[];
  readonly fill: string;
  readonly facet: string;
  readonly rim: string | null;
}

/**
 * A neutral chunky profile for the one stop with no FR-12b row.
 *
 * Earth's emptiness is by construction (D57: the launchpad has no belt), so
 * there is no material to borrow. The Title still needs objects at depth, and a
 * generic rounded rock in the plane's own value is not a content claim about
 * Earth - it is scenery, drawn in the palette's colours like everything else.
 */
export const FALLBACK_RADII: readonly number[] = [0.94, 1.0, 0.86, 0.97, 0.88, 1.0, 0.85, 0.95];

/** Points per decorative outline. Fewer than a gameplay rock: these are small. */
const DRIFT_STEPS = 28;

function radiusAt(radii: readonly number[], t: number): number {
  const n = radii.length;
  const scaled = t * n;
  const i = Math.floor(scaled) % n;
  const j = (i + 1) % n;
  const a = radii[i] as number;
  const b = radii[j] as number;
  const f = scaled - Math.floor(scaled);
  return a + (b - a) * ((1 - Math.cos(f * Math.PI)) / 2);
}

/** One rock outline, centred on (cx, cy). Rounded, chunky, never spiky. */
export function driftOutline(
  radii: readonly number[],
  cx: number,
  cy: number,
  radius: number,
  spin: number,
): Vec[] {
  const out: Vec[] = [];
  for (let s = 0; s < DRIFT_STEPS; s++) {
    const t = s / DRIFT_STEPS;
    const angle = -Math.PI / 2 + t * Math.PI * 2 + spin;
    const r = radiusAt(radii, t) * radius;
    out.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
  }
  return out;
}

export interface DriftTileOptions {
  readonly materials: readonly DriftMaterial[];
  readonly count: number;
  readonly minPx: number;
  readonly maxPx: number;
  readonly light: number;
  /** Keep out of [lane, 1-lane] in x. 0 allows the whole width. */
  readonly laneGuard: number;
  /**
   * Shapes no decorative rock may overlap, in tile coordinates.
   *
   * `laneGuard` keeps debris out of the SHIP'S lane, which is the centre. It
   * cannot help a screen whose content is somewhere else: on the Title the
   * wordmark sits in the LEFT band, which is exactly where the guard sends
   * rocks, so KEYBLASTER had an asteroid across its K (UR-06); on the Director
   * map the seven planets sit across the WHOLE width and a near-black rock
   * landed on Mars (UR-52). A scene knows where its own content is and the
   * parallax cannot, so the scene passes it in.
   *
   * The zone list and the edge-accurate hit test live in `keepClear.ts`, which
   * is the shared mechanism BOTH those screens now register with. It used to be
   * a rect list defined in this file and assembled by hand inside
   * `TitleScene.create()`, which is why the second screen did not get it.
   */
  readonly keepClear?: readonly KeepClearShape[];
  readonly rand: () => number;
}

/**
 * A rectangle in tile coordinates.
 *
 * Retained as the untagged rectangle the rest of this module uses for bands and
 * bounds. Keep-clear zones are `KeepClearShape` (re-exported at the top of this
 * file), because a planet is a disc and a bounding box round one excludes 21%
 * more sky than it needs to.
 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * DECORATIVE debris: one tile of rocks that are NOT in the ship's lane.
 *
 * WHY THEY EXIST. Every typeable rock in the game is on one plane at speed 1.0,
 * because fall time is a learning rule (FR-8 / D19 computes it per word, per
 * player) and a typeable rock at another speed makes the 85% band meaningless.
 * The consequence was that nothing object-like ever passed the camera at any
 * other depth: the world moved, but nothing moved PAST you, and five terrain
 * bands alone do not sell parallax.
 *
 * WHY THEY ARE OBVIOUSLY NOT TYPEABLE, and it is not a label. A decorative rock
 * is on a different TRACK. Its plane drifts sideways as well as down (see
 * `parallax.ts`, `DRIFT_X`), so it crosses the frame and leaves by the side
 * instead of falling down the lane toward the ship - and `laneGuard` keeps the
 * near ones out of the centre column entirely. A child learns it the way you
 * learn anything in a game, by watching one drift past and miss. Only rocks in
 * the ship's own lane are a threat, and those are the ones carrying word plates.
 */
export function driftTile(w: number, h: number, o: DriftTileOptions): TileOp[] {
  const out = layered();
  if (o.materials.length === 0 || o.count <= 0) return [];

  for (let i = 0; i < o.count; i++) {
    const m = o.materials[Math.floor(o.rand() * o.materials.length) % o.materials.length] as DriftMaterial;
    const radius = (o.minPx + o.rand() * (o.maxPx - o.minPx)) / 2;
    const cy = ((i + o.rand() * 0.8) / o.count) * h;
    const u = o.rand();
    // Outside the lane guard: the left band, or the right band, never between.
    //
    // THE BAND IS MEASURED TO THE SHAPE'S EDGE, NOT ITS CENTRE, and shapes are
    // allowed to hang off the frame. The previous arithmetic placed CENTRES
    // inside `[radius, w * laneGuard - radius]`, which is fine while a rock is
    // small and silently inverts once `radius` passes `w * laneGuard / 2`: at
    // 200 px on a 1280 px stage the left band ran to cx 200, and 200 + 200 put
    // 67 px of rock inside the word lane. That is a plate a child cannot read,
    // arriving as a side effect of making the foreground bigger.
    //
    // Letting a near object be CROPPED by the frame is also what the reference
    // does - `alto-03`'s palms run off the top and both sides - so the fix and
    // the look want the same thing.
    // EDGE-ACCURATE. `w * laneGuard` is where the rock must STOP, so the
    // rightmost centre on the left band is that minus the radius - with no
    // `Math.max` floor under it. A floor lets a big shape overhang the guard,
    // and the render that first grew these put a 130 px rock at cx 250 with its
    // edge at 380, straight over a word plate: the capture reads "acon".
    //
    // When the radius exceeds the whole band the centre goes negative and the
    // shape is simply cropped by the frame, which is what `alto-03` does with
    // its palms and is the correct behaviour for a near-camera object.
    const reach = w * o.laneGuard - radius;
    const cx =
      o.laneGuard <= 0
        ? radius + u * (w - radius * 2)
        : u < 0.5
          ? -radius * 0.35 + u * 2 * (reach + radius * 0.35)
          : w + radius * 0.35 - (u - 0.5) * 2 * (reach + radius * 0.35);
    // (both branches are symmetric about the frame's centre line)
    // A rock that would land on the scene's own text is DROPPED, not nudged.
    // Nudging would bias the whole field away from the text and read as a hole
    // in the debris; dropping one of nine costs nothing and keeps the
    // distribution honest. `rand()` has already been consumed either way, so
    // the field stays deterministic for the pixel-diff tests.
    if (hitsKeepClear(cx, cy, radius, o.keepClear)) continue;

    const spin = o.rand() * Math.PI * 2;
    const shape = driftOutline(m.radii, cx, cy, radius, spin);

    // Opaque, and rims before fills before facets - the compositing rule at the
    // top of this file. Two overlapping decorative rocks used to composite
    // lighter where they crossed, which is the same pale-join defect the
    // silhouette planes had, just smaller.
    if (m.rim !== null) {
      out.rims.push({
        kind: "poly",
        color: m.rim,
        alpha: SOLID,
        points: towardLight(shape, o.light, 2.5),
      });
    }
    out.fills.push({ kind: "poly", color: m.fill, alpha: SOLID, points: shape });
    for (const f of m.facets) {
      out.detail.push({
        kind: "circle",
        // Pre-mixed rather than drawn at 55%: a facet is a value step on the
        // rock, and a value step is a colour.
        color: mixHex(m.fill, m.facet, 0.55),
        alpha: SOLID,
        x: cx + f.x * radius,
        y: cy + f.y * radius,
        r: f.r * radius,
      });
    }
  }
  return flatten(out);
}

// ---------------------------------------------------------------------------
// Foreground veils (PRD section 6 / FR-12b sourcing discipline)
// ---------------------------------------------------------------------------

/**
 * What passes in FRONT of the camera at each stop, and the fact behind it.
 *
 * The ask was "something cloud-like passing in front, for depth", with the
 * correct objection that clouds do not belong in space. At six of seven stops
 * there is a real answer and no invention is needed, which matters because this
 * product's content spine is NASA-sourced per FR-12b and the debris table is
 * already cited row by row. The `source` field here is transcribed from the
 * same NASA pages `asteroid.ts` cites, so an audit can check it the same way.
 *
 * A stop with no honest answer would get `null` rather than a fudge.
 */
export interface VeilSpec {
  readonly kind: "dust" | "ice" | "cloud" | "haze";
  /** What it actually is. Plain language, for the audit and for the comment. */
  readonly what: string;
  readonly source: string;
  /** Veil tint, as a mix key into the stop's palette. */
  readonly warm: boolean;
}

const NASA_MARS = "https://science.nasa.gov/mars/facts/";
const NASA_BELT = "https://science.nasa.gov/solar-system/asteroids/facts/";
const NASA_SATURN = "https://science.nasa.gov/saturn/facts/";
const NASA_URANUS = "https://science.nasa.gov/uranus/facts/";
const NASA_NEPTUNE = "https://science.nasa.gov/neptune/neptune-facts/";
const NASA_KUIPER = "https://science.nasa.gov/solar-system/kuiper-belt/facts/";

export const VEIL_BY_STOP: Readonly<Record<string, VeilSpec | null>> = {
  // Earth has no FR-12b row at all (D57: the launchpad has no belt), so there
  // is no sourced material to cite. A night cloud deck over a launchpad needs
  // none - the palette itself carries a `cloud` colour role (#E8EEF7), promoted
  // into palettes.json as part of the rubric, and that is the cited content.
  earth: { kind: "cloud", what: "night cloud deck over the launchpad", source: "src/content/palettes.json colorRoles.cloud", warm: false },
  // Mars has planet-wide dust storms; the suspended rust dust is the reason our
  // Mars sky is butterscotch rather than blue.
  mars: { kind: "dust", what: "airborne dust from planet-scale storms", source: NASA_MARS, warm: true },
  // Collisions in the belt grind rock into dust bands that sit in the plane of
  // the solar system - the same material FR-12b's Jupiter rows are made of.
  jupiter: { kind: "dust", what: "dust bands ground off by belt collisions", source: NASA_BELT, warm: true },
  // FR-12b already describes Saturn's ring material as ice chunks coated in
  // dust; the fine end of that distribution is an ice-crystal veil.
  saturn: { kind: "ice", what: "ice-crystal veil off the ring material", source: NASA_SATURN, warm: false },
  // Uranus' rings are made of unusually dark particles; their fines are a haze.
  uranus: { kind: "haze", what: "haze of dark ring particles", source: NASA_URANUS, warm: false },
  // No invention required whatsoever: Neptune has methane ice clouds and they
  // have been photographed.
  neptune: { kind: "cloud", what: "methane ice clouds", source: NASA_NEPTUNE, warm: false },
  // Also real: New Horizons found roughly twenty stacked haze layers at Pluto,
  // and they are blue - against a frost-white surface, which is a gift.
  pluto: { kind: "haze", what: "stacked blue haze layers", source: NASA_KUIPER, warm: false },
};

export function veilFor(stopId: string): VeilSpec | null {
  return VEIL_BY_STOP[stopId] ?? null;
}

export interface VeilTileOptions {
  readonly spec: VeilSpec;
  readonly tint: string;
  /** Keep out of [lane, 1-lane] in x. AC-22.8: never between a player and a word. */
  readonly laneGuard: number;
  readonly rand: () => number;
}

/**
 * One tile of the front-of-camera veil.
 *
 * HARD CONSTRAINT: legibility is the game (AC-22.8). A veil that sits between a
 * player and a word they are reading is a defect, not atmosphere. So it is
 * thin, it is low alpha, it keeps moving, and `laneGuard` keeps it out of the
 * centre column where the plates fall. It is drawn in front of the ship and
 * behind the HUD.
 */
export function veilTile(w: number, h: number, o: VeilTileOptions): TileOp[] {
  const out: TileOp[] = [];
  const bands = o.spec.kind === "cloud" ? 4 : 6;
  const guard = Math.max(0.05, Math.min(0.45, o.laneGuard));
  for (let i = 0; i < bands; i++) {
    const left = o.rand() < 0.5;
    const spanW = w * guard;
    const cx = left ? o.rand() * spanW : w - o.rand() * spanW;
    const cy = ((i + o.rand()) / bands) * h;
    // Wide and shallow: a veil is a horizontal smear, not a blob. Cloud decks
    // are the fattest, haze layers the thinnest and most stacked.
    const rx = (o.spec.kind === "cloud" ? 210 : 300) + o.rand() * 260;
    const ry = (o.spec.kind === "cloud" ? 34 : 14) + o.rand() * (o.spec.kind === "cloud" ? 30 : 16);
    const alpha = (o.spec.kind === "cloud" ? 0.1 : 0.07) + o.rand() * 0.06;
    out.push({ kind: "ellipse", color: o.tint, alpha, x: cx, y: cy, w: rx, h: ry });
    // A softer, wider echo underneath, so the edge is never a drawn line.
    out.push({
      kind: "ellipse",
      color: o.tint,
      alpha: alpha * 0.55,
      x: cx + (o.rand() - 0.5) * 90,
      y: cy + ry * 0.45,
      w: rx * 1.45,
      h: ry * 1.7,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Value helpers used by the near-plane bound (see palette.ts)
// ---------------------------------------------------------------------------

/**
 * The value a decorative plane's material takes: the real rock, pushed into the
 * haze for its distance and then toward that plane's own fill.
 *
 * Kept here so `tiles.test.ts` can assert the ordering far -> near without a
 * canvas: a near decorative rock must be darker-or-lighter in the same
 * direction as its plane, never a mid-grey floating between planes.
 */
export function planeMaterialColor(
  fill: string,
  sky: string,
  planeFill: string,
  lift: number,
  bond: number,
): string {
  const lifted = atmospheric(fill, sky, lift);
  return mixHex(lifted, planeFill, Math.min(1, Math.max(0, bond)));
}

/** Convenience re-exports so `parallax.ts` has one import for colour maths. */
export { desaturate, relativeLuminance };
