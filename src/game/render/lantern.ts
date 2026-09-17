/**
 * THE LANTERN (D89, D90, FR-24; art-direction.md section 5).
 *
 * Vector, drawn in code (D83). `design-reference/refs/lantern-topdown.png` was
 * LOOKED AT while writing this and is never loaded: the reference is the four
 * colourways, the silhouette, the proportions and the emitter treatment, all
 * reproduced below as geometry.
 *
 * Proportions are taken off the reference and expressed as ratios of the
 * fuselage half-width (`W`), so the whole ship scales from one number:
 *   overall height / fuselage width  ~ 2.87
 *   fin span      / fuselage width  ~ 1.52
 *   lens diameter / fuselage width  ~ 0.57
 *   porthole dia. / fuselage width  ~ 0.62
 *
 * AC-24.1 - the emitter is engineered tech, not a gun barrel: finned heat
 * housing, a yoke on a pivot mount, three concentric focusing rings, a six-blade
 * iris that opens on fire, one large lens. One beam source.
 * AC-24.3 - four colourways = the four base ships (D79). No text is drawn on
 * the hull; `shipName` is an optional dynamic label the caller passes in.
 */

import Phaser from "phaser";
import { hexToNum, mixHex } from "./palette.js";
import {
  type Pt,
  TEX,
  ensureTextures,
  fillShape,
  profileBand,
  profilePolygon,
  rampAt,
  smoothPolygon,
  starPoints,
} from "./textures.js";
import {
  FIN_TIP,
  LANTERN_DESIGN_HEIGHT,
  LENS_LOCAL,
  LENS_R,
  NOZZLE_BOTTOM,
  PIVOT,
} from "./lanternGeometry.js";

// ---------------------------------------------------------------------------
// Geometry, in design units. W = 80 is the fuselage half-width.
//
// Every number below is a RATIO measured off the reference sheet and multiplied
// by the fuselage width (2W = 160), so the ship is one shape at any size:
//   total height / fuselage width   2.61
//   fuselage height / width         1.69   (a capsule, not a tube)
//   fin span / width                1.62
//   lens diameter / width           0.44   (the instrument SITS ON the nose)
//   porthole diameter / width       0.58
// The emitter assembly is 23% of total height and the lens head alone 17%,
// which is what keeps the read "rocket with an instrument at its nose".
// ---------------------------------------------------------------------------

const W = 80;
/** Top of the cream NOSECONE. The emitter collar mounts onto this, not over it. */
const Y_TOP = -142;
const Y_BOT = 128;

/**
 * Half-width down the hull, as a fraction of W: a capsule, fullest at the
 * porthole and tapering gently both ways (art-direction section 4: "rounded,
 * chunky, friendly"). The first stop is small but non-zero - that is the
 * rounded nosecone shoulder the collar sits on.
 */
const HULL_PROFILE = [0.14, 0.52, 0.78, 0.94, 1.0, 0.99, 0.94, 0.84, 0.66] as const;
const hull = (t: number): number => W * rampAt(HULL_PROFILE, t);

/** Spine fraction -> rig y. */
const atT = (t: number): number => Y_TOP + (Y_BOT - Y_TOP) * t;

const PORTHOLE_Y = -10;
const PORTHOLE_R = 46;

/** Livery: one thick band, one thin band at the shoulder (reference sheet). */
const BAND_THIN: readonly [number, number] = [0.04, 0.1];
const BAND_THICK: readonly [number, number] = [0.17, 0.3];

/**
 * The design-unit geometry moved to `lanternGeometry.ts`, which imports no
 * Phaser, so a unit test can ask how tall the ship is without booting a game
 * (UR-53 places one in a 110 px gap on the Director map and has to prove it
 * fits, at all seven stops). Re-exported here, so every existing importer of
 * `LANTERN_DESIGN_HEIGHT` / `LANTERN_LENS_OFFSET` is unaffected.
 */
export {
  LANTERN_DESIGN_HEIGHT,
  LANTERN_LENS_OFFSET,
  LANTERN_ABOVE_ORIGIN,
  LANTERN_PLUME_LENGTH,
  lanternDesignBox,
} from "./lanternGeometry.js";

// ---------------------------------------------------------------------------
// Colourways: the four ships in the reference sheet (D79, AC-24.3).
// ---------------------------------------------------------------------------

export type LanternColorway = "coral" | "teal" | "amber" | "rose";

export const LANTERN_COLORWAYS: readonly LanternColorway[] = [
  "coral",
  "teal",
  "amber",
  "rose",
] as const;

const STRIPE: Record<LanternColorway, string> = {
  coral: "#E8695A",
  teal: "#58B5AE",
  amber: "#F0B429",
  rose: "#EE8593",
};

const HULL_CREAM = "#F2E6D2";
const HULL_LIGHT = "#FFF8EA";
const HULL_SHADE = "#DBC8AC";

// Gunmetal, not black: on the reference the instrument reads as machined metal
// with warm highlights, and a near-black housing swallows the silhouette.
const METAL_DARK = "#4E555E";
const METAL = "#7A828C";
const METAL_LIGHT = "#B4BBC3";
const METAL_RIM = "#D6DCE3";
const BRASS = "#C0A15E";
const LENS_GOLD = "#FFD25C";
const LENS_HOT = "#FFF7DA";
const GLASS = "#25405A";
const GLASS_DEEP = "#16283A";

// ---------------------------------------------------------------------------

/**
 * A ship's four chosen colours (`ui/catalog.ts`: `ShipDef["colors"]`).
 *
 * WHY THIS EXISTS. The four `LANTERN_COLORWAYS` are the four BASE ships of
 * D79, and they are a closed set written into this file. The profile's ship is
 * not: a child picks one at profile creation and can unlock a SKIN for it
 * (`catalog.liveryFor`), which is a fifth, sixth, seventh and eighth colourway
 * this file has never heard of. Before this existed the flight screen answered
 * that by drawing its own ship with its own hardcoded hex - which is how the
 * game came to fly something `R-lantern` had never judged.
 *
 * Only four colours vary. The metal, the brass and the speculars do not: they
 * are the INSTRUMENT, and an amber lens on a brass ring is the same machined
 * object whichever hull it is bolted to.
 */
export interface LanternLivery {
  readonly hull: string;
  readonly stripe: string;
  readonly glass: string;
  readonly lens: string;
}

/** The full working palette, with the values a livery does not state derived. */
interface LanternSkin {
  readonly hull: string;
  readonly hullLight: string;
  readonly hullShade: string;
  readonly stripe: string;
  readonly glass: string;
  readonly glassDeep: string;
  readonly lens: string;
  readonly lensHot: string;
}

/**
 * NO LIVERY MEANS THE CONSTANTS, BYTE FOR BYTE.
 *
 * `R-lantern` is a human comparing `lanternShot.ts`'s render against the
 * reference sheet, and that render passes no livery. So the `undefined` branch
 * returns the exact constants this file has always drawn with rather than a
 * round trip through `mixHex` that would land a level or two away and quietly
 * invalidate a verdict somebody had already given.
 */
function skinFor(colorway: LanternColorway, livery?: LanternLivery): LanternSkin {
  if (livery === undefined) {
    return {
      hull: HULL_CREAM,
      hullLight: HULL_LIGHT,
      hullShade: HULL_SHADE,
      stripe: STRIPE[colorway],
      glass: GLASS,
      glassDeep: GLASS_DEEP,
      lens: LENS_GOLD,
      lensHot: LENS_HOT,
    };
  }
  // The four derived values keep the same RELATIONSHIPS the constants have -
  // light is the hull toward white, shade is the hull toward the gunmetal, the
  // deep glass is the glass toward black, the hot lens is the lens toward
  // white - so a catalogue colour lands in the same drawing rather than in a
  // flat-shaded copy of it.
  return {
    hull: livery.hull,
    hullLight: mixHex(livery.hull, "#FFFFFF", 0.45),
    hullShade: mixHex(livery.hull, METAL_DARK, 0.22),
    stripe: livery.stripe,
    glass: livery.glass,
    glassDeep: mixHex(livery.glass, "#0B0D11", 0.55),
    lens: livery.lens,
    lensHot: mixHex(livery.lens, "#FFFFFF", 0.62),
  };
}

export interface LanternOptions {
  /** 1.0 draws the ship at LANTERN_DESIGN_HEIGHT px tall. */
  readonly scale?: number;
  readonly colorway?: LanternColorway;
  /**
   * The profile's four colours. Overrides `colorway` when given; omit it and
   * the ship is drawn in the base colourway exactly as it always was.
   */
  readonly livery?: LanternLivery;
  /** D41 / AC-19.3: the idle bob slows, it never stops. */
  readonly reducedMotion?: boolean;
  readonly exhaust?: boolean;
  /** The idle light shaft out of the lens. */
  readonly beam?: boolean;
  readonly idleBob?: boolean;
  /** 0 = closed iris (idle), 1 = fully open (firing). */
  readonly iris?: number;
  /**
   * Rendered on the flank, dynamically (AC-24.3). Left undefined by default:
   * the ART carries no text, ever.
   */
  readonly shipName?: string;
}

export interface LanternRig {
  readonly container: Phaser.GameObjects.Container;
  /** The yoke + head. Rotates to track the locked target; the mount does not. */
  readonly emitterMount: Phaser.GameObjects.Container;
  /**
   * The iris blades, so a caller can blip the aperture's ALPHA without redrawing
   * it. Flight acknowledges every keystroke that matched nothing with one
   * (AC-6e.2), and that is a property of the object rather than of the drawing,
   * which is why it is a handle and not a third draw entry point.
   */
  readonly iris: Phaser.GameObjects.Graphics;
  /**
   * The plume and its glow. Flight dims this when the engines go quiet (D29) -
   * again a property of the object, so the stall does not need its own exhaust.
   * Empty when the rig was built with `exhaust: false`.
   */
  readonly exhaust: Phaser.GameObjects.Container;
  /** World-space point the beam originates from (the lens centre). */
  beamOrigin(): { x: number; y: number };
  /** Aim the emitter at a world point. Clamped, and eased - never snapped. */
  aimAt(worldX: number, worldY: number): void;
  /** 0..1. The iris opens on fire (AC-24.1). */
  setIris(open: number): void;
  setColorway(colorway: LanternColorway): void;
  /** Repaint in a profile's four colours; `undefined` restores the colourway. */
  setLivery(livery: LanternLivery | undefined): void;
  destroy(): void;
}

/**
 * Max emitter swing from straight ahead. A head that spins is a turret, not a lamp.
 *
 * Exported because Flight aims the same head on a per-frame lerp rather than
 * with `aimAt`'s tween (a tween per frame is a tween leak), and an aim limit
 * that exists in two places is an aim limit that ends up with two values.
 */
export const LANTERN_AIM_LIMIT = Phaser.Math.DegToRad(26);
const AIM_LIMIT = LANTERN_AIM_LIMIT;

export function drawLantern(
  scene: Phaser.Scene,
  x: number,
  y: number,
  options: LanternOptions = {},
): LanternRig {
  ensureTextures(scene);

  const scale = options.scale ?? 1;
  const reducedMotion = options.reducedMotion ?? false;
  let colorway = options.colorway ?? "coral";
  let livery = options.livery;
  let skin = skinFor(colorway, livery);

  const rig = scene.add.container(x, y).setScale(scale);

  // --- exhaust (behind everything) ---------------------------------------
  const exhaust = scene.add.container(0, 0);
  let plumeGlow: Phaser.GameObjects.Image | null = null;
  let flame: Phaser.GameObjects.Graphics | null = null;
  if (options.exhaust ?? true) {
    plumeGlow = scene.add
      .image(0, 236, TEX.glow)
      .setDisplaySize(250, 340)
      .setAlpha(0.32)
      .setBlendMode(Phaser.BlendModes.ADD);
    exhaust.add(plumeGlow);
    // Built as a body profile, not a hand-listed pentagon: profilePolygon
    // always yields a simple left/right outline, so the fill can never
    // self-intersect into the two-streak shape a concave point list gives.
    flame = scene.add.graphics();
    exhaust.add(flame);
    scene.tweens.add({
      targets: flame,
      scaleY: { from: 0.9, to: 1.08 },
      alpha: { from: 0.85, to: 1 },
      duration: reducedMotion ? 1400 : 700,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }
  rig.add(exhaust);

  /** The plume burns the SHIP's light, so it repaints when the livery does. */
  const paintExhaust = (): void => {
    plumeGlow?.setTint(hexToNum(skin.lens));
    if (flame === null) return;
    const plume = (w: number, len: number): Pt[] =>
      profilePolygon(
        NOZZLE_BOTTOM - 6,
        NOZZLE_BOTTOM + len,
        (t) => w * (1 - t) ** 0.75,
        16,
      );
    flame.clear();
    flame.fillStyle(hexToNum(skin.lens), 0.9);
    fillShape(flame, plume(34, 152));
    // Warm, not near-white: an almost-white core vanishes against a light
    // background (and against the transparent reference-compare render), which
    // leaves only the plume's two gold edges and reads as a broken V.
    flame.fillStyle(hexToNum(mixHex(skin.lens, skin.lensHot, 0.7)), 0.97);
    fillShape(flame, plume(17, 98));
  };

  // --- fins (behind the hull) --------------------------------------------
  const fins = scene.add.graphics();
  rig.add(fins);

  // --- engine ------------------------------------------------------------
  const engine = scene.add.graphics();
  rig.add(engine);
  drawEngine(engine);

  // --- hull --------------------------------------------------------------
  const hullG = scene.add.graphics();
  rig.add(hullG);

  // --- porthole ----------------------------------------------------------
  const porthole = scene.add.graphics();
  rig.add(porthole);

  // --- centre fin (over hull and nozzle, as in the reference) ------------
  const centreFin = scene.add.graphics();
  rig.add(centreFin);

  if (options.shipName !== undefined && options.shipName.length > 0) {
    // Dynamic only (AC-24.3). Small, on the flank, never baked into the art.
    rig.add(
      scene.add
        .text(0, 58, options.shipName, {
          fontFamily: '"Avenir Next","Nunito","Trebuchet MS",system-ui,sans-serif',
          fontSize: "26px",
          color: mixHex(METAL_DARK, HULL_CREAM, 0.2),
        })
        .setOrigin(0.5),
    );
  }

  // --- emitter: fixed mount, then the pivoting yoke + head ---------------
  const mountBase = scene.add.graphics();
  rig.add(mountBase);
  drawMountBase(mountBase);

  const emitterMount = scene.add.container(PIVOT.x, PIVOT.y);
  rig.add(emitterMount);

  let shaft: Phaser.GameObjects.Graphics | null = null;
  if (options.beam ?? true) {
    shaft = scene.add.graphics();
    shaft.setBlendMode(Phaser.BlendModes.ADD);
    emitterMount.add(shaft);
  }

  /** The idle light shaft, in the lens's own colour. */
  const paintShaft = (): void => {
    if (shaft === null) return;
    shaft.clear();
    shaft.fillStyle(hexToNum(skin.lens), 0.14);
    fillShape(shaft, [
      { x: -7, y: LENS_LOCAL.y },
      { x: 7, y: LENS_LOCAL.y },
      { x: 20, y: LENS_LOCAL.y - 1000 },
      { x: -20, y: LENS_LOCAL.y - 1000 },
    ]);
    shaft.fillStyle(hexToNum(skin.lensHot), 0.2);
    fillShape(shaft, [
      { x: -2.5, y: LENS_LOCAL.y },
      { x: 2.5, y: LENS_LOCAL.y },
      { x: 7, y: LENS_LOCAL.y - 1000 },
      { x: -7, y: LENS_LOCAL.y - 1000 },
    ]);
  };

  const yoke = scene.add.graphics();
  emitterMount.add(yoke);
  drawYokeAndHousing(yoke);

  const lensGlow = scene.add
    .image(LENS_LOCAL.x, LENS_LOCAL.y, TEX.glow)
    .setDisplaySize(LENS_R * 4, LENS_R * 4)
    .setAlpha(0.34)
    .setBlendMode(Phaser.BlendModes.ADD);
  emitterMount.add(lensGlow);

  const head = scene.add.graphics();
  emitterMount.add(head);

  const iris = scene.add.graphics();
  emitterMount.add(iris);

  // The lens breathes. Under reduced motion it breathes more slowly; a dead
  // lamp on the title screen reads as a broken build (D41 keeps ambient life).
  scene.tweens.add({
    targets: lensGlow,
    alpha: { from: 0.24, to: 0.44 },
    duration: reducedMotion ? 3600 : 1800,
    yoyo: true,
    repeat: -1,
    ease: "Sine.easeInOut",
  });

  if (options.idleBob ?? true) {
    // Art direction section 5: gentle 2 px bob on a 3 s sine.
    scene.tweens.add({
      targets: rig,
      y: { from: y - 2, to: y + 2 },
      duration: reducedMotion ? 3000 : 1500,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  let irisOpen = options.iris ?? 0.72;

  const repaint = (): void => {
    skin = skinFor(colorway, livery);
    lensGlow.setTint(hexToNum(skin.lens));
    drawFins(fins, skin.stripe);
    drawHull(hullG, skin);
    drawPorthole(porthole, skin);
    drawCentreFin(centreFin, skin.stripe);
    drawHead(head, skin);
    drawIris(iris, irisOpen);
    paintShaft();
    paintExhaust();
  };
  repaint();

  const rigScale = (): number => scale;

  return {
    container: rig,
    emitterMount,
    iris,
    exhaust,

    beamOrigin(): { x: number; y: number } {
      const cos = Math.cos(emitterMount.rotation);
      const sin = Math.sin(emitterMount.rotation);
      const lx = LENS_LOCAL.x * cos - LENS_LOCAL.y * sin + PIVOT.x;
      const ly = LENS_LOCAL.x * sin + LENS_LOCAL.y * cos + PIVOT.y;
      return { x: rig.x + lx * rigScale(), y: rig.y + ly * rigScale() };
    },

    aimAt(worldX: number, worldY: number): void {
      const px = rig.x + PIVOT.x * rigScale();
      const py = rig.y + PIVOT.y * rigScale();
      // 0 rotation points straight up, so measure from -90 degrees.
      const target = Phaser.Math.Clamp(
        Math.atan2(worldX - px, py - worldY),
        -AIM_LIMIT,
        AIM_LIMIT,
      );
      scene.tweens.add({
        targets: emitterMount,
        rotation: target,
        duration: 180,
        ease: "Cubic.easeOut",
      });
    },

    setIris(open: number): void {
      irisOpen = Phaser.Math.Clamp(open, 0, 1);
      drawIris(iris, irisOpen);
    },

    setColorway(next: LanternColorway): void {
      colorway = next;
      repaint();
    },

    setLivery(next: LanternLivery | undefined): void {
      livery = next;
      repaint();
    },

    destroy(): void {
      scene.tweens.killTweensOf(rig);
      scene.tweens.killTweensOf(lensGlow);
      rig.destroy(true);
    },
  };
}

// ---------------------------------------------------------------------------
// The parts
// ---------------------------------------------------------------------------

/**
 * Right-hand fin outline; the left is this mirrored.
 *
 * Broad and softly curved, attached at porthole height and emerging from behind
 * the hull just below the porthole centre, with a ROUNDED outer edge and tip.
 * A fin that tapers to a point reads as a dart; the reference ship is friendly.
 */
const FIN_POINTS: readonly Pt[] = [
  { x: 42, y: -16 },
  { x: 74, y: 12 },
  { x: 91, y: 58 },
  { x: 108, y: 106 },
  { x: FIN_TIP.x, y: FIN_TIP.y },
  { x: 129, y: 173 },
  { x: 104, y: NOZZLE_BOTTOM },
  { x: 81, y: 172 },
  { x: 62, y: 158 },
  { x: 51, y: 134 },
  { x: 44, y: 92 },
  { x: 41, y: 30 },
];

/**
 * Half the drawn span, design units: the fin outline's widest point.
 *
 * Exported because a caller with a PIXEL budget for the ship's width - the
 * flight screen reserves `SHIP_HALF_WIDTH_PX` so it knows which spawn columns
 * would drop a rock on the pilot - has to derive its scale FROM the geometry
 * rather than pick one and then hope. `scale = halfWidthPx /
 * LANTERN_DESIGN_HALF_WIDTH` is the only expression that keeps the drawn
 * silhouette and the gameplay constant the same object; a literal here would
 * drift the moment a fin moved, silently, in the direction of rocks landing on
 * a ship that is wider than the game thinks it is.
 *
 * DERIVED, not written down: `smoothPolygon` interpolates between the points
 * and never overshoots them, so the widest POINT is the widest drawn x.
 */
export const LANTERN_DESIGN_HALF_WIDTH = FIN_POINTS.reduce(
  (max, p) => Math.max(max, Math.abs(p.x)),
  0,
);

function drawFins(g: Phaser.GameObjects.Graphics, stripe: string): void {
  g.clear();
  const right = smoothPolygon(FIN_POINTS, 8);
  const left = right.map((p) => ({ x: -p.x, y: p.y }));

  // Both fins carry the same flat colour, as on the reference sheet. Depth
  // here comes from the rim highlight below, not from tinting one side.
  g.fillStyle(hexToNum(stripe), 1);
  fillShape(g, left);
  fillShape(g, right);
  // Rim highlight on the lit side of each fin: one offset shape, 1 value step.
  g.fillStyle(hexToNum(mixHex(stripe, "#FFFFFF", 0.3)), 0.32);
  fillShape(g, right.map((p) => ({ x: p.x * 0.96 - 3, y: p.y * 0.98 - 3 })));

  // Fin star (reference: cream, right fin only).
  g.fillStyle(hexToNum(HULL_LIGHT), 0.95);
  fillShape(g, starPoints(92, 132, 16, 6.4));
}

function drawHull(g: Phaser.GameObjects.Graphics, skin: LanternSkin): void {
  const stripe = skin.stripe;
  g.clear();
  const body = profilePolygon(Y_TOP, Y_BOT, hull, 56);

  // Rim highlight: a slightly larger, darker silhouette behind the hull, so the
  // capsule has an edge without a drawn shadow.
  g.fillStyle(hexToNum(skin.hullShade), 1);
  fillShape(g, body.map((p) => ({ x: p.x * 1.03, y: p.y * 1.01 })));
  g.fillStyle(hexToNum(skin.hull), 1);
  fillShape(g, body);

  // Form shading: one light lens left, one shade lens right. No drawn shadows.
  g.fillStyle(hexToNum(skin.hullLight), 0.55);
  g.fillEllipse(-26, -12, 38, 196);
  g.fillStyle(hexToNum(skin.hullShade), 0.42);
  g.fillEllipse(50, 0, 24, 190);

  // Livery. The bands ARE hull slices, so they are clipped to the capsule
  // exactly and curve with it - the reference's thin shoulder band plus one
  // thick band above the porthole.
  g.fillStyle(hexToNum(mixHex(stripe, METAL_DARK, 0.12)), 1);
  fillShape(g, profileBand(Y_TOP, Y_BOT, hull, BAND_THIN[0], BAND_THIN[1]));
  g.fillStyle(hexToNum(stripe), 1);
  fillShape(g, profileBand(Y_TOP, Y_BOT, hull, BAND_THICK[0], BAND_THICK[1]));
  g.fillStyle(hexToNum(mixHex(stripe, "#FFFFFF", 0.35)), 0.3);
  fillShape(
    g,
    profileBand(Y_TOP, Y_BOT, hull, BAND_THICK[0], BAND_THICK[1]).map((p) => ({
      x: p.x * 0.44 - 24,
      y: p.y,
    })),
  );
}

function drawPorthole(g: Phaser.GameObjects.Graphics, skin: LanternSkin): void {
  g.clear();
  g.fillStyle(hexToNum(METAL_LIGHT), 1);
  g.fillCircle(0, PORTHOLE_Y, PORTHOLE_R);
  g.fillStyle(hexToNum(METAL_RIM), 1);
  g.fillCircle(-2, PORTHOLE_Y - 2, PORTHOLE_R - 3);
  g.fillStyle(hexToNum(METAL), 1);
  g.fillCircle(0, PORTHOLE_Y, PORTHOLE_R - 6);
  g.fillStyle(hexToNum(skin.glassDeep), 1);
  g.fillCircle(0, PORTHOLE_Y, PORTHOLE_R - 10);
  g.fillStyle(hexToNum(skin.glass), 1);
  g.fillCircle(0, PORTHOLE_Y - 3, PORTHOLE_R - 12);
  // Two speculars: the big crescent and the small dot. Straight off the ref.
  g.fillStyle(0xffffff, 0.85);
  g.fillEllipse(-12, PORTHOLE_Y - 14, 16, 24);
  g.fillStyle(0xffffff, 0.6);
  g.fillCircle(-21, PORTHOLE_Y - 1, 4.5);
}

function drawCentreFin(g: Phaser.GameObjects.Graphics, stripe: string): void {
  g.clear();
  const top = 44;
  const bottom = NOZZLE_BOTTOM - 4;
  const blade = (t: number): number =>
    12 * Math.sin(Math.PI * Math.min(1, Math.max(0, t))) ** 0.7;
  g.fillStyle(hexToNum(mixHex(stripe, METAL_DARK, 0.18)), 1);
  fillShape(g, profilePolygon(top, bottom, blade, 26));
  g.fillStyle(hexToNum(stripe), 1);
  fillShape(g, profilePolygon(top + 2, bottom - 3, (t) => blade(t) * 0.88, 26));
  g.fillStyle(hexToNum(mixHex(stripe, "#FFFFFF", 0.4)), 0.45);
  fillShape(
    g,
    profilePolygon(top + 10, bottom - 22, (t) => blade(t) * 0.34, 20).map((p) => ({
      x: p.x - 3,
      y: p.y,
    })),
  );
}

/**
 * Engine: a compact ribbed cylinder tucked between the fins, not a wide grille.
 * Narrower than the hull's base so the fins read as the widest thing down there.
 */
function drawEngine(g: Phaser.GameObjects.Graphics): void {
  g.clear();
  const top = Y_BOT;
  const mid = top + 22;
  const bottom = NOZZLE_BOTTOM;

  // Ribbed collar.
  g.fillStyle(hexToNum(METAL_DARK), 1);
  g.fillRoundedRect(-38, top - 4, 76, 26, 7);
  g.fillStyle(hexToNum(METAL), 1);
  for (let i = 0; i < 4; i++) g.fillRect(-35 + i * 19, top, 11, 18);

  // Bell: short, barely flared.
  g.fillStyle(hexToNum(METAL_DARK), 1);
  fillShape(g, [
    { x: -38, y: mid - 4 },
    { x: 38, y: mid - 4 },
    { x: 45, y: bottom },
    { x: -45, y: bottom },
  ]);
  g.fillStyle(hexToNum(METAL_LIGHT), 1);
  fillShape(g, [
    { x: -34, y: mid - 1 },
    { x: 34, y: mid - 1 },
    { x: 40, y: bottom - 3 },
    { x: -40, y: bottom - 3 },
  ]);
  g.fillStyle(hexToNum(METAL), 0.85);
  for (const sx of [-16, 0, 16]) {
    fillShape(g, [
      { x: sx - 2.2, y: mid - 1 },
      { x: sx + 2.2, y: mid - 1 },
      { x: sx * 1.2 + 2.6, y: bottom - 3 },
      { x: sx * 1.2 - 2.6, y: bottom - 3 },
    ]);
  }
  g.fillStyle(hexToNum(METAL_DARK), 0.9);
  g.fillEllipse(0, bottom - 2, 80, 13);
}

/**
 * The fixed part of the emitter: a small collar clamped onto the NOSECONE.
 *
 * It mounts on the nose, it does not replace it: the cream shoulder below it
 * stays visible, which is what keeps the ship reading as a rocket.
 */
function drawMountBase(g: Phaser.GameObjects.Graphics): void {
  g.clear();
  g.fillStyle(hexToNum(METAL_DARK), 1);
  fillShape(
    g,
    smoothPolygon(
      [
        { x: -30, y: -136 },
        { x: -28, y: -157 },
        { x: -22, y: -170 },
        { x: 22, y: -170 },
        { x: 28, y: -157 },
        { x: 30, y: -136 },
      ],
      6,
    ),
  );
  // Warm machined highlight along the top of the collar.
  g.fillStyle(hexToNum(mixHex(METAL_LIGHT, BRASS, 0.3)), 0.85);
  g.fillRoundedRect(-23, -169, 46, 6, 3);
  // The pivot boss: a visible bearing, so the head reads as mounted, not glued.
  g.fillStyle(hexToNum(METAL), 1);
  g.fillCircle(-11, -150, 7.5);
  g.fillStyle(hexToNum(METAL_LIGHT), 1);
  g.fillCircle(-11, -151, 5);
  g.fillStyle(hexToNum(METAL_DARK), 1);
  g.fillCircle(-11, -150, 2.6);
}

/**
 * Yoke arms and the finned heat housing (AC-24.1).
 * Local to `emitterMount`, i.e. relative to PIVOT.
 */
function drawYokeAndHousing(g: Phaser.GameObjects.Graphics): void {
  g.clear();

  // A U-shaped CRADLE: one band sweeping under the head and up both sides,
  // plus a short post each side down to the collar. Two separate thin posts
  // read as clutter; a cradle reads as a mount holding an instrument.
  const cradleR = LENS_R + 6;
  for (const [width, colour, alpha] of [
    [12, METAL_DARK, 1],
    [4, mixHex(METAL_LIGHT, BRASS, 0.25), 0.8],
  ] as const) {
    g.lineStyle(width, hexToNum(colour), alpha);
    g.beginPath();
    g.arc(
      LENS_LOCAL.x,
      LENS_LOCAL.y,
      cradleR,
      Phaser.Math.DegToRad(12),
      Phaser.Math.DegToRad(168),
      false,
    );
    g.strokePath();
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(side * 20, 8);
      g.lineTo(side * 38, -14);
      g.lineTo(side * (cradleR - 10), LENS_LOCAL.y + 14);
      g.strokePath();
    }
  }

  // Finned heat housing between collar and head.
  g.fillStyle(hexToNum(METAL_DARK), 1);
  g.fillRoundedRect(-23, -16, 46, 28, 7);
  g.fillStyle(hexToNum(METAL), 1);
  for (let i = 0; i < 4; i++) g.fillRect(-19 + i * 11, -13, 5, 22);
  g.fillStyle(hexToNum(mixHex(METAL_LIGHT, BRASS, 0.2)), 0.6);
  g.fillRoundedRect(-23, -16, 46, 4, 2);
}

/**
 * Lens head: bezel, THREE concentric focusing rings, then the lens (D89).
 *
 * The rings alternate value (light / dark / brass) so all three are legible at
 * game size; three rings of the same grey read as one thick bezel.
 */
function drawHead(g: Phaser.GameObjects.Graphics, skin: LanternSkin): void {
  g.clear();
  const { x: cx, y: cy } = LENS_LOCAL;

  // Bezel.
  g.fillStyle(hexToNum(METAL_DARK), 1);
  g.fillCircle(cx, cy, LENS_R);
  g.fillStyle(hexToNum(METAL), 1);
  g.fillCircle(cx, cy, LENS_R - 2.5);
  // Ring 1 of 3 - bright machined collar.
  g.fillStyle(hexToNum(METAL_LIGHT), 1);
  g.fillCircle(cx, cy, LENS_R - 6);
  // Ring 2 of 3 - the dark seat between the collars.
  g.fillStyle(hexToNum(METAL_DARK), 1);
  g.fillCircle(cx, cy, LENS_R - 10);
  // Ring 3 of 3 - the brass focusing ring the iris rides in.
  g.fillStyle(hexToNum(BRASS), 1);
  g.fillCircle(cx, cy, LENS_R - 13);
  g.fillStyle(hexToNum(mixHex(BRASS, "#FFFFFF", 0.35)), 1);
  g.fillCircle(cx, cy, LENS_R - 15);
  // The lens.
  g.fillStyle(hexToNum(skin.lens), 1);
  g.fillCircle(cx, cy, LENS_R - 17);
  g.fillStyle(hexToNum(skin.lensHot), 1);
  g.fillCircle(cx - 1, cy - 1.5, LENS_R - 25);
  // Housing specular on the lit side.
  g.lineStyle(3, hexToNum(METAL_RIM), 0.75);
  g.beginPath();
  g.arc(cx, cy, LENS_R - 1.5, Phaser.Math.DegToRad(175), Phaser.Math.DegToRad(295), false);
  g.strokePath();
}

/**
 * Six-blade iris over the lens (D89, AC-24.1).
 *
 * `open` is a 0..1 drawable STATE, not an animation: the Flight lane tweens it
 * to 1 on a blast and back, and nothing here needs to know what a blast is.
 * 0 = nearly shut (a warm slit), 1 = fully retracted (the lens wide open).
 * The blades are drawn with a lit leading edge so the aperture is legible at
 * game size rather than reading as one dark disc.
 */
function drawIris(g: Phaser.GameObjects.Graphics, open: number): void {
  g.clear();
  const { x: cx, y: cy } = LENS_LOCAL;
  const outer = LENS_R - 16;
  const k = Phaser.Math.Clamp(open, 0, 1);
  const inner = outer * (0.88 - 0.76 * k);
  if (inner >= outer - 0.4) return;
  const twist = 0.42;
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2;
    const a1 = ((i + 1) / 6) * Math.PI * 2;
    const blade: Pt[] = [
      { x: cx + Math.cos(a0) * outer, y: cy + Math.sin(a0) * outer },
      { x: cx + Math.cos(a1) * outer, y: cy + Math.sin(a1) * outer },
      { x: cx + Math.cos(a1 - twist) * inner, y: cy + Math.sin(a1 - twist) * inner },
      { x: cx + Math.cos(a0 - twist) * inner, y: cy + Math.sin(a0 - twist) * inner },
    ];
    // Translucent body: the blades sit IN FRONT of a lit lens, so light shows
    // through them. Opaque blades read as a nut, not an aperture.
    g.fillStyle(hexToNum(mixHex(BRASS, METAL_DARK, 0.4)), 0.45);
    fillShape(g, blade);
    // Lit leading edge, so six blades are countable.
    const a = blade[3] as Pt;
    const b = blade[2] as Pt;
    g.lineStyle(1.6, hexToNum(mixHex(BRASS, "#FFFFFF", 0.55)), 0.9);
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.strokePath();
  }
}
