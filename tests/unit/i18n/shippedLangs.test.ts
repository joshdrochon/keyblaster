import { describe, expect, it } from "vitest";
import {
  SHIPPED_LANGS,
  availableContentLangs,
  isShipped,
  resolveContentLang,
  typeableContentLangs,
} from "@engine/i18n/index.js";
import { LANGS, type InputMethod } from "@engine/types.js";
import { bundlesFor, sightWordsFor } from "../content/fixtures.js";

/**
 * D95 — Spanish and Hindi are withheld from the shipped menu for the hackathon
 * build. This file exists to make that cut PROVABLE in both directions:
 *
 *   - the player is offered English only, and a save that predates the cut is
 *     repaired rather than left pointing at content the menu will not show;
 *   - the Spanish and Hindi content is still THERE, still loaded, still
 *     validated, so the cut is reversible by editing one array.
 *
 * The second half is the important half. The tempting version of this change
 * was to delete the es/hi content, and that would have made every check
 * covering it pass by having nothing left to measure — the precise failure
 * catalogued throughout docs/audit.md. A cut that silently satisfies its own
 * tests is not a cut, it is a hole.
 */

const INPUT_METHODS: InputMethod[] = ["latin", "inscript", "translit"];

describe("AC-14.4 / D95: the shipped menu offers English only", () => {
  it("SHIPPED_LANGS is exactly English", () => {
    expect([...SHIPPED_LANGS]).toEqual(["en"]);
  });

  it("no input method can reach Spanish or Hindi content in the menu", () => {
    for (const im of INPUT_METHODS) {
      expect(availableContentLangs(im), `input method ${im}`).toEqual(["en"]);
    }
  });

  it("isShipped agrees with the array for every known language", () => {
    for (const lang of LANGS) {
      expect(isShipped(lang)).toBe(lang === "en");
    }
  });

  it("a profile saved before the cut degrades to English instead of a dead choice", () => {
    // A child who picked Spanish yesterday must not open the game to content
    // the Settings screen can no longer show.
    expect(resolveContentLang("es", "latin", "es")).toBe("en");
    expect(resolveContentLang("hi", "translit", "hi")).toBe("en");
    expect(resolveContentLang("en", "latin", "en")).toBe("en");
  });
});

describe("AC-14.4 / D95: the withheld content is dormant, not deleted", () => {
  // If any of these fail, the cut has become a deletion and restoring the two
  // languages is no longer a one-line change.
  for (const lang of ["es", "hi"] as const) {
    it(`${lang} still ships every stage bundle and its sight words`, () => {
      const bundles = bundlesFor(lang);
      expect(bundles.length).toBeGreaterThan(0);
      expect(sightWordsFor(lang).length).toBeGreaterThan(0);
      for (const b of bundles) {
        // Earth has no belt, so no word pool (types.ts). Every other stop does.
        if (b.stopId !== "earth") {
          expect(b.pool.length, `${lang}/${b.stopId} pool`).toBeGreaterThan(0);
        }
        expect(b.briefing.length, `${lang}/${b.stopId} briefing`).toBeGreaterThan(0);
      }
    });
  }

  it("the withheld languages are still known to the engine", () => {
    // LANGS is untouched: the ship filter is a filter, not a redefinition of
    // what a language is. Everything keyed by Lang keeps type-checking.
    expect([...LANGS].sort()).toEqual(["en", "es", "hi"]);
  });
});

describe("D95: AC-14.1's input-method rule is still exercised on all three languages", () => {
  // Without typeableContentLangs, filtering the menu down to English would
  // reduce the Devanagari branch of AC-14.1 to dead code that no test reaches,
  // and the rule would rot unnoticed while it was dormant.
  it("Devanagari content is typeable only by a Devanagari input method", () => {
    expect(typeableContentLangs("latin")).toEqual(["en", "es"]);
    expect(typeableContentLangs("inscript")).toEqual(["en", "es", "hi"]);
    expect(typeableContentLangs("translit")).toEqual(["en", "es", "hi"]);
  });

  it("NEGATIVE CONTROL: the two functions genuinely differ", () => {
    // If someone 'simplifies' typeableContentLangs into availableContentLangs,
    // this fails rather than silently halving the rule's coverage.
    expect(typeableContentLangs("inscript")).not.toEqual(availableContentLangs("inscript"));
  });

  it("the menu is always a subset of what the input method can type", () => {
    for (const im of INPUT_METHODS) {
      const menu = availableContentLangs(im);
      const typeable = new Set(typeableContentLangs(im));
      for (const lang of menu) expect(typeable.has(lang), `${lang} on ${im}`).toBe(true);
    }
  });
});
