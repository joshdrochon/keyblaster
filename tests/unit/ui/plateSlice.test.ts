import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { slicedPoints } from "@game/ui/plate";
import { SPACE } from "@game/ui/theme";
import {
  COG_W,
  CONTINUE_W,
  FOCUS_PAD,
  PRIMARY_H,
  PRIMARY_W,
  SLICE_GAP,
  SLICE_LEAN,
} from "@game/scenes/support/titleStack";

/**
 * ONE BUTTON, CUT IN TWO BY A DIAGONAL.
 *
 * Continue keeps the left piece and settings the right. The cut is the only
 * diagonal on either half - the outer edges are the edges the single button
 * had - and the two pieces together still fill its footprint.
 *
 * `TitleScene` extends a Phaser class and cannot be imported here, so the
 * geometry is tested through `slicedPoints` (which is what the scene draws
 * with) and the wiring through the source.
 */
const TITLE = readFileSync("src/game/scenes/TitleScene.ts", "utf8");
const PLATE = readFileSync("src/game/ui/plate.ts", "utf8");

const left = { x: 0, y: 0, w: CONTINUE_W, h: PRIMARY_H };
const right = { x: 0, y: 0, w: COG_W, h: PRIMARY_H };

describe("the cut", () => {
  it("is the only diagonal: the other three edges stay square", () => {
    const [tl, tr, br, bl] = slicedPoints(left, SLICE_LEAN, "right");
    expect(tl![1], "top edge is not level").toBe(tr![1]);
    expect(bl![1], "bottom edge is not level").toBe(br![1]);
    expect(tl![0], "Continue's LEFT edge leaned; only the cut may").toBe(bl![0]);
  });

  it("leans forward, and the two halves' cuts are parallel", () => {
    const l = slicedPoints(left, SLICE_LEAN, "right");
    const r = slicedPoints(right, SLICE_LEAN, "left");
    // Continue's cut: top-right sits right of bottom-right.
    expect(l[1]![0] - l[2]![0]).toBe(SLICE_LEAN);
    // The cog's cut: top-left sits right of bottom-left, by the same travel.
    expect(r[0]![0] - r[3]![0]).toBe(SLICE_LEAN);
  });

  it("the cog's outer edge is square, like the button's was", () => {
    const r = slicedPoints(right, SLICE_LEAN, "left");
    expect(r[1]![0], "the cog's RIGHT edge leaned; only the cut may").toBe(r[2]![0]);
  });

  it("splits the travel, so tuning the angle does not move either half", () => {
    const centre = (lean: number): number => {
      const p = slicedPoints(left, lean, "right");
      return (p[1]![0] + p[2]![0]) / 2;
    };
    expect(centre(SLICE_LEAN)).toBe(centre(0));
    expect(centre(SLICE_LEAN * 4)).toBe(centre(0));
  });

  it("zero lean is exactly the rectangle it was before", () => {
    expect(slicedPoints(left, 0, "right")).toEqual([
      [0, 0],
      [CONTINUE_W, 0],
      [CONTINUE_W, PRIMARY_H],
      [0, PRIMARY_H],
    ]);
  });
});

describe("the two halves are the button they came from", () => {
  it("fill its footprint exactly", () => {
    expect(CONTINUE_W + SLICE_GAP + COG_W).toBe(PRIMARY_W);
  });

  it("leave room for either half's ring, because either can hold focus", () => {
    // A gap of one pad would put a focused Continue's ring over the cog. The
    // shipped gap was 10 at first and did exactly that.
    expect(SLICE_GAP).toBeGreaterThanOrEqual(FOCUS_PAD * 2);
  });

  it("share a baseline and a height", () => {
    expect(TITLE).toMatch(/settings\.root\.setY\(stack\.primaryY\)/);
    expect(TITLE).toMatch(/w: COG_W, h: PRIMARY_H/);
  });

  it("sit with the cog one gap past Continue's trailing edge", () => {
    expect(TITLE).toMatch(/WORDMARK_X \+ PRIMARY_X \+ CONTINUE_W \+ SLICE_GAP/);
  });

  it("round every corner, including the two the cut made", () => {
    // `fillRoundedRect` cannot draw this, so a scene drawing its own path is
    // the failure mode - `platePainters.test.ts` is the guard for that. What
    // this asserts is that the shared component rounds the polygon at all.
    expect(PLATE).toMatch(/function roundedPoly\(/);
    expect(PLATE, "a sliced plate is filled as a bare polygon").toMatch(
      /roundedPoly\(g, sliced, radius, false\)/,
    );
    expect(SPACE.radius).toBe(16);
  });
});

describe("the focus ring is the half's own shape", () => {
  it("takes the ANGLE of the cut, not its pixels", () => {
    // The ring is `2 * FOCUS_PAD` taller than the control, so reusing the
    // plate's travel draws a shallower diagonal around a steeper one.
    const ringH = PRIMARY_H + FOCUS_PAD * 2;
    const ringLean = (SLICE_LEAN * ringH) / PRIMARY_H;
    expect(ringLean).toBeGreaterThan(SLICE_LEAN);
    expect(ringLean / ringH).toBeCloseTo(SLICE_LEAN / PRIMARY_H, 10);
    expect(PLATE, "the ring no longer scales the lean to its own height").toMatch(
      /\(\(options\.lean \?\? 0\) \* ring\.h\) \/ rect\.h/,
    );
  });

  it("is cut on the side that half was cut on", () => {
    expect(TITLE).toMatch(/diagonal: item\.id === "settings" \? "left" : "right"/);
  });
});

describe("settings is still the same control", () => {
  const cog = ((): string => {
    const at = TITLE.indexOf("private buildCog(");
    const body = TITLE.slice(at);
    return body.slice(0, body.indexOf("\n  private "));
  })();

  it("keeps its id, so focus order and the e2e selectors are unchanged", () => {
    expect(cog).toMatch(/id: "settings"/);
  });

  it("still opens Settings, and still returns to the Title", () => {
    expect(cog).toMatch(/SCENE_KEYS\.settings/);
    expect(cog).toMatch(/returnTo: SCENE_KEYS\.title/);
  });

  it("carries a glyph and no words, so nothing on it can be a text box", () => {
    expect(cog).toMatch(/drawSettingIcon\(glyph, "cog"/);
    expect(cog, "the cog grew a label").not.toMatch(/skyText\(/);
  });
});
