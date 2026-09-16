import { describe, expect, it } from "vitest";
import {
  MAX_WORD_LENGTH,
  checkWord,
  createAllowlist,
  filterWords,
  isBlocked,
  normalizeWord,
  sentenceIsAllowed,
  tokenize,
} from "@engine/allowlist/index.js";
import type { Lang } from "@engine/types";
import {
  type Bundle,
  CONTENT_LANGS,
  bundlesFor,
  readableProse,
  sightWordsFor,
  typedCopy,
} from "./fixtures.js";

/**
 * The allowlist gate over all three languages (AC-12.3, AC-13.1, AC-13.2, D34).
 *
 * THE ALLOWLIST THIS USES. `scripts/compile-allowlist` (architecture 5.2) has
 * not run, so there is no Fry-1000 (or its Spanish / Hindi equivalent) on disk.
 * Following tests/e2e/briefing.spec.ts exactly, the list is built PER STOP from
 * that stop's own pool plus `content/<lang>/sight-words.json` plus its proper
 * nouns, and `createAllowlist` DROPS anything blocked or over-length on the way
 * in. So a blocked or 14-letter pool word is absent from the very list it was
 * built from and `checkWord` rejects it: the check is not circular for exactly
 * the failure modes it exists to catch, and it is those failure modes that must
 * fail here rather than ship (lane brief rule 4).
 */

const SIGHT: Readonly<Record<Lang, readonly string[]>> = {
  en: sightWordsFor("en"),
  es: sightWordsFor("es"),
  hi: sightWordsFor("hi"),
};

const BY_LANG = new Map(CONTENT_LANGS.map((l) => [l, bundlesFor(l)] as const));

/** Same construction as the e2e English gate, parameterised by language. */
function allowlistFor(lang: Lang, b: Bundle) {
  return createAllowlist({
    lang,
    words: [
      ...b.pool,
      ...SIGHT[lang],
      ...(b.activationWord === null ? [] : [b.activationWord]),
    ],
    properNouns: b.properNouns,
  });
}

describe("Content passes the allowlist in every language (AC-13.2, D34)", () => {
  for (const lang of CONTENT_LANGS) {
    for (const b of BY_LANG.get(lang) ?? []) {
      it(`AC-13.2: every ${lang}/${b.stopId} pool word is typeable`, () => {
        const list = allowlistFor(lang, b);
        for (const word of b.pool) {
          expect(isBlocked(word), `"${word}" is on the blocklist`).toBe(false);
          // Raw length, not normalised length: the asteroid plate is sized
          // from the string the artist draws, and normalizeWord can shorten a
          // Devanagari word (see normalization.test.ts).
          expect(
            word.length,
            `"${word}" is longer than a word plate`,
          ).toBeLessThanOrEqual(MAX_WORD_LENGTH);
          expect(checkWord(word, list), `"${word}" was refused`).toBeNull();
        }
      });

      it(`AC-13.2: every word a child READS at ${lang}/${b.stopId} is listed`, () => {
        const list = allowlistFor(lang, b);
        const unknown = tokenize(readableProse(b), lang).filter(
          (w) => !list.hasReadable(w),
        );
        // A word added to a briefing, a pre-flight line or a beacon line
        // without being added to the pool, the proper nouns or
        // sight-words.json fails HERE rather than reaching a child.
        expect(unknown, `${lang}/${b.stopId} prose has unlisted words`).toEqual([]);
      });

      it(`AC-13.1: every word a child TYPES at ${lang}/${b.stopId} is allowed`, () => {
        const list = allowlistFor(lang, b);
        const typed = typedCopy(b);
        expect(typed.length, "there is something to type").toBeGreaterThan(0);
        // sentenceIsAllowed is the production predicate; using it rather than
        // re-implementing the check is what keeps this test honest.
        expect(
          sentenceIsAllowed(typed, list),
          `${lang}/${b.stopId} typed copy: "${typed}"`,
        ).toBe(true);
        expect(filterWords(tokenize(typed, lang), list).rejected).toEqual([]);
      });

      it(`AC-13.2: no ${lang}/${b.stopId} proper noun is blocked`, () => {
        for (const noun of b.properNouns) {
          expect(isBlocked(normalizeWord(noun, lang)), noun).toBe(false);
        }
      });
    }

    it(`AC-13.2: no ${lang} sight word is blocked or over-length`, () => {
      for (const w of SIGHT[lang]) {
        expect(isBlocked(normalizeWord(w, lang)), `"${w}" is blocked`).toBe(false);
        expect(w.length, `"${w}" is over-length`).toBeLessThanOrEqual(
          MAX_WORD_LENGTH,
        );
      }
    });
  }
});

describe("Warp sentences are built from pool words (AC-12.3, C13)", () => {
  for (const lang of CONTENT_LANGS) {
    const sight = new Set(SIGHT[lang].map((w) => normalizeWord(w, lang)));
    for (const b of (BY_LANG.get(lang) ?? []).filter((x) => x.stopId !== "earth")) {
      it(`AC-12.3: every content word of the ${lang}/${b.stopId} warp sentence is in its pool`, () => {
        const pool = new Set(b.pool.map((w) => normalizeWord(w, lang)));
        const content = tokenize(b.warpSentence ?? "", lang).filter(
          (w) => !sight.has(w),
        );
        expect(
          content.length,
          `${b.stopId} warp sentence has no content words`,
        ).toBeGreaterThan(0);
        for (const word of content) {
          expect(pool.has(word), `"${word}" is not in the ${b.stopId} pool`).toBe(
            true,
          );
        }
      });

      it(`C13: the ${lang}/${b.stopId} planet name is in the pool and its moons are not`, () => {
        // C13, lean (a), as shipped in en/: the planet's OWN name is poolable,
        // because every warp sentence opens with it and AC-12.3 would
        // otherwise be unsatisfiable. Moons stay readable-only (story note 4).
        const pool = new Set(b.pool.map((w) => normalizeWord(w, lang)));
        const planet = normalizeWord(b.planetName, lang);
        expect(pool.has(planet), `${b.planetName} is poolable`).toBe(true);
        const moons = b.properNouns
          .map((n) => normalizeWord(n, lang))
          .filter((n) => n !== planet);
        for (const moon of moons) {
          expect(pool.has(moon), `moon "${moon}" must stay readable-only`).toBe(
            false,
          );
        }
      });
    }

    it(`C13: ${lang} Earth types its activation word, not a planet name`, () => {
      const earth = (BY_LANG.get(lang) ?? []).find((b) => b.stopId === "earth");
      const list = allowlistFor(lang, earth as Bundle);
      expect(list.has(earth?.activationWord ?? "")).toBe(true);
    });
  }
});

describe("Shipped copy stays inside the tone rules (AC-25.3, C07)", () => {
  /**
   * AC-25.3 in three languages. The English regexes come from
   * tests/e2e/story-lane.ts; the Spanish and Hindi rows are the direct
   * equivalents. This is a SUBSTRING claim and nothing more: it proves these
   * exact strings are absent, not that the tone is right in a language nobody
   * on this project reads. See VERIFICATION-GAP in transliteration.test.ts.
   */
  const PUNISHMENT: Readonly<Record<Lang, readonly RegExp[]>> = {
    en: [
      new RegExp(`\\b${"wr" + "ong"}\\b`, "i"),
      /\bincorrect\b/i,
      /\bfail(ed|ure)?\b/i,
      /\bgame\s*over\b/i,
      /\blives\b/i,
      /\berror\b/i,
    ],
    es: [
      /\bmal\b/i,
      /\bincorrecto\b/i,
      /\berror\b/i,
      /\bfallaste\b/i,
      /\bperdiste\b/i,
      /\bvidas\b/i,
    ],
    hi: [/गलत/, /गलती/, /हार/, /खेल\s*खत्म/, /जीवन/, /नाकाम/],
  };

  for (const lang of CONTENT_LANGS) {
    it(`AC-25.3: no shipped ${lang} Shadow line punishes the player`, () => {
      for (const b of BY_LANG.get(lang) ?? []) {
        const spoken = [b.preflightLine, b.beaconFlavor].join(" ");
        for (const re of PUNISHMENT[lang]) {
          expect(spoken, `${lang}/${b.stopId}: ${spoken}`).not.toMatch(re);
        }
      }
    });

    it(`C07: no shipped ${lang} copy names the ship; Earth uses {shipName}`, () => {
      const bundles = BY_LANG.get(lang) ?? [];
      for (const b of bundles) {
        const all = [...b.briefing, b.preflightLine, b.beaconFlavor].join(" ");
        expect(all, `${lang}/${b.stopId} names the ship`).not.toMatch(/lantern/i);
        expect(all, `${lang}/${b.stopId} names the ship`).not.toMatch(/linterna/i);
      }
      const earth = bundles.find((b) => b.stopId === "earth");
      expect(earth?.briefing.join(" ")).toContain("{shipName}");
      // The placeholder must not leak into anything the child types.
      for (const b of bundles) {
        expect(typedCopy(b)).not.toContain("{shipName}");
      }
    });
  }
});
