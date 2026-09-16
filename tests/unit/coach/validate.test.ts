import { describe, expect, it } from "vitest";
import {
  MAX_NOTE_WORDS,
  SHADOW_BANNED_TERMS,
  VARIANT_COUNT,
  createCoachValidator,
  parseCoachPayload,
  saysWrong,
  scanForBanned,
} from "@engine/coach/index.js";
import { allowlist, permissiveAllowlist } from "./fixtures.js";

/**
 * AC-15.2: "Output is validated: schema, allowlist, word count, banned-term
 * scan." Each gate is tested INDEPENDENTLY, which means every test below feeds
 * a payload that would pass the other three.
 */

const validator = createCoachValidator({ allowlist });

/** A payload that passes everything. Each test breaks exactly one thing. */
const good = {
  note: "Nice flying, pilot. Watch for rivers and empty next time.",
  variants: ["Mars is the red planet.", "Its dust is full of rust."],
};

describe("schema gate (AC-15.2)", () => {
  it("AC-15.2: accepts a well-formed payload", () => {
    const outcome = validator.validate(good);
    expect(outcome.ok).toBe(true);
  });

  it("AC-15.2: schema gate rejects non-objects", () => {
    for (const raw of [null, undefined, 42, "note", [], [good]]) {
      expect(validator.validate(raw)).toEqual({ ok: false, reason: "schema" });
    }
  });

  it("AC-15.2: schema gate rejects a missing or empty note", () => {
    expect(parseCoachPayload({ variants: good.variants })).toBeNull();
    expect(parseCoachPayload({ ...good, note: "   " })).toBeNull();
    expect(parseCoachPayload({ ...good, note: 7 })).toBeNull();
  });

  it(`AC-15.2: schema gate requires exactly ${VARIANT_COUNT} variants`, () => {
    expect(parseCoachPayload({ ...good, variants: ["one"] })).toBeNull();
    expect(
      parseCoachPayload({ ...good, variants: [...good.variants, "three"] }),
    ).toBeNull();
    expect(parseCoachPayload({ ...good, variants: "not an array" })).toBeNull();
  });

  it("AC-15.2: schema gate rejects a non-string or blank variant", () => {
    expect(parseCoachPayload({ ...good, variants: [3, "ok"] })).toBeNull();
    expect(parseCoachPayload({ ...good, variants: ["ok", 3] })).toBeNull();
    expect(parseCoachPayload({ ...good, variants: ["ok", "  "] })).toBeNull();
  });

  it("AC-15.2: schema gate trims whitespace off accepted text", () => {
    const parsed = parseCoachPayload({ note: "  hello  ", variants: [" a ", "b"] });
    expect(parsed).toEqual({ note: "hello", variants: ["a", "b"] });
  });
});

describe("allowlist gate (AC-15.2, D34)", () => {
  it("AC-15.2: rejects a well-formed response that smuggles a non-allowlisted word", () => {
    // Everything else about this payload is fine: 9 words, no banned term,
    // correct shape. The single word "zorblax" is not on the list.
    const smuggled = {
      note: "Nice flying, pilot. Watch for zorblax and empty next time.",
      variants: good.variants,
    };
    expect(validator.validate(smuggled)).toEqual({
      ok: false,
      reason: "allowlist",
    });
  });

  it("AC-15.2: rejects a non-allowlisted word hiding in a variant", () => {
    expect(
      validator.validate({
        ...good,
        variants: ["Mars is the red planet.", "Its dust is full of zorblax."],
      }),
    ).toEqual({ ok: false, reason: "allowlist" });
  });

  it("AC-15.2: the note may use readable-only proper nouns, a variant may not", () => {
    // Story note 4: Phobos is readable in briefings, never typed. A note is
    // read; a variant is typed.
    expect(
      validator.validate({ ...good, note: "Phobos and Deimos spin past us." }).ok,
    ).toBe(true);
    expect(
      validator.validate({
        ...good,
        variants: ["Phobos is a moon.", "Mars is the red planet."],
      }),
    ).toEqual({ ok: false, reason: "allowlist" });
  });

  it('AC-15.2: noteScope "typeable" holds the note to the strict list too', () => {
    const strict = createCoachValidator({ allowlist, noteScope: "typeable" });
    expect(strict.noteScope).toBe("typeable");
    expect(strict.validate({ ...good, note: "Phobos and Deimos spin past us." })).toEqual(
      { ok: false, reason: "allowlist" },
    );
  });
});

describe("word count gate (AC-15.2, FR-15)", () => {
  it(`AC-15.2: rejects a note longer than ${MAX_NOTE_WORDS} words`, () => {
    // 21 allowlisted words: passes schema, allowlist and the banned scan.
    const long = new Array(MAX_NOTE_WORDS + 1).fill("rock").join(" ");
    const open = createCoachValidator({ allowlist: permissiveAllowlist });
    expect(open.validate({ ...good, note: long })).toEqual({
      ok: false,
      reason: "length",
    });
  });

  it(`AC-15.2: accepts a note of exactly ${MAX_NOTE_WORDS} words`, () => {
    const exact = new Array(MAX_NOTE_WORDS).fill("rock").join(" ");
    const open = createCoachValidator({ allowlist: permissiveAllowlist });
    expect(open.validate({ ...good, note: exact }).ok).toBe(true);
  });

  it("AC-15.2: the limit is configurable for content tests", () => {
    const tight = createCoachValidator({ allowlist, maxNoteWords: 3 });
    expect(tight.maxNoteWords).toBe(3);
    expect(tight.validate(good)).toEqual({ ok: false, reason: "length" });
  });
});

describe("banned-term gate (AC-15.2, AC-25.3, D34)", () => {
  // The permissive allowlist removes the allowlist gate, so a refusal here can
  // only have come from the banned scan.
  const open = createCoachValidator({ allowlist: permissiveAllowlist });

  it('AC-15.2: rejects a response containing "liquor" (D34 worked example)', () => {
    expect(
      open.validate({
        note: "Pack my box with five dozen liquor jugs.",
        variants: good.variants,
      }),
    ).toEqual({ ok: false, reason: "banned" });
  });

  it("AC-15.2: a blocked word in a variant is refused by the layer above", () => {
    // D34's layering, demonstrated: even with `has` wide open, the allowlist
    // module's own checkWord runs isBlocked first, so a variant carrying
    // "liquor" never reaches the banned scan. Both gates catch it; the first
    // one wins. The outcome - fallback - is what AC-15.1 cares about.
    expect(
      open.validate({
        note: "Nice flying.",
        variants: ["Mars is the red planet.", "Five dozen liquor jugs."],
      }),
    ).toEqual({ ok: false, reason: "allowlist" });
  });

  it('AC-25.3: a note containing "wrong" is refused (D31, story note 6)', () => {
    // "wrong" IS on the fixture allowlist, so only the voice rule can catch it.
    expect(
      validator.validate({
        note: "That one was wrong, pilot. Watch for rivers next time.",
        variants: good.variants,
      }),
    ).toEqual({ ok: false, reason: "banned" });
  });

  it('AC-25.3: inflections and unsplittable tokens containing "wrong" are refused', () => {
    expect(saysWrong("You read that wrongly")).toBe(true);
    expect(saysWrong("you-were-wrong-there")).toBe(true);
    expect(saysWrong("Nice flying, pilot.")).toBe(false);
  });

  it("AC-25.3: the shipped voice list is exactly the word the docs name", () => {
    expect(SHADOW_BANNED_TERMS).toEqual(["wrong"]);
  });

  it("AC-15.2: the banned list is extensible for content without touching code", () => {
    const strict = createCoachValidator({
      allowlist: permissiveAllowlist,
      bannedTerms: ["wrong", "fail"],
    });
    expect(strict.validate({ note: "Do not fail me", variants: good.variants })).toEqual(
      { ok: false, reason: "banned" },
    );
  });

  it("AC-15.2: scanForBanned labels content and voice hits differently", () => {
    expect(scanForBanned("five dozen liquor jugs")).toEqual({
      term: "liquor",
      reason: "blocked-word",
    });
    expect(scanForBanned("that was wrong")).toEqual({
      term: "wrong",
      reason: "banned-term",
    });
    expect(scanForBanned("nice flying pilot")).toBeNull();
    expect(saysWrong("five dozen liquor jugs")).toBe(false);
  });
});

describe("request sanitisation (D34)", () => {
  it("AC-15.2: missed and slow words are allowlist-filtered before any use", () => {
    const safe = validator.sanitize({
      stopId: "mars",
      lang: "en",
      missed: ["Rivers.", "zorblax", "empty"],
      slow: ["liquor", "across"],
      hitRate: 0.5,
    });
    expect(safe.missed).toEqual(["rivers", "empty"]);
    expect(safe.slow).toEqual(["across"]);
  });

  it("AC-15.2: hitRate is clamped into [0, 1] and NaN reads as 0", () => {
    const at = (hitRate: number): number =>
      validator.sanitize({
        stopId: "mars",
        lang: "en",
        missed: [],
        slow: [],
        hitRate,
      }).hitRate;
    expect(at(-3)).toBe(0);
    expect(at(9)).toBe(1);
    expect(at(Number.NaN)).toBe(0);
    expect(at(0.42)).toBe(0.42);
  });

  it("exposes the allowlist it was built with", () => {
    expect(validator.allowlist).toBe(allowlist);
    expect(validator.maxNoteWords).toBe(MAX_NOTE_WORDS);
    expect(validator.noteScope).toBe("readable");
  });
});
