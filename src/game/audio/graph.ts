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
  type AudioBufferLike,
  type AudioNodeLike,
  type GainNodeLike,
} from "./context.js";
import { label } from "./nullContext.js";
import { playChirp } from "./chirp.js";
import { AmbientBus } from "./ambient.js";
import { MusicBus, type MusicTrackCatalog } from "./music.js";
import { SfxBus } from "./sfx.js";
import { KeystrokeTone } from "./keystrokeTone.js";
import {
  createVoiceTransport,
  DUCK_DB,
  VoiceBus,
  type Ducker,
  type VoiceEnvironment,
} from "./voice.js";
import { createVoiceClipPlayer, type VoiceClipCatalog } from "./voiceClips.js";

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
  /**
   * The unducked resting gain. Captured at construction from the bus table and
   * moved afterwards only by `setBase`, which is how a settings volume slider
   * reaches a ducked bus: if the slider wrote the gain node directly, the next
   * release would ramp the bus back to the SHIPPED level and the child's choice
   * would be undone the moment Shadow finished a sentence.
   */
  base: number;
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

  /**
   * Move a target's resting level (a settings volume) and re-apply whatever
   * duck state is in flight, so a slider dragged mid-line lands immediately and
   * the release still comes back to the NEW level rather than the shipped one.
   * Returns false when this ducker does not own the bus, which is how
   * `setBusGain` knows to write the node itself.
   */
  setBase(id: BusId, base: number): boolean {
    const target = this.targets.find((t) => t.id === id);
    if (target === undefined) return false;
    target.base = clamp(base, 0, 1);
    const multiplier = this.depth > 0 ? dbToGain(this.duckDb) : 1;
    const now = this.ctx.currentTime;
    target.gain.gain.cancelScheduledValues(now);
    target.gain.gain.setValueAtTime(target.base * multiplier, now);
    target.gain.gain.value = target.base * multiplier;
    return true;
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
  /**
   * Shadow's rendered lines (D63), if this build ships any.
   *
   * It arrives HERE rather than on `voiceEnv` because a clip has to be routed
   * into the graph to be worth playing, and the voice bus does not exist until
   * `buildAudioGraph` has made it. Same reasoning as the `chirp` below: the
   * wiring belongs at the graph, so `voice.ts` still names no sibling and
   * AC-21.7's boundary test stays honest.
   */
  readonly voiceClips?: VoiceClipCatalog;
  /**
   * The composed music (E-MUSIC-1, UR-12), if this build ships any. Absent in
   * Node, in the evidence emitter, and in a build with no assets - all of which
   * get the synthesised layer stack instead. See `MusicBusOptions.tracks`.
   */
  readonly musicTracks?: MusicTrackCatalog;
  /**
   * Decoder for those tracks. Left out in the browser, where the context's own
   * `decodeAudioData` is used; a test injects one because `NullAudioContext`
   * has no decoder and must not grow a fake one - "this machine cannot decode"
   * is a real state the bus has to handle, and a null context is how it is
   * reached.
   */
  readonly musicDecode?: (data: ArrayBuffer) => Promise<AudioBufferLike>;
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
  /**
   * Line ids this graph can play from a RENDERED FILE (D63). Empty on a build
   * that shipped none, and empty on a context that cannot route a media
   * element - which are different situations with the same consequence.
   *
   * Separate from `voice.transportId` on purpose; see the `id` getter in
   * `adaptiveTransport`. Together they answer "what can this machine do":
   * `transportId` is the speech path for an unrendered line, this is the set of
   * lines that never need it.
   */
  readonly voiceClipIds: readonly string[];
  /** Step the time-based buses. One call per frame from the scene. */
  advance(dtMs: number): void;
  /** Set the overall level without disturbing the ducker's captured bases. */
  setMasterGain(gain: number): void;
  /**
   * Set ONE bus's resting level - what the settings volume sliders drive
   * (AC-19.1). For a ducked bus this also moves the sidechain's base, so the
   * new level survives the next voice line; see `SidechainDucker.setBase`.
   */
  setBusGain(id: BusId, gain: number): void;
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

  const music = new MusicBus(ctx, buses.music, {
    ...(options.musicTracks !== undefined ? { tracks: options.musicTracks } : {}),
    ...(options.musicDecode !== undefined ? { decode: options.musicDecode } : {}),
  });
  const ambient = new AmbientBus(ctx, buses.ambient);
  const sfx = new SfxBus(ctx, buses.sfx, rand);
  // D75's pitched layer rides the SFX bus with the rest of the keystroke sound.
  const keystrokeTone = new KeystrokeTone(ctx, buses.sfx);
  // Shadow's stand-in when a line cannot be voiced (AC-21.5: the machine offers
  // only cloud voices, or the browser refused the utterance). `uiNav` is the
  // game's smallest, calmest tone and D31 forbids anything that reads as a
  // failure - a chirp here says "he said something", it does not say "error".
  // Wired at the graph rather than inside voice.ts so that module still names
  // no sibling and AC-21.7's boundary test stays honest.
  //
  // THE RENDERED LINES (D63). Routed to `buses.voice`, which is what makes the
  // AC-21.4 duck, the master fader and the settings volumes apply to Shadow's
  // recorded voice - none of which reach a Web Speech utterance, because that
  // one never enters the graph at all. Null when the context cannot route a
  // media element, in which case nothing changes and every line is spoken by
  // the platform exactly as before.
  const clips =
    options.voiceClips === undefined
      ? null
      : createVoiceClipPlayer(ctx, buses.voice, options.voiceClips, options.voiceEnv.schedule);

  const voiceEnv: VoiceEnvironment = {
    ...options.voiceEnv,
    // UR-25 - SHADOW'S OWN SOUND, ON SHADOW'S OWN BUS.
    //
    // This used to borrow `uiNav` from the SFX bus, which put "the robot said
    // something" in the same voice, at the same level and on the same fader as
    // "you moved the menu cursor" - and inside the stream the keystroke cue is
    // firing in. It is now its own recipe routed to `buses.voice`, so it ducks,
    // fades and mixes with Shadow's recorded lines because it IS one of them.
    // See chirp.ts for how far it is held from the keystroke tick.
    chirp: options.voiceEnv.chirp ?? ((): void => playChirp(ctx, buses.voice)),
    ...(clips !== null ? { clips } : {}),
  };
  // The bus serialises Shadow's lines and holds the AC-21.4 duck across the
  // gap between two of them, so it needs the same clock the transport uses.
  const voice = new VoiceBus({
    transport: createVoiceTransport(voiceEnv),
    ducker,
    schedule: voiceEnv.schedule,
  });

  return {
    ctx,
    buses,
    voiceClipIds: clips === null ? [] : (options.voiceClips?.ids() ?? []),
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
    setBusGain(id: BusId, gain: number): void {
      const node = buses[id];
      if (node === undefined) return;
      const level = clamp(gain, 0, 1);
      // The ducker owns music and ambient; it writes the node itself so the
      // level and the duck state can never disagree. Everything else is a
      // plain assignment.
      if (!ducker.setBase(id, level)) node.gain.value = level;
    },
  };
}
