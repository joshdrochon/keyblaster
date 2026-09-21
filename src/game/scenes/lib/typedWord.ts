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
import type { Rect } from "@game/ui/layout";
import { FONT_STACK, INK, SPACE, TYPE } from "@game/ui/theme";
import { audioFrom } from "@game/audio/wiring";

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
 *
 * ================== UR-101.4: AND IT SOUNDS LIKE FLIGHT TOO ==============
 * This module played NO AUDIO AT ALL. Every screen it serves - the pre-flight
 * ritual, the launch ceremony, Earth's activation - was typed in total silence,
 * while the belt next door gives every keystroke a mechanical clack (UR-34) and
 * a pitched note climbing a pentatonic ladder (D75/UR-30). The header above
 * says "the tutorial's whole job is to feel identical to the thing it is
 * teaching" and the loudest half of that feel was missing from the tutorial.
 *
 * IT IS THE FLIGHT CUE, NOT A SECOND VOCABULARY. `AudioService.routeFlightCue`
 * is what `FlightScene` calls, and routing through it is what makes "sounds
 * like the belt" structural rather than a resemblance somebody has to maintain:
 * the SFX event, the D75 tone step, the typo's gentle tick and the ladder's
 * word-boundary reset all come from one table in `audio/wiring.ts`. Change the
 * clack and this changes with it. Nothing new was authored and no cue name was
 * invented; `via` reads `flight-cue:keystroke` in the evidence because that is
 * honestly the path taken.
 *
 * LOUDNESS IS UNCHANGED BY CONSTRUCTION. UR-34 measured a forty-word belt as no
 * louder with the clack than without, and the ritual asks for six or seven
 * words. D31's rule that a mistyped key is the quietest sound in the game is
 * likewise inherited rather than restated: the `typo` cue IS the quiet one, and
 * `GENTLE_EVENTS` polices it in `audio/sfx.ts`.
 *
 * THE WORD ENDING IS SILENT ON PURPOSE. In flight a finished word is a rock
 * exploding and gets `blast`; here it is a prompt being replaced, and the sound
 * that belongs to a finished PIECE of the ritual is the check row's own
 * (UR-101.5, in `PreflightScene`). What the ending does do is `resetTone()`,
 * which is the word boundary the pitched ladder needs - without it every prompt
 * after the first would start where the last one stopped and the ladder would
 * sit on its ceiling, which is exactly the defect UR-30 reopened on the belt.
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

/**
 * THE CARET UNDER THE LETTER BEING TYPED - ONE DRAWING, TWO SCREENS.
 *
 * "the next letter carries a soft underline cue" (art-direction s7). It was a
 * closure inside `createWordPrompt`, reachable only by the single-word ritual;
 * the warp break asked for the same cue under a line that WRAPS. The drawing
 * did not have to change for that - a caret is a function of ONE letter's box -
 * so what changed is that the box is now a parameter instead of a container
 * offset. This project has shipped two cockpit windows, two `WINDOW` rects and
 * two skies; it is not shipping two carets.
 */
export const CARET = {
  /** How far under the letter's TOP the bar sits, in ems. */
  drop: 1.06,
  height: 5,
  radius: 3,
  /** A space, or a narrow "i", still gets a caret wide enough to see. */
  minWidth: 8,
  breatheMs: 900,
  /** The alpha band every caret in the game breathes across (UR-161). */
  breatheMin: 0.3,
  breatheMax: 0.8,
} as const;

/** The letter the caret is under: its left edge, its top, its width. */
export interface CaretTarget {
  readonly x: number;
  readonly y: number;
  readonly w: number;
}

export function caretBox(target: CaretTarget, fontPx: number): Rect {
  return {
    x: target.x,
    y: target.y + fontPx * CARET.drop,
    w: Math.max(CARET.minWidth, target.w),
    h: CARET.height,
  };
}

export function caretBreathe(timeMs: number): number {
  const mid = (CARET.breatheMax + CARET.breatheMin) / 2;
  const swing = (CARET.breatheMax - CARET.breatheMin) / 2;
  return mid + Math.sin((timeMs / CARET.breatheMs) * Math.PI * 2) * swing;
}

/** Repaint the caret. `null` clears it - a finished word has no next letter. */
export function paintCaret(
  g: Phaser.GameObjects.Graphics,
  target: CaretTarget | null,
  fontPx: number,
  accent: string,
  timeMs: number,
): void {
  g.clear();
  if (target === null) return;
  const box = caretBox(target, fontPx);
  g.fillStyle(rgb(accent), caretBreathe(timeMs));
  g.fillRoundedRect(box.x, box.y, box.w, box.h, CARET.radius);
}

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
    const target = complete ? undefined : letters[[...typed].length];
    paintCaret(
      cue,
      target === undefined
        ? null
        : {
            // The letters live in `letterLayer`; the caret is drawn in the
            // root, so the box is handed over in the root's space.
            x: letterLayer.x + target.x,
            y: letterLayer.y + target.y,
            w: target.width,
          },
      size,
      options.accent,
      timeMs,
    );
  };

  // UR-101.4. Resolved once: the registry is the scene's and does not change,
  // and a null service (the standalone harness, or a browser that refused an
  // AudioContext) is silent by design rather than a branch at every keystroke.
  const audio = audioFrom(scene.registry);

  const handleEmits = (next: LockState, nowMs: number): void => {
    for (const emit of next.emitted) {
      if (emit.type === "advanced") {
        typed = emit.typed;
        paintLetters();
        // THE BELT'S OWN CUE (UR-101.4): the UR-34 clack and the D75 pitched
        // note, from the one table `FlightScene` routes through.
        audio?.routeFlightCue({ cue: "keystroke", atMs: emit.nowMs });
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
        // D31 THROUGH THE FLIGHT TABLE, not through a judgement made here.
        // `typo` is the quietest recipe in the game and `GENTLE_EVENTS` keeps
        // it that way; `ignored` maps to the ordinary keystroke click and does
        // not touch the pitched ladder. Both are `audio/wiring.ts`'s decisions.
        audio?.routeFlightCue({ cue: emit.type, atMs: nowMs });
        options.onNudge?.();
      } else if (emit.type === "blast") {
        complete = true;
        typed = word;
        paintLetters();
        cue.clear();
        // THE WORD BOUNDARY THE LADDER NEEDS (UR-30). No sound of its own: a
        // finished prompt is not a rock exploding, and the sound that belongs
        // to a finished piece of the ritual is the check row's (UR-101.5).
        audio?.resetTone();
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
