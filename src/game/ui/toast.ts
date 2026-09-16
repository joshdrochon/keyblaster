import Phaser from "phaser";
import { GAME_WIDTH } from "@game/sceneKeys";
import { layer } from "@game/render/layers";
import { DUR, EASE, INK, SPACE, TYPE } from "./theme.js";
import { plate, strokePlate } from "./chrome.js";
import { hexToNum } from "@game/render/palette";
import { publishToasts } from "./mirror.js";
import { plateWidth, uiText } from "./text.js";
import type { ControlStyle } from "./controls.js";

/**
 * Unlock toasts (design brief 13; D73 skins, D74 trophies).
 *
 * "Brief, celebratory, non-blocking, during flight or at Results." So:
 *  - it never takes focus and never pauses anything;
 *  - it is drawn on the HUD layer, top-right, out of the debris column;
 *  - it leaves on its own after ~3 s, and a second toast stacks under the
 *    first rather than replacing it;
 *  - it is informational, never comparative (D74) - "trophy earned", no rank,
 *    no count of other players, no score.
 *
 * `showToast` takes the calling scene, so Flight and Results can raise one
 * without owning any of this.
 *
 * ---------------------------------------------------------------------------
 * DO NOT USE `scene.time.delayedCall` FOR ANYTHING A TEST CAN SEE.
 *
 * Phaser 3.90's Clock advances on the SMOOTHED frame delta. In a throttled
 * headless browser that runs an order of magnitude behind the wall clock:
 * measured here, a 600 ms timer had accumulated 185 ms of `elapsed` after
 * 2.5 s of real time, and a 3.2 s timer simply never fired. Tweens run on the
 * same delta and DO complete, which is why the toast's exit below is a delayed
 * tween rather than a timer.
 *
 * This is worth knowing because of how it presents: the feature works on a real
 * machine, the e2e goes red, and the failure looks like flake. The tempting fix
 * is to weaken the assertion that appears to fail. It is not flake - it is a
 * timer that never fires - and weakening the assertion would ship a toast that
 * never leaves the screen.
 * ---------------------------------------------------------------------------
 */

const live: string[] = [];

export interface ToastOptions {
  readonly style: ControlStyle;
  readonly reducedMotion?: boolean;
  /** Milliseconds on screen. Defaults to DUR.toast. */
  readonly holdMs?: number;
}

export function showToast(
  scene: Phaser.Scene,
  message: string,
  options: ToastOptions,
): void {
  const { style } = options;
  const index = live.length;
  live.push(message);
  publishToasts(live);

  const container = scene.add
    .container(0, 0)
    .setDepth(layer("hud").depth + 10)
    .setScrollFactor(0);

  const g = scene.add.graphics();
  const text = uiText(scene, 0, 0, message, {
    size: TYPE.label,
    lang: style.lang,
    uppercase: style.uppercase,
    increasedLetterSpacing: style.increasedLetterSpacing,
  });

  const w = plateWidth(text, SPACE.rowPadX, 280);
  const h = text.height + SPACE.rowPadY * 2;
  plate(g, 0, 0, w, h, hexToNum(INK.panelRaised), 0.96);
  strokePlate(g, 0, 0, w, h, hexToNum(style.accent), 3);
  // A filled pip on the leading edge: the toast reads as an award even in a
  // desaturated frame (rubric 4).
  g.fillStyle(hexToNum(style.accent), 1);
  g.fillCircle(SPACE.rowPadX - 12, h / 2, 7);
  text.setPosition(SPACE.rowPadX + 6, SPACE.rowPadY);

  container.add([g, text]);
  const restX = GAME_WIDTH - w - SPACE.gutter;
  const restY = 64 + index * (h + 14);
  container.setPosition(restX + 80, restY);
  container.setAlpha(0);

  scene.tweens.add({
    targets: container,
    x: restX,
    alpha: 1,
    duration: DUR.toastIn,
    // Back.Out on arrival is the "pop" curve; under reduced motion the slide
    // is kept but the overshoot is not (AC-19.3 removes shake, not feedback).
    ease: options.reducedMotion ? EASE.arrive : EASE.pop,
  });

  // The exit is a DELAYED TWEEN, not `scene.time.delayedCall`. Phaser 3.90's
  // Clock advances on the smoothed frame delta, which in a throttled headless
  // browser runs an order of magnitude behind the wall clock - a timer set for
  // 3.2 s simply never fires there, while tweens on the same delta do complete.
  // The tween is also what actually draws the exit, so this is one mechanism
  // rather than two.
  scene.tweens.add({
    targets: container,
    alpha: 0,
    y: restY - 24,
    delay: options.holdMs ?? DUR.toast,
    duration: DUR.panel,
    ease: EASE.arrive,
    onComplete: () => {
      container.destroy();
      const at = live.indexOf(message);
      if (at >= 0) live.splice(at, 1);
      publishToasts(live);
    },
  });
}

/** Current toast text, for tests and for a scene restoring its mirror. */
export function liveToasts(): readonly string[] {
  return live;
}
