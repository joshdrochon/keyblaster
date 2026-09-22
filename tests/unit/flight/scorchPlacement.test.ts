import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HULL_DESIGN_PROFILE,
  HULL_DESIGN_W,
  HULL_DESIGN_Y_BOT,
  HULL_DESIGN_Y_TOP,
  SCORCH_CORE_H,
  SCORCH_CORE_W,
  SCORCH_H,
  SCORCH_JITTER_PX,
  SCORCH_SLOTS,
  SCORCH_W,
  hullHalfWidthAt,
  scorchColors,
  scorchSlotAt,
} from "@game/render/scorch.js";
import { luma255 } from "@game/render/palette.js";
import { hullForStage } from "@engine/hull/index.js";
import { DEFAULT_FLIGHT_CONFIG } from "@game/flight/stage.js";

/**
 * THE SCORCH MARK'S ARITHMETIC (UR-22, AC-22.4).
 *
 * ================== WHAT WENT WRONG ==================
 * UR-22 made the mark big enough to see: 34x20 on a fuselage 57 px across. It
 * did not account for how MANY of them a stage draws. A shipped belt is 58
 * words and `hullForStage(58)` was nine when this was measured (six since C26),
 * so nine translucent near-black ellipses were being stacked inside a 20 px
 * wide strip down the middle of the hull. Nothing below is pinned to nine: the
 * assertions read `hullForStage` and the lattice holds twelve either way.
 *
 * Measured with the gauntlet's own silhouette probe
 * (`tests/e2e/hull-scorch.spec.ts`), the Lantern's core fell from 203 to about
 * 75 as the marks accumulated, while the frame immediately around the ship sits
 * at 57 (neptune) to 108 (saturn). So the hull walked THROUGH the sky's own
 * value on its way down, and AC-22.4's 0.06 separation bar was failing at four
 * marks on mars, four on jupiter, seven on pluto, eight on saturn and nine on
 * neptune - all of them reachable on a shipped stage - and never on uranus,
 * whose sky at the ship is dark enough that a darkening hull only separates
 * further. A gate that had sampled uranus would have called this clean.
 *
 * Two controls, not one (coding-standards rule 9): the same probe run with the
 * mark not drawn at all reports the ship at 203.5 at EVERY mark count and every
 * stop, minimum separation 0.3736. The hull lamp dimming is not a contributor;
 * the whole of it is this drawing.
 *
 * ================== WHAT THIS FILE HOLDS ==================
 * The three properties the fix rests on, none of which needs a browser:
 *   1. every slot keeps the whole mark on the hull, at the hull's own width;
 *   2. the mark's core is dark and its field is not - the field is the value
 *      NINE marks paint the ship, so it is the value that has to clear the sky;
 *   3. the slots spread, so a new hit lands somewhere a previous one did not.
 *
 * WATCHED FAILING, in each case by putting a piece of the old drawing back:
 *
 *   the field mix 0.1 -> the shipped `#2A2F3A` at 0.72 alpha, i.e. what the old
 *   mark composited to over cream:
 *     a fully scorched #F2E6D2 hull would read 98.3 against a sky at 108:
 *     expected 98.342 to be greater than 123.3
 *
 *   SCORCH_SLOTS -> the old `x = (rng() - 0.5) * 20, y = -34 + rng() * 58`,
 *   sampled on a lattice, which fails three ways at once:
 *     slot 0 at y -42.5: the mark reaches 16.3 px from the spine where the hull
 *     is 11.3 px wide - it would hang off the ship into the sky:
 *     expected 16.308248298638638 to be less than or equal to 11.821917886879131
 *     the lowest slot: expected 24 to be greater than 25
 *     slot 3 is the first and it sits on the porthole:
 *     expected 3 to be greater than or equal to 9
 *
 *   the gash 24x10 -> the old 11x7 hard centre:
 *     one mark's core is 0.88% of the fuselage box:
 *     expected 0.008810556320163681 to be greater than 0.02
 *
 *   npx vitest run tests/unit/flight/scorchPlacement.test.ts --coverage.enabled=false
 */

/**
 * `FlightScene.SHIP_SCALE` - `SHIP_HALF_WIDTH_PX / LANTERN_DESIGN_HALF_WIDTH`.
 *
 * `LANTERN_DESIGN_HALF_WIDTH` is the widest |x| in `lantern.FIN_POINTS`, which
 * is `FIN_TIP.x + 6` at the second-to-last fin point (129). Restated with the
 * source guard below rather than imported, because `lantern.ts` executes Phaser.
 */
const SHIP_HALF_WIDTH_PX = 46;
const LANTERN_DESIGN_HALF_WIDTH = 129;
const SHIP_SCALE = SHIP_HALF_WIDTH_PX / LANTERN_DESIGN_HALF_WIDTH;

const lanternSource = (): string =>
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/render/lantern.ts"),
    "utf8",
  );

/** The four shipped hulls (`lantern.LANTERN_COLORWAYS`), plus the base cream. */
const HULLS = ["#F2E6D2", "#E8F1F2", "#F6EBD6", "#F7E9EC"];

describe("the scorch mirrors the hull it is drawn on", () => {
  /**
   * A COPY IS NOT A BINDING UNLESS SOMETHING WATCHES IT.
   *
   * `scorch.ts` mirrors `lantern.ts`'s private `W`, `Y_TOP`, `Y_BOT` and
   * `HULL_PROFILE` because that module imports Phaser as a value and cannot be
   * loaded here. Restating numbers and hoping is how `hudKeepOut` ended up
   * testing its own arithmetic; this reads the real file instead, so moving a
   * fin or reshaping the capsule turns this red rather than quietly sliding a
   * mark off the ship.
   */
  it("the mirrored fuselage profile is still what lantern.ts draws", () => {
    const src = lanternSource();
    expect(/const W = (\d+);/.exec(src)?.[1], "lantern.W").toBe(String(HULL_DESIGN_W));
    expect(/const Y_TOP = (-?\d+);/.exec(src)?.[1], "lantern.Y_TOP").toBe(
      String(HULL_DESIGN_Y_TOP),
    );
    expect(/const Y_BOT = (-?\d+);/.exec(src)?.[1], "lantern.Y_BOT").toBe(
      String(HULL_DESIGN_Y_BOT),
    );
    const profile = /const HULL_PROFILE = \[([^\]]*)\]/.exec(src)?.[1] ?? "";
    expect(
      profile.split(",").map((n) => Number(n.trim())),
      "lantern.HULL_PROFILE",
    ).toEqual([...HULL_DESIGN_PROFILE]);
    // And the scale the slots were sized against.
    expect(
      /const SHIP_HALF_WIDTH_PX = (\d+);/.exec(
        readFileSync(
          resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/scenes/FlightScene.ts"),
          "utf8",
        ),
      )?.[1],
      "FlightScene.SHIP_HALF_WIDTH_PX",
    ).toBe(String(SHIP_HALF_WIDTH_PX));
  });

  it("puts the fuselage where the ship is drawn", () => {
    // The capsule's widest point, and the two ends where it closes.
    expect(hullHalfWidthAt(-2.5, SHIP_SCALE)).toBeCloseTo(28.5, 0);
    expect(hullHalfWidthAt(-51, SHIP_SCALE)).toBe(0);
    expect(hullHalfWidthAt(46, SHIP_SCALE)).toBe(0);
  });
});

describe("every mark lands on the ship", () => {
  it("the whole mark is inside the hull at its own height, jitter included", () => {
    /**
     * THE MARK IS AN ELLIPSE AND THE HULL IS A CAPSULE, so this walks the
     * mark's own outline rather than its bounding box: at the top and bottom of
     * the mark the ellipse is barely any wider than its centre line, and a box
     * test would reject placements that are wholly on the ship.
     */
    for (const [i, slot] of SCORCH_SLOTS.entries()) {
      for (const jx of [0, 0.5, 1]) {
        for (const jy of [0, 0.5, 1]) {
          const placed = scorchSlotAt(i, jx, jy);
          for (let dy = -SCORCH_H / 2; dy <= SCORCH_H / 2; dy += 0.5) {
            const t = dy / (SCORCH_H / 2);
            const reach = Math.abs(placed.x) + (SCORCH_W / 2) * Math.sqrt(Math.max(0, 1 - t * t));
            const halfWidth = hullHalfWidthAt(placed.y + dy, SHIP_SCALE);
            expect(
              reach,
              `slot ${i} at y ${(placed.y + dy).toFixed(1)}: the mark reaches ` +
                `${reach.toFixed(1)} px from the spine where the hull is ` +
                `${halfWidth.toFixed(1)} px wide - it would hang off the ship into the sky`,
            ).toBeLessThanOrEqual(halfWidth + 0.5);
          }
        }
      }
    }
  });

  it("has a slot for every mark a shipped stage can take, and then some", () => {
    const shipped = hullForStage(DEFAULT_FLIGHT_CONFIG.stageWordCount);
    expect(shipped, "a 58-word belt carries six marks (C26)").toBe(6);
    expect(
      SCORCH_SLOTS.length,
      "the lattice repeats before a shipped stage runs out of hull",
    ).toBeGreaterThanOrEqual(shipped);
  });

  it("is total: a 400-word fixture stage takes 66 hits and still gets a slot", () => {
    for (const index of [0, 11, 12, 65, 66, 1000]) {
      const slot = scorchSlotAt(index, 0.5, 0.5);
      expect(Number.isFinite(slot.x) && Number.isFinite(slot.y), `index ${index}`).toBe(true);
    }
    // Junk in, a mark on the ship out - never NaN painted onto the hull.
    expect(scorchSlotAt(Number.NaN, 0.5, 0.5)).toEqual(SCORCH_SLOTS[0]);
    expect(scorchSlotAt(-3, 0.5, 0.5)).toEqual(SCORCH_SLOTS[0]);
  });
});

describe("the marks spread instead of piling", () => {
  /**
   * The old placement was `x = (rng() - 0.5) * 20, y = -34 + rng() * 58` - a
   * 20 px wide strip through the exact middle of the hull, which is also the
   * exact disc AC-22.4 averages. Nine marks in it are one mark nine times over.
   */
  it("every one of the first nine gashes lands on hull no earlier one took", () => {
    /**
     * NOT A MINIMUM SEPARATION, because one is not achievable and a bar chosen
     * so it can be passed is not a bar. Nine 34x20 burns do not fit on a hull
     * this size without touching. What HAS to be true is what the accumulation
     * ladder in `hull-feedback.spec.ts` depends on now that marks no longer
     * darken each other: a hit only registers if its GASH - the near-black
     * centre that spec counts - covers hull no earlier gash had.
     *
     * Rasterised at 1 px, which is what the frame does.
     */
    const rasterise = (
      slots: readonly { x: number; y: number }[],
      w: number,
      h: number,
      ox: number,
      oy: number,
    ): Set<string> => {
      const set = new Set<string>();
      for (const s of slots) {
        for (let y = Math.floor(s.y + oy - h / 2); y <= Math.ceil(s.y + oy + h / 2); y += 1) {
          for (let x = Math.floor(s.x + ox - w / 2); x <= Math.ceil(s.x + ox + w / 2); x += 1) {
            const dx = (x - s.x - ox) / (w / 2);
            const dy = (y - s.y - oy) / (h / 2);
            if (dx * dx + dy * dy <= 1) set.add(`${x},${y}`);
          }
        }
      }
      return set;
    };

    const first9 = SCORCH_SLOTS.slice(0, 9);
    const seen = new Set<string>();
    for (const [i, slot] of first9.entries()) {
      // `FlightScene.addScorch` draws the gash one px right and one px down.
      const gash = rasterise([slot], SCORCH_CORE_W, SCORCH_CORE_H, 1, 1);
      let fresh = 0;
      for (const px of gash) if (!seen.has(px)) fresh += 1;
      for (const px of gash) seen.add(px);
      expect(
        fresh,
        `gash ${i} lands entirely on hull an earlier gash had already taken, so ` +
          `the hit cannot register on a fuselage that is already scorched`,
      ).toBeGreaterThan(0);
    }
    const oneGash = rasterise([first9[0] as { x: number; y: number }], SCORCH_CORE_W, SCORCH_CORE_H, 1, 1).size;
    expect(
      seen.size / oneGash,
      `nine gashes cover ${(seen.size / oneGash).toFixed(2)} times what one does ` +
        `- the lattice is piling them into one place`,
    ).toBeGreaterThan(4);
    const burns = rasterise(first9, SCORCH_W, SCORCH_H, 0, 0);
    const oneBurn = rasterise([first9[0] as { x: number; y: number }], SCORCH_W, SCORCH_H, 0, 0).size;
    expect(
      burns.size / oneBurn,
      `nine burns cover ${(burns.size / oneBurn).toFixed(2)} times what one does`,
    ).toBeGreaterThan(3);
  });

  it("uses the whole hull, not a strip down the middle", () => {
    const ys = SCORCH_SLOTS.map((s) => s.y);
    // The capsule runs -50.6..45.6; the marks have to be spread over it rather
    // than concentrated where the probe's core disc is.
    expect(Math.min(...ys), "the highest slot").toBeLessThan(-25);
    expect(Math.max(...ys), "the lowest slot").toBeGreaterThan(25);
    expect(
      new Set(SCORCH_SLOTS.map((s) => Math.sign(s.x))).size,
      "the lattice uses both sides of the spine",
    ).toBe(3);
  });

  it("the jitter varies a mark without moving it off its own slot", () => {
    // Smaller than the mark's own half-height, so a jittered mark is still
    // recognisably in the place the lattice put it.
    expect(SCORCH_JITTER_PX, "the jitter has grown into a second placement rule").toBeLessThan(
      SCORCH_H / 2,
    );
    const jittered = scorchSlotAt(0, 1, 1);
    const slot = SCORCH_SLOTS[0] as { x: number; y: number };
    expect(Math.hypot(jittered.x - slot.x, jittered.y - slot.y)).toBeLessThanOrEqual(
      SCORCH_JITTER_PX * Math.SQRT2 + 1e-9,
    );
  });

  /**
   * THE PORTHOLE IS THE SHIP'S FACE AND IT IS TAKEN LAST.
   *
   * It is at (0, -3.6) with a 16.4 px radius at the flight screen's scale. A
   * burn laid across it paints out the one feature art-direction section 5
   * names, and because the burn is LIGHTER than the glass it also removes dark
   * pixels from the fuselage - which would make a hull hit register as the
   * opposite of damage on `hull-feedback.spec.ts`'s dark-share measure.
   */
  it("works outward from the hull and reaches the window last", () => {
    const porthole = { x: 0, y: -3.6, r: 16.4 };
    const overlapsWindow = (s: { x: number; y: number }): boolean =>
      Math.hypot(s.x - porthole.x, s.y - porthole.y) < porthole.r;
    const firstOnWindow = SCORCH_SLOTS.findIndex(overlapsWindow);
    // Nine, against the six a shipped 58-word stage can take since C26, so the
    // window is only ever reached by a fixture stage - with three slots of
    // headroom now rather than none.
    expect(
      firstOnWindow,
      `slot ${firstOnWindow} is the first and it sits on the porthole`,
    ).toBeGreaterThanOrEqual(hullForStage(DEFAULT_FLIGHT_CONFIG.stageWordCount));
  });
});

describe("the mark's values: an edge, not a depth", () => {
  /**
   * The field is what NINE marks paint the whole ship with, so ITS value is the
   * value a fully scorched hull takes. The frame immediately around the ship
   * was measured at 57 (neptune) to 108 (saturn), and AC-22.4 wants 0.06 of the
   * 8-bit range - 15.3 levels - between the ship and it.
   */
  const BRIGHTEST_SKY_AT_SHIP = 108;
  const SEPARATION_BAR = 0.06;
  const FLOOR = BRIGHTEST_SKY_AT_SHIP + SEPARATION_BAR * 255;

  it("a hull painted entirely in scorch is still clear of the brightest sky", () => {
    for (const hull of HULLS) {
      const field = luma255(scorchColors(hull).field);
      expect(
        field,
        `a fully scorched ${hull} hull would read ${field.toFixed(1)} against a ` +
          `sky at ${BRIGHTEST_SKY_AT_SHIP}`,
      ).toBeGreaterThan(FLOOR);
    }
  });

  it("the core is dark enough to count as damage", () => {
    // `hull-feedback.spec.ts` counts a pixel as dark below a quarter of the
    // range. The core is what a hit adds to that count.
    for (const hull of HULLS) {
      expect(luma255(scorchColors(hull).core), hull).toBeLessThan(0.25 * 255);
    }
  });

  it("the core is a large enough share of the fuselage for one hit to register", () => {
    // `hull-feedback.spec.ts`: the hull box is 52x132 and one hit must move the
    // dark share of it by more than 2%.
    const coreArea = Math.PI * (SCORCH_CORE_W / 2) * (SCORCH_CORE_H / 2);
    const hullBox = 52 * 132;
    expect(
      coreArea / hullBox,
      `one mark's core is ${((coreArea / hullBox) * 100).toFixed(2)}% of the fuselage box`,
    ).toBeGreaterThan(0.02);
  });

  it("the rim is lighter than the hull and the field is darker", () => {
    for (const hull of HULLS) {
      const ink = scorchColors(hull);
      const base = luma255(hull);
      expect(luma255(ink.rim), `${hull} rim`).toBeGreaterThan(base);
      expect(luma255(ink.field), `${hull} field`).toBeLessThan(base);
      // And the step from hull to field is far above the ~5/255 the first
      // UR-22 fix failed at, so the mark reads as a mark.
      expect(base - luma255(ink.field), `${hull} field step`).toBeGreaterThan(15);
    }
  });

  it("the mark is still the size UR-22 logged", () => {
    expect([SCORCH_W, SCORCH_H], "UR-22's outcome: a third of the hull's width").toEqual([
      34, 20,
    ]);
  });
});
