import { describe, expect, it } from "vitest";
import { moteTile } from "@game/render/tiles";
import { hitsKeepClear } from "@game/render/keepClear";
import { titleKeepClear } from "@game/scenes/support/titleLayout";
import { PALETTE_STOP_IDS, paletteAt } from "@game/render/palette";

/**
 * THE ACCENT GLINTS TAKE THE ZONE TOO.
 *
 * `accentTile`'s diamonds have steered around type since UR-06. `moteTile`'s
 * seven glints - the same saturated stop accent, larger, additive - never
 * asked: they were placed at `rand()*w, rand()*h` and nothing was passed to
 * stop them. On Pluto, whose accent is `#FFB3C7`, that put a pink four-point
 * star on the wordmark and another under the tagline. The owner reported both.
 *
 * The zone is the one the Title already ships (`titleKeepClear`), so this
 * cannot pass against a rectangle invented for the test.
 */
const W = 1920;
const H = 1080;
const ZONE = titleKeepClear(W);

/** A fixed stream: the placement is a property of the tile, not of luck. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

const glintsOf = (seed: number, zone?: typeof ZONE) =>
  moteTile(W, H, "#20222A", paletteAt("pluto", false).accent, rng(seed), zone).filter(
    (op) => op.kind === "sprite" && op.tex === "glint",
  );

describe("the stop's accent glints keep off the lockup", () => {
  it("NEGATIVE CONTROL: without a zone, they land on it", () => {
    // If this ever goes quiet the guard below is measuring nothing.
    const hit = [...Array(40).keys()].some((seed) =>
      glintsOf(seed).some(
        (op) => op.kind === "sprite" && hitsKeepClear(op.x, op.y, op.size, ZONE),
      ),
    );
    expect(hit, "no seed put a glint on the lockup, so this proves nothing").toBe(true);
  });

  it("with the zone, none of them touch it, at any seed", () => {
    for (let seed = 0; seed < 40; seed += 1) {
      for (const op of glintsOf(seed, ZONE)) {
        if (op.kind !== "sprite") continue;
        expect(
          hitsKeepClear(op.x, op.y, op.size, ZONE),
          `seed ${seed}: a glint landed on the lockup at ${Math.round(op.x)},${Math.round(op.y)}`,
        ).toBe(false);
      }
    }
  });

  it("the field is still populated - the guard moves them, it does not empty", () => {
    // 12 re-draws then a drop, so a run of bad luck costs a glint rather than
    // looping. The frame must not go bare because of it.
    for (let seed = 0; seed < 40; seed += 1) {
      expect(glintsOf(seed, ZONE).length, `seed ${seed}`).toBeGreaterThanOrEqual(5);
    }
  });

  it("holds for every stop's accent, not just the pink one", () => {
    for (const stop of PALETTE_STOP_IDS) {
      const ops = moteTile(W, H, "#20222A", paletteAt(stop, false).accent, rng(7), ZONE);
      for (const op of ops) {
        if (op.kind !== "sprite" || op.tex !== "glint") continue;
        expect(hitsKeepClear(op.x, op.y, op.size, ZONE), stop).toBe(false);
      }
    }
  });
});
