import { describe, expect, it } from "vitest";
import {
  clamp,
  dbToGain,
  equalPowerCrossfade,
  gainToDb,
  progress,
  seededRandom,
  semitoneRatio,
} from "../../../src/game/audio/context.js";
import {
  NullAudioContext,
  NullGain,
  NullOscillator,
  describeRecordedGraph,
  label,
  reaches,
} from "../../../src/game/audio/nullContext.js";

describe("audio units", () => {
  it("converts dB to linear gain and back", () => {
    expect(dbToGain(0)).toBeCloseTo(1, 12);
    expect(dbToGain(-6)).toBeCloseTo(0.5011872336, 9);
    expect(gainToDb(dbToGain(-6))).toBeCloseTo(-6, 9);
    expect(gainToDb(1)).toBeCloseTo(0, 12);
  });

  it("never lets a non-finite level reach a gain node", () => {
    // A NaN in a GainNode silences a whole bus and is close to untraceable.
    expect(dbToGain(Number.NaN)).toBe(0);
    expect(dbToGain(Number.POSITIVE_INFINITY)).toBe(0);
    expect(gainToDb(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(gainToDb(Number.NaN)).toBe(Number.NEGATIVE_INFINITY);
    expect(clamp(Number.NaN, 0.2, 1)).toBe(0.2);
  });

  it("clamps and reports progress", () => {
    expect(progress(0, 1000)).toBe(0);
    expect(progress(500, 1000)).toBe(0.5);
    expect(progress(5000, 1000)).toBe(1);
    expect(progress(10, 0)).toBe(1);
    expect(progress(10, Number.NaN)).toBe(1);
  });

  it("AC-21.1: the crossfade is EQUAL POWER, so a transition never dips", () => {
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const { out, in: incoming } = equalPowerCrossfade(t);
      // The whole point: constant perceived loudness across the move. A linear
      // crossfade fails this by ~3 dB in the middle and sounds like a fault.
      expect(out * out + incoming * incoming).toBeCloseTo(1, 12);
    }
  });

  it("AC-21.1: the crossfade starts fully out and ends fully in", () => {
    expect(equalPowerCrossfade(0)).toEqual({ out: 1, in: 0 });
    const end = equalPowerCrossfade(1);
    expect(end.out).toBeCloseTo(0, 12);
    expect(end.in).toBeCloseTo(1, 12);
    // Out of range is clamped, not extrapolated.
    expect(equalPowerCrossfade(-3).in).toBe(0);
    expect(equalPowerCrossfade(9).in).toBeCloseTo(1, 12);
  });

  it("is deterministic: seeded rngs agree and stay in [0,1)", () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    for (let i = 0; i < 200; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(seededRandom(1)()).not.toBe(seededRandom(2)());
    expect(Number.isFinite(seededRandom(Number.NaN)())).toBe(true);
  });

  it("converts semitones to frequency ratios", () => {
    expect(semitoneRatio(0)).toBe(1);
    expect(semitoneRatio(12)).toBeCloseTo(2, 12);
    expect(semitoneRatio(-12)).toBeCloseTo(0.5, 12);
    expect(semitoneRatio(Number.NaN)).toBe(1);
  });
});

describe("the recording context", () => {
  it("records nodes, connections and param automation", () => {
    const ctx = new NullAudioContext();
    const gain = ctx.createGain();
    const osc = ctx.createOscillator();
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.4, 0);
    gain.gain.linearRampToValueAtTime(0.9, 1);

    expect(gain).toBeInstanceOf(NullGain);
    expect(osc).toBeInstanceOf(NullOscillator);
    expect(reaches(osc, ctx.destination)).toBe(true);
    expect(reaches(ctx.destination, osc)).toBe(false);
    expect(gain.gain.value).toBeCloseTo(0.9, 12);
    expect((gain as NullGain).gain.events.map((e) => e.kind)).toEqual(["set", "linear"]);
  });

  it("holds its own clock so a two-second fade costs no real time", () => {
    const ctx = new NullAudioContext();
    expect(ctx.currentTime).toBe(0);
    ctx.advance(2.2);
    expect(ctx.currentTime).toBeCloseTo(2.2, 12);
  });

  it("labels nodes so a built graph can be read back", () => {
    const ctx = new NullAudioContext();
    label(ctx.createGain(), "bus.master");
    label(ctx.createGain(), "ambient.bed.mars");
    ctx.createGain();
    expect(ctx.labelledWith("ambient.bed.").length).toBe(1);
    // The destination is labelled too, hence 2 named buses/beds + destination.
    expect(ctx.labelled().length).toBe(3);
    const dump = describeRecordedGraph(ctx);
    expect(dump.some((n) => n.label === "bus.master")).toBe(true);
  });

  it("makes buffers with real, writable channel data", () => {
    const ctx = new NullAudioContext(8000);
    const buffer = ctx.createBuffer(1, 16, 8000);
    const data = buffer.getChannelData(0);
    data[3] = 0.5;
    expect(buffer.length).toBe(16);
    expect(buffer.getChannelData(0)[3]).toBeCloseTo(0.5, 6);
    expect(() => buffer.getChannelData(4)).toThrow();
  });

  it("disconnects and ignores foreign destinations", () => {
    const ctx = new NullAudioContext();
    const gain = ctx.createGain() as NullGain;
    gain.connect(ctx.destination);
    expect(gain.outputs.length).toBe(1);
    gain.disconnect();
    expect(gain.outputs.length).toBe(0);
    gain.connect({ connect: () => undefined, disconnect: () => undefined });
    expect(gain.outputs.length).toBe(0);
    expect(reaches(gain, { connect: () => undefined, disconnect: () => undefined })).toBe(false);
  });

  it("tracks oscillator and buffer-source lifecycle", () => {
    const ctx = new NullAudioContext();
    const osc = ctx.createOscillator() as NullOscillator;
    osc.start(0);
    osc.stop(1);
    expect(osc.started && osc.stopped).toBe(true);

    const source = ctx.createBufferSource();
    source.buffer = ctx.createBuffer(1, 4, 48000);
    source.loop = true;
    source.start(0);
    source.stop(1);
    expect(source.loop).toBe(true);

    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(-0.5, 0);
    expect(panner.pan.value).toBeCloseTo(-0.5, 12);

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.setValueAtTime(2, 0);
    filter.frequency.cancelScheduledValues(0);
    filter.frequency.exponentialRampToValueAtTime(900, 1);
    expect(filter.frequency.value).toBe(900);
  });
});
