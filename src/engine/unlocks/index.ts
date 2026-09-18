import type { Profile } from "../types.js";
import { litCount } from "../progress/index.js";
import { CLEAN_STAGE_STARS, type StageAward } from "../awards/index.js";

/**
 * Ship and skin unlocks (D73, D79; PRD AC-6d.1, AC-6d.1b).
 *
 * ==========================================================================
 * THE DEFECT THIS MODULE EXISTS FOR
 *
 * Four ships and four skins were defined in `src/game/ui/catalog.ts`,
 * `ProfileCreateScene` drew all eight tiles with their "unlocks after 3
 * beacons" sentence, `ProfilePickerScene` re-coloured a pilot's card from
 * `liveryFor(profile)` - and NOT ONE OF THEM COULD EVER BE UNLOCKED, because
 * nothing anywhere in `src/` ever added an id to `profile.unlockedShips` or
 * `profile.unlockedSkins`. `blankProfile` wrote the starting hull and the two
 * lists were read-only for the life of the profile.
 *
 * This is `engine/awards/index.ts`'s trophy defect one table over, and
 * `tests/unit/catalog/unlocks.test.ts` said so in as many words rather than
 * papering over it: "AC-6d.1b's thresholds are asserted as CONFIG, because
 * config is all they are."
 *
 * This is the other half. It is pure, it sits under the 95% coverage gate, and
 * `catalog.ts` still decides only what EXISTS.
 * ==========================================================================
 *
 * D73 / AC-6d.1: "skins unlock only from mastery milestones defined in config;
 * no time/purchase path exists". That is discharged STRUCTURALLY here, the same
 * way `catalog.ts` discharges it: the only inputs this module has are the
 * persisted route and one `StageAward`. There is no clock, no session length,
 * no counter of anything a child could accumulate by leaving the game running,
 * and nowhere to put one. A time-played unlock cannot be written here without
 * adding a parameter that does not exist.
 *
 * WHY `StageAward` AND NOT A SECOND SHAPE. Three of the four skins are the
 * same three facts three trophies already need - a 25 chain, a 50 chain, a full
 * retention set - and they die with the stage. Sharing the record means the
 * chain that earns Chain 25 and the chain that earns the deep-blue trim are the
 * same chain by construction, rather than two readings of one run that can
 * disagree.
 *
 * Pure TypeScript: no Phaser, no DOM, no clock, no Math.random (CLAUDE.md).
 */

/** A ship and the number of lit beacons that opens it (AC-6d.1b: 1/3/5/7). */
export interface ShipUnlockRule {
  readonly id: string;
  readonly beacons: number;
}

/**
 * The four hulls, at the four thresholds the PRD names.
 *
 * These ids and numbers are ALSO in `src/game/ui/catalog.ts`, which is the
 * presentation table, and the engine may not import the game layer. The two are
 * held together by `tests/unit/unlocks/unlocks.test.ts`, which asserts this list
 * and `SHIPS` agree id-for-id and number-for-number - so a ship added to the
 * catalogue with no rule here fails a test rather than becoming a tile nothing
 * can open.
 */
export const SHIP_UNLOCKS: readonly ShipUnlockRule[] = [
  { id: "ship-1", beacons: 1 },
  { id: "ship-2", beacons: 3 },
  { id: "ship-3", beacons: 5 },
  { id: "ship-4", beacons: 7 },
];

/** The two chain skins, as the numbers they are named after (AC-6d.1b). */
export const SKIN_CHAINS: readonly { readonly id: string; readonly combo: number }[] = [
  { id: "skin-2", combo: 25 },
  { id: "skin-3", combo: 50 },
];

/** "Unlocks at your first 3-star stop" - a persisted fact, not a stage one. */
export const FIRST_THREE_STAR_SKIN = "skin-1";

/** "Unlocks when you remember a whole word set" (AC-9.3's retention set). */
export const RETENTION_SKIN = "skin-4";

/**
 * Beacons lit, from the same derivation the Director map's header counts.
 *
 * `litCount` rather than "entries with a `beaconPlacedAt`": a record carrying
 * one half of a clear and not the other is exactly what `isCharted` was
 * hardened against, and a hull must not open on a malformed row that the map
 * itself draws as locked.
 */
export function beaconsLit(profile: Profile): number {
  return litCount(profile.progress);
}

/** The best star rating anywhere on the route (AC-6d.1b's "first 3-star stop"). */
export function bestStars(profile: Profile): number {
  return profile.progress.reduce((best, p) => Math.max(best, p.stars), 0);
}

/** Every ship this profile now satisfies the rule for, held or not. */
export function satisfiedShips(profile: Profile): readonly string[] {
  const lit = beaconsLit(profile);
  return SHIP_UNLOCKS.filter((s) => lit >= s.beacons).map((s) => s.id);
}

/**
 * Every skin this profile now satisfies the rule for, held or not.
 *
 * `stage` is null for a profile read outside a run - a harness mount, or the
 * profile screen asking what is open. Three of the four skins are then
 * unreachable, and that is correct rather than a limitation: a chain of 25 is a
 * thing that happened, and nothing persists it.
 */
export function satisfiedSkins(
  profile: Profile,
  stage: StageAward | null = null,
): readonly string[] {
  const out: string[] = [];
  if (bestStars(profile) >= CLEAN_STAGE_STARS) out.push(FIRST_THREE_STAR_SKIN);
  if (stage !== null) {
    for (const { id, combo } of SKIN_CHAINS) {
      if (stage.bestCombo >= combo) out.push(id);
    }
    // `=== true` on purpose: `null` is "this belt had no retention words at
    // all", which is a Mars belt with no earlier stop to draw from, and
    // "recalled all zero of them" must not earn the ember trim.
    if (stage.retentionAllRecalled === true) out.push(RETENTION_SKIN);
  }
  return out;
}

/** What is newly open, i.e. satisfied and not already on the profile. */
export interface NewUnlocks {
  readonly ships: readonly string[];
  readonly skins: readonly string[];
}

function added(held: readonly string[], satisfied: readonly string[]): string[] {
  const have = new Set(held);
  const out: string[] = [];
  for (const id of satisfied) {
    if (have.has(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

/**
 * Ships and skins this run opens that the profile does not already hold.
 *
 * Once-only is structural rather than flagged, exactly as AC-6d.2 is for
 * trophies: the profile's lists are sets and this is the set difference, so
 * awarding the same run twice produces nothing the second time.
 */
export function newUnlocks(
  profile: Profile,
  stage: StageAward | null = null,
): NewUnlocks {
  return {
    ships: added(profile.unlockedShips, satisfiedShips(profile)),
    skins: added(profile.unlockedSkins, satisfiedSkins(profile, stage)),
  };
}

/**
 * What a pilot who does not exist yet owns: the starting hull, no trim.
 *
 * D79 makes unlocks PER PROFILE. The create screen used to read them off
 * `app.profile()`, which is whichever pilot is currently active - i.e. somebody
 * else - and its own comment said that must not happen. That was inert only
 * while the two lists could never fill: with `applyUnlocks` live it becomes a
 * younger sibling inheriting an older one's hulls on their first ever screen,
 * which is the one thing a per-profile reward must not do.
 *
 * Matches `blankProfile`'s grant by construction (asserted in
 * `tests/unit/unlocks/unlocks.test.ts`), so the tiles a pilot sees while being
 * created are the ones they will hold a second later.
 */
export function unlocksForNewPilot(): NewUnlocks {
  return { ships: [SHIP_UNLOCKS[0]?.id ?? "ship-1"], skins: [] };
}

/**
 * Apply this run's unlocks to a profile. Pure; the caller persists it.
 *
 * Returns the SAME object when nothing is new, so a caller can cheaply tell
 * whether anything happened and a store write can be skipped.
 *
 * Nothing is EQUIPPED here. `shipId` is the child's choice and a reward that
 * silently repaints their ship is a reward that took something away; the
 * livery follows from `unlockedSkins` on its own (`catalog.liveryFor`), which
 * is the one place that decides what a pilot is currently wearing.
 */
export function applyUnlocks(
  profile: Profile,
  stage: StageAward | null = null,
): Profile {
  const { ships, skins } = newUnlocks(profile, stage);
  if (ships.length === 0 && skins.length === 0) return profile;
  return {
    ...profile,
    unlockedShips: [...profile.unlockedShips, ...ships],
    unlockedSkins: [...profile.unlockedSkins, ...skins],
  };
}

// ---------------------------------------------------------------------------
// EQUIPPING (UR-48, coding-standards rule 2)
// ---------------------------------------------------------------------------

/**
 * ================== THE OTHER HALF OF THE DEFECT ==================
 *
 * Earning worked and equipping did not. `applyUnlocks` above genuinely grants
 * hulls at 1 / 3 / 5 / 7 beacons, and the ONLY writer of `profile.shipId`
 * anywhere in `src/` outside `blankProfile` / `decodeProfile` was
 * `ProfileCreateScene`, at creation time - where `unlocksForNewPilot()` grants
 * `ship-1` and locks the other three tiles. So `shipId` could only ever hold
 * `ship-1` for the life of a real save: ships 2, 3 and 4 were drawn,
 * catalogued, earnable and unwearable.
 *
 * That is coding-standards rule 2 in its purest form, and rule 2 names this
 * field by name. The reader seam was closed first (`scenes/lib/livery.ts`);
 * this is the WRITER seam, and without it the reader can only ever report
 * `ship-1`.
 *
 * ================== WHY THE GUARD IS HERE AND NOT IN THE ROW ==================
 * "A locked hull cannot be equipped by any input" is a property of the SAVE,
 * not of one screen's keyboard handling. A guard living inside the Settings row
 * would be re-implemented, or forgotten, by the second caller - which is how
 * `crossDrift` was lost and how keep-clear was lost twice. `equipShip` cannot
 * be called in a way that skips its own check: the refusal IS the return value.
 *
 * It reads `profile.unlockedShips` and nothing else. The THRESHOLD that fills
 * that list is `SHIP_UNLOCKS` above; this function has no access to a beacon
 * count and nowhere to put one, so an unlock rule cannot be duplicated here and
 * drift from the one the toast announced.
 */

/** True when this profile holds the hull, i.e. equipping it is allowed. */
export function canEquipShip(profile: Profile, shipId: string): boolean {
  return profile.unlockedShips.includes(shipId);
}

/**
 * Wear an earned hull. Pure; the caller persists it.
 *
 * Returns the SAME object when the hull is locked, unknown, or already being
 * worn - so a refusal and a no-op are one code path, a caller can cheaply tell
 * whether anything happened, and no store write is made for a press that
 * changed nothing.
 *
 * The skin is deliberately NOT touched. `catalog.liveryForShip` decides what a
 * hull is wearing from `unlockedSkins`, and a pilot who has earned the trim for
 * the hull they just equipped is wearing it the moment they equip it.
 */
export function equipShip(profile: Profile, shipId: string): Profile {
  if (!canEquipShip(profile, shipId)) return profile;
  if (profile.shipId === shipId) return profile;
  return { ...profile, shipId };
}
