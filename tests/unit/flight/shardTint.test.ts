import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  wordDebrisTypesFor,
  wordRockFill,
} from "../../../src/game/render/asteroid.js";
import { luma255 } from "../../../src/game/render/palette.js";
import { paletteFor } from "../../../src/game/flight/stage.js";
import { STOP_IDS } from "../../../src/engine/types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

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

  /**
   * ============ THIS FILE WAS VACUOUS AND IT IS INSTANCE 15 ============
   *
   * Its headline assertion was
   *
   *     expect(wordRockFill(type)).toBe(wordRockFill(type));
   *
   * followed by `void declared;`. f(x) === f(x) is true for every f, and nothing
   * in the file touched `fractureRock` or `setParticleTint`. A critic reverted
   * `FlightScene.ts` to `rock.debris.fill` - the exact defect this file is named
   * after - and all three tests still passed.
   *
   * It was written by a lane that had spent the night cataloguing this precise
   * defect class, in the same change where it fixed another instance of it.
   * Knowing about the trap does not keep you out of it. The only thing that does
   * is reverting the code and watching the test go red, which is now done for
   * every assertion here and recorded below.
   *
   * ============ WHY A SOURCE CHECK ============
   *
   * `fractureRock` is a private method on a Phaser Scene. Reaching it needs a
   * browser, and an e2e that blasts a rock and samples shard pixels is a real
   * check but a slow and flaky one for a binding that is a single expression.
   * The binding itself IS visible in the source, and `tests/unit/arch/` already
   * uses that shape for the same reason (`oneBootPath.test.ts`): some bindings
   * cannot be asserted from inside the running program, only about it.
   *
   * So this file now checks two separable things:
   *   1. the VALUES differ, so binding to the right one matters at all;
   *   2. the CALL SITE uses `wordRockFill` and not `debris.fill`.
   * Neither alone would have caught the revert. Together they do.
   *
   * WATCHED FAIL, both ways, before this was believed:
   *
   *   revert `FlightScene.fractureRock` to `rock.debris.fill`
   *     -> "fractureRock does not derive its shard tint from
   *         asteroid.wordRockFill ...": expected 'private fractureRock(rock:
   *         LiveRock, ...' to contain 'wordRockFill('
   *   make `wordRockFill` return its `base` argument unchanged
   *     -> "mars/mars-regolith: the drawn body colour equals the declared
   *         material, so this file proves nothing"
   */
  const FLIGHT_SCENE = readFileSync(
    path.resolve(HERE, "../../../src/game/scenes/FlightScene.ts"),
    "utf8",
  );

  /**
   * The body of `fractureRock`, from its signature to the next method, WITH THE
   * COMMENTS REMOVED.
   *
   * Stripping them is not tidiness. The first version of the check below tested
   * the raw text and failed, because the comment above the line explains at
   * length that the tint "is not `debris.fill`" - so a doc-comment describing
   * the fix read as the defect. A check that a comment can fail is a check about
   * prose.
   */
  function fractureRockBody(): string {
    const start = FLIGHT_SCENE.indexOf("private fractureRock(");
    expect(start, "fractureRock was renamed or removed").toBeGreaterThan(-1);
    const rest = FLIGHT_SCENE.slice(start);
    const end = rest.indexOf("\n  private ", 1);
    const body = end > 0 ? rest.slice(0, end) : rest;
    return body.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  }

  it("the tint passed to setParticleTint comes from wordRockFill", () => {
    const body = fractureRockBody();
    expect(body, "fractureRock no longer tints the shards").toContain("setParticleTint");
    expect(
      body,
      "fractureRock does not derive its shard tint from asteroid.wordRockFill - the shards are painted in a colour the rock is not drawn in, which is the defect this file is named after",
    ).toContain("wordRockFill(");
    // And not the raw material, which is what it used to read. Reverting that
    // one expression is the negative control; see the block comment above.
    expect(
      /\bdebris\.fill\b/.test(body),
      "fractureRock reads `debris.fill` - the material's declared colour, not the colour the rock is drawn in",
    ).toBe(false);
  });

  it("the two colours really are different, so the binding matters", () => {
    for (const stop of STOP_IDS) {
      for (const type of wordDebrisTypesFor(stop)) {
        const drawn = wordRockFill(type);
        expect(drawn, `${stop}/${type.id}`).toMatch(/^#[0-9a-fA-F]{6}$/);
        // The assertion this file was supposed to make all along. If these were
        // ever equal, binding to either would be the same thing and the whole
        // file would be asserting nothing - which is how it read before.
        expect(
          drawn.toLowerCase(),
          `${stop}/${type.id}: the drawn body colour equals the declared material, so this file proves nothing`,
        ).not.toBe(type.fill.toLowerCase());
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
