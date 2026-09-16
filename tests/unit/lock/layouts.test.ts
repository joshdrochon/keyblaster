import { describe, expect, it } from "vitest";
import { LAYOUT_MAPS, type KeyInput, resolveChar } from "@engine/lock/index.js";
import type { KeyboardLayout } from "@engine/types.js";

const LAYOUTS: readonly KeyboardLayout[] = [
  "qwerty",
  "azerty",
  "qwertz",
  "dvorak",
];

/**
 * The physical keys, restated independently of the engine table so that a
 * permutation of the map cannot pass these tests. Each expectation below was
 * checked against the real national layout, key by key.
 */
const ROW_CODES: readonly (readonly string[])[] = [
  [
    "Backquote", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6",
    "Digit7", "Digit8", "Digit9", "Digit0", "Minus", "Equal",
  ],
  [
    "KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO",
    "KeyP", "BracketLeft", "BracketRight",
  ],
  [
    "KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL",
    "Semicolon", "Quote", "Backslash",
  ],
  ["KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM", "Comma", "Period", "Slash"],
];

/** Unshifted output of each physical row, per layout. */
const EXPECTED_ROWS: Readonly<Record<KeyboardLayout, readonly string[]>> = {
  qwerty: ["`1234567890-=", "qwertyuiop[]", "asdfghjkl;'\\", "zxcvbnm,./"],
  azerty: ["²&é\"'(-è_çà)=", "azertyuiop^$", "qsdfghjklmù*", "wxcvbn,;:!"],
  qwertz: ["^1234567890ß´", "qwertzuiopü+", "asdfghjklöä#", "yxcvbnm,.-"],
  dvorak: ["`1234567890[]", "',.pyfgcrl/=", "aoeuidhtns-\\", ";qjkxbmwvz"],
};

function input(partial: Partial<KeyInput>): KeyInput {
  return { key: "", code: "", ctrl: false, alt: false, meta: false, ...partial };
}

describe("AC-19.2: keyboard layout changes the key→char map", () => {
  it("AC-19.2: every physical key on every layout types the pinned character", () => {
    for (const layout of LAYOUTS) {
      const rows = EXPECTED_ROWS[layout];
      ROW_CODES.forEach((codes, rowIndex) => {
        const expectedRow = [...(rows[rowIndex] as string)];
        expect(expectedRow).toHaveLength(codes.length);
        codes.forEach((code, i) => {
          const expected = expectedRow[i] as string;
          expect(LAYOUT_MAPS[layout].get(code), `${layout} ${code}`).toBe(expected);
          expect(resolveChar(input({ code, key: "?" }), layout)).toBe(expected);
        });
      });
      expect(LAYOUT_MAPS[layout].size).toBe(47);
    }
  });

  it("AC-19.2: AZERTY moves a, z, w, q and m — the keys a French child types", () => {
    const azerty = LAYOUT_MAPS.azerty;
    // Semicolon → m is the one that silently breaks "maman", "moment", "comme".
    expect(azerty.get("Semicolon")).toBe("m");
    expect(azerty.get("KeyQ")).toBe("a");
    expect(azerty.get("KeyA")).toBe("q");
    expect(azerty.get("KeyZ")).toBe("w");
    expect(azerty.get("KeyW")).toBe("z");
    expect(azerty.get("KeyM")).toBe(",");
    // The QWERTY positions of those letters must NOT still produce them.
    expect(azerty.get("KeyM")).not.toBe("m");
  });

  it("AC-19.2: QWERTZ swaps y and z and puts the umlauts on the home row", () => {
    const qwertz = LAYOUT_MAPS.qwertz;
    expect(qwertz.get("KeyY")).toBe("z");
    expect(qwertz.get("KeyZ")).toBe("y");
    expect(qwertz.get("Semicolon")).toBe("ö");
    expect(qwertz.get("Quote")).toBe("ä");
    expect(qwertz.get("BracketLeft")).toBe("ü");
    expect(qwertz.get("Minus")).toBe("ß");
  });

  it("AC-19.2: the Dvorak home row reads a-o-e-u-i-d-h-t-n-s", () => {
    const codes = [
      "KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL",
      "Semicolon",
    ];
    expect(codes.map((c) => LAYOUT_MAPS.dvorak.get(c)).join(""))
      .toBe("aoeuidhtns");
    expect(LAYOUT_MAPS.dvorak.get("KeyQ")).toBe("'");
    expect(LAYOUT_MAPS.dvorak.get("Semicolon")).toBe("s");
    expect(LAYOUT_MAPS.dvorak.get("KeyZ")).toBe(";");
    expect(LAYOUT_MAPS.dvorak.get("Slash")).toBe("z");
  });

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

  it("AC-19.2: every layout can type the whole Latin alphabet", () => {
    for (const layout of LAYOUTS) {
      const produced = new Set(LAYOUT_MAPS[layout].values());
      for (const ch of "abcdefghijklmnopqrstuvwxyz") {
        expect(produced.has(ch), `${layout} cannot type ${ch}`).toBe(true);
      }
      expect(new Set(LAYOUT_MAPS[layout].values()).size).toBe(47);
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
