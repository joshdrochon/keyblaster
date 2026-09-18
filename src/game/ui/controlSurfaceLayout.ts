import type { Rect } from "./layout.js";
import { HARDWARE, type Point, detentStops, rivetPositions } from "./panel.js";

/**
 * A CONTROL SURFACE, MEASURED (UR-61, UR-11; standards rule 1).
 *
 * ================== WHAT THIS IS FOR ==================
 * UR-11 asked for the Settings screen to stop reading as a web form and start
 * reading as the Lantern's own console; what came out of it is `ui/panel.ts`
 * (the maths) and `ui/cockpit.ts` (the hardware, drawn in vector). UR-61 then
 * reported the Briefing's strip - the dark bar of blue dots under the cockpit
 * window - as a row of dots that is meant to be ship controls and does not read
 * as any.
 *
 * The wrong fix is to redraw the Briefing's bar until it looks like hardware,
 * because that ships a SECOND console language for one screen. A screen is a
 * component and a theme is a skin (standards rule 1): the console is a surface
 * two screens mount things on, and this module is that surface's geometry.
 * Settings mounts a column of controls on it; the Briefing mounts a lamp bank
 * and a pair of vents on it. Neither owns it.
 *
 * ================== WHY THE GEOMETRY IS SEPARATE FROM THE DRAWING ==========
 * The same split `panel.ts` and `cockpit.ts` already use, for the same reason:
 * everything here is pure, so the unit suite runs it in Node and can assert
 * WHAT IS ON THE PANEL - how many pieces of hardware, where each one is, that
 * nothing hangs off the edge - without booting Phaser or reading pixels.
 *
 * That is the specific guard UR-61 needs. "It reads as a row of dots" is a
 * regression a future redraw can reintroduce silently, because a strip with its
 * vents and screws deleted still renders, still passes a screenshot diff nobody
 * is looking at, and still has lamps on it. `controlSurface.test.ts` counts the
 * elements and checks their boxes, so flattening it back is a red test.
 */

export interface ControlSurfaceParts {
  /** The outer frame the face is set into. */
  readonly bezel: Rect;
  /** The milled face itself. */
  readonly face: Rect;
  /** Screw heads holding the face on. */
  readonly rivets: readonly Point[];
  /** Milled cooling slots, in two groups flanking the bank. */
  readonly vents: readonly Rect[];
  /** The recess the indicator lamps are set into. */
  readonly bank: Rect;
  /** One indicator lamp per stop. */
  readonly lamps: readonly Rect[];
}

/**
 * The strip's hardware sizes.
 *
 * Bigger than the Settings panel's `HARDWARE.lampSize` (13) on purpose: these
 * lamps are read from across a room-sized composition rather than from the row
 * of a control the player is operating, and 13 px squares in an 812 px strip
 * are the dots the report is about.
 */
export const CONTROL_SURFACE = {
  /** Inset from the bezel to the face. Shared with the Settings console. */
  bezel: HARDWARE.bezel,
  /** How far in from the bezel the screws sit. */
  rivetInset: 22,
  /** An indicator lamp. */
  lampSize: 20,
  /** Air around the lamp group inside its recess. */
  bankPadX: 26,
  bankH: 52,
  /** One milled cooling slot. */
  ventW: 10,
  ventPitch: 20,
  ventCount: 6,
  /** How much of the face's height a vent slot takes. */
  ventFill: 0.46,
  /** Air between the face's edge and the first vent slot. */
  ventInset: 30,
} as const;

/**
 * Where a row of lamps sits inside a box it is centred in.
 *
 * ONE IMPLEMENTATION (standards rule 3). The Settings selector's position lamps
 * and this strip's stop lamps are the same piece of hardware at two sizes, and
 * both get their boxes from here - `cockpit.SelectorRow` through
 * `controlSurface.drawPositionLamps`, the strip through `controlSurfaceLayout`.
 * A second copy of this arithmetic is how the two would drift apart.
 *
 * Clustered at a fixed pitch and centred, never spread across the full width:
 * two lamps at opposite ends of a 240 px window read as two unrelated dots
 * rather than as two positions of one control.
 */
export function lampRowBoxes(
  x: number,
  y: number,
  w: number,
  count: number,
  size: number = HARDWARE.lampSize,
): Rect[] {
  const pitch = size + 10;
  const groupW = Math.max(size, count * pitch - 10);
  const stops = detentStops(x + (w - groupW) / 2, groupW, count, size / 2);
  return stops.map((cx) => ({ x: cx - size / 2, y, w: size, h: size }));
}

/** One group of cooling slots, `leftToRight` from `x`. */
function ventGroup(x: number, y: number, h: number): Rect[] {
  return Array.from({ length: CONTROL_SURFACE.ventCount }, (_, i) => ({
    x: x + i * CONTROL_SURFACE.ventPitch,
    y,
    w: CONTROL_SURFACE.ventW,
    h,
  }));
}

/** The width one group of vents occupies. */
export function ventGroupWidth(): number {
  return (
    CONTROL_SURFACE.ventCount * CONTROL_SURFACE.ventPitch -
    (CONTROL_SURFACE.ventPitch - CONTROL_SURFACE.ventW)
  );
}

/**
 * Lay a control surface out inside `rect`.
 *
 * Everything the strip draws comes from the returned boxes; nothing is measured
 * twice. That is what lets the test assert the geometry of the thing the screen
 * actually draws rather than of a model of it.
 */
export function controlSurfaceLayout(rect: Rect, lamps: number): ControlSurfaceParts {
  const b = CONTROL_SURFACE.bezel;
  const face: Rect = {
    x: rect.x + b,
    y: rect.y + b,
    w: rect.w - b * 2,
    h: rect.h - b * 2,
  };

  const bankW =
    Math.max(
      CONTROL_SURFACE.lampSize,
      lamps * (CONTROL_SURFACE.lampSize + 10) - 10,
    ) +
    CONTROL_SURFACE.bankPadX * 2;
  const bankH = Math.min(CONTROL_SURFACE.bankH, face.h - 12);
  const bank: Rect = {
    x: Math.round(face.x + (face.w - bankW) / 2),
    y: Math.round(face.y + (face.h - bankH) / 2),
    w: bankW,
    h: bankH,
  };

  const ventH = Math.round(face.h * CONTROL_SURFACE.ventFill);
  const ventY = Math.round(face.y + (face.h - ventH) / 2);
  const rightGroupX =
    face.x + face.w - CONTROL_SURFACE.ventInset - ventGroupWidth();

  return {
    bezel: rect,
    face,
    rivets: rivetPositions(rect, CONTROL_SURFACE.rivetInset),
    vents: [
      ...ventGroup(face.x + CONTROL_SURFACE.ventInset, ventY, ventH),
      ...ventGroup(rightGroupX, ventY, ventH),
    ],
    bank,
    lamps: lampRowBoxes(
      bank.x,
      Math.round(bank.y + (bank.h - CONTROL_SURFACE.lampSize) / 2),
      bank.w,
      lamps,
      CONTROL_SURFACE.lampSize,
    ),
  };
}

/**
 * How many separate pieces of hardware the surface draws.
 *
 * The number a regression would move. A strip that has quietly become a bar
 * with dots on it has lost its bezel, its screws and its vents, and this count
 * is what says so out loud.
 */
export function controlSurfaceElementCount(parts: ControlSurfaceParts): number {
  return (
    2 + parts.rivets.length + parts.vents.length + 1 + parts.lamps.length
  );
}
