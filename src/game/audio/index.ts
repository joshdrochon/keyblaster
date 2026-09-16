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
export * from "./evidence.js";

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
}

/**
 * Build the game's audio. Safe to call with nothing: on a browser it binds the
 * real APIs, in Node it builds the same graph on a silent context.
 */
export function createAudioSystem(options: AudioSystemOptions = {}): AudioGraph {
  const scope = options.scope ?? globalThis;
  const ctx = options.ctx ?? browserAudioContext(scope) ?? new NullAudioContext();
  const speech = options.speech !== undefined ? options.speech : browserSpeechPort(scope);
  const schedule = options.schedule ?? browserScheduler(scope);
  const platform = options.platform ?? detectPlatformFrom(scope);

  const graphOptions = {
    voiceEnv: { speech, platform, lang: options.lang ?? "en-US", schedule },
    ...(options.rand ? { rand: options.rand } : {}),
    ...(options.masterGain !== undefined ? { masterGain: options.masterGain } : {}),
  };

  return buildAudioGraph(ctx, graphOptions);
}
