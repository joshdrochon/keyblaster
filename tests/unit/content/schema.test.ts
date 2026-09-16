import { describe, expect, it } from "vitest";
import { LANGS, STOP_IDS, isLang, isStopId } from "@engine/types";
import {
  type Bundle,
  CONTENT_LANGS,
  EXPECTED_STOPS,
  bundlesFor,
  rawSightWords,
} from "./fixtures.js";

/**
 * AC-12.2 - "each of the six belt stops has: briefing, asteroid pool,
 * pre-flight line, warp sentence, beacon text, IN ALL THREE LANGUAGES", plus
 * the D57 launchpad exception and the D45 shape rule.
 *
 * D45 is the reason this file exists at all: "translations preserve the pool /
 * sentence STRUCTURE, not word-for-word". So nothing here compares a Spanish or
 * Hindi string to its English counterpart. What is asserted is that the three
 * languages agree on STRUCTURE - same stops, same fields, same nullability,
 * same briefing-length band, same launchpad rule - and that each language's
 * prose is internally consistent with its own pool. A Spanish briefing that
 * reads nothing like the English one is correct; a Spanish briefing with four
 * sentences where English has five is also correct.
 */

const BY_LANG = new Map(CONTENT_LANGS.map((l) => [l, bundlesFor(l)] as const));

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

describe("Stage bundles: schema and structure (AC-12.2, D45, D57)", () => {
  it("AC-12.2: all three content languages ship all seven stops", () => {
    // LANGS is the engine's closed list; the content folder must not drift
    // from it in either direction, or Settings offers a language with no prose.
    expect([...CONTENT_LANGS].sort()).toEqual([...LANGS].sort());
    for (const lang of CONTENT_LANGS) {
      const stops = (BY_LANG.get(lang) ?? []).map((b) => b.stopId).sort();
      expect(stops, `${lang} stop coverage`).toEqual([...EXPECTED_STOPS]);
      expect(stops.length).toBe(STOP_IDS.length);
    }
  });

  for (const lang of CONTENT_LANGS) {
    for (const b of BY_LANG.get(lang) ?? []) {
      it(`AC-12.2: ${lang}/${b.stopId} satisfies the StageBundle schema`, () => {
        // Field-by-field, because the game narrows this JSON with a
        // hand-written validator (scenes/lib/content.ts) that THROWS on a
        // miss. A malformed bundle must fail here, not on a child's screen.
        expect(isStopId(b.stopId)).toBe(true);
        expect(isLang(b.lang)).toBe(true);
        expect(b.lang, `${b.stopId} declares its folder's language`).toBe(lang);
        for (const key of [
          "planetName",
          "chapterTitle",
          "preflightLine",
          "beaconHeadline",
          "beaconState",
          "beaconFlavor",
        ] as const) {
          expect(typeof b[key], `${key} is a string`).toBe("string");
          expect(b[key].length, `${key} is non-empty`).toBeGreaterThan(0);
        }
        expect(isStringArray(b.briefing)).toBe(true);
        expect(isStringArray(b.pool)).toBe(true);
        expect(isStringArray(b.properNouns)).toBe(true);
        for (const key of ["activationWord", "warpSentence"] as const) {
          const v = b[key];
          expect(v === null || typeof v === "string", `${key} is string|null`).toBe(
            true,
          );
        }
      });

      it(`AC-12.2: ${lang}/${b.stopId} briefing is 3-5 sentences`, () => {
        // design-brief-v2 screen 4, and the exact band scenes/lib/content.ts
        // throws outside of.
        expect(b.briefing.length).toBeGreaterThanOrEqual(3);
        expect(b.briefing.length).toBeLessThanOrEqual(5);
        for (const s of b.briefing) expect(s.trim().length).toBeGreaterThan(0);
      });

      it(`AC-12.2: ${lang}/${b.stopId} pool has no duplicates`, () => {
        // A duplicate is invisible in JSON and doubles a word's spawn odds.
        expect(new Set(b.pool).size).toBe(b.pool.length);
        expect(new Set(b.properNouns).size).toBe(b.properNouns.length);
      });
    }

    it(`AC-12.1 / D57: ${lang} Earth is a launchpad, not a belt`, () => {
      const earth = (BY_LANG.get(lang) ?? []).find((b) => b.stopId === "earth");
      expect(earth?.pool, "Earth has no asteroid pool").toEqual([]);
      expect(earth?.warpSentence, "Earth has no warp break").toBeNull();
      expect(
        (earth?.activationWord ?? "").length,
        "Earth has one activation word",
      ).toBeGreaterThan(0);
    });

    it(`AC-12.2: every ${lang} belt stop ships all five parts`, () => {
      const belt = (BY_LANG.get(lang) ?? []).filter((b) => b.stopId !== "earth");
      expect(belt.length).toBe(6);
      for (const b of belt) {
        expect(b.pool.length, `${b.stopId} pool`).toBeGreaterThan(10);
        expect(b.preflightLine.length, `${b.stopId} pre-flight`).toBeGreaterThan(10);
        expect(b.warpSentence, `${b.stopId} warp sentence`).not.toBeNull();
        expect(b.beaconFlavor.length, `${b.stopId} beacon text`).toBeGreaterThan(10);
        expect(b.activationWord, `${b.stopId} has no activation word`).toBeNull();
      }
    });

    it(`D45: ${lang} sight-words.json is well formed and non-empty`, () => {
      const sight = rawSightWords(lang);
      expect(sight.lang).toBe(lang);
      expect(sight.note.length).toBeGreaterThan(0);
      expect(isStringArray([...sight.words])).toBe(true);
      expect(sight.words.length).toBeGreaterThan(50);
      expect(new Set(sight.words).size, "no duplicate sight words").toBe(
        sight.words.length,
      );
    });
  }

  it("D45: the three languages agree on STRUCTURE, not on wording", () => {
    // The structural contract translations must preserve: which stops carry a
    // warp sentence, which carries an activation word, and the fact that the
    // planet's own name is poolable everywhere (C13).
    const shape = (b: Bundle) => ({
      stopId: b.stopId,
      hasWarp: b.warpSentence !== null,
      hasActivation: b.activationWord !== null,
      hasPool: b.pool.length > 0,
    });
    const en = (BY_LANG.get("en") ?? []).map(shape);
    for (const lang of ["es", "hi"] as const) {
      expect((BY_LANG.get(lang) ?? []).map(shape), `${lang} shape`).toEqual(en);
    }
  });

  it("D45: no two languages ship the same prose (translation, not a copy)", () => {
    // Cheap tripwire for the failure mode where a lane copies en/*.json into
    // es/ or hi/ and edits only the filenames.
    for (const stop of EXPECTED_STOPS) {
      const prose = CONTENT_LANGS.map(
        (l) => (BY_LANG.get(l) ?? []).find((b) => b.stopId === stop)?.briefing.join(" "),
      );
      expect(new Set(prose).size, `${stop} briefings are distinct`).toBe(3);
    }
  });
});
