import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH } from "@game/sceneKeys";
import { layer } from "@game/render/layers";
import type { ShadowFigure } from "@game/render/shadow";
import type { StopId } from "@engine/types";
import { stopStaleScenes } from "@game/scenes/lib/init";
import { type App, appFor } from "./app.js";
import { FocusRing } from "./chrome.js";
import { buildParallax, type Parallax } from "@game/render/parallax";
import { type Control, type ControlStyle } from "./controls.js";
import { ConfirmDialog } from "./dialog.js";
import { FocusList, handleFocusKey } from "./focus.js";
import type { MenuKey, MenuTranslator } from "./i18n.js";
import { type HintLine, drawHint } from "./hintLine.js";
import { clearMirror, publishMirror } from "./mirror.js";
import { DUR, INK, SPACE, TYPE } from "./theme.js";
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
/**
 * Re-exported from `ui/layout.ts`, which is where they live: two of the four
 * menu screens are laid out by a plan in that module rather than by the scene.
 */
export { CONTENT_TOP, HEADING_TOP } from "./layout.js";
import { HEADING_TOP } from "./layout.js";

/** An eyebrow above the heading - a step counter, a section name. */
export const HEADING_EYEBROW_TOP = 44;

/**
 * How far the menu screens' focus ring sits outside a row (UR-143).
 *
 * 2, not the app's 6: the owner asked for the ring flush to the row's outline.
 * A row's own border is stroked at 3 when focused, which is 1.5 px outside its
 * box, so 2 is the tightest value that still leaves daylight between the two
 * lines instead of merging them into one thick edge.
 */
const MENU_RING_OFFSET = 2;

/** One seed for every menu, so the four screens share a sky (UR-155). */
const MENU_SKY_SEED = 0x0d13;

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

  private parallax: Parallax | null = null;
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

  /**
   * THE ACCENT THIS SCREEN WEARS, WHEN IT IS NOT A STOP'S (UR-123).
   *
   * ================== WHAT WAS REPORTED ==================
   * The project owner, on Ship Controls: the screen has no colour identity of
   * its own, it borrows Earth's. That is literally true and was true of every
   * menu - `paletteStop()` returns `"earth"` here, so eight screens wore the
   * launchpad's amber because a stop is the only thing this class knew how to
   * be dressed by.
   *
   * ================== WHY A HOOK AND NOT A SECOND PALETTE ENTRY ==========
   * The obvious fix was to add a palette keyed `"settings"`. It was rejected on
   * inspection: `StopPalette` is looked up by `StopId`, which is the route's own
   * type - `types.STOP_IDS`, `stageIndexOf`, `BELT_STOP_IDS`, the Director map's
   * seven discs, the debris tables (D71) and `stopBand`'s difficulty curve all
   * read it. A screen is not a place on the route, and widening the route's key
   * type so a menu can have a colour would put a non-place into every one of
   * those readers.
   *
   * So the BACKDROP still comes from a stop - this screen is still lit like the
   * rest of the product - and the ACCENT, which is the thing the report is
   * about, is a separate answer the screen may give. Returning null is the
   * default and leaves all eight other screens byte-identical.
   *
   * `SettingsScene` returns the pilot's dash colour, which is what makes the
   * identity the PLAYER'S rather than a ninth constant somebody chose.
   */
  protected accentOverride(): string | null {
    return null;
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

  create(data?: { readonly fadeIn?: boolean }): void {
    this.app = appFor(this);
    this.t = this.app.t();
    const dressed = this.app.style(this.paletteStop());
    const ownAccent = this.accentOverride();
    this.uiStyle = ownAccent === null ? dressed : { ...dressed, accent: ownAccent };

    if (this.wantsBackdrop) {
      // UR-155: the menus wear the Director map's sky, not a second one.
      // `chrome.Backdrop` was a flat gradient with round bubble-rocks; this is
      // the same stack every other screen draws, in the map's neutral config -
      // no planet framing and no debris plane, because a menu is not a place.
      this.parallax = buildParallax(this, {
        // UR-171: a menu borrows Earth's palette; it is not AT Earth.
        publishStop: false,
        palette: this.app.palette(this.paletteStop()),
        reducedMotion: this.reducedMotion,
        width: GAME_WIDTH,
        height: GAME_HEIGHT,
        decorate: ["sky", "farField", "midField", "nearField"],
        crossDrift: false,
        seed: MENU_SKY_SEED,
      });
    }
    // The ring breathes unless the player asked for calm motion (UR-112,
    // D41 / AC-19.3). The flag is passed, never defaulted: see `FocusRing`.
    /**
     * UR-131b: the ring wears an OVERRIDE, never the stop's accent.
     *
     * The first pass passed `this.uiStyle.accent`, which is the stop palette's
     * accent on every screen that has no override - and Earth's accent is
     * `#4A87E0`. So the profile picker's focus ring went blue. The chrome
     * accent is gold by decision (`INK.accent`, UR-49: "a theme may set the SKY
     * and nothing else"), and the dash colour is the ONE thing allowed to move
     * it, on the one screen that declares it.
     */
    this.ring = new FocusRing(
      this,
      this.depth + 2,
      this.reducedMotion,
      ownAccent ?? INK.accent,
      MENU_RING_OFFSET,
    );
    this.list.onChange(() => {
      this.moveRing();
      this.publish();
    });

    this.build();
    this.renderNotice();
    this.wireKeyboard();
    this.publish();
    // LAST, and after `build`: the camera fades up over a screen that is
    // already drawn, so the dissolve shows the destination rather than an
    // empty frame filling in behind it. No-op unless the caller asked (UR-118).
    this.fadeInIfAsked(data);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
  }

  override update(time: number, delta: number): void {
    this.elapsed += delta;
    this.parallax?.update(delta);
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
  /**
   * THE LINE EVERY MENU'S HEADING SITS ON (UR-85).
   *
   * Named rather than defaulted in a parameter, because the whole point is that
   * no screen gets to choose it. `ProfileCreateScene` used to draw its own
   * heading at 116 to make room for a step counter above it, so two screens a
   * child sees back to back put their title 32 px apart.
   */
  protected addHeading(
    key: MenuKey,
    y = HEADING_TOP,
    wrapWidth = GAME_WIDTH - SPACE.gutter * 2,
  ): Phaser.GameObjects.Text {
    const text = this.t.t(key);
    this.headingText = uiText(this, SPACE.gutter, y, text, {
      size: TYPE.display,
      lang: this.uiStyle.lang,
      uppercase: this.uiStyle.uppercase,
      increasedLetterSpacing: this.uiStyle.increasedLetterSpacing,
      wrapWidth,
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

  /**
   * The one-line keyboard hint every screen carries, bottom-left.
   *
   * IT IS THE INSTRUCTIONS, so it is not drawn in the faintest ink there is.
   * `INK.textFaint` measures ~3.4:1 on the panel and worse on the dark half of
   * the backdrop gradient: the one line telling a child which keys move them
   * around this screen was the least readable text on it (AC-22.8).
   *
   * A THIN CALL INTO `ui/hintLine.drawHint`, which is now the only thing in the
   * product that draws this line. This method used to be one of THREE renderers
   * for it - unplated `uiText` here, plated `skyText` on the map and results,
   * unplated `label` on pre-flight - and it owned its own `GAME_HEIGHT - 76`,
   * which is how the picker came to sit 32 px below the map's. It no longer
   * passes a position, because `drawHint` does not take one.
   */
  protected addHint(key: MenuKey = "ui.common.hintKeys"): HintLine {
    return drawHint(this, this.t.t(key), {
      screen: this.scene.key,
      id: key,
      depth: this.depth,
      style: this.uiStyle,
    });
  }

  protected setControls(controls: readonly Control[], focusId?: string): void {
    this.list.setItems(controls, focusId);
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
    this.ring.setDimmed(current.locked);
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
    // The screen behind a modal stops taking clicks. The keyboard already went
    // to the dialog first (see `wireKeyboard`); this is the same rule for the
    // pointer, so "are you sure" cannot be answered by clicking past it.
    this.list.setPointerEnabled(false);
    this.dialog = new ConfirmDialog(this, this.uiStyle, {
      message: options.message,
      confirmLabel: options.confirmLabel,
      cancelLabel: options.cancelLabel,
      depth: this.depth + 20,
      reducedMotion: this.reducedMotion,
      onConfirm: () => {
        this.dialog = null;
        this.list.setPointerEnabled(true);
        options.onConfirm();
        this.publish();
      },
      onCancel: () => {
        this.dialog = null;
        this.list.setPointerEnabled(true);
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
  protected goTo(key: string, data?: object, options?: { readonly fade?: boolean }): boolean {
    if (this.scene.get(key) === null) {
      console.warn(`[kb] scene "${key}" is not registered yet; staying put`);
      return false;
    }
    // The same invariant the story lane's `goTo` enforces: one place at a time.
    // This path matters most on the pause menu's "quit to map", which stopped
    // the belt but left the HUD running - so the readouts were still drawn over
    // the Director map, and over the Settings panel after that.
    const start = (): void => {
      stopStaleScenes(this, key);
      // UR-182: never `undefined` - see the note on `lib/init.goTo`.
      this.scene.start(key, data ?? {});
    };
    /**
     * OPT IN, NOT ON BY DEFAULT (UR-118).
     *
     * Most moves between menus are a change of PLACE - the map, settings, the
     * beacon log - and a cut is the honest way to show that. A fade says the
     * two screens are the same place at two moments, which is true of exactly
     * one pair here: the pilot picker handing over to pilot creation. Making
     * every menu dissolve would spend 260 ms on every navigation to say
     * something that is only true once.
     *
     * The other half is `MenuScene.fadeInIfAsked`, called from `create`: a
     * fade-out with no fade-in is a screen that goes black and then snaps,
     * which looks more broken than the cut it replaced.
     */
    if (options?.fade !== true) {
      start();
      return true;
    }
    this.cameras.main.fadeOut(DUR.panel, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, start);
    return true;
  }

  /**
   * Fade this screen up when it was entered through a fading `goTo`.
   *
   * Reads the flag off the scene's own init data rather than off a field, so a
   * screen that Phaser re-runs `create` on (it builds each scene once and
   * re-enters it) does not keep fading in forever on later visits.
   */
  protected fadeInIfAsked(data?: { readonly fadeIn?: boolean }): void {
    if (data?.fadeIn !== true) return;
    this.cameras.main.fadeIn(DUR.panel, 0, 0, 0);
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
    this.parallax?.destroy();
    this.parallax = null;
    for (const shadow of this.shadows) shadow.destroy();
    this.shadows.length = 0;
    if (this.onKey) this.input.keyboard?.off("keydown", this.onKey);
    this.onKey = null;
    this.dialog?.close();
    this.dialog = null;
    clearMirror(this.scene.key);
  }
}
