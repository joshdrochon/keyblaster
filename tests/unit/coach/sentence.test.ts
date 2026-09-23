import { describe, expect, it } from "vitest";
import { createAllowlist, tokenize, type Allowlist } from "@engine/allowlist/index.js";
import {
  NO_SENTENCE,
  SENTENCE_LIMITS,
  practisedWords,
  validateComposedSentence,
} from "@engine/coach/index.js";
import { CONTENT_LANGS, bundlesFor, sightWordsFor } from "../content/fixtures.js";

/**
 * THE SIX GATES over a composed warp sentence (D09, E-AI-1; AC-12.3, AC-15.2,
 * FR-16).
 *
 * `tests/unit/coach/warpSentenceLive.test.ts` is the one that matters for "does
 * the feature work" - it runs the SHIPPED client against a fake wire. This file
 * is the gate in isolation: it is where a refusal can be pinned to the gate
 * that produced it, and where the length band is proved against the shipped
 * content rather than asserted.
 */

const POOL = [
  "mars", "red", "planet", "dust", "rust", "cold", "dry", "sky", "pink",
  "day", "tiny", "moons", "spin", "rivers", "run", "across", "surface",
  "land", "empty", "first", "pilot", "place", "beacon", "liquor",
];

const SIGHT_WORDS = [
  "a", "and", "are", "is", "it", "its", "of", "on", "the", "this", "was",
  "with", "very", "from", "all", "that", "has", "to", "in",
];

/** A list wide enough that only the gate under test can refuse a sentence. */
function allowlistWith(extra: readonly string[] = []): Allowlist {
  return createAllowlist({
    lang: "en",
    words: [...POOL, ...SIGHT_WORDS, ...extra],
    properNouns: ["Phobos"],
  });
}

function check(text: unknown, over: Partial<Parameters<typeof validateComposedSentence>[1]> = {}) {
  return validateComposedSentence(text, {
    allowlist: allowlistWith(),
    pool: POOL,
    sightWords: SIGHT_WORDS,
    practised: ["rivers", "empty"],
    ...over,
  });
}

describe("the composed warp sentence is accepted only when it is safe (D09, AC-15.2)", () => {
  it("CONTROL: a clean sentence built from the child's own words is accepted", () => {
    // Without this the rest of the file is unfalsifiable: a gate that refused
    // everything would pass every refusal assertion below.
    const result = check("The rivers on mars are dust and rust.");
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe("The rivers on mars are dust and rust.");
    expect(result.reused).toContain("rivers");
  });

  it("names the words from THIS run that the sentence gave back", () => {
    const result = check("The rivers are empty and dry.");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reused).toEqual(["rivers", "empty"]);
  });

  it("absent: nothing came back, which is not a failure", () => {
    expect(validateComposedSentence(undefined, {
      allowlist: allowlistWith(),
      pool: POOL,
      sightWords: SIGHT_WORDS,
      practised: ["rivers"],
    })).toEqual(NO_SENTENCE);
    expect(check("   ")).toEqual(NO_SENTENCE);
  });

  it("shape: a non-string, an unterminated sentence, or two sentences", () => {
    expect(check(42)).toEqual({ ok: false, reason: "shape" });
    expect(check({ text: "x" })).toEqual({ ok: false, reason: "shape" });
    expect(check("The rivers on mars are dust")).toEqual({ ok: false, reason: "shape" });
    expect(check("The rivers are dry. The dust is red.")).toEqual({
      ok: false,
      reason: "shape",
    });
  });

  it("shape: characters a child cannot reach on a keyboard", () => {
    // Every one of these reads fine and is untypeable by a 7-year-old, which
    // is the whole point of the gate.
    for (const bad of [
      "The rivers on mars are 2 dust and rust.",
      "The rivers on mars are dust - and rust.",
      "The rivers on mars (dust) are rust.",
      "The rivers on mars are “dust” and rust.",
      "The rivers on mars are dust and rust!",
      "The rivers on mars are dust and rust…",
    ]) {
      expect(check(bad), bad).toEqual({ ok: false, reason: "shape" });
    }
  });

  it("allowlist (D34): one off-list word throws the whole sentence away", () => {
    // "sand" is a perfectly innocent word. It is not on the list, so it does
    // not appear on a screen a child reads. That is D34 working, not a bug.
    expect(check("The rivers on mars are sand and rust.")).toEqual({
      ok: false,
      reason: "allowlist",
    });
  });

  it("allowlist: a readable-only proper noun is still not typeable (story note 4)", () => {
    // `hasReadable` would admit Phobos; a sentence the child TYPES is held to
    // `has`, which does not. A coach note may say it; this may not.
    expect(check("Phobos is a moons of mars.")).toEqual({
      ok: false,
      reason: "allowlist",
    });
  });

  it("length: outside the band the shipped sentences occupy", () => {
    expect(check("Mars is red.")).toEqual({ ok: false, reason: "length" });
    const long =
      "The rivers and the dust and the rust and the cold dry pink sky of mars.";
    expect(long.length).toBeGreaterThan(SENTENCE_LIMITS.maxChars);
    expect(check(long)).toEqual({ ok: false, reason: "length" });
  });

  it("AC-12.3: every content word is in THIS stage's pool", () => {
    // "beacon" is on the allowlist and in the Mars pool; drop it from the pool
    // and the same sentence must be refused, which is what makes this the pool
    // gate rather than a second allowlist gate.
    const sentence = "The beacon is on the empty red dust.";
    expect(check(sentence).ok, JSON.stringify(check(sentence))).toBe(true);
    expect(
      check(sentence, { pool: POOL.filter((w) => w !== "beacon") }),
    ).toEqual({ ok: false, reason: "pool" });
  });

  it("AC-12.3: a sentence of nothing but sight words says nothing about the stop", () => {
    expect(check("This is all of it.", { practised: ["this"] })).toEqual({
      ok: false,
      reason: "pool",
    });
  });

  it("a blocked word is refused even though it was put in the pool (D34)", () => {
    // "liquor" is in POOL on purpose - a content bug. `createAllowlist` drops
    // blocked entries on construction, so the allowlist gate is what catches
    // it, which is the first of D34's three layers doing its job.
    expect(POOL).toContain("liquor");
    expect(check("The rivers are liquor on mars.")).toEqual({
      ok: false,
      reason: "allowlist",
    });
  });

  it("banned (D34): the scan still catches it when the allowlist has widened", () => {
    // D34's own argument for layering: "a compilation bug that widened the
    // allowlist would defeat the first check and not the second". That bug
    // cannot be built with `createAllowlist`, which refuses blocked entries -
    // so it is built by hand here, and the banned scan has to hold alone.
    const widened: Allowlist = {
      lang: "en",
      size: 0,
      has: () => true,
      hasReadable: () => true,
      words: [],
      properNouns: [],
    };
    expect(
      check("The rivers are liquor on mars.", {
        allowlist: widened,
        pool: [...POOL, "liquor"],
      }),
    ).toEqual({ ok: false, reason: "banned" });
  });

  it("banned (D31/AC-25.3): Shadow's one forbidden word, in a sentence she did not write", () => {
    // "wrong" is not a blocked CONTENT word, so nothing above this gate has
    // any reason to refuse it. It is refused because Shadow never says it.
    expect(
      check("That run was wrong, first pilot.", {
        allowlist: allowlistWith(["wrong", "was", "run"]),
        pool: [...POOL, "wrong"],
        practised: ["first"],
      }),
    ).toEqual({ ok: false, reason: "banned" });
  });

  it("reuse (D09): a sentence that gives back none of this run's words is refused", () => {
    // This is the defect KeyBlaster exists to fix, as a gate: a grammatical,
    // safe, in-pool sentence that has nothing to do with what the child just
    // practised is exactly what Type Storm already does.
    expect(check("The pink sky of mars is cold and dry.")).toEqual({
      ok: false,
      reason: "reuse",
    });
    expect(check("The rivers on mars are dust and rust.", { practised: [] })).toEqual({
      ok: false,
      reason: "reuse",
    });
  });
});

describe("the length band is calibrated on the SHIPPED sentences", () => {
  /**
   * The brief for this feature says the existing static sentences are the
   * calibration for "typeable by a 7-11 year old". So they are run through the
   * gate rather than eyeballed: if a band is ever tightened past the content
   * we already ship, this fails and names the sentence.
   */
  for (const lang of CONTENT_LANGS) {
    const sight = sightWordsFor(lang);
    for (const b of bundlesFor(lang).filter((x) => x.warpSentence !== null)) {
      it(`${lang}/${b.stopId}: the shipped sentence passes its own gate`, () => {
        const text = b.warpSentence as string;
        const result = validateComposedSentence(text, {
          allowlist: createAllowlist({
            lang,
            words: [...b.pool, ...sight],
          }),
          pool: b.pool,
          sightWords: sight,
          // Stand in for a run that practised the whole sentence: the shipped
          // string was authored, not composed, so the reuse gate is the one
          // claim it cannot make for itself.
          practised: tokenize(text, lang),
        });
        expect(result, `${b.stopId}: ${text}`).toMatchObject({ ok: true });
      });
    }
  }
});

describe("practisedWords orders the run missed-first (E-AI-1)", () => {
  it("missed, then slow, then blasted, de-duplicated, order preserved", () => {
    expect(
      practisedWords(["rivers"], ["across", "rivers"], {
        pool: [],
        sightWords: [],
        blasted: ["dust", "across"],
        sentence: true,
        shipped: "",
      }),
    ).toEqual(["rivers", "across", "dust"]);
  });

  it("drops empties and is case-insensitive about duplicates", () => {
    expect(
      practisedWords(["Rivers", "  "], ["rivers"], undefined),
    ).toEqual(["Rivers"]);
  });
});
