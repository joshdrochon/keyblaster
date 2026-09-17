import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bootScene, snap, texts } from "./support/lane";

/**
 * THE WARP SENTENCE, COMPOSED FOR THIS CHILD, IN A REAL BROWSER
 * (D09, E-AI-1; FR-16, AC-12.3, AC-15.1, AC-15.2, AC-15.3).
 *
 * `tests/unit/coach/warpSentenceLive.test.ts` proves the shipped CLIENT accepts
 * a good sentence and refuses a bad one. It cannot prove the scene then puts it
 * on screen, and "the pipeline produced something the running game never asked
 * for" is a bug this repo has already shipped once.
 *
 * So nothing here is injected into the scene. The page runs the real
 * `ProxyCoach` against a real `fetch` to `/api/coach` (`?coach=proxy` plus a
 * same-origin `coachEndpoint`, the seam `game/coach/transport.ts` documents),
 * and Playwright answers that request the way a deployed endpoint would. The
 * gates, the scene, the re-layout and the marker are all the shipped ones.
 *
 * THE MARKER IS THE POINT OF THE LAST TWO TESTS. A fallback that is
 * indistinguishable from the real thing makes an "AI-powered" demo
 * unfalsifiable, so the claim tested here is BOTH directions: the marker is
 * present exactly when a model wrote the sentence, and absent every other time.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EVIDENCE = join(REPO, "gauntlet", "evidence");

function writeEvidence(name: string, body: string | Buffer): void {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, name), body);
}

/** Mars' shipped warp sentence, from src/content/en/mars.json. The fallback. */
const SHIPPED = "Mars is the red planet.";

/** Composed from a run that missed "rivers" and "empty". Passes all six gates. */
const COMPOSED = "The rivers on mars are empty dust.";

const NOTE = "Good run. Let us take rivers and empty a little slower.";
const VARIANTS = ["Mars is the red planet.", "The dust is cold and dry."];

type Composed = {
  live: boolean;
  marker: string;
  text: string | null;
  reused: string[];
  outcome: { ok: boolean; reason?: string } | null;
  refused: string | null;
  shipped: string;
};

type WarpSnapshot = {
  sentence: string;
  composed: Composed;
  coach: { transport: string | null; source: string | null; settled: boolean };
};

/** The run the scene is handed: two words got past the pilot, four went down. */
const RUN = {
  stopId: "mars",
  missed: ["rivers", "empty"],
  slow: ["across"],
  hitRate: 0.85,
  blastHistory: {
    blasts: ["mars", "red", "dust", "rust"].map((word, order) => ({
      word,
      order,
      atMs: order * 1000,
      fkLatencyMs: 400,
      ikiMs: [200, 200],
      wasCanister: false,
    })),
    misses: [
      { word: "rivers", atMs: 5000 },
      { word: "empty", atMs: 6000 },
    ],
  },
};

/**
 * Boot the warp break on the PRODUCTION transport, with `/api/coach` answered
 * by `reply`. `respond: null` makes the request fail outright, which is the
 * offline case.
 */
async function openComposedWarp(
  page: Page,
  reply: Record<string, unknown> | null,
): Promise<void> {
  // A PREDICATE, NOT A GLOB. The page URL itself ends in "/api/coach" (it
  // carries `coachEndpoint=/api/coach`), so a `**/api/coach` glob aborts the
  // navigation as well as the POST and every test dies before it boots.
  await page.route((url) => url.pathname === "/api/coach", async (route) => {
    if (reply === null) {
      await route.abort("failed");
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(reply),
    });
  });

  await bootScene(page, "Warp", "warp", "&coach=proxy&coachEndpoint=/api/coach");
  await page.evaluate((run) => {
    const game = (window as unknown as { __kb: Record<string, unknown> }).__kb[
      "game"
    ] as { scene: { getScene(k: string): { scene: { restart(d: unknown): void } } } };
    game.scene.getScene("Warp").scene.restart(run);
  }, RUN);

  await waitForRun(page);
}

/**
 * Wait for THE RESTARTED break to have settled, not the boot before it.
 *
 * `scene.restart()` is deferred to the next scene step, so a poll on
 * `coach.settled` alone can be answered by the BOOT's own coach call - which
 * carried no run, therefore no compose block, therefore no sentence. That race
 * reported `absent` for a sentence the gates had never been shown, which reads
 * exactly like the feature being off. Waiting on the run's own words first
 * pins the snapshot to the restarted scene.
 */
async function waitForRun(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const w = (window as unknown as { __kb: Record<string, unknown> }).__kb["warp"] as {
      snapshot: () => { missedWords: string[]; coach: { settled: boolean } };
    };
    const s = w.snapshot();
    return s.missedWords.length === 2 && s.coach.settled;
  });
}

// ---------------------------------------------------------------------------

test("D09 the child types a sentence composed from the words THEY just practised", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openComposedWarp(page, { note: NOTE, variants: VARIANTS, sentence: COMPOSED });

  const s = await snap<WarpSnapshot>(page, "warp");

  // The transport really is the production one. If this reads "mock" the rest
  // of this file is about a canned template.
  expect(s.coach.transport).toBe("proxy");

  // THE FOUNDING DEFECT, FIXED. Decision log line 18: Type Storm's end-of-level
  // sentence does not reuse the words just typed. This one does, and it is not
  // the string that ships in mars.json.
  expect(s.sentence).toBe(COMPOSED);
  expect(s.sentence).not.toBe(SHIPPED);
  expect(s.composed.shipped).toBe(SHIPPED);
  expect(s.composed.reused).toEqual(expect.arrayContaining(["rivers", "empty"]));

  // It is really on the screen, not just in the state: one Text per character.
  const drawn = await texts(page, "warp");
  expect(drawn.join("")).toContain("rivers");

  writeEvidence(
    "warp-composed-live.json",
    `${JSON.stringify({ sentence: s.sentence, composed: s.composed }, null, 2)}\n`,
  );
});

test("E-AI-1 the marker is shown, and it says a model wrote this one", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openComposedWarp(page, { note: NOTE, variants: VARIANTS, sentence: COMPOSED });

  const s = await snap<WarpSnapshot>(page, "warp");
  expect(s.composed.live).toBe(true);
  expect(s.composed.marker.length).toBeGreaterThan(0);
  expect(await texts(page, "warp")).toContain(s.composed.marker);

  writeEvidence("warp-composed-marker.png", await page.screenshot());
});

test("AC-16.3 the composed sentence is a real warp sentence: typing it charges the drive", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openComposedWarp(page, { note: NOTE, variants: VARIANTS, sentence: COMPOSED });

  // The point of the feature is that the child TYPES it. Re-laying out the
  // panel rebuilds one Text per character and resets the meter, so this is the
  // test that the swap left a working screen rather than a nice-looking one.
  for (const ch of COMPOSED) {
    await page.keyboard.press(ch === " " ? "Space" : ch);
  }

  const s = await snap<WarpSnapshot & { chargePercent: number; charged: boolean }>(
    page,
    "warp",
  );
  expect(s.chargePercent).toBe(100);
  expect(s.charged).toBe(true);
});

test("AC-15.2 a generated sentence that fails a gate falls back to the shipped one", async ({
  page,
}) => {
  test.setTimeout(90_000);
  // Well-formed JSON, 200, a perfectly readable sentence - and "sand" is not on
  // the allowlist. The child types the shipped string and there is no marker.
  await openComposedWarp(page, {
    note: NOTE,
    variants: VARIANTS,
    sentence: "The rivers on mars are sand and dust.",
  });

  const s = await snap<WarpSnapshot>(page, "warp");
  expect(s.sentence).toBe(SHIPPED);
  expect(s.composed.live).toBe(false);
  expect(s.composed.marker).toBe("");
  expect(s.composed.outcome).toEqual({ ok: false, reason: "allowlist" });
});

test("AC-15.1 an endpoint that is down leaves the shipped sentence and no marker", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openComposedWarp(page, null);

  const s = await snap<WarpSnapshot>(page, "warp");
  // The whole warp beat is intact: a sentence to type, a note from Shadow.
  expect(s.sentence).toBe(SHIPPED);
  expect(s.coach.source).toBe("fallback");
  // And the screen makes no claim it cannot support.
  expect(s.composed.live).toBe(false);
  expect(s.composed.marker).toBe("");

  writeEvidence("warp-composed-offline.png", await page.screenshot());
});

test("E-AI-1 the DEFAULT build shows no marker, because nothing wrote the sentence", async ({
  page,
}) => {
  test.setTimeout(90_000);
  // No `?coach=proxy`, no endpoint: `chooseTransport` gives MockCoach, which is
  // what an undeployed build and the whole gauntlet run on (D87). A marker here
  // would be the exact dishonesty this feature was asked to avoid.
  await bootScene(page, "Warp", "warp");
  await page.evaluate((run) => {
    const game = (window as unknown as { __kb: Record<string, unknown> }).__kb[
      "game"
    ] as { scene: { getScene(k: string): { scene: { restart(d: unknown): void } } } };
    game.scene.getScene("Warp").scene.restart(run);
  }, RUN);
  await waitForRun(page);

  const s = await snap<WarpSnapshot>(page, "warp");
  expect(s.coach.transport).toBe("mock");
  expect(s.sentence).toBe(SHIPPED);
  expect(s.composed.live).toBe(false);
  expect(s.composed.marker).toBe("");
});
