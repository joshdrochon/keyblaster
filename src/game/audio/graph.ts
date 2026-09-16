/**
 * The bus graph (architecture section 6, D62).
 *
 * Architecture 6, verbatim:
 *
 *   Master -> [Music bus (3 layer gains, crossfaded by intensity index)]
 *           + [Ambient bus (per-stop bed, crossfade on transition)]
 *           + [SFX bus (procedural nodes, variant rotation)]
 *           + [Voice bus (Web Speech API system voice by default; optional
 *              pre-rendered ElevenLabs files; sidechain ducks Music/Ambient
 *              -6 dB)]. UI sounds on SFX bus.
 *
 * That paragraph is the whole specification and this file is its only
 * implementation. `BUSES` below is the topology as data, `buildAudioGraph`
 * wires it, and the tests assert the wiring by walking the REAL connections on
 * a recording context - not by re-reading the table.
 *
 * "UI sounds on SFX bus" is a graph fact with teeth: it means one gain change
 * attenuates every click, tick and nav blip in the game, and it is asserted
 * rather than assumed, because the natural mistake is a separate UI bus.
 *
 * REDUCED MOTION DOES NOT AFFECT AUDIO (architecture 6, last line). There is no
 * `reducedMotion` anywhere under src/game/audio, deliberately: a child who
 * needs less movement has not asked for less music.
 */

import {
  clamp,
  dbToGain,
  gainToDb,
  seededRandom,
  type AudioContextLike,
  type AudioNodeLike,
  type GainNodeLike,
} from "./context.js";
import { label } from "./nullContext.js";
import { AmbientBus } from "./ambient.js";
import { MusicBus } from "./music.js";
import { SfxBus } from "./sfx.js";
import { KeystrokeTone } from "./keystrokeTone.js";
import {
  createVoiceTransport,
  DUCK_DB,
  VoiceBus,
  type Ducker,
  type VoiceEnvironment,
} from "./voice.js";

export type BusId = "master" | "music" | "ambient" | "sfx" | "voice";

export interface BusSpec {
  readonly id: BusId;
  /** null only for master, which feeds the destination. */
  readonly parent: BusId | null;
  /** Resting linear gain. The mix, in one column. */
  readonly gain: number;
  /** Does the Voice bus sidechain pull this one down? (AC-21.4) */
  readonly duckedByVoice: boolean;
  readonly note: string;
}

export const BUSES: readonly BusSpec[] = [
  { id: "master", parent: null, gain: 0.85, duckedByVoice: false, note: "one place to attenuate everything" },
  { id: "music", parent: "master", gain: 0.7, duckedByVoice: true, note: "three intensity layer gains (AC-21.2)" },
  { id: "ambient", parent: "master", gain: 0.8, duckedByVoice: true, note: "per-stop bed, crossfaded (AC-21.1)" },
  { id: "sfx", parent: "master", gain: 0.9, duckedByVoice: false, note: "procedural events AND all UI sound" },
  { id: "voice", parent: "master", gain: 1.0, duckedByVoice: false, note: "Shadow; ducks the two above (AC-21.4)" },
];

export const BUS_IDS: readonly BusId[] = BUSES.map((b) => b.id);

/** Architecture 6: "UI sounds on SFX bus." Not a separate bus. */
export const UI_BUS: BusId = "sfx";

/** The two buses the voice sidechain pulls down. Derived from the table. */
export const DUCK_TARGET_IDS: readonly BusId[] = BUSES.filter((b) => b.duckedByVoice).map((b) => b.id);

export function busSpec(id: BusId): BusSpec {
  const found = BUSES.find((b) => b.id === id);
  if (!found) throw new Error(`unknown bus: ${String(id)}`);
  return found;
}

// ---------------------------------------------------------------------------
// The sidechain (AC-21.4)
// ---------------------------------------------------------------------------

/** Fast enough that the first syllable is already clear; not a click. */
export const DUCK_ATTACK_MS = 120;
/** Slower than the attack, so the world comes back rather than snapping back. */
export const DUCK_RELEASE_MS = 420;

interface DuckTarget {
  readonly id: BusId;
  readonly gain: GainNodeLike;
  /** The undacked resting gain, captured once at construction. */
  readonly base: number;
}

/**
 * The sidechain compressor, done honestly as a scheduled gain move.
 *
 * A real `DynamicsCompressorNode` sidechain is not expressible in Web Audio
 * without routing the voice into the compressor's input, which would mix
 * Shadow into the music. Every browser game does this instead, and it has the
 * decisive advantage that the reduction is an exact number we chose rather than
 * an emergent property of a compressor's knee - which matters when AC-21.4 is
 * "at least 6 dB" and has to be MEASURED for the evidence artifact.
 *
 * Nested ducks are counted, not booleaned: two overlapping lines must not have
 * the first one's release un-duck the second one's music.
 */
export class SidechainDucker implements Ducker {
  private depth = 0;

  constructor(
    private readonly ctx: AudioContextLike,
    private readonly targets: readonly DuckTarget[],
    readonly duckDb: number = DUCK_DB,
  ) {}

  get ducking(): boolean {
    return this.depth > 0;
  }

  /** The buses this ducker moves. Read by the graph tests and the evidence. */
  targetIds(): readonly BusId[] {
    return this.targets.map((t) => t.id);
  }

  duck(active: boolean): void {
    this.depth = active ? this.depth + 1 : Math.max(0, this.depth - 1);
    const ducked = this.depth > 0;
    const rampMs = ducked ? DUCK_ATTACK_MS : DUCK_RELEASE_MS;
    const multiplier = ducked ? dbToGain(this.duckDb) : 1;
    const now = this.ctx.currentTime;

    for (const target of this.targets) {
      const to = target.base * multiplier;
      target.gain.gain.cancelScheduledValues(now);
      target.gain.gain.setValueAtTime(target.gain.gain.value, now);
      target.gain.gain.linearRampToValueAtTime(to, now + rampMs / 1000);
    }
  }

  /**
   * MEASURED reduction, in dB, per bus: duck, read, release, read. This is what
   * the evidence artifact reports - the number comes out of the graph, it is
   * not copied from `duckDb`.
   */
  measureReductionDb(): Record<string, number> {
    const before = new Map<BusId, number>();
    for (const t of this.targets) before.set(t.id, t.gain.gain.value);

    this.duck(true);
    const measured: Record<string, number> = {};
    for (const t of this.targets) {
      const base = before.get(t.id) ?? t.base;
      measured[t.id] = base > 0 ? gainToDb(t.gain.gain.value / base) : Number.NEGATIVE_INFINITY;
    }
    this.duck(false);
    return measured;
  }
}

// ---------------------------------------------------------------------------
// The graph
// ---------------------------------------------------------------------------

export interface AudioGraphOptions {
  readonly voiceEnv: VoiceEnvironment;
  /** Injected so variant rotation is reproducible in a test. */
  readonly rand?: () => number;
  /** Overall level, 0..1. Settings will drive this. */
  readonly masterGain?: number;
}

export interface AudioGraph {
  readonly ctx: AudioContextLike;
  readonly buses: Readonly<Record<BusId, GainNodeLike>>;
  readonly music: MusicBus;
  readonly ambient: AmbientBus;
  readonly sfx: SfxBus;
  readonly keystrokeTone: KeystrokeTone;
  readonly voice: VoiceBus;
  readonly ducker: SidechainDucker;
  /** Step the time-based buses. One call per frame from the scene. */
  advance(dtMs: number): void;
  /** Set the overall level without disturbing the ducker's captured bases. */
  setMasterGain(gain: number): void;
}

/**
 * Build the whole graph on a context. The ONLY place any of these buses are
 * created, so "is UI on the SFX bus" has exactly one answer.
 */
export function buildAudioGraph(ctx: AudioContextLike, options: AudioGraphOptions): AudioGraph {
  const rand = options.rand ?? seededRandom(0x9e3779b9);

  const buses = {} as Record<BusId, GainNodeLike>;
  for (const spec of BUSES) {
    const gain = label(ctx.createGain(), `bus.${spec.id}`);
    gain.gain.value = spec.id === "master" ? clamp(options.masterGain ?? spec.gain, 0, 1) : spec.gain;
    buses[spec.id] = gain;
  }
  for (const spec of BUSES) {
    const node: AudioNodeLike = buses[spec.id];
    node.connect(spec.parent === null ? ctx.destination : buses[spec.parent]);
  }

  const ducker = new SidechainDucker(
    ctx,
    DUCK_TARGET_IDS.map((id) => ({ id, gain: buses[id], base: busSpec(id).gain })),
    DUCK_DB,
  );

  const music = new MusicBus(ctx, buses.music);
  const ambient = new AmbientBus(ctx, buses.ambient);
  const sfx = new SfxBus(ctx, buses.sfx, rand);
  // D75's pitched layer rides the SFX bus with the rest of the keystroke sound.
  const keystrokeTone = new KeystrokeTone(ctx, buses.sfx);
  const voice = new VoiceBus({ transport: createVoiceTransport(options.voiceEnv), ducker });

  return {
    ctx,
    buses,
    music,
    ambient,
    sfx,
    keystrokeTone,
    voice,
    ducker,
    advance(dtMs: number): void {
      music.advance(dtMs);
      ambient.advance(dtMs);
    },
    setMasterGain(gain: number): void {
      buses.master.gain.value = clamp(gain, 0, 1);
    },
  };
}
