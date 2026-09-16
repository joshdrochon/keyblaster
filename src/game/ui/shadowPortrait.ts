import Phaser from "phaser";
import { EASE, INK } from "./theme.js";
import { rgb } from "./palette.js";

/**
 * Shadow, the navigation robot (D66, D91, art-direction section 6).
 *
 * WHY THIS IS HERE AND NOT IN render/. The lane brief says to import
 * `drawShadow(scene, x, y, pose)` from the render lane. At the time this lane
 * ran, `src/game/render/` contained only layers.ts and particles.ts - there is
 * no shadow module on disk - and a scene that imports a file that does not
 * exist fails `tsc` for everyone. So this is the local stand-in with the
 * brief's exact signature, per the scene brief's instruction to keep a missing
 * shared helper inside your own folder. When render/shadow.ts lands, delete
 * this file and re-point the three imports.
 *
 * AC-25.1 shape list: charcoal body, cream face rim, glowing pale-blue eyes and
 * antenna tip, stubby arms, hover glow, round flank port. AC-25.2: the six
 * poses, and NOT the reference sheet's bottom-row colourways - Shadow has one
 * look.
 */

export type ShadowPose =
  | "idle"
  | "pointing"
  | "cheering"
  | "worried"
  | "sleeping"
  | "saluting";

export const SHADOW_POSES: readonly ShadowPose[] = [
  "idle",
  "pointing",
  "cheering",
  "worried",
  "sleeping",
  "saluting",
] as const;

const CHARCOAL = "#22272E";
const CHARCOAL_DEEP = "#171B21";
const FACE_RIM = "#F0E6D2";
const EYE = "#9FD8F0";

/**
 * Draws Shadow at `size` (default 180 px tall) and returns the container. The
 * hover glow and the face-plate pulse run forever; they are the "never still"
 * rule (rubric 2) applied to a character sitting in a menu.
 */
export function drawShadow(
  scene: Phaser.Scene,
  x: number,
  y: number,
  pose: ShadowPose,
  size = 180,
  reducedMotion = false,
): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  const s = size / 100;
  const g = scene.add.graphics();

  // Hover glow under him: he never touches the floor.
  const glow = scene.add.ellipse(0, 46 * s, 74 * s, 16 * s, rgb(EYE), 0.22);
  c.add(glow);

  // Body: a rounded charcoal capsule, wider than tall so he reads as friendly.
  g.fillStyle(rgb(CHARCOAL), 1);
  g.fillRoundedRect(-34 * s, -34 * s, 68 * s, 76 * s, 26 * s);
  g.fillStyle(rgb(CHARCOAL_DEEP), 1);
  g.fillRoundedRect(-34 * s, 18 * s, 68 * s, 24 * s, 20 * s);

  // Round flank port.
  g.lineStyle(3 * s, rgb(FACE_RIM), 0.5);
  g.strokeCircle(22 * s, 18 * s, 7 * s);

  // Face plate: cream rim, dark glass.
  g.fillStyle(rgb(FACE_RIM), 1);
  g.fillRoundedRect(-27 * s, -26 * s, 54 * s, 40 * s, 16 * s);
  g.fillStyle(rgb(CHARCOAL_DEEP), 1);
  g.fillRoundedRect(-23 * s, -22 * s, 46 * s, 32 * s, 13 * s);

  // Antenna.
  g.lineStyle(4 * s, rgb(CHARCOAL), 1);
  g.beginPath();
  g.moveTo(0, -34 * s);
  g.lineTo(0, -50 * s);
  g.strokePath();
  g.fillStyle(rgb(EYE), 1);
  g.fillCircle(0, -54 * s, 6 * s);

  // Stubby arms, placed by pose.
  g.fillStyle(rgb(CHARCOAL), 1);
  const arms = armsFor(pose);
  g.fillRoundedRect(-46 * s, arms.leftY * s, 16 * s, 22 * s, 8 * s);
  g.fillRoundedRect(30 * s, arms.rightY * s, 16 * s, 22 * s, 8 * s);

  c.add(g);

  // Eyes: shape carries the expression, colour never does (AC-25.2).
  const eyes = scene.add.graphics();
  paintEyes(eyes, pose, s);
  c.add(eyes);

  const pulseTargets: Phaser.GameObjects.GameObject[] = [glow];
  scene.tweens.add({
    targets: pulseTargets,
    scaleX: reducedMotion ? 1.04 : 1.12,
    alpha: reducedMotion ? 0.26 : 0.34,
    duration: reducedMotion ? 3400 : 2200,
    ease: EASE.drift,
    yoyo: true,
    repeat: -1,
  });
  if (pose !== "sleeping") {
    scene.tweens.add({
      targets: c,
      y: y - (reducedMotion ? 3 : 7),
      duration: 3000,
      ease: EASE.drift,
      yoyo: true,
      repeat: -1,
    });
  }
  return c;
}

function armsFor(pose: ShadowPose): { leftY: number; rightY: number } {
  switch (pose) {
    case "pointing":
      return { leftY: 4, rightY: -22 };
    case "cheering":
      return { leftY: -26, rightY: -26 };
    case "saluting":
      return { leftY: 6, rightY: -30 };
    case "worried":
      return { leftY: 10, rightY: 10 };
    case "sleeping":
      return { leftY: 14, rightY: 14 };
    default:
      return { leftY: 2, rightY: 2 };
  }
}

/** Expressions are eye SHAPE changes, per art-direction section 6. */
function paintEyes(
  g: Phaser.GameObjects.Graphics,
  pose: ShadowPose,
  s: number,
): void {
  g.fillStyle(rgb(EYE), 1);
  const lx = -10 * s;
  const rx = 10 * s;
  const cy = -6 * s;
  switch (pose) {
    case "cheering": // happy: upward arcs
      g.lineStyle(4 * s, rgb(EYE), 1);
      g.beginPath();
      g.arc(lx, cy + 2 * s, 7 * s, Math.PI, 0, true);
      g.strokePath();
      g.beginPath();
      g.arc(rx, cy + 2 * s, 7 * s, Math.PI, 0, true);
      g.strokePath();
      break;
    case "worried": // small and low
      g.fillCircle(lx, cy + 3 * s, 4 * s);
      g.fillCircle(rx, cy + 3 * s, 4 * s);
      break;
    case "sleeping": // closed: two flat lines
      g.lineStyle(4 * s, rgb(EYE), 0.8);
      g.beginPath();
      g.moveTo(lx - 7 * s, cy);
      g.lineTo(lx + 7 * s, cy);
      g.moveTo(rx - 7 * s, cy);
      g.lineTo(rx + 7 * s, cy);
      g.strokePath();
      break;
    case "pointing": // attentive: tall ovals
      g.fillEllipse(lx, cy, 11 * s, 15 * s);
      g.fillEllipse(rx, cy, 11 * s, 15 * s);
      break;
    case "saluting":
      g.fillEllipse(lx, cy, 13 * s, 11 * s);
      g.fillEllipse(rx, cy, 13 * s, 11 * s);
      break;
    default:
      g.fillCircle(lx, cy, 7 * s);
      g.fillCircle(rx, cy, 7 * s);
      break;
  }
  // Face-plate glint, so the plate reads as glass and not as a hole.
  g.fillStyle(rgb(INK.text), 0.18);
  g.fillEllipse(-14 * s, -15 * s, 14 * s, 5 * s);
}
