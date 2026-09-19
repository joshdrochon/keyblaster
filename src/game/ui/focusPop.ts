import { SPACE } from "./theme.js";

/**
 * ============== THE FOCUS POP, IN ONE PLACE (UR-110, UR-111) ==============
 *
 * There are three keyboard menus in this game - `ui/controls.ts` (settings,
 * profiles, the pause menu), `scenes/lib/kit.ts` (map, briefing, results,
 * beacon, ending, earth activation) and `TitleScene`'s own list, which predates
 * both - and until UR-111 they had three different answers to "what does a
 * focused control look like".
 *
 *   controls.ts   grew 1.5% and HELD it            (UR-110 fixed this one)
 *   kit.ts        did not grow at all; ring alpha only
 *   TitleScene    shrank to 0.985 and settled back to 1
 *
 * A child walking Title -> Map -> Briefing met all three in six seconds. This
 * module is the one answer, and all three import it: the numbers below are
 * defined once, and so is the arithmetic that turns a scale factor into a
 * CENTRED swell.
 *
 * The model itself - one control active, hover moves focus, pointer-leave does
 * nothing, size is a STATE and not a flourish - is written out in full at the
 * top of `ui/controls.ts` and is not restated here.
 */

/**
 * How big "grown" is.
 *
 * `ratio` is the 1.5% the menu kit has always used. `maxGrowPx` is the cap that
 * makes HOLDING it safe, and it is DERIVED rather than picked: the focus ring
 * is stroked `SPACE.focusRingOffset` outside the control's box with a
 * `SPACE.focusRingWidth` line centred on that path, so there are
 * `offset - width / 2` px of clear air between the plate's edge and the ring's
 * inner edge. A flat percentage crosses that on a wide control - 1.5% of a
 * 900 px settings row is 6.75 px per side against 4 px of clearance - which
 * nobody saw while the pop was a 280 ms flourish and everybody would see once
 * it is held. Capped, the widest control swells exactly into its ring and the
 * narrowest still visibly grows.
 */
export const FOCUS_POP = {
  ratio: 0.015,
  maxGrowPx: SPACE.focusRingOffset - SPACE.focusRingWidth / 2,
} as const;

/**
 * Every container this game scales for focus is named `kb-pop:<id>`, for the
 * same reason every hit area is named `kb-hit:<id>` (ui/focus.ts): a probe - an
 * e2e, or a hand measurement of a served build - has to be able to find the
 * object whose scale it is measuring without guessing at the scene graph's
 * shape. One prefix for all three menus, so one probe reads all of them.
 */
export const POP_NAME_PREFIX = "kb-pop:";

/**
 * How much bigger a control of this width is when focused, as a scale factor.
 *
 * Derived from the control's OWN width so the growth in pixels is bounded the
 * same way on a 220 px chip and a 900 px settings row. A zero or negative width
 * cannot grow, and says so by returning 1 rather than by dividing by zero.
 */
export function focusPopScale(boxW: number): number {
  if (boxW <= 0) return 1;
  const grow = Math.min(FOCUS_POP.maxGrowPx, (boxW * FOCUS_POP.ratio) / 2);
  return 1 + (grow * 2) / boxW;
}

/**
 * Where the scaled container has to sit for the growth to be CENTRED.
 *
 * A Phaser Container scales about its own origin, which is its top-left, so a
 * held pop with no offset puts every pixel of the growth on the right and the
 * bottom: invisible in a 280 ms flourish, and, held, a focused row visibly out
 * of line with the rows above it. Half the growth goes to each side instead.
 *
 * `left` and `top` are where the control's BOX sits inside the container's own
 * coordinate space - normally 0, 0 (the kit builds the container on the box),
 * but the Title's quiet rows report a plate that starts above their root, so
 * the general form is the one that lives here. At scale 1 both results are 0
 * and the container sits exactly on its anchor.
 */
export function focusPopShift(
  scale: number,
  box: { readonly left: number; readonly top: number; readonly w: number; readonly h: number },
): { readonly x: number; readonly y: number } {
  return {
    x: -(scale - 1) * (box.left + box.w / 2),
    y: -(scale - 1) * (box.top + box.h / 2),
  };
}

export interface PopBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * How far outside a control's box one of its own parts may reach.
 *
 * NOT ZERO, AND NOT A CONSTANT. A label is centred on its plate and sits well
 * inside it; a plate cut from a label's own bounds (`kit.skyText`) sits a hair
 * outside the rectangle the screen declared, because the padding was rounded
 * somewhere. A fixed 2 px would drop a label on a wide button whose letter
 * spacing pushed it two pixels proud; a fixed 40 px would swallow the hint line
 * under a small chip. A fraction of the control's own short side scales with
 * the thing being measured, with a floor for a chip that is only 48 px tall.
 */
const PART_SLOP = { fraction: 0.15, floor: 8 } as const;

/**
 * Is `part` one of the pieces that make up the control drawn at `box`?
 *
 * THIS IS HOW THE STORY SCREENS' KIT FINDS A CONTROL AT ALL. `createKeyboardMenu`
 * is handed a bare rectangle and the scene draws its own plate and its own
 * label - there is no node to scale, which is why those seven screens had no
 * focus growth for as long as they existed. The rectangle plus this test is the
 * way back from "the control is here" to "and these two objects are it".
 *
 * Two conditions, and both are needed. The CENTRE test alone would accept the
 * whole results panel whenever a button happens to sit near its middle; the
 * CONTAINMENT test alone would accept a 1 px rule that clips the control's
 * corner. Together they mean "this drawing is inside this control and is about
 * the size of it".
 */
export function isPartOf(part: PopBox, box: PopBox): boolean {
  if (box.w <= 0 || box.h <= 0) return false;
  const cx = part.x + part.w / 2;
  const cy = part.y + part.h / 2;
  if (cx < box.x || cx > box.x + box.w) return false;
  if (cy < box.y || cy > box.y + box.h) return false;
  const slop = Math.max(PART_SLOP.floor, Math.min(box.w, box.h) * PART_SLOP.fraction);
  return (
    part.x >= box.x - slop &&
    part.y >= box.y - slop &&
    part.x + part.w <= box.x + box.w + slop &&
    part.y + part.h <= box.y + box.h + slop
  );
}
