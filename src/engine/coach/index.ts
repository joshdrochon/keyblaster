/**
 * coach/ - the one LLM call in the game (D32, D33, D34, D47, D92;
 * PRD FR-15 / AC-15.1..AC-15.5; architecture section 4.6).
 *
 * D32 is the frame for everything here: the LLM is the last possible option,
 * and it never touches the game loop. It runs ONCE, during the calm warp break
 * between belts, with a 1500 ms deadline and a shipped fallback behind it. If
 * it is slow, broken, offline or off-voice, the child sees a good coach note
 * anyway and nothing about the screen tells them which one they got.
 *
 * ONE INTERFACE, THREE TRANSPORTS (AC-15.4):
 *
 *   CoachClient { transport, request(req) -> Promise<CoachResult> }
 *     ProxyCoach   prod.  POSTs /api/coach; the key stays server-side (D47).
 *     MockCoach    dev / offline / demo / gauntlet. Deterministic.
 *     DirectCoach  dev flag only. NOT EXPORTED HERE - see below.
 *
 * Every transport ends in the same two calls (pipeline.ts): validate, then
 * either the live payload or the shipped fallback, in an identical result
 * shape. The scene cannot tell which transport it holds and does not branch on
 * which one it got.
 *
 * DirectCoach IS DELIBERATELY ABSENT FROM THIS FILE. Importing it here would
 * put the Anthropic endpoint, the dev headers and the prompt into every
 * production bundle. It lives at `@engine/coach/direct.js`, is imported by
 * nothing in this graph, and `buildGuard.js` gives the build test the scan that
 * proves it. Same for `prompt.js`, which the serverless function imports by
 * path. Do not re-export either from here.
 *
 * WIRING, for the Warp scene:
 *
 *   const validator = createCoachValidator({ allowlist });
 *   const client = import.meta.env.DEV
 *     ? createMockCoach({ validator })
 *     : createProxyCoach({ validator, fetchImpl, timer: createRealTimer() });
 *   const gate = createCoachGate({ client });   // AC-15.3 lives in the gate
 *
 * Nothing in this module reads a clock, a global fetch, process.env or storage.
 */

export type {
  AbortPort,
  CoachClient,
  CoachFailure,
  CoachFetch,
  CoachPayload,
  CoachRequest,
  CoachRequestInit,
  CoachResponse,
  CoachResult,
  CoachSource,
  CoachVariants,
  CreateAbort,
  SanitizedCoachRequest,
  Timer,
  TimerHandle,
  TransportName,
} from "./types.js";

export { VARIANT_COUNT, parseCoachPayload } from "./schema.js";

export {
  SHADOW_BANNED_TERMS,
  saysWrong,
  scanForBanned,
  type BanHit,
  type BanReason,
} from "./banned.js";

export {
  MAX_NOTE_WORDS,
  createCoachValidator,
  type CoachValidation,
  type CoachValidator,
  type CoachValidatorOptions,
  type NoteScope,
} from "./validate.js";

export {
  DEFAULT_FALLBACK_BUNDLE,
  fallbackFor,
  fallbackIssues,
  type FallbackBundle,
  type LangFallback,
} from "./fallback.js";

export { COACH_TIMEOUT_MS, fallbackResult, postJson, settle } from "./pipeline.js";
export type { PostOptions, PostOutcome } from "./pipeline.js";

export {
  COACH_ENDPOINT,
  createProxyCoach,
  type ProxyCoachOptions,
} from "./proxy.js";

export {
  createMockCoach,
  hashRequest,
  mockNote,
  type MockCoachOptions,
  type MockVariantSource,
} from "./mock.js";

export {
  createCoachGate,
  type CoachGate,
  type CoachGateOptions,
  type GamePhase,
} from "./gate.js";

export { createNeverTimer, createRealTimer } from "./timer.js";
