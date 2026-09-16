import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROGRESS_VARIANTS,
  STOPS,
  expectNoPunishment,
  mount,
  snapshot,
  transitions,
} from "./story-lane";

/**
 * Screen inventory row 3 - Director map (D13, D40, D27, D43).
 *
 * The inventory demands three variants - "Mars only unlocked", "mid-run" and
 * "all seven" - so each is mounted here and each leaves a screenshot in
 * `gauntlet/evidence/`, which is where the visual rubric looks for evidence
 * rather than taking a description of it (D85).
 *
 * ACs covered: AC-18.1 (keyboard alone, visible focus), AC-18.3 (personal-best
 * board, no global rank), AC-4.4/D27 (star rating per charted stop),
 * AC-22b.1 (locked is never punishment), D13 (charted stops blink), D40
 * (entry points to the Beacon Log and Settings).
 */

const HERE = dirname(fileURLToPath(import.meta.url));

const KEY = "DirectorMap";
const EVIDENCE = resolve(HERE, "../../gauntlet/evidence");

interface StopRow {
  stopId: string;
  charted: boolean;
  locked: boolean;
  stars: number;
  bestWpm: number;
}

const rows = (s: Awaited<ReturnType<typeof snapshot>>): StopRow[] =>
  s["stops"] as StopRow[];

test.describe("Director map (row 3, D13/D40)", () => {
  test("D13 variant: Mars only unlocked - Earth blinks, everything past Mars is dark but visible", async ({
    page,
  }) => {
    await mount(page, KEY, { progress: PROGRESS_VARIANTS.marsOnly });
    const s = await snapshot(page, KEY);
    const stops = rows(s);

    // All seven are drawn, always. A locked stop is dark, never absent.
    expect(stops.map((r) => r.stopId)).toEqual([...STOPS]);
    expect(s.litCount).toBe(1);
    expect(stops.find((r) => r.stopId === "mars")?.locked).toBe(false);
    expect(stops.find((r) => r.stopId === "jupiter")?.locked).toBe(true);
    expect(stops.find((r) => r.stopId === "pluto")?.locked).toBe(true);
    expectNoPunishment(s.text);

    mkdirSync(EVIDENCE, { recursive: true });
    await page.locator("canvas").screenshot({ path: `${EVIDENCE}/map-mars-only.png` });
  });

  test("D13 variant: mid-run - the lit path stops at the furthest beacon", async ({ page }) => {
    await mount(page, KEY, { progress: PROGRESS_VARIANTS.midRun });
    const s = await snapshot(page, KEY);
    const stops = rows(s);

    expect(s.litCount).toBe(4);
    expect(stops.find((r) => r.stopId === "saturn")?.charted).toBe(true);
    expect(stops.find((r) => r.stopId === "uranus")?.charted).toBe(false);
    // Saturn is cleared, so Uranus is open; Neptune is not.
    expect(stops.find((r) => r.stopId === "uranus")?.locked).toBe(false);
    expect(stops.find((r) => r.stopId === "neptune")?.locked).toBe(true);

    await page.locator("canvas").screenshot({ path: `${EVIDENCE}/map-mid-run.png` });
  });

  test("D13 variant: all seven - every beacon is lit and nothing is locked", async ({ page }) => {
    await mount(page, KEY, { progress: PROGRESS_VARIANTS.allSeven });
    const s = await snapshot(page, KEY);
    expect(s.litCount).toBe(7);
    expect(rows(s).every((r) => !r.locked)).toBe(true);

    await page.locator("canvas").screenshot({ path: `${EVIDENCE}/map-all-seven.png` });
  });

  test("D27 / AC-4.4 each charted stop shows its star rating", async ({ page }) => {
    await mount(page, KEY, { progress: PROGRESS_VARIANTS.allSeven });
    const s = await snapshot(page, KEY);
    const charted = rows(s).filter((r) => r.charted);
    expect(charted.length).toBe(7);
    // Earth is exempt: no belt, so no hull hits and no rating (types.ts).
    const rated = charted.filter((r) => r.stopId !== "earth");
    expect(rated.length).toBe(6);
    // Three glyphs per rated stop, DRAWN - not merely present in the model.
    expect(s["starGlyphs"]).toBeGreaterThanOrEqual(rated.length * 3);
    // The ratings on screen are the ones the profile carries.
    expect(rated.map((r) => r.stars)).toEqual(
      PROGRESS_VARIANTS.allSeven.filter((p) => p["stopId"] !== "earth").map((p) => p["stars"]),
    );
  });

  test("D43 / AC-18.3 the board is a personal best, never a global rank", async ({ page }) => {
    await mount(page, KEY, { progress: PROGRESS_VARIANTS.midRun });
    // Focus Mars, which has a cleared run.
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(120);
    let s = await snapshot(page, KEY);
    while (s.selected !== "mars") {
      await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(120);
      s = await snapshot(page, KEY);
    }

    const screen = s.text.join(" ");
    expect(screen).toContain("personal best");
    expect(screen).toContain("26 wpm");
    expect(screen).toContain("97% accurate");
    // AC-18.3: no global rank is rendered anywhere on this screen.
    for (const line of s.text) {
      expect(line).not.toMatch(/\brank\b/i);
      expect(line).not.toMatch(/\bleaderboard\b/i);
      expect(line).not.toMatch(/\bglobal\b/i);
      expect(line).not.toMatch(/#\s*\d+/);
    }
  });

  test("D43 a stop with no run says so instead of showing a zero", async ({ page }) => {
    await mount(page, KEY, { progress: PROGRESS_VARIANTS.marsOnly });
    let s = await snapshot(page, KEY);
    while (s.selected !== "pluto") {
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(100);
      s = await snapshot(page, KEY);
      if (s.selected === undefined) break;
    }
    expect(s.text.join(" ")).toContain("no run yet");
    expect(s.text.join(" ")).not.toContain("0 wpm");
  });

  test("D40 entry points to the Beacon Log and Settings live here", async ({ page }) => {
    await mount(page, KEY, { progress: PROGRESS_VARIANTS.midRun });
    const s = await snapshot(page, KEY);
    expect(s["entryPoints"]).toEqual(["beaconLog", "settings"]);
    expect(s.text.join(" ").toLowerCase()).toContain("beacon log");
    expect(s.text.join(" ").toLowerCase()).toContain("settings");
  });

  test("AC-18.1 arrows move a visible focus and enter flies to the briefing", async ({ page }) => {
    await mount(page, KEY, { progress: PROGRESS_VARIANTS.midRun });
    const first = await snapshot(page, KEY);
    // The map opens on the next stop to fly, not on Earth.
    expect(first.selected).toBe("uranus");
    expect(first.focusId).toBe("uranus");

    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(120);
    const moved = await snapshot(page, KEY);
    expect(moved.focusIndex).not.toBe(first.focusIndex);
    expect(moved.selected).toBe("saturn");

    await page.keyboard.press("Enter");
    await page.waitForFunction(() => {
      const s = window.__kb?.game.scene.getScene("Briefing") as
        | { scene: { isActive(): boolean } }
        | null;
      return s?.scene.isActive() === true;
    }, null, { timeout: 10_000 });
    expect(await transitions(page)).toContain("Briefing");
  });

  test("AC-22b.1 a locked stop can be focused and refuses nothing out loud", async ({ page }) => {
    await mount(page, KEY, { progress: PROGRESS_VARIANTS.marsOnly });
    let s = await snapshot(page, KEY);
    while (s.focusId !== "pluto") {
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(80);
      s = await snapshot(page, KEY);
    }
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);

    const after = await snapshot(page, KEY);
    // Still on the map, no transition fired, no telling-off.
    expect(after.scene).toBe("DirectorMap");
    expect(await transitions(page)).not.toContain("Briefing");
    expect(after.text.join(" ").toLowerCase()).toContain("locked");
    expectNoPunishment(after.text);
  });
});
