/**
 * Adaptive music (D62, PRD FR-21 / AC-21.2).
 *
 * AC-21.2: ">= 3 intensity layers; intensity index is a function of live
 * asteroid count and combo". The second clause is the testable one and it is
 * why `intensityIndex` is a PURE function of two numbers - no scene, no
 * context, no clock. The layers themselves are three stacked gains under the
 * music bus; the index only decides where each gain is heading.
 *
 * D63 calls music "composed files with intensity layers". No key and no
 * composer exists yet, so the layers are synthesised here from the same
 * procedural primitives as everything else. The SHAPE is what matters and it is
 * the shape a composed stem swap slots into: three gains, one index, one
 * equal-power ramp. Replacing the oscillator stack in `buildLayerVoice` with
 * three looping `AudioBufferSourceNode`s is the whole change.
 *
 * LAYERS ARE CUMULATIVE, not exclusive. Index 1 does not mean "play layer 1",
 * it means "bed and pulse are up, drive is down". That is what keeps an
 * intensity change feeling like the same piece of music getting busier rather
 * than a different track starting.
 */

import {
  clamp,
  equalPowerCrossfade,
  progress,
  type AudioContextLike,
  type AudioNodeLike,
  type GainNodeLike,
  type OscillatorWave,
} from "./context.js";
import { label } from "./nullContext.js";

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
  const fade = equalPowerCrossfade(clamp(t, 0, 1));
  const a = layerTargetGains(from);
  const b = layerTargetGains(to);
  return MUSIC_LAYERS.map((_, i) => {
    const ga = a[i] ?? 0;
    const gb = b[i] ?? 0;
    // A layer that is up in both indices does not move at all; only the layers
    // that differ are crossfaded, which is what makes this feel like one piece
    // of music getting busier rather than a cut between two tracks.
    if (Math.abs(ga - gb) < 1e-9) return ga;
    return Math.sqrt(ga * ga * fade.out * fade.out + gb * gb * fade.in * fade.in);
  });
}

/** How long an intensity change takes. Long enough to be a move, not a cut. */
export const INTENSITY_RAMP_MS = 1400;

interface LayerVoice {
  readonly spec: MusicLayerSpec;
  readonly gain: GainNodeLike;
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
  private fromIndex = 0;
  private elapsedMs = INTENSITY_RAMP_MS;
  private rampMs = INTENSITY_RAMP_MS;

  constructor(
    private readonly ctx: AudioContextLike,
    readonly output: AudioNodeLike,
  ) {
    for (const spec of MUSIC_LAYERS) {
      const gain = label(this.ctx.createGain(), `music.layer.${spec.id}`);
      gain.gain.value = 0;
      gain.connect(this.output);
      this.voices.push({ spec, gain });
      this.buildLayerVoice(spec, gain);
    }
    this.applyGains(layerTargetGains(0));
  }

  /** The three layer gain nodes, in spec order. Read by graph tests/evidence. */
  layerGains(): readonly GainNodeLike[] {
    return this.voices.map((v) => v.gain);
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
    this.fromIndex = this.currentIndex;
    this.currentIndex = target;
    this.rampMs = Math.max(1, rampMs);
    this.elapsedMs = 0;
  }

  advance(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs < 0) return;
    this.elapsedMs = Math.min(this.rampMs, this.elapsedMs + dtMs);
    const t = progress(this.elapsedMs, this.rampMs);
    this.applyGains(layerGainsDuringChange(this.fromIndex, this.currentIndex, t));
  }

  private applyGains(gains: readonly number[]): void {
    this.voices.forEach((voice, i) => {
      voice.gain.gain.value = gains[i] ?? 0;
    });
  }

  /**
   * The synthesised stem. THE SWAP POINT: replace the oscillator stack with a
   * looping buffer source per layer and nothing else in this file changes.
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
