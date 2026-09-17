import { expect, test, type Page } from "@playwright/test";
import { charted, mount, snapshot } from "./story-lane";
import { bootScene, restartScene, settle, snap } from "./support/lane";
import { focused, items, open, press, screen, snapshot as menuSnapshot } from "./lib/menus";

/**
 * AC-18.1: EVERY FOCUSABLE CONTROL IS ALSO CLICKABLE, and the keyboard alone is
 * still enough for all of it.
 *
 * The defect: nothing in the game responded to a mouse. D37 chose the keyboard
 * as the input model; it never said a click should do nothing, and a child who
 * clicks a button, gets no response, and concludes the game is broken has been
 * failed by the product whatever the decision log says. Both halves are tested
 * here, and the second half is the load-bearing one: adding a pointer must not
 * cost the keyboard anything.
 *
 * THE INVARIANT, not a sample. Every hit area in the game is a Phaser Zone
 * named `kb-hit:<id>` (ui/focus.ts), so a test can enumerate a screen's hit
 * areas and compare them with the screen's focusable set. That is what makes
 * this a rule rather than five buttons somebody remembered to wire: a control
 * only the keyboard reaches and a click target with no focus entry both fail
 * the same assertion.
 */

const HIT_PREFIX = "kb-hit:";

const STOPS = ["earth", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"] as const;

/**
 * A full profile for the Results screen.
 *
 * `relativeBoard` is the lever these specs care about: false means the D43
 * one-time opt-in prompt is on screen (and holds the caret), true means it is
 * not (and `continue` holds the caret). Handed to the scene explicitly so the
 * fixture cannot write itself into a real save.
 */
function resultsProfile(relativeBoard: boolean): Record<string, unknown> {
  return {
    id: "pilot-test",
    name: "Ada",
    avatar: "avatar-1",
    shipId: "ship-1",
    shipName: "Lantern",
    createdAt: 1,
    calibration: { ikiMs: 350, fkLatencyMs: 500 },
    settings: {
      musicVolume: 0.7,
      sfxVolume: 0.8,
      keyboardLayout: "qwerty",
      uiLang: "en",
      contentLang: "en",
      inputMethod: "latin",
      uppercase: false,
      increasedLetterSpacing: false,
      reducedMotion: false,
      colorblindPalette: false,
      relativeBoard,
    },
    progress: STOPS.map((stopId) => ({
      stopId,
      cleared: stopId === "earth" || stopId === "mars",
      stars: 3,
      bestWpm: stopId === "mars" ? 22 : 0,
      bestAccuracy: 0.95, // fraction, as the engine produces it
      lastWpm: 20,
      lastAccuracy: 94,
      beaconPlacedAt: stopId === "earth" || stopId === "mars" ? 1 : null,
    })),
    trophies: [],
    unlockedShips: ["ship-1"],
    unlockedSkins: [],
    words: {},
  };
}


interface HitBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Every named hit area in a scene, in GAME coordinates.
 *
 * Read off the live display list rather than from a debug field a scene could
 * forget to publish - the zones ARE the input surface, so reading them is
 * reading what the player can actually hit.
 */
async function hitBoxes(page: Page, sceneKey: string): Promise<HitBox[]> {
  return page.evaluate(
    ([key, prefix]) => {
      const kb = (window as unknown as { __kb: Record<string, unknown> }).__kb;
      const game = kb["game"] as {
        scene: {
          getScene(k: string): {
            children: { list: { name?: string; x: number; y: number; width: number; height: number }[] };
          } | null;
        };
      };
      const scene = game.scene.getScene(key);
      if (scene === null) return [];
      return scene.children.list
        .filter((o) => typeof o.name === "string" && o.name.startsWith(prefix))
        .map((o) => ({
          id: (o.name as string).slice(prefix.length),
          x: o.x,
          y: o.y,
          w: o.width,
          h: o.height,
        }));
    },
    [sceneKey, HIT_PREFIX] as [string, string],
  );
}

/**
 * The GAME canvas, not the letterbox backdrop behind it.
 *
 * `#app` holds two canvases since the aspect-ratio fix (ui/viewportBackdrop.ts)
 * and the backdrop is the one that fills the window, so an unqualified
 * `#app canvas` would measure the wrong rectangle and every click would land
 * somewhere the player never aimed.
 */
function gameCanvas(page: Page) {
  return page.locator('#app canvas:not([data-testid="viewport-backdrop"])');
}

/**
 * Game coordinate -> page coordinate.
 *
 * `Scale.FIT` scales and centres the canvas, so a game coordinate is not a page
 * coordinate. The canvas's own bounding box carries both the scale and the
 * offset, which is why the conversion is MEASURED rather than assumed - it
 * stays correct at every window size, including the letterboxed ones
 * `aspect.spec.ts` covers.
 */
async function pagePoint(
  page: Page,
  box: HitBox,
): Promise<{ x: number; y: number }> {
  const rect = await gameCanvas(page).boundingBox();
  expect(rect, "the game canvas has no box").not.toBeNull();
  const frame = rect as { x: number; y: number; width: number; height: number };
  const scale = frame.width / 1920;
  return {
    x: frame.x + (box.x + box.w / 2) * scale,
    y: frame.y + (box.y + box.h / 2) * scale,
  };
}

async function clickBox(page: Page, box: HitBox): Promise<void> {
  const point = await pagePoint(page, box);
  await page.mouse.click(point.x, point.y);
}

async function hoverBox(page: Page, box: HitBox): Promise<void> {
  const point = await pagePoint(page, box);
  await page.mouse.move(point.x, point.y);
}

function boxFor(boxes: HitBox[], id: string): HitBox {
  const found = boxes.find((b) => b.id === id);
  expect(found, `no hit area named ${HIT_PREFIX}${id}`).toBeDefined();
  return found as HitBox;
}

// ---------------------------------------------------------------------------
// The UI kit: a whole screen, driven entirely by the mouse
// ---------------------------------------------------------------------------

test.describe("AC-18.1: the pointer reaches everything the keyboard does", () => {
  test.setTimeout(120_000);

  test("AC-18.1: Settings is operable end to end with the mouse alone", async ({
    page,
  }) => {
    await open(page, "Settings");
    await settle(page, 400);

    const boxes = await hitBoxes(page, "Settings");
    expect(boxes.length, "Settings has no hit areas at all").toBeGreaterThan(3);

    // 1. THE HIT AREAS ARE EXACTLY THE FOCUSABLE SET. Not a subset either way.
    const focusableIds = await items(page, "Settings").evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-id") ?? ""),
    );
    expect([...boxes.map((b) => b.id)].sort()).toEqual([...focusableIds].sort());

    // 2. HOVER MOVES FOCUS, so the mouse has a visible "you are here" and it is
    //    the same one the keyboard has.
    const last = boxFor(boxes, focusableIds[focusableIds.length - 1] as string);
    await hoverBox(page, last);
    await expect(screen(page, "Settings")).toHaveAttribute("data-focus", last.id);
    await expect(focused(page, "Settings")).toHaveCount(1);
    await expect(screen(page, "Settings")).toHaveAttribute("data-focus-ring", "true");

    // 3. A CLICK CHANGES A VALUE. The reduced-motion toggle is a real setting
    //    with a real consequence (AC-19.3), so this is a click that did
    //    something, not a click that merely repainted a plate.
    const toggleId = "settings.reducedMotion";
    expect(focusableIds, "settings has no reduced-motion row").toContain(toggleId);
    const toggle = boxFor(boxes, toggleId);

    const before = await menuSnapshot(page, "Settings");
    const beforeItems = (before["items"] ?? []) as { id: string; value?: string }[];
    const beforeValue = beforeItems.find((i) => i.id === toggleId)?.value;

    // The right half of an adjustable row is +1, the same as ArrowRight.
    await clickBox(page, { ...toggle, x: toggle.x + toggle.w * 0.75, w: 2 });
    await settle(page, 300);

    const after = await menuSnapshot(page, "Settings");
    const afterItems = (after["items"] ?? []) as { id: string; value?: string }[];
    expect(afterItems.find((i) => i.id === toggleId)?.value).not.toBe(beforeValue);
  });

  test("AC-18.1: the keyboard is untouched by the pointer being wired", async ({
    page,
  }) => {
    // The whole point of the change is that it costs the keyboard nothing. A
    // pure-keyboard walk of the same screen, with no mouse event of any kind.
    await open(page, "Settings");
    await settle(page, 400);

    const ids = await items(page, "Settings").evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-id") ?? ""),
    );
    expect(ids.length).toBeGreaterThan(3);

    await expect(screen(page, "Settings")).toHaveAttribute("data-focus", ids[0] as string);
    for (let i = 1; i < ids.length; i += 1) {
      await press(page, "ArrowDown");
      await expect(screen(page, "Settings")).toHaveAttribute("data-focus", ids[i] as string);
      await expect(screen(page, "Settings")).toHaveAttribute("data-focus-ring", "true");
    }
    // And it wraps, so the list never dead-ends.
    await press(page, "ArrowDown");
    await expect(screen(page, "Settings")).toHaveAttribute("data-focus", ids[0] as string);
  });

  // -------------------------------------------------------------------------
  // The story kit: the same rules, a different menu implementation
  // -------------------------------------------------------------------------

  test("AC-18.1: Results answers the mouse, and clicking `replay` replays", async ({
    page,
  }) => {
    await bootScene(page, "Results", "results");
    // Opted in, so the D43 prompt is not on screen: this test is about the two
    // buttons, and a prompt would add two more hit areas to reason about.
    await restartScene(page, "Results", {
      stopId: "mars",
      profile: resultsProfile(true),
      tally: { characters: 210, elapsedMs: 60_000, hits: 12, typos: 3, hullHits: 0 },
      exposures: [],
    });
    await settle(page);

    const boxes = await hitBoxes(page, "Results");
    const before = await snap<{ focusId: string; focusIds: string[] }>(page, "results");
    expect([...boxes.map((b) => b.id)].sort()).toEqual([...before.focusIds].sort());
    expect(before.focusId).toBe("continue");

    // Hover the OTHER button: focus follows the mouse, so the ring and the
    // cursor never disagree about what Enter would do.
    await hoverBox(page, boxFor(boxes, "replay"));
    await settle(page, 250);
    expect((await snap<{ focusId: string }>(page, "results")).focusId).toBe("replay");

    // And a click actually leaves the screen - replay restarts the stage.
    await clickBox(page, boxFor(boxes, "replay"));
    await page.waitForFunction(
      () => {
        const kb = (window as unknown as { __kb: Record<string, unknown> }).__kb;
        const game = kb["game"] as {
          scene: { getScenes(active: boolean): { scene: { key: string } }[] };
        };
        return !game.scene.getScenes(true).some((s) => s.scene.key === "Results");
      },
      null,
      { timeout: 60_000 },
    );
  });

  test("AC-18.1: Briefing's launch button is clickable", async ({ page }) => {
    await mount(page, "Briefing", { stopId: "mars", progress: [charted("earth", 3, 0, 0)] });
    const boxes = await hitBoxes(page, "Briefing");
    const before = await snapshot(page, "Briefing");

    // THE POINTER REACHES EXACTLY THE FOCUSABLE SET - not "exactly one thing".
    //
    // This asserted `toEqual([before.focusId])`, which was true only while the
    // Briefing had a single control, and UR-27 added a second one (the back
    // chip) because a player who opened a stop had no way out. The count was
    // never the claim: `lib/kit.createKeyboardMenu` builds one hit zone per
    // focus target precisely so "the mouse reaches exactly the same set of
    // things the keyboard does and nothing more". That is what is checked now,
    // and it holds for a screen with one control or with five.
    const focusable = (before["controls"] as { id: string }[]).map((c) => c.id);
    expect([...boxes.map((b) => b.id)].sort()).toEqual([...focusable].sort());
    expect(focusable).toContain(before["focusId"]);

    await clickBox(page, boxFor(boxes, "launch"));
    await page.waitForFunction(
      () => {
        const kb = (window as unknown as { __kb: Record<string, unknown> }).__kb;
        const game = kb["game"] as {
          scene: { getScenes(active: boolean): { scene: { key: string } }[] };
        };
        return !game.scene.getScenes(true).some((s) => s.scene.key === "Briefing");
      },
      null,
      { timeout: 60_000 },
    );
  });
});
