import Phaser from "phaser";
import { hexToNum } from "@game/render/palette";
import type { Rect } from "./layout.js";
import {
  HARDWARE,
  PANEL,
  type Point,
  SHADOW_ALPHA,
  dashLitSurface,
  dashSeam,
  lampAlpha,
} from "./panel.js";
import {
  CONTROL_SURFACE,
  type ControlSurfaceParts,
  controlSurfaceLayout,
  lampRowBoxes,
} from "./controlSurfaceLayout.js";
import { SPACE } from "./theme.js";

/**
 * THE CONTROL SURFACE, DRAWN (UR-61 and UR-11; D83 vector-in-code).
 *
 * ================== ONE CONSOLE LANGUAGE, TWO SCREENS ==================
 * UR-11 produced the Settings console: milled charcoal, screws at the corners,
 * a light from above, glass recesses for anything with a value in it. UR-61
 * reported the Briefing's strip - the bar under the cockpit window - as failing
 * to read as the ship controls it is meant to be.
 *
 * This file is the shared answer rather than a second one. Every primitive the
 * console is built from LIVES HERE NOW and both screens draw with it:
 * `cockpit.ts` uses these to build the Settings controls, `BriefingScene` uses
 * `drawControlSurface` for its strip. They were private to `cockpit.ts` before,
 * which is why the Briefing could not have used them without copying them -
 * and a copied drawing is exactly what standards rule 3 exists to stop. The
 * guard that rule describes is not theoretical here: a second private Shadow
 * once shipped in this repo and was only found by a reference compare judging a
 * drawing the game never used.
 *
 * ================== THE RULES THE FICTION DOES NOT GET TO BREAK ==========
 *  - AC-22.8. Every colour comes from `panel.ts`; `controlSurface.test.ts`
 *    fails if a hex literal appears in this file, the same guard `cockpit.ts`
 *    is held to, because a literal is the only way an unmeasured ink gets
 *    drawn.
 *  - D83/D84. Vector, in code. Nothing here loads a raster.
 *  - NO FAKE CONTROLS. Everything the strip draws is an INDICATOR - lamps,
 *    vents, screws, seams. It does not draw a knob or a switch, because a knob
 *    that cannot be turned is a lie told to a seven-year-old, and this screen's
 *    only controls are launch and the way back.
 *
 * The light comes from ABOVE, once, for the whole surface (art-direction s5):
 * every `Lit` token is a top facet, every `Shade` token an underside, and a
 * recess is dark along its top edge where a raised object is light.
 */

const HW = HARDWARE;

// ---------------------------------------------------------------------------
// Primitives (moved here from `cockpit.ts`; one implementation each)
// ---------------------------------------------------------------------------

/** The soft shadow every raised piece of hardware casts, down and right. */
/** The bezel wraps the face, so its corner is the face's plus the inset. */
const BEZEL_RADIUS = SPACE.radius + 10;

export function castShadowCircle(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  r: number,
): void {
  g.fillStyle(hexToNum(PANEL.shadow), SHADOW_ALPHA);
  g.fillCircle(cx + 2, cy + 5, r);
}

/** A screw head: a dark socket, a lit crown, and a slot. */
export function drawRivet(
  g: Phaser.GameObjects.Graphics,
  p: Point,
  r: number,
): void {
  g.fillStyle(hexToNum(PANEL.shadow), SHADOW_ALPHA);
  g.fillCircle(p.x, p.y + 1, r + 1);
  g.fillStyle(hexToNum(PANEL.rivet), 1);
  g.fillCircle(p.x, p.y, r);
  g.fillStyle(hexToNum(PANEL.rivetLit), 1);
  g.fillCircle(p.x - r * 0.22, p.y - r * 0.26, r * 0.62);
  g.lineStyle(2, hexToNum(PANEL.knobShade), 1);
  g.lineBetween(p.x - r * 0.55, p.y, p.x + r * 0.55, p.y);
}

/**
 * A readout window: a rectangle milled through the face with glass in it. The
 * darkest surface on the panel, because it is the one a value is printed on.
 */
export function drawGlass(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  g.fillStyle(hexToNum(PANEL.glass), 1);
  g.fillRoundedRect(x, y, w, h, 8);
  // A recess is dark at the top and lit at the bottom - the opposite of a
  // raised object under the same light.
  g.lineStyle(2, hexToNum(PANEL.faceShade), 1);
  g.lineBetween(x + 8, y + 1, x + w - 8, y + 1);
  g.lineStyle(2, hexToNum(PANEL.lip), 1);
  g.lineBetween(x + 8, y + h - 1, x + w - 8, y + h - 1);
}

/**
 * A ROW OF LAMPS ON AN ENGRAVED INDEX LINE, with the one you are on burning.
 *
 * It is NOT a track with a thumb. The first pass drew exactly that, and a small
 * filled bar with a marker sliding along it is a pill slider - the shape the
 * whole cockpit change exists to remove - printed under every option row on the
 * screen. A row of lamps says the thing a printed word cannot ("there are four
 * of these and you are on the second") without borrowing the vocabulary of a
 * continuous control for a discrete one.
 *
 * Two screens draw it: a Settings selector's positions, and the Briefing
 * strip's one-lamp-per-stop bank. The boxes come from `lampRowBoxes` so both
 * are measured by the same arithmetic.
 */
export function drawLampRow(
  g: Phaser.GameObjects.Graphics,
  boxes: readonly Rect[],
  index: number,
  accent: string,
  focused: boolean,
): void {
  if (boxes.length === 0) return;
  const first = boxes[0] as Rect;
  const last = boxes[boxes.length - 1] as Rect;
  const midY = first.y + first.h / 2;

  // The engraved index line the lamps are set into: a hairline, never a filled
  // track, so this cannot read as something that slides.
  if (boxes.length > 1) {
    g.lineStyle(1, hexToNum(PANEL.lip), 0.8);
    g.lineBetween(first.x + first.w / 2, midY, last.x + last.w / 2, midY);
  }

  boxes.forEach((box, i) => {
    const lit = i === index;
    if (lit) {
      g.fillStyle(hexToNum(accent), 0.22);
      g.fillRoundedRect(box.x - 5, box.y - 5, box.w + 10, box.h + 10, 8);
    }
    g.fillStyle(hexToNum(lit ? accent : PANEL.glass), 1);
    g.fillRoundedRect(box.x, box.y, box.w, box.h, 4);
    g.lineStyle(2, hexToNum(lit ? accent : PANEL.lip), lit && focused ? 1 : 0.85);
    g.strokeRoundedRect(box.x, box.y, box.w, box.h, 4);
  });
}

/** A Settings selector's positions: one lamp per choice, centred in `w`. */
export function drawPositionLamps(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  index: number,
  count: number,
  accent: string,
  focused: boolean,
): void {
  drawLampRow(g, lampRowBoxes(x, y, w, count, HW.lampSize), index, accent, focused);
}

/**
 * THE CONSOLE FACE a column of controls - or a strip of indicators - is screwed
 * to.
 *
 * Bezel, then the face inside it, then the cabin light falling on the top of
 * the face as a band of stacked strips - the same light `chrome.ts` already
 * blooms at the top of every menu backdrop, so the panel is lit by the room it
 * is in rather than by a second, invented lamp. The strips are inset past the
 * face's corner radius so they never break the rounded corners.
 */
export function drawConsoleFace(
  g: Phaser.GameObjects.Graphics,
  rect: Rect,
  dash?: string,
): void {
  paintFace(g, controlSurfaceLayout(rect, 0), dash);
}

/**
 * The face itself, from measured parts.
 *
 * `dash` is the pilot's DASH COLOUR (UR-123) and is optional: passing nothing
 * paints exactly what this file has always painted, which is what keeps the
 * Briefing and Pre-flight strips byte-identical. When it is given, the cabin
 * light falling on the top of the face carries it and the engraved seam under
 * that light does too - the two marks on this surface that are ABOUT the light
 * rather than about the metal, so the panel reads as a dashboard lit in the
 * pilot's colour rather than as a panel painted in it.
 *
 * The blend is `dashLitSurface`, which is pure and measured: every dash colour
 * the game offers is run through the AC-22.8 cross product in
 * `tests/unit/ui/cockpit.test.ts` against both label inks, so a colour that
 * would cost this panel its contrast cannot be added to the set quietly.
 */
function paintFace(
  g: Phaser.GameObjects.Graphics,
  parts: ControlSurfaceParts,
  dash?: string,
): void {
  const { x, y, w, h } = parts.bezel;
  g.fillStyle(hexToNum(PANEL.faceShade), 1);
  g.fillRoundedRect(x, y, w, h, BEZEL_RADIUS);
  g.lineStyle(2, hexToNum(PANEL.lip), 1);
  g.strokeRoundedRect(x, y, w, h, BEZEL_RADIUS);

  const { x: fx, y: fy, w: fw, h: fh } = parts.face;
  g.fillStyle(hexToNum(PANEL.face), 1);
  g.fillRoundedRect(fx, fy, fw, fh, SPACE.radius);

  const lit = dash === undefined ? PANEL.faceLit : dashLitSurface(dash);
  const bands = 22;
  const reach = Math.min(fh * 0.55, 260);
  for (let i = 0; i < bands; i += 1) {
    const t = i / bands;
    g.fillStyle(hexToNum(lit), 0.42 * (1 - t) ** 2);
    g.fillRect(fx + 16, fy + 2 + (reach * i) / bands, fw - 32, reach / bands + 1);
  }

  /**
   * The engraved seam where the face meets the bezel: in shadow along the
   * bottom, and NO LONGER LIT IN THE DASH COLOUR ALONG THE TOP (UR-137).
   *
   * The lit seam was a 2 px line in `dashSeam(dash)` across the full width of
   * both panels, and at the top of a tall dark console it did not read as a
   * seam catching the cabin light - it read as a coloured rule someone had
   * drawn on, which is what the owner called a yellow accent bar.
   *
   * The cabin light itself is KEPT: the 22-band wash above still carries the
   * dash colour down the top of the face, which is the part that actually
   * makes the panel look lit. What goes is the hard edge on top of it.
   */
  g.lineStyle(2, hexToNum(PANEL.lip), 0.85);
  g.lineBetween(fx + 16, fy + 1, fx + fw - 16, fy + 1);
  g.lineStyle(2, hexToNum(PANEL.faceShade), 1);
  g.lineBetween(fx + 16, fy + fh - 1, fx + fw - 16, fy + fh - 1);

  for (const p of parts.rivets) drawRivet(g, p, CONTROL_SURFACE.rivetR);
}

/**
 * A milled cooling slot: a dark cut with a lit lower lip, so it reads as a hole
 * in the metal rather than as a painted stripe.
 */
function drawVent(g: Phaser.GameObjects.Graphics, slot: Rect): void {
  const r = slot.w / 2;
  g.fillStyle(hexToNum(PANEL.bay), 1);
  g.fillRoundedRect(slot.x, slot.y, slot.w, slot.h, r);
  g.lineStyle(2, hexToNum(PANEL.shadow), SHADOW_ALPHA);
  g.lineBetween(slot.x + r, slot.y + 1, slot.x + slot.w - r, slot.y + 1);
  g.lineStyle(2, hexToNum(PANEL.lip), 0.7);
  g.lineBetween(slot.x + r, slot.y + slot.h - 1, slot.x + slot.w - r, slot.y + slot.h - 1);
}

export interface ControlSurfaceOptions {
  /** How many indicator lamps the bank carries. */
  readonly lamps: number;
  /** Which one burns, or -1 for none. */
  readonly lit: number;
  /** The stop's accent, which is the only saturated thing on the surface. */
  readonly accent: string;
}

/**
 * THE STRIP UNDER THE COCKPIT WINDOW, AS HARDWARE (UR-61).
 *
 * What was there: a rounded rectangle in `INK.panel` with nine flat circles on
 * it, three of them in the accent. Nothing about that says console - there is
 * no frame, no fixing, no depth, no light, and a circle on a bar is a bullet
 * point. What replaces it is the same object the Settings screen is built from:
 * a bezel with a milled face inside it, screwed down at four corners, lit from
 * above, with cooling slots cut through the metal on both sides and the stop
 * lamps recessed behind glass in the middle.
 *
 * The lamps are the one thing that SAYS something - one per stop, the one you
 * are being briefed for burning - so the strip is an instrument rather than
 * decoration shaped like one.
 */
export function drawControlSurface(
  g: Phaser.GameObjects.Graphics,
  rect: Rect,
  options: ControlSurfaceOptions,
): ControlSurfaceParts {
  const parts = controlSurfaceLayout(rect, options.lamps);
  paintFace(g, parts);
  for (const slot of parts.vents) drawVent(g, slot);
  drawGlass(g, parts.bank.x, parts.bank.y, parts.bank.w, parts.bank.h);
  drawLampRow(g, parts.lamps, options.lit, options.accent, false);
  // A lit lamp spills onto the metal around its recess, the way the Settings
  // toggle's slot does. Alpha, not a second colour: `lampAlpha` is the one
  // place the console decides how hard a lamp burns.
  if (options.lit >= 0 && options.lit < parts.lamps.length) {
    g.fillStyle(hexToNum(options.accent), lampAlpha(true) * 0.18);
    g.fillRoundedRect(
      parts.bank.x - CONTROL_SURFACE.bankPadX / 2,
      parts.bank.y - 6,
      parts.bank.w + CONTROL_SURFACE.bankPadX,
      parts.bank.h + 12,
      12,
    );
  }
  return parts;
}
