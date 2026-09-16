/**
 * GENERATED TEXTURES (D83, AC-23.1, art-direction.md sections 1 and 9).
 *
 * No raster asset ships. Every texture the game samples is drawn here from
 * Phaser Graphics at boot and baked with `generateTexture`, so the gauntlet's
 * G-raster scan finds nothing to load and the art stays resolution-independent.
 *
 * Everything is drawn WHITE so a single texture serves every stop: callers tint
 * it from the active palette. That is also why the set is small - four particle
 * shapes plus a star and a soft glow cover the whole art direction.
 *
 * `ensureTextures` is idempotent and cheap to call from any scene's `create`;
 * boot calls it once before the first scene starts.
 */

import Phaser from "phaser";

/** Texture keys. Namespaced so a scene lane cannot collide with them. */
export const TEX = {
  /** Rock chunk for `blastShards`: irregular, rounded, tumbles well. */
  shard: "kb/tex/shard",
  /** Ambient dust mote: soft-edged dot for `dustMotes` and the near field. */
  mote: "kb/tex/mote",
  /** Four-point sparkle for ice glints and the near field. */
  glint: "kb/tex/glint",
  /** Soft radial falloff. The only "light" primitive; ADD-blended in use. */
  glow: "kb/tex/glow",
  /** Five-point star: the Lantern's fin mark and the map's rating stars. */
  star: "kb/tex/star",
  /** Hard little dot for `strikeSpark` and `warpStreaks`. */
  spark: "kb/tex/spark",
} as const;

export type TextureKey = (typeof TEX)[keyof typeof TEX];

// ---------------------------------------------------------------------------
// Vector primitives shared by every drawing module in render/.
// ---------------------------------------------------------------------------

export interface Pt {
  x: number;
  y: number;
}

/**
 * Round a control polygon into an organic closed shape.
 *
 * The whole art direction is "rounded, chunky, friendly; no sharp spikes", and
 * hand-listing enough points for that is unreadable. Control points describe the
 * silhouette; the spline does the rounding. Used by the Lantern's fins and by
 * every silhouette band and rock in parallax.ts.
 */
export function smoothPolygon(points: readonly Pt[], samplesPerSegment = 10): Pt[] {
  const n = points.length;
  if (n < 3) return points.map((p) => ({ x: p.x, y: p.y }));
  const at_ = (i: number): Pt => points[((i % n) + n) % n] as Pt;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = at_(i - 1);
    const p1 = at_(i);
    const p2 = at_(i + 1);
    const p3 = at_(i + 2);
    for (let s = 0; s < samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
      out.push({
        x: catmullRom(p0.x, p1.x, p2.x, p3.x, t),
        y: catmullRom(p0.y, p1.y, p2.y, p3.y, t),
      });
    }
  }
  return out;
}

/** Uniform Catmull-Rom on one segment. Closed-loop safe because callers wrap. */
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/**
 * A vertical body profile: half-widths sampled down a spine, mirrored into a
 * closed outline. This is how the Lantern's fuselage is built, and it is what
 * lets a coloured stripe be clipped to the hull exactly (see `profileBand`).
 */
export function profilePolygon(
  yTop: number,
  yBottom: number,
  halfWidth: (t: number) => number,
  steps = 40,
): Pt[] {
  const right: Pt[] = [];
  const left: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = yTop + (yBottom - yTop) * t;
    const w = halfWidth(t);
    right.push({ x: w, y });
    left.push({ x: -w, y });
  }
  left.reverse();
  return [...right, ...left];
}

/** The slice of a body profile between two spine fractions, as a closed shape. */
export function profileBand(
  yTop: number,
  yBottom: number,
  halfWidth: (t: number) => number,
  tA: number,
  tB: number,
  steps = 18,
): Pt[] {
  const right: Pt[] = [];
  const left: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = tA + (tB - tA) * (i / steps);
    const y = yTop + (yBottom - yTop) * t;
    const w = halfWidth(t);
    right.push({ x: w, y });
    left.push({ x: -w, y });
  }
  left.reverse();
  return [...right, ...left];
}

/** Catmull-Rom over a table of stops, for profiles described by a few numbers. */
export function rampAt(stops: readonly number[], t: number): number {
  if (stops.length === 0) return 0;
  const clamped = Phaser.Math.Clamp(t, 0, 1);
  const pos = clamped * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(pos));
  const f = pos - i;
  const p0 = stops[Math.max(0, i - 1)] as number;
  const p1 = stops[i] as number;
  const p2 = stops[i + 1] as number;
  const p3 = stops[Math.min(stops.length - 1, i + 2)] as number;
  return catmullRom(p0, p1, p2, p3, f);
}

/** Fill a closed point list on a Graphics. */
export function fillShape(g: Phaser.GameObjects.Graphics, pts: readonly Pt[]): void {
  g.fillPoints(pts.map((p) => new Phaser.Geom.Point(p.x, p.y)), true, true);
}

/** Five-point star point list, first point straight up. */
export function starPoints(cx: number, cy: number, outer: number, inner: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

// ---------------------------------------------------------------------------
// The boot-time bake
// ---------------------------------------------------------------------------

/** Steps in the soft-glow falloff. 40 rings reads as a gradient at any size. */
const GLOW_RINGS = 40;

function bake(
  scene: Phaser.Scene,
  key: string,
  width: number,
  height: number,
  draw: (g: Phaser.GameObjects.Graphics) => void,
): void {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(g);
  g.generateTexture(key, width, height);
  g.destroy();
}

/**
 * Draw every generated texture once. Safe to call repeatedly: each key is
 * skipped if the texture manager already has it.
 */
export function ensureTextures(scene: Phaser.Scene): void {
  // Shard: an irregular rounded chunk. Rock-shaped, never spiky (art dir. 4).
  bake(scene, TEX.shard, 28, 28, (g) => {
    g.fillStyle(0xffffff, 1);
    fillShape(
      g,
      smoothPolygon(
        [
          { x: 14, y: 2 },
          { x: 23, y: 7 },
          { x: 26, y: 16 },
          { x: 19, y: 25 },
          { x: 9, y: 24 },
          { x: 2, y: 15 },
          { x: 4, y: 6 },
        ],
        8,
      ),
    );
  });

  // Mote: a soft dot. Three rings of falloff so it blurs by size, not filter.
  bake(scene, TEX.mote, 16, 16, (g) => {
    g.fillStyle(0xffffff, 0.22);
    g.fillCircle(8, 8, 8);
    g.fillStyle(0xffffff, 0.45);
    g.fillCircle(8, 8, 5.2);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(8, 8, 2.6);
  });

  // Glint: two crossed tapered spindles - the ice sparkle.
  bake(scene, TEX.glint, 28, 28, (g) => {
    g.fillStyle(0xffffff, 1);
    fillShape(g, [
      { x: 14, y: 0 },
      { x: 16.4, y: 11.6 },
      { x: 28, y: 14 },
      { x: 16.4, y: 16.4 },
      { x: 14, y: 28 },
      { x: 11.6, y: 16.4 },
      { x: 0, y: 14 },
      { x: 11.6, y: 11.6 },
    ]);
    g.fillStyle(0xffffff, 0.85);
    g.fillCircle(14, 14, 2.4);
  });

  // Glow: quadratic alpha falloff, drawn as concentric discs. This is the one
  // primitive that stands in for a gradient; Graphics has no radial fill.
  bake(scene, TEX.glow, 160, 160, (g) => {
    for (let i = GLOW_RINGS; i > 0; i--) {
      const t = i / GLOW_RINGS;
      g.fillStyle(0xffffff, (1 - t) ** 2 * 0.5 + (t < 0.12 ? 0.5 : 0));
      g.fillCircle(80, 80, 80 * t);
    }
  });

  bake(scene, TEX.star, 32, 32, (g) => {
    g.fillStyle(0xffffff, 1);
    fillShape(g, starPoints(16, 16, 16, 6.6));
  });

  bake(scene, TEX.spark, 8, 8, (g) => {
    g.fillStyle(0xffffff, 1);
    g.fillCircle(4, 4, 3.6);
  });
}
