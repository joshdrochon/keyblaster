import type { MirrorItem } from "./mirror.js";

/**
 * Focus, the way everything in this game is operated (D37, AC-18.1).
 *
 * One list owns the caret for a screen, every control reports whether it is
 * focused, and the scene mirrors that into the DOM so both a screen reader and
 * an e2e test can see it.
 *
 * THE KEYBOARD IS THE INPUT MODEL AND IT IS STILL SUFFICIENT ON ITS OWN
 * (D37, AC-18.1). Nothing below adds a control the keyboard cannot reach, and
 * no screen may require a pointer for anything. What it adds is that the mouse
 * is no longer INERT: D37 chose the keyboard, it never forbade a mouse, and a
 * child who clicks a button and gets nothing back concludes the game is broken
 * rather than that it is keyboard-first.
 *
 * FOCUSABLE AND CLICKABLE ARE ONE THING. `FocusList.setItems` binds the pointer
 * for every item it is given (`bindPointer` below), so a screen cannot add a
 * control that only one input reaches: to be in the focus list IS to be
 * clickable, and to be clickable you must be in the focus list.
 *
 * HOVER MOVES FOCUS rather than painting a second highlight. There is exactly
 * one "you are here" in this UI - the ring plus the control's own raised plate
 * - and inventing a hover-only state would mean two competing highlights on
 * screen and two things for a screen reader's mirror to disagree about.
 */

/**
 * Every pointer hit area in the game is a Phaser Zone named
 * `kb-hit:<focusable id>`.
 *
 * The naming is not decoration. It is what lets one e2e enumerate a screen's
 * hit areas and assert they are EXACTLY the focusable set - neither a control
 * only the keyboard can reach, nor a click target with no focus entry - which
 * is the invariant this whole file exists to hold. Both menu kits use it
 * (`ui/controls.ts` and `scenes/lib/kit.ts`), as do the two screens that
 * predate them (Title, Stall).
 */
export const HIT_ZONE_PREFIX = "kb-hit:";

/** What a control calls when a pointer reaches it. Supplied by `FocusList`. */
export interface PointerHandlers {
  /** The pointer is over this control: make it the focused one. */
  focus(): void;
  /** The pointer pressed this control: focus it, then do what Enter does. */
  press(): void;
  /**
   * The pointer pressed an ADJUSTABLE control. `delta` is -1 for the left half
   * of the box and +1 for the right half, so a slider or an option row answers
   * a click the same way it answers Left/Right.
   */
  adjust(delta: number): void;
  /** 0..1 for a control with a position (a knob); null for everything else. */
  detentLevel?(): number | null;
}

export interface Focusable {
  readonly id: string;
  /** Visible but not choosable - a locked skin, an unlit stop. */
  readonly locked: boolean;
  /** True when Left/Right belong to the control rather than to navigation. */
  readonly adjustable: boolean;
  setFocused(focused: boolean): void;
  /** Enter or Space. */
  activate(): void;
  /** Left/Right, +1/-1. No-op unless `adjustable`. */
  adjust(delta: number): void;
  /**
   * 0..1 for a control that HAS a position - a knob - and null or absent for
   * everything else (UR-133). Optional, so the twelve controls that are not
   * knobs need no stub and keep the flat nav blip.
   */
  detentLevel?(): number | null;
  toMirror(): MirrorItem;
  /**
   * Wire this control's hit area to the list (AC-18.1's pointer half).
   *
   * Optional so a non-visual `Focusable` in a unit test needs no stub, but
   * every real control in `controls.ts` implements it - and `setItems` calls it
   * on everything, so forgetting it is the only way to ship a keyboard-only
   * control, and that is a missing method rather than a missing call site.
   */
  bindPointer?(handlers: PointerHandlers): void;
  /** Take the pointer away (a modal is open) without losing the binding. */
  setPointerEnabled?(enabled: boolean): void;
}

/** What the scene is told after any focus or value change. */
export type FocusListener = () => void;

/**
 * The UI sound hook (D62 "UI sounds for every interaction", AC-21.3 `uiNav`).
 *
 * WHY IT IS A MODULE-LEVEL HOOK AND NOT A CONSTRUCTOR ARGUMENT. Every screen in
 * the game builds its own `FocusList`, several of them inside `MenuScene`'s
 * base class, and a few before `appFor(scene)` has run. Threading an audio
 * handle through all of those is the kind of change that lands on fifteen of
 * sixteen screens - and the sixteenth is then silently mute, which is the exact
 * failure mode this whole fix exists to undo. Boot sets it once; every list in
 * the game is audible from that moment, including ones built later.
 *
 * Null by default, so a focus list in a unit test or a standalone scene makes
 * no sound and needs no stub.
 */
export type UiSoundKind = "nav" | "activate" | "detent";
/**
 * `amount` is only meaningful for "detent": where the knob now points, 0..1.
 * Optional so the two existing kinds and every existing caller are unchanged.
 */
export type UiSound = (kind: UiSoundKind, amount?: number) => void;

let uiSound: UiSound | null = null;

/** Boot calls this with the audio service's `uiNav`. Pass null to unhook. */
export function setUiSound(hook: UiSound | null): void {
  uiSound = hook;
}

/**
 * Make the UI blip, if anything is listening.
 *
 * Exported because this kit's `FocusList` is not the only keyboard menu in the
 * game: the story lane's screens (title, map, briefing, warp, beacon, results,
 * ending) drive `createKeyboardMenu` in `scenes/lib/kit.ts` instead. Both call
 * this, so "UI sounds for every interaction" (D62) means every interaction and
 * not just the ones on the five screens that happen to use this file.
 */
export function uiSoundBlip(kind: UiSoundKind, amount?: number): void {
  if (uiSound === null) return;
  try {
    uiSound(kind, amount);
  } catch {
    // A sound that throws must never take a menu down with it.
  }
}

export class FocusList {
  private items: Focusable[] = [];
  private index = 0;
  private focusable = true;
  private readonly listeners: FocusListener[] = [];

  /**
   * UR-192: a screen whose rows are a READOUT passes `focusable: false`. The
   * items are still mirrored and still clickable-free; they simply never take
   * the ring, because nothing here is operable and a ring on an inert row
   * promises something Enter does not do.
   */
  setItems(items: readonly Focusable[], focusId?: string, focusable = true): void {
    this.items = [...items];
    this.focusable = focusable;
    if (!focusable) {
      this.index = -1;
      this.paint();
      return;
    }
    // START WHERE THE CALLER SAYS, NOT AT ZERO.
    //
    // A screen that restarts itself to redraw under a changed setting used to
    // land here at index 0, paint (which moves the focus ring), and only then
    // restore the row the child was on. That is one frame of the ring sitting
    // on the FIRST control - the music row - before it jumps back, on every
    // single setting change. Restoring afterwards fixed the focus and could
    // never fix the flash, because the wrong frame had already been drawn.
    const wanted = focusId === undefined ? -1 : this.items.findIndex((i) => i.id === focusId);
    this.index = wanted < 0 ? 0 : wanted;
    // Every item in the list becomes clickable here, in ONE place. A screen
    // builds controls and hands them over; it never decides, per control,
    // whether the mouse works on it.
    for (const item of this.items) this.bind(item);
    this.paint();
  }

  private bind(item: Focusable): void {
    if (typeof item.bindPointer !== "function") return;
    item.bindPointer({
      focus: () => {
        this.focus(item.id);
      },
      press: () => {
        this.focus(item.id);
        this.activate();
      },
      adjust: (delta: number) => {
        this.focus(item.id);
        this.adjust(delta);
      },
    });
  }

  /**
   * ADDITIVE, NOT A SLOT. This was `this.listener = listener`, so the LAST
   * caller silently won - and the confirm dialog registered `paintRing` before
   * `PauseScene` registered `publish`, so the dialog's focus ring stopped
   * following focus entirely. Measured: focus moved cancel -> confirm while the
   * ring's box stayed at x 790, the cancel button's, and the confirm button at
   * x 1056 never showed one. Nothing errored and no test failed; one screen
   * quietly lost its selection outline.
   */
  onChange(listener: FocusListener): void {
    this.listeners.push(listener);
  }

  get all(): readonly Focusable[] {
    return this.items;
  }

  get current(): Focusable | null {
    if (!this.focusable) return null;
    return this.items[this.index] ?? null;
  }

  get focusId(): string | null {
    return this.current?.id ?? null;
  }

  /** True when a ring is drawn right now. Mirrored for AC-18.1. */
  get ringVisible(): boolean {
    return this.current !== null;
  }

  focus(id: string): boolean {
    const i = this.items.findIndex((item) => item.id === id);
    if (i < 0) return false;
    // Only a MOVE is a sound. `focus(currentId)` is how a scene restores the
    // caret after a restart, and a blip there would make the settings screen
    // chirp at itself every time a slider is nudged.
    const moved = i !== this.index;
    this.index = i;
    this.paint();
    if (moved) uiSoundBlip("nav");
    return true;
  }

  /**
   * Move one item. Wraps: a menu that stops dead at the last row makes a child
   * think the keyboard broke.
   *
   * LOCKED ITEMS ARE STILL FOCUSABLE. A locked skin has to be readable - "you
   * get this at a 25 chain" is the whole reason it is on screen (D73) - and a
   * screen reader can only read what focus can reach. Locked changes what Enter
   * does, not whether you can look.
   */
  move(step: number): void {
    if (this.items.length === 0) return;
    const n = this.items.length;
    this.index = (((this.index + step) % n) + n) % n;
    this.paint();
    uiSoundBlip("nav");
  }

  activate(): void {
    const c = this.current;
    if (c && !c.locked) {
      c.activate();
      this.notify();
      uiSoundBlip("activate");
    }
  }

  adjust(delta: number): void {
    const c = this.current;
    if (!c || c.locked) return;
    if (c.adjustable) {
      c.adjust(delta);
      this.notify();
      /**
       * A KNOB CLICKS, AND THE CLICK CLIMBS (UR-133).
       *
       * `detentLevel` is a control's own position, 0..1, and only a knob has
       * one - everything else returns null and keeps the flat nav blip it has
       * always had. A knob's detent is pitched from that position, so sweeping
       * the volume up runs up the scale and sweeping it down runs down it.
       *
       * It is `uiNav` underneath, on the `sfx` bus, which is why the Sound knob
       * turning itself down also turns its own click down - the thing the owner
       * asked for, and free rather than wired.
       */
      const level = c.detentLevel?.() ?? null;
      if (level !== null) {
        uiSoundBlip("detent", level);
        return;
      }
      // A slider step is an interaction too - and it is the one a child
      // dragging the SFX volume is listening to while they drag it.
      uiSoundBlip("nav");
    } else {
      this.move(delta);
    }
  }

  /**
   * Suspend or restore the pointer for the whole screen.
   *
   * The keyboard is deliberately NOT touched: `MenuScene` already routes every
   * key to the open dialog first, so the modal's keyboard behaviour is unchanged
   * and this only stops a click from reaching a button behind the scrim.
   */
  setPointerEnabled(enabled: boolean): void {
    for (const item of this.items) item.setPointerEnabled?.(enabled);
  }

  toMirror(): MirrorItem[] {
    return this.items.map((item, i) => ({
      ...item.toMirror(),
      focused: i === this.index,
    }));
  }

  private paint(): void {
    this.items.forEach((item, i) => item.setFocused(i === this.index));
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

/**
 * The shared key map. Vertical lists move on Up/Down and Tab; Left/Right belong
 * to the focused control if it wants them (a slider, a layout picker) and fall
 * back to navigation if it does not, so arrow keys never feel dead.
 *
 * Returns true when the key was consumed.
 */
export function handleFocusKey(
  list: FocusList,
  event: KeyboardEvent,
  onBack: () => void,
): boolean {
  switch (event.key) {
    case "ArrowDown":
      list.move(1);
      return true;
    case "ArrowUp":
      list.move(-1);
      return true;
    case "ArrowRight":
      list.adjust(1);
      return true;
    case "ArrowLeft":
      list.adjust(-1);
      return true;
    case "Tab":
      list.move(event.shiftKey ? -1 : 1);
      return true;
    case "Enter":
    case " ":
      list.activate();
      return true;
    case "Escape":
      onBack();
      return true;
    default:
      return false;
  }
}
