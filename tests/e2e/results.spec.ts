import { expect, test, type Page } from "@playwright/test";
import {
  bootScene,
  inks,
  PUNISHING_WORDS,
  readsAsRed,
  restartScene,
  snap,
  texts,
  waitForTweens,
  waitForSnapshot,
} from "./support/lane";

/**
 * RESULTS e2e - screen 9 of the screen inventory.
 *
 * Covers AC-20.1 (WPM / accuracy and the delta vs the previous stage, including
 * the D57 case where Mars correctly has none), AC-20.2 (per-word
 * faster-than-before markers), AC-20.3 (the retention line), AC-20.4 (stars),
 * D43 (personal best and the opt-in relative board with no global rank), D74
 * and AC-22b.1 (informational, never a scoreboard shame moment), and AC-18.1.
 *
 * Every fixture is built in the page and handed to the scene, so the assertions
 * are about what the screen DOES with a stage result rather than about the
 * arithmetic, which `tests/unit/scoring` already owns.
 */

const STOPS = ["earth", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"];

interface ProgressSeed {
  stopId: string;
  cleared?: boolean;
  lastWpm?: number;
  lastAccuracy?: number;
  bestWpm?: number;
}

interface Seed {
  stopId: string;
  progress: ProgressSeed[];
  tally: {
    characters: number;
    elapsedMs: number;
    hits: number;
    typos: number;
    hullHits: number;
  };
  exposures: {
    word: string;
    fkLatencyMs: number[];
    hit: boolean;
    retention: boolean;
    priorSamples?: number[];
    firstFkLatencyMs?: number | null;
  }[];
  /**
   * A PROFILE SAVED BEFORE UR-102. `settings.relativeBoard` is still persisted
   * and still decoded - removing a field from a stored profile is the only part
   * of that removal that could damage a child's save - so a pilot who opted
   * into the nearby-pilots board before it was cut still has `true` on disk.
   * The test below is what that is for: it must change nothing on screen.
   */
  relativeBoardOptedIn?: boolean;
}

type ResultsSnapshot = {
  stopId: string;
  accent: string;
  wpm: number;
  accuracy: number;
  wpmDelta: number | null;
  accuracyDelta: number | null;
  previousStopId: string | null;
  stars: number;
  starsRendered: boolean;
  fasterWords: string[];
  slowerWords: string[];
  retention: {
    wordCount: number;
    hitRate: number | null;
    meanLatencyDeltaMs: number | null;
  };
  isNewBest: boolean;
  bestWpm: number;
  rendered: string[];
  panels: { report: { x: number; y: number; w: number; h: number } | null };
  focusIndex: number;
  focusId: string | null;
  focusIds: string[];
};

/** Boot Results, then restart it with a built stage result. */
async function seed(page: Page, fixture: Seed): Promise<void> {
  await bootScene(page, "Results", "results", `&stop=${fixture.stopId}`);

  const seeded = new Map(fixture.progress.map((p) => [p.stopId, p]));
  const progress = STOPS.map((stopId) => {
    const p = seeded.get(stopId);
    return {
      stopId,
      cleared: p?.cleared ?? false,
      stars: 0,
      bestWpm: p?.bestWpm ?? 0,
      bestAccuracy: 0,
      lastWpm: p?.lastWpm ?? 0,
      lastAccuracy: p?.lastAccuracy ?? 0,
      beaconPlacedAt: p?.cleared === true ? 1 : null,
    };
  });

  const record = (samples: number[], first: number | null) => ({
    exposures: samples.length,
    hits: samples.length,
    misses: 0,
    typos: 0,
    fkLatencyMs: samples,
    ikiMs: [],
    firstFkLatencyMs: first,
    ease: 1,
    lastSeen: 1,
    nextEligibleStage: 0,
  });

  const exposures = fixture.exposures.map((e) => ({
    word: e.word,
    fkLatencyMs: e.fkLatencyMs,
    hit: e.hit,
    retention: e.retention,
    prior:
      e.priorSamples === undefined
        ? null
        : record(e.priorSamples, e.firstFkLatencyMs ?? e.priorSamples[0] ?? null),
  }));

  const profile = {
    id: "pilot-test",
    name: "Ada",
    avatar: "avatar-1",
    shipId: "ship-1",
    shipName: "Lantern",
    createdAt: 1,
    calibration: { ikiMs: 350, fkLatencyMs: 500 },
    settings: {
      musicVolume: 0.7,
      sfxVolume: 0.8,
      keyboardLayout: "qwerty",
      uiLang: "en",
      contentLang: "en",
      inputMethod: "latin",
      uppercase: false,
      increasedLetterSpacing: false,
      reducedMotion: false,
      colorblindPalette: false,
      relativeBoard: fixture.relativeBoardOptedIn ?? false,
    },
    progress,
    trophies: [],
    unlockedShips: ["ship-1"],
    unlockedSkins: [],
    words: {},
  };

  await restartScene(page, "Results", {
    stopId: fixture.stopId,
    tally: fixture.tally,
    exposures,
    profile,
    progress,
  });
  // The entrance tweens have to finish before `texts()` can be trusted: a
  // marker still fading in is below the visibility floor and would read as
  // absent, which is exactly what several of these tests assert about.
  await waitForSnapshot(page, "results", "stopId", fixture.stopId);
  await waitForTweens(page, "Results");
}

const CLEAN_TALLY = {
  characters: 400,
  elapsedMs: 60_000,
  hits: 40,
  typos: 2,
  hullHits: 1,
};

// ---------------------------------------------------------------------------

test("AC-20.1 / D57 Mars shows NO delta, because Earth is not a previous stage", async ({
  page,
}) => {
  await seed(page, {
    stopId: "mars",
    // Earth is cleared and carries figures. It is still not a previous stage:
    // it has no belt, so a delta against it would be invented.
    progress: [{ stopId: "earth", cleared: true, lastWpm: 42, lastAccuracy: 0.9 }],
    tally: CLEAN_TALLY,
    exposures: [],
  });

  const s = await snap<ResultsSnapshot>(page, "results");
  expect(s.wpm).toBeCloseTo(80, 6);
  expect(s.previousStopId).toBeNull();
  expect(s.wpmDelta).toBeNull();
  expect(s.accuracyDelta).toBeNull();

  // Absence, not a zero: no delta element is drawn at all.
  expect(s.rendered).toContain("wpm");
  expect(s.rendered).not.toContain("wpm-delta");
  expect(s.rendered).not.toContain("accuracy-delta");

  const seen = (await texts(page, "results")).join(" ").toLowerCase();
  expect(seen).not.toContain("earth");
  expect(seen).not.toContain("+0");
});

test("AC-20.1 a later stage shows the delta against the previous BELT stage", async ({
  page,
}) => {
  await seed(page, {
    stopId: "jupiter",
    progress: [
      { stopId: "earth", cleared: true, lastWpm: 99, lastAccuracy: 0.99 },
      { stopId: "mars", cleared: true, lastWpm: 30, lastAccuracy: 0.8, bestWpm: 30 },
    ],
    tally: CLEAN_TALLY,
    exposures: [],
  });

  const s = await snap<ResultsSnapshot>(page, "results");
  expect(s.previousStopId).toBe("mars");
  expect(s.wpmDelta).toBeCloseTo(50, 6);
  expect(s.rendered).toContain("wpm-delta");

  const seen = (await texts(page, "results")).join(" ").toLowerCase();
  expect(seen).toContain("mars");
  expect(seen).toContain("50");
});

test("AC-20.1 a slower stage is reported plainly and never in a warning colour", async ({
  page,
}) => {
  await seed(page, {
    stopId: "jupiter",
    progress: [{ stopId: "mars", cleared: true, lastWpm: 100, lastAccuracy: 0.95 }],
    tally: CLEAN_TALLY,
    exposures: [],
  });

  const s = await snap<ResultsSnapshot>(page, "results");
  expect(s.wpmDelta).toBeLessThan(0);
  for (const ink of await inks(page, "results")) {
    expect(readsAsRed(ink.color, s.accent), `"${ink.text}" in ${ink.color}`).toBe(false);
  }
});

test("AC-20.2 only the words that got faster are marked; slower words say nothing", async ({
  page,
}) => {
  await seed(page, {
    stopId: "jupiter",
    progress: [{ stopId: "mars", cleared: true, lastWpm: 40, lastAccuracy: 0.9 }],
    tally: CLEAN_TALLY,
    exposures: [
      // 1000 ms -> 400 ms is a 60% improvement, well past the 15% threshold.
      { word: "rivers", fkLatencyMs: [400], hit: true, retention: false, priorSamples: [1000] },
      // 1000 ms -> 1200 ms is slower. It must produce NO marker at all.
      { word: "empty", fkLatencyMs: [1200], hit: true, retention: false, priorSamples: [1000] },
      // First ever exposure: nothing to have improved on.
      { word: "storm", fkLatencyMs: [700], hit: true, retention: false },
    ],
  });

  const s = await snap<ResultsSnapshot>(page, "results");
  expect(s.fasterWords).toEqual(["rivers"]);
  expect(s.slowerWords).toContain("empty");
  expect(s.rendered).toContain("faster:rivers");
  expect(s.rendered).not.toContain("faster:empty");
  expect(s.rendered).not.toContain("faster:storm");

  const seen = await texts(page, "results");
  expect(seen).toContain("rivers");
  expect(seen).not.toContain("empty");
  expect(seen).not.toContain("storm");
});

test("AC-20.3 the retention line reports the words from earlier stops", async ({ page }) => {
  await seed(page, {
    stopId: "jupiter",
    progress: [{ stopId: "mars", cleared: true, lastWpm: 40, lastAccuracy: 0.9 }],
    tally: CLEAN_TALLY,
    exposures: [
      {
        word: "rust",
        fkLatencyMs: [500],
        hit: true,
        retention: true,
        priorSamples: [520, 510],
        firstFkLatencyMs: 2000,
      },
      {
        word: "dust",
        fkLatencyMs: [600],
        hit: true,
        retention: true,
        priorSamples: [610, 600],
        firstFkLatencyMs: 2000,
      },
    ],
  });

  const s = await snap<ResultsSnapshot>(page, "results");
  expect(s.retention.wordCount).toBe(2);
  expect(s.retention.hitRate).toBe(1);
  // Measured against the FIRST EVER exposure, not the rolling window.
  expect(s.retention.meanLatencyDeltaMs).toBeCloseTo(-1450, 6);
  expect(s.rendered).toContain("retention");

  const seen = (await texts(page, "results")).join(" ");
  expect(seen).toContain("1450");
  expect(seen).toContain("100%");
});

test("AC-20.3 with no retention words the line is absent, not zeroed", async ({ page }) => {
  await seed(page, {
    stopId: "mars",
    progress: [],
    tally: CLEAN_TALLY,
    exposures: [{ word: "dust", fkLatencyMs: [500], hit: true, retention: false }],
  });
  const s = await snap<ResultsSnapshot>(page, "results");
  expect(s.retention.wordCount).toBe(0);
  expect(s.rendered).not.toContain("retention");
});

test("AC-20.4 stars come from hull hits, and a stall renders no rating at all", async ({
  page,
}) => {
  await seed(page, {
    stopId: "mars",
    progress: [],
    tally: { ...CLEAN_TALLY, hullHits: 1 },
    exposures: [],
  });
  const clean = await snap<ResultsSnapshot>(page, "results");
  expect(clean.stars).toBe(2);
  expect(clean.starsRendered).toBe(true);
  expect(clean.rendered).toContain("stars");

  // Three hits is a stall (D29): the stage was never cleared, so there is no
  // rating to show and a 0 must not be drawn as if it were one.
  await seed(page, {
    stopId: "mars",
    progress: [],
    tally: { ...CLEAN_TALLY, hullHits: 3 },
    exposures: [],
  });
  const stalled = await snap<ResultsSnapshot>(page, "results");
  expect(stalled.stars).toBe(0);
  expect(stalled.starsRendered).toBe(false);
  expect(stalled.rendered).not.toContain("stars");
});

test("D43 personal best for this stop is shown, and beating it is said plainly", async ({
  page,
}) => {
  await seed(page, {
    stopId: "mars",
    progress: [{ stopId: "mars", cleared: true, bestWpm: 120, lastWpm: 120 }],
    tally: CLEAN_TALLY,
    exposures: [],
  });
  const holding = await snap<ResultsSnapshot>(page, "results");
  expect(holding.isNewBest).toBe(false);
  expect(holding.bestWpm).toBe(120);
  expect(holding.rendered).toContain("personal-best");
  expect((await texts(page, "results")).join(" ")).toContain("120");

  await seed(page, {
    stopId: "mars",
    progress: [{ stopId: "mars", cleared: true, bestWpm: 10, lastWpm: 10 }],
    tally: CLEAN_TALLY,
    exposures: [],
  });
  const best = await snap<ResultsSnapshot>(page, "results");
  expect(best.isNewBest).toBe(true);
  expect(best.rendered).toContain("personal-best-new");
});

test("UR-102 the nearby-pilots board is gone, including for a pilot who opted in", async ({
  page,
}) => {
  // THE FEATURE IS DELETED, NOT HIDDEN. The stage report used to carry a second
  // panel in the right-hand column: a one-time question asking a child to opt
  // into seeing pilots flying near their speed, and the board that question
  // turned on. Nothing was ever behind it - D43 rules out accounts and there is
  // no network - so its only honest state was "no other pilots nearby yet".
  //
  // This seeds the hardest case: a pilot whose SAVED profile says they opted
  // in, which is the one state that used to draw the board with no prompt. The
  // field is still on disk and still decoded; the screen must not react to it.
  await seed(page, {
    stopId: "mars",
    progress: [],
    tally: CLEAN_TALLY,
    exposures: [],
    relativeBoardOptedIn: true,
  });

  const s = await snap<ResultsSnapshot>(page, "results");
  // One panel, not two.
  expect(Object.keys(s.panels)).toEqual(["report"]);
  // Nothing the board drew is marked as rendered any more.
  expect(s.rendered.filter((m) => m.startsWith("board"))).toEqual([]);
  // The focus list is the two buttons and nothing else: no "show nearby
  // pilots", no "not now".
  expect(s.focusIds).toEqual(["replay", "continue"]);

  const seen = (await texts(page, "results")).join(" ").toLowerCase();
  for (const phrase of ["pilots near you", "nearby pilots", "no other pilots", "not now"]) {
    expect(seen, phrase).not.toContain(phrase);
  }
});

test("AC-18.1 Results is operable with the keyboard alone and shows focus", async ({
  page,
}) => {
  await seed(page, {
    stopId: "mars",
    progress: [],
    tally: CLEAN_TALLY,
    exposures: [],
  });

  const s = await snap<ResultsSnapshot>(page, "results");
  expect(s.focusIds).toEqual(["replay", "continue"]);
  // CONTINUE holds focus on entry, not replay. This assertion used to read
  // `focusIndex === 0`, which pinned the caret to whichever button was drawn
  // first - and replay is drawn first, because "back" reads on the left. So a
  // child pressing Enter on reflex silently re-flew the stage they had just
  // finished. The forward action is the default on every screen that offers
  // both; layout order does not choose what Enter does.
  expect(s.focusId).toBe("continue");

  await page.keyboard.press("Tab");
  // Wraps, so a child cannot get stuck at the end of the list.
  expect((await snap<ResultsSnapshot>(page, "results")).focusId).toBe("replay");
  await page.keyboard.press("Tab");
  expect((await snap<ResultsSnapshot>(page, "results")).focusId).toBe("continue");
  await page.keyboard.press("ArrowUp");
  expect((await snap<ResultsSnapshot>(page, "results")).focusId).toBe("replay");
});

test("D74 / AC-22b.1 Results is informational, never a grade", async ({ page }) => {
  await seed(page, {
    stopId: "jupiter",
    progress: [{ stopId: "mars", cleared: true, lastWpm: 100, lastAccuracy: 0.99 }],
    tally: { characters: 100, elapsedMs: 60_000, hits: 10, typos: 9, hullHits: 2 },
    exposures: [
      { word: "empty", fkLatencyMs: [1500], hit: false, retention: false, priorSamples: [500] },
    ],
  });

  const s = await snap<ResultsSnapshot>(page, "results");
  const lines = await texts(page, "results");
  const seen = lines.join(" ").toLowerCase();

  for (const word of PUNISHING_WORDS) {
    if (word === "#") continue;
    expect(seen, `"${word}" must not appear on Results`).not.toContain(word);
  }
  // No letter grade either.
  for (const line of lines) {
    expect(line.trim()).not.toMatch(/^[A-F][+-]?$/);
  }
  for (const ink of await inks(page, "results")) {
    expect(readsAsRed(ink.color, s.accent), `"${ink.text}" in ${ink.color}`).toBe(false);
  }
  // A poor run still gets its stars and its numbers; nothing is withheld.
  expect(s.starsRendered).toBe(true);
  expect(s.stars).toBe(1);
});

test("the stop order fixture covers every stop id the scene may be opened at", async () => {
  // Guards the fixture builder above against a route change (D56).
  expect(STOPS).toHaveLength(7);
});
