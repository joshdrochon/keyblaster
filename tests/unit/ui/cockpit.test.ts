import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  TEXT_MIN_CONTRAST,
  compositeOver,
  contrastRatio,
} from "@engine/contrast/index.js";
import { PALETTE_STOP_IDS, paletteAt } from "@game/render/palette";
import {
  SETTINGS_CONSOLE,
  bottomOf,
  fitPlan,
  flowColumn,
} from "@game/ui/layout";
import { BEACON_LOG } from "@game/ui/layout";
import { INK, SPACE, TYPE, lineHeightEm, rowHeight } from "@game/ui/theme";
import {
  KNOB,
  LABEL_SURFACE,
  PANEL,
  READOUT_SURFACE,
  SWITCH,
  HARDWARE,
  HARDWARE_SPAN,
  KNOB_SPAN,
  TEXT_SURFACES,
  detentStops,
  knobAngleDeg,
  knobTickAngles,
  labelInk,
  labelSpan,
  lampAlpha,
  leverTip,
  polar,
  readoutInk,
  rivetPositions,
  stepValue,
} from "@game/ui/panel";

/**
 * THE COCKPIT CONSOLE (UR-11).
 *
 * UR-11 asked for the settings screen to read as a ship's interior.
 * What shipped was a flat pill slider with a white dot and a 0% caption. What
 * replaces it is a rotary knob, an illuminated toggle and a detented selector.
 *
 * A knob is a worse control than a slider IF you cannot tell where it is
 * pointing, cannot turn it with the keyboard, or cannot read its label on the
 * charcoal it is screwed to. Those three are the whole risk of this change, so
 * they are the three things asserted here - not the prettiness, which the
 * capture in gauntlet/evidence/screens/settings.png is for.
 */

const SRC = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../../src/game/ui/${name}`, import.meta.url)),
    "utf8",
  );

/** The same file with comments stripped, so prose cannot satisfy a check. */
const CODE = (name: string): string =>
  SRC(name).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

// ---------------------------------------------------------------------------
// The knob points somewhere, and it never lies about where
// ---------------------------------------------------------------------------

describe("the rotary knob", () => {
  it("sweeps 270 degrees, minimum down-left and maximum down-right", () => {
    expect(knobAngleDeg(0)).toBe(-135);
    expect(knobAngleDeg(1)).toBe(135);
    expect(knobAngleDeg(0.5)).toBe(0);
    expect(KNOB.maxDeg - KNOB.minDeg).toBe(KNOB.sweepDeg);
  });

  it("NEVER WRAPS: the pointer rises with the value and stops at the stops", () => {
    // The defect a rotary control invites and a slider cannot have. If the
    // angle is ever taken modulo anything, turning the music all the way up
    // puts the pointer back at silence.
    let previous = -Infinity;
    for (let i = 0; i <= 100; i += 1) {
      const deg = knobAngleDeg(i / 100);
      expect(deg).toBeGreaterThan(previous);
      expect(deg).toBeGreaterThanOrEqual(KNOB.minDeg);
      expect(deg).toBeLessThanOrEqual(KNOB.maxDeg);
      previous = deg;
    }
    // Out of range in both directions clamps rather than spinning round.
    expect(knobAngleDeg(-4)).toBe(KNOB.minDeg);
    expect(knobAngleDeg(4)).toBe(KNOB.maxDeg);
  });

  it("puts every 10% step at a visibly different angle", () => {
    // 27 degrees per step. A pointer a child cannot see move is a pointer that
    // has not told them anything.
    const angles = [...Array(11)].map((_, i) => knobAngleDeg(i / 10));
    for (let i = 1; i < angles.length; i += 1) {
      expect((angles[i] ?? 0) - (angles[i - 1] ?? 0)).toBeGreaterThanOrEqual(20);
    }
  });

  it("draws one detent per keyboard step, ends included", () => {
    const ticks = knobTickAngles();
    expect(ticks).toHaveLength(KNOB.detents);
    expect(ticks[0]).toBe(KNOB.minDeg);
    expect(ticks[ticks.length - 1]).toBe(KNOB.maxDeg);
    // The detents ARE the arrow-key steps: ten presses from silent to full.
    expect(KNOB.detents - 1).toBe(Math.round(1 / KNOB.step));
    for (const value of [0, 0.3, 0.7, 1]) {
      expect(ticks.some((t) => Math.abs(t - knobAngleDeg(value)) < 1e-9)).toBe(true);
    }
  });

  it("an arrow press moves one detent and stops dead at both ends", () => {
    expect(stepValue(0.7, -1)).toBeCloseTo(0.6, 10);
    expect(stepValue(0.7, 1)).toBeCloseTo(0.8, 10);
    // No wrap on the value either, which is the same promise one layer down.
    expect(stepValue(1, 1)).toBe(1);
    expect(stepValue(0, -1)).toBe(0);
    // Ten presses cross the whole range and land exactly on the end.
    let v = 0;
    for (let i = 0; i < 10; i += 1) v = stepValue(v, 1);
    expect(v).toBe(1);
    // Rounded to whole percent, so the readout and the pointer cannot disagree.
    expect(stepValue(0.7, -1) * 100).toBe(60);
  });

  it("places the pointer where the angle says, clockwise from twelve", () => {
    const up = polar(100, 100, 50, 0);
    expect(up.x).toBeCloseTo(100, 6);
    expect(up.y).toBeCloseTo(50, 6);
    const right = polar(100, 100, 50, 90);
    expect(right.x).toBeCloseTo(150, 6);
    expect(right.y).toBeCloseTo(100, 6);
    // Minimum is down-and-left, maximum down-and-right: both below the pivot.
    const min = polar(100, 100, 50, knobAngleDeg(0));
    const max = polar(100, 100, 50, knobAngleDeg(1));
    expect(min.x).toBeLessThan(100);
    expect(max.x).toBeGreaterThan(100);
    expect(min.y).toBeGreaterThan(100);
    expect(max.y).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// The switch actually throws
// ---------------------------------------------------------------------------

describe("the illuminated toggle", () => {
  it("throws far enough to see, and up is on", () => {
    const on = leverTip(100, 100, true);
    const off = leverTip(100, 100, false);
    expect(on.y).toBeLessThan(100);
    expect(off.y).toBeGreaterThan(100);
    // A lever that moves four pixels is a picture of a switch, not a switch.
    expect(Math.abs(on.y - off.y)).toBeGreaterThanOrEqual(40);
  });

  it("leans off vertical so it reads as an object rather than a line", () => {
    const on = leverTip(100, 100, true);
    expect(on.x).toBeGreaterThan(100);
    expect(SWITCH.leanDeg).toBeGreaterThan(0);
  });

  it("lights the lamp behind it, and darkens it right down when off", () => {
    expect(lampAlpha(true)).toBeGreaterThanOrEqual(0.9);
    expect(lampAlpha(false)).toBeLessThanOrEqual(0.12);
    expect(lampAlpha(true) - lampAlpha(false)).toBeGreaterThan(0.75);
  });
});

// ---------------------------------------------------------------------------
// The selector has positions you can count
// ---------------------------------------------------------------------------

describe("the detented selector", () => {
  it("spaces its detents evenly inside the track", () => {
    const stops = detentStops(0, 200, 4, 12);
    expect(stops).toHaveLength(4);
    expect(stops[0]).toBeCloseTo(12, 9);
    expect(stops[1]).toBeCloseTo(70.6667, 3);
    expect(stops[2]).toBeCloseTo(129.3333, 3);
    expect(stops[3]).toBeCloseTo(188, 9);
    for (const s of stops) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(200);
    }
    const gaps = stops.slice(1).map((s, i) => s - (stops[i] ?? 0));
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0] ?? 0, 9);
  });

  it("centres a single position rather than jamming it against the left", () => {
    // D95 ships one language, so the two language rows really do have one
    // detent. A lone notch pinned to the left edge reads as a broken control.
    expect(detentStops(0, 200, 1, 12)).toEqual([100]);
    expect(detentStops(0, 200, 0, 12)).toEqual([]);
  });

  it("keeps the detents inside the track at every count the screen uses", () => {
    for (const count of [1, 2, 3, 4]) {
      for (const s of detentStops(40, 160, count, 10)) {
        expect(s).toBeGreaterThanOrEqual(40);
        expect(s).toBeLessThanOrEqual(200);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The panel is screwed on
// ---------------------------------------------------------------------------

describe("the panel frame", () => {
  it("puts a screw in every corner, inside the bezel", () => {
    const rect = { x: 10, y: 20, w: 400, h: 120 };
    const rivets = rivetPositions(rect, 18);
    expect(rivets).toHaveLength(4);
    for (const r of rivets) {
      expect(r.x).toBeGreaterThanOrEqual(rect.x + 18);
      expect(r.x).toBeLessThanOrEqual(rect.x + rect.w - 18);
      expect(r.y).toBeGreaterThanOrEqual(rect.y + 18);
      expect(r.y).toBeLessThanOrEqual(rect.y + rect.h - 18);
    }
  });

  it("adds a mid-edge screw once the panel is tall enough to need one", () => {
    const tall = rivetPositions({ x: 0, y: 0, w: 400, h: 800 }, 18);
    expect(tall).toHaveLength(6);
    expect(tall.some((r) => r.y === 400)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-22.8: a charcoal panel is where contrast dies quietly
// ---------------------------------------------------------------------------

/**
 * EVERY (ink, surface) PAIR THE CONSOLE CAN DRAW, as a cross product rather
 * than as a list somebody remembered to extend.
 *
 * THE ACCENTS COME OUT OF THE PALETTE, not out of a literal here. A value is
 * printed in `uiStyle.accent`, which is the stop's plate accent - #FFC857 on
 * Earth and #FFD98A under the colourblind variant (D41 separates the two by
 * luminance; `palette.ts` documents why the UI reads `plateAccent` and the
 * world reads `colorblind.accent`). Hard-coding "amber or white" here would
 * measure a colour the screen never draws and miss the one it does.
 */
const ACCENTS: string[] = [
  ...new Set(
    PALETTE_STOP_IDS.flatMap((stop) => [
      paletteAt(stop, false).accent,
      paletteAt(stop, true).accent,
    ]),
  ),
];

describe("V-22.8 every label and value on the console clears 4.5:1", () => {
  it("has more than one accent to measure, on every stop, both modes", () => {
    // A cross product over an empty or single-valued set is the same failure
    // as measuring nothing. Settings is dressed from Earth today; it reads the
    // stop palette, so all seven are measured.
    expect(PALETTE_STOP_IDS.length).toBeGreaterThanOrEqual(7);
    expect(ACCENTS.length).toBeGreaterThan(1);
    expect(TEXT_SURFACES.length).toBeGreaterThanOrEqual(5);
  });

  it.each(TEXT_SURFACES)(
    "both label inks clear the bar on surface %s",
    (surface) => {
      for (const focused of [true, false]) {
        expect(
          contrastRatio(labelInk(focused), surface),
          `${labelInk(focused)} on ${surface}`,
        ).toBeGreaterThanOrEqual(TEXT_MIN_CONTRAST);
      }
      // And with the cabin bloom `chrome.ts` washes over the top of the panel.
      const lit = compositeOver(INK.accent, 0.08, surface);
      for (const focused of [true, false]) {
        expect(
          contrastRatio(labelInk(focused), lit),
          `${labelInk(focused)} on lit ${surface}`,
        ).toBeGreaterThanOrEqual(TEXT_MIN_CONTRAST);
      }
    },
  );

  it("every accent the game can hand this panel is legible behind glass", () => {
    for (const accent of ACCENTS) {
      expect(
        contrastRatio(readoutInk(accent), READOUT_SURFACE),
        `${accent} on glass`,
      ).toBeGreaterThanOrEqual(TEXT_MIN_CONTRAST);
    }
  });

  it("no value is ever printed on a lit lamp, which is why none is", () => {
    for (const accent of ACCENTS) {
      // The trap this rules out: amber on amber. A burning lamp is a SURFACE,
      // and the switch prints its word in a separate unlit window beside it
      // precisely because this pair does not clear the bar.
      const burning = compositeOver(accent, lampAlpha(true), READOUT_SURFACE);
      expect(contrastRatio(readoutInk(accent), burning)).toBeLessThan(
        TEXT_MIN_CONTRAST,
      );
    }
    expect(READOUT_SURFACE).not.toBe(PANEL.face);
    expect(contrastRatio(labelInk(true), LABEL_SURFACE)).toBeGreaterThanOrEqual(
      TEXT_MIN_CONTRAST,
    );
  });

  it("NEGATIVE CONTROL: the faint ink fails on this panel, as it must", () => {
    // Without this, "everything passes" would be indistinguishable from
    // "nothing is measured". `INK.textFaint` is 3.64:1 on the console face and
    // is the ink a dim engraved legend would reach for first.
    expect(contrastRatio(INK.textFaint, PANEL.face)).toBeLessThan(
      TEXT_MIN_CONTRAST,
    );
    // And the hardware is not a text surface: nothing may be printed on the
    // lit facet of a knob, where even white only reaches 4.41:1.
    expect(contrastRatio(INK.text, PANEL.knobLit)).toBeLessThan(
      TEXT_MIN_CONTRAST,
    );
    expect(TEXT_SURFACES).not.toContain(PANEL.knobLit);
  });

  it("the recesses are darker than the face they are cut into", () => {
    // A panel darker than its own cutouts is a hole, not a surface - and it is
    // what made the glass readouts vanish on the first pass.
    const lum = (hex: string): number => contrastRatio(hex, "#000000");
    expect(lum(PANEL.faceShade)).toBeLessThan(lum(PANEL.face));
    expect(lum(PANEL.bay)).toBeLessThan(lum(PANEL.faceShade));
    expect(lum(PANEL.glass)).toBeLessThan(lum(PANEL.bay));
    expect(lum(PANEL.faceLit)).toBeGreaterThan(lum(PANEL.face));
    expect(lum(PANEL.knobLit)).toBeGreaterThan(lum(PANEL.knob));
    expect(lum(PANEL.knobShade)).toBeLessThan(lum(PANEL.knob));
    // The knob's rim is lighter than anything it sits on, which is what makes
    // a top light read, and its white pointer is lighter still.
    expect(lum(PANEL.pointer)).toBeGreaterThan(lum(PANEL.knobLit));
  });
});

// ---------------------------------------------------------------------------
// A label may never reach the hardware
// ---------------------------------------------------------------------------

describe("the label column", () => {
  it("stops short of the hardware by a whole gap", () => {
    // "how you type hindi" printed straight through the chevron beside it the
    // moment `wider letters` was on, because the label column was a fixed
    // fraction of the module width rather than the space actually left.
    expect(labelSpan(530, 28, 20)).toBe(482);
    expect(labelSpan(530, 28, 20) + 28 + 20).toBeLessThanOrEqual(530);
  });

  it("never collapses the label to nothing, however wide the hardware", () => {
    // A 300 px readout on a narrow module would otherwise ask for a negative
    // wrap width, and Phaser answers that with one character per line.
    expect(labelSpan(60, 28, 20)).toBe(120);
    expect(labelSpan(-400, 28, 20)).toBe(120);
    expect(labelSpan(60, 28, 20, 90)).toBe(90);
  });
});

describe("how the console is allowed to be drawn", () => {
  it("is vector, in code: no raster is referenced (D83/D84)", () => {
    // Comments are stripped first: the reference plate is NAMED in the header
    // on purpose (D84 - it is looked at), and prose about a .png must not be
    // mistaken for loading one. What is checked is the code.
    const cockpit = CODE("cockpit.ts");
    expect(cockpit).not.toMatch(/\.(png|jpg|jpeg|webp|gif|svg)\b/i);
    expect(cockpit).not.toMatch(/scene\.add\.(image|sprite)\(/);
    expect(cockpit).not.toMatch(/design-reference/);
    expect(cockpit).not.toMatch(/\bload\./);
  });

  it("takes every colour from a token, so no ink can dodge the contrast test", () => {
    // The cross product above is only a proof if the drawing code cannot reach
    // for a colour that is not in it.
    expect(CODE("cockpit.ts")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("keeps a numeric readout on the knobs", () => {
    // The bar from the ticket: a beautiful knob whose value a child cannot read
    // is worse than the slider it replaced. `format` is the "70%" the old
    // slider printed and the e2e still asserts it in the mirror.
    const cockpit = SRC("cockpit.ts");
    expect(cockpit).toContain("format");
    expect(cockpit).toMatch(/role: "slider"/);
  });

  it("keeps the on/off WORD beside the lamp, so colour is never the carrier", () => {
    const cockpit = SRC("cockpit.ts");
    expect(cockpit).toContain("onLabel");
    expect(cockpit).toContain("offLabel");
  });

  it("every cockpit control answers the arrow keys (AC-18.1)", () => {
    const cockpit = CODE("cockpit.ts");
    // `adjustable` is what routes Left/Right to a control instead of to
    // navigation (focus.ts). It is set once, in the base every panel control
    // extends, so a fourth control cannot be added without it.
    expect(cockpit).toMatch(/class PanelControl extends Control \{[\s\S]*?this\.adjustable = true/);
    // FOUR controls, four real `adjust` implementations. The fourth is the
    // hull bay (UR-48), and this guard is what caught it arriving: it failed
    // `expected [ 'extends PanelControl', ...(3) ] to have a length of 3 but
    // got 4` the moment `HullRow` landed, which is the check asking the new
    // control the same question it asks the other three.
    expect(cockpit.match(/extends PanelControl\b/g)).toHaveLength(4);
    expect(cockpit.match(/override adjust\(/g)).toHaveLength(4);
    // And the hull row's arrows BROWSE - Enter is what equips - so it is the
    // one control here whose `activate` is not `adjust` in disguise.
    expect(cockpit).toMatch(/class HullRow extends PanelControl \{/);
  });

  it("the flat pill slider is GONE, not left beside the knob", () => {
    // Two kits is how a later screen quietly gets its pill slider back.
    const controls = SRC("controls.ts");
    expect(controls).not.toContain("class SliderRow");
    expect(controls).not.toContain("class ToggleRow");
    expect(controls).not.toContain("class OptionRow");
  });
});

// ---------------------------------------------------------------------------
// The console has to fit the frame, in the tallest script there is
// ---------------------------------------------------------------------------

/**
 * SETTINGS' OWN COLUMN, FLOWED FROM THE REAL NUMBERS.
 *
 * Every control on this panel is taller than the flat row it replaced - a knob
 * row is 130 px against the pill slider's 59 - and the left column has six of
 * them. The old screen stacked on a fixed 14 px gap inside two hard-coded
 * plates; the Beacon Log shipped that same defect and printed its bottom row
 * off the frame (layout.test.ts). This is the same check for screen 11, and it
 * is done here rather than in a capture because a capture only ever shows one
 * language.
 *
 * Line heights are modelled the way layout.test.ts models a trophy tile:
 * Phaser's text metrics are about 1.05 em of ink and `uiText` adds
 * `lineHeightEm(lang) - 1` of leading (theme.ts LINE_HEIGHT).
 */
const textLine = (fontPx: number, lang: "en" | "hi"): number =>
  Math.round(fontPx * 1.05) + Math.round(fontPx * (lineHeightEm(lang) - 1));

/** A control's measured height: the taller of its hardware and its label. */
const row = (span: number, labelLines: number, lang: "en" | "hi"): number =>
  Math.max(
    rowHeight(TYPE.label, lang),
    span,
    labelLines * textLine(TYPE.label, lang) + SPACE.rowPadY * 2,
  );

/** The reset key, which is `PanelButton`: a body-size row plus its bevel. */
const key = (lang: "en" | "hi"): number => rowHeight(TYPE.body, lang) + 6;

/**
 * The hull row's hardware span (UR-48), from the same two numbers `cockpit.ts`
 * builds it from: a `drawShip` at size 72 is ~1.14x its size in ink, and the
 * row pads it like every other module. Re-derived here rather than exported, so
 * a change to the glyph size in `cockpit.ts` that this column cannot afford
 * shows up as a failing frame rather than as a silently larger constant.
 */
const HULL_SPAN = Math.round(72 * 1.14) + SPACE.rowPadY * 2;

/** A selector carrying AC-14.1's one calm note line under it. */
const withNote = (h: number, lang: "en" | "hi", lines: number): number =>
  h + lines * textLine(TYPE.caption, lang) + 10;

function fits(
  column: readonly number[],
  tail: readonly number[],
  tailGap: number,
): { fits: boolean; bottom: number } {
  const plan = fitPlan([...column, ...tail], {
    ...SETTINGS_CONSOLE,
    bottom: SETTINGS_CONSOLE.bottom - tailGap,
  });
  const rects = flowColumn(column, {
    left: 0,
    top: SETTINGS_CONSOLE.top,
    width: 0,
    rowGap: plan.rowGap,
  });
  const tailRects = flowColumn(tail, {
    left: 0,
    top: bottomOf(rects) + tailGap,
    width: 0,
    rowGap: plan.rowGap,
  });
  const bottom = tail.length === 0 ? bottomOf(rects) : bottomOf(tailRects);
  // The BEZEL is what may not cross the hint, not the last control: the console
  // face is drawn `bezel` px past the stack on every side.
  return {
    fits: bottom + SETTINGS_CONSOLE.bezel <= BEACON_LOG.hintTop,
    bottom,
  };
}

describe("the settings console fits the frame", () => {
  for (const lang of ["en", "hi"] as const) {
    it(`the sound-and-language column clears the keyboard hint (${lang})`, () => {
      // music, sound, keyboard, how-you-type, menu language, typing language -
      // with every label wrapped to two lines, which is the worst the copy can
      // do, and AC-14.1's note under the content-language row.
      const column = [
        row(HARDWARE_SPAN.knob, 2, lang),
        row(HARDWARE_SPAN.knob, 2, lang),
        row(HARDWARE_SPAN.selector, 2, lang),
        row(HARDWARE_SPAN.selector, 2, lang),
        row(HARDWARE_SPAN.selector, 2, lang),
        withNote(row(HARDWARE_SPAN.selector, 2, lang), lang, 2),
      ];
      const plan = fits(column, [], 0);
      expect(plan.fits, `bottom ${plan.bottom}`).toBe(true);
    });

    it(`the flight-deck column and the reset key clear it too (${lang})`, () => {
      // The hull row (UR-48) is the first module on this column and the tallest
      // thing on the panel: a 72 px ship in its bay plus the line that says what
      // unlocks it. Modelled at its WORST - a two-line label and a two-line
      // unlock sentence - because "unlocks after 7 beacons" is two lines in
      // Devanagari, which is where this column runs out of room first.
      const column = [
        withNote(row(HULL_SPAN, 2, lang), lang, 2),
        row(HARDWARE_SPAN.selector, 2, lang),
        row(HARDWARE_SPAN.switch, 2, lang),
        row(HARDWARE_SPAN.switch, 2, lang),
        row(HARDWARE_SPAN.switch, 2, lang),
      ];
      const plan = fits(column, [key(lang)], SETTINGS_CONSOLE.keyGap);
      expect(plan.fits, `bottom ${plan.bottom}`).toBe(true);
    });

    it(`the hull row is what this column can least afford to grow (${lang})`, () => {
      // Rule 8: the bar does not move to make a number pass, so the headroom is
      // MEASURED rather than assumed. As it stands, HULL_SPAN is 110 and the
      // column ends at 949 (en) and 965 (hi) against a hint at 1004 with a
      // 26 px bezel - 29 px of margin in the tighter script, at a row gap
      // already tightened from 18 to 10.
      //
      // 64 px taller - a size-128 ship in the bay - is 174, and Devanagari
      // then ends at 1013 and does NOT fit, at the row gap's floor of 6. That
      // is the negative control: this column has room for the hull bay and
      // not much more, and the check can be made to fail.
      const withHull = [
        withNote(row(HULL_SPAN, 2, lang), lang, 2),
        row(HARDWARE_SPAN.selector, 2, lang),
        row(HARDWARE_SPAN.switch, 2, lang),
        row(HARDWARE_SPAN.switch, 2, lang),
        row(HARDWARE_SPAN.switch, 2, lang),
      ];
      const oversized = [
        withNote(row(HULL_SPAN + 64, 2, lang), lang, 2),
        ...withHull.slice(1),
      ];
      expect(fits(withHull, [key(lang)], SETTINGS_CONSOLE.keyGap).fits).toBe(true);
      expect(
        fits(oversized, [key(lang)], SETTINGS_CONSOLE.keyGap).fits,
        "the frame would swallow a 64 px taller hull bay without saying so",
      ).toBe(lang === "en");
    });
  }

  it("NEGATIVE CONTROL: a column the frame cannot hold is reported as such", () => {
    // Without this the check could pass by being impossible to fail.
    const absurd = new Array(9).fill(row(HARDWARE_SPAN.knob, 3, "hi"));
    expect(fits(absurd, [], 0).fits).toBe(false);
  });

  it("gives the white space up before anything else, and never the type", () => {
    // `fitPlan` tightens the gap first and has no glyph to shrink on this
    // screen, so the ONLY thing it can spend is the space between modules -
    // which is exactly the guarantee a 7-year-old's type size needs.
    const tight = new Array(6).fill(row(HARDWARE_SPAN.knob, 2, "hi"));
    const plan = fitPlan(tight, { ...SETTINGS_CONSOLE });
    expect(plan.rowGap).toBeLessThanOrEqual(SETTINGS_CONSOLE.rowGap);
    expect(plan.rowGap).toBeGreaterThanOrEqual(SETTINGS_CONSOLE.minRowGap);
    expect(SETTINGS_CONSOLE.glyph).toBe(0);
    expect(SETTINGS_CONSOLE.minGlyph).toBe(0);
  });

  it("the hardware column is the same width on every control", () => {
    // The eye reads one instrument stack down the right of each panel only if
    // the three hardware types occupy a comparable column.
    expect(KNOB_SPAN).toBe((HARDWARE.knobR + HARDWARE.arcOuter) * 2);
    expect(HARDWARE_SPAN.knob).toBeGreaterThan(HARDWARE_SPAN.switch);
    expect(HARDWARE_SPAN.switch).toBeGreaterThan(HARDWARE_SPAN.selector);
  });
});
