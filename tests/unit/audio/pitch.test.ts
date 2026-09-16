import { describe, expect, it } from "vitest";
import { NullAudioContext } from "../../../src/game/audio/nullContext.js";
import {
  MAX_PITCH_SEMITONES,
  SFX_EVENTS,
  SfxBus,
  blastSemitonesFor,
  variantsFor,
} from "../../../src/game/audio/sfx.js";
import { semitoneRatio } from "../../../src/game/audio/context.js";

/**
 * `SfxPlayOptions.pitchSemitones` (D63).
 *
 * The warp break's charge meter is the one bar in this game that is a
 * CONTINUOUS quantity, and it charged in silence: `warpCharge` spooled once on
 * the first character and then nothing moved for the rest of the sentence. A
 * caller that is sounding a continuous quantity needs the pitch to track it,
 * and the bus had no way to say so - the only pitch rule it had was blast-vs-
 * combo, which is a rule about the game and correctly lives inside the bus.
 *
 * The property that matters most here is the last one: adding this must not
 * change a single existing call.
 */

const bus = (): SfxBus => new SfxBus(new NullAudioContext(), new NullAudioContext().createGain());

describe("SfxPlayOptions.pitchSemitones", () => {
  it("transposes ANY event, not just the two with their own reactive rule", () => {
    for (const event of SFX_EVENTS) {
      const b = bus();
      const flat = b.play(event, { pitchSemitones: 0 });
      const up = b.play(event, { pitchSemitones: 12 });
      // Variants rotate, so compare each play against ITS OWN recipe.
      expect(flat.startHz).toBeCloseTo(flat.variant.startHz, 6);
      expect(up.startHz / up.variant.startHz, event).toBeCloseTo(2, 4);
    }
  });

  it("is clamped, so nothing can be transposed out of the audible register", () => {
    const b = bus();
    const wild = b.play("warpCharge", { pitchSemitones: 400 });
    expect(wild.startHz / wild.variant.startHz).toBeCloseTo(
      semitoneRatio(MAX_PITCH_SEMITONES),
      4,
    );
    const low = b.play("warpCharge", { pitchSemitones: -400 });
    expect(low.startHz / low.variant.startHz).toBeCloseTo(
      semitoneRatio(-MAX_PITCH_SEMITONES),
      4,
    );
  });

  it("composes with the blast's own combo rule rather than replacing it", () => {
    const b = bus();
    const played = b.play("blast", { combo: 10, pitchSemitones: 2 });
    expect(played.startHz / played.variant.startHz).toBeCloseTo(
      semitoneRatio(blastSemitonesFor(10) + 2),
      4,
    );
  });

  it("changes NOTHING when it is not supplied", () => {
    // The regression that matters. Every call in the game predates this option.
    for (const event of SFX_EVENTS) {
      const b = bus();
      const played = b.play(event);
      const expected = event === "blast" ? semitoneRatio(blastSemitonesFor(0)) : 1;
      expect(played.startHz, event).toBeCloseTo(played.variant.startHz * expected, 6);
    }
  });

  it("leaves the D31 gentle events gentle: pitch moves, gain does not", () => {
    for (const event of ["typo", "hit"] as const) {
      const b = bus();
      const played = b.play(event, { pitchSemitones: MAX_PITCH_SEMITONES });
      const ceiling = Math.max(...variantsFor(event).map((v) => v.peakGain));
      expect(played.peakGain, event).toBeLessThanOrEqual(ceiling * 1.35 + 1e-9);
    }
  });
});
