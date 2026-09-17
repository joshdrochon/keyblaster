import { describe, expect, it } from "vitest";
import { WARP_SIGHT_WORDS } from "../../../api/coach.js";
import { normalizeWord } from "@engine/allowlist/index.js";
import { SENTENCE_LIMITS } from "@engine/coach/index.js";
import { coachAllowlist, sightWordList } from "@game/scenes/support/vocab.js";

/**
 * THE SECOND PROMPT SHAPE'S VOCABULARY (E-AI-1, D34, AC-12.3).
 *
 * `api/coach.ts` tells the model which filler words it may use when it composes
 * the warp sentence. That list is written on the SERVER and the sentence is
 * judged on the CLIENT, which is the exact shape of drift this project has
 * already shipped once: a pipeline that produced ids the game never asked for,
 * with a green suite on top of it.
 *
 * So the two sides are pinned to each other here. A word offered by the prompt
 * that the client's gate would refuse is not a small bug - it is a live
 * sentence turned into a silent fallback, i.e. the feature quietly not
 * existing, which is the thing E-AI-1 is about.
 *
 * The prompt itself is not asserted word for word on purpose. It is a backup
 * layer (D34), every rule in it is also enforced by code that runs on the
 * reply, and pinning its prose would make it unimprovable.
 */

describe("the warp prompt only offers words the client will accept", () => {
  const en = coachAllowlist("en");
  const sight = new Set(sightWordList("en").map((w) => normalizeWord(w, "en")));

  it("every offered sight word is in the shipped sight-word list", () => {
    // If it is not, the client counts it as a CONTENT word and AC-12.3 then
    // demands it be in the stage's asteroid pool - which a filler word never
    // is. The sentence falls back and nobody finds out why.
    const strays = WARP_SIGHT_WORDS.filter((w) => !sight.has(normalizeWord(w, "en")));
    expect(strays).toEqual([]);
  });

  it("every offered sight word is on the runtime allowlist (D34)", () => {
    expect(WARP_SIGHT_WORDS.filter((w) => !en.has(w))).toEqual([]);
  });

  it("the list is non-trivial, deduplicated and short enough to be worth sending", () => {
    expect(WARP_SIGHT_WORDS.length).toBeGreaterThan(40);
    expect(new Set(WARP_SIGHT_WORDS).size).toBe(WARP_SIGHT_WORDS.length);
    // The whole point of curating it is that the full 149 would be prompt
    // tokens spent inside a 1200 ms server budget.
    expect(WARP_SIGHT_WORDS.length).toBeLessThan(sightWordList("en").length);
  });

  it("the band the prompt states is inside the band the client enforces", () => {
    // The prompt asks for 4-10 words and <=48 characters; the gate accepts
    // 4-11 and <=56. A model that obeys the prompt exactly is never refused
    // for length. If anyone tightens the gate, this fails.
    expect(SENTENCE_LIMITS.minWords).toBeLessThanOrEqual(4);
    expect(SENTENCE_LIMITS.maxWords).toBeGreaterThanOrEqual(10);
    expect(SENTENCE_LIMITS.maxChars).toBeGreaterThanOrEqual(48);
  });
});
