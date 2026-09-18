import { describe, expect, it } from "vitest";
import {
  CHROME_PAD_Y,
  FOCUS_PAD,
  FRAME_BOTTOM,
  MARK_GAP,
  MARK_GAP_MIN,
  MIN_CLEAR,
  PRIMARY_H,
  SECONDARY_GAP,
  STACK_FLOOR,
  STATUS_GAP,
  clearGaps,
  titleStack,
} from "@game/scenes/support/titleStack";
import { LINE_HEIGHT, TYPE } from "@game/ui/theme";

/**
 * UR-68 - THE TITLE'S MENU COLUMN HAS AIR IN IT, IN BOTH PROFILE STATES.
 *
 * ================== WATCHED FAILING (coding-standards rule 4) ==================
 * Every number below was read off the running game, not reasoned about. The
 * screen was measured at 1920x1080 before the fix by walking the live scene
 * tree and reading each visible Text object's bounds, then reconstructing the
 * plates from the paddings the scene draws with:
 *
 *   returning pilot, Neptune   primary plate 560..664
 *                              status  plate 674..718
 *                              settings plate 718..769
 *     clear gaps, ring to plate:  -4  and  -14      <- both OVERLAPS
 *   new pilot, no beacon       primary plate 602..706
 *                              settings plate 761..812
 *     clear gap:                  26
 *
 * And the same measurement after, at every stop and every window this suite's
 * e2e half sweeps: 20 and 44 with a beacon, 44 without.
 *
 * THE RESTORE-AND-WATCH-RED PASS, run twice, values copied from the terminal.
 *
 * `STATUS_GAP` was set to -4, which is the offset that reproduces the shipped
 * `height + 18` placement exactly (plate 10 px under the button's, ring 4 px
 * through it). 5 of 11 failed:
 *
 *   × a returning pilot's column keeps MIN_CLEAR everywhere
 *       expected -4 to be greater than or equal to 20
 *   × the status line claims its own space instead of borrowing the settings gap
 *       expected 40 to be greater than or equal to 44
 *   × holds at every lockup position the seven stops' light produces
 *       markBottom 468, statusH 44: expected -4 to be greater than or equal to 20
 *   × holds in Devanagari, whose line box is 1.56 em against Latin's 1.3
 *       expected 36 to be 44
 *   × the floor of the assertion is the floor of the budget
 *       expected -4 to be greater than or equal to 20
 *
 * `SECONDARY_GAP` was then set to -14, which is the offset that reproduces the
 * shipped `settingsY = primaryY + 166` - the settings plate flush against the
 * status plate's bottom edge. 6 of 11 failed:
 *
 *   expected -14 to be greater than or equal to 20      (x3, both states)
 *   expected -14 to be greater than 30                  (the grouping claim)
 *   markBottom 468, statusH null: expected -14 ...      (the NEW-pilot sweep)
 *   expected 2 to be 44
 *
 * Both restored; 11 of 11 pass. The negative numbers are the point. An
 * assertion that cannot produce one is not measuring a gap, and the second run
 * is why the new-pilot case is a test of its own: `SECONDARY_GAP` is the only
 * constant that state can be broken by, and the first run never touched it.
 *
 * ================== WHY A PURE MODULE IS THE RIGHT PLACE ==================
 * The e2e half (`tests/e2e/title-lockup.spec.ts`) measures what is drawn, in
 * both profile states, at several windows and every stop. It cannot cover the
 * cases that matter MOST to this defect, because they are unreachable in a
 * shipped build: Devanagari line boxes (D95 ships `en` only) and a lockup
 * pushed far enough down by a stop's light to run the column out of frame. Both
 * are ordinary inputs here.
 */

/**
 * The plate heights the running screen actually measured at 1920x1080, en.
 *
 * `status` is `TYPE.label` ink of 28 px plus the 8 px padding at both ends;
 * `settings` is `TYPE.body` ink of 35 px plus the same. Taken from the live
 * Text objects rather than computed, so this file is anchored to the product.
 */
const MEASURED = { status: 44, settings: 51 } as const;

/** A lockup bottom read off the running screen. Neptune's, at 1920x1080. */
const MARK_BOTTOM_NEPTUNE = 468;
/** The furthest down any of the seven stops' light pushed it. Mars'. */
const MARK_BOTTOM_MARS = 537;

function gapsFor(input: {
  markBottom: number;
  statusH: number | null;
  settingsH?: number;
  langH?: number | null;
}): { gaps: number[]; overflow: number; bottom: number } {
  const settingsH = input.settingsH ?? MEASURED.settings;
  const tops = titleStack({
    markBottom: input.markBottom,
    primaryH: PRIMARY_H,
    statusH: input.statusH,
    settingsH,
    langH: input.langH ?? null,
  });
  const gaps = clearGaps({
    primaryTop: tops.primaryY,
    primaryBottom: tops.primaryY + PRIMARY_H,
    statusTop: tops.statusY,
    statusBottom:
      tops.statusY === null || input.statusH === null ? null : tops.statusY + input.statusH,
    settingsTop: tops.settingsY,
  });
  return { gaps, overflow: tops.overflow, bottom: tops.settingsY + settingsH + FOCUS_PAD };
}

describe("UR-68: the Title's menu column is a budget, not four constants", () => {
  it("a returning pilot's column keeps MIN_CLEAR everywhere", () => {
    // The state the defect was reported in. Pre-fix this read [-4, -14].
    const { gaps } = gapsFor({
      markBottom: MARK_BOTTOM_NEPTUNE,
      statusH: MEASURED.status,
    });
    expect(gaps).toHaveLength(2);
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(MIN_CLEAR);
    expect(gaps).toEqual([STATUS_GAP, SECONDARY_GAP]);
  });

  it("a NEW pilot's column keeps MIN_CLEAR, with no status line at all", () => {
    /**
     * THE STATE EVERY CAPTURE OF THIS SCREEN HAS BEEN IN, which is why the
     * defect shipped. A fresh profile has placed no beacon, so the line does
     * not exist and the column is two blocks. It measured 26 px pre-fix and
     * looked fine, and that is the whole trap: the screen is only crowded in
     * the state nobody photographs.
     */
    const { gaps } = gapsFor({ markBottom: MARK_BOTTOM_NEPTUNE, statusH: null });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toBeGreaterThanOrEqual(MIN_CLEAR);
  });

  it("the status line claims its own space instead of borrowing the settings gap", () => {
    /**
     * THE DEFECT, STATED AS A DIFFERENCE. The old column placed `settings` at a
     * fixed 166 px below the primary whether or not a status line was between
     * them, so adding the line did not move anything - it landed in the gap
     * that already existed. The block below the status line must now sit lower
     * BY AT LEAST the line's own height, or the line is still borrowing.
     */
    const withoutLine = titleStack({
      markBottom: MARK_BOTTOM_NEPTUNE,
      primaryH: PRIMARY_H,
      statusH: null,
      settingsH: MEASURED.settings,
      langH: null,
    });
    const withLine = titleStack({
      markBottom: MARK_BOTTOM_NEPTUNE,
      primaryH: PRIMARY_H,
      statusH: MEASURED.status,
      settingsH: MEASURED.settings,
      langH: null,
    });
    expect(withLine.settingsY - withoutLine.settingsY).toBeGreaterThanOrEqual(MEASURED.status);
    expect(withLine.primaryY).toBe(withoutLine.primaryY);
  });

  it("the primary block reads as one thing and the secondary as another", () => {
    // Not merely "both gaps clear the floor": the caption has to belong to the
    // button above it, which it only does if the break below it is bigger.
    const { gaps } = gapsFor({ markBottom: MARK_BOTTOM_NEPTUNE, statusH: MEASURED.status });
    expect(gaps[1]).toBeGreaterThan((gaps[0] ?? 0) * 1.5);
  });

  it("holds at every lockup position the seven stops' light produces", () => {
    /**
     * RULE 5: SWEEP, DO NOT SAMPLE. The Title wears the palette of the furthest
     * beacon and dodges that stop's sun, so the lockup's bottom is a different
     * number at every stop. These are the seven measured off the running game
     * at 1920x1080 (earth is also the no-beacon sky), plus the two ends of the
     * range the dodge can reach at all: `WORDMARK_Y` 250 + 218 with no sun in
     * the column, and the lowest a 0.41-of-frame light plus an 86 px bright
     * disc plus the 18 px gap can push it.
     *
     *   468  neptune, pluto, and every stop on a 32:9 world (the sun clears
     *        the type column entirely, so the lockup does not move at all)
     *   510  earth          528  saturn
     *   530  jupiter, uranus                536  mars, the furthest it goes
     */
    const measured = [468, 510, 528, 530, 536];
    const extremes = [250 + 218, Math.round(0.41 * 1080) + 86 + 18 + 218];
    for (const markBottom of [...measured, ...extremes]) {
      for (const statusH of [null, MEASURED.status]) {
        const { gaps } = gapsFor({ markBottom, statusH });
        for (const g of gaps) {
          expect(g, `markBottom ${markBottom}, statusH ${statusH}`).toBeGreaterThanOrEqual(
            MIN_CLEAR,
          );
        }
      }
    }
  });

  it("holds in Devanagari, whose line box is 1.56 em against Latin's 1.3", () => {
    /**
     * THE LANGUAGE HALF OF RULE 5, WHICH THE E2E CANNOT REACH. D95 ships `en`
     * only and `pickLang` refuses `?lang=hi`, so a browser sweep of this screen
     * in three languages measures one language three times. Here the taller
     * line box is just a bigger number, and it is the MEASURED multiplier from
     * `ui/theme.LINE_HEIGHT` rather than an invented one.
     *
     * The language row is included, because it is the block Devanagari hits
     * hardest - "हिं" is the one string on this screen that is Devanagari in
     * every locale - and because it is the block that reappears the day a
     * second language ships (D95).
     */
    const dev = (fontPx: number): number =>
      Math.round(fontPx * LINE_HEIGHT.devanagari) + CHROME_PAD_Y * 2;

    // The build that ships today: `en` only, so no language row (D95).
    const shipped = titleStack({
      markBottom: MARK_BOTTOM_MARS,
      primaryH: PRIMARY_H,
      statusH: dev(TYPE.label),
      settingsH: dev(TYPE.body),
      langH: null,
    });
    expect(shipped.overflow).toBe(0);
    expect(shipped.bottom).toBeLessThanOrEqual(STACK_FLOOR);

    /**
     * AND THE BUILD D95 CUT, WHICH IS THE ONE THAT DOES NOT FIT.
     *
     * With a second language shipped the row comes back, and in Devanagari at
     * Mars' lockup - the furthest down any stop's light pushes it - the column
     * reaches 1020. That is 16 px INTO the hint band and 60 px clear of the
     * frame. Reported here as the measurement it is rather than tuned away:
     * the gaps this ticket is about all hold, the concession that was meant to
     * happen first (the gap to the wordmark) has been spent in full, and the
     * thing left over is a real constraint on the day a second language ships.
     * Logged in gauntlet/escalations.md. NOT reachable in the shipped build:
     * `SHIPPED_LANGS` is `["en"]` and `TitleScene` draws no row for one option.
     */
    const withLangRow = titleStack({
      markBottom: MARK_BOTTOM_MARS,
      primaryH: PRIMARY_H,
      statusH: dev(TYPE.label),
      settingsH: dev(TYPE.body),
      langH: dev(TYPE.label),
    });
    expect(withLangRow.tightenedBy).toBe(MARK_GAP - MARK_GAP_MIN);
    expect(withLangRow.overflow).toBe(16);
    expect(withLangRow.bottom).toBeLessThan(FRAME_BOTTOM);

    // What the ticket asked for holds in both builds: the gaps never pay.
    for (const tops of [shipped, withLangRow]) {
      const gaps = clearGaps({
        primaryTop: tops.primaryY,
        primaryBottom: tops.primaryY + PRIMARY_H,
        statusTop: tops.statusY,
        statusBottom: (tops.statusY ?? 0) + dev(TYPE.label),
        settingsTop: tops.settingsY,
      });
      for (const g of gaps) expect(g).toBeGreaterThanOrEqual(MIN_CLEAR);
    }
  });

  it("nothing is drawn below the product's hint line", () => {
    for (const markBottom of [468, 511, 537, 565]) {
      const tops = titleStack({
        markBottom,
        primaryH: PRIMARY_H,
        statusH: MEASURED.status,
        settingsH: MEASURED.settings,
        langH: null,
      });
      expect(tops.settingsY + MEASURED.settings + FOCUS_PAD).toBeLessThanOrEqual(STACK_FLOOR);
      expect(tops.overflow).toBe(0);
    }
  });

  it("tightens the gap to the wordmark before it tightens anything else", () => {
    /**
     * THE CLAMP THAT `PRIMARY_Y_MAX` WAS MEANT TO BE. Pinning the primary at
     * 740 pinned the TOP of a stack whose height it did not know: at a lockup
     * bottom of 765 it put the button 25 px ABOVE the wordmark it hangs from,
     * and the blocks under it still ran off the frame. Driving the same guard
     * from the stack's BOTTOM cannot do that.
     */
    const low = titleStack({
      markBottom: 820,
      primaryH: PRIMARY_H,
      statusH: MEASURED.status,
      settingsH: MEASURED.settings,
      langH: null,
    });
    expect(low.tightenedBy).toBeGreaterThan(0);
    expect(low.primaryY).toBeGreaterThan(820 + MARK_GAP_MIN - 1);
    expect(low.primaryY).toBeLessThan(820 + MARK_GAP);
    // The gaps INSIDE the column are never what pays for the fit.
    const gaps = clearGaps({
      primaryTop: low.primaryY,
      primaryBottom: low.primaryY + PRIMARY_H,
      statusTop: low.statusY,
      statusBottom: (low.statusY ?? 0) + MEASURED.status,
      settingsTop: low.settingsY,
    });
    expect(gaps).toEqual([STATUS_GAP, SECONDARY_GAP]);
  });

  it("says so in pixels when it still does not fit", () => {
    /**
     * Rule 8 in layout form: the last concession is to TELL somebody, never to
     * quietly overlap. `TitleScene` publishes this on its debug bag and
     * `title-lockup.spec.ts` asserts it is 0 in the shipped build, so a future
     * change that makes the column too tall shows up as a number rather than as
     * a screenshot nobody takes.
     */
    const impossible = titleStack({
      markBottom: 900,
      primaryH: PRIMARY_H,
      statusH: 300,
      settingsH: 200,
      langH: null,
    });
    expect(impossible.overflow).toBeGreaterThan(0);
    expect(impossible.tightenedBy).toBe(MARK_GAP - MARK_GAP_MIN);
  });

  it("the floor of the assertion is the floor of the budget", () => {
    // If STATUS_GAP is ever edited below MIN_CLEAR the column would ship
    // crowded with every gap test still green, because each one would be
    // checking the new constant against itself.
    expect(Math.min(STATUS_GAP, SECONDARY_GAP)).toBeGreaterThanOrEqual(MIN_CLEAR);
    expect(MARK_GAP_MIN).toBeLessThan(MARK_GAP);
  });

  it("clearGaps counts the focus ring, which is what the player sees", () => {
    /**
     * THE MEASUREMENT BUG THIS DEFECT HID BEHIND. Plate to plate, the shipped
     * column read 10 px and 0 px - tight, but not obviously broken. The screen
     * draws a 14 px focus ring outside every control, so what was on screen was
     * -4 and -14. A gap that is only a gap when you ignore something the screen
     * draws every frame is not a gap.
     */
    const plateOnly = { primaryTop: 0, primaryBottom: 100, statusTop: 110, settingsTop: 200 };
    const gaps = clearGaps({ ...plateOnly, statusBottom: 150 });
    expect(gaps[0]).toBe(110 - (100 + FOCUS_PAD));
    expect(gaps[1]).toBe(200 - FOCUS_PAD - 150);
  });
});
