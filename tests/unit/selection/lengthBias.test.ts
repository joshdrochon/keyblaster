import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LENGTH_BIAS_PIVOT,
  LENGTH_BIAS_SPAN,
  LENGTH_BIAS_STRENGTH,
  SELECTION_WEIGHT,
  biasedWeightOf,
  createSelectionState,
  lengthWeightFactor,
  pickNext,
  weightOf,
} from "@engine/selection/index.js";
import { DEFAULT_KNOBS, LENGTH_BIAS_MAX, LENGTH_BIAS_MIN } from "@engine/controller/knobs.js";
import { stagePoolFor } from "@game/flight/stage.js";
import { mulberry32 } from "./rng.js";
import { masteredRecord, unknownRecord } from "./fixtures.js";

/**
 * UR-79 / FR-10 / AC-10.4: THE SECONDARY KNOB NOW DOES SOMETHING.
 *
 * `lengthBias` is half of FR-10's knob set. The controller has always moved it
 * - `tightenStep` raises it BEFORE it touches `maxLive`, `loosenStep` drops it
 * to its floor first, persistence stores it, the schema repairs it - and
 * nothing read it. Before this change, `grep -rn lengthBias src/engine/selection`
 * returned nothing at all: the word a child saw was identical whether the
 * controller had tightened them to +1 or loosened them to -1.
 *
 * That was survivable while every pool was 26-32 words with a longest word of
 * seven, because there was barely a long end to bias towards. UR-79 widens the
 * pools to 40-46 with a real 2-to-8 letter spread, which is exactly what a mix
 * knob needs in order to have anything to say.
 *
 * ================== WHAT IS NOT WIRED, AND WHERE IT ISN'T ==================
 * `FlightScene.spawnOne` (src/game/scenes/FlightScene.ts, the `pickNext` call)
 * does not pass `lengthBias` into the pick context, and src/game/scenes is not
 * this lane's to edit. So the capability, its constants and its proof are here
 * and the one-line wiring is escalated. Until that line lands the knob is
 * still inert IN THE GAME, and the honest statement of that is in
 * gauntlet/escalations.md rather than in a comment claiming otherwise.
 */

const MARS = stagePoolFor("mars");
const PLUTO = stagePoolFor("pluto");

describe("UR-79 / FR-10: lengthWeightFactor", () => {
  it("AC-10.4: a neutral knob is EXACTLY a no-op, for every word", () => {
    // Load-bearing, not decorative. `DEFAULT_KNOBS.lengthBias` is 0, which is
    // what every cold-start profile carries, so this is the assertion that
    // says reading the knob changed nothing for a player the controller has
    // not moved yet - and it is why the whole simulation suite is unmoved by
    // this commit.
    expect(DEFAULT_KNOBS.lengthBias).toBe(0);
    for (const word of [...MARS, ...PLUTO]) {
      expect(lengthWeightFactor(word, 0), word).toBe(1);
      expect(biasedWeightOf(word, undefined, 0), word).toBe(weightOf(undefined));
    }
  });

  it("FR-10: +1 lifts long words and -1 lifts short ones, symmetrically", () => {
    // WATCHED FAILING: return 1 unconditionally from `lengthWeightFactor` and
    // this reads "expected 1 to be greater than 1" on the first row.
    const long = "hydrogen"; // 8 letters, a Jupiter pool word
    const short = "gas"; // 3 letters, the same pool
    expect(lengthWeightFactor(long, LENGTH_BIAS_MAX)).toBeGreaterThan(1);
    expect(lengthWeightFactor(short, LENGTH_BIAS_MAX)).toBeLessThan(1);
    expect(lengthWeightFactor(long, LENGTH_BIAS_MIN)).toBeLessThan(1);
    expect(lengthWeightFactor(short, LENGTH_BIAS_MIN)).toBeGreaterThan(1);
    // Symmetric about 1: the two knob ends are mirror images, so loosening
    // gives back exactly what tightening took.
    for (const word of [long, short, "orbit"]) {
      const up = lengthWeightFactor(word, LENGTH_BIAS_MAX);
      const down = lengthWeightFactor(word, LENGTH_BIAS_MIN);
      expect(up + down, word).toBeCloseTo(2, 10);
    }
  });

  it("FR-10: the factor is monotone in length and clamps at full deflection", () => {
    let previous = -Infinity;
    for (let len = 1; len <= 13; len += 1) {
      const factor = lengthWeightFactor("x".repeat(len), LENGTH_BIAS_MAX);
      expect(factor, `${len} letters`).toBeGreaterThanOrEqual(previous);
      previous = factor;
      // Never zero and never negative, so `weightedPick` can never be handed a
      // total weight of 0 and fall through to its uniform guard.
      expect(factor).toBeGreaterThan(0);
      expect(factor).toBeLessThanOrEqual(1 + LENGTH_BIAS_STRENGTH);
      expect(factor).toBeGreaterThanOrEqual(1 - LENGTH_BIAS_STRENGTH);
    }
    // The clamp: a word a full span past the pivot is already at the end of
    // the range, and a longer one gets no more than that.
    const atSpan = "x".repeat(LENGTH_BIAS_PIVOT + LENGTH_BIAS_SPAN);
    expect(lengthWeightFactor(atSpan, LENGTH_BIAS_MAX)).toBeCloseTo(1 + LENGTH_BIAS_STRENGTH, 10);
    expect(lengthWeightFactor(`${atSpan}xxx`, LENGTH_BIAS_MAX)).toBeCloseTo(
      1 + LENGTH_BIAS_STRENGTH,
      10,
    );
    // And the pivot itself is untouched at either end.
    const atPivot = "x".repeat(LENGTH_BIAS_PIVOT);
    expect(lengthWeightFactor(atPivot, LENGTH_BIAS_MAX)).toBe(1);
    expect(lengthWeightFactor(atPivot, LENGTH_BIAS_MIN)).toBe(1);
  });

  it("D21: mastery still outranks length at full deflection", () => {
    // D21 says frequency tracks mastery, and this knob must not be allowed to
    // overturn that. The mastery axis spans 10x; this one spans 4x at most, so
    // a MASTERED 8-letter word at +1 is still served less often than an
    // UNKNOWN 3-letter word at the same knob.
    const masteredLong = biasedWeightOf("hydrogen", masteredRecord(), LENGTH_BIAS_MAX);
    const unknownShort = biasedWeightOf("gas", unknownRecord(), LENGTH_BIAS_MAX);
    expect(masteredLong).toBeLessThan(unknownShort);
    expect(masteredLong).toBeCloseTo(SELECTION_WEIGHT.mastered * 1.6, 10);
    expect(unknownShort).toBeCloseTo(SELECTION_WEIGHT.unknown * 0.6, 10);
  });
});

describe("UR-79 / FR-10: what the belt actually serves at each knob", () => {
  /**
   * HOW MANY SPAWNS THIS LOOKS AT, AND WHY IT IS NOT THE WHOLE BELT.
   *
   * FR-9 serves a stage pool WITHOUT REPLACEMENT: every word comes round once
   * before any word comes round twice. So over a whole 58-spawn belt against a
   * 46-word pool the weights cannot change WHICH words are served - they are
   * nearly all served either way - they change the ORDER the child meets them
   * in. That is the authority this knob actually has, and measuring it over
   * 400 draws would report 0.04 of a letter and call a real effect nothing.
   *
   * The opening of a belt is also where the authority matters. A child who is
   * about to stall does it in the first half-dozen rocks, and this is the knob
   * that decides whether those rocks are `gas` or `hydrogen`.
   */
  const FIRST_SPAWNS = 8;

  /**
   * Draw the opening spawns of a stage at one knob position and report the mean
   * length served. The board is left empty between picks so AC-2.1's
   * first-letter filter cannot be what moves the number.
   */
  function meanServed(pool: readonly string[], bias: -1 | 0 | 1, seeds: number): number {
    const lengths: number[] = [];
    for (let seed = 1; seed <= seeds; seed += 1) {
      let state = createSelectionState({ stage: 1, stagePool: pool });
      const rng = mulberry32(seed * 0x9e3779b1);
      for (let i = 0; i < FIRST_SPAWNS; i += 1) {
        const out = pickNext(state, { live: [], book: {}, rng, lengthBias: bias });
        if (!out.ok) continue;
        lengths.push(out.word.length);
        state = out.state;
      }
    }
    expect(lengths.length).toBeGreaterThan(seeds * FIRST_SPAWNS * 0.9);
    return lengths.reduce((a, b) => a + b, 0) / lengths.length;
  }

  it("FR-10: a tightened knob serves LONGER words than a loosened one", () => {
    // WATCHED FAILING: drop the `lengthBias` argument from `pickNext`'s
    // `weightedPick` call and all three means collapse onto the same number -
    // "pluto: tight 4.572 vs neutral 4.572: expected 4.571875 to be greater
    // than 4.571875".
    for (const [name, pool] of [
      ["pluto", PLUTO],
      ["mars", MARS],
    ] as const) {
      const loose = meanServed(pool, LENGTH_BIAS_MIN, 80);
      const neutral = meanServed(pool, 0, 80);
      const tight = meanServed(pool, LENGTH_BIAS_MAX, 80);
      expect(tight, `${name}: tight ${tight.toFixed(3)} vs neutral ${neutral.toFixed(3)}`).toBeGreaterThan(
        neutral,
      );
      expect(neutral, `${name}: neutral ${neutral.toFixed(3)} vs loose ${loose.toFixed(3)}`).toBeGreaterThan(
        loose,
      );
      // Worth having, not a rounding artefact: at least a quarter of a letter
      // between the two ends of the knob.
      expect(tight - loose, `${name} knob travel`).toBeGreaterThan(0.25);
    }
  });

  it("AC-2.1 / FR-9: the neutral knob picks the SAME words as no knob at all", () => {
    // The compatibility promise, spelled as a sequence rather than as a mean:
    // an existing caller that never passes `lengthBias` gets the stream it
    // always got, word for word.
    const draw = (bias: -1 | 0 | 1 | undefined): string[] => {
      let state = createSelectionState({ stage: 1, stagePool: PLUTO });
      const rng = mulberry32(0xbeef);
      const out: string[] = [];
      for (let i = 0; i < 120; i += 1) {
        const pick = pickNext(state, {
          live: [],
          book: {},
          rng,
          ...(bias === undefined ? {} : { lengthBias: bias }),
        });
        if (!pick.ok) continue;
        out.push(pick.word);
        state = pick.state;
      }
      return out;
    };
    expect(draw(0)).toEqual(draw(undefined));
    expect(draw(LENGTH_BIAS_MAX)).not.toEqual(draw(undefined));
  });

  it("FR-10: no knob position can empty the board", () => {
    // The totality property `picker.ts` rests on. A weight cannot remove a
    // candidate, so every knob position still yields a word on an empty board
    // at every one of the six stops.
    for (const stopId of ["mars", "jupiter", "saturn", "uranus", "neptune", "pluto"] as const) {
      const pool = stagePoolFor(stopId);
      for (const bias of [LENGTH_BIAS_MIN, 0, LENGTH_BIAS_MAX] as const) {
        let state = createSelectionState({ stage: 1, stagePool: pool });
        const rng = mulberry32(7);
        for (let i = 0; i < 200; i += 1) {
          const out = pickNext(state, { live: [], book: {}, rng, lengthBias: bias });
          expect(out.ok, `${stopId} at bias ${bias} stalled on spawn ${i}`).toBe(true);
          if (!out.ok) break;
          state = out.state;
        }
      }
    }
  });
});

/**
 * THE KNOB IS ACTUALLY HANDED OVER (UR-79, AC-10.4).
 *
 * Everything above proves the WEIGHTING is right. None of it would notice if
 * `FlightScene` never passed the knob - `pickNext` would default to `0`,
 * `lengthWeightFactor` would return exactly 1 for every word, every test here
 * would stay green, and `lengthBias` would go on being what it was for its
 * whole life: a number the controller moved, the profile stored and the schema
 * repaired, that nothing ever read.
 *
 * That is not a hypothetical failure mode. It is the defect this ticket exists
 * to fix, and it survived precisely because every test of the knob tested the
 * knob rather than its wiring.
 *
 * `FlightScene.ts` extends a Phaser class and cannot be imported under vitest's
 * node environment, so this is a source guard - the same binding
 * `tests/unit/flight/plateSeparation.test.ts` uses for the same reason.
 *
 * WATCHED FAILING, with the line removed from `trySpawn`:
 *
 *   FlightScene does not hand the picker lengthBias, so FR-10's second knob is
 *   inert however well it is weighted: expected false to be true
 */
describe("UR-79: FlightScene reads the knob it has always written", () => {
  it("hands lengthBias to the picker on every spawn", () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/scenes/FlightScene.ts"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(
      /lengthBias:\s*this\.controller\.knobs\.lengthBias/.test(source),
      "FlightScene does not hand the picker lengthBias, so FR-10's second knob " +
        "is inert however well it is weighted",
    ).toBe(true);
  });
});
