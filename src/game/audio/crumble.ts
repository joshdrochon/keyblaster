/**
 * THE ROCK COMING APART (UR-48, D31, AC-21.3).
 *
 * "Is there any reason why when the asteroids are shot down they cant make a
 * nice crumbling sound? It needs to be the most satisfying part of the game."
 *
 * WHAT WAS WRONG IS THE SHAPE, NOT THE LEVEL. What shipped was an explosion: one
 * oscillator sweeping down, a wash of white noise through a filter, a sub under
 * it and a tail. That is a bomb. UR-30 gave it mass, which it needed, and mass
 * is not what a rock breaking sounds like.
 *
 * A rock coming apart is GRANULAR. It is forty-odd small stone fragments, dry
 * and mid-to-high, scattering over a few hundred milliseconds and thinning out
 * as they go, with weight underneath. So that is what this generates: a crowd of
 * tiny struck-stone grains, each one an exponentially decaying resonance with a
 * scrap of noise at its onset, scattered in time by a decaying density and
 * darkening as they fall.
 *
 * ================== WHY THIS IS SAMPLES AND NOT NODES ==================
 *
 * The obvious build is one bandpassed noise burst per grain in the audio graph.
 * At forty grains that is a hundred and twenty nodes created in a single frame,
 * fifty-eight times a belt, on a game with a 60 fps budget (AC-22.9) and a perf
 * item already escalated. Generating the grains as SAMPLES costs one buffer
 * source per blast instead, and the arithmetic moves off the audio thread
 * entirely.
 *
 * It also makes the sound testable. Everything here is a function from a seed to
 * a `Float32Array`, so a test can read every sample and measure what the ear
 * cares about - how many onsets there are, where they sit, how the density
 * decays - rather than asserting that some nodes were created. Same reasoning as
 * `windLoopSamples` and `musicLoop`.
 *
 * ================== THE REPETITION TRAP ==================
 *
 * This fires about fifty-eight times a belt and granular textures are the WORST
 * case for repetition: the ear latches onto a grain pattern far faster than it
 * latches onto an envelope, so a crumble that is gorgeous once is gravel by word
 * thirty. Two defences, and they multiply:
 *
 *   - `CRUMBLE_VARIANTS` different buffers, each from its own seed, played in a
 *     shuffle bag so every one is heard before any repeats;
 *   - a playback-rate jitter per press, which moves the whole grain pattern in
 *     pitch AND time at once. A rate change is the one transform that a granular
 *     texture cannot shrug off, because it rewrites the intervals between grains
 *     rather than just their colour.
 *
 * D31: this is the reward at the centre of the game, so it may be satisfying and
 * it may be big, and it may never be violent. Dry stone, not detonation.
 */

import { clamp, seededRandom } from "./context.js";

/** How many distinct crumbles are baked. Each is its own seed. */
export const CRUMBLE_VARIANTS = 6;

/** Length of one crumble, in seconds. Long enough for the last grains to fall. */
export const CRUMBLE_SECONDS = 0.5;

/** Seed of the first crumble; the rest step from it. */
export const CRUMBLE_SEED = 0x3d9f21;

export interface CrumbleShape {
  /** Roughly how many fragments. The real count varies with the seed. */
  readonly grains: number;
  /**
   * Time constant of the density decay, in seconds. Small = the rock falls
   * apart at once; large = it keeps shedding. This is the single number that
   * decides whether it reads as a break or as a slide.
   */
  readonly densityTau: number;
  /** Lowest and highest fragment resonance, in Hz. Dry stone, not glass. */
  readonly loHz: number;
  readonly hiHz: number;
  /** How much darker the late fragments are than the first ones, 0..1. */
  readonly darkening: number;
  /** Shortest and longest fragment ring, in ms. */
  readonly minRingMs: number;
  readonly maxRingMs: number;
}

export const CRUMBLE_SHAPE: CrumbleShape = Object.freeze({
  grains: 64,
  densityTau: 0.15,
  loHz: 520,
  hiHz: 5200,
  darkening: 0.4,
  minRingMs: 7,
  maxRingMs: 34,
});

/**
 * One crumble, as plain samples, peak-normalised to 1.
 *
 * Normalised on purpose: the recipe's own `gain` is then the only thing that
 * decides how loud a blast is, and a reseeded crumble cannot quietly change the
 * mix. The same discipline as `levelTrimFor` for the composed music.
 */
export function crumbleSamples(
  sampleRate: number,
  seed: number = CRUMBLE_SEED,
  shape: CrumbleShape = CRUMBLE_SHAPE,
): Float32Array {
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000;
  const length = Math.max(1, Math.floor(rate * CRUMBLE_SECONDS));
  const out = new Float32Array(length);
  const rng = seededRandom(seed);

  for (let g = 0; g < shape.grains; g++) {
    // WHERE THIS FRAGMENT LANDS. An exponential, so the fragments crowd the
    // first few milliseconds and thin out - a rock breaks and then settles, it
    // does not clatter evenly.
    //
    // STRATIFIED, not drawn freely. Sixty-four independent draws clump badly by
    // luck: one baked crumble came out with a third of the onsets of its
    // siblings and a fall that stopped at 274 ms instead of 460, which is
    // audible as one variant in six sounding thin. Taking one draw from each
    // equal slice of the distribution keeps every crumble different without
    // letting any of them be sparse. Same distribution, a fraction of the
    // variance.
    const u = ((g + rng()) / shape.grains) * 0.995;
    const at = clamp(-shape.densityTau * Math.log(1 - u), 0, CRUMBLE_SECONDS * 0.92);
    const start = Math.floor(at * rate);

    // Later fragments are duller: the bright snap is the fracture itself, and
    // what follows is tumbling.
    const age = at / CRUMBLE_SECONDS;
    const spread = Math.log(shape.hiHz / shape.loHz);
    const hz = shape.loHz * Math.exp(rng() * spread) * (1 - shape.darkening * age);

    // Small fragments ring short and bright, large ones longer and lower.
    const ringMs =
      shape.minRingMs + (shape.maxRingMs - shape.minRingMs) * (1 - hz / shape.hiHz) * rng();
    const tau = Math.max(0.002, ringMs / 1000);

    // Quieter as the fall goes on, and quieter the higher it sits, so the
    // texture does not turn into a hiss of tiny bright ticks.
    const amp = (0.35 + 0.65 * rng()) * Math.exp(-at / (shape.densityTau * 2.2)) * (1 - 0.28 * (hz / shape.hiHz));

    const w = (2 * Math.PI * hz) / rate;
    const decay = Math.exp(-1 / (tau * rate));
    const grainLength = Math.min(length - start, Math.floor(tau * rate * 5));

    // A scrap of noise across the first few samples rather than a clean
    // impulse: a struck stone has grit in its attack, and a pure impulse
    // response reads as a tuned percussion instrument.
    let y1 = 0;
    let y2 = 0;
    const coeff = 2 * decay * Math.cos(w);
    const decay2 = decay * decay;
    for (let n = 0; n < grainLength; n++) {
      const excite = n < 3 ? amp * (rng() * 2 - 1) : 0;
      const y = coeff * y1 - decay2 * y2 + excite;
      y2 = y1;
      y1 = y;
      out[start + n] = (out[start + n] as number) + y;
    }
  }

  // Peak-normalise. A crumble that came back quieter because its seed happened
  // to scatter its fragments would be a mix change nobody asked for.
  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(out[i] as number));
  if (peak > 0) {
    const scale = 1 / peak;
    for (let i = 0; i < length; i++) out[i] = (out[i] as number) * scale;
  }

  // The last grains must not be cut off mid-ring: a hard edge at the end of the
  // buffer is a click, and this buffer ends while fragments are still sounding.
  const fade = Math.floor(rate * 0.03);
  for (let i = 0; i < fade; i++) {
    const k = length - fade + i;
    out[k] = (out[k] as number) * (1 - i / fade);
  }
  return out;
}

/** The seed of the nth baked crumble. Spread so no two share a grain pattern. */
export function crumbleSeed(index: number): number {
  return (CRUMBLE_SEED + Math.max(0, Math.floor(index)) * 0x9e3779b1) >>> 0;
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/**
 * When each fragment lands, in seconds.
 *
 * THE MEASUREMENT THAT SEPARATES A CRUMBLE FROM AN EXPLOSION, and the reason
 * this is exported rather than living in the test: an explosion has ONE onset
 * and a decaying tail; a crumble has dozens, spread out and thinning. Counting
 * them is how a test can tell which one it is holding without anyone having to
 * agree on what "granular" sounds like.
 *
 * An onset is a rise in the local envelope that clears `threshold` times the
 * envelope's own running level, with a short refractory gap so one fragment's
 * attack is not counted twice.
 */
export function onsetTimes(
  samples: Float32Array,
  sampleRate: number,
  threshold = 1.6,
  refractoryMs = 6,
): number[] {
  const win = Math.max(1, Math.floor(sampleRate * 0.002));
  const refractory = Math.floor((refractoryMs / 1000) * sampleRate);
  const onsets: number[] = [];
  let previous = 0;
  let last = -refractory;
  for (let i = 0; i + win < samples.length; i += win) {
    let sum = 0;
    for (let n = 0; n < win; n++) sum += (samples[i + n] as number) ** 2;
    const level = Math.sqrt(sum / win);
    if (level > previous * threshold && level > 0.01 && i - last >= refractory) {
      onsets.push(i / sampleRate);
      last = i;
    }
    previous = Math.max(level, previous * 0.6);
  }
  return onsets;
}
