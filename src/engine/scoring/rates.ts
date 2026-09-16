/**
 * WPM and accuracy.
 *
 * Both definitions are taken verbatim from the Type Storm reference read out of
 * its shipped bundle (decision-log "Type Storm reference"): the point of mirror-
 * ing them exactly is that a player moving between the two games sees the same
 * number mean the same thing. D58 limits the borrowing to loop mechanics, and a
 * scoring definition is loop mechanics.
 */

/** Characters per "word" in the standard WPM definition. */
export const CHARS_PER_WORD = 5;

const MS_PER_MINUTE = 60_000;

/**
 * WPM = (characters / 5) / minutes.
 *
 * `characters` is the count of characters the player actually typed correctly
 * during the stage; the caller owns that tally (the engine counts keystrokes,
 * not word lengths, so a word abandoned mid-way still contributes what it
 * earned).
 *
 * Division-by-zero: a stage with no elapsed time has no rate to report. We
 * return 0 rather than Infinity because Infinity poisons every downstream
 * delta, average and render. Non-positive and non-finite elapsed time are
 * treated the same way (a clock that went backwards is not evidence of
 * infinite speed).
 */
export function wpm(characters: number, elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  if (!Number.isFinite(characters) || characters <= 0) return 0;
  return characters / CHARS_PER_WORD / (elapsedMs / MS_PER_MINUTE);
}

/**
 * Accuracy = hits / (hits + typos), as a fraction in [0, 1].
 *
 * KNOWN UNIT MISMATCH, inherited from the PRD and escalated separately by the
 * lead - do not "fix" it here. `hits` counts completed WORDS (AC-3.4) while
 * `typos` counts KEYSTROKES (AC-3.2), so this ratio mixes units and reads
 * roughly 5x harsher than a per-keystroke accuracy would: one mistyped key in a
 * clean five-word run scores 5/6 = 83%, not 96%. The formula is implemented as
 * documented because the documented value is what ships; the fix, if there is
 * one, is a PRD change to the definition of `hits`, not a local divergence.
 *
 * Zero attempts returns 1. This is the D31 call: with no evidence of anything
 * going wrong, the honest vacuous answer is "nothing went wrong", and it is the
 * only one of {0, 1, NaN} that cannot render as a 0% on a child's results
 * screen for a stage they never got to type in. It is a defensive branch in
 * practice - every stage ships a spawn queue, so a cleared stage always has
 * attempts.
 */
export function accuracy(hits: number, typos: number): number {
  const h = Number.isFinite(hits) ? Math.max(0, hits) : 0;
  const t = Number.isFinite(typos) ? Math.max(0, typos) : 0;
  const attempts = h + t;
  if (attempts <= 0) return 1;
  return h / attempts;
}
