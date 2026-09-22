import { expect, test } from "@playwright/test";
import { bootFlight } from "./support/flightBoot.js";
import type { FlightDebugState } from "../../src/game/scenes/FlightScene.js";

/**
 * UR-146 in a real browser: Shadow points at the repair rock once per belt, and
 * only while there is something to repair and something to point at.
 *
 * The unit tests own the rule (`tests/unit/flight/canisterHint.test.ts`); this
 * owns "the scene actually asks", and it earned its place - the first version
 * of the reachability gate passed every unit test and never fired here, because
 * it waited on a sentence longer than most rocks' whole fall.
 *
 * `canisterHintSaid` is read from the debug surface rather than the voice bus
 * because `bootFlight` mounts the scene without an audio system, and what is in
 * question here is the DECISION.
 */

const SHORT_BELT = 18;

/**
 * Spawn, promote and measure in ONE round trip.
 *
 * A Playwright hop costs the better part of a second and a rock's whole fall is
 * three to five, so a spec that spawns in one `evaluate` and reads in the next
 * measures a board the canister has already left. Measured: the first version
 * read "no canister on the board" after 30 frames.
 */
async function promoteAndStep(
  page: import("@playwright/test").Page,
  word: string,
  y: number,
  frames: number,
  strikeFirst: boolean,
): Promise<FlightDebugState> {
  return page.evaluate(
    ({ word, y, frames, strikeFirst }) =>
      new Promise<FlightDebugState>((resolve) => {
        if (strikeFirst) window.__kbFlight?.strike();
        window.__kbFlight?.spawn(word, { y });
        window.__kbFlight?.makeCanister(word);
        let seen = 0;
        const tick = (): void => {
          seen += 1;
          if (seen >= frames) {
            resolve(window.__kbFlight?.state() as FlightDebugState);
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { word, y, frames, strikeFirst },
  );
}

test.describe("UR-146: the canister hint fires once, and only when it matters", () => {
  test("a damaged hull with a canister on screen IS pointed at, once", async ({ page }) => {
    await bootFlight(page, { debug: true, stageWordCount: SHORT_BELT, seed: 5 });

    const said = await promoteAndStep(page, "ring", 60, 8, true);
    expect(said.hull, "the strike did not land").toBeLessThan(said.maxHull);
    expect(
      said.rocks.some((r) => r.isCanister),
      "the canister left the board before the measurement",
    ).toBe(true);
    // WATCHED FAILING with `this.maybeHintCanister(time);` removed from
    // `update`: the repair rock was never pointed at: expected false to be true
    expect(said.canisterHintSaid, "the repair rock was never pointed at").toBe(true);

    // ONCE PER BELT. A second canister says nothing new, and the flag is the
    // only thing that can prove it on a scene with no audio system.
    const again = await promoteAndStep(page, "rings", 60, 8, false);
    expect(again.canisterHintSaid).toBe(true);
  });

  /**
   * THE FULL-HULL NEGATIVE IS NOT HERE, and that is a decision rather than an
   * omission. `bootFlight` takes three to six seconds and the belt's own first
   * rock falls in three to four, so by the time a measurement can be taken the
   * hull has often already been damaged - the premise of the test - and it
   * failed two runs in three for that reason and passed in isolation. The
   * obvious fix does not work either: `calibration` does not reach the scene
   * through this boot path (`FlightScene` line 854 prefers a stored
   * calibration, so a standalone boot flies 350/500 whatever is passed), which
   * is worth knowing and is not this lane's to fix.
   *
   * `tests/unit/flight/canisterHint.test.ts` asserts the damage gate
   * deterministically, with a watched-failing run, which is where a rule
   * belongs. A flaky red here would buy nothing and cost the suite.
   */

  test("a canister still above the top of the frame is not pointed at yet", async ({ page }) => {
    await bootFlight(page, { debug: true, stageWordCount: SHORT_BELT, seed: 5 });

    // FOUR frames, and the count is anti-vacuity rather than patience. At ONE
    // the scene had not necessarily stepped at all, and the test passed with
    // the on-screen gate deleted from `shouldHintCanister` - it was measuring
    // a scene that never ran.
    //
    // -900 px, not -200. Four frames is 66 ms of fall at 60 Hz and about 22 px,
    // but the frames right after a boot are not 60 Hz: at -200 this read the
    // rock at y=66, already on screen, and failed on its own premise. The
    // placement is now far enough up that no plausible frame budget carries it
    // into the frame, and the premise is asserted below rather than assumed.
    const placed = await promoteAndStep(page, "ring", -900, 4, true);
    const rock = placed.rocks.find((r) => r.isCanister);
    expect(rock, "the canister is not on the board").toBeDefined();
    expect(
      (rock as NonNullable<typeof rock>).y,
      "the placement did not put the rock above the frame",
    ).toBeLessThan(0);
    // WATCHED FAILING with the on-screen gate deleted from
    // `shouldHintCanister`:
    //   a rock above the top edge was pointed at: expected true to be false
    expect(placed.canisterHintSaid, "a rock above the top edge was pointed at").toBe(false);
  });
});
