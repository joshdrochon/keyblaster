import { describe, expect, it } from "vitest";
import { DEFAULT_FLIGHT_CONFIG, flightConfigFrom } from "@game/flight/stage.js";
import { STOP_IDS, stageIndexOf, type StopId } from "@engine/types.js";
import { applyToBook, blankRecord, isEligible } from "@engine/words/index.js";

/**
 * AC-9.3 / D23 — THE BELT KNOWS WHERE IT IS ON THE ROUTE.
 *
 * `FlightConfig.stage` is the clock D23's spacing runs on: `nextEligibleStage`
 * is written as "current stage + 1, 2 or 4" and `isEligible` refuses a word
 * until the route has moved that far.
 *
 * NOTHING ON THE REAL PATH EVER SET IT. `PreflightScene` hands Flight a
 * `StoryInit`, which has no `stage` field, so every belt in the shipped game
 * ran at `DEFAULT_FLIGHT_CONFIG.stage`, which is 1 - Mars - whichever stop the
 * player was actually at.
 *
 * That was invisible only because the word book was thrown away at stage end:
 * `nextEligibleStage` never survived long enough to be compared against
 * anything. Now that the book persists it is the difference between a schedule
 * and a word that is refused for ever, which is what the second test measures.
 */

describe("AC-9.3: a belt's stage index comes from the stop it is flying", () => {
  it("AC-9.3: every stop gets its own route position, not Mars'", () => {
    for (const stopId of STOP_IDS) {
      expect(flightConfigFrom({ stopId }).stage).toBe(stageIndexOf(stopId));
    }
    // The old behaviour, for contrast: one number for the whole route.
    expect(new Set(STOP_IDS.map((s) => stageIndexOf(s))).size).toBe(STOP_IDS.length);
  });

  it("AC-9.3: an explicit stage still wins, and the shipped default is unchanged", () => {
    expect(flightConfigFrom({ stopId: "pluto", stage: 0 }).stage).toBe(0);
    // Every existing caller passes a stopId or nothing; Mars is stage 1, which
    // is what `DEFAULT_FLIGHT_CONFIG` has always said.
    expect(flightConfigFrom().stage).toBe(DEFAULT_FLIGHT_CONFIG.stage);
    expect(flightConfigFrom().stage).toBe(stageIndexOf(DEFAULT_FLIGHT_CONFIG.stopId));
  });

  it("D23: a pinned stage index would refuse a remembered word for ever", () => {
    // The consequence, stated as arithmetic rather than as a worry. A word
    // answered well at Mars (stage 1) is scheduled past stage 2.
    const stage = flightConfigFrom({ stopId: "mars" }).stage;
    const book = applyToBook({}, "rock", {
      kind: "hit",
      fkLatencyMs: 300,
      ikiMs: [200, 200],
      atMs: 0,
      stage,
    });
    const record = book["rock"] ?? blankRecord();
    expect(record.nextEligibleStage).toBeGreaterThan(stage);

    // At Jupiter's real index the schedule comes due. Pinned at Mars' index it
    // never does, and the word is unreachable through the eligible rung for the
    // whole rest of the route.
    const jupiter: StopId = "jupiter";
    expect(isEligible(record, stage, flightConfigFrom({ stopId: jupiter }).stage)).toBe(true);
    expect(isEligible(record, stage, stage)).toBe(false);
  });
});
