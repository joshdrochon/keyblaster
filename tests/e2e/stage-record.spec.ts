import { expect, test, type Page } from "@playwright/test";
import { bootFlight, flightState, freezeFlight, spawnAt } from "./support/flightBoot.js";
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
 * Rocks fall on the wall clock and the belt keeps running while a word is being
 * typed, so any absolute count here would drift with machine load - and a test
 * whose verdict depends on how busy the box is measures the box. A breach the
 * spec did not ask for adds one to BOTH sides of that relation and changes
 * nothing, which is exactly the property that makes it worth asserting: under
 * the defect the left side was defined as the right side minus the repairs, so
 * the equation could not hold unless no canister was ever collected.
 */

test.describe.configure({ mode: "default", timeout: 180_000 });

/**
 * Put a fresh rock at the top of the belt, make it a shield canister, and blast
 * it (AC-5.1, AC-5.2, D26).
 *
 * THE BELT IS RESUMED FIRST, AND THE ROCK IS SPAWNED AFTER. Both matter.
 *
 * A rock is spawned with the scene clock's reading and falls against it, but
 * the scene clock does not advance while the scene is paused - so a rock
 * spawned during a freeze is stamped with the moment the freeze began, and on
 * resume the whole frozen interval is charged to its fall. Several CDP round
 * trips is several seconds, and the rock is past the breach line on the first
 * frame. It reads as a canister that repaired nothing, which is precisely the
 * defect under test, so getting this wrong would have produced a red that
 * looked like a finding.
 *
 * The rock is spawned rather than borrowed for a related reason:
 * `makeCanister()` with no argument promotes the OLDEST rock on the belt, which
 * is the one nearest the breach line, and racing it measures whichever won.
 */
async function collectCanister(page: Page, word: string): Promise<void> {
  await freezeFlight(page, false);
  await spawnAt(page, word, { y: -60 });
  const named = await page.evaluate(
    (w) => window.__kbFlight?.makeCanister(w) ?? null,
    word,
  );
  expect(named, `no live rock named ${word} to promote`).toBe(word);
  await page.keyboard.type(word, { delay: 30 });
  await page.waitForFunction(
    (w) => !(window.__kbFlight?.state().rocks ?? []).some((r) => r.word === w),
    word,
    { timeout: 15_000 },
  );
  await freezeFlight(page, true);
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
  await bootFlight(page, { stopId: "mars", seed: 4242 });
  await freezeFlight(page, true);

  const opening = await flightState(page);
  expect(opening.hullHits, "a fresh belt has taken no hits").toBe(0);
  expect(opening.hull).toBe(opening.maxHull);

  // One rock reaches the ship (`@engine/hull.hullAfterStrike`, the real rule).
  await page.evaluate(() => window.__kbFlight?.strike());
  const struck = await flightState(page);
  expect(struck.hull).toBe(struck.maxHull - 1);
  expect(struck.hullHits, "the hit was not recorded").toBe(1);

  await collectCanister(page, "quasar");

  const after = await flightState(page);
  const missing = after.maxHull - after.hull;
  // The canister did its job: a mark came back.
  expect(after.hull, "the canister gave no hull mark back").toBeGreaterThan(
    struck.maxHull - after.hullHits,
  );

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
  await bootFlight(page, { stopId: "mars", seed: 99 });
  await freezeFlight(page, true);

  for (let i = 0; i < 3; i += 1) {
    await page.evaluate(() => window.__kbFlight?.strike());
  }
  const before = await flightState(page);
  expect(before.hullHits).toBe(3);
  expect(before.hull).toBe(before.maxHull - 3);

  // Two repairs. The ship recovers; the belt does not become a belt that was
  // never hit. This is the reported run in miniature - hull zero twice, twenty
  // canisters, "without a scratch".
  await collectCanister(page, "quasar");
  await collectCanister(page, "zenith");

  const after = await flightState(page);
  expect(after.hullHits, "repairs rewrote the stage's history").toBe(
    after.maxHull - after.hull + 2,
  );
  expect(after.hullHits).toBeGreaterThanOrEqual(3);
  // A three-star stage is one that cost nothing. This one cost at least three
  // marks, and no amount of repairing may make it flawless.
  expect(starsForHullHits(after.hullHits, after.maxHull)).toBeLessThan(3);
});
