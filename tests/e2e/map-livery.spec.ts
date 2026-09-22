import { expect, test, type Page } from "@playwright/test";
import { mount, snapshot } from "./story-lane";
import { gameCanvas } from "./support/lane.js";
import { SHIPS } from "../../src/game/ui/catalog.js";

/**
 * UR-48: THE HULL THE CHILD CHOSE IS THE HULL ON THE DIRECTOR MAP.
 *
 * `profile.shipId` is chosen at profile creation, hulls can be earned through
 * play, and the field reached NOTHING - coding-standards rule 2 names it as its
 * second instance, beside `uppercase` and `increasedLetterSpacing`, which
 * persisted perfectly and did nothing on nine screens. The flight screen was
 * closed first. This screen drew the ship in the file constants, deliberately,
 * matching `WarpScene`, and that was recorded at the time as the same rule-2
 * defect in a different place, owed its own ticket. This is that ticket's
 * evidence.
 *
 * ================== WHY A PIXEL COUNT AND NOT ONLY A SNAPSHOT ==================
 * `DirectorMapScene.snapshot().shipLivery` is the object handed to the drawing,
 * so it proves the scene KNOWS which hull it is showing. It proves nothing
 * about what is on screen, which is the whole lesson of
 * `docs/verification-gaps.md` and precisely how `profile.shipId` came to be
 * chosen, persisted, migrated and drawn by nothing. So both halves run, and the
 * second one is a real frame.
 *
 * SHIP-2 AND SHIP-3, EACH THE OTHER'S CONTROL, for the reason the flight half
 * of `world-frame-invariants.spec.ts` gives: their stripes are a blue and a
 * violet, neither can be mistaken for the other, and neither occurs in this
 * screen's sky (Earth's night palette). Ship-1's coral would be a bad choice on
 * any screen with warm debris in it.
 *
 * COUNTING A COLOUR, not comparing two frames byte for byte. That was tried on
 * the flight half and FAILED ITS OWN CONTROL: two boots of the same hull do not
 * produce identical bytes, because the sky drifts and the tween phases land
 * wherever machine load puts them. The livery band is drawn flat at full alpha,
 * so a hull's own stripe is either on the screen or it is not.
 */

const KEY = "DirectorMap";

/**
 * The floor for "this hull's stripe is on screen".
 *
 * MEASURED, and set to a fifth of the smaller reading rather than to a number
 * that happened to work (rule 8). The map's ship is 96 design units tall
 * against Flight's, so the readings are smaller than the flight half's 310/318
 * and the floor is scaled with them, not inherited from it.
 *
 * READINGS:
 *   wearing ship-2:   blue 160   violet   0
 *   wearing ship-3:   blue   0   violet 164
 *
 * WATCHED FAILING (rule 4). `buildLantern` back to the state this screen
 * shipped in - `drawPlayerLantern(this,` -> `drawLantern(this,` and the
 * `livery:` argument deleted:
 *
 *   ship-2's own stripe is not on the map: ship-2 frame [blue 0, violet 0],
 *   ship-3 frame [blue 0, violet 0]
 *
 * AND THE CASE ABOVE IT STAYED GREEN THROUGH THAT. `shipLivery` is still
 * resolved and still reported while the drawing ignores it, so the snapshot
 * half alone is a false green - which is the whole reason the pixel half is
 * here and not a second reading of the same field.
 */
const MIN_STRIPE = 32;

/** Ship-2's blue and ship-3's violet, read off the catalogue, never retyped. */
const BLUE = SHIPS.find((s) => s.id === "ship-2")?.colors.stripe as string;
const VIOLET = SHIPS.find((s) => s.id === "ship-3")?.colors.stripe as string;

interface ShipState {
  x: number;
  y: number;
  targetX: number;
}

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

/**
 * Put one pilot in the REAL store and show them the map.
 *
 * Written through `services().store`, the same object the game writes through,
 * rather than into `localStorage` behind it: a fixture that bypasses the load
 * path proves nothing about the load path, and this screen reads the profile
 * through `lib/init.activeProfile`, which is that store.
 *
 * The Director map publishes no DOM mirror - it is not one of the five menu
 * screens - so `lib/menus.seed` cannot be used here and the seed is local.
 */
async function showMap(
  page: Page,
  spec: { shipId: string; unlockedSkins?: string[] },
): Promise<void> {
  await mount(page, KEY);
  await page.evaluate((s) => {
    const store = (window as unknown as StoreWindow).__kb?.services.store;
    if (store === undefined) throw new Error("no store");
    for (const existing of [...store.profiles]) store.deleteProfile(existing.id);
    const created = store.createProfile({
      name: "Ren",
      avatar: "avatar-1",
      shipId: s.shipId,
      shipName: "Lantern",
      settings: {},
    });
    store.updateProfile(created.id, (p) => ({
      ...p,
      unlockedShips: [s.shipId],
      unlockedSkins: s.unlockedSkins ?? [],
    }));
    store.selectProfile(created.id);
    store.flush();
  }, spec);
  // Re-enter the screen so `create()` resolves the hull against the pilot who
  // is now active. The scene reads the store when it builds the ship, which is
  // the seam being tested; nothing pushes a livery at a live scene.
  await mount(page, KEY);
}

/**
 * How many pixels of each colour are in the box the ship occupies.
 *
 * The box comes from the scene's OWN report of where it put the ship, not from
 * a remembered constant: `nodeX` is derived from the world's width at call time
 * (D99), so a hardcoded clip would measure the wrong part of a 21:9 frame and
 * report zero for both hulls, which reads as a defect rather than as a bad
 * measurement. Generous by 40 design units all round - the idle bob is +-2 and
 * the rig's own extent is 247 above the origin and 178 below, scaled to 96.
 */
async function stripeCounts(
  page: Page,
  shipId: string,
  targets: readonly string[],
): Promise<number[]> {
  await showMap(page, { shipId });
  const s = await snapshot(page, KEY);
  const ship = s["ship"] as ShipState | null;
  expect(ship, "the map drew no ship at all (UR-53)").not.toBeNull();

  const box = await gameCanvas(page).boundingBox();
  if (box === null) throw new Error("no game canvas");
  const design = await page.evaluate(() => {
    const g = (window as unknown as { __kb?: { game: { scale: { width: number; height: number } } } })
      .__kb?.game;
    return { w: g?.scale.width ?? 1920, h: g?.scale.height ?? 1080 };
  });
  const sx = box.width / design.w;
  const sy = box.height / design.h;
  const shot = (
    await page.screenshot({
      clip: {
        x: box.x + ((ship as ShipState).x - 60) * sx,
        y: box.y + ((ship as ShipState).y - 100) * sy,
        width: 120 * sx,
        height: 180 * sy,
      },
    })
  ).toString("base64");

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

test.describe("UR-48: the Director map flies the pilot's own hull", () => {
  // Software WebGL under parallel workers, same as the rest of this lane.
  test.setTimeout(180_000);

  test("the map reports the profile's hull, skin included", async ({ page }) => {
    await showMap(page, { shipId: "ship-3" });
    const s = await snapshot(page, KEY);
    expect(
      s["shipLivery"],
      "the map drew the ship in colours that are not the pilot's hull",
    ).toEqual(SHIPS.find((x) => x.id === "ship-3")?.colors);

    // The skin is the half of `@engine/unlocks` that reaches the screen without
    // anything being equipped: earn `skin-3` and ship-3 is repainted.
    await showMap(page, { shipId: "ship-3", unlockedSkins: ["skin-3"] });
    const withSkin = await snapshot(page, KEY);
    expect(
      withSkin["shipLivery"],
      "an earned skin does not reach the map's ship",
    ).not.toEqual(SHIPS.find((x) => x.id === "ship-3")?.colors);
  });

  test("and it reaches the pixels: two hulls, each the other's control", async ({ page }) => {
    const two = await stripeCounts(page, "ship-2", [BLUE, VIOLET]);
    const three = await stripeCounts(page, "ship-3", [BLUE, VIOLET]);
    const detail = `ship-2 frame [blue ${two[0]}, violet ${two[1]}], ship-3 frame [blue ${three[0]}, violet ${three[1]}]`;

    /**
     * EACH OTHER'S CONTROL, WHICH IS WHAT THE TITLE SAYS - AND IT HAS TO BE.
     *
     * The crop is a 120x180 box around the ship, so most of it is the map
     * behind her, and UR-171 dressed the menus in EARTH'S palette. Earth's sky
     * lands within 8 of ship-2's #3C7BD9, so the crop now carries about 600
     * blue pixels whichever hull is on: wearing ship-3 read 610 blue against a
     * bar of violet/20, and "the livery does not reach the pixels" was a
     * backdrop.
     *
     * The two frames are the same map at the same place with only the ship
     * changed, so the background cancels between them. Measured: 762 vs 610
     * blue, 0 vs 159 violet - a stripe worth ~155 px on a bed of ~610, and the
     * two stripes agree with each other to within four pixels.
     */
    const blueFromStripe = (two[0] as number) - (three[0] as number);
    const violetFromStripe = (three[1] as number) - (two[1] as number);

    expect(
      blueFromStripe,
      `ship-2's own stripe is not on the map: ${detail}`,
    ).toBeGreaterThan(MIN_STRIPE);
    expect(
      violetFromStripe,
      `ship-3's own stripe is not on the map: ${detail}`,
    ).toBeGreaterThan(MIN_STRIPE);
    // The control half: showing one hull must not put the OTHER hull's colour
    // up. Violet has no source in the backdrop, so it is read straight.
    expect(two[1], `ship-3's stripe is on the map while wearing ship-2: ${detail}`).toBeLessThan(
      violetFromStripe / 20,
    );
    // Blue has one, so the claim is that wearing ship-3 leaves NO MORE blue
    // than the bed - it cannot add any.
    expect(
      three[0] as number,
      `ship-2's stripe is on the map while wearing ship-3: ${detail}`,
    ).toBeLessThanOrEqual(two[0] as number);
  });
});
