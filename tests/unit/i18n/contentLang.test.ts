import { describe, expect, it } from "vitest";
import { type InputMethod, type Lang, LANGS } from "@engine/types.js";
import {
  DEVANAGARI_INPUT_METHODS,
  DEVANAGARI_LANGS,
  availableContentLangs,
  typeableContentLangs,
  canTypeLang,
  isDevanagariLang,
  resolveContentLang,
} from "@engine/i18n/index.js";

const ALL_INPUT_METHODS: readonly InputMethod[] = [
  "latin",
  "translit",
  "inscript",
];

describe("AC-14.1: content languages are filtered by input method", () => {
  it("AC-14.1: Devanagari content is NOT offered on a latin input method", () => {
    expect(typeableContentLangs("latin")).toEqual(["en", "es"]);
    expect(typeableContentLangs("latin")).not.toContain("hi");
  });

  it("AC-14.1: Devanagari content IS offered on translit (D46)", () => {
    expect(typeableContentLangs("translit")).toContain("hi");
  });

  it("AC-14.1: Devanagari content IS offered on inscript", () => {
    expect(typeableContentLangs("inscript")).toContain("hi");
  });

  it("AC-14.1: hi is offered by exactly the two Devanagari input methods", () => {
    const offering = ALL_INPUT_METHODS.filter((m) =>
      typeableContentLangs(m).includes("hi"),
    );
    expect(offering.sort()).toEqual([...DEVANAGARI_INPUT_METHODS].sort());
  });

  it("AC-14.1: Latin-script content is offered on every input method", () => {
    for (const method of ALL_INPUT_METHODS) {
      expect(typeableContentLangs(method), method).toContain("en");
      expect(typeableContentLangs(method), method).toContain("es");
    }
  });

  /**
   * The full spec as a literal table. Asserting exact arrays is the point:
   * comparing availableContentLangs against LANGS.filter(canTypeLang) would
   * only prove Array.filter works, since that IS the implementation.
   */
  const EXPECTED: readonly [InputMethod, readonly Lang[]][] = [
    ["latin", ["en", "es"]],
    ["translit", ["en", "es", "hi"]],
    ["inscript", ["en", "es", "hi"]],
  ];

  for (const [method, expected] of EXPECTED) {
    it(`AC-14.1: ${method} offers exactly [${expected.join(", ")}]`, () => {
      expect(typeableContentLangs(method)).toEqual(expected);
    });
  }

  it("AC-14.1: the menu never offers a language twice", () => {
    for (const method of ALL_INPUT_METHODS) {
      const offered = typeableContentLangs(method);
      expect(new Set(offered).size, method).toBe(offered.length);
    }
  });

  it("AC-14.1: the returned array is a copy the caller may sort in place", () => {
    const first = typeableContentLangs("translit");
    first.reverse();
    expect(typeableContentLangs("translit")).toEqual(["en", "es", "hi"]);
  });

  it("hi is the only Devanagari language", () => {
    expect([...DEVANAGARI_LANGS]).toEqual(["hi"]);
    expect(isDevanagariLang("hi")).toBe(true);
    expect(isDevanagariLang("en")).toBe(false);
    expect(isDevanagariLang("es")).toBe(false);
  });
});

describe("resolveContentLang", () => {
  it("leaves a still-legal choice untouched", () => {
    // D95: es and hi are no longer shipped, so a choice of either is repaired
    // to English even when the input method could type it. The "leave a legal
    // choice alone" property is asserted on the language that IS shipped; the
    // Devanagari repair path keeps its own test below.
    expect(resolveContentLang("en", "translit", "en")).toBe("en");
    expect(resolveContentLang("en", "latin", "en")).toBe("en");
  });

  it("AC-14.1: repairs hi content when the input method drops to latin", () => {
    // D95: the uiLang fallback is also filtered, so this lands on English
    // rather than Spanish. Restoring SHIPPED_LANGS restores the es outcome.
    expect(resolveContentLang("hi", "latin", "es")).toBe("en");
  });

  it("falls back to en when the UI language is also untypeable", () => {
    // UI in Hindi, content in Hindi, but the keyboard can no longer type it.
    expect(resolveContentLang("hi", "latin", "hi")).toBe("en");
  });

  it("never returns an untypeable language for any starting state", () => {
    for (const method of ALL_INPUT_METHODS) {
      for (const current of LANGS) {
        for (const ui of LANGS) {
          const resolved: Lang = resolveContentLang(current, method, ui);
          expect(canTypeLang(resolved, method), `${current}/${method}/${ui}`).toBe(
            true,
          );
        }
      }
    }
  });
});
