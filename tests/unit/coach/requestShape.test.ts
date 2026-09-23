import { describe, expect, it } from "vitest";
import { parseRequest } from "../../../api/coach.js";
import { stageBundle } from "@game/scenes/lib/content";
import { STOP_IDS, type StopId } from "@engine/types";

/**
 * WHAT A REAL BELT ACTUALLY SENDS.
 *
 * The endpoint's gates were measured for months against hand-written bodies
 * carrying six blasted words. A cleanly flown Uranus belt sends 56, the cap
 * was 48, and every one of those runs was refused with a 400 before a token
 * was spent. From the child's seat it is indistinguishable from the model
 * being off: stock note, stock sentence, every time, on the later belts.
 *
 * So these cases are the measurement, not an invention: the numbers below were
 * read off `/api/coach` requests captured from production play.
 */

/** Captured from a real Uranus run: 2 missed, 0 slow, 56 blasted, 115 pool. */
const REAL_URANUS = {
  stopId: "uranus",
  lang: "en",
  missed: ["hard", "cold"],
  slow: [],
  hitRate: 0.9655172413793104,
  mode: "warp",
  pool: stageBundle("uranus").pool,
  blasted: stageBundle("uranus").pool.slice(0, 56),
  shipped: stageBundle("uranus").warpSentence ?? "",
};

describe("the endpoint accepts what the game sends (UR-193)", () => {
  it("the captured Uranus request parses", () => {
    expect(REAL_URANUS.blasted).toHaveLength(56);
    expect(parseRequest(REAL_URANUS)).not.toBeNull();
  });

  it("every belt's FULL pool blasted still parses", () => {
    // The upper bound of a real run: the child cleared every rock. Nothing
    // about a good run may cost them the coach.
    for (const stop of STOP_IDS as readonly StopId[]) {
      const bundle = stageBundle(stop);
      if (bundle.warpSentence === null) continue;
      const parsed = parseRequest({
        ...REAL_URANUS,
        stopId: stop,
        pool: bundle.pool,
        blasted: bundle.pool,
        missed: bundle.pool.slice(0, 2),
        shipped: bundle.warpSentence,
      });
      expect(parsed, `${stop} blasted=${bundle.pool.length}`).not.toBeNull();
    }
  });

  it("a struggling pilot who missed 13 words still gets a reply", () => {
    // The old cap was 12. The child who misses most is the one this is for.
    const parsed = parseRequest({
      ...REAL_URANUS,
      missed: stageBundle("uranus").pool.slice(0, 13),
    });
    expect(parsed?.missed).toHaveLength(13);
  });

  it("still refuses a body that is not a plausible run", () => {
    // The caps are a guard against a malformed client, not decoration.
    expect(parseRequest({ ...REAL_URANUS, blasted: new Array(200).fill("rock") })).toBeNull();
    expect(parseRequest({ ...REAL_URANUS, missed: new Array(60).fill("rock") })).toBeNull();
    expect(parseRequest({ ...REAL_URANUS, stopId: "earth" })).toBeNull();
    expect(parseRequest({ ...REAL_URANUS, hitRate: 1.5 })).toBeNull();
    expect(parseRequest({ ...REAL_URANUS, mode: "warp", pool: [] })).toBeNull();
  });
});
