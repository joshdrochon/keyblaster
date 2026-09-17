import { describe, expect, it } from "vitest";
import {
  NEIGHBOURS_PER_SIDE,
  PROMPT_TARGET_IDS,
  openingFocusId,
  relativeWindow,
  type CaretTarget,
  type RelativeRow,
} from "@game/scenes/support/relativeBoard";

/**
 * THE RELATIVE BOARD'S TWO RULES (D43, AC-18.1).
 *
 * `relativeWindow` is the selection: you, and at most two pilots either side.
 * `openingFocusId` is the caret: the forward action holds focus, EXCEPT while
 * the one-time opt-in question is on screen.
 *
 * The second one is here rather than in `tests/e2e/default-focus.spec.ts`
 * because that spec drives a real browser to assert the outcome, and the
 * outcome depends on a rule that can be stated and checked without one. The
 * e2e still asserts what the screen does; this asserts what the rule says, and
 * in particular the half that was easy to get wrong - the caret coming BACK to
 * continue the instant the question is answered.
 */

const PILOTS: RelativeRow[] = [
  { label: "Ivy", wpm: 96, isYou: false },
  { label: "Omar", wpm: 88, isYou: false },
  { label: "Ada", wpm: 80, isYou: true },
  { label: "Ren", wpm: 74, isYou: false },
  { label: "Kit", wpm: 70, isYou: false },
  { label: "Wen", wpm: 44, isYou: false },
];

/** The stage report's focus list once the question has been answered. */
const ANSWERED: CaretTarget[] = [{ id: "replay" }, { id: "continue", primary: true }];

/** The same list while the question is still being asked. */
const ASKING: CaretTarget[] = [
  { id: "board-yes" },
  { id: "board-no" },
  ...ANSWERED,
];

describe("relativeWindow: you, and your neighbours, and nobody else", () => {
  it("takes at most two either side, fastest first", () => {
    expect(relativeWindow(PILOTS).map((r) => r.label)).toEqual([
      "Ivy",
      "Omar",
      "Ada",
      "Ren",
      "Kit",
    ]);
    expect(NEIGHBOURS_PER_SIDE).toBe(2);
  });

  it("is empty when you are not in it", () => {
    // A board that does not contain you is a leaderboard, and D43 says this is
    // not one.
    expect(relativeWindow(PILOTS.filter((r) => !r.isYou))).toEqual([]);
    expect(relativeWindow([])).toEqual([]);
  });

  it("clips at the ends rather than padding", () => {
    const top: RelativeRow[] = [
      { label: "Ada", wpm: 99, isYou: true },
      { label: "Ren", wpm: 74, isYou: false },
    ];
    expect(relativeWindow(top).map((r) => r.label)).toEqual(["Ada", "Ren"]);
  });
});

describe("openingFocusId: the forward action, unless the screen is asking", () => {
  it("opens on continue, never on replay", () => {
    // The defect: the caret opened on "fly it again", so a child pressing Enter
    // on reflex silently re-flew the stage they had just finished.
    expect(openingFocusId(ANSWERED, false)).toBe("continue");
    // Replay is drawn FIRST, because "back" reads on the left. Layout order
    // does not get to choose what Enter does.
    expect(ANSWERED[0]?.id).toBe("replay");
  });

  it("gives the caret to the one-time question while it is on screen", () => {
    // THE EXCEPTION, and the reason it is one: a question the default action
    // skips past is a question nobody ever answers, and D43 gets one calm ask.
    expect(openingFocusId(ASKING, true)).toBe("board-yes");
    expect(PROMPT_TARGET_IDS).toEqual(["board-yes", "board-no"]);
  });

  it("gives it straight back the moment the question is answered", () => {
    // Same list, question no longer being asked: continue takes it, not the
    // board button that happened to hold it a frame ago, and not replay.
    expect(openingFocusId(ASKING, false)).toBe("continue");
    expect(openingFocusId(ANSWERED, true)).toBe("continue");
  });

  it("falls back to the first target, and to nothing at all", () => {
    expect(openingFocusId([{ id: "only" }], false)).toBe("only");
    expect(openingFocusId([], false)).toBeNull();
    expect(openingFocusId([], true)).toBeNull();
  });
});
