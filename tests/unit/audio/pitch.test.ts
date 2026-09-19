import { describe, expect, it } from "vitest";
import { NullAudioContext } from "../../../src/game/audio/nullContext.js";
import {
  MAX_PITCH_SEMITONES,
  SFX_EVENTS,
  SYSTEM_CHECK_SEMITONES,
  SfxBus,
  blastSemitonesFor,
  systemCheckSemitones,
  variantsFor,
} from "../../../src/game/audio/sfx.js";
import { PENTATONIC_SEMITONES } from "../../../src/game/audio/keystrokeTone.js";
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

/**
 * UR-101.5: THE PRE-FLIGHT CHECK ROWS HAD NO SOUND AT ALL.
 *
 * ================== WHAT WAS ASKED ==================
 * Each completing step should have its own sound, and three rows completing in
 * sequence should read as A SYSTEM COMING UP rather than as three identical
 * beeps. The brief asked for the existing vocabulary to be READ before anything
 * was added, and specifically whether a rising figure is supported.
 *
 * ================== WHAT THE VOCABULARY TURNED OUT TO HOLD ==============
 * Ten SFX events, each with three procedural variants (`SFX_VARIANTS`), a
 * pitched keystroke ladder on a pentatonic scale (`keystrokeTone.ts`, D75),
 * Shadow's chirp, and `SfxPlayOptions.pitchSemitones` - a caller-supplied
 * transposition that already applies to ANY event and is already capped at an
 * octave. So a rising figure needed no new sample and no new cue name: it
 * needed three numbers.
 *
 * `lock` is the event, and it was chosen by reading rather than by taste. Its
 * own comment in `sfx.ts` calls it "a small confident upward confirmation" -
 * 470-620 Hz gliding up a fifth in 110-150 ms at peak 0.15-0.17. `beacon` is
 * the game's reward bell at 900 ms and 0.28 and means a STOP being lit, not a
 * row. `uiNav` is a focus blip. `shield` rises but means absorption and runs
 * 420 ms of filtered noise.
 *
 *   npx vitest run tests/unit/audio/pitch.test.ts --coverage.enabled=false
 */
describe("UR-101.5: the check rows are a rising figure, composed not sampled", () => {
  it("is three rows walking up a major triad", () => {
    expect(SYSTEM_CHECK_SEMITONES).toEqual([0, 4, 7]);
    expect(systemCheckSemitones(0)).toBe(0);
    expect(systemCheckSemitones(1)).toBe(4);
    expect(systemCheckSemitones(2)).toBe(7);
  });

  it("really RISES - each row is transposed further up than the last", () => {
    // The whole of "not three identical beeps". `lock`'s three variants ROTATE,
    // so raw start frequencies differ between plays whatever is asked for -
    // which is why this compares each play against ITS OWN recipe, the way the
    // rest of this file does. The ratios are the figure.
    //
    // WATCHED FAILING on a first version that compared raw `startHz` and used
    // "three flat plays give fewer than three pitches" as its negative control:
    // "expected 3 to be less than 3". The rotation had already made them three.
    const b = bus();
    const ratios = [0, 1, 2].map((i) => {
      const played = b.play("lock", { pitchSemitones: systemCheckSemitones(i) });
      return played.startHz / played.variant.startHz;
    });
    expect(ratios[0]!).toBeCloseTo(semitoneRatio(0), 4);
    expect(ratios[1]!).toBeCloseTo(semitoneRatio(4), 4);
    expect(ratios[2]!).toBeCloseTo(semitoneRatio(7), 4);
    expect(ratios[1]!).toBeGreaterThan(ratios[0]!);
    expect(ratios[2]!).toBeGreaterThan(ratios[1]!);
    // NEGATIVE CONTROL: what shipped was no cue at all, and the nearest thing
    // to "three identical beeps" the option can express is a flat figure.
    const flat = bus();
    const flatRatios = [0, 1, 2].map(() => {
      const played = flat.play("lock", { pitchSemitones: 0 });
      return played.startHz / played.variant.startHz;
    });
    expect(new Set(flatRatios.map((r) => r.toFixed(4))).size).toBe(1);
  });

  it("stays in the key the child has been typing in (D75)", () => {
    // The reason these three numbers and not three others. {0, 4, 7} is a
    // subset of the pentatonic scale every keystroke tone is drawn from, so the
    // row chime lands in the key of the twenty seconds of typing before it
    // instead of beside it.
    for (const s of SYSTEM_CHECK_SEMITONES) {
      expect(PENTATONIC_SEMITONES, `${s} is off the keystroke scale`).toContain(s);
    }
  });

  it("composes from an EXISTING cue rather than adding an eleventh event", () => {
    // The brief asked for composition over a new sample. `lock` is one of the
    // ten AC-21.3 events and this adds none.
    expect(SFX_EVENTS).toContain("lock");
    expect(SFX_EVENTS.length).toBe(10);
  });

  it("stays inside the transposition cap however many rows there are", () => {
    // A fourth step would otherwise transpose itself off the top. It holds at
    // the fifth instead, which is a repeat and not a wrong note.
    expect(systemCheckSemitones(3)).toBe(7);
    expect(systemCheckSemitones(99)).toBe(7);
    expect(systemCheckSemitones(-1)).toBe(0);
    for (const s of SYSTEM_CHECK_SEMITONES) {
      expect(Math.abs(s)).toBeLessThanOrEqual(MAX_PITCH_SEMITONES);
    }
  });

  it("D31: nothing here is louder than the cue it transposes", () => {
    // Transposition moves pitch, never level, so UR-34's loudness work and
    // D31's "a mistyped key is the quietest sound in the game" are untouched by
    // this item. Measured against each play's OWN recipe, because the three
    // `lock` variants ship at 0.15, 0.16 and 0.17 and rotate - comparing across
    // them reported "expected 0.17 to be less than or equal to 0.15" on the
    // first version of this assertion, which was the test's error, not the
    // code's.
    const b = bus();
    for (const s of SYSTEM_CHECK_SEMITONES) {
      const played = b.play("lock", { pitchSemitones: s });
      expect(played.peakGain, `${s} semitones`).toBeLessThanOrEqual(
        played.variant.peakGain + 1e-9,
      );
    }
    // ...and it stays under the quietest thing that is NOT a success cue by a
    // wide margin is not the claim; the claim is that a typo is still quieter.
    const typoCeiling = Math.max(...variantsFor("typo").map((v) => v.peakGain));
    const lockFloor = Math.min(...variantsFor("lock").map((v) => v.peakGain));
    expect(typoCeiling).toBeLessThan(lockFloor);
  });
});
