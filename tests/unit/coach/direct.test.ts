import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createCoachValidator } from "@engine/coach/index.js";
import {
  ANTHROPIC_MESSAGES_URL,
  ANTHROPIC_VERSION,
  COACH_MAX_TOKENS,
  COACH_MODEL,
  DIRECT_COACH_MARKER,
  DirectCoachUnavailableError,
  createDirectCoach,
  extractPayload,
} from "@engine/coach/direct.js";
import { buildSystemPrompt, buildUserPrompt } from "@engine/coach/prompt.js";
import {
  DIRECT_COACH_FORBIDDEN,
  directCoachIssues,
} from "@engine/coach/buildGuard.js";
import {
  allowlist,
  createFakeFetch,
  createFakeTimer,
  marsRequest,
  respondHang,
  respondJson,
} from "./fixtures.js";

/**
 * AC-15.4: three transports behind one interface, and the direct path is
 * unreachable in prod builds.
 *
 * This file also stands in for the build test's logic: the graph check below
 * walks the real files, and `directCoachIssues` is the scan the gauntlet's
 * build step runs against dist/ (buildGuard.ts).
 */

const COACH_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../src/engine/coach",
);

const validator = createCoachValidator({ allowlist });

/** A Messages API response carrying a JSON note. */
const anthropicResponse = (payload: unknown, wrapper = "") => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  model: COACH_MODEL,
  content: [{ type: "text", text: `${wrapper}${JSON.stringify(payload)}${wrapper}` }],
});

const livePayload = {
  note: "Nice flying, pilot. Watch for rivers and empty next time.",
  variants: ["Mars is the red planet.", "Its dust is full of rust."],
};

function build(answer: () => Promise<unknown>, apiKey = "sk-ant-test-injected") {
  const fetch = createFakeFetch(answer as never);
  const clock = createFakeTimer();
  const coach = createDirectCoach({
    devFlag: true,
    apiKey,
    fetchImpl: fetch.fetchImpl,
    timer: clock.timer,
    validator,
  });
  return { coach, fetch, clock };
}

describe("AC-15.4: DirectCoach is unreachable in prod builds", () => {
  it("AC-15.4: index.ts does not reach direct.ts through any import path", () => {
    // Walk the real import graph from the module's public entry point. If
    // direct.ts is unreachable, a bundler tree-shakes it out; nothing else is
    // needed and no build flag has to be trusted.
    const seen = new Set<string>();
    const queue = ["index.ts"];

    while (queue.length > 0) {
      const file = queue.pop();
      if (file === undefined || seen.has(file)) continue;
      seen.add(file);
      const source = readFileSync(join(COACH_DIR, file), "utf8");
      for (const match of source.matchAll(/from\s+"\.\/([A-Za-z]+)\.js"/g)) {
        const next = `${match[1] ?? ""}.ts`;
        if (!seen.has(next)) queue.push(next);
      }
    }

    expect([...seen].sort()).not.toContain("direct.ts");
    expect([...seen].sort()).not.toContain("prompt.ts");
    expect([...seen].sort()).not.toContain("buildGuard.ts");
    // Sanity: the walk actually walked something.
    expect(seen.size).toBeGreaterThan(5);
  });

  it("AC-15.4: the marker string appears in exactly one source file", () => {
    const hits = readdirSync(COACH_DIR).filter((name) =>
      readFileSync(join(COACH_DIR, name), "utf8").includes(DIRECT_COACH_MARKER),
    );
    expect(hits).toEqual(["direct.ts"]);
  });

  it("AC-15.4: directCoachIssues flags a bundle that contains the direct path", () => {
    expect(directCoachIssues("var a=1;// harmless bundle")).toEqual([]);
    for (const needle of DIRECT_COACH_FORBIDDEN) {
      expect(directCoachIssues(`prefix ${needle} suffix`)).toHaveLength(1);
    }
    expect(
      directCoachIssues(`${DIRECT_COACH_MARKER} ${ANTHROPIC_MESSAGES_URL}`),
    ).toHaveLength(2);
  });

  it("AC-15.4: construction throws without an explicit dev flag", () => {
    const fetch = createFakeFetch(respondJson({}) as never);
    const clock = createFakeTimer();
    const base = {
      apiKey: "sk-ant-test",
      fetchImpl: fetch.fetchImpl,
      timer: clock.timer,
      validator,
    };
    expect(() => createDirectCoach({ ...base, devFlag: false })).toThrow(
      DirectCoachUnavailableError,
    );
    // A truthy-but-not-true flag is still a refusal.
    expect(() =>
      createDirectCoach({ ...base, devFlag: 1 as unknown as boolean }),
    ).toThrow(DirectCoachUnavailableError);
  });

  it("D47: construction throws when no key is injected, and never reads env", () => {
    const fetch = createFakeFetch(respondJson({}) as never);
    const clock = createFakeTimer();
    const base = {
      devFlag: true as const,
      fetchImpl: fetch.fetchImpl,
      timer: clock.timer,
      validator,
    };
    expect(() => createDirectCoach({ ...base, apiKey: "" })).toThrow(
      /no apiKey was injected/,
    );
    expect(() => createDirectCoach({ ...base, apiKey: "   " })).toThrow(
      DirectCoachUnavailableError,
    );
    expect(() =>
      createDirectCoach({ ...base, apiKey: undefined as unknown as string }),
    ).toThrow(DirectCoachUnavailableError);
  });

  it("D47: no file in the module reads process.env or hardcodes a key", () => {
    // Comments are stripped first: several files SAY "process.env is never
    // read", and a scan that trips on its own documentation is useless.
    const stripComments = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

    for (const name of readdirSync(COACH_DIR)) {
      const source = stripComments(readFileSync(join(COACH_DIR, name), "utf8"));
      expect(source, `${name} reads process.env`).not.toMatch(/process\s*\.\s*env/);
      expect(source, `${name} contains a key-shaped literal`).not.toMatch(
        /["'`]sk-ant-[A-Za-z0-9_-]{8}/,
      );
    }
  });
});

describe("DirectCoach request shape (D92)", () => {
  it("D92: uses Claude Haiku 4.5 at the id the decision log pins", async () => {
    const { coach, fetch } = build(respondJson(anthropicResponse(livePayload)));
    const result = await coach.request(marsRequest);

    const call = fetch.calls[0];
    expect(call?.url).toBe(ANTHROPIC_MESSAGES_URL);
    expect(call?.body).toMatchObject({
      model: "claude-haiku-4-5-20251001",
      max_tokens: COACH_MAX_TOKENS,
    });
    expect(COACH_MODEL).toBe("claude-haiku-4-5-20251001");
    expect(result.source).toBe("live");
    expect(result.transport).toBe("direct");
  });

  it("D47: the injected key rides in the header and nowhere else", async () => {
    const { coach, fetch } = build(
      respondJson(anthropicResponse(livePayload)),
      "sk-ant-injected-by-the-dev-script",
    );
    await coach.request(marsRequest);
    const call = fetch.calls[0];
    expect(call?.headers["x-api-key"]).toBe("sk-ant-injected-by-the-dev-script");
    expect(call?.headers["anthropic-version"]).toBe(ANTHROPIC_VERSION);
    expect(JSON.stringify(call?.body)).not.toContain("sk-ant");
  });

  it("D34: the prompt states the voice rules and carries only filtered words", async () => {
    const { coach, fetch } = build(respondJson(anthropicResponse(livePayload)));
    await coach.request({ ...marsRequest, missed: ["rivers", "zorblax"] });
    const body = JSON.stringify(fetch.calls[0]?.body);
    expect(body).toContain("rivers");
    expect(body).not.toContain("zorblax");
    expect(body).toContain("NEVER use the word");
  });

  it("AC-15.1: DirectCoach honours the same 1500 ms deadline and fallback", async () => {
    const { coach, clock } = build(respondHang);
    const pending = coach.request(marsRequest);
    expect(clock.handles[0]?.ms).toBe(1500);
    clock.fireAll();
    const result = await pending;
    expect(result.source).toBe("fallback");
    expect(result.failure).toBe("timeout");
    expect(result.transport).toBe("direct");
  });

  it("AC-15.1: a response with no extractable JSON falls back as malformed", async () => {
    for (const body of [
      { content: [{ type: "text", text: "Sorry, I cannot help with that." }] },
      { content: [{ type: "text", text: "{not json at all" }] },
      { content: [{ type: "text", text: "{ this looks like json but is not }" }] },
      { content: [{ type: "tool_use", id: "x" }] },
      { content: "not an array" },
      { nothing: true },
      null,
      "a string",
    ]) {
      const { coach } = build(respondJson(body));
      const result = await coach.request(marsRequest);
      expect(result.failure).toBe("malformed");
      expect(result.source).toBe("fallback");
      expect(result.note.trim().length).toBeGreaterThan(0);
    }
  });

  it("tolerates a fenced or chatty response, because the validator runs anyway", async () => {
    const { coach } = build(
      respondJson({
        content: [
          { type: "text", text: `Here you go:\n\`\`\`json\n${JSON.stringify(livePayload)}\n\`\`\`` },
        ],
      }),
    );
    expect((await coach.request(marsRequest)).source).toBe("live");
  });

  it("skips non-text blocks and finds the payload in a later one", () => {
    expect(
      extractPayload({
        content: [
          null,
          { type: "thinking", thinking: "..." },
          { type: "text", text: "no braces here" },
          { type: "text", text: '{"note":"ok","variants":["a","b"]}' },
        ],
      }),
    ).toEqual({ note: "ok", variants: ["a", "b"] });
  });

  it("honours an injected base url, model, token cap and timeout", async () => {
    const fetch = createFakeFetch(respondHang as never);
    const clock = createFakeTimer();
    const coach = createDirectCoach({
      devFlag: true,
      apiKey: "sk-ant-test",
      fetchImpl: fetch.fetchImpl,
      timer: clock.timer,
      validator,
      baseUrl: "http://localhost:9/v1/messages",
      model: "claude-haiku-4-5",
      maxTokens: 64,
      timeoutMs: 250,
    });
    const pending = coach.request(marsRequest);
    clock.fireAll();
    await pending;

    expect(fetch.calls[0]?.url).toBe("http://localhost:9/v1/messages");
    expect(fetch.calls[0]?.body).toMatchObject({
      model: "claude-haiku-4-5",
      max_tokens: 64,
    });
    expect(clock.handles[0]?.ms).toBe(250);
  });
});

describe("prompt (D33, D34, D66)", () => {
  it("AC-25.3: the system prompt forbids the word Shadow may never say", () => {
    for (const lang of ["en", "es", "hi"] as const) {
      const prompt = buildSystemPrompt(lang);
      expect(prompt).toContain("Shadow");
      expect(prompt).toContain('NEVER use the word "wrong"');
      expect(prompt).toContain("at most 20 words");
    }
    expect(buildSystemPrompt("es")).toContain("Spanish");
    expect(buildSystemPrompt("hi")).toContain("Hindi");
    expect(buildSystemPrompt("en", 12)).toContain("at most 12 words");
  });

  it("the user turn carries the FR-15 inputs, with (none) for empty lists", () => {
    const filled = buildUserPrompt({
      stopId: "mars",
      lang: "en",
      missed: ["rivers", "empty"],
      slow: ["across"],
      hitRate: 0.85,
    });
    expect(filled).toContain("missed: rivers, empty");
    expect(filled).toContain("slow: across");
    expect(filled).toContain("hit rate: 85%");

    const empty = buildUserPrompt({
      stopId: "pluto",
      lang: "en",
      missed: [],
      slow: [],
      hitRate: 1,
    });
    expect(empty).toContain("missed: (none)");
    expect(empty).toContain("slow: (none)");
  });
});
