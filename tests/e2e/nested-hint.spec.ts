import { expect, test } from "@playwright/test";
import { bootFlight } from "./support/flightBoot.js";
import type { FlightDebugState } from "../../src/game/scenes/FlightScene.js";

/**
 * UR-148 in a real browser: the first two-layer rock a child sees gets a
 * sentence about it.
 *
 * The unit tests own the rule (`tests/unit/flight/nestedHint.test.ts`); this
 * owns "the scene actually asks", which is the half that caught the canister
 * hint's first reachability gate.
 *
 * NOT SPAWNED BY HAND. `spawnRock` rolls `nestedShareFor(stopId)` itself, so
 * the only honest way to get a two-layer rock is to fly a Neptune belt and wait
 * for one - which also means this measures the rock the GAME produced rather
 * than one a hook forced onto the board.
 */

test.describe("UR-148: the first two-layer rock is explained", () => {
  test("a nested rock on screen at Neptune is warned about, once", async ({ page }) => {
    await bootFlight(page, { debug: true, stopId: "neptune", seed: 11 });

    const seen = await page.evaluate(
      () =>
        new Promise<{
          sawNested: boolean;
          said: boolean;
          frames: number;
          state: FlightDebugState;
        }>((resolve) => {
          let frames = 0;
          let sawNested = false;
          const deadline = performance.now() + 12000;
          const tick = (): void => {
            frames += 1;
            const s = window.__kbFlight?.state() as FlightDebugState;
            if (s.rocks.some((r) => r.shellIntact)) sawNested = true;
            // Stop on the first frame the flag is up, so "once" is measured
            // against the moment it fired rather than against a later board.
            // A WALL-CLOCK deadline, not a frame count. At 900 frames this
            // outran Playwright's 30 s test timeout on a Neptune belt and
            // reported "page.evaluate: Test timeout" - so deleting the
            // `update` hook read as an infrastructure problem rather than as
            // the defect it is.
            if ((sawNested && s.nestedHintSaid) || performance.now() > deadline || s.stalled) {
              resolve({ sawNested, said: s.nestedHintSaid, frames, state: s });
              return;
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
    );

    // ANTI-VACUITY: a belt that never drew a two-layer rock proves nothing
    // about a warning that is only allowed to fire when one is on the board.
    expect(
      seen.sawNested,
      `no two-layer rock appeared in ${seen.frames} frames at Neptune`,
    ).toBe(true);
    // WATCHED FAILING with `this.maybeWarnNested(time);` removed from `update`:
    //   the two-layer rock was never explained: expected false to be true
    expect(seen.said, "the two-layer rock was never explained").toBe(true);

    // ONCE PER RUN: the flag is on the registry, so it outlives the scene. A
    // restart is a new belt and must NOT say it again.
    const afterRestart = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const game = window.__kbGame as unknown as {
            scene: { getScene(key: string): { scene: { restart(d?: unknown): void } } };
          };
          game.scene.getScene("Flight").scene.restart({ stopId: "neptune", debug: true });
          let n = 0;
          const tick = (): void => {
            n += 1;
            if (n >= 10) {
              resolve((window.__kbFlight?.state() as FlightDebugState).nestedHintSaid);
              return;
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
    );
    // WATCHED FAILING with the flag moved to a scene field reset in `init`:
    //   a belt restart forgot that the mechanic had been explained: expected
    //   false to be true
    expect(
      afterRestart,
      "a belt restart forgot that the mechanic had been explained",
    ).toBe(true);
  });
});
