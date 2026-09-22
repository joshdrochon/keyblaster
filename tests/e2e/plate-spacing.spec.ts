import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { bootFlight, flightState, freezeFlight, spawnAt, waitFrames } from "./support/flightBoot.js";

/**
 * "THE LETTERS ON THE ROCKS ARE UNEVENLY SPACED" - MEASURED ON A REAL BOARD,
 * IN A REAL BROWSER, WITH THE REAL FONT.
 *
 * ================== WHY THIS EXISTS ALONGSIDE THE UNIT TEST ==================
 * `tests/unit/render/wordPlateSpacing.test.ts` proves the arithmetic: pack each
 * glyph's advance, add `letterSpacingPx` between boxes, every gap comes out the
 * same. It proves it against a table of advances, because there is no font in
 * node.
 *
 * THAT IS EXACTLY THE SHAPE OF THE DEFECT IT IS GUARDING. The shipped layout was
 * internally consistent too - `startX + i * cell` with `cell` from
 * `cellWidthPx`, and the plate sized to match - and it still drew `mp` with the
 * two glyphs on top of each other, because the width it RESERVED had nothing to
 * do with the width the browser DREW. A green table-based test sitting on top of
 * a visibly broken word is instance 5 of `docs/verification-gaps.md`, not a new
 * kind of mistake.
 *
 * So this reads `reservedWidth` (what the layout chose the position from) and
 * `width` (what `Phaser.GameObjects.Text` measured the glyph at, with the face
 * the machine actually resolved) off the SAME live objects, and requires them
 * to agree. Once they agree, the even spacing follows and is checked too.
 *
 * ================== THE NEGATIVE CONTROL ==================
 * The old rule is re-run on the same board from the same drawn widths and the
 * overlaps it produced are counted. It is not a copy of the fix - it is
 * `i * cell`, the arithmetic that was deleted - and if it ever stops producing
 * overlaps then this board is not the case the report was about and the numbers
 * below are worth nothing.
 *
 * ================== WATCHED FAILING ==================
 * With `letterCentresPx` put back to `pen += cellWidthPx(style)`:
 *
 *   AssertionError: "jumping": letters 4 and 5 (m,p) overlap by 1.08 px on the
 *   screen: expected -1.0836000000000013 to be greater than 0
 *
 * RUN IT ALONE:
 *   PW_PORT=5199 npx playwright test tests/e2e/plate-spacing.spec.ts
 */

test.use({ trace: "off" });

const EVIDENCE_DIR = resolve(process.cwd(), "gauntlet/evidence");

/** `FlightScene.plateStyle.letterSpacingPx` with D41's setting off. */
const LETTER_SPACING_PX = 1;

/** `wordPlateGeometry.PLATE_PAD_X_PX`. */
const PLATE_PAD_X_PX = 14;

test("every letter on every plate is set on its own advance", async ({ page }) => {
  await bootFlight(page, { seed: 11, stageWordCount: 40, knobs: { maxLive: 8 } });
  // THE FIVE WORDS FROM THE REPORT, PUT ON THE BELT ON PURPOSE.
  //
  // Waiting for the picker to serve "jump" is not a test - the three words that
  // overlapped are specific, and a board that happens not to contain them
  // proves the spacing of whatever it did contain.
  //
  // The belt is FROZEN FIRST and the words are put down afterwards, so nothing
  // falls, is retired, or is picked over while the next one is being placed.
  // Placing them on a running belt lost one to the column rule and the loss
  // looked like a spacing failure.
  const placed = ["will", "little", "time", "jump", "small"];
  await freezeFlight(page);
  for (const word of placed) await spawnAt(page, word);
  const state = await flightState(page);

  const plates = state.rocks.filter((r) => r.letters.length > 1);
  expect(
    plates.length,
    "no plate with more than one letter was on the board; nothing was measured",
  ).toBeGreaterThan(2);
  for (const word of placed) {
    expect(
      plates.some((r) => r.word === word),
      `"${word}" was put on the belt and is not on the board; it is one of the words the report named`,
    ).toBe(true);
  }

  const rows: unknown[] = [];
  let oldRuleOverlaps = 0;
  let worstOldGap = Number.POSITIVE_INFINITY;
  let worstOldPair = "";

  for (const rock of plates) {
    const letters = rock.letters;
    const glyphs = [...rock.word];

    // 1. THE LAYOUT RESERVED WHAT THE RENDERER DREW.
    //
    // Half a pixel, because Phaser's `Text.width` is the canvas measurement
    // rounded up to whole texture pixels while `measureText` is subpixel, so
    // the two differ by up to one device pixel and never by a glyph.
    letters.forEach((letter, i) => {
      expect(
        Math.abs(letter.width - letter.reservedWidth),
        `"${rock.word}": the layout reserved ${letter.reservedWidth.toFixed(2)} px for "${glyphs[i]}" and Phaser drew it ${letter.width.toFixed(2)} px wide`,
      ).toBeLessThanOrEqual(1);
    });

    // 2. NO TWO GLYPHS TOUCH, AND EVERY GAP IS THE SAME.
    const gaps: number[] = [];
    for (let i = 0; i + 1 < letters.length; i += 1) {
      const a = letters[i];
      const b = letters[i + 1];
      if (a === undefined || b === undefined) continue;
      const gap = b.x - b.reservedWidth / 2 - (a.x + a.reservedWidth / 2);
      gaps.push(gap);
      expect(
        gap,
        `"${rock.word}": letters ${i} and ${i + 1} (${glyphs[i]},${glyphs[i + 1]}) overlap by ${(-gap).toFixed(2)} px on the screen`,
      ).toBeGreaterThan(0);
      expect(
        gap,
        `"${rock.word}": the gap between ${glyphs[i]} and ${glyphs[i + 1]} is ${gap.toFixed(2)} px, not the ${LETTER_SPACING_PX} px every other pair gets`,
      ).toBeCloseTo(LETTER_SPACING_PX, 6);
    }

    // 3. THE PLATE IS AS WIDE AS THE WORD IT HOLDS, both ends equal.
    const first = letters[0];
    const last = letters[letters.length - 1];
    if (first !== undefined && last !== undefined) {
      const halfWidth = (rock.plateRight - rock.plateLeft) / 2;
      const leftPad = first.x - first.reservedWidth / 2 + halfWidth;
      const rightPad = halfWidth - (last.x + last.reservedWidth / 2);
      expect(
        leftPad,
        `"${rock.word}": ${leftPad.toFixed(2)} px of plate to the left of the first letter`,
      ).toBeCloseTo(PLATE_PAD_X_PX, 4);
      expect(
        rightPad,
        `"${rock.word}": ${rightPad.toFixed(2)} px of plate to the right of the last letter`,
      ).toBeCloseTo(PLATE_PAD_X_PX, 4);
    }

    // 4. THE OLD RULE, ON THIS BOARD, FROM THESE DRAWN WIDTHS.
    const cell = 30 * 0.62 + LETTER_SPACING_PX;
    const oldGaps: number[] = [];
    for (let i = 0; i + 1 < letters.length; i += 1) {
      const a = letters[i];
      const b = letters[i + 1];
      if (a === undefined || b === undefined) continue;
      const gap = cell - (a.width + b.width) / 2;
      oldGaps.push(gap);
      if (gap < 0) oldRuleOverlaps += 1;
      if (gap < worstOldGap) {
        worstOldGap = gap;
        worstOldPair = `${rock.word} ${glyphs[i]}|${glyphs[i + 1]}`;
      }
    }

    rows.push({
      word: rock.word,
      drawnWidths: letters.map((l) => Number(l.width.toFixed(2))),
      before: oldGaps.map((g) => Number(g.toFixed(2))),
      after: gaps.map((g) => Number(g.toFixed(2))),
      beforeSpread: Number((Math.max(...oldGaps) - Math.min(...oldGaps)).toFixed(2)),
      afterSpread: Number((Math.max(...gaps) - Math.min(...gaps)).toFixed(2)),
    });
  }

  // The control has to actually fire, or the board is the wrong board.
  expect(
    oldRuleOverlaps,
    `the fixed cell overlapped nothing on these ${plates.length} plates, so this board is not the case the report was about`,
  ).toBeGreaterThan(0);

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(
    resolve(EVIDENCE_DIR, "plate-spacing.json"),
    `${JSON.stringify(
      {
        plates: plates.length,
        letterSpacingPx: LETTER_SPACING_PX,
        oldRuleOverlaps,
        worstOldGapPx: Number(worstOldGap.toFixed(2)),
        worstOldPair,
        rows,
      },
      null,
      1,
    )}\n`,
  );
});
