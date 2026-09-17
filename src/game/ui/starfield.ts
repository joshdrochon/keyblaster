/**
 * WHAT IS BEHIND A MENU: SPACE.
 *
 * ================== THE DEFECT ==================
 * `chrome.ts`'s `paintMidfield` drew a rolling hill band along the bottom of
 * every menu screen:
 *
 *   const h = 190 + Math.sin(x / 260) * 46 + Math.cos(x / 97) * 22;
 *
 * - a continuous landform, in a game about flying between planets, on five
 * screens (pause, settings, beacon log, profile picker, profile create). D97
 * dropped terrain grammar for space grammar across the world screens and this
 * was missed because it lives in the UI kit rather than in `render/`, so the
 * product ended up speaking two visual languages depending on which screen you
 * were looking at.
 *
 * ================== WHAT REPLACES IT ==================
 * The same thing the world screens use at that depth: DEBRIS. Flat silhouette
 * rocks, scattered rather than joined, drifting on the midfield's own speed.
 * A menu still gets something behind it - "nothing is ever still" (rubric 2)
 * still holds, and an empty gradient reads as a web page - but what it gets is
 * the belt the player flies through rather than a hillside they never will.
 *
 * ================== WHY IT IS A PURE MODULE ==================
 * Two things about this are assertable and were not: that the field is
 * DETERMINISTIC (a menu that reshuffles its background on every navigation
 * flickers) and that it SCALES WITH THE WORLD (the old band ran a `for` loop to
 * `GAME_WIDTH` and the world widens with the window under D99). Both are
 * questions about numbers, so the numbers live here, away from Phaser.
 */

export interface Mote {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  /** 0..1, used as the fill alpha. */
  readonly alpha: number;
}

/** mulberry-ish LCG. Seeded, never `Math.random`: see the header. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 0x100000000;
  };
}

/** The star field. Small, sparse, spread over the whole frame. */
export function menuStars(
  width: number,
  height: number,
  count = 90,
  seed = 0x5eed,
): Mote[] {
  const next = rng(seed);
  const out: Mote[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push({
      x: next() * width,
      y: next() * height,
      r: 1 + next() * 2.2,
      alpha: 0.1 + next() * 0.35,
    });
  }
  return out;
}

/**
 * The debris field.
 *
 * SCATTERED, NOT A BAND. Each rock is placed independently in a vertical range
 * that covers most of the frame, so no horizon line can emerge from them - that
 * is the whole difference between this and the hills it replaces, and
 * `starfield.test.ts` asserts it by looking for two rocks that share an x range
 * at different heights.
 *
 * `count` scales with the width so a 32:9 monitor gets a field rather than a
 * cluster on the left, which is the other half of the defect: the old band's
 * loop ran to a `GAME_WIDTH` that widens with the window (D99).
 */
export function menuDebris(
  width: number,
  height: number,
  seed = 0xdeb7,
): Mote[] {
  const next = rng(seed);
  const count = Math.max(12, Math.round((width / 1920) * 34));
  const out: Mote[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push({
      x: next() * width,
      // From a third of the way down to just off the bottom edge: near enough
      // to the floor to sit behind the content, spread far enough that the
      // tops never line up into a ridge.
      y: height * (0.34 + next() * 0.72),
      r: 9 + next() * 44,
      // 5-9%, and no higher. A rock may land anywhere, including directly
      // under the keyboard hint in the bottom-left corner, so the heaviest
      // fill this can emit is part of that line's contrast budget: at the
      // stops with a pale ground (saturn, mars) a 16% rock took `INK.textDim`
      // to 3.87:1. `tests/unit/ui/smallLabels.test.ts` composites the worst
      // case here against every palette and holds it to AC-22.8's 4.5:1.
      alpha: 0.05 + next() * 0.04,
    });
  }
  return out;
}
