import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GAME_HEIGHT } from "@game/sceneKeys";
import { rectsOverlap, type Rect } from "@game/ui/layout";
import { PLATE_RHYTHM } from "@game/ui/plateLayout";
import {
  BEACON_Y,
  SHADOW_SCALE,
  SPEECH_TAIL_GAP,
  SPEECH_W,
  beaconBounds,
  shadowBox,
  shadowOrigin,
  speechBox,
  speechRowBoxes,
  speechWrapWidth,
} from "@game/scenes/support/earthLayout";

/**
 * UR: SHADOW'S LINE SAT ON THE LAMP.
 *
 * The Earth activation screen exists to show a child a beacon light up. Its
 * one spoken line was drawn as a 760 x 156 plate centred on `GAME_WIDTH / 2`
 * at `GAME_HEIGHT * 0.63 - 140`, which is 580..1340 x 540..696 at the
 * artboard - straight over the lamp housing (912..1008 x 461..539) and the top
 * of the mast. A passing layout guard is not evidence on this project, so this
 * file measures the two boxes and prints them.
 */

/** Every width the game can be built at: 16:9 through the 32:9 ceiling. */
const WIDTHS = [1920, 1707, 2561, 3440] as const;

/** One line in Latin, two in the worst wrap. Both have to clear the tower. */
const LINE_COUNTS = [1, 2, 3] as const;

const show = (r: Rect): string =>
  `x ${r.x.toFixed(1)}..${(r.x + r.w).toFixed(1)}  y ${r.y.toFixed(1)}..${(r.y + r.h).toFixed(1)}`;

describe("Earth activation - Shadow's line", () => {
  it("never covers the lamp or the tower, at any world width", () => {
    for (const width of WIDTHS) {
      for (const lines of LINE_COUNTS) {
        const box = speechBox(width, lines);
        const beacon = beaconBounds(width);
        expect(
          rectsOverlap(box, beacon),
          `w=${width} lines=${lines}\n  speech ${show(box)}\n  beacon ${show(beacon)}`,
        ).toBe(false);
      }
    }
  });

  it("clears the tower to its LEFT, with a gutter of sky between them", () => {
    for (const width of WIDTHS) {
      const box = speechBox(width, 2);
      const beacon = beaconBounds(width);
      const gap = beacon.x - (box.x + box.w);
      expect(gap, `w=${width}: speech ${show(box)} beacon ${show(beacon)}`).toBeGreaterThanOrEqual(
        96,
      );
    }
  });

  it("is anchored to Shadow: same column, sitting on his head", () => {
    for (const width of WIDTHS) {
      const box = speechBox(width, 2);
      const figure = shadowBox(width);
      // Horizontally overlapping his drawing, so the box reads as HIS.
      expect(box.x, `w=${width}`).toBeLessThanOrEqual(figure.x + figure.w);
      expect(box.x + box.w, `w=${width}`).toBeGreaterThan(figure.x + figure.w);
      // Directly above him, by exactly the declared gap.
      expect(figure.y - (box.y + box.h), `w=${width}`).toBeCloseTo(SPEECH_TAIL_GAP, 5);
      // Clear of the top of the drawing rather than crossing it.
      expect(box.y + box.h, `w=${width}`).toBeLessThan(figure.y);
    }
  });

  it("moves with the centre, like every other object on this screen", () => {
    // `grid-conformance.spec.ts` declares this screen "centred" and measures
    // every Text against `delta / 2`. Shadow, his box and the beacon must all
    // be on that model or the e2e goes red one width later.
    const delta = 2561 - 1920;
    const at = (w: number): number => speechBox(w, 2).x;
    expect(at(2561) - at(1920)).toBeCloseTo(delta / 2, 5);
    expect(shadowOrigin(2561).x - shadowOrigin(1920).x).toBeCloseTo(delta / 2, 5);
    expect(beaconBounds(2561).x - beaconBounds(1920).x).toBeCloseTo(delta / 2, 5);
  });

  it("shrinks to its content instead of reserving a worst case", () => {
    const one = speechBox(1920, 1);
    const two = speechBox(1920, 2);
    expect(two.h).toBeGreaterThan(one.h);
    // One line of body type, one caption, and the card rhythm's padding - no
    // more. The 156 px literal this replaces left ~70 px of empty plate.
    const rows = speechRowBoxes(1920, 1);
    const last = rows[rows.length - 1] as Rect;
    const slack = one.y + one.h - (last.y + last.h);
    expect(slack).toBeCloseTo(PLATE_RHYTHM.card.padY, 5);
  });

  it("keeps the numbers it borrows from the drawing honest", () => {
    // Same discipline as `warpLayout.test.ts`: the four reach coefficients are
    // restated here, so parse them back out of the drawing and compare.
    const src = readFileSync("src/game/render/shadow.ts", "utf8");
    const radius = /SHADOW_RADIUS\s*=\s*(\d+)/.exec(src);
    expect(radius, "render/shadow.ts stopped declaring SHADOW_RADIUS").not.toBeNull();
    const r = Number((radius as RegExpExecArray)[1]) * SHADOW_SCALE;
    const figure = shadowBox(1920);
    expect(figure.h / r).toBeCloseTo(1.82 + 1.6, 5);
    expect(figure.w / r).toBeCloseTo(1.32 + 1.52, 5);
  });

  it("is what the scene actually draws", () => {
    // The scene imports Phaser and cannot be loaded here, so the binding is
    // asserted by source: if the scene goes back to its own literals this file
    // would keep passing while the screen broke again.
    const scene = readFileSync("src/game/scenes/EarthActivationScene.ts", "utf8");
    expect(scene).toMatch(/from "\.\/support\/earthLayout(\.js)?"/);
    expect(scene).toMatch(/speechBox\(/);
    expect(scene).toMatch(/speechRowBoxes\(/);
    expect(scene).toMatch(/shadowOrigin\(/);
    // The two literals the defect was made of are gone.
    expect(scene).not.toMatch(/const lineW = 760/);
    expect(scene).not.toMatch(/GAME_HEIGHT \* 0\.63 - 140/);
  });

  it("states the beacon the screen is about", () => {
    expect(BEACON_Y).toBeCloseTo(GAME_HEIGHT * 0.46, 5);
    expect(SPEECH_W).toBe(560);
    expect(speechWrapWidth()).toBe(SPEECH_W - PLATE_RHYTHM.card.padX * 2);
  });
});
