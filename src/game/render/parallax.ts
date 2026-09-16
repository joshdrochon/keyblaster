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
 *   6 dark framing        `canyonTile` on the near plane + a pinned vignette
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
import {
  LAYERS,
  type LayerId,
  type LayerSpec,
  cameraSwayPx,
  idleDriftPx,
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
  canyonTile,
  driftTile,
  dustTile,
  massifTile,
  moteTile,
  planeMaterialColor,
  starTile,
  veilFor,
  veilTile,
  wrapXY,
  wrapY,
} from "./tiles.js";
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

/** Depth of the pinned floor vignette: in front of the near field, behind the ship. */
const VIGNETTE_DEPTH = 5.6;
/** Depth of the atmosphere pass: in front of the foreground veil, behind the HUD. */
const ATMOSPHERE_DEPTH = 6.8;

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
 * centre, so nothing on a plane IN FRONT of them may sit there. 0.26 leaves the
 * middle 48% of the frame permanently clear.
 */
const LANE_GUARD = 0.26;

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
}

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

export function buildParallax(scene: Phaser.Scene, options: ParallaxOptions): Parallax {
  ensureTextures(scene);

  const pal = options.palette;
  const W = options.width ?? scene.scale.width;
  const H = options.height ?? scene.scale.height;
  const decorate = new Set(options.decorate ?? DEFAULT_DECORATE);
  const rand = rng(options.seed ?? 0x5eed);
  const wantsFraming = options.framing ?? true;
  const wantsAtmosphere = options.atmosphere ?? true;

  let reducedMotion = options.reducedMotion ?? false;
  let worldSpeed = options.worldSpeed ?? 0;
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

  const layers: ParallaxLayer[] = LAYERS.map((spec) => {
    const container = scene.add.container(0, 0).setDepth(spec.depth);
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
  if (decorate.has("sky")) {
    const skyLayer = layerOf("sky").container;
    skyLayer.add(gradient(scene, W, H, skyStops(pal)));
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
    // Starfield first, so the planet occludes it. Wrapped like everything else:
    // it used to be drawn once across -H..H, which is not periodic, so the stars
    // were themselves a source of the seam jolt.
    const starTint = mixHex(skyStops(pal)[0], "#FFFFFF", 0.75);
    c.add(drawOps(scene, wrapY(starTile(W, H, starTint, 90, rand), H)));
    for (const dy of [0, -H]) c.add(celestialBody(scene, pal, W, H, dy));
    // WORLD-BAR item 4: the source itself, in frame. The planet alone is not
    // it - a large dark disc reads as an object the light falls on, which is
    // exactly what it is, and leaves the frame with no visible source for the
    // rims on every silhouette below.
    for (const dy of [0, -H]) c.add(sunDisc(scene, pal, W, H, dy));
  }

  // --- L2/L3 silhouette planes -------------------------------------------
  // WORLD-BAR item 5: angular, terraced, chamfered, spired massifs sitting on a
  // CONTINUOUS ridgeline, not rounded blobs at three sizes floating in sky.
  // SKY IS MOST OF THE FRAME, and it has to stay that way: the reference is
  // roughly half sky, and four carefully separated values need somewhere to be
  // seen against each other. Two masses per plane, far smaller than near.
  if (decorate.has("farField")) {
    const f = layerOf("farField").container;
    f.add(
      drawOps(
        scene,
        wrapY(
          massifTile(W, H, {
            fill: farFill,
            rimColor: rimOf(farFill),
            alpha: 0.95,
            light,
            rand,
            count: 2,
            scale: 0.72,
            // A far shape has no rim: a lit edge out there reads as a near
            // object and destroys the depth it is meant to build.
            rim: false,
            dots: false,
            ridgeAt: 0.62,
            avoid: { x: W * lightPositionOf(pal).x, r: 190 },
          }),
          H,
        ),
      ),
    );
    addDrift(
      "farField",
      driftTile(W, H, {
        materials: materialsFor(pal, farFill, liftAt(0, DEPTH_PLANES), 0.55, false),
        count: 7,
        minPx: 10,
        maxPx: 26,
        alpha: 0.9,
        light,
        laneGuard: 0,
        rand,
      }),
    );
  }
  if (decorate.has("midField")) {
    const m = layerOf("midField").container;
    m.add(
      drawOps(
        scene,
        wrapY(
          massifTile(W, H, {
            fill: midFill,
            rimColor: rimOf(midFill),
            alpha: 1,
            light,
            rand,
            count: 2,
            scale: 0.95,
            rim: true,
            dots: true,
            ridgeAt: 0.34,
            avoid: { x: W * lightPositionOf(pal).x, r: 150 },
          }),
          H,
        ),
      ),
    );
    m.add(
      drawOps(scene, wrapY(dustTile(W, H, mixHex(midFill, "#FFFFFF", 0.22), rand), H)),
    );
    addDrift(
      "midField",
      driftTile(W, H, {
        materials: materialsFor(pal, midFill, liftAt(1, DEPTH_PLANES), 0.45, true),
        count: 5,
        minPx: 26,
        maxPx: 54,
        alpha: 0.95,
        light,
        laneGuard: 0,
        rand,
      }),
    );
  }

  // --- L4 debris ----------------------------------------------------------
  // Distant, unlabelled rocks in the gameplay plane's own value. The Flight lane
  // owns the real, typeable debris; this is the silhouette that makes the world
  // read as populated when no word is on screen.
  if (decorate.has("debris")) {
    layerOf("debris").container.add(
      drawOps(
        scene,
        wrapY(
          driftTile(W, H, {
            materials: materialsFor(pal, debrisFill, liftAt(2, DEPTH_PLANES), 0.6, true),
            count: 5,
            minPx: 46,
            maxPx: 78,
            alpha: 1,
            light,
            laneGuard: 0.3,
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
    // WORLD-BAR item 6: the frame's near terrain. The world here scrolls
    // VERTICALLY, so the reference's bottom-of-frame foreground becomes canyon
    // walls running down both edges - same job, same plane, and they wrap with
    // the scroll instead of sliding off it.
    if (wantsFraming) {
      n.add(
        drawOps(
          scene,
          wrapY(canyonTile(W, H, { fill: nearFill, rimColor: rimOf(nearFill), light, rand }), H),
        ),
      );
    }
    n.add(drawOps(scene, wrapY(moteTile(W, H, nearFill, pal.accent, rand), H)));
    // WORLD-BAR item 7. Three of them. Tiny, high contrast, enormous effect.
    n.add(
      drawOps(scene, wrapY(accentTile(W, H, mixHex(pal.accent, "#FFFFFF", 0.2), rand), H)),
    );
    addDrift(
      "nearField",
      driftTile(W, H, {
        materials: materialsFor(pal, objectInk, 0, 0.8, true),
        count: 4,
        minPx: 70,
        maxPx: 132,
        alpha: 1,
        light,
        laneGuard: LANE_GUARD,
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
        count: 2,
        minPx: 130,
        maxPx: 230,
        alpha: 0.94,
        light,
        laneGuard: LANE_GUARD * 0.8,
        rand,
      }),
    );
    if (veilSpec !== null) {
      const tint = veilSpec.warm
        ? mixHex(pal.colors[0] ?? "#FFFFFF", "#FFFFFF", 0.45)
        : mixHex(skyStops(pal)[0], "#FFFFFF", 0.7);
      veilContainer = scene.add.container(0, 0);
      veilContainer.add(
        drawOps(
          scene,
          wrapXY(veilTile(W, H, { spec: veilSpec, tint, laneGuard: LANE_GUARD, rand }), W, H),
        ),
      );
      veilContainer.setAlpha(reducedMotion ? VEIL_ALPHA_REDUCED : VEIL_ALPHA);
      fv.add(veilContainer);
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
  if (kind !== null) {
    weather = atmospherePass(scene, pal, kind, W, H).setDepth(ATMOSPHERE_DEPTH);
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
      const crossScale = reducedMotion ? 0.55 : 1;
      for (const p of driftPlanes) {
        p.offset = mod(p.offset + (p.base + p.rate * worldSpeed) * crossScale * (dt / 1000), W);
        p.container.x = p.offset;
      }
      if (weather !== null) {
        // The weather crosses every plane, so it moves on its own clock rather
        // than on any one layer's: a touch faster than the near field, with a
        // slow sideways drift that keeps it alive on a still screen (rubric 2).
        weather.tilePositionY -= (worldSpeed * 1.45 + 26) * (dt / 1000);
        weather.tilePositionX += Math.sin(elapsedMs / 5200) * 0.22;
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
    const hex = t < 0.5 ? mixHex(top, mid, t * 2) : mixHex(mid, bottom, (t - 0.5) * 2);
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
  const cy = dy + h * 0.2;
  const r = 230;
  const sky = skyStops(pal)[1];
  // Hazed back. A planet drawn at full saturation sits IN FRONT of the far
  // ridges however slowly it scrolls - the first pass of this had Mars as a
  // near-black rust disc dominating a pale sky, which is atmospheric
  // perspective applied to everything except the largest object on screen.
  const body = atmospheric(pal.colors[2] ?? pal.accent, sky, 0.62);
  const lit = mixHex(body, "#FFFFFF", 0.28);
  const dark = mixHex(body, pal.colors[pal.colors.length - 1] ?? body, 0.3);

  const c = scene.add.container(0, 0);
  const glow = scene.add
    .image(cx, cy, TEX.glow)
    .setDisplaySize(r * 3.4, r * 3.4)
    .setTint(hexToNum(lit))
    // Lowered from 0.30. This is the second-brightest thing in frame and it was
    // washing the far plane it is meant to sit behind.
    .setAlpha(0.22)
    .setBlendMode(Phaser.BlendModes.ADD);
  c.add(glow);

  const g = scene.add.graphics();
  // Terminator: the dark disc, then the lit disc offset toward the light.
  // Two fills, no drawn shadow - depth is a value step (art dir. "Light").
  g.fillStyle(hexToNum(dark), 1);
  g.fillCircle(cx, cy, r);
  g.fillStyle(hexToNum(body), 1);
  g.fillCircle(cx - r * 0.14, cy - r * 0.1, r * 0.82);
  g.fillStyle(hexToNum(lit), 0.5);
  g.fillEllipse(cx - r * 0.34, cy - r * 0.38, r * 0.95, r * 0.6);
  // Rim highlight on the lit side, 1 px value step.
  g.lineStyle(3, hexToNum(mixHex(lit, "#FFFFFF", 0.4)), 0.55);
  g.beginPath();
  g.arc(cx, cy, r - 1.5, Phaser.Math.DegToRad(160), Phaser.Math.DegToRad(320), false);
  g.strokePath();
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
): Phaser.GameObjects.Graphics {
  const at = lightPositionOf(pal);
  const cx = w * at.x;
  const cy = dy + h * at.y;
  // Smaller and softer on a night stop. Earth is a launchpad after dark and
  // Neptune is most of the way to nowhere; the light in frame there is a moon,
  // not a sun, and a 78 px near-white disc on a navy sky is a hole in the
  // picture that also fights whatever type the screen puts near it.
  const bright = isBrightStop(pal);
  const r = bright ? 78 : 44;
  const skyTop = skyStops(pal)[0];
  const core = mixHex(skyTop, "#FFFFFF", bright ? 0.9 : 0.74);
  const halo = mixHex(skyTop, "#FFFFFF", bright ? 0.62 : 0.5);

  const g = scene.add.graphics();
  // Enough rings that each one's alpha step is below a visible band. The first
  // pass used 18 and the render showed concentric circles around the sun, which
  // is a different way of not having a soft halo.
  const rings = 40;
  for (let i = rings - 1; i >= 0; i--) {
    const t = i / (rings - 1);
    g.lineStyle(r * 0.14, hexToNum(halo), 0.034 * (1 - t) ** 1.7);
    g.strokeCircle(cx, cy, r * (1.03 + t * 1.9));
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
  const ramp = (y0: number, y1: number, peak: number): void => {
    for (let i = 0; i < steps; i++) {
      const a = Math.round(y0 + ((y1 - y0) * i) / steps);
      const b = Math.round(y0 + ((y1 - y0) * (i + 1)) / steps);
      if (b <= a) continue;
      const t = i / (steps - 1);
      g.fillStyle(hexToNum(ink), peak * t * t);
      g.fillRect(0, a, w, b - a);
    }
  };
  ramp(h, h - h * 0.34, 0.5);
  // A touch on the top edge too, so the HUD plate has something to sit on.
  ramp(0, h * 0.16, 0.16);
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
  const size = 256;
  if (!scene.textures.exists(key)) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    const r = rng(0xa17105 + kind.length);
    if (kind === "streaks" || kind === "dust") {
      const lines = kind === "streaks" ? 16 : 26;
      for (let i = 0; i < lines; i++) {
        const x = r() * size;
        const len = kind === "streaks" ? 110 + r() * 120 : 26 + r() * 54;
        g.lineStyle(kind === "streaks" ? 2 : 1.2, 0xffffff, 0.12 + r() * 0.2);
        // A shallow lean, wrapped: the pass has to tile in both axes or the
        // seam is a diagonal line across the sky.
        for (const dx of [-size, 0, size]) {
          g.lineBetween(x + dx, r() * size, x + dx + len * 0.28, r() * size + len);
        }
      }
    } else if (kind === "glitter") {
      for (let i = 0; i < 70; i++) {
        g.fillStyle(0xffffff, 0.14 + r() * 0.5);
        g.fillCircle(r() * size, r() * size, 0.7 + r() * 1.5);
      }
    } else {
      for (let i = 0; i < 14; i++) {
        g.fillStyle(0xffffff, 0.035 + r() * 0.05);
        g.fillEllipse(r() * size, r() * size, 90 + r() * 150, 24 + r() * 40);
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
