import { describe, expect, it } from "vitest";
import {
  createAllowlist,
  normalizeWord,
  tokenize,
} from "@engine/allowlist/index.js";
import { LANG_EXPANSION, projectedLength } from "@engine/i18n/index.js";
import { CONTENT_LANGS, bundlesFor, sightWordsFor } from "./fixtures.js";

/**
 * Two things the shipped content exposes about `allowlist/normalize.ts`, and
 * the Spanish copy budget.
 *
 * FINDING 1 (BLOCKING FOR HINDI DISPLAY) - normalizeWord destroys trailing
 * Devanagari combining marks.
 *
 *   `normalizeWord` strips edge characters with
 *   `/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu`. Devanagari matras (ी ा ू े ो), the
 *   anusvara ं, the chandrabindu ँ, the nukta ़ and the virama ् are Unicode
 *   categories Mc and Mn - MARKS. They are neither \p{L} nor \p{N}, so any
 *   Hindi word ENDING in one is truncated:
 *
 *       गुलाबी -> गुलाब      ठंडा -> ठंड        प्लूटो -> प्लूट
 *       बड़ा   -> बड        सालों -> साल       झीलें -> झील
 *
 *   That is most of Hindi. The word-INITIAL case is safe, because every Hindi
 *   word starts with a consonant or an independent vowel, both \p{L}.
 *
 *   WHY THE ALLOWLIST GATE STILL HOLDS. `createAllowlist` normalises on the way
 *   IN and `has()` normalises on the way OUT, so both sides are truncated
 *   identically and lookups still succeed. The damage is downstream of the
 *   gate, in everything that reads the STORED string:
 *     - `Allowlist.words` - the asteroid plate would be drawn with the truncated
 *       spelling, i.e. a word that is not a word;
 *     - `filterWords(...).accepted` and `assertAllowed(...)`, which RETURN the
 *       normalised form, so a caller that keys a WordRecord by it keys it wrong;
 *     - anything comparing an allowlist entry to a Devanagari string that was
 *       not put through normalizeWord first.
 *   The transliteration matcher is unaffected: `normalizeTyped` in
 *   i18n/translit.ts does NFC + trim + lowercase only, with no edge stripping.
 *
 *   THE FIX IS NOT THIS LANE'S. `src/engine/allowlist/` belongs to the
 *   allowlist lane and `normalize.ts` must not be edited from here. The
 *   suggested change is to include \p{M} in the kept set, e.g.
 *   `/^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu`, which leaves the English
 *   and Spanish behaviour byte-identical (no Latin word ends in a combining
 *   mark once NFC has composed the accents) and makes the Devanagari round-trip
 *   exact. The tests below pin the CURRENT behaviour so the defect is visible
 *   and so closing it fails here rather than silently.
 *
 * FINDING 2 (SPANISH TYPEABILITY) - normalizeWord does not fold Spanish
 * diacritics, but i18n/contentLang.ts states that it does:
 *   "Spanish accents are handled by normalisation in allowlist/normalize.ts."
 *   They are not. NFC COMPOSES them; nothing removes them. So `júpiter` and
 *   `jupiter` are different words to the allowlist and to the lock, and a child
 *   on a keyboard without dead keys cannot complete the Júpiter warp sentence.
 *   The content ships correct Spanish rather than accent-stripped Spanish; the
 *   engine is where the fold belongs (fold accents for lang === "es" while
 *   keeping ñ distinct from n, since año / ano is not a joke to ship to
 *   children).
 */

const ES = bundlesFor("es");
const HI = bundlesFor("hi");
const EN = bundlesFor("en");

const ACCENTED = /[áéíóúü]/;

describe("REGRESSION: normalizeWord preserves Devanagari combining marks", () => {
  // This block replaces a FINDING block that PINNED the defect. Its own comment
  // said to delete it once the count reached zero. It has: allowlist/normalize.ts
  // now keeps \p{M}, so matras, anusvara, chandrabindu, nukta and virama survive.
  //
  // The defect was invisible to the allowlist gate, because construction and
  // lookup truncated identically. It was only visible from content - which is
  // why building the Hindi bundles found it and four months of English tests
  // would not have.
  it("round-trips every Hindi pool and sight word unchanged", () => {
    const mangled: string[] = [];
    for (const bundle of bundlesFor("hi")) {
      for (const w of bundle.pool) {
        if (normalizeWord(w, "hi") !== w) mangled.push(w);
      }
    }
    for (const w of sightWordsFor("hi")) {
      if (normalizeWord(w, "hi") !== w) mangled.push(w);
    }
    expect(mangled, `truncated: ${mangled.slice(0, 8).join(", ")}`).toEqual([]);
  });

  it("still strips real punctuation from a Devanagari token", () => {
    const w = "\u0939\u0948";
    expect(normalizeWord(`${w}.`, "hi")).toBe(w);
    expect(normalizeWord(`\u201C${w}\u201D`, "hi")).toBe(w);
  });
});

describe("FINDING: normalizeWord and Spanish accents", () => {
  it("FINDING: Spanish accents survive normalisation, so they must be typed", () => {
    // Pinned so the size of the problem is visible: these are the words a
    // child must produce an accented character for.
    const accented = ES.flatMap((b) => b.pool).filter((w) => ACCENTED.test(w));
    expect(accented.length).toBeGreaterThan(0);
    for (const w of accented) {
      expect(normalizeWord(w, "es"), `"${w}" was folded`).toBe(w);
      // ...and the unaccented spelling is therefore a DIFFERENT word.
      const plain = w.normalize("NFD").replace(/[̀-̄̈]/g, "");
      expect(normalizeWord(plain, "es")).not.toBe(normalizeWord(w, "es"));
    }
  });

  it("FINDING: the accented words in every typed Spanish warp sentence", () => {
    // The blast radius: which stops a child on an accent-less keyboard cannot
    // finish. Pinned rather than asserted-empty because rewriting the story's
    // voice to avoid Spanish orthography is the wrong fix.
    const blocked = ES.filter((b) => b.warpSentence !== null)
      .filter((b) => ACCENTED.test(b.warpSentence ?? ""))
      .map((b) => b.stopId)
      .sort();
    expect(blocked).toEqual(["jupiter", "neptune", "pluto"]);
  });

  it("ñ must never be folded away, whatever else is folded", () => {
    // año / ano. Any future accent-folding fix must keep this true.
    expect(normalizeWord("año", "es")).not.toBe(normalizeWord("ano", "es"));
  });
});

describe("D45 / fit: Spanish prose stays inside its copy budget", () => {
  it("LANG_EXPANSION documents Spanish at +25% and Hindi at parity", () => {
    expect(LANG_EXPANSION.es).toBe(1.25);
    expect(LANG_EXPANSION.hi).toBe(1);
  });

  for (const b of ES) {
    it(`fit: es/${b.stopId} briefing is within the projected Spanish budget`, () => {
      // The UI lane measured up to +90% growth on SHORT labels; prose has more
      // room to absorb Spanish's longer function words, so the budget checked
      // here is the documented +25% (fit.ts), applied to the whole briefing.
      const en = EN.find((x) => x.stopId === b.stopId);
      const budget = projectedLength(en?.briefing.join(" ") ?? "", "es");
      expect(b.briefing.join(" ").length, `${b.stopId} briefing`).toBeLessThanOrEqual(
        budget,
      );
    });
  }

  it("fit: no translated briefing sentence is longer than English's budget", () => {
    // The bound is derived from the shipped English prose rather than invented:
    // the longest English sentence, grown by the documented per-language
    // expansion. Nothing here is allowed to be a wall of text that English is
    // not already allowed to be.
    const longestEn = Math.max(
      ...EN.flatMap((b) => b.briefing).map((s) => s.length),
    );
    for (const lang of CONTENT_LANGS.filter((l) => l !== "en")) {
      const budget = projectedLength("x".repeat(longestEn), lang);
      for (const b of bundlesFor(lang)) {
        for (const s of b.briefing) {
          expect(s.length, `${lang}/${b.stopId}: ${s}`).toBeLessThanOrEqual(budget);
        }
      }
    }
  });
});
