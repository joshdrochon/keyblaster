import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SKY_PLATE } from "@game/ui/theme";
import { FOCUS_PAD } from "@game/scenes/support/titleStack";

/**
 * UR-80: THE TITLE HAS ONE LEFT EDGE, AND IT IS THE ONE YOU CAN SEE.
 *
 * ================== THE DEFECT ==================
 * `COLUMN_X` gave every block on the title ONE ORIGIN, which is not the same
 * thing as one left edge. Three kinds of block draw to the LEFT of their own
 * origin: a glass plate bleeds `SKY_PLATE.padX` (22), a focus ring reaches
 * `FOCUS_PAD` (14) outside its control, and the wordmark bleeds nothing. So a
 * single origin produced three visible edges - measured on the served build at
 * 178, 186 and 200 - and the screen read as ragged down its whole left side.
 *
 * The previous pass measured the plate bleed, called it the plate's own
 * geometry and left it. That is true about the cause and wrong about the
 * result: nobody looking at the screen can see an origin.
 *
 * ================== WHY A SOURCE GUARD ==================
 * `TitleScene.ts` extends a Phaser class and cannot be imported under vitest's
 * node environment. What this file CAN do, and what a regex alone could not, is
 * check the offsets against the real `SKY_PLATE.padX` and `FOCUS_PAD` values -
 * so if either token moves, this fails rather than silently describing an
 * edge the screen no longer has.
 *
 * The measurement itself is in the browser: every visible left edge on the
 * title reads 200 in both focus states.
 */
const source = (): string =>
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/scenes/TitleScene.ts"),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

describe("UR-80: every block on the title starts on one visible line", () => {
  it("offsets each block by its own bleed, off the real tokens", () => {
    const s = source();
    // WATCHED FAILING, with `PLATED_X` set back to `COLUMN_X`:
    //   a plated line is not offset by the plate's bleed, so its plate hangs
    //   left of the wordmark: expected false to be true
    expect(
      /const PLATE_BLEED_X = SKY_PLATE\.padX;/.test(s),
      "the plate's bleed is no longer taken from SKY_PLATE, so the two can drift",
    ).toBe(true);
    expect(
      /const PLATED_X = COLUMN_X \+ PLATE_BLEED_X;/.test(s),
      "a plated line is not offset by the plate's bleed, so its plate hangs " +
        "left of the wordmark",
    ).toBe(true);
    expect(
      /const PRIMARY_X = COLUMN_X \+ FOCUS_PAD;/.test(s),
      "the primary is not offset by its ring's reach, so the ring hangs left " +
        "of the wordmark whenever it holds focus",
    ).toBe(true);
    // The numbers the offsets resolve to, so a token move is caught here.
    expect(SKY_PLATE.padX).toBe(22);
    expect(FOCUS_PAD).toBe(14);
  });

  it("gives all three plated lines the bled x, not just the one that was noticed", () => {
    // The tagline, the status line under the primary and the quiet rows are the
    // three plated blocks. Fixing one and not the others is how this screen got
    // three edges in the first place.
    //
    // WATCHED FAILING, with the tagline reverted to COLUMN_X:
    //   expected 2 to be 3
    const s = source();
    const plain = (s.match(/skyText\(this, PLATED_X,/g) ?? []).length;
    const inherited = (s.match(/skyText\(this, PLATED_X - PRIMARY_X,/g) ?? []).length;
    expect(plain + inherited, "a plated line was left on the bare column").toBe(3);
  });

  it("takes the primary's inset back off its own status line", () => {
    // The status line is a CHILD of the primary's container, so it inherits
    // `PRIMARY_X`. It carries no focus ring, so it must subtract that inset or
    // it sits a focus-pad right of every other plate on the screen - which is
    // exactly what shipped the first time this column was "fixed".
    //
    // WATCHED FAILING, with the subtraction removed:
    //   the status line keeps the primary's ring inset, so its plate sits right
    //   of every other plate: expected false to be true
    expect(
      /skyText\(this, PLATED_X - PRIMARY_X,/.test(source()),
      "the status line keeps the primary's ring inset, so its plate sits right " +
        "of every other plate",
    ).toBe(true);
  });

  it("moves the whole primary, never just its plate", () => {
    const s = source();
    // The ring and the hit zone are struck from `root.x` and the label is
    // centred on the same origin, so the CONTROL is what carries the offset.
    expect(/buildPrimary\([^)]*WORDMARK_X \+ PRIMARY_X/.test(s)).toBe(true);
    expect(
      /paintPlate\(\s*plate,\s*\{ x: COLUMN_X,/.test(s),
      "the primary's plate carries the offset instead of the control, which " +
        "puts its label off centre",
    ).toBe(true);
  });

  it("lands a quiet row's ring on the column too", () => {
    // A ring that only misaligns while its row holds focus is the same defect,
    // visible less often.
    //
    // WATCHED FAILING, with `ringBox` returning `item.root.x` flat:
    //   expected false to be true
    expect(
      /const inset = item\.id === "primary" \? 0 : FOCUS_PAD;/.test(source()),
      "a quiet row's focus ring reaches left of the column when it is focused",
    ).toBe(true);
  });
});
