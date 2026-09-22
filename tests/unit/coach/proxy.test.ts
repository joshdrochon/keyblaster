import { describe, expect, it } from "vitest";
import {
  COACH_ENDPOINT,
  COACH_TIMEOUT_MS,
  DEFAULT_FALLBACK_BUNDLE,
  createCoachValidator,
  createProxyCoach,
  fallbackFor,
  type CoachResult,
} from "@engine/coach/index.js";
import {
  allowlist,
  createFakeAbort,
  createFakeFetch,
  createFakeTimer,
  marsRequest,
  permissiveAllowlist,
  respondHang,
  respondJson,
  respondMalformed,
  respondNetworkError,
  respondStatus,
} from "./fixtures.js";

/**
 * AC-15.1: 4500 ms timeout; on timeout / error / invalid JSON the fallback
 * bundle is used and the UI is identical. Every failure mode below is produced
 * by an injected fake - there is no network in this file and no real time
 * passes (CLAUDE.md HARD RULES).
 */

const validator = createCoachValidator({ allowlist });

const livePayload = {
  note: "Nice flying, pilot. Watch for rivers and empty next time.",
  variants: ["Mars is the red planet.", "Its dust is full of rust."],
};

function build(answer: () => Promise<never> | Promise<unknown>) {
  const fetch = createFakeFetch(answer as never);
  const clock = createFakeTimer();
  const abort = createFakeAbort();
  const coach = createProxyCoach({
    fetchImpl: fetch.fetchImpl,
    timer: clock.timer,
    validator,
    createAbort: abort.create,
  });
  return { coach, fetch, clock, abort };
}

/** The shipped text a failing Mars break must produce. */
const marsFallback = fallbackFor(DEFAULT_FALLBACK_BUNDLE, "en", "mars");

function expectIdenticalShape(result: CoachResult): void {
  expect(typeof result.note).toBe("string");
  expect(result.note.length).toBeGreaterThan(0);
  expect(result.variants).toHaveLength(2);
  expect(result.variants[0].length).toBeGreaterThan(0);
  expect(result.variants[1].length).toBeGreaterThan(0);
  expect(result.transport).toBe("proxy");
}

describe("ProxyCoach happy path (AC-15.4, architecture 4.6)", () => {
  it("AC-15.4: POSTs the documented contract to /api/coach", async () => {
    const { coach, fetch } = build(respondJson(livePayload));
    const result = await coach.request(marsRequest);

    expect(fetch.calls).toHaveLength(1);
    const call = fetch.calls[0];
    expect(call?.url).toBe(COACH_ENDPOINT);
    expect(call?.body).toEqual({
      stopId: "mars",
      lang: "en",
      missed: ["rivers", "empty"],
      slow: ["across"],
      hitRate: 0.85,
    });
    expect(result.source).toBe("live");
    expect(result.failure).toBeNull();
    expect(result.note).toBe(livePayload.note);
    expectIdenticalShape(result);
  });

  it("D34: the request is allowlist-filtered before it reaches the wire", async () => {
    const { coach, fetch } = build(respondJson(livePayload));
    await coach.request({
      ...marsRequest,
      missed: ["rivers", "zorblax"],
      slow: ["liquor"],
    });
    expect(fetch.calls[0]?.body).toMatchObject({ missed: ["rivers"], slow: [] });
  });

  it("uses the documented 4500 ms deadline by default", async () => {
    const { coach, clock } = build(respondJson(livePayload));
    await coach.request(marsRequest);
    expect(COACH_TIMEOUT_MS).toBe(4500);
    expect(clock.handles[0]?.ms).toBe(4500);
  });

  it("cancels the deadline once an answer arrives, so no timer outlives the call", async () => {
    const { coach, clock } = build(respondJson(livePayload));
    await coach.request(marsRequest);
    expect(clock.handles[0]?.cancelled).toBe(true);
  });
});

describe("AC-15.1 failure modes", () => {
  it("AC-15.1: timeout -> shipped fallback", async () => {
    const { coach, clock, abort } = build(respondHang);
    const pending = coach.request(marsRequest);
    clock.fireAll();
    const result = await pending;

    expect(result).toEqual({
      note: marsFallback.note,
      variants: marsFallback.variants,
      source: "fallback",
      failure: "timeout",
      transport: "proxy",
      // A note-only request never asks for a composed warp sentence, so the
      // scene keeps the stop's shipped static one (D09, E-AI-1).
      sentence: { ok: false, reason: "absent" },
    });
    // A request nobody is listening to must not hold a socket open (D32).
    expect(abort.aborted()).toBe(1);
    expectIdenticalShape(result);
  });

  it("AC-15.1: network error -> shipped fallback", async () => {
    const { coach } = build(respondNetworkError);
    const result = await coach.request(marsRequest);
    expect(result.source).toBe("fallback");
    expect(result.failure).toBe("network");
    expect(result.note).toBe(marsFallback.note);
    expectIdenticalShape(result);
  });

  it("AC-15.1: non-200 -> shipped fallback", async () => {
    for (const status of [429, 500, 502]) {
      const { coach } = build(respondStatus(status));
      const result = await coach.request(marsRequest);
      expect(result.failure).toBe("status");
      expect(result.source).toBe("fallback");
      expectIdenticalShape(result);
    }
  });

  it("AC-15.1: malformed JSON -> shipped fallback", async () => {
    const { coach } = build(respondMalformed);
    const result = await coach.request(marsRequest);
    expect(result.failure).toBe("malformed");
    expect(result.note).toBe(marsFallback.note);
    expectIdenticalShape(result);
  });

  it("AC-15.1: schema mismatch -> shipped fallback", async () => {
    const { coach } = build(respondJson({ note: "fine", variants: ["only one"] }));
    const result = await coach.request(marsRequest);
    expect(result.failure).toBe("schema");
    expect(result.note).toBe(marsFallback.note);
    expectIdenticalShape(result);
  });

  it("AC-15.1 + AC-15.2: a validation failure is indistinguishable from a timeout to the UI", async () => {
    const smuggled = build(
      respondJson({ ...livePayload, note: "Watch for zorblax next time." }),
    );
    const timedOut = build(respondHang);
    const pendingTimeout = timedOut.coach.request(marsRequest);
    timedOut.clock.fireAll();

    const a = await smuggled.coach.request(marsRequest);
    const b = await pendingTimeout;

    // Same note, same variants, same source. Only the private `failure` label
    // differs, and nothing in src/game is allowed to branch on it.
    expect(a.note).toBe(b.note);
    expect(a.variants).toEqual(b.variants);
    expect(a.source).toBe(b.source);
    expect(a.failure).toBe("allowlist");
    expect(b.failure).toBe("timeout");
  });

  it("AC-15.1: the fallback is never empty, for any stop or language", async () => {
    for (const stopId of ["mars", "jupiter", "pluto"] as const) {
      for (const lang of ["en", "es", "hi"] as const) {
        const { coach } = build(respondNetworkError);
        const result = await coach.request({ ...marsRequest, stopId, lang });
        expect(result.note.trim().length).toBeGreaterThan(0);
        expect(result.variants).toHaveLength(2);
      }
    }
  });
});

describe("ProxyCoach wiring", () => {
  it("works with no abort port at all (signal is simply absent)", async () => {
    const fetch = createFakeFetch(respondJson(livePayload) as never);
    const clock = createFakeTimer();
    const coach = createProxyCoach({
      fetchImpl: fetch.fetchImpl,
      timer: clock.timer,
      validator,
    });
    const result = await coach.request(marsRequest);
    expect(fetch.calls[0]?.signal).toBeUndefined();
    expect(result.source).toBe("live");
  });

  it("a timeout with no abort port still falls back cleanly", async () => {
    const fetch = createFakeFetch(respondHang as never);
    const clock = createFakeTimer();
    const coach = createProxyCoach({
      fetchImpl: fetch.fetchImpl,
      timer: clock.timer,
      validator,
    });
    const pending = coach.request(marsRequest);
    clock.fireAll();
    expect((await pending).failure).toBe("timeout");
  });

  it("honours an injected url, timeout and fallback bundle", async () => {
    const fetch = createFakeFetch(respondHang as never);
    const clock = createFakeTimer();
    const coach = createProxyCoach({
      fetchImpl: fetch.fetchImpl,
      timer: clock.timer,
      validator: createCoachValidator({ allowlist: permissiveAllowlist }),
      url: "/api/coach-canary",
      timeoutMs: 800,
      fallback: {
        byLang: {
          en: { base: { note: "Custom.", variants: ["A.", "B."] }, byStop: {} },
          es: { base: { note: "Custom es.", variants: ["A.", "B."] }, byStop: {} },
          hi: { base: { note: "Custom hi.", variants: ["A.", "B."] }, byStop: {} },
        },
      },
    });
    const pending = coach.request(marsRequest);
    clock.fireAll();
    const result = await pending;

    expect(fetch.calls[0]?.url).toBe("/api/coach-canary");
    expect(clock.handles[0]?.ms).toBe(800);
    expect(result.note).toBe("Custom.");
  });
});
