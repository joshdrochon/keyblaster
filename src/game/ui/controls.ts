import Phaser from "phaser";
import type { Lang } from "@engine/types";
import { HIT_ZONE_PREFIX, type Focusable, type PointerHandlers } from "./focus.js";
import type { MirrorItem, MirrorRole } from "./mirror.js";
import { DUR, EASE, INK, SPACE, TYPE, rowHeight } from "./theme.js";
import { plate, strokePlate } from "./chrome.js";
import { hexToNum } from "@game/render/palette";
import { plateWidth, uiText } from "./text.js";

/**
 * The control kit: button, list row, gallery tile, text field.
 *
 * WHERE THE SETTINGS CONTROLS WENT. A flat pill slider, an on/off row and an
 * option picker used to live here, and exactly one screen used all three. They
 * are now a rotary knob, an illuminated toggle and a detented selector in
 * `cockpit.ts` (UR-11): Settings is the inside of the Lantern, not a web form.
 * They were REMOVED rather than left beside the new ones, because two kits is
 * how the next screen quietly gets its pill slider back -
 * `tests/unit/ui/cockpit.test.ts` fails if any of the three names returns.
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
 * 3. FOCUSABLE IS CLICKABLE. `Control.bindPointer` gives every control in this
 *    file a hit area, and `FocusList.setItems` calls it on everything it is
 *    handed - so a control cannot exist that only the keyboard reaches, and
 *    the keyboard path is untouched by any of it (AC-18.1, D37).
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
  /**
   * True for a control with exactly two states, where a click anywhere flips
   * it rather than meaning "less" on the left and "more" on the right.
   */
  twoState = false;
  /** True when printable keys should reach this control instead of navigation. */
  capturesTyping = false;

  protected focused = false;
  protected readonly g: Phaser.GameObjects.Graphics;
  protected readonly container: Phaser.GameObjects.Container;
  protected boxW = 0;
  protected boxH = 0;
  private pointerZone: Phaser.GameObjects.Zone | null = null;

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

  /**
   * The pointer half of AC-18.1. Called by `FocusList.setItems` for every
   * control on the screen, so this is not something a screen opts into.
   *
   * WHY A ZONE AND NOT `container.setInteractive()`. The container is scaled by
   * the 1.5% focus pop, and an input hit area that breathes with a tween is a
   * button whose edge moves under the cursor. A sibling zone at the control's
   * measured box stays exactly where the focus ring is drawn, which is the box
   * the player is aiming at.
   *
   * A LOCKED CONTROL STILL TAKES THE POINTER, and only focuses. That is the
   * same thing the keyboard does with it (focus.ts: locked items are focusable,
   * `activate` is what locking removes), and it is the whole point of a locked
   * tile - a child is meant to be able to look at Pluto and read why it is not
   * lit yet (D73, D31). It gets no hand cursor, because it is not pressable.
   */
  bindPointer(handlers: PointerHandlers): void {
    this.pointerZone?.destroy();
    this.pointerZone = null;
    const box = this.ringBounds();
    if (box.w <= 0 || box.h <= 0) return;

    const zone = this.scene.add
      .zone(box.x, box.y, box.w, box.h)
      .setOrigin(0, 0)
      // Named so the pointer e2e can find every hit area on a screen and prove
      // it lines up with a focusable control, rather than clicking at hard-coded
      // pixel coordinates that go stale the moment a layout changes.
      .setName(`${HIT_ZONE_PREFIX}${this.id}`)
      .setDepth(this.container.depth + 1)
      .setInteractive({ useHandCursor: !this.locked });

    zone.on("pointerover", () => handlers.focus());
    zone.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.locked) {
        handlers.focus();
        return;
      }
      // An adjustable control answers a click the way it answers Left/Right:
      // the left half is -1 and the right half is +1. Sending `activate` here
      // instead would make clicking a volume slider do nothing at all, which
      // is the exact dead-click this change exists to remove.
      if (this.adjustable) {
        // A TWO-STATE CONTROL TOGGLES WHEREVER YOU CLICK IT.
        //
        // The left/right split below is right for a slider or an option row,
        // where -1 and +1 mean different things. On an on/off switch it is a
        // dead click: the right half sends +1, the switch is already on, and
        // clicking the same spot again does nothing. A child has to work out
        // that the OTHER half of the same control is the off button, which is
        // not how a switch behaves anywhere else they have met one.
        if (this.twoState) {
          // `press` (activate) TOGGLES; `adjust` does not. SwitchRow.adjust is
          // `set(delta > 0)`, so sending +1 here would pin the switch ON for
          // ever - which is exactly what a first attempt at this shipped.
          handlers.press();
          return;
        }
        handlers.adjust(pointer.worldX >= box.x + box.w / 2 ? 1 : -1);
        return;
      }
      handlers.press();
    });
    this.pointerZone = zone;
  }

  /**
   * Take the pointer away without losing the binding - what a screen does while
   * a modal confirm is open, so a click cannot reach the screen underneath it.
   */
  setPointerEnabled(enabled: boolean): void {
    if (!this.pointerZone) return;
    if (enabled) this.pointerZone.setInteractive({ useHandCursor: !this.locked });
    else this.pointerZone.disableInteractive();
  }

  destroy(): void {
    this.pointerZone?.destroy();
    this.pointerZone = null;
    this.container.destroy();
  }

  protected abstract redraw(): void;
  abstract toMirror(): MirrorItem;

  /** Shared plate fill: sunken normally, raised on focus, flat when locked. */
  protected paintPlate(): void {
    this.g.clear();
    const fill = this.locked
      ? hexToNum(INK.panelSunken)
      : this.focused
        ? hexToNum(INK.panelRaised)
        : hexToNum(INK.panel);
    plate(this.g, 0, 0, this.boxW, this.boxH, fill, this.locked ? 0.55 : 0.92);
    strokePlate(
      this.g,
      0,
      0,
      this.boxW,
      this.boxH,
      this.focused && !this.locked ? hexToNum(this.style.accent) : hexToNum(INK.line),
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

  /**
   * FOCUS IS CARRIED BY THE RING AND THE PLATE, NEVER BY DIMMING THE WORD.
   *
   * The pause menu shipped with "settings" and "quit to map" in `textDim` beside
   * a white "back to the belt", and two of the three things a paused child can
   * do read as DISABLED. They are not disabled. Greying is the one visual
   * convention that means "this will not work", and spending it on "this is not
   * the item under the cursor" leaves nothing to say the real thing with.
   *
   * So an unfocused button is the same ink as a focused one, and the state is
   * carried by the accent ring, the raised plate and the 1.5% pop. A genuinely
   * LOCKED button is the one that dims - to `textDim`, which is still 9:1 on
   * the plate, because a locked control is meant to be read and wanted (D73).
   */
  protected redraw(): void {
    this.paintPlate();
    this.text.setColor(this.locked ? INK.textDim : INK.text);
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
      // Dim, not erased: an unlit beacon is the same silhouette a step down.
      if (this.locked) glyph.setAlpha(0.62);
    }
    this.container.add(this.title);
    if (this.detail) this.container.add(this.detail);
    this.redraw();
  }

  override activate(): void {
    this.onPress?.();
  }

  /**
   * A LOCKED ROW IS DIM, NOT INVISIBLE (D73, AC-22.8). `INK.locked` (#3A4656)
   * measures 1.6:1 on the row plate: "pluto / not lit yet" and every unearned
   * trophy's criterion were drawn in an ink a child cannot read, which is the
   * opposite of what a locked row is for. Locked now means `textDim` - 9:1,
   * clearly a step below the white of an open row, and still a sentence.
   */
  protected redraw(): void {
    this.paintPlate();
    this.title.setColor(this.locked ? INK.textDim : INK.text);
    this.detail?.setColor(INK.textDim);
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
  /**
   * Where the drawn thing sits. "top" is the gallery tile - a ship or a pilot
   * mark is the SUBJECT and the name is its caption. "left" is the record card:
   * a small mark identifying a line of text that is itself the subject, which
   * is what a trophy's criterion is. It also costs a third of the height, and
   * twelve trophies over four rows is the block on the Beacon Log that runs out
   * of room first.
   */
  readonly glyphSide?: "top" | "left";
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

    const side = options.glyphSide ?? "top";
    const textLeft =
      side === "left"
        ? SPACE.rowPadX + options.glyphHeight + SPACE.gap * 0.7
        : SPACE.rowPadX;
    const inner = options.width - textLeft - SPACE.rowPadX;
    const align = side === "left" ? "left" : "center";

    this.title = uiText(scene, textLeft, 0, options.label, {
      size: TYPE.label,
      align,
      lang: style.lang,
      uppercase: style.uppercase,
      increasedLetterSpacing: style.increasedLetterSpacing,
      wrapWidth: inner,
    });
    this.detail =
      options.detail === undefined
        ? null
        : uiText(scene, textLeft, 0, options.detail, {
            size: TYPE.caption,
            color: INK.textDim,
            align,
            lang: style.lang,
            uppercase: style.uppercase,
            increasedLetterSpacing: style.increasedLetterSpacing,
            wrapWidth: inner,
          });

    const textH =
      this.title.height + (this.detail ? this.detail.height + 6 : 0);

    if (side === "left") {
      // The card is as tall as whichever half is taller, and the mark is
      // centred against the text rather than the other way round.
      this.boxH = SPACE.rowPadY * 2 + Math.max(options.glyphHeight, textH);
      const top = Math.round((this.boxH - textH) / 2);
      this.title.setY(top);
      this.detail?.setY(top + this.title.height + 6);
    } else {
      const glyphTop = SPACE.rowPadY;
      const textTop = glyphTop + options.glyphHeight + SPACE.gap;
      this.title.setY(textTop);
      this.detail?.setY(textTop + this.title.height + 6);
      this.boxH = textTop + textH + SPACE.rowPadY;
      this.title.setX(Math.round(textLeft + (inner - this.title.width) / 2));
      if (this.detail) {
        this.detail.setX(Math.round(textLeft + (inner - this.detail.width) / 2));
      }
    }

    const glyph =
      side === "left"
        ? options.glyph(
            scene,
            SPACE.rowPadX + options.glyphHeight / 2,
            this.boxH / 2,
          )
        : options.glyph(
            scene,
            options.width / 2,
            SPACE.rowPadY + options.glyphHeight / 2,
          );
    // 0.3 put a locked mark at about a tenth of its ink once the glyph's own
    // dimming was counted too, which is how twelve trophies became twelve
    // smudges. A locked tile is DIM AND STILL A PICTURE (D73).
    if (this.locked) glyph.setAlpha(0.62);
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
    // Same rule as ListRow: locked is a step dimmer, never below 4.5:1. An
    // unearned trophy's name is the invitation; it has to be readable.
    this.title.setColor(this.locked ? INK.textDim : INK.text);
    if (this.selected && !this.locked) {
      // Selection is a filled bar under the tile, not a colour swap: it still
      // reads desaturated (rubric 4) and under the colourblind palette.
      this.g.fillStyle(hexToNum(this.style.accent), 1);
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
    this.entry.setColor(next === "" ? INK.textDim : INK.text);
    this.redraw();
    this.onChange(next);
  }

  protected redraw(): void {
    this.paintPlate();
    if (this.entry) {
      // A placeholder is copy a child reads before they type over it, so it
      // clears the same 4.5:1 bar as everything else (AC-22.8).
      this.entry.setColor(this.value === "" ? INK.textDim : INK.text);
    }
    if (!this.focused) {
      this.caret?.destroy();
      this.caret = null;
      return;
    }
    if (!this.caret) {
      this.caret = this.scene.add
        .rectangle(0, 0, 3, this.entry.height * 0.8, hexToNum(this.style.accent))
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
