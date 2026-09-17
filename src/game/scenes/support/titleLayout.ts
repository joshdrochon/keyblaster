import { KEEP_CLEAR_PAD, keepClear, type KeepClearShape } from "@game/render/keepClear";

/**
 * The Title's layout constants and its keep-clear zone.
 *
 * WHY THEY LEFT `TitleScene.ts`. UR-06 put an asteroid across the "B" of
 * KEYBLASTER and was fixed by handing `buildParallax` one rectangle, assembled
 * inline in `create()` from these constants. The fix was right; its LOCATION was
 * the defect. Nothing outside a booted Phaser scene could see the rectangle, so
 * nothing could check it, and when the same debris landed on the Director map's
 * planets (UR-52) there was no mechanism to reuse - only a paragraph to re-read.
 *
 * This module imports no Phaser, so `tests/unit/render/keepClear.test.ts` can
 * hold the REAL zone this screen ships against the REAL debris planes.
 */

/** Where the lockup sits when nothing is in the way of it. */
export const WORDMARK_X = 200;
export const WORDMARK_Y = 250;

/** The language row is the last thing down the column and must stay on screen. */
export const LANG_Y_MAX = 1000;

/**
 * How much of the width the type column occupies.
 *
 * The lockup is sized to the world (`buildWordmark`) and the menu hangs off it,
 * so the zone is bounded by a FRACTION rather than by a measured width: the
 * parallax is built before the type is, and a keep-clear that depends on the
 * thing it protects would have to be recomputed after the fact.
 */
export const WORDMARK_COLUMN = 0.52;

/**
 * Everything on this screen that debris must not land on.
 *
 * One rectangle over the whole lockup and the controls beneath it. It is built
 * from the same constants the lockup is PLACED from, so the zone cannot drift
 * from what it is covering - which is the half of UR-06's fix that is easy to
 * lose in a refactor. `LANG_Y_MAX` is the lowest any control goes.
 *
 * The Lantern is not in here. It is drawn into the `shipFx` container at depth
 * 6, in front of every plane that carries debris except `foreVeil`, and a
 * silhouette crossing in front of the ship is the foreground doing its job.
 */
export function titleKeepClear(width: number): readonly KeepClearShape[] {
  return keepClear()
    .rect(
      WORDMARK_X,
      WORDMARK_Y,
      width * WORDMARK_COLUMN - KEEP_CLEAR_PAD * 2,
      LANG_Y_MAX - WORDMARK_Y,
    )
    .zones();
}
