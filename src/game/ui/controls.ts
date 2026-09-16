import Phaser from "phaser";
import type { Lang } from "@engine/types";
import type { Focusable } from "./focus.js";
import type { MirrorItem, MirrorRole } from "./mirror.js";
import { DUR, EASE, INK, SPACE, TYPE, rowHeight } from "./theme.js";
import { plate, strokePlate } from "./chrome.js";
import { rgb } from "./palette.js";
import { plateWidth, uiText } from "./text.js";

/**
 * The control kit: button, list row, toggle, slider, option picker, text field.
 *
 * Two rules run through all of them.
 *
 * 1. SIZE TO CONTENT, WITH A MINIMUM. Never to a width derived from the English
 *    string. The design brief's flat "+25% for Spanish" underestimates exactly
 *    the labels a settings screen is made of - `Locked` -> `Bloqueado` is +50%,
 *    `Beacon Log` -> `Registro de balizas` is +90% - because Spanish pays a
 *    fixed cost in articles that a short label cannot amortise. Height is
 *    computed from the script's measured line height for the same reason
 *    (theme.ts LINE_HEIGHT), so Devanagari gets a taller row instead of a
 *    clipped one.
 * 2. FOCUS IS ALWAYS VISIBLE (AC-18.1). Every control brightens its plate and
 *    reports its box, and the screen's one focus ring moves to it.
 */

export interface ControlStyle {
  readonly lang: Lang;
  readonly uppercase: boolean;
  readonly increasedLetterSpacing: boolean;
  /** The stop accent; the only saturated colour a control may use. */
  readonly accent: string;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export abstract class Control implements Focusable {
  readonly id: string;
  locked = false;
  adjustable = false;
  /** True when printable keys should reach this control instead of navigation. */
  capturesTyping = false;

  protected focused = false;
  protected readonly g: Phaser.GameObjects.Graphics;
  protected readonly container: Phaser.GameObjects.Container;
  protected boxW = 0;
  protected boxH = 0;

  constructor(
    protected readonly scene: Phaser.Scene,
    protected readonly style: ControlStyle,
    id: string,
    x: number,
    y: number,
    depth: number,
  ) {
    this.id = id;
    this.container = scene.add.container(x, y).setDepth(depth);
    this.g = scene.add.graphics();
    this.container.add(this.g);
  }

  get node(): Phaser.GameObjects.Container {
    return this.container;
  }

  /** World-space box the focus ring should wrap. */
  ringBounds(): Box {
    return {
      x: this.container.x,
      y: this.container.y,
      w: this.boxW,
      h: this.boxH,
    };
  }

  setFocused(focused: boolean): void {
    if (this.focused === focused) return;
    this.focused = focused;
    this.redraw();
    if (focused && !this.locked) {
      // A 1.5% scale pop on Back.Out. Small enough to never reflow the row,
      // big enough that the eye lands on the right control.
      this.scene.tweens.add({
        targets: this.container,
        scale: 1.015,
        duration: DUR.focus,
        ease: EASE.pop,
        yoyo: true,
      });
    }
  }

  activate(): void {}
  adjust(_delta: number): void {}
  /** Returns true when the key was consumed as text input. */
  typeKey(_key: string): boolean {
    return false;
  }

  destroy(): void {
    this.container.destroy();
  }

  protected abstract redraw(): void;
  abstract toMirror(): MirrorItem;

  /** Shared plate fill: sunken normally, raised on focus, flat when locked. */
  protected paintPlate(): void {
    this.g.clear();
    const fill = this.locked
      ? rgb(INK.panelSunken)
      : this.focused
        ? rgb(INK.panelRaised)
        : rgb(INK.panel);
    plate(this.g, 0, 0, this.boxW, this.boxH, fill, this.locked ? 0.55 : 0.92);
    strokePlate(
      this.g,
      0,
      0,
      this.boxW,
      this.boxH,
      this.focused && !this.locked ? rgb(this.style.accent) : rgb(INK.line),
      this.focused && !this.locked ? 3 : 2,
    );
  }
}

// ---------------------------------------------------------------------------

export interface ButtonOptions {
  readonly label: string;
  readonly minWidth?: number;
  readonly size?: number;
  readonly onPress: () => void;
}

/** A single action. Enter or Space fires it. */
export class MenuButton extends Control {
  private readonly text: Phaser.GameObjects.Text;
  private readonly onPress: () => void;
  private label: string;

  constructor(
    scene: Phaser.Scene,
    style: ControlStyle,
    id: string,
    x: number,
    y: number,
    depth: number,
    options: ButtonOptions,
  ) {
    super(scene, style, id, x, y, depth);
    this.onPress = options.onPress;
    this.label = options.label;
    const size = options.size ?? TYPE.body;
    this.text = uiText(scene, 0, 0, options.label, {
      size,
      lang: style.lang,
      uppercase: style.uppercase,
      increasedLetterSpacing: style.increasedLetterSpacing,
    });
    this.boxW = plateWidth(this.text, SPACE.rowPadX, options.minWidth ?? 220);
    this.boxH = rowHeight(size, style.lang);
    this.text.setPosition(
      Math.round((this.boxW - this.text.width) / 2),
      Math.round((this.boxH - this.text.height) / 2),
    );
    this.container.add(this.text);
    this.redraw();
  }

  override activate(): void {
    this.onPress();
  }

  protected redraw(): void {
    this.paintPlate();
    this.text.setColor(this.focused ? INK.text : INK.textDim);
  }

  toMirror(): MirrorItem {
    return { id: this.id, role: "button", label: this.label };
  }
}

// ---------------------------------------------------------------------------

export interface ListRowOptions {
  readonly label: string;
  readonly detail?: string;
  readonly width: number;
  readonly locked?: boolean;
  readonly onPress?: () => void;
  /** Drawn at the left of the row, e.g. an avatar or a beacon. */
  readonly glyph?: (
    scene: Phaser.Scene,
    x: number,
    y: number,
  ) => Phaser.GameObjects.Container;
  readonly glyphSize?: number;
  readonly role?: MirrorRole;
  /**
   * False when the detail line is DATA rather than copy - a beacon's
   * "λ 214.6°  β −1.2°  r 1.52 AU" is a measurement in the D81 format, and the
   * letter-case setting must not rewrite its units to "au".
   */
  readonly detailChrome?: boolean;
}

/**
 * A row in a collection: a pilot, a beacon, a trophy, a ship.
 *
 * Width is given by the caller (a list is a column and must line up), but
 * HEIGHT is measured from the two text objects, so a Spanish detail line that
 * wraps to two lines makes the row taller instead of clipping.
 */
export class ListRow extends Control {
  private readonly title: Phaser.GameObjects.Text;
  private readonly detail: Phaser.GameObjects.Text | null;
  private readonly onPress: (() => void) | undefined;
  private readonly role: MirrorRole;

  constructor(
    scene: Phaser.Scene,
    style: ControlStyle,
    id: string,
    x: number,
    y: number,
    depth: number,
    options: ListRowOptions,
  ) {
    super(scene, style, id, x, y, depth);
    this.locked = options.locked ?? false;
    this.onPress = options.onPress;
    this.role = options.role ?? "listitem";
    this.boxW = options.width;

    const glyphSize = options.glyph ? (options.glyphSize ?? 72) : 0;
    const textLeft = SPACE.rowPadX + (glyphSize > 0 ? glyphSize + SPACE.gap : 0);
    const textWidth = this.boxW - textLeft - SPACE.rowPadX;

    this.title = uiText(scene, textLeft, 0, options.label, {
      size: TYPE.body,
      lang: style.lang,
      uppercase: style.uppercase,
      increasedLetterSpacing: style.increasedLetterSpacing,
      wrapWidth: textWidth,
      // A pilot's name and a ship's name are the child's own words; the
      // letter-case setting is chrome and must not rewrite them.
      chrome: options.role === "listitem" ? false : true,
    });
    this.detail =
      options.detail === undefined
        ? null
        : uiText(scene, textLeft, 0, options.detail, {
            size: TYPE.caption,
            color: INK.textDim,
            lang: style.lang,
            uppercase: style.uppercase,
            increasedLetterSpacing: style.increasedLetterSpacing,
            wrapWidth: textWidth,
            chrome: options.detailChrome ?? true,
          });

    const textHeight =
      this.title.height + (this.detail ? this.detail.height + 6 : 0);
    this.boxH = Math.max(
      rowHeight(TYPE.body, style.lang),
      Math.max(textHeight, glyphSize) + SPACE.rowPadY * 2,
    );

    const top = Math.round((this.boxH - textHeight) / 2);
    this.title.setY(top);
    this.detail?.setY(top + this.title.height + 6);

    if (options.glyph) {
      const glyph = options.glyph(
        scene,
        SPACE.rowPadX + glyphSize / 2,
        this.boxH / 2,
      );
      this.container.add(glyph);
      if (this.locked) glyph.setAlpha(0.3);
    }
    this.container.add(this.title);
    if (this.detail) this.container.add(this.detail);
    this.redraw();
  }

  override activate(): void {
    this.onPress?.();
  }

  protected redraw(): void {
    this.paintPlate();
    this.title.setColor(
      this.locked ? INK.locked : this.focused ? INK.text : INK.textDim,
    );
    this.detail?.setColor(this.locked ? INK.locked : INK.textDim);
  }

  toMirror(): MirrorItem {
    const item: MirrorItem = {
      id: this.id,
      role: this.role,
      label: this.title.text,
      locked: this.locked,
    };
    return this.detail ? { ...item, detail: this.detail.text } : item;
  }
}

// ---------------------------------------------------------------------------

export interface TileOptions {
  readonly label: string;
  /** The unlock sentence for a locked tile, e.g. "unlocks at a 25 chain". */
  readonly detail?: string;
  readonly width: number;
  readonly glyphHeight: number;
  readonly locked?: boolean;
  readonly selected?: boolean;
  readonly onPress?: () => void;
  readonly glyph: (
    scene: Phaser.Scene,
    x: number,
    y: number,
  ) => Phaser.GameObjects.Container;
}

/**
 * A gallery tile: a drawn thing on top, its name under it, and - when it is
 * locked - the one sentence that says how you get it.
 *
 * A locked tile is DIM AND STILL FOCUSABLE (D73: "locked skins are visible but
 * dim"). It is not struck through, not greyed with a cross, and not hidden: a
 * child is meant to look at it and want it, which only works if the keyboard
 * can land on it and a screen reader can read it.
 *
 * Width is fixed by the caller because a gallery is a row and the tiles must
 * line up; HEIGHT is measured, so a Spanish unlock line that wraps to two lines
 * makes every tile taller rather than clipping one.
 */
export class Tile extends Control {
  private readonly title: Phaser.GameObjects.Text;
  private readonly detail: Phaser.GameObjects.Text | null;
  private readonly onPress: (() => void) | undefined;
  private selected: boolean;

  constructor(
    scene: Phaser.Scene,
    style: ControlStyle,
    id: string,
    x: number,
    y: number,
    depth: number,
    options: TileOptions,
  ) {
    super(scene, style, id, x, y, depth);
    this.locked = options.locked ?? false;
    this.selected = options.selected ?? false;
    this.onPress = options.onPress;
    this.boxW = options.width;

    const inner = options.width - SPACE.rowPadX * 2;
    this.title = uiText(scene, SPACE.rowPadX, 0, options.label, {
      size: TYPE.label,
      align: "center",
      lang: style.lang,
      uppercase: style.uppercase,
      increasedLetterSpacing: style.increasedLetterSpacing,
      wrapWidth: inner,
    });
    this.detail =
      options.detail === undefined
        ? null
        : uiText(scene, SPACE.rowPadX, 0, options.detail, {
            size: TYPE.caption,
            color: INK.textDim,
            align: "center",
            lang: style.lang,
            uppercase: style.uppercase,
            increasedLetterSpacing: style.increasedLetterSpacing,
            wrapWidth: inner,
          });

    const glyphTop = SPACE.rowPadY;
    const textTop = glyphTop + options.glyphHeight + SPACE.gap;
    this.title.setY(textTop);
    this.detail?.setY(textTop + this.title.height + 6);
    this.boxH =
      textTop +
      this.title.height +
      (this.detail ? this.detail.height + 6 : 0) +
      SPACE.rowPadY;

    this.title.setX(
      Math.round(SPACE.rowPadX + (inner - this.title.width) / 2),
    );
    if (this.detail) {
      this.detail.setX(
        Math.round(SPACE.rowPadX + (inner - this.detail.width) / 2),
      );
    }

    const glyph = options.glyph(
      scene,
      options.width / 2,
      glyphTop + options.glyphHeight / 2,
    );
    if (this.locked) glyph.setAlpha(0.3);
    this.container.add(glyph);
    this.container.add(this.title);
    if (this.detail) this.container.add(this.detail);
    this.redraw();
  }

  setSelected(selected: boolean): void {
    if (this.selected === selected) return;
    this.selected = selected;
    this.redraw();
  }

  get isSelected(): boolean {
    return this.selected;
  }

  override activate(): void {
    if (this.locked) return;
    this.onPress?.();
  }

  protected redraw(): void {
    this.paintPlate();
    this.title.setColor(
      this.locked ? INK.locked : this.focused ? INK.text : INK.textDim,
    );
    if (this.selected && !this.locked) {
      // Selection is a filled bar under the tile, not a colour swap: it still
      // reads desaturated (rubric 4) and under the colourblind palette.
      this.g.fillStyle(rgb(this.style.accent), 1);
      this.g.fillRoundedRect(
        SPACE.rowPadX,
        this.boxH - 10,
        this.boxW - SPACE.rowPadX * 2,
        6,
        3,
      );
    }
  }

  toMirror(): MirrorItem {
    const item: MirrorItem = {
      id: this.id,
      role: "listitem",
      label: this.title.text,
      locked: this.locked,
      value: this.selected ? "selected" : "",
    };
    return this.detail ? { ...item, detail: this.detail.text } : item;
  }
}

// ---------------------------------------------------------------------------

export interface ToggleOptions {
  readonly label: string;
  readonly width: number;
  readonly value: boolean;
  readonly onLabel: string;
  readonly offLabel: string;
  readonly onChange: (value: boolean) => void;
}

/** An on/off control. Enter flips it; Left/Right also flip it. */
export class ToggleRow extends Control {
  private value: boolean;
  private readonly title: Phaser.GameObjects.Text;
  private readonly state: Phaser.GameObjects.Text;
  private readonly onChange: (value: boolean) => void;
  private readonly onLabel: string;
  private readonly offLabel: string;

  constructor(
    scene: Phaser.Scene,
    style: ControlStyle,
    id: string,
    x: number,
    y: number,
    depth: number,
    options: ToggleOptions,
  ) {
    super(scene, style, id, x, y, depth);
    this.adjustable = true;
    this.value = options.value;
    this.onChange = options.onChange;
    this.onLabel = options.onLabel;
    this.offLabel = options.offLabel;
    this.boxW = options.width;

    this.title = uiText(scene, SPACE.rowPadX, 0, options.label, {
      size: TYPE.label,
      lang: style.lang,
      uppercase: style.uppercase,
      increasedLetterSpacing: style.increasedLetterSpacing,
      wrapWidth: options.width * 0.52,
    });
    this.state = uiText(scene, 0, 0, this.value ? this.onLabel : this.offLabel, {
      size: TYPE.label,
      color: style.accent,
      lang: style.lang,
      uppercase: style.uppercase,
      increasedLetterSpacing: style.increasedLetterSpacing,
      align: "right",
    });
    this.boxH = Math.max(
      rowHeight(TYPE.label, style.lang),
      Math.max(this.title.height, this.state.height) + SPACE.rowPadY * 2,
    );
    this.title.setY(Math.round((this.boxH - this.title.height) / 2));
    this.container.add([this.title, this.state]);
    this.layoutState();
    this.redraw();
  }

  private layoutState(): void {
    this.state.setX(Math.round(this.boxW - SPACE.rowPadX - this.state.width));
    this.state.setY(Math.round((this.boxH - this.state.height) / 2));
  }

  private set(value: boolean): void {
    if (this.value === value) return;
    this.value = value;
    this.state.setText(
      this.style.uppercase
        ? (value ? this.onLabel : this.offLabel).toLocaleUpperCase()
        : (value ? this.onLabel : this.offLabel).toLocaleLowerCase(),
    );
    this.layoutState();
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
    this.paintPlate();
    this.title.setColor(this.focused ? INK.text : INK.textDim);
    // A small filled pip beside the state word, so "on" is not carried by
    // colour alone (D41 colourblind rule applies to the menus too).
    this.g.fillStyle(rgb(this.style.accent), this.value ? 1 : 0.22);
    this.g.fillCircle(
      this.boxW - SPACE.rowPadX - this.state.width - 22,
      this.boxH / 2,
      this.value ? 9 : 6,
    );
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

// ---------------------------------------------------------------------------

export interface SliderOptions {
  readonly label: string;
  readonly width: number;
  readonly value: number;
  readonly step?: number;
  readonly onChange: (value: number) => void;
  /** Formats the number for the mirror and the readout, e.g. "70%". */
  readonly format: (value: number) => string;
}

/** A 0..1 control. Left/Right move it; Enter is a no-op so it cannot surprise. */
export class SliderRow extends Control {
  private value: number;
  private readonly step: number;
  private readonly title: Phaser.GameObjects.Text;
  private readonly readout: Phaser.GameObjects.Text;
  private readonly onChange: (value: number) => void;
  private readonly format: (value: number) => string;
  private trackX = 0;
  private trackW = 0;

  constructor(
    scene: Phaser.Scene,
    style: ControlStyle,
    id: string,
    x: number,
    y: number,
    depth: number,
    options: SliderOptions,
  ) {
    super(scene, style, id, x, y, depth);
    this.adjustable = true;
    this.value = clamp01(options.value);
    this.step = options.step ?? 0.1;
    this.onChange = options.onChange;
    this.format = options.format;
    this.boxW = options.width;

    this.title = uiText(scene, SPACE.rowPadX, 0, options.label, {
      size: TYPE.label,
      lang: style.lang,
      uppercase: style.uppercase,
      increasedLetterSpacing: style.increasedLetterSpacing,
      wrapWidth: options.width * 0.34,
    });
    this.readout = uiText(scene, 0, 0, this.format(this.value), {
      size: TYPE.label,
      color: style.accent,
      lang: style.lang,
      uppercase: style.uppercase,
      increasedLetterSpacing: style.increasedLetterSpacing,
    });
    this.boxH = Math.max(
      rowHeight(TYPE.label, style.lang),
      this.title.height + SPACE.rowPadY * 2,
    );
    this.title.setY(Math.round((this.boxH - this.title.height) / 2));
    this.container.add([this.title, this.readout]);
    this.layout();
    this.redraw();
  }

  /**
   * The track starts after the longest the LABEL can be in this language, not
   * after a fixed column. In Spanish "movimiento tranquilo" is half again as
   * long as "calm motion"; a fixed column would run the label under the track.
   */
  private layout(): void {
    this.readout.setX(
      Math.round(this.boxW - SPACE.rowPadX - this.readout.width),
    );
    this.readout.setY(Math.round((this.boxH - this.readout.height) / 2));
    this.trackX = Math.round(
      SPACE.rowPadX + this.title.width + SPACE.gap * 1.5,
    );
    this.trackW = Math.max(
      120,
      this.readout.x - SPACE.gap * 1.5 - this.trackX,
    );
  }

  private set(value: number): void {
    const next = clamp01(Math.round(value * 100) / 100);
    if (next === this.value) return;
    this.value = next;
    this.readout.setText(this.format(next));
    this.layout();
    this.redraw();
    this.onChange(next);
  }

  override adjust(delta: number): void {
    this.set(this.value + delta * this.step);
  }

  protected redraw(): void {
    this.paintPlate();
    this.title.setColor(this.focused ? INK.text : INK.textDim);
    const y = this.boxH / 2;
    this.g.fillStyle(rgb(INK.panelSunken), 1);
    this.g.fillRoundedRect(this.trackX, y - 7, this.trackW, 14, 7);
    this.g.fillStyle(rgb(this.style.accent), this.focused ? 1 : 0.7);
    this.g.fillRoundedRect(
      this.trackX,
      y - 7,
      Math.max(14, this.trackW * this.value),
      14,
      7,
    );
    // The knob is a second SHAPE, not just a colour change, so the value is
    // readable desaturated (rubric 4) and under the colourblind palette.
    this.g.fillStyle(rgb(INK.text), 1);
    this.g.fillCircle(this.trackX + this.trackW * this.value, y, 11);
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

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

// ---------------------------------------------------------------------------

export interface OptionChoice<T extends string> {
  readonly value: T;
  readonly label: string;
}

export interface OptionRowOptions<T extends string> {
  readonly label: string;
  readonly width: number;
  readonly value: T;
  readonly choices: readonly OptionChoice<T>[];
  readonly onChange: (value: T) => void;
  /** One calm line under the row, e.g. why a language is not offered. */
  readonly note?: string;
}

/** Cycles a small fixed set: keyboard layout, language, letter case. */
export class OptionRow<T extends string> extends Control {
  private index: number;
  private choices: readonly OptionChoice<T>[];
  private readonly title: Phaser.GameObjects.Text;
  private readonly readout: Phaser.GameObjects.Text;
  private readonly note: Phaser.GameObjects.Text | null;
  private readonly onChange: (value: T) => void;

  constructor(
    scene: Phaser.Scene,
    style: ControlStyle,
    id: string,
    x: number,
    y: number,
    depth: number,
    options: OptionRowOptions<T>,
  ) {
    super(scene, style, id, x, y, depth);
    this.adjustable = true;
    this.choices = options.choices;
    this.onChange = options.onChange;
    this.index = Math.max(
      0,
      options.choices.findIndex((c) => c.value === options.value),
    );
    this.boxW = options.width;

    this.title = uiText(scene, SPACE.rowPadX, 0, options.label, {
      size: TYPE.label,
      lang: style.lang,
      uppercase: style.uppercase,
      increasedLetterSpacing: style.increasedLetterSpacing,
      wrapWidth: options.width * 0.46,
    });
    this.readout = uiText(scene, 0, 0, this.currentLabel(), {
      size: TYPE.label,
      color: style.accent,
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

    const head = Math.max(this.title.height, this.readout.height);
    this.boxH =
      Math.max(rowHeight(TYPE.label, style.lang), head + SPACE.rowPadY * 2) +
      (this.note ? this.note.height + 8 : 0);
    this.title.setY(SPACE.rowPadY + Math.round((head - this.title.height) / 2));
    this.note?.setY(SPACE.rowPadY + head + 8);
    this.container.add([this.title, this.readout]);
    if (this.note) this.container.add(this.note);
    this.layout();
    this.redraw();
  }

  private currentLabel(): string {
    return this.choices[this.index]?.label ?? "";
  }

  private layout(): void {
    // 44 px of clearance on the right for the "‹ ›" affordance chevrons.
    this.readout.setX(
      Math.round(this.boxW - SPACE.rowPadX - 30 - this.readout.width),
    );
    this.readout.setY(
      SPACE.rowPadY +
        Math.round(
          (Math.max(this.title.height, this.readout.height) -
            this.readout.height) /
            2,
        ),
    );
  }

  /** Replace the choice set in place (AC-14.1 re-filters content languages). */
  setChoices(choices: readonly OptionChoice<T>[], value: T): void {
    this.choices = choices;
    this.index = Math.max(
      0,
      choices.findIndex((c) => c.value === value),
    );
    this.readout.setText(this.currentLabel());
    this.layout();
    this.redraw();
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
    this.paintPlate();
    this.title.setColor(this.focused ? INK.text : INK.textDim);
    const y = SPACE.rowPadY + Math.max(this.title.height, this.readout.height) / 2;
    const chevron = this.focused ? rgb(this.style.accent) : rgb(INK.textFaint);
    this.g.fillStyle(chevron, 1);
    const rx = this.boxW - SPACE.rowPadX - 18;
    this.g.fillTriangle(rx, y - 9, rx + 11, y, rx, y + 9);
    const lx = this.readout.x - 20;
    this.g.fillTriangle(lx, y - 9, lx - 11, y, lx, y + 9);
  }

  toMirror(): MirrorItem {
    const base: MirrorItem = {
      id: this.id,
      role: "option",
      label: this.title.text,
      value: this.value ?? "",
    };
    // The note is part of what this row SAYS - AC-14.1's "pick a Hindi keyboard"
    // line is the whole explanation for a missing option - so it belongs in the
    // mirror, not only on the canvas.
    return this.note ? { ...base, detail: this.note.text } : base;
  }
}

// ---------------------------------------------------------------------------

export interface TextFieldOptions {
  readonly label: string;
  readonly width: number;
  readonly value: string;
  readonly maxLength: number;
  readonly placeholder: string;
  readonly onChange: (value: string) => void;
}

/**
 * A name field, operated by typing while it has focus - there is no "click to
 * edit" step, because there is no pointer (D37).
 *
 * THE FIELD IS THE ONLY TEXT ENTRY IN THE GAME'S MENUS, and it takes a name.
 * There is no email field here or anywhere else (AC-18.2, D43, NFR-3): a
 * profile is a name, a mark and a ship the child named, and the persistence
 * schema copies a fixed field list so no contact field can reach storage even
 * if one were added upstream.
 */
export class TextField extends Control {
  private value: string;
  private readonly maxLength: number;
  private readonly title: Phaser.GameObjects.Text;
  private readonly entry: Phaser.GameObjects.Text;
  private readonly placeholder: string;
  private readonly onChange: (value: string) => void;
  private caret: Phaser.GameObjects.Rectangle | null = null;

  constructor(
    scene: Phaser.Scene,
    style: ControlStyle,
    id: string,
    x: number,
    y: number,
    depth: number,
    options: TextFieldOptions,
  ) {
    super(scene, style, id, x, y, depth);
    this.capturesTyping = true;
    this.value = options.value;
    this.maxLength = options.maxLength;
    this.placeholder = options.placeholder;
    this.onChange = options.onChange;
    this.boxW = options.width;

    this.title = uiText(scene, SPACE.rowPadX, SPACE.rowPadY, options.label, {
      size: TYPE.caption,
      color: INK.textDim,
      lang: style.lang,
      uppercase: style.uppercase,
      increasedLetterSpacing: style.increasedLetterSpacing,
    });
    this.entry = uiText(
      scene,
      SPACE.rowPadX,
      SPACE.rowPadY + this.title.height + 6,
      this.value === "" ? options.placeholder : this.value,
      {
        size: TYPE.heading,
        lang: style.lang,
        uppercase: style.uppercase,
        increasedLetterSpacing: style.increasedLetterSpacing,
        // The child's own words keep the capitals they typed.
        chrome: false,
      },
    );
    this.boxH = SPACE.rowPadY * 2 + this.title.height + 6 + this.entry.height;
    this.container.add([this.title, this.entry]);
    this.redraw();
  }

  get text(): string {
    return this.value;
  }

  override typeKey(key: string): boolean {
    if (key === "Backspace") {
      if (this.value.length === 0) return true;
      this.setValue(this.value.slice(0, -1));
      return true;
    }
    // One printable character, including a space. Anything longer is a named
    // key ("Shift", "ArrowLeft") and belongs to navigation.
    if ([...key].length !== 1) return false;
    if (this.value.length >= this.maxLength) return true;
    this.setValue(this.value + key);
    return true;
  }

  private setValue(next: string): void {
    this.value = next;
    this.entry.setText(next === "" ? this.placeholder : next);
    this.entry.setColor(next === "" ? INK.textFaint : INK.text);
    this.redraw();
    this.onChange(next);
  }

  protected redraw(): void {
    this.paintPlate();
    if (this.entry) {
      this.entry.setColor(this.value === "" ? INK.textFaint : INK.text);
    }
    if (!this.focused) {
      this.caret?.destroy();
      this.caret = null;
      return;
    }
    if (!this.caret) {
      this.caret = this.scene.add
        .rectangle(0, 0, 3, this.entry.height * 0.8, rgb(this.style.accent))
        .setOrigin(0, 0);
      this.container.add(this.caret);
      this.scene.tweens.add({
        targets: this.caret,
        alpha: 0.15,
        duration: 620,
        ease: EASE.drift,
        yoyo: true,
        repeat: -1,
      });
    }
    this.caret.setPosition(
      this.entry.x + this.entry.width + 6,
      this.entry.y + this.entry.height * 0.1,
    );
  }

  toMirror(): MirrorItem {
    return {
      id: this.id,
      role: "field",
      label: this.title.text,
      value: this.value,
    };
  }
}
