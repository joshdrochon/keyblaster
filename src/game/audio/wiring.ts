/**
 * THE CONNECTION LAYER (D62, D63, D75, D88; audit.md 1.2).
 *
 * Everything else under src/game/audio is a sound. This file is the reason a
 * player hears one.
 *
 * The audit's finding was not that the audio was bad, it was that the audio was
 * UNREACHABLE: `createAudioSystem()` had no caller outside its own unit test,
 * `SettingsScene` read a registry key nobody wrote, and `FLIGHT_EVENTS.cue` was
 * emitted into a room with no listeners. Five rubric items were green for a
 * subsystem that was not part of the product.
 *
 * So this module owns exactly one job: turn the game's existing signals into
 * calls on the graph, and record - as data, not as a claim - what it routed.
 *
 *   FLIGHT_EVENTS.cue   -> SfxBus.play + KeystrokeTone           (the ten events)
 *   FLIGHT_EVENTS.hud   -> MusicBus.setFromState(live, combo)    (AC-21.2)
 *   scene start         -> AmbientBus.start / transitionTo       (AC-21.1)
 *   FocusList           -> SfxBus.play("uiNav")                  (AC-21.3)
 *   settings volumes    -> AudioGraph.setBusGain                 (AC-19.1)
 *   Shadow's lines      -> VoiceBus.speak, ducking the world     (AC-21.4/6)
 *
 * WHY IT IS PHASER-FREE. The rest of this package is unit-testable in Node
 * because no file in it touches a global or a framework, and the module that
 * connects it must not be the one that breaks that: an untestable connector is
 * how the disconnection happened in the first place. So the game's emitter and
 * registry arrive as two-method ports, boot.ts passes `game.events` and
 * `game.registry`, and a test passes plain objects.
 *
 * WHAT IS DELIBERATELY SILENT. `park` (the word is armed, and the blast that
 * follows it is the sound of that) and `stall` (D31: nothing in this game may
 * read as failure, and the moment the engines go quiet is the last place to put
 * a noise). `ignored` is NOT silent - AC-6e.2 promises every keystroke an audio
 * answer, including the one that matched nothing - but it gets the neutral
 * keystroke tick rather than the typo tick, because a key that landed nowhere is
 * not a mistake and must not be told it was. Neither does it move the D75
 * pitched layer: an ignored key neither advances the scale nor resets it.
 */

import { isStopId, type StopId } from "../../engine/types.js";
import { coachNoteClipId } from "../../engine/coach/spokenNotes.js";
import { clamp } from "./context.js";
import { NullAudioContext } from "./nullContext.js";
import { AMBIENT_CROSSFADE_MS } from "./ambient.js";
import type { AudioGraph, BusId } from "./graph.js";
import { SFX_EVENTS, type SfxEventId, type SfxPlayOptions, type SfxPlayResult } from "./sfx.js";
import {
  speakCoachNote,
  type CoachNoteDisplay,
  type CoachNoteSpeechResult,
  type SpokenNote,
  type VoiceLine,
} from "./voice.js";

/**
 * The registry key `SettingsScene` has read since before anything wrote it.
 * It is a contract with that file and with the e2e suite; do not rename it.
 */
export const AUDIO_REGISTRY_KEY = "kb.audio";

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/** A payload-carrying listener. Phaser's EventEmitter accepts one of these. */
export type ChannelHandler = (payload?: unknown) => void;

/** The slice of `Phaser.Events.EventEmitter` this module uses. */
export interface EventChannel {
  on(event: string, handler: ChannelHandler): unknown;
  off(event: string, handler: ChannelHandler): unknown;
}

/** The slice of `Phaser.Data.DataManager` this module uses. */
export interface RegistryLike {
  get(key: string): unknown;
  set(key: string, value: unknown): unknown;
}

// ---------------------------------------------------------------------------
// The flight channel
// ---------------------------------------------------------------------------

/**
 * `FlightCue` from `@game/flight/stage`, restated as a plain union so this
 * package keeps no dependency on the flight lane. The two are pinned together
 * by a test rather than by an import.
 */
export type FlightCueName =
  | "keystroke"
  | "lock"
  | "typo"
  | "ignored"
  | "blast"
  | "hit"
  | "shield"
  | "park"
  | "stall";

/**
 * The cues that END a word (UR-30). A rock destroyed, a rock that reached the
 * bottom, a belt that ran out - after any of them the next key the child presses
 * is the first key of a new word, and D75's ladder starts again at its root.
 */
export const WORD_ENDING_CUES: readonly FlightCueName[] = ["blast", "park", "stall"];

export const FLIGHT_CUE_NAMES: readonly FlightCueName[] = [
  "keystroke",
  "lock",
  "typo",
  "ignored",
  "blast",
  "hit",
  "shield",
  "park",
  "stall",
];

/**
 * What `FlightScene.cue()` emits. `combo` and `hull` are what D63's reactive
 * shaping needs - blast pitch rises with the combo, the hit thud grows as the
 * hull falls - and they are read at the instant of the cue rather than from the
 * HUD stream, because the HUD snapshot is published AFTER the cue and would be
 * one event stale on exactly the two events that use it.
 */
export interface FlightCuePayload {
  readonly cue: FlightCueName;
  readonly atMs?: number;
  readonly combo?: number;
  readonly hull?: number;
  readonly maxHull?: number;
  readonly live?: number;
}

/** What `FLIGHT_EVENTS.hud` carries, narrowed to the two numbers music wants. */
export interface HudLike {
  readonly combo?: number;
  readonly liveCount?: number;
  readonly hull?: number;
  readonly maxHull?: number;
}

/**
 * Cue -> sound. `null` is a DECISION, not a gap; see the header.
 * Exported so the evidence run and the rubric read the same table the game does.
 */
export const CUE_SFX: Readonly<Record<FlightCueName, SfxEventId | null>> = Object.freeze({
  keystroke: "keystroke",
  lock: "lock",
  typo: "typo",
  ignored: "keystroke",
  blast: "blast",
  hit: "hit",
  shield: "shield",
  park: null,
  stall: null,
});

// ---------------------------------------------------------------------------
// What the wiring saw
// ---------------------------------------------------------------------------

/** One routed sound, as it was actually scheduled. */
export interface RoutedPlay {
  readonly event: SfxEventId;
  readonly variant: string;
  readonly peakGain: number;
  readonly startHz: number;
  /** The graph context's clock at the moment it was scheduled. */
  readonly ctxTime: number;
  /** Where the call came from: a flight cue, the UI kit, or a scene. */
  readonly via: string;
}

/**
 * The evidence surface (D85).
 *
 * `gauntlet/evidence/audio-wiring.json` is built from this, and every field is
 * something the running game DID, counted here as it happened. Nothing in this
 * interface can be satisfied by a table, a constant, or a graph built inside a
 * unit test - which is the whole point, because that is exactly what
 * `audio-graph.json` could be satisfied by.
 */
export interface WiringSnapshot {
  readonly registryKey: string;
  /** The bus ids the live graph has, read off the graph. */
  readonly buses: readonly string[];
  /** "AudioContext" / "webkitAudioContext" / "NullAudioContext". */
  readonly contextKind: string;
  /** Times each of the ten SFX events was routed by the running game. */
  readonly played: Readonly<Record<string, number>>;
  /** How each event was reached, e.g. "flight-cue:blast", "ui:nav". */
  readonly reachedVia: Readonly<Record<string, readonly string[]>>;
  /** Flight cue names actually received from `FLIGHT_EVENTS.cue`. */
  readonly cuesRouted: readonly string[];
  /** The last few scheduled sounds, with the values that went to the nodes. */
  readonly recent: readonly RoutedPlay[];
  readonly sfxPlays: number;
  /** Keystroke-tone (D75) steps taken, and the pitch index reached. */
  readonly toneSteps: number;
  /**
   * How many times the pitched ladder went back to its root (UR-30). Next to
   * `toneSteps` on purpose: a run with hundreds of steps and no resets is the
   * defect - a belt spent on one note - and it is visible here without anyone
   * having to render the audio.
   */
  readonly toneResets: number;
  /**
   * Shadow's chirps (UR-25). Reported next to `spoken` on purpose: a run with
   * lines spoken, no rendered clips and no chirps is a silent robot, and that
   * is the defect a player had to ask about.
   */
  readonly chirps: number;
  /** Stops whose ambient bed the running game started or faded to, in order. */
  readonly ambientStops: readonly string[];
  readonly ambientCrossfades: number;
  /** Distinct music intensity indices the live HUD numbers produced. */
  readonly musicIndices: readonly number[];
  readonly hudSamples: number;
  /** The live graph's current music index. */
  readonly musicIndex: number;
  /** Stops the running game asked for a composed piece for, in order (UR-12). */
  readonly musicStops: readonly string[];
  /**
   * Stops this build shipped a composed piece for. Empty means the synthesised
   * layers are the music, which is a different situation from a track that
   * failed to load - and telling them apart is the whole reason this is here
   * next to `musicTrack`.
   */
  readonly musicTrackIds: readonly string[];
  /** The piece actually playing right now, or null. */
  readonly musicTrack: string | null;
  /** "synth" | "track" | "silent". `silent` means a track did not load. */
  readonly musicSource: string;
  readonly frames: number;
  readonly advancedMs: number;
  /** Voice lines the running game handed to the voice bus. */
  readonly spoken: readonly { readonly id: string; readonly kind: string }[];
  readonly voiceTransport: string;
  /**
   * Shadow's lines this build can play from a rendered file (D63).
   *
   * Reported next to `spoken`, so the evidence can answer the question that
   * matters - how many lines the running game actually took off disk - by
   * intersecting the two, rather than by anybody asserting it.
   */
  readonly voiceClipIds: readonly string[];
  /** Spoken line ids that had a rendered file. A subset of `spoken`. */
  readonly voiceClipsUsed: readonly string[];
  /** Lines waiting behind the one in flight. Never negative, never concurrent. */
  readonly voiceQueued: number;
  /** True while a line is actually in flight. At most one, ever. */
  readonly voiceSpeaking: boolean;
  /** Screen hand-offs seen; each one eased Shadow out (`interruptFor`). */
  readonly voiceInterrupts: number;
  /** The order `speakCoachNote` recorded the last time a note was shown. */
  readonly coachNoteOrder: readonly string[];
  /** Resting gain of each bus right now. Settings volumes land here. */
  readonly busGains: Readonly<Record<string, number>>;
  readonly volumes: { readonly music: number; readonly sfx: number };
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export interface AudioService {
  readonly graph: AudioGraph;
  /** Play one of the ten events directly. `via` is recorded for the evidence. */
  play(event: SfxEventId, via: string, options?: SfxPlayOptions): SfxPlayResult | null;
  /** Route a `FLIGHT_EVENTS.cue` payload. Returns null for a silent cue. */
  routeFlightCue(payload: FlightCuePayload): SfxPlayResult | null;
  /** The UI kit's focus/activate blip (architecture 6: UI is on the SFX bus). */
  uiNav(): SfxPlayResult | null;
  /** Start or crossfade the ambient bed for a stop (AC-21.1). */
  ambientFor(stopId: StopId, crossfadeMs?: number): void;
  /** Drive the music from live state (AC-21.2). */
  musicFromState(liveAsteroids: number, combo: number): number;
  /** One call per frame. Moves the ambient crossfade and the intensity ramp. */
  advance(dtMs: number): void;
  /** Settings volumes, straight onto the bus gains (AC-19.1). */
  setVolumes(volumes: { music?: number; sfx?: number }): void;
  /**
   * A scripted Shadow line (AC-21.4: the world ducks while he talks).
   *
   * QUEUED, never overlapped: if Shadow is mid-sentence this line waits its
   * turn. That is the right default because a scene emitting its next line is
   * the game talking to itself, and the game can wait for itself.
   */
  speak(line: VoiceLine): void;
  /**
   * THE PLAYER ADVANCED THE SCREEN, so Shadow gives way (see `VoiceBus.interrupt`).
   *
   * The line in flight eases out to silence - it finishes the word it is on,
   * then stops, then a short quiet beat - and `line`, if given, begins after
   * it. Anything queued behind is dropped, because it belonged to the screen
   * the player just left.
   *
   * This is the ONLY sanctioned way to displace a line in flight. A scene that
   * calls it on a timer rather than on a keypress has misunderstood it.
   */
  interruptFor(line?: VoiceLine): void;
  /** AC-21.6. Renders first, speaks second, and the display never differs. */
  speakNote(
    note: SpokenNote,
    render: (display: CoachNoteDisplay) => void,
    lineId?: string,
  ): CoachNoteSpeechResult;
  /** Stop anything Shadow is saying (a scene tearing down mid-line). */
  cancelVoice(): void;
  /** Reset the D75 pitched layer at the start of a stage. */
  resetTone(): void;
  /** Everything the running game did, for the evidence artifact. */
  snapshot(): WiringSnapshot;
  /** Unsubscribe from the game's channels. */
  dispose(): void;
}

export interface InstallAudioOptions {
  readonly graph: AudioGraph;
  /** `game.events`. Omit to wire nothing but the direct calls. */
  readonly events?: EventChannel;
  /** `game.registry`. The graph is published here under `kb.audio`. */
  readonly registry?: RegistryLike;
  /** `FLIGHT_EVENTS.cue`. Passed in so this package needs no flight import. */
  readonly cueEvent?: string;
  /** `FLIGHT_EVENTS.hud`. */
  readonly hudEvent?: string;
  /**
   * The game-wide "a screen handed off" event - `scenes/lib/init.goTo` emits
   * `"story-transition"` on `game.events` immediately before starting the next
   * scene, and every screen advance in this game goes through it.
   *
   * Subscribing to it HERE is what makes the interrupt rule true everywhere
   * without a single scene having to remember it: the player pressing Enter to
   * leave a screen is the one event that may displace a line in flight, and it
   * is exactly this event. Passed in as a string so the audio package still
   * imports nothing from the scenes.
   */
  readonly transitionEvent?: string;
  readonly registryKey?: string;
  /** Opening volumes, from the active profile's settings. */
  readonly volumes?: { music?: number; sfx?: number };
  /** How many routed plays `snapshot().recent` keeps. */
  readonly recentLimit?: number;
}

const RECENT_DEFAULT = 64;

/**
 * Ceiling on the two unbounded evidence lists (`cuesRouted`, `spoken`).
 *
 * These are diagnostics on a hot path - one entry per keystroke - and this
 * object lives for the whole session. A cap well above any evidence run keeps
 * the artifact complete while stopping a long afternoon of play from growing a
 * list nobody reads. The oldest entries go first; the COUNTS never do.
 */
const LOG_CAP = 1024;

function push<T>(list: T[], value: T, cap = LOG_CAP): void {
  list.push(value);
  if (list.length > cap) list.shift();
}

function contextKindOf(graph: AudioGraph): string {
  const ctx = graph.ctx;
  if (ctx instanceof NullAudioContext) return "NullAudioContext";
  const name = (ctx as { constructor?: { name?: string } }).constructor?.name;
  return typeof name === "string" && name.length > 0 ? name : "unknown";
}

/**
 * Build the service and subscribe it to the game's channels.
 *
 * Idempotent in the only way that matters: calling it twice on one registry
 * replaces the published service, and the old one's `dispose` detaches it, so a
 * hot reload cannot leave two graphs listening to one cue stream.
 */
export function installAudio(options: InstallAudioOptions): AudioService {
  const { graph } = options;
  const registryKey = options.registryKey ?? AUDIO_REGISTRY_KEY;
  const recentLimit = Math.max(1, options.recentLimit ?? RECENT_DEFAULT);

  const played: Record<string, number> = {};
  const reachedVia: Record<string, string[]> = {};
  for (const event of SFX_EVENTS) {
    played[event] = 0;
    reachedVia[event] = [];
  }
  const cuesRouted: string[] = [];
  const recent: RoutedPlay[] = [];
  const ambientStops: string[] = [];
  const musicStops: string[] = [];
  const musicIndices: number[] = [];
  const spoken: { id: string; kind: string }[] = [];

  let sfxPlays = 0;
  let toneSteps = 0;
  let toneResets = 0;
  let ambientCrossfades = 0;
  let hudSamples = 0;
  let frames = 0;
  let advancedMs = 0;
  let transitions = 0;
  let coachNoteOrder: readonly string[] = [];
  let volumes = {
    music: clamp(options.volumes?.music ?? graph.buses.music.gain.value, 0, 1),
    sfx: clamp(options.volumes?.sfx ?? graph.buses.sfx.gain.value, 0, 1),
  };

  const record = (result: SfxPlayResult, via: string): void => {
    const event = result.variant.event;
    played[event] = (played[event] ?? 0) + 1;
    const seen = reachedVia[event];
    if (seen && !seen.includes(via)) seen.push(via);
    sfxPlays += 1;
    push(
      recent,
      {
        event,
        variant: result.variant.id,
        peakGain: result.peakGain,
        startHz: result.startHz,
        ctxTime: graph.ctx.currentTime,
        via,
      },
      recentLimit,
    );
  };

  const service: AudioService = {
    graph,

    play(event, via, playOptions): SfxPlayResult | null {
      const result = graph.sfx.play(event, playOptions);
      record(result, via);
      return result;
    },

    routeFlightCue(payload): SfxPlayResult | null {
      const cue = payload?.cue;
      if (typeof cue !== "string") return null;
      if (!FLIGHT_CUE_NAMES.includes(cue as FlightCueName)) return null;
      const name = cue as FlightCueName;
      push(cuesRouted, name);

      // D75: the pitched layer rides the same keystroke stream. `ignored`
      // touches neither the step nor the reset - see the header.
      if (name === "keystroke") {
        graph.keystrokeTone.correct();
        toneSteps += 1;
      } else if (name === "typo") {
        graph.keystrokeTone.typo();
      } else if (WORD_ENDING_CUES.includes(name)) {
        // UR-30, REOPENED - THE LADDER HAD NO WORD BOUNDARY.
        //
        // `KeystrokeTone.reset()` is documented as "word finished, new word
        // starting", and until now the only caller in src/ was
        // `FlightScene.create()` via `resetTone()` - which runs ONCE PER STAGE.
        // So the ladder never reset at a word boundary. Measured over a
        // 290-key belt at 100% accuracy, `pitchIndexFor` caps at 14 and keys 15
        // through 290 are all 2217.5 Hz: 95% of a belt on one note. And because
        // only a typo cleared it, THE BETTER A CHILD TYPED THE MORE MONOTONOUS
        // IT GOT - 2% of keys on the top note at 80% accuracy, 89% at 98%.
        //
        // The word boundary was already here and nobody read it. `blast` is a
        // rock destroyed, `park` is one that reached the bottom, `stall` is a
        // belt that ran out: every way a word can end, arriving on the same cue
        // stream this function already owns. No scene has to remember anything,
        // which is exactly why the old arrangement failed.
        graph.keystrokeTone.reset();
        toneResets += 1;
      }

      const event = CUE_SFX[name];
      if (event === null) return null;

      const hull = payload.hull;
      const maxHull = payload.maxHull;
      const hullFraction =
        typeof hull === "number" && typeof maxHull === "number" && maxHull > 0
          ? clamp(hull / maxHull, 0, 1)
          : 1;

      const result = graph.sfx.play(event, {
        ...(typeof payload.combo === "number" ? { combo: payload.combo } : {}),
        hullFraction,
      });
      record(result, `flight-cue:${name}`);
      return result;
    },

    uiNav(): SfxPlayResult | null {
      return service.play("uiNav", "ui:nav");
    },

    ambientFor(stopId, crossfadeMs = AMBIENT_CROSSFADE_MS): void {
      if (!isStopId(stopId)) return;
      // THE COMPOSED PIECE RIDES THE SAME SIGNAL (E-MUSIC-1, UR-12). The bed
      // and the music are two answers to one question - "which stop is the
      // player at" - and every caller that knows the stop already calls this.
      // Giving music its own entry point would mean a second call site that a
      // scene can forget, which is precisely how the audio ended up
      // unreachable the first time (see this file's header).
      //
      // BEFORE the early return below, not after: the bed is already playing
      // for this stop on a re-entry, but the music may never have loaded - the
      // fetch can fail, and asking again on the next scene is the only retry
      // there is. `setStop` is idempotent per stop, so the extra call costs a
      // resolved promise.
      const music = graph.music.setStop(stopId);
      if (!musicStops.includes(stopId)) musicStops.push(stopId);
      // The load is deliberately not awaited: music arrives when it arrives and
      // nothing in the scene waits for it. `catch` because an unhandled
      // rejection is a console error in front of a child, and `setStop`
      // promises not to reject anyway.
      void music.catch(() => undefined);

      const active = graph.ambient.activeStop;
      if (active === stopId) return;
      if (active === null) {
        graph.ambient.start(stopId);
      } else {
        graph.ambient.transitionTo(stopId, crossfadeMs);
        ambientCrossfades += 1;
      }
      ambientStops.push(stopId);
    },

    musicFromState(liveAsteroids, combo): number {
      const index = graph.music.setFromState(liveAsteroids, combo);
      if (!musicIndices.includes(index)) musicIndices.push(index);
      return index;
    },

    advance(dtMs): void {
      if (!Number.isFinite(dtMs) || dtMs < 0) return;
      frames += 1;
      advancedMs += dtMs;
      graph.advance(dtMs);
    },

    setVolumes(next): void {
      if (typeof next.music === "number") {
        volumes = { ...volumes, music: clamp(next.music, 0, 1) };
        graph.setBusGain("music", volumes.music);
      }
      if (typeof next.sfx === "number") {
        volumes = { ...volumes, sfx: clamp(next.sfx, 0, 1) };
        graph.setBusGain("sfx", volumes.sfx);
      }
    },

    speak(line): void {
      if (!line || typeof line.text !== "string" || line.text.trim().length === 0) return;
      push(spoken, { id: line.id, kind: line.kind });
      graph.voice.speak(line);
    },

    interruptFor(line): void {
      const usable =
        line !== undefined &&
        typeof line.text === "string" &&
        line.text.trim().length > 0;
      // An empty line still EASES OUT whatever is speaking - "the player left
      // the screen and Shadow had nothing else to say" is a real case, and
      // dropping the call because the replacement was empty would leave the old
      // line talking over the next screen.
      if (usable) push(spoken, { id: line.id, kind: line.kind });
      graph.voice.interrupt(usable ? line : undefined);
    },

    /**
     * THE LOOKUP KEYS ON THE LINE, NOT ON THE CALL SITE (D63, D98).
     *
     * `lineId` names a SCREEN - `WarpScene` passes `warp.coachNote` - and there
     * are ten fixed sentences behind that one name (D33's fallback bundle and
     * the mock's slot-free notes), so a file called `warp.coachNote.mp3` could
     * only ever be one of them played over the text of another. The id is
     * therefore resolved from the NOTE, by `coachNoteClipId`, which is the same
     * enumeration `scripts/render-voice.mjs` renders and the D98 guard checks.
     *
     * Null - an interpolated mock note (AC-15.5) or genuine model text - keeps
     * the call site's id, which has no clip and, under D98, is silent rather
     * than read by an OS voice.
     */
    speakNote(note, render, lineId): CoachNoteSpeechResult {
      const id = coachNoteClipId(note?.note ?? "") ?? lineId ?? "coach.note";
      const result = speakCoachNote(note, render, graph.voice, id);
      coachNoteOrder = result.order;
      if (result.spoke) push(spoken, { id, kind: "coachNote" });
      return result;
    },

    cancelVoice(): void {
      graph.voice.cancel();
    },

    resetTone(): void {
      graph.keystrokeTone.reset();
    },

    snapshot(): WiringSnapshot {
      const busGains: Record<string, number> = {};
      for (const [id, node] of Object.entries(graph.buses)) {
        busGains[id] = node.gain.value;
      }
      return {
        registryKey,
        buses: Object.keys(graph.buses),
        contextKind: contextKindOf(graph),
        played: { ...played },
        reachedVia: Object.fromEntries(
          Object.entries(reachedVia).map(([k, v]) => [k, [...v]]),
        ),
        cuesRouted: [...cuesRouted],
        recent: [...recent],
        sfxPlays,
        toneSteps,
        toneResets,
        chirps: graph.chirpCount,
        ambientStops: [...ambientStops],
        ambientCrossfades,
        musicIndices: [...musicIndices].sort((a, b) => a - b),
        hudSamples,
        musicIndex: graph.music.index,
        musicStops: [...musicStops],
        musicTrackIds: [...graph.music.trackIds()],
        musicTrack: graph.music.trackId,
        musicSource: graph.music.sourceKind,
        frames,
        advancedMs,
        spoken: [...spoken],
        voiceTransport: graph.voice.transportId,
        voiceClipIds: [...graph.voiceClipIds],
        voiceClipsUsed: spoken
          .map((s) => s.id)
          .filter((id, i, all) => all.indexOf(id) === i && graph.voiceClipIds.includes(id)),
        voiceQueued: graph.voice.queued,
        voiceSpeaking: graph.voice.speaking,
        voiceInterrupts: transitions,
        coachNoteOrder: [...coachNoteOrder],
        busGains,
        volumes: { ...volumes },
      };
    },

    dispose(): void {
      detach();
      graph.voice.cancel();
    },
  };

  // --- subscriptions -------------------------------------------------------

  const onCue: ChannelHandler = (payload) => {
    if (typeof payload !== "object" || payload === null) return;
    service.routeFlightCue(payload as FlightCuePayload);
  };

  const onHud: ChannelHandler = (payload) => {
    if (typeof payload !== "object" || payload === null) return;
    const hud = payload as HudLike;
    hudSamples += 1;
    service.musicFromState(hud.liveCount ?? 0, hud.combo ?? 0);
  };

  /**
   * A screen handed off, which in this game only ever happens because the
   * player did something. Shadow gives way GRACEFULLY: the word he is on
   * finishes, the line stops, the world stays ducked for a beat, and the next
   * screen's first line starts into quiet. Anything still queued belonged to
   * the screen that just closed and goes with it.
   */
  const onTransition: ChannelHandler = () => {
    transitions += 1;
    graph.voice.interrupt();
  };

  const channel = options.events;
  const cueEvent = options.cueEvent;
  const hudEvent = options.hudEvent;
  const transitionEvent = options.transitionEvent;

  const detach = (): void => {
    if (!channel) return;
    if (cueEvent !== undefined) channel.off(cueEvent, onCue);
    if (hudEvent !== undefined) channel.off(hudEvent, onHud);
    if (transitionEvent !== undefined) channel.off(transitionEvent, onTransition);
  };

  if (channel) {
    if (cueEvent !== undefined) channel.on(cueEvent, onCue);
    if (hudEvent !== undefined) channel.on(hudEvent, onHud);
    if (transitionEvent !== undefined) channel.on(transitionEvent, onTransition);
  }

  // Opening volumes, so a profile that muted the music last session is muted
  // before the first bed starts rather than a second later.
  service.setVolumes(volumes);

  const registry = options.registry;
  if (registry) {
    const previous = registry.get(registryKey);
    if (previous && previous !== service && isDisposable(previous)) previous.dispose();
    registry.set(registryKey, service);
  }

  return service;
}

function isDisposable(value: unknown): value is { dispose(): void } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { dispose?: unknown }).dispose === "function"
  );
}

// ---------------------------------------------------------------------------
// Reading it back
// ---------------------------------------------------------------------------

/**
 * The service a scene should use, or null.
 *
 * NULL IS A SUPPORTED ANSWER and it is why nothing in a scene needs a try/catch
 * around a sound: a screen opened standalone by the e2e harness has no boot and
 * therefore no audio, and that is a way of running a screen, not a fault.
 */
export function audioFrom(registry: RegistryLike | null | undefined, key = AUDIO_REGISTRY_KEY): AudioService | null {
  if (!registry || typeof registry.get !== "function") return null;
  const found = registry.get(key);
  if (typeof found !== "object" || found === null) return null;
  const candidate = found as Partial<AudioService>;
  return typeof candidate.play === "function" && typeof candidate.snapshot === "function"
    ? (found as AudioService)
    : null;
}

/** One-liner for a scene: play a sound if there is one to play. */
export function playAudio(
  registry: RegistryLike | null | undefined,
  event: SfxEventId,
  via: string,
  options?: SfxPlayOptions,
): void {
  audioFrom(registry)?.play(event, via, options);
}

/** One-liner for a scene: say a line if there is a voice to say it. */
export function speakAudio(registry: RegistryLike | null | undefined, line: VoiceLine): void {
  audioFrom(registry)?.speak(line);
}

/**
 * The stop a started scene is about, or null.
 *
 * Every scene that belongs to a place is started with a data object carrying a
 * `stopId` - `FlightConfig`, `StoryInit`, the map's hand-off. Reading it here,
 * generically, is what lets boot give every screen the right ambient bed
 * without each scene having to remember to ask for one.
 */
export function stopIdFromSceneData(data: unknown): StopId | null {
  if (typeof data !== "object" || data === null) return null;
  const raw = (data as { stopId?: unknown }).stopId;
  return typeof raw === "string" && isStopId(raw) ? raw : null;
}

/** Bus ids in the order the graph holds them. Used by the evidence artifact. */
export function busIdsOf(graph: AudioGraph): readonly BusId[] {
  return Object.keys(graph.buses) as BusId[];
}
