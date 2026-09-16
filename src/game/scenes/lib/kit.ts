import Phaser from "phaser";
import { DUR, EASE, FONT_STACK, INK, SPACE, TYPE, chromeCase, letterSpacingPx, lineHeightEm } from "@game/ui/theme";
import { hexToNum as rgb } from "@game/render/palette";
import type { Lang } from "@engine/types";
import { uiSoundBlip } from "@game/ui/focus";

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
  setTargets(targets: readonly FocusTarget[]): void;
  destroy(): void;
}

/**
 * Keyboard-only list navigation (D37). Arrows on the menu's axis move, Tab and
 * Shift+Tab always move, Enter and Space activate, Escape goes back.
 *
 * Tab is handled explicitly and its default prevented: the game is a canvas,
 * so the browser's own focus order would walk out of the document and strand
 * the player, which is the exact failure AC-18.1 exists to catch.
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
  let index = Math.min(Math.max(options.startIndex ?? 0, 0), Math.max(0, list.length - 1));

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
  focus(index);

  return {
    get index() {
      return index;
    },
    get targets() {
      return list;
    },
    focus,
    setTargets(next: readonly FocusTarget[]) {
      list = [...next];
      focus(Math.min(index, Math.max(0, list.length - 1)));
    },
    destroy() {
      scene.input.keyboard?.off("keydown", onKey);
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
