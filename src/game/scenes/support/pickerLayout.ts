import { GAME_HEIGHT } from "@game/sceneKeys";
import { BACK_CORNER_BOTTOM, GUTTER, type Rect } from "@game/ui/grid";

/**
 * The profile picker's geometry, out of the scene and into a module a node test
 * can measure - the same split `support/earthLayout.ts` made, for the same
 * reason: `ProfilePickerScene.ts` imports Phaser, so nothing positioned inside
 * it can be asserted without a browser.
 *
 * This exists because of three literal coordinates that lived in the scene:
 * Shadow at `(GAME_WIDTH - 260, 620)` on the list variant and at
 * `(GAME_WIDTH * 0.72, 520)` on the empty one, neither of which is on any line
 * this product has a name for. The owner's report was "Shadow is floating in
 * the middle of space", and both numbers are why.
 *
 * Every function takes the WORLD WIDTH as an argument rather than reading
 * `GAME_WIDTH`. `GAME_WIDTH` is a live binding set from the window's aspect
 * (D99, `sceneKeys` header), so a module that captured it at import time would
 * freeze it at 1920.
 */

// ---------------------------------------------------------------------------
// Which control opens with the caret
// ---------------------------------------------------------------------------

/** The focus id of the "new pilot" control, on both variants of the screen. */
export const NEW_PILOT_ID = "pick.new";

/**
 * WHICH CONTROL HOLDS FOCUS WHEN THE PICKER OPENS. ALWAYS "NEW PILOT".
 *
 * ================== WHAT WAS REPORTED ==================
 * The owner's brother played the game and took several seconds to work out
 * that he could press Enter or click "New Pilot". The screen opened with the
 * ring on a PILOT ROW, because `buildList` ended with
 *
 *     const active = this.app.profile();
 *     if (active) this.list.focus(`pick.profile.${active.id}`);
 *
 * "Open on the pilot who last flew, so the common case is one key press."
 *
 * ================== WHY THAT IS OVERRIDDEN ==================
 * The argument is right about the common case and wrong about whose case it
 * is. A returning pilot already knows this screen is a list and that the arrow
 * keys walk it; the one person who does not is the first-time player, and the
 * screen was optimised against them. It is also the same rule the story lane
 * already follows - `tests/e2e/default-focus.spec.ts`, AC-18.1: the FORWARD
 * action holds focus on entry, never replay, never back. Starting a pilot is
 * this screen's forward action.
 *
 * THE COST IS ONE ARROW KEY for a returning pilot, and it is paid knowingly.
 *
 * A function rather than a bare constant so the claim can be swept: the answer
 * does not depend on how many pilots exist or on which of them last flew, and
 * a test that passes both arguments is what says so.
 */
export function initialFocusId(
  _profileCount: number,
  _lastFlownProfileId: string | null,
): string {
  return NEW_PILOT_ID;
}

// ---------------------------------------------------------------------------
// Shadow
// ---------------------------------------------------------------------------

/** `render/shadow.SHADOW_RADIUS`. */
const SHADOW_R = 64;

/**
 * His drawn reach about his origin, in radii.
 *
 * The four coefficients `support/warpLayout.ts` measured off the served build
 * by screenshot difference, restated here exactly as `support/earthLayout.ts`
 * restates them - `warpLayout` is the warp break's module and this screen may
 * not reach into it, and `render/shadow.SHADOW_HEIGHT` under-reads the drawing
 * by half a radius and is not the number to derive a box from.
 */
const SHADOW_ABOVE_R = 1.82;
const SHADOW_BELOW_R = 1.6;
const SHADOW_LEFT_R = 1.32;
const SHADOW_RIGHT_R = 1.52;

/**
 * The scale each variant draws him at, unchanged from the scene.
 *
 * Two sizes, because the two variants are two different screens: the empty
 * hangar is Shadow and one control, and he carries it; the list is three or
 * four pilot rows and he stands beside them. Expressed as a WANTED HEIGHT
 * divided through `SHADOW_HEIGHT` at the call site, which is the arithmetic
 * `drawShadow` asks for and which the scene has always done.
 */
export const SHADOW_DRAWN_HEIGHT = { list: 220, empty: 260 } as const;

/**
 * WHERE SHADOW STANDS: THE BOTTOM-RIGHT CORNER OF THE CONTENT AREA.
 *
 * ================== WHICH LINES, AND WHY THESE ==================
 * His drawn footprint's RIGHT edge lands on the right gutter - the same
 * `width - GUTTER` line every other element on this screen measures to - and
 * its BOTTOM edge lands on `grid.BACK_CORNER_BOTTOM`, the foot line the hint
 * plate's own bottom edge defines and the line `grid.backCorner` puts a
 * bottom-right control on. So Shadow sits in the corner the product already
 * reserves for the bottom-right of a screen, on one line with the keyboard
 * hint at the other end of it.
 *
 * ================== WHY THE FOOTPRINT AND NOT THE ORIGIN ==================
 * `drawShadow` takes the point his BODY is centred on, which is neither the
 * edge of the drawing nor its foot - he hovers, and the hover shadow, the
 * antenna and a raised arm all reach past it by different amounts. Placing the
 * origin on a grid line puts the DRAWING somewhere else, which is how the
 * literal `620` came to look centred in the sky. The box is placed and the
 * origin is derived from it.
 *
 * ================== WHY THE WORLD WIDTH AND NOT THE ARTBOARD ==================
 * The picker reflows: its heading, its hint and its row column are all drawn
 * from `SPACE.gutter` and `GAME_WIDTH`, so it is a CENTRED composition in
 * `grid-conformance.spec.ts`'s terms and its right margin has to track the
 * window the way `contentRight()` does.
 */
export function shadowOrigin(width: number, scale: number): { x: number; y: number } {
  const r = SHADOW_R * scale;
  return {
    x: width - GUTTER - SHADOW_RIGHT_R * r,
    y: BACK_CORNER_BOTTOM - SHADOW_BELOW_R * r,
  };
}

/**
 * How far right a MIRRORED Shadow may move before her reach hits the gutter.
 *
 * `shadowOrigin` insets by the RIGHT coefficient; mirroring swaps the two, so
 * the difference is air she is not using (UR-164).
 */
export function shadowMirrorInset(scale: number): number {
  return (SHADOW_RIGHT_R - SHADOW_LEFT_R) * SHADOW_R * scale;
}

/** His drawn footprint on this screen, in screen pixels. */
export function shadowBox(width: number, scale: number): Rect {
  const at = shadowOrigin(width, scale);
  const r = SHADOW_R * scale;
  return {
    x: at.x - SHADOW_LEFT_R * r,
    y: at.y - SHADOW_ABOVE_R * r,
    w: (SHADOW_LEFT_R + SHADOW_RIGHT_R) * r,
    h: (SHADOW_ABOVE_R + SHADOW_BELOW_R) * r,
  };
}

/**
 * The lowest a row column may reach before it would run into Shadow's corner.
 *
 * Exported so the claim "the list and Shadow do not share space" is checkable
 * rather than eyeballed; `GAME_HEIGHT` is pinned (D99), so this is a number.
 */
export function shadowClearTop(width: number, scale: number): number {
  return Math.min(GAME_HEIGHT, shadowBox(width, scale).y);
}
