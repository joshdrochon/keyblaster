import Phaser from "phaser";
import { hexToNum } from "@game/render/palette";
import { Control, type ControlStyle } from "./controls.js";
import type { MirrorItem } from "./mirror.js";
import {
  KNOB,
  PANEL,
  type Point,
  type Rect,
  SHADOW_ALPHA,
  clamp01,
  detentStops,
  knobAngleDeg,
  knobTickAngles,
  labelInk,
  lampAlpha,
  leverTip,
  polar,
  readoutInk,
  rivetPositions,
  stepValue,
} from "./panel.js";
import { INK, SPACE, TYPE, rowHeight } from "./theme.js";
import { uiText } from "./text.js";

/**
 * THE CONSOLE, DRAWN (UR-11; D83 vector-in-code; D84 refs are looked at, never
 * loaded).
 *
 * Shape vocabulary traced from `design-reference/refs/cockpit/console-2.png`: a
 * chunky rotary knob with a flat pointer facet catching a top light, an
 * illuminated toggle with an amber glow behind it, a charcoal panel with screws
 * at the corners, and a soft shadow under every piece of hardware. Nothing is
 * loaded from that file and nothing here touches a raster - the reference was
 * looked at, and these are circles, triangles and rounded rectangles.
 *
 * WHAT THE FICTION IS NOT ALLOWED TO COST. In order:
 *
 *  1. AC-18.1. Every control here is `adjustable`, which means Left/Right reach
 *     it through the one `FocusList` the whole game uses, and the screen's gold
 *     focus ring lands on its measured box. A knob you can only drag would be a
 *     regression on the one input this game has.
 *  2. AC-22.8. Every colour comes from `panel.ts`, and every (ink, surface)
 *     pair it can produce is measured at 4.5:1 in tests/unit/ui/cockpit.test.ts.
 *     `cockpit.test.ts` also fails if a hex literal appears in this file, which
 *     is the only way an unmeasured ink could get drawn.
 *  3. LEGIBILITY BEFORE PROP REALISM. Every control keeps its printed value:
 *     the knob keeps the "70%" the pill slider had, the toggle keeps the word
 *     "on", the selector keeps the name of the thing it is set to - each behind
 *     glass, in the accent, at 12.8:1. A knob whose value a seven-year-old
 *     cannot read is worse than the slider it replaced.
 *
 * The light comes from ABOVE, once, for the whole panel: every `Lit` token is a
 * top facet and every `Shade` token is an underside, and no control invents its
 * own light direction (art-direction s5).
 */

// ---------------------------------------------------------------------------
// Hardware sizes
// ---------------------------------------------------------------------------

const HW = {
  /** Knob body radius; the detent arc sits outside it. */
  knobR: 34,
  arcInner: 8,
  arcOuter: 17,
  /** The switch guard. */
  guardW: 50,
  guardH: 78,
  lampH: 20,
  leverCap: 8,
  /** The selector's position lamps. */
  lampSize: 13,
  /** A readout window. */
  glassPadX: 16,
  glassH: 42,
  glassMinW: 96,
  /** Chevron half-height and reach. */
  chevron: 9,
  /** Bezel thickness around a console panel. */
  bezel: 14,
} as const;

const KNOB_SPAN = (HW.knobR + HW.arcOuter) * 2;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** The soft shadow every raised piece of hardware casts, down and right. */
function castShadowCircle(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  r: number,
): void {
  g.fillStyle(hexToNum(PANEL.shadow), SHADOW_ALPHA);
  g.fillCircle(cx + 2, cy + 5, r);
}

/** A screw head: a dark socket, a lit crown, and a slot. */
function drawRivet(g: Phaser.GameObjects.Graphics, p: Point, r: number): void {
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
function drawGlass(
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

/** ‹ or › beside a control that cycles. */
function drawChevron(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  dir: 1 | -1,
  color: string,
): void {
  g.fillStyle(hexToNum(color), 1);
  g.fillTriangle(
    x,
    y - HW.chevron,
    x + 11 * dir,
    y,
    x,
    y + HW.chevron,
  );
}

/**
 * THE ROTARY POT.
 *
 * Read three ways at once, on purpose: the pointer's ANGLE, the lit part of the
 * detent ARC, and the printed NUMBER beside it. Two of the three survive being
 * desaturated (rubric 4) and all three survive the colourblind palette, so no
 * single channel is carrying the value.
 */
function drawKnob(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  value01: number,
  accent: string,
  focused: boolean,
): void {
  const r = HW.knobR;
  const value = clamp01(value01);
  const ticks = knobTickAngles();

  castShadowCircle(g, cx, cy, r + 2);

  // The detented arc. Ticks up to the value burn in the accent; the rest are
  // engraved marks. The arc is OUTSIDE the knob so the hand never covers it.
  ticks.forEach((deg, i) => {
    const lit = i / (ticks.length - 1) <= value + 1e-9;
    const a = polar(cx, cy, r + HW.arcInner, deg);
    const b = polar(cx, cy, r + HW.arcOuter, deg);
    g.lineStyle(
      lit ? 4 : 3,
      hexToNum(lit ? accent : PANEL.tick),
      lit ? (focused ? 1 : 0.88) : 0.85,
    );
    g.lineBetween(a.x, a.y, b.x, b.y);
  });

  // Skirt, body, and the flat facet on top where the light lands.
  g.fillStyle(hexToNum(PANEL.knobShade), 1);
  g.fillCircle(cx, cy, r);
  g.fillStyle(hexToNum(PANEL.knob), 1);
  g.fillCircle(cx, cy, r - 3);
  g.fillStyle(hexToNum(PANEL.knobLit), 1);
  g.fillCircle(cx - 2, cy - 3, r - 9);
  g.lineStyle(2, hexToNum(PANEL.knobShade), 0.75);
  g.strokeCircle(cx - 2, cy - 3, r - 9);
  if (focused) {
    g.lineStyle(3, hexToNum(accent), 0.9);
    g.strokeCircle(cx, cy, r + 1);
  }

  // The pointer: a tapered facet from the collar to the rim, in the brightest
  // metal on the panel so it reads against both the lit and shaded halves.
  const deg = knobAngleDeg(value);
  const along = { x: Math.sin((deg * Math.PI) / 180), y: -Math.cos((deg * Math.PI) / 180) };
  const perp = { x: -along.y, y: along.x };
  const base = polar(cx, cy, 5, deg);
  const tip = polar(cx, cy, r - 5, deg);
  g.fillStyle(hexToNum(PANEL.pointer), 1);
  g.fillPoints(
    [
      new Phaser.Geom.Point(base.x + perp.x * 5, base.y + perp.y * 5),
      new Phaser.Geom.Point(tip.x + perp.x * 2.5, tip.y + perp.y * 2.5),
      new Phaser.Geom.Point(tip.x - perp.x * 2.5, tip.y - perp.y * 2.5),
      new Phaser.Geom.Point(base.x - perp.x * 5, base.y - perp.y * 5),
    ],
    true,
  );
  // The collar the pointer turns on.
  g.fillStyle(hexToNum(PANEL.knobShade), 1);
  g.fillCircle(cx, cy, 4);
}

/**
 * THE ILLUMINATED TOGGLE.
 *
 * Up is on. The lamp under the lever burns and an amber wash spills onto the
 * face behind the guard, which is the thing the reference plate does and the
 * thing a flat "on / off" caption cannot do. The WORD is still printed beside
 * it (D41: colour is never the only carrier), and the lever's own position is a
 * third encoding that survives a greyscale print.
 */
function drawSwitch(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  on: boolean,
  accent: string,
  focused: boolean,
): void {
  const w = HW.guardW;
  const h = HW.guardH;
  const x = cx - w / 2;
  const y = cy - h / 2;

  // The glow behind the guard, spilling onto the panel face. This is the thing
  // the reference plate does that a flat "on" caption cannot: the switch lights
  // the metal around it.
  if (on) {
    g.fillStyle(hexToNum(accent), 0.18);
    g.fillRoundedRect(x - 9, y - 7, w + 18, h + 18, 20);
    g.fillStyle(hexToNum(accent), 0.09);
    g.fillRoundedRect(x - 18, y - 14, w + 36, h + 32, 26);
  }

  // A RAISED metal guard, not a recess. The first pass cut the guard into the
  // same dark the control's own plate was drawn in, so the whole switch was one
  // dark shape with a white dot in it.
  g.fillStyle(hexToNum(PANEL.shadow), SHADOW_ALPHA);
  g.fillRoundedRect(x + 1, y + 5, w, h, 14);
  g.fillStyle(hexToNum(PANEL.knobShade), 1);
  g.fillRoundedRect(x, y, w, h, 14);
  g.fillStyle(hexToNum(PANEL.knob), 1);
  g.fillRoundedRect(x, y, w, h - 4, 14);
  g.lineStyle(2, hexToNum(focused ? accent : PANEL.knobLit), focused ? 1 : 0.55);
  g.strokeRoundedRect(x, y, w, h - 4, 14);

  // The slot the lever travels in, milled through the guard.
  g.fillStyle(hexToNum(PANEL.glass), 1);
  g.fillRoundedRect(x + 7, y + 7, w - 14, h - 18, 9);

  // The lamp at the foot of the slot, where the lever never covers it. Off, it
  // is still a bulb behind glass with a lit rim - a lamp you cannot see is a
  // lamp a child cannot learn to read.
  const lampY = y + h - HW.lampH - 12;
  const lampX = x + 11;
  const lampW = w - 22;
  g.fillStyle(hexToNum(accent), lampAlpha(on));
  g.fillRoundedRect(lampX, lampY, lampW, HW.lampH, 5);
  g.lineStyle(2, hexToNum(on ? accent : PANEL.lip), 1);
  g.strokeRoundedRect(lampX, lampY, lampW, HW.lampH, 5);

  // The lever, thrown. A BRIGHT shaft with a dark collar, as on the reference
  // plate: it has to be the lightest thing in the slot or the throw is invisible.
  const pivot = { x: cx, y: cy + 2 };
  const tip = leverTip(pivot.x, pivot.y, on);
  g.lineStyle(16, hexToNum(PANEL.knobShade), 1);
  g.lineBetween(pivot.x, pivot.y, tip.x, tip.y);
  g.lineStyle(11, hexToNum(PANEL.knobLit), 1);
  g.lineBetween(pivot.x, pivot.y, tip.x, tip.y);
  g.fillStyle(hexToNum(PANEL.pointer), 1);
  g.fillCircle(tip.x, tip.y, HW.leverCap);
  g.fillStyle(hexToNum(PANEL.knobShade), 1);
  g.fillCircle(pivot.x, pivot.y, 10);
  g.fillStyle(hexToNum(PANEL.knob), 1);
  g.fillCircle(pivot.x, pivot.y, 7);
}

/**
 * THE SELECTOR'S POSITIONS: one lamp per choice, on an engraved index line,
 * with the one you are on burning.
 *
 * It is NOT a track with a thumb. The first pass drew exactly that, and a small
 * filled bar with a marker sliding along it is a pill slider - the shape this
 * whole change exists to remove - printed under every option row on the screen.
 * A row of lamps says the thing a printed word cannot ("there are four of these
 * and you are on the second") without borrowing the vocabulary of a continuous
 * control for a discrete one.
 */
function drawPositionLamps(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  index: number,
  count: number,
  accent: string,
  focused: boolean,
): void {
  const size = HW.lampSize;
  const stops = detentStops(x, w, count, size / 2 + 2);
  if (stops.length === 0) return;

  // The engraved index line the lamps are set into: a hairline, never a filled
  // track, so this cannot read as something that slides.
  const first = stops[0] ?? x;
  const last = stops[stops.length - 1] ?? x;
  if (stops.length > 1) {
    g.lineStyle(1, hexToNum(PANEL.lip), 0.8);
    g.lineBetween(first, y + size / 2, last, y + size / 2);
  }

  stops.forEach((sx, i) => {
    const lx = sx - size / 2;
    const lit = i === index;
    if (lit) {
      g.fillStyle(hexToNum(accent), 0.22);
      g.fillRoundedRect(lx - 5, y - 5, size + 10, size + 10, 8);
    }
    g.fillStyle(hexToNum(lit ? accent : PANEL.glass), 1);
    g.fillRoundedRect(lx, y, size, size, 4);
    g.lineStyle(2, hexToNum(lit ? accent : PANEL.lip), lit && focused ? 1 : 0.85);
    g.strokeRoundedRect(lx, y, size, size, 4);
  });
}

/**
 * THE CONSOLE FACE a column of controls is screwed to.
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
): void {
  const { x, y, w, h } = rect;
  const b = HW.bezel;

  g.fillStyle(hexToNum(PANEL.faceShade), 1);
  g.fillRoundedRect(x, y, w, h, 26);
  g.lineStyle(2, hexToNum(PANEL.lip), 1);
  g.strokeRoundedRect(x, y, w, h, 26);

  const fx = x + b;
  const fy = y + b;
  const fw = w - b * 2;
  const fh = h - b * 2;
  g.fillStyle(hexToNum(PANEL.face), 1);
  g.fillRoundedRect(fx, fy, fw, fh, 16);

  const bands = 22;
  const reach = Math.min(fh * 0.55, 260);
  for (let i = 0; i < bands; i += 1) {
    const t = i / bands;
    g.fillStyle(hexToNum(PANEL.faceLit), 0.42 * (1 - t) ** 2);
    g.fillRect(fx + 16, fy + 2 + (reach * i) / bands, fw - 32, reach / bands + 1);
  }

  // The engraved seam where the face meets the bezel: lit along the top edge,
  // in shadow along the bottom.
  g.lineStyle(2, hexToNum(PANEL.lip), 0.85);
  g.lineBetween(fx + 16, fy + 1, fx + fw - 16, fy + 1);
  g.lineStyle(2, hexToNum(PANEL.faceShade), 1);
  g.lineBetween(fx + 16, fy + fh - 1, fx + fw - 16, fy + fh - 1);

  for (const p of rivetPositions(rect, 22)) drawRivet(g, p, 9);
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

/**
 * What every control on this panel shares: a milled bay, an engraved label on
 * the left, and its hardware in a column down the right so the eye reads one
 * instrument stack rather than eight unrelated widgets.
 */
abstract class PanelControl extends Control {
  protected readonly title: Phaser.GameObjects.Text;

  protected constructor(
    scene: Phaser.Scene,
    style: ControlStyle,
    id: string,
    x: number,
    y: number,
    depth: number,
    label: string,
    width: number,
    labelWrap: number,
  ) {
    super(scene, style, id, x, y, depth);
    this.adjustable = true;
    this.boxW = width;
    this.title = uiText(scene, SPACE.rowPadX, 0, label, {
      size: TYPE.label,
      lang: style.lang,
      uppercase: style.uppercase,
      increasedLetterSpacing: style.increasedLetterSpacing,
      wrapWidth: labelWrap,
    });
    this.container.add(this.title);
  }

  /**
   * The recess this control sits in. A bay is DARK AT THE TOP and LIT ALONG THE
   * BOTTOM, which is what tells the eye it is cut into the face rather than
   * sitting on it - the inverse of the shadow every knob and shuttle casts.
   */
  protected paintBay(): void {
    this.g.clear();
    const r = SPACE.radius;
    // A MODULE BOLTED TO THE FACE, one step darker than it - not the darkest
    // thing on the panel. The first pass made every module `PANEL.bay`, which
    // is the same dark the glass readouts and switch slots are cut from, so
    // every recess inside a module vanished into the module around it.
    this.g.fillStyle(
      hexToNum(this.focused ? PANEL.bay : PANEL.faceShade),
      this.focused ? 1 : 0.88,
    );
    this.g.fillRoundedRect(0, 0, this.boxW, this.boxH, r);
    // The seam: dark along the top edge, lit along the bottom. That one pair of
    // lines is what says the module is set INTO the face under a light from
    // above, and it is the same rule every recess on this panel follows.
    this.g.lineStyle(2, hexToNum(PANEL.shadow), 0.5);
    this.g.lineBetween(r, 1, this.boxW - r, 1);
    this.g.lineStyle(2, hexToNum(PANEL.lip), 0.7);
    this.g.lineBetween(r, this.boxH - 1, this.boxW - r, this.boxH - 1);
    this.g.lineStyle(
      this.focused ? 3 : 2,
      hexToNum(this.focused ? this.style.accent : PANEL.lip),
      this.focused ? 1 : 0.55,
    );
    this.g.strokeRoundedRect(0, 0, this.boxW, this.boxH, r);
    this.title.setColor(labelInk(this.focused));
  }

  /** Centre the label vertically in whatever height the hardware forced. */
  protected centreTitle(): void {
    this.title.setY(Math.round((this.boxH - this.title.height) / 2));
  }

  /**
   * Widest a set of strings renders in the current language, so a readout
   * window does not resize - and the hardware beside it does not jump - when
   * the value changes. Measured, never estimated: "small letters" ->
   * "letras pequeñas" is +40%.
   */
  protected measureWidest(candidates: readonly string[]): number {
    let widest = 0;
    for (const candidate of candidates) {
      const probe = uiText(this.scene, 0, 0, candidate, {
        size: TYPE.label,
        lang: this.style.lang,
        uppercase: this.style.uppercase,
        increasedLetterSpacing: this.style.increasedLetterSpacing,
        chrome: false,
      });
      widest = Math.max(widest, probe.width);
      probe.destroy();
    }
    return Math.ceil(widest);
  }
}

// -- knob -------------------------------------------------------------------

export interface KnobOptions {
  readonly label: string;
  readonly width: number;
  readonly value: number;
  readonly step?: number;
  readonly onChange: (value: number) => void;
  /** Formats the number for the glass and the mirror, e.g. "70%". */
  readonly format: (value: number) => string;
}

/**
 * A 0..1 rotary control: music, sound.
 *
 * Left/Right turn it one detent. Enter is deliberately a no-op, exactly as the
 * slider it replaces was, so a child pressing Enter on a volume cannot mute the
 * game by accident.
 */
export class KnobRow extends PanelControl {
  private value: number;
  private readonly step: number;
  private readonly readout: Phaser.GameObjects.Text;
  private readonly onChange: (value: number) => void;
  private readonly format: (value: number) => string;
  private readonly knobCx: number;
  private readonly glassX: number;
  private readonly glassW: number;

  constructor(
    scene: Phaser.Scene,
    style: ControlStyle,
    id: string,
    x: number,
    y: number,
    depth: number,
    options: KnobOptions,
  ) {
    super(
      scene,
      style,
      id,
      x,
      y,
      depth,
      options.label,
      options.width,
      options.width * 0.4,
    );
    this.value = clamp01(options.value);
    this.step = options.step ?? KNOB.step;
    this.onChange = options.onChange;
    this.format = options.format;

    this.knobCx = this.boxW - SPACE.rowPadX - KNOB_SPAN / 2;
    this.glassW = Math.max(
      HW.glassMinW,
      this.measureWidest([options.format(0), options.format(1), options.format(this.value)]) +
        HW.glassPadX * 2,
    );
    this.glassX = this.knobCx - KNOB_SPAN / 2 - SPACE.gap - this.glassW;

    this.readout = uiText(scene, 0, 0, this.format(this.value), {
      size: TYPE.label,
      color: readoutInk(style.accent),
      lang: style.lang,
      uppercase: style.uppercase,
      increasedLetterSpacing: style.increasedLetterSpacing,
      chrome: false,
    });
    this.boxH = Math.max(
      rowHeight(TYPE.label, style.lang),
      KNOB_SPAN + 16,
      this.title.height + SPACE.rowPadY * 2,
    );
    this.centreTitle();
    this.container.add(this.readout);
    this.layout();
    this.redraw();
  }

  private layout(): void {
    this.readout.setX(Math.round(this.glassX + (this.glassW - this.readout.width) / 2));
    this.readout.setY(Math.round((this.boxH - this.readout.height) / 2));
  }

  private set(next: number): void {
    if (next === this.value) return;
    this.value = next;
    this.readout.setText(this.format(next));
    this.layout();
    this.redraw();
    this.onChange(next);
  }

  override adjust(delta: number): void {
    this.set(stepValue(this.value, delta, this.step));
  }

  protected redraw(): void {
    this.paintBay();
    drawGlass(
      this.g,
      this.glassX,
      Math.round((this.boxH - HW.glassH) / 2),
      this.glassW,
      HW.glassH,
    );
    drawKnob(
      this.g,
      this.knobCx,
      this.boxH / 2,
      this.value,
      this.style.accent,
      this.focused,
    );
    this.container.bringToTop(this.readout);
  }

  toMirror(): MirrorItem {
    return {
      id: this.id,
      role: "slider",
      label: this.title.text,
      value: this.format(this.value),
    };
  }
}

// -- switch -----------------------------------------------------------------

export interface SwitchOptions {
  readonly label: string;
  readonly width: number;
  readonly value: boolean;
  readonly onLabel: string;
  readonly offLabel: string;
  readonly onChange: (value: boolean) => void;
}

/** A binary: calm motion, wider letters, the colour-safe palette. */
export class SwitchRow extends PanelControl {
  private value: boolean;
  private readonly state: Phaser.GameObjects.Text;
  private readonly onChange: (value: boolean) => void;
  private readonly onLabel: string;
  private readonly offLabel: string;
  private readonly switchCx: number;
  private readonly glassX: number;
  private readonly glassW: number;

  constructor(
    scene: Phaser.Scene,
    style: ControlStyle,
    id: string,
    x: number,
    y: number,
    depth: number,
    options: SwitchOptions,
  ) {
    super(
      scene,
      style,
      id,
      x,
      y,
      depth,
      options.label,
      options.width,
      options.width * 0.46,
    );
    this.value = options.value;
    this.onChange = options.onChange;
    this.onLabel = options.onLabel;
    this.offLabel = options.offLabel;

    this.switchCx = this.boxW - SPACE.rowPadX - HW.guardW / 2;
    this.glassW = Math.max(
      HW.glassMinW,
      this.measureWidest([this.word(true), this.word(false)]) + HW.glassPadX * 2,
    );
    this.glassX = this.switchCx - HW.guardW / 2 - SPACE.gap - this.glassW;

    this.state = uiText(scene, 0, 0, this.word(this.value), {
      size: TYPE.label,
      color: readoutInk(style.accent),
      lang: style.lang,
      uppercase: style.uppercase,
      increasedLetterSpacing: style.increasedLetterSpacing,
      chrome: false,
    });
    this.boxH = Math.max(
      rowHeight(TYPE.label, style.lang),
      HW.guardH + 16,
      this.title.height + SPACE.rowPadY * 2,
    );
    this.centreTitle();
    this.container.add(this.state);
    this.layout();
    this.redraw();
  }

  /** The state word, already in the D41 letter case the screen is drawn in. */
  private word(on: boolean): string {
    const raw = on ? this.onLabel : this.offLabel;
    return this.style.uppercase ? raw.toLocaleUpperCase() : raw.toLocaleLowerCase();
  }

  private layout(): void {
    this.state.setX(Math.round(this.glassX + (this.glassW - this.state.width) / 2));
    this.state.setY(Math.round((this.boxH - this.state.height) / 2));
  }

  private set(value: boolean): void {
    if (this.value === value) return;
    this.value = value;
    this.state.setText(this.word(value));
    this.layout();
    this.redraw();
    this.onChange(value);
  }

  override activate(): void {
    this.set(!this.value);
  }

  override adjust(delta: number): void {
    this.set(delta > 0);
  }

  protected redraw(): void {
    this.paintBay();
    drawGlass(
      this.g,
      this.glassX,
      Math.round((this.boxH - HW.glassH) / 2),
      this.glassW,
      HW.glassH,
    );
    drawSwitch(
      this.g,
      this.switchCx,
      this.boxH / 2,
      this.value,
      this.style.accent,
      this.focused,
    );
    this.container.bringToTop(this.state);
  }

  toMirror(): MirrorItem {
    return {
      id: this.id,
      role: "toggle",
      label: this.title.text,
      value: this.value ? "on" : "off",
    };
  }
}

// -- selector ---------------------------------------------------------------

export interface SelectorChoice<T extends string> {
  readonly value: T;
  readonly label: string;
}

export interface SelectorOptions<T extends string> {
  readonly label: string;
  readonly width: number;
  readonly value: T;
  readonly choices: readonly SelectorChoice<T>[];
  readonly onChange: (value: T) => void;
  /** One calm line under the row, e.g. why a language is not offered. */
  readonly note?: string;
}

/**
 * A small fixed set with physical positions: keyboard layout, input method,
 * letter case, language.
 *
 * The value is printed behind glass with a chevron each side, and the detent
 * track under it says how many positions there are and which one this is.
 */
export class SelectorRow<T extends string> extends PanelControl {
  private index: number;
  private readonly choices: readonly SelectorChoice<T>[];
  private readonly readout: Phaser.GameObjects.Text;
  private readonly note: Phaser.GameObjects.Text | null;
  private readonly onChange: (value: T) => void;
  private readonly glassX: number;
  private readonly glassW: number;
  private headH = 0;

  constructor(
    scene: Phaser.Scene,
    style: ControlStyle,
    id: string,
    x: number,
    y: number,
    depth: number,
    options: SelectorOptions<T>,
  ) {
    super(
      scene,
      style,
      id,
      x,
      y,
      depth,
      options.label,
      options.width,
      options.width * 0.42,
    );
    this.choices = options.choices;
    this.onChange = options.onChange;
    this.index = Math.max(
      0,
      options.choices.findIndex((c) => c.value === options.value),
    );

    this.glassW = Math.max(
      HW.glassMinW,
      this.measureWidest(options.choices.map((c) => c.label)) + HW.glassPadX * 2,
    );
    // A chevron's reach plus its breathing room, each side of the window.
    this.glassX = this.boxW - SPACE.rowPadX - 26 - this.glassW;

    this.readout = uiText(scene, 0, 0, this.currentLabel(), {
      size: TYPE.label,
      color: readoutInk(style.accent),
      lang: style.lang,
      uppercase: style.uppercase,
      increasedLetterSpacing: style.increasedLetterSpacing,
      // Language names are proper nouns: "español" and "हिंदी" are written the
      // way that language writes them, whatever the letter-case setting says.
      chrome: false,
    });
    this.note =
      options.note === undefined
        ? null
        : uiText(scene, SPACE.rowPadX, 0, options.note, {
            size: TYPE.caption,
            color: INK.textDim,
            lang: style.lang,
            uppercase: style.uppercase,
            increasedLetterSpacing: style.increasedLetterSpacing,
            wrapWidth: options.width - SPACE.rowPadX * 2,
          });

    this.headH = Math.max(
      rowHeight(TYPE.label, style.lang),
      HW.glassH + 9 + HW.lampSize + SPACE.rowPadY * 2,
      this.title.height + SPACE.rowPadY * 2,
    );
    this.boxH = this.headH + (this.note ? this.note.height + 10 : 0);
    this.title.setY(Math.round((this.headH - this.title.height) / 2));
    this.note?.setY(this.headH - 4);
    this.container.add(this.readout);
    if (this.note) this.container.add(this.note);
    this.layout();
    this.redraw();
  }

  private currentLabel(): string {
    return this.choices[this.index]?.label ?? "";
  }

  private get glassY(): number {
    return Math.round((this.headH - (HW.glassH + 9 + HW.lampSize)) / 2);
  }

  private layout(): void {
    this.readout.setX(Math.round(this.glassX + (this.glassW - this.readout.width) / 2));
    this.readout.setY(
      Math.round(this.glassY + (HW.glassH - this.readout.height) / 2),
    );
  }

  get value(): T | undefined {
    return this.choices[this.index]?.value;
  }

  override adjust(delta: number): void {
    if (this.choices.length === 0) return;
    const n = this.choices.length;
    this.index = (((this.index + delta) % n) + n) % n;
    this.readout.setText(this.currentLabel());
    this.layout();
    this.redraw();
    const next = this.choices[this.index];
    if (next) this.onChange(next.value);
  }

  override activate(): void {
    this.adjust(1);
  }

  protected redraw(): void {
    this.paintBay();
    const gy = this.glassY;
    drawGlass(this.g, this.glassX, gy, this.glassW, HW.glassH);
    const mid = gy + HW.glassH / 2;
    const chevron = this.focused ? this.style.accent : INK.textDim;
    drawChevron(this.g, this.glassX - 10, mid, -1, chevron);
    drawChevron(this.g, this.glassX + this.glassW + 10, mid, 1, chevron);
    drawPositionLamps(
      this.g,
      this.glassX,
      gy + HW.glassH + 9,
      this.glassW,
      this.index,
      this.choices.length,
      this.style.accent,
      this.focused,
    );
    this.container.bringToTop(this.readout);
  }

  toMirror(): MirrorItem {
    const base: MirrorItem = {
      id: this.id,
      role: "option",
      label: this.title.text,
      value: this.value ?? "",
    };
    // The note is part of what this row SAYS - AC-14.1's "pick a Hindi
    // keyboard" line is the whole explanation for a missing option - so it
    // belongs in the mirror, not only on the canvas.
    return this.note ? { ...base, detail: this.note.text } : base;
  }
}
