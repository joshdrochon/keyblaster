import Phaser from "phaser";
import { paintPlate } from "@game/ui/plate";
import {
  type BlastEmit,
  type KeyInput,
  type LockState,
  createLockState,
  reduce,
} from "@engine/lock";
import { hexToNum as rgb } from "@game/render/palette";
import { FONT_STACK, INK, SPACE, TYPE } from "@game/ui/theme";

/**
 * One word, typed, with the same feel as flight.
 *
 * WHY THE LOCK MACHINE FOR A SINGLE WORD. Earth's activation is one word
 * (`launch`, AC-12.1) and each pre-flight ritual prompt is one word (FR-11).
 * Both could be done with a string compare in four lines. They are not,
 * because `@engine/lock` is where "what a keystroke means" is decided - which
 * keys are typing and which are browser commands (`resolveChar`), what a
 * keyboard layout does to a physical key (D41/AC-19.2), how an IME commit
 * arrives (D46), and above all that a mismatch shakes the plate and does NOT
 * drop the lock (D24, AC-3.2). A local compare would get one of those subtly
 * different from flight, and the tutorial's whole job is to feel identical to
 * the thing it is teaching.
 *
 * Nothing about a mismatch is punitive: the plate nudges, the letter stays
 * unlit, and no counter, colour or sound marks it (D31, AC-22b.1). The typo
 * count the machine returns is used for timing data only and is never drawn.
 */

export interface WordPromptOptions {
  readonly word: string;
  readonly x: number;
  readonly y: number;
  readonly size?: number;
  /** Colour a letter turns as it is typed. */
  readonly accent: string;
  readonly plateFill?: string;
  readonly plateText?: string;
  /** FR-8 keystroke budget; pass 1.5 x the profile's median inter-key interval. */
  readonly parkGraceMs?: number;
  readonly reducedMotion?: boolean;
  readonly depth?: number;
  /** Fired for every accepted keystroke: `index` is its 0-based position. */
  readonly onAdvance?: (index: number, nowMs: number) => void;
  /** Fired once, when the word is complete. */
  readonly onComplete?: (blast: BlastEmit) => void;
  /** Fired on a key that moved nothing. Feedback only; nothing is scored. */
  readonly onNudge?: () => void;
}

export interface WordPrompt {
  readonly root: Phaser.GameObjects.Container;
  /** When the word became visible; calibration measures latency from here. */
  readonly shownAtMs: number;
  readonly typed: string;
  readonly complete: boolean;
  /** Drive the park-grace timer and the underline cue. */
  update(timeMs: number): void;
  destroy(): void;
}

const ASTEROID_ID = "prompt";

function toKeyInput(event: KeyboardEvent): KeyInput {
  return {
    key: event.key,
    code: event.code,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    meta: event.metaKey,
  };
}

export function createWordPrompt(
  scene: Phaser.Scene,
  options: WordPromptOptions,
): WordPrompt {
  const size = options.size ?? TYPE.display;
  const word = options.word;
  const reduced = options.reducedMotion ?? false;
  const shownAtMs = scene.time.now;

  const root = scene.add.container(options.x, options.y);
  if (options.depth !== undefined) root.setDepth(options.depth);

  // --- letters, laid out on a contrast plate (rubric 8) -------------------
  const letters: Phaser.GameObjects.Text[] = [];
  const glyphs = [...word];
  let cursorX = 0;
  const gap = Math.round(size * 0.1);
  for (const ch of glyphs) {
    const t = scene.add.text(cursorX, 0, ch, {
      fontFamily: FONT_STACK,
      fontSize: `${size}px`,
      color: options.plateText ?? INK.text,
    });
    letters.push(t);
    cursorX += t.width + gap;
  }
  const textWidth = Math.max(0, cursorX - gap);
  const padX = Math.round(size * 0.55);
  const padY = Math.round(size * 0.3);
  const plateW = textWidth + padX * 2;
  const plateH = size * 1.36 + padY;

  // THE SHARED PLATE (UR-69). The word plate is the one surface in the game
  // that was already at bar - 17.4:1, the only plated thing the rubric ever
  // looked at - so nothing about its inks or its 0.96 changes here. What
  // changes is that it is now the SAME drawing the cards are, so a corner
  // treatment or a rim applied to the component reaches the word plate too.
  const plateG = scene.add.graphics();
  paintPlate(
    plateG,
    { x: -plateW / 2, y: -plateH / 2, w: plateW, h: plateH },
    {
      fill: options.plateFill ?? INK.panel,
      alpha: 0.96,
      stroke: options.accent,
      strokeAlpha: 0.45,
    },
  );

  const cue = scene.add.graphics();

  const letterLayer = scene.add.container(-textWidth / 2, -size * 0.62);
  letterLayer.add(letters);
  root.add([plateG, cue, letterLayer]);

  // --- the lock machine ---------------------------------------------------
  let state: LockState = createLockState({
    parkGraceMs: options.parkGraceMs,
  });
  state = reduce(state, {
    type: "spawn",
    asteroid: { id: ASTEROID_ID, word, spawnedAtMs: shownAtMs },
  });

  let typed = "";
  let complete = false;
  let nudgeUntil = 0;

  const paintLetters = (): void => {
    const lit = [...typed].length;
    letters.forEach((t, i) => {
      if (i < lit) {
        t.setColor(options.accent);
        t.setAlpha(1);
      } else {
        t.setColor(options.plateText ?? INK.text);
        t.setAlpha(0.72);
      }
    });
  };

  const drawCue = (timeMs: number): void => {
    cue.clear();
    if (complete) return;
    const i = [...typed].length;
    const target = letters[i];
    if (target === undefined) return;
    // "the next letter carries a soft underline cue" (art-direction s7).
    const breathe = 0.55 + Math.sin((timeMs / 900) * Math.PI * 2) * 0.25;
    const x = letterLayer.x + target.x;
    const y = letterLayer.y + size * 1.06;
    cue.fillStyle(rgb(options.accent), breathe);
    cue.fillRoundedRect(x, y, Math.max(8, target.width), 5, 3);
  };

  const handleEmits = (next: LockState, nowMs: number): void => {
    for (const emit of next.emitted) {
      if (emit.type === "advanced") {
        typed = emit.typed;
        paintLetters();
        options.onAdvance?.(emit.index, emit.nowMs);
        const t = letters[emit.index];
        if (t !== undefined) {
          // Scale pop on the letter that just lit. Back.Out, never Linear.
          scene.tweens.add({
            targets: t,
            scale: { from: 1.35, to: 1 },
            duration: 180,
            ease: "Back.Out",
          });
        }
      } else if (emit.type === "typo" || emit.type === "ignored") {
        // A nudge, not a verdict. Reduced motion swaps the shake for a
        // brightness beat so AC-6e.2's "visible response to every keystroke"
        // survives AC-19.3.
        nudgeUntil = nowMs + 140;
        options.onNudge?.();
      } else if (emit.type === "blast") {
        complete = true;
        typed = word;
        paintLetters();
        cue.clear();
        options.onComplete?.(emit);
      }
    }
  };

  const onKey = (event: KeyboardEvent): void => {
    if (complete) return;
    if (event.key === "Enter" || event.key === "Tab" || event.key === "Escape") return;
    const nowMs = scene.time.now;
    const next = reduce(state, { type: "key", input: toKeyInput(event), nowMs });
    state = next;
    handleEmits(next, nowMs);
  };

  const onComposition = (event: CompositionEvent): void => {
    if (complete) return;
    const nowMs = scene.time.now;
    const next = reduce(state, { type: "composition", text: event.data, nowMs });
    state = next;
    handleEmits(next, nowMs);
  };

  scene.input.keyboard?.on("keydown", onKey);
  window.addEventListener("compositionend", onComposition);

  paintLetters();

  return {
    root,
    shownAtMs,
    get typed() {
      return typed;
    },
    get complete() {
      return complete;
    },
    update(timeMs: number) {
      state = reduce(state, { type: "tick", nowMs: timeMs });
      handleEmits(state, timeMs);
      drawCue(timeMs);
      if (timeMs < nudgeUntil) {
        const p = (nudgeUntil - timeMs) / 140;
        if (reduced) {
          plateG.setAlpha(0.7 + 0.3 * (1 - p));
          root.setX(options.x);
        } else {
          root.setX(options.x + Math.sin(p * Math.PI * 6) * 6 * p);
        }
      } else {
        plateG.setAlpha(1);
        root.setX(options.x);
      }
    },
    destroy() {
      scene.input.keyboard?.off("keydown", onKey);
      window.removeEventListener("compositionend", onComposition);
      root.destroy(true);
    },
  };
}
