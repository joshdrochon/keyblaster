import { expect, test, type Page } from "@playwright/test";

/**
 * AC-17.3 — "Beacon persists to profile and blinks on the Director map
 * thereafter."
 *
 * Two halves, and the second one had nothing behind it anywhere in the suite.
 *
 * PERSISTS. Asserted against the real `ProfileStore` and a real reload, so the
 * claim is about localStorage and not about an init payload being handed from
 * one scene to the next. `playthrough.spec.ts` plays a whole run to get a
 * beacon placed and then checks the store; that test is the one that proves
 * PLACING works. This one is about what happens afterwards: the beacon is in
 * the profile, the browser is reloaded, and the map drawn from a cold boot
 * still shows it.
 *
 * BLINKS. `DirectorMapScene.snapshot()` reports `charted`, and a charted stop
 * whose lamp was drawn once and never again would report exactly the same
 * thing. Phaser's Graphics keeps no display list, so the only way to see a
 * pulse is to watch the draw happen: the beacon Graphics' own `fillCircle` is
 * wrapped for a few frames and the radii it is called with are recorded. The
 * halo radius carries the pulse, so a lamp that is not pulsing produces one
 * radius and a lamp that is produces a spread of them.
 *
 * The negative control is free and comes from the scene itself: `drawBeacon`
 * returns before drawing anything when the stop is not charted, so an
 * uncharted stop must record NO fills at all. If the recorder saw fills
 * everywhere, it would be measuring something other than the beacon.
 */

const MAP = "DirectorMap";

/**
 * Open the map with a profile that already has beacons placed.
 *
 * `lib/menus.seed` cannot be used: it waits for the DOM mirror, and the map is
 * a canvas scene with no mirror. The store calls are the same ones - the real
 * `ProfileStore`, through the real `updateProfile`, flushed to localStorage.
 */
async function openMapWithBeacons(page: Page, beacons: string[]): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await openMap(page);
  await page.evaluate((placed) => {
    const store = window.__kb!.services!.store as unknown as {
      profiles: { id: string }[];
      createProfile(spec: Record<string, unknown>): { id: string };
      updateProfile(id: string, fn: (p: Record<string, unknown>) => Record<string, unknown>): void;
      selectProfile(id: string): void;
      deleteProfile(id: string): void;
      flush(): void;
    };
    for (const existing of [...store.profiles]) store.deleteProfile(existing.id);
    const created = store.createProfile({
      name: "Ana",
      avatar: "avatar-1",
      shipId: "ship-1",
      shipName: "Lantern",
      settings: {},
    });
    store.updateProfile(created.id, (p) => ({
      ...p,
      progress: (p["progress"] as Record<string, unknown>[]).map((entry) =>
        placed.includes(entry["stopId"] as string)
          ? { ...entry, cleared: true, beaconPlacedAt: Date.UTC(2026, 8, 16) }
          : entry,
      ),
    }));
    store.selectProfile(created.id);
    store.flush();
  }, beacons);
  await openMap(page);
}

/** Cold-boot the Director map and wait for it to be running. */
async function openMap(page: Page): Promise<void> {
  await page.goto(`/?scene=${MAP}`);
  await expect(page.getByTestId("app")).toHaveAttribute("data-booted", "true");
  await page.waitForFunction(() => {
    const scene = window.__kb?.game.scene.getScene("DirectorMap") as unknown as {
      nodes?: unknown[];
    } | null;
    return scene !== null && scene !== undefined && (scene.nodes?.length ?? 0) > 0;
  });
  await page.waitForTimeout(400);
}

interface BeaconTrace {
  stopId: string;
  charted: boolean;
  radii: number[];
}

/**
 * Wrap every beacon lamp's `fillCircle`, let the scene run, and report what
 * each one actually drew. Nothing in `src/` is modified or read for this: the
 * wrapper sits on the live Graphics object and calls through.
 */
async function traceBeacons(page: Page, frames: number): Promise<BeaconTrace[]> {
  await page.evaluate(
    ([key]) => {
      const scene = window.__kb!.game.scene.getScene(key as string) as unknown as {
        nodes: { stopId: string; charted: boolean; beacon: Record<string, unknown> }[];
        __trace?: Record<string, number[]>;
      };
      scene.__trace = {};
      for (const node of scene.nodes) {
        const log: number[] = [];
        scene.__trace[node.stopId] = log;
        const graphics = node.beacon;
        const original = graphics["fillCircle"] as (
            x: number,
            y: number,
            r: number,
          ) => unknown;
        graphics["fillCircle"] = function wrapped(x: number, y: number, r: number) {
          log.push(r);
          return original.call(graphics, x, y, r);
        };
      }
    },
    [MAP] as const,
  );

  // Let the map run. 2600 ms is the scene's own blink period, so a window of
  // roughly that length sees a whole cycle whatever the frame rate.
  await page.waitForTimeout(Math.max(1200, frames * 16));

  return (await page.evaluate(
    ([key]) => {
      const scene = window.__kb!.game.scene.getScene(key as string) as unknown as {
        nodes: { stopId: string; charted: boolean }[];
        __trace: Record<string, number[]>;
      };
      return scene.nodes.map((n) => ({
        stopId: n.stopId,
        charted: n.charted,
        radii: scene.__trace[n.stopId] ?? [],
      }));
    },
    [MAP] as const,
  )) as BeaconTrace[];
}

const mapStops = (page: Page): Promise<{ stopId: string; charted: boolean }[]> =>
  page.evaluate(() => {
    const scene = window.__kb!.game.scene.getScene("DirectorMap") as unknown as {
      snapshot(): { stops: { stopId: string; charted: boolean }[] };
    };
    return scene.snapshot().stops;
  });

test("AC-17.3: a placed beacon survives a reload and is still charted on the map", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openMapWithBeacons(page, ["earth", "mars"]);

  const before = await mapStops(page);
  expect(before.filter((s) => s.charted).map((s) => s.stopId)).toEqual(["earth", "mars"]);

  // A real reload, and a cold boot of the map with no init payload anywhere:
  // whatever is on screen now came out of storage.
  await openMap(page);

  const stored = await page.evaluate(() => {
    const store = window.__kb!.services?.store as
      | { activeProfile(): { progress: { stopId: string; beaconPlacedAt: number | null }[] } | null }
      | undefined;
    return store?.activeProfile()?.progress.filter((p) => p.beaconPlacedAt !== null).map((p) => p.stopId) ?? null;
  });
  expect(stored, "the beacons never reached the profile store").toEqual(["earth", "mars"]);

  const after = await mapStops(page);
  expect(
    after.filter((s) => s.charted).map((s) => s.stopId),
    "the map drawn from storage no longer shows the beacons",
  ).toEqual(["earth", "mars"]);
});

test("AC-17.3: a charted stop's beacon blinks on the map, and an uncharted one draws no lamp", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openMapWithBeacons(page, ["earth", "mars"]);

  const traced = await traceBeacons(page, 160);
  expect(traced.length, "the map drew no stops at all").toBeGreaterThan(2);

  const lit = traced.filter((t) => t.charted);
  const dark = traced.filter((t) => !t.charted);
  expect(lit.map((t) => t.stopId)).toEqual(["earth", "mars"]);
  expect(dark.length, "every stop is charted, so there is no control").toBeGreaterThan(0);

  // THE CONTROL: a stop with no beacon draws no lamp at all.
  for (const t of dark) {
    expect(t.radii, `${t.stopId} has no beacon but drew a lamp`).toEqual([]);
  }

  for (const t of lit) {
    expect(t.radii.length, `${t.stopId}'s beacon was never drawn`).toBeGreaterThan(10);
    const halo = [...new Set(t.radii)];
    expect(
      halo.length,
      `${t.stopId}'s beacon drew one fixed size every frame - it is lit, not blinking`,
    ).toBeGreaterThan(3);
    // A pulse, not a flicker: the halo has to actually travel.
    expect(
      Math.max(...t.radii) - Math.min(...t.radii),
      `${t.stopId}'s beacon varies by less than a pixel`,
    ).toBeGreaterThan(2);
  }

  // The lamps are staggered along the route, so the map reads as a chain of
  // beacons rather than one thing flashing in seven places.
  const [first, second] = lit;
  expect(first!.radii.join(","), "two beacons blinked in perfect lockstep").not.toBe(
    second!.radii.join(","),
  );
});
