import { describe, expect, it } from "vitest";
import {
  NullAudioContext,
  NullGain,
  reaches,
} from "../../../src/game/audio/nullContext.js";
import { dbToGain, gainToDb, seededRandom } from "../../../src/game/audio/context.js";
import {
  BUSES,
  BUS_IDS,
  DUCK_ATTACK_MS,
  DUCK_RELEASE_MS,
  DUCK_TARGET_IDS,
  SidechainDucker,
  UI_BUS,
  buildAudioGraph,
  busSpec,
  type AudioGraph,
  type BusId,
} from "../../../src/game/audio/graph.js";
import { DUCK_DB } from "../../../src/game/audio/voice.js";
import { MUSIC_LAYER_COUNT } from "../../../src/game/audio/music.js";
import { AMBIENT_CROSSFADE_MS } from "../../../src/game/audio/ambient.js";
import { createAudioSystem } from "../../../src/game/audio/index.js";
import { fakeVoiceEnvironment } from "./fakes.js";

const build = (): { ctx: NullAudioContext; graph: AudioGraph; speech: ReturnType<typeof fakeVoiceEnvironment> } => {
  const speech = fakeVoiceEnvironment();
  const ctx = new NullAudioContext();
  const graph = buildAudioGraph(ctx, { voiceEnv: speech.env, rand: seededRandom(3) });
  return { ctx, graph, speech };
};

describe("architecture 6: the bus topology", () => {
  it("has exactly the five buses the architecture names", () => {
    expect([...BUS_IDS]).toEqual(["master", "music", "ambient", "sfx", "voice"]);
  });

  it("hangs Music, Ambient, SFX and Voice off Master, and Master off the destination", () => {
    const { ctx, graph } = build();
    for (const spec of BUSES) {
      const node = graph.buses[spec.id];
      expect(node, spec.id).toBeDefined();
      if (spec.parent === null) {
        expect(reaches(node, ctx.destination)).toBe(true);
      } else {
        // The path is direct, not merely eventual.
        expect((node as NullGain).outputs[0]).toBe(graph.buses[spec.parent]);
      }
    }
    // Everything ends up at the destination, so master really is the one knob.
    for (const id of BUS_IDS) expect(reaches(graph.buses[id], ctx.destination)).toBe(true);
  });

  it("builds every bus as a labelled gain node on the context", () => {
    const { ctx } = build();
    const labels = ctx.labelledWith("bus.").map((n) => n.label);
    expect(labels.sort()).toEqual(BUS_IDS.map((id) => `bus.${id}`).sort());
  });

  it("architecture 6: UI sounds ride the SFX bus, not a bus of their own", () => {
    const { ctx, graph } = build();
    expect(UI_BUS).toBe("sfx");
    graph.sfx.play("uiNav");
    const voice = ctx.labelledWith("sfx.voice.uiNav")[0];
    expect(voice).toBeDefined();
    expect(reaches(voice!, graph.buses.sfx)).toBe(true);
    // And it does NOT reach the music or voice buses.
    expect(reaches(voice!, graph.buses.music)).toBe(false);
  });

  it("AC-21.2: the three music layer gains hang off the music bus", () => {
    const { graph } = build();
    expect(graph.music.layerGains().length).toBe(MUSIC_LAYER_COUNT);
    for (const gain of graph.music.layerGains()) {
      expect(reaches(gain, graph.buses.music)).toBe(true);
    }
  });

  it("AC-21.1: ambient beds hang off the ambient bus", () => {
    const { ctx, graph } = build();
    graph.ambient.start("earth");
    const bed = ctx.labelledWith("ambient.bed.earth")[0]!;
    expect(reaches(bed, graph.buses.ambient)).toBe(true);
    expect(reaches(bed, graph.buses.master)).toBe(true);
  });

  it("D75: the keystroke tone rides the SFX bus with the rest of the keypress", () => {
    const { ctx, graph } = build();
    graph.keystrokeTone.correct();
    const tone = ctx.labelledWith("sfx.keystrokeTone")[0]!;
    expect(reaches(tone, graph.buses.sfx)).toBe(true);
  });

  it("rejects an unknown bus loudly", () => {
    expect(() => busSpec("reverb" as BusId)).toThrow(/unknown bus/);
  });

  it("architecture 6: reduced motion does not appear anywhere in the audio", () => {
    // "Reduced-motion setting does not affect audio." A child who needs less
    // movement has not asked for less music.
    expect(BUSES.some((b) => b.note.includes("reducedMotion"))).toBe(false);
  });

  it("lets the master level move without disturbing the ducker's bases", () => {
    const { graph } = build();
    graph.setMasterGain(0.4);
    expect(graph.buses.master.gain.value).toBeCloseTo(0.4, 9);
    graph.setMasterGain(5);
    expect(graph.buses.master.gain.value).toBe(1);
    graph.ducker.duck(true);
    expect(graph.buses.music.gain.value).toBeCloseTo(busSpec("music").gain * dbToGain(DUCK_DB), 9);
  });

  it("honours a master gain supplied at construction", () => {
    const { env } = fakeVoiceEnvironment();
    const ctx = new NullAudioContext();
    const graph = buildAudioGraph(ctx, { voiceEnv: env, masterGain: 0.25 });
    expect(graph.buses.master.gain.value).toBeCloseTo(0.25, 9);
  });

  it("advances the time-based buses together, one call per frame", () => {
    const { graph } = build();
    graph.ambient.start("earth");
    graph.ambient.transitionTo("mars");
    graph.music.setIndex(2);
    graph.advance(AMBIENT_CROSSFADE_MS);
    expect(graph.ambient.activeStop).toBe("mars");
    expect(graph.music.changing).toBe(false);
  });
});

describe("AC-21.4: the voice bus sidechains Music and Ambient", () => {
  it("AC-21.4: it ducks exactly the two buses the architecture names", () => {
    expect([...DUCK_TARGET_IDS]).toEqual(["music", "ambient"]);
    const { graph } = build();
    expect([...graph.ducker.targetIds()]).toEqual(["music", "ambient"]);
    // SFX and Voice are NOT ducked: the game stays responsive under a line.
    expect(DUCK_TARGET_IDS).not.toContain("sfx");
    expect(DUCK_TARGET_IDS).not.toContain("voice");
  });

  it("AC-21.4: the measured reduction is at least 6 dB on every ducked bus", () => {
    const { graph } = build();
    const measured = graph.ducker.measureReductionDb();
    expect(Object.keys(measured).sort()).toEqual(["ambient", "music"]);
    for (const [bus, db] of Object.entries(measured)) {
      expect(db, bus).toBeLessThanOrEqual(-6);
    }
  });

  it("AC-21.4: measuring leaves the graph exactly as it found it", () => {
    const { graph } = build();
    const before = DUCK_TARGET_IDS.map((id) => graph.buses[id].gain.value);
    graph.ducker.measureReductionDb();
    const after = DUCK_TARGET_IDS.map((id) => graph.buses[id].gain.value);
    after.forEach((v, i) => expect(v).toBeCloseTo(before[i]!, 9));
    expect(graph.ducker.ducking).toBe(false);
  });

  it("AC-21.4: speaking really pulls the music down, and ending brings it back", () => {
    const { graph, speech } = build();
    const rest = graph.buses.music.gain.value;
    graph.voice.speak({ id: "l", text: "Careful out there.", kind: "scripted" });
    const ducked = graph.buses.music.gain.value;
    expect(gainToDb(ducked / rest)).toBeLessThanOrEqual(-6);
    speech.speech!.finishLast();
    expect(graph.buses.music.gain.value).toBeCloseTo(rest, 9);
  });

  it("AC-21.4: ramps rather than stepping, and comes back slower than it leaves", () => {
    const { graph } = build();
    graph.ducker.duck(true);
    const music = graph.buses.music as NullGain;
    expect(music.gain.events.map((e) => e.kind)).toContain("linear");
    // A release as fast as the attack pumps; the world should return, not snap.
    expect(DUCK_RELEASE_MS).toBeGreaterThan(DUCK_ATTACK_MS);
  });

  it("AC-21.4: nested lines do not release the duck early", () => {
    const { graph } = build();
    const rest = graph.buses.music.gain.value;
    graph.ducker.duck(true);
    graph.ducker.duck(true);
    graph.ducker.duck(false);
    expect(graph.ducker.ducking).toBe(true);
    expect(graph.buses.music.gain.value).toBeLessThan(rest);
    graph.ducker.duck(false);
    expect(graph.ducker.ducking).toBe(false);
    expect(graph.buses.music.gain.value).toBeCloseTo(rest, 9);
  });

  it("AC-21.4: an unbalanced release cannot drive the duck negative", () => {
    const { graph } = build();
    graph.ducker.duck(false);
    graph.ducker.duck(false);
    expect(graph.ducker.ducking).toBe(false);
    graph.ducker.duck(true);
    expect(graph.ducker.ducking).toBe(true);
  });

  it("reports -Infinity rather than a wrong number for a silent bus", () => {
    const ctx = new NullAudioContext();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const ducker = new SidechainDucker(ctx, [{ id: "music", gain, base: 0 }]);
    expect(ducker.measureReductionDb()["music"]).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe("createAudioSystem binds the platform", () => {
  it("builds a working graph in Node, with no Web Audio at all", () => {
    const graph = createAudioSystem();
    expect(graph.ctx).toBeInstanceOf(NullAudioContext);
    // Silence is a degraded experience; a crash on the title screen is a
    // broken one. Everything still works.
    graph.sfx.play("uiNav");
    graph.ambient.start("earth");
    graph.music.setFromState(4, 2);
    graph.advance(16.7);
    expect(graph.voice.transportId).toBe("silent");
  });

  it("uses the browser's AudioContext and voices when they exist", () => {
    let constructed = 0;
    class FakeAudioContext extends NullAudioContext {
      constructor() {
        super();
        constructed += 1;
      }
    }
    class Utterance {
      voice: unknown = null;
      lang = "";
      rate = 1;
      pitch = 1;
      volume = 1;
      onend: unknown = null;
      onerror: unknown = null;
      constructor(readonly text: string) {}
    }
    const scope = {
      AudioContext: FakeAudioContext,
      speechSynthesis: {
        getVoices: () => [{ name: "Samantha", lang: "en-US", localService: true, default: true }],
        speak: () => undefined,
        cancel: () => undefined,
      },
      SpeechSynthesisUtterance: Utterance,
      navigator: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel" },
      setTimeout: (cb: () => void) => {
        void cb;
        return 1;
      },
      clearTimeout: () => undefined,
    };
    // D98: `allowSystemVoice` is what binds the platform's voice at all; the
    // assertion below is unchanged, and the default-off case is covered by
    // `spokenLines.test.ts`.
    const graph = createAudioSystem({ scope, allowSystemVoice: true });
    expect(constructed).toBe(1);
    expect(graph.voice.transportId).toBe("webspeech");
  });

  it("survives a browser that refuses to construct an AudioContext", () => {
    const scope = {
      AudioContext: class {
        constructor() {
          throw new Error("blocked until a user gesture");
        }
      },
    };
    const graph = createAudioSystem({ scope });
    expect(graph.ctx).toBeInstanceOf(NullAudioContext);
  });

  it("falls back to a same-tick scheduler when there is no setTimeout", () => {
    const graph = createAudioSystem({ scope: {}, speech: null });
    let done = 0;
    graph.voice.speak({ id: "x", text: "hello there", kind: "coachNote" });
    // The silent transport's timer fires immediately in this environment, so
    // the line is already finished and the duck already released.
    expect(graph.ducker.ducking).toBe(false);
    void done;
  });

  it("wires the silent fallback to the platform's own setTimeout", () => {
    const timers: Array<{ id: number; cb: () => void }> = [];
    let nextId = 1;
    const scope = {
      setTimeout: (cb: () => void) => {
        const id = nextId++;
        timers.push({ id, cb });
        return id;
      },
      clearTimeout: (id: number) => {
        const index = timers.findIndex((t) => t.id === id);
        if (index >= 0) timers.splice(index, 1);
      },
    };
    const graph = createAudioSystem({ scope, speech: null });
    graph.voice.speak({ id: "x", text: "Approaching Neptune.", kind: "scripted" });
    expect(timers.length).toBe(1);
    expect(graph.ducker.ducking).toBe(true);

    // The timer really is the platform's, and cancelling really clears it.
    graph.voice.cancel();
    expect(timers.length).toBe(0);
    expect(graph.ducker.ducking).toBe(false);

    graph.voice.speak({ id: "y", text: "Beacon lit.", kind: "scripted" });
    timers[0]!.cb();
    expect(graph.ducker.ducking).toBe(false);
  });

  it("honours an explicitly supplied context, speech port and language", () => {
    const ctx = new NullAudioContext();
    const { env } = fakeVoiceEnvironment();
    const graph = createAudioSystem({
      ctx,
      speech: env.speech,
      platform: "mac",
      lang: "es-ES",
      rand: seededRandom(1),
      masterGain: 0.5,
      allowSystemVoice: true,
    });
    expect(graph.ctx).toBe(ctx);
    expect(graph.buses.master.gain.value).toBeCloseTo(0.5, 9);
    graph.voice.speak({ id: "x", text: "Hola.", kind: "scripted" });
    // Voice selection ran against the Spanish content language (D45).
    expect(graph.voice.transportId).toBe("webspeech");
  });
});
