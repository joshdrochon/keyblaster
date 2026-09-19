import { describe, expect, it } from "vitest";
import { calibrationOf, mulberry32, simulateBelt, type SimPlayer } from "./flight.js";
import { HULL_PASS_COST, HULL_STRIKE_COST } from "@engine/hull/index.js";
import {
  DEFAULT_FLIGHT_CONFIG,
  retentionPoolFor,
  stagePoolFor,
} from "@game/flight/stage.js";

/**
 * UR-91 / C20: THE HARNESS CHARGES WHAT THE SCENE CHARGES FOR A ROCK THAT
 * SAILS PAST THE SHIP.
 *
 * ================== THE DEFECT THIS FILE EXISTS FOR ==================
 * `FlightScene.passBy` charges `HULL_PASS_COST` - half a mark - for a practice
 * rock reaching the bottom. The belt simulation charged NOTHING, and its doc
 * comment still stated the superseded "costs nothing" rule that UR-91 replaced.
 *
 * That is not a cosmetic disagreement. Practice rocks are not rare on a belt
 * going badly: once a child misses a few words, D23 brings them straight back,
 * so most of what is falling is practice. Every hull figure in
 * `tests/unit/simulation/` was therefore optimistic by half a mark per practice
 * pass-by - for the slow pilot at Pluto, about 10 marks over one belt, on a
 * hull of 9. A route proved survivable against that harness was proved against
 * a game nobody ships.
 *
 * ================== WHY IT IS ASSERTED AS AN IDENTITY ==================
 * Not "the hull is lower than it was", which is a statement about a number
 * somebody wrote down, but the whole hull ledger for a belt:
 *
 *     hull = maxHull - HULL_PASS_COST x passedBy
 *                    - HULL_STRIKE_COST x (breaches - passedBy)
 *
 * Canisters are off by default, nesting is off, and the belt is
 * flown to a pilot slow enough to miss words and therefore to meet them again
 * as practice. So every term above is accounted for and the identity is exact.
 *
 * ================== WATCHED FAILING ==================
 * Against the harness before the fix (`if (passes) passedBy += 1;` and no
 * charge at all), with the numbers it printed:
 *
 *   AssertionError: seed 2: 2 pass-bys, 6 breaches, hull 5 of 9
 *     expected 5 to be 4
 *   AssertionError: seed 3: 3 pass-bys, 6 breaches, hull 6 of 9
 *     expected 6 to be 4.5
 *
 * Half a mark per pass-by, every time, in the direction that flatters the
 * belt.
 */

const GRADE2: SimPlayer = {
  accuracy: 0.82,
  ikiMs: 600,
  fkLatencyMs: 700,
  coldRecognitionMs: 2400,
};

const WORDS = DEFAULT_FLIGHT_CONFIG.stageWordCount;

interface Ledger {
  seed: number;
  passedBy: number;
  breaches: number;
  hull: number;
  maxHull: number;
  stalled: boolean;
}

/**
 * JUPITER, AND NOT MARS, FOR THE ONLY REASON THAT MATTERS HERE: a practice
 * rock is a word COMING BACK (D21, D23), and at the first stop there is
 * nothing to come back. Jupiter is the earliest belt that carries Mars's words
 * in its retention pool, so it is the earliest belt on which the event under
 * test can happen at all. Nesting is off because it cannot fire before
 * Neptune anyway, and leaving it on would put a second hull cost in a ledger
 * this test wants to read one term at a time.
 */
function flyJupiter(seed: number): Ledger {
  const result = simulateBelt(
    {
      stopIndex: 2,
      stopId: "jupiter",
      stagePool: stagePoolFor("jupiter"),
      retentionPool: retentionPoolFor(["mars"]),
      spawnCount: WORDS,
      calibration: calibrationOf(GRADE2),
      nested: false,
    },
    GRADE2,
    {},
    mulberry32(seed),
  );
  return {
    seed,
    passedBy: result.passedBy,
    breaches: result.breaches,
    hull: result.hull,
    maxHull: result.maxHull,
    stalled: result.stalled,
  };
}

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
const LEDGERS = SEEDS.map(flyJupiter);

describe("UR-91 / C20: the harness charges the scene's cost for a pass-by", () => {
  it("is not vacuous - practice rocks really did reach the bottom", () => {
    // A belt with no pass-by proves nothing about what a pass-by costs, and
    // this is the assertion that keeps the identity below from being true by
    // arithmetic on two zeroes.
    const total = LEDGERS.reduce((n, l) => n + l.passedBy, 0);
    expect(
      total,
      `no practice rock passed the ship over ${LEDGERS.length} belts`,
    ).toBeGreaterThan(0);
  });

  it("UR-91: a practice pass-by costs HULL_PASS_COST, exactly as FlightScene.passBy does", () => {
    for (const l of LEDGERS) {
      // A stalled belt stops mid-flight, so its counters are a prefix of the
      // belt rather than the whole of it and the ledger below does not close.
      if (l.stalled) continue;
      const expectedHull = Math.max(
        0,
        l.maxHull -
          HULL_PASS_COST * l.passedBy -
          HULL_STRIKE_COST * (l.breaches - l.passedBy),
      );
      expect(
        l.hull,
        `seed ${l.seed}: ${l.passedBy} pass-bys, ${l.breaches} breaches, ` +
          `hull ${l.hull} of ${l.maxHull}`,
      ).toBe(expectedHull);
    }
  });

  it("UR-91: and half a mark, not a whole one - the near miss is still not a hit", () => {
    // The other direction. Charging `HULL_STRIKE_COST` here would also make the
    // harness pessimistic rather than optimistic, and C20's whole point is that
    // the two events are not the same one.
    expect(HULL_PASS_COST).toBe(HULL_STRIKE_COST / 2);
  });
});
