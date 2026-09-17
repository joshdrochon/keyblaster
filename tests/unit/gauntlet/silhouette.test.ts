import { describe, expect, it } from "vitest";
// @ts-expect-error - .mjs tooling module, no type declarations by design
import { crushBand, measureSilhouettes, otsuRegionSeparation } from "../../gauntlet/silhouette.mjs";

/**
 * THE NEGATIVE CONTROL FOR V-22.4, and the reason the measure changed.
 *
 * V-22.4 says "rocket and asteroids identifiable by silhouette". It has been
 * green on two different measures that could not answer that question:
 *
 *   1. `{"contours": 14}` — a count of connected regions in a desaturated
 *      frame, passed for any count in [3, 60]. A frame in which the ship failed
 *      to render and thirteen dust blobs survived scores the same number.
 *   2. Per-region background separation off a global Otsu binarisation. Better,
 *      and still adaptive: crush the play area and Otsu re-splits what is left,
 *      finds object-sized regions elsewhere in the frame, and reports a healthy
 *      number about a part of the picture nobody asked about. The art lane
 *      measured a floor vignette that flattened the play area to a 0.002 step
 *      and this measure scored it 0.239.
 *
 * The previous lane deliberately did NOT move the threshold to catch that one
 * vignette, and was right: a threshold tuned to one known defect catches that
 * defect and nothing else. The fix is not a number, it is anchoring the
 * measurement to the coordinates the game reports for each object, so it cannot
 * migrate to a different part of the image.
 *
 * The frames below are synthetic, deterministic and need no browser, so the
 * control can be re-run in milliseconds:
 *
 *   npx vitest run tests/unit/gauntlet/silhouette.test.ts --coverage.enabled=false
 */

const W = 480;
const H = 270;

interface Obj {
  id: string;
  kind: string;
  cx: number;
  cy: number;
  r: number;
}

/** Four rocks in the play band plus the ship low and centre, as Flight lays out. */
const OBJECTS: Obj[] = [
  { id: "rock-a", kind: "rock", cx: 90, cy: 80, r: 22 },
  { id: "rock-b", kind: "rock", cx: 220, cy: 130, r: 26 },
  { id: "rock-c", kind: "rock", cx: 350, cy: 175, r: 20 },
  { id: "rock-d", kind: "rock", cx: 140, cy: 205, r: 24 },
  { id: "ship", kind: "ship", cx: 240, cy: 232, r: 28 },
];

/** Paint a filled disc of value `v`. */
function disc(grey: Uint8Array, cx: number, cy: number, r: number, v: number): void {
  for (let y = Math.max(0, cy - r); y <= Math.min(H - 1, cy + r); y += 1) {
    for (let x = Math.max(0, cx - r); x <= Math.min(W - 1, cx + r); x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) grey[y * W + x] = v;
    }
  }
}

/**
 * A healthy desaturated frame: a sky that darkens downward, a row of distant
 * crags near the horizon, and the game's objects as dark discs where the game
 * says they are.
 *
 * THE CRAGS ARE NOT DECORATION. They are object-sized, isolated and well clear
 * of the play band — exactly the kind of shape a real parallax frame is full
 * of, and exactly what a segmentation-based measure finds and reports on when
 * the play area itself has stopped saying anything. Without them the synthetic
 * frame would be kinder to the old measure than a real one is, and the control
 * below would be proving something easier than the truth.
 */
function healthyFrame(): Uint8Array {
  const grey = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) grey[y * W + x] = 200 - Math.round((y / H) * 50);
  }
  for (let i = 0; i < 9; i += 1) disc(grey, 30 + i * 52, 40, 13, 120);
  for (const o of OBJECTS) disc(grey, o.cx, o.cy, o.r, 40);
  return grey;
}

const measure = (grey: Uint8Array) =>
  measureSilhouettes({ grey, w: W, h: H, objects: OBJECTS }) as {
    minSeparation: number;
    objectsMeasured: number;
    unmeasurable: unknown[];
    weakest: { id: string; separation: number } | null;
  };

const THRESHOLD = 0.06; // the rubric's bar for V-22.4, unchanged

describe("AC-22.4: silhouette separation is measured where the objects are", () => {
  it("AC-22.4: a healthy frame reads well clear of the bar, on every object", () => {
    const r = measure(healthyFrame());
    expect(r.objectsMeasured).toBe(OBJECTS.length);
    expect(r.unmeasurable).toEqual([]);
    expect(r.minSeparation).toBeGreaterThan(THRESHOLD);
  });

  it("NEGATIVE CONTROL: the floor vignette that scored 0.239 under Otsu fails here", () => {
    // THE WHOLE CASE FOR THE CHANGE, ON ONE SET OF PIXELS. The crush flattens
    // the lower band onto its own mean: the ship and the low rocks are still
    // exactly where the game says they are, and there is nothing there to see.
    // fromY 0.5 / strength 4: the wash ramps in over the top quarter of the
    // band and is fully crushed from about y=168 down, so the three objects in
    // the lower half of the frame sit in flat grey. The two above it are
    // untouched — which is the point, because that is where the adaptive
    // measure goes to find its healthy number.
    const crushed = crushBand(healthyFrame(), W, H, { fromY: 0.5, strength: 4 }) as Uint8Array;

    const anchored = measure(crushed);
    const adaptive = otsuRegionSeparation({ grey: crushed, w: W, h: H }) as {
      minSeparation: number;
      regionsMeasured: number;
    };

    // The position-anchored measure goes red.
    expect(anchored.minSeparation).toBeLessThan(THRESHOLD);
    // And it names the object that vanished, rather than a number about the frame.
    expect(["ship", "rock-d", "rock-c"]).toContain(anchored.weakest?.id);

    // THE FALSE PASS, REPRODUCED ON THE SAME PIXELS. The measure this replaces
    // re-picks its threshold, finds ten object-sized regions up in the
    // untouched part of the frame, and reports ~0.27 — four times the bar —
    // about a part of the picture nobody asked about. That is the 0.239 the art
    // lane measured, and it is why no threshold below it would have been a fix.
    expect(adaptive.regionsMeasured).toBeGreaterThan(0);
    expect(adaptive.minSeparation).toBeGreaterThan(THRESHOLD);
  });

  it("NEGATIVE CONTROL: an object that failed to render is caught even in a busy frame", () => {
    // AC-22.4's other failure mode, and the one the contour count could never
    // see: everything else draws, the Lantern does not. The frame is full of
    // shapes and the count is healthy; the ship's own coordinates are empty sky.
    const grey = healthyFrame();
    const ship = OBJECTS.find((o) => o.id === "ship")!;
    disc(grey, ship.cx, ship.cy, Math.round(ship.r * 2), 200 - Math.round((ship.cy / H) * 50));
    const r = measure(grey);
    expect(r.weakest?.id).toBe("ship");
    expect(r.minSeparation).toBeLessThan(THRESHOLD);
    // The old count-based measure is untroubled: the rocks are all still there.
    const adaptive = otsuRegionSeparation({ grey, w: W, h: H }) as { regionsMeasured: number };
    expect(adaptive.regionsMeasured).toBeGreaterThanOrEqual(3);
  });

  it("NEGATIVE CONTROL: a uniform frame has nothing to report and says so", () => {
    const flat = new Uint8Array(W * H).fill(128);
    const r = measure(flat);
    expect(r.minSeparation).toBe(0);
  });

  it("the measure does not adapt: scaling the whole frame does not rescue a crushed one", () => {
    // Otsu's failure in one line. Multiply every pixel by 0.5 and the anchored
    // reading halves, because it is an absolute luminance step; the adaptive
    // one is unchanged, because it re-picks its threshold from the new data.
    const grey = healthyFrame();
    const dimmed = Uint8Array.from(grey, (v) => Math.round(v * 0.5));
    const a = measure(grey).minSeparation;
    const b = measure(dimmed).minSeparation;
    expect(b).toBeLessThan(a);
    expect(b).toBeCloseTo(a / 2, 2);
  });

  it("a rock overlapping another is measured against the sky, not against its neighbour", () => {
    // Without the neighbour exclusion, two touching rocks read as one rock on a
    // dark background and the separation collapses for a frame that is fine.
    const near: Obj[] = [
      { id: "rock-a", kind: "rock", cx: 200, cy: 60, r: 22 },
      { id: "rock-b", kind: "rock", cx: 236, cy: 60, r: 22 },
    ];
    const grey = new Uint8Array(W * H).fill(200);
    for (const o of near) {
      for (let y = o.cy - o.r; y <= o.cy + o.r; y += 1) {
        for (let x = o.cx - o.r; x <= o.cx + o.r; x += 1) {
          const dx = x - o.cx;
          const dy = y - o.cy;
          if (dx * dx + dy * dy <= o.r * o.r) grey[y * W + x] = 40;
        }
      }
    }
    const r = measureSilhouettes({ grey, w: W, h: H, objects: near }) as { minSeparation: number };
    expect(r.minSeparation).toBeGreaterThan(0.5);
  });

  it("an object the ring cannot be sampled around is reported unmeasurable, not passed", () => {
    // A rock half off the edge of the frame has no background ring. Silently
    // skipping it would shrink the population the minimum is taken over, which
    // is how a minimum quietly stops covering the thing that broke.
    const grey = healthyFrame();
    const edge = [{ id: "rock-edge", kind: "rock", cx: 0, cy: 0, r: 10 }];
    const r = measureSilhouettes({ grey, w: W, h: H, objects: edge }) as {
      objectsMeasured: number;
      unmeasurable: { id: string }[];
    };
    expect(r.objectsMeasured).toBe(0);
    expect(r.unmeasurable[0]?.id).toBe("rock-edge");
  });
});
