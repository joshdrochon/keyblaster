import { type Locator, type Page, expect } from "@playwright/test";

/**
 * Shared helpers for the five menu screens' e2e suites.
 *
 * WHY A DOM MIRROR AND NOT SCREENSHOTS. Phaser renders to a canvas, so
 * Playwright can see nothing inside it. Every screen in this lane publishes an
 * off-screen DOM shadow of what it is showing (`src/game/ui/mirror.ts`) - which
 * is also what makes the game legible to a screen reader - and these helpers
 * read that. Pixel claims stay with the visual-evidence runner; behaviour
 * claims are made here, against structure.
 *
 * Not a spec file: Playwright's default testMatch only collects `*.spec.ts`.
 */

export interface SeedProfile {
  name: string;
  avatar?: string;
  shipId?: string;
  shipName?: string;
  /** Stop ids whose beacons are placed, in route order. */
  beacons?: string[];
  trophies?: string[];
  unlockedShips?: string[];
  unlockedSkins?: string[];
  settings?: Record<string, unknown>;
}

interface KbWindow {
  __kb?: {
    game: {
      scene: { getScene(key: string): { snapshot?(): Record<string, unknown> } | null };
      sound: { volume: number };
    };
    services: {
      context: Record<string, unknown>;
      store: {
        profiles: { id: string }[];
        createProfile(input: Record<string, unknown>): { id: string };
        updateProfile(
          id: string,
          update: (p: Record<string, unknown>) => Record<string, unknown>,
        ): unknown;
        selectProfile(id: string): boolean;
        deleteProfile(id: string): boolean;
        activeProfile(): Record<string, unknown> | null;
        flush(): unknown;
      };
    };
  };
}

/** Boot the game straight into one scene. `?scene=` is boot.ts's own hook. */
export async function open(
  page: Page,
  scene: string,
  query = "",
): Promise<void> {
  await page.goto(`/?scene=${scene}${query}`);
  await page.waitForFunction(
    () => (window as unknown as KbWindow).__kb?.game !== undefined,
  );
  await screen(page, scene).waitFor({ state: "attached" });
}

export function screen(page: Page, scene: string): Locator {
  return page.locator(`[data-testid="ui-screen"][data-scene="${scene}"]`);
}

export function items(page: Page, scene: string): Locator {
  return screen(page, scene).locator('[data-testid="ui-item"]');
}

export function item(page: Page, scene: string, id: string): Locator {
  return screen(page, scene).locator(`[data-testid="ui-item"][data-id="${id}"]`);
}

export function focused(page: Page, scene: string): Locator {
  return screen(page, scene).locator('[data-testid="ui-item"][data-focused="true"]');
}

export function dialog(page: Page, scene: string): Locator {
  return screen(page, scene).locator('[data-testid="ui-dialog"]');
}

export function notice(page: Page, scene: string): Locator {
  return screen(page, scene).locator('[data-testid="ui-notice"]');
}

export function toasts(page: Page): Locator {
  return page.locator('[data-testid="ui-toast"]');
}

/** The scene's own snapshot object, for facts the DOM mirror does not carry. */
export async function snapshot(
  page: Page,
  scene: string,
): Promise<Record<string, unknown>> {
  return page.evaluate((key) => {
    const kb = (window as unknown as KbWindow).__kb;
    const s = kb?.game.scene.getScene(key);
    return s?.snapshot?.() ?? {};
  }, scene);
}

/** The active profile as persisted. Reads boot's store, not a second one. */
export async function activeProfile(
  page: Page,
): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    const kb = (window as unknown as KbWindow).__kb;
    return kb?.services.store.activeProfile() ?? null;
  });
}

export async function settings(page: Page): Promise<Record<string, unknown>> {
  const profile = await activeProfile(page);
  return (profile?.["settings"] as Record<string, unknown>) ?? {};
}

/**
 * Write a set of pilots straight through the real store, then reload into the
 * target scene so the test exercises the real load path (AC-18.4's loader is
 * total; a fixture that bypasses it would prove nothing about it).
 */
export async function seed(
  page: Page,
  profiles: SeedProfile[],
  scene: string,
  query = "",
): Promise<void> {
  await open(page, scene);
  await page.evaluate((list) => {
    const kb = (window as unknown as KbWindow).__kb;
    const store = kb?.services.store;
    if (!store) return;
    for (const existing of [...store.profiles]) store.deleteProfile(existing.id);
    for (const spec of list) {
      const created = store.createProfile({
        name: spec.name,
        avatar: spec.avatar ?? "avatar-1",
        shipId: spec.shipId ?? "ship-1",
        shipName: spec.shipName ?? "Lantern",
        settings: spec.settings ?? {},
      });
      store.updateProfile(created.id, (p) => {
        const progress = (p["progress"] as Record<string, unknown>[]).map(
          (entry) =>
            (spec.beacons ?? []).includes(entry["stopId"] as string)
              ? { ...entry, cleared: true, beaconPlacedAt: Date.UTC(2026, 8, 16) }
              : entry,
        );
        return {
          ...p,
          progress,
          trophies: spec.trophies ?? [],
          unlockedShips: spec.unlockedShips ?? [spec.shipId ?? "ship-1"],
          unlockedSkins: spec.unlockedSkins ?? [],
        };
      });
    }
    const first = store.profiles[0];
    if (first) store.selectProfile(first.id);
    store.flush();
  }, profiles);
  await open(page, scene, query);
}

/** Wipe storage so a spec starts from a first run. */
export async function clearStorage(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
}

/**
 * AC-18.2 / D43 / NFR-3, asserted as the PRD declares it: a DOM assertion that
 * no email field exists anywhere. Checked three ways because each one alone has
 * a hole: no email input, no text input at all (the canvas has none, so a form
 * could only arrive as DOM), and the word itself nowhere in the served page.
 */
export async function assertNoEmailField(page: Page): Promise<void> {
  await expect(page.locator('input[type="email"]')).toHaveCount(0);
  await expect(page.locator("input, textarea, form, select")).toHaveCount(0);
  const html = await page.content();
  expect(html.toLowerCase()).not.toContain("email");
  expect(html.toLowerCase()).not.toContain("e-mail");
}

/**
 * AC-18.1 as a reusable check: focus lands on exactly one element, that element
 * is reported focused, and the canvas focus ring is actually drawn.
 */
export async function assertVisibleFocus(
  page: Page,
  scene: string,
): Promise<void> {
  await expect(focused(page, scene)).toHaveCount(1);
  await expect(screen(page, scene)).toHaveAttribute("data-focus-ring", "true");
  const snap = await snapshot(page, scene);
  expect(snap["focusRing"]).toBe(true);
  expect(snap["focusId"]).toBeTruthy();
}

/** Press a key and let Phaser's next frame republish the mirror. */
export async function press(page: Page, key: string, times = 1): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await page.keyboard.press(key);
    await page.waitForTimeout(60);
  }
}

/**
 * Walk focus to a control by id using ONLY the keyboard (D37).
 *
 * Takes the shortest way round the list rather than stepping blindly: the
 * Beacon Log has nineteen rows, and a blind two-lap walk is slow enough to eat
 * a test timeout without telling you anything about the game.
 */
export async function focusItem(
  page: Page,
  scene: string,
  id: string,
): Promise<void> {
  await item(page, scene, id).waitFor({ state: "attached" });
  const ids = await items(page, scene).evaluateAll((nodes) =>
    nodes.map((n) => n.getAttribute("data-id") ?? ""),
  );
  const target = ids.indexOf(id);
  if (target < 0) {
    throw new Error(`"${id}" is not on ${scene}`);
  }
  const current = await screen(page, scene).getAttribute("data-focus");
  const from = current === null ? 0 : Math.max(0, ids.indexOf(current));
  const n = ids.length;
  const down = (target - from + n) % n;
  const up = (from - target + n) % n;
  if (down <= up) await press(page, "ArrowDown", down);
  else await press(page, "ArrowUp", up);

  const landed = await screen(page, scene).getAttribute("data-focus");
  if (landed !== id) {
    throw new Error(
      `keyboard navigation landed on "${landed}" instead of "${id}" on ${scene}`,
    );
  }
}
