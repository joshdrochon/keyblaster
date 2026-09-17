import type { Rect } from "./layout.js";
import { INK, SPACE } from "./theme.js";

/**
 * THE LANTERN'S CONSOLE — tokens and maths (UR-11, D83, D84, AC-18.1, AC-22.8).
 *
 * Settings used to be the cleanest web form in the build: flat rows, a pill
 * slider with a white dot, a "70%" caption. Correct, legible, and plainly not
 * part of a ship. The request was for the inside of a space ship, and the name
 * for what they asked for is a DIEGETIC INTERFACE - the panel is not a menu the
 * player is shown, it is the console the pilot is sitting at.
 *
 * WHY THIS FILE IS SEPARATE FROM `cockpit.ts`. Everything here is pure: numbers
 * in, numbers out, no Phaser and no DOM. That is what lets the three things a
 * child would notice first be UNIT TESTED rather than eyeballed in a capture:
 *
 *   - a knob's pointer must sweep monotonically and MUST NOT WRAP. A rotary
 *     control that snaps from full to silent because the arrow key was held one
 *     step too long is the single worst thing a volume knob can do, and it is
 *     invisible in a screenshot.
 *   - a switch must visibly THROW. A lever that moves four pixels is a picture
 *     of a switch, not a switch.
 *   - every label and value must clear 4.5:1 (AC-22.8). A charcoal panel with
 *     amber hardware is exactly where contrast dies quietly, so the ink for
 *     each surface is chosen by a function here and the whole cross product is
 *     measured in tests/unit/ui/cockpit.test.ts.
 *
 * THE LIGHT COMES FROM ABOVE, which is the rule the rest of the game is drawn
 * under (art-direction s5: one light direction, a rim highlight on the lit
 * side) and the same light `chrome.ts`'s backdrop bloom already puts at the top
 * of every menu. Every token below that ends in `Lit` is a top facet; every one
 * that ends in `Shade` is the underside.
 */

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

/**
 * The console's materials. Four values only - face, recess, hardware, glass -
 * because a panel made of more than four values reads as decoration rather than
 * as one milled object.
 *
 * `face` is deliberately LIGHTER than `INK.panel`. The controls are recessed
 * into it and the recesses are the dark things; a panel darker than its own
 * cutouts is a hole, not a surface. It still measures 15.27:1 against
 * `INK.text` and 7.75:1 against `INK.textDim`, both well over the bar. Every
 * pair is measured as a cross product in tests/unit/ui/cockpit.test.ts.
 */
export const PANEL = {
  /** The console face: charcoal, matte, lit from above. */
  face: "#1C222C",
  /** The face where the top light falls on it. */
  faceLit: "#2C3440",
  /**
   * The face in its own shadow: the bezel, and the plate a control module is
   * bolted to. A module is only a STEP darker than the face, not a hole in it -
   * the first pass made every module the darkest surface on the panel and the
   * glass readouts inside them disappeared, because a recess cut into a recess
   * has nothing to be darker than.
   */
  faceShade: "#12171E",
  /** A milled recess: what a module drops into once it has focus. */
  bay: "#0B0F14",
  /** The lit top edge of a recess, and every engraved line. */
  lip: "#333D4A",
  /** Screw heads. */
  rivet: "#3D4753",
  rivetLit: "#616D7C",
  /** The knob body and the switch bezel. */
  knob: "#3E4753",
  /** The lit facet on top of the knob, and the switch lever's shaft. */
  knobLit: "#6B7684",
  knobShade: "#232932",
  /** The pointer on the knob and the cap on the lever: the brightest metal. */
  pointer: "#EEF3FA",
  /** Unlit detent ticks. Not text; still has to be a mark a child can see. */
  tick: "#8494A8",
  /** The glass a readout is printed behind. The darkest thing on the panel. */
  glass: "#05070A",
  /** Cast shadow under every piece of hardware. */
  shadow: "#000000",
} as const;

/** How dark the cast shadow under a control is. */
export const SHADOW_ALPHA = 0.45;

// ---------------------------------------------------------------------------
// The hull the pilot is sitting inside
// ---------------------------------------------------------------------------

/**
 * WHAT COUNTS AS A HOLE RATHER THAN A DARK SURFACE, in CIE L*.
 *
 * Not a taste threshold: a blind critic measured `briefing.png` and reported
 * that 40.9% of its pixels sat below L* 5, and named the consequence - "the
 * left and right thirds are voids". Below about 5 the eye stops reading a
 * surface and starts reading absence, because there is no shading left to see:
 * the whole range from #000000 to #0E1116 is four L* wide.
 *
 * Every large area the UI paints is held above this. Small ones are exempt by
 * construction - `PANEL.glass` is L* 2 and it is a readout window a centimetre
 * across, which is a dark THING rather than a dark REGION.
 */
export const VOID_LSTAR = 5;

/**
 * CIE L* for a hex colour, 0..100. Perceptual lightness, which is the scale the
 * "voids" measurement was taken on; WCAG relative luminance is not, and reading
 * 0.004 against 0.008 tells you nothing about what a person sees.
 */
export function lightness(hex: string): number {
  const linear = [0, 2, 4]
    .map((i) => Number.parseInt(hex.replace("#", "").slice(i, i + 2), 16) / 255)
    .map((s) => (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  const y = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
}

/**
 * THE COCKPIT HULL (Briefing and Pre-flight).
 *
 * Both screens are "a picture-book page inside a cockpit": a window cut out of
 * a wall, with the wall filling everything the page and the glass do not. That
 * wall was `INK.bg` - a flat #08111F at L* 4.98 - across roughly 40% of the
 * frame, so the two screens read as a card and a photograph floating in
 * nothing rather than as the inside of a ship.
 *
 * It is the same milled charcoal the Settings console is made of, one step
 * darker so the console still reads as hardware bolted to it, and it is LIT
 * FROM ABOVE like every other surface in the game (art-direction s5). The
 * darkest stop is L* 7.5, half again clear of `VOID_LSTAR`.
 */
export const HULL = {
  /** The top of the wall, where the cabin light falls on it. */
  top: "#18202C",
  /** The bottom, in its own shadow. Still a surface: L* 7.5. */
  bottom: PANEL.faceShade,
  /** The engraved seam where a frame meets the wall. */
  seam: PANEL.lip,
} as const;

/** Every value the hull gradient passes through, for measurement. */
export function hullStops(): readonly string[] {
  return [HULL.top, HULL.bottom];
}

// ---------------------------------------------------------------------------
// Ink: which colour goes on which surface
// ---------------------------------------------------------------------------

/**
 * The ink for a control's engraved label.
 *
 * Both answers clear 4.5:1 on every surface the panel has, by a wide margin
 * (worst case 6.09:1, on the top-lit band), which is the point: focus is carried by the RING and the hardware,
 * never by making the unfocused labels unreadable. `controls.ts` has the same
 * note about the pause menu shipping two of three rows in an ink that read as
 * "disabled"; a console must not repeat it.
 */
export function labelInk(focused: boolean): string {
  return focused ? INK.text : INK.textDim;
}

/**
 * The ink for a value printed behind glass - "70%", "qwerty", "on".
 *
 * It is the stop accent, which is amber normally and #FFFFFF under the
 * colourblind palette, and it is always read against `PANEL.glass` - the
 * darkest surface on the panel - rather than against the face. 13.11:1 amber,
 * 20.17:1 white.
 */
export function readoutInk(accent: string): string {
  return accent;
}

/** Everything a value is ever printed on. One surface, so one measurement. */
export const READOUT_SURFACE = PANEL.glass;

/** The lightest surface a label can be engraved on: the top-lit band. */
export const LABEL_SURFACE = PANEL.faceLit;

/**
 * EVERY SURFACE THE PANEL CAN PUT UNDER TEXT, as a list rather than as three
 * constants somebody has to remember to extend.
 *
 * `cockpit.test.ts` takes the cross product of this with every ink `labelInk`
 * and `readoutInk` can return, so adding a surface here without checking what
 * it does to contrast is what turns the suite red - not a code review.
 */
export const TEXT_SURFACES = [
  PANEL.face,
  PANEL.faceLit,
  PANEL.faceShade,
  PANEL.bay,
  PANEL.glass,
] as const;

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * A point on a circle, with 0° at TWELVE O'CLOCK and degrees running clockwise.
 *
 * Not the maths convention, on purpose: every angle in this file describes a
 * piece of hardware a person looks at, and "the pointer is at minus 135" should
 * mean the pointer is down-and-to-the-left, which is where it is.
 */
export function polar(cx: number, cy: number, r: number, deg: number): Point {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

// -- knob -------------------------------------------------------------------

/**
 * The rotary pot. 270° of sweep with eleven detents is the panel-instrument
 * default, and eleven detents is exactly the ten arrow-key steps the old slider
 * had, so the hardware and the keyboard agree about what one press is worth.
 */
export const KNOB = {
  sweepDeg: 270,
  /** Pointer angle at 0. */
  minDeg: -135,
  /** Pointer angle at 1. */
  maxDeg: 135,
  detents: 11,
  /** One arrow press. */
  step: 0.1,
} as const;

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * Where the pointer points for a value.
 *
 * MONOTONIC AND BOUNDED. There is no modulo here and there must never be one: a
 * knob that wraps tells a child that turning the music up far enough turns it
 * off, which is the one thing a volume control may not do.
 */
export function knobAngleDeg(value01: number): number {
  return KNOB.minDeg + KNOB.sweepDeg * clamp01(value01);
}

/** The detent ticks around the arc, minimum and maximum included. */
export function knobTickAngles(count: number = KNOB.detents): number[] {
  const n = Math.max(2, Math.floor(count));
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(KNOB.minDeg + (KNOB.sweepDeg * i) / (n - 1));
  }
  return out;
}

/**
 * One arrow press on a knob, rounded the way the readout is.
 *
 * Rounds to whole percent BEFORE clamping so `0.7 - 0.1` cannot land on
 * 0.5999999999999999 and print "60%" beside a pointer drawn at 59.99%.
 */
export function stepValue(
  value01: number,
  delta: number,
  step: number = KNOB.step,
): number {
  return clamp01(Math.round((value01 + delta * step) * 100) / 100);
}

// -- switch -----------------------------------------------------------------

/**
 * The illuminated toggle. UP IS ON, and the lamp behind the lever lights with
 * it, and the word "on" / "off" is printed beside it - three encodings of one
 * bit, because one of them is colour and colour is not allowed to be the only
 * carrier (D41).
 */
export const SWITCH = {
  /** How far off vertical the lever leans, so it reads as a 3D object. */
  leanDeg: 12,
  /** Lever length from the pivot. */
  leverLen: 26,
  lampOn: 0.95,
  lampOff: 0.06,
} as const;

export function leverAngleDeg(on: boolean): number {
  return on ? SWITCH.leanDeg : 180 - SWITCH.leanDeg;
}

/** The tip of the lever. The throw between the two states is ~50 px. */
export function leverTip(
  cx: number,
  cy: number,
  on: boolean,
  len: number = SWITCH.leverLen,
): Point {
  return polar(cx, cy, len, leverAngleDeg(on));
}

/** How hard the lamp behind the lever is burning. */
export function lampAlpha(on: boolean): number {
  return on ? SWITCH.lampOn : SWITCH.lampOff;
}

// -- selector ---------------------------------------------------------------

/**
 * A selector has PHYSICAL POSITIONS: a milled track with one detent per choice
 * and a shuttle that sits in one of them. The value is still printed in words
 * behind glass - the detents say "there are four of these and you are on the
 * second", which is the thing a word alone cannot say.
 */
export function detentStops(
  left: number,
  width: number,
  count: number,
  inset: number,
): number[] {
  const n = Math.floor(count);
  if (n <= 0) return [];
  if (n === 1) return [left + width / 2];
  const a = left + inset;
  const b = left + width - inset;
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) out.push(a + ((b - a) * i) / (n - 1));
  return out;
}

/**
 * How much width is left for a control's engraved label once its hardware has
 * taken the right of the module.
 *
 * `hardwareLeft` is the left edge of the leftmost thing on the right - a
 * readout window, or the chevron beside one. The label gets everything to the
 * left of it minus the module's own padding and one gap, and never less than
 * `floor`, because a label squeezed to nothing is not a smaller label, it is a
 * column of single letters.
 */
export function labelSpan(
  hardwareLeft: number,
  padX: number,
  gap: number,
  floor = 120,
): number {
  return Math.max(floor, hardwareLeft - padX - gap);
}

// -- hardware sizes ---------------------------------------------------------

/**
 * How big each piece of hardware is drawn, in design px.
 *
 * HERE RATHER THAN IN `cockpit.ts` so the layout maths and the drawing code
 * cannot disagree. `tests/unit/ui/cockpit.test.ts` flows the real Settings
 * column from these numbers and checks it clears the keyboard hint in
 * Devanagari; if that test read a copy of them it would be checking a layout
 * the screen does not draw.
 */
export const HARDWARE = {
  /** Knob body radius; the detent arc sits outside it. */
  /**
   * Knob body radius, with the detent arc outside it.
   *
   * SIZED BY THE FRAME, not by taste. At r=38 the knob row is 130 px tall and
   * six of those plus a wrapped Devanagari label and AC-14.1's note ran the
   * left column 30 px past the keyboard hint - `cockpit.test.ts` flows the real
   * column and caught it. 34 gives the same read (the pointer is carried by the
   * value structure, not by the diameter) and gives the frame back its margin.
   */
  knobR: 34,
  arcInner: 8,
  arcOuter: 16,
  /** The switch guard. */
  guardW: 58,
  guardH: 82,
  leverCap: 9,
  /** One of a selector's position lamps. */
  lampSize: 13,
  /** A readout window. */
  glassPadX: 16,
  glassH: 42,
  glassMinW: 96,
  /** A chevron's half-height. */
  chevron: 9,
  /** Bezel thickness around a console panel. */
  bezel: 14,
  /** Between a selector's readout window and its position lamps. */
  lampGap: 9,
} as const;

/** The knob plus its detent arc, corner to corner. */
export const KNOB_SPAN = (HARDWARE.knobR + HARDWARE.arcOuter) * 2;

/**
 * The height each control type needs for its HARDWARE alone, before its label
 * is measured. A row is the taller of this and its text.
 */
export const HARDWARE_SPAN = {
  knob: KNOB_SPAN + 16,
  switch: HARDWARE.guardH + 16,
  selector:
    HARDWARE.glassH + HARDWARE.lampGap + HARDWARE.lampSize + SPACE.rowPadY * 2,
} as const;

// -- panel frame ------------------------------------------------------------

/**
 * Screw heads: one at each corner, plus one at the middle of each long edge
 * once the panel is tall enough that two screws would look like a lie about how
 * a panel that size is held on.
 */
export function rivetPositions(rect: Rect, inset: number): Point[] {
  const { x, y, w, h } = rect;
  const out: Point[] = [
    { x: x + inset, y: y + inset },
    { x: x + w - inset, y: y + inset },
    { x: x + inset, y: y + h - inset },
    { x: x + w - inset, y: y + h - inset },
  ];
  if (h >= inset * 12) {
    out.push({ x: x + inset, y: y + h / 2 });
    out.push({ x: x + w - inset, y: y + h / 2 });
  }
  return out;
}
