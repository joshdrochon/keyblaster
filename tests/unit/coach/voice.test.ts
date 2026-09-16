import { describe, expect, it } from "vitest";
import {
  DEFAULT_FALLBACK_BUNDLE,
  createCoachValidator,
  createMockCoach,
  type CoachPayload,
} from "@engine/coach";
import { checkWord } from "@engine/allowlist";
import { tokenize } from "@engine/allowlist/normalize.js";
import { coachAllowlist } from "@game/scenes/support/vocab";

/**
 * EVERYTHING SHADOW CAN SAY MUST SURVIVE THE GATE IT IS PUT THROUGH
 * (AC-15.2, AC-15.5, D34).
 *
 * `MockCoach` is the transport almost every note in this game comes from
 * (D87 keeps it the default), and its output goes through the SAME allowlist
 * validator as a live note. When a template uses a word the allowlist does not
 * carry, nothing breaks loudly: `settle` just returns the shipped fallback, the
 * screen looks fine, and the note stops naming the words the child missed.
 *
 * That is exactly what was happening. `Good run. Let us take "{a}" a little
 * slower.` failed on "let" and "take" - two Fry-100 words - so every request
 * carrying missed words fell back. It was invisible because the game never
 * supplied missed words until the blast history was wired (D09), which meant
 * the only template ever exercised was the "clean run" one.
 *
 * These tests are the guard. They fail on the template, not on the symptom.
 */

const ALLOWLIST = coachAllowlist("en");

/** Every word in `text` the coach validator's allowlist would reject. */
function rejectedWords(text: string): string[] {
  return tokenize(text, "en").filter((w) => checkWord(w, ALLOWLIST) !== null);
}

describe("MockCoach notes survive the coach allowlist (AC-15.2, AC-15.5)", () => {
  const validator = createCoachValidator({ allowlist: ALLOWLIST });
  const client = createMockCoach({ validator });

  /** The four template branches in `mock.ts`, by the request that reaches each. */
  const REQUESTS = [
    {
      name: "two missed words",
      req: {
        stopId: "mars" as const,
        lang: "en" as const,
        missed: ["rivers", "empty"],
        slow: [],
        hitRate: 0.7,
      },
      names: ["rivers", "empty"],
    },
    {
      name: "one missed word",
      req: {
        stopId: "mars" as const,
        lang: "en" as const,
        missed: ["planet"],
        slow: [],
        hitRate: 0.9,
      },
      names: ["planet"],
    },
    {
      name: "one slow word",
      req: {
        stopId: "saturn" as const,
        lang: "en" as const,
        missed: [],
        slow: ["rings"],
        hitRate: 1,
      },
      names: ["rings"],
    },
    {
      name: "a clean run",
      req: {
        stopId: "pluto" as const,
        lang: "en" as const,
        missed: [],
        slow: [],
        hitRate: 1,
      },
      names: [],
    },
  ];

  for (const { name, req, names } of REQUESTS) {
    it(`AC-15.2: the ${name} note passes the allowlist and is served LIVE`, async () => {
      const result = await client.request(req);
      // `source: "live"` is the whole assertion: a mock note that lands on the
      // fallback is a template bug wearing a working screen.
      expect(result.failure).toBeNull();
      expect(result.source).toBe("live");
    });

    it(`AC-15.5: the ${name} note names the words the request carried`, async () => {
      const result = await client.request(req);
      for (const word of names) expect(result.note.toLowerCase()).toContain(word);
    });
  }

  it("the templates vary with the request, so this is not one template four times", async () => {
    const notes = new Set<string>();
    for (const { req } of REQUESTS) notes.add((await client.request(req)).note);
    expect(notes.size).toBe(REQUESTS.length);
  });
});

describe("the shipped fallback bundle is sayable too (D33, D34)", () => {
  // The bundle deliberately bypasses the runtime validator (its own failure
  // action IS the fallback), so nothing else checks it against the allowlist.
  // A fallback note containing a word the game would reject from a live note is
  // a contradiction in the voice rules even though no code path fails on it.
  const entries: [string, CoachPayload][] = [];
  const en = DEFAULT_FALLBACK_BUNDLE.byLang.en;
  entries.push(["en/base", en.base]);
  for (const [stop, payload] of Object.entries(en.byStop)) {
    if (payload !== undefined) entries.push([`en/${stop}`, payload]);
  }

  it("covers every English entry, so this loop cannot be vacuous", () => {
    expect(entries.length).toBeGreaterThan(5);
  });

  for (const [id, payload] of entries) {
    it(`${id}: the note uses only words the allowlist carries`, () => {
      expect(rejectedWords(payload.note)).toEqual([]);
    });

    it(`${id}: both typing variants use only words the allowlist carries`, () => {
      for (const variant of payload.variants) {
        expect(rejectedWords(variant)).toEqual([]);
      }
    });
  }
});
