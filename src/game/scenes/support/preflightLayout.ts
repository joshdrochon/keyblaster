import { GUTTER, HEADING_TOP, HINT_TOP, headerText } from "@game/ui/grid";
import { TYPE } from "@game/ui/theme";
import type { Rect } from "@game/ui/layout";

/**
 * THE PRE-FLIGHT SCREEN'S GEOMETRY (screen 5).
 *
 * ================== THE DEFECT ==================
 * The typed word was anchored to the SCREEN - `x: GAME_WIDTH / 2` - and the
 * cockpit window is not centred on the screen; it is a 900 px aperture at
 * x=900, i.e. the right half of a 1920 world. So on a 16:9 window the word
 * plate straddled the window frame: half of it on the glass, half of it on the
 * hull, with the frame's two strokes running through the middle of the one
 * thing the child is being asked to read. `preflight.png` caught it exactly.
 *
 * It is also ASPECT-DEPENDENT, which is why it survived: `GAME_WIDTH` is a live
 * binding that grows with the window (D99), and on a wide monitor the screen's
 * centre moves far enough right that the plate lands inside the glass by
 * accident. A bug that only appears at one aspect ratio is a bug that passes
 * every capture taken at another.
 *
 * ================== THE FIX ==================
 * The prompt is anchored to the WINDOW, which is the thing it belongs to: the
 * word appears on the glass, low, like a readout projected on the canopy. The
 * numbers are here rather than in the scene so the containment can be asserted
 * without a browser - see `tests/unit/scenes/preflightLayout.test.ts`.
 *
 * Nothing here imports Phaser or the DOM.
 */

/** The three system rows, down the left. */
/** The three system rows, down the left, on the product's gutter. */
export const ROW = { x: GUTTER, y: 300, w: 584, h: 116, gap: 26 } as const;

/** The cockpit window: the only hole in the hull. */
/** The cockpit window. Its right edge is the right gutter (`ui/grid.ts`). */
export const WINDOW = { x: 900, y: 170, w: 924, h: 600, r: 48 } as const;

/**
 * Where the typed word's plate is CENTRED.
 *
 * Horizontally on the glass, and low on it: high enough to clear the window's
 * bottom rounded corners, low enough that the planet swinging in behind it
 * (which settles around `WINDOW.x + WINDOW.w * 0.62`) is still the thing the
 * eye reads first.
 */
export const PROMPT = {
  x: WINDOW.x + WINDOW.w / 2,
  y: WINDOW.y + WINDOW.h - 130,
} as const;

/** Where the "type the word you see" line sits, under the glass. */
export const PROMPT_HINT = {
  x: WINDOW.x + WINDOW.w / 2,
  y: WINDOW.y + WINDOW.h + 58,
} as const;

/**
 * How wide a glyph may be, as a fraction of the font size, for SIZING PURPOSES
 * ONLY.
 *
 * 0.8 em is a deliberate over-estimate. The widest lowercase Latin glyph in the
 * UI stack measures about 0.62 em at 72 px and the pre-flight pool's widest
 * word ("encontramos", 11 glyphs, Spanish) draws at about 0.57 em average, but
 * Devanagari conjuncts are wider than Latin at the same point size and nothing
 * here may shrink a word to make a rectangle work. Over-estimating costs a test
 * some margin; under-estimating ships a clipped word.
 */
export const MAX_GLYPH_EM = 0.8;

/** The longest word the ritual can put on screen, in glyphs (`ritualPool`). */
export const MAX_PROMPT_GLYPHS = 12;

/**
 * The plate `lib/typedWord.createWordPrompt` cuts for a word, as a rectangle.
 *
 * The padding and the inter-letter gap are that module's own arithmetic,
 * restated: `padX = round(size * 0.55)`, `padY = round(size * 0.3)`,
 * `gap = round(size * 0.1)`, `plateH = size * 1.36 + padY`.
 */
export function promptPlate(
  glyphs: number,
  size: number = TYPE.display,
  at: { readonly x: number; readonly y: number } = PROMPT,
): Rect {
  const gap = Math.round(size * 0.1);
  const padX = Math.round(size * 0.55);
  const padY = Math.round(size * 0.3);
  const textWidth = glyphs * size * MAX_GLYPH_EM + Math.max(0, glyphs - 1) * gap;
  const w = textWidth + padX * 2;
  const h = size * 1.36 + padY;
  return { x: at.x - w / 2, y: at.y - h / 2, w, h };
}

/** A rectangle shrunk on every side. */
export function inset(r: Rect, by: number): Rect {
  return { x: r.x + by, y: r.y + by, w: r.w - by * 2, h: r.h - by * 2 };
}

/** True when `inner` lies wholly inside `outer`. */
export function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/** The window as a plain rectangle. */
export function windowRect(): Rect {
  return { x: WINDOW.x, y: WINDOW.y, w: WINDOW.w, h: WINDOW.h };
}

// ---------------------------------------------------------------------------
// UR-39: the screen that read as a wireframe
// ---------------------------------------------------------------------------

/**
 * WHAT WAS WRONG WITH THIS SCREEN, measured.
 *
 * A blind critic called Pre-flight the worst screen in the game and the phrase
 * that stuck was "a wireframe sitting between two finished screens". Measured
 * here rather than taken on trust - busy-pixel fraction, same metric on every
 * capture:
 *
 *   preflight 8.6%  ·  earth-activation 10.6  ·  map 12.1  ·  briefing 14.0
 *   beacon 16.4  ·  results 18.0  ·  warp 18.1
 *
 * Lowest in the product by a third, and the reasons were structural rather
 * than decorative:
 *
 *   NOTHING ABOVE y=320. The top of the frame held no title, no stop name and
 *   no chrome of any kind - the only story screen with no header at all.
 *   FOUR LEFT EDGES in one frame: rows at 96, their labels at 224, the
 *   dialogue plate at 356 and its text at 388.
 *   THE HINT FLOATED at the window's centre while every sibling's sits in the
 *   bottom band.
 *   NO WAY BACK. Unlike the Briefing, this scene never installed a keyboard
 *   handler at all, so Escape was inert and there was no pointer control
 *   either - the same defect as UR-27 and one screen further on.
 *
 * Everything below is the geometry for that, kept pure so
 * `tests/unit/scenes/preflightLayout.test.ts` can assert it without a browser.
 */

/** The screen's title and the stop under it, on the product's header lines. */
export const HEADING = headerText(0, undefined, 14);
export const SUBHEADING = headerText(1, undefined, 8);

/**
 * Shadow's dialogue plate.
 *
 * ON THE GUTTER. It was at x=356, which matched nothing on this screen or any
 * other; its text then sat at 388. A plate's own padding is not a column edge,
 * so the invariant the test holds is that every PLATE starts on the gutter and
 * text is inset from its plate - two numbers instead of four.
 */
export const LINE_PLATE = { x: GUTTER, y: 716, w: 760, h: 200 } as const;

/**
 * SHADOW STANDS INSIDE THE PLATE, which is the warp break's coach card exactly
 * (`WarpScene.buildCoachArea`: the figure at `COACH.x + 130`, the note inset
 * past him). Moving the plate to the gutter without moving him put the plate
 * under the figure and printed "Hull, check." through his face - caught in the
 * capture, not by a test, which is why `preflightLayout.test.ts` now asserts
 * containment rather than only non-overlap.
 */
export const LINE_SHADOW = { x: 206, y: 816, scale: 0.72 } as const;

/** Text inset: past Shadow on the left, a normal pad everywhere else. */
export const LINE_PAD = { x: 230, y: 56 } as const;

/** The keyboard hint, on the line every other screen uses. */
export const HINT = { x: GUTTER, y: HINT_TOP } as const;

/** The way out, in the Director map's chip treatment (as on the Briefing). */
export const BACK_CHIP = { w: 262, h: 66 } as const;

export function backChip(): Rect {
  return {
    x: WINDOW.x + WINDOW.w - BACK_CHIP.w,
    y: HEADING_TOP,
    w: BACK_CHIP.w,
    h: BACK_CHIP.h,
  };
}

/**
 * The instrument shelf under the glass.
 *
 * The Briefing has one and this screen did not, which is most of the 5-point
 * busy-pixel gap between two screens that are meant to be the same cockpit.
 * It is quiet and unlabelled on purpose - no readout a child could fail.
 */
export const SHELF = {
  x: WINDOW.x - 30,
  y: WINDOW.y + WINDOW.h + 24,
  w: WINDOW.w + 60,
  h: 76,
} as const;

/**
 * The bulkhead the system rows are bolted to.
 *
 * The rows used to float on bare hull, which is most of what made this the
 * least busy screen in the product (8.6% against 14.0% for the Briefing, its
 * own twin). A rack has a back plate; three cards on a wall do not read as
 * instruments. It is the cockpit's own material (`ui/panel.ts`), so this adds
 * structure rather than decoration.
 */
export const BULKHEAD = {
  x: GUTTER - 28,
  y: ROW.y - 40,
  w: ROW.w + 56,
  /**
   * ASYMMETRIC PADDING - 40 above, 12 below - because there are only 16 px
   * between the last row and the dialogue plate. A symmetric 44 ran the rack
   * straight through the plate, which the capture showed and the first version
   * of this module's test did not ask about; it checked the ROWS against the
   * plate and not the thing the rows are mounted on.
   */
  h: 3 * ROW.h + 2 * ROW.gap + 52,
} as const;

/** Shadow's drawn footprint, the same model `resultsLayout.shadowBox` uses. */
export function lineShadowBox(
  at: { readonly x: number; readonly y: number; readonly scale: number } = LINE_SHADOW,
): Rect {
  const r = 64 * at.scale;
  return { x: at.x - 1.6 * r, y: at.y - 2.0 * r, w: 1.6 * r * 2, h: (2.0 + 1.7) * r };
}

/** Every PLATE edge on the left column. One value, or the test fails. */
export function leftEdges(): number[] {
  return [ROW.x, LINE_PLATE.x, HINT.x];
}
