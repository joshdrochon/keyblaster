import { describe, expect, it } from "vitest";
import {
  FIRST_THREE_STAR_SKIN,
  RETENTION_SKIN,
  SHIP_UNLOCKS,
  SKIN_CHAINS,
  applyUnlocks,
  beaconsLit,
  newUnlocks,
  satisfiedShips,
  satisfiedSkins,
  unlocksForNewPilot,
} from "@engine/unlocks/index.js";
import { CHAIN_TROPHIES, CLEAN_STAGE_STARS, type StageAward } from "@engine/awards/index.js";
import { STOP_IDS, type Profile, type StopId } from "@engine/types.js";
import { blankProfile } from "@engine/persistence/index.js";
import { clearStopOnProfile } from "@engine/progress/index.js";
import { computeStageResults, type StageTally, type WordExposure } from "@engine/scoring/index.js";
import { hullForStage } from "@engine/hull/index.js";
import { SHIPS, SKINS, liveryFor } from "@game/ui/catalog.js";
import { DEFAULT_FLIGHT_CONFIG, retentionPoolFor, stagePoolFor } from "@game/flight/stage.js";
import {
  calibrationOf,
  mulberry32,
  simulateBelt,
  type BeltResult,
  type SimPlayer,
} from "../simulation/flight.js";

/**
 * D73 / D79 / AC-6d.1 / AC-6d.1b — SHIPS AND SKINS CAN NOW BE UNLOCKED.
 *
 * ================== WHY THIS FILE IS NEW ==================
 * Four ships and four skins existed in the catalogue, `ProfileCreateScene` drew
 * all eight tiles with the sentence that earns each one, and `ProfilePickerScene`
 * re-coloured a pilot's card from whichever skin they held. Nothing in the
 * entire source tree ever added an id to `profile.unlockedShips` or
 * `profile.unlockedSkins`, so all eight were permanently unreachable and
 * `liveryFor` could only ever return the base hull.
 *
 * `tests/unit/catalog/unlocks.test.ts` asserted the THRESHOLDS and said so in
 * its own header: "config is all they are". This file is the other half, and it
 * takes the rule `tests/unit/awards/awards.test.ts` set for the identical
 * trophy defect:
 *
 *     NO TEST IN THIS FILE MAY PUT AN ID INTO `unlockedShips` OR
 *     `unlockedSkins`. Every one drives the real path - a stage result, a
 *     clear, a chain flown by a simulated child - and asserts the unlock came
 *     out the other end.
 *
 * Seeding the profile is exactly what let the trophy defect survive twelve
 * green tests, and a skin test that seeds the skin tests `Array.includes`.
 * ==========================================================
 */

const PLAY_TALLY: StageTally = {
  characters: 240,
  elapsedMs: 120_000,
  hits: 58,
  typos: 0,
  hullHits: 0,
  maxHull: hullForStage(58),
};

function freshProfile(): Profile {
  return blankProfile({ id: "p1", createdAt: 0, name: "Ada" });
}

const stage = (over: Partial<StageAward> = {}): StageAward => ({
  stopId: "mars",
  stars: 3,
  bestCombo: 0,
  sharedPrefixStage: false,
  retentionAllRecalled: null,
  ...over,
});

/**
 * Fly a stop the way the game does, in the order `ResultsScene.create` does it:
 * compute the stage result from a tally, write the clear onto the profile, THEN
 * unlock. The order is load-bearing - three of the four hulls are questions
 * about how many beacons are lit, and this stop's beacon is only recorded by
 * the clear.
 */
function playStop(
  profile: Profile,
  stopId: StopId,
  options: { hullHits?: number; award?: Partial<StageAward> } = {},
): Profile {
  const tally: StageTally = { ...PLAY_TALLY, hullHits: options.hullHits ?? 0 };
  const exposures: readonly WordExposure[] = [];
  const results = computeStageResults({ stopId, tally, exposures, profile });
  const cleared = clearStopOnProfile(profile, stopId, {
    atMs: 1_700_000_000_000,
    stars: results.stars,
    wpm: results.wpm,
    accuracy: results.accuracy,
  });
  return applyUnlocks(cleared, stage({ stopId, stars: results.stars, ...options.award }));
}

// ---------------------------------------------------------------------------
// The catalogue and the rules are one table in two files
// ---------------------------------------------------------------------------

describe("AC-6d.1b: every ship and skin in the catalogue can be reached", () => {
  it("THE DEFECT: a fresh pilot owns one hull and no trim, and playing changes that", () => {
    const fresh = freshProfile();
    expect(fresh.unlockedShips).toEqual(["ship-1"]);
    expect(fresh.unlockedSkins).toEqual([]);

    let profile = fresh;
    for (const stopId of STOP_IDS) profile = playStop(profile, stopId);
    expect(profile.unlockedShips.length).toBeGreaterThan(1);
    expect(profile.unlockedSkins).toContain(FIRST_THREE_STAR_SKIN);
  });

  it("AC-6d.1b: all eight catalogue ids are reachable, none orphaned", () => {
    // Walks the whole route at three stars with a 50 chain and a full retention
    // set, and asserts the union covers the catalogue exactly. An id in
    // `catalog.ts` with no rule in `@engine/unlocks` is a tile drawn on a
    // screen that nothing can ever open - which is the bug this file exists
    // for, one tile at a time.
    let profile = freshProfile();
    for (const stopId of STOP_IDS) {
      profile = playStop(profile, stopId, {
        award: { bestCombo: 50, retentionAllRecalled: stopId === "earth" ? null : true },
      });
    }
    const held = new Set([...profile.unlockedShips, ...profile.unlockedSkins]);
    const defined = [...SHIPS.map((s) => s.id), ...SKINS.map((s) => s.id)];
    for (const id of defined) {
      expect(held.has(id), `${id} is in the catalogue but nothing unlocks it`).toBe(true);
    }
    for (const id of held) {
      expect(defined, `${id} was unlocked but is not in the catalogue`).toContain(id);
    }
  });

  it("AC-6d.1b: the engine's ship thresholds are the catalogue's, id for id", () => {
    // The engine may not import the game layer, so the two tables are held
    // together here. A ship added to `catalog.ts` with no rule, or a threshold
    // moved in one file and not the other, fails this.
    expect(SHIP_UNLOCKS.map((s) => s.id)).toEqual(SHIPS.map((s) => s.id));
    expect(SHIP_UNLOCKS.map((s) => s.beacons)).toEqual(SHIPS.map((s) => s.unlockBeacons));
  });

  it("AC-6d.1b: the chain skins use the same numbers as the chain trophies", () => {
    // Chain 25 the trophy and the deep-blue trim are earned by ONE chain. Two
    // tables reading one run is how they come to disagree.
    expect(SKIN_CHAINS.map((s) => s.combo)).toEqual(CHAIN_TROPHIES.map((t) => t.combo));
  });

  it("AC-6d.1b: every skin id in the catalogue has a rule, and vice versa", () => {
    const ruled = [FIRST_THREE_STAR_SKIN, ...SKIN_CHAINS.map((s) => s.id), RETENTION_SKIN];
    expect([...ruled].sort()).toEqual(SKINS.map((s) => s.id).sort());
  });
});

// ---------------------------------------------------------------------------
// Ships: beacons, and only beacons
// ---------------------------------------------------------------------------

describe("AC-6d.1b: the four hulls open at 1, 3, 5 and 7 lit beacons", () => {
  it("AC-6d.1b: each hull opens on the beacon its own sentence names, and not before", () => {
    let profile = freshProfile();
    const openedAt = new Map<string, number>();
    for (const stopId of STOP_IDS) {
      const before = new Set(profile.unlockedShips);
      profile = playStop(profile, stopId);
      for (const id of profile.unlockedShips) {
        if (!before.has(id)) openedAt.set(id, beaconsLit(profile));
      }
    }
    for (const rule of SHIP_UNLOCKS.slice(1)) {
      expect(openedAt.get(rule.id), `${rule.id} never opened`).toBe(rule.beacons);
    }
  });

  it("AC-6d.1b: six lit beacons is not seven — the last hull waits for Pluto", () => {
    let profile = freshProfile();
    for (const stopId of STOP_IDS.slice(0, 6)) profile = playStop(profile, stopId);
    expect(beaconsLit(profile)).toBe(6);
    expect(profile.unlockedShips).not.toContain("ship-4");
    profile = playStop(profile, "pluto");
    expect(profile.unlockedShips).toContain("ship-4");
  });

  it("D13: a stop that was flown but never charted lights no beacon and opens no hull", () => {
    // `litCount` requires BOTH halves of a clear. A half-written record draws
    // as locked on the map, and it must not open a hull either.
    const profile = freshProfile();
    const halfCleared: Profile = {
      ...profile,
      progress: profile.progress.map((p) =>
        p.stopId === "earth" ? { ...p, cleared: true, beaconPlacedAt: null } : p,
      ),
    };
    expect(beaconsLit(halfCleared)).toBe(0);
    expect(satisfiedShips(halfCleared)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Skins: mastery, earned by flying a real belt
// ---------------------------------------------------------------------------

/** Three children, as `tests/unit/simulation/coreLoop.test.ts` models them. */
const CAREFUL: SimPlayer = {
  accuracy: 0.995,
  ikiMs: 300,
  fkLatencyMs: 450,
  coldRecognitionMs: 1200,
};
const SLOPPY: SimPlayer = {
  accuracy: 0.55,
  ikiMs: 700,
  fkLatencyMs: 900,
  coldRecognitionMs: 2600,
};

const ROUTE: StopId[] = [...STOP_IDS.slice(1)];

function flyBelt(
  stop: StopId,
  player: SimPlayer,
  seed: number,
  book = {},
): BeltResult {
  const index = ROUTE.indexOf(stop) + 1;
  return simulateBelt(
    {
      stopIndex: index,
      stagePool: stagePoolFor(stop),
      retentionPool: retentionPoolFor(ROUTE.slice(0, ROUTE.indexOf(stop))),
      spawnCount: DEFAULT_FLIGHT_CONFIG.stageWordCount,
      calibration: calibrationOf(player),
    },
    player,
    book,
    mulberry32(seed),
  );
}

/**
 * The longest unbroken run of blasted rocks, in the order the belt resolved
 * them - which is what `FlightScene.bestCombo` counts (`@engine/scoring/combo`
 * resets on a miss). Derived from what the belt DID, never declared.
 */
function longestChain(result: BeltResult): number {
  const resolved = [...result.spawns].sort((a, b) => a.clearedAtMs - b.clearedAtMs);
  let best = 0;
  let run = 0;
  for (const s of resolved) {
    run = s.hit ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

describe("AC-6d.1 / D73: skins are earned by flying, from mastery only", () => {
  it("AC-6d.1b: a careful child's real belt earns the 25 chain; a sloppy one's does not", () => {
    const careful = longestChain(flyBelt("mars", CAREFUL, 20260916));
    const sloppy = longestChain(flyBelt("mars", SLOPPY, 20260916));
    // The measurement, not an assumption: if the harness stops producing a
    // separation here the test below is measuring nothing.
    expect(careful, "the careful child never reached a 25 chain").toBeGreaterThanOrEqual(25);
    expect(sloppy, "the sloppy child reached a 25 chain anyway").toBeLessThan(25);

    const fresh = freshProfile();
    const earned = applyUnlocks(fresh, stage({ bestCombo: careful }));
    const not = applyUnlocks(fresh, stage({ bestCombo: sloppy }));
    expect(earned.unlockedSkins).toContain("skin-2");
    expect(not.unlockedSkins).not.toContain("skin-2");
  });

  it("AC-6d.1b: the 50 chain needs a longer run than the 25 chain does", () => {
    const fresh = freshProfile();
    expect(applyUnlocks(fresh, stage({ bestCombo: 49 })).unlockedSkins).not.toContain("skin-3");
    expect(applyUnlocks(fresh, stage({ bestCombo: 50 })).unlockedSkins).toContain("skin-3");
  });

  it("AC-6d.1b: the dawn trim needs a 3-star stop, and a scratched hull is not one", () => {
    const fresh = freshProfile();
    const perfect = playStop(fresh, "mars");
    expect(perfect.unlockedSkins).toContain(FIRST_THREE_STAR_SKIN);

    // Same belt, hull marks taken. `computeStageResults` rates it below three
    // stars and the trim stays shut.
    const scratched = playStop(fresh, "mars", { hullHits: hullForStage(58) - 1 });
    expect(scratched.progress.find((p) => p.stopId === "mars")?.stars).toBeLessThan(
      CLEAN_STAGE_STARS,
    );
    expect(scratched.unlockedSkins).not.toContain(FIRST_THREE_STAR_SKIN);
  });

  it("AC-6d.1b: the ember trim needs a retention set, and a belt with no retention words is not one", () => {
    const fresh = freshProfile();
    // A Mars belt has no earlier stop to draw from, so its retention set is
    // EMPTY - `null`, not `true`. "Recalled all zero of them" must not earn it.
    const mars = flyBelt("mars", CAREFUL, 7);
    expect(mars.spawns.some((s) => s.fromRetention)).toBe(false);
    expect(applyUnlocks(fresh, stage({ retentionAllRecalled: null })).unlockedSkins).not.toContain(
      RETENTION_SKIN,
    );

    // A later belt does bring words back, and recalling all of them earns it.
    let book = {};
    for (const stop of ROUTE.slice(0, 3)) book = flyBelt(stop, CAREFUL, 7, book).book;
    const saturn = flyBelt("saturn", CAREFUL, 7, book);
    const retention = saturn.spawns.filter((s) => s.fromRetention);
    expect(retention.length, "the selection engine brought nothing back").toBeGreaterThan(0);
    const allRecalled = retention.every((s) => s.hit);
    expect(
      applyUnlocks(fresh, stage({ retentionAllRecalled: allRecalled })).unlockedSkins.includes(
        RETENTION_SKIN,
      ),
    ).toBe(allRecalled);
  });

  it("AC-6d.1: no amount of playing unlocks a skin without mastery", () => {
    // The whole route, cleared, every beacon lit, every hull open - and a child
    // who never held a chain, never flew a clean stop and never recalled a set
    // holds no trim at all. There is no attendance path.
    let profile = freshProfile();
    for (const stopId of STOP_IDS) {
      profile = playStop(profile, stopId, {
        hullHits: hullForStage(58) - 1,
        award: { bestCombo: 24, retentionAllRecalled: false },
      });
    }
    expect(profile.unlockedShips).toEqual(SHIPS.map((s) => s.id));
    expect(profile.unlockedSkins).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Structure: once only, no equip, and the livery follows
// ---------------------------------------------------------------------------

describe("AC-6d.2: an unlock happens once, changes nothing else, and shows up", () => {
  it("AC-6d.2: replaying a stop unlocks nothing a second time", () => {
    const first = playStop(freshProfile(), "earth");
    const second = playStop(first, "earth");
    expect(second.unlockedShips).toEqual(first.unlockedShips);
    expect(second.unlockedSkins).toEqual(first.unlockedSkins);
    // Same object back when there is nothing new, so a store write is skippable.
    expect(applyUnlocks(first, stage({ stopId: "earth" }))).toBe(first);
  });

  it("D73: an unlock never equips anything or touches any other field", () => {
    const before = playStop(freshProfile(), "earth");
    const after = applyUnlocks(before, stage({ bestCombo: 50 }));
    expect(after.shipId).toBe(before.shipId);
    expect(after.shipName).toBe(before.shipName);
    expect(after.trophies).toBe(before.trophies);
    expect(after.progress).toBe(before.progress);
    expect(after.words).toBe(before.words);
  });

  it("D79: unlocking a trim is what re-colours the pilot's own ship", () => {
    // `liveryFor` is what `ProfilePickerScene` draws each pilot's card with. It
    // could only ever return the base hull, because nothing filled the list it
    // reads. This is the end of that wire.
    const fresh = freshProfile();
    expect(liveryFor(fresh)).toEqual(SHIPS[0]?.colors);
    const earned = applyUnlocks(playStop(fresh, "mars"), stage({ stars: 3 }));
    expect(earned.unlockedSkins).toContain("skin-1");
    expect(liveryFor(earned)).toEqual(SKINS[0]?.colors);
    expect(liveryFor(earned)).not.toEqual(SHIPS[0]?.colors);
  });

  it("AC-6d.1: `newUnlocks` reports only what is new, and `satisfiedSkins` only what is true", () => {
    const played = playStop(freshProfile(), "mars");
    expect(satisfiedSkins(played)).toContain(FIRST_THREE_STAR_SKIN);
    expect(newUnlocks(played).skins).toEqual([]);
    expect(newUnlocks(freshProfile(), stage({ bestCombo: 25 })).skins).toEqual(["skin-2"]);
  });

  it("D79: a pilot being created owns the starting hull and nothing anyone else earned", () => {
    // Unlocks are PER PROFILE. `ProfileCreateScene` used to draw its tiles from
    // `app.profile()` - whichever pilot is currently active, i.e. somebody
    // else - and its own comment said that must not happen. It was inert while
    // neither list could ever fill; the moment `applyUnlocks` went live it
    // became a younger sibling inheriting an older one's hulls.
    const starting = unlocksForNewPilot();
    expect(starting.ships).toEqual(blankProfile({ id: "x", createdAt: 0 }).unlockedShips);
    expect(starting.skins).toEqual([]);
    expect(starting.ships).toEqual([SHIPS[0]?.id]);

    // And it does not move when another pilot finishes the game.
    let veteran = freshProfile();
    for (const stopId of STOP_IDS) {
      veteran = playStop(veteran, stopId, { award: { bestCombo: 50 } });
    }
    expect(veteran.unlockedShips.length).toBe(SHIPS.length);
    expect(unlocksForNewPilot()).toEqual(starting);
  });

  it("AC-6d.1: outside a run, no stage-only trim is reachable at all", () => {
    let profile = freshProfile();
    for (const stopId of STOP_IDS) profile = playStop(profile, stopId);
    // Every beacon lit, every stop at three stars - and with no stage in hand
    // the chain and retention trims stay shut, because nothing persists a chain.
    expect(satisfiedSkins(profile, null)).toEqual([FIRST_THREE_STAR_SKIN]);
  });
});
