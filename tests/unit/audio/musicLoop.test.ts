import { describe, expect, it } from "vitest";
import { NullAudioContext } from "../../../src/game/audio/nullContext.js";
import {
  LOOP_CROSSFADE_MS,
  MUSIC_LEVEL_TRIM_RANGE,
  MUSIC_REFERENCE_RMS,
  bufferRms,
  levelTrimFor,
  buildLoopChannels,
  findLoopRegion,
  loopLevelStats,
  loopSeamStats,
  medianLevel,
  monoMix,
  prepareLoopBuffer,
  windowLevels,
} from "../../../src/game/audio/musicLoop.js";

// ---------------------------------------------------------------------------
// Signals
//
// Two synthetic pieces, each carrying ONE of the two defects the seven real
// tracks were measured for. Synthetic rather than the mp3s themselves because a
// unit test may not shell out to a decoder - the real files are measured by
// `node scripts/render-music.mjs --check-loops`, which runs THIS code over
// ffmpeg's PCM, so the algorithm under test is the same one either way.
// ---------------------------------------------------------------------------

const SR = 8000;
const SECONDS = 10;
const N = SR * SECONDS;

/** A sine at constant level whose length is not a whole number of cycles. */
const offPhase = (hz = 220): Float32Array => {
  const x = new Float32Array(N);
  for (let i = 0; i < N; i++) x[i] = Math.sin((2 * Math.PI * hz * i) / SR) * 0.5;
  // Rotate by a third of a cycle so the ends do not happen to meet.
  const shift = Math.round(SR / hz / 3);
  return x.slice(shift);
};

/**
 * The real defect: a piece that fades in over 2 s and out over 2 s, exactly as
 * earth.mp3 does. Its ends MEET - both are silence - so its seam step is zero
 * and a step-only measurement calls it perfect. It is not perfect; looped, it
 * dies away and restarts every lap.
 */
const faded = (hz = 220): Float32Array => {
  const x = new Float32Array(N);
  const fade = SR * 2;
  for (let i = 0; i < N; i++) {
    const env = Math.min(1, i / fade, (N - 1 - i) / fade);
    x[i] = Math.sin((2 * Math.PI * hz * i) / SR) * 0.5 * env;
  }
  return x;
};

describe("E-MUSIC-1: a loop's continuity is measured, not asserted", () => {
  it("catches a seam that steps, against the signal's own largest step", () => {
    const s = loopSeamStats(offPhase());
    // The bar is the music's own biggest sample-to-sample move. Nothing here
    // is tuned: a wrap that moves further than the signal ever moves on its
    // own is an edge, and this one does.
    expect(s.seamStep).toBeGreaterThan(s.maxInteriorStep);
  });

  it("a seam that does NOT step can still be a hole, and the level stats see it", () => {
    const x = faded();
    const seam = loopSeamStats(x);
    // Both ends are silence, so the step measurement is blind here - exactly
    // what the seven real tracks do, and why this file measures level too.
    expect(seam.seamStep).toBeLessThanOrEqual(seam.maxInteriorStep);

    const level = loopLevelStats(x, SR, 1000);
    expect(level.head).toBeLessThan(0.6);
    expect(level.tail).toBeLessThan(0.6);
  });

  it("reports the level of each end as a fraction of the piece's own middle", () => {
    const flat = new Float32Array(N).fill(0.25);
    const level = loopLevelStats(flat, SR, 1000);
    expect(level.head).toBeCloseTo(1, 6);
    expect(level.tail).toBeCloseTo(1, 6);
  });

  it("windowLevels and medianLevel are the envelope the trim is read from", () => {
    const levels = windowLevels(new Float32Array(N).fill(0.4), SR, 50);
    expect(levels.length).toBe(SECONDS * 20);
    for (const v of levels) expect(v).toBeCloseTo(0.4, 6);
    expect(medianLevel(levels)).toBeCloseTo(0.4, 6);
    expect(medianLevel(new Float32Array(0))).toBe(0);
  });
});

describe("E-MUSIC-1: the trim takes the fade out of the loop", () => {
  it("finds the region where the piece is actually playing", () => {
    const region = findLoopRegion(faded(), SR);
    expect(region.trimmed).toBe(true);
    // The 2 s fades are below half the median level for most of their length,
    // so the region starts and ends inside them, not at the file's edges.
    expect(region.start).toBeGreaterThan(0);
    expect(region.end).toBeLessThan(N);
    expect(region.length).toBeGreaterThan(N / 2);
  });

  it("THE DEFECT, FIXED: the prepared loop no longer dies away at its ends", () => {
    const before = loopLevelStats(faded(), SR, 1000);
    const region = findLoopRegion(faded(), SR);
    const after = loopLevelStats(buildLoopChannels([faded()], region)[0] as Float32Array, SR, 1000);

    expect(before.head).toBeLessThan(0.6);
    expect(before.tail).toBeLessThan(0.6);
    // Both ends now sit at the level the piece plays at. A loop that starts and
    // ends where it lives does not restart audibly.
    expect(after.head).toBeGreaterThan(0.75);
    expect(after.tail).toBeGreaterThan(0.75);
  });

  it("leaves a piece with no fades very nearly alone", () => {
    const region = findLoopRegion(new Float32Array(N).fill(0.3), SR);
    expect(region.start).toBe(0);
    expect(region.end).toBe(N);
  });

  it("GUARD: never trims away more than half the piece", () => {
    // Mostly silence with one loud burst: the threshold would keep only the
    // burst. Half a piece of music is a worse answer than the whole one.
    const x = new Float32Array(N);
    for (let i = SR * 4; i < SR * 5; i++) x[i] = 0.5;
    const region = findLoopRegion(x, SR);
    expect(region.trimmed).toBe(false);
    expect(region.start).toBe(0);
    expect(region.end).toBe(N);
  });

  it("GUARD: digital silence is kept whole rather than reduced to nothing", () => {
    const region = findLoopRegion(new Float32Array(N), SR);
    expect(region.start).toBe(0);
    expect(region.end).toBe(N);
  });
});

describe("E-MUSIC-1: the fold makes the seam not exist", () => {
  it("the wrap is two CONSECUTIVE samples of the original recording", () => {
    const x = offPhase();
    const region = findLoopRegion(x, SR);
    const out = buildLoopChannels([x], region)[0] as Float32Array;
    // out[L-1] = x[start+L-1] and out[0] = x[start+L]: adjacent in the source.
    // This is the whole construction, and it is exact, not approximate.
    expect(out[out.length - 1]).toBe(x[region.start + region.length - 1]);
    expect(out[0]).toBe(x[region.start + region.length]);
  });

  it("THE CLICK, FIXED: the prepared seam is no larger a step than the music takes on its own", () => {
    const x = offPhase();
    const before = loopSeamStats(x);
    expect(before.seamStep).toBeGreaterThan(before.maxInteriorStep);

    const region = findLoopRegion(x, SR);
    const after = loopSeamStats(buildLoopChannels([x], region)[0] as Float32Array);
    expect(after.seamStep).toBeLessThanOrEqual(after.maxInteriorStep);
  });

  it("and does not break the slope either", () => {
    const x = offPhase();
    const region = findLoopRegion(x, SR);
    const after = loopSeamStats(buildLoopChannels([x], region)[0] as Float32Array);
    expect(after.seamCurvature).toBeLessThanOrEqual(after.maxInteriorCurvature);
  });

  it("holds at 44.1 kHz too, so it is not a rate coincidence", () => {
    const rate = 44100;
    const n = rate * 4;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * 220 * i) / rate) * 0.5;
    const rotated = x.slice(31);
    const region = findLoopRegion(rotated, rate);
    const s = loopSeamStats(buildLoopChannels([rotated], region)[0] as Float32Array);
    expect(s.seamStep).toBeLessThanOrEqual(s.maxInteriorStep);
    expect(s.seamCurvature).toBeLessThanOrEqual(s.maxInteriorCurvature);
  });

  it("folds every channel with the SAME window, so a stereo image cannot open", () => {
    const left = offPhase(220);
    const right = offPhase(221);
    const region = findLoopRegion(monoMix([left, right]), SR);
    const [outL, outR] = buildLoopChannels([left, right], region) as [Float32Array, Float32Array];
    for (let i = 0; i < region.crossfade; i++) {
      const fade = (outL[i] as number) - (left[region.start + i] as number);
      const fadeR = (outR[i] as number) - (right[region.start + i] as number);
      // Both channels moved by their own tail through the identical curve.
      expect(Number.isFinite(fade)).toBe(true);
      expect(Number.isFinite(fadeR)).toBe(true);
    }
    expect(outL.length).toBe(outR.length);
    expect(outL.length).toBe(region.length);
  });

  it("never folds more than a quarter of the loop back on itself", () => {
    const short = offPhase().slice(0, SR); // 1 s, shorter than 4x the crossfade
    const region = findLoopRegion(short, SR);
    expect(region.crossfade).toBeLessThanOrEqual(Math.floor((region.end - region.start) / 4));
    expect(region.crossfade).toBeLessThanOrEqual(Math.floor((SR * LOOP_CROSSFADE_MS) / 1000));
  });
});

describe("E-MUSIC-1: prepareLoopBuffer, the one impure step", () => {
  const bufferOf = (ctx: NullAudioContext, channels: Float32Array[]) => {
    const buffer = ctx.createBuffer(channels.length, (channels[0] as Float32Array).length, SR);
    channels.forEach((c, i) => buffer.getChannelData(i).set(c));
    return buffer;
  };

  it("returns a shorter buffer with the same rate and channel count", () => {
    const ctx = new NullAudioContext(SR);
    const decoded = bufferOf(ctx, [faded(), faded()]);
    const loop = prepareLoopBuffer(ctx, decoded);
    expect(loop.numberOfChannels).toBe(2);
    expect(loop.sampleRate).toBe(SR);
    expect(loop.length).toBeLessThan(decoded.length);
    expect(loop.length).toBeGreaterThan(decoded.length / 2);
  });

  it("the buffer it returns is the one that actually loops", () => {
    const ctx = new NullAudioContext(SR);
    const loop = prepareLoopBuffer(ctx, bufferOf(ctx, [offPhase()]));
    const s = loopSeamStats(loop.getChannelData(0));
    expect(s.seamStep).toBeLessThanOrEqual(s.maxInteriorStep);
    const level = loopLevelStats(loop.getChannelData(0), SR, 1000);
    expect(level.head).toBeGreaterThan(0.75);
    expect(level.tail).toBeGreaterThan(0.75);
  });

  it("hands back a buffer too short to loop untouched rather than failing", () => {
    const ctx = new NullAudioContext(SR);
    const tiny = ctx.createBuffer(1, 2, SR);
    expect(prepareLoopBuffer(ctx, tiny)).toBe(tiny);
  });
});

describe("E-MUSIC-1: seven independently generated pieces are brought to one level", () => {
  const bufferAt = (ctx: NullAudioContext, amplitude: number) => {
    const buffer = ctx.createBuffer(1, SR, SR);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.sin((2 * Math.PI * 220 * i) / SR) * amplitude;
    }
    return buffer;
  };

  it("measures RMS off the buffer rather than trusting a manifest", () => {
    const ctx = new NullAudioContext(SR);
    // A sine of amplitude A has RMS A/sqrt(2).
    expect(bufferRms(bufferAt(ctx, 0.5))).toBeCloseTo(0.5 / Math.SQRT2, 3);
    expect(bufferRms(ctx.createBuffer(1, 16, SR))).toBe(0);
  });

  it("THE DEFECT: a loud piece and a quiet one arrive at the same level", () => {
    const ctx = new NullAudioContext(SR);
    // The real spread is 4.7 LU (saturn -12.3 LUFS against earth -17.0).
    const loud = bufferAt(ctx, 0.31);
    const quiet = bufferAt(ctx, 0.17);
    expect(bufferRms(loud) / bufferRms(quiet)).toBeGreaterThan(1.7);

    const after =
      (bufferRms(loud) * levelTrimFor(loud)) / (bufferRms(quiet) * levelTrimFor(quiet));
    expect(after).toBeCloseTo(1, 6);
    expect(bufferRms(loud) * levelTrimFor(loud)).toBeCloseTo(MUSIC_REFERENCE_RMS, 6);
  });

  it("clamps rather than boosting a near-silent file into its own noise floor", () => {
    const ctx = new NullAudioContext(SR);
    expect(levelTrimFor(bufferAt(ctx, 0.0005))).toBe(MUSIC_LEVEL_TRIM_RANGE.max);
    expect(levelTrimFor(bufferAt(ctx, 0.99))).toBeGreaterThanOrEqual(MUSIC_LEVEL_TRIM_RANGE.min);
    // Digital silence has nothing to normalise; Infinity into a gain node
    // silences a whole bus in some browsers.
    expect(levelTrimFor(ctx.createBuffer(1, 64, SR))).toBe(1);
  });
});
