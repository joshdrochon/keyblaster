import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONTROL_SURFACE,
  controlSurfaceElementCount,
  controlSurfaceLayout,
  lampRowBoxes,
  ventGroupWidth,
} from "@game/ui/controlSurfaceLayout";
import { HARDWARE } from "@game/ui/panel";

/**
 * THE SHARED CONTROL SURFACE (UR-61, extending UR-11).
 *
 * ================== WHAT THIS FILE IS DEFENDING ==================
 * UR-11 produced the Settings console. UR-61 reported that the Briefing's strip
 * - meant to be the same ship, seen from the same cockpit - reads as a row of
 * dots. The outcome standards rule 1 asks for is ONE control surface both
 * screens mount hardware on, not a second console language invented for one
 * screen, and that is what `ui/controlSurface.ts` and its layout module are.
 *
 * So there are two distinct claims here and they fail for different reasons:
 *
 *  1. THE GEOMETRY IS REAL. Pieces exist, they are inside the panel, and they
 *     do not sit on each other. A future redraw that flattens the strip back to
 *     a bar with dots on it goes red instead of quietly shipping.
 *  2. THE VOCABULARY IS SHARED. There is exactly one implementation of each
 *     piece and both screens reach it. A copied drawing is the defect standards
 *     rule 3 is about, and this repo has shipped a second private copy of a
 *     drawing before and only caught it with a reference compare.
 *
 *   npx vitest run tests/unit/ui/controlSurface.test.ts --coverage.enabled=false
 */

const SRC = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../../src/game/ui/${name}`, import.meta.url)),
    "utf8",
  );

/** The same file with comments stripped, so prose cannot satisfy a check. */
const CODE = (name: string): string =>
  SRC(name).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

/** A strip the shape of the Briefing's: the width of the cockpit glass. */
const STRIP = { x: 1012, y: 744, w: 812, h: 124 };

const overlaps = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("the surface is made of pieces, and they are where they say they are", () => {
  it("frames the face inside the bezel on every edge", () => {
    const p = controlSurfaceLayout(STRIP, 7);
    expect(p.face.x - p.bezel.x).toBe(CONTROL_SURFACE.bezel);
    expect(p.face.y - p.bezel.y).toBe(CONTROL_SURFACE.bezel);
    expect(p.bezel.x + p.bezel.w - (p.face.x + p.face.w)).toBe(CONTROL_SURFACE.bezel);
    expect(p.bezel.y + p.bezel.h - (p.face.y + p.face.h)).toBe(CONTROL_SURFACE.bezel);
  });

  it("puts a screw in each corner, inside the panel", () => {
    const p = controlSurfaceLayout(STRIP, 7);
    expect(p.rivets.length).toBe(4);
    const xs = new Set(p.rivets.map((r) => r.x));
    const ys = new Set(p.rivets.map((r) => r.y));
    expect(xs.size, "two distinct x positions").toBe(2);
    expect(ys.size, "two distinct y positions").toBe(2);
    for (const r of p.rivets) {
      expect(r.x).toBeGreaterThan(STRIP.x);
      expect(r.x).toBeLessThan(STRIP.x + STRIP.w);
    }
  });

  it("cuts two matched vent groups, neither of them through the lamp bank", () => {
    const p = controlSurfaceLayout(STRIP, 7);
    expect(p.vents.length).toBe(CONTROL_SURFACE.ventCount * 2);
    for (const vent of p.vents) {
      expect(overlaps(vent, p.bank), "a vent cut through the readout").toBe(false);
      expect(vent.h).toBeGreaterThan(0);
      expect(vent.h).toBeLessThan(p.face.h);
    }
    // Symmetric: the left group's inset from the face equals the right's.
    const left = p.vents[0] as { x: number };
    const right = p.vents[p.vents.length - 1] as { x: number; w: number };
    expect(left.x - p.face.x).toBe(
      p.face.x + p.face.w - (right.x + right.w),
    );
    expect(ventGroupWidth()).toBe(
      CONTROL_SURFACE.ventCount * CONTROL_SURFACE.ventPitch -
        (CONTROL_SURFACE.ventPitch - CONTROL_SURFACE.ventW),
    );
  });

  it("recesses the lamps inside their bank, centred, and never overlapping", () => {
    const p = controlSurfaceLayout(STRIP, 7);
    expect(p.lamps.length).toBe(7);
    for (const lamp of p.lamps) {
      expect(lamp.x).toBeGreaterThanOrEqual(p.bank.x);
      expect(lamp.x + lamp.w).toBeLessThanOrEqual(p.bank.x + p.bank.w);
      expect(lamp.y).toBeGreaterThanOrEqual(p.bank.y);
      expect(lamp.y + lamp.h).toBeLessThanOrEqual(p.bank.y + p.bank.h);
    }
    for (let i = 1; i < p.lamps.length; i += 1) {
      const a = p.lamps[i - 1] as { x: number; w: number };
      const b = p.lamps[i] as { x: number };
      expect(b.x, `lamp ${i} sits on lamp ${i - 1}`).toBeGreaterThan(a.x + a.w);
    }
  });

  it("counts the hardware, so a flattened redraw is a red test", () => {
    // The specific regression UR-61 is about: a strip that has become a plate
    // with dots on it still renders and still has lamps.
    //
    // WATCHED FAILING: return `rivets: []` and `vents: []` from
    // `controlSurfaceLayout` and this reports "expected 10 to be 26".
    const p = controlSurfaceLayout(STRIP, 7);
    expect(controlSurfaceElementCount(p)).toBe(26);
    // What shipped, for the record: one rounded bar and nine circles.
    expect(controlSurfaceElementCount(p)).toBeGreaterThan(10);
  });

  it("degrades sanely on a bank with nothing in it", () => {
    // `drawConsoleFace` lays the surface out with zero lamps - the Settings
    // panel mounts controls on it instead - so this path is live, not defensive.
    const p = controlSurfaceLayout({ x: 0, y: 0, w: 400, h: 200 }, 0);
    expect(p.lamps).toEqual([]);
    expect(p.rivets.length).toBeGreaterThanOrEqual(4);
    expect(p.face.w).toBe(400 - CONTROL_SURFACE.bezel * 2);
  });

  it("scales the lamp row with its size, and keeps it centred at any count", () => {
    for (const count of [1, 2, 4, 7, 9]) {
      const boxes = lampRowBoxes(100, 50, 400, count, 20);
      expect(boxes.length).toBe(count);
      const first = boxes[0] as { x: number };
      const last = boxes[boxes.length - 1] as { x: number; w: number };
      const leftAir = first.x - 100;
      const rightAir = 100 + 400 - (last.x + last.w);
      expect(Math.abs(leftAir - rightAir), `count ${count}`).toBeLessThanOrEqual(1);
    }
    // The Settings selector's lamps are the same hardware, smaller.
    expect(lampRowBoxes(0, 0, 200, 4)[0]?.w).toBe(HARDWARE.lampSize);
    expect(lampRowBoxes(0, 0, 200, 4, CONTROL_SURFACE.lampSize)[0]?.w).toBe(
      CONTROL_SURFACE.lampSize,
    );
  });
});

describe("one console language, shared, with no ink outside a token", () => {
  it("is the ONLY implementation of the console's pieces (standards rule 3)", () => {
    // Each of these used to be private to `cockpit.ts`, which is exactly why
    // the Briefing drew its own bar instead of using them.
    //
    // WATCHED FAILING: paste `drawRivet` back into `cockpit.ts` as a private
    // function and this reports "cockpit.ts has its own drawRivet: expected
    // true to be false".
    const cockpit = CODE("cockpit.ts");
    for (const piece of [
      "drawRivet",
      "drawGlass",
      "drawConsoleFace",
      "drawLampRow",
      "castShadowCircle",
    ]) {
      expect(
        new RegExp(`function\\s+${piece}\\b`).test(cockpit),
        `cockpit.ts has its own ${piece}`,
      ).toBe(false);
      expect(
        new RegExp(`export function\\s+${piece}\\b`).test(CODE("controlSurface.ts")),
        `controlSurface.ts is missing ${piece}`,
      ).toBe(true);
    }
    // ...and Settings still reaches them, through the import path it always had.
    expect(cockpit).toMatch(/from "\.\/controlSurface\.js"/);
    expect(cockpit).toMatch(/export \{ drawConsoleFace \}/);
  });

  it("is drawn by the Briefing, not redrawn in it", () => {
    const briefing = readFileSync(
      fileURLToPath(new URL("../../../src/game/scenes/BriefingScene.ts", import.meta.url)),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    expect(briefing).toMatch(/drawControlSurface\(/);
    // The shipped strip, which is what a one-screen redraw looks like.
    expect(briefing).not.toMatch(/fillCircle\(cx, lampY/);
  });

  it("takes every colour from a token, so no ink can dodge the contrast test", () => {
    // The same guard `cockpit.ts` is held to. A hex literal is the only way an
    // unmeasured ink reaches the screen.
    expect(CODE("controlSurface.ts")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(CODE("controlSurfaceLayout.ts")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("is vector, in code: no raster is referenced (D83/D84)", () => {
    const code = CODE("controlSurface.ts");
    expect(code).not.toMatch(/\.(png|jpg|jpeg|webp|gif|svg)\b/i);
    expect(code).not.toMatch(/scene\.add\.(image|sprite)\(/);
    expect(code).not.toMatch(/\bload\./);
  });

  it("draws no control the player cannot operate", () => {
    // The strip is INDICATORS. A knob or a switch on a screen whose only
    // controls are launch and the way back is a lie told to a seven-year-old,
    // and `cockpit.ts` keeps both of those for the screen where they do
    // something.
    const code = CODE("controlSurface.ts");
    expect(code).not.toMatch(/function drawKnob\b/);
    expect(code).not.toMatch(/function drawSwitch\b/);
  });
});
