import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE FOCUS RING DOES NOT TRAVEL BETWEEN CONTROLS (UR-75).
 *
 * ================== THE DEFECT ==================
 * `FocusRing.moveTo` tweened `this.box` - x, y, w AND h - from the control
 * that had focus to the one taking it, redrawing on every frame of that tween.
 * The ring therefore slid across the screen and stretched from one button's
 * shape into the next. The project owner reported it moving the mouse between
 * the pilot card and "new pilot" on the title screen.
 *
 * Focus is a STATE, not an object that walks. Animating the journey points the
 * eye at the gap between two controls instead of at the one that now has
 * focus, and on a screen where the two controls are different widths the ring
 * is briefly the shape of neither.
 *
 * It was also INCONSISTENT, which is the half that makes it a design-system
 * bug rather than a preference: `scenes/lib/kit.ts`'s ring already snapped and
 * faded, so whether the ring travelled depended on which screen you were on -
 * exactly the "one-off" class of defect UR-71 is about.
 *
 * ================== WHY THIS IS NOT A SOURCE GUARD ==================
 * `chrome.ts` imports Phaser and cannot be loaded under vitest's node
 * environment, which is why its siblings are tested by regex over the source.
 * A regex cannot tell a position tween from an alpha tween without pinning the
 * exact text of the call. So Phaser is stubbed instead and the REAL class is
 * driven: the assertions below are about what `moveTo` actually did to the
 * ring, not about how the file is written.
 *
 * WATCHED FAILING, with the box tween restored - four of the seven go red:
 *
 *   never tweens its own geometry, at any hop
 *     the ring tweened its own geometry, so it travels between controls:
 *     expected [ ...(2) ] to deeply equal []
 *
 *   is drawn at the new control synchronously, before any frame runs
 *     expected 94 to be 594 // Object.is equality
 *     (94 is the OLD control's box, still 6 px outside x=100, because the ring
 *      only reaches x=594 by animating there)
 *
 *   fades up on arrival rather than snapping to full opacity
 *     expected 1 to be +0 // Object.is equality
 *
 *   replaces the live fade on a fast sweep instead of stacking fades
 *     expected [] to have a length of 2 but got +0
 */
vi.mock("phaser", () => ({ default: { GameObjects: {}, Tweens: {}, Scene: class {} } }));

interface TweenCall {
  readonly targets: unknown;
  readonly config: Record<string, unknown>;
}

/** Every rounded rect the ring asked for, in order. */
const strokes: { x: number; y: number; w: number; h: number }[] = [];
const tweens: TweenCall[] = [];
const removed: TweenCall[] = [];

const graphics = {
  alpha: 0,
  setDepth() {
    return graphics;
  },
  setAlpha(a: number) {
    graphics.alpha = a;
    return graphics;
  },
  clear() {
    strokes.length = 0;
    return graphics;
  },
  lineStyle() {
    return graphics;
  },
  strokeRoundedRect(x: number, y: number, w: number, h: number) {
    strokes.push({ x, y, w, h });
    return graphics;
  },
  destroy() {
    return graphics;
  },
};

const scene = {
  add: { graphics: () => graphics },
  tweens: {
    add(config: Record<string, unknown>) {
      const call: TweenCall = { targets: config["targets"], config };
      tweens.push(call);
      return { remove: () => removed.push(call) };
    },
  },
};

const { FocusRing } = await import("@game/ui/chrome");

/** The ring the class drew, which is the OUTER of its two passes' inner one. */
const drawnAt = (): { x: number; y: number; w: number; h: number } =>
  strokes[0] as { x: number; y: number; w: number; h: number };

/** Tweens that animate geometry rather than opacity. Must always be empty. */
const geometryTweens = (): unknown[] =>
  tweens
    .filter((t) => {
      const c = t.config;
      return c["x"] !== undefined || c["y"] !== undefined || c["w"] !== undefined || c["h"] !== undefined;
    })
    .map((t) => t.targets);

describe("UR-75: the focus ring appears on the new control, it does not travel", () => {
  beforeEach(() => {
    strokes.length = 0;
    tweens.length = 0;
    removed.length = 0;
    graphics.alpha = 0;
  });

  it("never tweens its own geometry, at any hop", () => {
    const ring = new FocusRing(scene as never, 10);
    ring.moveTo(100, 100, 200, 60);
    ring.moveTo(600, 400, 320, 80);
    ring.moveTo(100, 100, 200, 60);
    expect(
      geometryTweens(),
      "the ring tweened its own geometry, so it travels between controls",
    ).toEqual([]);
  });

  it("is drawn at the new control synchronously, before any frame runs", () => {
    // THE SNAP, MEASURED AT THE RECTANGLE. Nothing here advances a tween, so
    // if the ring only reached the new control by animating, this reads the
    // OLD control's box and fails.
    const ring = new FocusRing(scene as never, 10);
    ring.moveTo(100, 100, 200, 60);
    ring.moveTo(600, 400, 320, 80);
    const at = drawnAt();
    expect(at.x).toBe(600 - 6);
    expect(at.y).toBe(400 - 6);
    expect(at.w).toBe(320 + 12);
    expect(at.h).toBe(80 + 12);
  });

  it("leaves the old control at once: one ring is drawn, never two", () => {
    // `clear()` empties `strokes`, so a ring that painted the old box and the
    // new one in the same frame would leave four rects here rather than two
    // (the class draws the ring plus its softer halo).
    const ring = new FocusRing(scene as never, 10);
    ring.moveTo(100, 100, 200, 60);
    ring.moveTo(600, 400, 320, 80);
    expect(strokes).toHaveLength(2);
  });

  it("fades up on arrival rather than snapping to full opacity", () => {
    const ring = new FocusRing(scene as never, 10);
    ring.moveTo(100, 100, 200, 60);
    // First show is instant - there is no control to leave.
    expect(graphics.alpha).toBe(1);
    tweens.length = 0;
    ring.moveTo(600, 400, 320, 80);
    expect(graphics.alpha).toBe(0);
    const fade = tweens.at(-1);
    expect(fade?.targets).toBe(graphics);
    expect(fade?.config["alpha"]).toBe(1);
  });

  it("replaces the live fade on a fast sweep instead of stacking fades", () => {
    // A pointer dragged across three buttons fires `moveTo` three times inside
    // one fade. Without the handle the old tweens keep running and fight the
    // new one, which a child sees as a flicker.
    const ring = new FocusRing(scene as never, 10);
    ring.moveTo(100, 100, 200, 60);
    ring.moveTo(600, 400, 320, 80);
    ring.moveTo(900, 400, 320, 80);
    ring.moveTo(1200, 400, 320, 80);
    expect(removed).toHaveLength(2);
  });

  it("honours `instant` with no tween at all", () => {
    const ring = new FocusRing(scene as never, 10);
    ring.moveTo(100, 100, 200, 60);
    tweens.length = 0;
    ring.moveTo(600, 400, 320, 80, true);
    expect(tweens).toEqual([]);
    expect(graphics.alpha).toBe(1);
  });

  it("drops the fade when focus is taken away, so it cannot land after a hide", () => {
    const ring = new FocusRing(scene as never, 10);
    ring.moveTo(100, 100, 200, 60);
    ring.moveTo(600, 400, 320, 80);
    ring.hide();
    expect(removed).toHaveLength(1);
    expect(ring.isVisible).toBe(false);
  });
});
