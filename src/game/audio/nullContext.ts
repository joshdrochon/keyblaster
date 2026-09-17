/**
 * An in-memory `AudioContextLike` that makes no sound and records the graph.
 *
 * It exists for three reasons, in order of importance:
 *
 * 1. UNIT TESTS. Node has no Web Audio. Every structural claim the audio rubric
 *    makes - five buses, three music layer gains, seven ambient beds, a duck of
 *    -6 dB on Music and Ambient - is asserted by building the REAL graph on this
 *    context and reading back what was created and connected. Nothing is
 *    asserted against a hand-written description of the graph.
 * 2. THE EVIDENCE EMITTER. gauntlet/evidence/audio-graph.json is produced by
 *    building the real graph here and measuring it, so the numbers in it are
 *    derived, never typed in (D85: a claim without an artifact is not a pass).
 * 3. A SAFE RUNTIME FALLBACK. If `AudioContext` is missing or blocked, the game
 *    binds to this instead of branching on `if (audio)` at forty call sites.
 *    Silence is a degraded experience; a crash is a broken one.
 *
 * It is a RECORDER, not a simulator: ramps land on their destination value
 * immediately. Fade SHAPES are proven by the pure curve functions in context.ts,
 * which is where the shape actually lives; this file only proves what was wired
 * to what, and with which numbers.
 */

import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  BiquadKind,
  GainNodeLike,
  OscillatorNodeLike,
  OscillatorWave,
  StereoPannerNodeLike,
} from "./context.js";

export type NullNodeKind =
  | "destination"
  | "gain"
  | "oscillator"
  | "biquad"
  | "bufferSource"
  | "panner"
  | "mediaSource";

/** One scheduled automation call, kept so tests can assert ramps happen. */
export interface ParamEvent {
  readonly kind: "set" | "linear" | "exponential" | "cancel";
  readonly value: number;
  readonly time: number;
}

export class NullParam implements AudioParamLike {
  value: number;
  readonly events: ParamEvent[] = [];

  constructor(initial: number) {
    this.value = initial;
  }

  setValueAtTime(value: number, startTime: number): AudioParamLike {
    this.events.push({ kind: "set", value, time: startTime });
    this.value = value;
    return this;
  }

  linearRampToValueAtTime(value: number, endTime: number): AudioParamLike {
    this.events.push({ kind: "linear", value, time: endTime });
    this.value = value;
    return this;
  }

  exponentialRampToValueAtTime(value: number, endTime: number): AudioParamLike {
    this.events.push({ kind: "exponential", value, time: endTime });
    this.value = value;
    return this;
  }

  cancelScheduledValues(startTime: number): AudioParamLike {
    this.events.push({ kind: "cancel", value: this.value, time: startTime });
    return this;
  }
}

let nextNodeId = 0;

export class NullNode implements AudioNodeLike {
  readonly id: number = nextNodeId++;
  readonly outputs: NullNode[] = [];
  /** Set by graph.ts via `label()`, so a recorded graph is readable. */
  label: string | null = null;
  started = false;
  stopped = false;

  constructor(readonly kind: NullNodeKind) {}

  connect(destination: AudioNodeLike): void {
    if (destination instanceof NullNode) this.outputs.push(destination);
  }

  disconnect(): void {
    this.outputs.length = 0;
  }
}

export class NullGain extends NullNode implements GainNodeLike {
  readonly gain = new NullParam(1);
  constructor() {
    super("gain");
  }
}

export class NullOscillator extends NullNode implements OscillatorNodeLike {
  type: OscillatorWave = "sine";
  readonly frequency = new NullParam(440);
  readonly detune = new NullParam(0);
  constructor() {
    super("oscillator");
  }
  start(when?: number): void {
    void when;
    this.started = true;
  }
  stop(when?: number): void {
    void when;
    this.stopped = true;
  }
}

export class NullBiquad extends NullNode implements BiquadFilterNodeLike {
  type: BiquadKind = "lowpass";
  readonly frequency = new NullParam(350);
  readonly Q = new NullParam(1);
  constructor() {
    super("biquad");
  }
}

export class NullBuffer implements AudioBufferLike {
  private readonly channels: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(channel: number): Float32Array {
    const data = this.channels[channel];
    if (!data) throw new RangeError(`no channel ${channel}`);
    return data;
  }
}

export class NullBufferSource extends NullNode implements AudioBufferSourceNodeLike {
  buffer: AudioBufferLike | null = null;
  loop = false;
  readonly playbackRate = new NullParam(1);
  constructor() {
    super("bufferSource");
  }
  start(when?: number): void {
    void when;
    this.started = true;
  }
  stop(when?: number): void {
    void when;
    this.stopped = true;
  }
}

export class NullPanner extends NullNode implements StereoPannerNodeLike {
  readonly pan = new NullParam(0);
  constructor() {
    super("panner");
  }
}

/**
 * The recording context. `currentTime` only moves when a test moves it, which
 * is what makes a 2.2 s ambient crossfade a zero-millisecond test.
 */
export class NullAudioContext implements AudioContextLike {
  readonly sampleRate: number;
  readonly destination: NullNode = new NullNode("destination");
  /** Every node this context ever made, in creation order. */
  readonly created: NullNode[] = [];
  private time = 0;

  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.destination.label = "destination";
    this.created.push(this.destination);
  }

  get currentTime(): number {
    return this.time;
  }

  /** Move the clock forward, in seconds. Tests only. */
  advance(seconds: number): void {
    this.time += seconds;
  }

  private track<T extends NullNode>(node: T): T {
    this.created.push(node);
    return node;
  }

  createGain(): GainNodeLike {
    return this.track(new NullGain());
  }
  createOscillator(): OscillatorNodeLike {
    return this.track(new NullOscillator());
  }
  createBiquadFilter(): BiquadFilterNodeLike {
    return this.track(new NullBiquad());
  }
  createBufferSource(): AudioBufferSourceNodeLike {
    return this.track(new NullBufferSource());
  }
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike {
    return new NullBuffer(numberOfChannels, length, sampleRate);
  }
  createStereoPanner(): StereoPannerNodeLike {
    return this.track(new NullPanner());
  }
  /**
   * A recorded stand-in for `createMediaElementSource`. The element is kept so
   * a test can assert WHICH clip was routed, which is the only thing a recorder
   * can honestly say about a media source.
   */
  createMediaElementSource(element: unknown): AudioNodeLike {
    const node = this.track(new NullNode("mediaSource"));
    this.mediaElements.push(element);
    return node;
  }

  /** Every element handed to `createMediaElementSource`, in order. */
  readonly mediaElements: unknown[] = [];

  /** Every node carrying a label, e.g. every bus and every named layer. */
  labelled(): NullNode[] {
    return this.created.filter((n) => n.label !== null);
  }

  /** Nodes whose label starts with `prefix`, e.g. "ambient.bed.". */
  labelledWith(prefix: string): NullNode[] {
    return this.created.filter((n) => n.label !== null && n.label.startsWith(prefix));
  }
}

/** Attach a readable name to a node, if the context is recording. Chainable. */
export function label<T extends AudioNodeLike>(node: T, name: string): T {
  if (node instanceof NullNode) node.label = name;
  return node;
}

/** Does a signal path exist from `from` to `to`? Follows `connect` edges. */
export function reaches(from: AudioNodeLike, to: AudioNodeLike): boolean {
  if (!(from instanceof NullNode) || !(to instanceof NullNode)) return false;
  const seen = new Set<number>();
  const stack: NullNode[] = [from];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || seen.has(node.id)) continue;
    seen.add(node.id);
    if (node === to) return true;
    for (const next of node.outputs) stack.push(next);
  }
  return false;
}

/** A serialisable dump of the recorded graph, for debugging and evidence. */
export function describeRecordedGraph(ctx: NullAudioContext): Array<{
  id: number;
  kind: NullNodeKind;
  label: string | null;
  connectedTo: Array<string | number>;
}> {
  return ctx.created.map((n) => ({
    id: n.id,
    kind: n.kind,
    label: n.label,
    connectedTo: n.outputs.map((o) => o.label ?? o.id),
  }));
}
