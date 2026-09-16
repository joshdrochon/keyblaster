import { describe, expect, it } from "vitest";
import { NullAudioContext, NullGain } from "../../../src/game/audio/nullContext.js";
import {
  KeystrokeTone,
  MAX_PITCH_INDEX,
  PENTATONIC_SEMITONES,
  TONE_ENVELOPE,
  TONE_ROOT_HZ,
  advanceToneState,
  frequencyFor,
  initialToneState,
  pitchIndexFor,
  semitonesForIndex,
} from "../../../src/game/audio/keystrokeTone.js";

describe("AC-6c.2: the pitch index is a pure function of consecutive correct keys", () => {
  it("AC-6c.2: the same count always gives the same index", () => {
    for (let i = 0; i < 100; i++) expect(pitchIndexFor(7)).toBe(pitchIndexFor(7));
  });

  it("AC-6c.2: the first correct key sounds the root, and it steps up from there", () => {
    expect(pitchIndexFor(0)).toBe(0);
    expect(pitchIndexFor(1)).toBe(0);
    expect(pitchIndexFor(2)).toBe(1);
    expect(pitchIndexFor(6)).toBe(5);
  });

  it("AC-6c.2: the ladder never descends", () => {
    let previous = -1;
    for (let n = 0; n <= 200; n++) {
      const index = pitchIndexFor(n);
      expect(index).toBeGreaterThanOrEqual(previous);
      previous = index;
    }
  });

  it("AC-6c.2: caps rather than climbing into a siren", () => {
    expect(pitchIndexFor(1000)).toBe(MAX_PITCH_INDEX);
    expect(frequencyFor(1000)).toBe(frequencyFor(MAX_PITCH_INDEX + 1));
    // Three pentatonic octaves is the top: still musical, still audible.
    expect(frequencyFor(1000)).toBeLessThanOrEqual(TONE_ROOT_HZ * 8);
  });

  it("AC-6c.2: junk input lands on the root rather than producing NaN", () => {
    expect(pitchIndexFor(Number.NaN)).toBe(0);
    expect(pitchIndexFor(-5)).toBe(0);
    expect(pitchIndexFor(Number.POSITIVE_INFINITY)).toBe(0);
    expect(frequencyFor(Number.NaN)).toBe(TONE_ROOT_HZ);
  });

  it("D75: the scale is a fixed pentatonic, so no run of keys can sound sour", () => {
    expect([...PENTATONIC_SEMITONES]).toEqual([0, 2, 4, 7, 9]);
    // Every interval inside the scale is consonant: no half-steps, no tritone.
    for (let i = 0; i < PENTATONIC_SEMITONES.length; i++) {
      for (let j = i + 1; j < PENTATONIC_SEMITONES.length; j++) {
        const interval = (PENTATONIC_SEMITONES[j]! - PENTATONIC_SEMITONES[i]!) % 12;
        expect([1, 6, 11]).not.toContain(interval);
      }
    }
  });

  it("D75: the scale wraps up an octave, in order", () => {
    expect(semitonesForIndex(0)).toBe(0);
    expect(semitonesForIndex(4)).toBe(9);
    expect(semitonesForIndex(5)).toBe(12);
    expect(semitonesForIndex(9)).toBe(21);
    expect(semitonesForIndex(-3)).toBe(0);
    expect(semitonesForIndex(999)).toBe(semitonesForIndex(MAX_PITCH_INDEX));
    let previous = -1;
    for (let i = 0; i <= MAX_PITCH_INDEX; i++) {
      const s = semitonesForIndex(i);
      expect(s).toBeGreaterThan(previous);
      previous = s;
    }
  });

  it("AC-6c.2: frequency follows the index off a configurable root", () => {
    expect(frequencyFor(1)).toBeCloseTo(TONE_ROOT_HZ, 9);
    expect(frequencyFor(6)).toBeCloseTo(TONE_ROOT_HZ * 2, 6);
    expect(frequencyFor(1, 440)).toBeCloseTo(440, 9);
  });
});

describe("D75: the ladder resets on a typo", () => {
  it("D75: a correct key steps up; a typo returns to zero", () => {
    let state = initialToneState();
    state = advanceToneState(state, "correct");
    state = advanceToneState(state, "correct");
    expect(state.consecutiveCorrect).toBe(2);
    state = advanceToneState(state, "typo");
    expect(state.consecutiveCorrect).toBe(0);
    expect(pitchIndexFor(state.consecutiveCorrect)).toBe(0);
  });

  it("D75: the reset is total, not a decay", () => {
    let state = initialToneState();
    for (let i = 0; i < 30; i++) state = advanceToneState(state, "correct");
    expect(advanceToneState(state, "typo")).toEqual({ consecutiveCorrect: 0 });
    expect(advanceToneState(state, "reset")).toEqual({ consecutiveCorrect: 0 });
  });

  it("is a pure reducer and repairs a corrupt count", () => {
    const state = { consecutiveCorrect: Number.NaN };
    expect(advanceToneState(state, "correct").consecutiveCorrect).toBe(1);
    expect(advanceToneState({ consecutiveCorrect: -9 }, "correct").consecutiveCorrect).toBe(1);
  });
});

describe("the keystroke tone on a context", () => {
  const build = (): { ctx: NullAudioContext; tone: KeystrokeTone } => {
    const ctx = new NullAudioContext();
    return { ctx, tone: new KeystrokeTone(ctx, ctx.createGain()) };
  };

  it("AC-6c.2: plays the frequency the pure function predicts", () => {
    const { ctx, tone } = build();
    for (let i = 1; i <= 8; i++) {
      const hit = tone.correct();
      expect(hit.consecutiveCorrect).toBe(i);
      expect(hit.pitchIndex).toBe(pitchIndexFor(i));
      expect(hit.frequencyHz).toBeCloseTo(frequencyFor(i), 9);
    }
    expect(ctx.labelledWith("sfx.keystrokeTone").length).toBe(8);
  });

  it("AC-6c.2: a typo drops the next key back to the root", () => {
    const { tone } = build();
    tone.correct();
    tone.correct();
    tone.correct();
    tone.typo();
    expect(tone.consecutiveCorrect).toBe(0);
    expect(tone.pitchIndex).toBe(0);
    expect(tone.correct().frequencyHz).toBeCloseTo(TONE_ROOT_HZ, 9);
  });

  it("D31: a typo plays NO tone - it only resets the ladder", () => {
    const { ctx, tone } = build();
    tone.correct();
    const after = ctx.labelledWith("sfx.keystrokeTone").length;
    tone.typo();
    // Stacking a second sound onto a mistyped key is how a game starts telling
    // a child off. The gentle tick in sfx.ts is the only thing a typo makes.
    expect(ctx.labelledWith("sfx.keystrokeTone").length).toBe(after);
  });

  it("resets between words without treating it as a typo", () => {
    const { tone } = build();
    tone.correct();
    tone.correct();
    tone.reset();
    expect(tone.consecutiveCorrect).toBe(0);
  });

  it("keeps a history of what it played", () => {
    const { tone } = build();
    tone.correct();
    tone.correct();
    expect(tone.history().map((h) => h.pitchIndex)).toEqual([0, 1]);
  });

  it("gives every tone a soft envelope, quiet enough to fire on every key", () => {
    const { ctx, tone } = build();
    tone.correct();
    const amp = ctx.labelledWith("sfx.keystrokeTone")[0] as NullGain;
    expect(amp.gain.events.map((e) => e.kind)).toEqual(["set", "linear", "exponential"]);
    expect(TONE_ENVELOPE.peakGain).toBeLessThan(0.1);
    expect(TONE_ENVELOPE.durationMs).toBeLessThan(200);
  });

  it("accepts a different root without changing the shape of the ladder", () => {
    const ctx = new NullAudioContext();
    const tone = new KeystrokeTone(ctx, ctx.createGain(), 330);
    expect(tone.correct().frequencyHz).toBeCloseTo(330, 9);
    expect(tone.correct().frequencyHz).toBeCloseTo(330 * Math.pow(2, 2 / 12), 9);
  });
});
