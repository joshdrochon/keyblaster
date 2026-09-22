import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH } from "@game/sceneKeys";
import { DUR, EASE, INK, SPACE, TYPE } from "./theme.js";
import { plate, strokePlate, FocusRing } from "./chrome.js";
import { hexToNum } from "@game/render/palette";
import { FocusList, handleFocusKey } from "./focus.js";
import { type ControlStyle, MenuButton } from "./controls.js";
import type { MirrorItem } from "./mirror.js";
import { uiText } from "./text.js";

/**
 * The in-game confirm (design brief 13).
 *
 * DRAWN IN THE GAME, NEVER `window.confirm`. A browser dialog steals focus from
 * the canvas, cannot be styled, cannot be translated, and cannot be driven by
 * the keyboard path the rest of the game uses - it would break AC-18.1 on the
 * one screen that most needs to be calm.
 *
 * Two rules from D31 / the design brief:
 *  - NO RED. A destructive confirm is drawn in the same calm ink as everything
 *    else; it asks in plain words instead of shouting in colour.
 *  - THE SAFE CHOICE HAS FOCUS. "keep flying" / "keep my progress" is focused
 *    when the dialog opens, so Enter on reflex never destroys anything.
 */

export interface ConfirmOptions {
  readonly message: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly depth: number;
  /**
   * D41 / AC-19.3. The dialog's own focus ring breathes with the same spec as
   * the screen's (UR-112, `ui/focusPop.focusPulse`), so a confirm opened over a
   * calm-motion screen does not start moving.
   */
  readonly reducedMotion: boolean;
}

export class ConfirmDialog {
  readonly list = new FocusList();
  private readonly container: Phaser.GameObjects.Container;
  private readonly ring: FocusRing;
  private readonly buttons: MenuButton[] = [];
  private readonly message: string;
  private closed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    style: ControlStyle,
    private readonly options: ConfirmOptions,
  ) {
    this.message = options.message;
    this.container = scene.add.container(0, 0).setDepth(options.depth);

    // Scrim: dims what is behind without hiding it, so the child keeps their
    // place in the screen they are answering about.
    const scrim = scene.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, hexToNum(INK.bgDeep), 0.72)
      .setOrigin(0, 0);
    // Interactive so the scrim EATS clicks rather than letting them through to
    // the screen it is dimming. It does nothing with them: a modal that closes
    // when you click beside it is a modal a child dismisses by accident, and
    // this one is the "delete this pilot" confirm.
    scrim.setInteractive();
    this.container.add(scrim);

    const panelW = Math.min(1120, GAME_WIDTH - SPACE.gutter * 2);
    const text = uiText(scene, 0, 0, options.message, {
      size: TYPE.body,
      lang: style.lang,
      uppercase: style.uppercase,
      increasedLetterSpacing: style.increasedLetterSpacing,
      align: "center",
      wrapWidth: panelW - SPACE.gutter,
    });
    // Panel height is measured from the wrapped message, so a Spanish or Hindi
    // line that runs to three lines grows the panel instead of spilling out.
    const panelH = text.height + 220;
    const px = Math.round((GAME_WIDTH - panelW) / 2);
    const py = Math.round((GAME_HEIGHT - panelH) / 2);

    const g = scene.add.graphics();
    plate(g, px, py, panelW, panelH, hexToNum(INK.panel), 0.98, 24);
    strokePlate(g, px, py, panelW, panelH, hexToNum(INK.line), 2, 24);
    this.container.add(g);

    text.setPosition(
      Math.round(px + (panelW - text.width) / 2),
      Math.round(py + 56),
    );
    this.container.add(text);

    this.ring = new FocusRing(scene, options.depth + 1, options.reducedMotion);

    const cancel = new MenuButton(
      scene,
      style,
      "dialog.cancel",
      0,
      0,
      options.depth + 1,
      { label: options.cancelLabel, onPress: () => this.cancel() },
    );
    const confirm = new MenuButton(
      scene,
      style,
      "dialog.confirm",
      0,
      0,
      options.depth + 1,
      { label: options.confirmLabel, onPress: () => this.confirm() },
    );
    this.buttons.push(cancel, confirm);

    const gap = SPACE.gap * 2;
    const totalW =
      cancel.ringBounds().w + confirm.ringBounds().w + gap;
    const bx = Math.round(px + (panelW - totalW) / 2);
    const by = Math.round(py + panelH - 56 - cancel.ringBounds().h);
    cancel.node.setPosition(bx, by);
    confirm.node.setPosition(bx + cancel.ringBounds().w + gap, by);

    // Cancel first: it is what Enter does if nobody moves.
    this.list.setItems([cancel, confirm]);
    this.list.onChange(() => this.paintRing());
    this.list.focus("dialog.cancel");

    this.container.setAlpha(0);
    scene.tweens.add({
      targets: this.container,
      alpha: 1,
      duration: DUR.panel,
      ease: EASE.arrive,
    });
    this.paintRing();
  }

  private paintRing(): void {
    // A CLOSED DIALOG DOES NOT PAINT. `FocusList.activate` runs the item's
    // action and THEN notifies, so the press that closes this dialog arrives
    // back here afterwards - `close()` has already hidden the ring and killed
    // its pulse, and `moveTo` would make both come back. Measured: after
    // Keep Flying, the dialog's ring sat at its old box with alpha 1 and a
    // running pulse, over a menu that had moved on.
    if (this.closed) return;
    const current = this.list.current as MenuButton | null;
    if (!current) return;
    const b = current.ringBounds();
    this.ring.moveTo(b.x, b.y, b.w, b.h);
  }

  /** True when the dialog consumed the key. Esc always cancels. */
  handleKey(event: KeyboardEvent): boolean {
    if (this.closed) return false;
    return handleFocusKey(this.list, event, () => this.cancel());
  }

  get dialogText(): string {
    return this.message;
  }

  mirrorItems(): MirrorItem[] {
    return this.list.toMirror();
  }

  get ringVisible(): boolean {
    return this.ring.isVisible && !this.closed;
  }

  get focusId(): string | null {
    return this.list.focusId;
  }

  private confirm(): void {
    if (this.closed) return;
    this.close();
    this.options.onConfirm();
  }

  private cancel(): void {
    if (this.closed) return;
    this.close();
    this.options.onCancel();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.ring.hide();
    for (const b of this.buttons) b.destroy();
    this.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      duration: DUR.focus,
      ease: EASE.arrive,
      onComplete: () => this.container.destroy(),
    });
  }
}
