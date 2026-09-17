import { SPAWN_MARGIN_PX } from "./stage.js";

/**
 * WHERE THE HUD SITS, as numbers rather than as literals inside a scene.
 *
 * ================== WHY THIS FILE EXISTS ==================
 * The HUD is the only thing on the flight screen that draws above a word plate
 * (layers.ts L7, and `stage.PLATE_LAYER_DEPTH` is deliberately just under it).
 * That is safe for exactly one reason: every readout lives inside a corridor no
 * rock enters. It is not safe because anybody checked - until now nothing did,
 * and the numbers were literals spread through `HudScene.create`.
 *
 * It became worth checking the moment the HUD grew a third element. UR-21 asks
 * for the stop to be named somewhere on the flight screen, and the obvious
 * place for a place name is
 * the top centre, which is precisely where the rocks fall. A readout added
 * there would have hidden a word, which is UR-23, reported the same evening.
 *
 * So the rectangles live here, Phaser-free, and `tests/unit/flight/hudKeepOut`
 * measures them against the corridor a word plate can actually reach.
 *
 * L7's own words are "own contrast plate, never over debris". This is that
 * sentence made checkable.
 */

export interface HudRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The instrument plates' shared width and corner inset, px. */
export const HUD_PLATE_W = 236;
export const HUD_MARGIN = 24;
export const HUD_TOP = 22;
export const HUD_PLATE_H = 92;
export const HUD_RADIUS = 12;

/** Gap between the instrument plate and the place plate under it. */
export const HUD_STACK_GAP = 10;

/**
 * The place plate (UR-21).
 *
 * ================== WHY IT IS A PLATE UNDER THE INSTRUMENTS ==================
 * Three placements were possible and only one of them is legal.
 *
 *   TOP CENTRE, like a title card. The nicest to look at and the worst
 *   available: it is the middle of the frame, which is where word plates fall,
 *   and the HUD draws over them. It would have shipped UR-23 a second time.
 *
 *   A ROW INSIDE THE INSTRUMENT PLATE, next to wpm and combo. Legal, and it
 *   makes the place name a READOUT - a fourth number-shaped thing in the row
 *   the score lives in. AC-22b.1 is explicit that nothing may read as a
 *   worksheet, and a label in the instrument row is a field on a form.
 *
 *   ITS OWN PLATE, under the instruments, in the same column and at the same
 *   width. Inside the corridor, aligned with what is above it, and separate
 *   from the numbers - a placard naming where the ship is rather than a
 *   quantity about how the player is doing. That is this one.
 *
 * It carries the stop's own name from the story bundle (`HudSnapshot.stopName`)
 * and nothing else. No caption under it, no "location:" in front of it: a label
 * explaining that a place name is a place name is the worksheet, arriving by
 * the back door.
 */
export const HUD_PLACE_H = 46;

export const hudLeftPlate = (): HudRect => ({
  x: HUD_MARGIN,
  y: HUD_TOP,
  w: HUD_PLATE_W,
  h: HUD_PLATE_H,
});

export const hudRightPlate = (screenWidth: number): HudRect => ({
  x: screenWidth - HUD_PLATE_W - HUD_MARGIN,
  y: HUD_TOP,
  w: HUD_PLATE_W,
  h: HUD_PLATE_H,
});

export const hudPlacePlate = (): HudRect => ({
  x: HUD_MARGIN,
  y: HUD_TOP + HUD_PLATE_H + HUD_STACK_GAP,
  w: HUD_PLATE_W,
  h: HUD_PLACE_H,
});

/** Every rectangle the HUD paints, for a screen of this width. */
export const hudRects = (screenWidth: number): readonly HudRect[] => [
  hudLeftPlate(),
  hudRightPlate(screenWidth),
  hudPlacePlate(),
];

/**
 * The band of x a WORD PLATE can occupy, at the design width.
 *
 * Not the band a rock's CENTRE can occupy, and the difference is the whole
 * point. `spawnX` keeps a rock's centre `SPAWN_MARGIN_PX` plus its own
 * half-width from the edge; the plate hangs at that same x, but it is a
 * different width from the rock, and it is the plate's EDGES that have to clear
 * the HUD.
 *
 * `overhangPx` is how far a plate sticks out past its own rock -
 * `max(plateHalf - rockHalf)` over the words that can be on the belt. It is a
 * single number rather than a rock size and a word length, because those two
 * are NOT independent: `asteroidSizePx` grows with word length, so the smallest
 * rock carries the shortest word and pairing "the narrowest rock" with "the
 * longest word" describes a rock that cannot exist and overstates the reach.
 *
 * Passed in rather than computed here, so this file stays free of the renderer.
 */
export function wordPlateSpan(
  screenWidth: number,
  overhangPx: number,
): { readonly left: number; readonly right: number } {
  const reach = Math.max(0, overhangPx);
  return {
    left: SPAWN_MARGIN_PX - reach,
    right: screenWidth - SPAWN_MARGIN_PX + reach,
  };
}

/** Does this rectangle reach into the band word plates travel down? */
export function intrudesOnWordPlates(
  rect: HudRect,
  span: { readonly left: number; readonly right: number },
): boolean {
  return rect.x + rect.w > span.left && rect.x < span.right;
}
