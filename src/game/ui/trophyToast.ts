import Phaser from "phaser";
import { GAME_WIDTH } from "@game/sceneKeys";
import { layer } from "@game/render/layers";
import { hexToNum } from "@game/render/palette";
import { audioFrom } from "@game/audio/wiring";
import { TROPHIES } from "./catalog.js";
import { plate, strokePlate } from "./chrome.js";
import { publishToasts } from "./mirror.js";
import { createMenuTranslator } from "./i18n.js";
import type { UiStringKey } from "./strings.js";
import { uiText } from "./text.js";
import { EASE, INK } from "./theme.js";
import { playTrophyCue } from "./trophyCue.js";
import {
  TROPHY_CHIP,
  TROPHY_CYCLE_MS,
  TROPHY_EVENT as EARNED,
  TROPHY_TIMING,
  chipEntryOffsetY,
  chipRect,
} from "./trophyToastLayout.js";
import type { Lang } from "@engine/types";

/**
 * THE IN-FLIGHT TROPHY NOTIFICATION (D74, D80; collision C24).
 *
 * ================== WHY THIS IS NOT `ui/toast.ts` ==================
 * `ui/toast.ts` says in its own header that it is for "during flight or at
 * Results", and it has never been able to do either. Three things stop it, and
 * all three are measured in `tests/unit/ui/trophyToast.test.ts`:
 *
 *  1. ITS POSITION. Its rest rectangle at a 1920 world is (1544, 64, 280, 59).
 *     That overlaps the HUD's right plate - the score, the hull label and the
 *     three hull marks - by 164 x 50 px, and puts 56 px of itself inside the
 *     corridor falling words travel down.
 *  2. ITS STACKING. A second toast is drawn `h + 14` lower. During a belt
 *     there is no lower: the only region free of the HUD and the word band is
 *     the 49.5 px strip under the band, and one chip is 44 of them.
 *  3. NOBODY CALLS IT. Its only caller is `MenuScene.raiseToast`, and nothing
 *     calls that either. It is the third fully-built unreachable feature on
 *     this screen's list, after twelve trophies with no writer and four hulls
 *     with no writer.
 *
 * So this is the flight-time component, and `ui/toast.ts` keeps the menus.
 * They share the DOM mirror (`publishToasts`), the tween-not-timer rule, and
 * the rule that a notification never takes focus.
 *
 * ================== IT MUST NEVER TAKE FOCUS OR BLOCK INPUT ==================
 * The child is mid-belt with their hands on the keyboard. Nothing here calls
 * `setInteractive`, registers a key, adds a `FocusTarget`, pauses a scene or
 * touches the keyboard plugin. The container is `setScrollFactor(0)` and is
 * drawn and forgotten. `showTrophyToast` returns `void` on purpose: there is
 * no handle to wait on, because nothing may wait on it.
 *
 * ================== AND IT MUST BE RAISED FROM `HudScene` ==================
 * NOT from `FlightScene`. `HudScene.create` calls `this.scene.bringToTop()`,
 * and scene render order beats object depth - a container created on the
 * flight scene at any depth renders UNDER the HUD. `showTrophyToast` takes the
 * scene it is drawn on, so the caller decides; `listenForTrophies` below is
 * the wiring that puts it on the right one.
 *
 * ---------------------------------------------------------------------------
 * DO NOT USE `scene.time.delayedCall` FOR ANYTHING A TEST CAN SEE. Phaser
 * 3.90's Clock advances on the SMOOTHED frame delta; in a throttled headless
 * browser a 3.2 s timer simply never fires, while tweens on the same delta do
 * complete. `ui/toast.ts` carries the measurement. Every delay here is a tween
 * delay for that reason.
 * ---------------------------------------------------------------------------
 */

/** The game-level event a scene emits to raise one. See `flightTrophyToast`. */
export const TROPHY_EVENT = "kb.trophy.earned";

export interface TrophyToastOptions {
  readonly lang: Lang;
  /** The stop's accent, so the chip is dressed like the screen it is on. */
  readonly accent: string;
  readonly reducedMotion?: boolean;
  readonly uppercase?: boolean;
  readonly increasedLetterSpacing?: boolean;
  /** Milliseconds before this chip begins. `queueDelays` supplies them. */
  readonly delayMs?: number;
  /** Already-formatted text. Defaults to the trophy's own name. */
  readonly message?: string;
}

/** What is on the line right now, for the mirror and for a test. */
const live: string[] = [];

/** When the line next comes free, in scene-clock ms. */
const freeAt = new WeakMap<Phaser.Scene, number>();

export function liveTrophyToasts(): readonly string[] {
  return live;
}

/** The catalogue's name key for a trophy id, or the id if it has none. */
export function trophyNameKey(id: string): string {
  return TROPHIES.find((t) => t.id === id)?.nameKey ?? id;
}

/**
 * Raise one trophy chip on this scene.
 *
 * `delayMs` is how the QUEUE is implemented: the caller does not have to know,
 * because `showTrophyToasts` below computes it, but a caller that raises them
 * one at a time gets the same behaviour from the per-scene `freeAt` ledger.
 */
export function showTrophyToast(
  scene: Phaser.Scene,
  message: string,
  options: TrophyToastOptions,
): void {
  const now = scene.time.now;
  const earliest = Math.max(now, freeAt.get(scene) ?? 0);
  const delay = options.delayMs ?? earliest - now;
  freeAt.set(scene, earliest + TROPHY_CYCLE_MS + TROPHY_TIMING.gapMs);

  const text = uiText(scene, 0, 0, message, {
    size: TROPHY_CHIP.size,
    lang: options.lang,
    uppercase: options.uppercase ?? false,
    increasedLetterSpacing: options.increasedLetterSpacing ?? false,
    color: INK.text,
  });

  const box = chipRect(GAME_WIDTH, text.width);
  const g = scene.add.graphics();
  plate(g, 0, 0, box.w, box.h, hexToNum(INK.panelRaised), 0.96, TROPHY_CHIP.radius);
  strokePlate(g, 0, 0, box.w, box.h, hexToNum(options.accent), 3, TROPHY_CHIP.radius);
  // A filled pip on the leading edge, so it reads as an award even in a
  // desaturated frame (rubric 4) and even to a child who cannot read it yet.
  g.fillStyle(hexToNum(options.accent), 1);
  g.fillCircle(TROPHY_CHIP.padX + TROPHY_CHIP.pipR, box.h / 2, TROPHY_CHIP.pipR);
  text.setPosition(
    TROPHY_CHIP.padX + TROPHY_CHIP.pipR * 2 + TROPHY_CHIP.pipGap,
    Math.round((box.h - text.height) / 2),
  );

  const container = scene.add
    .container(box.x, box.y + chipEntryOffsetY())
    .setDepth(layer("hud").depth + 5)
    .setScrollFactor(0)
    .setAlpha(0);
  container.add([g, text]);

  // IN. It slides UP onto its line from under the foot of the frame, which is
  // the only direction that cannot cross the belt on its way in.
  scene.tweens.add({
    targets: container,
    y: box.y,
    alpha: 1,
    delay,
    duration: TROPHY_TIMING.inMs,
    ease: options.reducedMotion ? EASE.arrive : EASE.pop,
    onStart: () => {
      live.push(message);
      publishToasts(live);
      cue(scene);
    },
  });

  // OUT, as a DELAYED TWEEN rather than a timer. See the header.
  scene.tweens.add({
    targets: container,
    alpha: 0,
    y: box.y + chipEntryOffsetY(),
    delay: delay + TROPHY_TIMING.inMs + TROPHY_TIMING.holdMs,
    duration: TROPHY_TIMING.outMs,
    ease: EASE.arrive,
    onComplete: () => {
      container.destroy();
      const at = live.indexOf(message);
      if (at >= 0) live.splice(at, 1);
      publishToasts(live);
    },
  });
}

/**
 * Raise a burst of them, queued.
 *
 * Chain 25 and Chain 50 are the two trophies most likely to land in the same
 * breath, and Sharp Eye can join them at the end of the same belt, so a burst
 * is the normal case rather than the edge one.
 */
export function showTrophyToasts(
  scene: Phaser.Scene,
  messages: readonly string[],
  options: TrophyToastOptions,
): void {
  messages.forEach((message, i) => {
    showTrophyToast(scene, message, {
      ...options,
      delayMs: i * (TROPHY_CYCLE_MS + TROPHY_TIMING.gapMs),
    });
  });
}

/**
 * The sound.
 *
 * On the SFX bus and NOT on the voice bus, so it cannot open AC-21.4's music
 * duck: a trophy fires mid-belt, possibly while Shadow is talking, and it may
 * never interrupt him. See `trophyCue.ts` for the level and why it is that one.
 *
 * Silent when there is no audio service, which is what a scene mounted by a
 * harness gets. That is a supported way to run a screen, not an error.
 */
function cue(scene: Phaser.Scene): void {
  const audio = audioFrom(scene.registry);
  if (audio === null) return;
  playTrophyCue(audio.graph.ctx, audio.graph.buses.sfx);
}

/**
 * THE WIRING, AS ONE FUNCTION THE FLIGHT LANE CAN CALL.
 *
 * `HudScene` calls this once in `create()`. The flight loop then only has to
 * say that a trophy happened - it does not need to know that a toast exists,
 * which scene it is drawn on, or what it sounds like.
 *
 * The listener is on the GAME's event emitter rather than a scene's, because
 * the emitter (`FlightScene`) and the drawer (`HudScene`) are two scenes and
 * neither owns the other.
 */
export function listenForTrophies(
  scene: Phaser.Scene,
  options: () => TrophyToastOptions,
): void {
  const onEarned = (ids: readonly string[]): void => {
    if (ids.length === 0) return;
    const opts = options();
    showTrophyToasts(
      scene,
      // UR-186: the NAME, not the key. This was `trophyNameKey(id)`, which
      // returns "ui.trophy.firstLight" - and nothing translated it, so the chip
      // printed the key at a child.
      ids.map((id) => opts.message ?? createMenuTranslator(opts.lang, "").t(trophyNameKey(id) as UiStringKey)),
      opts,
    );
  };
  scene.game.events.on(EARNED, onEarned);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.game.events.off(EARNED, onEarned);
  });
}

// ---------------------------------------------------------------------------
// The flight lane's side of the seam
// ---------------------------------------------------------------------------

/**
 * Re-exported from the PURE module so the flight lane has one import, and so
 * `tests/unit/ui/trophyToast.test.ts` can exercise the rule in a plain Node
 * test - importing this file pulls in Phaser, which needs a `window`.
 */
export {
  LIVE_TROPHY_THRESHOLDS,
  emitLiveTrophies,
  resetLiveTrophies,
  type TrophyEmitter,
} from "./trophyToastLayout.js";
