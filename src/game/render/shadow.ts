import Phaser from "phaser";

/**
 * Shadow, the navigation robot (D66, D91, art-direction.md section 6).
 *
 * Drawn entirely in vector (D83): Phaser Graphics only, no raster, no atlas.
 * `design-reference/refs/shadow-sheet.png` is LOOKED AT while drawing and is
 * never loaded by the game.
 *
 * WHAT THE SHEET FIXES, and therefore what this file must reproduce:
 *   - a round, slightly squashed CHARCOAL body with a soft top-lit crown and a
 *     darker underside, plus two faint panel seams on the crown;
 *   - a large rounded-square face plate with a thick CREAM rim and a deep navy
 *     screen behind it;
 *   - glowing PALE-BLUE eyes on that screen, and a pale-blue antenna tip;
 *   - two side pods ("ears") with a pale-blue ring;
 *   - two stubby dark paddle ARMS hanging at the flanks;
 *   - a ROUND FLANK PORT low on the body, ringed in pale blue (D91);
 *   - a HOVER GLOW: a bright ellipse under the belly and a soft wide one below.
 *
 * The sheet's bottom row is a colourway exploration (cream, red, teal). D91
 * says those are NOT used - Shadow has one look - so exactly one palette is
 * defined here and nothing takes a colour argument.
 *
 * EXPRESSIONS (art-direction section 6): eye-shape changes plus a 1-2 px
 * face-plate glow pulse. Nothing else about the face moves; that constraint is
 * what keeps six poses reading as one character.
 *
 * Shadow never says anything here. Every line he speaks is content, loaded
 * from src/content/<lang>/ by the scene (AC-25.3, D31).
 */

/** AC-25.2: the six poses, and the only six. */
export type ShadowPose =
  | "idle"
  | "pointing"
  | "cheering"
  | "worried"
  | "asleep"
  | "saluting";

export const SHADOW_POSES: readonly ShadowPose[] = [
  "idle",
  "pointing",
  "cheering",
  "worried",
  "asleep",
  "saluting",
] as const;

export function isShadowPose(value: string): value is ShadowPose {
  return (SHADOW_POSES as readonly string[]).includes(value);
}

/**
 * Shadow's one look (D91). Deliberately a frozen module constant and not a
 * parameter: a `colorway` argument is exactly how the bottom row of the sheet
 * would creep back in.
 */
export const SHADOW_COLORS = Object.freeze({
  bodyTop: 0x515a6b,
  body: 0x373d4a,
  bodyLow: 0x1c2027,
  seam: 0x454d5a,
  specular: 0x6d7789,
  rim: 0xefe5d0,
  rimShade: 0xd6c9ae,
  screen: 0x16213c,
  screenSheen: 0x2c4272,
  glow: 0x9fe4ff,
  glowBright: 0xeaf9ff,
  port: 0x6fd0f5,
});

/** Nominal body radius in local units. Scale the container, not these numbers. */
export const SHADOW_RADIUS = 64;

/** Full drawn height (hover shadow to antenna tip) at scale 1. */
export const SHADOW_HEIGHT = SHADOW_RADIUS * 2.9;

export interface ShadowOptions {
  /** Uniform scale applied to the returned container. */
  readonly scale?: number;
  /** D41 / AC-19.3: damps the hover bob; the glow pulse and drift are kept. */
  readonly reducedMotion?: boolean;
  /** 1 faces right (default), -1 mirrors him. */
  readonly facing?: 1 | -1;
  /** Phaser depth for the returned container. */
  readonly depth?: number;
}

export interface ShadowFigure {
  readonly root: Phaser.GameObjects.Container;
  /** The pose currently drawn. */
  pose: ShadowPose;
  /** Redraw in a different pose. Cheap: one Graphics clear + refill. */
  setPose(pose: ShadowPose): void;
  /**
   * Per-frame ambient life: the face-plate glow pulse (1-2 px, section 6) and
   * a gentle hover bob. Called with the scene clock; no tween is created, so
   * there is no easing config to audit (AC-22.5) and no timer to leak.
   */
  update(timeMs: number): void;
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Pose table. Everything that changes between poses lives here, so a pose is
// data and `drawShadow` has no per-pose branches in its body.
// ---------------------------------------------------------------------------

type EyeShape = "capsule" | "arcHappy" | "arcClosed" | "small" | "wink";

interface ArmPose {
  /**
   * Degrees swung from straight down, measured OUTWARD from the body on
   * whichever side the arm is. 0 hangs straight, 90 points sideways, 140 is
   * thrown up and out. Negative tucks the paddle in front of the belly.
   */
  readonly angleDeg: number;
  /** Distance of the arm's root from the body centre, in radii. */
  readonly reach: number;
  /** Vertical offset of the arm's root, in radii. */
  readonly lift: number;
}

interface PoseSpec {
  readonly eyes: EyeShape;
  readonly leftArm: ArmPose;
  readonly rightArm: ArmPose;
  /** Body tilt, degrees. */
  readonly tiltDeg: number;
  /** Vertical body offset in radii; asleep sinks toward the hover glow. */
  readonly sink: number;
  /** Hover-glow brightness multiplier. */
  readonly hover: number;
  /** Excitement ticks around the crown (the sheet draws these on cheering). */
  readonly sparks: number;
  /** Sleep marks. */
  readonly zzz: boolean;
  /** Bob amplitude in local units; the pulse is separate and always on. */
  readonly bob: number;
}

const HANG: ArmPose = { angleDeg: 15, reach: 0.78, lift: 0.5 };

const POSES: Readonly<Record<ShadowPose, PoseSpec>> = {
  idle: {
    eyes: "capsule",
    leftArm: HANG,
    rightArm: HANG,
    tiltDeg: 0,
    sink: 0,
    hover: 1,
    sparks: 0,
    zzz: false,
    bob: 3,
  },
  pointing: {
    eyes: "arcHappy",
    leftArm: HANG,
    rightArm: { angleDeg: 124, reach: 0.86, lift: 0.14 },
    tiltDeg: -4,
    sink: -0.02,
    hover: 1.05,
    sparks: 0,
    zzz: false,
    bob: 3,
  },
  cheering: {
    eyes: "arcHappy",
    leftArm: { angleDeg: 138, reach: 0.84, lift: 0.06 },
    rightArm: { angleDeg: 138, reach: 0.84, lift: 0.06 },
    tiltDeg: 0,
    sink: -0.08,
    hover: 1.25,
    sparks: 6,
    zzz: false,
    bob: 5,
  },
  worried: {
    // Paddles tucked in front of the belly: the sheet's shy pose.
    eyes: "small",
    leftArm: { angleDeg: -26, reach: 0.52, lift: 0.46 },
    rightArm: { angleDeg: -26, reach: 0.52, lift: 0.46 },
    tiltDeg: 3,
    sink: 0.06,
    hover: 0.8,
    sparks: 0,
    zzz: false,
    bob: 2,
  },
  asleep: {
    eyes: "arcClosed",
    leftArm: { angleDeg: 14, reach: 0.76, lift: 0.54 },
    rightArm: { angleDeg: 14, reach: 0.76, lift: 0.54 },
    tiltDeg: -7,
    sink: 0.16,
    hover: 0.55,
    sparks: 0,
    zzz: true,
    bob: 2,
  },
  saluting: {
    // One paddle up at the face rim, the other hanging.
    eyes: "wink",
    leftArm: HANG,
    rightArm: { angleDeg: 150, reach: 0.5, lift: -0.1 },
    tiltDeg: -2,
    sink: -0.02,
    hover: 1.1,
    sparks: 0,
    zzz: false,
    bob: 3,
  },
};

export function shadowPoseSpec(pose: ShadowPose): PoseSpec {
  return POSES[pose];
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

const R = SHADOW_RADIUS;
const DEG = Math.PI / 180;

/** Face plate geometry, shared by the plate, its rim glow and the eyes. */
const PLATE = {
  cx: 0,
  cy: -0.12 * R,
  w: 1.5 * R,
  h: 1.2 * R,
  radius: 0.4 * R,
  rimThickness: 0.14 * R,
};

const EYE_DX = 0.33 * R;
const EYE_CY = PLATE.cy - 0.01 * R;

function drawHover(g: Phaser.GameObjects.Graphics, spec: PoseSpec): void {
  const y = R * (1.0 + spec.sink);
  // Two separate things, as the sheet draws them: a soft cast shadow well
  // below, and a bright cushion of light directly under the belly.
  g.fillStyle(SHADOW_COLORS.glow, 0.2 * spec.hover);
  g.fillEllipse(0, y + 0.42 * R, 2.3 * R, 0.36 * R);
  g.fillStyle(SHADOW_COLORS.glow, 0.46 * spec.hover);
  g.fillEllipse(0, y + 0.08 * R, 1.5 * R, 0.3 * R);
  g.fillStyle(SHADOW_COLORS.glowBright, 0.78 * spec.hover);
  g.fillEllipse(0, y - 0.04 * R, 1.0 * R, 0.2 * R);
}

function drawArm(g: Phaser.GameObjects.Graphics, spec: ArmPose, side: 1 | -1): void {
  const a = spec.angleDeg * DEG;
  // Root sits on the flank; the paddle swings out from straight down by `a`,
  // mirrored by `side` so one table entry serves both arms.
  const rootX = side * spec.reach * R;
  const rootY = spec.lift * R;
  const len = 0.6 * R;
  const tipX = rootX + Math.sin(a) * len * side;
  const tipY = rootY + Math.cos(a) * len;
  const midX = (rootX + tipX) / 2;
  const midY = (rootY + tipY) / 2;
  const angle = Math.atan2(tipY - rootY, tipX - rootX);

  g.save();
  g.translateCanvas(midX, midY);
  g.rotateCanvas(angle);
  g.fillStyle(SHADOW_COLORS.bodyLow, 1);
  g.fillEllipse(0, 0, len + 0.32 * R, 0.54 * R);
  g.fillStyle(SHADOW_COLORS.body, 1);
  g.fillEllipse(-0.02 * R, -0.03 * R, len + 0.24 * R, 0.47 * R);
  // The sheet gives every arm one pale streak along its top edge.
  g.fillStyle(SHADOW_COLORS.specular, 0.5);
  g.fillEllipse(0.07 * R, -0.12 * R, len * 0.52, 0.1 * R);
  g.restore();
}

function drawEarPod(
  g: Phaser.GameObjects.Graphics,
  side: 1 | -1,
  spec: PoseSpec,
): void {
  const x = side * 1.0 * R;
  const y = spec.sink * R - 0.02 * R;
  g.fillStyle(SHADOW_COLORS.bodyLow, 1);
  g.fillEllipse(x, y, 0.6 * R, 0.8 * R);
  g.fillStyle(SHADOW_COLORS.body, 1);
  g.fillEllipse(x - side * 0.03 * R, y - 0.03 * R, 0.5 * R, 0.68 * R);
  g.fillStyle(SHADOW_COLORS.specular, 0.28);
  g.fillEllipse(x - side * 0.06 * R, y - 0.18 * R, 0.2 * R, 0.14 * R);
  g.lineStyle(Math.max(2.5, 0.055 * R), SHADOW_COLORS.port, 0.95);
  g.strokeCircle(x, y, 0.19 * R);
  g.fillStyle(SHADOW_COLORS.port, 0.32);
  g.fillCircle(x, y, 0.16 * R);
}

function drawBody(g: Phaser.GameObjects.Graphics, spec: PoseSpec): void {
  const cy = spec.sink * R;
  // Base sphere, slightly squashed the way the sheet draws it.
  g.fillStyle(SHADOW_COLORS.bodyLow, 1);
  g.fillEllipse(0, cy + 0.06 * R, 2.0 * R, 1.92 * R);
  g.fillStyle(SHADOW_COLORS.body, 1);
  g.fillEllipse(0, cy, 1.96 * R, 1.86 * R);
  // Top-lit crown, and a rim of light along the upper-left edge: the sheet's
  // body is charcoal that CATCHES light, not a black disc.
  g.fillStyle(SHADOW_COLORS.bodyTop, 0.9);
  g.fillEllipse(0, cy - 0.36 * R, 1.78 * R, 1.1 * R);
  g.fillStyle(SHADOW_COLORS.seam, 0.5);
  g.fillEllipse(0, cy - 0.5 * R, 1.5 * R, 0.72 * R);
  g.fillStyle(SHADOW_COLORS.body, 1);
  g.fillEllipse(0, cy - 0.3 * R, 1.62 * R, 0.98 * R);
  // Two faint crown seams.
  g.lineStyle(Math.max(1.5, 0.028 * R), SHADOW_COLORS.seam, 0.7);
  g.beginPath();
  g.arc(0, cy + 0.25 * R, 0.86 * R, 232 * DEG, 274 * DEG, false);
  g.strokePath();
  g.beginPath();
  g.arc(0, cy + 0.25 * R, 0.86 * R, 266 * DEG, 308 * DEG, false);
  g.strokePath();
  // Specular bloom, up-left, matching the sheet's light direction.
  g.fillStyle(SHADOW_COLORS.specular, 0.42);
  g.fillEllipse(-0.44 * R, cy - 0.62 * R, 0.56 * R, 0.26 * R);
  // Rim light on the lit side: one offset stroke, 10-15% lighter
  // (art-direction section 2). It is what gives the silhouette volume when
  // the whole figure is a dark shape on a bright sky.
  g.lineStyle(Math.max(2, 0.04 * R), SHADOW_COLORS.specular, 0.55);
  g.beginPath();
  g.arc(0, cy, 0.96 * R, 186 * DEG, 316 * DEG, false);
  g.strokePath();
}

function drawFlankPort(g: Phaser.GameObjects.Graphics, spec: PoseSpec): void {
  // D91's round flank port: low on the belly, ringed in pale blue.
  const y = spec.sink * R + 0.62 * R;
  g.fillStyle(SHADOW_COLORS.bodyLow, 1);
  g.fillCircle(0, y, 0.2 * R);
  g.lineStyle(Math.max(2.5, 0.055 * R), SHADOW_COLORS.port, 1);
  g.strokeCircle(0, y, 0.16 * R);
  g.fillStyle(SHADOW_COLORS.port, 0.25);
  g.fillCircle(0, y, 0.135 * R);
}

function drawAntenna(g: Phaser.GameObjects.Graphics, spec: PoseSpec): void {
  const baseY = spec.sink * R - 0.9 * R;
  const tipX = 0.11 * R;
  const tipY = spec.sink * R - 1.46 * R;
  g.lineStyle(Math.max(3, 0.07 * R), SHADOW_COLORS.body, 1);
  g.beginPath();
  g.moveTo(0, baseY);
  // Quadratic bend, sampled: the sheet's antenna leans, it is not a spike.
  for (let i = 1; i <= 8; i += 1) {
    const t = i / 8;
    const cx = -0.03 * R;
    const cy = (baseY + tipY) / 2;
    const x = (1 - t) * (1 - t) * 0 + 2 * (1 - t) * t * cx + t * t * tipX;
    const y = (1 - t) * (1 - t) * baseY + 2 * (1 - t) * t * cy + t * t * tipY;
    g.lineTo(x, y);
  }
  g.strokePath();
  g.fillStyle(SHADOW_COLORS.glow, 0.18);
  g.fillCircle(tipX, tipY, 0.36 * R);
  g.fillStyle(SHADOW_COLORS.glow, 0.4);
  g.fillCircle(tipX, tipY, 0.2 * R);
  g.fillStyle(SHADOW_COLORS.glowBright, 1);
  g.fillCircle(tipX, tipY, 0.1 * R);
}

function drawPlate(g: Phaser.GameObjects.Graphics, spec: PoseSpec): void {
  const cy = PLATE.cy + spec.sink * R;
  const x = PLATE.cx - PLATE.w / 2;
  const y = cy - PLATE.h / 2;
  // Cream rim.
  g.fillStyle(SHADOW_COLORS.rimShade, 1);
  g.fillRoundedRect(x, y + 0.03 * R, PLATE.w, PLATE.h, PLATE.radius);
  g.fillStyle(SHADOW_COLORS.rim, 1);
  g.fillRoundedRect(x, y, PLATE.w, PLATE.h, PLATE.radius);
  // Deep navy screen.
  const t = PLATE.rimThickness;
  g.fillStyle(SHADOW_COLORS.screen, 1);
  g.fillRoundedRect(
    x + t,
    y + t,
    PLATE.w - 2 * t,
    PLATE.h - 2 * t,
    PLATE.radius - t * 0.6,
  );
  // Screen sheen across the top third.
  g.fillStyle(SHADOW_COLORS.screenSheen, 0.55);
  g.fillRoundedRect(
    x + t * 1.6,
    y + t * 1.5,
    (PLATE.w - 2 * t) * 0.92,
    (PLATE.h - 2 * t) * 0.3,
    PLATE.radius * 0.5,
  );
}

/**
 * The bloom around an eye.
 *
 * It follows the eye's own shape. An earlier version used a circle wide enough
 * to cover the pill, which on the screen read as a second, larger pair of eyes
 * ghosted behind the real ones - the face looked like it had four.
 */
function eyeBloom(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  w: number,
  h: number,
): void {
  const pad = 0.05 * R;
  g.fillStyle(SHADOW_COLORS.glow, 0.16);
  g.fillRoundedRect(cx - w / 2 - pad, cy - h / 2 - pad, w + pad * 2, h + pad * 2, (w + pad * 2) / 2);
}

function drawEyes(g: Phaser.GameObjects.Graphics, spec: PoseSpec): void {
  const cy = EYE_CY + spec.sink * R;
  const stroke = Math.max(3, 0.075 * R);

  const capsule = (cx: number, h: number, w: number): void => {
    eyeBloom(g, cx, cy, w, h);
    g.fillStyle(SHADOW_COLORS.glowBright, 1);
    g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, w / 2);
  };

  const arcUp = (cx: number, w: number): void => {
    // A smiling eye: an arc whose ends lift. Centre sits BELOW the arc.
    g.lineStyle(stroke, SHADOW_COLORS.glowBright, 1);
    g.beginPath();
    g.arc(cx, cy + 0.06 * R, w * 0.5, 200 * DEG, 340 * DEG, false);
    g.strokePath();
  };

  const arcDown = (cx: number, w: number): void => {
    // A closed eye: the arc sags. Centre sits ABOVE the arc.
    g.lineStyle(stroke, SHADOW_COLORS.glow, 0.9);
    g.beginPath();
    g.arc(cx, cy - 0.08 * R, w * 0.5, 20 * DEG, 160 * DEG, false);
    g.strokePath();
  };

  switch (spec.eyes) {
    case "capsule":
      capsule(-EYE_DX, 0.62 * R, 0.3 * R);
      capsule(EYE_DX, 0.62 * R, 0.3 * R);
      break;
    case "arcHappy":
      arcUp(-EYE_DX, 0.44 * R);
      arcUp(EYE_DX, 0.44 * R);
      break;
    case "arcClosed":
      arcDown(-EYE_DX, 0.44 * R);
      arcDown(EYE_DX, 0.44 * R);
      break;
    case "small":
      capsule(-EYE_DX * 0.92, 0.34 * R, 0.26 * R);
      capsule(EYE_DX * 0.92, 0.34 * R, 0.26 * R);
      break;
    case "wink":
      capsule(-EYE_DX, 0.62 * R, 0.3 * R);
      arcUp(EYE_DX, 0.44 * R);
      break;
  }
}

function drawSparks(g: Phaser.GameObjects.Graphics, spec: PoseSpec): void {
  if (spec.sparks === 0) return;
  const cy = spec.sink * R;
  g.lineStyle(Math.max(2.5, 0.05 * R), SHADOW_COLORS.glowBright, 0.9);
  for (let i = 0; i < spec.sparks; i += 1) {
    const spread = 120 * DEG;
    const a = -90 * DEG - spread / 2 + (spread * i) / (spec.sparks - 1);
    const inner = 1.2 * R;
    const outer = 1.42 * R;
    g.beginPath();
    g.moveTo(Math.cos(a) * inner, cy + Math.sin(a) * inner);
    g.lineTo(Math.cos(a) * outer, cy + Math.sin(a) * outer);
    g.strokePath();
  }
}

function drawZzz(g: Phaser.GameObjects.Graphics, spec: PoseSpec): void {
  if (!spec.zzz) return;
  const cy = spec.sink * R;
  // Vector "z" marks: three strokes each, growing as they rise (D83 - even the
  // sleep marks are drawn, not typed, so no font and no string is involved).
  const marks = [
    { x: 0.95 * R, y: cy - 1.15 * R, s: 0.16 * R, a: 0.55 },
    { x: 1.2 * R, y: cy - 1.45 * R, s: 0.22 * R, a: 0.75 },
    { x: 1.5 * R, y: cy - 1.8 * R, s: 0.3 * R, a: 0.95 },
  ];
  for (const m of marks) {
    g.lineStyle(Math.max(2, m.s * 0.22), SHADOW_COLORS.glowBright, m.a);
    g.beginPath();
    g.moveTo(m.x - m.s / 2, m.y - m.s / 2);
    g.lineTo(m.x + m.s / 2, m.y - m.s / 2);
    g.lineTo(m.x - m.s / 2, m.y + m.s / 2);
    g.lineTo(m.x + m.s / 2, m.y + m.s / 2);
    g.strokePath();
  }
}

/**
 * Draw Shadow at (x, y) in one of the six poses.
 *
 * Returns a handle rather than a bare Container so a scene can change pose and
 * drive the glow pulse without reaching into child indices.
 */
export function drawShadow(
  scene: Phaser.Scene,
  x: number,
  y: number,
  pose: ShadowPose = "idle",
  options: ShadowOptions = {},
): ShadowFigure {
  const facing = options.facing ?? 1;
  const reducedMotion = options.reducedMotion ?? false;

  const root = scene.add.container(x, y);
  // Layer order matters: hover under the body, arms behind the belly, the face
  // plate and its glow above everything, antenna last.
  const hover = scene.add.graphics();
  const back = scene.add.graphics();
  const bodyG = scene.add.graphics();
  // A raised arm reads as a gesture only if it is in FRONT of the body; drawn
  // behind, a salute disappears into the silhouette and the pose is lost.
  const armsFront = scene.add.graphics();
  const rimGlow = scene.add.graphics();
  const plateG = scene.add.graphics();
  const eyesG = scene.add.graphics();
  const frontG = scene.add.graphics();

  root.add([hover, back, bodyG, armsFront, rimGlow, plateG, eyesG, frontG]);
  root.setScale(options.scale ?? 1);
  if (options.depth !== undefined) root.setDepth(options.depth);

  let current: ShadowPose = pose;
  let bob = POSES[pose].bob;

  const render = (next: ShadowPose): void => {
    const spec = POSES[next];
    bob = spec.bob;

    for (const g of [hover, back, bodyG, armsFront, rimGlow, plateG, eyesG, frontG]) g.clear();

    drawHover(hover, spec);

    // Anything swung past 110 degrees is a raised arm; it goes in front.
    const RAISED = 110;
    drawArm(spec.leftArm.angleDeg >= RAISED ? armsFront : back, spec.leftArm, -1);
    drawArm(spec.rightArm.angleDeg >= RAISED ? armsFront : back, spec.rightArm, 1);

    drawBody(bodyG, spec);
    // The pods sit ON the silhouette, not behind it. Drawn behind the body
    // they read as two open rings poking out - handles, not ears - because
    // only the outer crescent survives.
    drawEarPod(bodyG, -1, spec);
    drawEarPod(bodyG, 1, spec);
    drawFlankPort(bodyG, spec);

    // The pulse layer: a soft cream halo the size of the plate. `update`
    // breathes its scale by ~2 px, which is art-direction section 6's
    // "1-2 px face-plate glow pulse" and the only thing that animates here.
    rimGlow.fillStyle(SHADOW_COLORS.rim, 0.22);
    rimGlow.fillRoundedRect(
      PLATE.cx - PLATE.w / 2,
      PLATE.cy + spec.sink * R - PLATE.h / 2,
      PLATE.w,
      PLATE.h,
      PLATE.radius,
    );

    drawPlate(plateG, spec);
    drawEyes(eyesG, spec);

    drawAntenna(frontG, spec);
    drawSparks(frontG, spec);
    drawZzz(frontG, spec);

    root.setAngle(spec.tiltDeg * facing);
    root.setScale((options.scale ?? 1) * facing, options.scale ?? 1);
    current = next;
  };

  render(pose);

  const figure: ShadowFigure = {
    root,
    get pose() {
      return current;
    },
    set pose(next: ShadowPose) {
      render(next);
    },
    setPose(next: ShadowPose) {
      if (next !== current) render(next);
    },
    update(timeMs: number) {
      // Sine drift only: no tween object, so nothing here can carry an easing
      // config and AC-22.5 has nothing to find.
      const pulse = Math.sin((timeMs / 1600) * Math.PI * 2);
      // +-2 px on a plate ~83 px wide => a scale swing of about 0.024.
      rimGlow.setScale(1 + pulse * (2 / PLATE.w));
      rimGlow.setAlpha(0.55 + pulse * 0.25);
      const amplitude = reducedMotion ? bob * 0.4 : bob;
      const lift = Math.sin((timeMs / 3000) * Math.PI * 2) * amplitude;
      for (const g of [back, bodyG, armsFront, rimGlow, plateG, eyesG, frontG]) g.setY(lift);
    },
    destroy() {
      root.destroy(true);
    },
  };

  return figure;
}
