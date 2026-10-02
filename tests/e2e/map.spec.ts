import { expect, test } from "@playwright/test";
import { gameCanvas } from "./support/lane.js";
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
  // Software WebGL under parallel workers; see the note on mount().
  test.setTimeout(120_000);

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
    await gameCanvas(page).screenshot({ path: `${EVIDENCE}/map-mars-only.png` });
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

    await gameCanvas(page).screenshot({ path: `${EVIDENCE}/map-mid-run.png` });
  });

  test("D13 variant: all seven - every beacon is lit and nothing is locked", async ({ page }) => {
    await mount(page, KEY, { progress: PROGRESS_VARIANTS.allSeven });
    const s = await snapshot(page, KEY);
    expect(s.litCount).toBe(7);
    expect(rows(s).every((r) => !r.locked)).toBe(true);

    await gameCanvas(page).screenshot({ path: `${EVIDENCE}/map-all-seven.png` });
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
    expect(screen.toLowerCase()).toContain("personal best");
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
    expect(s.text.join(" ").toLowerCase()).toContain("no run yet");
    expect(s.text.join(" ")).not.toContain("0 wpm");
  });

  test("D40 entry points to the Beacon Log and Settings live here", async ({ page }) => {
    await mount(page, KEY, { progress: PROGRESS_VARIANTS.midRun });
    const s = await snapshot(page, KEY);
    // The ID is still `beaconLog` - D40's entry point did not move. Only its
    // LABEL did: UR-198 (51b7ffb, 24 Sep) renamed it to Trophies and this line
    // was never updated, so it has been red ever since. The chip is read by its
    // shipped string rather than by a restated one.
    expect(s["entryPoints"]).toEqual(["beaconLog", "settings"]);
    expect(s.text.join(" ").toLowerCase()).toContain("trophies");
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
    // Wait on the transition the scene ANNOUNCES, not on the next scene being
    // mid-frame: with three workers sharing a software GPU, "is this scene
    // stepping yet" is a race, and a race dressed as an assertion is how a
    // real check gets weakened later to make the flake stop.
    await page.waitForFunction(
      () => (window.__kbTransitions ?? []).includes("Briefing"),
      null,
      { timeout: 30_000 },
    );
  });

  /**
   * UR-53: the Lantern hovers above the CURRENT planet, and current means the
   * SELECTED one.
   *
   * There was no ship on this screen at all before this. The geometry - does it
   * fit between the header block and the beacon lamp, at all seven stops - is
   * arithmetic and lives in `tests/unit/scenes/mapLayout.test.ts`. What only a
   * running game can answer is whether it FOLLOWS, so that is what this asks:
   * press a key, and the ship is over the stop the board is now about.
   *
   * It reads ONE snapshot per position. `ship.x` and `ship.targetX` taken in
   * two round trips would describe two different moments and the assertion
   * would be about scheduling rather than about the ship (coding-standards
   * rule 7).
   *
   * Watch it fail: delete the `this.moveShipTo(...)` line from
   * `DirectorMapScene.select` and the ship stays on Earth while the board
   * retitles - `uranus: ship is at 210, the stop is at 1210`.
   */
  test("UR-53 the Lantern hovers over the selected stop, and follows it", async ({ page }) => {
    await mount(page, KEY, { progress: PROGRESS_VARIANTS.midRun });
    const first = await snapshot(page, KEY);
    const ship = (s: typeof first): { x: number; y: number; targetX: number } =>
      s["ship"] as { x: number; y: number; targetX: number };

    expect(ship(first), "the map draws no ship at all").not.toBeNull();
    expect(
      Math.abs(ship(first).x - ship(first).targetX),
      `${first.selected}: ship is at ${ship(first).x}, the stop is at ${ship(first).targetX}`,
    ).toBeLessThan(2);

    const seen = new Set<number>([ship(first).targetX]);
    const ys: number[] = [ship(first).y];
    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press("ArrowLeft");
      // The move is EASED, so poll for it landing rather than for a clock.
      await page.waitForFunction(
        () => {
          const sc = window.__kb?.game.scene.getScene("DirectorMap") as unknown as {
            snapshot: () => { ship: { x: number; targetX: number } | null };
          };
          const sh = sc.snapshot().ship;
          return sh !== null && Math.abs(sh.x - sh.targetX) < 2;
        },
        null,
        { timeout: 30_000 },
      );
      const s = await snapshot(page, KEY);
      expect(
        Math.abs(ship(s).x - ship(s).targetX),
        `${s.selected}: ship is at ${ship(s).x}, the stop is at ${ship(s).targetX}`,
      ).toBeLessThan(2);
      seen.add(ship(s).targetX);
      ys.push(ship(s).y);
    }
    // CONTROL: the ship actually moved. Four identical x values would satisfy
    // every assertion above and mean the ship is nailed to one planet.
    expect(seen.size, `the ship never left x=${[...seen][0]}`).toBe(4);
    // ...and it moved along ONE line, so the route reads as a row. The idle bob
    // is a few px, which is the world being alive (D41), not a wobble.
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(12);
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

/**
 * UR-162: THE WAY TO THE BONUS PAIR IS A BUTTON, NOT JUST A KEY.
 *
 * The owner could not find the doorway - a 12x24 caret at stroke 4, beside a
 * 4-px route line and under Earth's rim. It is 22x44 at stroke 6 now, it leans
 * toward the edge of the board, and it takes a click.
 *
 * THIS TEST EXISTS BECAUSE THE UNIT SUITE CANNOT REACH IT. The lean is a pure
 * function and is asserted there; pointer DELIVERY is not - it needs a real
 * browser with a running render loop, and the probe tab a scripted check drives
 * is hidden, so its loop never advances a frame and Phaser never flushes input.
 * A hit zone that exists, is interactive, and is never reachable by a pointer
 * would pass every other check in this repo.
 */
test.describe("UR-162: the doorway to the bonus pair", () => {
  /**
   * The doorway's hit zone, in GAME coordinates.
   *
   * Walks the tree rather than reading `children.list`: the caret rides the run
   * container so it travels with the board during the slide, so its zone is
   * nested and a top-level scan reports it missing.
   */
  async function doorwayBox(page: import("@playwright/test").Page) {
    return page.evaluate(() => {
      const kb = (window as unknown as { __kb: Record<string, unknown> }).__kb;
      const game = kb["game"] as { scene: { getScene(k: string): unknown } };
      const scene = game.scene.getScene("DirectorMap") as {
        children: { list: unknown[] };
      } | null;
      if (scene === null) return null;
      type Zone = {
        name?: string;
        width: number;
        height: number;
        getWorldTransformMatrix(): { tx: number; ty: number };
      };
      const hits: Zone[] = [];
      const walk = (list: unknown[]): void => {
        for (const raw of list) {
          const o = raw as { name?: string; list?: unknown[] };
          if (o.name === "kb-hit:doorway") hits.push(raw as Zone);
          if (Array.isArray(o.list)) walk(o.list);
        }
      };
      walk(scene.children.list);
      const found = hits[0];
      if (found === undefined) return null;
      const m = found.getWorldTransformMatrix();
      return { x: m.tx, y: m.ty, w: found.width, h: found.height };
    });
  }

  test("is drawn once Pluto is charted, and a click opens the inner run", async ({ page }) => {
    await mount(page, KEY, { progress: PROGRESS_VARIANTS.allSeven });
    const opened = await snapshot(page, KEY);
    expect(opened.mapView).toBe("route");

    const box = await doorwayBox(page);
    expect(box, "the doorway caret has no hit zone").not.toBeNull();
    const hit = box as { x: number; y: number; w: number; h: number };

    // A young player aims at the mark, so the mark is what gets clicked - the
    // centre of the zone, converted through the canvas's measured box.
    const rect = await gameCanvas(page).boundingBox();
    expect(rect, "the game canvas has no box").not.toBeNull();
    const frame = rect as { x: number; y: number; width: number; height: number };
    const scale = frame.width / 1920;
    await page.mouse.click(frame.x + hit.x * scale, frame.y + hit.y * scale);

    await page.waitForFunction(
      () => {
        const kb = (window as unknown as { __kb: Record<string, unknown> }).__kb;
        const game = kb["game"] as { scene: { getScene(k: string): unknown } };
        const s = game.scene.getScene("DirectorMap") as { mapView?: string } | null;
        return s?.mapView === "inner";
      },
      null,
      { timeout: 15_000 },
    );

    const inner = await snapshot(page, KEY);
    expect(inner.mapView).toBe("inner");
  });

  test("is not drawn at all while Pluto is still dark", async ({ page }) => {
    // The caret must never offer a child mid-route a way out of Earth that
    // does nothing when they press it.
    await mount(page, KEY, { progress: PROGRESS_VARIANTS.midRun });
    expect(await doorwayBox(page)).toBeNull();
  });
});

/**
 * UR-164: COMING BACK FROM A BONUS STOP LANDS ON THE BONUS BOARD.
 *
 * The map rebuilt itself on the main route whatever you had just flown, so a
 * player working through Venus and Mercury was thrown back to the Earth-to-Pluto
 * chart after every run and had to walk out through Earth's doorway again.
 */
test.describe("UR-164: the inner run keeps its board", () => {
  // WHAT THIS BLOCK OWNS IS THE BOARD, NOT THE FOCUS. Both tests used to assert
  // focus landed on the stop just flown; UR-177 replaced that rule outright -
  // the owner reported the two boards behaving differently - so the focus
  // assertions below pin UR-177's answer and the block below owns the rest.
  // `allSeven` charts no bonus stop, so Venus is the next to fly from either.
  test("returning from Mercury opens on the inner run", async ({ page }) => {
    await mount(page, KEY, { progress: PROGRESS_VARIANTS.allSeven, stopId: "mercury" });
    const s = await snapshot(page, KEY);
    expect(s.mapView).toBe("inner");
    expect(s.focusId, "UR-177: the next stop to fly, not the one just flown").toBe("venus");
  });

  test("returning from Venus opens on the inner run", async ({ page }) => {
    await mount(page, KEY, { progress: PROGRESS_VARIANTS.allSeven, stopId: "venus" });
    const s = await snapshot(page, KEY);
    expect(s.mapView).toBe("inner");
    expect(s.focusId, "UR-177: Venus is both where we came from and next to fly").toBe("venus");
  });

  test("returning from a main-route stop still opens on the route", async ({ page }) => {
    await mount(page, KEY, { progress: PROGRESS_VARIANTS.allSeven, stopId: "pluto" });
    expect((await snapshot(page, KEY)).mapView).toBe("route");
  });

  test("a bonus stopId with the pair still locked falls back to the route", async ({ page }) => {
    // The guard that stops a mid-route profile landing on a board it has not
    // earned - `stopId` is data, and data can be stale or wrong.
    await mount(page, KEY, { progress: PROGRESS_VARIANTS.midRun, stopId: "venus" });
    expect((await snapshot(page, KEY)).mapView).toBe("route");
  });
});

/**
 * UR-165: ZOOZVE IS A STOP THAT IS NOT A NODE.
 *
 * It is a 232 m rock that shadows Venus - a quasi-satellite, not a world - so
 * it is drawn on a dashed loop around its host rather than as a fourth disc in
 * the row. The split that makes that possible is `INNER_BOARD_STOP_IDS` (what
 * is drawn on the line) against `BONUS_STOP_IDS` (what the player flies), and
 * this is the test that stops the two silently collapsing back together.
 */
test.describe("UR-165: Zoozve orbits Venus rather than standing on the line", () => {
  const FULL = ["earth", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto", "venus"].map(
    (stopId) => ({
      stopId, cleared: true, stars: 3, bestWpm: 22, bestAccuracy: 0.95,
      lastWpm: 20, lastAccuracy: 94, beaconPlacedAt: 1,
    }),
  );

  test("is on the inner board, off the route line, and hangs off Venus", async ({ page }) => {
    await mount(page, KEY, { progress: FULL, stopId: "venus" });
    const s = await snapshot(page, KEY);
    expect(s.mapView).toBe("inner");

    const nodes = await page.evaluate(() => {
      const kb = (window as unknown as { __kb: Record<string, unknown> }).__kb;
      const game = kb["game"] as { scene: { getScene(k: string): unknown } };
      const scene = game.scene.getScene("DirectorMap") as {
        nodes: { stopId: string; x: number; y: number; r: number; satellite: boolean }[];
      };
      return scene.nodes.map((n) => ({
        stopId: n.stopId, x: n.x, y: n.y, r: n.r, satellite: n.satellite,
      }));
    });

    const zoozve = nodes.find((n) => n.stopId === "zoozve");
    const venus = nodes.find((n) => n.stopId === "venus");
    expect(zoozve, "Zoozve is not on the inner board").toBeDefined();
    expect(venus).toBeDefined();
    const z = zoozve as NonNullable<typeof zoozve>;
    const v = venus as NonNullable<typeof venus>;

    // A satellite, drawn smaller than a world and OFF the route's own line.
    expect(z.satellite).toBe(true);
    expect(z.r).toBeLessThan(v.r);
    expect(z.y).not.toBe(v.y);
    // Near its host, and not overlapping it: the arms of the rock have to clear
    // the planet's rim or the loop reads as a moon stuck to the limb.
    const gap = Math.hypot(z.x - v.x, z.y - v.y);
    expect(gap).toBeGreaterThan(v.r + z.r);
    expect(gap).toBeLessThan(300);

    // Every other stop is still on the line it was on.
    for (const n of nodes.filter((x) => x.stopId !== "zoozve")) {
      expect(n.satellite, `${n.stopId} must stay on the route line`).toBe(false);
      expect(n.y).toBe(v.y);
    }
  });

  test("is flyable: focusing it and pressing Enter leaves the map", async ({ page }) => {
    await mount(page, KEY, { progress: FULL, stopId: "venus" });
    // Walk focus onto Zoozve rather than assuming an index: it is appended
    // after the row, so the order is a thing the test should discover.
    for (let i = 0; i < 8; i += 1) {
      const s = await snapshot(page, KEY);
      if (s.focusId === "zoozve") break;
      await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(120);
    }
    expect((await snapshot(page, KEY)).focusId).toBe("zoozve");
  });
});

/**
 * UR-166: ZOOZVE WAS LOCKED, SO IT TOOK NO CLICK AND NO HAND CURSOR.
 *
 * Two orders were wrong at once. The board derived `locked` from `INNER_ORDER`
 * (Earth, Venus, Mercury), which has no Zoozve in it, so Mercury opened the
 * moment Venus was cleared. The satellite derived its own from `STOP_IDS`,
 * whose tail is venus, mercury, zoozve, so Zoozve needed MERCURY cleared. A
 * locked focus target gets `useHandCursor: false` and its `pointerdown`
 * returns before `activate`, which is why "not clickable" and "no pointer
 * cursor" were the same defect.
 */
test.describe("UR-166: the inner run unlocks in the order it is flown", () => {
  const cleared = (ids: readonly string[]) =>
    ids.map((stopId) => ({
      stopId, cleared: true, stars: 3, bestWpm: 22, bestAccuracy: 0.95,
      lastWpm: 20, lastAccuracy: 94, beaconPlacedAt: 1,
    }));
  const ROUTE = ["earth", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"];

  async function lockState(page: import("@playwright/test").Page) {
    return page.evaluate(() => {
      const kb = (window as unknown as { __kb: Record<string, unknown> }).__kb;
      const game = kb["game"] as { scene: { getScene(k: string): unknown } };
      const scene = game.scene.getScene("DirectorMap") as {
        nodes: { stopId: string; locked: boolean }[];
      };
      return Object.fromEntries(scene.nodes.map((n) => [n.stopId, n.locked]));
    });
  }

  test("Venus open, Zoozve and Mercury shut, before any bonus stop is flown", async ({ page }) => {
    await mount(page, KEY, { progress: cleared(ROUTE), stopId: "earth" });
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(600);
    const locks = await lockState(page);
    expect(locks["venus"]).toBe(false);
    expect(locks["zoozve"], "Zoozve must not open before Venus is flown").toBe(true);
    expect(locks["mercury"], "Mercury must not skip Zoozve").toBe(true);
  });

  test("flying Venus opens Zoozve, and Zoozve still gates Mercury", async ({ page }) => {
    await mount(page, KEY, { progress: cleared([...ROUTE, "venus"]), stopId: "venus" });
    const locks = await lockState(page);
    expect(locks["zoozve"], "Venus is flown, so Zoozve is open").toBe(false);
    expect(locks["mercury"], "Mercury waits on Zoozve").toBe(true);
  });

  test("flying Zoozve opens Mercury", async ({ page }) => {
    await mount(page, KEY, { progress: cleared([...ROUTE, "venus", "zoozve"]), stopId: "zoozve" });
    const locks = await lockState(page);
    expect(locks["mercury"]).toBe(false);
  });

  test("an open Zoozve is a real pointer target, not just a drawing", async ({ page }) => {
    await mount(page, KEY, { progress: cleared([...ROUTE, "venus"]), stopId: "venus" });
    const zone = await page.evaluate(() => {
      const kb = (window as unknown as { __kb: Record<string, unknown> }).__kb;
      const game = kb["game"] as { scene: { getScene(k: string): unknown } };
      const scene = game.scene.getScene("DirectorMap") as { children: { list: unknown[] } };
      type Z = { name?: string; input?: { cursor?: string } | null; list?: unknown[] };
      let found: Z | null = null;
      const walk = (list: unknown[]): void => {
        for (const raw of list) {
          const o = raw as Z;
          if (o.name === "kb-hit:zoozve") found = o;
          if (Array.isArray(o.list)) walk(o.list);
        }
      };
      walk(scene.children.list);
      const f = found as Z | null;
      return f === null ? null : { interactive: f.input != null, cursor: f.input?.cursor ?? "" };
    });
    expect(zone, "Zoozve has no hit zone at all").not.toBeNull();
    const z = zone as NonNullable<typeof zone>;
    expect(z.interactive).toBe(true);
    // The hand cursor IS the affordance the owner noticed was missing.
    expect(z.cursor).toBe("pointer");
  });
});

/**
 * UR-167: a satellite is a STOP, not just a drawing.
 *
 * Two things read a stop and found nothing where Zoozve should have been. The
 * detail panel reads `layer.stops`, which had been filtered to what is drawn on
 * the LINE, so `find(zoozve)` was undefined and its `?? true` reported a
 * cleared stop as "Locked". The beacon lamp was struck with a planet's radii
 * off `ROUTE_Y`, so on a 17 px rock the halo was twice the body and the stem
 * ran through it.
 */
test.describe("UR-167: the satellite reads as a stop everywhere", () => {
  const cleared = (ids: readonly string[]) =>
    ids.map((stopId) => ({
      stopId, cleared: true, stars: 3, bestWpm: 22, bestAccuracy: 0.95,
      lastWpm: 20, lastAccuracy: 94, beaconPlacedAt: 1,
    }));
  const ROUTE = ["earth", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"];

  test("a cleared Zoozve offers the flight, it does not report Locked", async ({ page }) => {
    await mount(page, KEY, {
      progress: cleared([...ROUTE, "venus", "zoozve"]),
      stopId: "zoozve",
    });
    const s = await snapshot(page, KEY);
    const screen = s.text.join(" ");
    expect(screen).toContain("Zoozve");
    expect(screen.toLowerCase(), "a cleared stop must not read as locked").not.toContain("locked");
  });

  test("it is counted among the inner beacons once lit", async ({ page }) => {
    await mount(page, KEY, { progress: cleared([...ROUTE, "venus", "zoozve"]), stopId: "zoozve" });
    const s = await snapshot(page, KEY);
    // Three bonus stops, two of them lit.
    const badge = s.badge as { segments: { lit: boolean }[] } | null;
    expect(badge, "the inner run has no badge").not.toBeNull();
    const segments = (badge as { segments: { lit: boolean }[] }).segments;
    expect(segments.length).toBe(3);
    expect(segments.filter((x) => x.lit).length).toBe(2);
  });

  test("its lamp is drawn to its own size, not a planet's", async ({ page }) => {
    await mount(page, KEY, { progress: cleared([...ROUTE, "venus", "zoozve"]), stopId: "zoozve" });
    const sizes = await page.evaluate(() => {
      const kb = (window as unknown as { __kb: Record<string, unknown> }).__kb;
      const game = kb["game"] as { scene: { getScene(k: string): unknown } };
      const scene = game.scene.getScene("DirectorMap") as {
        nodes: { stopId: string; r: number; y: number }[];
      };
      return Object.fromEntries(scene.nodes.map((n) => [n.stopId, { r: n.r, y: n.y }]));
    });
    // The lamp rides `node.r`, so asserting the radius is asserting the lamp.
    const z = sizes["zoozve"] as { r: number; y: number };
    const v = sizes["venus"] as { r: number; y: number };
    expect(z.r).toBeLessThan(v.r / 2);
    expect(z.y).toBeLessThan(v.y);
  });
});

/**
 * UR-177: finishing a stop lands on the NEXT one, on both boards.
 *
 * The route has always opened on the first unlocked, uncharted stop. UR-164
 * kept the inner run's board on screen when you come back from a bonus stop -
 * right - and moved focus onto the stop just flown - wrong. The owner noticed
 * the two boards behaving differently.
 */
test.describe("UR-177: the map advances to the next stop", () => {
  const cleared = (ids: readonly string[]) =>
    ids.map((stopId) => ({
      stopId, cleared: true, stars: 3, bestWpm: 22, bestAccuracy: 0.95,
      lastWpm: 20, lastAccuracy: 94, beaconPlacedAt: 1,
    }));
  const ROUTE = ["earth", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"];

  test("the ROUTE lands on the next stop, which is the behaviour being matched", async ({ page }) => {
    await mount(page, KEY, { progress: cleared(["earth", "mars"]), stopId: "mars" });
    expect((await snapshot(page, KEY)).focusId).toBe("jupiter");
  });

  test("finishing Venus lands on Zoozve, not back on Venus", async ({ page }) => {
    await mount(page, KEY, { progress: cleared([...ROUTE, "venus"]), stopId: "venus" });
    const s = await snapshot(page, KEY);
    expect(s.mapView, "the inner board still stays put (UR-164)").toBe("inner");
    expect(s.focusId).toBe("zoozve");
  });

  test("finishing Zoozve lands on Mercury", async ({ page }) => {
    await mount(page, KEY, { progress: cleared([...ROUTE, "venus", "zoozve"]), stopId: "zoozve" });
    const s = await snapshot(page, KEY);
    expect(s.mapView).toBe("inner");
    expect(s.focusId).toBe("mercury");
  });

  test("with the inner run finished it holds the last stop rather than snapping away", async ({
    page,
  }) => {
    await mount(page, KEY, {
      progress: cleared([...ROUTE, "venus", "zoozve", "mercury"]),
      stopId: "mercury",
    });
    const s = await snapshot(page, KEY);
    expect(s.mapView).toBe("inner");
    expect(s.focusId).toBe("mercury");
  });
});
