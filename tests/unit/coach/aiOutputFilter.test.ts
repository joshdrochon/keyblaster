import { describe, expect, it } from "vitest";
import { tokenize } from "@engine/allowlist/index.js";
import type { CoachRequest, CoachResponse } from "@engine/coach/index.js";
import { createCoachClient } from "@game/coach/transport.js";
import { coachAllowlist } from "@game/scenes/support/vocab.js";

/**
 * AC-13.3 — "AI outputs (PRD 3.4) pass the same filter before use."
 *
 * WHY THIS FILE IS NOT tests/unit/coach/validate.test.ts. That file holds
 * `createCoachValidator` to its four gates with a hand-built fixture
 * allowlist, which proves the FILTER works. AC-13.3 is a different claim: that
 * the filter is ON THE PATH the game actually runs. Those two can both be true
 * of a repo where the validator is never wired to anything, and "the game
 * sends one LLM call per warp break and shows the result to a child" makes the
 * difference between them the whole safety argument.
 *
 * So everything here is the shipped composition:
 *
 *   allowlist   `coachAllowlist("en")` from `scenes/support/vocab.ts` - the
 *               exact list `WarpScene.ts` passes, built from shipped content,
 *               not a fixture written to make a test pass.
 *   client      `createCoachClient` from `game/coach/transport.ts` - the
 *               composition root WarpScene calls, asked for the PROXY
 *               transport, i.e. the production path to `/api/coach`.
 *   input       a well-formed 200 response, exactly what a model that decided
 *               to say something it should not say looks like on the wire.
 *
 * Only `fetchImpl` is a fake, because the alternative is billing Anthropic to
 * run a unit test.
 *
 * THE CONTROL MATTERS AS MUCH AS THE REFUSALS. A client that rejected
 * everything would pass every "unsafe text never reaches the child" assertion
 * while being broken, so the first test proves a clean model note DOES come
 * through live. Without it the rest is unfalsifiable.
 */

/** The env that selects the production transport (see `chooseTransport`). */
const PROXY_ENV = {
  endpoint: "/api/coach",
  automated: false,
  override: null,
} as const;

const marsRequest: CoachRequest = {
  stopId: "mars",
  lang: "en",
  missed: ["rivers", "empty"],
  slow: ["across"],
  hitRate: 0.85,
};

/** A 200 whose JSON body is whatever the "model" returned. */
function modelSays(payload: unknown) {
  return (): Promise<CoachResponse> =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(payload),
    });
}

/** The shipped client, with the shipped allowlist, on the production path. */
function shippedCoach(payload: unknown) {
  return createCoachClient({
    allowlist: coachAllowlist("en"),
    env: PROXY_ENV,
    fetchImpl: modelSays(payload),
  });
}

const en = coachAllowlist("en");

/** Every word of a string that the shipped allowlist would refuse to show. */
const offList = (text: string): string[] =>
  tokenize(text, "en").filter((w) => !en.hasReadable(w));

describe("AC-13.3: AI output is filtered on the path the game actually runs", () => {
  it("AC-13.3: the transport under test is the production one, not the mock", () => {
    // If this ever reads "mock", every refusal below is a refusal by a canned
    // template rather than by the filter, and this file proves nothing.
    expect(shippedCoach({ note: "x", variants: ["a", "b"] }).transport).toBe(
      "proxy",
    );
  });

  it("AC-13.3: CONTROL - a clean model note reaches the child unchanged", async () => {
    const note = "Nice flying, pilot. Watch for the red dust next time.";
    const variants: [string, string] = [
      "Mars is the red planet.",
      "The dust is cold and dry.",
    ];
    // Stated up front: if the shipped allowlist cannot pass this, the control
    // is wrong, not the filter.
    expect(offList(note)).toEqual([]);

    const result = await shippedCoach({ note, variants }).request(marsRequest);

    expect(result.source).toBe("live");
    expect(result.failure).toBeNull();
    expect(result.note).toBe(note);
    expect(result.variants).toEqual(variants);
  });

  it("AC-13.3: a blocked word in the model's note never reaches the child", async () => {
    // D34's worked example. Well-formed JSON, 200, correct shape: the schema
    // gate has nothing to object to, so only the word filter can stop it.
    const poisoned = "Nice flying, pilot. Pour yourself a liquor and rest.";
    const result = await shippedCoach({
      note: poisoned,
      variants: ["Mars is the red planet.", "The dust is cold and dry."],
    }).request(marsRequest);

    expect(result.source).toBe("fallback");
    expect(result.note).not.toBe(poisoned);
    expect(result.note.toLowerCase()).not.toContain("liquor");
    for (const variant of result.variants) {
      expect(variant.toLowerCase()).not.toContain("liquor");
    }
  });

  it("AC-13.3: a blocked word in a model VARIANT never reaches the child", async () => {
    // The variants are the half a child TYPES, so an unfiltered one is worse
    // than an unfiltered note, not better.
    const result = await shippedCoach({
      note: "Nice flying, pilot.",
      variants: ["Mars is the red planet.", "The pilot had a beer."],
    }).request(marsRequest);

    expect(result.source).toBe("fallback");
    for (const variant of result.variants) {
      expect(variant.toLowerCase()).not.toContain("beer");
    }
  });

  it("AC-13.3: an off-allowlist word is refused even though it is harmless", async () => {
    // "photosynthesis" is not unsafe, it is unreadable for a 7-year-old. D34's
    // rule is an allowlist, not a blocklist, and the difference is that a word
    // nobody thought to ban is still refused.
    const poisoned = "Nice flying. That was excellent photosynthesis, pilot.";
    expect(offList(poisoned)).toContain("photosynthesis");

    const result = await shippedCoach({
      note: poisoned,
      variants: ["Mars is the red planet.", "The dust is cold and dry."],
    }).request(marsRequest);

    expect(result.source).toBe("fallback");
    expect(result.note).not.toContain("photosynthesis");
  });

  it("AC-13.3: whatever the model returns, the child only ever sees allowlisted words", async () => {
    // The claim as a property rather than as four examples: for each of these
    // responses, EVERY word of the note that is finally shown is on the list -
    // whether it came back live or was replaced by the shipped fallback.
    const responses: readonly unknown[] = [
      { note: "Nice flying, pilot. Watch for the red dust next time.", variants: ["Mars is the red planet.", "The dust is cold and dry."] },
      { note: "Pour yourself a liquor and rest.", variants: ["Mars is the red planet.", "The dust is cold and dry."] },
      { note: "That was excellent photosynthesis, pilot.", variants: ["Mars is the red planet.", "The dust is cold and dry."] },
      { note: "You got that one wrong, pilot.", variants: ["Mars is the red planet.", "The dust is cold and dry."] },
      { note: "Nice flying, pilot.", variants: ["Mars is the red planet.", "Grab the whiskey."] },
      { note: 42, variants: null },
      { note: "", variants: [] },
      null,
    ];

    for (const raw of responses) {
      const result = await shippedCoach(raw).request(marsRequest);
      expect(offList(result.note)).toEqual([]);
      for (const variant of result.variants) {
        expect(offList(variant)).toEqual([]);
      }
    }
  });

  it("AC-13.3: the child's own missed words are filtered before they reach the prompt", async () => {
    // The other direction of the same rule. A missed word is typed by a child
    // and echoed back by a model; if it went out unfiltered, an off-list word
    // could come home in Shadow's voice.
    let sent: unknown = null;
    const client = createCoachClient({
      allowlist: coachAllowlist("en"),
      env: PROXY_ENV,
      fetchImpl: (_url, init) => {
        sent = JSON.parse(init.body) as unknown;
        return modelSays({
          note: "Nice flying, pilot.",
          variants: ["Mars is the red planet.", "The dust is cold and dry."],
        })();
      },
    });

    await client.request({
      ...marsRequest,
      missed: ["rivers", "photosynthesis", "liquor"],
    });

    const body = sent as { missed: string[] };
    expect(body.missed).toEqual(["rivers"]);
  });
});
