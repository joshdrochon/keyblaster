import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * UR-87: THE CARET SITS WHERE THE NEXT LETTER WILL GO.
 *
 * ================== THE DEFECT ==================
 * `TextField.redraw` drew the caret past the END of its `entry` text. When the
 * field is empty `entry` holds the PLACEHOLDER, so focusing an empty name box
 * put the caret after "Pilot Name" - as though the child were about to type the
 * eleventh character of a word they had never written. A placeholder is copy to
 * be typed over; the caret belongs at its first letter.
 *
 * ================== WHY A SOURCE GUARD ==================
 * `ui/controls.ts` imports Phaser and cannot be loaded under vitest's node
 * environment, and `TextField` needs a real Text object to measure. What is
 * checkable here is the branch itself: the offset must depend on `this.value`,
 * which is the one thing that tells an empty field from a typed one - the
 * RENDERED string cannot, because it is the placeholder exactly when the value
 * is empty.
 *
 * WATCHED FAILING, with the unconditional offset restored:
 *
 *   the caret is placed past the rendered text whether or not anything was
 *   typed, so an empty field puts it after the placeholder:
 *   expected false to be true
 */
const source = (): string =>
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/ui/controls.ts"),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

describe("UR-87: an empty field carets at the start of its placeholder", () => {
  it("branches the caret offset on the typed value, not the rendered text", () => {
    const s = source();
    expect(
      /const typed = this\.value !== "";/.test(s),
      "the caret no longer asks whether anything was typed",
    ).toBe(true);
    expect(
      /this\.entry\.x \+ \(typed \? this\.entry\.width \+ 6 : 0\)/.test(s),
      "the caret is placed past the rendered text whether or not anything was " +
        "typed, so an empty field puts it after the placeholder",
    ).toBe(true);
  });

  it("still swaps the placeholder out for the value, in text and in ink", () => {
    // The other half of placeholder behaviour, which already worked and must
    // keep working: typing replaces the copy and lifts it out of the dim ink.
    const s = source();
    expect(/setText\(next === "" \? this\.placeholder : next\)/.test(s)).toBe(true);
    expect(/setColor\(next === "" \? INK\.textDim : INK\.text\)/.test(s)).toBe(true);
  });
});
