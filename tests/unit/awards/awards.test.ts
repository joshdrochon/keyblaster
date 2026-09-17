import { describe, expect, it } from "vitest";
import {
  CHAIN_TROPHIES,
  MAIN_BELT_STOP,
  STEADY_HULL_RUN,
  awardTrophies,
  newTrophies,
  satisfiedTrophies,
  steadyHullRun,
  type StageAward,
} from "@engine/awards/index.js";
import {
  BELT_STOP_IDS,
  DEFAULT_CALIBRATION,
  DEFAULT_SETTINGS,
  STOP_IDS,
  type Profile,
  type StopId,
} from "@engine/types.js";
import { blankStopProgress, clearStopOnProfile } from "@engine/progress/index.js";
import {
  computeStageResults,
  type StageTally,
  type WordExposure,
} from "@engine/scoring/index.js";
import { hullForStage } from "@engine/hull/index.js";
import { TROPHIES } from "@game/ui/catalog.js";

/**
 * D80 / AC-6d.1c / AC-6d.2 - TROPHIES CAN NOW BE EARNED.
 *
 * ================== WHY THIS FILE IS NEW ==================
 * Twelve trophies existed in the catalogue and the Beacon Log rendered all
 * twelve. Nothing in the entire source tree ever wrote to `profile.trophies`,
 * so every one of them was permanently unreachable.
 *
 * The suite was GREEN on that. Every trophy test put the trophy into a fixture
 * profile and then asserted the Log drew it - which tests the renderer and
 * assumes the feature. So the rule here is: no test in this file may hand a
 * profile a trophy. Each one drives the real path - a stage result, a clear, a
 * combo - and asserts the trophy came out the other end.
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
  return {
    id: "p1",
    name: "Ada",
    avatar: "avatar-1",
    shipId: "ship-1",
    shipName: "Lantern",
    createdAt: 0,
    calibration: { ...DEFAULT_CALIBRATION },
    settings: { ...DEFAULT_SETTINGS },
    progress: STOP_IDS.map(blankStopProgress),
    trophies: [],
    unlockedShips: [],
    unlockedSkins: [],
    words: {},
  };
}

const stage = (over: Partial<StageAward> = {}): StageAward => ({
  stopId: MAIN_BELT_STOP,
  stars: 3,
  bestCombo: 0,
  sharedPrefixStage: false,
  retentionAllRecalled: null,
  ...over,
});

/**
 * Fly a stop the way the game does: compute the stage result from a tally, then
 * write the clear onto the profile, then award. No trophy is ever written by a
 * test; only by `awardTrophies`.
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
  return awardTrophies(cleared, stage({ stopId, stars: results.stars, ...options.award }));
}

describe("AC-6d.1c: every trophy in the catalogue is reachable by playing", () => {
  it("THE DEFECT: a fresh profile holds none, and playing changes that", () => {
    const fresh = freshProfile();
    expect(fresh.trophies).toEqual([]);
    const played = playStop(fresh, "earth");
    expect(played.trophies.length).toBeGreaterThan(0);
  });

  it("AC-6d.1c: all twelve catalogue ids can be reached, none orphaned", () => {
    // Walks the whole route at three stars with a long chain and a full
    // retention set, and asserts the union covers the catalogue exactly. An id
    // in `catalog.ts` with no rule here would be a trophy drawn on a screen
    // that nothing can grant - which is the bug this file exists for, one
    // trophy at a time.
    let profile = freshProfile();
    for (const stopId of STOP_IDS) {
      profile = playStop(profile, stopId, {
        award: {
          bestCombo: 50,
          sharedPrefixStage: true,
          retentionAllRecalled: stopId === "earth" ? null : true,
        },
      });
    }
    const earned = new Set(profile.trophies);
    const defined = TROPHIES.map((t) => t.id);
    for (const id of defined) {
      expect(earned.has(id), `${id} is in the catalogue but nothing awards it`).toBe(true);
    }
    // And nothing is awarded that the catalogue does not define.
    for (const id of earned) {
      expect(defined, `${id} was awarded but is not in the catalogue`).toContain(id);
    }
  });

  it("D80: First Light comes from lighting Earth, and only from that", () => {
    const fresh = freshProfile();
    expect(newTrophies(fresh, stage())).not.toContain("firstLight");
    expect(playStop(fresh, "earth").trophies).toContain("firstLight");
    // Clearing Mars alone does not light Earth.
    expect(playStop(fresh, "mars").trophies).not.toContain("firstLight");
  });

  it("D80: Pathfinder is the first beacon, whichever stop it is", () => {
    expect(playStop(freshProfile(), "mars").trophies).toContain("pathfinder");
  });

  it("D80: Belt Runner needs the main belt flown clean, not merely flown", () => {
    const scratched = playStop(freshProfile(), MAIN_BELT_STOP, { hullHits: 2 });
    expect(scratched.trophies).not.toContain("beltRunner");
    const clean = playStop(freshProfile(), MAIN_BELT_STOP, { hullHits: 0 });
    expect(clean.trophies).toContain("beltRunner");
  });

  it("D80: Ring Weaver and Dark Side are their own stops at three stars", () => {
    const saturn = playStop(freshProfile(), "saturn");
    expect(saturn.trophies).toContain("ringWeaver");
    expect(saturn.trophies).not.toContain("darkSide");

    const uranus = playStop(freshProfile(), "uranus");
    expect(uranus.trophies).toContain("darkSide");
    expect(uranus.trophies).not.toContain("ringWeaver");

    const scratched = playStop(freshProfile(), "saturn", { hullHits: 1 });
    expect(scratched.trophies).not.toContain("ringWeaver");
  });

  it("AC-6c.1 / D80: the chain trophies come from the PEAK chain of the stage", () => {
    for (const { id, combo } of CHAIN_TROPHIES) {
      const under = playStop(freshProfile(), "mars", { award: { bestCombo: combo - 1 } });
      expect(under.trophies, `${id} at ${combo - 1}`).not.toContain(id);
      const exact = playStop(freshProfile(), "mars", { award: { bestCombo: combo } });
      expect(exact.trophies, `${id} at ${combo}`).toContain(id);
    }
  });

  it("D80: Sharp Eye needs the stage CLEARED, not just entered with the tier on", () => {
    const cleared = playStop(freshProfile(), "mars", { award: { sharedPrefixStage: true } });
    expect(cleared.trophies).toContain("sharpEye");
    const notCleared = newTrophies(
      freshProfile(),
      stage({ sharedPrefixStage: true, stars: 0 }),
    );
    expect(notCleared).not.toContain("sharpEye");
  });

  it("D80: Long Memory is not awarded for an EMPTY retention set", () => {
    // The trap: `[].every(...)` is true, so "recalled every word that came
    // back" would be trivially satisfied by a Mars belt, which has no earlier
    // stop to draw from. `null` is the distinction that stops it.
    const none = playStop(freshProfile(), "mars", { award: { retentionAllRecalled: null } });
    expect(none.trophies).not.toContain("longMemory");
    const missed = playStop(freshProfile(), "jupiter", {
      award: { retentionAllRecalled: false },
    });
    expect(missed.trophies).not.toContain("longMemory");
    const all = playStop(freshProfile(), "jupiter", { award: { retentionAllRecalled: true } });
    expect(all.trophies).toContain("longMemory");
  });

  it("D80: Map Maker needs all seven beacons, and Last Light needs Pluto", () => {
    let profile = freshProfile();
    for (const stopId of STOP_IDS.slice(0, -1)) profile = playStop(profile, stopId);
    expect(profile.trophies).not.toContain("mapMaker");
    expect(profile.trophies).not.toContain("lastLight");

    profile = playStop(profile, "pluto");
    expect(profile.trophies).toContain("mapMaker");
    expect(profile.trophies).toContain("lastLight");
  });

  it("D80: Steady Hull needs three clean stops IN A ROW", () => {
    // Clean, scratched, clean, clean: three clean stops but not three in a row
    // until the fourth lands, which is where the run of three completes.
    let profile = freshProfile();
    profile = playStop(profile, "mars");
    profile = playStop(profile, "jupiter", { hullHits: 1 });
    expect(profile.trophies).not.toContain("steadyHull");
    profile = playStop(profile, "saturn");
    expect(profile.trophies).not.toContain("steadyHull");
    profile = playStop(profile, "uranus");
    expect(profile.trophies).not.toContain("steadyHull");
    profile = playStop(profile, "neptune");
    expect(profile.trophies).toContain("steadyHull");
  });

  it("steadyHullRun counts along the route and needs the full run", () => {
    const progress = BELT_STOP_IDS.map((stopId) => ({
      ...blankStopProgress(stopId),
      stars: 3 as const,
    }));
    expect(steadyHullRun(progress)).toBe(true);
    expect(steadyHullRun(progress.slice(0, STEADY_HULL_RUN - 1))).toBe(false);
    expect(steadyHullRun([])).toBe(false);
    // Earth is not a belt stop, so a lit Earth cannot pad the run.
    expect(steadyHullRun([{ ...blankStopProgress("earth"), stars: 3 }])).toBe(false);
  });
});

describe("AC-6d.2: each trophy is awarded exactly once per profile", () => {
  it("replaying a stop earns nothing a second time", () => {
    const first = playStop(freshProfile(), "mars", { award: { bestCombo: 50 } });
    const before = [...first.trophies];
    const second = playStop(first, "mars", { award: { bestCombo: 50 } });
    expect(second.trophies).toEqual(before);
  });

  it("awardTrophies returns the SAME profile when nothing is new", () => {
    // So a caller can skip a store write, and so a no-op cannot churn the save.
    const played = playStop(freshProfile(), "mars");
    expect(awardTrophies(played, stage({ stopId: "mars" }))).toBe(played);
  });

  it("the list never gains a duplicate, even from a profile that already has one", () => {
    const seeded: Profile = { ...freshProfile(), trophies: ["pathfinder", "pathfinder"] };
    const played = playStop(seeded, "mars");
    expect(played.trophies.filter((t) => t === "pathfinder")).toHaveLength(2);
    expect(newTrophies(played, stage())).not.toContain("pathfinder");
  });

  it("the input profile is never mutated", () => {
    const fresh = freshProfile();
    awardTrophies(fresh, stage({ bestCombo: 50 }));
    expect(fresh.trophies).toEqual([]);
  });
});

describe("D74: what the trophy rules deliberately are NOT", () => {
  it("no trophy gates progress - a profile with none can finish the route", () => {
    // The strongest form of "informational, never controlling" that can be
    // written as a test: the route must not consult the trophy list at all.
    let profile: Profile = { ...freshProfile() };
    for (const stopId of STOP_IDS) {
      const played = playStop(profile, stopId);
      profile = { ...played, trophies: [] };
    }
    expect(profile.progress.every((p) => p.cleared)).toBe(true);
    expect(profile.trophies).toEqual([]);
  });

  it("every rule is mastery-contingent: no time, no attempts, no clock", () => {
    // `StageAward`'s shape is the guarantee. If a field ever appears here that
    // measures how LONG or HOW OFTEN rather than how well, D74 has been broken
    // in the type rather than in a rule somebody can read.
    expect(Object.keys(stage())).toEqual([
      "stopId",
      "stars",
      "bestCombo",
      "sharedPrefixStage",
      "retentionAllRecalled",
    ]);
  });

  it("satisfiedTrophies is a pure predicate: same profile, same answer", () => {
    const profile = playStop(freshProfile(), "saturn");
    const a = satisfiedTrophies(profile, stage({ stopId: "saturn" }));
    const b = satisfiedTrophies(profile, stage({ stopId: "saturn" }));
    expect(a).toEqual(b);
  });

  it("a profile with no stage behind it earns no stage-only trophy", () => {
    // A harness mounting the Results screen against a fixture must not be able
    // to mint a chain that nobody typed.
    const profile = playStop(freshProfile(), "mars");
    expect(satisfiedTrophies(profile, null)).not.toContain("chain25");
    expect(satisfiedTrophies(profile, null)).not.toContain("sharpEye");
  });
});
