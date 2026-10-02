import type Phaser from "phaser";
import { paintPlate } from "./plate.js";
import { PLATE_RHYTHM, lineBox, plateHeight, stackRows } from "./plateLayout.js";
import { INK, SPACE, TYPE } from "./theme.js";
import type { Rect } from "./layout.js";

/** Shadow's dialogue card: a speaker row, then the line. */

export function speechCardRows(lines: number): readonly number[] {
  return [lineBox(TYPE.caption), lineBox(TYPE.body, lines)];
}

export function speechCardHeight(lines: number): number {
  return plateHeight(speechCardRows(lines), "card");
}

export function speechCardWrapWidth(width: number): number {
  return width - PLATE_RHYTHM.card.padX * 2;
}

/**
 * Paints the card and returns where its two rows go. Caller owns the text.
 *
 * The plate comes back too, for a scene that draws into a CONTAINER: a
 * container's children render under anything outside it at a higher depth, so a
 * card left on the scene's own display list would cover the line on it.
 */
export function drawSpeechCard(
  scene: Phaser.Scene,
  box: Rect,
  lines: number,
  depth: number,
): {
  readonly speaker: Rect;
  readonly line: Rect;
  readonly plate: Phaser.GameObjects.Graphics;
} {
  const g = scene.add.graphics().setDepth(depth);
  paintPlate(g, box, {
    fill: INK.panel,
    stroke: INK.line,
    alpha: 1,
    radius: SPACE.radius,
  });
  const [speaker, line] = stackRows(box, speechCardRows(lines), "card") as [Rect, Rect];
  return { speaker, line, plate: g };
}
