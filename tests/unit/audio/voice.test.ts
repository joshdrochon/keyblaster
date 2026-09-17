import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DUCK_DB,
  EASE_OUT_DEADLINE_MS,
  VOICE_GAP_MS,
  VOICE_DELIVERY,
  VOICE_PREFERENCES,
  VoiceBus,
  adaptiveTransport,
  browserSpeechPort,
  localVoiceFor,
  coachNoteDisplay,
  createVoiceTransport,
  detectPlatform,
  estimateSpeechMs,
  selectVoice,
  silentTransport,
  speakCoachNote,
  webSpeechPort,
  webSpeechTransport,
  type Ducker,
  type SpeakRequest,
  type SpeechPort,
  type SpeechVoiceLike,
  type VoiceLine,
} from "../../../src/game/audio/voice.js";
import { dbToGain, gainToDb } from "../../../src/game/audio/context.js";
import {
  FakeSpeechPort,
  LINUX_VOICES,
  MAC_VOICES,
  WINDOWS_VOICES,
  fakeScheduler,
  fakeVoiceEnvironment,
} from "./fakes.js";

const AUDIO_SRC = join(process.cwd(), "src/game/audio");

class CountingDucker implements Ducker {
  ducked = 0;
  readonly calls: boolean[] = [];
  duck(active: boolean): void {
    this.calls.push(active);
    this.ducked += active ? 1 : -1;
  }
  get active(): boolean {
    return this.ducked > 0;
  }
}

const line = (text = "Course locked."): VoiceLine => ({ id: "l1", text, kind: "scripted" });

describe("AC-21.5: Shadow speaks via the Web Speech system voice", () => {
  it("AC-21.5: the shipped transport is webspeech when a voice exists", () => {
    const { env } = fakeVoiceEnvironment(MAC_VOICES, "mac");
    expect(createVoiceTransport(env).id).toBe("webspeech");
  });

  it("AC-21.5: has a per-platform preference list for every platform", () => {
    for (const platform of ["mac", "windows", "linux", "other"] as const) {
      expect(VOICE_PREFERENCES[platform]).toBeDefined();
    }
    expect(VOICE_PREFERENCES.mac.length).toBeGreaterThan(0);
    expect(VOICE_PREFERENCES.windows.length).toBeGreaterThan(0);
    expect(VOICE_PREFERENCES.linux.length).toBeGreaterThan(0);
  });

  it("AC-21.5: picks the preferred local voice on each platform", () => {
    expect(selectVoice(MAC_VOICES, "mac", "en-US")?.name).toBe("Samantha");
    expect(selectVoice(WINDOWS_VOICES, "windows", "en-US")?.name).toContain("Zira Desktop");
    expect(selectVoice(LINUX_VOICES, "linux", "en-US")?.name).toBe("English (America)");
  });

  it("AC-21.5: NEVER picks a cloud voice while a local one exists", () => {
    // This is the subtle network-TTS leak: Chrome's "Google ..." and Edge's
    // "... Online (Natural)" voices are rendered on a server. Choosing one
    // would be a runtime TTS network call made on our behalf.
    const mac = selectVoice(MAC_VOICES, "mac", "en-US");
    expect(mac?.localService).toBe(true);
    expect(mac?.name).not.toContain("Google");

    const windows = selectVoice(WINDOWS_VOICES, "windows", "en-US");
    expect(windows?.localService).toBe(true);
    expect(windows?.name).not.toContain("Online");

    // Even when the cloud voice is flagged as the platform default.
    const onlyDefaultIsCloud: SpeechVoiceLike[] = [
      { name: "Google US English", lang: "en-US", localService: false, default: true },
      { name: "Plain Local", lang: "en-US", localService: true },
    ];
    expect(selectVoice(onlyDefaultIsCloud, "other", "en-US")?.name).toBe("Plain Local");
  });

  it("AC-21.5: falls back through language, default and first voice", () => {
    // Language beats warmth: a lovely English voice reading Spanish is worse
    // than a plain Spanish one (D45 ships three content languages).
    expect(selectVoice(MAC_VOICES, "mac", "es-ES")?.name).toBe("Monica");
    // No voice in that language at all: fall back to the whole list.
    expect(selectVoice(MAC_VOICES, "mac", "hi-IN")?.name).toBe("Samantha");
    // No preference matches: take the platform default, then the first.
    const unknown: SpeechVoiceLike[] = [
      { name: "Voice A", lang: "en-US", localService: true },
      { name: "Voice B", lang: "en-US", localService: true, default: true },
    ];
    expect(selectVoice(unknown, "other", "en-US")?.name).toBe("Voice B");
    expect(selectVoice([unknown[0]!], "other", "en-US")?.name).toBe("Voice A");
    // A list of only cloud voices is still better than silence.
    expect(selectVoice([MAC_VOICES[0]!], "mac", "en-US")?.name).toBe("Google US English");
    expect(selectVoice([], "mac", "en-US")).toBe(null);
  });

  it("AC-21.5: detects the platform from the user agent", () => {
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("mac");
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    expect(detectPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
    expect(detectPlatform("", "MacIntel")).toBe("mac");
    expect(detectPlatform("something else entirely")).toBe("other");
  });

  it("AC-21.5: speaks the line through the platform, with Shadow's delivery", () => {
    const { env, speech } = fakeVoiceEnvironment();
    const transport = createVoiceTransport(env);
    transport.speak(line("Mars ahead."), () => undefined);
    expect(speech!.last?.text).toBe("Mars ahead.");
    expect(speech!.last?.voiceName).toBe("Samantha");
    expect(speech!.last?.rate).toBe(VOICE_DELIVERY.rate);
    expect(speech!.last?.lang).toBe("en-US");
  });

  it("AC-21.5: reports done exactly once, on end, error or cancel", () => {
    const port = new FakeSpeechPort();
    const transport = webSpeechTransport(port, "mac", "en-US");
    let done = 0;
    transport.speak(line(), () => (done += 1));
    port.finishLast();
    port.finishLast();
    expect(done).toBe(1);

    transport.speak(line(), () => (done += 1));
    port.failLast();
    expect(done).toBe(2);

    transport.speak(line(), () => (done += 1));
    transport.cancel();
    expect(done).toBe(3);
    expect(port.cancels).toBe(1);
  });

  it("AC-21.5: a new line supersedes the one in flight rather than queueing", () => {
    const port = new FakeSpeechPort();
    const transport = webSpeechTransport(port, "mac", "en-US");
    let done = 0;
    transport.speak(line("first"), () => (done += 1));
    transport.speak(line("second"), () => (done += 1));
    expect(done).toBe(1);
    expect(port.requests.length).toBe(2);
  });
});

describe("AC-21.5: the fallback when no voice is available", () => {
  it("AC-21.5: falls back to silence when there is no speech API at all", () => {
    const { env } = fakeVoiceEnvironment(null);
    expect(createVoiceTransport(env).id).toBe("silent");
  });

  it("AC-21.5: falls back to silence when the platform lists no voices", () => {
    const { env } = fakeVoiceEnvironment([]);
    expect(createVoiceTransport(env).id).toBe("silent");
  });

  it("AC-21.5: the silent fallback still takes the time the line would take", () => {
    const scheduler = fakeScheduler();
    const transport = silentTransport(scheduler.schedule);
    let done = 0;
    transport.speak(line("A long sentence with several words in it."), () => (done += 1));
    expect(done).toBe(0);
    expect(scheduler.pending).toBe(1);
    scheduler.runAll();
    expect(done).toBe(1);
    expect(transport.available()).toBe(true);
  });

  it("AC-21.5: cancelling the silent fallback drops its pending callback", () => {
    const scheduler = fakeScheduler();
    const transport = silentTransport(scheduler.schedule);
    let done = 0;
    transport.speak(line(), () => (done += 1));
    transport.cancel();
    scheduler.runAll();
    expect(done).toBe(0);
  });

  it("estimates speech length from the word count, with a floor", () => {
    expect(estimateSpeechMs("")).toBe(350);
    expect(estimateSpeechMs("one two three")).toBeGreaterThan(350);
    const long = "word ".repeat(30);
    expect(estimateSpeechMs(long)).toBeGreaterThan(estimateSpeechMs("word word"));
    // A faster rate is a shorter line.
    expect(estimateSpeechMs(long, 2)).toBeLessThan(estimateSpeechMs(long, 1));
    expect(estimateSpeechMs(long, 0)).toBe(estimateSpeechMs(long, 1));
  });
});

describe("AC-21.4: Shadow's voice ducks the music", () => {
  it("AC-21.4: the shipped duck is at least 6 dB", () => {
    expect(DUCK_DB).toBeLessThanOrEqual(-6);
    expect(gainToDb(dbToGain(DUCK_DB))).toBeLessThanOrEqual(-6 + 1e-9);
  });

  it("AC-21.4: the bus ducks on speak and releases when the line ends", () => {
    const port = new FakeSpeechPort();
    const ducker = new CountingDucker();
    const bus = new VoiceBus({ transport: webSpeechTransport(port, "mac", "en-US"), ducker });

    expect(ducker.active).toBe(false);
    bus.speak(line());
    expect(bus.speaking).toBe(true);
    expect(ducker.active).toBe(true);

    port.finishLast();
    expect(bus.speaking).toBe(false);
    expect(ducker.active).toBe(false);
    expect(ducker.calls).toEqual([true, false]);
  });

  it("AC-21.4: the duck releases even when the platform refuses the line", () => {
    const port = new FakeSpeechPort();
    const ducker = new CountingDucker();
    const bus = new VoiceBus({ transport: webSpeechTransport(port, "mac", "en-US"), ducker });
    bus.speak(line());
    port.failLast();
    expect(ducker.active).toBe(false);
  });

  it("AC-21.4: cancelling releases the duck and stops the line", () => {
    const port = new FakeSpeechPort();
    const ducker = new CountingDucker();
    const bus = new VoiceBus({ transport: webSpeechTransport(port, "mac", "en-US"), ducker });
    bus.speak(line());
    bus.cancel();
    expect(bus.speaking).toBe(false);
    expect(ducker.active).toBe(false);
    // Cancelling when nothing is speaking must not unbalance the ducker.
    bus.cancel();
    expect(ducker.ducked).toBe(0);
  });

  it("AC-21.4: a queued pair leaves the duck balanced, never stuck", () => {
    const port = new FakeSpeechPort();
    const ducker = new CountingDucker();
    const bus = new VoiceBus({ transport: webSpeechTransport(port, "mac", "en-US"), ducker });
    bus.speak(line("first"));
    bus.speak(line("second"));
    // The second line waits, so the first `finishLast` starts it rather than
    // draining the bus. The duck is HELD across the two: one duck(true) at the
    // top and one duck(false) when the last line ends, never a pump per line.
    port.finishLast();
    expect(ducker.ducked).toBe(1);
    port.finishLast();
    expect(ducker.ducked).toBe(0);
    expect(bus.speaking).toBe(false);
    expect(ducker.calls).toEqual([true, false]);
  });

  it("keeps a history of the lines it started", () => {
    const port = new FakeSpeechPort();
    const bus = new VoiceBus({
      transport: webSpeechTransport(port, "mac", "en-US"),
      ducker: new CountingDucker(),
    });
    bus.speak(line("a"));
    port.finishLast();
    bus.speak(line("b"));
    expect(bus.history().map((l) => l.text)).toEqual(["a", "b"]);
    expect(bus.transportId).toBe("webspeech");
  });
});

/**
 * THE DEFECT THIS BLOCK EXISTS FOR.
 *
 * The player heard two of Shadow's lines at once and said: "That can't happen
 * unless that's because of actual controls from the player." The bus used to
 * CANCEL the line in flight whenever a new one arrived, which is two separate
 * mistakes. It relied on `speechSynthesis.cancel()` to serialise - and that call
 * is asynchronous, so cancel-then-speak in one task is a race the platform can
 * lose by rendering the tail of one line under the head of the next. And it
 * treated a scene emitting its next line, which should WAIT, as the same event
 * as a player advancing the screen, which should cut in.
 *
 * So: two `speak()` calls in a row must never be concurrent, and an interrupt
 * must EASE rather than cut. Both are asserted against the transport, not
 * against the bus's own bookkeeping - the question is what the platform was
 * asked to do.
 */
describe("the voice bus serialises, and only the player interrupts", () => {
  const busWithScheduler = (): {
    bus: VoiceBus;
    port: FakeSpeechPort;
    ducker: CountingDucker;
    scheduler: ReturnType<typeof fakeScheduler>;
  } => {
    const port = new FakeSpeechPort();
    const ducker = new CountingDucker();
    const scheduler = fakeScheduler();
    const bus = new VoiceBus({
      transport: webSpeechTransport(port, "mac", "en-US", { schedule: scheduler.schedule }),
      ducker,
      schedule: scheduler.schedule,
    });
    return { bus, port, ducker, scheduler };
  };

  it("two speak() calls are never concurrent: the second waits for the first", () => {
    const { bus, port, scheduler } = busWithScheduler();
    bus.speak(line("first"));
    bus.speak(line("second"));

    // THE ASSERTION. One utterance has reached the platform, not two. Before
    // the queue this was two `speak` calls with a `cancel` wedged between them,
    // which is where the overlap came from.
    expect(port.requests.length).toBe(1);
    expect(port.last?.text).toBe("first");
    expect(bus.queued).toBe(1);

    port.finishLast();
    // Still one: the pre-roll gap is running, and the gap is silence.
    expect(port.requests.length).toBe(1);

    scheduler.runAll();
    expect(port.requests.map((r) => r.text)).toEqual(["first", "second"]);
  });

  it("a whole run of lines comes out in order, one at a time, every time", () => {
    const { bus, port, scheduler } = busWithScheduler();
    const texts = ["one", "two", "three", "four", "five"];
    for (const text of texts) bus.speak(line(text));

    const seen: string[] = [];
    for (let i = 0; i < texts.length; i += 1) {
      // At no point in the run is there more than one line in flight.
      expect(port.requests.length, `after ${i} lines`).toBe(i + 1);
      seen.push(port.last?.text ?? "");
      port.finishLast();
      scheduler.runAll();
    }
    expect(seen).toEqual(texts);
    expect(bus.queued).toBe(0);
    expect(bus.active).toBe(false);
  });

  it("a queued line never overlaps even when the platform refuses one", () => {
    const { bus, port, scheduler } = busWithScheduler();
    bus.speak(line("refused"));
    bus.speak(line("after"));
    port.failLast();
    expect(port.requests.length).toBe(1);
    scheduler.runAll();
    expect(port.requests.map((r) => r.text)).toEqual(["refused", "after"]);
  });

  it("AC-21.4: the two lines are separated by a real gap, not butted together", () => {
    const { bus, port, scheduler } = busWithScheduler();
    bus.speak(line("first"));
    bus.speak(line("second"));
    port.finishLast();
    // Something is scheduled between them, and the bus is still ACTIVE across
    // it - which is what holds the music down rather than letting it swell up
    // into the gap and duck again a breath later.
    expect(scheduler.pending).toBe(1);
    expect(bus.speaking).toBe(false);
    expect(bus.active).toBe(true);
  });

  it("VOICE_GAP_MS is a real pause and EASE_OUT_DEADLINE_MS is a short one", () => {
    // Bounds rather than exact values: the numbers are taste, the relation is
    // not. An interrupt that takes longer than the gap after it would feel like
    // lag rather than like Shadow giving way.
    expect(VOICE_GAP_MS).toBeGreaterThan(80);
    expect(VOICE_GAP_MS).toBeLessThan(400);
    expect(EASE_OUT_DEADLINE_MS).toBeGreaterThan(0);
    expect(EASE_OUT_DEADLINE_MS).toBeLessThan(VOICE_GAP_MS);
  });

  it("an interrupt EASES OUT on a word boundary rather than cutting mid-word", () => {
    const { bus, port, scheduler } = busWithScheduler();
    bus.speak(line("a long line the player is about to walk away from"));
    expect(port.cancels).toBe(0);

    bus.interrupt(line("next screen"));

    // THE POINT. The interrupt is registered and the platform has NOT been
    // told to stop yet - the line is allowed to finish the word it is on.
    expect(port.cancels).toBe(0);
    expect(port.requests.length).toBe(1);

    // The synthesiser crosses a word. NOW it stops, on a finished word.
    port.last?.onBoundary?.();
    expect(port.cancels).toBe(1);

    // And the replacement does not start on top of the stop: it starts after
    // the pre-roll gap, into quiet.
    expect(port.requests.length).toBe(1);
    scheduler.runAll();
    expect(port.requests.map((r) => r.text)).toEqual([
      "a long line the player is about to walk away from",
      "next screen",
    ]);
  });

  it("an interrupt still lands promptly when the platform reports no boundaries", () => {
    // Safari does not fire `onboundary` reliably. Waiting forever for a word
    // that never comes would leave the next screen silent, so the ease-out is
    // capped: the deadline cuts it and the gap still applies.
    const { bus, port, scheduler } = busWithScheduler();
    bus.speak(line("no boundaries here"));
    bus.interrupt(line("next"));
    expect(port.cancels).toBe(0);

    scheduler.runAll(); // the deadline fires
    expect(port.cancels).toBe(1);

    scheduler.runAll(); // then the gap
    expect(port.requests.map((r) => r.text)).toEqual(["no boundaries here", "next"]);
  });

  it("an interrupt drops what was queued behind it - that screen is gone", () => {
    const { bus, port, scheduler } = busWithScheduler();
    bus.speak(line("first"));
    bus.speak(line("second"));
    bus.speak(line("third"));
    bus.interrupt(line("the new screen"));
    port.last?.onBoundary?.();
    scheduler.runAll();
    expect(port.requests.map((r) => r.text)).toEqual(["first", "the new screen"]);
    expect(bus.queued).toBe(0);
  });

  it("AC-21.4: an interrupt holds the duck across the handover, then releases it", () => {
    const { bus, port, ducker, scheduler } = busWithScheduler();
    bus.speak(line("outgoing"));
    bus.interrupt(line("incoming"));
    port.last?.onBoundary?.();
    // Still ducked: the ease-out and the gap are part of the same speech, and
    // the music must not come up for 180 ms between two sentences.
    expect(ducker.ducked).toBe(1);
    scheduler.runAll();
    port.finishLast();
    expect(ducker.ducked).toBe(0);
    expect(ducker.calls).toEqual([true, false]);
  });

  it("an interrupt with nothing to say still eases the line out", () => {
    const { bus, port, ducker, scheduler } = busWithScheduler();
    bus.speak(line("mid sentence"));
    bus.interrupt();
    port.last?.onBoundary?.();
    scheduler.runAll();
    expect(port.cancels).toBe(1);
    expect(bus.speaking).toBe(false);
    expect(bus.active).toBe(false);
    expect(ducker.ducked).toBe(0);
  });

  it("an interrupt on a silent bus simply starts the line", () => {
    const { bus, port, scheduler } = busWithScheduler();
    bus.interrupt(line("first thing said"));
    scheduler.runAll();
    expect(port.requests.map((r) => r.text)).toEqual(["first thing said"]);
  });

  it("cancel is the hard stop, and it is not an interrupt", () => {
    // A scene tearing down does not get a graceful exit - there is nothing left
    // to be graceful for. This is the difference `interrupt` exists to make.
    const { bus, port, ducker, scheduler } = busWithScheduler();
    bus.speak(line("first"));
    bus.speak(line("second"));
    bus.cancel();
    expect(port.cancels).toBe(1);
    expect(bus.queued).toBe(0);
    expect(bus.active).toBe(false);
    expect(ducker.ducked).toBe(0);
    scheduler.runAll();
    expect(port.requests.length).toBe(1);
    // And cancelling twice must not unbalance the ducker.
    bus.cancel();
    expect(ducker.ducked).toBe(0);
  });

  it("a line that arrives DURING an ease-out waits for it, and does not cut it", () => {
    const { bus, port, scheduler } = busWithScheduler();
    bus.speak(line("outgoing"));
    bus.interrupt();
    bus.speak(line("arrived mid-ease"));
    expect(port.requests.length).toBe(1);
    port.last?.onBoundary?.();
    expect(port.requests.length).toBe(1);
    scheduler.runAll();
    expect(port.requests.map((r) => r.text)).toEqual(["outgoing", "arrived mid-ease"]);
  });

  it("the silent fallback has the same shape: queued, one at a time, gapped", () => {
    // AC-21.5's fallback is a fallback, not a different game. A player with no
    // system voice gets the same pacing, which is the whole reason the silent
    // transport takes the time the line would have taken.
    const scheduler = fakeScheduler();
    const ducker = new CountingDucker();
    const bus = new VoiceBus({
      transport: silentTransport(scheduler.schedule),
      ducker,
      schedule: scheduler.schedule,
    });
    bus.speak(line("first"));
    bus.speak(line("second"));
    expect(bus.speaking).toBe(true);
    expect(bus.queued).toBe(1);
    scheduler.runAll(); // the first line's duration
    expect(bus.speaking).toBe(false);
    scheduler.runAll(); // the gap
    expect(bus.speaking).toBe(true);
    scheduler.runAll(); // the second line
    expect(bus.active).toBe(false);
    expect(ducker.ducked).toBe(0);
  });

  it("the silent fallback eases out too, so an interrupt is not a dead stop", () => {
    const scheduler = fakeScheduler();
    const bus = new VoiceBus({
      transport: silentTransport(scheduler.schedule),
      ducker: new CountingDucker(),
      schedule: scheduler.schedule,
    });
    bus.speak(line("outgoing"));
    bus.interrupt(line("incoming"));
    expect(bus.speaking).toBe(false);
    scheduler.runAll();
    expect(bus.speaking).toBe(true);
    expect(bus.history().map((l) => l.text)).toEqual(["outgoing", "incoming"]);
  });

  it("a bus with no scheduler still serialises - it just has no gap", () => {
    // The degradation has to be "no pause", never "overlap".
    const port = new FakeSpeechPort();
    const bus = new VoiceBus({
      transport: webSpeechTransport(port, "mac", "en-US"),
      ducker: new CountingDucker(),
    });
    bus.speak(line("first"));
    bus.speak(line("second"));
    expect(port.requests.length).toBe(1);
    port.finishLast();
    expect(port.requests.map((r) => r.text)).toEqual(["first", "second"]);
  });

  it("a scheduler-less transport takes the cut immediately rather than hanging", () => {
    const port = new FakeSpeechPort();
    const bus = new VoiceBus({
      transport: webSpeechTransport(port, "mac", "en-US"),
      ducker: new CountingDucker(),
    });
    bus.speak(line("outgoing"));
    bus.interrupt(line("incoming"));
    expect(port.cancels).toBe(1);
    expect(port.requests.map((r) => r.text)).toEqual(["outgoing", "incoming"]);
  });

  it("the DOM adapter wires onboundary, which is what makes the ease possible", () => {
    const spoken: Record<string, unknown>[] = [];
    let boundaries = 0;
    const port = webSpeechPort(
      {
        getVoices: () => [{ name: "Samantha", lang: "en-US", localService: true, default: true }],
        speak: (u) => spoken.push(u as Record<string, unknown>),
        cancel: () => undefined,
      },
      class {
        voice: unknown = null;
        lang = "";
        rate = 1;
        pitch = 1;
        volume = 1;
        onend: unknown = null;
        onerror: unknown = null;
        onboundary: unknown = null;
        constructor(readonly text: string) {}
      },
    );
    port?.speak({
      text: "two words",
      voiceName: "Samantha",
      lang: "en-US",
      rate: 1,
      pitch: 1,
      volume: 1,
      onEnd: () => undefined,
      onError: () => undefined,
      onBoundary: () => {
        boundaries += 1;
      },
    });
    const utterance = spoken[0] as { onboundary: () => void; onend: () => void };
    utterance.onboundary();
    utterance.onboundary();
    expect(boundaries).toBe(2);
    // A boundary reported after the line ended belongs to nothing.
    utterance.onend();
    utterance.onboundary();
    expect(boundaries).toBe(2);
  });
});

describe("AC-21.6: coach notes are spoken AFTER the text renders", () => {
  const note = { note: "Nice work on 'through'. Try 'because' slowly next time." };

  const busWith = (port: FakeSpeechPort): VoiceBus =>
    new VoiceBus({
      transport: webSpeechTransport(port, "mac", "en-US"),
      ducker: new CountingDucker(),
    });

  it("AC-21.6: the text renders first and the speech follows", () => {
    const port = new FakeSpeechPort();
    const events: string[] = [];
    const result = speakCoachNote(
      note,
      (display) => events.push(`text:${display.text}`),
      busWith(port),
    );
    events.push(`speech:${port.last?.text ?? ""}`);

    expect(result.order).toEqual(["text", "speech"]);
    expect(events[0]).toContain("text:");
    expect(events[1]).toContain("speech:");
    expect(result.spoke).toBe(true);
  });

  it("AC-21.6: the display is IDENTICAL with and without speech", () => {
    const withSpeech = speakCoachNote(note, () => undefined, busWith(new FakeSpeechPort()));
    const withoutSpeech = speakCoachNote(note, () => undefined, null);
    expect(withSpeech.display).toEqual(withoutSpeech.display);
    expect(JSON.stringify(withSpeech.display)).toBe(JSON.stringify(withoutSpeech.display));
    expect(withoutSpeech.spoke).toBe(false);
    expect(withoutSpeech.order).toEqual(["text"]);
  });

  it("AC-21.6: the display carries the text and NOTHING a renderer could branch on", () => {
    // The cheapest way to guarantee an identical display is to hand the
    // renderer nothing about the audio at all.
    expect(Object.keys(coachNoteDisplay(note))).toEqual(["text"]);
    expect(coachNoteDisplay(note).text).toBe(note.note);
  });

  it("AC-21.6: the text is still the source of truth if speech is impossible", () => {
    const scheduler = fakeScheduler();
    const silentBus = new VoiceBus({
      transport: silentTransport(scheduler.schedule),
      ducker: new CountingDucker(),
    });
    const rendered: string[] = [];
    const result = speakCoachNote(note, (d) => rendered.push(d.text), silentBus);
    expect(rendered).toEqual([note.note]);
    expect(result.display.text).toBe(note.note);
  });

  it("AC-21.6: an empty note renders and simply says nothing", () => {
    const port = new FakeSpeechPort();
    const result = speakCoachNote({ note: "   " }, () => undefined, busWith(port));
    expect(result.spoke).toBe(false);
    expect(port.requests.length).toBe(0);
    expect(result.order).toEqual(["text"]);
  });

  it("AC-21.6: the spoken line is tagged as a coach note, with a stable id", () => {
    const port = new FakeSpeechPort();
    const bus = busWith(port);
    speakCoachNote(note, () => undefined, bus, "mars.coach");
    expect(bus.history()[0]?.kind).toBe("coachNote");
    expect(bus.history()[0]?.id).toBe("mars.coach");
  });
});

describe("AC-21.5 / AC-21.7: zero network TTS at runtime, confined to one module", () => {
  /**
   * Comments are stripped before scanning. "ElevenLabs" is discussed at length
   * in the doc comments - that is the plan being recorded, and a check that
   * cannot tell prose from a call would push those comments out of the code,
   * which is a worse outcome than the check is worth.
   */
  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

  const audioSources = (): Array<{ file: string; source: string }> =>
    readdirSync(AUDIO_SRC)
      .filter((f) => f.endsWith(".ts"))
      .map((file) => ({
        file,
        source: stripComments(readFileSync(join(AUDIO_SRC, file), "utf8")),
      }));

  it("AC-21.5: the injected fetch probe is never called by the voice path", () => {
    const { env, probe, speech } = fakeVoiceEnvironment();
    const transport = createVoiceTransport(env);
    const bus = new VoiceBus({ transport, ducker: new CountingDucker() });
    for (let i = 0; i < 25; i++) {
      bus.speak(line(`line ${i}`));
      speech!.finishLast();
    }
    speakCoachNote({ note: "A coach note." }, () => undefined, bus);
    speech!.finishLast();
    expect(probe.calls).toBe(0);
  });

  it("AC-21.5: no file in src/game/audio even names a network API", () => {
    // The probe proves nothing CALLS the injected fetch. This proves nothing
    // reaches around it for a global one, or for a TTS endpoint.
    const banned = [
      /\bfetch\s*\(/,
      /XMLHttpRequest/,
      /\bWebSocket\b/,
      /https?:\/\//,
      /elevenlabs/i,
      /\bEventSource\b/,
    ];
    const offences: string[] = [];
    for (const { file, source } of audioSources()) {
      for (const pattern of banned) {
        if (pattern.test(source)) offences.push(`${file} matches ${String(pattern)}`);
      }
    }
    expect(offences).toEqual([]);
  });

  it("AC-21.7: voice.ts is the ONLY module that names the Web Speech API", () => {
    // D88's whole promise is that swapping to pre-rendered files is one module.
    // If a scene or a sibling reached for speechSynthesis directly, that
    // promise would already be broken and this test is how we find out.
    const speechApi = /speechSynthesis|SpeechSynthesisUtterance/;
    const named = audioSources()
      .filter(({ source }) => speechApi.test(source))
      .map(({ file }) => file);
    expect(named).toEqual(["voice.ts"]);
  });

  it("AC-21.7: nothing outside src/game/audio touches speech synthesis either", () => {
    const walk = (dir: string, out: string[] = []): string[] => {
      if (!existsSync(dir)) return out;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path, out);
        else if (path.endsWith(".ts")) out.push(path);
      }
      return out;
    };
    const offenders = walk(join(process.cwd(), "src"))
      .filter((p) => !p.startsWith(AUDIO_SRC))
      .filter((p) => /speechSynthesis|SpeechSynthesisUtterance/.test(readFileSync(p, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("AC-21.7: the whole voice path works with no ElevenLabs key present", () => {
    // Nothing in the environment carries a key, and the path still produces a
    // ducked, timed, spoken coach note. That is D88's stand-in, complete.
    expect(process.env["ELEVENLABS_API_KEY"] ?? "").toBe("");
    const { env, speech } = fakeVoiceEnvironment();
    const ducker = new CountingDucker();
    const bus = new VoiceBus({ transport: createVoiceTransport(env), ducker });
    const result = speakCoachNote({ note: "Beacon lit." }, () => undefined, bus);
    expect(bus.transportId).toBe("webspeech");
    expect(ducker.active).toBe(true);
    expect(result.order).toEqual(["text", "speech"]);
    speech!.finishLast();
    expect(ducker.active).toBe(false);
  });
});

describe("the DOM adapter", () => {
  it("returns null when the browser has no speech synthesis", () => {
    expect(webSpeechPort(null, null)).toBe(null);
    expect(browserSpeechPort({})).toBe(null);
    expect(browserSpeechPort(null)).toBe(null);
    expect(browserSpeechPort("not an object")).toBe(null);
  });

  it("maps voices and utterances onto the real API", () => {
    const spoken: Array<Record<string, unknown>> = [];
    let cancelled = 0;
    const synthesis = {
      getVoices: () => [
        { name: "Samantha", lang: "en-US", localService: true, default: true },
        { name: "Alex", lang: "en-US", localService: true, default: false },
      ],
      speak: (u: unknown) => spoken.push(u as Record<string, unknown>),
      cancel: () => (cancelled += 1),
    };
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

    const port = browserSpeechPort({ speechSynthesis: synthesis, SpeechSynthesisUtterance: Utterance });
    expect(port).not.toBe(null);
    expect(port!.voices().map((v) => v.name)).toEqual(["Samantha", "Alex"]);

    let ended = 0;
    port!.speak({
      text: "hello",
      voiceName: "Alex",
      lang: "en-US",
      rate: 99,
      pitch: -3,
      volume: 4,
      onEnd: () => (ended += 1),
      onError: () => (ended += 1),
    });
    const utterance = spoken[0]!;
    expect(utterance["text"]).toBe("hello");
    expect((utterance["voice"] as { name: string }).name).toBe("Alex");
    // Out-of-range delivery values are clamped to what the API accepts.
    expect(utterance["rate"]).toBe(10);
    expect(utterance["pitch"]).toBe(0);
    expect(utterance["volume"]).toBe(1);

    (utterance["onend"] as () => void)();
    (utterance["onend"] as () => void)();
    (utterance["onerror"] as () => void)();
    expect(ended).toBe(1);

    port!.cancel();
    expect(cancelled).toBe(1);
  });

  it("leaves the voice unset when the requested name is gone", () => {
    const spoken: Array<Record<string, unknown>> = [];
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
    const port = browserSpeechPort({
      speechSynthesis: {
        getVoices: () => [],
        speak: (u: unknown) => spoken.push(u as Record<string, unknown>),
        cancel: () => undefined,
      },
      SpeechSynthesisUtterance: Utterance,
    });
    port!.speak({
      text: "x",
      voiceName: "Nobody",
      lang: "en-US",
      rate: 1,
      pitch: 1,
      volume: 1,
      onEnd: () => undefined,
      onError: () => undefined,
    });
    expect(spoken[0]!["voice"]).toBe(null);
    (spoken[0]!["onerror"] as () => void)();
  });
});


// ---------------------------------------------------------------------------
// The mute-game regression (2026-09)
// ---------------------------------------------------------------------------

/**
 * A speech port whose voice list ARRIVES LATE, which is the one thing the
 * existing `FakeSpeechPort` cannot do and the one thing the real platform
 * always does.
 *
 * Chrome returns `[]` from `getVoices()` until it has loaded the list and fired
 * `voiceschanged`. Every fake in this suite answered synchronously, so every
 * test passed while the shipped game was mute - the graph asked "are there
 * voices" exactly once, at boot, inside that empty window, and cached "no"
 * for the session.
 */
class LateSpeechPort implements SpeechPort {
  readonly requests: SpeakRequest[] = [];
  cancels = 0;
  private list: readonly SpeechVoiceLike[] = [];

  constructor(private readonly eventual: readonly SpeechVoiceLike[]) {}

  /** The platform finishes loading. Nothing else is told. */
  load(): void {
    this.list = this.eventual;
  }

  voices(): readonly SpeechVoiceLike[] {
    return this.list;
  }

  speak(request: SpeakRequest): void {
    this.requests.push(request);
  }

  cancel(): void {
    this.cancels += 1;
  }

  get last(): SpeakRequest | undefined {
    return this.requests[this.requests.length - 1];
  }
}

describe("AC-21.5: the transport is chosen per line, not once at boot", () => {
  it("AC-21.5: a voice list that arrives after construction is still used", () => {
    const port = new LateSpeechPort(MAC_VOICES);
    const scheduler = fakeScheduler();
    const transport = adaptiveTransport({
      speech: port,
      platform: "mac",
      lang: "en-US",
      schedule: scheduler.schedule,
    });

    // Boot: no voices yet. Silence is the honest answer, and a line still
    // takes the time it would have taken.
    expect(transport.id).toBe("silent");
    transport.speak(line("early"), () => undefined);
    expect(port.requests.length).toBe(0);

    // The platform loads. Nothing is rebuilt, nothing is re-injected.
    port.load();

    // THE FIX: the next line goes to the platform. Before it, this stayed
    // "silent" for the life of the session.
    expect(transport.id).toBe("webspeech");
    transport.speak(line("later"), () => undefined);
    expect(port.requests.length).toBe(1);
    expect(port.last?.text).toBe("later");
    expect(port.last?.voiceName).toBe("Samantha");
  });

  it("AC-21.5: a cloud-only machine is never spoken through, and chirps", () => {
    // Every voice here is rendered on a server. Speaking through one would be
    // the runtime network TTS call AC-21.5 forbids - so the transport refuses
    // it, and the line degrades to a chirp rather than to nothing at all.
    const cloudOnly: SpeechVoiceLike[] = [
      { name: "Google US English", lang: "en-US", localService: false, default: true },
      { name: "Microsoft Aria Online (Natural)", lang: "en-US", localService: false },
    ];
    expect(selectVoice(cloudOnly, "other", "en-US")?.name).toBe("Google US English");
    // ...and the TRANSPORT's question has a different answer to the SELECTOR's.
    expect(localVoiceFor(cloudOnly, "other", "en-US")).toBe(null);

    const port = new FakeSpeechPort(cloudOnly);
    const scheduler = fakeScheduler();
    let chirps = 0;
    const transport = adaptiveTransport({
      speech: port,
      platform: "other",
      lang: "en-US",
      schedule: scheduler.schedule,
      chirp: () => (chirps += 1),
    });

    expect(transport.id).toBe("silent");
    let done = 0;
    transport.speak(line("Mars ahead."), () => (done += 1));

    expect(port.requests.length).toBe(0);
    expect(chirps).toBe(1);
    // And the line still takes its time, so ducking and pacing are unchanged.
    expect(done).toBe(0);
    scheduler.runAll();
    expect(done).toBe(1);
  });

  it("AC-21.5: a browser with no speech API at all stays quiet, without chirping", () => {
    // A player who never had a voice must not gain a new sound on every line
    // Shadow says. The chirp is for a voice we DECLINED, not for a platform
    // that never offered one.
    const scheduler = fakeScheduler();
    let chirps = 0;
    const transport = adaptiveTransport({
      speech: null,
      platform: "other",
      lang: "en-US",
      schedule: scheduler.schedule,
      chirp: () => (chirps += 1),
    });

    expect(transport.id).toBe("silent");
    transport.speak(line(), () => undefined);
    expect(chirps).toBe(0);
  });

  it("AC-21.5: a refused utterance chirps rather than vanishing", () => {
    // Chrome has blocked `speechSynthesis.speak()` without user activation
    // since M71 and reports it through `onerror`. Without this the line looks
    // spoken and is not.
    const port = new FakeSpeechPort(MAC_VOICES);
    let chirps = 0;
    const transport = webSpeechTransport(port, "mac", "en-US", {
      onRefused: () => (chirps += 1),
    });

    let done = 0;
    transport.speak(line("Course locked."), () => (done += 1));
    expect(chirps).toBe(0);
    port.failLast();
    expect(chirps).toBe(1);
    expect(done).toBe(1);
  });

  it("AC-21.5: the DOM adapter warms the voice list and listens for changes", () => {
    // The adapter asks once at construction, because on Chrome that CALL is
    // what starts the load, and subscribes so a list that changes mid-session
    // (a headset, an OS voice download) is picked up.
    let asks = 0;
    const listeners: string[] = [];
    const synthesis = {
      getVoices: () => {
        asks += 1;
        return [];
      },
      speak: () => undefined,
      cancel: () => undefined,
      addEventListener: (type: string) => listeners.push(type),
    };
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

    browserSpeechPort({ speechSynthesis: synthesis, SpeechSynthesisUtterance: Utterance });
    expect(asks).toBeGreaterThanOrEqual(1);
    expect(listeners).toContain("voiceschanged");
  });

  it("AC-21.5: an adapter on a browser that refuses either call still binds", () => {
    // A locked-down browser is a quieter game, never a failed boot.
    const synthesis = {
      getVoices: () => {
        throw new Error("blocked");
      },
      speak: () => undefined,
      cancel: () => undefined,
    };
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
    expect(() =>
      browserSpeechPort({ speechSynthesis: synthesis, SpeechSynthesisUtterance: Utterance }),
    ).not.toThrow();
  });
});
