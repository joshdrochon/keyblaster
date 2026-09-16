/**
 * /api/coach — the one server-side surface in the game (D47, D33, D92).
 *
 * WHY THIS FILE EXISTS AT ALL: the Anthropic key must never reach a browser
 * (NFR-4, CLAUDE.md). The client calls here; this calls Anthropic. Nothing
 * else in the product talks to a paid API.
 *
 * WHAT IT IS NOT: it is not in the game loop. It is called exactly once per
 * warp break (AC-15.3), never during flight, never on Earth. If it is slow or
 * down, the client gives up at 1500 ms and uses its shipped fallback bundle
 * (AC-15.1) — so this endpoint failing degrades the game by exactly nothing.
 *
 * DEPLOYMENT IS NOT AUTOMATED. The user deploys (architecture §9, D87). This
 * file is never invoked by the gauntlet, which mocks the coach by default.
 */

/** D92: chosen for latency inside the 1500 ms client budget. */
const MODEL = "claude-haiku-4-5-20251001";

/** Keep well inside the client's 1500 ms so it is the client that gives up. */
const UPSTREAM_TIMEOUT_MS = 1200;
const MAX_TOKENS = 300;

/** Per-IP rate limit (architecture §1: "Rate-limited per IP"). */
const RATE_LIMIT = { windowMs: 60_000, maxRequests: 12 } as const;

/**
 * In-memory limiter. Serverless instances are ephemeral and not shared, so
 * this is a courtesy brake against a single abusive client hitting one warm
 * instance, NOT a security control. It is deliberately not a KV store: adding
 * one would mean another vendor, another key, and a PII surface (NFR-3) for a
 * game whose worst-case abuse is a few cents of Haiku tokens.
 */
const hits = new Map<string, number[]>();

function rateLimited(ip: string, now: number): boolean {
  const cutoff = now - RATE_LIMIT.windowMs;
  const recent = (hits.get(ip) ?? []).filter((t) => t > cutoff);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear(); // crude bound; instance is ephemeral
  return recent.length > RATE_LIMIT.maxRequests;
}

export interface CoachRequest {
  stopId: string;
  lang: string;
  missed: string[];
  slow: string[];
  hitRate: number;
}

const STOPS = ["mars", "jupiter", "saturn", "uranus", "neptune", "pluto"];
const LANGS = ["en", "es", "hi"];

/** Reject anything that is not the documented shape, before spending a token. */
function parseRequest(body: unknown): CoachRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const words = (v: unknown): string[] | null => {
    if (!Array.isArray(v) || v.length > 12) return null;
    if (!v.every((w) => typeof w === "string" && w.length > 0 && w.length <= 20)) return null;
    return v as string[];
  };
  const missed = words(b["missed"]);
  const slow = words(b["slow"]);
  if (!missed || !slow) return null;
  // Earth is the launchpad and has no belt, so it never produces a coach call
  // (AC-15.3, D57). A request naming it is a client bug, not a valid input.
  if (typeof b["stopId"] !== "string" || !STOPS.includes(b["stopId"])) return null;
  if (typeof b["lang"] !== "string" || !LANGS.includes(b["lang"])) return null;
  const hitRate = b["hitRate"];
  if (typeof hitRate !== "number" || !Number.isFinite(hitRate) || hitRate < 0 || hitRate > 1) {
    return null;
  }
  return { stopId: b["stopId"], lang: b["lang"], missed, slow, hitRate };
}

/**
 * Shadow's voice (D66, D33, story note 6). The "never says wrong" line is not
 * decoration: D31 forbids anything that reads as punishment, and AC-25.3 makes
 * it a test. The client re-validates everything this returns (AC-15.2) — this
 * prompt is the first of three guardrail layers (D34), never the only one.
 */
function systemPrompt(req: CoachRequest): string {
  return [
    "You are Shadow, a small navigation robot flying with a child pilot aged 7 to 11.",
    "You speak in short, warm, plain sentences. You are never sarcastic and never baby-talk.",
    "",
    "Write ONE coach note of at most 20 words about the words the pilot found hard.",
    "Name the specific words. Sound like a friend noticing something, not a teacher marking work.",
    "",
    "Absolute rules:",
    '- Never use the word "wrong", or any synonym for failure, mistake, error or bad.',
    "- Never mention scores, percentages, ranks or how many were missed.",
    "- Only use simple words a 7-year-old reads, plus the named words themselves.",
    "- No emoji. No exclamation stacking. One sentence is usually enough.",
    "",
    `The pilot is at ${req.stopId}. Reply as JSON only:`,
    '{"note": "<=20 words", "variants": ["<sentence>", "<sentence>"]}',
    "The two variants are practice sentences for the next stage, each using only",
    "the named words plus very common English words.",
  ].join("\n");
}

function userPrompt(req: CoachRequest): string {
  const missed = req.missed.length ? req.missed.join(", ") : "(none)";
  const slow = req.slow.length ? req.slow.join(", ") : "(none)";
  return `Words that got past us: ${missed}\nWords that took a moment: ${slow}`;
}

export default async function handler(request: Request): Promise<Response> {
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });

  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(ip, Date.now())) return json({ error: "rate_limited" }, 429);

  const key = process.env["ANTHROPIC_API_KEY"];
  // No key configured is not an error worth surfacing: the client has a shipped
  // fallback and the game is identical without us (AC-15.1).
  if (!key) return json({ error: "unconfigured" }, 503);

  let parsed: CoachRequest | null;
  try {
    parsed = parseRequest(await request.json());
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (!parsed) return json({ error: "bad_request" }, 400);

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: abort.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt(parsed),
        messages: [{ role: "user", content: userPrompt(parsed) }],
      }),
    });

    if (!upstream.ok) return json({ error: "upstream" }, 502);

    const data = (await upstream.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((c) => c.type === "text")?.text ?? "";

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return json({ error: "unparseable" }, 502);
    }

    const p = payload as Record<string, unknown>;
    if (
      typeof p["note"] !== "string" ||
      !Array.isArray(p["variants"]) ||
      p["variants"].length !== 2 ||
      !p["variants"].every((v) => typeof v === "string")
    ) {
      return json({ error: "schema" }, 502);
    }

    // The client validates again against the compiled allowlist (AC-15.2).
    // This is a cheap first pass, not the guardrail.
    return json({ note: p["note"], variants: p["variants"] }, 200);
  } catch {
    return json({ error: "timeout" }, 504);
  } finally {
    clearTimeout(timer);
  }
}
