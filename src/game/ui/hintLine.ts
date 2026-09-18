import Phaser from "phaser";
import type { Lang } from "@engine/types";
import { recordSkyText } from "@game/scenes/lib/skyTextRegistry";
import { GUTTER, HINT_TOP } from "./grid.js";
import type { Rect } from "./layout.js";
import { paintPlate } from "./plate.js";
import { INK, SKY_PLATE, SPACE, TYPE } from "./theme.js";
import { uiText } from "./text.js";

/**
 * THE ONE RENDERER FOR THE KEYBOARD HINT LINE.
 *
 * ===================== WHAT WAS REPORTED =====================
 * The project owner walked the product and said button and control placement is
 * inconsistent everywhere - different positions AND different styles from page
 * to page - and gave the hint line as one of two examples: the Director map's
 * has a plate behind it, the pilot picker's has none.
 *
 * Measured on the served build before this file existed, the hint's actual ink:
 *
 *   ProfilePicker 96,1036   ProfileCreate 96,1004   BeaconLog 96,1004
 *   Settings      96,1004   DirectorMap  118,1012   Preflight 96,1004
 *   Results       96,1004   Warp         ABSENT (drawn inside the card)
 *   Pause         ABSENT (declared "grid", never drawn at all)
 *
 * Three positions and three different renderers for one line:
 *
 *   `MenuScene.addHint` -> `uiText`, NO plate   (picker, create, log, settings)
 *   `lib/kit.skyText`   -> PLATED               (map, results)
 *   `lib/kit.label`     -> NO plate             (pre-flight, warp)
 *
 * ===================== WHY THAT KEPT HAPPENING =====================
 * `ui/hint.ts` already declared a per-screen CONTRACT and `ui/grid.ts` already
 * named the line (`GUTTER`, `HINT_TOP`). Nine screens were declared "grid" and
 * the contract was right. What nothing owned was the PIXELS and the STYLE:
 * every screen still called its own text factory with its own coordinates, so
 * "on the grid line" was an instruction each screen followed approximately.
 *
 * So the coordinates are no longer a parameter. `drawHint` takes no x and no y,
 * which is the half of this the COMPILER enforces - a screen cannot place its
 * hint wrongly because it cannot place it at all. `tests/unit/ui/hintLine.test.ts`
 * sweeps every scene for the other half: a screen declared "grid" that draws its
 * hint with any other factory is a failure with no allowlist to land in.
 *
 * ===================== WHY EVERY SCREEN IS PLATED =====================
 * AC-22.8 wants 4.5:1. The plated screens (map, results) sit over busy art and
 * the unplated ones (the menus) over the dark backdrop gradient, and `INK.textDim`
 * clears 4.5:1 on `SKY_PLATE.fill` on both, while on bare art it does not: the
 * map's own comment records the line being MOVED onto a plate for exactly that
 * reason, and the pre-flight and results comments each record an ink being
 * raised off `INK.textFaint` for it. A plate is the only treatment that holds on
 * both backgrounds, so the unplated screens gain one rather than the plated ones
 * losing theirs. The plate is `SKY_PLATE` on the `chip` rhythm - the same
 * geometry `lib/kit.skyText` painted - so the two screens that already had one
 * keep the pixels they had.
 *
 * The ink is `INK.textDim` and the size is `TYPE.caption` for every screen, and
 * neither is a parameter. Depth is, because depth is z-order and not placement.
 */

/**
 * The padding between the hint's plate and its ink.
 *
 * `SKY_PLATE`'s, so the plate's corner lands on `HINT_CONTRACT` - which three
 * separate test files already assert and which this must not break.
 *
 * THE INK THEREFORE LANDS AT 118, and that is why `SPACE.rowPadX` moved from 28
 * to 22 in the same change: at 28 the settings rows' labels sat at 124, six
 * pixels from this line, and `nearMissEdges.test.ts` failed on it the moment
 * the plate shipped. Two pieces of text six pixels apart is never intentional.
 * Moving the hint instead was tried twice and cost more - the ink at 124
 * collided on every screen whose inner line is not 28 (4 pairs), and the ink on
 * the gutter broke the plate-corner contract in three files.
 */
export const HINT_PAD = { x: SKY_PLATE.padX, y: SKY_PLATE.padY } as const;

/** The hint's INK origin, so its PLATE's corner lands on `HINT_CONTRACT`. */
export function hintInk(): { x: number; y: number } {
  return { x: GUTTER + HINT_PAD.x, y: HINT_TOP + HINT_PAD.y };
}

/** The plate cut from a measured text's bounds. Exported so a test can check it. */
export function hintPlateRect(bounds: Rect): Rect {
  return {
    x: bounds.x - HINT_PAD.x,
    y: bounds.y - HINT_PAD.y,
    w: bounds.w + HINT_PAD.x * 2,
    h: bounds.h + HINT_PAD.y * 2,
  };
}

/**
 * D41's three typography settings, which the hint honours like any other chrome.
 *
 * The menu kit threads these from `app.style()`; the story screens read them
 * from `lib/typography.typographyOf`. Both routes end here, which is what makes
 * the uppercase setting apply to the story screens' hints as well - it did not
 * before, because `lib/kit.label` applies letter spacing but not letter case.
 */
export interface HintStyle {
  readonly lang: Lang;
  readonly uppercase: boolean;
  readonly increasedLetterSpacing: boolean;
}

export interface HintOptions {
  /** The screen name the contrast evidence is filed under (AC-22.8). */
  readonly screen: string;
  /** The copy key, so the evidence row names the line it measured. */
  readonly id: string;
  readonly style: HintStyle;
  /** Z-order only. There is no positional parameter and there must not be. */
  readonly depth?: number;
}

/** What a screen gets back. Enough to fade it, re-word it and tear it down. */
export interface HintLine {
  readonly text: Phaser.GameObjects.Text;
  readonly plate: Phaser.GameObjects.Graphics;
  /** Plate first, so a caller adding both to a container gets the order right. */
  readonly objects: readonly Phaser.GameObjects.GameObject[];
  setText(content: string): void;
  setAlpha(alpha: number): void;
  destroy(): void;
}

/**
 * Draw the keyboard hint. Bottom-left, plated, dim ink, caption size.
 *
 * NO X AND NO Y. See the note at the top of this file: the coordinates being a
 * parameter is the defect, not the layout.
 */
export function drawHint(
  scene: Phaser.Scene,
  content: string,
  options: HintOptions,
): HintLine {
  const depth = options.depth ?? 10;
  const at = hintInk();

  // The Graphics is created FIRST so it lands earlier on the display list and
  // therefore renders UNDER the text - `lib/kit.skyText` learned this the hard
  // way, by painting a black rectangle over the headline it was making legible.
  const g = scene.add.graphics().setDepth(depth - 1);
  const text = uiText(scene, at.x, at.y, content, {
    size: TYPE.caption,
    color: INK.textDim,
    lang: options.style.lang,
    uppercase: options.style.uppercase,
    increasedLetterSpacing: options.style.increasedLetterSpacing,
  }).setDepth(depth);

  const layout = (): void => {
    g.clear();
    if (text.text.length === 0) return;
    const b = text.getBounds();
    paintPlate(
      g,
      hintPlateRect({ x: b.x, y: b.y, w: b.width, h: b.height }),
      {
        fill: SKY_PLATE.fill,
        alpha: SKY_PLATE.alpha,
        stroke: SKY_PLATE.stroke,
        strokeAlpha: 0.55,
        radius: SKY_PLATE.radius,
        rhythm: "chip",
      },
    );
  };
  layout();

  recordSkyText(scene, {
    screen: options.screen,
    id: options.id,
    color: INK.textDim,
    plateFill: SKY_PLATE.fill,
    plateAlpha: SKY_PLATE.alpha,
  });

  return {
    text,
    plate: g,
    objects: [g, text],
    setText(next: string) {
      text.setText(next);
      layout();
    },
    setAlpha(alpha: number) {
      text.setAlpha(alpha);
      g.setAlpha(alpha);
    },
    destroy() {
      g.destroy();
      text.destroy();
    },
  };
}
