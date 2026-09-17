/**
 * Per-planet ambient beds (D62, D63, PRD FR-21 / AC-21.1).
 *
 * AC-21.1: "Per-planet ambient bed file exists and plays on that stop;
 * crossfades on transition."
 *
 * WHY THERE IS NO FILE. D63 planned to render the beds with ElevenLabs at build
 * time. There is no key (D88 records the same gap for the voice), so a lane that
 * shipped seven `.mp3` references would ship seven 404s and an audio rubric that
 * passes on paper. The beds are therefore SYNTHESISED: a drone stack, a filtered
 * noise wind, and a slow shimmer, tuned per planet. Seven real beds that play
 * beat seven filenames that do not.
 *
 * When the key lands, `buildBedVoice` becomes a looping buffer source over a
 * decoded file and the rest of this module - the seven-entry table, the
 * crossfade, the bus - is unchanged. Same swap shape as music.ts and voice.ts.
 *
 * The stop list comes from `src/engine/types.ts`, not from a local literal, so
 * "seven beds" cannot drift from "seven stops" (AC-21.1 counts seven).
 */

import { STOP_IDS, type StopId } from "../../engine/types.js";
import {
  clamp,
  equalPowerCrossfade,
  progress,
  seededRandom,
  type AudioBufferLike,
  type AudioContextLike,
  type AudioNodeLike,
  type GainNodeLike,
} from "./context.js";
import { label } from "./nullContext.js";

/**
 * One planet's bed. Every field is a synthesis parameter, so the table is also
 * the art direction for the audio: read down `droneHz` and you are reading the
 * route getting colder and emptier from Earth to Pluto.
 */
export interface AmbientBedSpec {
  readonly stopId: StopId;
  /** Root of the drone stack. Lower = larger, heavier world. */
  readonly droneHz: number;
  /** Harmonic ratios stacked over the root. Wider = emptier, stranger. */
  readonly partials: readonly number[];
  /** Lowpass cutoff on the whole bed. Lower = more distant, more muffled. */
  readonly filterHz: number;
  /** Amount of wind/hiss under the drone, 0..1. */
  readonly windLevel: number;
  /** Lowpass on the wind alone; separates "thin dust" from "deep gale". */
  readonly windFilterHz: number;
  /** Slow amplitude shimmer rate, Hz. Ice and rings shimmer; rock does not. */
  readonly shimmerHz: number;
  readonly shimmerDepth: number;
  /** Overall level of the bed, so quiet worlds are actually quieter. */
  readonly level: number;
  readonly note: string;
}

const BED_SEEDS: Readonly<Record<StopId, Omit<AmbientBedSpec, "stopId">>> = Object.freeze({
  earth: {
    droneHz: 98,
    partials: [1, 1.5, 2, 3],
    filterHz: 1200,
    windLevel: 0.16,
    windFilterHz: 900,
    shimmerHz: 0.09,
    shimmerDepth: 0.1,
    level: 0.5,
    note: "home: warm, close, a little city hum under it",
  },
  mars: {
    droneHz: 87,
    partials: [1, 1.5, 2.5],
    filterHz: 900,
    windLevel: 0.34,
    windFilterHz: 1600,
    shimmerHz: 0.05,
    shimmerDepth: 0.06,
    level: 0.46,
    note: "thin dry wind over hard ground; the air is real but almost nothing",
  },
  jupiter: {
    droneHz: 46,
    partials: [1, 1.25, 2, 2.5],
    filterHz: 520,
    windLevel: 0.48,
    windFilterHz: 320,
    shimmerHz: 0.03,
    shimmerDepth: 0.14,
    level: 0.58,
    note: "enormous slow storm; the lowest, largest bed in the game",
  },
  saturn: {
    droneHz: 62,
    partials: [1, 2, 3, 4.5],
    filterHz: 1800,
    windLevel: 0.2,
    windFilterHz: 2600,
    shimmerHz: 0.22,
    shimmerDepth: 0.26,
    level: 0.5,
    note: "the rings: glassy, metallic, the most shimmering bed",
  },
  uranus: {
    droneHz: 74,
    partials: [1, 1.5, 2.25],
    filterHz: 760,
    windLevel: 0.26,
    windFilterHz: 700,
    shimmerHz: 0.13,
    shimmerDepth: 0.18,
    level: 0.42,
    note: "cold, tilted, featureless; a held breath",
  },
  neptune: {
    droneHz: 55,
    partials: [1, 1.5, 2, 2.75],
    filterHz: 620,
    windLevel: 0.42,
    windFilterHz: 480,
    shimmerHz: 0.07,
    shimmerDepth: 0.12,
    level: 0.48,
    note: "the fastest winds in the solar system, heard from far away",
  },
  pluto: {
    droneHz: 41,
    partials: [1, 3, 5],
    filterHz: 420,
    windLevel: 0.1,
    windFilterHz: 240,
    shimmerHz: 0.17,
    shimmerDepth: 0.2,
    level: 0.34,
    note: "the far edge: sparse, icy, almost silent - the quietest bed",
  },
});

/** Seven beds, one per stop, keyed by the engine's own stop list. */
export const AMBIENT_BEDS: readonly AmbientBedSpec[] = STOP_IDS.map((stopId) => {
  const seed = BED_SEEDS[stopId];
  return { stopId, ...seed };
});

export function bedSpec(stopId: StopId): AmbientBedSpec {
  const found = AMBIENT_BEDS.find((b) => b.stopId === stopId);
  if (!found) throw new Error(`no ambient bed for stop: ${String(stopId)}`);
  return found;
}

/**
 * Transition length. Long: an ambient bed is the room you are in, and rooms do
 * not change in 200 ms. Short enough that the warp does not outlast it.
 */
export const AMBIENT_CROSSFADE_MS = 2200;

/** Gains of the outgoing and incoming bed at a point in the transition. */
export function ambientCrossfade(elapsedMs: number, durationMs: number): { out: number; in: number } {
  return equalPowerCrossfade(progress(elapsedMs, durationMs));
}

/** Length of the wind noise loop, in seconds. */
export const WIND_LOOP_SECONDS = 4;

/**
 * How much of the tail is folded back over the head to close the loop. A
 * quarter second: long enough that the blend is inaudible in noise this slow,
 * short enough to leave most of the lap as untouched material.
 */
export const WIND_WRAP_SECONDS = 0.25;

/**
 * The wind layer's looping noise, as plain samples.
 *
 * PURE ON PURPOSE. This is the only sound in the game that repeats, so it is
 * the only sound that can have a LOOP SEAM - and a seam is measurable, not a
 * matter of taste. Keeping the generator free of the audio context means the
 * test can read every sample and assert the seam away, instead of asserting
 * that some nodes were created.
 *
 * UR-10 - WHY THE TAIL IS FOLDED OVER THE HEAD.
 * Brown noise is a random walk. A walk starts at zero and ends wherever it
 * ended, so cutting `length` samples out of one and setting `loop = true`
 * guarantees a STEP at the wrap: the old buffer went from -0.2485 back to
 * +0.0389, a jump of 0.2873 where the largest step the noise takes anywhere
 * else in 192,000 samples is 0.0844. Rendered through Neptune's bed that
 * arrived as a 0.0579 level change in 0.54 ms, once every 4.000 s. No amount of
 * reseeding or re-tuning removes it, because it is a property of walks.
 *
 * IT IS NOT, HOWEVER, THE POP UR-10 REPORTED. That one was `MusicBus.setIndex`;
 * see the UR-10 block in music.ts. Recording the live game's master output
 * through an AudioWorklet and phase-averaging the high-passed envelope at the
 * 4 s lap, with this wrap off and then on, gave 5.0x and 6.1x the phase median
 * - indistinguishable, and both explained by the capture's own start. The seam
 * is masked because the walk's INCREMENTS are white noise of comparable size,
 * so the bed is already full of broadband edge at every sample. Fixed anyway: a
 * loop that does not join is a defect whether or not this mix hides it, and the
 * evidence is one measurement rather than an argument about audibility.
 *
 * So the walk is run for `length + wrap` samples and its last `wrap` samples
 * are equal-power crossfaded over its first `wrap`. Read what that does at the
 * two joins:
 *
 *   out[length-1] = x[length-1]   and   out[0] = x[length]
 *
 * which are CONSECUTIVE samples of one continuous walk - so wrapping around is
 * indistinguishable from playing straight on, in value and in slope alike. At
 * the other end out[wrap-1] = x[wrap-1] and out[wrap] = x[wrap], likewise
 * consecutive. The seam is not made small; it is made not to exist.
 *
 * Equal power rather than linear because the head and the far tail of a walk
 * are uncorrelated, and a linear blend of uncorrelated noise dips ~3 dB in the
 * middle - the same reasoning as `equalPowerCrossfade` for the bed transition.
 */
export function windLoopSamples(sampleRate: number, seconds = WIND_LOOP_SECONDS): Float32Array {
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000;
  const length = Math.max(1, Math.floor(rate * seconds));
  // At least two samples of overlap, and never more than half the lap.
  const wrap = Math.min(Math.floor(length / 2), Math.max(0, Math.floor(rate * WIND_WRAP_SECONDS)));

  // Brown-ish noise: white noise integrated, which is much closer to wind
  // than white is, and costs one add per sample. Run PAST the end by `wrap`
  // so there is real walk to fold back, never a repeat of the head.
  const walk = new Float32Array(length + wrap);
  const rng = seededRandom(0x2b7c19);
  let last = 0;
  for (let i = 0; i < walk.length; i++) {
    const white = rng() * 2 - 1;
    last = clamp((last + 0.02 * white) / 1.02, -1, 1);
    walk[i] = last * 3.5;
  }

  const data = walk.slice(0, length);
  if (wrap < 2) return data;
  for (let i = 0; i < wrap; i++) {
    // t runs 0..1 INCLUSIVE over the region, so the first blended sample is
    // purely tail and the last is purely head. Both joins are then exact.
    const fade = equalPowerCrossfade(i / (wrap - 1));
    data[i] = (walk[length + i] as number) * fade.out + (walk[i] as number) * fade.in;
  }
  return data;
}

interface BedVoice {
  readonly spec: AmbientBedSpec;
  readonly gain: GainNodeLike;
  readonly shimmer: GainNodeLike | null;
}

/**
 * The ambient bus. Holds at most two live beds - the one playing and the one
 * arriving - and crossfades between them.
 *
 * Beds are built LAZILY. Seven simultaneous drone stacks would be seven times
 * the oscillators for no audible gain, and the 60 fps budget (AC-22.9) is not
 * spent on things nobody can hear. `builtBeds()` reports which ones a run
 * actually created, which is what the evidence emitter measures after walking
 * the whole route.
 */
export class AmbientBus {
  private readonly voices = new Map<StopId, BedVoice>();
  private current: StopId | null = null;
  private incoming: StopId | null = null;
  private elapsedMs = 0;
  private durationMs = AMBIENT_CROSSFADE_MS;

  constructor(
    private readonly ctx: AudioContextLike,
    readonly output: AudioNodeLike,
  ) {}

  /** Every stop this bus can play. Seven, by construction (AC-21.1). */
  bedIds(): readonly StopId[] {
    return AMBIENT_BEDS.map((b) => b.stopId);
  }

  /** Stops whose nodes actually exist on the context right now. */
  builtBeds(): readonly StopId[] {
    return [...this.voices.keys()];
  }

  get activeStop(): StopId | null {
    return this.current;
  }

  get incomingStop(): StopId | null {
    return this.incoming;
  }

  get crossfading(): boolean {
    return this.incoming !== null && this.elapsedMs < this.durationMs;
  }

  /** Current linear gain of a bed. 0 for a bed that is not playing. */
  gainOf(stopId: StopId): number {
    return this.voices.get(stopId)?.gain.gain.value ?? 0;
  }

  /** Start a bed with no fade. Used once, when audio first comes up. */
  start(stopId: StopId): void {
    const voice = this.voiceFor(stopId);
    for (const [id, v] of this.voices) v.gain.gain.value = id === stopId ? voice.spec.level : 0;
    this.current = stopId;
    this.incoming = null;
    this.elapsedMs = this.durationMs;
  }

  /**
   * AC-21.1's "crossfades on transition". Starting a transition to the bed
   * already playing is a no-op; starting one while another is in flight snaps
   * the in-flight one home first, so gains can never accumulate across three
   * beds.
   */
  transitionTo(stopId: StopId, durationMs = AMBIENT_CROSSFADE_MS): void {
    if (this.current === null) {
      this.start(stopId);
      return;
    }
    if (stopId === this.current && !this.crossfading) return;
    if (this.incoming !== null) this.settle();
    if (stopId === this.current) return;

    this.voiceFor(stopId).gain.gain.value = 0;
    this.incoming = stopId;
    this.durationMs = Math.max(1, durationMs);
    this.elapsedMs = 0;
  }

  /** Step the crossfade. Called from the scene's frame loop. */
  advance(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs < 0 || this.incoming === null) return;
    this.elapsedMs = Math.min(this.durationMs, this.elapsedMs + dtMs);
    const fade = ambientCrossfade(this.elapsedMs, this.durationMs);

    const outVoice = this.current === null ? null : this.voices.get(this.current);
    const inVoice = this.voices.get(this.incoming);
    if (outVoice) outVoice.gain.gain.value = outVoice.spec.level * fade.out;
    if (inVoice) inVoice.gain.gain.value = inVoice.spec.level * fade.in;

    if (this.elapsedMs >= this.durationMs) this.settle();
  }

  /** Finish the in-flight transition immediately and release the old bed. */
  private settle(): void {
    if (this.incoming === null) return;
    const finished = this.current;
    this.current = this.incoming;
    this.incoming = null;
    this.elapsedMs = this.durationMs;

    const inVoice = this.voices.get(this.current);
    if (inVoice) inVoice.gain.gain.value = inVoice.spec.level;
    if (finished !== null && finished !== this.current) {
      const outVoice = this.voices.get(finished);
      if (outVoice) outVoice.gain.gain.value = 0;
    }
  }

  private voiceFor(stopId: StopId): BedVoice {
    const existing = this.voices.get(stopId);
    if (existing) return existing;
    const voice = this.buildBedVoice(bedSpec(stopId));
    this.voices.set(stopId, voice);
    return voice;
  }

  /**
   * THE SWAP POINT for pre-rendered beds (D63). Everything above this line is
   * about WHEN a bed plays; this method is the only thing that knows HOW one is
   * made.
   */
  private buildBedVoice(spec: AmbientBedSpec): BedVoice {
    const now = this.ctx.currentTime;
    const gain = label(this.ctx.createGain(), `ambient.bed.${spec.stopId}`);
    gain.gain.value = 0;
    gain.connect(this.output);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(spec.filterHz, now);
    filter.connect(gain);

    for (const ratio of spec.partials) {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(spec.droneHz * ratio, now);
      // A few cents of detune per partial: perfectly tuned sines beat against
      // each other and read as a test tone, not a world.
      osc.detune.setValueAtTime((ratio % 2) * 7 - 3, now);
      const partial = this.ctx.createGain();
      partial.gain.value = 1 / (spec.partials.length * ratio);
      osc.connect(partial);
      partial.connect(filter);
      osc.start(now);
    }

    if (spec.windLevel > 0) {
      const wind = this.ctx.createBufferSource();
      wind.buffer = this.windBuffer();
      wind.loop = true;
      const windFilter = this.ctx.createBiquadFilter();
      windFilter.type = "lowpass";
      windFilter.frequency.setValueAtTime(spec.windFilterHz, now);
      const windGain = this.ctx.createGain();
      windGain.gain.value = spec.windLevel;
      wind.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(gain);
      wind.start(now);
    }

    let shimmer: GainNodeLike | null = null;
    if (spec.shimmerHz > 0 && spec.shimmerDepth > 0) {
      const lfo = this.ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.setValueAtTime(spec.shimmerHz, now);
      shimmer = this.ctx.createGain();
      shimmer.gain.value = spec.shimmerDepth;
      lfo.connect(shimmer);
      shimmer.connect(filter);
      lfo.start(now);
    }

    return { spec, gain, shimmer };
  }

  private static sharedWind: WeakMap<object, AudioBufferLike> = new WeakMap();

  /** Four seconds of deterministic noise, shared by every bed on a context. */
  private windBuffer(): AudioBufferLike {
    const cached = AmbientBus.sharedWind.get(this.ctx);
    if (cached) return cached;
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * WIND_LOOP_SECONDS));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    buffer.getChannelData(0).set(windLoopSamples(this.ctx.sampleRate));
    AmbientBus.sharedWind.set(this.ctx, buffer);
    return buffer;
  }
}
