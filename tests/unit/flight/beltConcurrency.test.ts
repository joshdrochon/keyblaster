import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fallTimeMs } from "../../../src/engine/fallTime/index.js";
import { expectedClearMs } from "../../../src/engine/pacing/index.js";
import { DEFAULT_CALIBRATION, EASE_NEW, STOP_IDS } from "../../../src/engine/types.js";
import {
  CONCURRENCY_TARGET_MAX,
  MAX_LIVE_MAX,
  MAX_LIVE_MIN,
  concurrencyTarget,
} from "../../../src/engine/controller/knobs.js";
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
 *
 * ================== THAT DAY IS UR-51 ==================
 * The user took the decision UR-42 escalated: widen the budget so three or four
 * word-asteroids can be live at once, and make the difficulty controller
 * express the range rather than moving one global constant. So the budget is
 * now `concurrencyTarget(maxLive)` times FR-8's formula, and the number this
 * file records is a CURVE across the knob instead of a single figure.
 *
 * The old assertion - `answerableAtOnce === 1` for every pilot - has not been
 * relaxed, it has been moved to where it is still true and still load-bearing:
 * at `MAX_LIVE_MIN`, the floor a struggling child flies, it is exactly 1, and
 * every fall time there is byte-identical to the shipped one. What is new is
 * the other end: at `MAX_LIVE_MAX` it reaches 4 for every pilot.
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

function measure(maxLive: number = MAX_LIVE_MIN): Row[] {
  const rows: Row[] = [];
  for (const stop of STOP_IDS) {
    const pool = stagePoolFor(stop);
    for (const word of pool) {
      for (const [pilot, calibration] of PILOTS) {
        // EASE_NEW, because that is a word's ease the first time a child meets
        // it - the hardest a shipped word ever is, and the one the stall
        // happened on.
        //
        // The knob defaults to FR-10's floor, so `measure()` with no argument
        // is FR-8's shipped budget and the figures UR-42 recorded.
        const fallMs = fallTimeMs({ word, ease: EASE_NEW, calibration, knobs: { maxLive } });
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

  it("UR-51: records the answerable-rock curve across the whole knob, and writes it down", () => {
    const worst = rows.reduce((a, b) => (a.ratio <= b.ratio ? a : b));
    const best = rows.reduce((a, b) => (a.ratio >= b.ratio ? a : b));
    const summarise = (mine: readonly Row[]): {
      meanRatio: number;
      minRatio: number;
      answerableAtOnce: number;
    } => ({
      meanRatio: Number((mine.reduce((s, r) => s + r.ratio, 0) / mine.length).toFixed(3)),
      minRatio: Number(Math.min(...mine.map((r) => r.ratio)).toFixed(3)),
      answerableAtOnce: Math.floor(Math.min(...mine.map((r) => r.ratio))),
    });
    const byPilot = PILOTS.map(([pilot]) => ({
      pilot,
      ...summarise(rows.filter((r) => r.pilot === pilot)),
    }));
    const byKnob: Record<string, unknown> = {};
    for (let live = MAX_LIVE_MIN; live <= MAX_LIVE_MAX; live += 1) {
      byKnob[`maxLive${live}`] = {
        concurrencyTarget: Number(concurrencyTarget(live).toFixed(2)),
        pilots: PILOTS.map(([pilot]) => ({
          pilot,
          ...summarise(measure(live).filter((r) => r.pilot === pilot)),
        })),
      };
    }
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(
      join(EVIDENCE_DIR, "belt-concurrency.json"),
      `${JSON.stringify(
        {
          question: "why is only one word-asteroid on screen at once (UR-42), and what UR-51 changed",
          rule: "answerable rocks = floor(fallTimeMs / expectedClearMs)",
          ease: EASE_NEW,
          note:
            "byPilot is the knob's FLOOR (maxLive 2), which is FR-8's budget exactly and is unchanged: 1 answerable rock, the figure UR-42 recorded. byKnob is what the controller can now reach.",
          byPilot,
          byKnob,
          worst: { ...worst, ratio: Number(worst.ratio.toFixed(3)) },
          best: { ...best, ratio: Number(best.ratio.toFixed(3)) },
          source: "tests/unit/flight/beltConcurrency.test.ts",
        },
        null,
        2,
      )}\n`,
    );

    // THE FLOOR IS STILL THE FINDING, AND IT IS STILL ASSERTED. At the gentlest
    // knob setting no pilot gets room for a second rock to WAIT a whole word
    // and still be typed - which is FR-8's budget untouched, and which is the
    // belt the grade-2 child flies. This is the same assertion UR-42 wrote, at
    // the setting where it is still true; nothing has been relaxed.
    for (const p of byPilot) {
      expect(
        p.answerableAtOnce,
        `a ${p.pilot} pilot at the knob's floor could answer ${p.answerableAtOnce} rocks at once; FR-8's shipped budget has changed`,
      ).toBe(1);
    }

    // AND THE CEILING IS THE CHANGE. Watched failing first: with `knobs` left
    // off the call this reads 1 for all three pilots, which is the shipped
    // number and the whole of UR-42.
    for (const [pilot] of PILOTS) {
      const top = summarise(measure(MAX_LIVE_MAX).filter((r) => r.pilot === pilot));
      expect(
        top.answerableAtOnce,
        `a ${pilot} pilot at the knob's ceiling answers ${top.answerableAtOnce} rocks at once`,
      ).toBeGreaterThanOrEqual(CONCURRENCY_TARGET_MAX);
    }
  });
});
