import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH } from "@game/sceneKeys";
import { layer } from "@game/render/layers";
import type { ShadowFigure } from "@game/render/shadow";
import type { StopId } from "@engine/types";
import { type App, appFor } from "./app.js";
import { Backdrop, FocusRing } from "./chrome.js";
import { type Control, type ControlStyle } from "./controls.js";
import { ConfirmDialog } from "./dialog.js";
import { FocusList, handleFocusKey } from "./focus.js";
import type { MenuKey, MenuTranslator } from "./i18n.js";
import { clearMirror, publishMirror } from "./mirror.js";
import { INK, SPACE, TYPE } from "./theme.js";
import { uiText } from "./text.js";
import { showToast } from "./toast.js";

/**
 * The base every menu screen in this lane extends.
 *
 * It owns the four things all five screens must get right and none of them
 * should re-solve:
 *
 *  - KEYBOARD ONLY (D37, AC-18.1). One keydown listener, Tab's default
 *    prevented so the browser cannot walk focus out of the canvas and strand
 *    the player, and Esc always going back.
 *  - A VISIBLE FOCUS STATE on every interactive element (AC-18.1), via one ring
 *    that moves between controls.
 *  - THE DOM MIRROR, republished on every change, so the screen is legible to a
 *    screen reader and assertable by Playwright (mirror.ts).
 *  - THE CALM NOTICE LINE (AC-18.4), rendered once, one line, non-blocking.
 */
export abstract class MenuScene extends Phaser.Scene {
  protected app!: App;
  protected t!: MenuTranslator;
  protected uiStyle!: ControlStyle;
  protected readonly list = new FocusList();
  protected ring!: FocusRing;
  protected dialog: ConfirmDialog | null = null;

  /**
   * Shadow figures drawn by this screen.
   *
   * `render/shadow.ts` returns a handle whose ambient life - the face-plate
   * glow pulse and the hover bob (art-direction section 6) - is driven from the
   * scene clock rather than by a tween, so it has to be stepped every frame. A
   * figure that is never updated is a Shadow that has stopped breathing, which
   * is rubric item 2 failing on four screens at once.
   */
  protected readonly shadows: ShadowFigure[] = [];

  private backdrop: Backdrop | null = null;
  private heading = "";
  private headingText: Phaser.GameObjects.Text | null = null;
  private noticeLine: Phaser.GameObjects.Text | null = null;
  private onKey: ((event: KeyboardEvent) => void) | null = null;
  private elapsed = 0;

  /** Depth band for menu chrome: above the world, below toasts. */
  protected get depth(): number {
    return layer("hud").depth;
  }

  /** Override to `false` for an overlay that sits on a live scene (Pause). */
  protected get wantsBackdrop(): boolean {
    return true;
  }

  /** The stop whose palette dresses this screen. */
  protected paletteStop(): StopId {
    return "earth";
  }

  /** Build the screen. Call `setControls` with the focus order at the end. */
  protected abstract build(): void;

  /** Where Esc goes. Every screen must be returnable by keyboard (AC-18.1). */
  protected abstract goBack(): void;

  /**
   * A screen-specific key, handled before navigation. Return true to consume.
   * Used for the picker's "remove this pilot" shortcut; kept as a hook so the
   * keyboard path stays in ONE place rather than each scene adding a listener.
   */
  protected extraKey(_event: KeyboardEvent): boolean {
    return false;
  }

  create(): void {
    this.app = appFor(this);
    this.t = this.app.t();
    this.uiStyle = this.app.style(this.paletteStop());

    if (this.wantsBackdrop) {
      this.backdrop = new Backdrop(
        this,
        this.app.palette(this.paletteStop()),
        this.reducedMotion,
      );
    }
    this.ring = new FocusRing(this, this.depth + 2);
    this.list.onChange(() => {
      this.moveRing();
      this.publish();
    });

    this.build();
    this.renderNotice();
    this.wireKeyboard();
    this.publish();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
  }

  override update(time: number, delta: number): void {
    this.elapsed += delta;
    this.backdrop?.update(this.elapsed);
    for (const shadow of this.shadows) shadow.update(time);
  }

  protected get reducedMotion(): boolean {
    return this.app.services.context.reducedMotion;
  }

  // -- layout helpers -------------------------------------------------------

  /**
   * The screen title. Sized to content in the current language; the heading is
   * never given a fixed width, because "Beacon Log" -> "Registro de balizas" is
   * +90% and a fixed plate would clip it.
   */
  protected addHeading(key: MenuKey, y = 84): Phaser.GameObjects.Text {
    const text = this.t.t(key);
    this.headingText = uiText(this, SPACE.gutter, y, text, {
      size: TYPE.display,
      lang: this.uiStyle.lang,
      uppercase: this.uiStyle.uppercase,
      increasedLetterSpacing: this.uiStyle.increasedLetterSpacing,
      wrapWidth: GAME_WIDTH - SPACE.gutter * 2,
    }).setDepth(this.depth);
    // Mirror what is DRAWN, not what came out of the table: the letter-case
    // setting (D41) is applied by uiText, and a mirror that reported the raw
    // string would let a broken case setting pass an e2e.
    this.heading = this.headingText.text;
    return this.headingText;
  }

  protected setHeadingText(text: string): void {
    this.heading = text;
  }

  /** The one-line keyboard hint every screen carries, bottom-left. */
  protected addHint(key: MenuKey = "ui.common.hintKeys"): Phaser.GameObjects.Text {
    return uiText(this, SPACE.gutter, GAME_HEIGHT - 76, this.t.t(key), {
      size: TYPE.caption,
      color: INK.textFaint,
      lang: this.uiStyle.lang,
      uppercase: this.uiStyle.uppercase,
      increasedLetterSpacing: this.uiStyle.increasedLetterSpacing,
    }).setDepth(this.depth);
  }

  protected setControls(controls: readonly Control[]): void {
    this.list.setItems(controls);
    this.moveRing();
    this.publish();
  }

  private moveRing(): void {
    const current = this.list.current as Control | null;
    if (!current) {
      this.ring.hide();
      return;
    }
    // The ring follows a locked item too: AC-18.1 asks for a visible focus
    // state on every interactive element, and a locked tile you can read is
    // one of them.
    const b = current.ringBounds();
    this.ring.moveTo(b.x, b.y, b.w, b.h);
  }

  // -- notice ---------------------------------------------------------------

  /**
   * AC-18.4. One calm line, low on the screen, never a dialog and never
   * something the player has to dismiss before they can fly.
   */
  private renderNotice(): void {
    const line = this.app.takeNoticeText();
    if (line === null) return;
    this.noticeLine = uiText(this, SPACE.gutter, GAME_HEIGHT - 132, line, {
      size: TYPE.caption,
      color: INK.textDim,
      lang: this.uiStyle.lang,
      uppercase: this.uiStyle.uppercase,
      increasedLetterSpacing: this.uiStyle.increasedLetterSpacing,
      wrapWidth: GAME_WIDTH - SPACE.gutter * 2,
    }).setDepth(this.depth);
  }

  // -- keyboard -------------------------------------------------------------

  private wireKeyboard(): void {
    const handler = (event: KeyboardEvent): void => {
      // Never fight a browser shortcut: Ctrl/Cmd/Alt combos belong to the OS.
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (this.dialog) {
        if (this.dialog.handleKey(event)) event.preventDefault();
        this.publish();
        return;
      }

      const current = this.list.current as Control | null;
      if (
        current &&
        current.capturesTyping &&
        event.key !== "Enter" &&
        event.key !== "Tab" &&
        event.key !== "Escape" &&
        event.key !== "ArrowUp" &&
        event.key !== "ArrowDown" &&
        current.typeKey(event.key)
      ) {
        event.preventDefault();
        this.publish();
        return;
      }

      if (this.extraKey(event)) {
        event.preventDefault();
        this.publish();
        return;
      }

      if (handleFocusKey(this.list, event, () => this.goBack())) {
        // Tab especially: the canvas has no tab stops, so the browser default
        // would move focus out of the document and end the keyboard session.
        event.preventDefault();
        this.publish();
      }
    };
    this.onKey = handler;
    this.input.keyboard?.on("keydown", handler);
  }

  // -- dialog ---------------------------------------------------------------

  /**
   * Open the in-game confirm. Never `window.confirm`: a browser dialog steals
   * the keyboard from the canvas, cannot be translated and cannot be drawn
   * without red, all three of which this game's rules forbid.
   */
  protected openConfirm(options: {
    message: string;
    confirmLabel: string;
    cancelLabel: string;
    onConfirm: () => void;
    onCancel?: () => void;
  }): void {
    this.dialog?.close();
    this.dialog = new ConfirmDialog(this, this.uiStyle, {
      message: options.message,
      confirmLabel: options.confirmLabel,
      cancelLabel: options.cancelLabel,
      depth: this.depth + 20,
      onConfirm: () => {
        this.dialog = null;
        options.onConfirm();
        this.publish();
      },
      onCancel: () => {
        this.dialog = null;
        options.onCancel?.();
        this.moveRing();
        this.publish();
      },
    });
    this.dialog.list.onChange(() => this.publish());
    this.publish();
  }

  /**
   * Raise an unlock toast over this screen (design brief 13, D73/D74).
   *
   * Thin on purpose: the toast itself is `showToast(scene, message, options)`,
   * which any scene can call - Flight and Results raise theirs the same way,
   * without extending this class. This wrapper just binds the typography and
   * the reduced-motion flag so a caller inside the menu lane cannot get them
   * out of step with the screen they are drawn over.
   */
  raiseToast(message: string, holdMs?: number): void {
    showToast(this, message, {
      style: this.uiStyle,
      reducedMotion: this.reducedMotion,
      ...(holdMs === undefined ? {} : { holdMs }),
    });
  }

  // -- navigation -----------------------------------------------------------

  /**
   * Start another scene IF it exists.
   *
   * Scene lanes land in parallel and boot only registers the files on disk, so
   * a menu that hard-starts `DirectorMap` before that lane lands takes the
   * screen down. Missing targets are logged and the current screen simply
   * stays up, which is a dead end but never a crash.
   */
  protected goTo(key: string, data?: object): boolean {
    if (this.scene.get(key) === null) {
      console.warn(`[kb] scene "${key}" is not registered yet; staying put`);
      return false;
    }
    this.scene.start(key, data);
    return true;
  }

  // -- mirror ---------------------------------------------------------------

  protected publish(): void {
    const dialog = this.dialog;
    publishMirror({
      scene: this.scene.key,
      heading: this.heading,
      items: dialog ? dialog.mirrorItems() : this.list.toMirror(),
      focusId: dialog ? dialog.focusId : this.list.focusId,
      focusRing: dialog ? dialog.ringVisible : this.ring.isVisible,
      dialog: dialog ? dialog.dialogText : null,
      notice: this.noticeLine?.text ?? null,
    });
  }

  /**
   * Cross-lane compatibility: the story lanes read `scene.snapshot()` from
   * their probe. Same facts as the DOM mirror, as a plain object.
   */
  snapshot(): Record<string, unknown> {
    return {
      scene: this.scene.key,
      heading: this.heading,
      focusId: this.list.focusId,
      focusRing: this.ring?.isVisible ?? false,
      items: this.list.toMirror(),
      dialog: this.dialog?.dialogText ?? null,
      notice: this.noticeLine?.text ?? null,
      // Pixel facts the e2e uses to prove a setting TOOK EFFECT rather than
      // merely being stored (AC-19.1): the heading's rendered width moves when
      // letter case, letter spacing or the UI language changes, and the accent
      // moves when the colourblind palette is switched.
      headingWidth: Math.round(this.headingText?.width ?? 0),
      accent: this.uiStyle.accent,
      reducedMotion: this.reducedMotion,
    };
  }

  private teardown(): void {
    for (const shadow of this.shadows) shadow.destroy();
    this.shadows.length = 0;
    if (this.onKey) this.input.keyboard?.off("keydown", this.onKey);
    this.onKey = null;
    this.dialog?.close();
    this.dialog = null;
    clearMirror(this.scene.key);
  }
}
