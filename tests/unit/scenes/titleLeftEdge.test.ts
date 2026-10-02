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

  it("every sky line starts on the column - bled if it is plated, bare if not", () => {
    // Stronger than the count this replaces. That one asserted "three calls use
    // PLATED_X", which said nothing about a line that carries no plate: the
    // tagline lost its pill and the count went 3 -> 2 with no statement left
    // about where it had gone. Each call is now classified and checked.
    //
    // WATCHED FAILING, with the tagline put back on PLATED_X while unplated:
    //   tagline is unplated, so it bleeds nothing and belongs on COLUMN_X
    const s = source();
    // The centred and flowed lines (the quiet label, the language row) are not
    // column blocks and are skipped by name.
    const COLUMN = ["COLUMN_X", "PLATED_X", "PLATED_X-PRIMARY_X"];
    const onColumn = s
      .split("skyText(this,")
      .slice(1)
      .map((part) => ({
        at: part.slice(0, part.indexOf(",")).replace(/\s+/g, ""),
        opts: part.slice(0, part.indexOf("\n    })")),
      }))
      .filter((c) => COLUMN.includes(c.at));
    // Two since settings became the primary's other half rather than a plated
    // word on its own line: the tagline and the primary's status line.
    expect(onColumn.length, "the column blocks on this screen are no longer two").toBe(2);
    for (const { at, opts } of onColumn) {
      if (/plated:\s*true/.test(opts)) {
        expect(at, "an unplated line bleeds nothing, so it belongs on COLUMN_X").toBe("COLUMN_X");
      } else {
        expect(at, "a plated line was left on the bare column").not.toBe("COLUMN_X");
      }
    }
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

  it("every control reports the box its ring is struck on (UR-88)", () => {
    // UR-88 was a control reporting its TEXT's rectangle while the ring was
    // struck around whatever it reported, so the plate stuck out of its own
    // highlight. The quiet row that had the defect is gone - settings is the
    // primary's other half now - so the guard is restated as the PROPERTY
    // rather than as that row's two literals, which would have gone quiet with
    // it and taken the rule with them.
    //
    // WATCHED FAILING, with `width: item.text.width + SKY_PLATE.padX * 2` put
    // back on a builder:
    //   a control reports a TEXT-derived width, so its ring is not its plate
    const src = source();
    const builders = src.split("): MenuItem {").slice(1);
    // primary, cog, and the language row that only ships with a second lang.
    expect(builders.length, "the title no longer builds three controls").toBe(3);
    for (const b of builders) {
      expect(
        /width:\s*\w+\.text\.width/.test(b),
        "a control reports a TEXT-derived width, so its ring is not its plate",
      ).toBe(false);
    }
    expect(
      /return \{ x: item\.root\.x, y: top, w: item\.width, h: item\.height \};/.test(src),
      "the ring is no longer struck on the box each control reports",
    ).toBe(true);
  });
});
