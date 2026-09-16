import { createAllowlist, type Allowlist } from "@engine/allowlist/index.js";
import type {
  CoachFetch,
  CoachRequest,
  CoachResponse,
  Timer,
} from "@engine/coach/index.js";

/**
 * Shared fixtures for the coach tests.
 *
 * Nothing here touches the network or a real clock. Every transport takes its
 * fetch and its timer as parameters (CLAUDE.md HARD RULES), which is what makes
 * AC-15.1's four failure modes assertable rather than flaky.
 */

/**
 * Vocabulary MockCoach's templates use. In the shipped game these come from
 * the compiled allowlist (Fry 1000 + pools); here they are spelled out so the
 * fixture is readable and a template change that adds an off-list word fails
 * loudly instead of quietly falling back.
 */
const MOCK_VOCAB = [
  "nice", "flying", "pilot", "watch", "for", "and", "next", "time",
  "good", "run", "let", "us", "take", "a", "little", "slower",
  "you", "had", "that", "one", "keep", "an", "eye", "on",
  "clean", "took", "moment", "try", "it", "again", "with", "me",
  "every", "rock", "down", "was", "the", "slow", "is", "yours",
  "not", "past", "how", "map", "gets", "drawn", "word", "first",
];

/** Mars pool from story-draft-v1.md chapter 1, plus its warp-sentence glue. */
const MARS_POOL = [
  "red", "planet", "dust", "rust", "cold", "dry", "sky", "pink", "day",
  "tiny", "moons", "spin", "long", "ago", "rivers", "run", "across",
  "now", "empty", "first", "pilot", "place", "beacon",
  "mars", "is", "the", "its", "full", "of",
];

/**
 * "wrong" is deliberately ON this allowlist. It is a Fry-1000 word, so the
 * allowlist gate would pass it; the only thing that stops Shadow saying it is
 * the banned-term scan (D31, AC-25.3). Putting it here is what makes that test
 * mean something.
 */
export const allowlist: Allowlist = createAllowlist({
  lang: "en",
  words: [...MOCK_VOCAB, ...MARS_POOL, "wrong"],
  properNouns: ["Phobos", "Deimos"],
});

/**
 * An allowlist that accepts everything. Used to isolate a single gate: with
 * this in place the allowlist gate can never be the thing that fired, so a
 * refusal proves the banned-term scan or the word count did the work.
 * `createAllowlist` drops blocked words on the way in, so "liquor" cannot be
 * put on a real allowlist - this stub is the only way to test that gate
 * independently.
 */
export const permissiveAllowlist: Allowlist = {
  lang: "en",
  size: Number.MAX_SAFE_INTEGER,
  has: () => true,
  hasReadable: () => true,
  words: [],
  properNouns: [],
};

export const marsRequest: CoachRequest = {
  stopId: "mars",
  lang: "en",
  missed: ["rivers", "empty"],
  slow: ["across"],
  hitRate: 0.85,
};

// ---------------------------------------------------------------------------
// Timer fake
// ---------------------------------------------------------------------------

export interface FakeTimerHandle {
  readonly ms: number;
  cancelled: boolean;
  fire(): void;
}

export interface FakeTimer {
  readonly timer: Timer;
  readonly handles: FakeTimerHandle[];
  /** Trip every outstanding deadline. */
  fireAll(): void;
}

/** A `Timer` a test drives by hand. No real time passes anywhere. */
export function createFakeTimer(): FakeTimer {
  const handles: FakeTimerHandle[] = [];

  const timer: Timer = (ms: number) => {
    let resolve: () => void = () => undefined;
    const expired = new Promise<void>((r) => {
      resolve = r;
    });
    const handle: FakeTimerHandle = { ms, cancelled: false, fire: resolve };
    handles.push(handle);
    return {
      expired,
      cancel(): void {
        handle.cancelled = true;
      },
    };
  };

  return {
    timer,
    handles,
    fireAll(): void {
      for (const handle of handles) handle.fire();
    },
  };
}

// ---------------------------------------------------------------------------
// Fetch fakes - one per AC-15.1 failure mode
// ---------------------------------------------------------------------------

export interface FetchCall {
  readonly url: string;
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: unknown;
}

export interface FakeFetch {
  readonly fetchImpl: CoachFetch;
  readonly calls: FetchCall[];
}

function response(partial: Partial<CoachResponse>): CoachResponse {
  return {
    ok: partial.ok ?? true,
    status: partial.status ?? 200,
    json: partial.json ?? (() => Promise.resolve({})),
  };
}

/** Records every call, then answers with whatever `answer` produces. */
export function createFakeFetch(
  answer: () => Promise<CoachResponse>,
): FakeFetch {
  const calls: FetchCall[] = [];
  const fetchImpl: CoachFetch = (url, init) => {
    calls.push({
      url,
      body: JSON.parse(init.body) as unknown,
      headers: init.headers,
      signal: init.signal,
    });
    return answer();
  };
  return { fetchImpl, calls };
}

/** 200 with a JSON body. */
export const respondJson = (value: unknown) => (): Promise<CoachResponse> =>
  Promise.resolve(response({ json: () => Promise.resolve(value) }));

/** The connection failed. */
export const respondNetworkError = (): Promise<CoachResponse> =>
  Promise.reject(new Error("ECONNREFUSED"));

/** A non-200 (rate limit, cold start, 500...). */
export const respondStatus = (status: number) => (): Promise<CoachResponse> =>
  Promise.resolve(response({ ok: false, status }));

/** 200 whose body is not JSON - an HTML error page, a truncated stream. */
export const respondMalformed = (): Promise<CoachResponse> =>
  Promise.resolve(
    response({ json: () => Promise.reject(new SyntaxError("Unexpected token <")) }),
  );

/** Never answers. The only way out is the deadline. */
export const respondHang = (): Promise<CoachResponse> =>
  new Promise<CoachResponse>(() => undefined);

/** An AbortController-shaped port whose abort() a test can observe. */
export function createFakeAbort(): {
  create: () => { signal: unknown; abort(): void };
  aborted: () => number;
} {
  let count = 0;
  return {
    create: () => ({
      signal: "fake-signal",
      abort(): void {
        count += 1;
      },
    }),
    aborted: () => count,
  };
}
