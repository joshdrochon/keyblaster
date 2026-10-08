import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTION_BUTTON, ACTION_PAIR, COLUMN_GAP } from "@game/ui/grid";
import { BUTTON_GAP_X, BUTTON_H, BUTTON_W } from "@game/scenes/support/resultsLayout";

/**
 * ONE SIZE FOR A FORWARD ACTION, ALONE OR IN A PAIR.
 *
 * The stage report is the only screen with two forward actions and nothing
 * declared what a pair should be, so it wrote its own: `BUTTON_W = 420` took
 * the shared width and `BUTTON_H = 64` on the next line did not, leaving its
 * buttons 24 px shorter than every other forward action in the game. Measured
 * off the running build at 1280x720: Beacon 420x88, Briefing 420x88, Ending
 * 560x88, stage report 420x64.
 *
 *   npx vitest run tests/unit/ui/actionPair.test.ts --coverage.enabled=false
 */

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), "utf8");

describe("ACTION_PAIR: two forward actions are the size of one", () => {
  it("matches the single action exactly", () => {
    expect(ACTION_PAIR.w).toBe(ACTION_BUTTON.w);
    expect(ACTION_PAIR.h).toBe(ACTION_BUTTON.h);
  });

  it("is spaced by the declared column gap, not a number of its own", () => {
    expect(ACTION_PAIR.gapX).toBe(COLUMN_GAP);
  });

  it("the stage report READS it rather than repeating it", () => {
    expect(BUTTON_W).toBe(ACTION_PAIR.w);
    expect(BUTTON_H).toBe(ACTION_PAIR.h);
    expect(BUTTON_GAP_X).toBe(ACTION_PAIR.gapX);
    // Derived in the source too, so a future edit to the pair carries.
    const src = read("src/game/scenes/support/resultsLayout.ts");
    expect(src).toContain("export const BUTTON_W = ACTION_PAIR.w;");
    expect(src).toContain("export const BUTTON_H = ACTION_PAIR.h;");
    expect(src).toContain("export const BUTTON_GAP_X = ACTION_PAIR.gapX;");
  });

  it("no screen writes the old 64 beside a shared 420", () => {
    // The exact shape of the defect, so it cannot come back by copy-paste.
    for (const rel of [
      "src/game/scenes/support/resultsLayout.ts",
      "src/game/scenes/support/endingLayout.ts",
      "src/game/scenes/support/briefingLayout.ts",
    ]) {
      expect(read(rel), rel).not.toMatch(/BUTTON_H\s*=\s*64/);
    }
  });
});

describe("a pair of buttons is spaced the same wherever it is drawn", () => {
  it("the stall card uses the shared gap, not its own 20", () => {
    const src = read("src/game/scenes/StallScene.ts");
    expect(src).toContain("const buttonGap = COLUMN_GAP;");
    expect(src).not.toMatch(/const buttonGap = \d/);
  });

  it("the stall card keeps its own HEIGHT, which is measured and deliberate", () => {
    // 88 would leave 16 px of card under the pair inside a 396-tall card. It is
    // a card control, not a forward action on the foot line.
    const src = read("src/game/scenes/StallScene.ts");
    expect(src).toContain("const buttonH = 64;");
    expect(src).toContain("const cardH = 396;");
  });
});

describe("the ending's wider button is a decision, not drift", () => {
  it("keeps the shared height and foot line, and only the width is its own", () => {
    const src = read("src/game/scenes/support/endingLayout.ts");
    expect(src).toContain("const BUTTON = { w: 560, h: ACTION_BUTTON.h } as const;");
    expect(src).toContain("y: ACTION_BUTTON.y,");
  });
});
