import type { KeyboardLayout } from "../types.js";

/**
 * One keydown, as plain data.
 *
 * The engine is DOM-free (CLAUDE.md HARD RULES), so the Flight scene translates
 * a real `KeyboardEvent` into this shape before handing it to the lock machine.
 * Only the modifiers that can turn a keystroke into a browser/OS command are
 * carried; Shift is deliberately absent because every typeable word is
 * lowercase after normalisation (allowlist/normalize.ts), so case is noise.
 */
export interface KeyInput {
  readonly key: string;
  readonly code: string;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
}

/**
 * Physical key codes, row by row, in the order the characters below list them.
 * We key off `code` (the physical position) rather than `key` because that is
 * what makes the layout setting (D41, AC-19.2) mean anything: the same physical
 * key produces "q" on QWERTY and "a" on AZERTY.
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
  [
    "KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM", "Comma", "Period",
    "Slash",
  ],
];

/**
 * Unshifted characters per layout, aligned 1:1 with ROW_CODES. Digits and
 * punctuation are included so that a word list containing "don't" or a hyphen
 * still types correctly on every layout.
 */
const ROW_CHARS: Readonly<Record<KeyboardLayout, readonly string[]>> = {
  qwerty: ["`1234567890-=", "qwertyuiop[]", "asdfghjkl;'\\", "zxcvbnm,./"],
  azerty: ["²&é\"'(-è_çà)=", "azertyuiop^$", "qsdfghjklmù*", "wxcvbn,;:!"],
  qwertz: ["^1234567890ß´", "qwertzuiopü+", "asdfghjklöä#", "yxcvbnm,.-"],
  dvorak: ["`1234567890[]", "',.pyfgcrl/=", "aoeuidhtns-\\", ";qjkxbmwvz"],
};

function buildMap(rows: readonly string[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  rows.forEach((row, rowIndex) => {
    const codes = ROW_CODES[rowIndex] as readonly string[];
    [...row].forEach((ch, i) => {
      const code = codes[i];
      if (code !== undefined) map.set(code, ch);
    });
  });
  return map;
}

/** Pure key→char maps, built once (architecture section 4.4). */
export const LAYOUT_MAPS: Readonly<
  Record<KeyboardLayout, ReadonlyMap<string, string>>
> = {
  qwerty: buildMap(ROW_CHARS.qwerty),
  azerty: buildMap(ROW_CHARS.azerty),
  qwertz: buildMap(ROW_CHARS.qwertz),
  dvorak: buildMap(ROW_CHARS.dvorak),
};

/**
 * Fold to the comparable form: NFC so Devanagari composed and decomposed
 * spellings match (D46), lowercase because the allowlist stores lowercase.
 */
function fold(raw: string): string {
  return raw.normalize("NFC").toLowerCase();
}

/**
 * Resolve a keydown to the text it types, or null if it is not a character key
 * at all. Usually one character; NFC can expand a single keypress into a base
 * letter plus a combining mark (U+0958 → KA + NUKTA), so the caller consumes
 * the result code point by code point.
 *
 * AC-3.5: any ctrl/alt/meta combination is a command, not typing, and is
 * dropped before it can reach the state machine. This also drops Windows AltGr
 * (reported as ctrl+alt) — acceptable, because no typeable word needs an AltGr
 * character, and the alternative is treating "ctrl+s" as a typo (D31).
 */
export function resolveChar(
  input: KeyInput,
  layout: KeyboardLayout,
): string | null {
  if (input.ctrl || input.alt || input.meta) return null;

  // A non-ASCII `key` means the OS or an IME already produced the character —
  // Devanagari InScript, for example (D46). Re-mapping it through a Latin
  // layout table would destroy it, so it is trusted as typed. Named keys
  // ("Shift", "Enter") are pure ASCII and never take this path.
  const keyChars = [...input.key];
  if (keyChars.some((c) => (c.codePointAt(0) as number) > 0x7f)) {
    return fold(input.key);
  }
  const only = keyChars.length === 1 ? keyChars[0] : undefined;

  const mapped = LAYOUT_MAPS[layout].get(input.code);
  if (mapped !== undefined) return fold(mapped);

  // Unmapped physical key (numpad, function row, "Enter", "Shift"…): fall back
  // to `key` when it is a single printable character, otherwise it is not
  // typing and is ignored rather than counted as a typo (D31).
  if (only === undefined || only.trim().length === 0) return null;
  return fold(only);
}
