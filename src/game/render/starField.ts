/**
 * THE STARFIELD (UR-14) - stationary, and twinkling out of step.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS NOT A PARALLAX LAYER
 *
 * The stars used to be `starTile` on the `celestial` container, wrapped with
 * `wrapY` and scrolled at that layer's 0.05. A player looked at the Title and
 * said: "the stars should not actually be moving in the parallax. Keep the stars
 * just keep them stationary and flickering slowly at different intervals."
 *
 * That is right about the look and right about the physics, which is why it
 * looks wrong. Parallax is an artifact of DISTANCE: the nearer a thing is, the
 * faster it crosses your view. Stars are so far away that no motion of the ship
 * produces perceptible displacement - it is the same reason the Moon "follows"
 * a car and the constellations do not. A sliding starfield says the stars are
 * about as far off as the scenery, and the eye knows they are not.
 *
 * So the field is PINNED. It goes on the sky container, which `parallax.ts`
 * holds at (0, 0) forever, so it neither scrolls nor takes the camera sway.
 *
 * ---------------------------------------------------------------------------
 * WHAT MOVES INSTEAD, AND WHY IT HAS TO
 *
 * AC-22.2: two Title frames a second apart must differ by more than 2% of
 * pixels - the idle screen is never completely still. The star layer used to
 * satisfy that by sliding. Now the twinkle carries it.
 *
 * STAGGERED, not synchronised. Every star gets its own period and its own phase
 * offset, both drawn from the tile's seeded rand, so the field shimmers rather
 * than pulsing. A field twinkling in unison reads as a flashing grid, which is
 * worse than the sliding it replaced.
 *
 * ONE GRAPHICS, REDRAWN. Ninety tweened sprites would be ninety draw calls
 * against the AC-22.9 budget; ninety `fillCircle` calls into a single cleared
 * Graphics is one. That is the only reason this is a class with an `update`
 * rather than a list of `TileOp`s like everything else in `tiles.ts` - those are
 * static by construction, and this one has to breathe.
 */

import Phaser from "phaser";
import { hexToNum } from "./palette.js";

interface Star {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  /** Peak alpha. Some stars are simply fainter than others. */
  readonly base: number;
  /** Milliseconds for one full cycle. */
  readonly period: number;
  /** Radians. What keeps the field from pulsing as one. */
  readonly phase: number;
  /**
   * How much this star twinkles at all, 0..1. A field where every star has the
   * same swing reads as mechanical; real ones vary, and the still ones give the
   * eye something steady to read the moving ones against.
   */
  readonly swing: number;
}

export interface StarField {
  readonly graphics: Phaser.GameObjects.Graphics;
  /** Call from the scene's update with the parallax's own elapsed clock. */
  update(elapsedMs: number, reducedMotion: boolean): void;
  destroy(): void;
}

/** Slowest and fastest full cycle. "Slowly", as asked - seconds, not frames. */
const PERIOD_MIN_MS = 2600;
const PERIOD_MAX_MS = 7400;

/**
 * Under reduced motion the twinkle SLOWS rather than stopping (D41: the world
 * stays alive, it just stops being busy), which also keeps AC-22.2 satisfied on
 * a screen where nothing else may be moving.
 */
const REDUCED_PERIOD_SCALE = 2.2;

export function buildStarField(
  scene: Phaser.Scene,
  w: number,
  h: number,
  tint: string,
  count: number,
  rand: () => number,
): StarField {
  const stars: Star[] = [];
  for (let i = 0; i < count; i += 1) {
    stars.push({
      x: rand() * w,
      y: rand() * h,
      r: 0.8 + rand() * 1.6,
      base: 0.3 + rand() * 0.55,
      period: PERIOD_MIN_MS + rand() * (PERIOD_MAX_MS - PERIOD_MIN_MS),
      phase: rand() * Math.PI * 2,
      swing: rand() * 0.8,
    });
  }

  const color = hexToNum(tint);
  const graphics = scene.add.graphics();

  const paint = (elapsedMs: number, reducedMotion: boolean): void => {
    graphics.clear();
    const scale = reducedMotion ? REDUCED_PERIOD_SCALE : 1;
    for (const s of stars) {
      // sin in [-1, 1] -> [0, 1], so a star dims toward its floor and returns to
      // `base` rather than overshooting into a colour it never had.
      const wave = (Math.sin((elapsedMs / (s.period * scale)) * Math.PI * 2 + s.phase) + 1) / 2;
      graphics.fillStyle(color, s.base * (1 - s.swing + s.swing * wave));
      graphics.fillCircle(s.x, s.y, s.r);
    }
  };

  paint(0, false);

  return {
    graphics,
    update(elapsedMs: number, reducedMotion: boolean): void {
      paint(elapsedMs, reducedMotion);
    },
    destroy(): void {
      graphics.destroy();
    },
  };
}

/**
 * The alpha a star shows at a given time, as pure arithmetic.
 *
 * Split out so `tests/unit/render/starField.test.ts` can assert the two
 * properties that matter - that the field is staggered, and that it never goes
 * fully dark or exceeds its base - without a canvas.
 */
export function twinkleAlpha(
  base: number,
  swing: number,
  period: number,
  phase: number,
  elapsedMs: number,
): number {
  const wave = (Math.sin((elapsedMs / period) * Math.PI * 2 + phase) + 1) / 2;
  return base * (1 - swing + swing * wave);
}
