/**
 * The two questions every one-off line about a falling rock asks (UR-146,
 * UR-148): can the child SEE it, and will it still be there when the line has
 * named it. `@engine/hull` and `@engine/nested` own their own extra gates and
 * both call this, so there is one visibility rule rather than one per feature.
 */

/** A falling rock, as a hint rule sees it. Pixels, downward-positive. */
export interface RockHintView {
  readonly centreY: number;
  readonly sizePx: number;
  readonly viewportHeight: number;
  readonly msToBreach: number;
}

/**
 * WHOLLY inside the frame. A rock spawns at `-sizePx` and slides in, so "the
 * top of it has appeared" is true for most of that slide - and what the line
 * points at is the whole object.
 */
export function rockOnScreen(view: RockHintView): boolean {
  const half = Math.max(0, view.sizePx) / 2;
  if (!Number.isFinite(view.centreY)) return false;
  return view.centreY - half >= 0 && view.centreY + half <= view.viewportHeight;
}

/**
 * On screen, and still on the board when the clause that NAMES it has been
 * said.
 *
 * `leadMs` is the LEAD CLAUSE and not the whole line. The first draft of the
 * canister hint waited on the whole sentence plus the word's own clearing
 * estimate, and an e2e on a real canvas found it did not fire: measured at the
 * shipped calibration, a rock has 3616-6712 ms left when it comes on screen,
 * and `clearEstimateMs` alone is 67-79% of `fallMs` by construction. A hint
 * teaches; whether this particular rock is caught is the belt's business.
 */
export function rockHintFits(view: RockHintView, leadMs: number): boolean {
  if (!rockOnScreen(view)) return false;
  if (!Number.isFinite(view.msToBreach) || !Number.isFinite(leadMs)) return false;
  return view.msToBreach >= Math.max(0, leadMs);
}
