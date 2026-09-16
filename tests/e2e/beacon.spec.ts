import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  activeScenes,
  bootScene,
  inks,
  PUNISHING_WORDS,
  readsAsRed,
  snap,
  texts,
  waitForScene,
  waitForSnapshot,
} from "./support/lane";

/**
 * BEACON PLACEMENT e2e - screen 8 of the screen inventory.
 *
 * Covers AC-17.0 (the D81 display format and the pulsar-fix line), AC-17.1
 * (the coordinates are the engine's, unreformatted), the `ok: false`
 * calibrating branch, AC-18.1 and AC-22b.1.
 *
 * The play date is injected, never read off the machine's clock: a screen whose
 * output changes every day is a screen no test can pin.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EVIDENCE = join(REPO, "gauntlet", "evidence");

function writeEvidence(name: string, body: string | Buffer): void {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, name), body);
}

/** A date inside the 1800-2050 element table. */
const PLAY_DATE = "2026-03-15T12:00:00.000Z";

/**
 * D81's format, exactly: one decimal on the angles, two on the distance, two
 * spaces between the three fields, U+2212 MINUS SIGN for a negative latitude.
 */
const D81_COORDS = /^λ \d{1,3}\.\d°  β −?\d{1,2}\.\d°  r \d+\.\d{2} AU$/u;

type BeaconSnapshot = {
  stopId: string;
  accent: string;
  ok: boolean;
  reason: string | null;
  coordsLine: string;
  pulsarLine: string;
  pulsarVisible: boolean;
  flavourLine: string;
  poisoned: boolean;
  lit: boolean;
  focusId: string | null;
  focusRingVisible: boolean;
  nextScene: string;
};

async function openBeacon(page: Page, stop = "mars", date = PLAY_DATE): Promise<void> {
  await bootScene(
    page,
    "Beacon",
    "beacon",
    `&stop=${stop}&date=${encodeURIComponent(date)}`,
  );
}

// ---------------------------------------------------------------------------

test("AC-17.0 the beacon prints the D81 coordinate format plus one pulsar-fix line", async ({
  page,
}) => {
  await openBeacon(page);
  const s = await snap<BeaconSnapshot>(page, "beacon");

  expect(s.ok).toBe(true);
  expect(s.coordsLine).toMatch(D81_COORDS);
  expect(s.pulsarVisible).toBe(true);
  expect(s.pulsarLine.startsWith("pulsar fix")).toBe(true);
  // One flavour line, from the stage bundle (story-draft-v1.md).
  expect(s.flavourLine.length).toBeGreaterThan(0);
  expect(s.poisoned).toBe(false);

  writeEvidence(
    "beacon-readout.json",
    `${JSON.stringify(
      {
        stopId: s.stopId,
        playDate: PLAY_DATE,
        coordsLine: s.coordsLine,
        pulsarLine: s.pulsarLine,
        flavourLine: s.flavourLine,
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
});

test("AC-17.1 the scene prints the engine's coordinates verbatim, for every stop", async ({
  page,
}) => {
  test.setTimeout(120_000);
  // The claim is "do not reformat": the strings on screen must be character-
  // for-character what `@engine/ephemeris` produced for the same date. The
  // engine module is imported INTO the page, so this compares the screen with
  // the source of truth rather than with a second copy of the format.
  for (const stop of ["mars", "jupiter", "saturn", "uranus", "neptune", "pluto"]) {
    await openBeacon(page, stop);
    const s = await snap<BeaconSnapshot>(page, "beacon");
    const expected = await page.evaluate(
      async ([id, iso]) => {
        const path = "/src/engine/ephemeris/index.ts";
        const mod = (await import(/* @vite-ignore */ path)) as {
          beaconReadout: (
            planet: string,
            date: Date,
          ) => { ok: boolean; coordsLine?: string; pulsarLine?: string };
        };
        const r = mod.beaconReadout(id as string, new Date(iso as string));
        return { ok: r.ok, coordsLine: r.coordsLine ?? "", pulsarLine: r.pulsarLine ?? "" };
      },
      [stop, PLAY_DATE] as [string, string],
    );

    expect(expected.ok).toBe(true);
    expect(s.coordsLine).toBe(expected.coordsLine);
    expect(s.pulsarLine).toBe(expected.pulsarLine);
    expect(s.coordsLine).toMatch(D81_COORDS);
  }
});

test("AC-17.0 an unusable clock shows the beacon calibrating - never an error, never NaN", async ({
  page,
}) => {
  // 1776 is outside the 1800-2050 element table, so the engine refuses rather
  // than returning a confident wrong answer.
  await openBeacon(page, "mars", "1776-07-04T00:00:00.000Z");
  const outside = await snap<BeaconSnapshot>(page, "beacon");
  expect(outside.ok).toBe(false);
  expect(outside.reason).toBe("outside-table");
  expect(outside.poisoned).toBe(false);
  expect(outside.pulsarVisible).toBe(false);
  // The plate still says something calm, and the stop's flavour line stays.
  expect(outside.coordsLine.length).toBeGreaterThan(0);
  expect(outside.flavourLine.length).toBeGreaterThan(0);

  const seen = (await texts(page, "beacon")).join(" ").toLowerCase();
  for (const word of [...PUNISHING_WORDS, "error", "invalid", "nan", "undefined"]) {
    expect(seen).not.toContain(word);
  }
  for (const ink of await inks(page, "beacon")) {
    expect(readsAsRed(ink.color, outside.accent)).toBe(false);
  }
});

test("AC-17.0 an unreadable clock is calm too, and still shows no NaN", async ({ page }) => {
  await openBeacon(page, "saturn", "not-a-date");
  const s = await snap<BeaconSnapshot>(page, "beacon");
  expect(s.ok).toBe(false);
  expect(s.reason).toBe("invalid-date");
  expect(s.poisoned).toBe(false);
  expect(s.coordsLine).not.toContain("NaN");
});

test("the beacon drops onto the planet and lights", async ({ page }) => {
  await openBeacon(page);
  await page.waitForFunction(() => {
    const b = (window as unknown as { __kb: Record<string, unknown> }).__kb["beacon"] as { snapshot: () => { lit: boolean } };
    return b.snapshot().lit;
  });
  expect((await snap<BeaconSnapshot>(page, "beacon")).lit).toBe(true);
});

test("AC-18.1 the beacon is operable with the keyboard alone and shows focus", async ({
  page,
}) => {
  await openBeacon(page);
  const s = await snap<BeaconSnapshot>(page, "beacon");
  expect(s.focusId).toBe("beacon-continue");
  expect(s.focusRingVisible).toBe(true);
  expect(s.nextScene).toBe("Results");

  await page.keyboard.press("Enter");
  await waitForScene(page, "Results");
  expect(await activeScenes(page)).toContain("Results");
});

test("screen 12 Pluto's beacon hands over to the ending card, not to Results", async ({
  page,
}) => {
  // The ending card runs ~3.8 s of scene time, which headless stretches well
  // past the default per-test budget.
  test.setTimeout(120_000);
  await openBeacon(page, "pluto");
  expect((await snap<BeaconSnapshot>(page, "beacon")).nextScene).toBe("Ending");

  await page.keyboard.press("Enter");
  await waitForScene(page, "Ending");
  expect(await activeScenes(page)).toContain("Ending");

  // The ending card blinks seven beacons and says Shadow's closing line. The
  // beacons light on the scene clock, which headless runs far slower than wall
  // time, so this waits on the state rather than on a stopwatch.
  await waitForSnapshot(page, "ending", "litCount", 7, 60_000);
  await waitForSnapshot(page, "ending", "shadowLineVisible", true, 60_000);
  const ending = await page.evaluate(() => {
    const e = (window as unknown as { __kb: Record<string, unknown> }).__kb["ending"] as { snapshot: () => Record<string, unknown> };
    return e.snapshot();
  });
  expect(ending["beacons"]).toBe(7);
  expect(ending["litCount"]).toBe(7);
  expect(ending["litOrder"]).toEqual([
    "earth",
    "mars",
    "jupiter",
    "saturn",
    "uranus",
    "neptune",
    "pluto",
  ]);
  expect(ending["shadowLineVisible"]).toBe(true);
  expect(String(ending["shadowLine"])).toBe(
    "Every ship that comes after us will see these. You drew the map.",
  );
  expect(ending["nextScene"]).toBe("Results");
});

test("AC-22b.1 nothing on the beacon screen reads as punishment", async ({ page }) => {
  await openBeacon(page);
  const s = await snap<BeaconSnapshot>(page, "beacon");
  const seen = (await texts(page, "beacon")).join(" ").toLowerCase();
  for (const word of PUNISHING_WORDS) {
    if (word === "#") continue; // hex is never rendered; the guard is for copy
    expect(seen).not.toContain(word);
  }
  for (const ink of await inks(page, "beacon")) {
    expect(readsAsRed(ink.color, s.accent), `"${ink.text}" in ${ink.color}`).toBe(false);
  }
});
