import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  TEXT_MIN_CONTRAST,
  compositeOver,
  contrastRatio,
} from "@engine/contrast/index.js";
import { INK } from "@game/ui/theme";
import {
  KNOB,
  LABEL_SURFACE,
  PANEL,
  READOUT_SURFACE,
  SWITCH,
  detentStops,
  knobAngleDeg,
  knobTickAngles,
  labelInk,
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
 * "In the settings, the menu should look like the inside of a space ship."
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
 * The accent is the only value that changes at runtime - #FFC857 normally and
 * #FFFFFF under the colourblind palette (AC-19.1's e2e asserts both) - so both
 * are measured, on the darkest and the lightest the panel gets.
 */
const ACCENTS = ["#FFC857", "#FFFFFF"] as const;

/** The face at its lightest: lit by the cabin bloom `chrome.ts` paints. */
const LIT_FACE = compositeOver(INK.accent, 0.08, LABEL_SURFACE);

describe("V-22.8 every label and value on the console clears 4.5:1", () => {
  it.each([
    ["focused label on the lit face", labelInk(true), LIT_FACE],
    ["unfocused label on the lit face", labelInk(false), LIT_FACE],
    ["focused label on the face", labelInk(true), PANEL.face],
    ["unfocused label on the face", labelInk(false), PANEL.face],
    ["focused label in a bay", labelInk(true), PANEL.bay],
    ["unfocused label in a bay", labelInk(false), PANEL.bay],
  ])("%s", (_name, ink, surface) => {
    expect(contrastRatio(ink, surface)).toBeGreaterThanOrEqual(TEXT_MIN_CONTRAST);
  });

  it.each(ACCENTS)("a value printed behind glass in %s clears the bar", (accent) => {
    expect(
      contrastRatio(readoutInk(accent), READOUT_SURFACE),
    ).toBeGreaterThanOrEqual(TEXT_MIN_CONTRAST);
  });

  it.each(ACCENTS)("a lit lamp in %s does not wash the glass out", (accent) => {
    // The lamp burns THROUGH the glass under the value, so the worst case for
    // a readout is not bare glass - it is glass with the lamp on behind it.
    const burning = compositeOver(accent, lampAlpha(true), READOUT_SURFACE);
    // Amber-on-amber is the trap: a lit lamp must never be the surface a value
    // is printed on. The console draws the state word on the FACE beside the
    // lamp for exactly this reason, so that is the pair measured.
    expect(contrastRatio(readoutInk(accent), burning)).toBeLessThan(
      TEXT_MIN_CONTRAST,
    );
    expect(contrastRatio(labelInk(true), PANEL.face)).toBeGreaterThanOrEqual(
      TEXT_MIN_CONTRAST,
    );
  });

  it("NEGATIVE CONTROL: the faint ink fails on this panel, as it must", () => {
    // Without this, "everything passes" would be indistinguishable from
    // "nothing is measured". `INK.textFaint` is 3.90:1 on the console face and
    // is the ink a dim engraved legend would reach for first.
    expect(contrastRatio(INK.textFaint, PANEL.face)).toBeLessThan(
      TEXT_MIN_CONTRAST,
    );
    // And the hardware is not a text surface: white on a lit knob facet is
    // 5.41:1, but amber on it is 3.68:1, so no value may be printed there.
    expect(contrastRatio("#FFC857", PANEL.knobLit)).toBeLessThan(
      TEXT_MIN_CONTRAST,
    );
  });

  it("the recesses are darker than the face they are cut into", () => {
    // A panel darker than its own cutouts is a hole, not a surface - and it is
    // what makes the labels the brightest thing left on screen.
    const lum = (hex: string): number => contrastRatio(hex, "#000000");
    expect(lum(PANEL.bay)).toBeLessThan(lum(PANEL.face));
    expect(lum(PANEL.glass)).toBeLessThan(lum(PANEL.bay));
    expect(lum(PANEL.faceLit)).toBeGreaterThan(lum(PANEL.face));
    expect(lum(PANEL.faceShade)).toBeLessThan(lum(PANEL.face));
    expect(lum(PANEL.knobLit)).toBeGreaterThan(lum(PANEL.knob));
    expect(lum(PANEL.knobShade)).toBeLessThan(lum(PANEL.knob));
  });
});

// ---------------------------------------------------------------------------
// D83 / D84, and the rules that keep the fiction from eating the usability
// ---------------------------------------------------------------------------

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
    // Three controls, three real `adjust` implementations.
    expect(cockpit.match(/extends PanelControl\b/g)).toHaveLength(3);
    expect(cockpit.match(/override adjust\(/g)).toHaveLength(3);
  });

  it("the flat pill slider is GONE, not left beside the knob", () => {
    // Two kits is how a later screen quietly gets its pill slider back.
    const controls = SRC("controls.ts");
    expect(controls).not.toContain("class SliderRow");
    expect(controls).not.toContain("class ToggleRow");
    expect(controls).not.toContain("class OptionRow");
  });
});
