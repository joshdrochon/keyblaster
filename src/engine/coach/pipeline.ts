import { fallbackFor, type FallbackBundle } from "./fallback.js";
import {
  NO_SENTENCE,
  practisedWords,
  validateComposedSentence,
  type SentenceOutcome,
} from "./sentence.js";
import type { CoachValidator } from "./validate.js";
import type {
  CoachFailure,
  CoachFetch,
  CoachRequest,
  CoachResult,
  CreateAbort,
  Timer,
  TransportName,
} from "./types.js";

/**
 * The bit every transport shares: talk over the wire under a deadline, then
 * put whatever came back through the validator, and on ANY problem return the
 * shipped fallback in exactly the same shape (AC-15.1 - "the UI path is
 * identical"). The Warp scene reads `note` and `variants` and never branches
 * on `source`.
 */

/** AC-15.1, CLAUDE.md, architecture 4.6. Not a suggestion, not per-transport. */
export const COACH_TIMEOUT_MS = 1500;

/**
 * Build a fallback result. `note` is never empty (see fallback.ts).
 *
 * `sentence` defaults to "there isn't one", which is what every transport
 * failure means for the warp sentence: the scene keeps the shipped static
 * string it laid out at `create()` and shows no marker.
 */
export function fallbackResult(
  bundle: FallbackBundle,
  req: CoachRequest,
  transport: TransportName,
  failure: CoachFailure,
  sentence: SentenceOutcome = NO_SENTENCE,
): CoachResult {
  const payload = fallbackFor(bundle, req.lang, req.stopId);
  return {
    note: payload.note,
    variants: payload.variants,
    source: "fallback",
    failure,
    transport,
    sentence,
  };
}

/**
 * Pull the composed warp sentence out of a raw payload and put it through
 * `sentence.ts`'s six gates (D09, AC-12.3, AC-15.2).
 *
 * Returns `absent` whenever the caller did not ask for one, so a note-only
 * request and every mock keep exactly the shape they had before this existed.
 */
function composedSentence(
  raw: unknown,
  req: CoachRequest,
  validator: CoachValidator,
): SentenceOutcome {
  if (req.compose === undefined) return NO_SENTENCE;
  if (typeof raw !== "object" || raw === null) return NO_SENTENCE;
  // Sanitized, not raw: the pool and the practised list are matched against
  // here, and an unfiltered word in either is a word the gate would otherwise
  // be willing to admit into a sentence a child types (D34).
  const safe = validator.sanitize(req);
  const compose = safe.compose;
  if (compose === undefined) return NO_SENTENCE;
  return validateComposedSentence((raw as { sentence?: unknown }).sentence, {
    allowlist: validator.allowlist,
    pool: compose.pool,
    sightWords: compose.sightWords,
    practised: practisedWords(safe.missed, safe.slow, compose),
  });
}

/**
 * Validate a raw payload and turn it into a result. A validation failure is
 * not an error the caller handles - it is just the fallback (AC-15.2).
 *
 * THE NOTE AND THE SENTENCE ARE GATED SEPARATELY, and that is deliberate.
 * They are two strings with two jobs: the note is READ and lands on the
 * shipped fallback bundle when it fails; the sentence is TYPED and lands on
 * the stop's shipped static sentence when it fails. One model reply can fail
 * one and pass the other, and collapsing them would throw away a perfectly
 * safe sentence because the note said "wrong" - or, far worse, invite a later
 * change that shows a sentence because the NOTE passed.
 */
export function settle(
  raw: unknown,
  req: CoachRequest,
  validator: CoachValidator,
  bundle: FallbackBundle,
  transport: TransportName,
): CoachResult {
  const sentence = composedSentence(raw, req, validator);
  const outcome = validator.validate(raw);
  if (!outcome.ok) {
    return fallbackResult(bundle, req, transport, outcome.reason, sentence);
  }
  return {
    note: outcome.value.note,
    variants: outcome.value.variants,
    source: "live",
    failure: null,
    transport,
    sentence,
  };
}

export type PostOutcome =
  | { readonly ok: true; readonly json: unknown }
  | { readonly ok: false; readonly failure: CoachFailure };

export interface PostOptions {
  readonly fetchImpl: CoachFetch;
  readonly timer: Timer;
  readonly timeoutMs: number;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly createAbort?: CreateAbort | undefined;
}

/**
 * POST JSON under a deadline. Never throws. Distinguishes the four AC-15.1
 * failure modes so tests can assert each one independently:
 *
 *   timeout   - the injected timer won the race
 *   network   - the injected fetch rejected
 *   status    - a non-200 response
 *   malformed - the body was not JSON
 *
 * The timer is injected (a `Timer`), so no test waits 1500 ms of real time and
 * nothing here reaches for setTimeout.
 */
export async function postJson(options: PostOptions): Promise<PostOutcome> {
  const abort = options.createAbort?.();
  const deadline = options.timer(options.timeoutMs);

  // The deadline covers the WHOLE exchange - connect, status and body read.
  // Racing only the fetch would let a response that streams its body slowly
  // blow the 1500 ms budget while every individual step looked fine.
  const attempt: Promise<PostOutcome> = (async () => {
    let response;
    try {
      response = await options.fetchImpl(options.url, {
        method: "POST",
        headers: options.headers,
        body: JSON.stringify(options.body),
        ...(abort === undefined ? {} : { signal: abort.signal }),
      });
    } catch {
      return { ok: false, failure: "network" };
    }

    if (!response.ok || response.status !== 200) {
      return { ok: false, failure: "status" };
    }

    try {
      return { ok: true, json: await response.json() };
    } catch {
      return { ok: false, failure: "malformed" };
    }
  })();

  // `attempt` never rejects, but if the deadline wins it is still pending;
  // this keeps any future change from surfacing an unhandled rejection under
  // a 60 fps game loop (D32).
  attempt.catch(() => undefined);

  const timedOut = Symbol("coach-timeout");
  const outcome = await Promise.race([
    attempt,
    deadline.expired.then(() => timedOut),
  ]);
  deadline.cancel();

  if (typeof outcome === "symbol") {
    // Cancel the wire: a request we are no longer listening to must not keep a
    // socket open behind the game loop.
    abort?.abort();
    return { ok: false, failure: "timeout" };
  }
  return outcome;
}
