import { expect, test, type Page } from "@playwright/test";
import { mount, snapshot } from "./story-lane";
import { gameCanvas } from "./support/lane.js";
import { SHIPS } from "../../src/game/ui/catalog.js";

/**
 * UR-48: THE HULL THE CHILD IS WEARING IS THE HULL ON THE TITLE AND THE WARP.
 *
 * ================== THE DEFECT ==================
 * Four screens draw the Lantern. Flight was closed by reading the profile
 * inline, the Director map by `scenes/lib/livery.drawPlayerLantern`
 * (`map-livery.spec.ts` is its evidence), and these two were left drawing the
 * FILE CONSTANTS - recorded at the time on
 * `tests/unit/arch/liveryReaders.test.ts`'s `KNOWN_BLIND_SCREENS` as open
 * defects rather than exemptions. That list is now empty and this is the
 * evidence for the two entries that came off it.
 *
 * THE TITLE IS THE ONE THAT MATTERS MOST. It is the first screen a returning
 * pilot sees, so for the life of the save it was the screen that showed a child
 * somebody else's ship - and it does that before they have touched a key.
 *
 * ================== WHY A PIXEL COUNT AND NOT ONLY A SNAPSHOT ==================
 * `shipLivery` is the object handed to the drawing, so it proves the scene KNOWS
 * which hull it is showing. It proves nothing about what is on screen, which is
 * the whole lesson of `docs/verification-gaps.md` and precisely how
 * `profile.shipId` came to be chosen, persisted, migrated and drawn by nothing.
 * `map-livery.spec.ts` records the case that makes this non-negotiable: with the
 * drawing reverted, the snapshot half STAYED GREEN while the pixel half went to
 * zero. So both halves run and the second one is a real frame.
 *
 * SHIP-2 AND SHIP-3, EACH THE OTHER'S CONTROL, for the reason the map and
 * flight halves give: their stripes are a blue and a violet, neither can be
 * mistaken for the other. Ship-1's coral would be a bad choice on any screen
 * with warm debris in it, and the Title wears the palette of the pilot's
 * furthest beacon.
 *
 * COUNTING A COLOUR, not comparing two frames byte for byte. That was tried on
 * the flight half and failed its own control: two boots of the same hull do not
 * produce identical bytes, because the sky drifts and the tween phases land
 * wherever machine load puts them. The livery band is drawn flat at full alpha,
 * so a hull's own stripe is either on the screen or it is not.
 */

/**
 * The floor for "this hull's stripe is on screen", per screen.
 *
 * MEASURED, and set to a fifth of the smaller reading rather than to a number
 * that happened to work (rule 8). The two screens draw the rig at very different
 * sizes - the Title at 42% of the frame height, the Warp at Flight's own stand,
 * which is roughly a tenth the area - so they do not share a floor.
 *
 * READINGS, off the green run (the spec prints them on every pass, see below):
 *
 *   Title: ship-2 frame [blue 4840, violet 0], ship-3 frame [blue 0, violet 4895]
 *   Warp:  ship-2 frame [blue  510, violet 0], ship-3 frame [blue 0, violet  539]
 *
 * WATCHED FAILING (rule 4). Both screens reverted to the state they shipped in -
 * `drawPlayerLantern(` -> `drawLantern(` and the `lib/livery` import dropped, so
 * the rig falls back to the file constants:
 *
 *   AC-6d.1b and it reaches the Title's pixels, each hull the other's control
 *     ship-2's own stripe is not on the Title: Title: ship-2 frame
 *     [blue 0, violet 0], ship-3 frame [blue 0, violet 0]
 *   AC-6d.1b and it reaches the Warp's pixels, each hull the other's control
 *     ship-2's own stripe is not on the Warp: Warp: ship-2 frame
 *     [blue 0, violet 0], ship-3 frame [blue 0, violet 0]
 *
 * AND THE SNAPSHOT HALF STAYED GREEN THROUGH THAT on both screens, because
 * `shipLivery` still resolves and still reports while the drawing ignores it.
 * That is the whole reason the pixel half is here and not a second reading of
 * the same field.
 */
const MIN_STRIPE = { Title: 960, Warp: 100 } as const;

/** Ship-2's blue and ship-3's violet, read off the catalogue, never retyped. */
const BLUE = SHIPS.find((s) => s.id === "ship-2")?.colors.stripe as string;
const VIOLET = SHIPS.find((s) => s.id === "ship-3")?.colors.stripe as string;

interface StoreWindow {
  __kb?: {
    game: { scale: { width: number; height: number } };
    services: {
      store: {
        profiles: { id: string }[];
        createProfile(input: Record<string, unknown>): { id: string };
        updateProfile(
          id: string,
          update: (p: Record<string, unknown>) => Record<string, unknown>,
        ): unknown;
        selectProfile(id: string): boolean;
        deleteProfile(id: string): boolean;
        flush(): unknown;
      };
    };
  };
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Put one pilot in the REAL store and show them the screen.
 *
 * Written through `services().store` - the same object the game writes through -
 * rather than into `localStorage` behind it: a fixture that bypasses the load
 * path proves nothing about the load path, and both screens read the profile
 * through `lib/livery.playerLivery`, which asks that store.
 *
 * Neither screen publishes a DOM mirror (they are story-lane, not menu-lane), so
 * `lib/menus.seed` cannot be used and the seed is local, exactly as
 * `map-livery.spec.ts` keeps its own.
 */
async function show(page: Page, key: string, shipId: string): Promise<void> {
  await mount(page, key);
  await page.evaluate((id) => {
    const store = (window as unknown as StoreWindow).__kb?.services.store;
    if (store === undefined) throw new Error("no store");
    for (const existing of [...store.profiles]) store.deleteProfile(existing.id);
    const created = store.createProfile({
      name: "Ren",
      avatar: "avatar-1",
      shipId: id,
      shipName: "Lantern",
      settings: {},
    });
    store.updateProfile(created.id, (p) => ({ ...p, unlockedShips: [id], unlockedSkins: [] }));
    store.selectProfile(created.id);
    store.flush();
  }, shipId);
  // Re-enter the screen so `create()` resolves the hull against the pilot who
  // is now active. Both screens read the store when they build the ship, which
  // is the seam under test; nothing pushes a livery at a live scene.
  await mount(page, key);
}

/** Where this screen says it put the ship, generously boxed. */
async function shipBox(page: Page, key: string): Promise<Rect> {
  const s = await snapshot(page, key);
  if (key === "Title") {
    const at = s["ship"] as { x: number; y: number; height: number } | null;
    expect(at, "the Title drew no ship at all").not.toBeNull();
    const { x, y, height } = at as { x: number; y: number; height: number };
    // Generous both ways: the rig's own extent is 247 design units above the
    // origin and 178 below (see `scenes/lib/livery.ts`), and the idle bob is a
    // couple of px on top of that. An over-generous box cannot manufacture a
    // pass, because the control half below requires the OTHER hull's colour to
    // be absent from the same box.
    return { x: x - height * 0.5, y: y - height * 0.7, w: height, h: height * 1.2 };
  }
  const ship = s["ship"] as { drawn: boolean; box: Rect } | null;
  expect(ship?.drawn, "the Warp drew no ship at all (UR-63)").toBe(true);
  const box = (ship as { box: Rect }).box;
  return { x: box.x - 20, y: box.y - 20, w: box.w + 40, h: box.h + 40 };
}

/** How many pixels of each colour are inside the ship's box, on a real frame. */
async function stripeCounts(
  page: Page,
  key: string,
  shipId: string,
  targets: readonly string[],
): Promise<number[]> {
  await show(page, key, shipId);
  const box = await shipBox(page, key);

  const canvas = await gameCanvas(page).boundingBox();
  if (canvas === null) throw new Error("no game canvas");
  // The design-space box is scaled to the canvas the browser actually laid out.
  // `GAME_WIDTH` is derived from the window (D99), so a clip in raw design units
  // measures the wrong part of the frame and reports zero for BOTH hulls - which
  // reads as a defect rather than as a bad measurement (rule 9).
  const design = await page.evaluate(() => {
    const g = (window as unknown as StoreWindow).__kb?.game;
    return { w: g?.scale.width ?? 1920, h: g?.scale.height ?? 1080 };
  });
  const sx = canvas.width / design.w;
  const sy = canvas.height / design.h;
  const clip = {
    x: Math.max(canvas.x, canvas.x + box.x * sx),
    y: Math.max(canvas.y, canvas.y + box.y * sy),
    width: Math.min(canvas.width, box.w * sx),
    height: Math.min(canvas.height, box.h * sy),
  };
  const shot = (await page.screenshot({ clip })).toString("base64");

  return page.evaluate(
    async ([data, hexes]: readonly [string, readonly string[]]) => {
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = `data:image/png;base64,${data}`;
      });
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d");
      if (g === null) throw new Error("no 2d context");
      g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, c.width, c.height).data;
      const want = hexes.map((h) => [
        parseInt(h.slice(1, 3), 16),
        parseInt(h.slice(3, 5), 16),
        parseInt(h.slice(5, 7), 16),
      ]);
      const counts = want.map(() => 0);
      for (let i = 0; i < px.length; i += 4) {
        for (let k = 0; k < want.length; k += 1) {
          const t = want[k] as number[];
          if (
            Math.abs((px[i] ?? 0) - (t[0] as number)) <= 8 &&
            Math.abs((px[i + 1] ?? 0) - (t[1] as number)) <= 8 &&
            Math.abs((px[i + 2] ?? 0) - (t[2] as number)) <= 8
          ) {
            counts[k] = (counts[k] as number) + 1;
          }
        }
      }
      return counts;
    },
    [shot, targets] as const,
  );
}

for (const key of ["Title", "Warp"] as const) {
  test.describe(`UR-48: ${key} draws the pilot's own hull`, () => {
    // Software WebGL under parallel workers, same as the rest of this lane.
    test.setTimeout(180_000);

    test(`AC-6d.1b the ${key} reports the profile's hull`, async ({ page }) => {
      await show(page, key, "ship-3");
      expect(
        (await snapshot(page, key))["shipLivery"],
        `the ${key} drew the ship in colours that are not the pilot's hull`,
      ).toEqual(SHIPS.find((x) => x.id === "ship-3")?.colors);

      await show(page, key, "ship-2");
      expect((await snapshot(page, key))["shipLivery"]).toEqual(
        SHIPS.find((x) => x.id === "ship-2")?.colors,
      );
    });

    test(`AC-6d.1b and it reaches the ${key}'s pixels, each hull the other's control`, async ({
      page,
    }) => {
      const two = await stripeCounts(page, key, "ship-2", [BLUE, VIOLET]);
      const three = await stripeCounts(page, key, "ship-3", [BLUE, VIOLET]);
      const detail =
        `${key}: ship-2 frame [blue ${two[0]}, violet ${two[1]}], ` +
        `ship-3 frame [blue ${three[0]}, violet ${three[1]}]`;
      // PRINTED ON A GREEN RUN, not only on a red one. `MIN_STRIPE` is set from
      // these numbers, and a floor whose readings are only visible when the
      // test fails is a floor nobody can check was measured (rule 8).
      console.log(detail);

      expect(two[0], `ship-2's own stripe is not on the ${key}: ${detail}`).toBeGreaterThan(
        MIN_STRIPE[key],
      );
      expect(three[1], `ship-3's own stripe is not on the ${key}: ${detail}`).toBeGreaterThan(
        MIN_STRIPE[key],
      );
      // The control half: showing one hull must not put the OTHER hull's colour
      // up. Without it, a screen that drew BOTH stripes would pass twice.
      expect(
        two[1],
        `ship-3's stripe is on the ${key} while wearing ship-2: ${detail}`,
      ).toBeLessThan((two[0] as number) / 20);
      expect(
        three[0],
        `ship-2's stripe is on the ${key} while wearing ship-3: ${detail}`,
      ).toBeLessThan((three[1] as number) / 20);
    });
  });
}
