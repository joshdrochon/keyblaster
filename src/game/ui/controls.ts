import Phaser from "phaser";
import type { Lang } from "@engine/types";
import { HIT_ZONE_PREFIX, type Focusable, type PointerHandlers } from "./focus.js";
import type { MirrorItem, MirrorRole } from "./mirror.js";
import { DUR, EASE, INK, SPACE, TYPE, rowHeight } from "./theme.js";
import { CARET } from "@game/scenes/lib/typedWord";
import { plate, strokePlate } from "./chrome.js";
import { hexToNum } from "@game/render/palette";
import { plateWidth, uiText } from "./text.js";
import { FOCUS_POP, POP_NAME_PREFIX, focusPopScale, focusPopShift } from "./focusPop.js";

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

/**
 * ================== THE FOCUS MODEL, IN ONE PLACE (UR-110) ==================
 *
 * This game is a Phaser canvas with no DOM in it, and it is keyboard-first
 * (D37, AC-18.1). "Hover" and "focus" are therefore two words for ONE state,
 * and the rules below are the whole of it. They are written here because this
 * is where the shared behaviour lives; `ui/focus.ts` owns which control is
 * focused, and this file owns what being focused LOOKS like.
 *
 *   1. EXACTLY ONE CONTROL IS ACTIVE ON A SCREEN, ALWAYS.
 *      `FocusList.paint` sets `setFocused(i === index)` on every item, so one
 *      control is true and the rest are false, by construction. There is no
 *      second "hovered" flag anywhere, and there must never be one.
 *
 *   2. HOVERING A CONTROL MOVES FOCUS TO IT.
 *      `bindPointer` sends `pointerover` straight to `handlers.focus()`. So
 *      the question "what if the pointer is on A while the keyboard is on B"
 *      cannot arise: the moment the pointer reaches A, A *is* the focused
 *      control and B is not. Two competing highlights would mean two answers
 *      to "you are here" and two things for the screen-reader mirror to
 *      disagree about (ui/focus.ts says the same for the same reason).
 *
 *   3. THE POINTER LEAVING A CONTROL DOES NOTHING.
 *      There is no `pointerout` handler in this game, deliberately. Focus is a
 *      state that is HELD until something takes it, not a spotlight that
 *      follows the mouse. A child who moves the mouse aside to look at the
 *      screen has not stopped being about to press Enter on that button.
 *
 *   4. ONLY TWO THINGS TAKE FOCUS AWAY: another control on the same screen
 *      taking it (by hover, arrow key, Tab or click), or the screen going away
 *      (Escape, a scene change, a modal opening - `setPointerEnabled(false)`).
 *      Nothing else. Not time, not the pointer, not a click on the background.
 *
 *   5. SIZE IS A STATE, NOT A FLOURISH.
 *      A focused control is bigger for as long as it is focused, and returns
 *      to its base size at the instant rule 4 fires. This is what UR-110 fixed:
 *      the pop used to be `yoyo: true`, so it grew and shrank straight back
 *      and the RESTING size of a focused control was the same as every other
 *      control's. Locked controls never grow - growth promises an Enter that
 *      a locked control does not answer (D73).
 */

/**
 * How big "grown" is, and the arithmetic that keeps the swell centred.
 *
 * BOTH LIVE IN `ui/focusPop.ts` NOW (UR-111), because this file is only one of
 * the three menus in the game: `scenes/lib/kit.ts` drives the seven story
 * screens and `TitleScene` rolls its own list, and until they shared these
 * numbers a focused control meant three different sizes depending on which
 * screen a child was looking at. Re-exported here so the ten call sites that
 * already import `FOCUS_POP` from the control kit keep working, and so this
 * file still reads as the place the focus model is documented.
 */
export { FOCUS_POP } from "./focusPop.js";

export abstract class Control implements Focusable {
  /**
   * The pop container is named `kb-pop:<id>`, for the same reason every hit
   * area is named `kb-hit:<id>` (ui/focus.ts): a probe - an e2e, or a hand
   * measurement of a served build - has to be able to find the object whose
   * scale it is measuring without guessing at the scene graph's shape.
   */
  static readonly POP_NAME_PREFIX = POP_NAME_PREFIX;

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
  /**
   * TWO CONTAINERS, AND THE SPLIT IS THE POINT.
   *
   * `root` is the LAYOUT anchor. Scenes position it (`node.setPosition`) and
   * `ringBounds` reports it, and it is never scaled - six scenes stack their
   * rows off `ringBounds().h`, so a pop that fed back into it would reflow the
   * screen under the child every time focus moved.
   *
   * `container` is what breathes. Every subclass adds its children to it, so
   * they all pop together, and it is offset inside `root` so the growth is
   * about the control's CENTRE. A single scaled container would anchor at its
   * own top-left, putting all of the growth on the right and bottom - which is
   * invisible in a 280 ms flourish and, held, is a focused row visibly out of
   * line with the rows above it.
   */
  private readonly root: Phaser.GameObjects.Container;
  protected readonly container: Phaser.GameObjects.Container;
  protected boxW = 0;
  protected boxH = 0;
  private pointerZone: Phaser.GameObjects.Zone | null = null;
  /** The live pop, so fast focus movement replaces it instead of stacking. */
  private popTween: Phaser.Tweens.Tween | null = null;

  constructor(
    protected readonly scene: Phaser.Scene,
    protected readonly style: ControlStyle,
    id: string,
    x: number,
    y: number,
    depth: number,
  ) {
    this.id = id;
    this.root = scene.add.container(x, y).setDepth(depth);
    this.container = scene.add
      .container(0, 0)
      .setName(`${Control.POP_NAME_PREFIX}${id}`);
    this.root.add(this.container);
    this.g = scene.add.graphics();
    this.container.add(this.g);
  }

  get node(): Phaser.GameObjects.Container {
    return this.root;
  }

  /**
   * The LAYOUT box: where this control sits and how much room it takes in the
   * stack. Deliberately not the drawn box - see `root` above. The focus ring
   * is struck around this, and a held pop swells the plate into that ring
   * rather than through it (`FOCUS_POP.maxGrowPx`).
   */
  ringBounds(): Box {
    return {
      x: this.root.x,
      y: this.root.y,
      w: this.boxW,
      h: this.boxH,
    };
  }

  /**
   * How much bigger this control is when focused, as a scale factor.
   *
   * Derived from the control's OWN width so the growth in pixels is bounded
   * the same way on a 220 px chip and a 900 px settings row. See `FOCUS_POP`.
   */
  private popScale(): number {
    return focusPopScale(this.boxW);
  }

  /**
   * Rule 5 of the focus model above: grown while focused, base size otherwise.
   *
   * Both directions are a tween, and both replace whatever was running. A
   * pointer swept across four rows fires this eight times; without the handle
   * the old tweens keep animating and fight the new one, which reads as a
   * control that judders instead of settling.
   */
  private setPopped(popped: boolean): void {
    const scale = popped ? this.popScale() : 1;
    // Half the growth goes to each side, which is what makes it a swell rather
    // than a drift. At scale 1 these are both 0 and the container sits exactly
    // on its root. The arithmetic is `ui/focusPop.ts`'s, shared with the story
    // screens' kit and the Title, so one control cannot swell differently from
    // another (UR-111).
    const shift = focusPopShift(scale, { left: 0, top: 0, w: this.boxW, h: this.boxH });
    this.popTween?.remove();
    this.popTween = this.scene.tweens.add({
      targets: this.container,
      scaleX: scale,
      scaleY: scale,
      x: shift.x,
      y: shift.y,
      duration: DUR.focus,
      ease: EASE.pop,
    });
  }

  setFocused(focused: boolean): void {
    if (this.focused === focused) return;
    this.focused = focused;
    this.redraw();
    // A LOCKED CONTROL NEVER GROWS. It is focusable and readable (D73) but it
    // does not answer Enter, and size is the loudest promise this kit makes.
    this.setPopped(focused && !this.locked);
  }

  activate(): void {}
  adjust(_delta: number): void {}

  /**
   * The x a pointer click is measured against to decide down vs up.
   *
   * Defaults to the control's own middle, which is right for a row whose whole
   * width IS the control. A row that draws its hardware in one corner overrides
   * this with that hardware's centre - see UR-131 in `bindPointer`.
   */
  protected adjustPivotX(box: Box): number {
    return box.x + box.w / 2;
  }
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
      .setDepth(this.root.depth + 1)
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
        /**
         * ================== SPLIT AT THE HARDWARE, NOT THE ROW (UR-131) ==============
         * This was `box.x + box.w / 2` - the midpoint of the whole ROW. On the
         * settings console the knob sits at the far right of a row that is most
         * of the panel wide, so EVERY click on the knob lands in the right half
         * and sends +1. The owner reported it exactly: the volume could be
         * turned up and never down. The only way down was to click the label,
         * a couple of hundred pixels away from the thing that looks like the
         * control, which nobody would find.
         *
         * A control that draws its own hardware says where its centre is, and
         * the split happens THERE: left of the knob turns it down, right of it
         * turns it up, which is what the drawing already promises. Rows that
         * draw nothing keep the old behaviour by default.
         */
        handlers.adjust(pointer.worldX >= this.adjustPivotX(box) ? 1 : -1);
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
    this.popTween?.remove();
    this.popTween = null;
    // `root` owns the pop container, which owns every child, so this is the
    // one destroy the kit needs.
    this.root.destroy();
  }

  protected abstract redraw(): void;
  abstract toMirror(): MirrorItem;

  /**
   * Shared plate fill: sunken normally, raised on focus, flat when locked.
   *
   * ============= THE PLATE'S BORDER IS NEVER THE ACCENT (UR-112) =============
   *
   * ================== WHAT WAS REPORTED ==================
   * The project owner, on the profile picker: "there appear to be two
   * concentric yellow outlines around New Pilot ... one outline plus the
   * control's own stroke, giving a strange hollow double line".
   *
   * ================== WHAT IT ACTUALLY WAS ==================
   * Not two rings. `ui/chrome.FocusRing` has drawn exactly ONE stroke since
   * UR-82 took its halo away for this same complaint. The second line was
   * THIS ONE: the plate was stroked in `style.accent` at 3 px whenever the
   * control was focused, while the ring strokes `INK.accent` at
   * `SPACE.focusRingWidth` (4) px, `SPACE.focusRingOffset` (6) px outside the
   * same box. `style.accent` is the STOP's accent, the screen's stop is
   * `earth`, and Earth's palette accent is `#FFC857` - which is `INK.accent`
   * to the byte. Two identical gold outlines with a strip of sky between them,
   * and the held 1.5% swell closing the gap to about 4 px.
   *
   * ================== WHY THE RING KEEPS THE GOLD ==================
   * The Director map's Beacon Log and Settings chips are the owner's stated
   * standard, and their plate is `INK.panelRaised` with the DEFAULT line -
   * `ui/plate.paintPlate` only reaches for gold on a bracketed plate. The
   * accent belongs to the ring there and now here. Focus is still carried by
   * three things: the ring, the raised fill, and the held swell. One of them
   * is gold instead of two.
   *
   * The width still steps 2 -> 3 on focus. That is the plate's own edge getting
   * firmer, in the quiet line, and it is invisible as a second outline because
   * it is not a second colour.
   */
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
      hexToNum(INK.line),
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
    /**
     * THE GLYPH GETS THE SAME PADDING AS EVERY OTHER ELEMENT (UR-143).
     *
     * This was `max(textHeight, glyphSize) + rowPadY * 2`, so an 84 px avatar
     * sat in a 112 px row: 22 px of air to its LEFT (`rowPadX`) and 14 to its
     * top and bottom (`rowPadY`). The owner read that as the icon not keeping
     * the row's padding, and they are right - it is the one element on the row
     * whose margin depends on which axis you measure.
     *
     * The glyph is measured against `rowPadX` on all four sides, which is the
     * padding its LEFT edge already uses; text keeps `rowPadY`, because a line
     * of type has its own leading and does not need the same room as a disc.
     */
    this.boxH = Math.max(
      rowHeight(TYPE.body, style.lang),
      textHeight + SPACE.rowPadY * 2,
      glyphSize > 0 ? glyphSize + SPACE.rowPadX * 2 : 0,
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
      // UR-161: one breathe for every caret in the game. A yoyo covers the
      // band twice, so the tween runs half a cycle.
      this.caret.setAlpha(CARET.breatheMax);
      this.scene.tweens.add({
        targets: this.caret,
        alpha: CARET.breatheMin,
        duration: CARET.breatheMs / 2,
        ease: EASE.drift,
        yoyo: true,
        repeat: -1,
      });
    }
    // THE CARET GOES WHERE THE NEXT LETTER GOES (UR-87).
    //
    // It was always drawn past the END of `entry`, and when the field is empty
    // `entry` holds the PLACEHOLDER - so focusing an empty name box put the
    // caret after "Pilot Name", as though a child were about to type the
    // eleventh character of a word they had not written. The placeholder is
    // copy to be typed OVER, so the caret belongs at its first letter.
    //
    // `this.value`, not the rendered string: the rendered string is the
    // placeholder exactly when the value is empty, which is the one case this
    // has to tell apart.
    const typed = this.value !== "";
    this.caret.setPosition(
      this.entry.x + (typed ? this.entry.width + 6 : 0),
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
