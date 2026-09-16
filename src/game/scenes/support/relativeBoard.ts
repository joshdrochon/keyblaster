/**
 * The relative board's selection rule (D43, design brief screen 9).
 *
 * D43: "personal-best per stop, plus opt-in relative board (you and nearest
 * players, never global rank)". The brief pins the window: the player with up
 * to two above and two below. This file is that rule and nothing else - pure,
 * no Phaser, no storage. Like `warpSentence.ts` it is written to engine rules
 * and belongs in `src/engine` once this lane can write there.
 *
 * WHAT IS DELIBERATELY ABSENT: a position, an index, a place, a total, or any
 * other number that could be read as a rank. `RelativeRow` carries a name and a
 * speed. If a rank is ever wanted, D43 is the thing to change first.
 *
 * WHERE THE DATA COMES FROM: nowhere yet. There are no accounts (D43) and no
 * network, so the board has no source until one is built. The scene takes the
 * rows as input and renders an empty-state line when there are none, which is
 * what a first player would truthfully see.
 */

export interface RelativeRow {
  /** Pilot name. Profiles are name + avatar only - never an email (D43). */
  readonly label: string;
  readonly wpm: number;
  readonly isYou: boolean;
}

/** How many neighbours are shown on each side. */
export const NEIGHBOURS_PER_SIDE = 2;

/**
 * The window around the player: fastest first, the player somewhere in the
 * middle, at most two either side. Returns an empty list when the player is not
 * in the data, because a board that does not contain you is a leaderboard, and
 * D43 says this is not one.
 */
export function relativeWindow(
  rows: readonly RelativeRow[],
  neighbours: number = NEIGHBOURS_PER_SIDE,
): RelativeRow[] {
  const sorted = [...rows].sort((a, b) => b.wpm - a.wpm);
  const you = sorted.findIndex((r) => r.isYou);
  if (you < 0) return [];
  const from = Math.max(0, you - neighbours);
  const to = Math.min(sorted.length, you + neighbours + 1);
  return sorted.slice(from, to);
}
