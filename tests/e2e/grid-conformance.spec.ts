import { expect, test, type Page } from "@playwright/test";
import { restartScene, settle } from "./support/lane";
import { freezeReloads } from "./support/lane";
import {
  GUTTER,
  HEADER_CONTRACT,
  HINT_CONTRACT,
  headingText,
  hintText,
} from "../../src/game/ui/grid";

/**
 * UR-19 - EVERY PAGE FOLLOWS SUIT, AS THREE MEASUREMENTS.
 *
 * ================== WHY THIS FILE EXISTS ==================
 * UR-19 asked for every screen to be laid out to one shared standard.
 * `ui/grid.ts` gave the product one gutter and one heading line and a unit
 * guard against literal
 * coordinates, and the ticket was closed. A blind critic then measured the
 * running game and found the fix had been judged on the four screens that
 * already looked alike:
 *
 *   header shared by 4 of 9 · hint line at 6 x positions and 4 y values, three
 *   screens with none · Title, Pre-flight and Ending do not reflow, so their
 *   right margin moves from 845 to 1485 on a 2560 window.
 *
 * The critic's closing point is the one that matters and it is why this is a
 * test rather than a patch: nothing in `tests/` asserted a shared header
 * ORIGIN, a shared hint BAND, or that a screen reflows - and `text-collision`
 * only asks whether text overlaps, which a blank wireframe passes. Without
 * these three, the next copy change or new screen drifts again with a fully
 * green suite.
 *
 * ================== HOW A KNOWN GAP IS HANDLED ==================
 * Five screens do not conform today. They are NAMED below with what they do
 * instead and who owns the fix, the list may only shrink, and a stale entry
 * fails. That is the same shape as `arch/profileWriters.test.ts`'s orphan list,
 * and it is the opposite of deleting the assertion: the check runs over all
 * nine screens on every run, and closing one is one line here.
 *
 *   npx playwright test tests/e2e/grid-conformance.spec.ts
 */

test.use({ trace: "off" });

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface TextView {
  readonly text: string;
  readonly size: number;
  readonly box: Box;
}

async function textsOf(page: Page, sceneKey: string): Promise<TextView[]> {
  return page.evaluate((key: string) => {
    const game = (window as unknown as { __kb: { game: Phaser.Game } }).__kb.game;
    const scene = game.scene.getScene(key) as unknown as { children: { list: unknown[] } };
    const out: TextView[] = [];
    interface Node {
      type: string;
      visible: boolean;
      alpha: number;
      text?: unknown;
      style?: { fontSize?: string };
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
          text: content.slice(0, 40),
          size: Number.parseInt(o.style?.fontSize ?? "0", 10),
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
    return out;
  }, sceneKey) as Promise<TextView[]>;
}

/**
 * The nine screens a player walks through, in route order.
 *
 * No per-screen driver any more: `open()` navigates to each one and waits for
 * the scene itself to report active, which works whether or not the screen
 * publishes a `__kb` debug bag. Four of them do and four do not, and letting
 * that difference leak into this list is what made the first three runs fail.
 */
const SCREENS = [
  { key: "Title" },
  { key: "EarthActivation" },
  { key: "DirectorMap" },
  { key: "Briefing" },
  { key: "Preflight" },
  { key: "Warp" },
  { key: "Beacon" },
  { key: "Results" },
  { key: "Ending" },
] as const;

/**
 * Screens that do not meet a contract TODAY, with what they do instead.
 *
 * Every entry is a defect, not a design. The list may only shrink; the stale
 * check fails if a screen starts conforming and is left here.
 *
 * PRE-FLIGHT WAS IN BOTH LISTS AND IS OUT OF BOTH (UR-39). It had no header at
 * all - the only story screen with nothing above y=320 - and its hint floated
 * at the window's centre. It now carries a title and stop name on the header
 * lines and its hint sits on the gutter in the band, which is what taking two
 * entries out of these lists is supposed to mean.
 */
const HEADER_GAPS: Readonly<Record<string, string>> = {
  Title: "a 128 px centred wordmark. A logo is not a screen title; arguably the one legitimate entry here",
  EarthActivation: "a 24 px chip centred at (837, 100), not a title at the origin",
  Briefing: "a 20 px eyebrow over a 44 px title at (168, 153), inside the page plate",
  Ending: "a 72 px headline centred at (677, 86) on the card",
};

/**
 * HOW EACH SCREEN IS ANCHORED, declared rather than inferred.
 *
 * "Everything moves or nothing does" was the first rule here and it is wrong:
 * the Director map is correctly anchored to BOTH gutters at once - a header
 * column that stays put and navigation chips on the right that move - plus a
 * route whose seven stop labels are distributed along the span between them,
 * so they drift by 59, 107, 213, 427 and 534 px of a 641 px widening. None of
 * that is drift; all of it is the composition doing its job.
 *
 * So the model is declared and each element is measured against it. The two
 * real defects this caught are both a single element disagreeing with its own
 * screen's model - the Briefing's back chip (right-anchored on a fixed screen)
 * and Earth activation's Shadow line (fixed on a centred screen).
 */
type AnchorModel = "fixed" | "centred" | "composite";

const ANCHOR_MODEL: Readonly<Record<string, AnchorModel>> = {
  Title: "fixed",
  EarthActivation: "centred",
  DirectorMap: "composite",
  Briefing: "fixed",
  Preflight: "fixed",
  Warp: "fixed",
  Beacon: "fixed",
  Results: "fixed",
  Ending: "fixed",
};

/**
 * The one screen whose model this file does not check, and why.
 *
 * A route that distributes labels between two gutters is a legitimate fourth
 * model; checking it would mean restating `DirectorMapScene`'s own route maths
 * here, and a test that reimplements the thing it measures agrees with itself
 * rather than with the product. Declared, so the exemption is a sentence
 * somebody can disagree with rather than a silent gap.
 */
const COMPOSITE_REASON =
  "header on the left gutter, chips on the right, and seven route labels " +
  "distributed along the span between them";

/**
 * The screens with no text on the hint line, and why.
 *
 * THE LIST MAY ONLY SHRINK, and two entries changed shape under UR-56 rather
 * than leaving it. A hint that repeats the verb on the button beside it was
 * reported as noise, and the same shape was on two screens: Beacon drew
 * "enter to continue" 28 px from a button reading "continue", Briefing drew
 * "enter to launch · esc to go back" under a button reading "launch" and a chip
 * reading "back to the map". Neither was moved to the gutter - a hint with
 * nothing of its own to say does not belong anywhere - so both are now in this
 * list for the same reason the Title and Earth activation are: there is no hint
 * line, on purpose. `src/game/ui/hint.ts` carries the rule and
 * `tests/unit/ui/hint.test.ts` sweeps every scene for it.
 *
 * DirectorMap LEFT the list. Its hint was centred at the foot of the screen;
 * it is on the gutter in the band now (UR-54).
 */
const HINT_GAPS: Readonly<Record<string, string>> = {
  Title: "no hint line; the menu items carry their own sublines",
  EarthActivation: "no hint line",
  Beacon: "no hint line (UR-56): one focused button, which names its own action",
  Briefing: "no hint line (UR-56): both actions are labelled plates on screen",
  Warp: "hint sits inside the sentence card",
  Ending: "hint sits under the centred button",
};

/**
 * Open one screen, from scratch.
 *
 * IT NAVIGATES EVERY TIME, and that is the whole point. `story-lane.mount`
 * skips its `page.goto` when the URL already contains `scene=` - a sensible
 * guard for a spec that drives ONE screen, and wrong for this file, which
 * walks nine on one page. After the first screen every later `mount` waited
 * sixty seconds for a scene the page had never been sent to. Three runs of this
 * spec failed that way before the cause was read rather than guessed at.
 */
/**
 * WAIT FOR THE ENTRANCE TO LAND, NOT FOR A CLOCK (coding-standards rule 6).
 *
 * Every screen here arrives: `TitleScene` tweens each menu item in from
 * `x - 26` over 420 ms with a 90 ms stagger, and the others do something
 * similar. `settle(2200)` is four times the longest of those and it STILL
 * measured mid-flight on a cold dev server - the Title reported exactly 26 px
 * of "drift" between the two viewports, which is not a drift, it is the
 * entrance offset read before the tween finished. A clock is not a
 * synchronisation primitive; the number it produced was a property of the
 * machine, not of the layout.
 *
 * Repeating tweens are SKIPPED, and they have to be: the Lantern's idle bob and
 * the exhaust flicker never finish by design (D41 keeps the world alive), so
 * "no tweens are running" would wait for ever on three screens.
 *
 * The timeout falls back to the old behaviour rather than failing: this helper
 * is a wait, and a wait that turns a slow machine into a red gate has replaced
 * one bad measurement with another.
 */
async function awaitArrivals(page: Page, key: string): Promise<void> {
  try {
    await page.waitForFunction(
      (k) => {
        const kb = window.__kb;
        const scene = kb?.game.scene.getScene(k) as unknown as {
          tweens?: { getTweens: () => { repeat?: number; loop?: number; totalProgress?: number }[] };
        } | null;
        const tweens = scene?.tweens?.getTweens() ?? [];
        return tweens.every(
          (t) => t.repeat === -1 || t.loop === -1 || (t.totalProgress ?? 1) >= 1,
        );
      },
      key,
      { timeout: 8_000 },
    );
  } catch {
    // Fall through: `settle` below is the floor this file always had.
  }
}

async function open(page: Page, screen: (typeof SCREENS)[number]): Promise<void> {
  await freezeReloads(page);
  await page.goto(`/?scene=${screen.key}`);
  await page.waitForFunction(() => window.__kb !== undefined, null, { timeout: 60_000 });
  await page.waitForFunction(
    (k) => {
      const kb = window.__kb;
      const scene = kb?.game.scene.getScene(k) as { scene?: { isActive(): boolean } } | null;
      return scene !== null && scene?.scene?.isActive() === true;
    },
    screen.key,
    { timeout: 60_000 },
  );
  await restartScene(page, screen.key, { stopId: "mars" });
  await settle(page, 2200);
  await awaitArrivals(page, screen.key);
}

/**
 * ONE PASS, THREE CLAIMS.
 *
 * Each contract was its own test first, and each one re-opened all nine
 * screens: 27 page loads for 9 screens' worth of information. On a machine
 * running other lanes' suites that never finished. The frames are identical for
 * all three questions, so they are gathered once and asked three times.
 */
test("UR-19: every page follows suit - header, hint and anchoring", async ({ page }) => {
  test.setTimeout(600_000);

  const headerFails: string[] = [];
  const headerOk: string[] = [];
  const hintFails: string[] = [];
  const anchorReport: Record<string, string> = {};

  for (const screen of SCREENS) {
    await page.setViewportSize({ width: 1280, height: 720 });
    await open(page, screen);
    const narrow = await textsOf(page, screen.key);

    // --- 1. the title's origin ------------------------------------------
    const header = narrow.filter((t) => t.box.y < 240).sort((a, b) => b.size - a.size)[0];
    // TWO ACCEPTABLE ORIGINS, and getting this wrong is what the first run of
    // this test did. A title drawn by `skyText` sits on a plate, and the PLATE
    // is what lands on the grid line - the ink is one padding in from it, at
    // `headingText()`. Measuring the ink against the plate's corner reported
    // Map, Warp, Beacon and Results as non-conforming when they are the four
    // screens that agree.
    const plated = headingText();
    const on = (b: Box, x: number, y: number): boolean =>
      Math.abs(b.x - x) <= HEADER_CONTRACT.tolerance &&
      Math.abs(b.y - y) <= HEADER_CONTRACT.tolerance;
    const headerConforms =
      header !== undefined &&
      (on(header.box, HEADER_CONTRACT.origin.x, HEADER_CONTRACT.origin.y) ||
        on(header.box, plated.x, plated.y));
    if (headerConforms) headerOk.push(screen.key);
    else headerFails.push(screen.key);

    // --- 2. the hint band -------------------------------------------------
    //
    // TWO ACCEPTABLE ORIGINS, exactly as the header check above has. The menu
    // kit draws its hint UNPLATED, so its ink lands on the gutter; a story
    // screen draws it with `skyText`, and there it is the PLATE that lands on
    // the gutter while the ink sits one padding in (`grid.ts`, "PLATED TEXT" -
    // putting the ink on the line is what made the Results heading look like it
    // was hugging the corner). Measuring plated ink against the plate's corner
    // reported the Director map as non-conforming when its hint plate starts on
    // the same line as its heading plate and its board, which is the alignment
    // UR-54 asked for. Same defect the header check already documents, one
    // contract further down the file.
    const inBand = narrow.filter(
      (t) =>
        t.box.y >= HINT_CONTRACT.top - HINT_CONTRACT.slack &&
        t.box.y <= HINT_CONTRACT.top + HINT_CONTRACT.slack,
    );
    const platedHintX = hintText().x;
    if (
      !inBand.some(
        (t) =>
          Math.abs(t.box.x - HINT_CONTRACT.x) <= 4 || Math.abs(t.box.x - platedHintX) <= 4,
      )
    ) {
      hintFails.push(screen.key);
    }

    // --- 3. anchoring -----------------------------------------------------
    await page.setViewportSize({ width: 1707, height: 720 });
    await restartScene(page, screen.key, { stopId: "mars" });
    await settle(page, 2200);
    await awaitArrivals(page, screen.key);
    const wide = await textsOf(page, screen.key);

    // KEYED BY TEXT **AND OCCURRENCE**. The warp break draws one Text per
    // CHARACTER, so a map keyed by content alone keeps only the last "a" and
    // silently compares it to the first one - which reported six phantom drifts
    // on a screen that does not move at all. Third measurement bug in this file
    // caught by reading the numbers instead of the summary.
    const key = (t: TextView, seen: Map<string, number>): string => {
      const n = seen.get(t.text) ?? 0;
      seen.set(t.text, n + 1);
      return `${t.text}#${n}`;
    };
    const wideSeen = new Map<string, number>();
    const wideBy = new Map(wide.map((t) => [key(t, wideSeen), t]));
    const narrowSeen = new Map<string, number>();
    const drifts = narrow
      .map((t) => {
        const other = wideBy.get(key(t, narrowSeen));
        return other === undefined ? null : other.box.x - t.box.x;
      })
      .filter((d): d is number => d !== null);

    expect(drifts.length, `${screen.key}: nothing matched across widths`).toBeGreaterThan(1);

    const model = ANCHOR_MODEL[screen.key];
    const delta = 2561 - 1920;
    const expected = model === "centred" ? delta / 2 : 0;
    const off = model === "composite" ? [] : drifts.filter((d) => Math.abs(d - expected) > 6);
    anchorReport[screen.key] = `${model}: ${drifts.length - off.length}/${drifts.length} on model`;
    expect(
      off,
      `${screen.key} is declared "${model}" but ${off.length} element(s) drifted ${[...new Set(off)].join(", ")}`,
    ).toEqual([]);
  }

  // --- the two gap lists, each only allowed to shrink ---------------------
  expect(headerFails.filter((k) => HEADER_GAPS[k] === undefined)).toEqual([]);
  expect(
    Object.keys(HEADER_GAPS).filter((k) => !headerFails.includes(k)),
    "a screen started conforming and its gap entry was left behind",
  ).toEqual([]);
  expect(headerOk.length, "nothing conforms, so this measures nothing").toBeGreaterThanOrEqual(4);

  expect(hintFails.filter((k) => HINT_GAPS[k] === undefined)).toEqual([]);
  expect(Object.keys(HINT_GAPS).filter((k) => !hintFails.includes(k))).toEqual([]);

  // THE CONTROL for the anchoring half. Earth activation is centre-anchored, so
  // its elements MUST move when the world widens; if they stop, the viewport
  // never changed and every green above is worthless.
  expect(ANCHOR_MODEL["EarthActivation"]).toBe("centred");
  expect(anchorReport["EarthActivation"], JSON.stringify(anchorReport)).toMatch(/^centred/);

  // The one exemption is named and is the only one.
  expect(
    Object.entries(ANCHOR_MODEL)
      .filter(([, m]) => m === "composite")
      .map(([k]) => k),
  ).toEqual(["DirectorMap"]);
  expect(COMPOSITE_REASON.length).toBeGreaterThan(40);
  expect(GUTTER).toBe(96);
});
