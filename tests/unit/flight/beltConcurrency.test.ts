import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fallTimeMs } from "../../../src/engine/fallTime/index.js";
import { expectedClearMs } from "../../../src/engine/pacing/index.js";
import { DEFAULT_CALIBRATION, EASE_NEW, STOP_IDS } from "../../../src/engine/types.js";
import type { Calibration, StopId } from "../../../src/engine/types.js";
import { stagePoolFor } from "../../../src/game/flight/stage.js";

/**
 * HOW MANY WORDS CAN BE ON SCREEN AT ONCE - the arithmetic, not the opinion.
 *
 * ================== THE REPORT ==================
 * "I noticed that there is only one asteroid on the screen at once, there
 * should be more than one, does that happen after you get to harder levels?"
 *
 * The answer is no, it does not happen at harder levels, and this file is why.
 * It is not `maxLive`: `gauntlet/evidence/belt-survivability.json` records
 * `peakLive: 2` at maxLive 7 as well as at maxLive 2, over 40 seeds and three
 * player speeds, because `@engine/pacing` feeds one rock per rock's worth of
 * the player's own work and the cap is never the binding constraint.
 *
 * ================== THE BINDING CONSTRAINT ==================
 * A player is a single server (AC-2.1 gives every live word a distinct first
 * letter so the lock is unambiguous), so a second rock on the board is a rock
 * WAITING. It waits one service time - `expectedClearMs`, what this player is
 * expected to spend on the rock in hand - and only then gets attention, while
 * falling the whole time. So a second rock is answerable only if
 *
 *     fallTimeMs  >=  2 x expectedClearMs
 *
 * and in general the number of ANSWERABLE rocks a belt can carry is
 * floor(fall / service). Both sides are FR-8's own numbers, so this is a
 * property of the spec rather than of the spawner:
 *
 *     fall    = len x 1.5 x iki + 1200 x ease          (D19 / FR-8)
 *     service = max(fk, 1200 x ease) + (len-1) x iki + 300
 *
 * ================== WHAT THIS FILE CHECKS ==================
 * 1. THE BELT IS CLEARABLE: every word in every shipped pool has more fall time
 *    than it costs, at a fast, a median and a slow pilot. This is the check
 *    that the grade-2 stall (queue P0a) needed and did not have - it was found
 *    by simulating a whole belt, which is a much later and much noisier place
 *    to find it.
 * 2. THE HEADROOM IS RECORDED, so "only one asteroid on screen" is answered
 *    with a number and the day somebody widens FR-8's budget the number moves.
 */

const EVIDENCE_DIR = resolve(process.cwd(), "gauntlet/evidence");

/** A fast, a median and a slow pilot. The median is FR-8's own default. */
const PILOTS: ReadonlyArray<readonly [string, Calibration]> = [
  ["fast", { ikiMs: 260, fkLatencyMs: 380 }],
  ["median", DEFAULT_CALIBRATION],
  // The grade-2 model the independent playthrough used (queue P0a).
  ["grade2", { ikiMs: 600, fkLatencyMs: 700 }],
];

interface Row {
  readonly stop: StopId;
  readonly pilot: string;
  readonly word: string;
  readonly fallMs: number;
  readonly serviceMs: number;
  readonly ratio: number;
}

function measure(): Row[] {
  const rows: Row[] = [];
  for (const stop of STOP_IDS) {
    const pool = stagePoolFor(stop);
    for (const word of pool) {
      for (const [pilot, calibration] of PILOTS) {
        // EASE_NEW, because that is a word's ease the first time a child meets
        // it - the hardest a shipped word ever is, and the one the stall
        // happened on.
        const fallMs = fallTimeMs({ word, ease: EASE_NEW, calibration });
        const serviceMs = expectedClearMs({
          length: [...word].length,
          ease: EASE_NEW,
          calibration,
        });
        rows.push({ stop, pilot, word, fallMs, serviceMs, ratio: fallMs / serviceMs });
      }
    }
  }
  return rows;
}

describe("the belt's concurrency is set by FR-8, not by maxLive", () => {
  const rows = measure();

  it("measures something: every shipped stop with a pool is covered", () => {
    expect(rows.length).toBeGreaterThan(100);
    const stops = new Set(rows.map((r) => r.stop));
    // Earth is the launchpad and ships `pool: []` (D57), so six of seven.
    expect(stops.size).toBeGreaterThanOrEqual(6);
  });

  it("every word in every pool can be cleared before it lands, at every pilot speed", () => {
    for (const r of rows) {
      expect(
        r.fallMs,
        `${r.stop}/"${r.word}" falls in ${Math.round(r.fallMs)}ms and costs a ${r.pilot} pilot ${Math.round(r.serviceMs)}ms`,
      ).toBeGreaterThan(r.serviceMs);
    }
  });

  it("records how many rocks the belt could answer at once, and writes it down", () => {
    const worst = rows.reduce((a, b) => (a.ratio <= b.ratio ? a : b));
    const best = rows.reduce((a, b) => (a.ratio >= b.ratio ? a : b));
    const byPilot = PILOTS.map(([pilot]) => {
      const mine = rows.filter((r) => r.pilot === pilot);
      const mean = mine.reduce((s, r) => s + r.ratio, 0) / mine.length;
      return {
        pilot,
        meanRatio: Number(mean.toFixed(3)),
        minRatio: Number(Math.min(...mine.map((r) => r.ratio)).toFixed(3)),
        answerableAtOnce: Math.floor(Math.min(...mine.map((r) => r.ratio))),
      };
    });
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(
      join(EVIDENCE_DIR, "belt-concurrency.json"),
      `${JSON.stringify(
        {
          question: "why is only one word-asteroid on screen at once",
          rule: "answerable rocks = floor(fallTimeMs / expectedClearMs)",
          ease: EASE_NEW,
          byPilot,
          worst: { ...worst, ratio: Number(worst.ratio.toFixed(3)) },
          best: { ...best, ratio: Number(best.ratio.toFixed(3)) },
          note:
            "peakLive in belt-survivability.json is 2 at maxLive 2 AND at maxLive 7, so the cap is not what holds the board at one.",
          source: "tests/unit/flight/beltConcurrency.test.ts",
        },
        null,
        2,
      )}\n`,
    );
    // THE FINDING, ASSERTED SO IT CANNOT ROT: at the shipped budget no pilot
    // gets room for a second rock to WAIT a whole word and still be typed. If
    // this ever goes red it is because FR-8's budget widened, which is exactly
    // the change that would put a second answerable word on screen - so the
    // failure is the notification, not a regression.
    for (const p of byPilot) {
      expect(
        p.answerableAtOnce,
        `a ${p.pilot} pilot could now answer ${p.answerableAtOnce} rocks at once; FR-8's fall budget has changed`,
      ).toBe(1);
    }
  });
});
