import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COCKPIT_CROSS,
  VIEWPORT_WINDOW,
  viewportWindowElementCount,
  viewportWindowLayout,
} from "@game/ui/viewportWindowLayout";
import { WINDOW as BRIEFING_WINDOW } from "@game/scenes/support/briefingLayout";
import {
  WINDOW as PREFLIGHT_WINDOW,
  mullionHorizontalAt,
  windowRect,
} from "@game/scenes/support/preflightLayout";

/**
 * THE COCKPIT WINDOW IS ONE COMPONENT (UR-77).
 *
 * ================== WHAT WAS REPORTED, AND WHAT IT MEANT ==================
 * The project owner looked at the Briefing and the Pre-flight screen back to
 * back and noticed that the Briefing's glass has a CROSS - a vertical mullion
 * and a horizontal one - and the Pre-flight's has a single vertical strut. The
 * inference they drew from that one detail is the ticket: the window is not a
 * shared component, because a component would have carried the crosshatch.
 *
 * They were right, and the inference is worth more than the symptom.
 * `BriefingScene.drawCockpit` and `PreflightScene.drawWindowAndPlanet` each
 * built the aperture mask, the hull, the inverted cutout, two frame rings and
 * the struts from scratch. Nearly the same lines, not the same: one strut
 * against two, `w * 0.38 - 8` against `w * 0.42`, `0.45` against `0.5`, `0.9`
 * against `0.92`, and the Briefing cutting its window mask twice in two places
 * 165 lines apart.
 *
 * ================== SO THIS FILE MAKES TWO CLAIMS, NOT ONE ==============
 *  1. THE GEOMETRY IS REAL. The frame surrounds the aperture, the struts cross
 *     the glass, and a window flattened back to a rounded rectangle with a line
 *     round it is a red test rather than a quiet ship.
 *  2. THERE IS ONE IMPLEMENTATION AND BOTH SCREENS REACH IT. This is the half
 *     that matters, and it is a SOURCE GUARD on purpose - in the shape of the
 *     one in `tests/unit/flight/plateSeparation.test.ts`, which greps a scene
 *     it cannot import because the scene extends a Phaser class.
 *
 * A check that the two windows LOOK alike is exactly the class of guard that
 * has been green here while a screen was visibly wrong: five of them were, on
 * this project, and two drawings that match today drift the next time one
 * screen is touched. So the assertion is that the drawing is not in either
 * scene AT ALL - no ring, no mask, no strut - and that each scene has exactly
 * one call site.
 *
 *   npx vitest run tests/unit/ui/viewportWindow.test.ts --coverage.enabled=false
 */

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../src/game/${rel}`, import.meta.url)), "utf8");

/** A file's code with its comments blanked, so prose cannot satisfy a check. */
const CODE = (rel: string): string =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const SCENES = ["scenes/BriefingScene.ts", "scenes/PreflightScene.ts"] as const;

const GLASS = { x: 1012, y: 84, w: 812, h: 636 };

const inside = (
  outer: { x: number; y: number; w: number; h: number },
  inner: { x: number; y: number; w: number; h: number },
): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h;

describe("the window is made of pieces, and they are where they say they are", () => {
  it("strikes the frame outside the aperture on every edge", () => {
    const p = viewportWindowLayout(GLASS, 56);
    const o = VIEWPORT_WINDOW.frameOffset;
    expect(p.aperture.x - p.frame.x).toBe(o);
    expect(p.aperture.y - p.frame.y).toBe(o);
    expect(p.frame.x + p.frame.w - (p.aperture.x + p.aperture.w)).toBe(o);
    expect(p.frame.y + p.frame.h - (p.aperture.y + p.aperture.h)).toBe(o);
    // The corner has to stay concentric or the ring pinches at the curve.
    expect(p.frameRadius - p.radius).toBe(o);
  });

  it("crosses the glass with two struts, both of them on it", () => {
    const p = viewportWindowLayout(GLASS, 56);
    expect(p.mullions.length).toBe(2);
    for (const m of p.mullions) {
      expect(inside(p.aperture, m), "a strut hangs off the glass").toBe(true);
    }
    const [vertical, horizontal] = p.mullions as [typeof p.mullions[0], typeof p.mullions[0]];
    // The vertical one is CENTRED on its fraction, which is what the
    // Pre-flight's `w * 0.38 - 8` was doing by hand with the half-width
    // subtracted at the call site.
    expect(vertical.x + vertical.w / 2).toBeCloseTo(
      GLASS.x + GLASS.w * VIEWPORT_WINDOW.verticalAt,
      6,
    );
    expect(vertical.h).toBe(GLASS.h);
    expect(horizontal.w).toBe(GLASS.w);
  });

  it("counts the pieces, so a flattened redraw is a red test", () => {
    // WATCHED FAILING: return `mullions: []` from `viewportWindowLayout` and
    // this reports "expected 2 to be 4".
    const p = viewportWindowLayout(GLASS, 56);
    expect(viewportWindowElementCount(p)).toBe(4);
    // What the Pre-flight shipped: a frame and ONE strut.
    expect(viewportWindowElementCount(viewportWindowLayout(GLASS, 56, { verticalAt: 0.42 }))).toBe(3);
  });

  it("gives BOTH cockpit screens the cross", () => {
    // The whole report, as one assertion. A porthole with no struts is still
    // expressible - `{}` - which is what makes this a claim about these two
    // screens rather than about the component.
    for (const [name, rect, radius, pattern] of [
      ["briefing", BRIEFING_WINDOW, BRIEFING_WINDOW.r, COCKPIT_CROSS],
      [
        "preflight",
        windowRect(),
        PREFLIGHT_WINDOW.r,
        { verticalAt: VIEWPORT_WINDOW.verticalAt, horizontalAt: mullionHorizontalAt() },
      ],
    ] as const) {
      const p = viewportWindowLayout(rect, radius, pattern);
      expect(p.mullions.length, `${name} has no crosshatch`).toBe(2);
    }
    expect(viewportWindowLayout(GLASS, 56, {}).mullions).toEqual([]);
  });

  it("puts the two screens' struts on the same vertical line, in fractions", () => {
    // The drift, measured: `0.38 - 8/w` against `0.42`. At the Pre-flight's own
    // 924 px glass that is 37 px, which is what "these are two hand-built
    // cockpits" looks like in one number.
    const shipped = 0.38 - 8 / PREFLIGHT_WINDOW.w;
    expect(
      Math.abs(shipped - VIEWPORT_WINDOW.verticalAt) * PREFLIGHT_WINDOW.w,
    ).toBeGreaterThan(30);
  });
});

describe("one implementation, and both screens reach it (standards rule 3)", () => {
  it("is the ONLY place the window is drawn", () => {
    const component = CODE("ui/viewportWindow.ts");
    expect(component).toMatch(/export function drawCockpitWindow\b/);
    // The three shapes a cockpit window is: the mask, the outer ring, the
    // inner ring. All three in one file.
    expect(component).toMatch(/fillRoundedRect\(/);
    expect(component.match(/strokeRoundedRect\(/g)?.length).toBe(2);
  });

  it("is not redrawn in either scene - no ring, no mask, no strut", () => {
    /**
     * THE ASSERTION THE TICKET ASKS FOR. Not "the two look alike": that is the
     * check that was green while the Pre-flight had one strut and no vents.
     *
     * WATCHED FAILING, both halves, on the real source. With the shipped ring
     * pasted back into `PreflightScene.drawWindowAndPlanet`:
     *
     *   AssertionError: PreflightScene.ts draws its own window frame:
     *   expected true to be false
     *
     * and with the shipped single strut pasted back on its own -
     * `frame.fillRect(WINDOW.x + WINDOW.w * 0.38 - 8, WINDOW.y, 16, WINDOW.h)`:
     *
     *   AssertionError: PreflightScene.ts draws its own mullion:
     *   expected true to be false
     */
    for (const scene of SCENES) {
      const src = CODE(scene);
      const base = scene.split("/")[1] ?? scene;
      expect(
        /(fill|stroke)RoundedRect\s*\(\s*WINDOW\./.test(src),
        `${base} draws its own window frame`,
      ).toBe(false);
      expect(
        /\bfillRect\s*\(\s*WINDOW\./.test(src),
        `${base} draws its own mullion`,
      ).toBe(false);
      // The mask, too: the aperture and the hull cutout are the component's.
      expect(
        /createGeometryMask\s*\(/.test(src),
        `${base} cuts its own aperture`,
      ).toBe(false);
      expect(
        /setInvertAlpha\s*\(/.test(src),
        `${base} cuts its own hull`,
      ).toBe(false);
    }
  });

  it("has exactly ONE call site per screen", () => {
    // Two call sites in one scene is the same defect at a smaller scale, and it
    // is how the Briefing came to cut its window mask twice in two places.
    //
    // WATCHED FAILING: a second `drawCockpitWindow(...)` in `PreflightScene` -
    //   AssertionError: PreflightScene.ts call sites: expected 2 to be 1
    for (const scene of SCENES) {
      const base = scene.split("/")[1] ?? scene;
      const calls = CODE(scene).match(/drawCockpitWindow\s*\(/g) ?? [];
      expect(calls.length, `${base} call sites`).toBe(1);
    }
  });

  it("draws the strip from the same one function, on both screens", () => {
    // The other half of the report: `drawControlSurface` had exactly ONE caller
    // in the product - `BriefingScene` - which is why the Pre-flight had no
    // vents, no screws and no bezel. Both call it now, and neither paints its
    // own lamp row.
    for (const scene of SCENES) {
      const src = CODE(scene);
      const base = scene.split("/")[1] ?? scene;
      expect(src, `${base} does not reach the shared console strip`).toMatch(
        /drawControlSurface\(/,
      );
      // The shipped Pre-flight strip, exactly: nine flat circles in a loop.
      expect(
        /fillCircle\(\s*SHELF\./.test(src),
        `${base} paints its own lamp row`,
      ).toBe(false);
    }
  });

  it("takes every colour from a token, so no ink can dodge the contrast test", () => {
    // The same guard `controlSurface.ts` and `plate.ts` are held to. A hex
    // literal is the only way an unmeasured ink reaches the screen - with the
    // one exception of the mask fill, which is not an ink at all: a geometry
    // mask is read for its ALPHA and never drawn.
    const component = CODE("ui/viewportWindow.ts").replace(/0xffffff/g, "");
    expect(component).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(CODE("ui/viewportWindowLayout.ts")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("is vector, in code: no raster is referenced (D83/D84)", () => {
    const component = CODE("ui/viewportWindow.ts");
    expect(component).not.toMatch(/\.(png|jpg|jpeg|webp|gif|svg)\b/i);
    expect(component).not.toMatch(/scene\.add\.(image|sprite)\(/);
    expect(component).not.toMatch(/\bload\./);
  });

  it("keeps the geometry out of the Phaser half, so this file can run it", () => {
    // The `panel.ts`/`cockpit.ts` split, for the same reason: the numbers are
    // assertable in Node only while nothing pure imports Phaser.
    expect(CODE("ui/viewportWindowLayout.ts")).not.toMatch(/from "phaser"/);
  });
});
