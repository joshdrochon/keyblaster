/**
 * How long after the reveal arms that input cannot skip it.
 *
 * A child opens a briefing by pressing Enter on the map, and `create` runs
 * inside that same input turn - so without this the opening keystroke was also
 * the skip, and the page was fully revealed before the first frame. Measured:
 * one Enter took `revealed` from 0 to 312 instantly.
 *
 * 200 ms is longer than any key repeat or trailing event from the navigation
 * and far shorter than the reveal itself (about 1.8 s at the ceiling), so a
 * child who actually wants the page now still gets it on their next keystroke.
 */
export const REVEAL_SKIP_GRACE_MS = 200;

/**
 * THE BRIEFING TYPES ITSELF OUT (UR-59, screen 4).
 *
 * The page used to be drawn complete on `create`. It reveals character by
 * character now, the way a dialogue box does, so the screen reads as a briefing
 * being DELIVERED rather than a page that was already lying there.
 *
 * ================== WHY A TYPEWRITER IS DANGEROUS HERE, SPECIFICALLY ==========
 * This is a typing game for seven-year-olds. A reveal that paces the reader is
 * a reveal that stands between a child and the button they came to press, and
 * the same child sees this screen every time they fly a stop - four visits to
 * Neptune is four viewings of the same 340 characters. So the effect is bounded
 * by four rules, and all four are tested rather than promised:
 *
 *   1. ANY KEY FINISHES IT. Not a named skip key, not a button: the first
 *      keystroke or click completes the page instantly. (`BriefingScene`)
 *   2. IT NEVER GATES LAUNCH. The focus ring, the keyboard menu and both
 *      controls are live from the first frame, and the key that completes the
 *      reveal is not swallowed - Enter on arrival completes the page AND
 *      launches, in that order, on the same keystroke.
 *   3. REDUCED MOTION TURNS IT OFF. `settings.reducedMotion` (AC-19.3, D41) is
 *      read on this path and the page is drawn whole. A reading intervention
 *      that only a menu reads is the UR-38 defect; this is a live reader.
 *   4. IT CANNOT OUTLAST `REVEAL_CEILING_MS`, whatever the copy does.
 *
 * ================== THE CADENCE, AND WHY IT IS THIS FAST ==================
 * `REVEAL_CPS` is 160 characters per second - 6.25 ms a character - with a hard
 * ceiling of 1800 ms on the whole page. The shipped briefings are 279 to 370
 * characters, so every stop completes between about 1.7 s and the ceiling.
 *
 * The number is set by READING SPEED, not by taste. A seven-year-old reads
 * somewhere around 90 words a minute, which is roughly 8 characters a second. A
 * reveal anywhere near that rate is not an effect, it is a metronome the reader
 * is tied to: they catch up to the cursor and wait for it, on every line, on
 * every visit. At 160 cps the reveal is around twenty times faster than the eye
 * that follows it, so it always arrives ahead of the reader - it is felt as the
 * page ARRIVING, which is the thing the ticket asks for, and never as pacing.
 *
 * The familiar 30-40 cps of a console dialogue box is the wrong reference and
 * it is worth saying why: those boxes reveal two short lines at a time and then
 * wait for a button. This is a whole page of five sentences. At 35 cps Neptune
 * would take ten seconds, which is not a Zelda text box, it is a cutscene.
 *
 * The ceiling is what makes the rule hold for copy nobody has written yet: at
 * 400 characters the nominal cadence would run 2.5 s, so the cadence tightens
 * instead. It is 1800 rather than something rounder because
 * `text-collision.spec.ts` settles for 2000 ms before it measures every story
 * screen at every stop, and a reveal that can still be running when a sweep
 * reads the frame is a flaky test waiting to happen (standards rule 6).
 *
 * Pure: numbers in, numbers out. No Phaser, no DOM, no clock of its own - the
 * scene hands in the elapsed time, which is what lets every claim above be a
 * unit test rather than a stopwatch held up to a capture.
 */

/** Nominal reveal rate, characters per second. */
export const REVEAL_CPS = 160;

/** The longest the whole page may take, whatever its copy does. */
export const REVEAL_CEILING_MS = 1800;

/** How long a run of `chars` characters takes, ceiling applied. */
export function revealDurationMs(chars: number): number {
  if (chars <= 0) return 0;
  return Math.min(REVEAL_CEILING_MS, (chars * 1000) / REVEAL_CPS);
}

/**
 * The cadence actually used for a run of `chars` characters.
 *
 * Reported rather than inferred, because it is the number the ticket asks to be
 * chosen deliberately and the ceiling can change it: 279 characters run at the
 * nominal 6.25 ms, 370 run at 4.86 because the page hits the ceiling first.
 */
export function msPerChar(chars: number): number {
  return chars <= 0 ? 0 : revealDurationMs(chars) / chars;
}

/** How much of a `chars`-long run is showing at `elapsedMs`. */
export function charsRevealedAt(elapsedMs: number, chars: number): number {
  if (chars <= 0) return 0;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  const duration = revealDurationMs(chars);
  if (elapsedMs >= duration) return chars;
  return Math.min(chars, Math.floor((elapsedMs / duration) * chars));
}

/**
 * Split a whole-page reveal across the blocks it is made of, in order.
 *
 * The page is one run of characters, not five independent ones: block two
 * starts the instant block one finishes, which is what makes the reveal walk
 * DOWN THE PAGE the way a dialogue box walks along a line. Returns how many
 * characters of each block are showing.
 */
export function revealPerBlock(
  lengths: readonly number[],
  revealed: number,
): number[] {
  let left = Math.max(0, revealed);
  return lengths.map((length) => {
    const take = Math.min(length, left);
    left -= take;
    return take;
  });
}
