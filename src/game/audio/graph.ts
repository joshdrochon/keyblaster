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

/**
 * ============ THE PAUSE MENU'S DUCK (UR-145) ============
 *
 * The project owner: the pause menu should make the music QUIETER, it should
 * STAY quieter if Settings is opened from inside it, and coming out of pause
 * should feel like dropping back into the action.
 *
 * WHY -4.5 AND NOT SOMETHING ELSE.
 *
 *   It must be SHALLOWER THAN THE VOICE DUCK. `DUCK_DB` is -6 and that number
 *   is a specification: AC-21.4 says Shadow talking pulls the world down at
 *   least 6 dB. A pause that ducked harder would say the menu is a bigger
 *   interruption than the character speaking, and worse, it would make the
 *   voice duck inaudible on top of it - Shadow would start a line and nothing
 *   in the mix would move.
 *
 *   It must be DEEPER THAN 3 dB. A 3 dB step on a sustained bed sits around the
 *   threshold where a listener notices a level change at all, and the owner's
 *   report is that the drop should be obvious. 4.5 dB is 0.6x amplitude - a
 *   plain, unmistakable drop.
 *
 *   It must NOT be a mute. The whole request is about the RETURN; you cannot
 *   return to something that was switched off. At -4.5 the music is still
 *   playing under the menu and the release is a swell rather than a power-on.
 *
 * THE RAMPS ARE THE EXISTING ONES, deliberately. `DUCK_ATTACK_MS` (120) lands
 * the drop with the freeze - a pause that dips over half a second reads as lag
 * - and `DUCK_RELEASE_MS` (420) is already the constant whose whole reason for
 * being slower than the attack is "the world comes back rather than snapping
 * back", which is the owner's sentence in different words. A second pair of
 * pause-specific constants would be two more numbers to keep in step with
 * nothing gained; see CLAUDE.md on shared values.
 */
export const PAUSE_DUCK_DB = -4.5;

/** The name the pause menu holds its duck under. One holder, one name. */
export const PAUSE_DUCK_SOURCE = "pause";

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

  /**
   * NAMED DUCKS, EACH WITH ITS OWN DEPTH (UR-145).
   *
   * `duck(active)` is the VOICE sidechain and is counted, because two
   * overlapping lines are two events. A pause is not an event, it is a STATE: a
   * screen is up or it is not, and the same screen asking twice must not need
   * two releases. So it is held by name at its own dB, and dropped by name.
   *
   * THE REDUCTIONS DO NOT ADD UP, and that is the decision in this design.
   * Shadow can be mid-sentence when a child hits Escape, and stacking -6 on
   * -4.5 would put the music 10.5 dB down - quieter than either claim asked
   * for, and the resume would then ramp back to a level the voice duck had not
   * finished with. The DEEPEST claim in force wins instead, which is the same
   * rule the voice counter already implements for nested lines: two lines duck
   * exactly as far as one.
   */
  private readonly sources = new Map<string, number>();

  /** The reduction currently applied, so a move knows which way it is going. */
  private appliedDb = 0;

  /**
   * ============ WHERE THE NEXT RAMP STARTS FROM (UR-145) ============
   *
   * This used to be `target.gain.gain.value`, and UR-46 already wrote down why
   * that is not a number this class may trust: a scheduled ramp does not move
   * `.value` on every context, so the read can hand back the anchor of the
   * PREVIOUS ramp instead of where the param actually is. UR-46 applied the
   * lesson to the evidence artifact and left the anchor alone.
   *
   * It is the same bug and it is worse here, because it is not a report - it
   * is the mix. Measured on `tests/unit/audio/offline.ts`, which renders:
   * duck at 0.5 s, release at 2.0 s, and the release ARRIVED IN ONE BLOCK.
   * The attack ramped (0.6348 of rest at 0.6 s, settling to 0.5957) and then
   * `setValueAtTime(gain.value, now)` anchored the release at 0.7 - the
   * attack's own starting value, still sitting in `.value` - so the ramp ran
   * from rest to rest and the music snapped back. The owner's whole request
   * for this ticket is that it must NOT do that.
   *
   * So the ducker computes the anchor from what it COMMITTED, the same way
   * `scheduledReductionDb` reports from what it committed: the previous ramp
   * was a straight line from `from` to `target` over `rampSeconds`, so where
   * it had got to at `now` is arithmetic this class already has every term of.
   * No context is asked anything, which is the property that makes it true on
   * all of them.
   */
  private rampStartedAt = 0;
  private rampSeconds = 0;

  constructor(
    private readonly ctx: AudioContextLike,
    private readonly targets: readonly DuckTarget[],
    readonly duckDb: number = DUCK_DB,
  ) {}

  get ducking(): boolean {
    return this.depth > 0 || this.sources.size > 0;
  }

  /** The named ducks in force. Read by the wiring snapshot and the evidence. */
  activeSources(): readonly string[] {
    return [...this.sources.keys()];
  }

  /** The reduction in force right now, in dB. Never the sum; see `sources`. */
  reductionDb(): number {
    let db = this.depth > 0 ? this.duckDb : 0;
    for (const value of this.sources.values()) db = Math.min(db, value);
    return db;
  }

  private multiplier(): number {
    return dbToGain(this.reductionDb());
  }

  /**
   * Hold or release a named duck. Idempotent on both sides: asking for a duck
   * that is already held, or releasing one that is not, does nothing at all -
   * which is what lets a scene call this from `create`, from `wake` and from
   * `shutdown` without counting.
   */
  setSource(id: string, active: boolean, db: number): void {
    if (active) {
      const level = Math.min(0, db);
      if (this.sources.get(id) === level) return;
      this.sources.set(id, level);
    } else if (!this.sources.delete(id)) {
      return;
    }
    this.move();
  }

  /**
   * Ramp every target to whatever the reduction now is.
   *
   * The DIRECTION picks the ramp, not the boolean that caused it: going deeper
   * is an attack, coming back up is a release. That matters exactly once and it
   * is the case this design exists for - Shadow finishing a line while the
   * pause menu is still up moves the mix from -6 to -4.5, which is a partial
   * RETURN and must not snap in at attack speed.
   */
  private move(): void {
    const next = this.reductionDb();
    const rampMs = next < this.appliedDb ? DUCK_ATTACK_MS : DUCK_RELEASE_MS;
    this.appliedDb = next;
    const multiplier = dbToGain(next);
    const now = this.ctx.currentTime;

    for (const target of this.targets) {
      const from = this.anchor(target, now);
      const to = target.base * multiplier;
      target.gain.gain.cancelScheduledValues(now);
      target.gain.gain.setValueAtTime(from, now);
      target.gain.gain.linearRampToValueAtTime(to, now + rampMs / 1000);
      // UR-46: remember what was committed, because a real `AudioParam` cannot
      // be asked afterwards. See `scheduledReductionDb` - and `anchor`, which
      // is the second reader this record now has.
      this.committed.set(target.id, { base: target.base, from, target: to });
    }
    // AFTER the loop: `anchor` above reads the PREVIOUS ramp's window.
    this.rampStartedAt = now;
    this.rampSeconds = rampMs / 1000;
  }

  /** Where the ramp this class last scheduled for `target` had got to at `now`. */
  private anchor(target: DuckTarget, now: number): number {
    const last = this.committed.get(target.id);
    // Nothing committed yet: the node has only ever held its resting gain, and
    // reading it is safe precisely because no automation has run on it.
    if (last === undefined) return target.gain.gain.value;
    const t =
      this.rampSeconds <= 0
        ? 1
        : clamp((now - this.rampStartedAt) / this.rampSeconds, 0, 1);
    return last.from + (last.target - last.from) * t;
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
    // EVERY duck in force, not just the voice one (UR-145). A child dragging
    // the Music knob inside Settings-from-pause is the case: the knob must land
    // at the level they will hear when the menu closes, which means the write
    // has to carry the pause reduction the same way it carries the voice one.
    const multiplier = this.multiplier();
    const now = this.ctx.currentTime;
    const level = target.base * multiplier;
    target.gain.gain.cancelScheduledValues(now);
    target.gain.gain.setValueAtTime(level, now);
    target.gain.gain.value = level;
    // The node is AT this level with no ramp in flight, so the next `move`
    // must anchor here and not on a ramp this write just cancelled.
    this.committed.set(id, { base: target.base, from: level, target: level });
    return true;
  }

  duck(active: boolean): void {
    this.depth = active ? this.depth + 1 : Math.max(0, this.depth - 1);
    this.move();
  }

  /**
   * The reduction this sidechain SCHEDULED, in dB, per bus.
   *
   * UR-46 - THIS USED TO CLAIM TO BE A MEASUREMENT AND WAS NOT.
   *
   * It read `gain.value` immediately after `duck(true)`, which schedules a
   * `linearRampToValueAtTime`. On a real `AudioContext` a scheduled ramp does
   * not move `.value` at all, so on the shipping context this returned 0 dB for
   * every bus. It returned -6 only under `NullAudioContext`, whose `NullParam`
   * applies a ramp synchronously (nullContext.ts) - and `NullAudioContext` is
   * what the evidence emitter runs on. So `audio-graph.json` has been reporting
   * a number produced by the harness rather than by the product, which is the
   * pattern docs/verification-gaps.md is about.
   *
   * There is no honest way to read a ramp back off a real `AudioParam` - the
   * Web Audio API exposes no automation introspection - so this no longer
   * pretends to. It reports what the ducker COMMITTED: the ramp target it
   * wrote, against the base it wrote it from, recorded at the moment it was
   * scheduled. That is a true statement about the graph on every context, and
   * it is not a restatement of `duckDb`, because a bus whose base moved under a
   * settings slider gives a different answer.
   *
   * THE AUDIO ITSELF is measured in `tests/unit/audio/rendered.test.ts`, by
   * rendering the duck and reading the samples. That is the check that would
   * catch a ramp that never arrives; this one cannot, and no longer says it can.
   */
  scheduledReductionDb(): Record<string, number> {
    // The VOICE depth, not `ducking` (UR-145). `ducking` now also reports a
    // named duck, and reading it here would leave the probe's own `duck(true)`
    // un-released for as long as the pause menu happened to be up.
    const wasDucking = this.depth > 0;
    this.duck(true);
    const out: Record<string, number> = {};
    for (const t of this.targets) {
      const committed = this.committed.get(t.id);
      // A bus already at zero has no reduction to express, and reporting 0 dB
      // for it would read as "not ducked". Same answer this always gave.
      out[t.id] =
        committed === undefined || committed.base <= 0
          ? Number.NEGATIVE_INFINITY
          : gainToDb(committed.target / committed.base);
    }
    if (!wasDucking) this.duck(false);
    return out;
  }

  /** What the last ramp on each bus was aimed at, and where from. */
  private readonly committed = new Map<
    BusId,
    { base: number; from: number; target: number }
  >();
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
  /**
   * How many times Shadow has chirped (UR-25). The chirp stands in for every
   * line that will make no sound, so a run with spoken lines and zero chirps
   * and no clips is a mute robot - which is exactly what UR-25 reported and
   * what nothing could see.
   */
  readonly chirpCount: number;
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

  /**
   * UR-25 / UR-46: the chirp's only observable trace.
   *
   * `playChirp` builds nodes on the voice bus and touches no history, so once
   * the chirp stopped borrowing `uiNav` there was nothing left for a test to
   * read - and `shadow-voice.spec.ts` was still counting `sfx.history()`, which
   * the chirp no longer reaches. An assertion with nothing behind it is worse
   * than none, so the graph counts them.
   */
  let chirps = 0;
  const chirp = options.voiceEnv.chirp ?? ((): void => playChirp(ctx, buses.voice));

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
    chirp: (): void => {
      chirps += 1;
      chirp();
    },
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
    get chirpCount(): number {
      return chirps;
    },
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
