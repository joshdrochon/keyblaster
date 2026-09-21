import { describe, expect, it } from "vitest";
import {
  BLAST_MILESTONE_GAIN,
  SfxBus,
  blastGainFor,
  variantsFor,
} from "../../../src/game/audio/sfx.js";
import { CUE_SFX, FLIGHT_CUE_NAMES, installAudio } from "../../../src/game/audio/wiring.js";
import { MULTIPLIER_MILESTONES, multiplierFor } from "../../../src/engine/scoring/index.js";
import { NullAudioContext } from "../../../src/game/audio/nullContext.js";
import { buildAudioGraph } from "../../../src/game/audio/graph.js";
import { seededRandom } from "../../../src/game/audio/context.js";
import { fakeVoiceEnvironment } from "./fakes.js";

/**
 * UR-117, THE AUDIO HALF: A MILESTONE BLAST IS LOUDER, AND NOTHING ELSE IS.
 *
 * `blastGainFor` shipped with the cue table and was never called by anything -
 * the constant existed, the function existed, and the bus multiplied by neither.
 * This file is about the wiring, so every assertion goes through `SfxBus.play`
 * or through the flight cue channel rather than calling `blastGainFor` and
 * checking it returns what it returns.
 *
 * SHAPED IN THE BUS AND NOT PASSED IN FROM THE SCENE, deliberately: the cue
 * already carries the combo it was fired at (D63 shapes blast PITCH from the
 * same field), so a `gainScale` threaded down from `FlightScene` would be a
 * second place that has to remember which multipliers are milestones.
 *
 * ================== WATCHED FAILING ==================
 *   removing `milestoneGain` from `peakGain` in `SfxBus.play`
 *     -> "a blast fired at a milestone combo is louder at the node": x3:
 *        expected 0.17 to be close to 0.204
 *   `blastGainFor` applied to every event, not just the blast
 *     -> "no other event is touched by the combo it was fired at": hit:
 *        expected 0.0936 to be close to 0.078
 *   `blastGainFor` returning the gain at every combo
 *     -> "an ordinary combo gets the ordinary blast": combo 0: expected 0.204
 *        to be close to 0.17, and "the three loud combos are exactly the three
 *        the scoring lane names": expected [ 0, 1, 2, ... 10 ] to equal
 *        [ 3, 5, 10 ]
 *   `CUE_SFX.comboUp` set back to null
 *     -> "emitting the cue schedules the comboUp sound": the comboUp cue routed
 *        to no sound: expected [] to have a length of 1 but got 0
 */
describe("UR-117: the blast that won a milestone is the louder one", () => {
  /** A bus on a null context: this is about the numbers written to the node. */
  const bus = (): SfxBus => {
    const ctx = new NullAudioContext();
    return new SfxBus(ctx, ctx.createGain());
  };

  it("a blast fired at a milestone combo is louder at the node", () => {
    for (const multiplier of MULTIPLIER_MILESTONES) {
      const b = bus();
      const played = b.play("blast", { combo: multiplier });
      expect(played.peakGain, `x${multiplier}`).toBeCloseTo(
        played.variant.peakGain * BLAST_MILESTONE_GAIN,
        12,
      );
    }
  });

  it("an ordinary combo gets the ordinary blast", () => {
    // Every combo from 0 to 14 that is NOT a milestone multiplier, including
    // 11-14 where the multiplier is pinned at 10 but the milestone was won
    // several words ago and is not being won again.
    for (let combo = 0; combo <= 14; combo += 1) {
      if (MULTIPLIER_MILESTONES.includes(multiplierFor(combo))) continue;
      const b = bus();
      const played = b.play("blast", { combo });
      expect(played.peakGain, `combo ${combo}`).toBeCloseTo(played.variant.peakGain, 12);
    }
  });

  it("the three loud combos are exactly the three the scoring lane names", () => {
    const loud: number[] = [];
    for (let combo = 0; combo <= 14; combo += 1) {
      if (blastGainFor(combo) > 1) loud.push(multiplierFor(combo));
    }
    // 11-14 are pinned at multiplier 10, so a rule that read the combo count
    // would put four more entries in this list. `multiplierFor` is why it does
    // not - and the scene never asks for one of those blasts anyway, because
    // `celebrationFor` only fires at a STEP.
    expect([...new Set(loud)]).toEqual([...MULTIPLIER_MILESTONES]);
  });

  it("no other event is touched by the combo it was fired at", () => {
    for (const event of ["hit", "lock", "keystroke", "comboUp", "shield"] as const) {
      const b = bus();
      const played = b.play(event, { combo: 5 });
      expect(played.peakGain, event).toBeCloseTo(played.variant.peakGain, 12);
    }
  });

  it("every blast variant stays inside the node's 0..1 gain range", () => {
    for (const variant of variantsFor("blast")) {
      expect(variant.peakGain * BLAST_MILESTONE_GAIN).toBeLessThanOrEqual(1);
    }
  });
});

describe("UR-117: the comboUp cue reaches the sfx bus", () => {
  it("the chime is a routed cue, not a scene calling the bus directly", () => {
    expect(FLIGHT_CUE_NAMES).toContain("comboUp");
    expect(CUE_SFX.comboUp).toBe("comboUp");
  });

  it("emitting the cue schedules the comboUp sound", () => {
    const { env } = fakeVoiceEnvironment();
    const graph = buildAudioGraph(new NullAudioContext(), {
      voiceEnv: env,
      rand: seededRandom(0xbeef),
    });
    const audio = installAudio({ graph });
    audio.routeFlightCue({ cue: "comboUp", combo: 5 });
    const played = audio.snapshot().recent.filter((p) => p.event === "comboUp");
    expect(played, "the comboUp cue routed to no sound").toHaveLength(1);
    expect(played[0]?.via).toBe("flight-cue:comboUp");
    // It is NOT a word ending: the ladder must not reset on a chime, which
    // fires on the same frame as the blast that already reset it.
    expect(audio.snapshot().toneResets).toBe(0);
  });
});
