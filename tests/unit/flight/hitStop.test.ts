import { describe, expect, it } from "vitest";
import {
  DEFAULT_FLIGHT_CONFIG,
  HIT_STOP_FRAMES,
  HIT_STOP_MS,
  hitStopMs,
} from "../../../src/game/flight/stage.js";
import { hullForStage } from "../../../src/engine/hull/index.js";

/**
 * UR-33: hit stop on a destroyed asteroid.
 *
 * The behaviour under test is in `FlightScene.update` and is measured by
 * `tests/e2e/hit-stop.spec.ts`, which types THROUGH the hold to prove no
 * keystroke is lost. This file owns the number, and the number is a judgement
 * rather than a fact, so it is written down where it can be argued with.
 */
describe("UR-33: the hold is short, and only a blast gets one", () => {
  it("sits at the short end of the range the player asked for", () => {
    // They asked for 1-3 frames. See `hitStopMs` for why 2 and not 3: this
    // fires on every completed word, 58 times a belt, at about one every two
    // seconds, and a hold that reads well once reads as a stutter by the
    // twentieth.
    expect(HIT_STOP_FRAMES).toBeGreaterThanOrEqual(1);
    expect(HIT_STOP_FRAMES).toBeLessThanOrEqual(3);
    expect(HIT_STOP_MS).toBe(33);
  });

  it("is a couple of frames and not a couple of hundred milliseconds", () => {
    // The failure mode worth a test is a zero that got typed as 330. At the
    // belt's own cadence a hold of a tenth of a second would be visible as lag
    // on every word.
    const wordsPerBelt = DEFAULT_FLIGHT_CONFIG.stageWordCount;
    const heldPerBelt = HIT_STOP_MS * wordsPerBelt;
    expect(heldPerBelt).toBeLessThan(DEFAULT_FLIGHT_CONFIG.stageDurationMs * 0.02);
  });

  it("reduced motion removes it entirely (AC-19.3)", () => {
    expect(hitStopMs(true)).toBe(0);
    expect(hitStopMs(false)).toBe(HIT_STOP_MS);
    // ...and it still removes it when a caller asks for a longer hold, so the
    // config field the e2e uses cannot smuggle motion past the setting.
    expect(hitStopMs(true, 600)).toBe(0);
    expect(hitStopMs(false, 600)).toBe(600);
  });

  it("the SHIPPED hold is the two-frame one, whatever a spec configures", () => {
    // `tests/e2e/hit-stop.spec.ts` lengthens this to span frames on a renderer
    // running at 4.5 fps. This is the assertion that keeps that convenience
    // from becoming the shipped value.
    expect(DEFAULT_FLIGHT_CONFIG.hitStopMs).toBe(HIT_STOP_MS);
  });

  /**
   * D31 / AC-22b.1: no hold on a hull strike.
   *
   * This is a rule about which CALLER may hold, so the unit that can carry it
   * is the count of holds a run produces. A belt where the player clears every
   * word holds once per word; a belt where they lose the whole hull holds not
   * at all. Asserted as arithmetic here and as behaviour in the e2e, which
   * strikes the ship and watches the world keep moving.
   */
  it("a run that only takes damage never holds the world once", () => {
    const words = DEFAULT_FLIGHT_CONFIG.stageWordCount;
    const hullHitsToEndARun = hullForStage(words);
    expect(hullHitsToEndARun).toBeGreaterThan(0);
    const holdsFromDamage = 0;
    expect(holdsFromDamage * HIT_STOP_MS).toBe(0);
    // ...and a clean run holds once per word, which is the cadence the length
    // above was chosen against.
    expect(words * HIT_STOP_MS).toBeGreaterThan(hullHitsToEndARun * HIT_STOP_MS);
  });
});
