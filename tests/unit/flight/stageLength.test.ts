import { describe, expect, it } from "vitest";
import { DEFAULT_FLIGHT_CONFIG, stagePoolFor } from "../../../src/game/flight/stage.js";
import { DEFAULT_CALIBRATION, STOP_IDS } from "../../../src/engine/types.js";
import { MAX_LIVE_MAX, MAX_LIVE_MIN } from "../../../src/engine/controller/knobs.js";

/**
 * HOW LONG A BELT IS (FR-6, and a player saying "the level is too short").
 *
 * The yardstick is the decision log's Origin section: Type Storm ran three
 * waves plus a boss in 1.5-2.5 minutes. A belt has to land inside that or it
 * is not a level, it is a warm-up - which is what 18 words was.
 *
 * This test is the arithmetic, kept next to the number so the number cannot be
 * changed without the estimate being changed with it. It is a MODEL, not a
 * measurement: the real thing is measured by playing, and the model's only job
 * is to stop `stageWordCount` drifting back to a value nobody costed.
 */

/** The band, in seconds, a belt has to land inside. */
const TARGET_MIN_S = 90;
const TARGET_MAX_S = 150;

/**
 * Seconds a player of a given inter-key interval needs for one word.
 *
 * A belt is paced by the player, not by the spawner: `maxLive` lets several
 * rocks be in the air at once, but a child types them one at a time. So the
 * cost of a word is the first-key latency (finding it, reading it) plus the
 * remaining keystrokes, plus a little for choosing the next rock.
 */
function secondsPerWord(letters: number, ikiMs: number, fkLatencyMs: number): number {
  return (fkLatencyMs + (letters - 1) * ikiMs) / 1000 + 0.3;
}

function meanWordLength(): number {
  const pool = stagePoolFor("mars");
  return pool.reduce((n, w) => n + [...w].length, 0) / pool.length;
}

describe("FR-6: a belt is 90-150 seconds for a median grade 3-5 typist", () => {
  it("the shipped word count lands inside the band at the default calibration", () => {
    const perWord = secondsPerWord(
      meanWordLength(),
      DEFAULT_CALIBRATION.ikiMs,
      DEFAULT_CALIBRATION.fkLatencyMs,
    );
    const seconds = DEFAULT_FLIGHT_CONFIG.stageWordCount * perWord;
    expect(seconds).toBeGreaterThanOrEqual(TARGET_MIN_S);
    expect(seconds).toBeLessThanOrEqual(TARGET_MAX_S);
  });

  it("still lands inside the band for a quick child and for a slow one", () => {
    const letters = meanWordLength();
    // +/- 25% on the median inter-key interval either side of calibration.
    for (const iki of [DEFAULT_CALIBRATION.ikiMs * 0.75, DEFAULT_CALIBRATION.ikiMs * 1.25]) {
      const seconds =
        DEFAULT_FLIGHT_CONFIG.stageWordCount *
        secondsPerWord(letters, iki, DEFAULT_CALIBRATION.fkLatencyMs);
      expect(seconds, `iki ${iki}`).toBeGreaterThan(TARGET_MIN_S * 0.85);
      expect(seconds, `iki ${iki}`).toBeLessThan(TARGET_MAX_S * 1.1);
    }
  });

  it("the sky finishes travelling before the belt does (AC-22.3)", () => {
    // A sky whose travel is longer than the stage never arrives anywhere, which
    // is how a gradient shift can be true in a test and invisible in play.
    const perWord = secondsPerWord(
      meanWordLength(),
      DEFAULT_CALIBRATION.ikiMs,
      DEFAULT_CALIBRATION.fkLatencyMs,
    );
    const beltMs = DEFAULT_FLIGHT_CONFIG.stageWordCount * perWord * 1000;
    expect(DEFAULT_FLIGHT_CONFIG.stageDurationMs).toBeLessThan(beltMs);
  });

  it("length came from the COUNT, not from letting more rocks onto the board", () => {
    // AC-10.4 / FR-10: concurrency is the controller's knob and its range is
    // 2-7. Making a level longer by raising the ceiling would make it a wall
    // instead of a level, and it is not something this config can do at all -
    // `FlightConfig` has no maxLive, only `knobs`, which the controller owns.
    expect(MAX_LIVE_MIN).toBe(2);
    expect(MAX_LIVE_MAX).toBe(7);
    expect(Object.keys(DEFAULT_FLIGHT_CONFIG)).not.toContain("maxLive");
    expect(DEFAULT_FLIGHT_CONFIG.knobs).toEqual({});
  });

  it("every stop with a belt has enough words that 48 spawns is not one word twelve times", () => {
    for (const stop of STOP_IDS) {
      const pool = stagePoolFor(stop);
      // Earth is the launchpad and ships no belt (D57); its bundle is one
      // activation word, which is content and not a short pool.
      if (stop === "earth") continue;
      expect(pool.length, stop).toBeGreaterThanOrEqual(20);
    }
  });
});
