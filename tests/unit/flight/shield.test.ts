import { describe, expect, it } from "vitest";
import {
  CANISTER_SPAWN_CHANCE,
  HULL_BASE_MARKS,
  HULL_BASE_SPAWNS,
  HULL_SPAWNS_PER_MARK,
  MIN_HULL,
  hullAfterShield,
  HULL_PASS_COST,
  hullAfterStrike,
  hullForStage,
  hullMarksLit,
  isStalled,
  maySpawnCanister,
  startingHull,
  survivableHitRate,
} from "@game/flight/shield.js";
import { hullLampLevel } from "@engine/hull/index.js";
import * as engineHull from "@engine/hull/index.js";
import { HULL_HITS_PER_STAGE, starsForHullHits } from "@engine/scoring/index.js";
import { DEFAULT_FLIGHT_CONFIG } from "@game/flight/stage.js";

/**
 * HULL AND THE SHIELD CANISTER - FR-4, FR-5; D17, D26, D27, D28, D29, D31.
 *
 * The rules now live in `src/engine/hull/` and `src/game/flight/shield.ts`
 * re-exports them, which is what finally puts them under the 95% coverage gate
 * - the audit's finding was that the file deciding when a child's run ends had
 * no test of any kind and no gate could see that.
 *
 * These are rules, so they are tested like rules: total, at the boundaries, and
 * for the properties the ACs actually claim rather than for the two happy
 * values. Nothing here is a failure count (D31, AC-22b.1) and no test asserts
 * one exists.
 */

describe("the shield seam", () => {
  it("re-exports the engine's rules rather than restating them", () => {
    // If this file ever grows a second implementation, the HUD and the star
    // rating can disagree about what a hull is without anything failing. That
    // is exactly how D27's 3 and D17's band drifted apart in the first place.
    expect(hullForStage).toBe(engineHull.hullForStage);
    expect(hullAfterStrike).toBe(engineHull.hullAfterStrike);
    expect(hullAfterShield).toBe(engineHull.hullAfterShield);
    expect(isStalled).toBe(engineHull.isStalled);
    expect(maySpawnCanister).toBe(engineHull.maySpawnCanister);
    expect(CANISTER_SPAWN_CHANCE).toBe(engineHull.CANISTER_SPAWN_CHANCE);
  });
});

describe("AC-5.1: `CANISTER_SPAWN_CHANCE` is the ONE number the repair rate is", () => {
  it("AC-5.1: the shipped chance is a half, and it is a probability", () => {
    // It was a literal `0.5` in `FlightScene.spawnRock` and a SECOND literal
    // `0.5` in the belt harness - two copies of the number the owner's "we have
    // the repair rocks so should be fine" argument rests on, and no way to tell
    // whether the game and the measurement of the game agreed. They do now by
    // construction; this pins the value so that moving it is a decision with a
    // red test in front of it rather than an edit in one of two files.
    //
    // WATCHED FAILING at `toBe(0.25)`:
    //   "expected 0.5 to be 0.25 // Object.is equality"
    expect(CANISTER_SPAWN_CHANCE).toBe(0.5);
    expect(CANISTER_SPAWN_CHANCE).toBeGreaterThan(0);
    expect(CANISTER_SPAWN_CHANCE).toBeLessThanOrEqual(1);
  });

  it("AC-5.1: it is a chance BEHIND the gate, not a rate per belt", () => {
    // Raising it can never hand a canister to a full hull or put two on the
    // board, because `maySpawnCanister` is asked first and it is the rule.
    // Measured consequence, in `tests/unit/simulation/hullThreeHits.test.ts`:
    // pushing this to 1.0 and allowing three live at once STILL does not make a
    // three-mark hull survivable for the grade-2 pilot.
    expect(maySpawnCanister(3, 3, false)).toBe(false);
    expect(maySpawnCanister(2, 3, true)).toBe(false);
  });
});

describe("hullForStage: D27 as a rate, so D17's band survives a longer belt", () => {
  it("D27 / AC-4.1: an 18-word stage is exactly three marks, unchanged", () => {
    // The whole point of expressing this as a rate is that it must reproduce
    // D27 term for term at the stage length D27 was written against. If this
    // row ever moves, the change stopped being a generalisation.
    expect(hullForStage(HULL_BASE_SPAWNS)).toBe(HULL_BASE_MARKS);
    expect(hullForStage(HULL_BASE_SPAWNS)).toBe(HULL_HITS_PER_STAGE);
  });

  it("C26 / D17: the shipped 58-word stage carries SIX marks", () => {
    // THE OWNER'S DECISION, as one row. C26 was logged unresolved with the rate
    // returning nine here; the owner picked six from the stall sweep in
    // `tests/unit/simulation/hullThreeHits.test.ts`, and six is also the
    // smallest hull D17's 90% ceiling allows at this belt length - which is why
    // `hullForStage` is that relation rather than this literal.
    //
    // WATCHED FAILING at `toBe(9)`: "expected 6 to be 9 // Object.is equality"
    expect(hullForStage(58)).toBe(6);
    expect(hullForStage(DEFAULT_FLIGHT_CONFIG.stageWordCount)).toBe(6);
  });

  it("C26: the hull is the SMALLEST whole hull D17's ceiling permits, at any length", () => {
    // THE RATE, STATED AS THE PROPERTY IT IS FOR rather than as its arithmetic.
    // `HULL_SPAWNS_PER_MARK` is ten because `1 - h/n <= 0.90` is `h >= n/10`,
    // so `ceil(n/10)` is the smallest hull D17 allows - and one mark LESS is
    // always outside the band. That second half is what stops this being a
    // tautology, and it is the reason five marks was not the answer at 58.
    //
    // WATCHED FAILING with `HULL_SPAWNS_PER_MARK` back at 6 (the old rate):
    //   "expected 6 to be 10 // Object.is equality" here, and
    //   "expected 10 to be 6 // Object.is equality" on the shipped row above,
    //   which is the old nine-mark hull arriving as ten at a rate of six."
    expect(HULL_SPAWNS_PER_MARK).toBe(10);
    for (let words = 31; words <= 200; words += 1) {
      const hull = hullForStage(words);
      expect(hull, `${words} words: not the smallest hull D17's ceiling requires`).toBe(
        Math.ceil(words / 10),
      );
      expect(
        survivableHitRate(words, hull - 1),
        `${words} words: ${hull - 1} marks would be inside the band too, so ${hull} is not minimal`,
      ).toBeGreaterThan(0.9);
    }
  });

  it("D17: the survivable hit rate lands INSIDE the 80-90% band, not above it", () => {
    // The defect, as one assertion. At three marks a 58-word stage demanded
    // 94.8%, which is four points clear of the top of D17's band - so the
    // controller could hold a child at the band's centre and the stage would
    // still end under them. The scaled hull puts the requirement back where
    // D17 and D27 were always meant to meet.
    const words = DEFAULT_FLIGHT_CONFIG.stageWordCount;
    const before = survivableHitRate(words, HULL_BASE_MARKS);
    const after = survivableHitRate(words);

    expect(before).toBeGreaterThan(0.9);
    expect(after).toBeGreaterThanOrEqual(0.8);
    expect(after).toBeLessThanOrEqual(0.9);
  });

  it("D17: the rate holds at every stage length, which is the actual claim", () => {
    // A fix that only works at 58 is another constant waiting to drift. The
    // relation has to hold wherever `stageWordCount` is next set.
    for (let words = HULL_BASE_SPAWNS; words <= 200; words += 1) {
      const rate = survivableHitRate(words);
      expect(rate, `${words} words`).toBeLessThanOrEqual(0.9);
    }
  });

  it("D27 / D31: never harsher than D27 wrote it, however short the stage", () => {
    for (const words of [0, 1, 6, 17]) {
      expect(hullForStage(words), `${words} words`).toBe(MIN_HULL);
    }
  });

  it("is monotonic in stage length: more flying is never less slack", () => {
    let previous = 0;
    for (let words = 0; words <= 300; words += 1) {
      const hull = hullForStage(words);
      expect(hull, `${words} words`).toBeGreaterThanOrEqual(previous);
      previous = hull;
    }
  });

  it("is total: junk stage lengths yield the D27 floor, never NaN marks", () => {
    expect(hullForStage(Number.NaN)).toBe(MIN_HULL);
    expect(hullForStage(Number.POSITIVE_INFINITY)).toBe(MIN_HULL);
    expect(hullForStage(-40)).toBe(MIN_HULL);
    expect(hullForStage(58.9)).toBe(6);
  });

  it("AC-4.1 / D27: every stage starts at its own full hull", () => {
    expect(startingHull(18)).toBe(3);
    expect(startingHull(58)).toBe(6);
  });

  it("survivableHitRate is total, and a stage of nothing is survivable", () => {
    expect(survivableHitRate(0)).toBe(1);
    expect(survivableHitRate(Number.NaN)).toBe(1);
    expect(survivableHitRate(10, 40)).toBe(0);
  });
});

describe("hullAfterStrike (AC-4.2)", () => {
  it("AC-4.2: a rock crossing the breach line costs exactly one", () => {
    expect(hullAfterStrike(3, 3)).toBe(2);
    expect(hullAfterStrike(2, 3)).toBe(1);
    expect(hullAfterStrike(1, 3)).toBe(0);
    expect(hullAfterStrike(9, 9)).toBe(8);
  });

  it("AC-4.2: it never goes below zero, however many strikes land", () => {
    // The stall card takes a frame or two to appear (FlightScene sinks the ship
    // for ~2.4 s first), and rocks already past the ship still resolve in that
    // window. A negative hull would draw as negative HUD marks.
    expect(hullAfterStrike(0, 3)).toBe(0);
    expect(hullAfterStrike(-5, 3)).toBe(0);
  });

  it("clamps a hull above the stage's maximum before spending from it", () => {
    // A persisted or mis-passed value must not buy extra lives by arithmetic.
    expect(hullAfterStrike(99, 3)).toBe(2);
    expect(hullAfterStrike(99, 9)).toBe(8);
  });

  it("propagates a fractional hull rather than flooring it (UR-91)", () => {
    // THIS ASSERTION IS INVERTED ON PURPOSE. It used to read "floors a
    // fractional hull rather than propagating it" and expect 1 from 2.9, which
    // was right while every cost was a whole mark. Half marks exist now - a
    // rock that passes the ship takes `HULL_PASS_COST` - and flooring the
    // RUNNING value would throw two of them away entirely, so a child could
    // miss forever at no cost. The rounding happens once, in `hullMarksLit`,
    // where the hull is drawn.
    //
    // WATCHED FAILING, with the floor restored: expected 1 to be 1.9
    expect(hullAfterStrike(2.9, 3)).toBe(1.9);
    // Two passes cost one whole mark between them, which is the rule.
    const afterOne = hullAfterStrike(3, 3, HULL_PASS_COST);
    expect(afterOne).toBe(2.5);
    expect(hullAfterStrike(afterOne, 3, HULL_PASS_COST)).toBe(2);
    // And a pass can empty a hull that a strike would have emptied too, so
    // there is no state where a child is alive on a hull of zero.
    expect(hullAfterStrike(0.5, 3, HULL_PASS_COST)).toBe(0);
  });

  it("is monotonically non-increasing across its whole domain", () => {
    for (const cap of [3, 9]) {
      for (let hull = -2; hull <= cap + 3; hull += 1) {
        expect(hullAfterStrike(hull, cap)).toBeLessThanOrEqual(hullMarksLit(hull, cap));
      }
    }
  });
});

describe("hullAfterShield (AC-5.2, D26)", () => {
  it("AC-5.2: blasting a canister restores exactly one mark", () => {
    expect(hullAfterShield(0, 3)).toBe(1);
    expect(hullAfterShield(1, 3)).toBe(2);
    expect(hullAfterShield(2, 3)).toBe(3);
    expect(hullAfterShield(5, 9)).toBe(6);
  });

  it("AC-5.2: the repair is capped at the stage's hull - never an overfill", () => {
    expect(hullAfterShield(3, 3)).toBe(3);
    expect(hullAfterShield(10, 3)).toBe(3);
    expect(hullAfterShield(9, 9)).toBe(9);
  });

  it("never returns less than one, even from a corrupt negative hull", () => {
    expect(hullAfterShield(-4, 3)).toBe(1);
  });

  it("a strike then a repair returns the hull it started at, mid-range", () => {
    for (const cap of [3, 9]) {
      for (let hull = 1; hull <= cap; hull += 1) {
        expect(hullAfterShield(hullAfterStrike(hull, cap), cap)).toBe(hull);
      }
    }
  });

  it("a zero-mark stage cannot be repaired into existence", () => {
    expect(hullAfterShield(0, 0)).toBe(0);
  });

  it("AC-5.2: ONE mark, on a fractional hull too - it no longer rounds up first", () => {
    // THE BUG THIS FIXES. `hullAfterShield` used to call `hullMarksLit` - which
    // CEILS - before adding one, so a hull standing at 1.5 (one strike and one
    // pass-by, UR-91) came back at 3 and the canister had paid 1.5 marks
    // against an AC that writes 1. Every whole-number hull was exact, which is
    // why the over-payment shipped with a green suite: the only hulls it could
    // reach are the halves `HULL_PASS_COST` creates, and nothing asserted one.
    //
    // WATCHED FAILING against the old implementation (ceil, then add):
    //   "expected 3 to be 2.5 // Object.is equality"
    expect(hullAfterShield(1.5, 6)).toBe(2.5);
    expect(hullAfterShield(0.5, 6)).toBe(1.5);
    expect(hullAfterShield(5.5, 6)).toBe(6);
    // The cap is the ONLY thing that may make a repair worth less than one.
    expect(hullAfterShield(5.5, 6) - 5.5).toBeLessThan(1);
  });

  it("AC-5.2: a canister is worth exactly one mark from every hull it can reach", () => {
    // Stated as the property rather than as four rows, because the defect was
    // in a case nobody had written a row for. Halves are the only fractions the
    // hull can hold: `HULL_STRIKE_COST` is 1 and `HULL_PASS_COST` is 0.5.
    //
    // WATCHED FAILING against the old implementation:
    //   "a repair at hull 0.5 of 3 returned 1.5 marks, not AC-5.2's one:
    //    expected 1.5 to be 1 // Object.is equality"
    for (const cap of [3, 6, 9]) {
      for (let hull = 0; hull <= cap - 1; hull += 0.5) {
        const given = hullAfterShield(hull, cap) - hull;
        expect(
          given,
          `a repair at hull ${hull} of ${cap} returned ${given} marks, not AC-5.2's one`,
        ).toBe(1);
      }
    }
  });
});

describe("C26 / UR-91: what HULL_PASS_COST does at a six-mark hull", () => {
  it("a pass-by is a TWELFTH of the shipped ship, and neither surface shows it", () => {
    // NOT A CHANGE, A MEASUREMENT. Both damage surfaces read `hullMarksLit`,
    // which ceils, so half-mark damage moves neither of them: the Lantern holds
    // its light (UR-22 made that the primary surface) and `maySpawnCanister`
    // refuses a repair rock over a ship that has just been hit. At nine marks a
    // pass-by was an eighteenth of the ship; at six it is a twelfth, and this
    // pins the size so that changing the hull again cannot move it silently.
    //
    // Whether a near miss SHOULD dim the Lantern is a feel decision and it is
    // the owner's - options, route numbers and a lean are in
    // `gauntlet/escalations.md`. If it is ever changed, this goes red and takes
    // the escalation with it.
    //
    // WATCHED FAILING with the lamp reading the raw hull instead of
    // `hullMarksLit`:
    //   "expected 0.9349999999999999 to be 1 // Object.is equality"
    const cap = hullForStage(DEFAULT_FLIGHT_CONFIG.stageWordCount);
    const afterPass = hullAfterStrike(cap, cap, HULL_PASS_COST);
    expect(cap - afterPass).toBe(HULL_PASS_COST);
    expect(HULL_PASS_COST / cap).toBeCloseTo(1 / 12, 10);
    // The Lantern does not move.
    expect(hullLampLevel(afterPass, cap)).toBe(hullLampLevel(cap, cap));
    // And no repair window opens.
    expect(maySpawnCanister(afterPass, cap, false)).toBe(false);
    // A whole strike does both, which is what makes the above a rounding rather
    // than a missing feature.
    const afterStrike = hullAfterStrike(cap, cap);
    expect(hullLampLevel(afterStrike, cap)).toBeLessThan(hullLampLevel(cap, cap));
    expect(maySpawnCanister(afterStrike, cap, false)).toBe(true);
  });
});

describe("isStalled (AC-4.3, D29)", () => {
  it("AC-4.3: an empty hull stalls the stage", () => {
    expect(isStalled(0)).toBe(true);
  });

  it("AC-4.3: any remaining mark keeps the ship flying", () => {
    for (const hull of [1, 2, 3, 8, 9]) expect(isStalled(hull)).toBe(false);
  });

  it("treats a negative or non-finite hull as stalled, never as not-yet", () => {
    expect(isStalled(-1)).toBe(true);
    expect(isStalled(Number.NaN)).toBe(true);
  });
});

describe("hullMarksLit (HUD, D31/AC-22b.1)", () => {
  it("lights one mark per remaining hit", () => {
    expect(hullMarksLit(0, 3)).toBe(0);
    expect(hullMarksLit(1, 3)).toBe(1);
    expect(hullMarksLit(3, 3)).toBe(3);
    expect(hullMarksLit(7, 9)).toBe(7);
  });

  it("is clamped to [0, maxHull] so the HUD can never draw a negative count", () => {
    expect(hullMarksLit(-3, 3)).toBe(0);
    expect(hullMarksLit(99, 3)).toBe(3);
    expect(hullMarksLit(99, 9)).toBe(9);
    expect(hullMarksLit(Number.NaN, 9)).toBe(0);
  });

  it("counts what REMAINS, never what was lost", () => {
    // D31: nothing in the surface may read as a penalty. The function the HUD
    // calls returns marks still lit; there is no `hullMarksLost` to draw.
    expect(hullMarksLit(2, 3)).toBe(2);
    expect(3 - hullMarksLit(2, 3)).toBe(1); // only the test may subtract
  });
});

describe("maySpawnCanister (AC-5.1)", () => {
  it("AC-5.1: no canister while the hull is full - there is nothing to repair", () => {
    expect(maySpawnCanister(3, 3, false)).toBe(false);
    expect(maySpawnCanister(9, 9, false)).toBe(false);
  });

  it("AC-5.1: a damaged hull may spawn one, at either stage length", () => {
    expect(maySpawnCanister(2, 3, false)).toBe(true);
    expect(maySpawnCanister(0, 3, false)).toBe(true);
    expect(maySpawnCanister(8, 9, false)).toBe(true);
  });

  it("AC-5.1: only ever one canister live at a time", () => {
    for (const hull of [0, 1, 2, 3]) {
      expect(maySpawnCanister(hull, 3, true)).toBe(false);
    }
  });

  it("decides WHETHER, never WHAT: it takes no pool and returns no word", () => {
    // selection/ owns which word rides the canister. This signature is the
    // guarantee that the canister cannot smuggle in an unallowlisted word: hull,
    // hull capacity, and whether one is already live. No content anywhere in it.
    expect(maySpawnCanister.length).toBe(3);
  });

  it("an over-full hull is still treated as full", () => {
    expect(maySpawnCanister(99, 3, false)).toBe(false);
  });
});

describe("AC-4.4: the star rating rides the stage's own hull", () => {
  it("AC-4.4: at three marks it is D27's table, term for term", () => {
    expect(starsForHullHits(0, 3)).toBe(3);
    expect(starsForHullHits(1, 3)).toBe(2);
    expect(starsForHullHits(2, 3)).toBe(1);
    expect(starsForHullHits(3, 3)).toBe(0);
  });

  it("AC-4.4 / D29: a CLEARED stage can never come back with no rating", () => {
    // The trap the scaled hull sets: read literally, "3 hits = 0 stars" would
    // tell a child who cleared a nine-mark belt with three marks gone that they
    // did not clear it. 0 means "stalled", and only a stall may produce it.
    const cap = hullForStage(DEFAULT_FLIGHT_CONFIG.stageWordCount);
    for (let hits = 0; hits < cap; hits += 1) {
      expect(starsForHullHits(hits, cap), `${hits} of ${cap}`).toBeGreaterThan(0);
    }
    expect(starsForHullHits(cap, cap)).toBe(0);
  });

  it("AC-4.4: the bands are thirds of the hull, best first", () => {
    expect(starsForHullHits(1, 9)).toBe(2);
    expect(starsForHullHits(3, 9)).toBe(2);
    expect(starsForHullHits(4, 9)).toBe(1);
    expect(starsForHullHits(8, 9)).toBe(1);
  });

  it("is monotonically non-increasing in hits, at every hull size", () => {
    for (const cap of [3, 6, 9, 12]) {
      let previous = 3;
      for (let hits = 0; hits < cap; hits += 1) {
        const stars = starsForHullHits(hits, cap);
        expect(stars, `${hits} of ${cap}`).toBeLessThanOrEqual(previous);
        previous = stars;
      }
    }
  });

  it("stays total on junk: a bad hull size rates nothing rather than everything", () => {
    expect(starsForHullHits(1, 0)).toBe(0);
    expect(starsForHullHits(1, Number.NaN)).toBe(2);
    expect(starsForHullHits(Number.NaN, 9)).toBe(0);
  });
});
