/**
 * Shadow's voice (D88, D63, PRD FR-21 / AC-21.5, AC-21.6, AC-21.7).
 *
 * ================== THE ONE MODULE (D88) ==================
 * D88: "System voice (Web Speech API) is the stand-in so the voice path (bus,
 * ducking, timing, spoken coach notes) is built and tested before the key
 * exists; swapping is one module."
 *
 * THIS IS THAT MODULE. The rest of the game - every scene, graph.ts, the
 * ducker, the coach-note path - talks to `VoiceBus` and `VoiceTransport` and
 * knows nothing about how a line becomes sound. Adding ElevenLabs later is:
 *
 *   1. write `preRenderedTransport(...)` next to `webSpeechTransport(...)`
 *   2. return it from `createVoiceTransport` when the manifest is present
 *
 * No other file in the repo changes. AC-21.7's "module boundary test" asserts
 * exactly that by scanning src/game/audio: no sibling may mention speech
 * synthesis. If a scene ever reaches for `speechSynthesis` directly, that test
 * goes red, which is the point of having it.
 *
 * ================== ZERO NETWORK TTS (AC-21.5) ==================
 * Nothing in this file fetches. Two independent checks keep it that way:
 *   - a fetch probe is injected into the environment and asserted never called
 *   - a static scan of src/game/audio asserts no network API is even named
 * Both feed `runtimeTtsNetworkCalls` in the evidence artifact.
 *
 * There is a subtler leak the probe would miss: several platforms expose CLOUD
 * voices through the same Web Speech API (Chrome's "Google ..." voices, Edge's
 * "... Online (Natural)"). Speaking through one of those is a network TTS call
 * made by the browser on our behalf. `selectVoice` prefers local voices, and
 * `localVoiceFor` - which is what the TRANSPORT asks - refuses a remote one
 * outright. A machine offering nothing but cloud voices gets no speech, and
 * `adaptiveTransport` turns that into a chirp rather than into silence.
 *
 * ================== WHY IT WAS MUTE (the 2026-09 fix) ==================
 * Every piece of this was correct and the game still said nothing, because the
 * DECISION WAS MADE TOO EARLY. `createVoiceTransport` ran once, inside
 * `buildAudioGraph`, during boot. On Chrome `speechSynthesis.getVoices()`
 * returns an EMPTY ARRAY until the platform has loaded its voice list and
 * fired `voiceschanged`, which happens some milliseconds after boot. So
 * `webSpeechTransport.available()` was false at exactly the one moment anybody
 * asked, the graph captured `silentTransport` forever, and every line Shadow
 * ever spoke went to a `setTimeout`.
 *
 * The fix is `adaptiveTransport`: the choice is re-made on EVERY LINE, from the
 * voice list as it is at that moment. A transport picked once at boot is a
 * transport picked from an empty list.
 *
 * Two smaller mutes are handled in the same place:
 *   - Chrome refuses `speak()` before a user gesture (M71+). That surfaces as
 *     `onerror`, so a refused utterance now chirps instead of vanishing.
 *   - `browserSpeechPort` warms the list on construction and re-reads it on
 *     `voiceschanged`, so the list is loaded long before the first line.
 *
 * ================== NOTHING READS AS FAILURE (D31) ==================
 * Shadow never says a line because the player got something wrong; this module
 * only speaks what it is handed. The one rule it enforces itself is AC-21.6:
 * the TEXT is the source of truth and is rendered FIRST, always. Speech is an
 * enhancement layered on top, and the display is byte-identical either way.
 */

import { clamp } from "./context.js";

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/** The slice of `SpeechSynthesisVoice` a choice is made from. */
export interface SpeechVoiceLike {
  readonly name: string;
  readonly lang: string;
  /**
   * False means the browser renders this voice on a SERVER. AC-21.5 makes that
   * disqualifying whenever a local voice exists.
   */
  readonly localService: boolean;
  readonly default?: boolean;
}

/** One request to speak. Our shape, not the DOM's - see `webSpeechPort`. */
export interface SpeakRequest {
  readonly text: string;
  /** Name of the chosen voice, or null to accept the platform default. */
  readonly voiceName: string | null;
  readonly lang: string;
  readonly rate: number;
  readonly pitch: number;
  readonly volume: number;
  readonly onEnd: () => void;
  /** Called instead of `onEnd` if the platform refuses the utterance. */
  readonly onError: () => void;
}

/**
 * The injected speech port. Deliberately OUR interface rather than the DOM's:
 * a fake is six lines, and no module below this one has to know that
 * `SpeechSynthesisUtterance` is a constructor with event handler properties.
 */
export interface SpeechPort {
  voices(): readonly SpeechVoiceLike[];
  speak(request: SpeakRequest): void;
  cancel(): void;
}

/** Cancels a pending callback. Calling it twice must be harmless. */
export type CancelTimer = () => void;
/** Injected timer, same reasoning as persistence's `Clock`: no real waiting. */
export type Scheduler = (callback: () => void, delayMs: number) => CancelTimer;

/**
 * A `fetch`-shaped hole, injected ONLY so a test can prove it is never used.
 * Nothing in this module calls it. That is the assertion.
 */
export type FetchProbe = (...args: unknown[]) => unknown;

export type Platform = "mac" | "windows" | "linux" | "other";

export interface VoiceEnvironment {
  /** null on a platform with no Web Speech API at all. */
  readonly speech: SpeechPort | null;
  readonly platform: Platform;
  /** BCP-47 tag for the content language (D45). */
  readonly lang: string;
  readonly schedule: Scheduler;
  readonly fetch?: FetchProbe;
  /**
   * Shadow's stand-in when the platform HAS a voice API but we will not use it
   * - the machine offers only cloud voices (AC-21.5 forbids those), or the
   * browser refused the utterance. A small sound is not a voice, but it says
   * "he said something", and that is strictly better than a screen where the
   * character's mouth moves in silence.
   *
   * `graph.ts` wires this to the SFX bus. Optional, so nothing below this
   * module has to have one.
   */
  readonly chirp?: () => void;
}

// ---------------------------------------------------------------------------
// Voice selection (AC-21.5: "per-platform voice preference list and fallback")
// ---------------------------------------------------------------------------

/**
 * Shadow reads calm, warm and unhurried - a companion, not a computer. These
 * lists are the LOCAL voices on each platform that land closest to that, best
 * first. Cloud voices are deliberately absent: see the header.
 */
export const VOICE_PREFERENCES: Readonly<Record<Platform, readonly string[]>> = Object.freeze({
  // macOS ships high quality local voices; Samantha is the warmest of the set.
  mac: ["Samantha", "Ava", "Allison", "Susan", "Karen", "Moira", "Daniel", "Alex"],
  // "Desktop" voices are the local SAPI ones. The Online/Natural voices are
  // rendered on a server, so they are not listed and are filtered out anyway.
  windows: [
    "Microsoft Zira Desktop",
    "Microsoft Zira",
    "Microsoft Hazel Desktop",
    "Microsoft David Desktop",
    "Microsoft David",
    "Microsoft Mark",
  ],
  // Desktop Linux is espeak-ng in practice, via speech-dispatcher.
  linux: ["English (America)", "English (Great Britain)", "espeak", "default"],
  other: [],
});

/** Base language of a BCP-47 tag: "en-GB" -> "en". */
const baseLang = (tag: string): string => (tag.split("-")[0] ?? tag).toLowerCase();

export function detectPlatform(userAgent: string, platformHint = ""): Platform {
  const s = `${userAgent} ${platformHint}`.toLowerCase();
  if (/mac|iphone|ipad|darwin/.test(s)) return "mac";
  if (/win/.test(s)) return "windows";
  if (/linux|x11|cros|android/.test(s)) return "linux";
  return "other";
}

/**
 * Pick a voice. Pure: a list in, a voice or null out. The order below is the
 * whole policy, and each step exists for a reason:
 *
 *   1. language first - a warm voice reading Spanish in English is worse than
 *      a plain voice reading it correctly (D45 ships three content languages)
 *   2. LOCAL only, if any local voice exists (AC-21.5, no network TTS)
 *   3. the platform preference list, in order
 *   4. the platform's own default
 *   5. anything at all
 *   6. null -> the caller falls back to silent, and the text still renders
 */
export function selectVoice(
  voices: readonly SpeechVoiceLike[],
  platform: Platform,
  lang: string,
): SpeechVoiceLike | null {
  if (voices.length === 0) return null;

  const wanted = baseLang(lang);
  const sameLang = voices.filter((v) => baseLang(v.lang) === wanted);
  let candidates = sameLang.length > 0 ? sameLang : voices.slice();

  const local = candidates.filter((v) => v.localService);
  if (local.length > 0) candidates = local;

  const preferences = VOICE_PREFERENCES[platform];
  for (const name of preferences) {
    const match = candidates.find((v) => v.name.toLowerCase().includes(name.toLowerCase()));
    if (match) return match;
  }

  return candidates.find((v) => v.default === true) ?? candidates[0] ?? null;
}

/**
 * The voice a TRANSPORT is allowed to speak through: `selectVoice`'s choice,
 * but only if it is rendered on this machine.
 *
 * `selectVoice` answers "which of these is the best voice for Shadow", and it
 * will name a cloud voice if that is all there is. This answers the different
 * question the transport actually has - "may I speak at all" - and AC-21.5's
 * answer for a cloud voice is no, whatever the alternative is. Speaking through
 * Chrome's "Google US English" is a runtime network TTS call; the fact that it
 * is the browser making it rather than us does not change what it is.
 *
 * Null here is not a failure. It routes the line to the chirp (see
 * `adaptiveTransport`), which is the degradation AC-21.5 asks for.
 */
export function localVoiceFor(
  voices: readonly SpeechVoiceLike[],
  platform: Platform,
  lang: string,
): SpeechVoiceLike | null {
  const choice = selectVoice(voices, platform, lang);
  return choice !== null && choice.localService ? choice : null;
}

// ---------------------------------------------------------------------------
// Lines and timing
// ---------------------------------------------------------------------------

/**
 * `scripted` lines are the ones ElevenLabs pre-renders when the key lands
 * (D63/D88); `coachNote` is runtime LLM text and stays system voice (D88's
 * recorded lean). The transport is free to treat them differently; nothing
 * above the transport needs to know that it does.
 */
export type VoiceLineKind = "scripted" | "coachNote";

export interface VoiceLine {
  /** Stable id, e.g. "mars.briefing.1". The pre-rendered manifest key. */
  readonly id: string;
  readonly text: string;
  readonly kind: VoiceLineKind;
}

/** Shadow's delivery. Slightly slow and slightly low: calm, never breathless. */
export const VOICE_DELIVERY = Object.freeze({ rate: 0.95, pitch: 1.0, volume: 1.0 });

/** Words per minute at rate 1.0. Used to time the duck when nothing speaks. */
export const SPEECH_WPM = 150;

/**
 * How long a line takes to say. Needed by the silent fallback so that ducking,
 * pacing and the "Shadow is talking" beat are IDENTICAL with and without a
 * voice - which is what makes the fallback a fallback rather than a different
 * game.
 */
export function estimateSpeechMs(text: string, rate: number = VOICE_DELIVERY.rate): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
  const ms = (words / SPEECH_WPM) * 60000 / safeRate;
  return Math.max(350, Math.round(ms));
}

// ---------------------------------------------------------------------------
// Transports - the swap point
// ---------------------------------------------------------------------------

export type VoiceTransportId = "webspeech" | "prerendered" | "silent";

export interface VoiceTransport {
  readonly id: VoiceTransportId;
  /** Can this transport actually produce sound right now? */
  available(): boolean;
  /** Speak, then call `onDone` exactly once - on success, error or cancel. */
  speak(line: VoiceLine, onDone: () => void): void;
  cancel(): void;
}

export interface WebSpeechOptions {
  /**
   * The platform REFUSED the utterance. Chrome has blocked
   * `speechSynthesis.speak()` without user activation since M71, and it reports
   * that through `onerror` rather than by throwing - so without this hook a
   * blocked line is indistinguishable from a spoken one and the game looks
   * fine while being mute. The line is still released either way.
   */
  readonly onRefused?: () => void;
}

/**
 * The D88 stand-in: the platform's own LOCAL voice, chosen from the preference
 * list. Zero bytes downloaded, zero network calls.
 *
 * `available()` is "is there a voice on this machine I am allowed to use", not
 * "does the platform list any voices at all". Those differ in the two cases
 * that matter: a machine with only cloud voices (AC-21.5 says no), and a Chrome
 * that has not finished loading its list yet (the answer is no NOW and yes in
 * a moment, which is why `adaptiveTransport` asks again every line).
 */
export function webSpeechTransport(
  port: SpeechPort,
  platform: Platform,
  lang: string,
  options: WebSpeechOptions = {},
): VoiceTransport {
  let done: (() => void) | null = null;

  const finish = (): void => {
    const cb = done;
    done = null;
    if (cb) cb();
  };

  return {
    id: "webspeech",
    available: () => localVoiceFor(port.voices(), platform, lang) !== null,
    speak(line, onDone) {
      finish();
      done = onDone;
      const voice = localVoiceFor(port.voices(), platform, lang);
      if (voice === null) {
        // No LOCAL voice. Handing the platform `voiceName: null` here would be
        // the leak: it would fall back to its own default, and on a cloud-only
        // machine that default is the cloud voice AC-21.5 forbids.
        options.onRefused?.();
        finish();
        return;
      }
      port.speak({
        text: line.text,
        voiceName: voice.name,
        lang,
        rate: VOICE_DELIVERY.rate,
        pitch: VOICE_DELIVERY.pitch,
        volume: VOICE_DELIVERY.volume,
        onEnd: finish,
        onError: () => {
          options.onRefused?.();
          finish();
        },
      });
    },
    cancel() {
      port.cancel();
      finish();
    },
  };
}

/**
 * The fallback (AC-21.5: "and fallback"). No speech synthesis, no voices, or a
 * platform that refuses: the line still takes the time it would have taken, so
 * the duck, the pacing and the coach-note beat are unchanged. The player
 * without a system voice gets a quieter game, not a broken one.
 */
export function silentTransport(schedule: Scheduler): VoiceTransport {
  let cancelTimer: CancelTimer | null = null;

  const clear = (): void => {
    const c = cancelTimer;
    cancelTimer = null;
    if (c) c();
  };

  return {
    id: "silent",
    available: () => true,
    speak(line, onDone) {
      clear();
      cancelTimer = schedule(() => {
        cancelTimer = null;
        onDone();
      }, estimateSpeechMs(line.text));
    },
    cancel() {
      clear();
    },
  };
}

/**
 * Web Speech when a local voice is available AT THIS MOMENT, the silent
 * fallback when it is not - decided per line, never once at boot.
 *
 * THIS IS THE FIX FOR THE MUTE GAME. The old code asked `available()` a single
 * time, inside `buildAudioGraph`, during boot. Chrome's voice list is empty
 * until `voiceschanged` fires a few milliseconds later, so the answer was
 * always "no voices" and the graph held a silent transport for the rest of the
 * session - on a machine with eight perfectly good local voices.
 *
 * `id` is a getter for the same reason: the evidence artifact reads
 * `voice.transportId`, and a field frozen at construction would report "silent"
 * on a machine that is, right now, speaking.
 *
 * WHEN THE LINE IS NOT VOICED, IT CHIRPS - but only when the platform HAS a
 * speech API and we declined to use it (no local voice, or a refused
 * utterance). A browser with no speech synthesis at all keeps the original
 * quiet fallback: a chirp there would be a new sound on every Shadow line for
 * a player who never had a voice to lose.
 */
export function adaptiveTransport(env: VoiceEnvironment): VoiceTransport {
  const silent = silentTransport(env.schedule);
  const web =
    env.speech === null
      ? null
      : webSpeechTransport(env.speech, env.platform, env.lang, {
          onRefused: () => env.chirp?.(),
        });

  const pick = (): VoiceTransport => (web !== null && web.available() ? web : silent);
  let active: VoiceTransport = silent;

  return {
    get id(): VoiceTransportId {
      return pick().id;
    },
    // The composite can always take a line: worst case it takes the time the
    // line would have taken and makes a small sound.
    available: () => true,
    speak(line, onDone) {
      const next = pick();
      if (next !== active) active.cancel();
      active = next;
      if (active === silent && web !== null) env.chirp?.();
      active.speak(line, onDone);
    },
    cancel() {
      active.cancel();
    },
  };
}

/**
 * THE SWAP FUNCTION (D88, AC-21.7). Today: `adaptiveTransport`. Tomorrow, when
 * `ELEVENLABS_API_KEY` has produced a manifest of pre-rendered files, one
 * branch is added here for `kind === "scripted"` and NOTHING outside this file
 * moves.
 */
export function createVoiceTransport(env: VoiceEnvironment): VoiceTransport {
  return adaptiveTransport(env);
}

// ---------------------------------------------------------------------------
// Ducking (AC-21.4)
// ---------------------------------------------------------------------------

/**
 * Architecture section 6: the Voice bus "sidechain ducks Music/Ambient -6 dB".
 * AC-21.4 requires AT LEAST 6 dB, so -6 exactly is the floor and the shipped
 * value. Anything shallower is a rubric failure, not a taste call.
 */
export const DUCK_DB = -6;

/** What the voice bus pushes on. graph.ts implements this over the two buses. */
export interface Ducker {
  duck(active: boolean): void;
}

// ---------------------------------------------------------------------------
// The voice bus
// ---------------------------------------------------------------------------

export interface VoiceBusOptions {
  readonly transport: VoiceTransport;
  readonly ducker: Ducker;
}

/**
 * Sequencing for Shadow. She never talks over herself: a new line cancels the
 * one in flight rather than queueing behind it, because a game line that
 * arrives two sentences late is worse than one that never arrives.
 */
export class VoiceBus {
  private speakingLine: VoiceLine | null = null;
  private readonly spokenLines: VoiceLine[] = [];
  /**
   * Bumped whenever a line stops for any reason. A transport that reports
   * `onDone` for a line we already abandoned carries a stale token and is
   * ignored - without which a cancel would release the duck twice and the
   * NEXT line would play over un-ducked music.
   */
  private token = 0;

  constructor(private readonly options: VoiceBusOptions) {}

  get transportId(): VoiceTransportId {
    return this.options.transport.id;
  }

  get speaking(): boolean {
    return this.speakingLine !== null;
  }

  /** Every line this bus has started, in order. Tests and evidence read it. */
  history(): readonly VoiceLine[] {
    return this.spokenLines;
  }

  speak(line: VoiceLine): void {
    this.stop();
    const token = ++this.token;
    this.speakingLine = line;
    this.spokenLines.push(line);
    this.options.ducker.duck(true);
    this.options.transport.speak(line, () => {
      if (token !== this.token) return;
      this.token++;
      this.speakingLine = null;
      this.options.ducker.duck(false);
    });
  }

  cancel(): void {
    this.stop();
  }

  /** Release whatever is speaking, exactly once. Safe when nothing is. */
  private stop(): void {
    if (!this.speakingLine) return;
    this.token++;
    this.speakingLine = null;
    this.options.transport.cancel();
    this.options.ducker.duck(false);
  }
}

// ---------------------------------------------------------------------------
// Coach notes (AC-21.6)
// ---------------------------------------------------------------------------

/** Anything with a note. `CoachPayload` from src/engine/coach satisfies it. */
export interface SpokenNote {
  readonly note: string;
}

/**
 * What the screen shows. It carries the TEXT AND NOTHING ELSE - no "spoken"
 * flag, no voice id, no duration - because AC-21.6 says the display must be
 * identical with or without speech, and the cheapest way to guarantee that is
 * to give the renderer nothing it could branch on.
 */
export interface CoachNoteDisplay {
  readonly text: string;
}

/** Pure. Same input, same display, forever, regardless of any audio state. */
export function coachNoteDisplay(note: SpokenNote): CoachNoteDisplay {
  return { text: note.note };
}

/** What actually happened, for tests. `order` is recorded, not declared. */
export interface CoachNoteSpeechResult {
  readonly display: CoachNoteDisplay;
  /** The real sequence of steps. AC-21.6 requires "text" before "speech". */
  readonly order: readonly ("text" | "speech")[];
  readonly spoke: boolean;
}

/**
 * AC-21.6: "Coach notes are spoken via system voice AFTER the text renders;
 * text remains the source of truth".
 *
 * The ordering is enforced structurally: `render` is called, and only then is
 * anything handed to the voice bus. There is no path through this function that
 * speaks first, and none that changes the display because speech happened -
 * so a note whose speech fails, or whose player has no voices at all, looks
 * exactly like one that was spoken.
 */
export function speakCoachNote(
  note: SpokenNote,
  render: (display: CoachNoteDisplay) => void,
  voice: VoiceBus | null,
  lineId = "coach.note",
): CoachNoteSpeechResult {
  const display = coachNoteDisplay(note);
  const order: Array<"text" | "speech"> = [];

  order.push("text");
  render(display);

  const text = display.text.trim();
  if (voice && text.length > 0) {
    order.push("speech");
    voice.speak({ id: lineId, text, kind: "coachNote" });
    return { display, order, spoke: true };
  }
  return { display, order, spoke: false };
}

// ---------------------------------------------------------------------------
// The DOM adapter - the only browser-touching code in src/game/audio
// ---------------------------------------------------------------------------

/** Minimal shape of the global the adapter needs. Kept local on purpose. */
interface SpeechSynthesisGlobal {
  getVoices(): Array<{ name: string; lang: string; localService: boolean; default: boolean }>;
  speak(utterance: unknown): void;
  cancel(): void;
  /** Present on every real implementation; absent on a minimal fake. */
  addEventListener?(type: string, listener: () => void): void;
}

interface UtteranceCtor {
  new (text: string): {
    voice: unknown;
    lang: string;
    rate: number;
    pitch: number;
    volume: number;
    onend: unknown;
    onerror: unknown;
  };
}

/**
 * Binds the port to the real Web Speech API. Returns null when the browser has
 * no speech synthesis, which is the signal `createVoiceTransport` uses to fall
 * back to silence.
 *
 * The two casts here are the entire cost of not modelling the DOM's event
 * handler types in our port, and they are confined to this function.
 */
export function webSpeechPort(
  synthesis: SpeechSynthesisGlobal | null | undefined,
  utteranceCtor: UtteranceCtor | null | undefined,
): SpeechPort | null {
  if (!synthesis || !utteranceCtor) return null;

  // WARM THE LIST. On Chrome the first `getVoices()` returns [] and STARTS the
  // load; the real list arrives with `voiceschanged`. Asking once here, at
  // boot, means the list is populated long before the first line - and the
  // subscription exists so that a platform which swaps voices mid-session
  // (a Bluetooth headset, an OS voice download) is picked up rather than
  // cached against. Nothing is stored: `voices()` below always reads live.
  try {
    synthesis.getVoices();
    synthesis.addEventListener?.("voiceschanged", () => {
      synthesis.getVoices();
    });
  } catch {
    // A locked-down browser may refuse either call. That is a quieter game,
    // never a failed boot.
  }

  return {
    voices: () =>
      synthesis.getVoices().map((v) => ({
        name: v.name,
        lang: v.lang,
        localService: v.localService,
        default: v.default,
      })),
    speak(request) {
      const utterance = new utteranceCtor(request.text);
      const match = synthesis.getVoices().find((v) => v.name === request.voiceName);
      if (match) utterance.voice = match;
      utterance.lang = request.lang;
      utterance.rate = clamp(request.rate, 0.1, 10);
      utterance.pitch = clamp(request.pitch, 0, 2);
      utterance.volume = clamp(request.volume, 0, 1);
      let settled = false;
      utterance.onend = () => {
        if (settled) return;
        settled = true;
        request.onEnd();
      };
      utterance.onerror = () => {
        if (settled) return;
        settled = true;
        request.onError();
      };
      synthesis.speak(utterance);
    },
    cancel: () => synthesis.cancel(),
  };
}

/**
 * Reads the globals and binds the port, or returns null if this is Node, an old
 * browser, or a locked-down one.
 *
 * The global lookup lives HERE rather than at the call site so that AC-21.7's
 * module boundary holds literally: `voice.ts` is the only file in the repo that
 * names the Web Speech API. index.ts calls this and never sees a DOM type.
 */
export function browserSpeechPort(scope: unknown = globalThis): SpeechPort | null {
  if (typeof scope !== "object" || scope === null) return null;
  const bag = scope as Record<string, unknown>;
  const synthesis = bag["speechSynthesis"] as SpeechSynthesisGlobal | undefined;
  const ctor = bag["SpeechSynthesisUtterance"] as UtteranceCtor | undefined;
  return webSpeechPort(synthesis ?? null, ctor ?? null);
}
