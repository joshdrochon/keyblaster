import { HINT_CONTRACT, HINT_TOP } from "./grid.js";

/**
 * THE KEYBOARD HINT, as a contract rather than as nine separate decisions.
 *
 * ===================== WHAT WAS REPORTED =====================
 * UR-56: a keyboard hint reported as redundant, and asked for outright removal
 * rather than relocation. It sat 28 px to the right of a focused button already
 * labelled with the same verb, so the screen said the word twice and one of the
 * two was in the dimmest ink on it.
 *
 * The follow-up on the ticket is the part that matters: a hint that repeats the
 * button beside it is noise EVERYWHERE, not on the screen that got reported. The Title
 * keep-clear (UR-06 -> UR-52) and the starfield (UR-14 -> UR-50.5) were both
 * fixed on one screen and came back on the next one, so this file holds the
 * rule for every screen instead.
 *
 * ===================== THE RULE, IN TWO PARTS =====================
 *   1. NO SCREEN DRAWS A HINT BESIDE A BUTTON. That placement is the defect
 *      itself: two pieces of text saying one thing, read as one object. Two
 *      screens did it (Beacon, Briefing) and neither does now.
 *   2. A hint on the grid line must TEACH something the buttons do not. The
 *      bottom-left line is a screen's keyboard instructions - it names keys,
 *      which no button label does - so it is allowed to contain a verb a button
 *      also uses, but it may not consist ONLY of words already on the buttons.
 *
 * `tests/unit/ui/hint.test.ts` sweeps every scene in `src/game/scenes`, not the
 * ones anybody remembered: a scene missing from `SCREEN_HINTS` fails the
 * completeness check (coding-standards rule 5 - a harness sweeps).
 *
 * Nothing here imports Phaser. Placement is `grid.ts`'s `HINT_CONTRACT`; this
 * module is where a screen declares that it is ON it.
 */

/** Where a screen puts its hint. */
export type HintPlacement =
  /** The shared bottom-left grid line. The only allowed placement. */
  | "grid"
  /** No hint. A screen whose controls speak for themselves. */
  | "none"
  /**
   * Beside or beneath a button. BANNED - this is UR-56's defect, and the value
   * exists so the guard has something to catch rather than being a comment.
   */
  | "beside-button";

export interface ScreenHint {
  /** The scene file, so the completeness guard can match on it. */
  readonly file: string;
  readonly placement: HintPlacement;
  /** The string key the hint renders, or null when there is no hint. */
  readonly hintKey: string | null;
  /** Every button/label on the screen that names an action. */
  readonly actionKeys: readonly string[];
  /** Why this screen has no hint, where it has none. Never left blank. */
  readonly note?: string;
}

/**
 * EVERY SCREEN, its hint and the actions it offers.
 *
 * The two `null`s with a UR-56 note are the removals. They are recorded rather
 * than deleted so that the next person to add a hint to those screens reads why
 * there is not one.
 */
export const SCREEN_HINTS: readonly ScreenHint[] = [
  {
    file: "TitleScene.ts",
    placement: "none",
    hintKey: null,
    actionKeys: ["title.play", "results.continue", "title.settings", "title.beaconLog"],
    note: "the menu column IS the instructions; every item is a labelled control.",
  },
  {
    file: "ProfilePickerScene.ts",
    placement: "grid",
    hintKey: "ui.common.hintKeys",
    actionKeys: ["common.back"],
  },
  {
    file: "ProfileCreateScene.ts",
    placement: "grid",
    hintKey: "ui.common.hintKeys",
    actionKeys: ["common.back"],
  },
  {
    file: "BeaconLogScene.ts",
    placement: "grid",
    hintKey: "ui.common.hintKeys",
    actionKeys: ["common.back"],
  },
  {
    file: "SettingsScene.ts",
    placement: "grid",
    hintKey: "ui.common.hintAdjust",
    actionKeys: ["common.back"],
  },
  {
    file: "DirectorMapScene.ts",
    placement: "grid",
    hintKey: "map.hint",
    actionKeys: ["map.travel", "title.beaconLog", "title.settings"],
    note:
      "UR-56 reviewed and KEPT. 'fly here' is a caption inside the board at the " +
      "foot of the screen, 600 px from the hint and not a plate the ring lands " +
      "on; the focusable things here are planet discs, so this line is the only " +
      "place the screen says how to move along the route or how to launch.",
  },
  {
    file: "EarthActivationScene.ts",
    placement: "none",
    hintKey: null,
    actionKeys: ["earth.continue"],
    note: "the screen is a typing prompt; the prompt is the instruction.",
  },
  {
    file: "BriefingScene.ts",
    placement: "none",
    hintKey: null,
    actionKeys: ["briefing.start", "briefing.back"],
    note:
      "UR-56. It was 'enter to launch · esc to go back', drawn 14 px UNDER a " +
      "button reading 'launch' and naming a chip reading 'back to the map'. " +
      "Both halves repeated a plate that was already on the screen; UR-27 is " +
      "what made the second one visible and labelled, which is what left this " +
      "line with nothing of its own to say.",
  },
  {
    file: "PreflightScene.ts",
    placement: "grid",
    hintKey: "preflight.hint",
    actionKeys: ["preflight.back"],
  },
  {
    file: "FlightScene.ts",
    placement: "none",
    hintKey: null,
    actionKeys: [],
    note: "gameplay. The HUD carries the state and nothing is focusable.",
  },
  {
    file: "HudScene.ts",
    placement: "none",
    hintKey: null,
    actionKeys: [],
    note: "an overlay on Flight, not a screen.",
  },
  {
    file: "StallScene.ts",
    placement: "none",
    hintKey: null,
    actionKeys: [],
    note: "the stall card is Shadow speaking; typing resumes the run.",
  },
  {
    file: "PauseScene.ts",
    placement: "grid",
    hintKey: "ui.common.hintKeys",
    actionKeys: ["common.back"],
  },
  {
    file: "WarpScene.ts",
    placement: "grid",
    hintKey: "warp.hint",
    actionKeys: [],
    note: "no button: the sentence is the control.",
  },
  {
    file: "BeaconScene.ts",
    placement: "none",
    hintKey: null,
    actionKeys: ["beacon.continue"],
    note:
      "UR-56, as reported: the hint sat 28 px right of a focused button whose " +
      "label already carried its verb. The button is the only control here " +
      "and it opens with focus, so the line said nothing the ring did not.",
  },
  {
    file: "ResultsScene.ts",
    placement: "grid",
    hintKey: "results.hint",
    actionKeys: ["results.replay", "results.continue"],
  },
  {
    file: "EndingScene.ts",
    placement: "none",
    hintKey: null,
    actionKeys: ["ending.continue"],
    note: "one button, centred, with focus. The card is the moment; no chrome.",
  },
];

/**
 * Words a hint may share with a button without repeating it.
 *
 * KEY NAMES are on this list because naming a key is the whole job of a hint -
 * no button label says "enter" - and the grammar words are here because "to"
 * matching "to" is not a repeated verb. Everything else counts.
 */
export const HINT_STOPWORDS: ReadonlySet<string> = new Set([
  // grammar
  "a", "an", "and", "at", "for", "from", "in", "is", "it", "of", "on", "or",
  "that", "the", "this", "to", "with", "you", "your",
  // key names - what a hint exists to say
  "arrows", "backspace", "down", "enter", "esc", "escape", "key", "keys",
  "left", "press", "return", "right", "space", "tab", "up",
]);

/** A label's words, lowercased, punctuation stripped, stopwords dropped. */
export function significantWords(copy: string): string[] {
  return copy
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0 && !HINT_STOPWORDS.has(w));
}

/** The words `hint` takes straight from `label`. Empty means it repeats nothing. */
export function repeatedWords(hint: string, label: string): string[] {
  const inLabel = new Set(significantWords(label));
  return [...new Set(significantWords(hint))].filter((w) => inLabel.has(w));
}

/**
 * Does this hint teach anything the buttons do not already say?
 *
 * The test part 2 runs: a hint every one of whose significant words is already
 * on a button is the UR-56 defect written long-hand, wherever it is drawn.
 */
export function teachesSomethingNew(hint: string, labels: readonly string[]): boolean {
  const onButtons = new Set(labels.flatMap(significantWords));
  const words = significantWords(hint);
  if (words.length === 0) return false;
  return words.some((w) => !onButtons.has(w));
}

/**
 * `hintOrigin` USED TO LIVE HERE AND IS GONE. See `ui/hintLine.ts`.
 *
 * It took a `padX` and a `padY`, which is how the Director map came to draw its
 * ink at (118, 1012) while the menu screens drew theirs at (96, 1004): the
 * helper was one call, and it still let every caller choose. `hintLine.hintInk`
 * takes nothing, and `hintLine.drawHint` - the only thing that draws this line
 * now - does not expose a position at all.
 *
 * This module stays Phaser-free and stays the CONTRACT: which screens have a
 * hint, what it says, and why the ones without one do not.
 */

export { HINT_CONTRACT, HINT_TOP };
