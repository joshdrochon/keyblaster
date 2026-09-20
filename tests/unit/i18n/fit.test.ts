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
  type StringKey,
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

});

describe("the design brief's +25% budget against the real translations", () => {
  /**
   * Keys whose actual Spanish string is LONGER than English + 25%.
   *
   * This is a real regression guard, not a restatement: it measures the
   * shipped translations against the one number the design brief gives. It is
   * also evidence that the flat +25% is wrong for short labels - "Locked" ->
   * "Bloqueado" is +50%, and short strings are exactly where a fixed-width
   * plate clips. The brief's number is implemented as written; this is the
   * list of places a renderer must not trust it.
   */
  const OVER_BUDGET: readonly StringKey[] = [
    "map.locked", // Locked -> Bloqueado, +50%
    "profile.nameShip", // Name your ship -> Ponle nombre a tu nave, +64%
    "profile.pilotName", // Pilot name -> Nombre del piloto, +70%
    "title.beaconLog", // Beacon Log -> Registro de balizas, +90%
    // "title.tagline" used to be here. It came OFF the list when the tagline
    // became a sentence ("Light the way through the solar system.", 39 chars) // no-user-quotes-ok: the game's OWN former tagline, superseded by UR-65; a report quoted it back, which is why the corpus matches
    // rather than a short label ("Light the way home.", 19). Spanish expands a
    // SENTENCE by roughly the brief's +25%; it expands a short LABEL by 50-90%.
    // So lengthening the English copy fixed a budget violation instead of
    // causing one - which is the whole point this list is making.
    //
    // "warp.heading" came off the list the same way and for the same reason.
    // It was "Warp break" (10) -> "Pausa de salto" (14), +40%. The screen was
    // recast as charging a beacon, so it is "Charging The Beacon" (19) ->
    // "Cargando la baliza" (18) - Spanish is SHORTER than the English here,
    // because the source string stopped being a two-word label.
    //
    // WATCHED FAILING, with the old heading in the table:
    //   the set of Spanish strings exceeding +25% is exactly the known list
    //     expected [ 'map.locked', ...(3) ] to deeply equal
    //     [ 'map.locked', ...(4) ]      (- "warp.heading")
  ];

  it("the set of Spanish strings exceeding +25% is exactly the known list", () => {
    const over = STRING_KEYS.filter(
      (key) => ES[key].length > projectedLength(EN[key], "es"),
    );
    expect(over.sort()).toEqual([...OVER_BUDGET].sort());
  });

  it("every over-budget key is a short label, which is where +25% fails", () => {
    for (const key of OVER_BUDGET) {
      expect(EN[key].length, key).toBeLessThanOrEqual(20);
    }
  });

  it("no Spanish string exceeds double its English source", () => {
    for (const key of STRING_KEYS) {
      expect(ES[key].length, key).toBeLessThanOrEqual(EN[key].length * 2);
    }
  });
});
