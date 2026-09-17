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

/** The two answers to the one-time question, in the order they are drawn. */
export const PROMPT_TARGET_IDS = ["board-yes", "board-no"] as const;

/** Anything the stage report's keyboard menu can hold. */
export interface CaretTarget {
  readonly id: string;
  /** The forward action: continue, launch, light the beacon (kit.FocusTarget). */
  readonly primary?: boolean;
}

/**
 * WHICH TARGET THE CARET OPENS ON, and the one deliberate exception to
 * "the forward action is the default" (AC-18.1, D43).
 *
 * The rule the stage report got wrong was replay-versus-continue: the ring
 * opened on "fly it again", so a child pressing Enter on reflex silently
 * re-flew the stage they had just finished. Continue is `primary` and takes the
 * caret whatever order the buttons are drawn in - replay is on the LEFT because
 * that is where a "back" reads, and layout order does not get to choose what
 * Enter does.
 *
 * The exception is `asking`. While the one-time opt-in question is on screen the
 * caret opens on the question, because a question the default action skips past
 * is a question nobody ever answers - and D43 only gets one calm ask. The moment
 * it is answered, `asking` is false, the question is not on screen any more, and
 * the caret goes back to the forward action. That "the moment it is answered" is
 * the half that was easy to get wrong, so it is a returned value here rather
 * than a branch inside a rebuild.
 *
 * Returns null only when there is nothing to focus at all.
 */
export function openingFocusId(
  targets: readonly CaretTarget[],
  asking: boolean,
): string | null {
  if (targets.length === 0) return null;
  if (asking) {
    const question = targets.find((t) => PROMPT_TARGET_IDS.includes(t.id as never));
    if (question !== undefined) return question.id;
  }
  const primary = targets.find((t) => t.primary === true);
  return (primary ?? targets[0])?.id ?? null;
}
