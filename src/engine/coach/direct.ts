import { DEFAULT_FALLBACK_BUNDLE, type FallbackBundle } from "./fallback.js";
import { COACH_TIMEOUT_MS, fallbackResult, postJson, settle } from "./pipeline.js";
import { buildSystemPrompt, buildUserPrompt } from "./prompt.js";
import type { CoachValidator } from "./validate.js";
import type {
  CoachClient,
  CoachFetch,
  CoachRequest,
  CoachResult,
  CreateAbort,
  Timer,
} from "./types.js";

/**
 * DirectCoach - DEV FLAG ONLY (D47, AC-15.4). Talks straight to the Anthropic
 * Messages API so a prompt can be iterated on without a serverless deploy.
 *
 * ================== THIS FILE MUST NOT REACH PRODUCTION ==================
 *
 * How that is arranged, in three layers:
 *
 * 1. GRAPH. `src/engine/coach/index.ts` does not import this file, and neither
 *    does anything index.ts imports. It is a leaf. A bundler that starts from
 *    the game's entry point never reaches it, so it tree-shakes out - there is
 *    no flag to evaluate and no dead branch to eliminate, the module is simply
 *    unreferenced. `tests/unit/coach/tree-shake.test.ts` walks the real import
 *    graph and fails if that ever stops being true.
 * 2. MARKER. `DIRECT_COACH_MARKER` below is a string that exists nowhere else
 *    in the repo. `buildGuard.ts` exports the scan; the build test greps the
 *    built bundle for it and for `api.anthropic.com` and `x-api-key`.
 * 3. RUNTIME. Construction throws unless `devFlag` is explicitly true.
 *
 * NO KEY IS EVER HARDCODED AND process.env IS NEVER READ (D47, CLAUDE.md
 * "No keys in the client bundle"). `apiKey` is a constructor parameter; where
 * the developer got it is the developer's problem, and in the only supported
 * case - a local dev script - it comes from their shell, read by the script,
 * not by the engine.
 *
 * WHY RAW HTTP RATHER THAN @anthropic-ai/sdk: src/engine is dependency-free
 * and DOM-free by rule (CLAUDE.md), and takes its transport as an injected
 * `fetch`-shaped function. Importing the SDK here would put a runtime
 * dependency into the engine's graph - the exact thing layer 1 relies on not
 * happening.
 */

/** Unique to this file. The build test asserts it is absent from dist/. */
export const DIRECT_COACH_MARKER = "KB_DIRECT_COACH_DEV_ONLY";

/**
 * D92: Claude Haiku 4.5, pinned to the dated snapshot the decision names.
 * Chosen for latency inside the 4500 ms budget (AC-15.1); ~400 in / ~120 out
 * tokens per call, six calls per run.
 */
export const COACH_MODEL = "claude-haiku-4-5-20251001";

/** Enough for a 20-word note and two short sentences, and no more. */
export const COACH_MAX_TOKENS = 300;

export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";

export class DirectCoachUnavailableError extends Error {
  constructor(reason: string) {
    super(`DirectCoach is dev-only and refused to start: ${reason}`);
    this.name = "DirectCoachUnavailableError";
  }
}

export interface DirectCoachOptions {
  /**
   * Explicit opt-in. Must be literally true. This is the runtime half of
   * "unreachable in prod builds"; the graph is the other half.
   */
  readonly devFlag: boolean;
  /** INJECTED. Never read from process.env, never defaulted, never logged. */
  readonly apiKey: string;
  readonly fetchImpl: CoachFetch;
  readonly timer: Timer;
  readonly validator: CoachValidator;
  readonly fallback?: FallbackBundle;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly maxTokens?: number;
  readonly createAbort?: CreateAbort;
}

/**
 * Pull the JSON object out of a Messages API response.
 *
 * Tolerant on purpose: a model asked for bare JSON sometimes wraps it in a
 * fence or a sentence. Everything it returns still goes through the full
 * validator, so being tolerant here costs nothing in safety and saves a
 * fallback for a response that was fine. Returns null when there is nothing
 * object-shaped, which the caller reports as "malformed".
 */
export function extractPayload(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return null;
  const content = (raw as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;

  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const typed = block as { type?: unknown; text?: unknown };
    if (typed.type !== "text" || typeof typed.text !== "string") continue;

    const text = typed.text;
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) continue;
    try {
      return JSON.parse(text.slice(start, end + 1)) as unknown;
    } catch {
      continue;
    }
  }
  return null;
}

export function createDirectCoach(options: DirectCoachOptions): CoachClient {
  if (options.devFlag !== true) {
    throw new DirectCoachUnavailableError(
      `devFlag was not true (${DIRECT_COACH_MARKER})`,
    );
  }
  if (typeof options.apiKey !== "string" || options.apiKey.trim().length === 0) {
    throw new DirectCoachUnavailableError("no apiKey was injected");
  }

  const bundle = options.fallback ?? DEFAULT_FALLBACK_BUNDLE;
  const url = options.baseUrl ?? ANTHROPIC_MESSAGES_URL;
  const model = options.model ?? COACH_MODEL;
  const timeoutMs = options.timeoutMs ?? COACH_TIMEOUT_MS;
  const maxTokens = options.maxTokens ?? COACH_MAX_TOKENS;

  return {
    transport: "direct",
    async request(req: CoachRequest): Promise<CoachResult> {
      const safe = options.validator.sanitize(req);

      const outcome = await postJson({
        fetchImpl: options.fetchImpl,
        timer: options.timer,
        timeoutMs,
        url,
        headers: {
          "content-type": "application/json",
          "x-api-key": options.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          // Dev-only: the browser refuses a direct call without it. Its
          // presence in a built bundle is itself a failure signal.
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: {
          model,
          max_tokens: maxTokens,
          system: buildSystemPrompt(safe.lang),
          messages: [{ role: "user", content: buildUserPrompt(safe) }],
        },
        createAbort: options.createAbort,
      });

      if (!outcome.ok) {
        return fallbackResult(bundle, req, "direct", outcome.failure);
      }

      const payload = extractPayload(outcome.json);
      if (payload === null) {
        return fallbackResult(bundle, req, "direct", "malformed");
      }
      return settle(payload, req, options.validator, bundle, "direct");
    },
  };
}
