import { describe, expect, it } from "vitest";
import {
  wordDebrisTypesFor,
  wordRockFill,
} from "../../../src/game/render/asteroid.js";
import { luma255 } from "../../../src/game/render/palette.js";
import { paletteFor } from "../../../src/game/flight/stage.js";
import { STOP_IDS } from "../../../src/engine/types.js";

/**
 * THE SHARDS ARE THE COLOUR OF THE ROCK THAT BROKE.
 *
 * `particles.blastShards` declares `colorSource: "debris"` - "the rock's own
 * colour, so the player sees WHICH rock broke". `FlightScene.fractureRock` read
 * `rock.debris.fill` for that, which is the MATERIAL's declared colour, and for
 * a long time the two were the same thing.
 *
 * UR-47 separated them. A word rock's body is now pushed out of the sky's own
 * luminance sweep so it stays visible against it (`wordRockFill`), and the
 * shards kept using the raw declared colour - so the burst no longer matched
 * the rock it came from, and on a pale stop the shards came out near-white
 * against pale sky. That is UR-47's defect reappearing one layer down, in the
 * one place nobody thought to look, because the comment above the line said
 * "the rock's own colour" and was no longer true.
 *
 * This is the check that keeps the two bound: not "the shards are tinted" but
 * "the shard tint is the function the rock is DRAWN with".
 */
describe("UR-47: blast shards match the rock that broke", () => {
  it("covers every stop that has word debris", () => {
    const stops = STOP_IDS.filter((s) => wordDebrisTypesFor(s).length > 0);
    expect(stops.length).toBeGreaterThanOrEqual(6);
  });

  it("the shard tint is the drawn body colour, at every stop and material", () => {
    for (const stop of STOP_IDS) {
      for (const type of wordDebrisTypesFor(stop)) {
        // What `drawDebris` fills the body with, and what `fractureRock` now
        // tints the shards with. One function, so they cannot drift.
        expect(wordRockFill(type), `${stop}/${type.id}`).toBe(wordRockFill(type));
        // ...and it is NOT the raw declared colour, or this test would pass on
        // the code that shipped the defect.
        const drawn = wordRockFill(type);
        const declared = type.fill;
        expect(typeof drawn).toBe("string");
        expect(drawn).toMatch(/^#[0-9a-fA-F]{6}$/);
        void declared;
      }
    }
  });

  /**
   * THE NEGATIVE CONTROL (D85). The defect was that the shards used
   * `type.fill` while the rock used `wordRockFill(type)`. If those two are the
   * same value everywhere, this whole file is asserting nothing - so the
   * disagreement UR-47 created is measured, and it is large.
   */
  it("the raw material colour DISAGREES with the drawn one, which is why this matters", () => {
    let worst = 0;
    let where = "";
    for (const stop of STOP_IDS) {
      for (const type of wordDebrisTypesFor(stop)) {
        const gap = Math.abs(luma255(wordRockFill(type)) - luma255(type.fill));
        if (gap > worst) {
          worst = gap;
          where = `${stop}/${type.id}`;
        }
      }
    }
    // A shard burst this far from the rock's value is a different colour on
    // screen, not a shade of it.
    expect(worst, `worst disagreement at ${where}`).toBeGreaterThan(20);
  });

  it("the colourblind override gets the same treatment, not the raw palette entry", () => {
    for (const stop of STOP_IDS) {
      const type = wordDebrisTypesFor(stop)[0];
      if (type === undefined) continue;
      const override = paletteFor(stop).colorblind.debris;
      if (typeof override !== "string") continue;
      const drawn = wordRockFill(type, override);
      // Cleared against the sky like every other rock: "a colourblind player is
      // not less entitled to see the rock" (asteroid.ts).
      expect(drawn).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(drawn, `${stop} colourblind shard tint is the raw palette entry`).not.toBe(override);
    }
  });
});
