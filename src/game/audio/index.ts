/**
 * The audio package's public surface, and the ONE place a real browser API is
 * bound to the ports the rest of the package runs on (D62, D88).
 *
 * Everything below `createAudioSystem` is re-export. Everything inside it is
 * adapter: read the globals, hand over ports, fall back to silence if any of
 * them are missing. No other file under src/game/audio touches a global, which
 * is what makes the whole package unit-testable in Node.
 *
 * WHY THE FALLBACK IS A NULL CONTEXT AND NOT A NULL SYSTEM. If `createAudioSystem`
 * could return null, every scene would grow an `if (audio)` and one of them
 * would eventually forget. A graph on a silent context has the same API, costs
 * nothing, and makes "the browser blocked audio" a quiet degradation instead of
 * a crash on the title screen.
 */

export * from "./context.js";
export * from "./nullContext.js";
export * from "./graph.js";
export * from "./music.js";
export * from "./ambient.js";
export * from "./sfx.js";
export * from "./keystrokeTone.js";
export * from "./voice.js";
export * from "./voiceClips.js";
export * from "./evidence.js";
// The connection layer. `createAudioSystem` BUILDS the audio; `installAudio`
// is what makes the game the thing playing it (audit.md 1.2).
export * from "./wiring.js";

import type { AudioContextLike } from "./context.js";
import { NullAudioContext } from "./nullContext.js";
import { buildAudioGraph, type AudioGraph } from "./graph.js";
import {
  browserSpeechPort,
  detectPlatform,
  type Platform,
  type Scheduler,
  type SpeechPort,
} from "./voice.js";
import type { VoiceClipCatalog, VoiceMediaElement } from "./voiceClips.js";

/**
 * Construct the platform's AudioContext, or null if there is not one.
 * `webkitAudioContext` is still how Safari spells it.
 */
export function browserAudioContext(scope: unknown = globalThis): AudioContextLike | null {
  if (typeof scope !== "object" || scope === null) return null;
  const bag = scope as Record<string, unknown>;
  const Ctor = (bag["AudioContext"] ?? bag["webkitAudioContext"]) as
    | (new () => AudioContextLike)
    | undefined;
  if (typeof Ctor !== "function") return null;
  try {
    return new Ctor();
  } catch {
    // A browser may refuse to construct one before a user gesture. Silence is
    // the correct outcome; a thrown error on boot is not.
    return null;
  }
}

/** `setTimeout`, as a port. Falls back to running the callback immediately. */
export function browserScheduler(scope: unknown = globalThis): Scheduler {
  const bag = typeof scope === "object" && scope !== null ? (scope as Record<string, unknown>) : {};
  const set = bag["setTimeout"];
  const clear = bag["clearTimeout"];
  if (typeof set !== "function" || typeof clear !== "function") {
    return (callback) => {
      callback();
      return () => undefined;
    };
  }
  return (callback, delayMs) => {
    const handle = (set as (cb: () => void, ms: number) => unknown)(callback, delayMs);
    return () => (clear as (h: unknown) => void)(handle);
  };
}

function detectPlatformFrom(scope: unknown): Platform {
  if (typeof scope !== "object" || scope === null) return "other";
  const nav = (scope as Record<string, unknown>)["navigator"];
  if (typeof nav !== "object" || nav === null) return "other";
  const bag = nav as Record<string, unknown>;
  const ua = typeof bag["userAgent"] === "string" ? (bag["userAgent"] as string) : "";
  const platform = typeof bag["platform"] === "string" ? (bag["platform"] as string) : "";
  return detectPlatform(ua, platform);
}

// ---------------------------------------------------------------------------
// Shadow's rendered lines (D63)
// ---------------------------------------------------------------------------

/**
 * The rendered clips, as URLs the bundler owns.
 *
 * THIS IS ALSO WHAT MAKES THEM SHIP. Vite emits an asset only if something
 * imports it, so before this glob existed `vite build` put zero mp3 into
 * `dist/` and a file transport would have 404'd in a real build while looking
 * perfectly wired in dev. The glob is the import. `?url` keeps the bytes out of
 * the JS bundle: what lands here is a hashed path, and the file is fetched by
 * the media element when a line is actually spoken.
 *
 * `import.meta.glob` rather than a static import for the same reason
 * `scenes/lib/content.ts` uses it: `resolveJsonModule` is off, no lane may edit
 * tsconfig, and a glob is declared by `vite/client` which tsconfig does load.
 */
const CLIP_URLS = import.meta.glob("../../content/audio/voice/*.mp3", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * The render manifest, which is the AUTHORITY on what was rendered and what it
 * was rendered from. The glob above says what is on disk; this says what was
 * meant to be. An id needs both - a file with no manifest row is an orphan from
 * a half-finished render, and a manifest row with no file is a render that was
 * capped mid-run (see `scripts/render-voice.mjs`).
 */
const CLIP_MANIFEST = import.meta.glob("../../content/audio/voice/manifest.json", {
  import: "default",
  eager: true,
}) as Record<string, unknown>;

/** `{ id, file }` rows from the manifest, narrowed by hand. It is content. */
export function manifestClipIds(manifest: unknown = Object.values(CLIP_MANIFEST)[0]): string[] {
  if (typeof manifest !== "object" || manifest === null) return [];
  const lines = (manifest as { lines?: unknown }).lines;
  if (!Array.isArray(lines)) return [];
  const ids: string[] = [];
  for (const row of lines) {
    if (typeof row !== "object" || row === null) continue;
    const id = (row as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) ids.push(id);
  }
  return ids;
}

/**
 * The language the shipped clips were RENDERED IN. Absent on an older manifest,
 * which is English, so that is the default.
 */
export function manifestLang(manifest: unknown = Object.values(CLIP_MANIFEST)[0]): string {
  if (typeof manifest !== "object" || manifest === null) return "en";
  const lang = (manifest as { lang?: unknown }).lang;
  return typeof lang === "string" && lang.length > 0 ? lang.toLowerCase() : "en";
}

/** "en-US" -> "en". Same rule `selectVoice` uses for a BCP-47 tag. */
const baseLangOf = (tag: string): string => (tag.split("-")[0] ?? tag).toLowerCase();

/** Line id from a clip path: ".../mars.beaconFlavor.mp3" -> "mars.beaconFlavor". */
function clipIdOf(path: string): string | null {
  const file = path.split("/").pop();
  if (file === undefined || !file.endsWith(".mp3")) return null;
  const id = file.slice(0, -".mp3".length);
  return id.length > 0 ? id : null;
}

/**
 * Wrap a real `HTMLAudioElement` as a `VoiceMediaElement`.
 *
 * The cast is the entire cost of not modelling the DOM's media types in the
 * port, and it is confined to this function - the same trade `webSpeechPort`
 * makes for utterances.
 */
function adaptMediaElement(element: unknown): VoiceMediaElement {
  const el = element as {
    play(): unknown;
    pause(): void;
    currentTime: number;
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
  };
  return {
    // The RAW element, which is the only thing `createMediaElementSource` will
    // accept. Handing it this adapter object instead is a silent fallback.
    source: element,
    play: () => el.play(),
    pause: () => el.pause(),
    get currentTime(): number {
      return el.currentTime;
    },
    set currentTime(value: number) {
      el.currentTime = value;
    },
    addEventListener: (type, listener) => el.addEventListener(type, listener),
    removeEventListener: (type, listener) => el.removeEventListener(type, listener),
  };
}

/**
 * The catalog of rendered lines this build can play, or null.
 *
 * Null in Node, in a browser with no `Audio` constructor, and in a build that
 * shipped no renders. Every one of those is a game that speaks through the
 * platform voice, which is D88's stand-in and still a complete game.
 */
export function browserVoiceClips(
  scope: unknown = globalThis,
  contentLang = "en",
): VoiceClipCatalog | null {
  if (typeof scope !== "object" || scope === null) return null;
  const Ctor = (scope as Record<string, unknown>)["Audio"];
  if (typeof Ctor !== "function") return null;
  // ================== THE CLIPS ARE IN ONE LANGUAGE ==================
  // The scripted ids carry no language - `mars.beaconFlavor` is the same id
  // whatever the child is reading - so a Spanish session would look up an
  // ENGLISH recording and play it over Spanish text. That is precisely the
  // "wrong voice" D98 cuts, and it is worse than the system voice was, because
  // it is not even the right words. A session whose language is not the one
  // that was rendered gets NO clips, which under D98 means silence.
  // See gauntlet/escalations.md E-VOICE-1.
  if (baseLangOf(contentLang) !== manifestLang()) return null;

  const rendered = new Set(manifestClipIds());
  const byId = new Map<string, string>();
  for (const [path, url] of Object.entries(CLIP_URLS)) {
    const id = clipIdOf(path);
    // Both, or neither: see CLIP_MANIFEST. An empty manifest is treated as "no
    // manifest was shipped", not as "nothing was rendered", so a build that
    // dropped the json still plays the files it has.
    if (id !== null && (rendered.size === 0 || rendered.has(id))) byId.set(id, url);
  }
  if (byId.size === 0) return null;

  const ids = [...byId.keys()].sort();
  const make = Ctor as new (src: string) => unknown;
  return {
    ids: () => ids,
    open(id: string): VoiceMediaElement | null {
      const url = byId.get(id);
      if (url === undefined) return null;
      try {
        return adaptMediaElement(new make(url));
      } catch {
        return null;
      }
    },
  };
}

export interface AudioSystemOptions {
  /** Override the context. Tests pass a `NullAudioContext`. */
  readonly ctx?: AudioContextLike | null;
  /** Override the speech port. `null` forces the silent voice fallback. */
  readonly speech?: SpeechPort | null;
  readonly platform?: Platform;
  /** Content language (D45). Drives voice selection. */
  readonly lang?: string;
  readonly schedule?: Scheduler;
  readonly rand?: () => number;
  readonly masterGain?: number;
  /** The scope globals are read from. Injected so the adapter is testable. */
  readonly scope?: unknown;
  /**
   * Shadow's rendered lines (D63). `null` ships no clips at all, which under
   * D98 means a silent Shadow - the state a build guard is supposed to prevent.
   */
  readonly voiceClips?: VoiceClipCatalog | null;
  /**
   * D98: bind the browser's speech synthesiser and let it read lines that have
   * no rendered clip. OFF unless explicitly passed, and `boot.ts` does not pass
   * it. The one case it is for is a live `/api/coach` note, which is genuinely
   * unrenderable; everything else that would use it is a missing render, and a
   * missing render is a build failure rather than a runtime fallback.
   */
  readonly allowSystemVoice?: boolean;
}

/**
 * Build the game's audio. Safe to call with nothing: on a browser it binds the
 * real APIs, in Node it builds the same graph on a silent context.
 */
export function createAudioSystem(options: AudioSystemOptions = {}): AudioGraph {
  const scope = options.scope ?? globalThis;
  const ctx = options.ctx ?? browserAudioContext(scope) ?? new NullAudioContext();
  // D98. Two locks rather than one: the environment flag below is what
  // `adaptiveTransport` reads, and the port is not even BOUND without the
  // opt-in, so a future edit that forgets the flag still cannot reach the
  // platform's voice from the shipped composition root.
  const allowSystemVoice = options.allowSystemVoice === true;
  const speech = !allowSystemVoice
    ? null
    : options.speech !== undefined
      ? options.speech
      : browserSpeechPort(scope);
  const schedule = options.schedule ?? browserScheduler(scope);
  const platform = options.platform ?? detectPlatformFrom(scope);
  const lang = options.lang ?? "en-US";
  const clips =
    options.voiceClips !== undefined ? options.voiceClips : browserVoiceClips(scope, lang);

  const graphOptions = {
    voiceEnv: {
      speech,
      platform,
      lang,
      schedule,
      allowSystemVoice,
    },
    ...(clips !== null ? { voiceClips: clips } : {}),
    ...(options.rand ? { rand: options.rand } : {}),
    ...(options.masterGain !== undefined ? { masterGain: options.masterGain } : {}),
  };

  return buildAudioGraph(ctx, graphOptions);
}
