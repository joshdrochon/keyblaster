/**
 * Turning a COMPOSED PIECE into a LOOP (E-MUSIC-1, AC-21.2, UR-12).
 *
 * `scripts/render-music.mjs` asks ElevenLabs for a piece that "loops seamlessly
 * with no gap or change at the loop point". Asking is not evidence, so every
 * one of the seven was measured before a line of this file was written. What
 * the measurement found is NOT the defect anyone expected:
 *
 *   track     raw seam step   largest step elsewhere   ratio
 *   earth       0.00004            0.41640             0.0001
 *   jupiter     0.00000            0.38579             0
 *   mars        0.00000            0.64903             0
 *   neptune     0.00078            0.59245             0.0013
 *   pluto       0.00170            0.39895             0.0043
 *   saturn      0.00000            0.47537             0
 *   uranus      0.00001            0.46681             0.0000
 *
 * Not one of them has a sample-step discontinuity at the wrap. They cannot:
 * every file begins and ends in DIGITAL SILENCE - 242 to 1203 samples of MP3
 * encoder delay at the head, 0 to 748 of padding at the tail. A join between
 * two silences has no step.
 *
 * THE DEFECT IS THE OPPOSITE ONE - A HOLE, NOT A CLICK. Three of the seven end
 * with a long musical fade-out, and one of those also fades in. Measured as RMS
 * over a window at each end, relative to the track's own overall RMS:
 *
 *   track      first 1s / last 1s        first 2s / last 2s
 *   earth        0.50 / 0.06               0.66 / 0.42     fades in AND out
 *   mars         1.08 / 0.01               1.03 / 0.07     fades out
 *   uranus       0.95 / 0.05               0.85 / 0.19     fades out
 *   jupiter      1.35 / 0.57               1.28 / 0.66
 *   neptune      1.02 / 0.83               1.04 / 0.87
 *   pluto        1.23 / 0.69               1.00 / 0.84
 *   saturn       0.99 / 0.97               1.01 / 0.96
 *
 * Looped raw, earth/mars/uranus die away to nothing and come back every 40
 * seconds. That is not a click but it is exactly as wrong: the music audibly
 * STOPS AND RESTARTS, which is the thing a loop exists not to do.
 *
 * ================== WHAT THIS MODULE DOES ABOUT IT ==================
 *
 * Two steps, both pure, both measurable:
 *
 * 1. TRIM. Find where the piece is actually playing - the first and last window
 *    whose level reaches a fraction of the track's own median window level -
 *    and loop only that. The fade-in and the fade-out are simply not in the
 *    loop. The threshold is relative to the track's OWN median, never an
 *    absolute dB, so a quiet piece is not mistaken for a fade.
 *
 * 2. FOLD. Trimming leaves a hard cut mid-phrase, which IS a click. So the last
 *    `wrap` samples of the trimmed region are equal-power crossfaded over its
 *    first `wrap`, exactly as `windLoopSamples` does for the ambient wind bed.
 *    Read what that does at the two joins, with x the trimmed region and
 *    L = length - wrap the final loop length:
 *
 *      out[L-1] = x[L-1]   and   out[0] = x[L]
 *
 *    CONSECUTIVE SAMPLES OF THE ORIGINAL RECORDING. Wrapping around is
 *    indistinguishable from playing straight on, in value and in slope alike.
 *    At the other end out[wrap-1] = x[wrap-1] and out[wrap] = x[wrap],
 *    likewise consecutive. The seam is not made small; it is made not to exist,
 *    and `tests/unit/audio/musicLoop.test.ts` asserts it against the signal's
 *    own largest interior step rather than against a tuned constant.
 *
 * Equal power rather than linear for the same reason as everywhere else in this
 * package: two uncorrelated stretches blended linearly dip ~3 dB in the middle.
 *
 * PURE ON PURPOSE. Nothing here touches an `AudioContext` except
 * `prepareLoopBuffer`, which only allocates the destination. Everything that
 * decides a number is a function from samples to numbers, so a test can read
 * every sample of the result - the same reason `windLoopSamples` is pure.
 */

import {
  clamp,
  equalPowerCrossfade,
  type AudioBufferLike,
  type AudioContextLike,
} from "./context.js";

/** Window the level envelope is measured over. Short enough to find a cut. */
export const LOOP_WINDOW_MS = 50;

/**
 * A window counts as "the piece playing" at this fraction of the track's own
 * MEDIAN window level. Half is well under any sustained passage and well over
 * the tail of a fade, which is where every one of the seven sits.
 */
export const LOOP_LEVEL_FRACTION = 0.5;

/**
 * Crossfade across the join. 400 ms: long enough that a cut mid-phrase reads as
 * a blend rather than an edit, short enough that two bars are never audibly
 * playing at once. Only this much of the trimmed material is ever doubled.
 */
export const LOOP_CROSSFADE_MS = 400;

/**
 * The trim may never take more than this fraction of the piece away. A guard,
 * not a tuning knob: if the envelope says most of a track is below the
 * threshold then the threshold is wrong for that track, and half a piece of
 * music is a worse answer than the whole piece with its fade left in.
 */
export const LOOP_MIN_KEPT_FRACTION = 0.5;

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/**
 * Sample-level continuity across the wrap, and the same statistic measured
 * everywhere else in the buffer to compare it against.
 *
 * The comparison is the whole point. An absolute threshold would be a number
 * someone chose; the buffer's own largest interior step is a number the music
 * chose, and a wrap that moves no further than the music already moves between
 * two adjacent samples cannot be heard as an edge.
 */
export interface LoopSeamStats {
  /** |x[0] - x[n-1]|: the move the wrap makes. */
  readonly seamStep: number;
  /** The largest such move anywhere else in the buffer. */
  readonly maxInteriorStep: number;
  /** Second difference at the wrap: catches a seam that breaks the SLOPE. */
  readonly seamCurvature: number;
  readonly maxInteriorCurvature: number;
}

/** Continuity of `samples` treated as a loop. See `LoopSeamStats`. */
export function loopSeamStats(samples: Float32Array): LoopSeamStats {
  const n = samples.length;
  if (n < 3) {
    return { seamStep: 0, maxInteriorStep: 0, seamCurvature: 0, maxInteriorCurvature: 0 };
  }
  const at = (i: number): number => samples[((i % n) + n) % n] as number;

  let maxInteriorStep = 0;
  for (let i = 1; i < n; i++) {
    const d = Math.abs(at(i) - at(i - 1));
    if (d > maxInteriorStep) maxInteriorStep = d;
  }
  let maxInteriorCurvature = 0;
  for (let i = 2; i < n; i++) {
    const d = Math.abs(at(i) - 2 * at(i - 1) + at(i - 2));
    if (d > maxInteriorCurvature) maxInteriorCurvature = d;
  }
  return {
    seamStep: Math.abs(at(0) - at(-1)),
    maxInteriorStep,
    seamCurvature: Math.abs(at(1) - 2 * at(0) + at(-1)),
    maxInteriorCurvature,
  };
}

/** RMS of every `windowMs` window, in order. The level envelope of a piece. */
export function windowLevels(
  samples: Float32Array,
  sampleRate: number,
  windowMs = LOOP_WINDOW_MS,
): Float32Array {
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000;
  const size = Math.max(1, Math.floor((rate * Math.max(1, windowMs)) / 1000));
  const count = Math.max(1, Math.floor(samples.length / size));
  const levels = new Float32Array(count);
  for (let w = 0; w < count; w++) {
    let sq = 0;
    const from = w * size;
    for (let i = from; i < from + size; i++) {
      const v = samples[i] as number;
      sq += v * v;
    }
    levels[w] = Math.sqrt(sq / size);
  }
  return levels;
}

/** Median of a level envelope. The reference the trim threshold is read off. */
export function medianLevel(levels: Float32Array): number {
  if (levels.length === 0) return 0;
  const sorted = Float32Array.from(levels).sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * How loud each end of a loop is relative to the middle. This is the number
 * that says whether a loop DIPS - the defect the seven tracks actually had, and
 * the one a sample-step measurement is blind to.
 *
 * 1 means "this end is as loud as the piece typically is". The raw earth track
 * measured 0.06 at its tail; a loop that ends at 0.06 and restarts is a hole.
 */
export interface LoopLevelStats {
  readonly head: number;
  readonly tail: number;
  /** The median window level the two are expressed as a fraction of. */
  readonly median: number;
}

export function loopLevelStats(
  samples: Float32Array,
  sampleRate: number,
  windowMs = 1000,
): LoopLevelStats {
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000;
  const size = Math.min(samples.length, Math.max(1, Math.floor((rate * windowMs) / 1000)));
  const rms = (from: number, to: number): number => {
    let sq = 0;
    for (let i = from; i < to; i++) {
      const v = samples[i] as number;
      sq += v * v;
    }
    return to > from ? Math.sqrt(sq / (to - from)) : 0;
  };
  const median = medianLevel(windowLevels(samples, rate, LOOP_WINDOW_MS));
  if (median <= 0) return { head: 0, tail: 0, median: 0 };
  return {
    head: rms(0, size) / median,
    tail: rms(samples.length - size, samples.length) / median,
    median,
  };
}

// ---------------------------------------------------------------------------
// Trim and fold
// ---------------------------------------------------------------------------

export interface LoopRegion {
  /** First sample of the looped material. */
  readonly start: number;
  /** One past the last. `end - start` samples are used in total... */
  readonly end: number;
  /** ...of which the last `crossfade` are folded back over the first. */
  readonly crossfade: number;
  /** Final loop length: `end - start - crossfade`. */
  readonly length: number;
  /** True when the envelope told us nothing and the whole piece is kept. */
  readonly trimmed: boolean;
}

export interface LoopRegionOptions {
  readonly windowMs?: number;
  readonly levelFraction?: number;
  readonly crossfadeMs?: number;
  readonly minKeptFraction?: number;
}

/**
 * Where to loop `samples` from and to.
 *
 * The trim is symmetric and threshold-based rather than clever: the first and
 * last window at or above `levelFraction` of the median. Beat detection would
 * be better and is not something this lane can verify by measurement, and an
 * unverifiable improvement is not an improvement.
 */
export function findLoopRegion(
  samples: Float32Array,
  sampleRate: number,
  options: LoopRegionOptions = {},
): LoopRegion {
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000;
  const n = samples.length;
  const windowMs = options.windowMs ?? LOOP_WINDOW_MS;
  const fraction = clamp(options.levelFraction ?? LOOP_LEVEL_FRACTION, 0, 1);
  const minKept = clamp(options.minKeptFraction ?? LOOP_MIN_KEPT_FRACTION, 0, 1);
  const size = Math.max(1, Math.floor((rate * Math.max(1, windowMs)) / 1000));

  const levels = windowLevels(samples, rate, windowMs);
  const threshold = medianLevel(levels) * fraction;

  let firstWindow = 0;
  while (firstWindow < levels.length && (levels[firstWindow] as number) < threshold) firstWindow++;
  let lastWindow = levels.length - 1;
  while (lastWindow > firstWindow && (levels[lastWindow] as number) < threshold) lastWindow--;

  let start = firstWindow * size;
  let end = Math.min(n, (lastWindow + 1) * size);
  let trimmed = true;

  // The guard. Either the threshold made no sense for this piece or the piece
  // is mostly silence; either way the whole thing is the honest answer.
  if (threshold <= 0 || end - start < n * minKept) {
    start = 0;
    end = n;
    trimmed = false;
  }

  const span = end - start;
  const wanted = Math.floor((rate * Math.max(0, options.crossfadeMs ?? LOOP_CROSSFADE_MS)) / 1000);
  // Never fold more than a quarter of the loop back on itself: past that the
  // doubling stops being a join and starts being a second arrangement.
  const crossfade = Math.max(0, Math.min(wanted, Math.floor(span / 4)));

  return { start, end, crossfade, length: span - crossfade, trimmed };
}

/**
 * Cut `region` out of every channel and fold its tail over its head.
 *
 * Every channel is folded with the SAME window, which is why the fold cannot
 * open a stereo image: both sides see the identical gain curve at every sample.
 */
export function buildLoopChannels(
  channels: readonly Float32Array[],
  region: LoopRegion,
): Float32Array[] {
  const { start, crossfade, length } = region;
  return channels.map((source) => {
    const out = source.slice(start, start + length);
    if (crossfade < 2) return out;
    for (let i = 0; i < crossfade; i++) {
      // t runs 0..1 INCLUSIVE, so the first blended sample is purely tail and
      // the last is purely head. Both joins are then exact. Same construction
      // and same reasoning as `windLoopSamples`.
      const fade = equalPowerCrossfade(i / (crossfade - 1));
      const tail = source[start + length + i] as number;
      const head = source[start + i] as number;
      out[i] = tail * fade.out + head * fade.in;
    }
    return out;
  });
}

/** Every channel of a decoded buffer, as plain arrays. */
export function channelsOf(buffer: AudioBufferLike): Float32Array[] {
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  return channels;
}

/** Channel 0, or the mean of all channels. What the trim envelope is read from. */
export function monoMix(channels: readonly Float32Array[]): Float32Array {
  const first = channels[0];
  if (first === undefined) return new Float32Array(0);
  if (channels.length === 1) return first;
  const out = new Float32Array(first.length);
  for (const channel of channels) {
    for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) + (channel[i] as number);
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) / channels.length;
  return out;
}

/**
 * A decoded track, in, a LOOPABLE buffer out.
 *
 * The only impure function in the file, and all it does is allocate the
 * destination: every decision above it is a function of samples.
 */
export function prepareLoopBuffer(
  ctx: AudioContextLike,
  decoded: AudioBufferLike,
  options: LoopRegionOptions = {},
): AudioBufferLike {
  const channels = channelsOf(decoded);
  if (channels.length === 0 || decoded.length < 4) return decoded;
  const region = findLoopRegion(monoMix(channels), decoded.sampleRate, options);
  if (region.length < 2) return decoded;
  const looped = buildLoopChannels(channels, region);
  const buffer = ctx.createBuffer(looped.length, region.length, decoded.sampleRate);
  for (let c = 0; c < looped.length; c++) {
    buffer.getChannelData(c).set(looped[c] as Float32Array);
  }
  return buffer;
}
