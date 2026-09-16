import { describe, expect, it } from "vitest";
import {
  EN,
  ES,
  LANG_EXPANSION,
  STRING_KEYS,
  fits,
  overflowingLangs,
  projectedLength,
  widestLength,
} from "@engine/i18n/index.js";

describe("copy budget (design brief: Spanish +25%)", () => {
  it("encodes the documented +25% Spanish expansion", () => {
    expect(LANG_EXPANSION.es).toBe(1.25);
    expect(LANG_EXPANSION.en).toBe(1);
    // Devanagari runs shorter in characters; its cost is height, handled in render.
    expect(LANG_EXPANSION.hi).toBe(1);
  });

  it("projects a Spanish label 25% longer than its English source", () => {
    expect(projectedLength("Settings", "es")).toBe(10);
    expect(projectedLength("Settings", "en")).toBe(8);
    expect(projectedLength("Settings", "hi")).toBe(8);
  });

  it("rounds the projection up, never down", () => {
    expect(projectedLength("abc", "es")).toBe(4); // 3.75 -> 4
  });

  it("fits() is a plain character budget", () => {
    expect(fits("Play", 4)).toBe(true);
    expect(fits("Play", 3)).toBe(false);
  });
});

describe("overflowingLangs", () => {
  it("a box sized to the English string overflows in Spanish", () => {
    // "Settings" is 8 chars; "Ajustes" fits, but the menu label does not.
    const key = "settings.contentLang";
    const budget = EN[key].length;
    expect(ES[key].length).toBeGreaterThan(budget);
    expect(overflowingLangs(key, budget)).toContain("es");
  });

  it("a box sized to the projected Spanish length holds it", () => {
    const key = "settings.contentLang";
    expect(overflowingLangs(key, projectedLength(EN[key], "es"))).not.toContain(
      "es",
    );
  });

  it("returns an empty array when the budget is generous", () => {
    expect(overflowingLangs("common.back", 100)).toEqual([]);
  });

  it("skips languages with no entry for the key", () => {
    const sparse = { en: EN, es: {}, hi: {} } as const;
    expect(overflowingLangs("title.play", 1, sparse)).toEqual(["en"]);
  });

  it("names every language that overflows", () => {
    expect(overflowingLangs("title.play", 1).sort()).toEqual(["en", "es", "hi"]);
  });
});

describe("widestLength", () => {
  it("is the longest rendering across all three languages", () => {
    const key = "title.beaconLog";
    expect(widestLength(key)).toBe(ES[key].length);
  });

  it("is zero when no language has the key", () => {
    const empty = { en: {}, es: {}, hi: {} } as const;
    expect(widestLength("title.play", empty)).toBe(0);
  });

  it("sizing every container to widestLength leaves nothing overflowing", () => {
    for (const key of STRING_KEYS) {
      expect(overflowingLangs(key, widestLength(key)), key).toEqual([]);
    }
  });
});
