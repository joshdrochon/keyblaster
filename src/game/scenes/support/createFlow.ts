/**
 * WHICH BEATS OF PILOT CREATION ARE LIVE, AND THE DRAFT THEY FILL IN.
 *
 * ================== WHY THIS MODULE EXISTS ==================
 * Screen 2 was written as three beats - who you are, what you fly, what you
 * call it (D72). The later two are not finished, and the owner asked for the
 * flow to be cut to what a child can actually complete tonight. That is a HIDE,
 * not a delete: every line that draws the ship gallery and the ship-name field
 * is still in `ProfileCreateScene`, still typed, still compiled, still the only
 * copy of itself.
 *
 * So the trim is ONE LIST rather than a set of deletions, and restoring the
 * full flow is the one line marked below. Nothing else in the scene knows how
 * many beats there are: the heading, the step counter, the "Next" vs the
 * confirm button, Esc, and where the last beat commits are all derived from
 * this list, so a restored flow cannot come back half-wired.
 *
 * ================== WHY THE SCENE DOES NOT OWN IT ==================
 * `ProfileCreateScene` extends a Phaser class and cannot be imported under
 * vitest's node environment, which is the same reason `WarpScene`'s rules live
 * outside it. The decisions this file makes - which beat is next, whether this
 * one commits, whether a counter is honest - are the ones worth asserting, so
 * they are pure functions over a step list that the test can pass its own copy
 * of. That is also what lets the test prove the RESTORED flow still works
 * without shipping it.
 *
 * Nothing here imports Phaser or touches the DOM.
 */

/** The three beats, in the order they were designed (D72). */
export const CREATE_STEPS = ["pilot", "ship", "shipName"] as const;

export type CreateStep = (typeof CREATE_STEPS)[number];

/**
 * ============ THE ONE LINE ============
 *
 * The beats a child walks today. To restore the full three-beat flow, make
 * this the whole list:
 *
 *     export const ENABLED_CREATE_STEPS: readonly CreateStep[] = CREATE_STEPS;
 *
 * and nothing else changes. The two hidden beats are "ship" (choose your ship,
 * with the four hulls and four skins) and "shipName" (name your ship). While
 * they are off, a new pilot takes the defaults `blankProfile` would have given
 * them anyway - the starting hull, and the ship name from the string table
 * (C07) - so the profile written is complete either way.
 *
 * That one line is the whole PRODUCT change; it was walked end to end in a
 * browser with all three beats on before it was trimmed back. The tests that
 * state what ships TODAY have to be told as well, and there are exactly three
 * places - a test that passed under either setting would not be asserting
 * anything:
 *
 *   tests/unit/scenes/profileCreateFlow.test.ts  the `ENABLED_CREATE_STEPS`,
 *     `nextCreateStep(0)`, `createStepAt(1|2)` and `showsCreateStepCounter()`
 *     expectations in the first describe. Each one already asserts the
 *     restored behaviour beside it, so the change is swapping which is which.
 *   tests/e2e/profile.spec.ts  "the hidden beats are unreachable" (delete it;
 *     the beats are reachable again) and the confirm-button id in the walk,
 *     which becomes `create.next.0` once a beat follows the pilot beat.
 *   tests/e2e/profile.spec.ts  the locked ship/skin gallery test that was
 *     removed with the beat - git log for this file has it verbatim.
 */
export const ENABLED_CREATE_STEPS: readonly CreateStep[] = ["pilot"];

/** The beat at a focus-order index, or null if the index is off the end. */
export function createStepAt(
  index: number,
  steps: readonly CreateStep[] = ENABLED_CREATE_STEPS,
): CreateStep | null {
  return steps[index] ?? null;
}

/** Is this beat drawn at all? A hidden beat has no index and no controls. */
export function isCreateStepEnabled(
  step: CreateStep,
  steps: readonly CreateStep[] = ENABLED_CREATE_STEPS,
): boolean {
  return steps.includes(step);
}

/**
 * What the forward button does from here: the next beat's index, or "commit" -
 * the pilot is created and the screen is done.
 *
 * The LAST ENABLED beat commits, whichever beat that is. That is the whole
 * reason the confirm button does not have to be hard-wired to the ship-name
 * step: with the flow trimmed, "choose your look" is last, so it is the one
 * that carries the confirm.
 */
export function nextCreateStep(
  index: number,
  steps: readonly CreateStep[] = ENABLED_CREATE_STEPS,
): number | "commit" {
  const next = index + 1;
  return next < steps.length ? next : "commit";
}

/** Where Esc goes from here: back a beat, or out of the screen (AC-18.1). */
export function backFromCreateStep(
  index: number,
  steps: readonly CreateStep[] = ENABLED_CREATE_STEPS,
): number | "exit" {
  if (index <= 0) return "exit";
  return Math.min(index - 1, steps.length - 1);
}

/**
 * Is a "Step n of m" counter worth drawing?
 *
 * Only when there is more than one beat. A counter over a single screen reads
 * "Step 1 of 1", which is noise at best, and the counter this replaced said
 * "Step 1 of 3" over a flow with one step - a line that was simply untrue.
 * Derived rather than deleted, so the counter returns with the beats.
 */
export function showsCreateStepCounter(
  steps: readonly CreateStep[] = ENABLED_CREATE_STEPS,
): boolean {
  return steps.length > 1;
}

/** Everything the screen collects before the profile exists. */
export interface CreateDraft {
  /** Index into the ENABLED steps, never into `CREATE_STEPS`. */
  step: number;
  pilotName: string;
  avatarId: string;
  shipId: string;
  shipName: string;
}

/**
 * A BLANK DRAFT - the fix for the name field that remembered the last child.
 *
 * Phaser constructs each scene ONCE (`boot.ts`: `game.scene.add(key, klass)`)
 * and `scene.start` re-runs `create()` on that same instance, so a class field
 * initialiser runs exactly once in the life of the page. `pilotName = ""` was
 * therefore the first pilot's answer for the rest of the session: the second
 * child to open "new pilot" found the first child's name already typed into a
 * screen whose entire purpose is a NEW pilot, and could create a profile
 * carrying it by pressing one key. Same mechanism, same session, for the mark
 * they chose and for which beat the screen opened on.
 *
 * The draft is one object rather than five fields so that starting over is one
 * assignment that cannot half-happen, and so that "what does a fresh screen
 * hold" is a question with an answer a test can read.
 */
export function freshCreateDraft(options: {
  avatarId: string;
  shipId: string;
  shipName: string;
}): CreateDraft {
  return {
    step: 0,
    pilotName: "",
    avatarId: options.avatarId,
    shipId: options.shipId,
    shipName: options.shipName,
  };
}
