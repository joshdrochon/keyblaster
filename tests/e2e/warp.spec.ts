import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bootScene,
  activeScenes,
  frame,
  frameOf,
  type GameHandle,
  inks,
  pixelDiffPercent,
  PUNISHING_WORDS,
  readsAsRed,
  restartScene,
  snap,
  texts,
  waitForScene,
  waitForSnapshot,
} from "./support/lane";

/**
 * WARP BREAK e2e - screen 7 of the screen inventory.
 *
 * Covers AC-16.1, AC-16.2, AC-16.3 (FR-16 / D30), AC-15.3 and AC-15.4 (FR-15),
 * AC-33 (D33: the coach area must look identical for an AI note and the shipped
 * fallback), AC-18.1 and AC-22b.1.
 *
 * AC-33 is the one worth reading. "Identical" is asserted twice, because either
 * half alone is cheap: once STRUCTURALLY, by comparing the geometry and style
 * the scene reports for the note, and once in PIXELS, by rendering the same
 * note text down each path and diffing two real screenshots of the same region.
 * The note string is held equal on purpose - two different sentences cannot be
 * pixel-equal, and the claim is about the AREA, not about the words.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EVIDENCE = join(REPO, "gauntlet", "evidence");

function writeEvidence(name: string, body: string | Buffer): void {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, name), body);
}

/** Mars' warp sentence, from src/content/en/mars.json. */
const MARS_SENTENCE = "Mars is the red planet.";

/**
 * The coach plate, minus the avatar column: Shadow's glow pulses forever.
 *
 * MOVED WITH THE CARD (UR-63). `COACH` is now `{ x: 96, y: 680, w: 1728,
 * h: 140 }` - the column gave the bottom of the frame back to the ship - and a
 * region left at the old y would have diffed two screenshots of the Lantern's
 * exhaust and called the coach area identical.
 */
const NOTE_REGION = { x: 326, y: 680, w: 1498, h: 140 } as const;

type WarpSnapshot = {
  stopId: string;
  accent: string;
  sentence: string;
  index: number;
  typos: number;
  charged: boolean;
  lastEvent: string;
  chargeFraction: number;
  chargePercent: number;
  meterShown: number;
  meterEaseFrames: number;
  chargeStage: number;
  percentLabel: string;
  chargedLabelVisible: boolean;
  focusId: string;
  focusRingVisible: boolean;
  highlightedText: string[];
  blastedWords: string[];
  missedWords: string[];
  debris: { count: number; moved: boolean };
  warping: boolean;
  multiplier: number;
  layerSpeeds: Record<string, number>;
  coach: {
    received: boolean;
    settled: boolean;
    note: string;
    source: string | null;
    failure: string | null;
    transport: string | null;
    calls: number;
  };
  coachArea: Record<string, unknown>;
  letters: { char: string; color: string; alpha: number; x: number; y: number; scaleX: number }[];
  wordPulse: {
    words: string[];
    fired: number;
    running: number;
    peakScale: number;
    frames: number;
    scale: number;
    durationMs: number;
    suppressed: boolean;
  };
};

/** One letter's geometry, as `__kb.warp.letterBoxes()` reports it. */
type LetterBox = { char: string; x: number; y: number; scaleX: number; scaleY: number };

async function openWarp(page: Page, query = ""): Promise<void> {
  await bootScene(page, "Warp", "warp", `&stop=mars${query}`);
}

/**
 * Restart Warp with a stub transport that returns a FIXED note and a caller-
 * chosen provenance. The stub is a plain object: `CoachClient` is structural,
 * so nothing has to be imported into the page to satisfy it.
 */
async function openWarpWithNote(
  page: Page,
  note: string,
  source: "live" | "fallback",
): Promise<void> {
  await openWarp(page);
  await page.evaluate(
    ([theNote, theSource]) => {
      const game = (window as unknown as { __kb: Record<string, unknown> }).__kb["game"] as GameHandle;
      const coach = {
        transport: "mock" as const,
        request: () =>
          Promise.resolve({
            note: theNote as string,
            variants: ["Mars is the red planet.", "Its dust is full of rust."] as [
              string,
              string,
            ],
            source: theSource as "live" | "fallback",
            failure: theSource === "fallback" ? ("timeout" as const) : null,
            transport: "mock" as const,
          }),
      };
      game.scene.getScene("Warp").scene.restart({ stopId: "mars", coach });
    },
    [note, source] as [string, string],
  );
  // Wait for the note to have arrived AND its fade-in to have finished, so the
  // two screenshots are compared at the same visual state.
  await page.waitForFunction(() => {
    const w = (window as unknown as { __kb: Record<string, unknown> }).__kb["warp"] as {
      snapshot: () => { coach: { settled: boolean } };
    };
    return w.snapshot().coach.settled;
  });
}

// ---------------------------------------------------------------------------

test("AC-16.1 nothing spawns or moves on the debris layer during the break", async ({
  page,
}) => {
  await openWarp(page);

  for (let i = 0; i < 5; i += 1) {
    const s = await snap<WarpSnapshot>(page, "warp");
    expect(s.debris.count).toBe(0);
    expect(s.debris.moved).toBe(false);
    await page.waitForTimeout(220);
  }
});

test("AC-16.1 the break is calm, not frozen: the ambient layers still drift", async ({
  page,
}) => {
  // Rubric item 2. A stopped belt must not mean a dead frame - "everything
  // calms" is a change of pace, not a pause button.
  await openWarp(page);
  const a = await frame(page);
  await page.waitForTimeout(1000);
  const b = await frame(page);
  const diff = await pixelDiffPercent(page, a.toString("base64"), b.toString("base64"));
  expect(diff).toBeGreaterThan(0.2);
});

test("D09 / D30 the sentence highlights the words the player just blasted", async ({
  page,
}) => {
  await openWarp(page);

  // D09. This test used to open the screen with no run behind it and assert
  // that Mars' whole pool was lit, which the screen satisfied by highlighting
  // the CONTENT FILE rather than the player's run - the founding defect, with
  // a green test on top of it. The run is now supplied, and what it asserts is
  // the difference between the two rules: "planet" is in Mars' pool and in
  // Mars' sentence, and it is dark because the player never blasted it.
  //
  // The full flight-to-warp version lives in tests/e2e/blast-history.spec.ts.
  await restartScene(page, "Warp", {
    stopId: "mars",
    blastHistory: {
      blasts: ["mars", "red"].map((word, order) => ({
        word,
        order,
        atMs: order * 1000,
        fkLatencyMs: 400,
        ikiMs: [200, 200],
        wasCanister: false,
      })),
      misses: [{ word: "planet", atMs: 5000 }],
    },
  });
  await page.waitForTimeout(500);

  const s = await snap<WarpSnapshot>(page, "warp");
  expect(s.sentence).toBe(MARS_SENTENCE);
  expect(s.highlightedText).toEqual(["Mars", "red"]);
  expect(s.highlightedText).not.toContain("planet");
});

test("AC-16.2 a typo does not reset the sentence and re-highlights the current letter", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openWarp(page);
  await page.keyboard.type("Mars", { delay: 25 });

  const before = await snap<WarpSnapshot>(page, "warp");
  expect(before.index).toBe(4);
  expect(before.typos).toBe(0);

  // "z" is not the next character (a space is).
  await page.keyboard.press("z");
  await page.waitForTimeout(120);

  const after = await snap<WarpSnapshot>(page, "warp");
  // The sentence is untouched and the caret has not moved: same letter, again.
  expect(after.sentence).toBe(before.sentence);
  expect(after.index).toBe(4);
  expect(after.typos).toBe(1);
  expect(after.lastEvent).toBe("retry");
  expect(after.chargeFraction).toBe(before.chargeFraction);

  // And the sentence still finishes normally afterwards.
  await page.keyboard.type(" is", { delay: 25 });
  expect((await snap<WarpSnapshot>(page, "warp")).index).toBe(7);
});

test("AC-22.5 the charge meter EASES toward the fill rather than jolting to it", async ({
  page,
}) => {
  // The player's words: "the progress bar should ease, not just jolt forward".
  //
  // The claim is about the two numbers being DIFFERENT for a moment and then
  // the same - the state is exact and instantaneous (AC-16.3 still reads
  // exactly 1 on the final character) and only the pixels lag it. A test that
  // read `chargeFraction` alone could not tell an eased bar from a stepped one,
  // which is why the scene reports the drawn value separately.
  test.setTimeout(90_000);
  await openWarp(page);

  const idle = await snap<WarpSnapshot>(page, "warp");
  expect(idle.meterEaseFrames).toBe(0);

  // One keystroke. The fill is REDRAWN OVER MANY FRAMES on its way to the new
  // value, which is what "ease" means and what a stepped bar cannot do: painted
  // straight from `chargeFraction` this counter never leaves zero.
  //
  // Counted rather than sampled on purpose. The tween is 280 ms and a snapshot
  // round-trip is not reliably shorter, so "read the drawn fill and assert it
  // lags" is a race - it passed and failed on the same build.
  await page.keyboard.press("M");
  await page.waitForTimeout(600);
  const settled = await snap<WarpSnapshot>(page, "warp");
  expect(settled.chargeFraction).toBeGreaterThan(0);
  // Two, not twenty. Headless Chromium rasterises Phaser in software and steps
  // its clock at a fraction of wall time (see playwright.config.ts) - this
  // 280 ms tween gets two or three update frames here and forty in a browser.
  // The number that carries the claim is the FLOOR, and the floor for a bar
  // that jolts is zero: `paintMeter` is only ever reached from the tween.
  //
  // THIS FLOOR IS A FRAME COUNT, SO IT IS ALSO A STATEMENT ABOUT THE HOST, and
  // 0 and 1 are different answers rather than degrees of the same one. Both
  // were forced rather than argued, because the run that produced `Received: 1`
  // could be read either way:
  //
  //   jolt      - `easeMeterTo` made to set `meterShown` and paint directly,
  //               easing removed      -> Received: 0
  //   starvation - code untouched, the renderer throttled 20x through CDP
  //               (`Emulation.setCPUThrottlingRate`) -> Received: 1
  //
  // Only the second reproduces what the loaded suite saw, so a 1 here means
  // the tween ran and the host gave it one frame in 280 ms - the bar eases and
  // the machine could not draw it. Unthrottled and alone this test passes with
  // the meter arriving exactly on `chargeFraction`. Do not answer a 1 by
  // lowering this floor: it would make the jolt above unfalsifiable at 0 vs 1,
  // which is the only distinction the number exists to draw.
  expect(settled.meterEaseFrames).toBeGreaterThanOrEqual(2);
  // And it ARRIVES. Easing that never reaches the state is a different bug.
  expect(settled.meterShown).toBeCloseTo(settled.chargeFraction, 5);

  // It never overshoots - the sentence carries the text the player is reading
  // and a bar that springs past the end reads as a fault, which is why the
  // tween is Cubic.Out and never Back.Out.
  await page.keyboard.type("ars is", { delay: 20 });
  await page.waitForTimeout(600);
  const later = await snap<WarpSnapshot>(page, "warp");
  expect(later.meterShown).toBeLessThanOrEqual(1);
  expect(later.meterShown).toBeCloseTo(later.chargeFraction, 5);
});

test("AC-21.3 the charge makes a rising noise that tracks the fill", async ({ page }) => {
  // "The warp drive progress bar should actually make noise when its charging
  // up." The RULE is unit-tested in tests/unit/scenes/warpCharge.test.ts; what
  // this asserts is that the screen actually walks it - the stage advances
  // through its thirds as the sentence is typed, rather than sounding once on
  // the first character and then charging in silence.
  test.setTimeout(90_000);
  await openWarp(page);

  await page.keyboard.press("M");
  const first = await snap<WarpSnapshot>(page, "warp");
  expect(first.chargeStage).toBe(1);

  await page.keyboard.type("ars is the", { delay: 20 });
  const middle = await snap<WarpSnapshot>(page, "warp");
  expect(middle.chargeStage).toBeGreaterThan(first.chargeStage);

  await page.keyboard.type(" red", { delay: 20 });
  const late = await snap<WarpSnapshot>(page, "warp");
  expect(late.chargeStage).toBeGreaterThanOrEqual(middle.chargeStage);
  expect(late.chargeStage).toBeLessThanOrEqual(3);
});

test("AC-16.3 the charge meter reaches exactly 100% on the final character", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openWarp(page);
  const body = MARS_SENTENCE.slice(0, -1);
  const last = MARS_SENTENCE.slice(-1);

  await page.keyboard.type(body, { delay: 20 });
  const penultimate = await snap<WarpSnapshot>(page, "warp");
  expect(penultimate.charged).toBe(false);
  expect(penultimate.chargeFraction).toBeLessThan(1);
  expect(penultimate.chargePercent).toBeLessThan(100);

  await page.keyboard.press(last === "." ? "Period" : last);
  await waitForSnapshot(page, "warp", "charged", true);
  // `chargedLabelVisible` is LATCHED on a real render pass and never cleared
  // (see `support/laneInit.ts`), so this asks "was the charged line drawn",
  // which is what the AC claims. Sampling `label.visible` instead would be a
  // race against the cut to Beacon that destroys the Text - a window a poll
  // cannot be made to hit by waiting longer.
  await waitForSnapshot(page, "warp", "chargedLabelVisible", true);

  const done = await snap<WarpSnapshot>(page, "warp");
  expect(done.charged).toBe(true);
  // Exactly, not approximately: index / length is n/n on the final character.
  expect(done.chargeFraction).toBe(1);
  expect(done.chargePercent).toBe(100);
  expect(done.percentLabel).toContain("100");
  expect(done.chargedLabelVisible).toBe(true);
});

test("AC-16.3 a typo on the way does not cost the player 100%", async ({ page }) => {
  test.setTimeout(90_000);
  await openWarp(page);
  await page.keyboard.type("Mars", { delay: 20 });
  await page.keyboard.press("q");
  await page.keyboard.press("q");
  await page.keyboard.type(" is the red planet", { delay: 20 });
  await page.keyboard.press("Period");
  await waitForSnapshot(page, "warp", "charged", true);

  const s = await snap<WarpSnapshot>(page, "warp");
  expect(s.typos).toBe(2);
  expect(s.chargeFraction).toBe(1);
  expect(s.chargePercent).toBe(100);
});

test("FR-16 completing the sentence accelerates L2-L5 x4 and cuts to Beacon", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openWarp(page);
  await page.keyboard.type(MARS_SENTENCE.slice(0, -1), { delay: 20 });
  await page.keyboard.press("Period");
  await page.waitForTimeout(200);

  expect((await snap<WarpSnapshot>(page, "warp")).warping).toBe(true);

  // art-direction section 8: L2-L5 x4 over 1.2 s of SCENE time.
  await waitForSnapshot(page, "warp", "multiplier", 4);
  const s = await snap<WarpSnapshot>(page, "warp");
  for (const [id, base] of [
    ["farField", 0.15],
    ["midField", 0.35],
    ["debris", 1],
    ["nearField", 1.3],
  ] as const) {
    expect(s.layerSpeeds[id]).toBeCloseTo(base * 4, 6);
  }

  // ...and then it cuts to Beacon.
  await waitForScene(page, "Beacon");
  expect(await activeScenes(page)).toContain("Beacon");
});

test("AC-15.3 / AC-15.4 exactly one coach call per warp break, through one interface", async ({
  page,
}) => {
  await openWarp(page);
  await page.waitForFunction(() => {
    const w = (window as unknown as { __kb: Record<string, unknown> }).__kb["warp"] as {
      snapshot: () => { coach: { received: boolean } };
    };
    return w.snapshot().coach.received;
  });
  const s = await snap<WarpSnapshot>(page, "warp");
  expect(s.coach.calls).toBe(1);
  // The default transport is the mock: D87 forbids a live paid call here.
  expect(s.coach.transport).toBe("mock");
  expect(s.coach.note.length).toBeGreaterThan(0);
});

test("AC-33 the coach area is IDENTICAL for an AI note and the shipped fallback", async ({
  page,
}) => {
  // Two full boots and two screenshots, on a canvas headless renders at about a
  // quarter of real speed.
  test.setTimeout(120_000);
  // The same sentence down both paths, because the claim is about the area, not
  // about the words. Every word is in the compiled allowlist, so neither path
  // is quietly rejected before it renders.
  const NOTE = "Good run. Let us take rivers and empty a little slower.";

  await openWarpWithNote(page, NOTE, "live");
  const liveSnap = await snap<WarpSnapshot>(page, "warp");
  const liveShot = await frameOf(page, NOTE_REGION);

  await openWarpWithNote(page, NOTE, "fallback");
  const fallbackSnap = await snap<WarpSnapshot>(page, "warp");
  const fallbackShot = await frameOf(page, NOTE_REGION);

  // The scene really did get two different provenances...
  expect(liveSnap.coach.source).toBe("live");
  expect(liveSnap.coach.failure).toBeNull();
  expect(fallbackSnap.coach.source).toBe("fallback");
  expect(fallbackSnap.coach.failure).toBe("timeout");

  // ...and rendered the same note, in the same box, with the same style.
  expect(fallbackSnap.coach.note).toBe(liveSnap.coach.note);
  expect(fallbackSnap.coachArea).toEqual(liveSnap.coachArea);

  const diff = await pixelDiffPercent(
    page,
    liveShot.toString("base64"),
    fallbackShot.toString("base64"),
  );

  writeEvidence("warp-coach-live.png", liveShot);
  writeEvidence("warp-coach-fallback.png", fallbackShot);
  writeEvidence(
    "warp-coach-identical.json",
    `${JSON.stringify(
      {
        diffPercent: diff,
        threshold: 0,
        note: NOTE,
        region: NOTE_REGION,
        frames: [
          "gauntlet/evidence/warp-coach-live.png",
          "gauntlet/evidence/warp-coach-fallback.png",
        ],
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );

  expect(diff).toBe(0);
});

test("AC-18.1 the warp break is operable with the keyboard alone and shows focus", async ({
  page,
}) => {
  await openWarp(page);

  // The focus ring is drawn before any key is pressed: a keyboard-only screen
  // that does not say where you are is not operable, it is just guessable.
  const idle = await snap<WarpSnapshot>(page, "warp");
  expect(idle.focusRingVisible).toBe(true);
  expect(idle.focusId).toBe("warp-sentence");

  // Tab does not strand the player: it stays on the thing that acts, and the
  // sentence still types afterwards with no pointer involved.
  await page.keyboard.press("Tab");
  await page.keyboard.type("Mars", { delay: 20 });
  expect((await snap<WarpSnapshot>(page, "warp")).index).toBe(4);
});

test("AC-22b.1 nothing on the warp break reads as punishment", async ({ page }) => {
  await openWarp(page);
  await page.keyboard.type("Mzzz", { delay: 20 });
  await page.waitForTimeout(200);

  const seen = (await texts(page, "warp")).join(" ").toLowerCase();
  for (const word of PUNISHING_WORDS) {
    expect(seen).not.toContain(word);
  }
  const accent = (await snap<WarpSnapshot>(page, "warp")).accent;
  for (const ink of await inks(page, "warp")) {
    expect(readsAsRed(ink.color, accent), `"${ink.text}" is drawn in ${ink.color}`).toBe(
      false,
    );
  }
});

// ---------------------------------------------------------------------------
// UR-26 - a finished word expands slightly and settles back
// ---------------------------------------------------------------------------

/**
 * UR-26, raised unprompted rather than as a defect: finishing a word in the
 * warp sentence should make that word grow a little and settle back to its
 * original size, so the child can see it has been typed out.
 *
 * The rule is unit-tested without a browser in
 * `tests/unit/scenes/warpWordPulse.test.ts`. What these three cases assert is
 * what the RUNNING SCREEN does, and in particular the thing the rule cannot
 * prove on its own: that scaling a word does not move the sentence. `Mars is
 * the red planet.` is one laid-out line, so if finishing "Mars" changed the
 * space "Mars" occupies, "planet" would slide - while a child is reading it.
 */

/** Read every letter's geometry. Cheap enough to call on every frame. */
async function letterBoxes(page: Page): Promise<LetterBox[]> {
  return page.evaluate(() => {
    const bag = (window as unknown as { __kb: Record<string, unknown> }).__kb["warp"] as {
      letterBoxes: () => LetterBox[];
    };
    return bag.letterBoxes();
  });
}

/**
 * Record every letter's x and scale on every animation frame, from inside the
 * page, for the next `frames` frames.
 *
 * FROM INSIDE, and not by polling from the test. The pulse is 240 ms and a
 * Playwright round-trip is not reliably shorter, so a test that sampled from
 * node would take four or five readings of a twenty-frame event and would miss
 * a single frame of jitter every time. This sees every frame the browser drew.
 */
async function watchLetters(page: Page, frames: number): Promise<void> {
  await page.evaluate((limit) => {
    const bag = (window as unknown as { __kb: Record<string, unknown> }).__kb["warp"] as {
      letterBoxes: () => LetterBox[];
    };
    const store = window as unknown as { __pulseWatch: LetterBox[][] };
    store.__pulseWatch = [];
    const tick = (): void => {
      store.__pulseWatch.push(bag.letterBoxes());
      if (store.__pulseWatch.length < limit) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, frames);
}

async function watched(page: Page): Promise<LetterBox[][]> {
  return page.evaluate(
    () => (window as unknown as { __pulseWatch: LetterBox[][] }).__pulseWatch,
  );
}

/** Mars' sentence, indexed: "Mars" is 0..3, " " is 4, "planet" is 16..21. */
const MARS_WORD = { start: 0, end: 4 } as const;
const PLANET_WORD = { start: 16, end: 22 } as const;

test("UR-26 a completed word pulses once, settles back, and moves nothing after it", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openWarp(page);
  // The per-letter entrance fade is alpha-only, but let it finish anyway so
  // "nothing moved" is measured against a screen that has stopped arriving.
  await page.waitForTimeout(700);

  const rest = await letterBoxes(page);
  expect(rest).toHaveLength(MARS_SENTENCE.length);
  for (const letter of rest) expect(letter.scaleX).toBe(1);

  // Watch every frame from before the keystroke that finishes "Mars" until
  // well after its pulse would have landed.
  await page.keyboard.type("Mar", { delay: 25 });
  // Sixty frames, and six seconds to collect them. Headless Chromium rasterises
  // Phaser in software and runs animation frames at a fraction of a real
  // browser's rate - twelve frames in 2.5 s on this machine - while Phaser's own
  // clock is delta-capped, so the 240 ms tween spans a handful of frames that
  // take seconds of wall time to arrive. The numbers below are floors for that
  // environment, not a description of the effect.
  await watchLetters(page, 60);
  await page.keyboard.press("s");
  await page.waitForTimeout(6000);

  const frames = await watched(page);
  expect(frames.length).toBeGreaterThanOrEqual(10);

  // ---- it actually happened -------------------------------------------
  // A pulse that never ran would satisfy every "nothing moved" assertion
  // below perfectly, so this is the control that makes them mean something.
  const grew = frames.filter((f) =>
    f.slice(MARS_WORD.start, MARS_WORD.end).some((l) => l.scaleX > 1.001),
  );
  expect(grew.length).toBeGreaterThan(0);

  const after = await snap<WarpSnapshot>(page, "warp");
  expect(after.wordPulse.suppressed).toBe(false);
  expect(after.wordPulse.words).toEqual(["Mars"]);
  expect(after.wordPulse.fired).toBe(1);
  // The high-water mark: the pulse reached the scale the module ships, not
  // merely some scale above 1.
  expect(after.wordPulse.peakScale).toBeCloseTo(after.wordPulse.scale, 3);
  // Two, not twenty, for the same reason `meterEaseFrames` asserts two: Phaser's
  // clock is delta-capped and headless Chromium gives this 240 ms tween a
  // handful of update frames where a real browser gives it fifteen. The floor
  // for an effect that never ran is zero, and that is the number that carries
  // the claim. `peakScale` above is the one that says it reached full size.
  expect(after.wordPulse.frames).toBeGreaterThanOrEqual(2);

  // ---- and it went back ------------------------------------------------
  expect(after.wordPulse.running).toBe(0);
  const settled = await letterBoxes(page);
  for (const [i, letter] of settled.entries()) {
    const was = rest[i] as LetterBox;
    expect(letter.scaleX, `letter ${i} "${letter.char}" scale`).toBe(1);
    expect(letter.x, `letter ${i} "${letter.char}" x`).toBe(was.x);
    expect(letter.y, `letter ${i} "${letter.char}" y`).toBe(was.y);
  }

  // ---- THE CLAIM: the line did not move --------------------------------
  // Every frame, every letter of every LATER word, against where the layout
  // put it. Not "close to" - exactly, because nothing in the effect is
  // supposed to be able to reach them at all.
  let checked = 0;
  for (const [n, f] of frames.entries()) {
    for (let i = MARS_WORD.end; i < f.length; i += 1) {
      const now = f[i] as LetterBox;
      const was = rest[i] as LetterBox;
      expect(now.x, `frame ${n}: letter ${i} "${now.char}" moved`).toBe(was.x);
      expect(now.scaleX, `frame ${n}: letter ${i} "${now.char}" scaled`).toBe(1);
      checked += 1;
    }
  }
  // The loop above is only worth something if it ran over real frames, and over
  // every letter of every word after the one that pulsed.
  expect(checked).toBe(frames.length * (MARS_SENTENCE.length - MARS_WORD.end));
  expect(checked).toBeGreaterThan(100);
});

test("UR-26 the pulse fires exactly once per word across the whole sentence", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openWarp(page);
  await page.waitForTimeout(700);

  // The body of the sentence, stopping before the full stop so the screen does
  // not charge and cut to Beacon mid-assertion.
  await page.keyboard.type("Mars is the red planet", { delay: 30 });
  // Long enough for the LAST word's pulse to land as well as fire. See the note
  // on frame rates in the case above.
  await page.waitForTimeout(4000);

  const s = await snap<WarpSnapshot>(page, "warp");
  expect(s.charged).toBe(false);
  // Five words, five pulses - not 22, one per accepted character, and not 4
  // because the last word only ends at the full stop.
  expect(s.wordPulse.words).toEqual(["Mars", "is", "the", "red", "planet"]);
  expect(s.wordPulse.fired).toBe(5);
  expect(s.wordPulse.running).toBe(0);

  // Typing the full stop finishes no word: the pulse belongs to the word, not
  // to the keystroke.
  await page.keyboard.press("Period");
  await waitForSnapshot(page, "warp", "charged", true);
  expect((await snap<WarpSnapshot>(page, "warp")).wordPulse.fired).toBe(5);
});

test("UR-26 a pulse that is still running when the screen goes away does not crash it", async ({
  page,
}) => {
  test.setTimeout(90_000);
  // The classic destroyed-object crash: the tween holds references to the
  // per-character Texts and writes scale and position into them every frame,
  // and the warp break is a screen that tears itself down. Two ways in:
  //
  //   the SENTENCE ENDS - the last word is finished and `beginWarp` runs on the
  //   same keystroke or the next one, and the scene cuts to Beacon;
  //   the SCENE RESTARTS - which is also what `relayoutSentence` does to the
  //   Texts when the coach lands a composed sentence mid-screen.
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await openWarp(page);
  await page.waitForTimeout(700);

  // Restart the scene DURING a pulse, with no delay at all after the keystroke
  // that finishes the word - the tween is mid-flight and its targets are about
  // to be destroyed underneath it.
  await page.keyboard.type("Mars", { delay: 25 });
  await restartScene(page, "Warp", { stopId: "mars" });
  await page.waitForTimeout(800);
  expect(errors, errors.join("\n")).toEqual([]);

  // The screen came back whole and typable, with a clean pulse record.
  const fresh = await snap<WarpSnapshot>(page, "warp");
  expect(fresh.sentence).toBe(MARS_SENTENCE);
  expect(fresh.index).toBe(0);
  expect(fresh.wordPulse.fired).toBe(0);
  expect(fresh.wordPulse.running).toBe(0);
  expect(fresh.wordPulse.peakScale).toBe(1);

  // And the other exit: finish the sentence, let the warp cut to Beacon, and
  // see that nothing threw on the way out.
  await page.keyboard.type("Mars is the red planet", { delay: 25 });
  await waitForSnapshot(page, "warp", "index", MARS_SENTENCE.length - 1);
  await page.keyboard.press("Period");
  await waitForScene(page, "Beacon", 30_000);
  await page.waitForTimeout(600);
  expect(errors, errors.join("\n")).toEqual([]);
});

/**
 * Diff ONE RECTANGLE of two PNGs, given as fractions of the image.
 *
 * Fractions rather than pixels because the capture's size depends on the
 * canvas's on-screen box and the device pixel ratio, and the claim is about a
 * word, not about a pixel count. The decode is a real PNG decode - `Image` plus
 * a 2D canvas - and NOT a read of the live WebGL canvas, which returns uniform
 * garbage without `preserveDrawingBuffer` and has already produced two wrong
 * measurements on this project.
 */
async function regionDiffPercent(
  page: Page,
  a: string,
  b: string,
  box: { fx: number; fy: number; fw: number; fh: number },
): Promise<number> {
  return page.evaluate(
    async ([first, second, rect]: [
      string,
      string,
      { fx: number; fy: number; fw: number; fh: number },
    ]) => {
      const load = (data: string): Promise<HTMLImageElement> =>
        new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = `data:image/png;base64,${data}`;
        });
      const [ia, ib] = await Promise.all([load(first), load(second)]);
      const w = Math.min(ia.width, ib.width);
      const h = Math.min(ia.height, ib.height);
      const x0 = Math.floor(rect.fx * w);
      const y0 = Math.floor(rect.fy * h);
      const cw = Math.max(1, Math.floor(rect.fw * w));
      const ch = Math.max(1, Math.floor(rect.fh * h));
      const pixels = (img: HTMLImageElement): Uint8ClampedArray => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        if (ctx === null) throw new Error("no 2d context");
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(x0, y0, cw, ch).data;
      };
      const da = pixels(ia);
      const db = pixels(ib);
      let differing = 0;
      for (let i = 0; i < da.length; i += 4) {
        if (
          Math.abs((da[i] ?? 0) - (db[i] ?? 0)) > 12 ||
          Math.abs((da[i + 1] ?? 0) - (db[i + 1] ?? 0)) > 12 ||
          Math.abs((da[i + 2] ?? 0) - (db[i + 2] ?? 0)) > 12
        ) {
          differing++;
        }
      }
      return (differing / (cw * ch)) * 100;
    },
    [a, b, box] as [string, string, { fx: number; fy: number; fw: number; fh: number }],
  );
}

/**
 * Hold the tween clock still, so a 240 ms effect can be photographed.
 *
 * Not zero: a pending tween still has to be promoted to active by the manager's
 * update, and a hair of time is cheaper than depending on that. At 1/10000 the
 * pulse would take forty minutes to run on its own, which is to say it does not
 * run - every frame below is reached by seeking, not by waiting.
 */
async function holdTweens(page: Page): Promise<void> {
  await page.evaluate(() => {
    const game = (window as unknown as { __kb: Record<string, unknown> }).__kb["game"] as GameHandle;
    const scene = game.scene.getScene("Warp") as unknown as {
      tweens: { timeScale: number };
    };
    scene.tweens.timeScale = 0.0001;
  });
}

/**
 * Step the live word-pulse tween to `ms` from its start and report the scale it
 * put the word at.
 *
 * `Tween.seek(ms, delta, emit)` with `emit` true replays the tween's own
 * `onUpdate`, so this is the SHIPPED effect at a chosen point on its own curve,
 * not a reconstruction of it. The tween is found by its target: the pulse
 * drives a holder `{ s }` and the charge meter drives a holder `{ v }`, so the
 * two cannot be confused.
 *
 * Deterministic on purpose. The first version of this capture waited on wall
 * time for the pulse to reach its peak and photographed whatever it found
 * there; on a machine running four other lanes' browsers the frame rate moved
 * by a factor of five between runs and the shutter landed in a different place
 * each time.
 */
async function seekPulse(page: Page, ms: number): Promise<number | null> {
  return page.evaluate((at) => {
    const game = (window as unknown as { __kb: Record<string, unknown> }).__kb["game"] as GameHandle;
    const scene = game.scene.getScene("Warp") as unknown as {
      tweens: {
        timeScale: number;
        getTweens: () => { targets: unknown[]; seek: (ms: number, d: number, e: boolean) => void }[];
      };
    };
    const pulse = scene.tweens
      .getTweens()
      .find((t) =>
        t.targets.some(
          (target) =>
            typeof target === "object" &&
            target !== null &&
            Object.prototype.hasOwnProperty.call(target, "s"),
        ),
      );
    if (pulse === undefined) return null;
    // `Tween.update` multiplies its delta by `this.timeScale * parent.timeScale`
    // (Phaser 3.90, Tween.js:671), and `seek` walks the tween by calling
    // `update`. So the hold that stops the clock ALSO stops the seek: it has to
    // be lifted for the walk and put back afterwards, or every frame comes back
    // at scale 1.0000000004 and the capture quietly photographs nothing.
    const manager = scene.tweens as unknown as { timeScale: number };
    const held = manager.timeScale;
    manager.timeScale = 1;
    pulse.seek(at as number, 1, true);
    manager.timeScale = held;
    const bag = (window as unknown as { __kb: Record<string, unknown> }).__kb["warp"] as {
      letterBoxes: () => { scaleX: number }[];
    };
    return bag.letterBoxes()[0]?.scaleX ?? null;
  }, ms);
}

test("UR-26 visual evidence: the word grows in the pixels and the line does not", async ({
  page,
}) => {
  test.setTimeout(300_000);
  // THE PICTURE, and the measurement taken off it.
  //
  // Every assertion above this one is read off the scene's own numbers, which
  // is the right way to check a mechanism and no way at all to check that a
  // person would see it. This photographs the pulse at five points on its own
  // curve and compares TWO rectangles of the same pair of images: the word that
  // was typed, and a word further along the same line. One must change and the
  // other must not - which is the complaint the effect had to avoid, measured
  // in the picture rather than in the code.
  //
  // The PNGs are decoded with `Image` and a 2D canvas. Nothing here reads the
  // live WebGL canvas, which returns uniform garbage without
  // `preserveDrawingBuffer` and has produced two wrong measurements on this
  // project already.
  await openWarp(page);
  await page.waitForTimeout(700);

  const rest = await letterBoxes(page);
  const at = (i: number): number => (rest[i] as LetterBox).x;
  // The line the sentence is drawn on, from just left of "Mars" to just right
  // of "planet". A letter's right edge is the next letter's x.
  const band = {
    x: at(MARS_WORD.start) - 20,
    y: (rest[0] as LetterBox).y - 14,
    w: at(PLANET_WORD.end) + 20 - (at(MARS_WORD.start) - 20),
    h: 92,
  };
  const fraction = (from: number, to: number) => ({
    fx: (from - band.x) / band.w,
    fy: 0,
    fw: (to - from) / band.w,
    fh: 1,
  });
  const marsBox = fraction(at(MARS_WORD.start) - 8, at(MARS_WORD.end) + 8);
  const planetBox = fraction(at(PLANET_WORD.start) - 8, at(PLANET_WORD.end) + 8);

  // Finish "Mars" with the tween clock held, so the pulse exists and has not
  // moved, then walk it: start, mid-rise, peak, mid-fall, home.
  await holdTweens(page);
  await page.keyboard.type("Mars", { delay: 30 });
  await page.waitForFunction(() => {
    const bag = (window as unknown as { __kb: Record<string, unknown> }).__kb["warp"] as {
      snapshot: () => { index: number };
    };
    return bag.snapshot().index === 4;
  });

  // Five points on a 120 ms out / 120 ms back curve. Not 0 and 240 exactly at
  // the ends and not 120 exactly at the turn: Phaser reports the value 1 at a
  // yoyo's flip frame, so the peak is sampled just before it.
  const strip: { ms: number; scale: number; png: Buffer }[] = [];
  for (const ms of [0, 60, 110, 180, 239]) {
    const scale = await seekPulse(page, ms);
    expect(scale, `no pulse tween to seek at ${ms} ms`).not.toBeNull();
    strip.push({ ms, scale: scale as number, png: await frameOf(page, band) });
  }

  const shot = (ms: number): { ms: number; scale: number; png: Buffer } =>
    strip.find((f) => f.ms === ms) as { ms: number; scale: number; png: Buffer };
  const home = shot(239);
  const peak = shot(110);

  // THE SHAPE OF THE THING, asserted rather than described: it starts at its
  // own size, rises, peaks at the tuned scale, falls back symmetrically, and
  // ends at its own size again. A one-way grow, a drift, or a pulse that never
  // came home all fail here.
  expect(shot(0).scale).toBeCloseTo(1, 2);
  expect(shot(60).scale).toBeGreaterThan(1.02);
  expect(peak.scale).toBeGreaterThan(shot(60).scale);
  expect(peak.scale).toBeGreaterThan(1.06);
  // Never past the tuning: an overshoot would be a bounce, and a bounce is a
  // celebration rather than the acknowledgement UR-26 asks for.
  expect(peak.scale).toBeLessThanOrEqual(1.07 + 1e-6);
  expect(shot(180).scale).toBeCloseTo(shot(60).scale, 2);
  expect(home.scale).toBeCloseTo(1, 2);

  const movedWord = await regionDiffPercent(
    page,
    peak.png.toString("base64"),
    home.png.toString("base64"),
    marsBox,
  );
  const movedLine = await regionDiffPercent(
    page,
    peak.png.toString("base64"),
    home.png.toString("base64"),
    planetBox,
  );
  // And the word is back where it started, in pixels and not only in numbers:
  // the first frame and the last are the same picture.
  const returned = await regionDiffPercent(
    page,
    strip[0]?.png.toString("base64") ?? "",
    home.png.toString("base64"),
    marsBox,
  );

  for (const f of strip) {
    writeEvidence(`warp-word-pulse-${String(f.ms).padStart(3, "0")}ms.png`, f.png);
  }
  writeEvidence(
    "warp-word-pulse.json",
    `${JSON.stringify(
      {
        ticket: "UR-26",
        requirement:
          "a word grows slightly on the keystroke that finishes it, returns to its original size, and moves nothing else on the line",
        band,
        sequence: strip.map((f) => ({
          ms: f.ms,
          scale: f.scale,
          file: `gauntlet/evidence/warp-word-pulse-${String(f.ms).padStart(3, "0")}ms.png`,
        })),
        typedWord: {
          region: marsBox,
          peakVsHomeDiffPercent: movedWord,
          startVsHomeDiffPercent: returned,
        },
        laterWord: { region: planetBox, peakVsHomeDiffPercent: movedLine },
        method:
          "Tween clock held at 1/10000 and the shipped pulse tween seeked to each point with emit=true; easing, scale and geometry are the shipped ones. PNGs decoded with Image + 2D canvas, never read off the WebGL canvas.",
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );

  // The typed word's own pixels move...
  expect(movedWord).toBeGreaterThan(1);
  // ...the word further down the line is pixel-identical...
  expect(movedLine).toBeLessThan(0.1);
  // ...and the word ends up exactly as it began.
  expect(returned).toBeLessThan(0.1);
});

test("UR-26 reduced motion keeps the confirmation and drops the movement (D41)", async ({
  page,
}) => {
  test.setTimeout(90_000);
  // D41 / AC-19.3. The pulse is decoration: the word is already recoloured to
  // the accent and the meter has already moved, so a player who has asked for
  // less motion loses nothing they need. The rule still RUNS - the screen
  // reports that it suppressed the effect rather than that no word was
  // finished - which is the difference between a deliberate silence and a
  // feature that quietly stopped working on this path.
  await openWarp(page, "&reducedMotion=1");
  await page.waitForTimeout(700);

  const rest = await letterBoxes(page);
  await watchLetters(page, 40);
  await page.keyboard.type("Mars", { delay: 25 });
  await page.waitForTimeout(3000);

  const s = await snap<WarpSnapshot>(page, "warp");
  expect(s.index).toBe(4);
  expect(s.wordPulse.suppressed).toBe(true);
  expect(s.wordPulse.fired).toBe(0);
  expect(s.wordPulse.peakScale).toBe(1);

  // Nothing on the line moved or scaled, on any frame - including the word
  // that was typed.
  const frames = await watched(page);
  expect(frames.length).toBeGreaterThanOrEqual(5);
  for (const [n, f] of frames.entries()) {
    for (const [i, now] of f.entries()) {
      const was = rest[i] as LetterBox;
      expect(now.scaleX, `frame ${n}: letter ${i} "${now.char}" scaled`).toBe(1);
      expect(now.x, `frame ${n}: letter ${i} "${now.char}" moved`).toBe(was.x);
    }
  }

  // And the typed letters still say so in ink, which is the part that carries
  // the information.
  expect(s.letters[0]?.color).toBe(s.accent);
});
