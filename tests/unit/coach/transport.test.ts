import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DIRECT_COACH_FORBIDDEN } from "@engine/coach/buildGuard.js";
import {
  chooseTransport,
  sameOriginPath,
  type TransportEnv,
} from "@game/coach/transport.js";

/**
 * TRANSPORT SELECTION - AC-15.4, D47, D87.
 *
 * `createProxyCoach` had no caller anywhere in `src/`, so "three transports
 * behind one interface" was a property of the unit tests and of nothing else.
 * `@game/coach/transport.ts` is the composition root that makes it true, and
 * this file holds it to the two rules that matter:
 *
 *   1. MOCK IS THE DEFAULT, EXPLICITLY. Not "because nothing else was wired".
 *      An automated run - vitest, Playwright, the gauntlet - is always mock,
 *      because D87 forbids live paid calls in the build loop.
 *   2. THE DIRECT PATH NEVER REACHES A PRODUCTION BUNDLE. Asserted by walking
 *      the real import graph from the real entry point, not by intent.
 *
 * `createCoachClient` itself is not constructed here: it reaches for
 * `import.meta.env`, `window` and `fetch`, and the decision it makes is
 * `chooseTransport`, which is pure. That split is the point of the split.
 */

const env = (over: Partial<TransportEnv> = {}): TransportEnv => ({
  endpoint: null,
  automated: false,
  override: null,
  ...over,
});

describe("chooseTransport (AC-15.4, D87)", () => {
  it("D87: an automated run is ALWAYS the mock, even with an endpoint configured", () => {
    expect(chooseTransport(env({ automated: true }))).toBe("mock");
    expect(
      chooseTransport(env({ automated: true, endpoint: "/api/coach" })),
    ).toBe("mock");
  });

  it("AC-15.4: the mock is the default when no endpoint is configured", () => {
    expect(chooseTransport(env())).toBe("mock");
  });

  it("AC-15.4: the proxy is used when, and only when, an endpoint is configured", () => {
    expect(chooseTransport(env({ endpoint: "/api/coach" }))).toBe("proxy");
    expect(chooseTransport(env({ endpoint: "" }))).toBe("mock");
  });

  it("an explicit mock override always wins - the cheap path is always reachable", () => {
    expect(
      chooseTransport(env({ override: "mock", endpoint: "/api/coach" })),
    ).toBe("mock");
    expect(
      chooseTransport(env({ override: "mock", automated: true })),
    ).toBe("mock");
  });

  it("an explicit proxy override still needs an endpoint, and degrades to mock", () => {
    expect(chooseTransport(env({ override: "proxy" }))).toBe("mock");
    expect(
      chooseTransport(env({ override: "proxy", endpoint: "/api/coach" })),
    ).toBe("proxy");
  });

  it("never returns the direct transport, whatever it is handed", () => {
    // AC-15.4: direct is a dev flag, not a deployment mode. No combination of
    // env, override and endpoint can select it, because this function cannot
    // name it.
    for (const automated of [true, false]) {
      for (const endpoint of [null, "", "/api/coach"]) {
        for (const override of [null, "mock", "proxy"] as const) {
          expect(["mock", "proxy"]).toContain(
            chooseTransport(env({ automated, endpoint, override })),
          );
        }
      }
    }
  });
});

describe("sameOriginPath (D47)", () => {
  it("accepts a same-origin absolute path", () => {
    expect(sameOriginPath("/api/coach")).toBe("/api/coach");
    expect(sameOriginPath("  /api/coach  ")).toBe("/api/coach");
  });

  it("refuses anything that could send a child's words to a third party", () => {
    // The request carries the words they missed. D47's whole posture is that
    // only our own function ever sees them.
    expect(sameOriginPath("https://evil.example/coach")).toBeNull();
    expect(sameOriginPath("//evil.example/coach")).toBeNull();
    expect(sameOriginPath("api/coach")).toBeNull();
    expect(sameOriginPath("")).toBeNull();
    expect(sameOriginPath(null)).toBeNull();
    expect(sameOriginPath(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The direct path is unreachable from the shipped graph (AC-15.4, build half)
// ---------------------------------------------------------------------------

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SRC = join(REPO, "src");

const ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["@engine/", join(SRC, "engine/")],
  ["@game/", join(SRC, "game/")],
  ["@content/", join(SRC, "content/")],
];

/** Resolve an import specifier to a file under src/, or null if it is external. */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string | null = null;
  if (spec.startsWith(".")) {
    base = resolve(dirname(fromFile), spec);
  } else {
    for (const [prefix, target] of ALIASES) {
      if (spec.startsWith(prefix)) {
        base = join(target, spec.slice(prefix.length));
        break;
      }
    }
  }
  if (base === null) return null; // phaser, node builtins, anything external

  const candidates = [
    base.replace(/\.js$/, ".ts"),
    `${base}.ts`,
    join(base, "index.ts"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && candidate.endsWith(".ts")) return candidate;
  }
  return null;
}

/**
 * Every static and dynamic import in a module. Type-only imports are INCLUDED
 * deliberately: a type import is erased by the compiler, so counting it can
 * only make this check stricter than the bundler, never looser.
 */
function importsOf(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of src.matchAll(/\bfrom\s+["']([^"']+)["']/g)) out.push(m[1] as string);
  for (const m of src.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    out.push(m[1] as string);
  }
  for (const m of src.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) {
    out.push(m[1] as string);
  }
  return out;
}

/** Transitive closure of src/ modules reachable from an entry point. */
function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of importsOf(file)) {
      const target = resolveSpecifier(file, spec);
      if (target !== null && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

describe("AC-15.4: the direct transport is unreachable in prod builds", () => {
  const DIRECT = join(SRC, "engine/coach/direct.ts");
  const GUARD = join(SRC, "engine/coach/buildGuard.ts");

  it("the walker can actually see the file it is looking for", () => {
    // A graph check that silently resolves nothing passes forever. This asserts
    // the resolver works by proving direct.ts IS reachable from something.
    expect(existsSync(DIRECT)).toBe(true);
    expect(reachableFrom(GUARD).has(DIRECT)).toBe(true);
  });

  it("src/main.ts does not reach src/engine/coach/direct.ts", () => {
    const graph = reachableFrom(join(SRC, "main.ts"));
    // Sanity: the entry really does pull the game in.
    expect(graph.has(join(SRC, "game/boot.ts"))).toBe(true);
    expect([...graph].filter((f) => f === DIRECT)).toEqual([]);
  });

  it("the transport composition root does not reach it either", () => {
    const graph = reachableFrom(join(SRC, "game/coach/transport.ts"));
    expect(graph.has(join(SRC, "engine/coach/proxy.ts"))).toBe(true);
    expect(graph.has(join(SRC, "engine/coach/mock.ts"))).toBe(true);
    expect(graph.has(DIRECT)).toBe(false);
    expect(graph.has(GUARD)).toBe(false);
  });

  it("no module reachable from src/main.ts mentions a forbidden string", () => {
    // The same needles `buildGuard` greps a built bundle for, applied to the
    // source graph so the failure arrives before a build rather than after one.
    const graph = reachableFrom(join(SRC, "main.ts"));
    const hits: string[] = [];
    for (const file of graph) {
      const text = readFileSync(file, "utf8");
      for (const needle of DIRECT_COACH_FORBIDDEN) {
        if (text.includes(needle)) hits.push(`${file}: ${needle}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
