import type { Rect } from "./layout.js";
import { HARDWARE, type Point, detentStops, rivetPositions } from "./panel.js";
import { COLUMN_GAP, contentWidth, pageInset } from "./grid.js";
import { SPACE, STEP } from "./theme.js";

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
  /**
   * A screw head's radius, as DRAWN. `controlSurface.paintFace` passes this to
   * `drawRivet`; it used to pass the literal 9, which is why nothing could ask
   * how much room a bolt needs without re-reading the pen (see `boltClearance`).
   */
  rivetR: 9,
  /**
   * How far `drawRivet`'s cast shadow reaches past the head: it fills a circle
   * at `r + 1`, one pixel down. Counted, so the reserve below is a bound on the
   * INK rather than on the construction radius - the same rule `keepClear.ts`
   * applies to a rock's rim.
   */
  rivetRim: 1,
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
 * THE STRIP UNDER A COCKPIT WINDOW, AS SHARED GEOMETRY (UR-61, shared by UR-77).
 *
 * UR-61 raised the Briefing's strip from 76 px of bar with nine flat circles on
 * it to a 124 px console with the whole vocabulary - bezel, milled face,
 * screws, vents, a recessed lamp bank. The Pre-flight, which is the SAME
 * COCKPIT one screen later, was never brought along: it kept a 76 px plate with
 * nine dots on it, hanging 30 px past the glass on each side, and drew the dots
 * itself rather than calling `drawControlSurface` at all.
 *
 * That is what "Pre-flight has no vent" means. The vents, the screws and the
 * seams are drawn from exactly one place and the Pre-flight was not reaching
 * it. The height and the lamp count live here now so the two screens cannot own
 * different ones again, and both derive the box from their own glass.
 */
export const CONSOLE_STRIP = {
  /** Air between the foot of the glass and the top of the strip. */
  gap: 24,
  /**
   * 124, NOT 76. The Briefing's value, which is the reference: the 48 px it
   * gains are what the bezel, the vents and the screws need in order to read as
   * hardware rather than as a bar with dots on it.
   */
  h: 124,
  /**
   * SEVEN, one per stop, and the one that burns is the stop you are at. Nine
   * lit at `i % 3 === 0` is decoration in the shape of a readout: three lamps
   * of nine burning says something specific and false. A count that matches the
   * route says the true thing for free.
   */
  lamps: 7,
} as const;

/**
 * HOW MUCH OF A CONSOLE'S EDGE THE BOLTS OWN (UR-122).
 *
 * ================== WHAT WAS REPORTED ==================
 * The project owner, on Ship Controls: the panel's corner bolts are being
 * overlapped by the setting rows. Measured from the source: a Settings column
 * put its control plates at `face.x + bezel`, and a bolt's ink reaches
 * `face.x + rivetInset + rivetR + rivetRim` - so the plate, which is opaque and
 * drawn one depth ABOVE the console face, was painted over the outer 6 px of
 * every bolt on both long edges, including the two mid-edge screws that sit
 * halfway down the column squarely behind a row.
 *
 * ================== WHY A RESERVE AND NOT A NARROWER ROW ==================
 * Same argument as `render/keepClear.ts`, which is the other place in this
 * build where a screen declares "this furniture is not to be drawn over": the
 * mechanism belongs to the thing that OWNS the furniture, not to the screen
 * that happens to mount on it. A width picked by hand in `SettingsScene` would
 * be a number that goes stale the first time `rivetInset` moves, and the next
 * surface to mount a column on this face would get the defect back - which is
 * exactly the history `keepClear.ts`'s header records for the Title and the map.
 *
 * So the console says how much of its own edge is spoken for, and anything
 * mounted on it derives its box from that.
 *
 * It is a bound on the INK: `rivetR` is the head and `rivetRim` is the cast
 * shadow's overshoot, both read off `drawRivet` rather than estimated.
 */
export function boltClearance(): number {
  return CONTROL_SURFACE.rivetInset + CONTROL_SURFACE.rivetR + CONTROL_SURFACE.rivetRim;
}

/**
 * The band, on ONE edge, that a bolt's ink occupies - as an offset pair from
 * the console's outer edge. `[12, 32]` at the shipped numbers.
 *
 * Exported so a guard can assert the overlap directly rather than re-deriving
 * the arithmetic and agreeing with itself.
 */
export function boltInkBand(): { readonly near: number; readonly far: number } {
  const { rivetInset, rivetR, rivetRim } = CONTROL_SURFACE;
  return { near: rivetInset - rivetR - rivetRim, far: rivetInset + rivetR + rivetRim };
}

/**
 * HOW FAR IN FROM A CONSOLE'S EDGE ANYTHING MOUNTED ON IT MAY START (UR-122).
 *
 * ================== WHY IT IS NOT JUST `boltClearance()` ==================
 * Because the thing that overruns the bolt is not only the row. It is the row
 * PLUS THE FOCUS RING, and the ring is 6 px outside the row and 4 px wide, so
 * its ink reaches `focusRingOffset + focusRingWidth / 2` = 8 px further left
 * than the plate does. Measured on the served build before this change, the
 * focused row's amber ring landed at x=88 with the top-left bolt's ink band
 * running 82..102 - the ring was drawn straight through the screw.
 *
 * An inset of exactly `boltClearance()` + 8 would put the ring's outer ink on
 * the bolt's outer ink, touching to the pixel, and an edge that touches is the
 * same report one frame later. `STEP.hair` is the air on top.
 *
 *   32  boltClearance()            bolt head + its cast shadow
 *  + 6  SPACE.focusRingOffset      the ring sits outside the plate
 *  + 2  SPACE.focusRingWidth / 2   the stroke is centred on its path
 *  + 8  STEP.hair                  air, so it clears rather than touches
 *  ----
 *    48
 *
 * DERIVED, NOT PICKED. It is a multiple of 4 like every number on the spacing
 * scale, but it is deliberately not one of `STEP`'s six names: those are air a
 * designer chooses and this is a clearance a measurement dictates. Writing 40
 * (`STEP.pad`) here because it is on the scale would be choosing a round number
 * over the bolt, which is the whole class of defect this file's header is
 * about. `tests/unit/ui/settingsFurniture.test.ts` asserts the RELATION, so
 * moving `rivetInset` or the ring's geometry is what turns it red.
 */
export function consoleContentInset(): number {
  return boltClearance() + SPACE.focusRingOffset + SPACE.focusRingWidth / 2 + STEP.hair;
}

/** One console face laid out on the page box, with the column inside it. */
export interface ConsoleColumn {
  /** The face's outer edge: what `drawConsoleFace` is given. */
  readonly faceX: number;
  readonly faceW: number;
  /** Where a control row starts, and how wide it is. */
  readonly controlX: number;
  readonly colW: number;
}

/**
 * LAY N CONSOLE FACES ACROSS THE PAGE BOX (UR-121, UR-122).
 *
 * ================== WHY THIS IS A FUNCTION AND NOT THREE LINES IN A SCENE ==
 * It was three lines in a scene, and both of the reports this change answers
 * are what those three lines did. `SettingsScene` computed
 * `colW = min(820, (GAME_WIDTH - gutter * 3) / 2)`, `leftX = gutter`,
 * `rightX = gutter * 2 + colW` - the CONTROLS first, the face derived from them
 * by subtracting a bezel. Measured on the served build at 1920, that put the
 * left face's ink at x=69 against a page padding of 96 and the right face's at
 * 1850 against a content edge of 1824: both panels outside the margin, in
 * opposite directions.
 *
 * Here the direction is reversed and both defects become arithmetically
 * unreachable. The FACES are laid out on the page box, so a face cannot miss
 * the margin; the CONTROLS are inset from the faces by `consoleContentInset()`,
 * so a row cannot reach the bolts. Neither is a number a screen supplies.
 *
 * It is pure, so `tests/unit/ui/settingsFurniture.test.ts` measures the real
 * geometry in Node rather than a model of it - the split `panel.ts` and
 * `cockpit.ts` already use, for the same reason.
 *
 * `GAME_WIDTH` is read at call time through `contentWidth()`, never captured:
 * the world widens with the window (D99).
 */
export function consoleColumns(count: number): readonly ConsoleColumn[] {
  const n = Math.max(1, Math.floor(count));
  const inset = consoleContentInset();
  const faceW = Math.round((contentWidth() - COLUMN_GAP * (n - 1)) / n);
  return Array.from({ length: n }, (_, i) => {
    const faceX = pageInset(0) + i * (faceW + COLUMN_GAP);
    return { faceX, faceW, controlX: faceX + inset, colW: faceW - inset * 2 };
  });
}

/** The strip's box, under a window's glass. Both cockpit screens use this. */
export function consoleStripBelow(glass: Rect): Rect {
  return {
    x: glass.x,
    y: glass.y + glass.h + CONSOLE_STRIP.gap,
    w: glass.w,
    h: CONSOLE_STRIP.h,
  };
}

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
