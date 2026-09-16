/**
 * PARALLAX (AC-22.1, AC-22.2, AC-19.3; art-direction.md section 2).
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
  type StopPalette,
  depthBands,
  hexToNum,
  mixHex,
  skyStops,
  skyStopsLate,
} from "./palette.js";
import { type Pt, TEX, ensureTextures, fillShape, smoothPolygon } from "./textures.js";

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

  let reducedMotion = options.reducedMotion ?? false;
  let worldSpeed = options.worldSpeed ?? 0;
  let elapsedMs = 0;

  const bands = depthBands(pal, 3);
  const farFill = bands[0] ?? pal.debris;
  const midFill = bands[1] ?? pal.debris;
  const nearFill = bands[2] ?? pal.debris;

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
  }

  // --- L1 celestial -------------------------------------------------------
  if (decorate.has("celestial")) {
    const c = layerOf("celestial").container;
    // Starfield first, so the planet occludes it.
    const stars = scene.add.graphics();
    const starTint = mixHex(skyStops(pal)[0], "#FFFFFF", 0.75);
    stars.fillStyle(hexToNum(starTint), 1);
    for (let i = 0; i < 90; i++) {
      const y = rand() * H * 2 - H;
      stars.fillStyle(hexToNum(starTint), 0.25 + rand() * 0.55);
      stars.fillCircle(rand() * W, y, 0.8 + rand() * 1.6);
    }
    c.add(stars);
    for (const dy of [0, -H]) c.add(celestialBody(scene, pal, W, dy));
  }

  // --- L2/L3 silhouette bands --------------------------------------------
  if (decorate.has("farField")) {
    layerOf("farField").container.add(bandDeck(scene, W, H, farFill, 0.6, rand, 3));
  }
  if (decorate.has("midField")) {
    const m = layerOf("midField").container;
    m.add(bandDeck(scene, W, H, midFill, 0.85, rand, 3));
    m.add(dustBank(scene, W, H, mixHex(midFill, "#FFFFFF", 0.22), rand));
  }

  // --- L4 debris ----------------------------------------------------------
  // Distant, unlabelled rocks. The Flight lane owns real debris; this is the
  // silhouette band that makes the plane read as populated.
  if (decorate.has("debris")) {
    layerOf("debris").container.add(rockField(scene, W, H, pal, rand));
  }

  // --- L5 near field ------------------------------------------------------
  if (decorate.has("nearField")) {
    layerOf("nearField").container.add(nearField(scene, W, H, nearFill, pal.accent, rand));
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

    destroy(): void {
      for (const l of layers) l.container.destroy(true);
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

/** The stop's planet, large and partially framed, with a soft radial glow. */
function celestialBody(
  scene: Phaser.Scene,
  pal: StopPalette,
  w: number,
  dy: number,
): Phaser.GameObjects.Container {
  const cx = w * 0.74;
  const cy = dy + 180;
  const r = 340;
  const body = pal.colors[2] ?? pal.accent;
  const lit = mixHex(body, "#FFFFFF", 0.28);
  const dark = mixHex(body, pal.colors[pal.colors.length - 1] ?? body, 0.55);

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
 * A silhouette band: soft rounded decks spread down a stage-height tile, one
 * flat palette colour. Drawn twice so the layer wraps.
 */
function bandDeck(
  scene: Phaser.Scene,
  w: number,
  h: number,
  fill: string,
  alpha: number,
  rand: () => number,
  count: number,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(hexToNum(fill), alpha);
  for (const dy of [0, -h]) {
    for (let i = 0; i < count; i++) {
      const baseY = dy + ((i + rand() * 0.6) / count) * h;
      const cx = rand() * w;
      // Wide and flat: these are horizon decks and cloud banks, not boulders.
      const rx = w * (0.34 + rand() * 0.34);
      const ry = 26 + rand() * 30;
      fillShape(g, smoothPolygon(deckPoints(cx, baseY, rx, ry, rand), 8));
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
  pal: StopPalette,
  rand: () => number,
): Phaser.GameObjects.Graphics {
  const deep = pal.colors[pal.colors.length - 1] ?? pal.debris;
  // A distant rock is the debris colour stepped TOWARD the void, never toward
  // white: a light rim on a far rock reads as a nearby object and breaks the
  // depth read (art dir. "Light").
  const base = mixHex(pal.debris, deep, 0.3);
  const crater = mixHex(base, deep, 0.5);
  const rim = mixHex(base, pal.colors[0] ?? base, 0.35);
  const count = 5;
  const g = scene.add.graphics();
  for (const dy of [0, -h]) {
    for (let i = 0; i < count; i++) {
      const cx = 120 + rand() * (w - 240);
      const cy = dy + ((i + rand() * 0.7) / count) * h;
      const r = 26 + rand() * 30;
      const shape = smoothPolygon(deckPoints(cx, cy, r, r * (0.82 + rand() * 0.3), rand), 8);
      g.fillStyle(hexToNum(rim), 0.5);
      fillShape(g, shape.map((p) => ({ x: p.x - 2, y: p.y - 2 })));
      g.fillStyle(hexToNum(base), 1);
      fillShape(g, shape);
      g.fillStyle(hexToNum(crater), 0.75);
      g.fillCircle(cx + r * 0.24, cy + r * 0.18, r * 0.26);
      g.fillCircle(cx - r * 0.3, cy + r * 0.36, r * 0.15);
    }
  }
  return g;
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
  for (const dy of [0, -h]) {
    for (let i = 0; i < 22; i++) {
      const s = 10 + rand() * 30;
      out.push(
        scene.add
          .image(rand() * w, dy + rand() * h, TEX.mote)
          .setDisplaySize(s, s)
          .setTint(hexToNum(fill))
          .setAlpha(0.18 + rand() * 0.3),
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
