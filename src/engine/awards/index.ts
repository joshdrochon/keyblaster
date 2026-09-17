import {
  BELT_STOP_IDS,
  STOP_IDS,
  type Profile,
  type Stars,
  type StopId,
  type StopProgress,
} from "../types.js";
import { isCharted, routeComplete } from "../progress/index.js";

/**
 * Trophies (D74, D80; PRD AC-6d.1c, AC-6d.2).
 *
 * ==========================================================================
 * THE DEFECT THIS MODULE EXISTS FOR
 *
 * Twelve trophies were defined in `src/game/ui/catalog.ts`, the Beacon Log
 * rendered all twelve with their "how you earn it" line, and NOT ONE COULD EVER
 * BE EARNED, because nothing anywhere in `src/` ever wrote to `profile.trophies`.
 * Every test of the feature seeded the trophy into a fixture profile first and
 * then checked that the Log drew it, so the suite was green on a screen that was
 * guaranteed to read "0 of 12 earned" forever.
 *
 * `catalog.ts` had already said where the missing half belonged, in a comment
 * written before it existed: "Awarding belongs in the engine alongside the
 * scoring and progress code that can see a stage end." This is that. It is pure,
 * it is under the 95% coverage gate, and the catalogue still decides only what
 * EXISTS.
 * ==========================================================================
 *
 * AC-6d.2: "each is awarded exactly once per profile". That is discharged
 * structurally rather than by a flag - `award` returns the ids that are newly
 * true and NOT already on the profile, and the profile's list is a set. Awarding
 * the same run twice produces nothing the second time.
 *
 * ==========================================================================
 * D74, AND THE THING THE AUDIT FOUND WRONG WITH IT
 *
 * D74 grounds trophies in Deci, Koestner & Ryan (1999), read as "informational
 * rewards support motivation". The audit checked the paper and that citation is
 * backwards: what it found is that expected, performance-contingent rewards
 * UNDERMINE intrinsic motivation, `d = -0.28` for performance-contingent, and
 * that the effect is LARGER for children than for college students - which is
 * this game's entire audience. Positive FEEDBACK helped; tangible and symbolic
 * contingent rewards did not.
 *
 * That is an argument about whether this layer should exist, and it is not
 * mine to settle - it is in `gauntlet/escalations.md` with the fail-state
 * question it sits next to. What this module does in the meantime is implement
 * D80 as written while keeping the damage as small as the decision allows:
 *
 *   - every trophy is MASTERY-contingent, never effort- or time-contingent;
 *   - nothing here is comparative, ordered by value, or ranked;
 *   - nothing here gates progress: a profile with zero trophies can finish the
 *     whole route, so no trophy is ever a thing the child has to go and get.
 *
 * If the escalation comes back "remove them", deleting this module and its
 * caller is the whole change. That is deliberate.
 * ==========================================================================
 *
 * Pure TypeScript: no Phaser, no DOM, no clock, no Math.random (CLAUDE.md).
 */

/** Stars a stage must earn to count as clean. 3 stars is 0 hull hits (AC-4.4). */
export const CLEAN_STAGE_STARS: Stars = 3;

/** Steady Hull: "three clean stops in a row" (D80, AC-6d.1c). */
export const STEADY_HULL_RUN = 3;

/** Chain 25 and Chain 50, as the numbers they are named after. */
export const CHAIN_TROPHIES: readonly { readonly id: string; readonly combo: number }[] = [
  { id: "chain25", combo: 25 },
  { id: "chain50", combo: 50 },
];

/**
 * The stop whose belt IS the main belt, for Belt Runner.
 *
 * AMBIGUITY, FLAGGED RATHER THAN BURIED. AC-6d.1c says "Belt Runner (main-belt
 * stage 0 hits)" and the shipped copy says "cross the main belt without a
 * scratch", but the route has no stop called "belt": it runs earth, mars,
 * jupiter, saturn, uranus, neptune, pluto. The real main belt lies BETWEEN Mars
 * and Jupiter, so either of those two is a defensible reading.
 *
 * Mars is taken because it is the first belt stage (`BELT_STOP_IDS[0]`), it is
 * the stop `DEFAULT_FLIGHT_CONFIG` flies, and it is the first belt a child ever
 * sees - which makes Belt Runner an early, reachable trophy rather than a second
 * Ring Weaver. Recorded in `gauntlet/escalations.md` for the user to confirm.
 */
export const MAIN_BELT_STOP: StopId = BELT_STOP_IDS[0] as StopId;

/** Ring Weaver and Dark Side: a named stop at three stars (AC-6d.1c). */
export const THREE_STAR_TROPHIES: readonly {
  readonly id: string;
  readonly stopId: StopId;
}[] = [
  { id: "ringWeaver", stopId: "saturn" },
  { id: "darkSide", stopId: "uranus" },
];

/**
 * What the run just finished can tell us that the profile cannot.
 *
 * Everything else a trophy needs - beacons, stars per stop, the route - is
 * already persisted, so this carries only the four facts that live for the
 * length of one stage and are then gone.
 */
export interface StageAward {
  readonly stopId: StopId;
  /** The stage's rating (AC-4.4). 3 means it was flown without a hull hit. */
  readonly stars: Stars;
  /** Longest unbroken chain of words this stage (AC-6c.1's combo, at its peak). */
  readonly bestCombo: number;
  /**
   * D25's dual-cannon tier was unlocked for this stage, i.e. two live rocks
   * could share a first letter. Sharp Eye is "clear a belt where two rocks
   * start the same".
   */
  readonly sharedPrefixStage: boolean;
  /**
   * AC-9.3's retention words, all of them blasted. `null` when the stage had no
   * retention words at all, which is NOT the same as getting none of them: a
   * Mars belt has no earlier stop to draw from, and awarding Long Memory for an
   * empty set would be awarding it for nothing.
   */
  readonly retentionAllRecalled: boolean | null;
}

const starsAt = (progress: readonly StopProgress[], stopId: StopId): Stars =>
  progress.find((p) => p.stopId === stopId)?.stars ?? 0;

/**
 * Three consecutive stops along the ROUTE, each cleared at three stars.
 *
 * Route order rather than chronological order, because the profile stores no
 * clear times per stage and the route is the thing the copy describes - "three
 * clean stops in a row" is a place on the map, not a session.
 */
export function steadyHullRun(progress: readonly StopProgress[]): boolean {
  let run = 0;
  for (const stopId of BELT_STOP_IDS) {
    run = starsAt(progress, stopId) >= CLEAN_STAGE_STARS ? run + 1 : 0;
    if (run >= STEADY_HULL_RUN) return true;
  }
  return false;
}

/**
 * Every trophy the profile now satisfies, earned or not.
 *
 * Deliberately NOT "newly earned": this is the predicate, and `award` below
 * does the set difference. Keeping them apart means the rule can be tested
 * without a profile that has to be built in a particular order.
 */
export function satisfiedTrophies(
  profile: Profile,
  stage: StageAward | null = null,
): readonly string[] {
  const out: string[] = [];
  const progress = profile.progress;

  // --- the route ---------------------------------------------------------
  if (isCharted(progress, "earth")) out.push("firstLight");
  if (STOP_IDS.some((id) => isCharted(progress, id))) out.push("pathfinder");
  if (routeComplete(progress)) out.push("mapMaker");
  if (isCharted(progress, "pluto")) out.push("lastLight");

  // --- persisted stars ---------------------------------------------------
  if (starsAt(progress, MAIN_BELT_STOP) >= CLEAN_STAGE_STARS) out.push("beltRunner");
  for (const { id, stopId } of THREE_STAR_TROPHIES) {
    if (starsAt(progress, stopId) >= CLEAN_STAGE_STARS) out.push(id);
  }
  if (steadyHullRun(progress)) out.push("steadyHull");

  // --- this stage only ---------------------------------------------------
  // These four cannot be recomputed from a saved profile, so a profile alone
  // never satisfies them. That is correct rather than a limitation: a chain of
  // 25 is a thing that happened, and nothing persists it.
  if (stage !== null) {
    for (const { id, combo } of CHAIN_TROPHIES) {
      if (stage.bestCombo >= combo) out.push(id);
    }
    if (stage.sharedPrefixStage && stage.stars > 0) out.push("sharpEye");
    if (stage.retentionAllRecalled === true) out.push("longMemory");
  }

  return out;
}

/** Trophies this run earns that the profile does not already hold (AC-6d.2). */
export function newTrophies(
  profile: Profile,
  stage: StageAward | null = null,
): readonly string[] {
  const held = new Set(profile.trophies);
  const out: string[] = [];
  for (const id of satisfiedTrophies(profile, stage)) {
    if (held.has(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

/**
 * Apply this run's trophies to a profile. Pure; the caller persists it.
 *
 * Returns the SAME object when nothing is new, so a caller can cheaply tell
 * whether anything happened and a store write can be skipped.
 */
export function awardTrophies(
  profile: Profile,
  stage: StageAward | null = null,
): Profile {
  const earned = newTrophies(profile, stage);
  if (earned.length === 0) return profile;
  return { ...profile, trophies: [...profile.trophies, ...earned] };
}
