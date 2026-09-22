/**
 * The injected Web Audio port, plus the pure units every other audio module
 * computes in (architecture section 6, D62).
 *
 * WHY A PORT AND NOT `AudioContext` DIRECTLY.
 * A plain Node test has no Web Audio. If graph.ts, sfx.ts, music.ts, ambient.ts
 * and voice.ts each reached for the global `AudioContext`, none of them could be
 * unit-tested and the whole audio rubric (A-21.1 .. A-21.5) would rest on an
 * e2e run in a browser - which is exactly the kind of check that quietly stops
 * being run. So every module takes an `AudioContextLike` and the real
 * `AudioContext` is passed in at the one binding site (index.ts). Tests and the
 * evidence emitter pass `NullAudioContext` from nullContext.ts.
 *
 * The interfaces below are deliberately a STRUCTURAL SUBSET of the real Web
 * Audio types: a real `AudioContext` is assignable to `AudioContextLike`
 * without a cast or a wrapper. Anything wider would be a second API to keep in
 * sync with the browser's.
 *
 * DECISION LOGIC LIVES IN PURE FUNCTIONS. Every number this package sends to a
 * `GainNode` is produced by a function in this file or in a sibling module that
 * takes no context: the duck amount, the crossfade curve, the layer gains, the
 * pitch index. The node objects are only where those numbers are delivered.
 */

/** Oscillator shapes we use. Subset of the browser's `OscillatorType`. */
export type OscillatorWave = "sine" | "square" | "sawtooth" | "triangle";

/** Filter shapes we use. Subset of the browser's `BiquadFilterType`. */
export type BiquadKind = "lowpass" | "highpass" | "bandpass" | "peaking";

/**
 * The slice of `AudioParam` we schedule against. Every method returns the param
 * so the browser's fluent style works; we never rely on the return value.
 */
export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): AudioParamLike;
  linearRampToValueAtTime(value: number, endTime: number): AudioParamLike;
  exponentialRampToValueAtTime(value: number, endTime: number): AudioParamLike;
  cancelScheduledValues(startTime: number): AudioParamLike;
}

export interface AudioNodeLike {
  // An AudioParam is a legal destination in the real Web Audio API, and it is
  // how an LFO modulates anything (UR-147b's shimmer). The shim narrowed it out.
  connect(destination: AudioNodeLike | AudioParamLike): void;
  disconnect(): void;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface OscillatorNodeLike extends AudioNodeLike {
  type: OscillatorWave;
  readonly frequency: AudioParamLike;
  readonly detune: AudioParamLike;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: BiquadKind;
  readonly frequency: AudioParamLike;
  readonly Q: AudioParamLike;
}

export interface AudioBufferLike {
  readonly length: number;
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  readonly playbackRate: AudioParamLike;
  /**
   * `offset` is WHERE IN THE BUFFER to begin, in seconds (UR-34).
   *
   * Declared because without it every noise burst in the game is the same
   * bytes: a source started with no offset always reads from sample 0, so the
   * keystroke tick's noise - and the blast's, and the warp's - was one fixed
   * texture replayed hundreds of times a belt. A random offset into a looping
   * noise buffer makes each one different for free.
   *
   * The browser's `start` takes a third `duration` argument as well; extra
   * OPTIONAL parameters on the implementation keep a real
   * `AudioBufferSourceNode` assignable to this, the same as `decodeAudioData`.
   */
  start(when?: number, offset?: number): void;
  stop(when?: number): void;
}

export interface StereoPannerNodeLike extends AudioNodeLike {
  readonly pan: AudioParamLike;
}

/**
 * The context port. `currentTime` is the only clock this package reads - there
 * is no `Date.now()` anywhere under src/game/audio, so a test can run a two
 * second crossfade in zero real milliseconds.
 */
export interface AudioContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  /**
   * HOW FAR BEHIND THE RENDERER `currentTime` IS (UR-55).
   *
   * Optional, because only a real `AudioContext` has one: an `OfflineAudioContext`
   * has no output device to be behind, and neither does `NullAudioContext` or the
   * test renderer. Where it exists it is the honest measure of how far in the past
   * `currentTime` already is, and `sfxLookaheadSeconds` reads it so a machine with
   * a slow output path gets a lookahead that actually clears its own latency
   * rather than the one this game was measured on.
   */
  readonly baseLatency?: number;
  readonly destination: AudioNodeLike;
  createGain(): GainNodeLike;
  createOscillator(): OscillatorNodeLike;
  createBiquadFilter(): BiquadFilterNodeLike;
  createBufferSource(): AudioBufferSourceNodeLike;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike;
  createStereoPanner(): StereoPannerNodeLike;
  /**
   * Route a media element (a pre-rendered voice clip) INTO the graph.
   *
   * Optional, and the only optional member of this port, because it is the one
   * capability a context can honestly lack: the null context has nothing to
   * route, and a browser that blocked audio never got far enough to have one.
   * `createVoiceClipPlayer` asks for it and returns null when it is absent,
   * which is how a build with rendered files still runs on a machine that
   * cannot play them.
   *
   * `element` is `unknown` rather than `HTMLMediaElement` for the same reason
   * `SpeechPort` is not `SpeechSynthesis`: no module under src/game/audio may
   * name a DOM type. The one real call site casts, in index.ts.
   */
  createMediaElementSource?(element: unknown): AudioNodeLike;
  /**
   * Decode compressed bytes (a composed music track) into a buffer.
   *
   * Optional for the same reason as `createMediaElementSource`: the null
   * context has no decoder, and a build with no music never needs one. A
   * context without it plays no composed track, which under `MusicBus` means
   * the synthesised layers or silence - never an error.
   *
   * Declared with one parameter although the browser's takes three: the two
   * callback forms are the pre-promise API and nothing in this package uses
   * them. A real `AudioContext` is still assignable, because extra OPTIONAL
   * parameters on the implementation are fine.
   */
  decodeAudioData?(data: ArrayBuffer): Promise<AudioBufferLike>;
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

/**
 * Decibels to a linear gain multiplier. AC-21.4 is written in dB and gain nodes
 * are linear, so this conversion is the only place the two meet.
 *
 * Non-finite input is not a level, so it yields silence rather than NaN
 * reaching a `GainNode` (a NaN in a gain param silences the whole bus in some
 * browsers and is very hard to trace).
 */
export function dbToGain(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.pow(10, db / 20);
}

/** The inverse. A gain of 0 has no dB value, so it reports -Infinity. */
export function gainToDb(gain: number): number {
  if (!Number.isFinite(gain) || gain <= 0) return Number.NEGATIVE_INFINITY;
  return 20 * Math.log10(gain);
}

/** Clamp that treats non-finite input as the low end, never as NaN. */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Normalised progress through a timed move; non-finite duration snaps to done. */
export function progress(elapsedMs: number, durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 1;
  return clamp(elapsedMs / durationMs, 0, 1);
}

export interface CrossfadePair {
  /** Gain of the bed/layer being faded OUT. */
  readonly out: number;
  /** Gain of the bed/layer being faded IN. */
  readonly in: number;
}

/**
 * EQUAL-POWER crossfade (AC-21.1's "crossfades on transition").
 *
 * A linear crossfade of two uncorrelated beds dips ~3 dB in the middle - the
 * audible "hole" you hear in a bad transition, and the reason a naive
 * `gain = 1 - t` implementation sounds like a fault rather than a move. The
 * sine/cosine pair holds `out^2 + in^2 === 1` at every t, so perceived loudness
 * is constant across the whole move. The invariant is asserted in the tests.
 *
 * Also note the curve is a cosine, not a `Linear` ease: AC-22.5 bans linear
 * easing in motion, and the same reasoning applies to a fade the player hears.
 */
export function equalPowerCrossfade(t: number): CrossfadePair {
  const p = clamp(t, 0, 1);
  return { out: Math.cos((p * Math.PI) / 2), in: Math.sin((p * Math.PI) / 2) };
}

/**
 * Deterministic PRNG (mulberry32). Audio picks variants and fills noise buffers;
 * both must be reproducible in a test, so no module under src/game/audio ever
 * calls `Math.random` - an rng is passed in, defaulting to one of these.
 */
export function seededRandom(seed: number): () => number {
  let a = Math.floor(Number.isFinite(seed) ? seed : 1) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Semitone offset to a frequency ratio. Used by the keystroke tone and SFX. */
export function semitoneRatio(semitones: number): number {
  if (!Number.isFinite(semitones)) return 1;
  return Math.pow(2, semitones / 12);
}
