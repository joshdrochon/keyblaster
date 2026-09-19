import { expect, test, type Page } from "@playwright/test";
import { freezeReloads } from "./support/lane";
import {
  CHROME_PAD_Y,
  FOCUS_PAD,
  MIN_CLEAR,
  PRIMARY_H,
  SECONDARY_GAP,
  STACK_FLOOR,
  STATUS_GAP,
  clearGaps,
} from "../../src/game/scenes/support/titleStack";
import { TYPE } from "../../src/game/ui/theme";

/**
 * UR-68 - THE TITLE LOCKUP IS NOT SQUISHED, IN BOTH PROFILE STATES.
 *
 * ================== WHY THIS FILE EXISTS AT ALL ==================
 * The defect was reported from a build the owner was looking at, and it is only
 * visible there: the beacon status line is drawn once a beacon has been placed
 * (D13), so a fresh profile renders no such line and the crowding it caused has
 * never appeared in a capture. Every screenshot of this screen for months has
 * been of a new pilot - the same blind spot, on the same screen, that let the
 * Title accent bug live for months (`docs/verification-gaps.md`). So this file
 * boots BOTH states and refuses to be satisfied by either one alone.
 *
 * `titleStack.test.ts` holds the arithmetic. This holds the DRAWING: every
 * number below comes from a real Text object's bounds read off the live scene
 * tree, not from the module that decided where to put it.
 *
 * ================== WHAT IT MEASURED BEFORE THE FIX ==================
 * Same method, same seven stops, same five windows, against the shipped
 * spacing. Clear gaps, focus ring included, at 1920x1080:
 *
 *   returning pilot   [-4, -14]   at every stop and every window
 *   new pilot         [26]
 *
 * and after: [20, 44] returning and [44] new, at every one of the 35 returning
 * combinations and all 5 new ones.
 *
 * ================== WATCHED FAILING (coding-standards rule 4) ==================
 * `titleStack.STATUS_GAP` was set to -4, which is the offset that reproduces the
 * shipped `height + 18` placement exactly, and this file was run:
 *
 *   Error: earth 1280x720: gaps [-3.999983720499017, 44.0000057220459]
 *     expected -3.999983720499017 to be greater than or equal to 20
 *
 * Restored. It fails on the FIRST stop it reaches, which is the property that
 * matters: the drift does not have to reach a particular window to be caught.
 *
 * ================== THE ONE DIMENSION THIS FILE DOES NOT SWEEP ==================
 * LANGUAGE. `SHIPPED_LANGS` is `["en"]` (D95) and `boot.pickLang` refuses
 * `?lang=es` and `?lang=hi` precisely so an unshipped locale cannot be reached
 * from a URL, so a three-language sweep here would measure English three times
 * and report it as coverage. The line-height dimension is covered where it can
 * be measured honestly instead: `titleStack.test.ts` feeds the Devanagari line
 * box (1.56 em against Latin's 1.3, `ui/theme.LINE_HEIGHT`) straight into the
 * budget, including the language row that comes back the day a second language
 * ships. Declared here rather than silently skipped (coding-standards rule 5).
 *
 *   PW_PORT=5259 npx playwright test tests/e2e/title-lockup.spec.ts
 */

test.use({ trace: "off" });
test.describe.configure({ mode: "default", timeout: 240_000 });

const STOPS = [
  "earth",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
] as const;

/**
 * FIVE WINDOWS, NOT ONE, AND THE HEIGHTS ARE THE POINT.
 *
 * `GAME_HEIGHT` is pinned at 1080 and the world's WIDTH is the window's aspect
 * at that height (D99), so changing the window's height is how the world's
 * shape changes - and the stop's light is placed as a FRACTION of the world's
 * width, so a different height moves the sun sideways, moves the wordmark's
 * dodge, and moves the whole column with it. A fix measured at 1280x720 alone
 * would have been measured at one lockup position out of the several the seven
 * stops produce across these five.
 */
const WINDOWS = [
  { width: 1280, height: 720 },
  { width: 1280, height: 1024 },
  { width: 1440, height: 900 },
  { width: 2560, height: 1080 },
  { width: 3840, height: 1080 },
] as const;

interface Box {
  readonly text: string;
  readonly size: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /**
   * The world y of the Container this Text is drawn inside.
   *
   * THE PRIMARY'S PLATE IS NOT A TEXT AND HAS NO BOUNDS. It is a Graphics
   * filled at local (0, 0, 460, 104) inside a Container, so the Container's own
   * transform IS the plate's top edge - a drawn value, not a computed one.
   *
   * The first version of this file derived it from the label's bounds instead
   * ("the label is centred in the plate, so the plate is its centre plus or
   * minus half of PRIMARY_H") and that held at 1920 and drifted at 3840:
   *
   *   Error: mars 3840x1080: gaps [19.394098043441772, 45.120073498371084]
   *     expected 19.394098043441772 to be greater than or equal to 20
   *
   * The sum is 64.5 against a budget of 64, which is the tell: half a pixel
   * appeared out of a glyph box, not out of the layout. A wide world raises the
   * render scale and with it the Text's texture resolution (`textResolutionFor`,
   * sceneKeys.ts), and a glyph box measured at a different resolution is not the
   * rectangle the Graphics was filled at. Reading the transform removes the
   * question. The label is still measured - as a CROSS-CHECK that the plate and
   * its label agree - rather than as the source of the plate's position.
   */
  readonly parentY: number;
}

/** Every visible Text on the Title, with the bounds it is actually drawn at. */
async function textsOf(page: Page): Promise<Box[]> {
  return page.evaluate(() => {
    const game = (window as unknown as { __kb: { game: Phaser.Game } }).__kb.game;
    const scene = game.scene.getScene("Title") as unknown as { children: { list: unknown[] } };
    interface Node {
      type: string;
      visible: boolean;
      alpha: number;
      text?: unknown;
      y?: number;
      style?: { fontSize?: string };
      list?: unknown[];
      getBounds?: () => { x: number; y: number; width: number; height: number };
    }
    const out: Box[] = [];
    const walk = (list: unknown[], parentY: number): void => {
      for (const raw of list) {
        const o = raw as Node;
        if (o.type === "Container" && Array.isArray(o.list)) {
          walk(o.list, parentY + (o.y ?? 0));
          continue;
        }
        if (o.type !== "Text" || !o.visible || o.alpha <= 0.02) continue;
        const content = String(o.text ?? "");
        if (content.trim().length === 0) continue;
        if (typeof o.getBounds !== "function") continue;
        const r = o.getBounds();
        if (r.width <= 0 || r.height <= 0) continue;
        // NOT ROUNDED. The first run of this file rounded these to integers
        // and the primary's plate - which is derived from its label's CENTRE,
        // so half a rounded height - came out half a pixel low at one stop:
        //
        //   Error: mars 3840x1080: gaps [19.5,44]
        //     expected 19.5 to be greater than or equal to 20
        //
        // That 0.5 was the measurement, not the screen. The right answer is to
        // stop discarding half a pixel and measure what is there, never to
        // round the assertion down to meet it (coding-standards rule 8).
        out.push({
          text: content.slice(0, 40),
          size: Number.parseInt(o.style?.fontSize ?? "0", 10),
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
          parentY,
        });
      }
    };
    walk(scene.children.list, 0);
    return out;
  });
}

/**
 * A profile whose furthest placed beacon is `stop`, or none at all.
 *
 * This is the whole apparatus of the ticket: the state that has the defect is a
 * state you have to construct, which is why nobody ever photographed it.
 */
function profileFor(stop: string | null): string | null {
  if (stop === null) return null;
  const upTo = STOPS.indexOf(stop as (typeof STOPS)[number]);
  const progress = STOPS.map((stopId, i) => ({
    stopId,
    cleared: i <= upTo,
    stars: i <= upTo ? 3 : 0,
    bestWpm: 0,
    bestAccuracy: 0,
    lastWpm: 0,
    lastAccuracy: 0,
    beaconPlacedAt: i <= upTo ? 1_700_000_000_000 + i : null,
  }));
  return JSON.stringify({
    version: 2,
    activeProfileId: "pilot-test",
    profiles: [
      {
        id: "pilot-test",
        name: "Ada",
        avatar: "avatar-1",
        shipId: "ship-1",
        shipName: "Lantern",
        createdAt: 1_700_000_000_000,
        calibration: { ikiMs: 350, fkLatencyMs: 500 },
        progress,
        trophies: [],
        unlockedShips: ["ship-1"],
        unlockedSkins: [],
        words: {},
      },
    ],
  });
}

interface Column {
  readonly gaps: number[];
  readonly bottom: number;
  readonly overflow: number;
  readonly hasStatus: boolean;
}

/**
 * The column's boxes, reconstructed from DRAWN TEXT plus the paddings the
 * screen draws with.
 *
 * WHY NOT ASK THE SCENE. It would be one line, and it would be the scene
 * agreeing with itself - the same shape as `f(x) === f(x)`
 * (coding-standards rule 4). The primary's plate is a Graphics object with no
 * useful bounds, so it is derived from the label's own centre: the label is
 * drawn at the plate's centre with origin 0.5, so the plate is that centre plus
 * or minus half of `PRIMARY_H`. Everything else is a plated `skyText`, whose
 * plate is cut from the text's bounds plus `CHROME_PAD_Y`.
 */
function columnOf(texts: Box[]): Column | null {
  const primary = texts.filter((t) => t.size === TYPE.heading).sort((a, b) => a.y - b.y)[0];
  if (primary === undefined) return null;
  // The plate the button is, from the Container it is drawn in.
  const primaryTop = primary.parentY;
  const primaryBottom = primaryTop + PRIMARY_H;
  // AND THE CROSS-CHECK. The label is drawn at the plate's centre with origin
  // 0.5, so if these two ever disagree by more than a glyph box's rounding, the
  // plate and its label have come apart and neither number means anything.
  const labelCentre = primary.y + primary.h / 2;
  if (Math.abs(labelCentre - (primaryTop + PRIMARY_H / 2)) > 1) return null;

  const below = (size: number): Box | undefined =>
    texts.filter((t) => t.size === size && t.y > primaryBottom).sort((a, b) => a.y - b.y)[0];

  const status = below(TYPE.label);
  const settings = below(TYPE.body);
  if (settings === undefined) return null;

  const settingsTop = settings.y - CHROME_PAD_Y;
  const gaps = clearGaps({
    primaryTop,
    primaryBottom,
    statusTop: status === undefined ? null : status.y - CHROME_PAD_Y,
    statusBottom: status === undefined ? null : status.y + status.h + CHROME_PAD_Y,
    settingsTop,
  });
  return {
    gaps,
    bottom: settings.y + settings.h + CHROME_PAD_Y + FOCUS_PAD,
    overflow: 0,
    hasStatus: status !== undefined,
  };
}

async function openTitle(
  page: Page,
  stop: string | null,
  view: (typeof WINDOWS)[number],
): Promise<{ column: Column; reported: number; furthest: string | null }> {
  await page.setViewportSize({ width: view.width, height: view.height });
  await freezeReloads(page);
  const saved = profileFor(stop);
  if (saved !== null) {
    await page.addInitScript(
      ([key, payload]: [string, string]) => {
        window.localStorage.setItem(key, payload);
      },
      ["kb:v1:profiles", saved] as [string, string],
    );
  }
  await page.goto("/?scene=Title");
  await page.waitForFunction(() => window.__kb !== undefined, null, { timeout: 60_000 });
  await page.waitForFunction(
    () =>
      (window as unknown as Record<string, Record<string, unknown>>)["__kb"]?.["title"] !==
      undefined,
    null,
    { timeout: 60_000 },
  );
  /**
   * WAIT FOR THE THING, NOT FOR A CLOCK (coding-standards rule 6).
   *
   * The thing is "every block of the column is on the display list AND has
   * finished arriving". Both halves were learned the hard way.
   *
   * WAITING ON THE TWEEN MANAGER HANGS. This screen keeps the Lantern's idle
   * bob, the exhaust flicker and the parallax drift running for ever by design
   * (D41, rubric item 2 - nothing is ever still), and the first version timed
   * out at 30 s on all seven stops waiting for tweens that never finish.
   *
   * WAITING ONLY FOR PRESENCE MEASURES MID-FLIGHT. The second version did that
   * and reported fractional gaps that moved between runs:
   *
   *   mars   3840x1080  gaps [19.394098043441772, 45.120073498371084]
   *   uranus 2560x1080  gaps [17.810002088546753, 46.60652323101044]
   *
   * The budget is integer arithmetic, so a fractional gap is the tell. It is
   * `setFocus`, which pops the focused item with `scale: {from: 0.985, to: 1}`
   * on `EASE.pop` - Back.Out, which OVERSHOOTS past 1 and settles back. A
   * scaled Container moves its children's bounds while its own transform stays
   * put, so the caption inside the button drifted a couple of pixels against a
   * plate that had not moved. Nothing was wrong with the layout; the frame was
   * read while the screen was still opening.
   *
   * AT REST NO LONGER MEANS SCALE 1 (UR-111). The condition above was written
   * against `scale: { from: 0.985, to: 1 }` - a tween whose RESTING value was
   * 1, because it shrank the item and put it back. That is the defect UR-111
   * fixed: a focused control now grows 1.5% and HOLDS it, on this screen and on
   * every other one, so the focused item's `kb-pop:` container rests at 1.015
   * for as long as a player is looking at it and a wait for scale 1 waits for
   * ever. (Measured: this spec timed out at 30 s on the new-pilot lockup.)
   *
   * So "at rest" is asked as what it actually means - the transform has STOPPED
   * CHANGING - by comparing consecutive polls rather than by naming the value
   * it is supposed to stop at. That is right for the entrance tween, for the
   * Back.Out overshoot on the pop (which passes THROUGH 1.015 on its way), and
   * for whatever the next held state turns out to be.
   */
  await page.waitForFunction(
    (bodyPx: number) => {
      const game = (window as unknown as { __kb?: { game: Phaser.Game } }).__kb?.game;
      const scene = game?.scene.getScene("Title") as unknown as {
        children: { list: unknown[] };
      } | null;
      if (scene === null || scene === undefined) return false;
      interface N {
        type: string;
        visible: boolean;
        alpha: number;
        scaleX?: number;
        scaleY?: number;
        style?: { fontSize?: string };
        list?: unknown[];
      }
      const sizes: number[] = [];
      const transforms: string[] = [];
      let opaque = true;
      const walk = (list: unknown[]): void => {
        for (const raw of list) {
          const o = raw as N;
          if (o.type === "Container" && Array.isArray(o.list)) {
            // Only the containers that hold type: the parallax planes have
            // scales of their own and are nobody's menu item.
            const holdsText = o.list.some((c) => (c as N).type === "Text");
            if (holdsText) {
              transforms.push(`${o.scaleX ?? 1}|${o.scaleY ?? 1}|${o.alpha}`);
              // Alpha IS named, because the entrance tween ends at exactly 1
              // and a half-faded item is not a frame worth measuring.
              if (o.alpha !== 1) opaque = false;
            }
            walk(o.list);
            continue;
          }
          if (o.type === "Text" && o.visible) {
            sizes.push(Number.parseInt(o.style?.fontSize ?? "0", 10));
          }
        }
      };
      walk(scene.children.list);
      const now = transforms.join(" ");
      const w = window as unknown as { __titleSettle?: string };
      const still = w.__titleSettle === now;
      w.__titleSettle = now;
      // The primary's 44 px label and the quiet control's body-size one.
      return still && opaque && sizes.includes(44) && sizes.includes(bodyPx);
    },
    TYPE.body,
    { timeout: 30_000 },
  );

  const bag = await page.evaluate(
    () =>
      (window as unknown as Record<string, Record<string, unknown>>)["__kb"]?.["title"] as {
        furthestBeacon: string | null;
        stackOverflow: number;
      },
  );
  const column = columnOf(await textsOf(page));
  expect(column, `no column found at ${stop ?? "new pilot"} ${view.width}x${view.height}`)
    .not.toBeNull();
  return { column: column as Column, reported: bag.stackOverflow, furthest: bag.furthestBeacon };
}

test("UR-68: a NEW pilot's lockup has air between its two controls", async ({ page }) => {
  const seen: Record<string, number[]> = {};
  for (const view of WINDOWS) {
    const { column, reported, furthest } = await openTitle(page, null, view);
    // THE CONTROL FOR THE WHOLE FILE. If a new profile somehow renders a status
    // line, the other test is measuring the same state twice and its green
    // means nothing.
    expect(furthest, "a fresh profile must have no beacon").toBeNull();
    expect(column.hasStatus, "a fresh profile draws no status line").toBe(false);
    expect(column.gaps).toHaveLength(1);
    for (const gap of column.gaps) {
      expect(gap, `${view.width}x${view.height}: ${JSON.stringify(column.gaps)}`)
        .toBeGreaterThanOrEqual(MIN_CLEAR);
    }
    expect(column.bottom).toBeLessThanOrEqual(STACK_FLOOR);
    expect(reported).toBe(0);
    seen[`${view.width}x${view.height}`] = column.gaps;
  }
  // Pre-fix this read 26 at all five. It is a real gap either way; it is here
  // so the number is on the record next to the returning pilot's -4 and -14.
  expect(Object.keys(seen)).toHaveLength(WINDOWS.length);
});

test("UR-68: a RETURNING pilot's lockup has air around the status line", async ({ page }) => {
  /**
   * RULE 5: SWEEP, DO NOT SAMPLE. Seven stops times five windows. The stop
   * matters because the Title wears the furthest beacon's palette and dodges
   * that stop's light, and the window matters because the light is placed as a
   * fraction of a world whose width is the window's aspect - Neptune and Pluto
   * never move the lockup at all, Mars moves it furthest, and at 32:9 every
   * stop stops moving it. That is five distinct lockup positions hiding behind
   * "the Title screen".
   */
  const report: Record<string, number[]> = {};
  for (const stop of STOPS) {
    for (const view of WINDOWS) {
      const at = `${stop} ${view.width}x${view.height}`;
      const { column, reported, furthest } = await openTitle(page, stop, view);
      expect(furthest, `${at}: the profile did not load`).toBe(stop);
      expect(column.hasStatus, `${at}: no status line was drawn`).toBe(true);
      expect(column.gaps).toHaveLength(2);
      for (const gap of column.gaps) {
        expect(gap, `${at}: gaps ${JSON.stringify(column.gaps)}`).toBeGreaterThanOrEqual(
          MIN_CLEAR,
        );
      }
      // The caption belongs to the button above it, so the break BELOW it has
      // to be the bigger one. Pre-fix both were negative and this was 10 vs 0.
      expect(column.gaps[1], `${at}`).toBeGreaterThan(column.gaps[0] ?? 0);
      expect(column.bottom, `${at}`).toBeLessThanOrEqual(STACK_FLOOR);
      expect(reported, `${at}: the column reported overflow`).toBe(0);
      report[at] = column.gaps;
    }
  }
  expect(Object.keys(report), JSON.stringify(report)).toHaveLength(STOPS.length * WINDOWS.length);
  // The budget the module publishes is the budget the screen draws, within the
  // pixel a measured line box can round by.
  for (const [at, gaps] of Object.entries(report)) {
    expect(Math.abs((gaps[0] ?? 0) - STATUS_GAP), at).toBeLessThanOrEqual(1);
    expect(Math.abs((gaps[1] ?? 0) - SECONDARY_GAP), at).toBeLessThanOrEqual(1);
  }
});
