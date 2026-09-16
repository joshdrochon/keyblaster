import type { MirrorItem } from "./mirror.js";

/**
 * Keyboard focus, the only way anything in this game is operated (D37, AC-18.1).
 *
 * There is no pointer path and no hidden DOM focus. One list owns the caret for
 * a screen, every control reports whether it is focused, and the scene mirrors
 * that into the DOM so both a screen reader and an e2e test can see it.
 */

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
  toMirror(): MirrorItem;
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
export type UiSoundKind = "nav" | "activate";
export type UiSound = (kind: UiSoundKind) => void;

let uiSound: UiSound | null = null;

/** Boot calls this with the audio service's `uiNav`. Pass null to unhook. */
export function setUiSound(hook: UiSound | null): void {
  uiSound = hook;
}

/** The hook currently installed. Read by the wiring evidence. */
export function currentUiSound(): UiSound | null {
  return uiSound;
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
export function uiSoundBlip(kind: UiSoundKind): void {
  if (uiSound === null) return;
  try {
    uiSound(kind);
  } catch {
    // A sound that throws must never take a menu down with it.
  }
}

const blip = uiSoundBlip;

export class FocusList {
  private items: Focusable[] = [];
  private index = 0;
  private listener: FocusListener = () => {};

  setItems(items: readonly Focusable[]): void {
    this.items = [...items];
    this.index = 0;
    this.paint();
  }

  onChange(listener: FocusListener): void {
    this.listener = listener;
  }

  get all(): readonly Focusable[] {
    return this.items;
  }

  get current(): Focusable | null {
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
    if (moved) blip("nav");
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
    blip("nav");
  }

  activate(): void {
    const c = this.current;
    if (c && !c.locked) {
      c.activate();
      this.listener();
      blip("activate");
    }
  }

  adjust(delta: number): void {
    const c = this.current;
    if (!c || c.locked) return;
    if (c.adjustable) {
      c.adjust(delta);
      this.listener();
      // A slider step is an interaction too - and it is the one a child
      // dragging the SFX volume is listening to while they drag it.
      blip("nav");
    } else {
      this.move(delta);
    }
  }

  toMirror(): MirrorItem[] {
    return this.items.map((item, i) => ({
      ...item.toMirror(),
      focused: i === this.index,
    }));
  }

  private paint(): void {
    this.items.forEach((item, i) => item.setFocused(i === this.index));
    this.listener();
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
