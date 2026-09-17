import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { freezeReloads } from "./support/lane.js";

/**
 * UR-49: THE PALETTE MAY SET THE SKY AND NOTHING ELSE.
 *
 * ================== THE DEFECT ==================
 * The Title wears the palette of the player's furthest beacon, so a returning
 * pilot opens the game somewhere they have already been (D13). That part is
 * liked and stays. What leaked is everything else: the stop's `accent` was
 * copied into `TitleScene.accent` and from there reached
 *
 *   the wordmark's glow tint      the "KEY" glyphs        the accent rule
 *   the primary button's plate    `drawFocusRing`
 *
 * At Saturn that is a pale blue on a bright beige sky, and the focus ring -
 * specified as ONE gold for the whole menu system - had been quietly wearing
 * the stop's colour on every themed boot for months.
 *
 * WHY IT SURVIVED: the default navy palette flatters the pale accent, and a
 * new pilot has no beacons, so every screenshot anybody ever took was of the
 * one state where the bug is invisible. A bright palette needs progress. This
 * is standards rule 5 again (a harness sweeps, it does not sample) wearing
 * different clothes - the sample was "a new profile", and it was the only
 * state that looked right.
 *
 * ================== WHAT THIS ASSERTS ==================
 * Two boots of the SAME screen with two different furthest beacons, compared
 * field by field. Every registered colour pair must be byte-identical; only
 * the sky may differ. The test proves its own premise first - that the two
 * boots really did load different themes - because a comparison of two
 * identical states passes for the wrong reason and would have passed against
 * the shipped defect too.
 *
 * Watch it fail: put `this.accent = pal.accent` back in `TitleScene.create`
 * and make the field mutable again. Measured with it restored:
 *
 *   title.primary: ink #0A0F17->#0A0F17, plate #FFC857->#9FD8F0
 *
 * The ink holds and the PLATE turns Saturn's pale blue under it - which is the
 * defect exactly, and why the ink-only contrast sweep never caught it.
 */

const TITLE = "Title";

/** Earth through Saturn charted: `furthestBeacon` is Saturn, a bright stop. */
const TO_SATURN = ["earth", "mars", "jupiter", "saturn"];

interface Row {
  screen: string;
  id: string;
  color: string;
  plateFill: string | null;
}

/**
 * Boot the Title with a given set of placed beacons.
 *
 * NOT `lib/menus.open`: that waits for a `[data-scene="Title"]` DOM mirror and
 * this screen publishes none - it predates the menu kit and carries its own
 * focus ring. Waiting on the mirror timed the first version of this file out at
 * 90 s twice. The debug bag is what the Title actually publishes, and
 * `title.spec.ts` waits on the same thing.
 */
async function openTitle(page: Page, beacons: string[]): Promise<void> {
  await freezeReloads(page);
  await page.goto(`/?scene=${TITLE}`);
  await page.waitForFunction(
    () => (window as unknown as { __kb?: { services?: unknown } }).__kb?.services !== undefined,
    null,
    { timeout: 60_000 },
  );
  await page.evaluate((placed) => {
    const store = (window as unknown as {
      __kb: {
        services: {
          store: {
            profiles: { id: string }[];
            createProfile(i: Record<string, unknown>): { id: string };
            updateProfile(id: string, f: (p: Record<string, unknown>) => unknown): unknown;
            selectProfile(id: string): boolean;
            deleteProfile(id: string): boolean;
            flush(): unknown;
          };
        };
      };
    }).__kb.services.store;
    for (const p of [...store.profiles]) store.deleteProfile(p.id);
    const made = store.createProfile({
      name: "Ana",
      avatar: "avatar-1",
      shipId: "ship-1",
      shipName: "Lantern",
      settings: {},
    });
    store.updateProfile(made.id, (p) => ({
      ...p,
      progress: (p["progress"] as Record<string, unknown>[]).map((row) =>
        placed.includes(row["stopId"] as string)
          ? { ...row, cleared: true, beaconPlacedAt: Date.UTC(2026, 8, 16) }
          : row,
      ),
    }));
    store.selectProfile(made.id);
    store.flush();
  }, beacons);

  // Re-enter the scene so `create` re-reads the store it just wrote.
  await page.goto(`/?scene=${TITLE}`);
  await expect(page.getByTestId("app")).toHaveAttribute("data-booted", "true");
  await page.waitForFunction(
    () => {
      const bag = (window as unknown as Record<string, Record<string, unknown>>)["__kb"];
      return bag !== undefined && bag["title"] !== undefined;
    },
    null,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(700);
}

async function chromeOf(page: Page): Promise<{ rows: Row[]; furthest: string | null }> {
  const snap = await page.evaluate(() => {
    const kb = (window as unknown as {
      __kb: { game: { scene: { getScene(k: string): { snapshot?(): Record<string, unknown> } | null } } };
    }).__kb;
    return kb.game.scene.getScene("Title")?.snapshot?.() ?? {};
  });
  const rows = ((snap["skyText"] ?? []) as Row[])
    .map((r) => ({ screen: r.screen, id: r.id, color: r.color, plateFill: r.plateFill }))
    .sort((a, b) => `${a.screen}.${a.id}`.localeCompare(`${b.screen}.${b.id}`));
  const furthest = await page.evaluate(() => {
    const bag = (window as unknown as Record<string, Record<string, unknown>>)["__kb"]?.[
      "title"
    ] as { furthestBeacon?: string | null } | undefined;
    return bag?.furthestBeacon ?? null;
  });
  return { rows, furthest };
}

test.describe("UR-49: a theme is a skin", () => {
  test("the Title's chrome is identical at a bright stop and at the default", async ({
    page,
  }) => {
    test.slow();

    await openTitle(page, []);
    const fresh = await chromeOf(page);

    await openTitle(page, TO_SATURN);
    const themed = await chromeOf(page);

    // ---- the premise, checked before the claim ---------------------------
    // If both boots loaded the same theme this test is comparing a thing with
    // itself, which is how `f(x) === f(x)` assertions get written (standards
    // rule 4). A new pilot has no beacon; the seeded one is at Saturn.
    expect(fresh.furthest, "a new pilot has no furthest beacon").toBeNull();
    expect(themed.furthest, "the seeded pilot is at Saturn").toBe("saturn");

    // ...and the two themes really do carry different accents, read from the
    // shipped palette module rather than asserted from memory.
    // The module URL is a VARIABLE so tsc does not try to resolve a browser
    // path at build time; vite serves the real source to the page.
    const accents = await page.evaluate(async (url) => {
      const pal = (await import(/* @vite-ignore */ url)) as {
        paletteAt: (stop: string, cb: boolean) => { accent: string };
      };
      return {
        earth: pal.paletteAt("earth", false).accent,
        saturn: pal.paletteAt("saturn", false).accent,
      };
    }, "/src/game/render/palette.ts");
    expect(
      accents.earth,
      `the palettes must differ or there is nothing to leak: ${JSON.stringify(accents)}`,
    ).not.toBe(accents.saturn);

    // ---- the claim -------------------------------------------------------
    // MATCHED BY ID, NOT BY INDEX. The two boots do not draw the same NUMBER of
    // rows and that is correct: a returning pilot's primary button carries a
    // subline naming the planet, so the themed boot has one row the fresh one
    // does not (3 -> 4, which failed an index-wise comparison on the first
    // run). What must not change is any row they have in common.
    const byId = (rows: Row[]): Map<string, Row> =>
      new Map(rows.map((r) => [`${r.screen}.${r.id}`, r]));
    const a = byId(fresh.rows);
    const b = byId(themed.rows);
    const shared = [...a.keys()].filter((k) => b.has(k));

    expect(fresh.rows.length, "the Title registers its sky-borne text").toBeGreaterThan(0);
    expect(shared.length, `rows drawn at both stops: ${shared.join(", ")}`).toBeGreaterThanOrEqual(
      3,
    );

    const drifted = shared
      .map((k) => ({ row: a.get(k) as Row, other: b.get(k) as Row }))
      .filter(
        ({ row, other }) => row.color !== other.color || row.plateFill !== other.plateFill,
      )
      .map(
        ({ row, other }) =>
          `${row.screen}.${row.id}: ink ${row.color}->${other.color}, ` +
          `plate ${row.plateFill}->${other.plateFill}`,
      );
    expect(drifted, `chrome moved with the theme: ${drifted.join(" | ")}`).toEqual([]);

    // The primary button's plate is the row the player complained about, so it
    // is named rather than left to the loop: it is the fixed gold, at both
    // stops, and not either stop's accent.
    const primary = themed.rows.find((r) => r.id === "title.primary");
    expect(primary, "the primary button registers its plate").toBeDefined();
    expect(primary?.plateFill).toBe("#FFC857");
    expect(primary?.plateFill).not.toBe(accents.saturn);
  });

  test("the focus ring is the one gold, whatever the sky is doing", async ({ page }) => {
    test.slow();
    // AC-18.1's ring is specified as a single accent for the whole menu system
    // and the standing instruction on this screen has always been that the gold
    // focus ring stays exactly as it is. It was drawn with `this.accent`, so it
    // had been themed along with everything else.
    await openTitle(page, TO_SATURN);
    // THE SOURCE IS READ FROM DISK, not fetched from the dev server: vite
    // serves TRANSPILED JavaScript, which has already stripped `private
    // readonly`, so the field regex found nothing and this test failed against
    // a correct fix on its first run.
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../src/game/scenes/TitleScene.ts"),
      "utf8",
    );
    const ringArg = /this\.focusRing\.lineStyle\(\s*4,\s*hexToNum\(([^)]+)\)/.exec(src)?.[1] ?? null;
    const accentField = /private readonly accent = ([^;]+);/.exec(src)?.[1] ?? null;
    const token = await page.evaluate(async (url) => {
      const theme = (await import(/* @vite-ignore */ url)) as { INK: { accent: string } };
      return theme.INK.accent;
    }, "/src/game/ui/theme.ts");
    const ring = { token, ringArg, accentField };
    expect(ring.ringArg, "the ring is drawn from the scene's accent field").toBe("this.accent");
    // ...and that field is fixed, by the compiler rather than by convention.
    expect(ring.accentField, "the accent field is the theme token, not a palette").toBe(
      "INK.accent",
    );
    expect(ring.token).toBe("#FFC857");
  });
});
