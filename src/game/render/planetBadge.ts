import type Phaser from "phaser";
import type { Rect } from "@game/ui/layout";
import { hexToNum, mixHex, paletteFor } from "./palette.js";

/**
 * THE DESTINATION BADGE (UR-70): the planet you are about to warp to, drawn as
 * a disc in the sentence card's top right.
 *
 * ================== IT IS DRAWN, NOT LOADED (D83) ==================
 * The reference comp has a little planet tucked into the element's corner. The
 * comp is a TARGET and is never loaded - all art in this game is vector drawn
 * in code - so this is that picture as three shapes: a disc, a terminator, and
 * a ring for the stops that have one. `design-reference/refs` stays a thing we
 * look at.
 *
 * ================== WHY IT IS IN `render/` ==================
 * Because it is the only mark in UR-70 that knows anything about the WORLD. The
 * prompt glyph, the dots and the charge bolt are chrome and live with the plate
 * (`ui/plateLayout.ts`); a planet is a stop, so its colours come from the stop's
 * own palette - the same `palettes.json` the sky, the debris and the rocks are
 * drawn from - and it goes where the rest of the world's drawing lives.
 *
 * NO NEW COLOUR. Both inks are the DESTINATION's palette mixed with itself or
 * with the plate, which is the rule the whole of `palette.ts` is built on: a
 * rendered frame's dominant colours have to stay a subset of the palette
 * (AC-22.7), so a badge that invented a planet colour would be a rubric failure
 * as well as a lie about where the child is going.
 *
 * ================== THE SPEC IS PURE ==================
 * `planetBadgeSpec` is numbers in, numbers out, so "Saturn has a ring and Mars
 * does not" is a unit test rather than something you find out by looking at a
 * capture of one stop.
 */

/**
 * The stops drawn with a ring.
 *
 * The three the solar system actually gives one worth drawing at 44 px. Jupiter
 * has rings and they are invisible; drawing them would make four of the six
 * badges identical, which defeats the point of having a badge at all - a child
 * should be able to tell Saturn from Neptune at a glance.
 */
export const RINGED_STOPS: readonly string[] = ["saturn", "uranus", "neptune"];

export interface PlanetBadgeSpec {
  readonly id: string;
  readonly ringed: boolean;
  /** The ring's tilt, radians. Negative, so it rises to the right. */
  readonly tilt: number;
  /** Where the light comes from, as a fraction of the disc's radius. */
  readonly lightX: number;
  readonly lightY: number;
}

export const BADGE_TILT = -0.32;

export function planetBadgeSpec(stopId: string): PlanetBadgeSpec {
  return {
    id: stopId,
    ringed: RINGED_STOPS.includes(stopId),
    tilt: BADGE_TILT,
    // Lit from the upper left, like every other lit thing in the game.
    lightX: -0.16,
    lightY: -0.16,
  };
}

export interface PlanetBadgeInk {
  /** The lit face. */
  readonly disc: string;
  /** The shadowed side. */
  readonly shade: string;
  /** The ring, when there is one. */
  readonly ring: string;
}

/**
 * The badge's three inks, derived from the DESTINATION's palette.
 *
 * `plate` is the surface the badge is drawn on, and the shade is mixed toward
 * it rather than toward black: a disc shaded to black on a near-black card
 * loses its own edge, which is the same mistake `foregroundInk` exists to stop
 * the debris making against a dark sky.
 */
/**
 * THE TWO STOPS WHOSE ACCENT IS NOT THE PLANET.
 *
 * The badge is drawn from the stop's `accent`, and for five of seven that is
 * right: Mars is rust, Jupiter cream, Uranus pale cyan, Neptune blue, and
 * Pluto's rose is a deliberate stylisation. But `accent` is a UI HIGHLIGHT
 * chosen to read against that stop's sky, not a portrait of the planet - so on
 * the two stops whose sky is the planet's own colour it comes out as very
 * nearly the inverse. Saturn, a gold world, wore a pale blue disc; Earth, the
 * blue one, wore gold.
 *
 * The fix is deliberately NOT "use the palette's `sky` role" - `sky` is the sky
 * SEEN FROM THE GROUND at that stop, so Mars's is pale sand and Earth's is
 * night navy, and reading from it would break the four badges that are already
 * right. Two named overrides, taken from each palette's own roles, is the
 * whole change.
 *
 * `accent` itself is untouched, so every focus ring, plate highlight and UI
 * accent in the game is exactly as it was.
 */
const BADGE_BODY: Readonly<Record<string, string>> = {
  // Earth's accent IS its blue now, and Saturn's its gold, so nothing needs an
  // override. Kept as the seam for any stop whose accent stops being its planet.
  // Saturn's accent IS its body gold now, so no override is needed.
};

export function planetBadgeInk(stopId: string, plate: string): PlanetBadgeInk {
  const p = paletteFor(stopId);
  const body = BADGE_BODY[stopId] ?? p.accent;
  return {
    disc: body,
    shade: mixHex(body, plate, 0.55),
    ring: mixHex(body, plate, 0.25),
  };
}

/** The disc, inset inside the badge square so a ring has room beside it. */
export function badgeDisc(box: Rect, ringed: boolean): {
  readonly x: number;
  readonly y: number;
  readonly r: number;
} {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  // A ringed planet's disc is smaller, because the RING is what has to fit the
  // reserved square: a ring drawn outside the box would hang over the card's
  // padding and, on the warp break, over the rim.
  const r = (Math.min(box.w, box.h) / 2) * (ringed ? 0.62 : 0.86);
  return { x: cx, y: cy, r };
}

/**
 * The lit face: a smaller disc, offset toward the light.
 *
 * Its radius is derived from the offset rather than picked, so the lit disc is
 * always exactly tangent to the planet's edge on the lit side and can never
 * hang over it however the light is aimed. `LIT_INSET` is how much of the
 * planet's edge stays dark all the way round.
 */
export const LIT_INSET = 0.04;

export function badgeLit(
  disc: { readonly x: number; readonly y: number; readonly r: number },
  spec: PlanetBadgeSpec,
): { readonly x: number; readonly y: number; readonly r: number } {
  const offset = Math.hypot(spec.lightX, spec.lightY);
  return {
    x: disc.x + spec.lightX * disc.r,
    y: disc.y + spec.lightY * disc.r,
    r: disc.r * (1 - offset - LIT_INSET),
  };
}

/**
 * A tilted ellipse arc, as points.
 *
 * PURE, AND POINTS RATHER THAN A CANVAS TRANSFORM. Phaser's Graphics can be
 * translated, rotated and scaled, but scaling it to squash a circle into a ring
 * squashes the STROKE with it - a 3 px line becomes 0.9 px on one axis and the
 * ring reads as a scratch. Walking the ellipse and stroking a polyline keeps
 * the line width honest, and it makes the ring's geometry something
 * `planetBadge.test.ts` can assert instead of something a capture has to show.
 */
export function ringArcPoints(
  cx: number,
  cy: number,
  rw: number,
  rh: number,
  tilt: number,
  from: number,
  to: number,
  steps = 24,
): { readonly x: number; readonly y: number }[] {
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = from + ((to - from) * i) / steps;
    const ex = Math.cos(t) * rw;
    const ey = Math.sin(t) * rh;
    out.push({ x: cx + ex * cos - ey * sin, y: cy + ex * sin + ey * cos });
  }
  return out;
}

function strokePolyline(
  g: Phaser.GameObjects.Graphics,
  points: readonly { readonly x: number; readonly y: number }[],
): void {
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a === undefined || b === undefined) continue;
    g.lineBetween(a.x, a.y, b.x, b.y);
  }
}

/**
 * Paint the badge.
 *
 * The order is the picture: ring behind, disc, terminator, ring in front. The
 * front half of the ring is drawn over the disc so the ring passes IN FRONT of
 * the planet's lower half, which is the one cue that makes a circle with a line
 * through it read as a ringed planet rather than as a target.
 */
export function paintPlanetBadge(
  g: Phaser.GameObjects.Graphics,
  box: Rect,
  spec: PlanetBadgeSpec,
  ink: PlanetBadgeInk,
  options: { readonly alpha?: number } = {},
): void {
  const alpha = options.alpha ?? 1;
  const disc = badgeDisc(box, spec.ringed);
  const ringW = (Math.min(box.w, box.h) / 2) * 0.98;
  const ringH = ringW * 0.3;

  if (spec.ringed) {
    // The far half, behind the planet. Dimmer, because it is seen through the
    // ring's own thickness - and because a ring of one flat value reads as a
    // circle drawn around a dot.
    g.lineStyle(3, hexToNum(ink.ring), alpha * 0.7);
    strokePolyline(
      g,
      ringArcPoints(disc.x, disc.y, ringW, ringH, spec.tilt, Math.PI, Math.PI * 2),
    );
  }

  // THE WHOLE PLANET IS THE SHADOWED INK, and the lit face is a smaller disc
  // offset TOWARD the light on top of it. Two circles, in that order, rather
  // than a gradient or a clipped arc: a Graphics has no gradient, a texture
  // would be a raster (D83), and an arc offset off the disc's own centre hangs
  // over the edge on the side the light comes from. `badgeLit` keeps the lit
  // disc strictly inside the planet, which is the containment the test asserts.
  g.fillStyle(hexToNum(ink.shade), alpha);
  g.fillCircle(disc.x, disc.y, disc.r);

  const lit = badgeLit(disc, spec);
  g.fillStyle(hexToNum(ink.disc), alpha);
  g.fillCircle(lit.x, lit.y, lit.r);

  if (spec.ringed) {
    // The near half, in front of the planet.
    g.lineStyle(3, hexToNum(ink.ring), alpha);
    strokePolyline(g, ringArcPoints(disc.x, disc.y, ringW, ringH, spec.tilt, 0, Math.PI));
  }
}
