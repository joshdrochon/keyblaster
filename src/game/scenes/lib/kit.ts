import Phaser from "phaser";
import { DUR, EASE, FONT_STACK, INK, SKY_PLATE, SPACE, TYPE, chromeCase, letterSpacingPx, lineHeightEm } from "@game/ui/theme";
import { hexToNum as rgb } from "@game/render/palette";
import { recordSkyText as record } from "./skyTextRegistry";
import type { Lang } from "@engine/types";
import { HIT_ZONE_PREFIX, uiSoundBlip } from "@game/ui/focus";

/**
 * The bits of chrome the four story screens share: type, plates, a focus ring
 * and keyboard-only navigation (D37, AC-18.1).
 *
 * It lives inside this lane's folder rather than in `src/game/ui/` because the
 * brief's scope rule says a helper another lane might also create belongs to
 * whoever needs it, not in a shared file two agents race to write. Everything
 * it draws is dressed from `@game/ui/theme`, so when the lanes are reconciled
 * the tokens already match.
 *
 * Nothing here can render a failure: there is no error state, no red, and no
 * disabled-with-a-cross treatment. A locked item is drawn dim and still
 * focusable, because "you can look at Pluto before you can fly there" is the
 * map's whole emotional job (D31, AC-22b.1).
 */

export interface TextOptions {
  readonly size?: number;
  readonly color?: string;
  readonly align?: "left" | "center" | "right";
  readonly wrapWidth?: number;
  readonly lang?: Lang;
  readonly alpha?: number;
  readonly letterSpacing?: boolean;
}

/** A Phaser Text dressed from the theme. Never takes a literal font name. */
export function label(
  scene: Phaser.Scene,
  x: number,
  y: number,
  content: string,
  options: TextOptions = {},
): Phaser.GameObjects.Text {
  const size = options.size ?? TYPE.body;
  const lang = options.lang ?? "en";
  const style: Phaser.Types.GameObjects.Text.TextStyle = {
    fontFamily: FONT_STACK,
    fontSize: `${size}px`,
    color: options.color ?? INK.text,
    align: options.align ?? "left",
  };
  if (options.wrapWidth !== undefined) {
    style.wordWrap = { width: options.wrapWidth, useAdvancedWrap: true };
  }
  const text = scene.add.text(x, y, content, style);
  text.setLineSpacing(Math.round(size * (lineHeightEm(lang) - 1)));
  text.setLetterSpacing(letterSpacingPx(size, options.letterSpacing ?? false));
  if (options.alpha !== undefined) text.setAlpha(options.alpha);
  return text;
}

/** Chrome copy: a button or row label, lowercased per D41 unless told not to. */
export function chrome(
  scene: Phaser.Scene,
  x: number,
  y: number,
  content: string,
  uppercase: boolean,
  options: TextOptions = {},
): Phaser.GameObjects.Text {
  return label(scene, x, y, chromeCase(content, uppercase), {
    size: TYPE.label,
    ...options,
  });
}

export interface PlateOptions {
  readonly fill?: string;
  readonly stroke?: string;
  readonly radius?: number;
  readonly alpha?: number;
}

/** A contrast plate. Word labels and prose both sit on one (rubric 8). */
export function plate(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  options: PlateOptions = {},
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(rgb(options.fill ?? INK.panel), options.alpha ?? 0.94);
  g.fillRoundedRect(x, y, w, h, options.radius ?? SPACE.radius);
  g.lineStyle(2, rgb(options.stroke ?? INK.line), 0.9);
  g.strokeRoundedRect(x, y, w, h, options.radius ?? SPACE.radius);
  return g;
}

// ---------------------------------------------------------------------------
// Sky-borne text (AC-22.8)
// ---------------------------------------------------------------------------

/**
 * EVERY PIECE OF TEXT DRAWN OVER THE WORLD GOES THROUGH HERE.
 *
 * The defect: the word plate had a contrast plate and measured 17.4:1, while the
 * headline that names the screen was drawn straight onto the sky. Mars' sky is a
 * warm ochre; coral ink on it is 1.6:1. "the map is drawn" was 1.19:1 in pink on
 * the ending's dawn, and it STRADDLED a silhouette edge, so half the word sat on
 * grey and half on sky - a child cannot read that at any size.
 *
 * So a headline is not a Text object any more, it is a Text object ON A PLATE,
 * and the plate is sized from the text's own measured bounds so it cannot be
 * mis-set by hand. Every one of them also REGISTERS ITS COLOUR PAIR on the
 * scene, which is what lets the rubric measure the whole inventory instead of
 * the one pair somebody remembered to check.
 *
 * `behind` defaults to worst-case white in the contrast module, so a scene never
 * has to know its own sky to be measured honestly.
 *
 * The registry itself lives in `skyTextRegistry.ts`, away from Phaser, because
 * the thing most likely to go wrong is the LIFETIME: a scene object survives
 * `scene.restart()`, so a registry that never cleared would have handed the
 * capture three copies of the Director map's rows and called it coverage.
 * Re-exported here so scenes keep importing one module.
 */
export { recordSkyText, skyTextSamples, clearSkyText } from "./skyTextRegistry";

export interface SkyTextOptions extends TextOptions {
  /** Stable id for the evidence row, e.g. "warp.heading". */
  readonly id: string;
  /** Screen id for the evidence row, e.g. "warp". */
  readonly screen: string;
  /** Text depth. The plate is drawn one below it. */
  readonly depth?: number;
  readonly originX?: number;
  readonly originY?: number;
  readonly padX?: number;
  readonly padY?: number;
  /**
   * Suppress the plate ONLY where the text already sits on a panel the scene
   * drew itself. `plateFill` then names that panel's colour, so the row is
   * still measured - "it's on a panel, trust me" is how 1.19:1 shipped.
   */
  readonly plated?: boolean;
  readonly plateFill?: string;
}

export interface PlatedText {
  readonly text: Phaser.GameObjects.Text;
  readonly plate: Phaser.GameObjects.Graphics | null;
  /**
   * Plate first, then text - THE ORDER MATTERS AND DEPTH DOES NOT SAVE YOU.
   *
   * A Phaser Container renders its children in LIST ORDER and ignores their
   * depth unless something calls `sort`. Warp and Beacon put their header in a
   * container, and the first version of this helper created the text and then
   * the plate, so the plate - correctly set to depth-1 - was added second and
   * painted a black rectangle straight over the headline it was there to make
   * legible. Adding this array is how a caller gets the order right without
   * having to know that.
   */
  readonly objects: readonly Phaser.GameObjects.GameObject[];
  /** Re-lays the plate around new content. */
  setText(content: string): void;
  destroy(): void;
}

/**
 * Text over the world, on a plate, measured.
 *
 * The plate is drawn from `text.getBounds()` AFTER the string is set, so it
 * follows the origin, the line count, the letter spacing and the Devanagari line
 * height without any of those being restated here. `setText` redraws it, which
 * is what stops a headline that changes ("PLACED", the per-stop board) from
 * keeping a plate cut for the string it used to hold.
 */
export function skyText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  content: string,
  options: SkyTextOptions,
): PlatedText {
  const depth = options.depth ?? 10;
  const padX = options.padX ?? SKY_PLATE.padX;
  const padY = options.padY ?? SKY_PLATE.padY;
  // The graphics object is created FIRST so it lands earlier on the display
  // list (and earlier in any container it is added to) and therefore renders
  // UNDER the text. It is drawn into afterwards, once the text has bounds.
  const wantsPlate = options.plated !== true;
  const g = wantsPlate ? scene.add.graphics().setDepth(depth - 1) : null;

  const text = label(scene, x, y, content, options).setDepth(depth);
  text.setOrigin(options.originX ?? 0, options.originY ?? 0);

  const layout = (): void => {
    if (g === null) return;
    g.clear();
    if (text.text.length === 0) return;
    const b = text.getBounds();
    g.fillStyle(rgb(SKY_PLATE.fill), SKY_PLATE.alpha);
    g.fillRoundedRect(
      b.x - padX,
      b.y - padY,
      b.width + padX * 2,
      b.height + padY * 2,
      SKY_PLATE.radius,
    );
    g.lineStyle(2, rgb(SKY_PLATE.stroke), 0.55);
    g.strokeRoundedRect(
      b.x - padX,
      b.y - padY,
      b.width + padX * 2,
      b.height + padY * 2,
      SKY_PLATE.radius,
    );
  };
  layout();

  record(scene, {
    screen: options.screen,
    id: options.id,
    color: options.color ?? INK.text,
    plateFill: wantsPlate ? SKY_PLATE.fill : (options.plateFill ?? INK.panel),
    plateAlpha: wantsPlate ? SKY_PLATE.alpha : 1,
  });

  return {
    text,
    plate: g,
    objects: g === null ? [text] : [g, text],
    setText(next: string) {
      text.setText(next);
      layout();
    },
    destroy() {
      g?.destroy();
      text.destroy();
    },
  };
}

export interface FocusTarget {
  readonly id: string;
  /** Screen-space bounds the ring is drawn around. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Fired on Enter or Space. */
  readonly activate?: () => void;
  /** Locked stops stay focusable; this only changes the ring's voice. */
  readonly locked?: boolean;
  /**
   * THE FORWARD ACTION. The one thing the player came to this screen to do:
   * continue, launch, light the beacon. It holds focus when the screen opens,
   * so the obvious next action is Enter and nothing else.
   *
   * Replay, retry and back are never primary. On the stage report that means
   * "continue" is focused and "fly it again" is one key away, not the other way
   * round - a child who presses Enter on reflex should move on with their run,
   * not silently repeat the stage they just finished.
   *
   * Declared per target rather than inferred from list order so that a screen
   * can lay its buttons out however it reads best (results puts replay on the
   * left, because that is where a "back" reads) without that choosing what
   * Enter does.
   */
  readonly primary?: boolean;
}

export interface FocusRing {
  moveTo(target: FocusTarget): void;
  readonly graphics: Phaser.GameObjects.Graphics;
  destroy(): void;
}

/**
 * The visible focus state AC-18.1 requires. One ring, moved between targets
 * with a Back.Out pop so the eye tracks it; it is never hidden.
 */
export function createFocusRing(scene: Phaser.Scene, depth = 40): FocusRing {
  const g = scene.add.graphics().setDepth(depth);
  let tween: Phaser.Tweens.Tween | null = null;

  const draw = (t: FocusTarget): void => {
    const o = SPACE.focusRingOffset;
    g.clear();
    g.lineStyle(SPACE.focusRingWidth, rgb(INK.accent), 1);
    g.strokeRoundedRect(
      t.x - o,
      t.y - o,
      t.w + o * 2,
      t.h + o * 2,
      SPACE.radius + o,
    );
    g.lineStyle(SPACE.focusRingWidth + 6, rgb(INK.accentSoft), 0.18);
    g.strokeRoundedRect(
      t.x - o,
      t.y - o,
      t.w + o * 2,
      t.h + o * 2,
      SPACE.radius + o,
    );
  };

  return {
    graphics: g,
    moveTo(target: FocusTarget) {
      draw(target);
      tween?.remove();
      g.setScale(1);
      tween = scene.tweens.add({
        targets: g,
        alpha: { from: 0.55, to: 1 },
        duration: DUR.focus,
        ease: EASE.pop,
      });
    },
    destroy() {
      tween?.remove();
      g.destroy();
    },
  };
}

export type MenuAxis = "horizontal" | "vertical";

export interface KeyboardMenuOptions {
  readonly axis?: MenuAxis;
  /** Escape / Backspace. AC-18.1: every screen is returnable by keyboard. */
  readonly onBack?: () => void;
  readonly wrap?: boolean;
  readonly startIndex?: number;
}

export interface KeyboardMenu {
  readonly index: number;
  readonly targets: readonly FocusTarget[];
  focus(index: number): void;
  /**
   * Replace the targets. Focus goes to the PRIMARY target unless `focusId`
   * names one - which is how a screen says "this rebuild is different", e.g.
   * results putting the caret on its one-time opt-in question while that
   * question is on screen.
   */
  setTargets(targets: readonly FocusTarget[], focusId?: string): void;
  destroy(): void;
}

/**
 * Where the caret goes when a screen opens: an explicit `startIndex` if the
 * screen computed one (the map focuses the stop you are on), otherwise the
 * PRIMARY target, otherwise the first.
 */
function openingIndex(
  list: readonly FocusTarget[],
  startIndex: number | undefined,
): number {
  const last = Math.max(0, list.length - 1);
  if (startIndex !== undefined) return Math.min(Math.max(startIndex, 0), last);
  const primary = list.findIndex((t) => t.primary === true);
  return primary >= 0 ? primary : 0;
}

/**
 * List navigation (D37, AC-18.1). Arrows on the menu's axis move, Tab and
 * Shift+Tab always move, Enter and Space activate, Escape goes back - and
 * every target is also a hit area, so the mouse reaches exactly the same set of
 * things the keyboard does and nothing more.
 *
 * Tab is handled explicitly and its default prevented: the game is a canvas,
 * so the browser's own focus order would walk out of the document and strand
 * the player, which is the exact failure AC-18.1 exists to catch.
 *
 * POINTER RULES, the same three the UI kit uses (ui/focus.ts):
 *   hover  -> focus. One highlight in this UI, and it is the ring.
 *   press  -> focus, then activate. A locked target only focuses.
 *   the keyboard path is untouched and remains sufficient on its own.
 */
export function createKeyboardMenu(
  scene: Phaser.Scene,
  ring: FocusRing,
  targets: readonly FocusTarget[],
  options: KeyboardMenuOptions = {},
): KeyboardMenu {
  const axis = options.axis ?? "vertical";
  const wrap = options.wrap ?? true;
  let list = [...targets];
  let index = openingIndex(list, options.startIndex);
  let zones: Phaser.GameObjects.Zone[] = [];

  const step = (delta: number): void => {
    if (list.length === 0) return;
    let next = index + delta;
    if (wrap) next = (next + list.length) % list.length;
    else next = Math.min(Math.max(next, 0), list.length - 1);
    focus(next);
    // D62 "UI sounds for every interaction" / AC-21.3 `uiNav`. The hook is the
    // menu kit's (ui/focus.ts) so both keyboard menus in this game make the
    // same sound; boot installs it once. `focus()` itself stays silent: it is
    // also how a screen restores the caret after a restart, and a blip there
    // would make a settings row chirp at itself.
    uiSoundBlip("nav");
  };

  function focus(i: number): void {
    if (list.length === 0) return;
    index = Math.min(Math.max(i, 0), list.length - 1);
    const target = list[index];
    if (target !== undefined) ring.moveTo(target);
    scene.events.emit("kb-focus", index, target);
  }

  /**
   * One invisible hit area per target, rebuilt whenever the targets are.
   *
   * Built from the SAME rectangle the focus ring is drawn around, so what the
   * ring says is clickable and what is clickable are one rectangle rather than
   * two that can drift apart.
   */
  function bindPointers(): void {
    for (const zone of zones) zone.destroy();
    zones = [];
    for (const [i, target] of list.entries()) {
      if (target.w <= 0 || target.h <= 0) continue;
      const zone = scene.add
        .zone(target.x, target.y, target.w, target.h)
        .setOrigin(0, 0)
        // Named so the pointer e2e can enumerate a screen's hit areas and check
        // they are exactly the focusable set (see ui/controls.ts for the same).
        .setName(`${HIT_ZONE_PREFIX}${target.id}`)
        .setDepth(ring.graphics.depth + 1)
        .setInteractive({ useHandCursor: target.locked !== true });
      zone.on("pointerover", () => {
        if (i === index) return;
        focus(i);
        uiSoundBlip("nav");
      });
      zone.on("pointerdown", () => {
        focus(i);
        if (target.locked === true) return;
        target.activate?.();
        uiSoundBlip("activate");
      });
      zones.push(zone);
    }
  }

  const forward = axis === "horizontal" ? ["ArrowRight", "ArrowDown"] : ["ArrowDown", "ArrowRight"];
  const backward = axis === "horizontal" ? ["ArrowLeft", "ArrowUp"] : ["ArrowUp", "ArrowLeft"];

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Tab") {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
      return;
    }
    if (forward.includes(event.key)) {
      event.preventDefault();
      step(1);
      return;
    }
    if (backward.includes(event.key)) {
      event.preventDefault();
      step(-1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      list[index]?.activate?.();
      uiSoundBlip("activate");
      return;
    }
    if (event.key === "Escape" || event.key === "Backspace") {
      event.preventDefault();
      options.onBack?.();
    }
  };

  scene.input.keyboard?.on("keydown", onKey);
  bindPointers();
  focus(index);

  return {
    get index() {
      return index;
    },
    get targets() {
      return list;
    },
    focus,
    /**
     * Replace the targets. The caret goes to the PRIMARY target, not to
     * whatever index happened to be current: a screen that rebuilds its buttons
     * (results, once the relative-board prompt is answered) is opening a new
     * set of choices, and the forward one is the default for the new set the
     * same way it was for the first.
     *
     * `focusId` overrides that for the case where the screen is ASKING
     * something. A one-time question the caret skips past is a question nobody
     * answers, and "the forward action is the default" is a rule about
     * replay-versus-continue, not a licence to focus past a prompt.
     */
    setTargets(next: readonly FocusTarget[], focusId?: string) {
      list = [...next];
      bindPointers();
      const named = focusId === undefined ? -1 : list.findIndex((t) => t.id === focusId);
      focus(named >= 0 ? named : openingIndex(list, undefined));
    },
    destroy() {
      scene.input.keyboard?.off("keydown", onKey);
      for (const zone of zones) zone.destroy();
      zones = [];
    },
  };
}

/**
 * What a scene exposes to the e2e suite. A canvas has no DOM to assert
 * against, so every screen publishes a plain-object view of the state its ACs
 * talk about. It is read-only and derived; nothing in the game reads it back.
 */
export interface SceneSnapshot {
  readonly scene: string;
  readonly [key: string]: unknown;
}

export interface Snapshotable {
  snapshot(): SceneSnapshot;
}

export function hasSnapshot(scene: Phaser.Scene): scene is Phaser.Scene & Snapshotable {
  return typeof (scene as Partial<Snapshotable>).snapshot === "function";
}

/**
 * Every string currently rendered by the scene, containers included.
 *
 * This exists for AC-11.3 and AC-22b.1, which are both claims about what is
 * ABSENT from a screen. An assertion that a score is not shown is only worth
 * something if the test can see everything that IS shown, so the snapshot
 * carries the full text of the screen and the e2e scans it.
 */
export function visibleText(scene: Phaser.Scene): string[] {
  const out: string[] = [];
  const walk = (objects: Phaser.GameObjects.GameObject[]): void => {
    for (const obj of objects) {
      if (obj instanceof Phaser.GameObjects.Container) {
        walk(obj.list);
        continue;
      }
      if (obj instanceof Phaser.GameObjects.Text) {
        if (obj.visible && obj.alpha > 0.02) out.push(obj.text);
      }
    }
  };
  walk(scene.children.list);
  return out;
}
