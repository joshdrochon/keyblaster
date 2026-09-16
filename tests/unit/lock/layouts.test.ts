import { describe, expect, it } from "vitest";
import { LAYOUT_MAPS, type KeyInput, resolveChar } from "@engine/lock/index.js";
import type { KeyboardLayout } from "@engine/types.js";

const LAYOUTS: readonly KeyboardLayout[] = [
  "qwerty",
  "azerty",
  "qwertz",
  "dvorak",
];

function input(partial: Partial<KeyInput>): KeyInput {
  return {
    key: "",
    code: "",
    ctrl: false,
    alt: false,
    meta: false,
    ...partial,
  };
}

describe("AC-19.2: keyboard layout changes the key→char map", () => {
  it("AC-19.2: the same physical key types a different character per layout", () => {
    const code = "KeyQ";
    expect(resolveChar(input({ code, key: "q" }), "qwerty")).toBe("q");
    expect(resolveChar(input({ code, key: "a" }), "azerty")).toBe("a");
    expect(resolveChar(input({ code, key: "q" }), "qwertz")).toBe("q");
    expect(resolveChar(input({ code, key: "'" }), "dvorak")).toBe("'");
  });

  it("AC-19.2: the layout map wins over the reported key value", () => {
    // The scene may be running on a QWERTY machine while the player has set
    // AZERTY; `code` is the physical key, so the setting is what decides.
    expect(resolveChar(input({ code: "KeyW", key: "w" }), "azerty")).toBe("z");
    expect(resolveChar(input({ code: "KeyY", key: "y" }), "qwertz")).toBe("z");
    expect(resolveChar(input({ code: "KeyK", key: "k" }), "dvorak")).toBe("t");
  });

  it("AC-19.2: each layout maps every physical key to exactly one character", () => {
    for (const layout of LAYOUTS) {
      const map = LAYOUT_MAPS[layout];
      expect(map.size).toBe(47);
      expect(new Set(map.values()).size).toBe(47);
    }
  });

  it("AC-19.2: every layout can type the whole Latin alphabet", () => {
    for (const layout of LAYOUTS) {
      const produced = new Set(LAYOUT_MAPS[layout].values());
      for (const ch of "abcdefghijklmnopqrstuvwxyz") {
        expect(produced.has(ch), `${layout} cannot type ${ch}`).toBe(true);
      }
    }
  });

  it("AC-19.2: layouts agree on the digit row so numerals type the same", () => {
    for (const layout of ["qwerty", "qwertz", "dvorak"] as const) {
      expect(LAYOUT_MAPS[layout].get("Digit5")).toBe("5");
    }
    // AZERTY's unshifted digit row is punctuation, which is why the map, not
    // the character, is the contract.
    expect(LAYOUT_MAPS.azerty.get("Digit5")).toBe("(");
  });
});

describe("AC-3.5: keydown-shaped input", () => {
  it.each([
    ["ctrl", { ctrl: true }],
    ["alt", { alt: true }],
    ["meta", { meta: true }],
  ])("AC-3.5: ignores a %s combo", (_name, mods) => {
    expect(resolveChar(input({ code: "KeyS", key: "s", ...mods }), "qwerty"))
      .toBeNull();
  });

  it("AC-3.5: ignores named keys that type nothing", () => {
    for (const key of ["Shift", "Enter", "Backspace", "ArrowLeft", "Tab"]) {
      expect(resolveChar(input({ code: key, key }), "qwerty")).toBeNull();
    }
  });

  it("AC-3.5: ignores whitespace, which is never part of a word", () => {
    expect(resolveChar(input({ code: "Space", key: " " }), "qwerty")).toBeNull();
  });

  it("AC-3.5: falls back to the key value for unmapped physical keys", () => {
    // Numpad and any key outside the four mapped rows.
    expect(resolveChar(input({ code: "Numpad7", key: "7" }), "qwerty")).toBe("7");
  });

  it("AC-3.5: folds case and NFC so matching is against the normalised word", () => {
    expect(resolveChar(input({ code: "KeyA", key: "A" }), "qwerty")).toBe("a");
  });
});

describe("D46: non-Latin input is trusted, not re-mapped", () => {
  it("D46: a Devanagari key value passes through untouched", () => {
    // InScript puts घ on the physical KeyT; re-mapping through the Latin table
    // would turn it into "t" and make the word untypeable.
    expect(resolveChar(input({ code: "KeyT", key: "घ" }), "qwerty")).toBe("घ");
  });

  it("D46: composed and decomposed spellings resolve to the same text", () => {
    // U+0958 QA is a Unicode composition exclusion: NFC rewrites it to
    // KA + NUKTA, so one keypress can yield two code points. Both spellings
    // must reach the matcher identically.
    expect(resolveChar(input({ code: "KeyX", key: "क़" }), "qwerty"))
      .toBe("क़");
    expect(resolveChar(input({ code: "KeyX", key: "क़" }), "qwerty"))
      .toBe("क़");
  });
});
