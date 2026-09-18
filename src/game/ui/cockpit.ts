import Phaser from "phaser";
import { hexToNum } from "@game/render/palette";
import { Control, type ControlStyle } from "./controls.js";
import type { Rect } from "./layout.js";
import type { MirrorItem } from "./mirror.js";
import {
  HARDWARE,
  HARDWARE_SPAN,
  KNOB,
  KNOB_SPAN,
  PANEL,
  SHADOW_ALPHA,
  clamp01,
  knobAngleDeg,
  knobTickAngles,
  labelInk,
  labelSpan,
  lampAlpha,
  leverTip,
  polar,
  readoutInk,
  stepValue,
} from "./panel.js";
/**
 * THE CONSOLE'S OWN VOCABULARY LIVES IN `controlSurface.ts` (UR-61).
 *
 * The face, the screws, the glass recesses and the lamp row were private to
 * this file, which is why the Briefing's control strip could not use them and
 * why it drew a bar with circles on it instead. They are shared now and this
 * screen is one of the two callers, not the owner (standards rule 1: a screen
 * is a component, and the console is a surface both screens mount things on).
 *
 * `drawConsoleFace` is re-exported because `SettingsScene` imports it from
 * here, and one import path is worth more than a tidy diff.
 */
import {
  castShadowCircle,
  drawConsoleFace,
  drawGlass,
  drawPositionLamps,
} from "./controlSurface.js";
import { drawShip } from "./chrome.js";
import { INK, SPACE, TYPE, rowHeight } from "./theme.js";
import { plateWidth, uiText } from "./text.js";

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
 *     glass, in the accent, at 13.1:1. A knob whose value a seven-year-old
 *     cannot read is worse than the slider it replaced.
 *
 * The light comes from ABOVE, once, for the whole panel: every `Lit` token is a
 * top facet and every `Shade` token is an underside, and no control invents its
 * own light direction (art-direction s5).
 */

// ---------------------------------------------------------------------------
// Hardware sizes
// ---------------------------------------------------------------------------

/** Hardware sizes live in `panel.ts`, beside the layout maths that use them. */
const HW = HARDWARE;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

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

  castShadowCircle(g, cx, cy, r + 3);

  // The detented arc. Ticks up to the value burn in the accent; the rest are
  // engraved marks. The arc is OUTSIDE the knob so a hand on the knob never
  // covers the one part of it that says how far round it is.
  ticks.forEach((deg, i) => {
    const lit = i / (ticks.length - 1) <= value + 1e-9;
    const a = polar(cx, cy, r + HW.arcInner, deg);
    const b = polar(cx, cy, r + HW.arcOuter, deg);
    g.lineStyle(
      lit ? 5 : 3,
      hexToNum(lit ? accent : PANEL.tick),
      lit ? (focused ? 1 : 0.9) : 0.8,
    );
    g.lineBetween(a.x, a.y, b.x, b.y);
  });

  // THE VALUE STRUCTURE IS WHAT MAKES THE POINTER READ. Lit rim, dark skirt,
  // mid-grey face, white pointer: four steps, in that order, so the pointer is
  // the brightest thing inside the knob by a long way. The first pass put a
  // near-white facet on top and a white pointer on it, and the pointer - the
  // only part that carries the value - was the one thing you could not see.
  g.fillStyle(hexToNum(PANEL.knobLit), 1);
  g.fillCircle(cx, cy, r);
  // The body sits a little low in its rim, so the lit metal shows along the
  // TOP edge: one light, from above, for the whole panel.
  g.fillStyle(hexToNum(PANEL.knobShade), 1);
  g.fillCircle(cx, cy + 2, r - 2);
  g.fillStyle(hexToNum(PANEL.knob), 1);
  g.fillCircle(cx, cy + 2, r - 8);
  if (focused) {
    g.lineStyle(3, hexToNum(accent), 0.95);
    g.strokeCircle(cx, cy, r + 1);
  }

  // The pointer: a tapered facet from the collar to the rim, in the brightest
  // metal on the panel.
  const deg = knobAngleDeg(value);
  const along = {
    x: Math.sin((deg * Math.PI) / 180),
    y: -Math.cos((deg * Math.PI) / 180),
  };
  const perp = { x: -along.y, y: along.x };
  const base = polar(cx, cy + 2, 4, deg);
  const tip = polar(cx, cy + 2, r - 9, deg);
  g.fillStyle(hexToNum(PANEL.pointer), 1);
  g.fillPoints(
    [
      new Phaser.Geom.Point(base.x + perp.x * 6, base.y + perp.y * 6),
      new Phaser.Geom.Point(tip.x + perp.x * 3, tip.y + perp.y * 3),
      new Phaser.Geom.Point(tip.x - perp.x * 3, tip.y - perp.y * 3),
      new Phaser.Geom.Point(base.x - perp.x * 6, base.y - perp.y * 6),
    ],
    true,
  );
  // The collar the pointer turns on.
  g.fillStyle(hexToNum(PANEL.knobShade), 1);
  g.fillCircle(cx, cy + 2, 5);
}

/**
 * THE ILLUMINATED TOGGLE.
 *
 * Up is on. The whole slot behind the lever burns, and an amber wash spills
 * onto the metal around the guard - which is the thing the reference plate does
 * and the thing a flat "on / off" caption cannot. The WORD is still printed
 * beside it (D41: colour is never the only carrier), and the lever's own
 * position is a third encoding that survives a greyscale print.
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

  // The glow spilling onto the panel around a switch that is on. This is the
  // thing the reference plate does that a flat "on" caption cannot: the switch
  // lights the metal it is screwed to.
  if (on) {
    g.fillStyle(hexToNum(accent), 0.18);
    g.fillRoundedRect(x - 9, y - 7, w + 18, h + 18, 22);
    g.fillStyle(hexToNum(accent), 0.09);
    g.fillRoundedRect(x - 19, y - 15, w + 38, h + 34, 28);
  }

  // A RAISED metal guard, not a recess. The first pass cut the guard from the
  // same dark its own module was drawn in, so the whole switch was one dark
  // shape with a white dot floating in it.
  g.fillStyle(hexToNum(PANEL.shadow), SHADOW_ALPHA);
  g.fillRoundedRect(x + 2, y + 6, w, h, 16);
  g.fillStyle(hexToNum(PANEL.knobShade), 1);
  g.fillRoundedRect(x, y, w, h, 16);
  g.fillStyle(hexToNum(PANEL.knob), 1);
  g.fillRoundedRect(x, y, w, h - 5, 16);
  g.lineStyle(2, hexToNum(focused ? accent : PANEL.knobLit), focused ? 1 : 0.5);
  g.strokeRoundedRect(x, y, w, h - 5, 16);

  // THE SLOT IS THE LAMP. A separate lamp square had to go somewhere the lever
  // never covered, which left no room for a throw worth looking at; backlighting
  // the whole window instead means the lit state is the biggest thing on the
  // control and the lever still has the full slot to swing in.
  const sx = x + 8;
  const sy = y + 7;
  const sw = w - 16;
  const sh = h - 22;
  g.fillStyle(hexToNum(PANEL.glass), 1);
  g.fillRoundedRect(sx, sy, sw, sh, 10);
  g.fillStyle(hexToNum(accent), lampAlpha(on));
  g.fillRoundedRect(sx, sy, sw, sh, 10);
  g.lineStyle(2, hexToNum(PANEL.knobShade), 1);
  g.strokeRoundedRect(sx, sy, sw, sh, 10);

  // The lever: a bright shaft inside a dark outline, and a white cap inside a
  // dark ring. Both halves matter - the bright core is what reads against a
  // dark slot, the dark outline is what reads against a burning one.
  const pivot = { x: cx, y: cy + 1 };
  const tip = leverTip(pivot.x, pivot.y, on);
  g.lineStyle(17, hexToNum(PANEL.knobShade), 1);
  g.lineBetween(pivot.x, pivot.y, tip.x, tip.y);
  g.lineStyle(11, hexToNum(PANEL.knobLit), 1);
  g.lineBetween(pivot.x, pivot.y, tip.x, tip.y);
  g.fillStyle(hexToNum(PANEL.knobShade), 1);
  g.fillCircle(tip.x, tip.y, HW.leverCap + 2);
  g.fillStyle(hexToNum(PANEL.pointer), 1);
  g.fillCircle(tip.x, tip.y, HW.leverCap);
  g.fillStyle(hexToNum(PANEL.knobShade), 1);
  g.fillCircle(pivot.x, pivot.y, 11);
  g.fillStyle(hexToNum(PANEL.knob), 1);
  g.fillCircle(pivot.x, pivot.y, 8);
}

export { drawConsoleFace };

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

/**
 * What every control on this panel shares: a module plate bolted to the face,
 * an engraved label down the left, and its hardware in a column down the right
 * so the eye reads one instrument stack rather than nine unrelated widgets.
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
  ) {
    super(scene, style, id, x, y, depth);
    this.adjustable = true;
    this.boxW = width;
    this.title = uiText(scene, SPACE.rowPadX, 0, label, {
      size: TYPE.label,
      lang: style.lang,
      uppercase: style.uppercase,
      increasedLetterSpacing: style.increasedLetterSpacing,
      wrapWidth: width,
    });
    this.container.add(this.title);
  }

  /**
   * Wrap the label so it CANNOT reach the hardware, measured rather than
   * guessed at a fraction of the module width.
   *
   * WHY IT LOOPS. `uiText` applies D41 letter spacing with `setLetterSpacing`,
   * which Phaser adds AFTER it has word-wrapped - so a label wrapped to 340 px
   * measures wider than 340 px the moment "wider letters" is on, and
   * "how you type hindi" printed straight through the chevron beside it. The
   * wrap width is the request; `width` is what was actually drawn, so the only
   * honest fit is to re-wrap until the drawn width is inside the span.
   */
  protected fitLabel(hardwareLeft: number): void {
    const span = labelSpan(hardwareLeft, SPACE.rowPadX, SPACE.gap);
    let wrap = span;
    this.title.setWordWrapWidth(wrap, true);
    for (let i = 0; i < 12 && this.title.width > span && wrap > 100; i += 1) {
      wrap -= Math.max(8, Math.round(this.title.width - span));
      this.title.setWordWrapWidth(wrap, true);
    }
  }

  /**
   * The module plate this control's hardware is mounted on. It is DARK ALONG
   * THE TOP EDGE and LIT ALONG THE BOTTOM, which is what tells the eye it is
   * set into the face under a light from above - the exact inverse of the
   * shadow every knob, key and switch guard casts downward.
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
    this.fitLabel(this.glassX);

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
      HARDWARE_SPAN.knob,
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
    this.fitLabel(this.glassX);

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
      HARDWARE_SPAN.switch,
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
    // The LEFT chevron is the leftmost hardware on this row, not the window.
    this.fitLabel(this.glassX - 26);

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
      HARDWARE_SPAN.selector,
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
    return Math.round((this.headH - (HW.glassH + HW.lampGap + HW.lampSize)) / 2);
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
      gy + HW.lampGap + HW.glassH,
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

// -- panel key --------------------------------------------------------------

export interface PanelButtonOptions {
  readonly label: string;
  readonly minWidth?: number;
  readonly onPress: () => void;
}

/**
 * A KEY ON THE PANEL, for the one action this screen has.
 *
 * `MenuButton` is the rest of the game's button and it is left exactly as it
 * is - it is on six other screens. But a web-form button in the middle of a
 * milled console is the loudest remaining tell that this is a menu, so the one
 * on this panel is a key: a raised cap with a lit bevel, sitting in its own
 * shadow, under the same light as every other piece of hardware here.
 *
 * It is NOT red and NOT flagged, in keeping with D31 / AC-22b.1: reset progress
 * is drawn in the same calm ink as everything else and asks twice instead.
 */
export class PanelButton extends Control {
  private readonly text: Phaser.GameObjects.Text;
  private readonly label: string;
  private readonly onPress: () => void;

  constructor(
    scene: Phaser.Scene,
    style: ControlStyle,
    id: string,
    x: number,
    y: number,
    depth: number,
    options: PanelButtonOptions,
  ) {
    super(scene, style, id, x, y, depth);
    this.label = options.label;
    this.onPress = options.onPress;
    this.text = uiText(scene, 0, 0, options.label, {
      size: TYPE.body,
      lang: style.lang,
      uppercase: style.uppercase,
      increasedLetterSpacing: style.increasedLetterSpacing,
    });
    this.boxW = plateWidth(this.text, SPACE.rowPadX, options.minWidth ?? 220);
    this.boxH = rowHeight(TYPE.body, style.lang) + 6;
    this.text.setPosition(
      Math.round((this.boxW - this.text.width) / 2),
      Math.round((this.boxH - 5 - this.text.height) / 2),
    );
    this.container.add(this.text);
    this.redraw();
  }

  override activate(): void {
    this.onPress();
  }

  protected redraw(): void {
    this.g.clear();
    const r = SPACE.radius;
    drawKey(this.g, this.boxW, this.boxH, r, this.focused, this.style.accent);
    // Always the full-strength ink: focus is carried by the ring, the lit bevel
    // and the raised cap, never by dimming the only word on the key.
    this.text.setColor(INK.text);
  }

  toMirror(): MirrorItem {
    return { id: this.id, role: "button", label: this.label };
  }
}

/** The key's material, kept out of the class so it reads as one shape. */
function drawKey(
  g: Phaser.GameObjects.Graphics,
  w: number,
  h: number,
  r: number,
  focused: boolean,
  accent: string,
): void {
  g.fillStyle(hexToNum(PANEL.shadow), SHADOW_ALPHA);
  g.fillRoundedRect(1, 5, w, h, r);
  g.fillStyle(hexToNum(PANEL.knobShade), 1);
  g.fillRoundedRect(0, 0, w, h, r);
  g.fillStyle(hexToNum(focused ? PANEL.faceShade : PANEL.bay), 1);
  g.fillRoundedRect(0, 0, w, h - 5, r);
  g.lineStyle(
    focused ? 3 : 2,
    hexToNum(focused ? accent : PANEL.knobLit),
    focused ? 1 : 0.45,
  );
  g.strokeRoundedRect(0, 0, w, h - 5, r);
}

// -- hull bay ---------------------------------------------------------------

/** The ship drawn in the bay, in `drawShip` size units. */
const HULL_GLYPH = 72;

/**
 * What `HULL_GLYPH` costs the row's height.
 *
 * `drawShip` draws from -52 to +62 in its own 100-unit space, so a size-72 ship
 * is ~82 px of ink; the row must clear that plus its padding. Modelled in
 * `cockpit.test.ts` against the real console frame, in Devanagari, which is
 * where the flight-deck column runs out of room first.
 */
const HULL_GLYPH_SPAN = Math.round(HULL_GLYPH * 1.14) + SPACE.rowPadY * 2;

/** Only reached by a row built with no choices at all, which no screen does. */
const SHIP_FALLBACK = {
  hull: PANEL.knob,
  stripe: PANEL.knobLit,
  glass: PANEL.glass,
  lens: PANEL.pointer,
} as const;

/** One hull the row can show, as data. Assembled by the screen, not by this file. */
export interface HullChoice {
  readonly id: string;
  /** The hull's name, e.g. "kestrel". */
  readonly label: string;
  /** Not held by this pilot: the row shows it and refuses to equip it. */
  readonly locked: boolean;
  /**
   * The line under the row for THIS hull: "unlocks after 5 beacons" when it is
   * locked, "flying now" when it is worn, "press enter to fly this one"
   * otherwise. Always present, because a row that only explains itself
   * sometimes is a row a child has to press to understand.
   */
  readonly detail: string;
  /** Hull, stripe, porthole glass, emitter lens (`catalog.ShipDef.colors`). */
  readonly colors: Parameters<typeof drawShip>[4];
}

export interface HullRowOptions {
  readonly label: string;
  readonly width: number;
  /** The id currently WORN. The cursor opens here. */
  readonly value: string;
  readonly choices: readonly HullChoice[];
  /** Called on Enter, and ONLY for a hull whose `locked` is false. */
  readonly onEquip: (id: string) => void;
}

/**
 * THE HULL BAY: the ship a pilot is wearing, on the console they already sit at
 * (UR-48; D73, D79; AC-6d.1b, AC-18.1).
 *
 * ================== THE DEFECT ==================
 * Hulls unlock at 1 / 3 / 5 / 7 beacons and NOTHING COULD EQUIP ONE. The only
 * writer of `profile.shipId` outside the schema was the create screen, where a
 * new pilot holds `ship-1` alone, so a child could play the whole route, earn
 * three hulls and fly the same ship for the life of the save. This row is the
 * missing input; `@engine/unlocks.equipShip` is the missing write.
 *
 * ================== BROWSE, THEN EQUIP - AND WHY NOT THE OTHER WAY ==================
 * Every other row on this panel changes its value on Left/Right. This one does
 * not, and the reason is the locked hulls. Two arrangements were possible:
 *
 *   ARROWS EQUIP, LOCKED HULLS SKIPPED. Then the four-position lamp row lies
 *   about how many ships exist, and the hull a child is three beacons away from
 *   is invisible on the one screen that would have told them about it. D73/D79
 *   require the opposite - locked hulls are visible, dim, and say what unlocks
 *   them - and the create screen already does it that way.
 *
 *   ARROWS BROWSE, ENTER EQUIPS. The cursor reaches all four, a locked one
 *   reads out its own sentence, and Enter is refused on it. Chosen.
 *
 * Landing on a hull cannot equip it in any case, because landing on a LOCKED
 * hull must not - so a row whose cursor and whose worn hull are the same thing
 * could not exist here. They are two fields, and the readout says which is
 * which: the worn hull's line is "flying now".
 *
 * ================== WHAT LOCKED COSTS AND WHAT IT DOES NOT ==================
 * The ROW is never `Control.locked`. `FocusList.adjust` drops the key for a
 * locked control, so a locked row would be a row whose arrows are dead - the
 * child could not reach ship-4 to read about it at all. Locked is a property of
 * the hull under the cursor, and it changes exactly two things: the ink and the
 * ship go dim, and Enter does nothing.
 *
 * `onEquip` is never called for a locked hull. That is belt and braces rather
 * than the guard: `@engine/unlocks.equipShip` refuses the same write, so a
 * second caller of that seam cannot equip a locked hull either.
 *
 * ================== THE ROW NEVER REFLOWS ==================
 * The glass window and the note both reserve the WIDEST and TALLEST any choice
 * needs, measured at build. The column is flowed once, by `SettingsScene`, and
 * a row that changed height when the cursor moved would push the reset key off
 * the console face - the fixed-pitch defect `layout.ts` exists to prevent.
 */
export class HullRow extends PanelControl {
  private cursor: number;
  private equipped: string;
  private readonly choices: readonly HullChoice[];
  private readonly readout: Phaser.GameObjects.Text;
  private readonly note: Phaser.GameObjects.Text;
  private readonly onEquip: (id: string) => void;
  private readonly glassX: number;
  private readonly glassW: number;
  private readonly shipX: number;
  private readonly shipY: number;
  private ship: Phaser.GameObjects.Container | null = null;
  private headH = 0;

  constructor(
    scene: Phaser.Scene,
    style: ControlStyle,
    id: string,
    x: number,
    y: number,
    depth: number,
    options: HullRowOptions,
  ) {
    super(scene, style, id, x, y, depth, options.label, options.width);
    this.choices = options.choices;
    this.onEquip = options.onEquip;
    this.equipped = options.value;
    const at = options.choices.findIndex((c) => c.id === options.value);
    this.cursor = at < 0 ? 0 : at;

    this.glassW = Math.max(
      HW.glassMinW,
      this.measureWidest(options.choices.map((c) => c.label)) + HW.glassPadX * 2,
    );
    this.glassX = this.boxW - SPACE.rowPadX - 26 - this.glassW;
    // The ship sits between the label and the readout, in the hardware column.
    this.shipX = Math.round(this.glassX - 26 - HULL_GLYPH * 0.45);
    this.fitLabel(this.shipX - HULL_GLYPH * 0.45 - SPACE.gap);

    this.readout = uiText(scene, 0, 0, this.current().label, {
      size: TYPE.label,
      color: readoutInk(style.accent),
      lang: style.lang,
      uppercase: style.uppercase,
      increasedLetterSpacing: style.increasedLetterSpacing,
      // A hull's name is a proper noun, like a language name on the row above.
      chrome: false,
    });
    this.note = uiText(scene, SPACE.rowPadX, 0, this.current().detail, {
      size: TYPE.caption,
      color: INK.textDim,
      lang: style.lang,
      uppercase: style.uppercase,
      increasedLetterSpacing: style.increasedLetterSpacing,
      wrapWidth: options.width - SPACE.rowPadX * 2,
    });

    this.headH = Math.max(
      rowHeight(TYPE.label, style.lang),
      HARDWARE_SPAN.selector,
      HULL_GLYPH_SPAN,
      this.title.height + SPACE.rowPadY * 2,
    );
    this.shipY = Math.round(this.headH / 2);
    // Reserve the TALLEST note any hull needs, measured rather than assumed, so
    // "unlocks after 7 beacons" wrapping to two lines in Devanagari does not
    // change the row's height the moment the cursor reaches ship-4.
    this.boxH = this.headH + this.tallestNote(options) + 10;
    this.title.setY(Math.round((this.headH - this.title.height) / 2));
    this.note.setY(this.headH - 4);
    this.container.add(this.readout);
    this.container.add(this.note);
    this.layout();
    this.redraw();
  }

  /** The height of the wordiest line any hull in this row can show. */
  private tallestNote(options: HullRowOptions): number {
    let tallest = 0;
    for (const choice of options.choices) {
      const probe = uiText(this.scene, 0, 0, choice.detail, {
        size: TYPE.caption,
        lang: this.style.lang,
        uppercase: this.style.uppercase,
        increasedLetterSpacing: this.style.increasedLetterSpacing,
        wrapWidth: options.width - SPACE.rowPadX * 2,
        chrome: false,
      });
      tallest = Math.max(tallest, probe.height);
      probe.destroy();
    }
    return Math.ceil(tallest);
  }

  private current(): HullChoice {
    return (
      this.choices[this.cursor] ??
      ({ id: "", label: "", locked: true, detail: "", colors: SHIP_FALLBACK } as HullChoice)
    );
  }

  /** The hull under the cursor. Not necessarily the one being worn. */
  get cursorId(): string {
    return this.current().id;
  }

  /** The hull being WORN. This is the value `profile.shipId` holds. */
  get value(): string {
    return this.equipped;
  }

  private get glassY(): number {
    return Math.round((this.headH - (HW.glassH + HW.lampGap + HW.lampSize)) / 2);
  }

  private layout(): void {
    this.readout.setX(Math.round(this.glassX + (this.glassW - this.readout.width) / 2));
    this.readout.setY(Math.round(this.glassY + (HW.glassH - this.readout.height) / 2));
  }

  /** Left/Right BROWSE. Nothing is written and nothing is equipped. */
  override adjust(delta: number): void {
    if (this.choices.length === 0) return;
    const n = this.choices.length;
    this.cursor = (((this.cursor + delta) % n) + n) % n;
    this.refresh();
  }

  /**
   * Enter equips the hull under the cursor, unless it is locked.
   *
   * A locked press is a NO-OP, deliberately and silently: the row is already
   * showing the sentence that says why, and a child who presses Enter on a ship
   * they have not earned has not done anything wrong (D31 - nothing in this
   * game reads as punishment).
   */
  override activate(): void {
    const choice = this.current();
    if (choice.locked || choice.id === "") return;
    this.equipped = choice.id;
    this.onEquip(choice.id);
    this.refresh();
  }

  private refresh(): void {
    this.readout.setText(this.current().label);
    this.note.setText(this.current().detail);
    this.layout();
    this.redraw();
  }

  protected redraw(): void {
    this.paintBay();
    const choice = this.current();
    const gy = this.glassY;
    drawGlass(this.g, this.glassX, gy, this.glassW, HW.glassH);
    const mid = gy + HW.glassH / 2;
    const chevron = this.focused ? this.style.accent : INK.textDim;
    drawChevron(this.g, this.glassX - 10, mid, -1, chevron);
    drawChevron(this.g, this.glassX + this.glassW + 10, mid, 1, chevron);
    drawPositionLamps(
      this.g,
      this.glassX,
      gy + HW.lampGap + HW.glassH,
      this.glassW,
      this.cursor,
      this.choices.length,
      this.style.accent,
      this.focused,
    );
    // A LOCKED HULL IS DIM AND STILL READABLE. `labelInk(false)` is INK.textDim,
    // which `cockpit.test.ts` measures at 4.5:1 on every surface on this panel
    // INCLUDING the glass - so "dim" costs saturation, never legibility.
    this.readout.setColor(choice.locked ? labelInk(false) : readoutInk(this.style.accent));
    this.ship?.destroy();
    // ONE ship drawing, `ui/chrome.drawShip` - the same pen the create screen's
    // tiles use, so the four hulls read identically on the two screens that
    // offer them. The Lantern RIG in `render/lantern.ts` is the flying ship and
    // is what the reference compare judges; a console instrument is not that,
    // and shrinking the rig into a 72 px bay would put a second caller on a
    // drawing a human signed off at full size.
    this.ship = drawShip(this.scene, this.shipX, this.shipY, HULL_GLYPH, choice.colors, choice.locked);
    this.container.add(this.ship);
    this.container.bringToTop(this.readout);
  }

  /**
   * `locked` here is the hull UNDER THE CURSOR, not the row.
   *
   * That is what `MirrorItem.locked` means to a reader - "visible but not
   * choosable" - and it is the fact a child needs spoken to them: the row they
   * are on is showing a ship they cannot fly yet, and `detail` says what earns
   * it. The row itself is always operable, which is why `Control.locked` stays
   * false (see the class comment).
   */
  toMirror(): MirrorItem {
    const choice = this.current();
    return {
      id: this.id,
      role: "option",
      label: this.title.text,
      value: choice.label,
      detail: choice.detail,
      locked: choice.locked,
    };
  }
}
