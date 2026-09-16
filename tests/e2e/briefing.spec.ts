import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PUNISHMENT_WORDS,
  expectNoPunishment,
  mount,
  snapshot,
  transitions,
} from "./story-lane";
import {
  checkWord,
  createAllowlist,
  isBlocked,
  normalizeWord,
  tokenize,
  MAX_WORD_LENGTH,
} from "../../src/engine/allowlist/index.js";

/**
 * Screen inventory row 4 - Briefing, and the stage-bundle content it renders.
 *
 * Two halves, on purpose:
 *
 *  1. THE SCREEN. Picture-book page inside a cockpit, planet through a window,
 *     Shadow present, one button. AC-18.1, C07.
 *  2. THE CONTENT. Every shipped word validated against `@engine/allowlist`
 *     and against the PRD's content rules. This half runs in Node with no
 *     browser, and it is the half that must FAIL rather than let a bad word
 *     ship: AC-12.2 (every belt stop has the five parts), AC-12.3 (every
 *     content word of a warp sentence is in that stage's pool), AC-13.2 (no
 *     blocked word anywhere), AC-25.3 (Shadow never says the forbidden word).
 *
 * THE ALLOWLIST THIS USES. `scripts/compile-allowlist` (architecture 5.2) has
 * not run, so there is no Fry-1000 on disk. The list is built per stop from the
 * stop's own pool plus `content/en/sight-words.json` plus its proper nouns, and
 * `createAllowlist` DROPS anything blocked or over-length on the way in - so a
 * blocked or 13+ letter pool word is absent from the list it was built from and
 * `checkWord` rejects it. The check is therefore not circular for exactly the
 * failure modes it exists to catch.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

const KEY = "Briefing";
const CONTENT = resolve(HERE, "../../src/content/en");
const EVIDENCE = resolve(HERE, "../../gauntlet/evidence");

interface Bundle {
  stopId: string;
  planetName: string;
  chapterTitle: string;
  briefing: string[];
  pool: string[];
  properNouns: string[];
  preflightLine: string;
  activationWord: string | null;
  warpSentence: string | null;
  beaconHeadline: string;
  beaconState: string;
  beaconFlavor: string;
}

const read = <T,>(file: string): T =>
  JSON.parse(readFileSync(resolve(CONTENT, file), "utf8")) as T;

const SIGHT = read<{ words: string[] }>("sight-words.json").words;

const BUNDLE_FILES = readdirSync(CONTENT).filter(
  (f) => f.endsWith(".json") && f !== "sight-words.json" && f !== "ui.json",
);
const BUNDLES = BUNDLE_FILES.map((f) => read<Bundle>(f));
const BELT = BUNDLES.filter((b) => b.stopId !== "earth");

const allowlistFor = (b: Bundle) =>
  createAllowlist({
    lang: "en",
    words: [...b.pool, ...SIGHT, ...(b.activationWord === null ? [] : [b.activationWord])],
    properNouns: b.properNouns,
  });

// ---------------------------------------------------------------------------
// Content (Node only - no browser)
// ---------------------------------------------------------------------------

test.describe("Stage bundles (AC-12.2, AC-12.3, AC-13.2, AC-25.3)", () => {
  test("AC-12.2 all seven stops ship a bundle and every belt stop has all five parts", () => {
    expect(BUNDLES.map((b) => b.stopId).sort()).toEqual([
      "earth", "jupiter", "mars", "neptune", "pluto", "saturn", "uranus",
    ]);
    for (const b of BELT) {
      expect(b.briefing.length, `${b.stopId} briefing length`).toBeGreaterThanOrEqual(3);
      expect(b.briefing.length, `${b.stopId} briefing length`).toBeLessThanOrEqual(5);
      expect(b.pool.length, `${b.stopId} pool`).toBeGreaterThan(10);
      expect(b.preflightLine.length, `${b.stopId} pre-flight line`).toBeGreaterThan(10);
      expect(b.warpSentence, `${b.stopId} warp sentence`).not.toBeNull();
      expect(b.beaconFlavor.length, `${b.stopId} beacon text`).toBeGreaterThan(10);
    }
    // D57: Earth is the launchpad. No belt, no warp sentence, one word.
    const earth = BUNDLES.find((b) => b.stopId === "earth");
    expect(earth?.pool).toEqual([]);
    expect(earth?.warpSentence).toBeNull();
    expect(earth?.activationWord).toBe("launch");
  });

  for (const b of BUNDLES) {
    test(`AC-13.2 every ${b.stopId} pool word passes @engine/allowlist`, () => {
      const list = allowlistFor(b);
      for (const word of b.pool) {
        // Normalised on the way in, or the asteroid plate and the WordRecord
        // key disagree about what the child typed.
        expect(normalizeWord(word), `"${word}" is not in normal form`).toBe(word);
        expect(isBlocked(word), `"${word}" is on the blocklist`).toBe(false);
        expect(word.length, `"${word}" is longer than a word plate`).toBeLessThanOrEqual(
          MAX_WORD_LENGTH,
        );
        expect(checkWord(word, list), `"${word}" was refused`).toBeNull();
      }
    });

    test(`AC-13.2 every word a child READS at ${b.stopId} is on the allowlist`, () => {
      const list = allowlistFor(b);
      const prose = [
        ...b.briefing.map((s) => s.replace(/\{shipName\}/g, "")),
        b.warpSentence ?? "",
        b.beaconFlavor,
      ].join(" ");
      const unknown = tokenize(prose, "en").filter((w) => !list.hasReadable(w));
      // A word added to a briefing without being added to the pool, the proper
      // nouns or sight-words.json fails HERE rather than reaching a child.
      expect(unknown, `${b.stopId} briefing has unlisted words`).toEqual([]);
    });
  }

  for (const b of BELT) {
    test(`AC-12.3 every content word of the ${b.stopId} warp sentence is in its pool`, () => {
      const sight = new Set(SIGHT.map((w) => normalizeWord(w)));
      const pool = new Set(b.pool);
      const content = tokenize(b.warpSentence ?? "", "en").filter((w) => !sight.has(w));
      expect(content.length, `${b.stopId} warp sentence has no content words`).toBeGreaterThan(0);
      for (const word of content) {
        expect(pool.has(word), `"${word}" is not in the ${b.stopId} pool`).toBe(true);
      }
    });
  }

  test("AC-25.3 no shipped Shadow line contains a punishing word", () => {
    for (const b of BUNDLES) {
      const spoken = [b.preflightLine, b.beaconFlavor].join(" ");
      for (const re of PUNISHMENT_WORDS) {
        expect(spoken, `${b.stopId}: ${spoken}`).not.toMatch(re);
      }
    }
  });

  test("C07 no shipped copy names the ship; it uses {shipName}", () => {
    for (const b of BUNDLES) {
      const all = [...b.briefing, b.preflightLine, b.beaconFlavor].join(" ");
      expect(all, `${b.stopId} names the ship`).not.toMatch(/lantern/i);
    }
    const earth = BUNDLES.find((b) => b.stopId === "earth");
    expect(earth?.briefing.join(" ")).toContain("{shipName}");
  });
});

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

test.describe("Briefing (row 4)", () => {
  test("the page is 3-5 story sentences, not a worksheet", async ({ page }) => {
    await mount(page, KEY, { stopId: "mars" });
    const s = await snapshot(page, KEY);
    const mars = BUNDLES.find((b) => b.stopId === "mars");

    expect(s.sentenceCount).toBeGreaterThanOrEqual(3);
    expect(s.sentenceCount).toBeLessThanOrEqual(5);
    expect(s.planetName).toBe(mars?.planetName);
    const screen = s.text.join(" ");
    for (const sentence of mars?.briefing ?? []) {
      expect(screen).toContain(sentence);
    }
    expect(screen).toContain(mars?.chapterTitle ?? "");
    // No worksheet furniture: nothing numbered, nothing to fill in.
    for (const line of s.text) {
      expect(line).not.toMatch(/^\s*\d+[.)]\s/);
      expect(line).not.toMatch(/_{3,}/);
      expect(line).not.toMatch(/\bquestion\b/i);
    }
    expectNoPunishment(s.text);

    mkdirSync(EVIDENCE, { recursive: true });
    await page.locator("canvas").screenshot({ path: `${EVIDENCE}/briefing-mars.png` });
  });

  test("the same layout dresses a second stop (inventory variant: Saturn)", async ({ page }) => {
    await mount(page, KEY, { stopId: "saturn" });
    const s = await snapshot(page, KEY);
    expect(s.planetName).toBe("Saturn");
    expect(s.sentenceCount).toBe(5);
    expect(s.buttonCount).toBe(1);
    await page.locator("canvas").screenshot({ path: `${EVIDENCE}/briefing-saturn.png` });
  });

  test("C07 the ship is named from the profile, never hard-coded", async ({ page }) => {
    await mount(page, KEY, { stopId: "mars", shipName: "Nomad" });
    const s = await snapshot(page, KEY);
    const screen = s.text.join(" ");
    expect(screen).toContain("Nomad");
    expect(screen).not.toMatch(/lantern/i);
    expect(screen).not.toContain("{shipName}");
  });

  test("AC-18.1 one button, reachable and operable by keyboard alone", async ({ page }) => {
    await mount(page, KEY, { stopId: "mars" });
    const s = await snapshot(page, KEY);
    expect(s.buttonCount).toBe(1);
    expect(s.focusId).toBe("launch");

    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => (window.__kbTransitions ?? []).includes("Preflight"),
      null,
      { timeout: 30_000 },
    );
    expect(await transitions(page)).toContain("Preflight");
  });

  test("AC-18.1 escape returns to the map", async ({ page }) => {
    await mount(page, KEY, { stopId: "mars" });
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => (window.__kbTransitions ?? []).includes("DirectorMap"),
      null,
      { timeout: 30_000 },
    );
  });
});
