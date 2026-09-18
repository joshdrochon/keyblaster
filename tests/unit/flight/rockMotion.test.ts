import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ROCK_ANGLE_MAX_PX,
  ROCK_DRIFT_PX,
  type LivePlateTrack,
  type PlateTrack,
  plateKeepOuts,
} from "@engine/spawn/index.js";
import {
  ROCK_SPIN_MAX_RAD_PER_SEC,
  ROCK_SPIN_MIN_RAD_PER_SEC,
  mulberry32,
  rockSpinPerSec,
} from "@game/flight/stage.js";

/**
 * UR-83: HOW A ROCK MOVES, AS OPPOSED TO HOW FAST IT FALLS.
 *
 * Two reports, both about motion and neither about difficulty:
 *
 *   SPIN - "asteroids should rotate at genuinely different rates, the way real
 *   ones do". The hook existed; the range did not. `spawnRock` drew
 *   `(rng() - 0.5) * 0.3`, so the FASTEST rock in the game turned at 0.15 rad/s
 *   - one revolution every 42 seconds against a fall of about ten - and the
 *   median rock turned at 0.075, one revolution in 84 seconds. Nothing visibly
 *   turned and no two rocks visibly differed.
 *
 *   ANGLE - "some rocks should come down at an angle rather than straight",
 *   with one hard constraint: the angle is CONSTANT FROM SPAWN. A rock that has
 *   been travelling at a slope since it entered the frame reads as a
 *   trajectory; the same rock turning near the bottom reads as being deflected
 *   by something, and that is a bug this project has already had reported.
 *
 * The angle's real cost is AC-22.8, and that is measured where AC-22.8 lives -
 * `./plateSeparation.test.ts` flies 3456 boards with the angle modelled and
 * checks that no plate ever covers another. What is here is the arithmetic that
 * sweep rests on: that the keep-out actually widens by the travel.
 */

const ROOT = resolve(import.meta.dirname, "../../..");
const FLIGHT = readFileSync(resolve(ROOT, "src/game/scenes/FlightScene.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(?<!:)\/\/.*$/gm, "");

describe("UR-83 / AC-2.3: a rock tumbles, and no two tumble alike", () => {
  it("UR-83: the range is wide enough to SEE and slow enough to read", () => {
    /**
     * WATCHED FAILING, with the real number: put `rockSpinPerSec` back to the
     * shipped `(draw - 0.5) * 0.3` and this reads
     *
     *     the fastest rock turns once every 41.9 s: expected 0.15 to be
     *     greater than 0.4
     *
     * The ceiling is bounded by the SILHOUETTE's legibility and not the word's:
     * the plate is not a child of the rock and `updateRocks` deliberately never
     * copies the rotation, so the word never turns at all (asserted below).
     */
    const fastest = rockSpinPerSec(1);
    const secondsPerTurn = (2 * Math.PI) / fastest;
    expect(
      fastest,
      `the fastest rock turns once every ${secondsPerTurn.toFixed(1)} s`,
    ).toBeGreaterThan(0.4);
    expect(fastest).toBe(ROCK_SPIN_MAX_RAD_PER_SEC);
    // Slow enough that a rock turns once or twice over a fall, not five times.
    expect(secondsPerTurn).toBeGreaterThan(5);
  });

  it("UR-83: every rock turns enough to see, and both ways", () => {
    // A uniform draw centred on zero gives most rocks a spin too slow to see,
    // and "they all look static" is the same complaint as "they all look the
    // same". The draw's sign picks the direction and its magnitude picks the
    // rate, so the whole range is spent on how fast.
    const rng = mulberry32(0x83);
    const spins = Array.from({ length: 400 }, () => rockSpinPerSec(rng()));
    for (const spin of spins) {
      expect(Math.abs(spin)).toBeGreaterThanOrEqual(ROCK_SPIN_MIN_RAD_PER_SEC);
      expect(Math.abs(spin)).toBeLessThanOrEqual(ROCK_SPIN_MAX_RAD_PER_SEC);
    }
    expect(spins.some((s) => s < 0), "no rock turned anticlockwise").toBe(true);
    expect(spins.some((s) => s > 0), "no rock turned clockwise").toBe(true);
    // GENUINELY DIFFERENT RATES, stated as a spread rather than as a range: the
    // slowest and fastest tenth of a board's rocks are far apart.
    const sorted = [...spins].map(Math.abs).sort((a, b) => a - b);
    const p10 = sorted[Math.floor(sorted.length * 0.1)] as number;
    const p90 = sorted[Math.floor(sorted.length * 0.9)] as number;
    expect(p90 / p10, `the fast tenth turns ${(p90 / p10).toFixed(1)}x the slow tenth`)
      .toBeGreaterThan(3);
  });

  it("UR-83: it is deterministic in its draw, so a seeded replay turns identically", () => {
    const a = Array.from({ length: 50 }, (_, i) => rockSpinPerSec(mulberry32(7 + i)()));
    const b = Array.from({ length: 50 }, (_, i) => rockSpinPerSec(mulberry32(7 + i)()));
    expect(a).toEqual(b);
    // Total: a corrupt draw is the slowest spin, never NaN. A rock with a NaN
    // rotation is an invisible rock.
    expect(Number.isFinite(rockSpinPerSec(Number.NaN))).toBe(true);
    expect(Math.abs(rockSpinPerSec(Number.NaN))).toBe(ROCK_SPIN_MIN_RAD_PER_SEC);
  });

  it("AC-2.3: the WORD does not rotate, whatever the rock does", () => {
    // The owner's constraint: "the word plate must not rotate - it hangs below
    // the rock and a spinning word is unreadable." `updateRocks` sets the
    // plate's POSITION from the rock and never its rotation, and the plate is
    // not a child of the container that spins (see PLATE_LAYER_DEPTH).
    //
    // WATCHED FAILING, with the real text: add `rock.plate.setRotation(...)` to
    // `updateRocks` and the second assertion goes red.
    expect(FLIGHT).toMatch(/rock\.container\.rotation \+= rock\.spinPerSec \* dtSeconds/);
    expect(FLIGHT).toMatch(
      /rock\.plate\.setPosition\(rock\.container\.x, rock\.container\.y \+ rock\.plateOffsetY\)/,
    );
    expect(
      /rock\.plate\.(setRotation|setAngle)\(/.test(FLIGHT),
      "the word plate is being rotated, and a spinning word is unreadable",
    ).toBe(false);
  });
});

describe("UR-83 / AC-22.8: an angled rock reserves the columns it travels through", () => {
  const track = (over: Partial<PlateTrack> = {}): PlateTrack => ({
    halfWidthPx: 100,
    halfHeightPx: 20,
    fromY: -40,
    toY: 860,
    spawnedAtMs: 0,
    fallMs: 6000,
    ...over,
  });
  const live = (over: Partial<LivePlateTrack> = {}): LivePlateTrack => ({
    ...track(),
    homeX: 900,
    ...over,
  });

  it("UR-83: no angle at all is the pre-UR-83 band, byte for byte", () => {
    // The property every caller that does not declare a travel depends on.
    const bands = plateKeepOuts(track(), [live()]);
    expect(bands.length).toBe(1);
    const reach = 100 + 100 + 2 * ROCK_DRIFT_PX;
    expect(bands[0]).toEqual({ from: 900 - reach, to: 900 + reach });
  });

  it("UR-83: the band widens by BOTH rocks' travel, on the side each travels", () => {
    /**
     * The arithmetic AC-22.8 rests on. The incoming rock occupies
     * `homeX + [0, travelA]` over its fall and the live one
     * `homeX + [0, travelB]`, so the forbidden set of columns is the interval
     * where those two can come within `reach`.
     *
     * WATCHED FAILING, with the real number: put `plateKeepOuts` back to
     * `other.homeX +/- reach` and `./plateSeparation.test.ts` reads
     *
     *   the belt put a word over a word: 479 boards, worst 53.9% of "chunks"
     *   and "thin" (saturn, maxLive 7, fast, spacing 1, saturated, seed 2)
     *   expected 0.5392569435095811 to be +0
     */
    const reach = 100 + 100 + 2 * ROCK_DRIFT_PX;
    // Both drifting right: the incoming rock's start must be further LEFT to
    // stay clear, and the live one's right-hand travel pushes the far edge out.
    const right = plateKeepOuts(track({ travelPx: 50 }), [live({ travelPx: 40 })])[0]!;
    expect(right).toEqual({ from: 900 + 0 - 50 - reach, to: 900 + 40 - 0 + reach });
    // Mirrored, and asymmetric in the other direction.
    const left = plateKeepOuts(track({ travelPx: -50 }), [live({ travelPx: -40 })])[0]!;
    expect(left).toEqual({ from: 900 - 40 - 0 - reach, to: 900 + 0 + 50 + reach });
    // Towards each other is the widest case, and is the one the old band missed.
    const towards = plateKeepOuts(track({ travelPx: 60 }), [live({ travelPx: -60 })])[0]!;
    expect(towards.to - towards.from).toBe(2 * reach + 120);
  });

  it("UR-83: the band's width is bounded by ROCK_ANGLE_MAX_PX, so the board keeps its room", () => {
    // The angle is bought out of the playable span, so the bound on it is the
    // bound on how much width a deep board loses. At the maximum, every band
    // grows by at most twice the constant.
    const reach = 100 + 100 + 2 * ROCK_DRIFT_PX;
    for (const a of [-ROCK_ANGLE_MAX_PX, 0, ROCK_ANGLE_MAX_PX]) {
      for (const b of [-ROCK_ANGLE_MAX_PX, 0, ROCK_ANGLE_MAX_PX]) {
        const band = plateKeepOuts(track({ travelPx: a }), [live({ travelPx: b })])[0]!;
        const width = band.to - band.from;
        expect(width, `${a}/${b}`).toBeGreaterThanOrEqual(2 * reach);
        expect(width).toBeLessThanOrEqual(2 * reach + 2 * ROCK_ANGLE_MAX_PX);
      }
    }
  });

  it("UR-83: a corrupt travel reads as a straight fall, never as NaN", () => {
    // A NaN band covers nothing, and a keep-out that covers nothing is the
    // guarantee silently switched off - which is worse than not having it.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const band = plateKeepOuts(track({ travelPx: bad }), [live({ travelPx: bad })])[0]!;
      expect(Number.isFinite(band.from), String(bad)).toBe(true);
      expect(Number.isFinite(band.to)).toBe(true);
      expect(band.to).toBeGreaterThan(band.from);
    }
  });

  it("UR-83: a rock still never comes level with a plate it cannot come level with", () => {
    // The narrow question the whole rule is built on is untouched: a rock that
    // is never level with another rock takes no band at all, whatever either
    // one's angle. Without this the angle would be an excuse to widen bands for
    // rocks that were never in each other's way.
    const later = live({ spawnedAtMs: 60_000, travelPx: ROCK_ANGLE_MAX_PX });
    expect(plateKeepOuts(track({ travelPx: -ROCK_ANGLE_MAX_PX }), [later])).toEqual([]);
  });
});
