import { DEFAULT_FALLBACK_BUNDLE, type FallbackBundle } from "./fallback.js";
import { COACH_TIMEOUT_MS, fallbackResult, postJson, settle } from "./pipeline.js";
import type { CoachValidator } from "./validate.js";
import type {
  CoachClient,
  CoachFetch,
  CoachRequest,
  CoachResult,
  CreateAbort,
  SanitizedCoachRequest,
  Timer,
} from "./types.js";

/**
 * ProxyCoach - the PRODUCTION transport (D47, AC-15.4).
 *
 *   POST /api/coach { stopId, lang, missed[], slow[], hitRate }
 *     -> { note, variants[2] }
 *
 * The Anthropic key lives in the serverless function, never in the browser
 * (D47, CLAUDE.md "No keys in the client bundle"). Nothing in this file knows
 * the key exists, and nothing here reads process.env.
 *
 * `fetchImpl` is injected. The engine never reaches for the global `fetch`:
 * that is what makes AC-15.1's four failure modes testable with a fake and
 * keeps src/engine DOM-free (CLAUDE.md HARD RULES).
 */

/** The endpoint from architecture section 4.6. */
export const COACH_ENDPOINT = "/api/coach";

export interface ProxyCoachOptions {
  readonly fetchImpl: CoachFetch;
  readonly timer: Timer;
  readonly validator: CoachValidator;
  /** Default: the shipped bundle. */
  readonly fallback?: FallbackBundle;
  /** Default: "/api/coach". */
  readonly url?: string;
  /** Default: 1500 (AC-15.1). */
  readonly timeoutMs?: number;
  /** Optional AbortController-shaped port so a timeout cancels the wire. */
  readonly createAbort?: CreateAbort;
}

/**
 * What actually goes on the wire.
 *
 * A note-only request is byte-for-byte what it has always been - five fields,
 * no `mode` - so a deployed endpoint that predates the warp sentence still
 * answers it. Asking for a sentence adds `mode: "warp"` and the two lists the
 * second prompt shape needs (E-AI-1: one endpoint, two prompt shapes).
 *
 * `sightWords` is deliberately NOT sent. It is 149 entries of Fry-tier filler
 * whose only job is to tell the CLIENT which tokens are exempt from AC-12.3;
 * putting it in the prompt would spend latency inside a 1200 ms server budget
 * to tell the model something a short curated hint already covers.
 */
function wireBody(safe: SanitizedCoachRequest): Record<string, unknown> {
  const base = {
    stopId: safe.stopId,
    lang: safe.lang,
    missed: safe.missed,
    slow: safe.slow,
    hitRate: safe.hitRate,
  };
  if (safe.compose === undefined) return base;
  return {
    ...base,
    mode: "warp",
    pool: safe.compose.pool,
    blasted: safe.compose.blasted,
  };
}

export function createProxyCoach(options: ProxyCoachOptions): CoachClient {
  const bundle = options.fallback ?? DEFAULT_FALLBACK_BUNDLE;
  const url = options.url ?? COACH_ENDPOINT;
  const timeoutMs = options.timeoutMs ?? COACH_TIMEOUT_MS;

  return {
    transport: "proxy",
    async request(req: CoachRequest): Promise<CoachResult> {
      // Sanitize before the wire: an unfiltered word must never reach a prompt,
      // even one assembled server-side (D34).
      const safe = options.validator.sanitize(req);

      const outcome = await postJson({
        fetchImpl: options.fetchImpl,
        timer: options.timer,
        timeoutMs,
        url,
        headers: { "content-type": "application/json" },
        body: wireBody(safe),
        createAbort: options.createAbort,
      });

      if (!outcome.ok) {
        return fallbackResult(bundle, req, "proxy", outcome.failure);
      }
      return settle(outcome.json, req, options.validator, bundle, "proxy");
    },
  };
}
