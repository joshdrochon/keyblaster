/**
 * Fakes for the audio lane.
 *
 * There is no `AudioContext` here: the audio package's own `NullAudioContext`
 * is the recording context, and it ships in src because it is also the runtime
 * fallback when a browser refuses to give us audio. What IS faked here is the
 * platform's SPEECH, because voice selection is a decision (AC-21.5) and a
 * decision needs inputs a test can vary.
 */

import type { CancelTimer, SpeakRequest, SpeechPort, SpeechVoiceLike, VoiceEnvironment } from "../../../src/game/audio/voice.js";
import { countingFetchProbe, type ProbeFetch } from "../../../src/game/audio/evidence.js";

/**
 * A realistic macOS voice list, including the CLOUD voice Chrome injects.
 * "Google US English" is rendered on Google's servers, so AC-21.5 requires the
 * selector to skip it; leaving it in the fixture is the only way that rule is
 * actually exercised.
 */
export const MAC_VOICES: readonly SpeechVoiceLike[] = [
  { name: "Google US English", lang: "en-US", localService: false, default: true },
  { name: "Alex", lang: "en-US", localService: true },
  { name: "Samantha", lang: "en-US", localService: true },
  { name: "Daniel", lang: "en-GB", localService: true },
  { name: "Monica", lang: "es-ES", localService: true },
];

/** Windows, with the Edge cloud voice that must also be skipped. */
export const WINDOWS_VOICES: readonly SpeechVoiceLike[] = [
  { name: "Microsoft Aria Online (Natural) - English (United States)", lang: "en-US", localService: false },
  { name: "Microsoft David Desktop - English (United States)", lang: "en-US", localService: true },
  { name: "Microsoft Zira Desktop - English (United States)", lang: "en-US", localService: true, default: true },
];

export const LINUX_VOICES: readonly SpeechVoiceLike[] = [
  { name: "English (Great Britain)", lang: "en-GB", localService: true },
  { name: "English (America)", lang: "en-US", localService: true },
];

/** Records what was asked for and only finishes when the test says so. */
export class FakeSpeechPort implements SpeechPort {
  readonly requests: SpeakRequest[] = [];
  cancels = 0;

  constructor(private readonly voiceList: readonly SpeechVoiceLike[] = MAC_VOICES) {}

  voices(): readonly SpeechVoiceLike[] {
    return this.voiceList;
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

  /** The platform finished speaking the most recent line. */
  finishLast(): void {
    this.last?.onEnd();
  }

  /** The platform refused the most recent line. */
  failLast(): void {
    this.last?.onError();
  }
}

export interface FakeScheduler {
  schedule: (callback: () => void, delayMs: number) => CancelTimer;
  runAll: () => void;
  readonly pending: number;
}

export function fakeScheduler(): FakeScheduler {
  let tasks: Array<{ callback: () => void; cancelled: boolean }> = [];
  return {
    schedule(callback) {
      const task = { callback, cancelled: false };
      tasks.push(task);
      return () => {
        task.cancelled = true;
      };
    },
    runAll() {
      const due = tasks;
      tasks = [];
      for (const task of due) if (!task.cancelled) task.callback();
    },
    get pending() {
      return tasks.filter((t) => !t.cancelled).length;
    },
  };
}

export interface FakeVoiceEnvironment {
  readonly env: VoiceEnvironment;
  readonly speech: FakeSpeechPort | null;
  readonly scheduler: FakeScheduler;
  readonly probe: ProbeFetch;
}

/**
 * A voice environment with a working system voice, a fake clock and a fetch
 * probe. The probe is the AC-21.5 network assertion: it is handed to the voice
 * path precisely so a test can prove nothing ever calls it.
 */
export function fakeVoiceEnvironment(
  voices: readonly SpeechVoiceLike[] | null = MAC_VOICES,
  platform: VoiceEnvironment["platform"] = "mac",
  lang = "en-US",
): FakeVoiceEnvironment {
  const speech = voices === null ? null : new FakeSpeechPort(voices);
  const scheduler = fakeScheduler();
  const probe = countingFetchProbe();
  return {
    env: { speech, platform, lang, schedule: scheduler.schedule, fetch: probe },
    speech,
    scheduler,
    probe,
  };
}
