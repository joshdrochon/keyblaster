import type Phaser from "phaser";
import { hexToNum } from "@game/render/palette";

/**
 * THE ENGRAVED MARK BESIDE EACH SETTING'S NAME (UR-138).
 *
 * ================== WHY THEY EXIST ==================
 * The console's left column was six rows of bare text against six identical
 * plates. The owner asked for an icon on each: a row you can find by SHAPE is
 * a row a child who cannot yet read "Menu Language" can still point at, which
 * is the same argument D41 makes for never letting colour be the only carrier.
 *
 * ================== WHY THEY ARE DRAWN, NOT A FONT ==================
 * D83: all art is vector drawn in code, no raster in `src/`. An icon font is a
 * raster in a trench coat - it would also be a second place type comes from,
 * and `theme.ts` is deliberately the only one.
 *
 * ================== THE RULES THEY SHARE ==================
 * Each mark draws inside a box of `size`, centred on the point it is given,
 * in ONE ink. They are STROKED at a constant width rather than filled, so they
 * read as engraved into the panel like the seams and the lamp channels, and so
 * a mark cannot become a bright shape competing with the readout that is the
 * actual value. Nothing here knows about focus: the caller picks the ink.
 */

/** Stroke width every mark is engraved at. */
const W = 2.5;

export type SettingIconId =
  | "music"
  | "sound"
  | "keyboard"
  | "language"
  | "dash"
  | "mark"
  | "letterCase"
  | "spacing"
  | "motion"
  | "palette"
  | "reset";

type Pen = Phaser.GameObjects.Graphics;

/** Draw `id` centred on (cx, cy) inside a `size` box, in `ink`. */
export function drawSettingIcon(
  g: Pen,
  id: SettingIconId,
  cx: number,
  cy: number,
  size: number,
  ink: string,
): void {
  const c = hexToNum(ink);
  const r = size / 2;
  g.lineStyle(W, c, 1);
  switch (id) {
    case "music": {
      // A quaver: stem with a flag, and a filled head so it reads at 22 px.
      const x = cx + r * 0.35;
      g.lineBetween(x, cy - r * 0.85, x, cy + r * 0.45);
      g.beginPath();
      g.moveTo(x, cy - r * 0.85);
      g.lineTo(x + r * 0.6, cy - r * 0.45);
      g.strokePath();
      g.fillStyle(c, 1);
      g.fillEllipse(x - r * 0.35, cy + r * 0.5, r * 0.75, r * 0.55);
      break;
    }
    case "sound": {
      // A speaker cone and two arcs. The arcs are what separate it from
      // `music` at a glance, which is the pair most likely to be confused.
      g.beginPath();
      g.moveTo(cx - r * 0.75, cy - r * 0.3);
      g.lineTo(cx - r * 0.35, cy - r * 0.3);
      g.lineTo(cx + r * 0.05, cy - r * 0.8);
      g.lineTo(cx + r * 0.05, cy + r * 0.8);
      g.lineTo(cx - r * 0.35, cy + r * 0.3);
      g.lineTo(cx - r * 0.75, cy + r * 0.3);
      g.closePath();
      g.strokePath();
      for (const k of [0.45, 0.8]) {
        g.beginPath();
        g.arc(cx + r * 0.05, cy, r * k, -0.9, 0.9, false);
        g.strokePath();
      }
      break;
    }
    case "keyboard": {
      g.strokeRoundedRect(cx - r * 0.9, cy - r * 0.6, r * 1.8, r * 1.2, 3);
      g.lineStyle(W * 0.8, c, 1);
      for (const row of [-0.22, 0.1]) {
        for (let i = 0; i < 4; i += 1) {
          const kx = cx - r * 0.66 + i * r * 0.44;
          g.lineBetween(kx, cy + r * row, kx + r * 0.18, cy + r * row);
        }
      }
      g.lineBetween(cx - r * 0.4, cy + r * 0.38, cx + r * 0.4, cy + r * 0.38);
      break;
    }
    case "language": {
      // A globe: circle, equator, meridian.
      g.strokeCircle(cx, cy, r * 0.85);
      g.lineBetween(cx - r * 0.85, cy, cx + r * 0.85, cy);
      g.strokeEllipse(cx, cy, r * 0.85, r * 1.7);
      break;
    }
    case "dash": {
      // A paint drop, which is the one mark here that is about COLOUR.
      g.beginPath();
      g.moveTo(cx, cy - r * 0.9);
      g.lineTo(cx + r * 0.65, cy + r * 0.15);
      g.arc(cx, cy + r * 0.15, r * 0.65, 0, Math.PI, false);
      g.closePath();
      g.strokePath();
      break;
    }
    case "mark": {
      // A pilot's badge: a ring with a star inside it.
      g.strokeCircle(cx, cy, r * 0.85);
      g.fillStyle(c, 1);
      star(g, cx, cy, r * 0.45, r * 0.2, 5);
      break;
    }
    case "letterCase": {
      // "Aa" as geometry: a capital wedge and a lowercase bowl.
      g.beginPath();
      g.moveTo(cx - r * 0.85, cy + r * 0.6);
      g.lineTo(cx - r * 0.35, cy - r * 0.75);
      g.lineTo(cx + r * 0.1, cy + r * 0.6);
      g.strokePath();
      g.lineBetween(cx - r * 0.66, cy + r * 0.12, cx - r * 0.06, cy + r * 0.12);
      g.strokeCircle(cx + r * 0.52, cy + r * 0.28, r * 0.35);
      g.lineBetween(cx + r * 0.87, cy - r * 0.1, cx + r * 0.87, cy + r * 0.62);
      break;
    }
    case "spacing": {
      // Two marks pushed apart by arrows: the setting, drawn literally.
      g.lineBetween(cx - r * 0.85, cy - r * 0.5, cx - r * 0.85, cy + r * 0.5);
      g.lineBetween(cx + r * 0.85, cy - r * 0.5, cx + r * 0.85, cy + r * 0.5);
      g.lineBetween(cx - r * 0.45, cy, cx + r * 0.45, cy);
      arrow(g, cx - r * 0.45, cy, -1, r * 0.3);
      arrow(g, cx + r * 0.45, cy, 1, r * 0.3);
      break;
    }
    case "motion": {
      // A body with two trailing lines - motion, and the setting calms it.
      g.strokeCircle(cx + r * 0.4, cy, r * 0.4);
      for (const dy of [-0.4, 0.4]) {
        g.lineBetween(cx - r * 0.9, cy + r * dy, cx - r * 0.2, cy + r * dy);
      }
      break;
    }
    case "palette": {
      // An eye: the accessibility setting is about what can be SEEN.
      g.beginPath();
      g.moveTo(cx - r * 0.9, cy);
      g.lineTo(cx, cy - r * 0.6);
      g.lineTo(cx + r * 0.9, cy);
      g.lineTo(cx, cy + r * 0.6);
      g.closePath();
      g.strokePath();
      g.strokeCircle(cx, cy, r * 0.28);
      break;
    }
    case "reset": {
      // An open circle with an arrowhead: going back round to the start.
      g.beginPath();
      g.arc(cx, cy, r * 0.75, 0.6, Math.PI * 1.9, false);
      g.strokePath();
      arrow(g, cx + r * 0.62, cy - r * 0.42, 1, r * 0.34);
      break;
    }
  }
}

/** A solid n-pointed star, used by `mark`. */
function star(g: Pen, cx: number, cy: number, outer: number, inner: number, points: number): void {
  g.beginPath();
  for (let i = 0; i < points * 2; i += 1) {
    const rad = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / points) * i - Math.PI / 2;
    const px = cx + Math.cos(a) * rad;
    const py = cy + Math.sin(a) * rad;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fillPath();
}

/** A small arrowhead at (x, y) pointing left (-1) or right (+1). */
function arrow(g: Pen, x: number, y: number, dir: 1 | -1, size: number): void {
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x - dir * size, y - size * 0.6);
  g.moveTo(x, y);
  g.lineTo(x - dir * size, y + size * 0.6);
  g.strokePath();
}
