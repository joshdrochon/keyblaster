import {
  COACH_ENDPOINT,
  createMockCoach,
  createProxyCoach,
  createRealTimer,
  createCoachValidator,
  type CoachClient,
  type CoachFetch,
  type CoachRequestInit,
  type CoachResponse,
} from "@engine/coach";
import type { Allowlist } from "@engine/allowlist";

/**
 * WHICH TRANSPORT THE GAME ACTUALLY HOLDS (AC-15.4, D47, D87).
 *
 * `src/engine/coach` ships three transports behind one `CoachClient`
 * interface. Until this file existed, the claim "three transports behind one
 * interface" was true only inside the unit tests: `createProxyCoach` had no
 * caller anywhere in `src/`, so every note a child ever saw came from
 * `MockCoach` and `/api/coach` was unreachable from the shipped client.
 *
 * This is the composition root for that choice, and the choice is DELIBERATE
 * rather than incidental:
 *
 *   MockCoach   the DEFAULT, and the only transport in tests and the gauntlet.
 *               D87 forbids live paid calls in the build loop, so "automated"
 *               forces the mock and no configuration can override that.
 *   ProxyCoach  used when, and only when, a same-origin `/api/coach` endpoint
 *               is CONFIGURED - `VITE_COACH_ENDPOINT` at build time. An
 *               unconfigured build is a mock build; there is no silent default
 *               that would make a deploy start spending money by accident
 *               (D47: the key is server-side, and the client does not guess).
 *   DirectCoach dev flag only, and NOT REACHABLE FROM THIS FILE. It is not
 *               imported here, it is not imported by `@engine/coach`, and
 *               `tests/unit/coach/treeShake.test.ts` walks the real import
 *               graph from `src/main.ts` and fails if that changes.
 *
 * AC-33 IS NOT AT RISK HERE. Nothing downstream of this function branches on
 * which transport it got: `CoachResult` has the same shape from all three, the
 * Warp scene reads `note` and never reads `source`, `failure` or `transport`,
 * and the fallback path is the shared one in `engine/coach/pipeline.ts`. The
 * byte-identical screenshot pair in `tests/e2e/warp.spec.ts` covers both.
 */

export type CoachTransportChoice = "mock" | "proxy";

export interface TransportEnv {
  /**
   * A configured coach endpoint, or null. Same-origin paths only: a coach note
   * is not worth an arbitrary cross-origin POST from a child's browser.
   */
  readonly endpoint: string | null;
  /**
   * True under vitest, Playwright and the gauntlet runner. Forces the mock
   * (D87); nothing but an explicit `?coach=proxy` can lift it, and that exists
   * so the proxy path can be exercised against an intercepted route rather
   * than against the real API.
   */
  readonly automated: boolean;
  /** Explicit per-session override, from `?coach=mock` / `?coach=proxy`. */
  readonly override: CoachTransportChoice | null;
}

/**
 * The rule, as one total function over data so it can be unit-tested without a
 * browser, a build mode or a network.
 *
 * Order matters and is the safety argument:
 *   1. an explicit "mock" always wins - the cheapest thing is always available
 *   2. an explicit "proxy" needs a configured endpoint, or it degrades to mock
 *   3. otherwise automated runs are mock (D87)
 *   4. otherwise: proxy if configured, mock if not
 */
export function chooseTransport(env: TransportEnv): CoachTransportChoice {
  const configured = env.endpoint !== null && env.endpoint.length > 0;
  if (env.override === "mock") return "mock";
  if (env.override === "proxy") return configured ? "proxy" : "mock";
  if (env.automated) return "mock";
  return configured ? "proxy" : "mock";
}

/**
 * Only a same-origin absolute path is accepted as an endpoint, whether it came
 * from the build env or the URL. `//evil.example` and `http://…` are rejected:
 * the sanitized request carries the child's missed words, and D47's whole point
 * is that the only party that sees them is our own function.
 */
export function sameOriginPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value.length === 0) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

function isAutomated(): boolean {
  // Vitest sets MODE to "test"; the gauntlet and the e2e suite drive a
  // WebDriver-controlled browser, which sets navigator.webdriver.
  try {
    if (import.meta.env.MODE === "test") return true;
  } catch {
    /* no import.meta.env outside a Vite graph; fall through */
  }
  try {
    return navigator.webdriver === true;
  } catch {
    return false;
  }
}

function envEndpoint(): string | null {
  try {
    const raw = import.meta.env["VITE_COACH_ENDPOINT"] as unknown;
    return sameOriginPath(typeof raw === "string" ? raw : null);
  } catch {
    return null;
  }
}

function parseOverride(raw: string | null): CoachTransportChoice | null {
  if (raw === "mock") return "mock";
  if (raw === "proxy") return "proxy";
  return null;
}

/**
 * Read the environment. Reading the URL is the same seam `boot.ts` and
 * `laneInit` already use for presentation knobs and test overrides; nothing
 * read here reaches a rule.
 */
export function readTransportEnv(search?: string): TransportEnv {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search ?? window.location.search);
  } catch {
    params = new URLSearchParams(search ?? "");
  }
  // A URL endpoint is a test seam for the proxy path (Playwright routes it);
  // it is still forced same-origin, so it cannot point at a third party.
  const fromUrl = sameOriginPath(params.get("coachEndpoint"));
  return {
    endpoint: fromUrl ?? envEndpoint(),
    automated: isAutomated(),
    override: parseOverride(params.get("coach")),
  };
}

/**
 * `fetch`, adapted to the engine's port.
 *
 * The engine takes a `fetch`-shaped function rather than calling the global,
 * so this three-line adapter is the only place in the program that knows the
 * browser has one (CLAUDE.md: src/engine never touches the DOM).
 */
export function browserFetch(url: string, init: CoachRequestInit): Promise<CoachResponse> {
  return fetch(url, {
    method: init.method,
    headers: { ...init.headers },
    body: init.body,
    signal: init.signal as AbortSignal | undefined,
  });
}

export interface CoachClientOptions {
  /** D34: the validator's allowlist. Built by `scenes/support/vocab.ts`. */
  readonly allowlist: Allowlist;
  /** Overridable for tests; defaults to reading the build env and the URL. */
  readonly env?: TransportEnv;
  /** Overridable for tests; defaults to the browser's `fetch`. */
  readonly fetchImpl?: CoachFetch;
}

/**
 * Build the coach client this session should use. Returns a `CoachClient` and
 * nothing else: the caller cannot tell which transport it got, which is the
 * property AC-15.4 is actually about.
 */
export function createCoachClient(options: CoachClientOptions): CoachClient {
  const validator = createCoachValidator({ allowlist: options.allowlist });
  const env = options.env ?? readTransportEnv();
  const choice = chooseTransport(env);

  if (choice === "mock") return createMockCoach({ validator });

  return createProxyCoach({
    validator,
    fetchImpl: options.fetchImpl ?? browserFetch,
    timer: createRealTimer(),
    // AC-15.1: a 1500 ms deadline that actually cancels the wire.
    createAbort: () => new AbortController(),
    url: env.endpoint ?? COACH_ENDPOINT,
  });
}
