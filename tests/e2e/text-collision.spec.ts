import { expect, test, type Page } from "@playwright/test";
import { bootScene, restartScene, settle } from "./support/lane";
import { mount, remount } from "./story-lane";

/**
 * UR-20 - NO TWO PIECES OF TEXT SHARE A ROW OF PIXELS, ON ANY STORY SCREEN, AT
 * ANY STOP.
 *
 * ================== WHY A CLASS-LEVEL TEST ==================
 * UR-20, reported on Saturn: text drawn over other text. The
 * briefing page flowed its sentences with no bound and then drew its footer at
 * an absolute y, so five of the seven stops printed one through the other. The
 * per-screen fix lives in `support/briefingLayout.ts` and is unit-tested there.
 *
 * This file is the other half, and it is the half that matters: the SAME SHAPE
 * of defect had already been reported once (UR-17, a second text at a fixed y
 * under variable-height content on the Earth activation screen), and the reason
 * it reached a player twice is that nothing in the suite ever asked the general
 * question. So the general question is asked here, structurally:
 *
 *   for every story screen, at every stop, read every VISIBLE Text object's
 *   real bounds off the live scene tree and assert that no two of them
 *   intersect, and that none of them leaves the frame.
 *
 * It knows nothing about Saturn, about "The Lantern is fuelled and ready.", or
 * about any string. New copy, a new stop, a new language or a new block is
 * checked by the same assertion on the day it lands.
 *
 * ================== THE FIXTURES ARE THE LONGEST, NOT THE HANDIEST ==================
 * Mars is what `scripts/capture-screens.mjs` boots, and Mars is the one stop
 * whose briefing fits - which is exactly why nobody saw this. Every screen here
 * is driven at all seven stops, and Results is handed a payload with EVERY
 * optional block present (a delta, a personal best, faster words, a retention
 * line and an opted-in board), because its panels are sized from what they hold.
 *
 * Re-run: npx playwright test tests/e2e/text-collision.spec.ts
 */

test.use({ trace: "off" });

const STOPS = ["earth", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"] as const;

/**
 * Long enough for every entrance on these screens: the panel fade is 260 ms
 * (`theme.DUR.panel`), the warp break's letters stagger 8 ms each, and the
 * coach note arrives inside a 1500 ms timeout (D33).
 */
const SETTLE_MS = 2000;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface TextView {
  readonly text: string;
  readonly box: Box;
}

interface FrameView {
  readonly width: number;
  readonly height: number;
  readonly texts: readonly TextView[];
}

/**
 * Every visible Text object in a scene, with the bounds Phaser actually gives
 * it. Containers are walked, because half the story screens put their header in
 * one and a container's children carry the real positions.
 */
async function textsOf(page: Page, sceneKey: string): Promise<FrameView> {
  return page.evaluate((key: string) => {
    const game = (window as unknown as { __kb: { game: Phaser.Game } }).__kb.game;
    const scene = game.scene.getScene(key) as unknown as {
      scale: { width: number; height: number };
      children: { list: unknown[] };
    };
    const out: { text: string; box: Box }[] = [];
    interface Node {
      type: string;
      visible: boolean;
      alpha: number;
      text?: unknown;
      list?: unknown[];
      getBounds?: () => { x: number; y: number; width: number; height: number };
    }
    const walk = (list: unknown[]): void => {
      for (const raw of list) {
        const o = raw as Node;
        if (o.type === "Container" && Array.isArray(o.list)) {
          walk(o.list);
          continue;
        }
        if (o.type !== "Text" || !o.visible || o.alpha <= 0.02) continue;
        const content = String(o.text ?? "");
        if (content.trim().length === 0) continue;
        if (typeof o.getBounds !== "function") continue;
        const r = o.getBounds();
        if (r.width <= 0 || r.height <= 0) continue;
        out.push({
          text: content.slice(0, 48),
          box: {
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            h: Math.round(r.height),
          },
        });
      }
    };
    walk(scene.children.list);
    return { width: scene.scale.width, height: scene.scale.height, texts: out };
  }, sceneKey) as Promise<FrameView>;
}

const intersects = (a: Box, b: Box): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const describeBox = (t: TextView): string =>
  `"${t.text}" [${t.box.x},${t.box.y} ${t.box.w}x${t.box.h}]`;

/**
 * The claim, in one place so every screen makes exactly the same one.
 *
 * ONE PIXEL OF SLACK, and no more: two Text objects whose ink boxes touch on a
 * single row are stacked lines, not a collision, and Phaser's reported height
 * includes a little leading. Anything past that is one string drawn through
 * another, which is the defect.
 */
function assertNoCollisions(frame: FrameView, where: string): void {
  const hits: string[] = [];
  const shrunk = frame.texts.map((t) => ({
    ...t,
    box: { x: t.box.x, y: t.box.y + 1, w: t.box.w, h: Math.max(1, t.box.h - 2) },
  }));
  for (let i = 0; i < shrunk.length; i += 1) {
    for (let j = i + 1; j < shrunk.length; j += 1) {
      const a = shrunk[i];
      const b = shrunk[j];
      if (a === undefined || b === undefined) continue;
      if (intersects(a.box, b.box)) {
        hits.push(`${describeBox(frame.texts[i] as TextView)}  x  ${describeBox(frame.texts[j] as TextView)}`);
      }
    }
  }
  expect(hits, `${where}: text drawn through text`).toEqual([]);

  const off = frame.texts
    .filter(
      (t) =>
        t.box.x < 0 ||
        t.box.y < 0 ||
        t.box.x + t.box.w > frame.width ||
        t.box.y + t.box.h > frame.height,
    )
    .map(describeBox);
  expect(off, `${where}: text outside the ${frame.width}x${frame.height} frame`).toEqual([]);

  // A screen with nothing on it passes every assertion above. The floor is a
  // heading plus something to read.
  expect(frame.texts.length, `${where}: nothing rendered`).toBeGreaterThan(1);
}

/**
 * The story screens that dress themselves from a stop's content.
 *
 * `Stall` and `Hud` are absent on purpose: neither takes stop copy, and the HUD
 * is an overlay rather than a screen (sceneKeys `SCENE_INVENTORY_ROW`).
 *
 * THE DRIVER DIFFERS, AND IT IS NOT A DETAIL. Four of these screens publish a
 * `window.__kb` debug bag (`support/laneInit.publishBag`) and four do not -
 * Briefing, Pre-flight, Earth activation and the Director map expose
 * `scene.snapshot()` and nothing else, which is what `story-lane.mount` waits
 * for. A first cut of this file used `bootScene` for all of them and waited
 * sixty seconds each for a bag that is never published; the four failures were
 * exactly those four screens, and none of them had reached an assertion.
 */
/**
 * `stops` is per screen, because "all seven" is not true of all of them.
 *
 * UR-40: this file drove the warp break at Earth and counted it as covered.
 * D57 makes Earth the launchpad - it has no belt, so no child can ever reach a
 * warp break there, and the frame being asserted is one the product cannot
 * produce. A coverage number that includes a screen nobody can open is a lie
 * about the number, which is worse than a smaller number.
 */
const BELT_STOPS = STOPS.filter((s) => s !== "earth");

const BAG_SCREENS = [
  { scene: "Warp", bag: "warp", stops: BELT_STOPS },
  { scene: "Beacon", bag: "beacon", stops: BELT_STOPS },
] as const;

const SNAPSHOT_SCREENS = ["Briefing", "Preflight", "EarthActivation", "DirectorMap"] as const;

for (const scene of SNAPSHOT_SCREENS) {
  test(`UR-20 ${scene}: no text collides, at any stop`, async ({ page }) => {
    // A SWEEP, not a unit: one boot and seven restarts, each of which is a
    // round trip to the browser.
    test.setTimeout(300_000);
    for (const [i, stop] of STOPS.entries()) {
      if (i === 0) await mount(page, scene, { stopId: stop });
      else await remount(page, scene, { stopId: stop });
      await settle(page, SETTLE_MS);
      assertNoCollisions(await textsOf(page, scene), `${scene}/${stop}`);
    }
  });
}

for (const screen of BAG_SCREENS) {
  test(`UR-20 ${screen.scene}: no text collides, at any stop`, async ({ page }) => {
    test.setTimeout(300_000);
    await bootScene(page, screen.scene, screen.bag);
    for (const stop of screen.stops) {
      await restartScene(page, screen.scene, { stopId: stop });
      // A FIXED SETTLE, not `waitForTweens`. Every entrance tween on these
      // screens moves ALPHA, so a text caught mid-fade is already at its final
      // position and is counted (the walk keeps anything over alpha 0.02).
      // What `waitForTweens` would add is 20 s of patience per stop for the
      // warp break's staggered letters and its 1500 ms coach timeout, seven
      // times, which is how the first run of this spec timed out rather than
      // reporting anything.
      await settle(page, SETTLE_MS);
      assertNoCollisions(await textsOf(page, screen.scene), `${screen.scene}/${stop}`);
    }
  });
}

/**
 * Results, with every optional block on screen at once.
 *
 * Its panels are sized from what they hold (`support/resultsLayout.ts`), so the
 * frame worth checking is the fullest one the screen can produce: a WPM delta
 * against a previous belt stage, a new personal best, words that got faster, a
 * retention line, and the relative board opted in.
 */
test("UR-20 Results: no text collides with every block on screen", async ({ page }) => {
  test.setTimeout(300_000);
  await bootScene(page, "Results", "results");

  // Results is reachable at every belt stop; Earth's "results" is the
  // activation screen, not this one (D57).
  for (const stop of BELT_STOPS) {
    const progress = STOPS.map((id, i) => ({
      stopId: id,
      cleared: i < 2,
      stars: 3,
      bestWpm: 18,
      bestAccuracy: 90,
      lastWpm: 18,
      lastAccuracy: 90,
      beaconPlacedAt: i < 2 ? 1 : null,
    }));
    await restartScene(page, "Results", {
      stopId: stop,
      tally: { characters: 620, elapsedMs: 60_000, hits: 58, typos: 3, hullHits: 1 },
      exposures: [
        {
          word: "beacon",
          fkLatencyMs: [300, 280],
          hit: true,
          retention: true,
          prior: {
            exposures: 4,
            hits: 4,
            misses: 0,
            typos: 0,
            fkLatencyMs: [700, 690, 680, 670],
            ikiMs: [],
            firstFkLatencyMs: 700,
            ease: 1,
            lastSeen: 1,
            nextEligibleStage: 0,
          },
        },
        {
          word: "rings",
          fkLatencyMs: [320],
          hit: true,
          retention: true,
          prior: {
            exposures: 3,
            hits: 3,
            misses: 0,
            typos: 0,
            fkLatencyMs: [900, 880, 860],
            ikiMs: [],
            firstFkLatencyMs: 900,
            ease: 1,
            lastSeen: 1,
            nextEligibleStage: 0,
          },
        },
      ],
      progress,
    });
    await settle(page, SETTLE_MS);
    assertNoCollisions(await textsOf(page, "Results"), `Results/${stop}`);
  }
});

/**
 * The Ending card, which has the same shape of risk: a closing panel whose
 * height comes from wrapped copy, with a button pinned under it.
 */
test("UR-20 Ending: no text collides", async ({ page }) => {
  test.setTimeout(120_000);
  await bootScene(page, "Ending", "ending");
  await settle(page, 2600);
  assertNoCollisions(await textsOf(page, "Ending"), "Ending");
});
