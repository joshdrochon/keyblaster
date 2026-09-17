/**
 * KEEP-CLEAR: the one place a screen says "no decorative debris here".
 *
 * ===================== WHY THIS FILE EXISTS =====================
 * It was reported twice, on two screens, for the same reason.
 *
 *   UR-06  a black asteroid across the "B" of KEYBLASTER on the Title.
 *   UR-52  a black asteroid across MARS on the Director map.
 *
 * UR-06 was fixed by giving `driftTile` a `keepClear` rectangle list and
 * passing one rectangle in from `TitleScene`. That fix was correct and it was
 * also the whole defect: it lived inside one scene's `create()`, so the next
 * screen to put something it cared about under the debris planes got the bug
 * back. `docs/verification-gaps.md` calls this shape out; the stars did exactly
 * the same thing (stopped on the Title, resurfaced in the briefing window).
 *
 * So the mechanism lives HERE, not in a scene. A screen builds a zone list,
 * `buildParallax` takes it, and `driftTile` drops any rock whose EDGE touches
 * one. Adding a screen is adding a `KeepClear` builder, not re-deriving a rule.
 *
 * ===================== WHY CIRCLES AS WELL AS RECTS =====================
 * The Title protects a column of type, which is a rectangle. The map protects
 * seven PLANET DISCS, which are not. A bounding rectangle round a disc excludes
 * 1 - pi/4 = 21% more sky than the disc needs, on seven discs, on a screen whose
 * debris budget is sixteen rocks. Debris crowded out of the frame is the other
 * way to fail this ticket, so the shape the screen draws is the shape it
 * registers.
 *
 * ===================== WHY IT MEASURES EDGES =====================
 * `hitsKeepClear` compares the rock's EDGE, never its centre. A centre-based
 * test silently inverts the moment the radius outgrows the margin, and that is
 * exactly how 67 px of rock ended up inside a word lane and rendered "acon"
 * (see `tiles.ts`, the note above `driftTile`'s band arithmetic).
 *
 * ===================== WHY IT DROPS RATHER THAN NUDGES =====================
 * A rock that would land on a zone is dropped. Nudging biases the field away
 * from the protected thing, which reads as a HOLE in the debris - a second
 * visual bug introduced by the fix for the first. `driftTile` has already
 * consumed the same number of `rand()` calls either way, so the field stays
 * deterministic for the pixel-diff tests.
 *
 * Nothing here imports Phaser or the DOM: it is geometry, and it is unit-tested
 * as geometry (`tests/unit/render/keepClear.test.ts`).
 */

/** A rectangle in tile/design coordinates. */
export interface KeepClearRect {
  readonly kind: "rect";
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A disc in tile/design coordinates. */
export interface KeepClearCircle {
  readonly kind: "circle";
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

export type KeepClearShape = KeepClearRect | KeepClearCircle;

/**
 * The margin a zone carries by default, in px.
 *
 * 28 is UR-06's number, kept: a rock TOUCHING the edge of a letter reads as
 * badly as one on it, and the decorative planes still breathe +/- 8 px under
 * `idleDriftPx` + `cameraSwayPx` on a screen that is otherwise still, so a zone
 * cut exactly to the ink would leak on some frames and not others.
 */
export const KEEP_CLEAR_PAD = 28;

/**
 * A screen's zone list, under construction.
 *
 * Immutable-out, chainable-in. Scenes build one in the same place they build
 * their layout constants so the zone and the thing it protects are derived from
 * the same numbers and cannot drift apart - which is the OTHER half of UR-06's
 * fix and the reason `TitleScene` bounds its rectangle by the layout constants
 * rather than by the measured lockup (the parallax is built before the type is).
 */
export class KeepClear {
  private readonly out: KeepClearShape[] = [];

  /** `pad` is added on every side. Pass 0 for a zone already sized to include it. */
  rect(x: number, y: number, w: number, h: number, pad: number = KEEP_CLEAR_PAD): this {
    this.out.push({ kind: "rect", x: x - pad, y: y - pad, w: w + pad * 2, h: h + pad * 2 });
    return this;
  }

  /** A disc. `pad` grows the radius. */
  circle(cx: number, cy: number, r: number, pad: number = KEEP_CLEAR_PAD): this {
    this.out.push({ kind: "circle", cx, cy, r: r + pad });
    return this;
  }

  /** A text block centred on `cx`, the shape `skyText(originX: 0.5)` draws. */
  centredBlock(cx: number, top: number, w: number, h: number, pad: number = KEEP_CLEAR_PAD): this {
    return this.rect(cx - w / 2, top, w, h, pad);
  }

  add(shapes: readonly KeepClearShape[]): this {
    this.out.push(...shapes);
    return this;
  }

  zones(): readonly KeepClearShape[] {
    return this.out;
  }
}

export const keepClear = (): KeepClear => new KeepClear();

/**
 * The rim `driftTile` paints just outside the outline (`towardLight(.., 2.5)`).
 *
 * `driftOutline` samples radii that top out at 1.0 (`asteroid.ts` PROFILE, and
 * `tiles.FALLBACK_RADII`), so the ink never reaches past `radius` - except for
 * this rim. Counted, so the disc test is a bound on the INK rather than on the
 * construction radius.
 */
const ROCK_RIM = 3;

/**
 * Does a rock centred at (cx, cy) with this radius touch any zone?
 *
 * EDGE-ACCURATE, for the reason the lane guard is: a centre-based test silently
 * inverts once the radius outgrows the margin, and that is how 67 px of rock
 * ended up inside a word lane.
 *
 * THE TWO SHAPES ARE TESTED DIFFERENTLY, ON PURPOSE.
 *
 *   rect    the rock's bounding BOX against the rectangle. This is the test
 *           UR-06 shipped and it is the conservative direction - it also
 *           excludes a rock that only reaches a corner's box. Kept exactly,
 *           because the Title's zone is a rectangle and changing its meaning
 *           while porting it would be a silent re-render of the screen the
 *           first report was about.
 *   circle  disc against disc. A bounding box round a disc is 4/pi = 27%
 *           larger than the disc, and the Director map registers fourteen of
 *           them; debris crowded out of the frame is the OTHER way to fail
 *           UR-52, so a planet is tested as the shape it is drawn as.
 */
export function hitsKeepClear(
  cx: number,
  cy: number,
  radius: number,
  zones: readonly KeepClearShape[] | undefined,
): boolean {
  if (zones === undefined) return false;
  const reach = radius + ROCK_RIM;
  for (const z of zones) {
    if (z.kind === "circle") {
      const dx = cx - z.cx;
      const dy = cy - z.cy;
      const sum = reach + z.r;
      if (dx * dx + dy * dy < sum * sum) return true;
      continue;
    }
    if (
      cx + radius > z.x &&
      cx - radius < z.x + z.w &&
      cy + radius > z.y &&
      cy - radius < z.y + z.h
    ) {
      return true;
    }
  }
  return false;
}

/** The axis-aligned bounds of a zone, for a test or a debug overlay. */
export function zoneBounds(z: KeepClearShape): {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
} {
  return z.kind === "circle"
    ? { x0: z.cx - z.r, y0: z.cy - z.r, x1: z.cx + z.r, y1: z.cy + z.r }
    : { x0: z.x, y0: z.y, x1: z.x + z.w, y1: z.y + z.h };
}

/** Total zone area, as a fraction of a w x h frame. The crowding-out check. */
export function zoneCoverage(
  zones: readonly KeepClearShape[],
  w: number,
  h: number,
  samplesPerAxis = 240,
): number {
  let hit = 0;
  let total = 0;
  for (let iy = 0; iy < samplesPerAxis; iy += 1) {
    const y = ((iy + 0.5) / samplesPerAxis) * h;
    for (let ix = 0; ix < samplesPerAxis; ix += 1) {
      const x = ((ix + 0.5) / samplesPerAxis) * w;
      total += 1;
      if (hitsKeepClear(x, y, 0, zones)) hit += 1;
    }
  }
  return hit / total;
}
