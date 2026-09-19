import { GAME_HEIGHT } from "@game/sceneKeys";
import type { Rect } from "@game/ui/layout";
import { PLATE_RHYTHM, lineBox, plateHeight, stackRows } from "@game/ui/plateLayout";
import { TYPE } from "@game/ui/theme";

/**
 * Earth activation's geometry, out of the scene and into a module a node test
 * can measure (screen inventory row 2b, D57).
 *
 * `EarthActivationScene.ts` imports Phaser, so nothing placed inside it can be
 * asserted without a browser - which is how Shadow's spoken line came to be
 * drawn as a 760x156 plate centred on `GAME_WIDTH / 2`, sitting squarely over
 * the lamp housing and the top of the mast. The screen exists to show a child
 * the beacon light up and the caption covered the lamp.
 *
 * Every function here takes the WORLD WIDTH as an argument rather than reading
 * `GAME_WIDTH`. `GAME_WIDTH` is a live binding set from the window's aspect
 * (D99, `sceneKeys` header), so a module that captures it at import time
 * freezes it at 1920 - the exact defect the scene's own `beaconX()` note
 * describes. A parameter also lets the test sweep widths.
 */

// ---------------------------------------------------------------------------
// The beacon: what the screen is for, and what nothing may cover
// ---------------------------------------------------------------------------

/** The lamp's centre y. `EarthActivationScene.BEACON_Y`. */
export const BEACON_Y = GAME_HEIGHT * 0.46;

/**
 * The mast's drawn footprint, in the same numbers `drawMast` fills with.
 *
 * `104` is the outer (bgDeep) triangle's half-base, not the `84` of the panel
 * triangle inside it, because the outer one is what a child sees against the
 * sky. `330` is `baseY - BEACON_Y`. `-36` is the lamp housing's top, which is
 * above the lamp circle's own `-32` stroke and is therefore the top of the
 * whole assembly.
 */
export const MAST_HALF_W = 104;
export const MAST_BASE_DY = 330;
export const LAMP_HOUSING_TOP_DY = -36;

/**
 * The lamp and the tower, as one rectangle.
 *
 * NOT the rings and NOT the column of light. Those are a 520 px radius of
 * translucent sky-wide decoration and a beam that runs off the top of the
 * frame; a box that cleared them would leave a 240 px column for a dialogue
 * box on a 1920 px screen. The hard thing - the object the screen is about -
 * is the lamp and the mast, and that is what this returns.
 */
export function beaconBounds(width: number): Rect {
  const cx = width / 2;
  return {
    x: cx - MAST_HALF_W,
    y: BEACON_Y + LAMP_HOUSING_TOP_DY,
    w: MAST_HALF_W * 2,
    h: MAST_BASE_DY - LAMP_HOUSING_TOP_DY,
  };
}

// ---------------------------------------------------------------------------
// Shadow
// ---------------------------------------------------------------------------

/** `render/shadow.SHADOW_RADIUS`. */
const SHADOW_R = 64;
/**
 * His drawn reach about his origin, in radii - the four coefficients
 * `support/warpLayout.ts` measured off the served build by screenshot
 * difference (see its `SHADOW_ABOVE_R` note; `render/shadow.SHADOW_HEIGHT`
 * under-reads the drawing by half a radius and is not the number to derive a
 * box from). Restated rather than imported because `warpLayout` is the warp
 * break's module and this screen may not reach into it.
 */
const SHADOW_ABOVE_R = 1.82;
const SHADOW_BELOW_R = 1.6;
const SHADOW_LEFT_R = 1.32;
const SHADOW_RIGHT_R = 1.52;

/** The scale this screen draws him at. Unchanged. */
export const SHADOW_SCALE = 1.05;

/**
 * Where Shadow stands, DERIVED FROM THE CENTRE.
 *
 * It was the literal `300`, which is right at 1920 and nowhere else. The
 * scene's own header note says "every object here - the mast, the lamp, its
 * rings, the column of light, Shadow's line, the prompt and the button - is
 * placed from `GAME_WIDTH / 2`"; Shadow himself was the one object that was
 * not, and `grid-conformance.spec.ts` could not catch it because a Phaser
 * `Graphics` carries no text for it to measure. `-660` is `300 - 1920 / 2`, so
 * nothing moves at the artboard width.
 */
export function shadowOrigin(width: number): { x: number; y: number } {
  return { x: width / 2 - 660, y: GAME_HEIGHT * 0.63 };
}

/** His drawn footprint on this screen, in screen pixels. */
export function shadowBox(width: number): Rect {
  const at = shadowOrigin(width);
  const r = SHADOW_R * SHADOW_SCALE;
  return {
    x: at.x - SHADOW_LEFT_R * r,
    y: at.y - SHADOW_ABOVE_R * r,
    w: (SHADOW_LEFT_R + SHADOW_RIGHT_R) * r,
    h: (SHADOW_ABOVE_R + SHADOW_BELOW_R) * r,
  };
}

// ---------------------------------------------------------------------------
// The line he says
// ---------------------------------------------------------------------------

/**
 * The dialogue box's width.
 *
 * Bounded on the right by the mast: the box's left edge is Shadow's column and
 * its right edge has to stop short of `beaconBounds().x`, which is 856 at the
 * artboard. 560 leaves 96 px - one gutter - of sky between the two, so the box
 * reads as a separate object rather than as a panel butted against the tower.
 */
export const SPEECH_W = 560;

/** Air between the top of Shadow's drawing and the foot of his box. */
export const SPEECH_TAIL_GAP = 20;

/**
 * Two rows: who is speaking, then what he said.
 *
 * `lineBox` is the DEVANAGARI line box, so the height is the worst language's
 * and not English's - `hi/earth.json` is the longest of the three.
 */
export function speechRows(lines: number): readonly number[] {
  return [lineBox(TYPE.caption), lineBox(TYPE.body, lines)];
}

/**
 * The box, SIZED TO WHAT IS IN IT.
 *
 * It was a literal `156` holding one line of 30 px body copy, i.e. a plate with
 * roughly 70 px of empty sky under its only sentence. A reserved worst case is
 * the right answer on the warp break, where the coach note ARRIVES later and
 * AC-33 forbids the card moving when it does. Nothing on this screen is
 * deferred: `bundle.preflightLine` is known in `create()` and never changes, so
 * the box is derived from its measured line count instead.
 */
export function speechBox(width: number, lines: number): Rect {
  const h = plateHeight(speechRows(lines), "card");
  const figure = shadowBox(width);
  return {
    x: width / 2 - 760,
    y: figure.y - SPEECH_TAIL_GAP - h,
    w: SPEECH_W,
    h,
  };
}

/** The speaker label's row and the line's row, inside the box. */
export function speechRowBoxes(width: number, lines: number): readonly Rect[] {
  return stackRows(speechBox(width, lines), speechRows(lines), "card");
}

/** The wrap width the line is measured and drawn at. */
export function speechWrapWidth(): number {
  return SPEECH_W - PLATE_RHYTHM.card.padX * 2;
}
