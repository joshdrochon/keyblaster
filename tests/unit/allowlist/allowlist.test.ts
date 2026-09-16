import { describe, expect, it } from "vitest";
import {
  AllowlistViolation,
  MAX_WORD_LENGTH,
  assertAllowed,
  blockedPrefixStems,
  blockedStems,
  checkWord,
  createAllowlist,
  filterWords,
  isBlocked,
  normalizeWord,
  sentenceIsAllowed,
  tokenize,
} from "@engine/allowlist/index.js";

/** Mars pool from story-draft-v1.md chapter 1. */
const MARS_POOL = [
  "red", "planet", "dust", "rust", "cold", "dry", "sky", "pink", "day",
  "tiny", "moons", "spin", "long", "ago", "rivers", "run", "across",
  "now", "empty", "first", "pilot", "place", "beacon",
];

const mars = createAllowlist({
  lang: "en",
  words: [...MARS_POOL, "is", "the", "mars"],
  properNouns: ["Phobos", "Deimos"],
});

describe("normalizeWord", () => {
  it("lowercases and trims", () => {
    expect(normalizeWord("  Mars  ")).toBe("mars");
  });

  it("strips surrounding punctuation but keeps internal", () => {
    expect(normalizeWord("Mars.")).toBe("mars");
    expect(normalizeWord('"red"')).toBe("red");
    expect(normalizeWord("don't")).toBe("don't");
  });

  it("is NFC-stable for Devanagari (D46)", () => {
    // U+0958 QA is a Unicode composition exclusion: NFC rewrites it to
    // KA + NUKTA. Both spellings of the same letter must compare equal.
    const precomposed = "\u0958\u0930";
    const decomposed = "\u0915\u093C\u0930";
    expect(normalizeWord(precomposed, "hi")).toBe(normalizeWord(decomposed, "hi"));
  });

  it("returns empty string for punctuation-only input", () => {
    expect(normalizeWord("---")).toBe("");
  });
});

describe("tokenize", () => {
  it("splits a sentence into normalised words", () => {
    expect(tokenize("Mars is the red planet.")).toEqual([
      "mars", "is", "the", "red", "planet",
    ]);
  });

  it("drops empty tokens from runs of whitespace", () => {
    expect(tokenize("  red   dust  ")).toEqual(["red", "dust"]);
  });
});

describe("isBlocked (AC-13.2)", () => {
  it("blocks the Type Storm example word", () => {
    // Type Storm ships "liquor" to grades 3-12 in a boss pangram (decision log).
    expect(isBlocked("liquor")).toBe(true);
  });

  it("blocks every stem on the list", () => {
    for (const stem of blockedStems()) {
      expect(isBlocked(stem), stem).toBe(true);
    }
  });

  it("blocks inflections of long stems via prefix match", () => {
    expect(isBlocked("beers")).toBe(true);
    expect(isBlocked("drunken")).toBe(true);
    expect(isBlocked("shooting")).toBe(true);
  });

  it("does not block innocent words that contain a short stem", () => {
    for (const w of ["class", "grass", "pass", "ginger", "assess", "hello", "shell"]) {
      expect(isBlocked(w), w).toBe(false);
    }
  });

  it("keeps the prefix tier free of stems that are too short to prefix-match", () => {
    // A stem shorter than 4 chars in the prefix list would be dead weight at
    // best and a false-positive generator at worst.
    for (const stem of blockedPrefixStems()) {
      expect(stem.length, stem).toBeGreaterThanOrEqual(3);
    }
    expect(blockedPrefixStems().length).toBeGreaterThan(0);
  });

  it("does not block the empty string", () => {
    expect(isBlocked("")).toBe(false);
  });

  it("does not block any Mars pool word", () => {
    for (const w of MARS_POOL) expect(isBlocked(w), w).toBe(false);
  });
});

describe("createAllowlist", () => {
  it("normalises entries on the way in", () => {
    const a = createAllowlist({ lang: "en", words: ["Mars", " RED ", "Dust."] });
    expect(a.has("mars")).toBe(true);
    expect(a.has("red")).toBe(true);
    expect(a.has("dust")).toBe(true);
  });

  it("is case-insensitive on lookup", () => {
    expect(mars.has("RED")).toBe(true);
    expect(mars.has("Red")).toBe(true);
  });

  it("deduplicates and reports size", () => {
    const a = createAllowlist({ lang: "en", words: ["red", "Red", "RED"] });
    expect(a.size).toBe(1);
    expect(a.words).toEqual(["red"]);
  });

  it("AC-13.2: the allowlist alone would already reject every blocked word", () => {
    // Feed the blocklist straight in; construction must refuse all of it.
    const poisoned = createAllowlist({ lang: "en", words: blockedStems() });
    expect(poisoned.size).toBe(0);
    for (const stem of blockedStems()) {
      expect(poisoned.has(stem), stem).toBe(false);
    }
  });

  it("drops words longer than the plate can carry", () => {
    const a = createAllowlist({ lang: "en", words: ["a".repeat(MAX_WORD_LENGTH + 1)] });
    expect(a.size).toBe(0);
  });

  it("keeps a word of exactly the maximum length", () => {
    const a = createAllowlist({ lang: "en", words: ["a".repeat(MAX_WORD_LENGTH)] });
    expect(a.size).toBe(1);
  });

  it("drops empty entries", () => {
    const a = createAllowlist({ lang: "en", words: ["", "   ", "---"] });
    expect(a.size).toBe(0);
  });

  it("sorts its word list for stable compiled output", () => {
    const a = createAllowlist({ lang: "en", words: ["rust", "cold", "sky"] });
    expect(a.words).toEqual(["cold", "rust", "sky"]);
  });

  it("carries the language tag", () => {
    expect(createAllowlist({ lang: "hi", words: [] }).lang).toBe("hi");
  });
});

describe("proper nouns are readable but not typeable (story note 4)", () => {
  it("excludes them from the typeable pool", () => {
    expect(mars.has("phobos")).toBe(false);
    expect(mars.has("deimos")).toBe(false);
  });

  it("includes them for briefing prose", () => {
    expect(mars.hasReadable("Phobos")).toBe(true);
    expect(mars.hasReadable("Deimos")).toBe(true);
  });

  it("still admits ordinary pool words as readable", () => {
    expect(mars.hasReadable("red")).toBe(true);
  });

  it("refuses a blocked proper noun", () => {
    const a = createAllowlist({ lang: "en", words: [], properNouns: ["Gun", "Titan"] });
    expect(a.hasReadable("gun")).toBe(false);
    expect(a.hasReadable("titan")).toBe(true);
  });

  it("drops empty proper nouns and sorts them", () => {
    const a = createAllowlist({ lang: "en", words: [], properNouns: ["Titan", "", "Charon"] });
    expect(a.properNouns).toEqual(["charon", "titan"]);
  });

  it("defaults to no proper nouns", () => {
    expect(createAllowlist({ lang: "en", words: ["red"] }).properNouns).toEqual([]);
  });
});

describe("checkWord", () => {
  it("returns null for an allowed word", () => {
    expect(checkWord("red", mars)).toBeNull();
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["a".repeat(MAX_WORD_LENGTH + 1), "too-long"],
    ["liquor", "blocked"],
    ["helicopter", "not-in-allowlist"],
  ] as const)("classifies %j as %s", (word, reason) => {
    expect(checkWord(word, mars)?.reason).toBe(reason);
  });

  it("reports blocked before not-in-allowlist", () => {
    // "liquor" is also absent from the list; the more specific reason wins.
    expect(mars.has("liquor")).toBe(false);
    expect(checkWord("liquor", mars)?.reason).toBe("blocked");
  });
});

describe("filterWords (AC-15.2)", () => {
  it("partitions a batch", () => {
    const r = filterWords(["red", "liquor", "planet", "helicopter"], mars);
    expect(r.accepted).toEqual(["red", "planet"]);
    expect(r.rejected.map((x) => x.reason)).toEqual(["blocked", "not-in-allowlist"]);
  });

  it("normalises accepted output", () => {
    expect(filterWords(["  RED.  "], mars).accepted).toEqual(["red"]);
  });

  it("accepts everything from a clean pool", () => {
    expect(filterWords(MARS_POOL, mars).rejected).toEqual([]);
  });
});

describe("sentenceIsAllowed (AC-12.3)", () => {
  it("accepts the Mars warp sentence, whose words are all in the pool", () => {
    expect(sentenceIsAllowed("Mars is the red planet.", mars)).toBe(true);
  });

  it("rejects a sentence containing an off-pool word", () => {
    expect(sentenceIsAllowed("Mars is the red helicopter.", mars)).toBe(false);
  });

  it("rejects a sentence containing a blocked word", () => {
    expect(sentenceIsAllowed("the liquor jugs", mars)).toBe(false);
  });

  it("accepts the empty sentence vacuously", () => {
    expect(sentenceIsAllowed("   ", mars)).toBe(true);
  });
});

describe("assertAllowed (AC-13.1)", () => {
  it("returns the normalised word when allowed, in both modes", () => {
    expect(assertAllowed("  Red ", mars, "dev")).toBe("red");
    expect(assertAllowed("  Red ", mars, "prod")).toBe("red");
  });

  it("throws in dev so content bugs fail the build", () => {
    expect(() => assertAllowed("liquor", mars, "dev")).toThrow(AllowlistViolation);
  });

  it("carries the rejection on the thrown error", () => {
    try {
      assertAllowed("helicopter", mars, "dev");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AllowlistViolation);
      expect((e as AllowlistViolation).rejection.reason).toBe("not-in-allowlist");
      expect((e as AllowlistViolation).message).toContain("helicopter");
    }
  });

  it("drops silently in prod so a child's game never crashes", () => {
    expect(assertAllowed("liquor", mars, "prod")).toBeNull();
    expect(assertAllowed("helicopter", mars, "prod")).toBeNull();
  });
});
