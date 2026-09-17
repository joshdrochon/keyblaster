/**
 * Shadow's PRE-RENDERED voice (D63, D88; AC-21.4, AC-21.5, AC-21.7).
 *
 * Three groups, and the third is the one that matters most:
 *
 *   1. THE TRANSPORT. A rendered line plays its file; an unrendered line falls
 *      through to the platform voice; a file that never sounds falls through
 *      too, because a missing render must degrade and never swallow the line.
 *   2. THE GRAPH. The clip is routed to the VOICE BUS, which is what makes the
 *      AC-21.4 duck and the master fader apply to it, and it is faded on an
 *      EXPONENTIAL ramp - the real ease-out Web Speech cannot do.
 *   3. THE ID SPACE. Every rendered file corresponds to a manifest row and vice
 *      versa, and the ids the game actually hands to the voice bus are checked
 *      against what was rendered. Group 3 is here because the first render pass
 *      shipped 28 files whose ids NO CALL SITE EVER SPEAKS, and nothing in the
 *      repo noticed. A transport is worthless if it misses on every real line.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  VOICE_FADE_OUT_MS,
  VoiceBus,
  adaptiveTransport,
  createVoiceTransport,
  preRenderedTransport,
  type Ducker,
  type VoiceClipCallbacks,
  type VoiceClipHandle,
  type VoiceClipPlayer,
  type VoiceLine,
  type VoiceTransport,
} from "../../../src/game/audio/voice.js";
import {
  createVoiceClipPlayer,
  FADE_FLOOR_GAIN,
  type VoiceClipCatalog,
  type VoiceMediaElement,
} from "../../../src/game/audio/voiceClips.js";
import { buildAudioGraph } from "../../../src/game/audio/graph.js";
import { NullAudioContext, NullNode, reaches } from "../../../src/game/audio/nullContext.js";
import { fakeScheduler, fakeVoiceEnvironment, MAC_VOICES } from "./fakes.js";

const REPO = process.cwd();
const VOICE_DIR = join(REPO, "src/content/audio/voice");

const line = (id: string, text = "Course locked."): VoiceLine => ({ id, text, kind: "scripted" });

class CountingDucker implements Ducker {
  ducked = 0;
  duck(active: boolean): void {
    this.ducked += active ? 1 : -1;
  }
  get active(): boolean {
    return this.ducked > 0;
  }
}

// ---------------------------------------------------------------------------
// A fake media element. Four members, exactly as the port declares.
// ---------------------------------------------------------------------------

class FakeMediaElement implements VoiceMediaElement {
  /** A fake context accepts the fake itself; see `VoiceMediaElement.source`. */
  get source(): unknown {
    return this;
  }
  currentTime = 0;
  plays = 0;
  pauses = 0;
  /** Set to reject `play()`, which is how a browser reports "no gesture yet". */
  refuse: "throw" | "reject" | null = null;
  private readonly listeners = new Map<string, Array<() => void>>();

  constructor(readonly url: string) {}

  play(): unknown {
    this.plays += 1;
    if (this.refuse === "throw") throw new Error("NotAllowedError");
    if (this.refuse === "reject") return Promise.reject(new Error("NotAllowedError"));
    return Promise.resolve();
  }
  pause(): void {
    this.pauses += 1;
  }
  addEventListener(type: string, listener: () => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, listener: () => void): void {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((l) => l !== listener),
    );
  }
  emit(type: string): void {
    for (const l of [...(this.listeners.get(type) ?? [])]) l();
  }
  get listening(): number {
    return [...this.listeners.values()].reduce((n, l) => n + l.length, 0);
  }
}

function fakeCatalog(ids: readonly string[]): {
  catalog: VoiceClipCatalog;
  opened: Map<string, FakeMediaElement>;
} {
  const opened = new Map<string, FakeMediaElement>();
  const sorted = [...ids].sort();
  return {
    opened,
    catalog: {
      ids: () => sorted,
      open(id) {
        if (!sorted.includes(id)) return null;
        const el = new FakeMediaElement(`/assets/${id}.mp3`);
        opened.set(id, el);
        return el;
      },
    },
  };
}

/** A clip player whose every move is recorded. Used for transport-only tests. */
function recordingPlayer(ids: readonly string[]): {
  player: VoiceClipPlayer;
  started: string[];
  fades: number[];
  stops: number;
  last: () => VoiceClipCallbacks | null;
  handle: () => VoiceClipHandle | null;
  failNext: (on: boolean) => void;
} {
  const started: string[] = [];
  const fades: number[] = [];
  let stops = 0;
  let callbacks: VoiceClipCallbacks | null = null;
  let handle: VoiceClipHandle | null = null;
  let failSynchronously = false;
  const player: VoiceClipPlayer = {
    has: (id) => ids.includes(id),
    play(id, cbs) {
      started.push(id);
      callbacks = cbs;
      if (failSynchronously) {
        cbs.onFail();
        return null;
      }
      handle = {
        fadeOut(ms, done) {
          fades.push(ms);
          done();
        },
        stop() {
          stops += 1;
        },
      };
      return handle;
    },
  };
  return {
    player,
    started,
    fades,
    get stops() {
      return stops;
    },
    last: () => callbacks,
    handle: () => handle,
    failNext: (on) => {
      failSynchronously = on;
    },
  };
}

// ---------------------------------------------------------------------------
// 1. The transport
// ---------------------------------------------------------------------------

describe("D63: the pre-rendered transport", () => {
  it("plays the rendered file for a line the catalog has", () => {
    const rec = recordingPlayer(["mars.beaconFlavor"]);
    const fallback = fakeTransport();
    const transport = preRenderedTransport(rec.player, () => fallback.transport);

    let done = 0;
    transport.speak(line("mars.beaconFlavor"), () => (done += 1));

    expect(rec.started).toEqual(["mars.beaconFlavor"]);
    expect(fallback.spoken).toEqual([]);
    expect(done).toBe(0);
    rec.last()!.onEnd();
    expect(done).toBe(1);
  });

  it("falls back to the platform voice for a line that was never rendered", () => {
    // A coach note is written at runtime by an LLM. There can never be a file
    // for it, and that is the COMMON case rather than the error case.
    const rec = recordingPlayer(["mars.beaconFlavor"]);
    const fallback = fakeTransport();
    const transport = preRenderedTransport(rec.player, () => fallback.transport);

    let done = 0;
    transport.speak({ id: "warp.coachNote", text: "Nice run.", kind: "coachNote" }, () => (done += 1));

    expect(rec.started).toEqual([]);
    expect(fallback.spoken).toEqual(["warp.coachNote"]);
    fallback.finish();
    expect(done).toBe(1);
  });

  it("falls back when the file exists but never makes a sound", () => {
    // A 404, a decode failure, or a browser refusing playback before a gesture.
    // The line must still be SAID - degrade, never fail silently.
    const rec = recordingPlayer(["mars.beaconFlavor"]);
    const fallback = fakeTransport();
    const transport = preRenderedTransport(rec.player, () => fallback.transport);

    let done = 0;
    transport.speak(line("mars.beaconFlavor"), () => (done += 1));
    expect(fallback.spoken).toEqual([]);

    rec.last()!.onFail();
    expect(fallback.spoken).toEqual(["mars.beaconFlavor"]);
    expect(done).toBe(0);
    fallback.finish();
    expect(done).toBe(1);
  });

  it("falls back when the failure is reported synchronously, and only once", () => {
    const rec = recordingPlayer(["mars.beaconFlavor"]);
    rec.failNext(true);
    const fallback = fakeTransport();
    const transport = preRenderedTransport(rec.player, () => fallback.transport);

    let done = 0;
    transport.speak(line("mars.beaconFlavor"), () => (done += 1));
    expect(fallback.spoken).toEqual(["mars.beaconFlavor"]);
    fallback.finish();
    expect(done).toBe(1);
  });

  it("never throws and never leaves the bus waiting when the catalog lies", () => {
    // `has` says yes and `play` returns null. The bus must still get its line.
    const player: VoiceClipPlayer = { has: () => true, play: () => null };
    const fallback = fakeTransport();
    const transport = preRenderedTransport(player, () => fallback.transport);
    let done = 0;
    expect(() => transport.speak(line("ghost"), () => (done += 1))).not.toThrow();
    expect(fallback.spoken).toEqual(["ghost"]);
    fallback.finish();
    expect(done).toBe(1);
  });

  it("an ease-out fades the clip rather than cutting it, and releases once", () => {
    const rec = recordingPlayer(["mars.beaconFlavor"]);
    const transport = preRenderedTransport(rec.player, () => fakeTransport().transport);
    transport.speak(line("mars.beaconFlavor"), () => undefined);

    let released = 0;
    transport.easeOut(() => (released += 1));
    expect(rec.fades).toEqual([VOICE_FADE_OUT_MS]);
    expect(released).toBe(1);

    // A late `onEnd` from the faded clip belongs to nobody.
    rec.last()!.onEnd();
    expect(released).toBe(1);
  });

  it("an ease-out on a fallback line uses the fallback's own ease-out", () => {
    const rec = recordingPlayer([]);
    const fallback = fakeTransport();
    const transport = preRenderedTransport(rec.player, () => fallback.transport);
    transport.speak(line("unrendered"), () => undefined);
    let released = 0;
    transport.easeOut(() => (released += 1));
    expect(fallback.eases).toBe(1);
    expect(released).toBe(1);
  });

  it("an ease-out with nothing in flight releases immediately", () => {
    const rec = recordingPlayer(["a"]);
    const transport = preRenderedTransport(rec.player, () => fakeTransport().transport);
    let released = 0;
    transport.easeOut(() => (released += 1));
    expect(released).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The no-overlap queue must survive the new transport
// ---------------------------------------------------------------------------

describe("the file transport does not regress the no-overlap queue", () => {
  it("a second line is not handed to the transport until the first reports done", () => {
    const rec = recordingPlayer(["a", "b"]);
    const transport = preRenderedTransport(rec.player, () => fakeTransport().transport);
    const bus = new VoiceBus({ transport, ducker: new CountingDucker() });

    bus.speak(line("a"));
    bus.speak(line("b"));
    expect(rec.started).toEqual(["a"]);
    expect(bus.queued).toBe(1);

    rec.last()!.onEnd();
    expect(rec.started).toEqual(["a", "b"]);
    expect(bus.queued).toBe(0);
  });

  it("the duck is held across the gap between two clips and released once", () => {
    const rec = recordingPlayer(["a", "b"]);
    const scheduler = fakeScheduler();
    const ducker = new CountingDucker();
    const transport = preRenderedTransport(rec.player, () => fakeTransport().transport);
    const bus = new VoiceBus({ transport, ducker, schedule: scheduler.schedule });

    bus.speak(line("a"));
    bus.speak(line("b"));
    expect(ducker.active).toBe(true);
    rec.last()!.onEnd();
    // Still ducked: the gap is quiet under a ducked bed, not a stab of music.
    expect(ducker.active).toBe(true);
    scheduler.runAll();
    rec.last()!.onEnd();
    expect(ducker.active).toBe(false);
    expect(ducker.ducked).toBe(0);
  });

  it("a player interrupt eases the clip out and starts the replacement after", () => {
    const rec = recordingPlayer(["a", "b"]);
    const scheduler = fakeScheduler();
    const transport = preRenderedTransport(rec.player, () => fakeTransport().transport);
    const bus = new VoiceBus({
      transport,
      ducker: new CountingDucker(),
      schedule: scheduler.schedule,
    });

    bus.speak(line("a"));
    bus.interrupt(line("b"));
    expect(rec.fades).toEqual([VOICE_FADE_OUT_MS]);
    // The replacement waits out the pre-roll gap rather than butting up.
    expect(rec.started).toEqual(["a"]);
    scheduler.runAll();
    expect(rec.started).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// 2. The graph: routing and the real fade
// ---------------------------------------------------------------------------

describe("AC-21.4 / the brief: a clip is routed through the graph and faded for real", () => {
  const build = (ids: readonly string[]) => {
    const ctx = new NullAudioContext();
    const { catalog, opened } = fakeCatalog(ids);
    const scheduler = fakeScheduler();
    const { env } = fakeVoiceEnvironment(MAC_VOICES, "mac");
    const graph = buildAudioGraph(ctx, {
      voiceEnv: { ...env, schedule: scheduler.schedule },
      voiceClips: catalog,
    });
    return { ctx, graph, opened, scheduler };
  };

  it("the clip's gain reaches the voice bus, so the duck and the master apply", () => {
    const { ctx, graph, opened } = build(["mars.beaconFlavor"]);
    graph.voice.speak(line("mars.beaconFlavor"));

    const clipGain = ctx
      .labelled()
      .find((n) => n.label === "voice.clip.mars.beaconFlavor");
    expect(clipGain).toBeDefined();
    expect(reaches(clipGain as NullNode, graph.buses.voice as unknown as NullNode)).toBe(true);
    expect(reaches(clipGain as NullNode, graph.buses.master as unknown as NullNode)).toBe(true);
    expect(reaches(clipGain as NullNode, ctx.destination)).toBe(true);
    expect(opened.get("mars.beaconFlavor")?.plays).toBe(1);
  });

  it("the element's OWN `source` is what the context is handed, not the adapter", () => {
    // A real `createMediaElementSource` throws on anything that is not a
    // genuine HTMLMediaElement, and the throw is caught - so getting this wrong
    // does not fail, it silently sends every line to Web Speech instead. Caught
    // in a live browser by tests/e2e/shadow-clips.spec.ts; asserted here so it
    // cannot come back without the unit suite noticing.
    const { ctx, graph, opened } = build(["mars.beaconFlavor"]);
    graph.voice.speak(line("mars.beaconFlavor"));
    const element = opened.get("mars.beaconFlavor");
    expect(ctx.mediaElements).toEqual([element?.source]);
    expect(ctx.mediaElements[0]).toBe(element);
  });

  it("speaking a clip ducks the music and ambient buses (AC-21.4)", () => {
    const { ctx, graph, opened } = build(["mars.beaconFlavor"]);
    const rest = graph.buses.music.gain.value;
    graph.voice.speak(line("mars.beaconFlavor"));
    expect(graph.buses.music.gain.value).toBeLessThan(rest);
    opened.get("mars.beaconFlavor")!.emit("ended");
    expect(graph.buses.music.gain.value).toBeCloseTo(rest, 6);
    expect(ctx).toBeDefined();
  });

  it("an interrupt schedules an EXPONENTIAL ramp to silence, never a linear one", () => {
    // This is the whole advantage over Web Speech, which has no gain node and
    // has to settle for stopping on a word boundary.
    const { ctx, graph, opened, scheduler } = build(["mars.beaconFlavor"]);
    graph.voice.speak(line("mars.beaconFlavor"));
    const clipGain = ctx.labelled().find((n) => n.label === "voice.clip.mars.beaconFlavor");
    const param = (clipGain as NullNode & { gain: { events: Array<{ kind: string; value: number }> } })
      .gain;
    param.events.length = 0;

    graph.voice.interrupt();

    const kinds = param.events.map((e) => e.kind);
    expect(kinds).toContain("exponential");
    expect(kinds).not.toContain("linear");
    const ramp = param.events.find((e) => e.kind === "exponential");
    expect(ramp?.value).toBe(FADE_FLOOR_GAIN);

    // The element is only stopped once the fade has finished.
    const el = opened.get("mars.beaconFlavor")!;
    expect(el.pauses).toBe(0);
    scheduler.runAll();
    expect(el.pauses).toBe(1);
    expect(param.events[param.events.length - 1]?.value).toBe(0);
  });

  it("a stopped clip stops listening, so a late event cannot reach the bus", () => {
    const { graph, opened, scheduler } = build(["a"]);
    graph.voice.speak(line("a"));
    const el = opened.get("a")!;
    expect(el.listening).toBeGreaterThan(0);
    graph.voice.cancel();
    expect(el.listening).toBe(0);
    expect(() => el.emit("ended")).not.toThrow();
    scheduler.runAll();
  });

  it("a context that cannot route a media element simply has no clip path", () => {
    // Every line goes to the platform voice, exactly as before the files
    // existed. A context port without the optional member is the honest shape
    // of "this machine cannot play a file", so the stand-in is an object
    // literal rather than a NullAudioContext with a member deleted off it -
    // deleting an instance property never removes a prototype method, and a
    // test that thinks it did is a test that asserts nothing.
    const base = new NullAudioContext();
    const ctx = { ...base, createMediaElementSource: undefined } as unknown as NullAudioContext;
    const { catalog } = fakeCatalog(["a"]);
    const player = createVoiceClipPlayer(ctx, base.destination, catalog, fakeScheduler().schedule);
    expect(player).toBe(null);
  });

  it("a browser that refuses playback before a gesture falls back, not silent", () => {
    // Chrome will not make noise until the player has touched something. The
    // refusal arrives as a thrown NotAllowedError or a rejected promise, and
    // either way NOTHING WAS HEARD - so the line owes the player a fallback.
    for (const refusal of ["throw", "reject"] as const) {
      const ctx = new NullAudioContext();
      const element = new FakeMediaElement("/assets/a.mp3");
      element.refuse = refusal;
      const catalog: VoiceClipCatalog = { ids: () => ["a"], open: () => element };
      const player = createVoiceClipPlayer(
        ctx,
        ctx.destination,
        catalog,
        fakeScheduler().schedule,
      );
      let failed = 0;
      let ended = 0;
      const handle = player!.play("a", {
        onEnd: () => (ended += 1),
        onFail: () => (failed += 1),
      });
      if (refusal === "throw") {
        expect(handle).toBe(null);
        expect(failed).toBe(1);
      } else {
        // The rejection is asynchronous; the handle exists until it lands.
        expect(handle).not.toBe(null);
      }
      expect(ended).toBe(0);
    }
  });

  it("an asynchronously refused clip reports the failure once it lands", async () => {
    const ctx = new NullAudioContext();
    const element = new FakeMediaElement("/assets/a.mp3");
    element.refuse = "reject";
    const catalog: VoiceClipCatalog = { ids: () => ["a"], open: () => element };
    const player = createVoiceClipPlayer(ctx, ctx.destination, catalog, fakeScheduler().schedule);
    let failed = 0;
    player!.play("a", { onEnd: () => undefined, onFail: () => (failed += 1) });
    await Promise.resolve();
    await Promise.resolve();
    expect(failed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Selection: per line, never per session
// ---------------------------------------------------------------------------

describe("AC-21.7: the transport is chosen per line", () => {
  it("one session uses the file for a rendered line and the voice for the next", () => {
    const { env, speech } = fakeVoiceEnvironment(MAC_VOICES, "mac");
    const rec = recordingPlayer(["earth.preflightLine"]);
    const transport = adaptiveTransport({ ...env, clips: rec.player });

    transport.speak(line("earth.preflightLine"), () => undefined);
    expect(rec.started).toEqual(["earth.preflightLine"]);
    rec.last()!.onEnd();

    // Same transport, same session, next line: no file, so the platform voice
    // takes it. The decision is the LINE's, not the session's.
    transport.speak({ id: "warp.coachNote", text: "Nice run.", kind: "coachNote" }, () => undefined);
    expect(rec.started).toEqual(["earth.preflightLine"]);
    expect(speech!.last?.text).toBe("Nice run.");

    // `id` still reports the SPEECH path and nothing else - see the getter's
    // comment. Whether this build has files is `graph.voiceClipIds`, because
    // "can this machine speak an unrendered line" is a different question with
    // a different answer and three e2e tests depend on the distinction.
    expect(transport.id).toBe("webspeech");
  });

  it("the graph reports which lines it can play from a file, separately", () => {
    const ctx = new NullAudioContext();
    const { catalog } = fakeCatalog(["mars.beaconFlavor", "earth.preflightLine"]);
    const { env } = fakeVoiceEnvironment(MAC_VOICES, "mac");
    const withClips = buildAudioGraph(ctx, { voiceEnv: env, voiceClips: catalog });
    expect(withClips.voiceClipIds).toEqual(["earth.preflightLine", "mars.beaconFlavor"]);
    // The speech path is unchanged and still answers AC-21.5's question.
    expect(withClips.voice.transportId).toBe("webspeech");

    const without = buildAudioGraph(new NullAudioContext(), { voiceEnv: env });
    expect(without.voiceClipIds).toEqual([]);
    expect(without.voice.transportId).toBe("webspeech");
  });

  it("a build with no rendered files behaves exactly as the stand-in did (D88)", () => {
    const { env, speech } = fakeVoiceEnvironment(MAC_VOICES, "mac");
    const transport = createVoiceTransport(env);
    expect(transport.id).toBe("webspeech");
    transport.speak(line("anything"), () => undefined);
    expect(speech!.requests).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 3. The id space. The half that was wrong, and the half that must stay right.
// ---------------------------------------------------------------------------

describe("D63: the render manifest and the files on disk agree", () => {
  const manifest = JSON.parse(readFileSync(join(VOICE_DIR, "manifest.json"), "utf8")) as {
    lines: Array<{ id: string; file: string }>;
  };
  const onDisk = readdirSync(VOICE_DIR).filter((f) => f.endsWith(".mp3"));

  it("every manifest row has a file", () => {
    const missing = manifest.lines.filter((l) => !onDisk.includes(l.file)).map((l) => l.id);
    expect(missing).toEqual([]);
  });

  it("every file has a manifest row - no orphans from a capped run", () => {
    const known = new Set(manifest.lines.map((l) => l.file));
    expect(onDisk.filter((f) => !known.has(f))).toEqual([]);
  });

  it("a file's name IS its line id, which is what the catalog relies on", () => {
    const wrong = manifest.lines.filter((l) => l.file !== `${l.id}.mp3`).map((l) => l.id);
    expect(wrong).toEqual([]);
  });
});

/**
 * THE CHECK THAT WAS MISSING.
 *
 * The first render pass produced 28 files against ids of the form
 * `<stop>.<field>`, picked from a hand-written list of "fields Shadow speaks"
 * that was never cross-checked against a call site. No call site spoke any of
 * them, so a file transport would have missed on 100% of real lines while every
 * test in the repo stayed green.
 *
 * This test walks the SPEAK SITES - the scenes that hand a `VoiceLine` to the
 * audio service - and asserts that every id they can produce is either rendered
 * or is one of the ids that can never be rendered. It is deliberately a source
 * scan: the alternative is booting Phaser, and a check that cannot run in the
 * unit suite is a check that stops running.
 */
describe("the ids the game SPEAKS are the ids that were RENDERED", () => {
  const rendered = new Set(
    readdirSync(VOICE_DIR)
      .filter((f) => f.endsWith(".mp3"))
      .map((f) => f.slice(0, -".mp3".length)),
  );

  const stops = ["earth", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"];

  it("every beacon line the game speaks has a rendered file", () => {
    const wanted = stops.flatMap((s) => [
      `${s}.beaconHeadline`,
      `${s}.beaconState`,
      `${s}.beaconFlavor`,
    ]);
    expect(wanted.filter((id) => !rendered.has(id))).toEqual([]);
  });

  it("every stop's pre-flight line has a rendered file", () => {
    expect(stops.map((s) => `${s}.preflightLine`).filter((id) => !rendered.has(id))).toEqual([]);
  });

  it("BeaconScene speaks the three beacon fields with <stop>.<field> ids", () => {
    // The id space is the contract between the scene and the manifest. A scene
    // that speaks `beacon.headline` instead of `${stopId}.beaconHeadline` is a
    // scene that will never play a file, and nothing else would notice.
    const source = readFileSync(join(REPO, "src/game/scenes/BeaconScene.ts"), "utf8");
    for (const field of ["beaconHeadline", "beaconState", "beaconFlavor"]) {
      expect(source).toContain(`\${this.stopId}.${field}`);
    }
  });

  it("EarthActivationScene speaks the pre-flight line with a <stop>.<field> id", () => {
    const source = readFileSync(join(REPO, "src/game/scenes/EarthActivationScene.ts"), "utf8");
    expect(source).toContain("preflightLine");
    expect(source).toMatch(/\$\{[^}]*stopId[^}]*\}\.preflightLine/);
  });

  it("the runtime coach note is NOT expected to have a file, and never will", () => {
    // It is written by an LLM during the warp break. Recording it is impossible
    // by construction, and the transport must fall through for it forever.
    expect(rendered.has("warp.coachNote")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A transport that records what it was asked to do. Stands in for Web Speech. */
function fakeTransport(): {
  transport: VoiceTransport;
  spoken: string[];
  eases: number;
  finish: () => void;
} {
  const spoken: string[] = [];
  let eases = 0;
  let done: (() => void) | null = null;
  return {
    spoken,
    get eases() {
      return eases;
    },
    finish: () => {
      const cb = done;
      done = null;
      cb?.();
    },
    transport: {
      id: "webspeech",
      available: () => true,
      speak(l, onDone) {
        spoken.push(l.id);
        done = onDone;
      },
      cancel() {
        done = null;
      },
      easeOut(release) {
        eases += 1;
        done = null;
        release();
      },
    },
  };
}
