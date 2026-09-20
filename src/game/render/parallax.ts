/**
 * PARALLAX (AC-22.1, AC-22.2, AC-19.3; art-direction.md section 2;
 * design-reference/refs/WORLD-BAR.md).
 *
 * One builder, used by every world-facing scene. It takes a palette and the
 * LAYERS table from `layers.ts` - it does not invent speeds, depths or drift
 * curves; those ARE the rubric and live there.
 *
 * WHAT IT GUARANTEES
 *  - One container per LayerSpec, at the spec's depth. Scenes add their own
 *    content (the ship, debris, HUD) into `layerOf(id).container` rather than
 *    building a second stack.
 *  - `update(dt)` applies THREE things per layer, and nothing else:
 *      scroll   spec.speed x worldSpeed   (only for layers that scroll)
 *      drift    idleDriftPx(spec, ...)    (kept under reduced motion)
 *      sway     cameraSwayPx(...)         (zero under reduced motion, D41)
 *  - Scrolling wraps: each scrolling layer draws its content twice, one tile
 *    above the other, and the container's y is taken modulo the stage height.
 *    No frame is ever identical to the one before it (rubric 2).
 *
 * WHAT IT DOES NOT DO
 *  Game logic of any kind. It has no notion of a word, a rock or a score.
 *
 * `sky` and `hud` are pinned at speed 0 by the art direction, and `shipFx` is
 * speed 1.0 but THE SHIP IS FIXED (art dir. L6) - its 1.0 describes the plane it
 * shares with debris, not a translation. They still move every frame via drift
 * and sway, so they still count toward "nothing is ever still".
 *
 * ---------------------------------------------------------------------------
 * THE WRAP SEAM, AND WHY IT IS NOW SOMEONE ELSE'S PROBLEM
 *
 * This file used to generate each plane's two wrap copies like this:
 *
 *     for (const dy of [0, -h])
 *       for (let i = 0; i < count; i++) {
 *         const halfW = (110 + rand() * 190) * scale;   // <- fresh rand per copy
 *
 * The wrap arithmetic was correct and the loop still jolted, because the tile at
 * `dy = 0` and the tile at `dy = -h` were two different landscapes: at the seam a
 * whole new arrangement snapped in. Every generator in the file had the same
 * shape and therefore the same bug.
 *
 * All content geometry now lives in `tiles.ts`, which builds ONE tile and then
 * produces the second copy by translation. That module imports no Phaser, so
 * `tests/unit/render/tiles.test.ts` asserts the seam property on the geometry
 * itself rather than on a screenshot. This file's only remaining job on that
 * front is `drawOps`, which replays a list.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE WAS REWRITTEN (WORLD-BAR.md)
 *
 * The previous version passed every measurable check - five layers, five
 * distinct speeds, a gradient that travels, no Linear easing - and the flight
 * screen still read as flat brown bands. Putting a real Alto's Odyssey frame
 * next to ours said why: scroll speed was the ONLY depth cue we had, and speed
 * is the weakest of the eight the reference uses. The other seven are now here,
 * each named where it is built:
 *
 *   1 atmospheric lift    `depthRamp` / `atmospheric` in palette.ts
 *   2 value range         `foregroundInk` + `foregroundObjectInk` in palette.ts
 *   3 hue shift           `coolShift` far, `warmShift` near
 *   4 one light, in frame `celestialBody` / `sunDisc` at `lightPositionOf`
 *   5 characterful shapes `massifTile` - angular, chamfered, terraced, spired
 *   6 dark framing        near-black OBJECTS crossing the near planes, plus a
 *                         floor vignette. Never an edge-to-edge band: see the
 *                         long note at the near-field block.
 *   7 sparse accents      `accentTile` - three, tiny, high contrast
 *   8 atmosphere pass     `atmosphereFor` - one cheap full-screen pass per stop
 *
 * And two the reference does not have to think about, because it is a
 * side-scroller with a horizon and we are a vertical scroller with the ship at
 * the bottom:
 *
 *   9 objects at depth    `driftTile` - decorative debris on four planes, so
 *                         something finally moves PAST the camera rather than
 *                         the whole world moving with it
 *  10 a plane in front    `foreVeil` (layers.ts L6.5) - the stop's own veil and
 *                         its nearest silhouettes, crossing in front of the ship
 *
 * All ten are layers, gradients and generated vector textures, so the AC-22.9
 * budget is untouched: no post-processing, no filters, no shaders.
 */

import Phaser from "phaser";
import { type StopId } from "@engine/types.js";
import { sunScaleForStop } from "./sunScale.js";
import {
  DEBRIS_SPEC,
  LANE_GUARD as LANE_GUARD_FRACTION,
  LAYERS,
  type LayerId,
  type LayerSpec,
  cameraSwayPx,
  idleDriftPx,
  layer,
} from "./layers.js";
import {
  type AtmosphereKind,
  type StopPalette,
  atmosphereFor,
  atmospheric,
  depthRamp,
  foregroundInk,
  foregroundObjectInk,
  hexToNum,
  isBrightStop,
  liftAt,
  lightness,
  withLightness,
  lightAngleOf,
  lightPositionOf,
  mixHex,
  rimOf,
  skyStops,
  skyStopsLate,
} from "./palette.js";
import {
  type DriftMaterial,
  type TileOp,
  FALLBACK_RADII,
  accentTile,
  driftTile,
  dustTile,
  moteTile,
  planeMaterialColor,
  veilFor,
  veilTile,
  wrapXY,
  wrapY,
} from "./tiles.js";
import type { KeepClearShape } from "./keepClear.js";
import {
  buildStarField,
  starsMayTravel,
  twinkleAlpha,
  type StarField,
} from "./starField.js";
import { debrisTypesFor } from "./asteroid.js";
import { TEX, ensureTextures } from "./textures.js";

export { atmosphereFor, type AtmosphereKind } from "./palette.js";

/**
 * The only easing curves allowed anywhere in the game (AC-22.5,
 * art-direction.md section 8). Exported from the render foundation so every
 * lane spells them the same way and `Linear` never gets typed by accident.
 */
export const EASE = {
  /** Something arrives and settles. */
  arrive: "Cubic.easeOut",
  /** Something appears with a little overshoot. */
  pop: "Back.easeOut",
  /** Something breathes or drifts, forever. */
  drift: "Sine.easeInOut",
  /** Something is launched or shattered. */
  blast: "Expo.easeOut",
} as const;

/** Layers that translate with the world. See the header note. */
const SCROLLS: ReadonlySet<LayerId> = new Set<LayerId>([
  "celestial",
  "farField",
  "midField",
  "debris",
  "nearField",
  "foreVeil",
]);

/**
 * Layers pinned at exactly (0,0) forever. The HUD must not sway - a readout
 * that drifts with the camera is unreadable and breaks rubric item 8 - and the
 * sky is full-bleed, so moving it would only risk an edge.
 */
const PINNED: ReadonlySet<LayerId> = new Set<LayerId>(["sky", "hud"]);

/**
 * The four depth planes the ramp is sampled at, far -> near. Four rather than
 * three because the range is the point (WORLD-BAR item 2): three stops between
 * near-sky and near-black leaves a gap the eye reads as a missing layer.
 */
const DEPTH_PLANES = 4;

/**
 * Depth of the near plane's PINNED points of light (UR-14, fourth report).
 *
 * A hair behind `nearField` so the stacking order is byte-for-byte what it was
 * when the specks lived inside that container: motes and accents under the near
 * silhouettes, over the debris plane at 4. Derived from `layers.ts` rather than
 * typed, because a depth split across two files is a depth with two values.
 */
const NEAR_LIGHT_DEPTH = layer("nearField").depth - 0.01;

/** Depth of the pinned floor vignette: in front of the near field, behind the ship. */
const VIGNETTE_DEPTH = 5.6;
/** Depth of the atmosphere pass: in front of the foreground veil, behind the HUD. */
const ATMOSPHERE_DEPTH = 6.8;

/**
 * The atmosphere pass's own flicker, for every screen that is not the one
 * named exception. Slower than the slowest star (7400 ms) and much shallower,
 * because this is one full-frame object rather than ninety specks: at swing
 * 0.3 on a base alpha of 0.13 the pass moves between 0.091 and 0.130, which
 * reads as the air breathing and never as a pulse.
 */
const WEATHER_PERIOD_MS = 9200;
const WEATHER_SWING = 0.3;

/**
 * SIDEWAYS drift of the decorative debris planes, as a multiple of world speed
 * plus a px/s floor that keeps them alive on a still screen (rubric 2).
 *
 * THIS IS THE WHOLE "not typeable" SIGNAL, and it is not a label. A gameplay
 * rock falls straight down the ship's lane, because fall time is a learning rule
 * (FR-8 / D19) and only a rock on that one plane can carry a word. A decorative
 * rock is on a different track: it crosses the frame and leaves by the side. You
 * learn it the way you learn anything in a game - you watch one drift past and
 * miss you - rather than by being told that a different shade of brown means
 * "do not type this".
 *
 * Adjacent planes drift in OPPOSITE directions on purpose. Parallel motion at
 * different speeds reads as one field being scrolled; opposed motion reads as
 * separate things on separate orbits, which is what they are.
 */
const DRIFT_X: Readonly<Record<string, { rate: number; base: number }>> = {
  farField: { rate: 0.1, base: 5 },
  midField: { rate: -0.2, base: -8 },
  nearField: { rate: 0.34, base: 11 },
  foreVeil: { rate: -0.52, base: -15 },
};

/**
 * Master alpha on the foreground veil.
 *
 * `veilTile` emits bands at 7-16% and this scales them, so what actually
 * crosses the ship is 5-12% with a typical band at about 8%. That is the number
 * the brief asked me to pick and state: enough to read as something passing in
 * front, not enough to be looked at. Under reduced motion it drops further
 * (D41 keeps the world alive but this is the layer most likely to bother a
 * motion-sensitive player).
 */
const VEIL_ALPHA = 0.72;
const VEIL_ALPHA_REDUCED = 0.5;

/**
 * Fraction of the stage width, from each edge, that near-plane objects and the
 * veil are allowed to occupy.
 *
 * AC-22.8 is the hard one: legibility is the game. Word plates fall down the
 * centre, so nothing on a plane IN FRONT of them may sit there.
 *
 * TIGHTENED FROM 0.26, because 0.26 was wrong about where plates actually land.
 * A plate follows its rock's x across the spawn lane's playable span, and a
 * capture caught one whose left edge sat at x=275 of 1280 - that is 0.215, well
 * inside the band 0.26 was handing to the foreground. The word read "acon".
 *
 * 0.20 leaves the middle 60% permanently clear, which covers the observed plate
 * positions with room. The coverage it costs is bought back by letting the big
 * near silhouettes hang off the frame EDGE instead of reaching inward, which is
 * what a near-camera object does in the reference anyway.
 */
const LANE_GUARD = LANE_GUARD_FRACTION;


/**
 * The light's on-screen radius, and the column around it the world keeps clear.
 *
 * Both halves live here so they cannot drift apart: `sunDisc` draws at
 * `sunRadius`, and the space forms are told where it is so they can be placed
 * away from it.
 */
function sunRadius(pal: StopPalette): number {
  return isBrightStop(pal) ? 86 : 48;
}



/**
 * UR-08: THE KEEP-OUT COLUMN IS GONE, and it had already gone before the report.
 *
 * `SUN_CLEARANCE` used to widen a vertical strip around the light in which far
 * and mid TERRAIN was forbidden, so a mesa could not crop the disc. It worked,
 * and it carved a visible band into the sky - that strip was the only place the
 * dark shapes were not, so it read brighter than everything either side of it. A
 * user zoomed in and asked what the brighter shape on the right was. A fix for
 * one visual bug had drawn a new one.
 *
 * D97 removed it as a side effect: there is no terrain to exclude, the light is
 * drawn at its own depth in front of the far and mid planes, and the two space
 * forms avoid it by construction instead - a limb is placed on the far side of
 * the light (`lightX`), and a ring band crosses the half of the tile the light
 * is not in (`lightY`). Neither is a hard edge anywhere.
 *
 * The constant is deleted rather than left at a value nothing reads: a keep-out
 * width that no longer keeps anything out is the next person's red herring.
 */

export interface ParallaxOptions {
  readonly palette: StopPalette;
  /** D41 / AC-19.3. Sway off, drift kept. */
  readonly reducedMotion?: boolean;
  readonly width?: number;
  readonly height?: number;
  /** Pixels/second at speed 1.0. 0 freezes scrolling but not drift. */
  readonly worldSpeed?: number;
  /** Layers to populate with generated content. Others get an empty container. */
  readonly decorate?: readonly LayerId[];
  /** Deterministic content, so a pixel-diff test compares like with like. */
  readonly seed?: number;
  /**
   * WORLD-BAR items 6 and 8. On by default, because they are what stops the
   * frame reading as flat; a screen that wants the bare stack (a menu that
   * needs the whole canvas legible) turns them off.
   */
  readonly framing?: boolean;
  readonly atmosphere?: boolean;
  /**
   * Zones decorative debris must not overlap, in design coordinates.
   *
   * `LANE_GUARD` keeps rocks out of the SHIP'S lane, which is the centre. It
   * cannot help a screen whose content is elsewhere: the Title's wordmark sits
   * in the LEFT band, which is exactly where the guard sends rocks, so
   * KEYBLASTER had an asteroid across its K (UR-06), and the Director map's
   * seven planets run the whole width, so a near-black rock landed on Mars
   * (UR-52). The scene knows where its content is and this file cannot, so the
   * scene passes it in - built with `render/keepClear.ts`, which is the one
   * mechanism every screen registers with.
   */
  readonly keepClear?: readonly KeepClearShape[];
  /**
   * May the decorative planes TRAVEL sideways? Default true, which is what
   * every screen did before UR-50.
   *
   * ------------------------------------------------------------------------
   * WHY THIS IS A SWITCH AND NOT A DELETION
   *
   * In FLIGHT the sideways travel is load-bearing and `DRIFT_X` above says so
   * at length: a gameplay rock falls straight down the ship's lane because
   * fall time is a learning rule (FR-8 / D19), and a decorative rock crosses
   * the frame and leaves by the side. That crossing IS the "you cannot type
   * this" signal, and it is taught by watching one drift past rather than by
   * being told. Removing it would delete a mechanic to fix a menu.
   *
   * On a STILL screen there is no lane, no falling rock and nothing to
   * contrast against, so the same motion reads as the whole view sliding. A
   * player has now reported it twice - UR-14 ("keep the stars stationary and
   * flickering") and UR-50.5, on two different screens - and both times the
   * travelling objects were these planes rather than the starfield, which has
   * been pinned since UR-14 (`starField.ts`).
   *
   * So: the planes keep their orbits where a lane exists, and hold still where
   * one does not. The nine story and menu screens pass `false`; Flight does
   * not. `tests/e2e/no-star-travel.spec.ts` is the guard, and it sweeps every
   * screen rather than the one that got reported.
   *
   * It does NOT freeze the frame. `idleDriftPx` and `cameraSwayPx` are bounded
   * sines - +/-2 px of sway and +/-`speed * 6` of drift - so the layers still
   * breathe and AC-22.2's "two frames a second apart differ" still holds, and
   * the starfield still twinkles. What stops is the unbounded `mod(W)` march
   * across the frame.
   */
  readonly crossDrift?: boolean;
}

/**
 * The name every parallax layer container carries.
 *
 * ONE STRING, exported, because two readers depend on it: the alignment census
 * in `scripts/contact-sheet.mjs`, which classifies what it walks, and
 * `tests/unit/ui/nearMissEdges.test.ts`, which fails if a census arrives with
 * no decor in it at all - a classifier that matches nothing would silently
 * exempt the whole world rather than the decoration.
 */
export const DECOR_LAYER_PREFIX = "kb-decor:";

export interface ParallaxLayer {
  readonly spec: LayerSpec;
  readonly container: Phaser.GameObjects.Container;
  /** Current on-screen offset, i.e. what a debug overlay reports. */
  offsetX: number;
  offsetY: number;
}

export interface Parallax {
  readonly layers: readonly ParallaxLayer[];
  layerOf(id: LayerId): ParallaxLayer;
  /** Call from the scene's `update(_, delta)`. */
  update(deltaMs: number): void;
  setWorldSpeed(pxPerSecond: number): void;
  /** 0 = stage start sky, 1 = stage end sky (AC-22.3). */
  setSkyProgress(t: number): void;
  setReducedMotion(on: boolean): void;
  /** Per-layer on-screen offsets; the AC-22.1 debug overlay reads this. */
  debugOffsets(): Record<string, { x: number; y: number }>;
  /** Live motion state, so AC-19.3 can be asserted instead of eyeballed. */
  debugMotion(): { swayPx: number; elapsedMs: number; reducedMotion: boolean };
  /**
   * The value ladder the frame is actually drawn with, far -> near. The R-world
   * judge reads this next to the screenshot so "does it have depth" can be
   * answered with numbers as well as by eye.
   */
  debugDepth(): {
    fills: readonly string[];
    lightAngleRad: number;
    atmosphere: string | null;
    /** The near-black the foreground OBJECTS are drawn in. */
    objectInk: string;
    /** The stop's front-of-camera veil, and the fact it is drawn from. */
    veil: { kind: string; what: string; source: string } | null;
  };
  destroy(): void;
}

/** Default decorated set: everything the background owns. */
const DEFAULT_DECORATE: readonly LayerId[] = [
  "sky",
  "celestial",
  "farField",
  "midField",
  "debris",
  "nearField",
  "foreVeil",
];

const mod = (v: number, m: number): number => ((v % m) + m) % m;

/** mulberry32 - tiny, seeded, no dependency. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

const SPRITE_TEX = { mote: TEX.mote, glint: TEX.glint, glow: TEX.glow } as const;

/**
 * Replay an op list into the scene.
 *
 * ONE Graphics carries every shape in the list, so a whole plane is one draw
 * call however many masses are on it. Sprite ops become Images because they
 * sample a generated texture; there are never many of them.
 */
function drawOps(scene: Phaser.Scene, ops: readonly TileOp[]): Phaser.GameObjects.GameObject[] {
  const out: Phaser.GameObjects.GameObject[] = [];
  const g = scene.add.graphics();
  let used = false;
  for (const op of ops) {
    if (op.kind === "sprite") {
      const img = scene.add
        .image(op.x, op.y, SPRITE_TEX[op.tex])
        .setDisplaySize(op.size, op.size)
        .setTint(hexToNum(op.color))
        .setAlpha(op.alpha);
      if (op.additive) img.setBlendMode(Phaser.BlendModes.ADD);
      out.push(img);
      continue;
    }
    used = true;
    g.fillStyle(hexToNum(op.color), op.alpha);
    switch (op.kind) {
      case "poly":
        g.fillPoints(
          op.points.map((p) => new Phaser.Geom.Point(p.x, p.y)),
          true,
          true,
        );
        break;
      case "circle":
        g.fillCircle(op.x, op.y, op.r);
        break;
      default:
        g.fillEllipse(op.x, op.y, op.w, op.h);
        break;
    }
  }
  if (used) out.unshift(g);
  else g.destroy();
  return out;
}

/** A plane's decorative sub-container: scrolls with its layer, drifts sideways. */
interface DriftPlane {
  readonly container: Phaser.GameObjects.Container;
  readonly rate: number;
  readonly base: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

/**
 * The stop's REAL debris, valued for one plane.
 *
 * Shapes and the two-tone fill come from `asteroid.ts`'s FR-12b table, which is
 * transcribed from the PRD with a NASA source per row - so a decorative rock on
 * Jupiter's far plane is a Trojan seen from further away, not a generic blob.
 * Only the colour changes: lifted into the haze for its distance, then bonded
 * toward that plane's own fill so it belongs to the plane rather than floating
 * between two of them.
 */
function materialsFor(
  pal: StopPalette,
  planeFill: string,
  lift: number,
  bond: number,
  withRim: boolean,
): DriftMaterial[] {
  const sky = skyStops(pal)[1];
  const types = debrisTypesFor(pal.id);
  const out: DriftMaterial[] = [];
  if (types.length === 0) {
    // Earth, by construction: D57 gives the launchpad no belt, so FR-12b has no
    // row to borrow. Scenery in the plane's own colour is not a content claim.
    const fill = planeMaterialColor(planeFill, sky, planeFill, lift, 1);
    out.push({
      radii: FALLBACK_RADII,
      facets: [
        { x: 0.22, y: 0.16, r: 0.24 },
        { x: -0.3, y: 0.34, r: 0.15 },
      ],
      fill,
      facet: mixHex(fill, "#000000", 0.3),
      rim: withRim ? rimOf(fill) : null,
    });
    return out;
  }
  for (const type of types.slice(0, 3)) {
    for (const variant of type.variants.slice(0, 3)) {
      const fill = planeMaterialColor(type.fill, sky, planeFill, lift, bond);
      out.push({
        radii: variant.radii,
        facets: variant.facets.map((f) => ({ x: f.x, y: f.y, r: f.r })),
        fill,
        facet: planeMaterialColor(type.facet, sky, planeFill, lift, bond),
        rim: withRim ? rimOf(fill) : null,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Registry key: the stop whose palette the WORLD IS ACTUALLY DRAWN IN.
 *
 * `boot.ts` needs to know where the player is so the letterbox bars can wear the
 * same sky as the picture inside them. It used to ask the scene tree, and that
 * answer can disagree with the picture: a scene opened straight from a URL
 * carries no `stopId` in its data, so the lookup fell through to the shared
 * `SceneContext` default - Earth - while `FlightScene` had resolved Mars for
 * itself. Measured at a 4:3 window, the bars came out `#0b1b3a` and `#08111f`,
 * which are Earth's sky and ground, framing a Mars screen.
 *
 * This is the answer that cannot disagree, because it is set by the thing that
 * does the drawing.
 */
export const WORLD_STOP_KEY = "kb.worldStop";

export function buildParallax(scene: Phaser.Scene, options: ParallaxOptions): Parallax {
  ensureTextures(scene);

  const pal = options.palette;
  scene.game.registry.set(WORLD_STOP_KEY, pal.id);
  const W = options.width ?? scene.scale.width;
  const H = options.height ?? scene.scale.height;
  const decorate = new Set(options.decorate ?? DEFAULT_DECORATE);
  const rand = rng(options.seed ?? 0x5eed);
  const wantsFraming = options.framing ?? true;
  const wantsAtmosphere = options.atmosphere ?? true;

  let reducedMotion = options.reducedMotion ?? false;
  let worldSpeed = options.worldSpeed ?? 0;
  const crossDrift = options.crossDrift ?? true;
  let elapsedMs = 0;

  // WORLD-BAR items 1-3, in one line: four fills spanning near-sky to the near
  // plane, desaturating and cooling with distance and warming toward the camera.
  const ramp = depthRamp(pal, DEPTH_PLANES);
  const farFill = ramp[0] ?? pal.debris;
  const midFill = ramp[1] ?? pal.debris;
  const debrisFill = ramp[2] ?? pal.debris;
  const nearFill = ramp[3] ?? foregroundInk(pal);
  const objectInk = foregroundObjectInk(pal);
  const sky = skyStops(pal)[1];
  const light = lightAngleOf(pal);
  const keepClear = options.keepClear;

  /**
   * EVERY PARALLAX LAYER IS NAMED, AND THE NAME SAYS "DECOR" (UR-69).
   *
   * These containers hold the seeded-random world: silhouettes, rocks, dust,
   * the stop's light. Their positions come from `seed`, not from a layout, so
   * a rock's left edge is not a line anything is aligned to and never can be.
   *
   * The alignment census used to count them anyway - it walks the real display
   * list and takes any object over 40 px wide - and they were the majority of
   * what it found. On the Ending, three of the four "near-miss pairs" were a
   * 59 px rock at 1794, a 51 px rock at 1798 and a 45 px rock at 1803. Naming
   * the layer is what lets a guard say "this is decor" from the scene graph
   * itself, instead of from a list of exceptions somebody maintains by hand.
   */
  const layers: ParallaxLayer[] = LAYERS.map((spec) => {
    const container = scene.add
      .container(0, 0)
      .setDepth(spec.depth)
      // ONLY THE DECORATIVE PLANES take the name. `debris`, `shipFx` and `hud`
      // carry composed content - the typeable rocks, the Lantern, and whatever
      // type a scene parks on the HUD plane - and a guard that called those
      // decoration would be exempting the game from its own alignment model.
      .setName(spec.decor ? `${DECOR_LAYER_PREFIX}${spec.id}` : "");
    return { spec, container, offsetX: 0, offsetY: 0 };
  });
  const byId = new Map<LayerId, ParallaxLayer>(layers.map((l) => [l.spec.id, l]));
  const layerOf = (id: LayerId): ParallaxLayer => {
    const l = byId.get(id);
    if (l === undefined) throw new Error(`no parallax layer "${id}"`);
    return l;
  };

  /** Objects outside the layer stack: pinned framing and the weather pass. */
  const extras: Phaser.GameObjects.GameObject[] = [];
  const driftPlanes: DriftPlane[] = [];

  /** Add a wrapped, sideways-drifting sub-plane to a layer. */
  const addDrift = (id: LayerId, ops: readonly TileOp[]): void => {
    const cfg = DRIFT_X[id];
    if (cfg === undefined || ops.length === 0) return;
    const sub = scene.add.container(0, 0);
    sub.add(drawOps(scene, wrapXY(ops, W, H)));
    layerOf(id).container.add(sub);
    driftPlanes.push({ container: sub, rate: cfg.rate, base: cfg.base, offset: 0 });
  };

  // --- L0 sky -------------------------------------------------------------
  // Two full-stage gradients (stage start / stage end) crossfaded by
  // setSkyProgress. Graphics has no gradient fill, so a gradient is a stack of
  // 1px-tall strips - one draw, no texture memory, and it is genuinely vector.
  let skyLate: Phaser.GameObjects.Graphics | null = null;
  let starField: StarField | null = null;
  if (decorate.has("sky")) {
    const skyLayer = layerOf("sky").container;
    skyLayer.add(gradient(scene, W, H, skyStops(pal)));
    /**
     * THE STARS ARE PINNED (UR-14). They live on the sky container, which
     * `PINNED` holds at (0, 0) forever, so they neither scroll nor take the
     * camera sway - see `starField.ts` for why a sliding starfield is wrong
     * about distance as well as about the look. They twinkle instead, and that
     * twinkle is what keeps AC-22.2 true for this layer.
     */
    starField = buildStarField(
      scene,
      W,
      H,
      mixHex(skyStops(pal)[0], "#FFFFFF", 0.75),
      90,
      rand,
    );
    skyLayer.add(starField.graphics);
    skyLate = gradient(scene, W, H, skyStopsLate(pal)).setAlpha(0);
    skyLayer.add(skyLate);
    // NOTE: the bloom around the light is drawn ONCE, by `sunDisc` on the
    // celestial layer. A second full-screen additive pass here is what clipped
    // Mars' top band to pure white - two ADD blends of a near-white tint over a
    // butterscotch sky saturate every channel, and a clipped sky cannot travel.
  }

  // --- L1 celestial -------------------------------------------------------
  if (decorate.has("celestial")) {
    const c = layerOf("celestial").container;
    // NO DECORATIVE PLANET IN THE SKY, by the owner's call.
    //
    // `celestialBody` drew one large body on EVERY stop, from that stop's
    // palette. Standing on Pluto at 35.61 AU with a big blue planet filling the
    // sky is not a thing that can happen: nothing is near Pluto, and the only
    // blue planet on the route is Neptune, which is about 5 AU away and would
    // be a point of light. It read as a second sun with no explanation, and it
    // was the same body at Mars, Saturn and Pluto alike.
    //
    // The function is KEPT rather than deleted: `support/preflightLayout.ts`
    // derives the pre-flight window's disc size from its source, and that is a
    // real rule about how a distant body is drawn, not a leftover.
    //
    // The starfield that used to be drawn behind it is unaffected - it lives on
    // its own layer, not here.
    // WORLD-BAR item 4: the source itself, in frame. The planet alone is not
    // it - a large dark disc reads as an object the light falls on, which is
    // exactly what it is, and leaves the frame with no visible source for the
    // rims on every silhouette below.
    // `pal.id` IS the stop, so every caller gets this for free.
    const sunScale = sunScaleForStop(pal.id as StopId);
    for (const dy of [0, -H]) c.add(sunDisc(scene, pal, W, H, dy, sunScale));
  }

  // --- L2/L3 silhouette planes -------------------------------------------
  // WORLD-BAR item 5: angular, terraced, chamfered, spired massifs sitting on a
  // CONTINUOUS ridgeline, not rounded blobs at three sizes floating in sky.
  // SKY IS MOST OF THE FRAME, and it has to stay that way: the reference is
  // roughly half sky, and four carefully separated values need somewhere to be
  // seen against each other. Two masses per plane, far smaller than near.
  if (decorate.has("farField")) {
    /**
     * NO SILHOUETTE GEOMETRY ON THIS PLANE, by the user's call.
     *
     * It carried terrain, then ring planes and a planet limb. All three are
     * gone. The terrain removal was structural (D97: a landform needs ground and
     * this game has none). The space forms went for a plainer reason - across
     * three rounds of review the limb and the horizontal forms kept reading as
     * noise rather than structure, so they were cut.
     *
     * What is left here is decorative debris at distance, coloured by this
     * plane's ramp value. The ramp is still what makes the planes read as
     * different depths; it now does it through the debris rather than through
     * masses, which is why `depthRamp` and `BANDS_BEHIND_DEBRIS` are unchanged.
     */
    addDrift(
      "farField",
      driftTile(W, H, {
        materials: materialsFor(pal, farFill, liftAt(0, DEPTH_PLANES), 0.55, false),
        ...DEBRIS_SPEC["farField"]!,
        light,
        keepClear,
        rand,
      }),
    );
  }
  if (decorate.has("midField")) {
    const m = layerOf("midField").container;
    m.add(
      drawOps(scene, wrapY(dustTile(W, H, mixHex(midFill, "#FFFFFF", 0.22), rand), H)),
    );
    addDrift(
      "midField",
      driftTile(W, H, {
        materials: materialsFor(pal, midFill, liftAt(1, DEPTH_PLANES), 0.45, true),
        ...DEBRIS_SPEC["midField"]!,
        light,
        keepClear,
        rand,
      }),
    );
  }

  // --- L4 debris ----------------------------------------------------------
  // Distant, unlabelled rocks in the gameplay plane's own value. The Flight lane
  // owns the real, typeable debris; this is the silhouette that makes the world
  // read as populated when no word is on screen.
  if (decorate.has("debris")) {
    /**
     * THE DARK HALF OF THE LADDER: BUILT, MEASURED, AND NOT SHIPPED.
     *
     * The finding is real and worth keeping. `depthRamp` computes 53 / 41 / 28 /
     * 16 on Mars while the frame measures L*37.8-52.9, because only the two
     * lightest bands have geometry: `ramp[3]` was used by `canyonTile` alone,
     * that was deleted with the edge bars, and the darkest value in the stack
     * quietly stopped being drawn. No test noticed, because none of them
     * measures band AREA.
     *
     * The fix looked obvious - put `ramp[3]` silhouettes HERE, on the debris
     * layer. Word plates draw at 4.5 and this is 4, so plates are in FRONT of
     * it: no lane guard needed, full width, centre included. That is the one
     * place near-black mass can live without being anchored to the two vertical
     * edges, and edge-anchoring is what made the previous coverage attempt read
     * as a border on 56 of 64 rows.
     *
     * IT WAS BUILT AND IT DID NOT WORK. Two masses per tile at 0.30-0.52 of the
     * tile height:
     *
     *   upper frame below L*40     5.8%  ->  5.7%     (`alto-03`: 29.5%)
     *   Title left edge band       0.39  ->  0.59     (threshold 0.45)
     *
     * A tenth of a point of the thing it was for, and it tripped the
     * seamless-screen guard - because a tall dark mass standing at an edge is
     * indistinguishable from a bar to any measurement, and to a player looking
     * at one frame.
     *
     * THE REASON IT CANNOT WORK IS THE SKY. The upper half of this frame is
     * mostly sky by area and 81.4% of it sits in the L*60-80 box; `alto-03`'s
     * upper half is 30.9% there because its sky is a third of its picture and
     * land fills the rest. Geometry on a plane cannot move a number dominated by
     * the gradient behind it. That is the horizon, and the horizon is the A/B/C
     * direction call.
     *
     * Also recorded, from `BANDS_BEHIND_DEBRIS` in palette.ts: band 2 could
     * never have joined band 3 here anyway. Four bands span ~90 luminance with
     * ~30 between neighbours, a rock needs 18 of clearance on both sides, and
     * with every band behind it the only windows left on Mars are below 48 and
     * above 144 - and its sky sweeps 207 -> 38 straight through both.
     */

    layerOf("debris").container.add(
      drawOps(
        scene,
        wrapY(
          driftTile(W, H, {
            materials: materialsFor(pal, debrisFill, liftAt(2, DEPTH_PLANES), 0.6, true),
            ...DEBRIS_SPEC["debris"]!,
            light,
            keepClear,
            rand,
          }),
          H,
        ),
      ),
    );
  }

  // --- L5 near field ------------------------------------------------------
  if (decorate.has("nearField")) {
    const n = layerOf("nearField").container;
    // THERE IS NO NEAR "FRAME" ANY MORE, and its removal is the point.
    //
    // WORLD-BAR item 6 asks for a dark foreground. This lane read that as canyon
    // walls running down both edges, because the world scrolls vertically and
    // the reference's foreground is along the bottom. Every version of that idea
    // - generated boxes, then authored wall profiles, then interrupted authored
    // wall profiles with different rhythms on each side - produced the same
    // thing, and it was reported three times: the left and right edges read as
    // bars rather than as one seamless screen.
    //
    // That verdict was correct and the idea was wrong. Anything that occupies both
    // vertical edges of a frame at most heights IS a border, whatever is drawn
    // inside it, and on a dark stop it is a LIGHTER border because the near
    // plane there sits above the sky by rule (art-direction section 2). Making
    // it darker would only have made a border that is harder to see.
    //
    // The dark foreground now comes entirely from things that are objects rather
    // than edges: the near-plane and foreVeil silhouettes below, drawn in
    // `foregroundObjectInk` - the frame's near-black at every stop - which cross
    // the frame sideways and leave by the side, and the floor vignette, which is
    // a seat under the ship rather than a frame around the picture.
    // `worldAccent`, not `accent`: in colourblind mode these two are different
    // colours on purpose. See the long note in palette.ts - the world wants the
    // value separated from the sky, the plate wants the one a child can read.
    //
    // ---------------------------------------------------------------------
    // UR-14, FOURTH REPORT: THE SPECKS ON THIS PLANE ARE POINTS OF LIGHT.
    //
    // 44 `mote` sprites, 14 `glint` sprites and 6 accent diamonds were replayed
    // straight into the `nearField` container, which scrolls at 1.30 x world
    // speed. On the shipped Title that is 96.2 px/s and the whole field crosses
    // the frame every eleven seconds - fifty-eight lit specks sliding down a
    // menu sky. The three previous fixes each pinned the mechanism that
    // round's report had found - container drift, then the sideways plane
    // march, then the atmosphere pass's texture scroll - and each left this one
    // because the rule at the time said an object placed at a depth may travel.
    //
    // It does not any more. `starsMayTravel` decides by what the thing LOOKS
    // like and which screen it is on; `starField.ts` carries the reasoning and
    // the Flight exception. Here the only consequence is WHERE these ops are
    // added: to a pinned container of their own on a screen with no flight, or
    // to the scrolling plane on the one screen that has bought an exception.
    //
    // The pinned copy is NOT wrapped. `wrapY` exists so a scrolling plane has a
    // second tile to bring in at the seam; a pinned one never reaches a seam,
    // so the wrap copy would be 29 Images parked permanently above the top edge
    // against the AC-22.9 budget.
    const nearLightTravels = starsMayTravel("world.nearLight", scene.scene.key);
    let nearLight = n;
    // The pinned copy takes the DECOR name too: it is the same weather as
    // `nearField` at a depth of its own, and on the menu screens it is the
    // largest body of seeded objects on the stage - 30 of them on the Ending -
    // which is what the alignment census used to report as near misses.
    if (!nearLightTravels) {
      nearLight = scene.add.container(0, 0).setDepth(NEAR_LIGHT_DEPTH);
      nearLight.setName(`${DECOR_LAYER_PREFIX}nearLight`);
      extras.push(nearLight);
    }
    const lightOps = (ops: readonly TileOp[]): readonly TileOp[] =>
      nearLightTravels ? wrapY(ops, H) : ops;
    nearLight.add(drawOps(scene, lightOps(moteTile(W, H, nearFill, pal.worldAccent, rand))));
    // WORLD-BAR item 7. Three of them. Tiny, high contrast, enormous effect -
    // and 4-9 px of opaque saturated colour is the most speck-like thing in the
    // frame, so they hold still with the motes rather than sliding alone.
    nearLight.add(
      drawOps(scene, lightOps(accentTile(W, H, mixHex(pal.worldAccent, "#FFFFFF", 0.2), rand))),
    );
    addDrift(
      "nearField",
      driftTile(W, H, {
        materials: materialsFor(pal, objectInk, 0, 0.8, true),
        // HELD, AND THE REASON IS A CONSTRAINT COLLISION - see the note on
        // `LANE_GUARD` and the foreVeil block below.
        ...DEBRIS_SPEC["nearField"]!,
        light,
        keepClear,
        rand,
      }),
    );
  }

  // --- L6.5 foreground veil ----------------------------------------------
  // The only world layer in front of the ship. See layers.ts for why the stack
  // needed one, and tiles.ts VEIL_BY_STOP for what each stop's veil actually is
  // and the NASA page it is drawn from.
  const veilSpec = veilFor(pal.id);
  let veilContainer: Phaser.GameObjects.Container | null = null;
  if (decorate.has("foreVeil")) {
    const fv = layerOf("foreVeil").container;
    // The nearest silhouettes: big, near-black, fast, and out of the centre
    // lane. This is where the frame's darkest value comes from - judge note 1 -
    // rather than from painting the whole near plane black.
    addDrift(
      "foreVeil",
      driftTile(W, H, {
        materials: materialsFor(pal, objectInk, 0, 0.92, false),
        /**
         * THE COVERAGE PASS STOPPED HERE, and the numbers say why.
         *
         * The ask was to put near-black mass into the UPPER frame, the way
         * `alto-03` does with palm trunks: 20.7% of its top half is below L*40
         * against 2.0% of ours. The near-plane and foreVeil silhouettes are the
         * only near-black things we have, so growing them is the obvious move.
         *
         * Three constraints do not fit together:
         *
         *   1. Near-plane objects must stay out of the centre 60%, because word
         *      plates fall there and legibility is the game (AC-22.8). A capture
         *      taken during this pass caught a grown rock over a plate reading
         *      "acon".
         *   2. Therefore near-black mass can only live in the outer 40%.
         *   3. Filling the outer 40% at most heights IS A BORDER, which is the
         *      defect reported three times: the left and right edges reading as
         *      bars instead of one seamless screen.
         *
         * Measured on the Title, as the fraction of rows where the edge band
         * differs from the middle of the picture:
         *
         *   count 4 / 2, 70-132 / 130-230 px    0.30 left, 0.33 right
         *   count 6 / 3,  90-180 / 170-300 px   0.38 left, 0.63 right
         *   count 10 / 8, 130-260 / 220-460 px  0.63 left, 0.88 right
         *
         * The threshold is 0.45, and at 0.88 the right edge differs from the
         * middle on 56 of 64 rows. That is the bar, back.
         *
         * So these are held at the level that is demonstrably not a border. The
         * upper-frame dark this pass was asked for cannot come from here; it has
         * to come from geometry BEHIND the plates, on the two dark ramp bands -
         * which currently carry no silhouette geometry at all, and that is the
         * real finding underneath the critic's "bands 2 and 3 have almost no
         * on-screen area". Adding it is a bigger change than a constant.
         */
        ...DEBRIS_SPEC["foreVeil"]!,
        light,
        keepClear,
        rand,
      }),
    );
    if (veilSpec !== null) {
      const tint = veilSpec.warm
        ? mixHex(pal.colors[0] ?? "#FFFFFF", "#FFFFFF", 0.45)
        : mixHex(skyStops(pal)[0], "#FFFFFF", 0.7);
      const vc = scene.add.container(0, 0);
      veilContainer = vc;
      vc.add(
        drawOps(
          scene,
          wrapXY(veilTile(W, H, { spec: veilSpec, tint, laneGuard: LANE_GUARD, rand }), W, H),
        ),
      );
      vc.setAlpha(reducedMotion ? VEIL_ALPHA_REDUCED : VEIL_ALPHA);
      fv.add(vc);
      const cfg = DRIFT_X["foreVeil"] as { rate: number; base: number };
      driftPlanes.push({
        container: veilContainer,
        // A touch slower than the silhouettes on the same plane, so the veil
        // reads as air moving through them rather than as part of them.
        rate: cfg.rate * 0.72,
        base: cfg.base * 0.72,
        offset: 0,
      });
    }
  }

  // --- Pinned framing and weather ----------------------------------------
  if (wantsFraming) {
    extras.push(vignette(scene, pal, W, H).setDepth(VIGNETTE_DEPTH));
  }
  const kind = wantsAtmosphere ? atmosphereFor(pal.id) : null;
  let weather: Phaser.GameObjects.TileSprite | null = null;
  /**
   * UR-14, THIRD REPORT. The atmosphere pass is a field of small light marks
   * and it therefore obeys the star rule, from the one place that states it.
   *
   * It used to advance `tilePositionY` on every screen unconditionally, at
   * `worldSpeed * 1.45 + 26` px/s - a FLOOR that runs even where the world is
   * stopped, which is the identical mistake `DRIFT_X` made and the reason
   * `worldSpeed: 0` never meant "nothing travels" either time somebody wrote
   * that in a comment. Measured on the shipped Briefing at Uranus, whose pass
   * is 24 lines 150-310 px long leaning sideways by 0.28 of their length: the
   * texture travelled 133.44 px in 1.92 s of world and 1334.40 px in 19.2 s.
   * Ten times the clock, ten times the distance - a ramp, not a breath - and
   * on a 812 px pane that is a long diagonal streak crossing the whole window
   * every six seconds.
   */
  const weatherTravels = starsMayTravel("world.atmosphere", scene.scene.key);
  let weatherAlpha = 0;
  if (kind !== null) {
    weather = atmospherePass(scene, pal, kind, W, H).setDepth(ATMOSPHERE_DEPTH);
    weatherAlpha = weather.alpha;
    extras.push(weather);
  }

  const parallax: Parallax = {
    layers,
    layerOf,

    update(deltaMs: number): void {
      // Guard the first frame and any tab-restore spike; a 3 s delta would
      // teleport every layer and read as a glitch.
      const dt = Phaser.Math.Clamp(deltaMs, 0, 64);
      elapsedMs += dt;
      const sway = cameraSwayPx(elapsedMs, reducedMotion);
      for (const l of layers) {
        const spec = l.spec;
        if (PINNED.has(spec.id)) continue;
        if (SCROLLS.has(spec.id)) {
          l.offsetY = mod(l.offsetY + spec.speed * worldSpeed * (dt / 1000), H);
        }
        // Nearer layers sway more: that is what makes a 2 px camera move read
        // as a camera and not as a wobbling background.
        l.offsetX = idleDriftPx(spec, elapsedMs, reducedMotion) + sway * (0.25 + spec.speed);
        l.container.setPosition(l.offsetX, l.offsetY);
      }
      // The decorative planes cross the frame as well as falling through it.
      // Under reduced motion they keep moving (D41 removes shake and sway, not
      // the world being alive) at a calmer rate.
      //
      // UNLESS THE SCREEN HAS NO LANE (UR-50.5). See `crossDrift` in
      // `ParallaxOptions` for why this is a switch rather than a deletion: the
      // crossing is Flight's "you cannot type this" signal, and on a still
      // screen the same motion is just the view sliding sideways.
      const crossScale = reducedMotion ? 0.55 : 1;
      if (crossDrift) {
        for (const p of driftPlanes) {
          p.offset = mod(p.offset + (p.base + p.rate * worldSpeed) * crossScale * (dt / 1000), W);
          p.container.x = p.offset;
        }
      }
      starField?.update(elapsedMs, reducedMotion);
      if (weather !== null) {
        if (weatherTravels) {
          // The one screen with an exception (`starField.TRAVELLING_LIGHT`):
          // the ship is flying and every plane under this one is scrolling, so
          // the pass that crosses all of them moves with them. Note the term
          // is now PROPORTIONAL to world speed with no floor - a pass that
          // travels while the world is stopped is the defect, not the feature.
          weather.tilePositionY -= worldSpeed * 1.45 * (dt / 1000);
          // NO SIDEWAYS DRIFT. This world scrolls vertically; a weather pass
          // sliding horizontally across it is motion in an axis nothing else
          // moves in, and it is what made the texture's repeats legible - a
          // player described the world as strips "sliding from left to right".
        } else {
          // FLICKER IS THE ONLY ANIMATION IT GETS. Freezing the pass outright
          // would take a motion source off screens where little else moves
          // (AC-22.2, rubric 2), so it breathes the same way a star does, out
          // of the same function, bounded and going nowhere. One slow cycle
          // rather than a field of staggered ones: this is a single object, so
          // there is nothing for it to be out of step with.
          weather.setAlpha(
            twinkleAlpha(weatherAlpha, WEATHER_SWING, WEATHER_PERIOD_MS, 0, elapsedMs),
          );
        }
      }
    },

    setWorldSpeed(pxPerSecond: number): void {
      worldSpeed = pxPerSecond;
    },

    setSkyProgress(t: number): void {
      skyLate?.setAlpha(Phaser.Math.Clamp(t, 0, 1));
    },

    setReducedMotion(on: boolean): void {
      reducedMotion = on;
      veilContainer?.setAlpha(on ? VEIL_ALPHA_REDUCED : VEIL_ALPHA);
    },

    debugOffsets(): Record<string, { x: number; y: number }> {
      const out: Record<string, { x: number; y: number }> = {};
      for (const l of layers) out[l.spec.id] = { x: l.container.x, y: l.container.y };
      return out;
    },

    debugMotion(): { swayPx: number; elapsedMs: number; reducedMotion: boolean } {
      return { swayPx: cameraSwayPx(elapsedMs, reducedMotion), elapsedMs, reducedMotion };
    },

    debugDepth() {
      return {
        fills: [...ramp],
        lightAngleRad: light,
        atmosphere: kind,
        objectInk,
        veil:
          veilSpec === null
            ? null
            : { kind: veilSpec.kind, what: veilSpec.what, source: veilSpec.source },
      };
    },

    destroy(): void {
      for (const l of layers) l.container.destroy(true);
      for (const e of extras) e.destroy();
      extras.length = 0;
      driftPlanes.length = 0;
      veilContainer = null;
      starField?.destroy();
      starField = null;
      weather = null;
    },
  };

  parallax.update(0);
  return parallax;
}

// ---------------------------------------------------------------------------
// Content that is NOT tiled: the sky, the one light, and the pinned framing.
// Everything that wraps lives in tiles.ts.
// ---------------------------------------------------------------------------

/**
 * Where the sky's MIDDLE stop sits, as a fraction of the frame height.
 *
 * ---------------------------------------------------------------------------
 * THIS REPLACES A CURVE THAT DREW A HORIZON LINE
 *
 * The lower leg used to be `((t - 0.5) * 2) ** 0.45`, to reach the dark bottom
 * stop sooner than a straight ramp does - the sky is most of the frame, so its
 * shape IS the value histogram. The value is continuous at the joint. The SLOPE
 * is not: `u ** 0.45` has infinite gradient at u = 0, so the first strip below
 * the midpoint was already 17.5% of the way to the bottom colour. On Mars that
 * is 9.6 L* in ONE ROW, at exactly y = h/2, on every screen that draws a sky.
 *
 * A blind critic measured it as a hard seam: 8.58 L* on ending, 5.95 on beacon,
 * 4.84 on flight, across 96-100% of columns, against a largest row-to-row jump
 * of 0.58 anywhere in `world-bar.png`. It read as a horizon - which is the
 * artifact that removing the terrain was supposed to kill.
 *
 * MOVING THE STOP does the same job with no discontinuity. Both legs stay
 * linear, so the value is continuous and the slope merely kinks: the first strip
 * below the joint is 1.6% of the range, about 0.85 L* on Mars, and the change in
 * step size across the joint is ~0.56 L* - inside what the reference itself does.
 *
 * 0.34 rather than 0.5 is what keeps the darkening early. The lower two thirds
 * of the frame carry the mid-to-bottom travel instead of the lower half.
 */
const SKY_MID_AT = 0.34;

/**
 * The sky's colour at a height fraction, using the SAME two legs `gradient`
 * draws with. Exported-in-spirit: anything that has to sit against the sky needs
 * to know what the sky is doing where it sits, not on average.
 */
export function skyAt(pal: StopPalette, t: number): string {
  const [top, mid, bottom] = skyStops(pal);
  const u = Math.min(1, Math.max(0, t));
  return u < SKY_MID_AT
    ? mixHex(top, mid, u / SKY_MID_AT)
    : mixHex(mid, bottom, (u - SKY_MID_AT) / (1 - SKY_MID_AT));
}

function gradient(
  scene: Phaser.Scene,
  w: number,
  h: number,
  stops: readonly [string, string, string],
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  const steps = 96;
  const [top, mid, bottom] = stops;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    // Two LINEAR legs meeting at `SKY_MID_AT`. Continuous in value and bounded
    // in slope - see the note on that constant for the seam this replaced.
    const hex =
      t < SKY_MID_AT
        ? mixHex(top, mid, t / SKY_MID_AT)
        : mixHex(mid, bottom, (t - SKY_MID_AT) / (1 - SKY_MID_AT));
    g.fillStyle(hexToNum(hex), 1);
    // +2 px of overlap: sub-pixel scaling must never show a seam.
    g.fillRect(0, Math.floor((i * h) / steps), w, Math.ceil(h / steps) + 2);
  }
  return g;
}

/**
 * The stop's sun or planet, PLACED (WORLD-BAR item 4).
 *
 * It sits opposite `lightPositionOf`, which is the same number every rim
 * highlight in the frame is computed from, so the light in this game has one
 * source and the player can see where it is.
 */
function celestialBody(
  scene: Phaser.Scene,
  pal: StopPalette,
  w: number,
  h: number,
  dy: number,
): Phaser.GameObjects.Container {
  const at = lightPositionOf(pal);
  const cx = w * (1 - at.x);
  const cy = dy + h * 0.13;
  // SHRUNK FROM 230. Judge note 5 of round 2: "the MIDDLE is crowded - the big
  // masses, the ridgelines and the planet are all within a narrow mid band."
  // The planet was a third of the stage height of mid-value disc sitting in the
  // same value as the mid plane, which is most of what filled that band. A
  // distant planet is small; the reference's moon is tiny.
  const r = Math.min(w, h) * 0.12;
  const sky = skyStops(pal)[1];
  // Hazed back. A planet drawn at full saturation sits IN FRONT of the far
  // ridges however slowly it scrolls - the first pass of this had Mars as a
  // near-black rust disc dominating a pale sky, which is atmospheric
  // perspective applied to everything except the largest object on screen.
  // ...and pushed much further into the haze, for the same reason. At 0.62 it
  // sat in the mid band with the terrain; at 0.84 it is a pale disc in the sky,
  // which is what something that far away looks like.
  // Hazed hard, and then pinned ABOVE the sky in value. A critic measured the
  // old disc at L*59.8 against a sky of L*77 - a distant body lit by the same
  // sun as everything else came out DARKER than the air in front of it, which
  // reads as a hole rather than as a planet. `withLightness` moves value without
  // touching the hue the haze produced.
  const hazed = atmospheric(pal.colors[2] ?? pal.accent, sky, 0.84);
  /**
   * SEPARATED FROM THE SKY AT THE DISC'S OWN HEIGHT, not from the mid stop.
   *
   * This used to be `lightness(sky) + 6`, where `sky` is `skyStops[1]` - the
   * gradient's MIDDLE colour. The disc sits near the top of the frame, where the
   * sky is a different value entirely, so the +6 landed on top of the local sky:
   * a critic measured the disc at L*77.7 against a local sky of L*77.8. A ratio
   * of 1.00:1. Pure hue difference, zero value difference - invisible on a
   * child's tablet at half brightness, and invisible to a colour-blind child
   * always. It was called "the single most wasted element on screen" and it was
   * right.
   *
   * 14 L* is about four value steps: clearly a body, still hazed back behind
   * everything in front of it.
   */
  const localSky = skyAt(pal, cy / Math.max(1, h));
  const target = lightness(localSky);
  const body = withLightness(hazed, target > 50 ? Math.max(4, target - 14) : Math.min(96, target + 14));

  const c = scene.add.container(0, 0);
  // THE ADDITIVE GLOW IS GONE. It was a second light source in a frame whose
  // whole depth system derives from having exactly one (WORLD-BAR item 4), and
  // because it blended ADD over the far plane it LIGHTENED every silhouette it
  // touched - one of the pale joins the brief calls out as a seam. A planet is
  // lit by the sun; it does not emit.

  const g = scene.add.graphics();
  // FLAT, in two values, with nothing translucent anywhere.
  //
  // This used to be a dark disc, a lit disc, a 50%-alpha highlight ellipse and a
  // 55%-alpha rim arc - a soft-shaded sphere in a frame where every other object
  // is a flat silhouette. It read as a balloon, and the translucent highlight
  // was one more pale join. The reference's celestial bodies are flat shapes in
  // one or two values (`alto-01`, `alto-05`: a crescent, and nothing else), so
  // this is a disc and a terminator and that is all.
  // ONE FLAT DISC. Nothing else.
  //
  // This has now been three circles (dark / lit / body - from any distance a
  // RING, and a critic described it exactly that way), two (a terminator
  // crescent, measured as "two overlapping circles with a hard seam at x=850"),
  // and two again with the bite drawn in the sky's colour - which fails for a
  // reason worth writing down: the sky is a GRADIENT, so a bite painted in
  // `skyStops[1]` matches the sky at exactly one height and reads as a second
  // pale disc everywhere else. Graphics cannot erase, so there is no third
  // attempt available along that line.
  //
  // A flat disc is also what the reference actually does. `alto-01` and
  // `alto-05` each draw their moon as ONE filled shape - the crescent is the
  // path, not two circles composited. A distant body here is a shape, and this
  // one is round.
  g.fillStyle(hexToNum(body), 1);
  g.fillCircle(cx, cy, r);
  c.add(g);
  return c;
}

/**
 * The light, as an object: a clean DISC with a soft halo around it.
 *
 * Judge note 2: "the sun is a blown-out white blob, not a disc. The reference
 * sun is a clean disc with a soft halo; ours is clipped white and washes its
 * surroundings. Draw the disc, then the halo. Do not let the bloom eat the
 * shape."
 *
 * The bloom was eating the shape LITERALLY. The halo was one ADD-blended glow
 * sprite 6.5 radii across, centred on the disc, so the pixels immediately around
 * the disc edge were driven to 255 in every channel - and a disc whose
 * surroundings are the same white as the disc has no edge. Raising the disc's
 * own value could never fix that; there is nothing above white.
 *
 * So the halo is now a set of concentric strokes that START outside the disc.
 * Nothing additive touches the edge, the falloff is still smooth, it is vector
 * (D83), and it costs one Graphics.
 */
function sunDisc(
  scene: Phaser.Scene,
  pal: StopPalette,
  w: number,
  h: number,
  dy: number,
  sunScale = 1,
): Phaser.GameObjects.Graphics {
  const at = lightPositionOf(pal);
  const cx = w * at.x;
  const cy = dy + h * at.y;
  const bright = isBrightStop(pal);
  const r = sunRadius(pal) * sunScale;
  const skyTop = skyStops(pal)[0];
  const core = mixHex(skyTop, "#FFFFFF", bright ? 0.9 : 0.74);
  const halo = mixHex(skyTop, "#FFFFFF", bright ? 0.62 : 0.5);

  const g = scene.add.graphics();
  // THE SOFT RADIAL GLOW art-direction section 2 asks for, and which a
  // measurement found had never been honoured: the brightest non-UI pixel in the
  // whole frame was a 3 px star sparkle, with 1,457 pixels above L*82 in total,
  // against `alto-03`'s 2.1% of the frame above L*90.
  //
  // Enough rings that each one's alpha step is below a visible band - an earlier
  // pass used 18 and the render showed concentric circles, which is a different
  // way of not having a soft halo - and they all START OUTSIDE the disc, which
  // is the constraint from the round-1 judge note: one big ADD-blended sprite
  // centred on the disc drove the pixels at its own edge to 255 in every
  // channel, and a disc whose surroundings are the same white as the disc has no
  // edge at all. Nothing additive touches this one.
  const rings = 48;
  for (let i = rings - 1; i >= 0; i--) {
    const t = i / (rings - 1);
    g.lineStyle(r * 0.14, hexToNum(halo), 0.075 * (1 - t) ** 1.5);
    g.strokeCircle(cx, cy, r * (1.03 + t * 2.1));
  }
  g.fillStyle(hexToNum(core), 1);
  g.fillCircle(cx, cy, r);
  // A crisp lip, so the boundary is a disc edge and not the end of a fade.
  g.lineStyle(2.5, hexToNum(mixHex(core, "#FFFFFF", 0.7)), 0.9);
  g.strokeCircle(cx, cy, r - 1.25);
  return g;
}

/**
 * WORLD-BAR item 6, pinned half: the frame's floor.
 *
 * A soft darkening into the bottom edge, so the ship is seated in something
 * rather than floating on a field of bands. It does not scroll, because a
 * vignette that scrolls is not a vignette.
 */
function vignette(
  scene: Phaser.Scene,
  pal: StopPalette,
  w: number,
  h: number,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  // The OBJECT ink, not the terrain ink: this is the frame's near-black, and on
  // a night stop the terrain ink is deliberately a lifted slate (see
  // `foregroundInk`). A vignette drawn in that would lighten the corners.
  const ink = foregroundObjectInk(pal);
  // ABUTTING strips, never overlapping ones.
  //
  // The first pass drew each strip 2 px taller than its slot "so a sub-pixel
  // seam can never show", which is right for the OPAQUE sky gradient and wrong
  // here: these strips are translucent, so an overlap composites twice and the
  // doubled band is visible as a hard line. Sixty-four exactly-tiled strips
  // with integer edges read as a gradient; twenty-six overlapping ones read as
  // stripes painted across the ground, which is what the first render showed.
  const steps = 64;
  /**
   * `y0` is the FRAME EDGE and `y1` is where the darkening has faded out, so
   * alpha is `peak` at y0 and 0 at y1.
   *
   * IT USED TO BE THE OTHER WAY UP. The old version indexed alpha by `i`, which
   * walks from y0 to y1 - so the bottom band was fully transparent AT the bottom
   * edge and darkest a third of the way up it. That is not a vignette, it is a
   * horizontal shadow across the middle of the frame, and it is a real part of
   * why the flight capture has no dark foreground under the ship: the one thing
   * placing a dark there was aimed at the sky instead.
   */
  const ramp = (y0: number, y1: number, peak: number): void => {
    for (let i = 0; i < steps; i++) {
      const a = Math.round(y0 + ((y1 - y0) * i) / steps);
      const b = Math.round(y0 + ((y1 - y0) * (i + 1)) / steps);
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      if (hi <= lo) continue;
      const t = i / (steps - 1);
      // A gentler exponent than a square: squared, the darkening has faded to a
      // quarter a third of the way up the band and the frame has a dark LINE at
      // the bottom rather than a dark foreground.
      g.fillStyle(hexToNum(ink), peak * (1 - t) ** 1.4);
      g.fillRect(0, lo, w, hi - lo);
    }
  };
  // BOUNDED, and the bound is AC-22.4 rather than taste.
  //
  // The first pass at this ran 0.86 peak over the bottom 42% of the frame, on
  // the reasoning that the reference's foreground is near-black. The rewritten
  // V-22.4 check caught what that actually did: at the ship's own height the
  // wash was 58% near-black across the FULL WIDTH, so a rock down there measured
  // luminance 76 against a background of 76 - it had no silhouette left at all.
  // A translucent wash over the play area is not a dark foreground; it is a dark
  // filter, and it flattens the objects it was supposed to frame.
  //
  // The reference's near-black is opaque OBJECTS - the near-plane and foreVeil
  // silhouettes. This is only the seat underneath them, and it was pulled back
  // again when those silhouettes grew: 93% of the bottom fifth was already below
  // L*40 from the wash alone, and a wash returns the same value at x=150 and
  // x=1000, so it contributes darkness without contributing any depth. Where
  // silhouette can carry the dark, it should.
  ramp(h, h - h * 0.20, 0.46);
  // A touch on the top edge too, so the HUD plate has something to sit on.
  ramp(0, h * 0.16, 0.18);
  return g;
}

/**
 * WORLD-BAR item 8: one atmosphere pass per stop.
 *
 * A single tiled texture drifting across the whole frame, in front of the world
 * and behind the HUD, at an alpha low enough to unify rather than to veil. The
 * texture is generated from vectors at runtime (D83) and is 256x256, so the
 * whole pass is one quad and one draw call - which is the only way a
 * full-screen effect fits the AC-22.9 budget.
 */
function atmospherePass(
  scene: Phaser.Scene,
  pal: StopPalette,
  kind: AtmosphereKind,
  w: number,
  h: number,
): Phaser.GameObjects.TileSprite {
  const key = `kb/tex/atmos/${kind}`;
  // LARGER THAN 256. Standard parallax practice is that a tiled element should
  // be bigger than the window so the player never sees a whole repeat at once;
  // at 256 a 1920-wide frame showed 7.5 of them, and the user counted "about 8"
  // vertical strips. Seamlessness is the real fix and it is below, but fewer
  // joins is free.
  //
  // Not derived from the stage width on purpose: the letterbox lane is making
  // the design width follow the window, so anything that hard-codes 1920 - or
  // scales off a width captured at construction - is about to be wrong.
  const size = 512;
  if (!scene.textures.exists(key)) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    const r = rng(0xa17105 + kind.length);
    if (kind === "streaks" || kind === "dust") {
      const lines = kind === "streaks" ? 24 : 40;
      for (let i = 0; i < lines; i++) {
        const x = r() * size;
        const y = r() * size;
        const len = kind === "streaks" ? 150 + r() * 160 : 34 + r() * 72;
        const lean = len * 0.28;
        g.lineStyle(kind === "streaks" ? 2 : 1.2, 0xffffff, 0.12 + r() * 0.2);
        /**
         * THE COPIES ARE TRANSLATIONS. This is the whole of UR-07.
         *
         * The previous version looped `for (const dx of [-size, 0, size])` and
         * called `r()` for the endpoints INSIDE that loop, so the three copies
         * of each streak had different y values. They were not copies at all,
         * and the comment claiming the pass "has to tile in both axes" was
         * describing an intention rather than the code. Every 256 px boundary
         * therefore carried a hard discontinuity, which at 1920 wide is the
         * seven-and-a-half vertical joins a player described as "a bunch of
         * vertical strips... stitched together".
         *
         * The y wrap was missing outright: a streak starting near the bottom ran
         * off the texture and reappeared nowhere.
         */
        for (const dx of [-size, 0, size]) {
          for (const dy of [-size, 0, size]) {
            g.lineBetween(x + dx, y + dy, x + dx + lean, y + dy + len);
          }
        }
      }
    } else if (kind === "glitter") {
      for (let i = 0; i < 140; i++) {
        const x = r() * size;
        const y = r() * size;
        const rad = 0.7 + r() * 1.5;
        g.fillStyle(0xffffff, 0.14 + r() * 0.5);
        // Same rule: a dot near an edge has to exist on the opposite edge too.
        for (const dx of [-size, 0, size]) {
          for (const dy of [-size, 0, size]) g.fillCircle(x + dx, y + dy, rad);
        }
      }
    } else {
      for (let i = 0; i < 26; i++) {
        const x = r() * size;
        const y = r() * size;
        const ew = 90 + r() * 150;
        const eh = 24 + r() * 40;
        g.fillStyle(0xffffff, 0.035 + r() * 0.05);
        for (const dx of [-size, 0, size]) {
          for (const dy of [-size, 0, size]) g.fillEllipse(x + dx, y + dy, ew, eh);
        }
      }
    }
    g.generateTexture(key, size, size);
    g.destroy();
  }

  const tint = kind === "dust" ? mixHex(pal.colors[0] ?? "#FFFFFF", "#FFFFFF", 0.3) : "#FFFFFF";
  const sprite = scene.add
    .tileSprite(w / 2, h / 2, w, h, key)
    .setTint(hexToNum(tint))
    // Low. The pass is there to TIE the planes together, and one that can be
    // looked at directly is one the player reads as scratches on the screen.
    .setAlpha(kind === "glitter" ? 0.22 : 0.13);
  if (kind === "glitter") sprite.setBlendMode(Phaser.BlendModes.ADD);
  return sprite;
}
