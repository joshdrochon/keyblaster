import { expect, test, type Page } from "@playwright/test";
import { bootFlight, flightState, spawnAt } from "./support/flightBoot.js";
import { starsForHullHits } from "../../src/engine/scoring/stars.js";

/**
 * WHAT THE STAGE COST, versus WHAT IS LEFT OF THE SHIP (AC-4.4, AC-5.1, D26).
 *
 * THE DEFECT. Stars were `starsForHullHits(maxHull - hull, maxHull)` - computed
 * from the hull REMAINING at the end. A shield canister gives a mark back
 * (AC-5.2), so every canister the child collected erased a hit from the record.
 * A real Mars run reached hull zero twice, collected twenty canisters, finished
 * with the hull full - and was awarded three stars out of three at 63%
 * accuracy, plus the `beltRunner` trophy, whose shipped copy is "cross the main
 * belt without a scratch".
 *
 * The canister is a second chance at SURVIVING, never an eraser. AC-4.4 rates a
 * stage by what it cost (0 hits -> 3 stars, 1 -> 2, 2 -> 1), and a stage that
 * cost the ship a mark cost it a mark whether or not a canister repaired it.
 * `@engine/scoring` was right the whole time; it was being handed the wrong
 * number.
 *
 * WHAT IS ASSERTED IS A RELATION, NOT A TALLY:
 *
 *     hits taken  ==  marks missing from the hull  +  marks repaired
 *
 * The belt runs the whole time these specs are talking to it - rocks fall on the
 * wall clock, and a CDP round trip on a loaded headless box is long enough for
 * one to land. Any absolute count here would drift with machine load, and a test
 * whose verdict depends on how busy the box is measures the box. A breach the
 * spec did not ask for adds one to BOTH sides of that relation and changes
 * nothing, which is exactly the property that makes it worth asserting: under
 * the defect the left side was DEFINED as the right side minus the repairs, so
 * the equation could not hold unless no canister was ever collected.
 *
 * THE BELT IS NOT FROZEN BETWEEN STEPS, and that is deliberate. `scene.pause`
 * stops the scene clock but not the wall clock, so every rock in the air is
 * charged the whole frozen interval the instant the scene resumes, and the board
 * clears itself in one frame. An earlier version of this file did that and
 * measured a canister that repaired nothing - which is precisely the defect
 * under test, arrived at by breaking the harness. A long stage is used instead:
 * `stageWordCount` sets the hull (`@engine/hull`), so 180 words is 30 marks and
 * the scenario has room to run without the ship ever being in danger.
 */

test.describe.configure({ mode: "default", timeout: 180_000 });

/** A stage long enough that its hull (`hullForStage`) cannot run out here. */
const LONG_STAGE = 180;

/**
 * Put a fresh rock at the top of the belt, make it a shield canister, and blast
 * it (AC-5.1, AC-5.2, D26).
 *
 * The rock is spawned rather than borrowed because `makeCanister()` with no
 * argument promotes the OLDEST rock on the belt, which is the one nearest the
 * breach line; racing it measures whichever won, and a lost race looks exactly
 * like a canister that did not repair anything.
 */
async function collectCanister(page: Page, word: string): Promise<void> {
  await spawnAt(page, word, { y: -60 });
  const named = await page.evaluate(
    (w) => window.__kbFlight?.makeCanister(w) ?? null,
    word,
  );
  expect(named, `no live rock named ${word} to promote`).toBe(word);
  // One round trip for the whole word, the way `flight.spec.ts` does it and for
  // the reason its header gives: `page.keyboard.press` costs a round trip per
  // key, a headless software-GL page under load answers those in hundreds of
  // milliseconds, and the canister crosses the breach line mid-word. These
  // events reach exactly the listener a real keystroke reaches - FlightScene
  // binds `window` keydown directly - so the path under test is unchanged.
  await page.evaluate((text) => {
    for (const ch of text as string) {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: ch,
          code: `Key${ch.toUpperCase()}`,
          bubbles: true,
        }),
      );
    }
  }, word);
  await page.waitForFunction(
    (w) => !(window.__kbFlight?.state().rocks ?? []).some((r) => r.word === w),
    word,
    { timeout: 15_000 },
  );
  // The word leaving the belt is not enough to go on: a rock that reaches the
  // breach line also leaves, and the two outcomes are opposites here - one
  // repairs the hull, the other costs a mark. `blasted` is the run record
  // (`flight/blastHistory`, D09), so it answers which one happened.
  const record = await flightState(page);
  expect(record.blasted, `${word} left the belt without being blasted`).toContain(word);
}

test("a collected canister repairs the hull and does not erase the hit", async ({
  page,
}) => {
  await bootFlight(page, { stopId: "mars", seed: 4242, stageWordCount: LONG_STAGE });

  // One rock reaches the ship (`@engine/hull.hullAfterStrike`, the real rule).
  await page.evaluate(() => window.__kbFlight?.strike());
  const struck = await flightState(page);
  expect(struck.hullHits, "the hit was not recorded").toBeGreaterThan(0);
  expect(struck.hull).toBeLessThan(struck.maxHull);

  await collectCanister(page, "quasar");

  const after = await flightState(page);
  const missing = after.maxHull - after.hull;
  expect(
    after.hull,
    "the hull emptied; this scenario is not the one under test",
  ).toBeGreaterThan(0);

  // THE ASSERTION THIS FILE EXISTS FOR. What the stage COST is not what is LEFT
  // of the ship, and one repair is exactly the gap between them.
  expect(after.hullHits, "the canister erased the hit from the record").toBe(missing + 1);
  expect(after.hullHits).toBeGreaterThan(missing);

  // Stated as the rating, because that is where a child meets it. The old
  // reading can only ever be kinder than the truth, never harsher - and on the
  // reported run it was three stars for a stage that emptied the hull twice.
  expect(starsForHullHits(after.hullHits, after.maxHull)).toBeLessThanOrEqual(
    starsForHullHits(missing, after.maxHull),
  );
});

test("every hit taken is counted, including the ones repaired away", async ({ page }) => {
  await bootFlight(page, { stopId: "mars", seed: 99, stageWordCount: LONG_STAGE });

  const opening = await flightState(page);
  for (let i = 0; i < 3; i += 1) {
    await page.evaluate(() => window.__kbFlight?.strike());
  }
  const struck = await flightState(page);
  expect(struck.hullHits).toBeGreaterThanOrEqual(opening.hullHits + 3);

  // Two repairs. The ship recovers; the belt does not become a belt that was
  // never hit. This is the reported run in miniature - hull zero twice, twenty
  // canisters, "without a scratch".
  await collectCanister(page, "quasar");
  await collectCanister(page, "zenith");

  const after = await flightState(page);
  expect(
    after.hull,
    "the hull emptied; this scenario is not the one under test",
  ).toBeGreaterThan(0);
  expect(after.hullHits, "repairs rewrote the stage's history").toBe(
    after.maxHull - after.hull + 2,
  );
  expect(after.hullHits).toBeGreaterThanOrEqual(3);
  expect(after.hullHits).toBeGreaterThan(after.maxHull - after.hull);
});
