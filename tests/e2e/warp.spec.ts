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

/** The coach plate, minus the avatar column: Shadow's glow pulses forever. */
const NOTE_REGION = { x: 390, y: 742, w: 1370, h: 236 } as const;

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
  percentLabel: string;
  chargedLabelVisible: boolean;
  chargedShown: boolean;
  focusId: string;
  focusRingVisible: boolean;
  highlightedText: string[];
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
};

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

test("D30 the sentence highlights the words the player just blasted", async ({ page }) => {
  await openWarp(page);
  const s = await snap<WarpSnapshot>(page, "warp");
  expect(s.sentence).toBe(MARS_SENTENCE);
  // Mars' asteroid pool carries mars / red / planet; "is" and "the" are filler.
  expect(s.highlightedText).toEqual(["Mars", "red", "planet"]);
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
  // The "charged" line goes up in the same frame the warp starts. Waiting on
  // the rendered flag is the assertion that it was really drawn; the latched
  // flag is what the snapshot below can still see once the cut to Beacon has
  // destroyed the Text.
  await waitForSnapshot(page, "warp", "chargedLabelVisible", true);

  const done = await snap<WarpSnapshot>(page, "warp");
  expect(done.charged).toBe(true);
  // Exactly, not approximately: index / length is n/n on the final character.
  expect(done.chargeFraction).toBe(1);
  expect(done.chargePercent).toBe(100);
  expect(done.percentLabel).toContain("100");
  expect(done.chargedShown).toBe(true);
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
