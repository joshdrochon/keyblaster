import { type WordRecord } from "../types.js";

/**
 * Spaced retention (architecture section 4.2, D21, D23, AC-9.3, AC-9.4).
 *
 * Intervals are measured in STAGES, not in wall-clock time. A child may play
 * three stops in one sitting or one a week; what matters pedagogically is how
 * much other material came between two exposures, which is what Cepeda's
 * spacing work actually varies. Stages are also the only clock the engine can
 * observe without reaching for a real one.
 */

/** Interval in stages before a word is eligible again (arch 4.2). */
export function intervalStages(ease: number): number {
  if (ease > 1.2) return 1; // weak: bring it back next stage
  if (ease >= 0.5) return 2; // learning
  return 4; // mastered: rare combo fodder (D21)
}

/**
 * AC-9.3: eligible when enough stages have passed since the last exposure.
 * A word never seen is always eligible - it cannot be overdue.
 */
export function isEligible(
  record: WordRecord | undefined,
  lastSeenStage: number | undefined,
  currentStage: number,
): boolean {
  if (!record || record.exposures === 0) return true;
  if (currentStage < record.nextEligibleStage) return false;
  if (lastSeenStage === undefined) return true;
  return currentStage - lastSeenStage >= intervalStages(record.ease);
}

/**
 * AC-9.4 / D23: a missed word comes back SOONER, not later. This is the line
 * that makes misses cost nothing - the only consequence of missing a word is
 * seeing it again, which is the intervention, not the punishment.
 */
export const nextStageAfterMiss = (currentStage: number): number => currentStage + 1;

/** After a hit, the ordinary interval applies. */
export const nextStageAfterHit = (currentStage: number, ease: number): number =>
  currentStage + intervalStages(ease);
