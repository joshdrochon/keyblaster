/**
 * AN OFFLINE RENDERER FOR `AudioContextLike`.
 *
 * WHY THIS EXISTS. Every other fake in this lane is a RECORDER: `NullAudioContext`
 * remembers that a gain node was created and what was written to it, which answers
 * "was it wired" and can never answer "what does it sound like". Three of the
 * user-reported audio defects are about the SAMPLES - a pop is a sample-to-sample
 * step, a buzz is energy in a band, a hum is a level - and none of them is visible
 * to a recorder. A browser's `OfflineAudioContext` would answer them, and a Node
 * unit test does not have one.
 *
 * So this renders. It implements the same `AudioContextLike` port the real
 * `AudioContext` satisfies, pulls 128-sample blocks exactly as Web Audio does, and
 * hands back a mono `Float32Array` that a test can read every sample of.
 *
 * IT IS A TEST HARNESS, NOT A BROWSER. What it covers is what this package uses:
 * gains with automation, biquads, oscillators, looping buffer sources, panners.
 * Two deliberate simplifications, both stated so a reader knows what a number
 * from here does and does not prove:
 *
 *   - Filter coefficients are computed once per 128-sample block rather than per
 *     sample. Web Audio is a-rate; nothing in this package sweeps a filter, so
 *     the two agree except during a sweep that does not exist.
 *   - The panner sums to mono. Every measurement here is about level, spectrum
 *     and continuity, none of which is a stereo question.
 *
 * Oscillators are BANDLIMITED ADDITIVE, which is what Web Audio's `PeriodicWave`
 * does: harmonics up to Nyquist and not one above. That matters for the buzz
 * measurement - a naive sawtooth would fold its own aliasing into the high band
 * and the test would be measuring this file's shortcut rather than the game's
 * sound.
 */

import type {
  AudioBufferLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  BiquadKind,
  GainNodeLike,
  OscillatorNodeLike,
  OscillatorWave,
  StereoPannerNodeLike,
  AudioBufferSourceNodeLike,
} from "../../../src/game/audio/context.js";

/** Web Audio's render quantum. Kept identical so block edges land where they do. */
export const RENDER_QUANTUM = 128;

type ParamEventKind = "set" | "linear" | "exponential";

interface ParamEvent {
  readonly kind: ParamEventKind;
  readonly value: number;
  readonly time: number;
}

/**
 * An `AudioParam` with a real timeline.
 *
 * `value = x` is treated as a `setValueAtTime` at the context's CURRENT time,
 * which is what a browser does, and is the reason this package's per-frame gain
 * writes (`advance()` in every bus) render as steps at the frame boundary rather
 * than as one value for the whole run.
 */
class OfflineParam implements AudioParamLike {
  private events: ParamEvent[] = [];
  private immediate: number;

  constructor(
    defaultValue: number,
    private readonly clock: () => number,
  ) {
    this.immediate = defaultValue;
  }

  get value(): number {
    return this.immediate;
  }

  set value(next: number) {
    this.immediate = next;
    this.push({ kind: "set", value: next, time: this.clock() });
  }

  setValueAtTime(value: number, startTime: number): AudioParamLike {
    this.immediate = value;
    this.push({ kind: "set", value, time: startTime });
    return this;
  }

  linearRampToValueAtTime(value: number, endTime: number): AudioParamLike {
    this.push({ kind: "linear", value, time: endTime });
    return this;
  }

  exponentialRampToValueAtTime(value: number, endTime: number): AudioParamLike {
    this.push({ kind: "exponential", value, time: endTime });
    return this;
  }

  cancelScheduledValues(startTime: number): AudioParamLike {
    this.events = this.events.filter((e) => e.time < startTime);
    return this;
  }

  private push(event: ParamEvent): void {
    // Later writes at the same instant win, exactly as a browser's timeline does.
    this.events = this.events.filter((e) => !(e.time === event.time && e.kind === event.kind));
    this.events.push(event);
    this.events.sort((a, b) => a.time - b.time);
    this.prune();
  }

  /**
   * Drop timeline history the render can no longer reach.
   *
   * Every bus in this package writes `gain.value` once per frame, so a 95-second
   * render schedules ~35,000 events on one param and an unpruned `at()` scans all
   * of them for every sample - the render becomes quadratic and never finishes.
   * Rendering only ever moves forward, so everything strictly before the last
   * event at or under the clock is unreachable. That one event is kept, because
   * it is what holds the param's value between writes.
   */
  private prune(): void {
    if (this.events.length < 64) return;
    const horizon = this.clock();
    let keepFrom = 0;
    for (let i = 0; i < this.events.length; i++) {
      if ((this.events[i] as ParamEvent).time <= horizon) keepFrom = i;
      else break;
    }
    if (keepFrom > 0) this.events = this.events.slice(keepFrom);
  }

  /** The param's value at an absolute context time. */
  at(time: number): number {
    if (this.events.length === 0) return this.immediate;
    const first = this.events[0] as ParamEvent;
    if (time <= first.time) return first.kind === "set" ? first.value : this.immediate;

    let prev = first;
    for (let i = 1; i < this.events.length; i++) {
      const next = this.events[i] as ParamEvent;
      if (time >= next.time) {
        prev = next;
        continue;
      }
      if (next.kind === "set") return prev.value;
      const span = next.time - prev.time;
      const t = span <= 0 ? 1 : (time - prev.time) / span;
      if (next.kind === "linear") return prev.value + (next.value - prev.value) * t;
      // Web Audio's exponential ramp is undefined through zero; the package never
      // asks for one (it ramps to 0.0001), so the guard is a floor, not a curve.
      const from = Math.max(1e-7, Math.abs(prev.value)) * Math.sign(prev.value || 1);
      const to = Math.max(1e-7, Math.abs(next.value)) * Math.sign(next.value || 1);
      return from * Math.pow(to / from, t);
    }
    return prev.value;
  }
}

abstract class OfflineNode implements AudioNodeLike {
  readonly inputs: OfflineNode[] = [];
  private outputs: OfflineNode[] = [];
  private cacheBlock = -1;
  private cache: Float32Array = new Float32Array(RENDER_QUANTUM);

  constructor(protected readonly ctx: OfflineAudioContextLike) {}

  connect(destination: AudioNodeLike): void {
    const node = destination as OfflineNode;
    if (!node || typeof (node as { pull?: unknown }).pull !== "function") return;
    node.inputs.push(this);
    this.outputs.push(node);
  }

  disconnect(): void {
    for (const out of this.outputs) {
      const i = out.inputs.indexOf(this);
      if (i >= 0) out.inputs.splice(i, 1);
    }
    this.outputs = [];
  }

  /** Sum of every upstream node's block. */
  protected inputBlock(block: number, startTime: number): Float32Array {
    const out = new Float32Array(RENDER_QUANTUM);
    for (const input of this.inputs) {
      const src = input.pull(block, startTime);
      for (let i = 0; i < RENDER_QUANTUM; i++) out[i] = (out[i] as number) + (src[i] as number);
    }
    return out;
  }

  /** One 128-sample block, computed once per block however many outputs ask. */
  pull(block: number, startTime: number): Float32Array {
    if (this.cacheBlock === block) return this.cache;
    this.cacheBlock = block;
    this.cache = this.process(block, startTime);
    return this.cache;
  }

  protected abstract process(block: number, startTime: number): Float32Array;
}

class OfflineGain extends OfflineNode implements GainNodeLike {
  readonly gain: OfflineParam;

  constructor(ctx: OfflineAudioContextLike) {
    super(ctx);
    this.gain = new OfflineParam(1, () => ctx.currentTime);
  }

  protected process(block: number, startTime: number): Float32Array {
    const input = this.inputBlock(block, startTime);
    const out = new Float32Array(RENDER_QUANTUM);
    const dt = 1 / this.ctx.sampleRate;
    for (let i = 0; i < RENDER_QUANTUM; i++) {
      out[i] = (input[i] as number) * this.gain.at(startTime + i * dt);
    }
    return out;
  }
}

/** RBJ cookbook, the same formulae the Web Audio spec prints for `BiquadFilter`. */
function biquadCoefficients(
  kind: BiquadKind,
  hz: number,
  q: number,
  sampleRate: number,
): { b0: number; b1: number; b2: number; a1: number; a2: number } {
  const nyquist = sampleRate / 2;
  const f = Math.min(Math.max(hz, 1e-4), nyquist - 1);
  const w0 = (2 * Math.PI * f) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const qq = Math.max(1e-4, q);
  const alpha = sin / (2 * qq);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let a0 = 1;
  let a1 = 0;
  let a2 = 0;
  if (kind === "lowpass") {
    b0 = (1 - cos) / 2;
    b1 = 1 - cos;
    b2 = (1 - cos) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  } else if (kind === "highpass") {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = (1 + cos) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  } else if (kind === "bandpass") {
    // Constant 0 dB peak gain, which is the variant Web Audio implements.
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  } else {
    // "peaking" with unity gain is a pass-through; the package never sets a gain
    // on one, so this is the honest answer rather than a guessed dB.
    b0 = 1;
    a0 = 1;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

class OfflineBiquad extends OfflineNode implements BiquadFilterNodeLike {
  type: BiquadKind = "lowpass";
  readonly frequency: OfflineParam;
  readonly Q: OfflineParam;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(ctx: OfflineAudioContextLike) {
    super(ctx);
    this.frequency = new OfflineParam(350, () => ctx.currentTime);
    this.Q = new OfflineParam(1, () => ctx.currentTime);
  }

  protected process(block: number, startTime: number): Float32Array {
    const input = this.inputBlock(block, startTime);
    const c = biquadCoefficients(
      this.type,
      this.frequency.at(startTime),
      this.Q.at(startTime),
      this.ctx.sampleRate,
    );
    const out = new Float32Array(RENDER_QUANTUM);
    for (let i = 0; i < RENDER_QUANTUM; i++) {
      const x0 = input[i] as number;
      const y0 = c.b0 * x0 + c.b1 * this.x1 + c.b2 * this.x2 - c.a1 * this.y1 - c.a2 * this.y2;
      this.x2 = this.x1;
      this.x1 = x0;
      this.y2 = this.y1;
      this.y1 = y0;
      out[i] = y0;
    }
    return out;
  }
}

/**
 * Bandlimited additive oscillator.
 *
 * Harmonic amplitudes are Web Audio's own for the four standard shapes, summed
 * only up to Nyquist. Reference: the Web Audio spec's `PeriodicWave` tables.
 */
function harmonic(wave: OscillatorWave, n: number): number {
  if (wave === "sine") return n === 1 ? 1 : 0;
  if (wave === "sawtooth") return (2 / (Math.PI * n)) * (n % 2 === 0 ? -1 : 1);
  if (wave === "square") return n % 2 === 1 ? 4 / (Math.PI * n) : 0;
  // triangle
  if (n % 2 === 0) return 0;
  return ((8 / (Math.PI * Math.PI)) * (((n - 1) / 2) % 2 === 0 ? 1 : -1)) / (n * n);
}

/**
 * Harmonics are capped here, not at Nyquist alone.
 *
 * A 0.09 Hz shimmer LFO has 266,000 harmonics below Nyquist and every one of
 * them is inaudible; summing them would make a six-second render take minutes
 * for no change to any number a test reads. 256 is well past the point where a
 * sawtooth's own harmonics are below -48 dB of its fundamental.
 */
const MAX_HARMONICS = 256;

/** Non-zero harmonic amplitudes for a shape, computed once per shape. */
const HARMONIC_TABLES = new Map<OscillatorWave, Array<{ n: number; a: number }>>();

function harmonicsFor(wave: OscillatorWave): Array<{ n: number; a: number }> {
  const cached = HARMONIC_TABLES.get(wave);
  if (cached) return cached;
  const table: Array<{ n: number; a: number }> = [];
  for (let n = 1; n <= MAX_HARMONICS; n++) {
    const a = harmonic(wave, n);
    if (a !== 0) table.push({ n, a });
  }
  HARMONIC_TABLES.set(wave, table);
  return table;
}

class OfflineOscillator extends OfflineNode implements OscillatorNodeLike {
  type: OscillatorWave = "sine";
  readonly frequency: OfflineParam;
  readonly detune: OfflineParam;
  private phase = 0;
  private startTimeSec = Number.POSITIVE_INFINITY;
  private stopTimeSec = Number.POSITIVE_INFINITY;

  constructor(ctx: OfflineAudioContextLike) {
    super(ctx);
    this.frequency = new OfflineParam(440, () => ctx.currentTime);
    this.detune = new OfflineParam(0, () => ctx.currentTime);
  }

  start(when = this.ctx.currentTime): void {
    this.startTimeSec = when;
  }

  stop(when = this.ctx.currentTime): void {
    this.stopTimeSec = when;
  }

  protected process(_block: number, startTime: number): Float32Array {
    const out = new Float32Array(RENDER_QUANTUM);
    const sr = this.ctx.sampleRate;
    const dt = 1 / sr;
    const nyquist = sr / 2;
    for (let i = 0; i < RENDER_QUANTUM; i++) {
      const t = startTime + i * dt;
      if (t < this.startTimeSec || t >= this.stopTimeSec) continue;
      const hz = Math.max(0, this.frequency.at(t) * Math.pow(2, this.detune.at(t) / 1200));
      let sample = 0;
      const maxN = hz <= 0 ? 0 : Math.floor(nyquist / hz);
      for (const h of harmonicsFor(this.type)) {
        if (h.n > maxN) break;
        sample += h.a * Math.sin(h.n * this.phase);
      }
      out[i] = sample;
      this.phase += 2 * Math.PI * hz * dt;
      if (this.phase > 2 * Math.PI) this.phase -= 2 * Math.PI;
    }
    return out;
  }
}

class OfflineBuffer implements AudioBufferLike {
  readonly length: number;
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  private readonly channels: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = Math.max(1, numberOfChannels);
    this.length = Math.max(0, length);
    this.sampleRate = sampleRate;
    this.channels = Array.from({ length: this.numberOfChannels }, () => new Float32Array(this.length));
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[Math.min(channel, this.numberOfChannels - 1)] as Float32Array;
  }
}

class OfflineBufferSource extends OfflineNode implements AudioBufferSourceNodeLike {
  buffer: AudioBufferLike | null = null;
  loop = false;
  readonly playbackRate: OfflineParam;
  private startTimeSec = Number.POSITIVE_INFINITY;
  private stopTimeSec = Number.POSITIVE_INFINITY;
  private offsetFrames = 0;

  constructor(ctx: OfflineAudioContextLike) {
    super(ctx);
    this.playbackRate = new OfflineParam(1, () => ctx.currentTime);
  }

  start(when = this.ctx.currentTime, offset = 0): void {
    this.startTimeSec = when;
    this.offsetFrames = Math.max(0, Math.round(offset * this.ctx.sampleRate));
  }

  stop(when = this.ctx.currentTime): void {
    this.stopTimeSec = when;
  }

  protected process(_block: number, startTime: number): Float32Array {
    const out = new Float32Array(RENDER_QUANTUM);
    const data = this.buffer?.getChannelData(0);
    if (!data || data.length === 0) return out;
    const sr = this.ctx.sampleRate;
    // Playback rate is read once per block, which is what this package does to
    // it - nothing sweeps it - and resampled with linear interpolation. It is
    // here because UR-48 uses a rate jitter as its main defence against a
    // granular texture repeating, and a renderer that ignored the rate would
    // measure that defence as working when it does nothing.
    const rate = Math.max(0, this.playbackRate.at(startTime));
    for (let i = 0; i < RENDER_QUANTUM; i++) {
      const t = startTime + i / sr;
      if (t < this.startTimeSec || t >= this.stopTimeSec) continue;
      const position = (t - this.startTimeSec) * sr * rate + this.offsetFrames;
      const whole = Math.floor(position);
      const frac = position - whole;
      const a = this.loop ? whole % data.length : whole;
      if (a < 0 || a >= data.length) continue;
      const b = this.loop ? (whole + 1) % data.length : whole + 1;
      const next = b >= 0 && b < data.length ? (data[b] as number) : 0;
      out[i] = (data[a] as number) * (1 - frac) + next * frac;
    }
    return out;
  }
}

class OfflinePanner extends OfflineNode implements StereoPannerNodeLike {
  readonly pan: OfflineParam;

  constructor(ctx: OfflineAudioContextLike) {
    super(ctx);
    this.pan = new OfflineParam(0, () => ctx.currentTime);
  }

  protected process(block: number, startTime: number): Float32Array {
    // Mono sum: every measurement this harness serves is level, spectrum or
    // continuity, and none of those is a stereo question.
    return this.inputBlock(block, startTime);
  }
}

class OfflineDestination extends OfflineNode {
  protected process(block: number, startTime: number): Float32Array {
    return this.inputBlock(block, startTime);
  }
}

/**
 * A rendering `AudioContextLike`.
 *
 * `render(seconds, onBlock)` advances the clock in 128-sample blocks and calls
 * back at each block boundary, which is where a test drives the package's own
 * `advance(dtMs)` - so a crossfade written per frame is rendered as the samples
 * the player would actually get.
 */
export class OfflineAudioContextLike implements AudioContextLike {
  currentTime = 0;
  readonly sampleRate: number;
  readonly destination: AudioNodeLike;
  private readonly sink: OfflineDestination;

  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.sink = new OfflineDestination(this);
    this.destination = this.sink;
  }

  createGain(): GainNodeLike {
    return new OfflineGain(this);
  }

  createOscillator(): OscillatorNodeLike {
    return new OfflineOscillator(this);
  }

  createBiquadFilter(): BiquadFilterNodeLike {
    return new OfflineBiquad(this);
  }

  createBufferSource(): AudioBufferSourceNodeLike {
    return new OfflineBufferSource(this);
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike {
    return new OfflineBuffer(numberOfChannels, length, sampleRate);
  }

  createStereoPanner(): StereoPannerNodeLike {
    return new OfflinePanner(this);
  }

  /**
   * Render `seconds` of the graph into one mono `Float32Array`.
   *
   * `onBlock` runs BEFORE each block with the block's start time and its length
   * in ms, which is where a caller steps the package's own frame clock.
   */
  render(seconds: number, onBlock?: (startTime: number, dtMs: number) => void): Float32Array {
    const total = Math.max(0, Math.floor(seconds * this.sampleRate));
    const blocks = Math.ceil(total / RENDER_QUANTUM);
    const out = new Float32Array(blocks * RENDER_QUANTUM);
    const dtMs = (RENDER_QUANTUM / this.sampleRate) * 1000;
    for (let b = 0; b < blocks; b++) {
      const startTime = (b * RENDER_QUANTUM) / this.sampleRate;
      this.currentTime = startTime;
      onBlock?.(startTime, dtMs);
      const chunk = this.sink.pull(b, startTime);
      out.set(chunk, b * RENDER_QUANTUM);
    }
    this.currentTime = (blocks * RENDER_QUANTUM) / this.sampleRate;
    return out.subarray(0, total);
  }
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/** Root mean square of a whole buffer, or of a window of it. */
export function rms(samples: Float32Array, from = 0, to = samples.length): number {
  const a = Math.max(0, from);
  const b = Math.min(samples.length, to);
  if (b <= a) return 0;
  let sum = 0;
  for (let i = a; i < b; i++) sum += (samples[i] as number) ** 2;
  return Math.sqrt(sum / (b - a));
}

export function peak(samples: Float32Array): number {
  let max = 0;
  for (let i = 0; i < samples.length; i++) max = Math.max(max, Math.abs(samples[i] as number));
  return max;
}

/**
 * The largest sample-to-sample step, and where it is.
 *
 * This is the pop measurement. A click is a step far outside what the signal
 * takes anywhere else, so the statistic is always reported next to the rest of
 * the distribution rather than against an absolute number someone chose.
 */
export function largestStep(samples: Float32Array, from = 0, to = samples.length): { step: number; index: number } {
  const a = Math.max(1, from);
  const b = Math.min(samples.length, to);
  let step = 0;
  let index = a;
  for (let i = a; i < b; i++) {
    const d = Math.abs((samples[i] as number) - (samples[i - 1] as number));
    if (d > step) {
      step = d;
      index = i;
    }
  }
  return { step, index };
}

/** The p-th quantile of |x[i] - x[i-1]| over a range. The signal's own yardstick. */
export function stepQuantile(samples: Float32Array, p: number, from = 0, to = samples.length): number {
  const a = Math.max(1, from);
  const b = Math.min(samples.length, to);
  if (b <= a) return 0;
  const steps = new Float64Array(b - a);
  for (let i = a; i < b; i++) steps[i - a] = Math.abs((samples[i] as number) - (samples[i - 1] as number));
  steps.sort();
  const idx = Math.min(steps.length - 1, Math.max(0, Math.round(p * (steps.length - 1))));
  return steps[idx] as number;
}

/**
 * Energy in a frequency band, as a fraction of the buffer's total energy.
 *
 * A Goertzel sweep rather than an FFT: the question is always "how much is above
 * / below X", the bin count is small, and a bespoke FFT here would be a second
 * copy of maths nobody checks. Windowed with a Hann so a sustained tone does not
 * smear its own energy across the whole spectrum.
 */
export function bandEnergyFraction(
  samples: Float32Array,
  sampleRate: number,
  loHz: number,
  hiHz: number,
): number {
  const spectrum = powerSpectrum(samples, sampleRate, "rect");
  let band = 0;
  let total = 0;
  for (const bin of spectrum) {
    total += bin.power;
    if (bin.hz >= loHz && bin.hz < hiHz) band += bin.power;
  }
  return total <= 0 ? 0 : band / total;
}

export interface SpectrumBin {
  readonly hz: number;
  readonly power: number;
}

/**
 * Power spectrum by radix-2 FFT, Hann-windowed.
 *
 * A REAL FFT rather than a sweep of probe frequencies, because the question the
 * hum test asks - "is this a tone or is it noise" - is exactly the question a
 * sparse probe cannot answer: a 98 Hz partial sits between probes at 75 and 100
 * and reports as almost nothing. Contiguous bins cannot miss it.
 *
 * Analyses the middle 65,536 samples (1.37 s at 48 kHz, 0.73 Hz bins), so
 * neither end's envelope is in the window and a long render costs the same as a
 * short one.
 */
export function powerSpectrum(
  samples: Float32Array,
  sampleRate: number,
  shape: "hann" | "rect" = "hann",
): SpectrumBin[] {
  const n = 1 << 16;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const start = Math.max(0, Math.floor((samples.length - n) / 2));
  const have = Math.min(n, samples.length - start);
  // The Hann window is sized to the DATA, not to the transform. Sizing it to
  // the transform silently annihilates any input shorter than 65,536 samples -
  // the window is ~0 across the whole of it - which made every band measurement
  // over a short window (an attack, a transient) a measurement of the window.
  // The rest of the frame stays zero, which is ordinary zero-padding.
  // HANN FOR SHAPE, RECT FOR ENERGY, and the difference is not cosmetic.
  //
  // A Hann window is ~0 at both ends of the analysis frame. That is right for
  // asking WHERE a sustained sound sits - it stops a tone smearing across the
  // spectrum - and it is catastrophic for asking HOW MUCH energy a ONE-SHOT
  // has, because a one-shot puts all of its energy at the START of the frame,
  // exactly where the window is zero. Measuring the blast's sub layer this way
  // reported it four times quieter than it is.
  //
  // So band energy uses a rectangular window with a short taper on the tail
  // only: nothing at the onset is attenuated, and the frame still ends smoothly
  // enough not to manufacture broadband leakage of its own.
  const denom = Math.max(1, have - 1);
  const taper = Math.max(1, Math.floor(have * 0.05));
  for (let i = 0; i < have; i++) {
    const w =
      shape === "hann"
        ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / denom)
        : i >= have - taper
          ? 0.5 - 0.5 * Math.cos((Math.PI * (have - i)) / taper)
          : 1;
    re[i] = (samples[start + i] as number) * w;
  }

  // Iterative Cooley-Tukey, bit-reversed input order.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i] as number;
      re[i] = re[j] as number;
      re[j] = tr;
      const ti = im[i] as number;
      im[i] = im[j] as number;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k] as number;
        const ui = im[i + k] as number;
        const vr = (re[i + k + len / 2] as number) * cr - (im[i + k + len / 2] as number) * ci;
        const vi = (re[i + k + len / 2] as number) * ci + (im[i + k + len / 2] as number) * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }

  const bins: SpectrumBin[] = [];
  for (let k = 1; k < n / 2; k++) {
    bins.push({ hz: (k * sampleRate) / n, power: (re[k] as number) ** 2 + (im[k] as number) ** 2 });
  }
  return bins;
}

/**
 * How much of the buffer's energy sits in its single loudest FFT bin.
 *
 * THE HUM MEASUREMENT (UR-13). A steady tone puts nearly all of its energy into
 * one or two 0.73 Hz bins; filtered noise of the same loudness spreads the same
 * energy over tens of thousands of them. One number therefore separates "an
 * electrical hum" from "a thruster", and it does so without anyone having to
 * agree on what a thruster sounds like.
 */
export function tonality(samples: Float32Array, sampleRate: number): { fraction: number; hz: number } {
  const bins = powerSpectrum(samples, sampleRate);
  let total = 0;
  let best = { hz: 0, power: 0 };
  for (const bin of bins) {
    total += bin.power;
    if (bin.power > best.power) best = bin;
  }
  return { fraction: total <= 0 ? 0 : best.power / total, hz: best.hz };
}

/** The bin carrying the most power. "Where does this sound actually live." */
export function dominantHz(samples: Float32Array, sampleRate: number): number {
  const spectrum = powerSpectrum(samples, sampleRate);
  let best = spectrum[0] ?? { hz: 0, power: 0 };
  for (const bin of spectrum) if (bin.power > best.power) best = bin;
  return best.hz;
}

/**
 * The frequency below which `fraction` of the buffer's energy sits. A single
 * number for "is this sound dark or bright", and the one the hum test asserts.
 */
export function spectralRolloffHz(
  samples: Float32Array,
  sampleRate: number,
  fraction = 0.95,
): number {
  const spectrum = powerSpectrum(samples, sampleRate);
  let total = 0;
  for (const bin of spectrum) total += bin.power;
  if (total <= 0) return 0;
  let run = 0;
  for (const bin of spectrum) {
    run += bin.power;
    if (run >= total * fraction) return bin.hz;
  }
  return sampleRate / 2;
}

/**
 * The signal's loudness contour, as one value per `windowMs`.
 *
 * Periodicity in NOISE is not visible in the samples - two laps of a loop are
 * bit-identical but so is any other pair of identical buffers, and the ear does
 * not hear samples. What an ear latches onto in wind is the GUST PATTERN, which
 * is the envelope. So that is what gets measured.
 */
export function envelope(samples: Float32Array, sampleRate: number, windowMs = 50): Float64Array {
  const win = Math.max(1, Math.floor((sampleRate * windowMs) / 1000));
  const count = Math.floor(samples.length / win);
  const out = new Float64Array(Math.max(0, count));
  for (let k = 0; k < count; k++) {
    let sum = 0;
    for (let i = 0; i < win; i++) sum += (samples[k * win + i] as number) ** 2;
    out[k] = Math.sqrt(sum / win);
  }
  return out;
}

/**
 * Normalised autocorrelation of an envelope at a lag given in seconds.
 *
 * Mean-removed, so a constant level correlates at 0 rather than at 1 and the
 * number means "does the SHAPE repeat" rather than "is it the same loudness".
 * 1.0 is a perfect repeat; a loop of length L scores ~1.0 at every multiple
 * of L and noise scores near 0 everywhere else.
 */
export function envelopeAutocorrelation(
  env: Float64Array,
  sampleRate: number,
  lagSeconds: number,
  windowMs = 50,
): number {
  const lag = Math.round((lagSeconds * 1000) / windowMs);
  const n = env.length - lag;
  if (lag <= 0 || n <= 8) return 0;
  let mean = 0;
  for (const v of env) mean += v;
  mean /= env.length;
  let num = 0;
  let a2 = 0;
  let b2 = 0;
  for (let i = 0; i < n; i++) {
    const a = (env[i] as number) - mean;
    const b = (env[i + lag] as number) - mean;
    num += a * b;
    a2 += a * a;
    b2 += b * b;
  }
  const den = Math.sqrt(a2 * b2);
  return den <= 0 ? 0 : num / den;
}

/**
 * ABSOLUTE energy in a band, as an RMS level.
 *
 * `bandEnergyFraction` answers "how much of this sound is down there", which is
 * the right question for a timbre and the WRONG one for a budget: a fraction
 * moves when any OTHER layer changes, so two fraction bars on the same sound
 * compete with each other. UR-48 added a large mid-band layer to the blast and
 * both of UR-30's fraction bars fell without one sample of the low end or the
 * attack changing.
 *
 * This does not move when something else is added. It is what a level claim -
 * "the blast still has its weight", "the crack is still there" - should be
 * measured against.
 */
export function bandRms(
  samples: Float32Array,
  sampleRate: number,
  loHz: number,
  hiHz: number,
): number {
  return rms(samples) * Math.sqrt(bandEnergyFraction(samples, sampleRate, loHz, hiHz));
}
