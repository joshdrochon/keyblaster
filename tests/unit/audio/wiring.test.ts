/**
 * The connection layer (src/game/audio/wiring.ts).
 *
 * These tests exist because the audio package already had 172 of them and the
 * game was still silent: every one of them exercised a graph the product never
 * built. So nothing here asserts that a sound is well made - sfx.test.ts does
 * that - and everything asserts that a SIGNAL THE GAME REALLY EMITS arrives at
 * the bus that makes the noise.
 *
 * The flight cue names are read out of `src/game/flight/stage.ts` rather than
 * restated, so renaming a cue in the flight lane fails here instead of quietly
 * muting one event.
 */

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NullAudioContext } from "../../../src/game/audio/nullContext.js";
import { buildAudioGraph, DUCK_ATTACK_MS } from "../../../src/game/audio/graph.js";
import { seededRandom, dbToGain } from "../../../src/game/audio/context.js";
import { SFX_EVENTS, GENTLE_LIMITS, pitchDirectionOf } from "../../../src/game/audio/sfx.js";
import { MAX_INTENSITY_INDEX, intensityIndex } from "../../../src/game/audio/music.js";
import { AMBIENT_CROSSFADE_MS } from "../../../src/game/audio/ambient.js";
import {
  AUDIO_REGISTRY_KEY,
  CUE_SFX,
  FLIGHT_CUE_NAMES,
  audioFrom,
  installAudio,
  playAudio,
  stopIdFromSceneData,
  type AudioService,
  type ChannelHandler,
} from "../../../src/game/audio/wiring.js";
import { STOP_IDS } from "../../../src/engine/types.js";
import {
  FocusList,
  setUiSound,
  uiSoundBlip,
  type Focusable,
} from "../../../src/game/ui/focus.js";
import { fakeVoiceEnvironment } from "./fakes.js";

const CUE_EVENT = "kb:flight:cue";
const HUD_EVENT = "kb:flight:hud";
/** `scenes/lib/init.goTo` emits this on `game.events` before every hand-off. */
const TRANSITION_EVENT = "story-transition";

/** A two-method stand-in for `game.events`. Phaser is not imported here. */
class FakeChannel {
  readonly handlers = new Map<string, Set<ChannelHandler>>();
  on(event: string, handler: ChannelHandler): void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler);
    this.handlers.set(event, set);
  }
  off(event: string, handler: ChannelHandler): void {
    this.handlers.get(event)?.delete(handler);
  }
  emit(event: string, payload?: unknown): void {
    for (const handler of [...(this.handlers.get(event) ?? [])]) handler(payload);
  }
  count(event: string): number {
    return this.handlers.get(event)?.size ?? 0;
  }
}

class FakeRegistry {
  private readonly bag = new Map<string, unknown>();
  get(key: string): unknown {
    return this.bag.get(key);
  }
  set(key: string, value: unknown): void {
    this.bag.set(key, value);
  }
}

interface Harness {
  readonly audio: AudioService;
  readonly channel: FakeChannel;
  readonly registry: FakeRegistry;
  readonly ctx: NullAudioContext;
  finishSpeech(): void;
  /** The platform crossed a word boundary in the line in flight. */
  boundary(): void;
  /** Utterances the platform was actually handed, in order. */
  spokenTexts(): string[];
  /** `speechSynthesis.cancel()` calls. */
  cancels(): number;
  /** Run every pending timer: the ease-out deadline and the inter-line gap. */
  tick(): void;
}

function harness(volumes?: { music?: number; sfx?: number }): Harness {
  const ctx = new NullAudioContext();
  const { env, speech, scheduler } = fakeVoiceEnvironment();
  const graph = buildAudioGraph(ctx, { voiceEnv: env, rand: seededRandom(0xbeef) });
  const channel = new FakeChannel();
  const registry = new FakeRegistry();
  const audio = installAudio({
    graph,
    events: channel,
    registry,
    cueEvent: CUE_EVENT,
    hudEvent: HUD_EVENT,
    transitionEvent: TRANSITION_EVENT,
    ...(volumes ? { volumes } : {}),
  });
  return {
    audio,
    channel,
    registry,
    ctx,
    finishSpeech: () => speech?.finishLast(),
    boundary: () => speech?.last?.onBoundary?.(),
    spokenTexts: () => (speech?.requests ?? []).map((r) => r.text),
    cancels: () => speech?.cancels ?? 0,
    tick: () => scheduler.runAll(),
  };
}

// ---------------------------------------------------------------------------
// The thing the audit actually found
// ---------------------------------------------------------------------------

describe("the audio system is reachable from the game", () => {
  it("publishes itself on the registry key SettingsScene reads", () => {
    const { registry } = harness();
    expect(AUDIO_REGISTRY_KEY).toBe("kb.audio");
    expect(audioFrom(registry)).not.toBeNull();
  });

  it("audioFrom is null - not a throw - when nothing was installed", () => {
    expect(audioFrom(new FakeRegistry())).toBeNull();
    expect(audioFrom(null)).toBeNull();
    expect(audioFrom(undefined)).toBeNull();
    // A registry holding something that is not an audio service is also null,
    // so a key collision degrades to silence rather than to a TypeError.
    const wrong = new FakeRegistry();
    wrong.set(AUDIO_REGISTRY_KEY, { buses: {} });
    expect(audioFrom(wrong)).toBeNull();
  });

  it("playAudio on an empty registry is a no-op, not a crash", () => {
    expect(() => playAudio(new FakeRegistry(), "uiNav", "test")).not.toThrow();
  });

  it("subscribes to the cue and hud channels, and lets go on dispose", () => {
    const { audio, channel } = harness();
    expect(channel.count(CUE_EVENT)).toBe(1);
    expect(channel.count(HUD_EVENT)).toBe(1);
    audio.dispose();
    expect(channel.count(CUE_EVENT)).toBe(0);
    expect(channel.count(HUD_EVENT)).toBe(0);
  });

  it("a second install on one registry detaches the first", () => {
    const { audio, registry, channel } = harness();
    const ctx = new NullAudioContext();
    const { env } = fakeVoiceEnvironment();
    installAudio({
      graph: buildAudioGraph(ctx, { voiceEnv: env }),
      events: channel,
      registry,
      cueEvent: CUE_EVENT,
      hudEvent: HUD_EVENT,
    });
    expect(audioFrom(registry)).not.toBe(audio);
    expect(channel.count(CUE_EVENT)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// FLIGHT_EVENTS.cue -> a sound
// ---------------------------------------------------------------------------

describe("AC-6e.2 / AC-21.3: a flight cue becomes a scheduled sound", () => {
  it("routes every cue the flight lane can emit", () => {
    const { audio, channel } = harness();
    for (const cue of FLIGHT_CUE_NAMES) {
      channel.emit(CUE_EVENT, { cue, atMs: 0, combo: 0, hull: 3, maxHull: 3 });
    }
    const snap = audio.snapshot();
    expect(snap.cuesRouted).toEqual([...FLIGHT_CUE_NAMES]);
    // Seven of the nine make a sound; `park` and `stall` are silent by decision.
    expect(snap.sfxPlays).toBe(FLIGHT_CUE_NAMES.filter((c) => CUE_SFX[c] !== null).length);
  });

  it("the cue names match `FlightCue` in src/game/flight/stage.ts exactly", () => {
    // Read, not restated: a rename in the flight lane must fail HERE rather
    // than silently drop an event on the floor.
    const source = readFileSync(join(process.cwd(), "src/game/flight/stage.ts"), "utf8");
    const block = /export type FlightCue\s*=([\s\S]*?);/.exec(source)?.[1] ?? "";
    const declared = [...block.matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(0);
    expect([...declared].sort()).toEqual([...FLIGHT_CUE_NAMES].sort());
    expect(Object.keys(CUE_SFX).sort()).toEqual([...FLIGHT_CUE_NAMES].sort());
  });

  it("every sound a cue maps to is one of the ten AC-21.3 events", () => {
    for (const event of Object.values(CUE_SFX)) {
      if (event === null) continue;
      expect(SFX_EVENTS).toContain(event);
    }
  });

  it("records what was scheduled, with the values that went to the nodes", () => {
    const { audio, channel } = harness();
    channel.emit(CUE_EVENT, { cue: "lock", atMs: 12 });
    const [play] = audio.snapshot().recent;
    expect(play?.event).toBe("lock");
    expect(play?.variant).toMatch(/^lock\./);
    expect(play?.peakGain).toBeGreaterThan(0);
    expect(play?.via).toBe("flight-cue:lock");
  });

  it("D63: blast pitch rises with the combo carried on the cue", () => {
    const { audio, channel } = harness();
    channel.emit(CUE_EVENT, { cue: "blast", combo: 0 });
    channel.emit(CUE_EVENT, { cue: "blast", combo: 10 });
    const plays = audio.snapshot().recent.filter((p) => p.event === "blast");
    expect(plays).toHaveLength(2);
    // Different variants, so compare against each one's own table entry.
    const cold = plays[0]!;
    const hot = plays[1]!;
    expect(hot.startHz / hotBase(hot.variant)).toBeGreaterThan(cold.startHz / hotBase(cold.variant));
  });

  it("D63: the hit thud grows as the hull falls, and never sharpens", () => {
    const { audio, channel } = harness();
    channel.emit(CUE_EVENT, { cue: "hit", hull: 3, maxHull: 3 });
    channel.emit(CUE_EVENT, { cue: "hit", hull: 1, maxHull: 3 });
    const plays = audio.snapshot().recent.filter((p) => p.event === "hit");
    const full = plays[0]!;
    const low = plays[1]!;
    expect(low.peakGain / hotBase(low.variant, "peakGain")).toBeGreaterThan(
      full.peakGain / hotBase(full.variant, "peakGain"),
    );
  });

  it("a cue with no hull numbers is treated as a full hull, not as NaN", () => {
    const { audio, channel } = harness();
    channel.emit(CUE_EVENT, { cue: "hit" });
    const play = audio.snapshot().recent.at(-1)!;
    expect(Number.isFinite(play.peakGain)).toBe(true);
    expect(play.peakGain).toBeCloseTo(hotBase(play.variant, "peakGain"), 6);
  });

  it("ignores a cue name it does not know, and a payload that is not one", () => {
    const { audio, channel } = harness();
    channel.emit(CUE_EVENT, { cue: "explode" });
    channel.emit(CUE_EVENT, "keystroke");
    channel.emit(CUE_EVENT, undefined);
    expect(audio.snapshot().sfxPlays).toBe(0);
  });
});

describe("D31: nothing the flight cues play may read as failure", () => {
  it("`typo` gets the gentle neutral tick, at a flat pitch", () => {
    const { audio, channel } = harness();
    channel.emit(CUE_EVENT, { cue: "typo" });
    const play = audio.snapshot().recent.at(-1)!;
    expect(play.event).toBe("typo");
    expect(play.peakGain).toBeLessThanOrEqual(GENTLE_LIMITS.maxPeakGain);
    expect(pitchDirectionOf(variantOf(play.variant))).toBe("flat");
  });

  it("`ignored` answers with the NEUTRAL keystroke tick, never the typo tick", () => {
    // AC-6e.2 promises every keystroke an audio answer, including the one that
    // matched nothing. D31 forbids telling the child it was wrong.
    const { audio, channel } = harness();
    channel.emit(CUE_EVENT, { cue: "ignored" });
    expect(audio.snapshot().recent.at(-1)?.event).toBe("keystroke");
  });

  it("`stall` is silent: the moment the engines go quiet gets no noise", () => {
    const { audio, channel } = harness();
    channel.emit(CUE_EVENT, { cue: "stall" });
    expect(audio.snapshot().sfxPlays).toBe(0);
  });
});

describe("D75: the pitched keystroke layer follows the same cue stream", () => {
  it("a correct keystroke steps the scale and a typo resets it", () => {
    const { audio, channel } = harness();
    for (let i = 0; i < 4; i++) channel.emit(CUE_EVENT, { cue: "keystroke" });
    expect(audio.graph.keystrokeTone.consecutiveCorrect).toBe(4);
    channel.emit(CUE_EVENT, { cue: "typo" });
    expect(audio.graph.keystrokeTone.consecutiveCorrect).toBe(0);
  });

  it("an ignored key neither steps the scale nor resets it", () => {
    const { audio, channel } = harness();
    for (let i = 0; i < 3; i++) channel.emit(CUE_EVENT, { cue: "keystroke" });
    channel.emit(CUE_EVENT, { cue: "ignored" });
    expect(audio.graph.keystrokeTone.consecutiveCorrect).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// AC-21.2: the music index comes from live numbers
// ---------------------------------------------------------------------------

describe("AC-21.2: music intensity is driven by the live HUD snapshot", () => {
  it("the index the bus reaches is the one the pure function names", () => {
    const { audio, channel } = harness();
    for (const [live, combo] of [[0, 0], [5, 0], [9, 6], [2, 1]] as const) {
      channel.emit(HUD_EVENT, { liveCount: live, combo });
      expect(audio.graph.music.index).toBe(intensityIndex(live, combo));
    }
    const snap = audio.snapshot();
    expect(snap.hudSamples).toBe(4);
    expect(snap.musicIndices).toContain(0);
    expect(snap.musicIndices).toContain(MAX_INTENSITY_INDEX);
  });

  it("a HUD snapshot missing its numbers reads as a calm screen, not as NaN", () => {
    const { audio, channel } = harness();
    channel.emit(HUD_EVENT, {});
    expect(audio.graph.music.index).toBe(0);
  });

  it("advance() moves the intensity ramp the HUD started", () => {
    const { audio, channel } = harness();
    channel.emit(HUD_EVENT, { liveCount: 12, combo: 10 });
    expect(audio.graph.music.changing).toBe(true);
    audio.advance(4000);
    expect(audio.graph.music.changing).toBe(false);
    expect(audio.snapshot().frames).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC-21.1: a bed per stop, crossfaded
// ---------------------------------------------------------------------------

describe("AC-21.1: the ambient bed follows the stop the game is at", () => {
  it("the first stop starts; a second one crossfades", () => {
    const { audio } = harness();
    const [first, second] = STOP_IDS;
    audio.ambientFor(first!);
    expect(audio.graph.ambient.crossfading).toBe(false);
    audio.ambientFor(second!);
    expect(audio.graph.ambient.crossfading).toBe(true);
    // Both beds audible at the midpoint: a crossfade, not a cut.
    audio.advance(AMBIENT_CROSSFADE_MS / 2);
    expect(audio.graph.ambient.gainOf(first!)).toBeGreaterThan(0);
    expect(audio.graph.ambient.gainOf(second!)).toBeGreaterThan(0);
    expect(audio.snapshot().ambientCrossfades).toBe(1);
  });

  it("asking for the stop already playing changes nothing", () => {
    const { audio } = harness();
    audio.ambientFor("mars");
    audio.ambientFor("mars");
    expect(audio.snapshot().ambientStops).toEqual(["mars"]);
  });

  it("a stop id that is not one is ignored", () => {
    const { audio } = harness();
    audio.ambientFor("atlantis" as never);
    expect(audio.snapshot().ambientStops).toEqual([]);
  });

  it("reads a stop off a scene's start data, and null off anything else", () => {
    expect(stopIdFromSceneData({ stopId: "saturn" })).toBe("saturn");
    expect(stopIdFromSceneData({ stopId: "atlantis" })).toBeNull();
    expect(stopIdFromSceneData({})).toBeNull();
    expect(stopIdFromSceneData(null)).toBeNull();
    expect(stopIdFromSceneData("saturn")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-19.1: the sliders move the gains
// ---------------------------------------------------------------------------

describe("AC-19.1: settings volumes move the real bus gains", () => {
  it("music and sfx land on their own buses and nowhere else", () => {
    const { audio } = harness();
    audio.setVolumes({ music: 0.25, sfx: 0.4 });
    expect(audio.graph.buses.music.gain.value).toBeCloseTo(0.25, 6);
    expect(audio.graph.buses.sfx.gain.value).toBeCloseTo(0.4, 6);
    expect(audio.graph.buses.voice.gain.value).toBeCloseTo(1, 6);
  });

  it("a volume set while Shadow is talking survives his release ramp", () => {
    // The music bus is a sidechain target. Writing the gain node directly would
    // be undone by the next release, and the child's choice would revert the
    // moment the line ended - which is the bug this path exists to prevent.
    const { audio, finishSpeech } = harness();
    audio.speak({ id: "l", text: "Nice flying.", kind: "scripted" });
    expect(audio.graph.buses.music.gain.value).toBeLessThan(0.7);
    audio.setVolumes({ music: 0.3 });
    expect(audio.graph.buses.music.gain.value).toBeCloseTo(0.3 * dbToGain(-6), 5);
    finishSpeech();
    audio.advance(DUCK_ATTACK_MS * 8);
    expect(audio.graph.buses.music.gain.value).toBeCloseTo(0.3, 5);
  });

  it("opening volumes come from the profile before the first bed starts", () => {
    const { audio } = harness({ music: 0.1, sfx: 0.2 });
    expect(audio.graph.buses.music.gain.value).toBeCloseTo(0.1, 6);
    expect(audio.graph.buses.sfx.gain.value).toBeCloseTo(0.2, 6);
  });

  it("a muted game still routes every cue, at zero, without crashing", () => {
    const { audio, channel } = harness({ music: 0, sfx: 0 });
    expect(audio.graph.buses.music.gain.value).toBe(0);
    expect(audio.graph.buses.sfx.gain.value).toBe(0);
    for (const cue of FLIGHT_CUE_NAMES) channel.emit(CUE_EVENT, { cue });
    channel.emit(HUD_EVENT, { liveCount: 9, combo: 9 });
    audio.advance(16);
    expect(audio.snapshot().sfxPlays).toBeGreaterThan(0);
  });

  it("nonsense volumes clamp instead of reaching a gain node", () => {
    const { audio } = harness();
    audio.setVolumes({ music: Number.NaN, sfx: 9 });
    expect(audio.graph.buses.music.gain.value).toBe(0);
    expect(audio.graph.buses.sfx.gain.value).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

describe("AC-21.4 / AC-21.6: Shadow, through the wiring", () => {
  it("a scripted line ducks the world and is recorded", () => {
    const { audio, finishSpeech } = harness();
    const before = audio.graph.buses.ambient.gain.value;
    audio.speak({ id: "preflight.line.opening", text: "Systems are yours.", kind: "scripted" });
    expect(audio.graph.buses.ambient.gain.value).toBeLessThan(before);
    expect(audio.snapshot().spoken).toEqual([
      { id: "preflight.line.opening", kind: "scripted" },
    ]);
    finishSpeech();
  });

  it("an empty line is not spoken and does not duck anything", () => {
    const { audio } = harness();
    const before = audio.graph.buses.music.gain.value;
    audio.speak({ id: "blank", text: "   ", kind: "scripted" });
    expect(audio.graph.buses.music.gain.value).toBe(before);
    expect(audio.snapshot().spoken).toEqual([]);
  });

  it("AC-21.6: the coach note renders first and speaks second", () => {
    const { audio } = harness();
    const seen: string[] = [];
    const result = audio.speakNote({ note: "Try the long ones slower." }, (d) => {
      seen.push(d.text);
    });
    expect(seen).toEqual(["Try the long ones slower."]);
    expect(result.order).toEqual(["text", "speech"]);
    expect(audio.snapshot().coachNoteOrder).toEqual(["text", "speech"]);
  });

  it("AC-21.6: the renderer is handed the text and nothing it could branch on", () => {
    const { audio } = harness();
    let display: object | null = null;
    audio.speakNote({ note: "Good run." }, (d) => {
      display = d;
    });
    expect(Object.keys(display ?? {})).toEqual(["text"]);
  });
});

// ---------------------------------------------------------------------------
// The evidence surface
// ---------------------------------------------------------------------------

describe("the wiring snapshot describes what happened, not what was configured", () => {
  it("counts every one of the ten events and where it was reached from", () => {
    const { audio, channel } = harness();
    channel.emit(CUE_EVENT, { cue: "keystroke" });
    audio.uiNav();
    audio.play("warp", "warp-scene:jump");
    const snap = audio.snapshot();
    expect(Object.keys(snap.played).sort()).toEqual([...SFX_EVENTS].sort());
    expect(snap.played["keystroke"]).toBe(1);
    expect(snap.played["uiNav"]).toBe(1);
    expect(snap.played["blast"]).toBe(0);
    expect(snap.reachedVia["uiNav"]).toEqual(["ui:nav"]);
    expect(snap.reachedVia["warp"]).toEqual(["warp-scene:jump"]);
  });

  it("names the context it is running on, so a null one cannot pass as real", () => {
    const { audio } = harness();
    expect(audio.snapshot().contextKind).toBe("NullAudioContext");
    expect(audio.snapshot().buses).toEqual(["master", "music", "ambient", "sfx", "voice"]);
  });

  it("keeps its lists bounded while the counts stay exact", () => {
    // The service lives for the whole session and these lists take an entry per
    // keystroke. The COUNTS are what the rubric reads, and they never drop.
    const { audio, channel } = harness();
    for (let i = 0; i < 2000; i++) channel.emit(CUE_EVENT, { cue: "keystroke" });
    const snap = audio.snapshot();
    expect(snap.sfxPlays).toBe(2000);
    expect(snap.played["keystroke"]).toBe(2000);
    expect(snap.recent.length).toBeLessThanOrEqual(64);
    expect(snap.cuesRouted.length).toBeLessThanOrEqual(1024);
    expect(snap.cuesRouted.every((c) => c === "keystroke")).toBe(true);
  });
});


// ---------------------------------------------------------------------------
// The UI kit's sound hook (D62 "UI sounds for every interaction")
// ---------------------------------------------------------------------------

function fakeRow(id: string, overrides: Partial<Focusable> = {}): Focusable {
  return {
    id,
    locked: false,
    adjustable: false,
    setFocused: () => undefined,
    activate: () => undefined,
    adjust: () => undefined,
    toMirror: () => ({ id }) as ReturnType<Focusable["toMirror"]>,
    ...overrides,
  };
}

describe("AC-21.3 uiNav: the menu kit's sound hook", () => {
  afterEach(() => setUiSound(null));

  it("is silent until boot installs it, and needs no stub in a test", () => {
    setUiSound(null);
    const list = new FocusList();
    list.setItems([fakeRow("a"), fakeRow("b")]);
    expect(() => list.move(1)).not.toThrow();
  });

  it("blips on a move, on an activate and on a slider step - but not on setup", () => {
    const heard: string[] = [];
    setUiSound((kind) => heard.push(kind));
    const list = new FocusList();
    // Building the screen is not an interaction.
    list.setItems([fakeRow("a"), fakeRow("b", { adjustable: true })]);
    expect(heard).toEqual([]);

    list.move(1);
    list.activate();
    list.adjust(1);
    expect(heard).toEqual(["nav", "activate", "nav"]);
  });

  it("restoring the caret to where it already is stays silent", () => {
    const heard: string[] = [];
    setUiSound((kind) => heard.push(kind));
    const list = new FocusList();
    list.setItems([fakeRow("a"), fakeRow("b")]);
    expect(list.focus("a")).toBe(true);
    expect(heard).toEqual([]);
    expect(list.focus("b")).toBe(true);
    expect(heard).toEqual(["nav"]);
  });

  it("a locked row cannot be activated, so it makes no sound", () => {
    const heard: string[] = [];
    setUiSound((kind) => heard.push(kind));
    const list = new FocusList();
    list.setItems([fakeRow("locked", { locked: true })]);
    list.activate();
    expect(heard).toEqual([]);
  });

  it("a hook that throws never takes the menu down with it", () => {
    setUiSound(() => {
      throw new Error("no audio today");
    });
    const list = new FocusList();
    list.setItems([fakeRow("a"), fakeRow("b")]);
    expect(() => list.move(1)).not.toThrow();
    expect(list.focusId).toBe("b");
    expect(() => uiSoundBlip("activate")).not.toThrow();
  });

  it("routes to the audio service's uiNav, on the SFX bus", () => {
    const { audio } = harness();
    setUiSound(() => audio.uiNav());
    const list = new FocusList();
    list.setItems([fakeRow("a"), fakeRow("b")]);
    list.move(1);
    const snap = audio.snapshot();
    expect(snap.played["uiNav"]).toBe(1);
    expect(snap.reachedVia["uiNav"]).toEqual(["ui:nav"]);
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

import { variantsFor } from "../../../src/game/audio/sfx.js";

function variantOf(id: string): ReturnType<typeof variantsFor>[number] {
  const [event] = id.split(".");
  const found = variantsFor(event as (typeof SFX_EVENTS)[number]).find((v) => v.id === id);
  if (!found) throw new Error(`no variant ${id}`);
  return found;
}

/** The table value a reactive play was scaled from. */
function hotBase(id: string, field: "startHz" | "peakGain" = "startHz"): number {
  return variantOf(id)[field];
}

// ---------------------------------------------------------------------------
// Shadow never talks over himself, and only the player cuts him off
// ---------------------------------------------------------------------------

describe("AC-21.4: the voice bus serialises across the whole game", () => {
  it("two scenes speaking in the same tick produce two lines, never two at once", () => {
    // The player's report, as a test at the level they experienced it: not
    // "the bus queues", but "the GAME never plays two voice lines together".
    const h = harness();
    h.audio.speak({ id: "a", text: "Mars ahead.", kind: "scripted" });
    h.audio.speak({ id: "b", text: "Course locked.", kind: "scripted" });

    expect(h.spokenTexts()).toEqual(["Mars ahead."]);
    h.finishSpeech();
    h.tick();
    expect(h.spokenTexts()).toEqual(["Mars ahead.", "Course locked."]);
    expect(h.audio.snapshot().voiceQueued).toBe(0);
  });

  it("the snapshot never reports more than one line in flight", () => {
    const h = harness();
    for (let i = 0; i < 6; i += 1) {
      h.audio.speak({ id: `l${i}`, text: `line ${i}`, kind: "scripted" });
      const snap = h.audio.snapshot();
      expect(snap.voiceSpeaking).toBe(true);
      expect(h.spokenTexts().length).toBe(1);
    }
    expect(h.audio.snapshot().voiceQueued).toBe(5);
  });

  it("a coach note queues behind a scripted line instead of cutting it", () => {
    // AC-21.6's note is still text-first; what changed is that it waits its
    // turn rather than talking over whatever Shadow was already saying.
    const h = harness();
    h.audio.speak({ id: "a", text: "Mars ahead.", kind: "scripted" });
    const rendered: string[] = [];
    const result = h.audio.speakNote({ note: "Nice work." }, (d) => rendered.push(d.text));

    expect(result.order).toEqual(["text", "speech"]);
    expect(rendered).toEqual(["Nice work."]);
    // The TEXT is up immediately - that is AC-21.6 - and the speech is queued.
    expect(h.spokenTexts()).toEqual(["Mars ahead."]);
    h.finishSpeech();
    h.tick();
    expect(h.spokenTexts()).toEqual(["Mars ahead.", "Nice work."]);
  });

  it("THE PLAYER ADVANCING A SCREEN eases Shadow out - and nothing else does", () => {
    // `goTo` emits this before every hand-off in the game, and it is the only
    // event in the build that is always the player acting.
    const h = harness();
    h.audio.speak({ id: "a", text: "a long line being walked away from", kind: "scripted" });
    expect(h.cancels()).toBe(0);

    h.channel.emit(TRANSITION_EVENT, "Warp");

    // Eased, not cut: the platform has not been stopped yet, and it stops on
    // the next word boundary.
    expect(h.cancels()).toBe(0);
    h.boundary();
    expect(h.cancels()).toBe(1);
    expect(h.audio.snapshot().voiceInterrupts).toBe(1);
  });

  it("a hand-off drops the lines queued behind it - that screen is gone", () => {
    const h = harness();
    h.audio.speak({ id: "a", text: "first", kind: "scripted" });
    h.audio.speak({ id: "b", text: "second", kind: "scripted" });
    h.channel.emit(TRANSITION_EVENT, "Results");
    h.boundary();
    h.tick();
    expect(h.spokenTexts()).toEqual(["first"]);
    expect(h.audio.snapshot().voiceQueued).toBe(0);
  });

  it("the next screen's first line starts AFTER the gap, into quiet", () => {
    const h = harness();
    h.audio.speak({ id: "a", text: "outgoing", kind: "scripted" });
    h.audio.interruptFor({ id: "b", text: "incoming", kind: "scripted" });
    h.boundary();
    expect(h.spokenTexts()).toEqual(["outgoing"]);
    h.tick();
    expect(h.spokenTexts()).toEqual(["outgoing", "incoming"]);
  });

  it("interruptFor with nothing to say still stops the line", () => {
    const h = harness();
    h.audio.speak({ id: "a", text: "outgoing", kind: "scripted" });
    h.audio.interruptFor();
    h.boundary();
    h.tick();
    expect(h.cancels()).toBe(1);
    expect(h.audio.snapshot().voiceSpeaking).toBe(false);
  });

  it("detaching stops listening for hand-offs", () => {
    const h = harness();
    expect(h.channel.count(TRANSITION_EVENT)).toBe(1);
    h.audio.dispose();
    expect(h.channel.count(TRANSITION_EVENT)).toBe(0);
  });
});
