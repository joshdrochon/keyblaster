/**
 * Adaptive music (D62, PRD FR-21 / AC-21.2).
 *
 * AC-21.2: ">= 3 intensity layers; intensity index is a function of live
 * asteroid count and combo". The second clause is the testable one and it is
 * why `intensityIndex` is a PURE function of two numbers - no scene, no
 * context, no clock. The layers themselves are three stacked gains under the
 * music bus; the index only decides where each gain is heading.
 *
 * LAYERS ARE CUMULATIVE, not exclusive. Index 1 does not mean "play layer 1",
 * it means "bed and pulse are up, drive is down". That is what keeps an
 * intensity change feeling like the same piece of music getting busier rather
 * than a different track starting.
 *
 * ================== THE COMPOSED TRACKS (E-MUSIC-1, UR-12) ==================
 *
 * D63 calls music "composed files with intensity layers". Seven pieces now
 * exist - one per stop, in `src/content/audio/music/` - and this file plays
 * them. The header used to say the swap was "three looping
 * `AudioBufferSourceNode`s". It is ONE, and the difference matters:
 *
 *   THREE INDEPENDENTLY GENERATED CLIPS CANNOT STACK. They would be in
 *   different keys, at different tempos, with unrelated phase. Playing them
 *   together is noise, not music. A generative model gives you a performance,
 *   not stems.
 *
 * So each stop is ONE recording, and the three layers are derived from that
 * same buffer: one looping source feeding three parallel filter bands - a
 * low-passed `bed`, a mid `pulse`, a high `drive` - each into the layer gain
 * `layerTargetGains` was already driving. Nothing about AC-21.2 changes. The
 * layers are still three, still cumulative, still crossfaded by an index that
 * is a pure function of live state. What changes is that the bands sum back
 * towards the whole recording instead of towards a chord of oscillators, so
 * rising intensity is heard as the piece opening up - more level and more
 * brightness - and the layers can never drift out of phase, because they are
 * one performance.
 *
 * THE SYNTHESISED STACK IS STILL HERE and is still what a build with no music
 * files plays. That is deliberate: "this build shipped no tracks" and "this
 * track would not load" are different situations and they get different
 * answers. See `MusicBus`'s constructor.
 */

import {
  clamp,
  equalPowerCrossfade,
  progress,
  type AudioBufferLike,
  type AudioBufferSourceNodeLike,
  type AudioContextLike,
  type AudioNodeLike,
  type BiquadKind,
  type GainNodeLike,
  type OscillatorWave,
} from "./context.js";
import { label } from "./nullContext.js";
import { levelTrimFor, prepareLoopBuffer, type LoopRegionOptions } from "./musicLoop.js";

export type MusicLayerId = "bed" | "pulse" | "drive";

export interface MusicLayerSpec {
  readonly id: MusicLayerId;
  /** Index at which this layer is fully up. Layer i is up when index >= i. */
  readonly activeFrom: number;
  /** Linear gain when the layer is up. Mixed so three-up is not three-loud. */
  readonly activeGain: number;
  readonly wave: OscillatorWave;
  /** Root frequencies, in Hz. A chord, not a note, so a layer has body. */
  readonly partialsHz: readonly number[];
  readonly filterHz: number;
  /** Tremolo rate in Hz; 0 for a still layer. Gives each layer its motion. */
  readonly pulseHz: number;
  /**
   * THE COMPOSED-TRACK SIDE OF THE LAYER: which slice of the one recording this
   * layer is. `bed` takes the low end, `pulse` the middle, `drive` the top, so
   * the three bands SUM back towards the whole piece rather than towards three
   * copies of it. That is what makes the stack cumulative with real audio: at
   * index 0 you hear a muffled, distant version of the track; at index 2 you
   * hear all of it, brighter and louder. It is one performance either way.
   */
  readonly band: BiquadKind;
  readonly bandHz: number;
  readonly bandQ: number;
  /**
   * Make-up gain for the band, applied BEFORE the layer gain so `layerTargetGains`
   * stays the single authority on how far up a layer is. A wide bandpass and a
   * high-pass throw away most of a track's energy; without this the two upper
   * layers would be inaudible next to the bed and "busier" would not be heard.
   */
  readonly bandGain: number;
  readonly note: string;
}

/** AC-21.2's floor and the count the evidence reports. */
export const MUSIC_LAYERS: readonly MusicLayerSpec[] = [
  {
    id: "bed",
    activeFrom: 0,
    activeGain: 0.22,
    wave: "sine",
    // A minor-add9 drone: open, unresolved, never triumphant and never grim.
    partialsHz: [110, 164.81, 220, 246.94],
    filterHz: 900,
    pulseHz: 0,
    band: "lowpass",
    bandHz: 700,
    bandQ: 0.7,
    bandGain: 1,
    note: "always present; the room the whole game sits in",
  },
  {
    id: "pulse",
    activeFrom: 1,
    activeGain: 0.16,
    wave: "triangle",
    partialsHz: [220, 329.63, 440],
    filterHz: 1800,
    pulseHz: 2.2,
    band: "bandpass",
    bandHz: 1500,
    bandQ: 0.6,
    bandGain: 1.8,
    note: "a heartbeat under the bed; arrives when the belt gets busy",
  },
  {
    id: "drive",
    activeFrom: 2,
    activeGain: 0.14,
    wave: "sawtooth",
    partialsHz: [82.41, 110, 164.81],
    filterHz: 2600,
    pulseHz: 4.4,
    band: "highpass",
    bandHz: 2800,
    bandQ: 0.7,
    bandGain: 1.4,
    note: "low driving movement; the top of the belt, or a long combo",
  },
];

export const MUSIC_LAYER_COUNT = MUSIC_LAYERS.length;
export const MAX_INTENSITY_INDEX = MUSIC_LAYER_COUNT - 1;

/**
 * How the two inputs combine. Asteroids dominate because they are what is
 * actually happening on screen; the combo contributes at half weight so a calm
 * screen with a long streak still lifts, but never as hard as six live rocks.
 * The combo is capped at 10 to match the scoring multiplier (AC-6c.1).
 */
export const INTENSITY_WEIGHTS = Object.freeze({
  perAsteroid: 1,
  perComboPoint: 0.5,
  comboCap: 10,
});

/** Pressure at which each index takes over. Index 0 is everything below [0]. */
export const INTENSITY_THRESHOLDS: readonly number[] = [4, 8];

/**
 * Musical pressure from the live state. Exposed because it is the interesting
 * number: `intensityIndex` is just this against two thresholds, and testing the
 * two separately is what keeps the thresholds tunable without rewriting tests.
 */
export function intensityPressure(liveAsteroids: number, combo: number): number {
  const rocks = clamp(liveAsteroids, 0, 64) * INTENSITY_WEIGHTS.perAsteroid;
  const streak = clamp(combo, 0, INTENSITY_WEIGHTS.comboCap) * INTENSITY_WEIGHTS.perComboPoint;
  return rocks + streak;
}

/**
 * AC-21.2. Pure function of live asteroid count and combo. Monotone
 * non-decreasing in both inputs - a test asserts that across the whole grid,
 * because a non-monotone intensity curve is the bug you cannot hear in a demo
 * and cannot stop hearing in a long session.
 */
export function intensityIndex(liveAsteroids: number, combo: number): number {
  const pressure = intensityPressure(liveAsteroids, combo);
  let index = 0;
  for (const threshold of INTENSITY_THRESHOLDS) {
    if (pressure >= threshold) index++;
  }
  return clamp(index, 0, MAX_INTENSITY_INDEX);
}

/** Target gain of every layer at an index. Cumulative: index 2 has all three. */
export function layerTargetGains(index: number): number[] {
  const i = clamp(Math.floor(index), 0, MAX_INTENSITY_INDEX);
  return MUSIC_LAYERS.map((layer) => (i >= layer.activeFrom ? layer.activeGain : 0));
}

/**
 * Gains partway through a move from one index to another (AC-21.2's
 * "crossfaded by intensity"). Equal-power, so an intensity change never dips.
 * At t=0 this is exactly `layerTargetGains(from)`, at t=1 exactly
 * `layerTargetGains(to)`; in between, layers that are up in both stay up.
 */
export function layerGainsDuringChange(from: number, to: number, t: number): number[] {
  return crossfadeGains(layerTargetGains(from), layerTargetGains(to), t);
}

/**
 * The same equal-power move, but between two sets of ACTUAL GAINS rather than
 * two indices.
 *
 * UR-10 - WHY THIS EXISTS. `layerGainsDuringChange` can only start a move from
 * a place the layers might not be. Every intensity change before this one may
 * still have been in flight, so the honest starting point is the gain each
 * layer is holding right now, not the target of the move being abandoned. Read
 * against `t`:
 *
 *   t = 0  ->  exactly `from`, i.e. exactly where the layers already are
 *   t = 1  ->  exactly `to`
 *
 * so a move can be interrupted at any instant and the gain a layer is holding
 * never changes in that instant. That is the whole fix: continuity at t=0.
 */
export function crossfadeGains(
  from: readonly number[],
  to: readonly number[],
  t: number,
): number[] {
  const fade = equalPowerCrossfade(clamp(t, 0, 1));
  return MUSIC_LAYERS.map((_, i) => {
    const ga = from[i] ?? 0;
    const gb = to[i] ?? 0;
    // A layer that is up in both indices does not move at all; only the layers
    // that differ are crossfaded, which is what makes this feel like one piece
    // of music getting busier rather than a cut between two tracks.
    if (Math.abs(ga - gb) < 1e-9) return ga;
    return Math.sqrt(ga * ga * fade.out * fade.out + gb * gb * fade.in * fade.in);
  });
}

/** How long an intensity change takes. Long enough to be a move, not a cut. */
export const INTENSITY_RAMP_MS = 1400;

/**
 * How long a STOP change takes - one piece giving way to another at a warp.
 * Longer than an intensity change because this really is two different pieces
 * of music, and shorter than the 2200 ms ambient bed move because the ambient
 * bed is a room and this is a song.
 */
export const TRACK_CROSSFADE_MS = 1200;

// ---------------------------------------------------------------------------
// The composed tracks (E-MUSIC-1)
// ---------------------------------------------------------------------------

/**
 * Which stops this build shipped a piece for, and how to get the bytes.
 *
 * Bytes, not a decoded buffer: decoding needs the AudioContext and the catalog
 * is built by the adapter in `index.ts`, which deliberately knows nothing about
 * the graph. Same split as `VoiceClipCatalog`.
 *
 * `open` MUST NOT THROW AND MUST NOT REJECT. A 404, an offline machine and a
 * truncated file are all "no music for this stop", and none of them is an error
 * a scene should ever see. The bus defends itself anyway - see `loadTrack` -
 * but the contract is here because it is the contract that keeps the game
 * running when a file is missing.
 */
export interface MusicTrackCatalog {
  /** Stop ids with a shipped track. Sorted, so a test prints a stable diff. */
  ids(): readonly string[];
  /** Encoded bytes for a stop's track, or null when there are none. */
  open(id: string): Promise<ArrayBuffer | null>;
}

/** Where the sound coming out of the music bus is being made. */
export type MusicSourceKind = "synth" | "track" | "silent";

export interface MusicBusOptions {
  /**
   * The composed pieces (E-MUSIC-1). ABSENT means this build shipped no music
   * files, and the synthesised layer stack plays instead - which is what every
   * Node test, the evidence emitter and any build without the assets gets.
   * PRESENT means the tracks are the music, and a track that will not load is
   * silence rather than a fallback to synthesis: a synth that quietly covers a
   * missing file is how a feature ships inert and nobody notices.
   */
  readonly tracks?: MusicTrackCatalog;
  /** Decoder. Defaults to the context's own, and there is no music without one. */
  readonly decode?: (data: ArrayBuffer) => Promise<AudioBufferLike>;
  /** Passed to `prepareLoopBuffer`. Tests use it to shrink the crossfade. */
  readonly loop?: LoopRegionOptions;
}

interface LayerVoice {
  readonly spec: MusicLayerSpec;
  readonly gain: GainNodeLike;
}

/** One composed piece, playing or fading out, with the nodes it owns. */
interface LiveTrack {
  readonly id: string;
  readonly source: AudioBufferSourceNodeLike;
  /** This piece's own level, ABOVE the layer gains. Only the swap moves it. */
  readonly gain: GainNodeLike;
  /** Everything to disconnect when the piece is done. */
  readonly nodes: readonly AudioNodeLike[];
  /**
   * Level when the swap now in flight started. Same discipline as the layer
   * crossfade's `fromGains`: a swap interrupted by another swap must not step.
   */
  fromGain: number;
  retiring: boolean;
}

/**
 * The music bus: three layer gains under one output, plus the ramp state.
 *
 * `advance(dtMs)` is how the crossfade moves. A frame-driven update rather than
 * a scheduled ramp because it is the version a test can step through, and the
 * scene already has a frame loop. The scheduled-ramp version would be
 * unobservable in Node, which is how an audio bug survives to production.
 */
export class MusicBus {
  private readonly voices: LayerVoice[] = [];
  private currentIndex = 0;
  /**
   * Where the layers were when the move in flight started - the GAINS, not an
   * index. See `crossfadeGains`: holding the index instead is what let an
   * interrupted ramp snap every layer to its old destination in one frame
   * (UR-10).
   */
  private fromGains: number[] = MUSIC_LAYERS.map(() => 0);
  private elapsedMs = INTENSITY_RAMP_MS;
  private rampMs = INTENSITY_RAMP_MS;

  /** Null when this build shipped no music files; then the synth stack plays. */
  private readonly catalog: MusicTrackCatalog | null;
  private readonly decode: ((data: ArrayBuffer) => Promise<AudioBufferLike>) | null;
  private readonly loopOptions: LoopRegionOptions;
  /** The synthesised stack, built only when there are no composed tracks. */
  private readonly synthesised: boolean;
  /** Pieces with sound in the graph: the current one, plus any fading out. */
  private tracks: LiveTrack[] = [];
  /** The stop most recently ASKED for, which is not yet the one playing. */
  private wantedId: string | null = null;
  private loading: Promise<boolean> | null = null;
  private swapElapsedMs = TRACK_CROSSFADE_MS;
  private swapMs = TRACK_CROSSFADE_MS;

  constructor(
    private readonly ctx: AudioContextLike,
    readonly output: AudioNodeLike,
    options: MusicBusOptions = {},
  ) {
    // Bound to the context, not passed unbound: `decodeAudioData` detached from
    // a real `AudioContext` throws an illegal-invocation TypeError, and it
    // would throw it inside a promise nobody is watching.
    const own = ctx.decodeAudioData;
    const decode =
      options.decode ??
      (typeof own === "function"
        ? (data: ArrayBuffer): Promise<AudioBufferLike> => own.call(ctx, data)
        : null);
    // A catalog is only usable with a decoder. A context that cannot decode is
    // the same situation as a build that shipped nothing: synthesise.
    const usable = options.tracks !== undefined && decode !== null;
    this.catalog = usable ? (options.tracks ?? null) : null;
    this.decode = usable ? decode : null;
    this.loopOptions = options.loop ?? {};
    this.synthesised = !usable;

    for (const spec of MUSIC_LAYERS) {
      const gain = label(this.ctx.createGain(), `music.layer.${spec.id}`);
      gain.gain.value = 0;
      gain.connect(this.output);
      this.voices.push({ spec, gain });
      if (this.synthesised) this.buildLayerVoice(spec, gain);
    }
    this.applyGains(layerTargetGains(0));
  }

  /** The three layer gain nodes, in spec order. Read by graph tests/evidence. */
  layerGains(): readonly GainNodeLike[] {
    return this.voices.map((v) => v.gain);
  }

  // -------------------------------------------------------------------------
  // The composed piece for a stop (E-MUSIC-1, AC-21.1's sibling for music)
  // -------------------------------------------------------------------------

  /** Where the sound is coming from right now. */
  get sourceKind(): MusicSourceKind {
    if (this.synthesised) return "synth";
    return this.tracks.some((t) => !t.retiring) ? "track" : "silent";
  }

  /** The stop whose piece is actually playing, or null. */
  get trackId(): string | null {
    return this.tracks.find((t) => !t.retiring)?.id ?? null;
  }

  /** Stops this build can play a composed piece for. Empty when none shipped. */
  trackIds(): readonly string[] {
    return this.catalog?.ids() ?? [];
  }

  /** Is a stop change still fading between two pieces? */
  get swapping(): boolean {
    return this.tracks.length > 0 && this.swapElapsedMs < this.swapMs;
  }

  /**
   * Play this stop's piece (UR-12). Idempotent per stop, so a scene may call it
   * every frame; the second call for a stop already asked for returns the
   * in-flight promise rather than fetching again.
   *
   * RESOLVES FALSE RATHER THAN REJECTING, always. False is "no music for this
   * stop" - no such track, a fetch that failed, bytes that would not decode -
   * and the game carries on in silence. The promise is returned only so a test
   * can await the load; no caller has to.
   */
  setStop(stopId: string): Promise<boolean> {
    if (this.catalog === null) return Promise.resolve(false);
    if (stopId === this.wantedId) {
      return this.loading ?? Promise.resolve(this.trackId === stopId);
    }
    this.wantedId = stopId;
    const load = this.loadTrack(stopId).then((ok) => {
      if (this.loading === load) this.loading = null;
      return ok;
    });
    this.loading = load;
    return load;
  }

  /**
   * Fetch, decode, loop-prepare, attach. Every failure mode lands in the same
   * place: the current piece fades out and nothing replaces it.
   */
  private async loadTrack(stopId: string): Promise<boolean> {
    const catalog = this.catalog;
    const decode = this.decode;
    if (catalog === null || decode === null) return false;

    let buffer: AudioBufferLike | null = null;
    if (catalog.ids().includes(stopId)) {
      try {
        const bytes = await catalog.open(stopId);
        if (bytes !== null) {
          // The decoded piece is NOT what loops. See musicLoop.ts: three of the
          // seven fade out to silence, so the loop is the trimmed, folded
          // region of it and the fade is simply not in the loop.
          buffer = prepareLoopBuffer(this.ctx, await decode(bytes), this.loopOptions);
        }
      } catch {
        // A 404 that rejected, bytes that were not audio, a decoder that gave
        // up. A quieter game, never a thrown error out of a scene.
        buffer = null;
      }
    }

    // A later stop was asked for while this one was in flight. Whatever we
    // fetched is stale and must not be started over the top of the new one.
    if (this.wantedId !== stopId) return false;

    if (buffer === null) {
      this.retireAll();
      return false;
    }
    this.attach(stopId, buffer);
    return true;
  }

  /**
   * Start a piece and fade whatever was playing out under it.
   *
   * ONE SOURCE, THREE BANDS. This is the whole design decision: a generated
   * clip is a performance, not a stem, so three clips cannot stack. The three
   * layers are three filtered views of THIS buffer, feeding the same three
   * layer gains the intensity index already drives.
   */
  private attach(stopId: string, buffer: AudioBufferLike): void {
    for (const track of this.tracks) {
      track.retiring = true;
      // From where it IS, not from where it was meant to be. Same rule as
      // `setIndex`; an interrupted swap must not step either.
      track.fromGain = track.gain.gain.value;
    }

    const now = this.ctx.currentTime;
    const source = label(this.ctx.createBufferSource(), `music.source.${stopId}`);
    source.buffer = buffer;
    source.loop = true;
    // Every piece is brought to one level before anything else touches it. The
    // seven were generated independently and span 4.7 LU; see
    // `MUSIC_REFERENCE_RMS`. Measured from the buffer, so a regenerated track
    // needs nothing updated by hand.
    const level = label(this.ctx.createGain(), `music.level.${stopId}`);
    level.gain.value = levelTrimFor(buffer);
    const trackGain = label(this.ctx.createGain(), `music.track.${stopId}`);
    trackGain.gain.value = 0;
    source.connect(level);
    level.connect(trackGain);

    const nodes: AudioNodeLike[] = [source, level, trackGain];
    this.voices.forEach((voice) => {
      const spec = voice.spec;
      const band = label(this.ctx.createBiquadFilter(), `music.band.${spec.id}`);
      band.type = spec.band;
      band.frequency.setValueAtTime(spec.bandHz, now);
      band.Q.setValueAtTime(spec.bandQ, now);
      const makeup = this.ctx.createGain();
      makeup.gain.value = spec.bandGain;
      trackGain.connect(band);
      band.connect(makeup);
      makeup.connect(voice.gain);
      nodes.push(band, makeup);
    });

    source.start(now);
    this.tracks.push({ id: stopId, source, gain: trackGain, nodes, fromGain: 0, retiring: false });
    this.swapMs = TRACK_CROSSFADE_MS;
    this.swapElapsedMs = 0;
  }

  /** Fade every live piece out and leave nothing behind it. */
  private retireAll(): void {
    if (this.tracks.length === 0) return;
    let changed = false;
    for (const track of this.tracks) {
      if (track.retiring) continue;
      track.retiring = true;
      track.fromGain = track.gain.gain.value;
      changed = true;
    }
    if (!changed) return;
    this.swapMs = TRACK_CROSSFADE_MS;
    this.swapElapsedMs = 0;
  }

  /** Step the piece-to-piece crossfade. Driven from `advance`, like everything. */
  private advanceSwap(dtMs: number): void {
    if (this.tracks.length === 0 || this.swapElapsedMs >= this.swapMs) return;
    this.swapElapsedMs = Math.min(this.swapMs, this.swapElapsedMs + dtMs);
    const fade = equalPowerCrossfade(progress(this.swapElapsedMs, this.swapMs));
    for (const track of this.tracks) {
      track.gain.gain.value = track.retiring ? track.fromGain * fade.out : fade.in;
    }
    if (this.swapElapsedMs >= this.swapMs) this.settleSwap();
  }

  /** Stop and unwire the pieces that finished fading out. */
  private settleSwap(): void {
    const done = this.tracks.filter((t) => t.retiring);
    if (done.length === 0) return;
    const now = this.ctx.currentTime;
    for (const track of done) {
      track.gain.gain.value = 0;
      try {
        track.source.stop(now);
      } catch {
        // A source that was never started, or already stopped. Either way it
        // is not making a sound, which is the only thing this call is for.
      }
      for (const node of track.nodes) node.disconnect();
    }
    this.tracks = this.tracks.filter((t) => !t.retiring);
  }

  get index(): number {
    return this.currentIndex;
  }

  /** Is an intensity crossfade in flight right now? */
  get changing(): boolean {
    return this.elapsedMs < this.rampMs;
  }

  /**
   * Drive the music from live game state (AC-21.2). Idempotent: calling it
   * every frame with an unchanged state does nothing, so the scene can just
   * call it every frame.
   */
  setFromState(liveAsteroids: number, combo: number, rampMs = INTENSITY_RAMP_MS): number {
    const next = intensityIndex(liveAsteroids, combo);
    this.setIndex(next, rampMs);
    return next;
  }

  setIndex(index: number, rampMs = INTENSITY_RAMP_MS): void {
    const target = clamp(Math.floor(index), 0, MAX_INTENSITY_INDEX);
    if (target === this.currentIndex) return;
    // Start the new move from WHERE THE LAYERS ARE, not from the target of the
    // move being abandoned. Reading the nodes rather than recomputing from an
    // index is the point: whatever the last frame wrote is the truth.
    this.fromGains = this.voices.map((v) => v.gain.gain.value);
    this.currentIndex = target;
    this.rampMs = Math.max(1, rampMs);
    this.elapsedMs = 0;
  }

  advance(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs < 0) return;
    this.elapsedMs = Math.min(this.rampMs, this.elapsedMs + dtMs);
    const t = progress(this.elapsedMs, this.rampMs);
    this.applyGains(crossfadeGains(this.fromGains, layerTargetGains(this.currentIndex), t));
    // Two independent moves share the frame: WHICH PIECE is playing, and HOW
    // BUSY it is. They multiply rather than fight - the piece fade is above the
    // layer gains - so a warp during an intensity change is still one sound.
    this.advanceSwap(dtMs);
  }

  private applyGains(gains: readonly number[]): void {
    this.voices.forEach((voice, i) => {
      voice.gain.gain.value = gains[i] ?? 0;
    });
  }

  /**
   * The synthesised stem: what plays when this build shipped no composed
   * pieces, or the context cannot decode one. Built once per layer in the
   * constructor and never torn down, because a build is one or the other for
   * its whole life - `attach` is the composed path and it never runs here.
   */
  private buildLayerVoice(spec: MusicLayerSpec, into: GainNodeLike): void {
    const now = this.ctx.currentTime;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(spec.filterHz, now);
    filter.connect(into);

    for (const hz of spec.partialsHz) {
      const osc = this.ctx.createOscillator();
      osc.type = spec.wave;
      osc.frequency.setValueAtTime(hz, now);
      const partial = this.ctx.createGain();
      partial.gain.value = 1 / spec.partialsHz.length;
      osc.connect(partial);
      partial.connect(filter);
      osc.start(now);
    }

    if (spec.pulseHz > 0) {
      // Tremolo: a slow oscillator on the layer's own gain. This is what makes
      // "busier" audible as movement rather than as volume.
      const lfo = this.ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.setValueAtTime(spec.pulseHz, now);
      const depth = this.ctx.createGain();
      depth.gain.value = 0.18;
      lfo.connect(depth);
      depth.connect(filter);
      lfo.start(now);
    }
  }
}
