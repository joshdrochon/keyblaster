import type { Lang, StopId } from "../types.js";
import type { SentenceOutcome } from "./sentence.js";

/**
 * What the coach needs in order to COMPOSE this break's warp sentence out of
 * the words this child just practised (D09, FR-16, E-AI-1).
 *
 * Present on a request only at a warp break, and only when there is something
 * to compose from. Its absence is the note-only request the endpoint has
 * always taken, so nothing that does not ask for a sentence changes shape.
 */
export interface ComposeContext {
  /** This stage's typeable asteroid pool. AC-12.3 is checked against it. */
  readonly pool: readonly string[];
  /**
   * Words exempt from AC-12.3's "content word" rule - the sight-word list.
   * Never sent over the wire; it is the client-side gate's own vocabulary.
   */
  readonly sightWords: readonly string[];
  /** Words the child actually shot down this run (D09, `blastHistory`). */
  readonly blasted: readonly string[];
  /**
   * False when there is nothing to compose a sentence OUT of - a run with no
   * missed word, no slow word and no blast history (D09). The pool still goes
   * over the wire so the proxy can keep the reply's unused variants on the
   * allowlist; a variant that misses it fails the whole payload and takes the
   * NOTE with it, and nothing on screen ever shows a variant.
   */
  readonly sentence: boolean;
  /**
   * The stop's shipped sentence. Sent so the proxy can refuse a reply that is
   * just a copy of it: the client drops an identical sentence silently, so an
   * echo reads to a child as the AI never having run at all.
   */
  readonly shipped: string;
}

/**
 * The coach contract (architecture section 4.6, PRD FR-15, D33, D47).
 *
 *   POST /api/coach { stopId, lang, missed[], slow[], hitRate }
 *     -> { note: string, variants: string[2] }
 *
 * Everything in this file is data. The ports below (fetch, timer, abort) are
 * INTERFACES, never globals: src/engine may not reach for `fetch`,
 * `setTimeout` or `AbortController` on its own (CLAUDE.md HARD RULES), so the
 * whole module is exercised with zero network and zero real time in tests.
 */

/** What the game knows at the end of a belt, and hands to the coach. */
export interface CoachRequest {
  readonly stopId: StopId;
  /** Content language (D45). The note comes back in this language. */
  readonly lang: Lang;
  /** Words the player let through. Shadow names these (AC-15.5). */
  readonly missed: readonly string[];
  /** Words typed correctly but slowly. */
  readonly slow: readonly string[];
  /** Fraction in [0, 1]. */
  readonly hitRate: number;
  /**
   * Ask for this break's warp sentence to be composed from the run (D09).
   * Absent = the note-only request this endpoint has always taken.
   */
  readonly compose?: ComposeContext;
}

/**
 * A request whose word lists have been through the allowlist (D34) and whose
 * hitRate has been clamped. Transports only ever see this shape, so nothing a
 * caller passes can smuggle an unfiltered word into a prompt or a mock note.
 */
export interface SanitizedCoachRequest {
  readonly stopId: StopId;
  readonly lang: Lang;
  readonly missed: readonly string[];
  readonly slow: readonly string[];
  readonly hitRate: number;
  /** Filtered the same way: an unfiltered pool word must not reach a prompt. */
  readonly compose?: ComposeContext;
}

/** Exactly two variants. FR-15 says two, so the type says two. */
export type CoachVariants = readonly [string, string];

/** The validated payload: what a transport is allowed to hand to the UI. */
export interface CoachPayload {
  readonly note: string;
  readonly variants: CoachVariants;
}

/** Which transport produced a result (AC-15.4). */
export type TransportName = "proxy" | "mock" | "direct";

/**
 * Where the text came from. AC-15.1 requires the UI path to be IDENTICAL for
 * both, so this field exists for tests and telemetry-free logging only - the
 * shape of the result does not change with it.
 */
export type CoachSource = "live" | "fallback";

/**
 * Why a live answer was refused. Every one of these lands on the shipped
 * fallback bundle (AC-15.1, AC-15.2).
 *
 * Transport failures:  timeout | network | status | malformed
 * Validation failures: schema | allowlist | length | banned
 * Gate refusals:       phase | earth | duplicate   (AC-15.3)
 */
export type CoachFailure =
  | "timeout"
  | "network"
  | "status"
  | "malformed"
  | "schema"
  | "allowlist"
  | "length"
  | "banned"
  | "phase"
  | "earth"
  | "duplicate";

/** What every transport returns. Never throws, never rejects. */
export interface CoachResult {
  readonly note: string;
  readonly variants: CoachVariants;
  readonly source: CoachSource;
  /** null when `source` is "live". */
  readonly failure: CoachFailure | null;
  readonly transport: TransportName;
  /**
   * This break's warp sentence, composed from the words this child just
   * practised, or the reason there is not one (D09, FR-16, E-AI-1).
   *
   * INDEPENDENT OF `source` AND `failure`, which describe the NOTE. A model
   * can hand back a note that fails the banned-term scan and a sentence that
   * passes every gate, and refusing the good sentence because of the bad note
   * would cost the child the practice for no safety gain. `pipeline.settle`
   * gates the two separately and this field is the sentence's own verdict.
   *
   * `ok: true` is the ONLY thing the on-screen "written for you" marker is
   * allowed to key on, and it is true exactly when a live model wrote this
   * string for this run and it survived all six gates in `sentence.ts`.
   */
  readonly sentence: SentenceOutcome;
}

/**
 * ONE interface, three transports (AC-15.4). The Warp scene holds a
 * `CoachClient` and cannot tell which one it has.
 */
export interface CoachClient {
  readonly transport: TransportName;
  request(req: CoachRequest): Promise<CoachResult>;
}

// ---------------------------------------------------------------------------
// Ports. Injected, never imported from the host.
// ---------------------------------------------------------------------------

/**
 * The slice of the `fetch` response we use. Structural on purpose: the engine
 * must not depend on DOM lib types, and a test fake is three fields.
 */
export interface CoachResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export interface CoachRequestInit {
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  /** Opaque to us; whatever `createAbort` produced. */
  readonly signal?: unknown;
}

/** A `fetch`-shaped function. Injected (D47: nothing in the browser guesses). */
export type CoachFetch = (
  url: string,
  init: CoachRequestInit,
) => Promise<CoachResponse>;

/**
 * A cancellable delay. `expired` RESOLVES (never rejects) when the deadline
 * passes, so a lost race cannot produce an unhandled rejection; `cancel` must
 * make it never resolve, so no timer outlives the call.
 */
export interface TimerHandle {
  readonly expired: Promise<void>;
  cancel(): void;
}

export type Timer = (ms: number) => TimerHandle;

/** An AbortController-shaped port, so a timeout can actually cancel the wire. */
export interface AbortPort {
  readonly signal: unknown;
  abort(): void;
}

export type CreateAbort = () => AbortPort;
