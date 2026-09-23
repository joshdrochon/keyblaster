import { describe, expect, it } from "vitest";
import type { CoachResponse } from "@engine/coach/index.js";
import { createCoachClient } from "@game/coach/transport.js";
import { coachRequestFor, type RunSummary } from "@game/scenes/support/composeRequest.js";
import { stageBundle } from "@game/scenes/lib/content.js";
import { coachAllowlist } from "@game/scenes/support/vocab.js";

/**
 * THE WARP SENTENCE, ON THE PATH THE GAME ACTUALLY RUNS (D09, E-AI-1, FR-16).
 *
 * WHY THIS FILE IS NOT `sentence.test.ts`. That file holds the six gates to
 * their contract with a fixture allowlist, which proves the GATE works. This
 * is the different, harder claim: that the gate is wired into the transport
 * the game ships, fed by the request the scene actually sends, against the
 * allowlist and the pool that actually ship. Those two can both be true of a
 * repo where nothing calls the gate.
 *
 * THIS PROJECT HAS ALREADY SHIPPED THAT EXACT BUG ONCE. The voice pipeline
 * rendered 44 mp3s against clip ids the running game never asked for, and
 * every test passed, because the tests targeted the fixtures rather than the
 * path. So everything below is the shipped composition:
 *
 *   request    `coachRequestFor` from `scenes/support/composeRequest.ts` - the
 *              exact call `WarpScene.askShadow` makes, including the compose
 *              block, the real Mars pool and the real sight-word list.
 *   client     `createCoachClient` from `game/coach/transport.ts`, asked for
 *              the PROXY transport: the production path to `/api/coach`.
 *   allowlist  `coachAllowlist("en")` from `scenes/support/vocab.ts`.
 *
 * Only `fetchImpl` is a fake, because the alternative is billing Anthropic to
 * run a unit test.
 */

/** The env that selects the production transport (see `chooseTransport`). */
const PROXY_ENV = { endpoint: "/api/coach", automated: false, override: null } as const;

/** A run at Mars that missed two words and was slow on a third (AC-15.5's demo). */
const MARS_RUN: RunSummary = {
  stopId: "mars",
  lang: "en",
  missed: ["rivers", "empty"],
  slow: ["across"],
  hitRate: 0.85,
  blasted: ["mars", "red", "dust", "rust"],
};

/** A well-formed 200, i.e. exactly what the deployed endpoint returns. */
function modelSays(payload: unknown) {
  return (): Promise<CoachResponse> =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) });
}

function shippedCoach(payload: unknown) {
  return createCoachClient({
    allowlist: coachAllowlist("en"),
    env: PROXY_ENV,
    fetchImpl: modelSays(payload),
  });
}

/** A note that is known to survive the coach validator, so only the sentence varies. */
const CLEAN_NOTE = "Nice flying, pilot. Watch for the rivers next time.";
const CLEAN_VARIANTS: [string, string] = [
  "Mars is the red planet.",
  "The dust is cold and dry.",
];

async function composeAt(sentence: unknown) {
  const payload =
    sentence === undefined
      ? { note: CLEAN_NOTE, variants: CLEAN_VARIANTS }
      : { note: CLEAN_NOTE, variants: CLEAN_VARIANTS, sentence };
  return shippedCoach(payload).request(coachRequestFor(MARS_RUN));
}

/** The shipped static sentence. This is what every failure below degrades to. */
const SHIPPED_MARS = "Mars is the red planet.";

describe("the warp break asks for a sentence built from this run (D09, E-AI-1)", () => {
  it("the transport under test is the production one, not the mock", () => {
    // If this ever reads "mock", every assertion in this file is about a
    // canned template and the file proves nothing.
    expect(shippedCoach({ note: "x", variants: ["a", "b"] }).transport).toBe("proxy");
  });

  it("one call carries the second prompt shape: mode, pool and blasted", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const client = createCoachClient({
      allowlist: coachAllowlist("en"),
      env: PROXY_ENV,
      fetchImpl: (_url, init) => {
        calls.push(JSON.parse(init.body) as Record<string, unknown>);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ note: CLEAN_NOTE, variants: CLEAN_VARIANTS }),
        });
      },
    });

    await client.request(coachRequestFor(MARS_RUN));

    // ONE call. D33 and AC-15.3 allow exactly one per warp break, so the
    // sentence has to ride on the note's call rather than buy its own.
    expect(calls).toHaveLength(1);
    const body = calls[0] as Record<string, unknown>;
    expect(body["mode"]).toBe("warp");
    expect(body["pool"]).toEqual(stageBundle("mars").pool);
    expect(body["blasted"]).toEqual(MARS_RUN.blasted);
    // The 149-word sight list is the client gate's business, not the wire's.
    expect(body["sightWords"]).toBeUndefined();
  });

  it("CONTROL: a clean generated sentence IS used, and names the words that got past the pilot", async () => {
    // Without this every "falls back" assertion below would also pass on a
    // client that refused everything.
    const generated = "The rivers on mars are empty dust.";
    const result = await composeAt(generated);

    expect(result.sentence, JSON.stringify(result.sentence)).toMatchObject({ ok: true });
    if (!result.sentence.ok) return;
    expect(result.sentence.text).toBe(generated);
    expect(result.sentence.text).not.toBe(SHIPPED_MARS);
    // The retrieval-practice claim, as data: the child gets back the two words
    // that actually got past them.
    expect(result.sentence.reused).toEqual(expect.arrayContaining(["rivers", "empty"]));
  });

  it("a generated sentence that FAILS validation falls back to the shipped one", async () => {
    // Well-formed JSON, 200, correct shape, a perfectly readable sentence -
    // and "sand" is not on the allowlist. The child types the shipped string.
    const result = await composeAt("The rivers on mars are sand and dust.");
    expect(result.sentence).toEqual({ ok: false, reason: "allowlist" });
  });

  it("every way a generated sentence can be refused ends at the shipped one", async () => {
    const cases: ReadonlyArray<readonly [string, unknown, string]> = [
      ["off-allowlist word", "The rivers on mars are sand and dust.", "allowlist"],
      // "sky" is on the allowlist and in the Jupiter/Mars prose, but "biggest"
      // is a Jupiter pool word: at Mars it is a content word from the wrong
      // stop, which is exactly what AC-12.3 is for.
      ["a word from another stop's pool", "The biggest rivers on mars are dust.", "pool"],
      ["too long for a 7-year-old", "The rivers and the dust and the rust and the cold dry pink sky of mars.", "length"],
      ["too short to be the beat", "Rivers on mars.", "length"],
      ["a character nobody can type", "The rivers on mars are dust - and rust.", "shape"],
      ["two sentences", "The rivers are dry. The dust is red.", "shape"],
      // Every word is in the Mars pool and none of them is a word this pilot
      // missed, was slow on, or shot down. Grammatical, safe, in-pool, and
      // exactly the Type Storm defect D09 exists to fix.
      ["nothing from this run", "The pink sky is cold and dry.", "reuse"],
      ["not a string at all", 42, "shape"],
    ];

    for (const [why, sentence, reason] of cases) {
      const result = await composeAt(sentence);
      expect(result.sentence, why).toEqual({ ok: false, reason });
    }
  });

  it("a reply with no sentence at all is absent, not a failure", async () => {
    const result = await composeAt(undefined);
    expect(result.sentence).toEqual({ ok: false, reason: "absent" });
  });

  it("the NOTE and the SENTENCE fail independently", async () => {
    // D34's worked example in the note, a clean sentence beside it. Refusing
    // the sentence because the note was refused would cost the child the
    // practice for no safety gain - and, far worse, the mirror of that bug
    // would show a sentence because the NOTE passed.
    const result = await shippedCoach({
      note: "Nice flying, pilot. Pour yourself a liquor and rest.",
      variants: CLEAN_VARIANTS,
      sentence: "The rivers on mars are empty dust.",
    }).request(coachRequestFor(MARS_RUN));

    expect(result.source).toBe("fallback");
    expect(result.note.toLowerCase()).not.toContain("liquor");
    expect(result.sentence).toMatchObject({ ok: true });
  });

  it("a transport failure leaves the shipped sentence in place", async () => {
    const down = createCoachClient({
      allowlist: coachAllowlist("en"),
      env: PROXY_ENV,
      fetchImpl: () => Promise.reject(new Error("offline")),
    });
    const result = await down.request(coachRequestFor(MARS_RUN));
    expect(result.failure).toBe("network");
    expect(result.sentence).toEqual({ ok: false, reason: "absent" });
  });

  it("the DEFAULT build never composes: an unconfigured client is the mock", async () => {
    // D87 and `chooseTransport`: no endpoint configured means MockCoach, and
    // MockCoach has no model behind it. It must therefore never produce a
    // sentence, because the on-screen marker would then be a lie.
    const mock = createCoachClient({
      allowlist: coachAllowlist("en"),
      env: { endpoint: null, automated: false, override: null },
    });
    expect(mock.transport).toBe("mock");
    const result = await mock.request(coachRequestFor(MARS_RUN));
    expect(result.sentence).toEqual({ ok: false, reason: "absent" });
  });
});

describe("what the shipped request asks for (composeRequest.ts)", () => {
  it("Earth has no belt, so it never asks for a sentence (D57)", () => {
    expect(
      coachRequestFor({ ...MARS_RUN, stopId: "earth" }).compose,
    ).toBeUndefined();
  });

  it("a PERFECT run still asks for a sentence - blasted words are words to build from", () => {
    // The mistake this replaces: "perfect run" was read as "nothing
    // practised", and blasting a word counts as practising it. A belt cleared
    // without a single miss has a full blast history and plenty to compose
    // from, so the sentence still comes - it is the NOTE that becomes the
    // authored, spoken one (UR-191, WarpScene).
    // Perfect is "nothing got past you" - `missed` empty. A slow word is not a
    // miss, so a run can be perfect and still have one.
    const perfect = coachRequestFor({ ...MARS_RUN, missed: [] });
    expect(perfect.compose?.sentence).toBe(true);
    expect(perfect.missed).toEqual([]);
    expect(perfect.slow.length).toBeGreaterThan(0);
    expect(perfect.compose?.blasted.length).toBeGreaterThan(0);
  });

  it("a run with nothing practised at all does not ask for a sentence (D09)", () => {
    // The claim is that we never BUY a sentence with nothing to build it out
    // of. It used to be expressed by dropping the whole compose block, which
    // also dropped the pool - and the proxy needs the pool to keep the reply's
    // unused variants on the allowlist. A variant that misses it fails the
    // payload and takes the NOTE down with it, which is what a clean run at
    // Jupiter looked like from play: shipped sentence AND shipped note.
    const compose = coachRequestFor({
      ...MARS_RUN,
      missed: [],
      slow: [],
      blasted: [],
    }).compose;
    expect(compose?.sentence).toBe(false);
    expect(compose?.pool.length, "the pool still rides along").toBeGreaterThan(0);
  });

  it("a run that practised something does ask for one", () => {
    expect(coachRequestFor(MARS_RUN).compose?.sentence).toBe(true);
  });

  it("a language with no compiled allowlist does not pay for a call it would refuse", () => {
    // Spanish and Hindi, until `compile-allowlist` lands. Every gate would
    // refuse the result, so asking is spending money on a guaranteed fallback.
    expect(coachAllowlist("es").size).toBe(0);
    expect(coachRequestFor({ ...MARS_RUN, lang: "es" }).compose).toBeUndefined();
  });

  it("a real Mars run carries the real pool and the real sight list", () => {
    const compose = coachRequestFor(MARS_RUN).compose;
    expect(compose?.pool).toEqual(stageBundle("mars").pool);
    expect(compose?.pool).toContain("rivers");
    expect(compose?.sightWords).toContain("the");
    expect(compose?.blasted).toEqual(MARS_RUN.blasted);
  });
});
