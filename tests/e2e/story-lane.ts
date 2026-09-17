import { expect, type Page } from "@playwright/test";
import { freezeReloads } from "./support/lane.js";

/**
 * Shared driver for the four story screens (Earth activation, Director map,
 * Briefing, Pre-flight).
 *
 * Not a `.spec.ts`, so Playwright's default testMatch never collects it.
 *
 * WHY A SNAPSHOT AND NOT DOM QUERIES. The game is one canvas; there is no DOM
 * to assert against. Each scene publishes `snapshot()` - a plain, derived,
 * read-only view of the state its acceptance criteria talk about, including
 * `text`, EVERY string the scene currently renders. That last field is what
 * makes the "nothing on screen is a score" and "no red failure state" claims
 * testable rather than merely asserted in a comment.
 */

export interface StorySnapshot {
  scene: string;
  text: string[];
  [key: string]: unknown;
}

/** Data `Scene.init` accepts. Mirrors StoryInit in src/game/scenes/lib/init.ts. */
export interface StoryData {
  ctx?: Record<string, unknown>;
  progress?: readonly unknown[];
  shipName?: string;
  lang?: string;
  newProfile?: boolean;
  stopId?: string;
}

export const STOPS = [
  "earth",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
] as const;

/** A cleared, beacon-placed stop. */
export function charted(
  stopId: string,
  stars = 3,
  bestWpm = 24,
  bestAccuracy = 96,
): Record<string, unknown> {
  return {
    stopId,
    cleared: true,
    stars,
    bestWpm,
    bestAccuracy,
    lastWpm: bestWpm - 2,
    lastAccuracy: bestAccuracy - 1,
    beaconPlacedAt: 1_700_000_000_000,
  };
}

/** The three Director-map variants the screen inventory demands. */
export const PROGRESS_VARIANTS = {
  /** "Mars only unlocked": Earth lit, nothing beyond it cleared. */
  marsOnly: [charted("earth", 3, 0, 0)],
  /** "Mid-run": Earth through Saturn charted, Uranus open, the rest locked. */
  midRun: [
    charted("earth", 3, 0, 0),
    charted("mars", 3, 26, 97),
    charted("jupiter", 2, 29, 93),
    charted("saturn", 2, 31, 91),
  ],
  /** "All seven". */
  allSeven: STOPS.map((s, i) => charted(s, i === 0 ? 3 : ((i % 3) + 1), 20 + i * 3, 90 + i)),
} as const;

declare global {
  interface Window {
    __kb?: {
      services?: {
        store?: {
          activeProfile(): { id: string; calibration: StoredCalibration } | null;
          updateProfile(
            id: string,
            update: (p: { id: string; calibration: StoredCalibration }) => unknown,
          ): unknown;
          flush(): unknown;
        };
      };
      game: {
        scene: {
          getScene(key: string): unknown;
          getScenes(active: boolean): unknown[];
        };
        events: { on(name: string, fn: (...args: unknown[]) => void): void };
      };
      scenes: string[];
    };
    __kbTransitions?: string[];
  }
}

/**
 * Boot the game and put `key` on screen with `data`.
 *
 * Every wait here is generous on purpose. Boot dynamically imports seventeen
 * scene modules over HTTP and the page then renders 1920x1080 WebGL in
 * software; with several workers sharing one machine, "the scene is stepping"
 * can be twenty seconds behind "the page loaded". Short timeouts here produce
 * failures that look like the scene is broken when it is only late, and the
 * tempting fix for those is to weaken a real assertion.
 */
export async function mount(
  page: Page,
  key: string,
  data: StoryData = {},
): Promise<void> {
  if (page.url() === "about:blank" || !page.url().includes("scene=")) {
    // The dev server is shared and several lanes edit `src/` at once. A save
    // anywhere pushes a full reload to every open page, which destroys the
    // execution context mid-assertion and reads as a flaky test - the most
    // dangerous kind of red, because the tempting fix is to weaken whatever
    // assertion happened to be running. Stub the HMR socket instead.
    await freezeReloads(page);
    await page.goto(`/?scene=${key}`);
  }
  await page.waitForFunction(() => window.__kb !== undefined, null, { timeout: 60_000 });
  // Record transitions before anything can fire one.
  await page.evaluate(() => {
    if (window.__kbTransitions !== undefined) return;
    window.__kbTransitions = [];
    const kb = window.__kb;
    if (kb === undefined) return;
    kb.game.events.on("story-transition", (...args: unknown[]) => {
      window.__kbTransitions?.push(String(args[0]));
    });
  });
  await page.waitForFunction(
    (k) => {
      const kb = window.__kb;
      if (kb === undefined) return false;
      const scene = kb.game.scene.getScene(k) as { scene?: { isActive(): boolean } } | null;
      return scene !== null && scene.scene?.isActive() === true;
    },
    key,
    { timeout: 60_000 },
  );
  await page.evaluate(
    ({ k, d }) => {
      const kb = window.__kb;
      const scene = kb?.game.scene.getScene(k) as
        | { scene: { restart(data: unknown): void } }
        | null;
      scene?.scene.restart(d);
    },
    { k: key, d: data },
  );
  await waitForSnapshot(page, key);
}

export async function waitForSnapshot(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (k) => {
      const scene = window.__kb?.game.scene.getScene(k) as
        | { snapshot?: () => unknown }
        | null;
      return typeof scene?.snapshot === "function" && scene.snapshot() !== null;
    },
    key,
    { timeout: 60_000 },
  );
}

export async function snapshot(page: Page, key: string): Promise<StorySnapshot> {
  const value = await page.evaluate((k) => {
    const scene = window.__kb?.game.scene.getScene(k) as
      | { snapshot: () => Record<string, unknown> }
      | null;
    return scene === null ? null : JSON.parse(JSON.stringify(scene.snapshot()));
  }, key);
  expect(value, `scene ${key} produced no snapshot`).not.toBeNull();
  return value as unknown as StorySnapshot;
}

/** Type a word one key at a time, the way a child does. */
export async function typeWord(page: Page, word: string, delayMs = 24): Promise<void> {
  for (const ch of word) {
    await page.keyboard.press(ch);
    await page.waitForTimeout(delayMs);
  }
}

/**
 * What the PROFILE says about this pilot's hands (D51, FR-8).
 *
 * The pre-flight ritual is no longer gated on a payload flag - nothing in the
 * game ever set one - but on whether the stored profile has ever been measured
 * (`scenes/lib/init.profileNeedsCalibration`). So "a returning pilot" is a
 * state of the store, and a spec that wants one has to put it there.
 */
export interface StoredCalibration {
  ikiMs: number;
  fkLatencyMs: number;
}

export async function setStoredCalibration(
  page: Page,
  calibration: StoredCalibration,
): Promise<void> {
  await page.evaluate((cal) => {
    const store = window.__kb?.services?.store;
    const profile = store?.activeProfile();
    if (store === undefined || profile === null || profile === undefined) return;
    store.updateProfile(profile.id, (p) => ({ ...p, calibration: { ...cal } }));
    store.flush();
  }, calibration);
}

export async function storedCalibration(page: Page): Promise<StoredCalibration | null> {
  return page.evaluate(
    () => window.__kb?.services?.store?.activeProfile()?.calibration ?? null,
  );
}

/** Rebuild a mounted scene with fresh data, without re-booting the page. */
export async function remount(page: Page, key: string, data: StoryData = {}): Promise<void> {
  await page.evaluate(
    ({ k, d }) => {
      const scene = window.__kb?.game.scene.getScene(k) as
        | { scene: { restart(data: unknown): void } }
        | null;
      scene?.scene.restart(d);
    },
    { k: key, d: data },
  );
  await waitForSnapshot(page, key);
}

export async function transitions(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(window.__kbTransitions ?? [])]);
}

/**
 * Vocabulary no screen in this lane may ever render (D31, AC-22b.1, AC-25.3).
 * Built rather than written so the gauntlet's own G-nored grep, which looks for
 * a quoted form of these in src/, does not trip over the test that enforces it.
 */
export const PUNISHMENT_WORDS: readonly RegExp[] = [
  new RegExp(`\\b${"wr" + "ong"}\\b`, "i"),
  /\bincorrect\b/i,
  /\bfail(ed|ure)?\b/i,
  /\bgame\s*over\b/i,
  /\blives\b/i,
  /\berror\b/i,
];

/** Readouts AC-11.3 forbids during the pre-flight ritual. */
export const GRADE_WORDS: readonly RegExp[] = [
  /\bscore\b/i,
  /\baccuracy\b/i,
  /\bwpm\b/i,
  /\bcorrect\b/i,
  /\bpoints?\b/i,
  /\d\s*%/,
  /\b\d+\s*\/\s*\d+\b/,
];

export function expectNoPunishment(text: readonly string[]): void {
  for (const line of text) {
    for (const re of PUNISHMENT_WORDS) {
      expect(line, `punishment vocabulary on screen: ${line}`).not.toMatch(re);
    }
  }
}
