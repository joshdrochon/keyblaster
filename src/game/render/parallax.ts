/**
 * PARALLAX (AC-22.1, AC-22.2, AC-19.3; art-direction.md section 2;
 * design-reference/refs/WORLD-BAR.md).
 *
 * One builder, used by every world-facing scene. It takes a palette and the
 * LAYERS table from `layers.ts` - it does not invent speeds, depths or drift
 * curves; those ARE the rubric and live there.
 *
 * WHAT IT GUARANTEES
 *  - Eight containers exist, one per LayerSpec, at the spec's depth. Scenes add
 *    their own content (the ship, debris, HUD) into `layerOf(id).container`
 *    rather than building a second stack.
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
 * THREE LAYERS DO NOT SCROLL, on purpose: `sky` and `hud` are pinned at speed 0
 * by the art direction, and `shipFx` is speed 1.0 but the SHIP IS FIXED (art
 * dir. L6) - its 1.0 describes the plane it shares with debris, not a
 * translation. It still moves every frame via drift and sway, so it still
 * counts toward "nothing is ever still".
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
 *   2 value range         `foregroundInk` anchors the near end at near-black
 *   3 hue shift           `coolShift`, applied with the lift
 *   4 one light, in frame `celestialBody` at `lightPositionOf`, rims everywhere
 *   5 characterful shapes `massif` - angular, chamfered, terraced, dotted
 *   6 dark framing        `canyonWall` on the near plane + a pinned vignette
 *   7 sparse accents      `accents` - three, tiny, high contrast
 *   8 atmosphere pass     `atmosphereFor` - one cheap full-screen pass per stop
 *
 * All eight are still layers, gradients and generated vector textures, so the
 * AC-22.9 budget is untouched: no post-processing, no filters, no shaders.
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
  hexToNum,
  lightAngleOf,
  lightPositionOf,
  mixHex,
  rimOf,
  skyStops,
  skyStopsLate,
} from "./palette.js";
import { type Pt, TEX, ensureTextures, fillShape, smoothPolygon } from "./textures.js";

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
/** Depth of the atmosphere pass: in front of the ship, behind the HUD. */
const ATMOSPHERE_DEPTH = 6.5;

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

  // WORLD-BAR items 1-3, in one line: four fills spanning near-sky to
  // near-black, desaturating and cooling with distance. Everything drawn below
  // takes its colour from this array and from nothing else, which is what makes
  // the depth read consistent instead of per-shape.
  const ramp = depthRamp(pal, DEPTH_PLANES);
  const farFill = ramp[0] ?? pal.debris;
  const midFill = ramp[1] ?? pal.debris;
  const debrisFill = ramp[2] ?? pal.debris;
  const nearFill = ramp[3] ?? foregroundInk(pal);
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

  /** Objects outside the eight layers: pinned framing and the weather pass. */
  const extras: Phaser.GameObjects.GameObject[] = [];

  // --- L0 sky -------------------------------------------------------------
  // Two full-stage gradients (stage start / stage end) crossfaded by
  // setSkyProgress. Graphics has no gradient fill, so a gradient is a stack of
  // 1px-tall strips - one draw, no texture memory, and it is genuinely vector.
  let skyLate: Phaser.GameObjects.Graphics | null = null;
  if (decorate.has("sky")) {
    const sky = layerOf("sky").container;
    sky.add(gradient(scene, W, H, skyStops(pal)));
    skyLate = gradient(scene, W, H, skyStopsLate(pal)).setAlpha(0);
    sky.add(skyLate);
    // NOTE: the bloom around the light is drawn ONCE, by `sunDisc` on the
    // celestial layer. A second full-screen additive pass here is what clipped
    // Mars' top band to pure white - two ADD blends of a near-white tint over a
    // butterscotch sky saturate every channel, and a clipped sky cannot travel.
  }

  // --- L1 celestial -------------------------------------------------------
  if (decorate.has("celestial")) {
    const c = layerOf("celestial").container;
    // Starfield first, so the planet occludes it.
    const stars = scene.add.graphics();
    const starTint = mixHex(skyStops(pal)[0], "#FFFFFF", 0.75);
    for (let i = 0; i < 90; i++) {
      const y = rand() * H * 2 - H;
      stars.fillStyle(hexToNum(starTint), 0.25 + rand() * 0.55);
      stars.fillCircle(rand() * W, y, 0.8 + rand() * 1.6);
    }
    c.add(stars);
    for (const dy of [0, -H]) c.add(celestialBody(scene, pal, W, H, dy));
    // WORLD-BAR item 4: the source itself, in frame. The planet alone is not
    // it - a large dark disc reads as an object the light falls on, which is
    // exactly what it is, and leaves the frame with no visible source for the
    // rims on every silhouette below.
    for (const dy of [0, -H]) c.add(sunDisc(scene, pal, W, H, dy));
  }

  // --- L2/L3 silhouette planes -------------------------------------------
  // WORLD-BAR item 5: angular, terraced, chamfered massifs, not rounded blobs
  // at three sizes. The far plane is nearly the sky; the mid plane is the first
  // value the eye can actually separate from it.
  // SKY IS MOST OF THE FRAME. The reference is roughly half sky, and the first
  // pass of this rewrite was not: three big massifs per plane per wrap covered
  // most of the canvas, so four carefully separated values had nowhere to be
  // seen against each other. Two per plane, and the far plane smaller than the
  // near one, which is also just perspective.
  if (decorate.has("farField")) {
    layerOf("farField").container.add(
      massifField(scene, W, H, {
        fill: farFill,
        alpha: 0.95,
        light,
        rand,
        count: 2,
        scale: 0.72,
        // A far shape has no rim: a lit edge out there reads as a near object
        // and destroys the depth it is meant to build (art dir. "Light").
        rim: false,
        dots: false,
      }),
    );
  }
  if (decorate.has("midField")) {
    const m = layerOf("midField").container;
    m.add(
      massifField(scene, W, H, {
        fill: midFill,
        alpha: 1,
        light,
        rand,
        count: 2,
        scale: 0.95,
        rim: true,
        dots: true,
      }),
    );
    m.add(dustBank(scene, W, H, mixHex(midFill, "#FFFFFF", 0.22), rand));
  }

  // --- L4 debris ----------------------------------------------------------
  // Distant, unlabelled rocks. The Flight lane owns real debris; this is the
  // silhouette plane that makes the world read as populated.
  if (decorate.has("debris")) {
    layerOf("debris").container.add(rockField(scene, W, H, debrisFill, light, rand));
  }

  // --- L5 near field ------------------------------------------------------
  if (decorate.has("nearField")) {
    const n = layerOf("nearField").container;
    // WORLD-BAR item 6: a genuinely dark foreground that frames the scene. The
    // world here scrolls VERTICALLY, so the reference's bottom-of-frame
    // foreground becomes canyon walls running down both edges - same job (they
    // frame and they are near-black), same plane, and they wrap with the scroll
    // instead of sliding off it.
    if (wantsFraming) n.add(canyonWalls(scene, W, H, nearFill, light, rand));
    n.add(nearField(scene, W, H, nearFill, pal.accent, rand));
    // WORLD-BAR item 7. Three of them. Tiny, high contrast, enormous effect.
    n.add(accents(scene, W, H, pal, rand));
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
    },

    debugOffsets(): Record<string, { x: number; y: number }> {
      const out: Record<string, { x: number; y: number }> = {};
      for (const l of layers) out[l.spec.id] = { x: l.container.x, y: l.container.y };
      return out;
    },

    debugMotion(): { swayPx: number; elapsedMs: number; reducedMotion: boolean } {
      return { swayPx: cameraSwayPx(elapsedMs, reducedMotion), elapsedMs, reducedMotion };
    },

    debugDepth(): {
      fills: readonly string[];
      lightAngleRad: number;
      atmosphere: string | null;
    } {
      return { fills: [...ramp], lightAngleRad: light, atmosphere: kind };
    },

    destroy(): void {
      for (const l of layers) l.container.destroy(true);
      for (const e of extras) e.destroy();
      extras.length = 0;
      weather = null;
    },
  };

  parallax.update(0);
  return parallax;
}

// ---------------------------------------------------------------------------
// Content generators. Each returns ONE Graphics drawn twice - once at y and
// once at y - H - so the layer wraps seamlessly at one draw call.
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
 * It sits at `lightPositionOf`, which is the same number every rim highlight in
 * the frame is computed from, so the light in this game has one source and the
 * player can see where it is.
 */
function celestialBody(
  scene: Phaser.Scene,
  pal: StopPalette,
  w: number,
  h: number,
  dy: number,
): Phaser.GameObjects.Container {
  // Opposite the light, so the planet is lit from the same direction as every
  // silhouette in the frame and the terminator below actually means something.
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
    .setAlpha(0.3)
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
 * The light, as an object. Small, bright, and at `lightPositionOf` - the same
 * number the rim highlight on every silhouette is computed from.
 */
function sunDisc(
  scene: Phaser.Scene,
  pal: StopPalette,
  w: number,
  h: number,
  dy: number,
): Phaser.GameObjects.Container {
  const at = lightPositionOf(pal);
  const cx = w * at.x;
  const cy = dy + h * at.y;
  const r = 86;
  // Nearly white. At 0.72 toward white the disc was within a few values of
  // Mars' own butterscotch sky and read as a smudge rather than as a sun - the
  // brightest thing in the frame has to actually be the brightest thing.
  const core = mixHex(skyStops(pal)[0], "#FFFFFF", 0.93);

  const c = scene.add.container(0, 0);
  c.add(
    scene.add
      .image(cx, cy, TEX.glow)
      .setDisplaySize(r * 6.5, r * 6.5)
      .setTint(hexToNum(core))
      .setAlpha(0.26)
      .setBlendMode(Phaser.BlendModes.ADD),
  );
  const g = scene.add.graphics();
  g.fillStyle(hexToNum(core), 0.98);
  g.fillCircle(cx, cy, r);
  c.add(g);
  return c;
}

// ---------------------------------------------------------------------------
// Massifs (WORLD-BAR item 5)
// ---------------------------------------------------------------------------

/**
 * An angular rock mass: flat planes, chamfered corners, terraced shoulders.
 *
 * This is the shape language the reference actually uses and the one we did not
 * have. `smoothPolygon` rounds everything it touches, which is right for a
 * friendly asteroid you shoot (art dir. section 4) and wrong for the scenery
 * behind it: a world built entirely of rounded blobs has no edges for the light
 * to catch and nothing for the eye to read as structure.
 */
function massifPoints(
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  rand: () => number,
): Pt[] {
  const chamfer = halfW * (0.18 + rand() * 0.16);
  const top = cy - halfH;
  const bottom = cy + halfH;
  const left = cx - halfW;
  const right = cx + halfW;
  // A stepped shoulder on one side, picked per shape, so no two silhouettes in
  // a field are the same slab.
  const stepSide = rand() < 0.5 ? -1 : 1;
  const stepX = cx + stepSide * halfW * (0.42 + rand() * 0.3);
  const stepY = top + halfH * (0.5 + rand() * 0.5);

  const pts: Pt[] = [
    { x: left + chamfer, y: top },
    { x: right - chamfer, y: top },
    { x: right, y: top + chamfer },
  ];
  if (stepSide > 0) {
    pts.push({ x: right, y: stepY - chamfer * 0.6 });
    pts.push({ x: stepX, y: stepY });
    pts.push({ x: stepX, y: bottom - chamfer });
    pts.push({ x: stepX - chamfer, y: bottom });
  } else {
    pts.push({ x: right, y: bottom - chamfer });
    pts.push({ x: right - chamfer, y: bottom });
  }
  if (stepSide < 0) {
    pts.push({ x: stepX + chamfer, y: bottom });
    pts.push({ x: stepX, y: bottom - chamfer });
    pts.push({ x: stepX, y: stepY });
    pts.push({ x: left, y: stepY - chamfer * 0.6 });
  } else {
    pts.push({ x: left + chamfer, y: bottom });
    pts.push({ x: left, y: bottom - chamfer });
  }
  pts.push({ x: left, y: top + chamfer });
  return pts;
}

/** The reference's temple face: a sparse diamond grid inside a near silhouette. */
function dotGrid(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  tint: string,
): void {
  const step = 34;
  g.fillStyle(hexToNum(tint), 0.5);
  for (let y = cy - halfH + step; y < cy + halfH - step * 0.5; y += step) {
    for (let x = cx - halfW + step; x < cx + halfW - step * 0.5; x += step) {
      g.fillPoints(
        [
          new Phaser.Geom.Point(x, y - 4),
          new Phaser.Geom.Point(x + 4, y),
          new Phaser.Geom.Point(x, y + 4),
          new Phaser.Geom.Point(x - 4, y),
        ],
        true,
        true,
      );
    }
  }
}

/** A fan of tapered spikes: the reference's agave, as a rock-growth silhouette. */
function frond(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  size: number,
  tint: string,
  rand: () => number,
): void {
  g.fillStyle(hexToNum(tint), 1);
  const blades = 7;
  for (let i = 0; i < blades; i++) {
    const a = -Math.PI + (Math.PI * (i + 0.5)) / blades;
    const len = size * (0.65 + rand() * 0.45);
    const wob = 0.12;
    g.fillPoints(
      [
        new Phaser.Geom.Point(cx + Math.cos(a - wob) * size * 0.16, cy + Math.sin(a - wob) * size * 0.16),
        new Phaser.Geom.Point(cx + Math.cos(a) * len, cy + Math.sin(a) * len),
        new Phaser.Geom.Point(cx + Math.cos(a + wob) * size * 0.16, cy + Math.sin(a + wob) * size * 0.16),
      ],
      true,
      true,
    );
  }
}

interface MassifOptions {
  readonly fill: string;
  readonly alpha: number;
  readonly light: number;
  readonly rand: () => number;
  readonly count: number;
  readonly scale: number;
  readonly rim: boolean;
  readonly dots: boolean;
}

/** One depth plane's worth of massifs, drawn twice so the plane wraps. */
function massifField(
  scene: Phaser.Scene,
  w: number,
  h: number,
  o: MassifOptions,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  const rim = rimOf(o.fill);
  // Art-direction section 2: the rim is a second offset shape on the LIT side,
  // never a drawn shadow on the dark side.
  const rimDx = -Math.cos(o.light) * 4;
  const rimDy = -Math.sin(o.light) * 4;

  for (const dy of [0, -h]) {
    for (let i = 0; i < o.count; i++) {
      const halfW = (110 + o.rand() * 190) * o.scale;
      const halfH = (150 + o.rand() * 260) * o.scale;
      const cx = halfW * 0.5 + o.rand() * (w - halfW);
      const cy = dy + ((i + o.rand() * 0.75) / o.count) * h;
      const shape = massifPoints(cx, cy, halfW, halfH, o.rand);

      if (o.rim) {
        g.fillStyle(hexToNum(rim), o.alpha);
        fillShape(g, shape.map((p) => ({ x: p.x + rimDx, y: p.y + rimDy })));
      }
      g.fillStyle(hexToNum(o.fill), o.alpha);
      fillShape(g, shape);

      if (o.dots && o.rand() < 0.6) {
        dotGrid(g, cx, cy, halfW * 0.62, halfH * 0.66, rim);
      }
      if (o.rand() < 0.5) {
        frond(g, cx + halfW * 0.5, cy - halfH * 0.92, 44 * o.scale, o.fill, o.rand);
      }
    }
  }
  return g;
}

/**
 * WORLD-BAR item 6. Near-black masses running down both edges of the frame.
 *
 * The reference frames its scene with a dark foreground along the bottom. This
 * world scrolls top-to-bottom instead of left-to-right, so the same job is done
 * by the edges: they are the nearest thing in the frame, they are the darkest
 * value in it, and because they are built on the near-field plane they wrap with
 * the scroll rather than sliding out of it.
 *
 * They stay off the middle of the screen on purpose - the middle is where the
 * word plates fall, and a foreground that eats a word is a foreground that costs
 * a child a rock.
 */
function canyonWalls(
  scene: Phaser.Scene,
  w: number,
  h: number,
  fill: string,
  light: number,
  rand: () => number,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  const rim = rimOf(fill);
  const rimDx = -Math.cos(light) * 3;
  const rimDy = -Math.sin(light) * 3;
  const maxReach = w * 0.085;

  for (const dy of [0, -h]) {
    for (const side of [-1, 1] as const) {
      const segments = 4;
      for (let i = 0; i < segments; i++) {
        const halfH = h / segments / 2;
        const cy = dy + (i + 0.5) * (h / segments);
        const reach = maxReach * (0.5 + rand() * 0.5);
        const cx = side < 0 ? -reach * 0.25 : w + reach * 0.25;
        const shape = massifPoints(cx, cy, reach, halfH * 1.05, rand);
        g.fillStyle(hexToNum(rim), 0.9);
        fillShape(g, shape.map((p) => ({ x: p.x + rimDx, y: p.y + rimDy })));
        g.fillStyle(hexToNum(fill), 1);
        fillShape(g, shape);
      }
    }
  }
  return g;
}

/** Mid-field dust: bigger, softer, lower-contrast than the near field. */
function dustBank(
  scene: Phaser.Scene,
  w: number,
  h: number,
  fill: string,
  rand: () => number,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  for (const dy of [0, -h]) {
    for (let i = 0; i < 20; i++) {
      g.fillStyle(hexToNum(fill), 0.035 + rand() * 0.055);
      g.fillEllipse(rand() * w, dy + rand() * h, 240 + rand() * 420, 34 + rand() * 60);
    }
  }
  return g;
}

/** Distant rocks: two-tone, rounded, never spiky (art dir. section 4). */
function rockField(
  scene: Phaser.Scene,
  w: number,
  h: number,
  fill: string,
  light: number,
  rand: () => number,
): Phaser.GameObjects.Graphics {
  const crater = mixHex(fill, "#000000", 0.28);
  const rim = rimOf(fill);
  const rimDx = -Math.cos(light) * 2.5;
  const rimDy = -Math.sin(light) * 2.5;
  const count = 5;
  const g = scene.add.graphics();
  for (const dy of [0, -h]) {
    for (let i = 0; i < count; i++) {
      const cx = 120 + rand() * (w - 240);
      const cy = dy + ((i + rand() * 0.7) / count) * h;
      const r = 26 + rand() * 30;
      const shape = smoothPolygon(deckPoints(cx, cy, r, r * (0.82 + rand() * 0.3), rand), 8);
      g.fillStyle(hexToNum(rim), 0.6);
      fillShape(g, shape.map((p) => ({ x: p.x + rimDx, y: p.y + rimDy })));
      g.fillStyle(hexToNum(fill), 1);
      fillShape(g, shape);
      g.fillStyle(hexToNum(crater), 0.75);
      g.fillCircle(cx + r * 0.24, cy + r * 0.18, r * 0.26);
      g.fillCircle(cx - r * 0.3, cy + r * 0.36, r * 0.15);
    }
  }
  return g;
}

function deckPoints(cx: number, cy: number, rx: number, ry: number, rand: () => number): Pt[] {
  const pts: Pt[] = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 0.72 + rand() * 0.42;
    pts.push({ x: cx + Math.cos(a) * rx * k, y: cy + Math.sin(a) * ry * k });
  }
  return pts;
}

/** Foreground motes and glints: sparse, blurred by SIZE, never by a filter. */
function nearField(
  scene: Phaser.Scene,
  w: number,
  h: number,
  fill: string,
  accent: string,
  rand: () => number,
): Phaser.GameObjects.GameObject[] {
  const out: Phaser.GameObjects.GameObject[] = [];
  // Blurred BY SIZE: the near plane's motes are the biggest and softest in the
  // frame, which is the only "blur" the AC-22.9 budget allows.
  for (const dy of [0, -h]) {
    for (let i = 0; i < 22; i++) {
      const s = 18 + rand() * 54;
      out.push(
        scene.add
          .image(rand() * w, dy + rand() * h, TEX.mote)
          .setDisplaySize(s, s)
          .setTint(hexToNum(mixHex(fill, "#FFFFFF", 0.12)))
          .setAlpha(0.1 + rand() * 0.16),
      );
    }
    for (let i = 0; i < 7; i++) {
      const s = 14 + rand() * 20;
      out.push(
        scene.add
          .image(rand() * w, dy + rand() * h, TEX.glint)
          .setDisplaySize(s, s)
          .setTint(hexToNum(accent))
          .setAlpha(0.3 + rand() * 0.35)
          .setBlendMode(Phaser.BlendModes.ADD),
      );
    }
  }
  return out;
}

/**
 * WORLD-BAR item 7: sparse, high-contrast accents.
 *
 * "A bird, a flag, balloons, a few drifting diamonds. Tiny, few, and they carry
 * enormous life." Three per wrap, in the stop's accent, at sizes small enough
 * that they never compete with a word plate. Their whole job is to be the one
 * saturated thing in a desaturated frame.
 */
function accents(
  scene: Phaser.Scene,
  w: number,
  h: number,
  pal: StopPalette,
  rand: () => number,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  const bright = mixHex(pal.accent, "#FFFFFF", 0.2);
  for (const dy of [0, -h]) {
    for (let i = 0; i < 3; i++) {
      const cx = w * (0.1 + rand() * 0.8);
      const cy = dy + ((i + rand()) / 3) * h;
      // A small drifting diamond and two smaller followers: the same read as
      // the reference's balloons, with this game's shape language.
      g.fillStyle(hexToNum(bright), 0.85);
      for (const [ox, oy, s] of [
        [0, 0, 9],
        [22, 34, 5],
        [-18, 52, 4],
      ] as const) {
        g.fillPoints(
          [
            new Phaser.Geom.Point(cx + ox, cy + oy - s),
            new Phaser.Geom.Point(cx + ox + s, cy + oy),
            new Phaser.Geom.Point(cx + ox, cy + oy + s),
            new Phaser.Geom.Point(cx + ox - s, cy + oy),
          ],
          true,
          true,
        );
      }
    }
  }
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
  const ink = foregroundInk(pal);
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
  ramp(h, h - h * 0.34, 0.44);
  // A touch on the top edge too, so the HUD plate has something to sit on.
  ramp(0, h * 0.16, 0.16);
  return g;
}

/**
 * WORLD-BAR item 8: one atmosphere pass per stop.
 *
 * A single tiled texture drifting across the whole frame, in front of the ship
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
