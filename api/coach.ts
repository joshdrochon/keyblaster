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
  /** The stop's shipped sentence; a reply that copies it is not a reply. */
  shipped: string;
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

/**
 * Just the candidates the client could actually accept, in order.
 *
 * ON THE LIST **AND** THE RIGHT LENGTH. Checking only the word list left the
 * picker blind to the gate that rejects a sentence for running long, and at
 * Jupiter - whose pool words are longer - two live replies in eight died on
 * `length` with a clean sibling sitting right beside them in the same reply.
 * The bounds are the client's (`SENTENCE_LIMITS`), one word tighter on each
 * side so a candidate that squeaks past here cannot fail there.
 */
export function onListOnly(
  candidates: readonly string[],
  allowed: ReadonlySet<string>,
): string[] {
  return candidates.filter((s) => {
    const words = s.toLowerCase().match(/[a-z]+/g) ?? [];
    if (words.length < WARP_MIN_WORDS || words.length > WARP_MAX_WORDS) return false;
    if (s.length > WARP_MAX_CHARS) return false;
    return words.length > 0 && words.every((w) => allowed.has(w));
  });
}

/** Loose equality for "is this just the shipped line again". */
function sameLine(a: string, b: string): boolean {
  const norm = (t: string): string => t.toLowerCase().replace(/[^a-z]+/g, " ").trim();
  return norm(a).length > 0 && norm(a) === norm(b);
}

/**
 * A note is a sentence, so it starts with a capital - even when the first
 * thing in it is one of the child's own pool words, which are stored
 * lowercase. `retry.namedWords` and `coachHighlight.quotedWords` both fold
 * case through `normalizeWord`, so the highlight and UR-64's promise are
 * unaffected.
 */
export function sentenceCase(note: string): string {
  // ANCHORED. An unanchored /[a-z]/ finds the first LOWERCASE letter, which in
  // "Good run, pilot." is the "o" - it returned "GOod".
  return note.replace(/^([^A-Za-z]*)([a-z])/, (_m, lead: string, c: string) => lead + c.toUpperCase());
}

/** The model marks named words with *stars*; the screen reads double quotes. */
export function starsToQuotes(note: string): string {
  return note.replace(/\*([^*\n]+)\*/g, '"$1"');
}

/**
 * The words the model is actually shown, which is not the whole pool.
 *
 * A stage pool is 100-115 words and the model wanders across it: measured on
 * the deployed endpoint, five sentences in thirty-six came back with a word
 * that is in the pool's neighbourhood but not in it - a plural the pool does
 * not carry, or a word from another stop. A shorter palette is easier to stay
 * inside, and none of this loosens AC-12.3: the client still checks the whole
 * pool, and every word here IS a pool word.
 *
 * The hard words come first because the sentence must contain one, then what
 * the child actually blasted this run, then enough of the pool to write with.
 */
export function promptPool(req: CoachRequest, budget = 34): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of [...req.missed, ...req.slow, ...req.blasted, ...req.pool]) {
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
    if (out.length >= budget) break;
  }
  return out;
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

/**
 * Caps on what a run may report. Measured, not guessed: a cleanly flown Uranus
 * belt sends 56 blasted words, and the old cap of 48 turned that into a 400
 * before a token was spent - the whole AI beat, gone, on exactly the later
 * belts where it was most visible. Mars's shorter belt stayed under it, which
 * is why the endpoint measured green while play did not.
 */
const BLASTED_CAP = 160;
/** A child who missed 13 words is the child this feature is for (was 12). */
const HARD_CAP = 48;

/** Reject anything that is not the documented shape, before spending a token. */
export function parseRequest(body: unknown): CoachRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const list = (v: unknown, cap: number): string[] | null => {
    if (!Array.isArray(v) || v.length > cap) return null;
    if (!v.every((w) => typeof w === "string" && w.length > 0 && w.length <= 20)) return null;
    return v as string[];
  };
  const words = (v: unknown): string[] | null => list(v, HARD_CAP);
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
  const shipped = typeof b["shipped"] === "string" ? b["shipped"] : "";
  const pool = b["pool"] === undefined ? [] : list(b["pool"], POOL_CAP);
  const blasted = b["blasted"] === undefined ? [] : list(b["blasted"], BLASTED_CAP);
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
    shipped,
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
    "",
    // Measured live: "You found *dry*, *sky*, *rim* took a moment." - the
    // model was stapling the named words into a slot the sentence had no room
    // for. It needs the SHAPE, not more rules.
    // EVERY PHRASE BELOW WAS RUN THROUGH THE SHIPPED ALLOWLIST FIRST.
    //
    // Left to write its own sentences the model kept reaching one word outside
    // the list - measured live: "nailed", "flew", "fine", "well", "made you
    // think", "tricky", "slowed". Each one failed the note gate, and a failed
    // note takes the composed SENTENCE down with it, so the whole AI beat
    // vanished. The child's own words are still the subject; only the framing
    // is fixed, because the framing is what kept breaking.
    "Write EXACTLY two sentences and nothing else.",
    "",
    "FIRST sentence: one of these, with the pilot's words in the stars.",
    "    *word* took you a moment.",
    "    *word* took a moment.",
    "    *word* and *word* took you a moment.",
    "    *word* was the slow one.",
    "    *word* is one to watch.",
    "",
    "SECOND sentence: one of these, copied exactly.",
    "    Nice flying, pilot.",
    "    Good run, pilot.",
    "    Nice work, pilot.",
    "    That was a good belt.",
    "    We will see them again.",
    "    Good flying.",
    "    Steady hands, pilot.",
    "",
    "Do not add a third sentence. Do not reword either one. Star every word",
    "you name and nothing else.",
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
    ...(req.pool.length > 0
      ? [
          "",
          "Every word in both variants must come from POOL or SIGHT below,",
          "spelled EXACTLY as printed. No past tense unless the list has it.",
          `POOL: ${req.pool.join(", ")}`,
          `SIGHT: ${sightFor(req)}`,
        ]
      : []),
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
    "- NO PAST TENSE unless the list has that exact form. The list has \"run\",",
    "  so \"ran\" is not allowed. Words like \"once\", \"ancient\" and \"cover\" are",
    "  not on any list - if it is not printed below, you may not use it.",
    // Measured live at Jupiter, three replies in five: "planets", where the
    // pool carries "planet". Naming the exact word it keeps reaching for is
    // what finally stopped "plains"; this is the same trap, one word over.
    "- NO PLURALS the list does not have. If it prints \"planet\" you may not",
    "  write \"planets\"; if it prints \"moons\" you may not write \"moon\". Check",
    "  each word against the list letter by letter before you answer.",
    "- It MUST contain at least one word from HARD. Those words are the point:",
    "  the pilot just struggled with them and this is how they meet them again.",
    // AIM AT 6, NOT AT THE CAP. Told "up to 10 words" the model writes 10 and
    // anything that overshoots is thrown away - Jupiter and Uranus, whose pool
    // words are longer, lost sentences to `length` and `shape` that way. A
    // target well inside the bound leaves room to miss.
    `- AIM FOR 6 OR 7 WORDS. Never fewer than ${WARP_MIN_WORDS}, never more than`,
    `  ${WARP_MAX_WORDS}, and never longer than ${WARP_MAX_CHARS} characters. One plain sentence,`,
    "  one full stop. A long sentence is thrown away however good it is, so the",
    "  shorter of two good sentences is always the better answer here.",
    "- Letters, spaces and commas only, ending in a single full stop. No digits,",
    "  no quotes, no dashes, no brackets, no exclamation marks, no emoji.",
    `- True about ${req.stopId}, and it must make sense read on its own.`,
    // Measured live: "Mars has a thin air and dry land." Every gate passed -
    // allowlist, pool, length, shape, reuse - because none of them reads
    // English. The prompt is the only place this can be asked for.
    "- GRAMMATICAL ENGLISH. A child is going to type this and a teacher may be",
    '  reading over their shoulder. "Mars has a thin air" is wrong; "Mars has',
    '  thin air" is right. Read it back to yourself before you answer.',
    // THESE USED TO BE SHIPPED SENTENCES, and at Mars and Saturn the model
    // simply copied the example - which is byte-identical to the line already
    // on screen, so `useComposedSentence` dropped it and the child saw the
    // stock sentence with no marker. Measured: two live replies in three came
    // back as "Saturn wears rings made of ice and rock."
    "- Write it the way these are written - the SHAPE, never the words:",
    '    "The wind here is cold and dry."',
    '    "Ice and dust drift past the ship."',
    "- NEVER copy an example, and never write the sentence the pilot can",
    "  already see on their screen. It has to be new, and it has to contain a",
    "  word from HARD - that is the whole reason it exists.",
    "",
    "Reply as JSON only:",
    '{"note": "<=10 words", "variants": ["<sentence>", "<sentence>", "<sentence>"], "sentence": "<the practice sentence>"}',
    // They came back IDENTICAL, which defeats the point: when the first one
    // slipped there was nothing else to fall back to.
    "Give THREE variants that are genuinely DIFFERENT from each other - not the",
    "same sentence three times, and not the same sentence reworded. Each must",
    "obey every rule above on its own, so that when one slips another holds.",
  ].join("\n");
}

/** The accepted array is a whole belt; the prompt only needs a sample of it. */
const BLASTED_SHOWN = 24;

function warpUserPrompt(req: CoachRequest): string {
  // HARD is ordered missed-first: retrieval practice is strongest on the words
  // that actually got past the pilot (E-AI-1), and the model is told to prefer
  // the front of the list.
  const hard = [...req.missed, ...req.slow];
  return [
    userPrompt(req),
    "",
    `HARD (prefer the first of these): ${hard.length ? hard.join(", ") : "(none)"}`,
    `BLASTED this run: ${req.blasted.length ? req.blasted.slice(0, BLASTED_SHOWN).join(", ") : "(none)"}`,
    `POOL (the only content words allowed): ${promptPool(req).join(", ")}`,
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
      // The model is asked for three so a slip has siblings; the client's
      // schema wants exactly two, and `variants` below sends two.
      p["variants"].length < 2 ||
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
    // An echo of the stop's own line is dropped by the client without a word,
    // so it reads as the AI never having run. Measured one in eight.
    const fresh = candidates.filter((c) => !sameLine(c, parsed.shipped));
    const clean = onListOnly(fresh.length > 0 ? fresh : candidates, allowed);
    const sentence = warp && candidates.length > 0 ? (clean[0] ?? candidates[0]) : undefined;
    // The client rejects the WHOLE payload - note included - if EITHER variant
    // is off the allowlist, so one loose variant costs a perfectly good note.
    // A clean sentence repeated beats a dirty one: both slots have to pass.
    /**
     * THE VARIANTS MUST NOT BE ABLE TO SINK THE REPLY.
     *
     * The client refuses the WHOLE payload - note and sentence included - if
     * either variant misses the allowlist, and nothing on screen ever shows a
     * variant. The model was returning all three candidates IDENTICAL, so one
     * off-list idea failed every slot at once and the child got the stock
     * sentence and the canned note: measured twice in a row at Uranus in play.
     *
     * The stop's own shipped sentence is allowlisted by construction - it is
     * shipped content and passes these gates every time - so it is the safe
     * filler. The model's variants are used when they are clean; otherwise the
     * reply is carried by its note and its sentence, judged on their own.
     */
    const safe = parsed.shipped.length > 0 ? parsed.shipped : (clean[0] ?? candidates[0] ?? "");
    const variants = [clean[0] ?? safe, clean[1] ?? safe];
    return json(
      sentence === undefined
        ? { note: sentenceCase(starsToQuotes(p["note"])), variants }
        : { note: sentenceCase(starsToQuotes(p["note"])), variants, sentence },
      200,
    );
  } catch {
    return json({ error: "timeout" }, 504);
  } finally {
    clearTimeout(timer);
  }
}
