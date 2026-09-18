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
 *
 * ================== UR-66: TWO MATERIALS, NOT ONE SOUND ==================
 *
 * UR-66 reports that the shipped grain set reads as ICE, that this is RIGHT at
 * the frozen stops and wrong at the rocky ones, and asks for a drier, heavier
 * rock beside it. So this is ADDITIVE: `ICE_CRUMBLE_SHAPE` is the shipped set,
 * byte-for-byte, and `ROCK_CRUMBLE_SHAPE` is a second band of resonances next
 * to it. Retuning the shipped one to split the difference would lose the half
 * that already works, which is the one thing UR-66 asks to keep.
 *
 * THE SELECTOR IS THE DEBRIS TYPE, NEVER THE STOP. `MATERIAL_BY_DEBRIS_TYPE`
 * below maps every row of `render/asteroid.ts`'s FR-12b table. Jupiter carries
 * four materials on one board, so a per-stop switch would give carbonaceous,
 * silicate, metal and Trojan rock one sound between them and would have been
 * wrong on the day it shipped.
 *
 * THE ENVELOPE IS SHARED BY CONSTRUCTION, WHICH IS WHY THE SHARDS STILL FIT.
 * `render/particles.ts` schedules 12 shard waves against the measured fall of
 * this file (UR-48: fracture 0 ms, debris 15-22 ms, density decay 150 ms, last
 * fragment 400-460 ms). Every material therefore shares `grains`, `densityTau`
 * and `CRUMBLE_SECONDS`, and every material is baked from the SAME seeds - so
 * the per-grain random draws run in the same order and land each fragment at
 * the same instant. Only the resonances, the ring lengths and the darkening
 * differ. A material that moved `densityTau` would move the picture too, and
 * `rendered.test.ts` fails on exactly that.
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

/**
 * THE SHIPPED SOUND (UR-48), AND UR-66 KEEPS IT EXACTLY.
 *
 * Bright, short-ringing fragments over two and a half octaves. UR-66 reports
 * this reads as ice and lands well where the debris IS ice, so not one number
 * here may move; `rendered.test.ts` pins all six baked buffers to the
 * checksums they had before UR-66 was touched.
 */
export const ICE_CRUMBLE_SHAPE: CrumbleShape = Object.freeze({
  grains: 64,
  densityTau: 0.15,
  loHz: 520,
  hiHz: 5200,
  darkening: 0.4,
  minRingMs: 7,
  maxRingMs: 34,
});

/**
 * UR-66's SECOND MATERIAL: dry, heavy, crumbling stone.
 *
 * Four numbers move and three do not, and which is which is the whole design.
 *
 * MOVED. The resonance band drops from 520-5200 Hz to 300-2200 Hz - most of an
 * octave down at the bottom and more than an octave off the top, which is where
 * the icy glitter lived. `darkening` rises 0.4 -> 0.5 so the fall dulls faster
 * than an ice fall does; a rock's late fragments are tumbling, not tinkling.
 * `maxRingMs` comes in 34 -> 32 with `minRingMs` up 7 -> 8, narrowing the
 * spread: stone rings less freely than ice, and a wide spread of ring lengths
 * is part of what makes the shipped set sparkle.
 *
 * Measured over the six baked buffers at 48 kHz, against the ice set built from
 * the same seeds: median rolloff 298-472 Hz against 550-916 Hz (0.515-0.542x,
 * every seed, no overlap), the fraction of energy above 2 kHz down from
 * 1.79-3.35% to 0.020-0.088% (38x to 113x), and the fraction below 400 Hz up
 * from 1.02-3.36% to 27.6-56.2% (17x to 33x). Duller on top and heavier
 * underneath: a different material, not a detuning of the same one.
 *
 * NOT MOVED, and these are load-bearing: `grains`, `densityTau`, and the seeds
 * this is baked from. Those three together are the fall's shape in TIME, and
 * the shard schedule in `render/particles.ts` is built against it.
 */
export const ROCK_CRUMBLE_SHAPE: CrumbleShape = Object.freeze({
  grains: 64,
  densityTau: 0.15,
  loHz: 300,
  hiHz: 2200,
  darkening: 0.5,
  minRingMs: 8,
  maxRingMs: 32,
});

/**
 * Kept as the name the rest of the program already imports, and kept pointing
 * at ice: every existing caller wanted the shipped sound and still gets it.
 */
export const CRUMBLE_SHAPE: CrumbleShape = ICE_CRUMBLE_SHAPE;

/**
 * WHICH MATERIALS EXIST (UR-66).
 *
 * TWO, and the count is a decision rather than a floor. Ice and rock are what
 * the report distinguishes and they are what the table splits into. A third for
 * M-type nickel-iron was considered and declined: it is one row of thirteen,
 * present at one stop, described by FR-12b as the rare one, and nobody has
 * reported it sounding wrong. Every extra material is a second grain set to
 * bake per context (six 0.5 s buffers, ~576 kB at 48 kHz) and, because UR-66
 * closes on a human listening rather than on a number, another sound somebody
 * has to sit down and approve. Metal sits with rock until there is a report
 * that says it should not.
 */
export type CrumbleMaterial = "ice" | "rock";

/** Every material, for harnesses that must sweep rather than sample (rule 5). */
export const CRUMBLE_MATERIALS: readonly CrumbleMaterial[] = Object.freeze([
  "ice",
  "rock",
] as const);

/** The grain set each material is baked from. Total over `CrumbleMaterial`. */
export const CRUMBLE_SHAPES: Readonly<Record<CrumbleMaterial, CrumbleShape>> = Object.freeze({
  ice: ICE_CRUMBLE_SHAPE,
  rock: ROCK_CRUMBLE_SHAPE,
});

/**
 * Every debris type in `render/asteroid.ts`'s FR-12b table, as a literal union.
 *
 * WHY THE IDS ARE RESTATED HERE RATHER THAN DERIVED. `DEBRIS_BY_STOP` is typed
 * `Record<StopId, readonly DebrisType[]>` with `id: string`, so there is no
 * literal union to import - and audio importing the render layer to read a
 * colour table would be the wrong dependency anyway. Restating them buys the
 * thing that matters: `Record<DebrisTypeId, CrumbleMaterial>` below is a TOTAL
 * map, so a material cannot be omitted without the compiler saying so, and
 * `rendered.test.ts` asserts this union and the real table have exactly the
 * same members in both directions. A row added to FR-12b turns that test red;
 * it cannot quietly inherit a sound nobody picked.
 */
export type DebrisTypeId =
  | "mars-regolith"
  | "c-type"
  | "s-type"
  | "m-type"
  | "jupiter-trojan"
  | "saturn-ice-chunk"
  | "saturn-dust-grain"
  | "uranus-dark-ice"
  | "neptune-icy-body"
  | "neptune-ring-dust"
  | "kuiper-water-ice"
  | "kuiper-methane-ammonia-ice"
  | "small-kbo";

/**
 * UR-66's MAPPING: what each debris type is made of, as far as the ear cares.
 *
 * Read down the FR-12b `label` column and the split is the report's own:
 * regolith, carbonaceous, silicate and metal are stone; ring ice, dark icy ring
 * particles, icy bodies and the Kuiper ices are frozen.
 *
 * THE TWO JUDGEMENT CALLS, both written down because neither is forced:
 *
 *   `jupiter-trojan` is ROCK. FR-12b calls it dark and reddish with some water
 *   ice, so it could go either way; it sits on Jupiter's board with three
 *   stone types and is drawn in their family of browns, and a lone icy shatter
 *   in the middle of a rocky belt is the exact complaint UR-66 makes.
 *
 *   `small-kbo` is ICE. Kuiper objects are ice-and-rock mixtures, so this could
 *   also go either way; it sits on Pluto's board, which is the one UR-66 names
 *   as already right, and putting a stone crumble on one of Pluto's three types
 *   would break the half of the game the report asks to leave alone.
 *
 * The two dust rows (`carriesWord: false`) are mapped for totality rather than
 * for sound: nothing ever blasts a dust grain.
 */
export const MATERIAL_BY_DEBRIS_TYPE: Readonly<Record<DebrisTypeId, CrumbleMaterial>> =
  Object.freeze({
    "mars-regolith": "rock",
    "c-type": "rock",
    "s-type": "rock",
    "m-type": "rock",
    "jupiter-trojan": "rock",
    "saturn-ice-chunk": "ice",
    "saturn-dust-grain": "ice",
    "uranus-dark-ice": "ice",
    "neptune-icy-body": "ice",
    "neptune-ring-dust": "ice",
    "kuiper-water-ice": "ice",
    "kuiper-methane-ammonia-ice": "ice",
    "small-kbo": "ice",
  });

/**
 * What an UNRECOGNISED debris id sounds like, and why it is a named constant.
 *
 * A blast cannot throw - a child destroying a rock is the last place in the
 * program that may fail - so something has to come back for an id this map has
 * never heard of. Ice, because ice is what the game shipped for every type
 * before UR-66: an unmapped type sounds exactly as it does today rather than
 * silently acquiring the new sound. It is a chosen fallback, not a default, and
 * the totality test is what stops it ever being reached in this build.
 */
export const UNMAPPED_DEBRIS_MATERIAL: CrumbleMaterial = "ice";

/** Whether this id is one the FR-12b mapping above covers. */
export function isMappedDebrisType(id: string): id is DebrisTypeId {
  return Object.prototype.hasOwnProperty.call(MATERIAL_BY_DEBRIS_TYPE, id);
}

/**
 * The material to crumble for the debris type that was destroyed (UR-66).
 *
 * `undefined` is the caller that has no debris type to give - a UI blast, a
 * test, a cue emitted before a rock was resolved - and gets the shipped sound.
 */
export function crumbleMaterialFor(debrisTypeId: string | undefined | null): CrumbleMaterial {
  if (typeof debrisTypeId !== "string") return UNMAPPED_DEBRIS_MATERIAL;
  return isMappedDebrisType(debrisTypeId)
    ? MATERIAL_BY_DEBRIS_TYPE[debrisTypeId]
    : UNMAPPED_DEBRIS_MATERIAL;
}

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
