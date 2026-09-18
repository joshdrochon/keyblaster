/**
 * THE STARFIELD (UR-14) - stationary, and twinkling out of step.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS NOT A PARALLAX LAYER
 *
 * The stars used to be `starTile` on the `celestial` container, wrapped with
 * `wrapY` and scrolled at that layer's 0.05. UR-14, reported from play on the
 * Title: the stars must not move with the parallax at all. They should hold
 * still and twinkle slowly, each on its own interval.
 *
 * That is right about the look and right about the physics, which is why the
 * scrolling version looks wrong. Parallax is an artifact of DISTANCE: the nearer a thing is, the
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
 *
 * ---------------------------------------------------------------------------
 * AND THIS FILE IS NOW WHERE THE RULE LIVES - see `starsMayTravel` below.
 */

import Phaser from "phaser";
import { hexToNum } from "./palette.js";

// ---------------------------------------------------------------------------
// THE RULE, AND THE ONLY PLACE THAT DECIDES IT (UR-14)
// ---------------------------------------------------------------------------

/**
 * Every surface in the game that draws a FIELD OF SMALL LIGHT MARKS on the sky.
 *
 * ================== WHY THIS ENUMERATION EXISTS ==================
 * UR-14 has been reported three times, on three screens, and each of the first
 * two fixes was made where the report came from. Round 1 pinned the field on
 * the Title. Round 2 stopped the decorative debris planes marching across the
 * Briefing. Round 3 was the same complaint again, on the same screen, about a
 * third mechanism nobody had catalogued: the per-stop atmosphere pass in
 * `parallax.ts`, a full-frame tiled texture of white marks whose texture
 * coordinates were advanced every frame.
 *
 * That is the shape of UR-06 exactly - a keep-clear built for the Title
 * wordmark, then debris over the Director map's planets, then a shared
 * mechanism. A defect reported three times on three mechanisms is not three
 * defects; it is one missing rule. So the rule is stated once, here, and every
 * surface asks this module rather than deciding locally:
 *
 *   world.starField    `buildStarField` below, on the pinned `sky` container
 *   world.atmosphere   `atmospherePass` in `parallax.ts` - depending on the
 *                      stop this is 140 additive dots ("glitter"), 24 long
 *                      leaning lines ("streaks") or 40 short ones ("dust").
 *                      Points of light on a black sky, whatever it is called.
 *   world.nearLight    `moteTile` and `accentTile` in `tiles.ts`, replayed onto
 *                      the near plane by `parallax.ts`: 44 `mote` sprites, 14
 *                      `glint` sprites and 6 accent diamonds per world screen.
 *                      Round four. See the boundary note below.
 *   menu.backdrop      `Backdrop` in `ui/chrome.ts`, placed by `ui/starfield.ts`
 *
 * A new surface that draws specks adds a member here, which is a compile error
 * everywhere the table below is exhaustive - so it cannot be added quietly.
 *
 * ================== TWO IMPLEMENTATIONS OF ONE DRAWING ==================
 * `world.atmosphere` is on this list because of what it LOOKS like, not what it
 * is called. Rendered alone on black at Saturn it is a starfield - denser and
 * more even than the one below, because the 512 px texture tiles about eight
 * times across a 1920 frame and each tile carries 140 additive dots. Every
 * world screen therefore draws TWO fields of small white marks: this module's,
 * which is pinned, and that one, which was not.
 *
 * Standards rule 3 says one implementation per drawing and gives the reason -
 * a guard that finds the implementation whose FILE IS NAMED after the thing
 * will judge a drawing the game is not showing. That is what happened here for
 * three reports running. Freezing the pass fixes the defect; the duplication
 * itself is a live design question (fold the glitter into this field, or drop
 * the kind and give those stops more stars) and it is raised rather than
 * settled quietly.
 *
 * ================== WHERE THE LINE IS, AND WHY IT MOVED (ROUND FOUR) ========
 * Round three drew the line at MECHANISM: a full-frame overlay holds still, and
 * anything placed at a depth travels at its plane's speed "because that is what
 * parallax means". It named `moteTile`'s motes and glints as things that MAY
 * travel. That sentence is why UR-14 came back a fourth time.
 *
 * Measured on the shipped Title at commit 1f10068, 4.0 s of world: texture
 * scroll zero everywhere (round three's fix holds), and 58 sprites travelling
 * 384.8 px - 44 `kb/tex/mote` and 14 `kb/tex/glint`, riding the near plane at
 * 1.30 x the Title's 74 px/s world speed. Fifty-eight lit specks crossing a
 * menu sky. Nothing about the drawing changed between round three and round
 * four; only the sentence that excused it.
 *
 * THE LINE IS NOW APPEARANCE, NOT PLACEMENT, and it has two halves:
 *
 *   WHAT it is. A POINT OF LIGHT is a small, bright, self-luminous speck with
 *   no internal structure: the `mote` and `glint` sprites, the accent diamonds
 *   (4-9 px, opaque, fully saturated - the most speck-like thing in the frame),
 *   the pinned field, the atmosphere pass, the menu backdrop's stars. Lit
 *   MATTER is not: a decorative rock has a silhouette, a facet and a rim; the
 *   mid-field dust is a 240-660 px soft low-alpha ellipse, which is haze; the
 *   foreground veil is a sheet. Those are objects seen by a light, and they
 *   keep their parallax. No report in UR-14's history has named a drifting rock;
 *   all four have named the lights.
 *
 *   WHERE it is. A point of light holds position on a screen the ship is not
 *   flying through. On a MENU nothing is moving, so a plane's speed conveys
 *   nothing and a drifting speck is just a drifting speck. On Flight the ship
 *   IS moving and the whole stack scrolls, so the same speck field carries
 *   depth - which is why Flight is the exception below rather than an accident
 *   of which file draws it.
 *
 * WHAT DID NOT CHANGE. UR-50.4 asked for debris drifting down the Briefing
 * window and it still does: the rocks, the dust and the veil are untouched on
 * every screen. Freezing the near-plane specks costs the near plane a depth
 * cue on screens where there is no depth to cue.
 */
export type StarSurface =
  | "world.starField"
  | "world.atmosphere"
  | "world.nearLight"
  | "menu.backdrop";

/**
 * THE ANSWER IS NO. Stars hold position; flicker is the only animation they get.
 *
 * The exceptions are keyed `surface@SceneKey` and the value is why. Anything
 * not in this table does not translate, on any screen, in any axis, by any
 * mechanism - object position, container offset or texture coordinate.
 *
 * DERIVED, NOT PASSED IN. The scene does not get to hand `buildParallax` a flag
 * saying whether its stars move, because that is the arrangement that failed:
 * `crossDrift` is an opt-out every new screen has to remember, and a screen
 * nobody remembers is exactly how this came back. A screen gets the right
 * answer by existing, and buying an exception costs an entry here with a
 * sentence attached.
 */
const TRAVELLING_LIGHT: Readonly<Record<string, string>> = {
  // EMPTY, AND THAT IS THE DECISION (UR-14, round five).
  //
  // Rounds one to four each removed one mechanism and granted Flight an
  // exception on the argument that the ship is genuinely moving there, so a
  // frozen speck field over scrolling planes would read as dirt on the canopy.
  // The owner has ruled against it, and the reason is simple physics a child
  // already knows: stars are extremely far away, so no visible movement should
  // exist, including while flying.
  //
  // MATTER STILL MOVES. Rocks, dust, the veil and the debris planes all keep
  // their parallax on every screen - see `TILE_DRAWS` in `render/tiles.ts` for
  // the line between a point of LIGHT and a thing a light falls on. What is
  // frozen is the sky, not the world.
  //
  // Buying an exception back costs an entry here with a sentence attached, and
  // an empty table is the only state where a new screen cannot inherit one by
  // accident.
};

/**
 * The other deliberate travelling light, named here so the guard can tell it
 * from an accident even though it is not an ambient field.
 *
 * `warpStreaks` (art-direction section 9, AC-22.6) is a PARTICLE BURST fired
 * once at the warp break, in the stop's accent, lasting about a second, and
 * switched off entirely under reduced motion (D41). It is travelling light on
 * purpose: the break is the moment the ship is meant to be moving, and the
 * streaks are the only thing on screen that says so. It is emitted from
 * `WarpScene.emitStreaks`, it is not a field of stars, and it does not go
 * through `starsMayTravel` because it has no ambient, always-on existence to
 * govern. Warp's own atmosphere pass is NOT excepted and does not move: the
 * break is calm, not frozen, and its ambient layers carry that by drifting.
 */
export const TRAVELLING_LIGHT_EFFECTS = ["warpStreaks"] as const;

/**
 * May this surface, on this screen, translate its light marks?
 *
 * The one seam. `parallax.ts` and `ui/chrome.ts` both call it; nothing else
 * decides.
 */
export function starsMayTravel(surface: StarSurface, sceneKey: string): boolean {
  return `${surface}@${sceneKey}` in TRAVELLING_LIGHT;
}

/** The justification for an exception, or null if there is not one. Read by the guard. */
export function travelExceptionReason(
  surface: StarSurface,
  sceneKey: string,
): string | null {
  return TRAVELLING_LIGHT[`${surface}@${sceneKey}`] ?? null;
}

/** Every exception currently granted, as `surface@SceneKey`. Read by the guard. */
export function travelExceptions(): readonly string[] {
  return Object.keys(TRAVELLING_LIGHT);
}

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
 * The flicker parameters for one star, drawn from a seeded rand.
 *
 * SHARED, because "flicker at varying intervals" is half of UR-14 and the menu
 * backdrop used to satisfy none of it - its stars were painted once into the
 * same Graphics as the sky gradient and then never touched again, so five
 * screens showed a field of dead pixels. Both surfaces take their period, phase
 * and swing from here, so "varying intervals" means the same thing everywhere
 * and there is one set of numbers to tune.
 */
export interface Twinkle {
  /** Milliseconds for one full cycle. */
  readonly period: number;
  /** Radians. What keeps the field from pulsing as one. */
  readonly phase: number;
  /** How much this star twinkles at all, 0..1. Some of them barely do. */
  readonly swing: number;
}

export function twinkleFor(rand: () => number): Twinkle {
  return {
    period: PERIOD_MIN_MS + rand() * (PERIOD_MAX_MS - PERIOD_MIN_MS),
    phase: rand() * Math.PI * 2,
    swing: rand() * 0.8,
  };
}

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
      ...twinkleFor(rand),
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
