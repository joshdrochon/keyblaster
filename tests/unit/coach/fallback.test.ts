import { describe, expect, it } from "vitest";
import { LANGS, STOP_IDS } from "@engine/types.js";
import {
  DEFAULT_FALLBACK_BUNDLE,
  MAX_NOTE_WORDS,
  fallbackFor,
  fallbackIssues,
  parseCoachPayload,
} from "@engine/coach/index.js";
import { tokenize } from "@engine/allowlist/index.js";

/**
 * The shipped fallback bundle (D33). Every failure in AC-15.1 and AC-15.2
 * lands here, and offline (NFR-2) it is the only text there is, so it gets the
 * same scrutiny as generated output.
 */

describe("AC-15.1: the fallback is never empty", () => {
  it("AC-15.1: every (language, stop) pair resolves to usable text", () => {
    for (const lang of LANGS) {
      for (const stopId of STOP_IDS) {
        const payload = fallbackFor(DEFAULT_FALLBACK_BUNDLE, lang, stopId);
        expect(payload.note.trim().length, `${lang}/${stopId}`).toBeGreaterThan(0);
        expect(payload.variants, `${lang}/${stopId}`).toHaveLength(2);
        expect(payload.variants[0].trim().length).toBeGreaterThan(0);
        expect(payload.variants[1].trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("AC-15.1: a language with no per-stop entry degrades to its own language, not English", () => {
    const es = fallbackFor(DEFAULT_FALLBACK_BUNDLE, "es", "mars");
    const en = fallbackFor(DEFAULT_FALLBACK_BUNDLE, "en", "mars");
    expect(es.note).not.toBe(en.note);
    expect(es).toEqual(DEFAULT_FALLBACK_BUNDLE.byLang.es.base);
  });

  it("AC-15.1: a stop with its own entry gets it, not the language default", () => {
    const mars = fallbackFor(DEFAULT_FALLBACK_BUNDLE, "en", "mars");
    expect(mars).not.toEqual(DEFAULT_FALLBACK_BUNDLE.byLang.en.base);
    expect(mars.variants[0]).toBe("Mars is the red planet.");
  });

  it("D57: Earth has an entry even though it has no belt, so no path can be empty", () => {
    const earth = fallbackFor(DEFAULT_FALLBACK_BUNDLE, "en", "earth");
    expect(earth.note.trim().length).toBeGreaterThan(0);
  });

  it("every stop from the route has an English entry", () => {
    for (const stopId of STOP_IDS) {
      expect(DEFAULT_FALLBACK_BUNDLE.byLang.en.byStop[stopId]).toBeDefined();
    }
  });
});

describe("AC-15.2 / AC-25.3: the shipped bundle obeys the same rules as live output", () => {
  it("AC-15.2: the shipped bundle has no schema, length or banned-term issues", () => {
    expect(fallbackIssues(DEFAULT_FALLBACK_BUNDLE)).toEqual([]);
  });

  it(`AC-15.2: every shipped note is at most ${MAX_NOTE_WORDS} words`, () => {
    for (const lang of LANGS) {
      for (const stopId of STOP_IDS) {
        const payload = fallbackFor(DEFAULT_FALLBACK_BUNDLE, lang, stopId);
        expect(tokenize(payload.note, lang).length, `${lang}/${stopId}`)
          .toBeLessThanOrEqual(MAX_NOTE_WORDS);
      }
    }
  });

  it('AC-25.3: no shipped line contains "wrong"', () => {
    for (const lang of LANGS) {
      for (const stopId of STOP_IDS) {
        const payload = fallbackFor(DEFAULT_FALLBACK_BUNDLE, lang, stopId);
        for (const text of [payload.note, ...payload.variants]) {
          expect(text.toLowerCase()).not.toContain("wrong");
        }
      }
    }
  });

  it("AC-15.2: every shipped entry matches the FR-15 schema", () => {
    for (const lang of LANGS) {
      for (const stopId of STOP_IDS) {
        expect(
          parseCoachPayload(fallbackFor(DEFAULT_FALLBACK_BUNDLE, lang, stopId)),
        ).not.toBeNull();
      }
    }
  });
});

describe("fallbackIssues catches a bad authored bundle", () => {
  const wrap = (note: string, variants: [string, string]) => ({
    byLang: {
      en: { base: { note, variants }, byStop: {} },
      es: DEFAULT_FALLBACK_BUNDLE.byLang.es,
      hi: DEFAULT_FALLBACK_BUNDLE.byLang.hi,
    },
  });

  it("reports an over-long note", () => {
    const long = new Array(MAX_NOTE_WORDS + 3).fill("word").join(" ");
    const issues = fallbackIssues(wrap(long, ["A.", "B."]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("limit 20");
  });

  it('AC-25.3: reports a note that says "wrong"', () => {
    const issues = fallbackIssues(wrap("That was wrong, pilot.", ["A.", "B."]));
    expect(issues[0]).toContain("wrong");
    expect(issues[0]).toContain("banned-term");
  });

  it("D34: reports a blocked content word in a variant", () => {
    const issues = fallbackIssues(wrap("Nice flying.", ["A.", "Five dozen liquor jugs."]));
    expect(issues[0]).toContain("liquor");
    expect(issues[0]).toContain("blocked-word");
  });

  it("reports a per-stop entry that breaks the schema", () => {
    const issues = fallbackIssues({
      byLang: {
        en: {
          base: DEFAULT_FALLBACK_BUNDLE.byLang.en.base,
          byStop: {
            mars: { note: "", variants: ["A.", "B."] },
          },
        },
        es: DEFAULT_FALLBACK_BUNDLE.byLang.es,
        hi: DEFAULT_FALLBACK_BUNDLE.byLang.hi,
      },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("en.mars");
    expect(issues[0]).toContain("schema");
  });

  it("honours a custom word limit", () => {
    expect(fallbackIssues(DEFAULT_FALLBACK_BUNDLE, 3).length).toBeGreaterThan(0);
  });
});
