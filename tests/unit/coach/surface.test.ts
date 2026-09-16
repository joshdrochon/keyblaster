import { describe, expect, it } from "vitest";
import {
  COACH_TIMEOUT_MS,
  DEFAULT_FALLBACK_BUNDLE,
  createCoachValidator,
  createMockCoach,
  createNeverTimer,
  createProxyCoach,
  createRealTimer,
  fallbackResult,
  postJson,
  settle,
  type CoachClient,
} from "@engine/coach/index.js";
import { createDirectCoach } from "@engine/coach/direct.js";
import {
  allowlist,
  createFakeFetch,
  createFakeTimer,
  marsRequest,
  respondHang,
  respondJson,
} from "./fixtures.js";

/**
 * AC-15.4: ONE interface, three transports. This file holds the three of them
 * to the same contract, and covers the small shared pieces (timer port,
 * pipeline helpers) that the transport tests exercise only indirectly.
 */

const validator = createCoachValidator({ allowlist });

const livePayload = {
  note: "Nice flying, pilot. Watch for rivers and empty next time.",
  variants: ["Mars is the red planet.", "Its dust is full of rust."],
};

function allThree(): CoachClient[] {
  const fetch = createFakeFetch(respondJson(livePayload) as never);
  const clock = createFakeTimer();
  return [
    createProxyCoach({ fetchImpl: fetch.fetchImpl, timer: clock.timer, validator }),
    createMockCoach({ validator }),
    createDirectCoach({
      devFlag: true,
      apiKey: "sk-ant-test",
      fetchImpl: createFakeFetch(
        respondJson({
          content: [{ type: "text", text: JSON.stringify(livePayload) }],
        }) as never,
      ).fetchImpl,
      timer: clock.timer,
      validator,
    }),
  ];
}

describe("AC-15.4: three transports behind one interface", () => {
  it("AC-15.4: all three satisfy the same CoachClient contract", async () => {
    const names = new Set<string>();
    for (const client of allThree()) {
      names.add(client.transport);
      const result = await client.request(marsRequest);
      expect(typeof result.note).toBe("string");
      expect(result.note.trim().length).toBeGreaterThan(0);
      expect(result.variants).toHaveLength(2);
      expect(result.source === "live" || result.source === "fallback").toBe(true);
      expect(result.transport).toBe(client.transport);
    }
    expect([...names].sort()).toEqual(["direct", "mock", "proxy"]);
  });

  it("AC-15.4: a caller can swap transports without changing one line downstream", async () => {
    const read = async (client: CoachClient): Promise<string[]> => {
      const r = await client.request(marsRequest);
      return [r.note, ...r.variants];
    };
    for (const client of allThree()) {
      const lines = await read(client);
      expect(lines).toHaveLength(3);
      for (const line of lines) expect(line.trim().length).toBeGreaterThan(0);
    }
  });

  it("AC-15.1: all three carry the same 1500 ms deadline", () => {
    expect(COACH_TIMEOUT_MS).toBe(1500);
  });
});

describe("pipeline helpers", () => {
  it("settle turns a valid payload into a live result", () => {
    const result = settle(
      livePayload,
      marsRequest,
      validator,
      DEFAULT_FALLBACK_BUNDLE,
      "mock",
    );
    expect(result.source).toBe("live");
    expect(result.note).toBe(livePayload.note);
  });

  it("AC-15.1: postJson reports each wire failure distinctly", async () => {
    const clock = createFakeTimer();
    const run = async (answer: () => Promise<unknown>): Promise<unknown> =>
      postJson({
        fetchImpl: createFakeFetch(answer as never).fetchImpl,
        timer: clock.timer,
        timeoutMs: 1500,
        url: "/api/coach",
        headers: {},
        body: {},
      });

    expect(await run(() => Promise.reject(new Error("down")))).toEqual({
      ok: false,
      failure: "network",
    });
    expect(
      await run(() =>
        Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve({}) }),
      ),
    ).toEqual({ ok: false, failure: "status" });
  });

  it("AC-15.1: postJson times out against an injected timer", async () => {
    const clock = createFakeTimer();
    const pending = postJson({
      fetchImpl: createFakeFetch(respondHang as never).fetchImpl,
      timer: clock.timer,
      timeoutMs: 1500,
      url: "/api/coach",
      headers: {},
      body: {},
    });
    clock.fireAll();
    expect(await pending).toEqual({ ok: false, failure: "timeout" });
  });
});

describe("timer port", () => {
  it("createRealTimer resolves after the delay and cancels cleanly", async () => {
    const timer = createRealTimer();
    const handle = timer(1);
    await handle.expired;
    handle.cancel(); // after the fact: must not throw
    expect(true).toBe(true);
  });

  it("createRealTimer cancel stops a pending deadline", async () => {
    const timer = createRealTimer();
    const handle = timer(5);
    handle.cancel();
    const raced = await Promise.race([
      handle.expired.then(() => "fired"),
      new Promise((resolve) => setTimeout(() => resolve("still pending"), 20)),
    ]);
    expect(raced).toBe("still pending");
  });

  it("createNeverTimer never fires, so the wire always wins", async () => {
    const fetch = createFakeFetch(respondJson(livePayload) as never);
    const coach = createProxyCoach({
      fetchImpl: fetch.fetchImpl,
      timer: createNeverTimer(),
      validator,
    });
    const result = await coach.request(marsRequest);
    expect(result.source).toBe("live");
    // cancel() on a never-timer is a no-op and must not throw.
    createNeverTimer()(10).cancel();
  });
});

describe("fallbackResult", () => {
  it("AC-15.1: labels the failure but keeps the shape identical", () => {
    const result = fallbackResult(DEFAULT_FALLBACK_BUNDLE, marsRequest, "proxy", "network");
    expect(result.source).toBe("fallback");
    expect(result.failure).toBe("network");
    expect(result.variants).toHaveLength(2);
  });
});
