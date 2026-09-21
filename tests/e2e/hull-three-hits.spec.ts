import { expect, test } from "@playwright/test";
import {
  bootFlight,
  flightState,
  waitFrames,
} from "./support/flightBoot.js";

/**
 * THREE HITS, IN A REAL BROWSER, ON THE SHIPPED SCENE.
 *
 * ================== WHY THIS SPEC EXISTS ==================
 * The project owner asked for the hull to go back to three hits at a 58-word
 * belt, on the grounds that "we have the repair rocks so should be fine". The
 * arithmetic behind that decision is measured in
 * `tests/unit/simulation/hullThreeHits.test.ts`, and it says the repair rocks
 * do NOT cover it. But a simulation is not a game, and this project has been
 * caught twice shipping a green harness over a scene that behaved differently.
 * So the two halves of the owner's sentence are checked HERE, on a real canvas,
 * with real keystrokes:
 *
 *   1. three hits really does end a belt
 *   2. a canister really does give a mark back
 *
 * ================== NO PATCH IS NEEDED TO FLY A 3-HULL BELT ==================
 * `hullForStage` is `ceil(spawnCount / 10)` with a floor of `MIN_HULL`, so
 * an EIGHTEEN-WORD belt already carries exactly three marks - that is D27
 * verbatim, and it is the belt this spec boots. Nothing about the hull rule is
 * modified to run this: the three-hit hull is a shipped configuration, reached
 * by choosing a stage length rather than by a test hook. Which is also why the
 * measurement is trustworthy - the 58-word question is the SAME rule with a
 * different `spawnCount`.
 */

const SHORT_BELT = 18;

/**
 * A pilot the game believes is very slow, so the belt cannot damage itself
 * while the spec is measuring.
 *
 * WATCHED FAILING WITHOUT IT. On the shipped calibration the first test read
 * `[2, 0, 0]` from three strikes and the second read a hull of 2 after a
 * repair: the belt holds one rock, that rock reaches the breach line inside the
 * few seconds these tests take, and its hull mark landed in the middle of the
 * measurement. Both failures looked like the hull rule being wrong and were the
 * belt doing its job.
 *
 * FR-8 scales fall time by the believed inter-key interval and calibration may
 * only ever LENGTHEN a fall (`fallTimeIkiMs`), so this is a shipped
 * configuration - the game a child with very slow hands is given - and not a
 * test hook that suspends the rules being measured.
 */
const UNHURRIED = { ikiMs: 2400, fkLatencyMs: 2000 };

test.describe("D27 at its own stage length: three hits, and one repair", () => {
  test("three hull hits end an 18-word belt, and the marks and lamp move on each one", async ({
    page,
  }) => {
    await bootFlight(page, {
      debug: true,
      stageWordCount: SHORT_BELT,
      seed: 7,
      calibration: UNHURRIED,
    });
    /**
     * PAUSED AND READ IN ONE ROUND TRIP.
     *
     * The world is held still for the whole measurement: `strike()` is a direct
     * call on the scene, so it needs no `update`, and with `update` stopped no
     * rock of the belt's own can resolve between two of the three hits being
     * counted. NOTE that the pause stops the FRAME, not the CLOCK - see the
     * canister test below, which cannot use this and says why.
     *
     * The pause and the opening read are one `page.evaluate` because a
     * Playwright round trip between them is a window the belt can land a rock
     * in. Measured: on a loaded machine the sibling test lost exactly that race
     * and read a hull of 1 where it expected 2.
     */
    const opening = await page.evaluate(() => {
      const game = window.__kbGame as unknown as {
        scene: { getScene(key: string): { scene: { pause(): void } } };
      };
      game.scene.getScene("Flight").scene.pause();
      return window.__kbFlight?.state() ?? null;
    });
    expect(opening, "the flight debug api was not on the page").not.toBeNull();
    // ANTI-VACUITY. A belt that opened on nine marks would end after nine
    // strikes and this spec would still be green, having measured nothing about
    // three.
    const open = opening as NonNullable<typeof opening>;
    expect(
      open.maxHull,
      `an ${SHORT_BELT}-word belt opened on ${open.maxHull} marks, not the 3 D27 writes`,
    ).toBe(3);
    expect(
      open.hull,
      `the belt had already taken ${3 - open.hull} of its 3 marks before the measurement began`,
    ).toBe(3);
    expect(open.stalled, "the belt was already over before a single hit").toBe(false);

    const hullAfter: number[] = [];
    const stalledAfter: boolean[] = [];
    for (let hit = 1; hit <= 3; hit += 1) {
      await page.evaluate(() => window.__kbFlight?.strike());
      const now = await flightState(page);
      hullAfter.push(now.hull);
      stalledAfter.push(now.stalled);
    }

    // ONE WHOLE MARK PER HIT. This is the property the owner is asking for and
    // the one the 58-word belt does not currently have: there, nine hits share
    // three marks and one hit moves a mark by a third.
    expect(
      hullAfter,
      `three strikes on a 3-mark hull left ${JSON.stringify(hullAfter)}`,
    ).toEqual([2, 1, 0]);

    // AND THE THIRD ONE ENDS IT. `isStalled` is `!(hull > 0)`, and D29's stall
    // is what "the belt ended" means on screen.
    expect(
      stalledAfter,
      `the belt stalled at ${JSON.stringify(stalledAfter)} - the third hit must be the one that ends it, and neither of the first two may`,
    ).toEqual([false, false, true]);
  });

  test("AC-5.2: blasting a shield canister gives a whole mark back on a 3-mark hull", async ({
    page,
  }) => {
    await bootFlight(page, {
      debug: true,
      stageWordCount: SHORT_BELT,
      seed: 11,
      calibration: UNHURRIED,
    });
    expect((await flightState(page)).maxHull).toBe(3);

    /**
     * ============ EVERY STEP IN ONE ROUND TRIP, AND THE BELT NEVER PAUSED ===
     *
     * Two earlier shapes of this test were wrong and both failed loudly, which
     * is why they are written down rather than deleted:
     *
     *   LIVE, WITH ROUND TRIPS  - `hullHits` 1 -> 2. The belt holds a rock and
     *     it breached in the seconds the Playwright round trips took, so the
     *     hull afterwards was a repair MINUS an unrelated strike.
     *
     *   PAUSED  - `hullHits` 1 -> 3, worse. `scene.pause()` stops `update`, it
     *     does NOT stop the clock a rock's deadline is measured against, so the
     *     paused rocks all came due at once the moment the scene resumed. A
     *     frozen belt is not a still belt, and that is worth knowing anywhere
     *     in this suite.
     *
     * So the damage, the placement, the promotion and the keystrokes all happen
     * inside ONE `page.evaluate`, synchronously, with the game running
     * normally: `strike`, `spawn` and `makeCanister` are direct calls and the
     * keydown handler resolves the blast in-line. There is no window for the
     * belt to land anything of its own, and nothing about the rules is
     * suspended to get that.
     */
    const word = "shield";
    const inline = await page.evaluate((w: string) => {
      const api = window.__kbFlight;
      if (api === undefined) return null;
      // AC-5.1 refuses a canister over a full hull, so a spec that promoted a
      // rock without taking a hit would measure a repair the game never hands
      // out. One whole mark, at a 3-mark hull.
      const before = api.state();
      api.strike();
      const damaged = api.state();
      api.spawn(w, { x: 960, y: 200, spinPerSec: 0.1 });
      const promoted = api.makeCanister(w);
      const armed = api.state();
      const press = (ch: string): void => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: ch, code: `Key${ch.toUpperCase()}`, bubbles: true }),
        );
      };
      for (const ch of w) press(ch);
      return {
        promoted,
        maxHull: damaged.maxHull,
        beforeHull: before.hull,
        damagedHull: damaged.hull,
        damagedStalled: damaged.stalled,
        damagedHits: damaged.hullHits,
        wasCanister: armed.rocks.find((r) => r.word === w)?.isCanister ?? false,
      };
    }, word);

    expect(inline, "the flight debug api was not on the page").not.toBeNull();
    const armed = inline as NonNullable<typeof inline>;
    /**
     * DELTAS, NOT ABSOLUTES, AND THAT IS NOT A WEAKENING.
     *
     * The first version asserted `damagedHull === 2`, i.e. that the belt was
     * still on a full hull when the measurement began. On a loaded machine it
     * read 1: an ordinary rock had breached in the ~200 ms between `bootFlight`
     * resolving and the evaluate running, so the hull was already at 2 and one
     * strike took it to 1. The RULE was right and the PRECONDITION was not.
     *
     * So the claims below are made about what one strike and one canister DO,
     * which is what AC-4.2 and AC-5.2 actually say, and they hold from any
     * starting hull. Nothing is loosened: a strike must still cost exactly one
     * whole mark and a canister must still give back at least one whole mark,
     * and at a 3-mark hull that is a third of the ship either way.
     */
    expect(
      armed.maxHull,
      `an ${SHORT_BELT}-word belt opened on ${armed.maxHull} marks, not the 3 D27 writes`,
    ).toBe(3);
    expect(
      armed.damagedHull,
      `one strike took ${armed.beforeHull - armed.damagedHull} marks, not the whole one AC-4.2 writes`,
    ).toBe(armed.beforeHull - 1);
    expect(armed.damagedStalled, "the strike ended the belt, so there is nothing left to repair").toBe(
      false,
    );
    expect(
      armed.damagedHull,
      `the hull was at ${armed.damagedHull} of ${armed.maxHull} before the canister, so a whole mark back cannot be measured against the cap`,
    ).toBeLessThanOrEqual(armed.maxHull - 1);
    expect(armed.promoted, `the placed rock "${word}" was not promoted to a canister`).toBe(word);
    expect(
      armed.wasCanister,
      "the scene does not think the placed rock is a canister, so nothing below measures a repair",
    ).toBe(true);

    // The resolved rock is swept out of the live list in `update`, so the blast
    // needs frames to become visible - not time for anything else to happen.
    await waitFrames(page, 3);
    const repaired = await flightState(page);
    expect(
      repaired.rocks.some((r) => r.word === word),
      "the canister is still on the belt, so it was never blasted and nothing below measures a repair",
    ).toBe(false);
    // THE INTERFERENCE GUARD, checked BEFORE the repair. `hullHits` counts
    // marks TAKEN and a canister never takes one back, so an increase here
    // means an ordinary rock breached and the hull below is two events.
    expect(
      repaired.hullHits,
      "another rock breached while the canister was being typed (or the canister erased the hit from the stage record) - the hull below would be a reading of two events",
    ).toBe(armed.damagedHits);
    // A WHOLE MARK, which at a 3-mark hull is a third of the ship. `hullHits`
    // must NOT forget the hit that was taken - the results screen reads it, and
    // a canister is a second chance, never an eraser.
    // A WHOLE MARK BACK - which at a 3-mark hull is a THIRD OF THE SHIP, and is
    // the entire content of the owner's "we have the repair rocks" premise.
    const given = repaired.hull - armed.damagedHull;
    expect(
      given,
      `the canister gave back ${given} marks, not the whole one AC-5.2 writes (${armed.damagedHull} -> ${repaired.hull} of ${armed.maxHull})`,
    ).toBeGreaterThanOrEqual(1);
    expect(
      repaired.hull,
      `the canister took the hull to ${repaired.hull}, past the stage's ${armed.maxHull} marks`,
    ).toBeLessThanOrEqual(armed.maxHull);
    expect(
      given / armed.maxHull,
      `one canister is worth ${((given / armed.maxHull) * 100).toFixed(0)}% of a 3-mark hull`,
    ).toBeGreaterThanOrEqual(1 / 3);
  });
});
