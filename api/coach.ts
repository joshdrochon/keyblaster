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

/**
 * Measured: a warp reply lands in 1.75-2.8 s, so the old 1200 ms killed every
 * call. Kept inside `COACH_TIMEOUT_MS` (4500) so the server gives up first.
 */
const UPSTREAM_TIMEOUT_MS = 4000;
const MAX_TOKENS = 300;
/** A warp reply carries the note, both variants AND the practice sentence. */
const WARP_MAX_TOKENS = 420;

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

/**
 * Two request shapes, one endpoint (E-AI-1).
 *
 *   mode omitted / "note"  the coach note this endpoint has always returned.
 *   mode "warp"            the SAME call, plus the warp sentence composed from
 *                          the words this child just practised (D09, FR-16).
 *
 * It is one call either way, because D33 allows exactly one per warp break and
 * AC-15.3 counts them. The warp shape is a different SYSTEM PROMPT and a
 * bigger reply, not a second round trip.
 */
export type CoachMode = "note" | "warp";

export interface CoachRequest {
  stopId: string;
  lang: string;
  missed: string[];
  slow: string[];
  hitRate: number;
  mode: CoachMode;
  /** The stage's asteroid pool. Only these words may appear in the sentence. */
  pool: string[];
  /** Words the child shot down this run. */
  blasted: string[];
}

/**
 * Read the model's JSON, fence or no fence. It returns valid JSON wrapped in a
 * ```json fence, which `JSON.parse` will not eat - so every reply that made it
 * this far used to be thrown away. Tolerated rather than prompted away: a
 * parser cannot be talked out of it by a model having an off day.
 */
export function parseModelJson(raw: string): unknown | null {
  const text = raw.trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(text);
  const body = fenced?.[1]?.trim() ?? text;
  try {
    return JSON.parse(body);
  } catch {
    // Last resort: the outermost object in whatever came back.
    const open = body.indexOf("{");
    const close = body.lastIndexOf("}");
    if (open < 0 || close <= open) return null;
    try {
      return JSON.parse(body.slice(open, close + 1));
    } catch {
      return null;
    }
  }
}

/**
 * Of the three sentences a warp reply carries, the one most likely to survive
 * the client's gates. NOT a gate itself - this function has no compiled
 * allowlist and the client still checks everything. It only picks, using the
 * POOL and SIGHT lists it sent. About half of first choices carry one outside
 * word, and the old code kept the first and threw the other two away.
 */
export function pickSentence(
  candidates: readonly string[],
  allowed: ReadonlySet<string>,
): string | undefined {
  return onListOnly(candidates, allowed)[0] ?? candidates[0];
}

/** Just the candidates whose every word is on the list, in order. */
export function onListOnly(
  candidates: readonly string[],
  allowed: ReadonlySet<string>,
): string[] {
  return candidates.filter((s) => {
    const words = s.toLowerCase().match(/[a-z]+/g) ?? [];
    return words.length > 0 && words.every((w) => allowed.has(w));
  });
}

/** The model marks named words with *stars*; the screen reads double quotes. */
export function starsToQuotes(note: string): string {
  return note.replace(/\*([^*\n]+)\*/g, '"$1"');
}

const STOPS = ["mars", "jupiter", "saturn", "uranus", "neptune", "pluto"];
const LANGS = ["en", "es", "hi"];

/**
 * The sight words the warp prompt offers as filler.
 *
 * A HAND-PICKED SUBSET of `src/content/en/sight-words.json`, not the whole
 * 149-word list: the prompt is inside a 1200 ms budget and every word here is
 * prompt tokens. `tests/unit/coach/warpPrompt.test.ts` asserts every entry is
 * in the shipped sight list AND on the runtime allowlist, so a word added here
 * that the client would then refuse fails a test rather than quietly turning
 * every live sentence into a fallback.
 */
export const WARP_SIGHT_WORDS: readonly string[] = [
  "a", "all", "and", "are", "as", "at", "back", "before", "behind", "but",
  "can", "does", "every", "for", "from", "has", "have", "here", "if", "in",
  "is", "it", "its", "just", "last", "left", "like", "little", "looks", "may",
  "more", "next", "no", "not", "of", "on", "one", "only", "out", "past",
  "pretty", "ready", "rest", "same", "so", "still", "than", "that", "the",
  "them", "they", "this", "those", "to", "two", "up", "us", "way", "we",
  "when", "which", "while", "whole", "will", "with", "you", "your",
];

/**
 * The band the client gate enforces (`src/engine/coach/sentence.ts`), restated
 * to the model. Stating it here does not make it true - the client measures
 * the string it is handed - but a model told the shape returns it far more
 * often, and every fallback is a child who did not get their own sentence.
 */
const WARP_MIN_WORDS = 4;
const WARP_MAX_WORDS = 10;
const WARP_MAX_CHARS = 48;

/** Reject anything that is not the documented shape, before spending a token. */
function parseRequest(body: unknown): CoachRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const list = (v: unknown, cap: number): string[] | null => {
    if (!Array.isArray(v) || v.length > cap) return null;
    if (!v.every((w) => typeof w === "string" && w.length > 0 && w.length <= 20)) return null;
    return v as string[];
  };
  const words = (v: unknown): string[] | null => list(v, 12);
  const missed = words(b["missed"]);
  const slow = words(b["slow"]);
  if (!missed || !slow) return null;

  /**
   * This read 48 on a stale note that a stage pool is ~26 words. Shipped pools
   * are 100 (mars) to 115, so EVERY compose request was refused with a 400
   * before a token was spent - the reason the coach never worked in
   * production. 160 clears the largest pool at ~150 prompt tokens.
   */
  const POOL_CAP = 160;
  const rawMode = b["mode"];
  if (rawMode !== undefined && rawMode !== "note" && rawMode !== "warp") return null;
  const mode: CoachMode = rawMode === "warp" ? "warp" : "note";
  const pool = b["pool"] === undefined ? [] : list(b["pool"], POOL_CAP);
  const blasted = b["blasted"] === undefined ? [] : list(b["blasted"], 48);
  if (!pool || !blasted) return null;
  // A warp request with no pool cannot produce a sentence that satisfies
  // AC-12.3, so it is a client bug rather than a request worth paying for.
  if (mode === "warp" && pool.length === 0) return null;
  // Earth is the launchpad and has no belt, so it never produces a coach call
  // (AC-15.3, D57). A request naming it is a client bug, not a valid input.
  if (typeof b["stopId"] !== "string" || !STOPS.includes(b["stopId"])) return null;
  if (typeof b["lang"] !== "string" || !LANGS.includes(b["lang"])) return null;
  const hitRate = b["hitRate"];
  if (typeof hitRate !== "number" || !Number.isFinite(hitRate) || hitRate < 0 || hitRate > 1) {
    return null;
  }
  return {
    stopId: b["stopId"],
    lang: b["lang"],
    missed,
    slow,
    hitRate,
    mode,
    pool,
    blasted,
  };
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
    // The accent highlight and UR-64's retry promise both read double-quoted
    // runs, so an unquoted note gets neither. Asked for as *stars* because a
    // double quote inside a JSON string value is what the model forgets to
    // escape - it broke its own reply every time. `starsToQuotes` converts.
    "- Wrap every named word in stars, like: You found *rusty* and *dim* hard.",
    "  Star the word only, never a phrase, and star nothing else.",
    "",
    "Absolute rules:",
    '- Never use the word "wrong", or any synonym for failure, mistake, error or bad.',
    "- Never mention scores, percentages, ranks or how many were missed.",
    "- Only use simple words a 7-year-old reads, plus the named words themselves.",
    "- No emoji. No exclamation stacking. ONE sentence, ten words or fewer.",
    "- No contractions: write \"we will\", never \"we'll\". Every word outside the",
    "  starred ones must be one a 7-year-old reads - the shorter the safer.",
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

/**
 * THE SECOND PROMPT SHAPE (E-AI-1, D09, decision-log line 18).
 *
 * The thing this project was built to fix: Type Storm's end-of-level sentence
 * does not reuse the words just typed. This prompt is the fix. It asks for one
 * sentence made out of THIS child's hard words, and the client then refuses it
 * unless every word is on the allowlist, every content word is in this stage's
 * own pool (AC-12.3), and it sits inside the length band the shipped sentences
 * occupy (`src/engine/coach/sentence.ts`).
 *
 * EVERY RULE BELOW IS ALSO ENFORCED BY CODE THAT RUNS ON THE REPLY. This is
 * D34's third layer, the backup, exactly as `engine/coach/prompt.ts` says. A
 * prompt that is the only thing between a language model and a seven-year-old
 * is a design error.
 *
 * THE WORKED EXAMPLES ARE THE SHIPPED SENTENCES, verbatim from
 * `src/content/en/mars.json` and `saturn.json`. They are the calibration for
 * "typeable by a 7-11 year old", so they are what the model is shown.
 */
function warpSystemPrompt(req: CoachRequest): string {
  return [
    ...systemPrompt(req).split("\n"),
    "",
    "THEN, as well as the note, write ONE practice sentence for this pilot to",
    "type right now, at the warp break. This is the sentence they will actually",
    "type, so every rule is hard:",
    "",
    `- Use ONLY words from POOL and SIGHT below. Nothing else, not even a very`,
    "  common word. A single outside word means the sentence is thrown away.",
    // MEASURED: the model does not invent words, it INFLECTS them. Every live
    // reply was rejected on one word - "plains", where the pool carries
    // "plain". The allowlist is exact-match and does not bend, so the prompt
    // has to say this out loud.
    "- Spell every word EXACTLY as it appears in the list. Do not add -s, -es,",
    "  -ed or -ing, and do not change any ending. If the list says \"plain\" you",
    "  may not write \"plains\"; if it says \"moons\" you may not write \"moon\".",
    "- It MUST contain at least one word from HARD. Those words are the point:",
    "  the pilot just struggled with them and this is how they meet them again.",
    `- ${WARP_MIN_WORDS} to ${WARP_MAX_WORDS} words, at most ${WARP_MAX_CHARS} characters, one plain sentence.`,
    "- Letters, spaces and commas only, ending in a single full stop. No digits,",
    "  no quotes, no dashes, no brackets, no exclamation marks, no emoji.",
    `- True about ${req.stopId}, and it must make sense read on its own.`,
    "- Write it the way these are written:",
    '    "Mars is the red planet."',
    '    "Saturn wears rings made of ice and rock."',
    "",
    "Reply as JSON only:",
    '{"note": "<=20 words", "variants": ["<sentence>", "<sentence>"], "sentence": "<the practice sentence>"}',
  ].join("\n");
}

function warpUserPrompt(req: CoachRequest): string {
  // HARD is ordered missed-first: retrieval practice is strongest on the words
  // that actually got past the pilot (E-AI-1), and the model is told to prefer
  // the front of the list.
  const hard = [...req.missed, ...req.slow];
  return [
    userPrompt(req),
    "",
    `HARD (prefer the first of these): ${hard.length ? hard.join(", ") : "(none)"}`,
    `BLASTED this run: ${req.blasted.length ? req.blasted.join(", ") : "(none)"}`,
    `POOL (the only content words allowed): ${req.pool.join(", ")}`,
    `SIGHT (filler words allowed): ${sightFor(req)}`,
  ].join("\n");
}

function sightFor(req: CoachRequest): string {
  return req.lang === "en" ? WARP_SIGHT_WORDS.join(", ") : "(none)";
}

/**
 * THE EDGE RUNTIME, AND IT IS NOT OPTIONAL (UR-100).
 *
 * The handler below takes a Web `Request` and returns a Web `Response`, which
 * is the EDGE runtime's contract. Vercel's default is NODE, whose contract is
 * `(req, res)` - so without this the function was deployed, invoked, and
 * crashed on every call with FUNCTION_INVOCATION_FAILED. Verified against the
 * live deployment before this line existed.
 *
 * The client gives up at 1500 ms and uses its shipped fallback (AC-15.1), so
 * the game looked perfectly fine while its one server surface was dead - which
 * is exactly why this had to be checked against the deployment rather than
 * against a green build.
 */
export const config = { runtime: "edge" } as const;

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

  const warp = parsed.mode === "warp";
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
        max_tokens: warp ? WARP_MAX_TOKENS : MAX_TOKENS,
        system: warp ? warpSystemPrompt(parsed) : systemPrompt(parsed),
        messages: [
          { role: "user", content: warp ? warpUserPrompt(parsed) : userPrompt(parsed) },
        ],
      }),
    });

    if (!upstream.ok) return json({ error: "upstream" }, 502);

    const data = (await upstream.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((c) => c.type === "text")?.text ?? "";

    const payload = parseModelJson(text);
    if (payload === null) return json({ error: "unparseable" }, 502);

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
    //
    // THE SENTENCE IS PASSED THROUGH UNJUDGED, and deliberately so. Every rule
    // that decides whether a child ever sees it - allowlist, stage pool
    // (AC-12.3), length band, banned terms, and whether it reuses any of their
    // own words - needs the shipped content and the compiled allowlist, and
    // neither exists in this function. Half-checking it here would only invite
    // someone to believe it had been checked. The client's six gates are the
    // guardrail; a missing or malformed sentence simply never passes them and
    // the child types the stop's shipped sentence instead.
    const candidates = [p["sentence"], ...(p["variants"] as unknown[])].filter(
      (c): c is string => typeof c === "string" && c.length > 0,
    );
    const allowed = new Set<string>([
      ...parsed.pool.map((w) => w.toLowerCase()),
      ...(parsed.lang === "en" ? WARP_SIGHT_WORDS : []),
    ]);
    const clean = onListOnly(candidates, allowed);
    const sentence = warp && candidates.length > 0 ? (clean[0] ?? candidates[0]) : undefined;
    // The client rejects the WHOLE payload - note included - if EITHER variant
    // is off the allowlist, so one loose variant costs a perfectly good note.
    // A clean sentence repeated beats a dirty one: both slots have to pass.
    const fallbackVariant = clean[0] ?? candidates[0] ?? "";
    const variants = [fallbackVariant, clean[1] ?? fallbackVariant];
    return json(
      sentence === undefined
        ? { note: starsToQuotes(p["note"]), variants }
        : { note: starsToQuotes(p["note"]), variants, sentence },
      200,
    );
  } catch {
    return json({ error: "timeout" }, 504);
  } finally {
    clearTimeout(timer);
  }
}
