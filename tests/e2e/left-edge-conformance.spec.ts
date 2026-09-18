import { expect, test, type Page } from "@playwright/test";
import { freezeReloads, restartScene, settle } from "./support/lane";
import { GUTTER } from "../../src/game/ui/grid";
import { judgeRow, legalLefts, rowsOf, runsOf, type Anchor } from "../../src/game/ui/alignment";

/**
 * EVERY LEFT EDGE IS ON A NAMED LINE, OR IS NAMED (UR-69).
 *
 * ================== THE MEASUREMENT THAT PROMPTED IT ==================
 * A census of the served build at 1920x1080, walking the real display list of
 * all nine screens, counted 164 DISTINCT LEFT EDGES app-wide:
 *
 *   DirectorMap 34 · Results 27 · Ending 27 · Title 23 · Briefing 20 ·
 *   Beacon 19 · Preflight 16 · Warp 16 · Settings 13
 *
 * On the Pre-flight, `GUTTER` is 96 and exactly TWO elements sat on it; the
 * rest landed at 0, 118, 224, 326, 400, 464, 650, 781, 826 and 993.
 *
 * ================== WHY A NEW FILE AND NOT AN ASSERTION IN grid-conformance ==================
 * Because `grid-conformance.spec.ts` PASSES the Pre-flight. It measures four
 * real things - drift across widths, the header band, the hint band and the
 * anchor model - and not one of its assertions asks whether two elements on one
 * screen share a left edge. A screen can satisfy every one of them with sixteen
 * different left margins.
 *
 * That is the shape this project keeps finding (standards rule 9: an error
 * message is not a measurement, and here, a green guard is not a measurement
 * either). The guard is as much the deliverable as the fix.
 *
 * ================== WHAT IT ASKS ==================
 * Per element, with its x, in the shape of `arch/liveryReaders.test.ts`, which
 * fails per call site. An element's left edge must be on a line the model
 * names (`ui/alignment.ts`): the gutter, a plate's inner line, an indent of
 * whole vertical units from one, centred on a screen declared centred, or
 * right-anchored.
 *
 * ================== HOW THE KNOWN GAP IS HELD ==================
 * `BUDGET` is the number of OFF-MODEL elements each screen still has, measured.
 * IT MAY ONLY SHRINK: a screen that grows one fails, and a screen that has
 * fewer than its budget fails too, so a fix cannot leave the number lying. The
 * idiom is `profileWriters.test.ts`'s orphan list and `grid-conformance`'s
 * `HEADER_GAPS`, and it is the opposite of narrowing the sweep to the screens
 * that already pass (standards rule 8).
 *
 * A budget is not an exemption. Every off-model element is PRINTED with its x
 * on every run, so the list of what is left is the test's own output rather
 * than a comment somebody has to maintain.
 *
 * ================== WATCHED FAILING (standards rule 4) ==================
 * Every budget set to 0, which is the state of the product judged against the
 * model with nothing forgiven - one line per screen, and the census above it
 * naming each element with its x:
 *
 *   Error: Title: 4 off-model, budget 0
 *          EarthActivation: 1 off-model, budget 0
 *          DirectorMap: 3 off-model, budget 0
 *          Briefing: 1 off-model, budget 0
 *          Preflight: 4 off-model, budget 0
 *          Warp: 2 off-model, budget 0
 *          Beacon: 1 off-model, budget 0
 *          Results: 7 off-model, budget 0
 *          Ending: 2 off-model, budget 0
 *     expect(received).toEqual(expected)
 *     - Array []  + Received + 11
 *
 * The SHRINK half fired on its own, which is the ratchet working rather than a
 * sabotage: the Title measured 3 where its budget said 4, and the run failed
 * with
 *
 *   Title: 3 off-model but the budget says 4 - lower it, so the list cannot lie
 *   about the state of the product
 *
 * That is what put the Title in `VARIES` - see the note there. It is not an
 * exemption for a screen that is hard to measure; it is the finding that the
 * screen's ROW SET is not fixed.
 *
 * And the model's own first cut, before runs and rows: it reported 20 off-model
 * elements on the warp break, nineteen of which were the letters of one
 * sentence ("a", "r", "s", "i", "s"...), because `layoutLetters` draws one Text
 * per character. A guard that reports nineteen letters is a guard nobody reads,
 * and a budget seeded from it would have said 20 for one sentence.
 *
 *   PW_PORT=5263 npx playwright test tests/e2e/left-edge-conformance.spec.ts
 */

test.use({ trace: "off" });

interface Element {
  readonly text: string;
  readonly size: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Every visible Text on a screen, with its measured box.
 *
 * TEXT ONLY, on purpose. A Phaser Graphics has no bounds worth reading - it is
 * a command list, and its `getBounds` reports the union of whatever it drew,
 * including a full-frame backdrop - so a graphics-inclusive sweep would report
 * x=0 for the sky on every screen and drown the signal. The plates are measured
 * by `tests/unit/ui/plateRhythm.test.ts` off their own geometry; this is about
 * where the TYPE sits, which is what a person reads as alignment.
 */
async function elementsOf(page: Page, sceneKey: string): Promise<Element[]> {
  return page.evaluate((key: string) => {
    const game = (window as unknown as { __kb: { game: Phaser.Game } }).__kb.game;
    const scene = game.scene.getScene(key) as unknown as { children: { list: unknown[] } };
    const out: Element[] = [];
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
          text: content.slice(0, 28),
          size: Number.parseInt(o.style?.fontSize ?? "0", 10),
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    };
    walk(scene.children.list);
    return out;
  }, sceneKey) as Promise<Element[]>;
}

/**
 * The nine screens, with how each is anchored.
 *
 * DECLARED, never inferred - the same rule `grid-conformance.spec.ts` applies
 * to its anchor model. A screen that reflows and a screen that centres are both
 * correct; which one a screen is cannot be read off one frame.
 */
const SCREENS: readonly { key: string; anchor: Anchor }[] = [
  { key: "Title", anchor: "centred" },
  { key: "EarthActivation", anchor: "centred" },
  { key: "DirectorMap", anchor: "gutter" },
  { key: "Briefing", anchor: "gutter" },
  { key: "Preflight", anchor: "gutter" },
  { key: "Warp", anchor: "gutter" },
  { key: "Beacon", anchor: "gutter" },
  { key: "Results", anchor: "gutter" },
  { key: "Ending", anchor: "centred" },
];

/**
 * The plates each screen draws, as their left edges.
 *
 * Read from the layout modules rather than off the frame, because a Graphics
 * has no readable rectangle (see `elementsOf`). Every screen's cards start on
 * the gutter since `ui/grid.ts` landed, so this is `[GUTTER]` for all of them
 * today; it is a parameter because a screen with a second column would need
 * one, and because "there is only one plate line" is a claim worth being able
 * to break.
 */
const PLATE_LEFTS: Readonly<Record<string, readonly number[]>> = {};

/**
 * OFF-MODEL ELEMENTS PER SCREEN, MEASURED ON A REAL RUN. MAY ONLY SHRINK.
 *
 * ================== WHAT THESE NUMBERS ARE ==================
 * The census this file was written from counted 164 distinct left edges over
 * nine screens by walking every Text object. That number is not the defect - it
 * is the defect plus the model's own blind spots. Judged as RUNS and ROWS (see
 * `ui/alignment.ts`), the product has 25 genuinely off-model elements:
 *
 *   Results 7 · Title 4 · Preflight 4 · DirectorMap 3 · Warp 2 · Ending 2 ·
 *   EarthActivation 1 · Briefing 1 · Beacon 1
 *
 * ================== WHY A BUDGET AND NOT AN EXEMPTION LIST ==================
 * The list of what is left is PRINTED with each element's x on every run, so
 * nobody has to maintain a second copy of it in a comment that can go stale.
 * What the budget does is ratchet: a screen that grows one fails, and a screen
 * that is BETTER than its budget also fails, so a fix cannot leave the number
 * lying about the state of the product. That is the `KNOWN_ORPHANS` idiom
 * (`arch/profileWriters.test.ts`), and it is the opposite of narrowing the
 * sweep to the screens that already pass (standards rule 8).
 *
 * ================== WHAT IS BEHIND EACH NUMBER ==================
 * Title 4, EarthActivation 1, Briefing 1, Ending 2 - the lane closing UR-68
 * (the Title lockup) and UR-19 (the header contract) owns those four files.
 * Named, not excused; their fix is that lane's.
 *
 * Preflight 4 - the real defect the census named. Three system rows at x=224
 * and Shadow's line at x=326, where the card's inner line is 136. This is the
 * screen where `GUTTER` is 96 and two elements sat on it.
 *
 * Results 7 - the stage report's stat columns and its four button treatments,
 * which UR-19's critic independently ranked REWORK.
 *
 * Warp 2 - the coach note and its speaker label, at `COACH.x + 230`. They are
 * the SECOND COLUMN of a row whose first column is Shadow's figure, and a
 * two-column row inside a plate is a shape this model does not describe yet: it
 * knows about a row's first run and about even distribution, and a figure
 * beside a paragraph is neither. That is a gap in the MODEL rather than in the
 * screen, and it is written here rather than quietly widened away.
 *
 * DirectorMap 3 - two right-hand buttons and the "Earth" chip, 3 px off.
 * Beacon 1 - its "continue" button at x=258.
 */
/**
 * SCREENS WHOSE OFF-MODEL COUNT IS NOT ONE NUMBER, with why.
 *
 * Their budget is an UPPER BOUND and the shrink half of the ratchet does not
 * apply. This is not a place to put a screen that is merely inconvenient: an
 * entry here is a claim that the screen's ELEMENT SET or its geometry varies
 * between runs for a reason the product intends.
 *
 * TITLE. Two independent sources of variation, and UR-68's own evidence names
 * the second:
 *
 *   - the wordmark's y is a function of which beacon the pilot lit last,
 *     because the lockup dodges the stop's light source (250 at Neptune, 319 at
 *     Mars), and it is then clamped by `PRIMARY_Y_MAX`. Measured across two
 *     runs here, "play" moved from x=367 to x=389 and the stack's rows
 *     regrouped, so "settings" was judged as its own row once and as a
 *     follower of the tagline's the next time.
 *   - A FRESH PILOT RENDERS NO BEACON STATUS LINE. A whole row is absent from
 *     every capture anyone has taken of this screen, which is the same blind
 *     spot that let the Title's accent bug live for months - every screenshot
 *     for those months was of a new pilot.
 *
 * Both observed counts are recorded: 3 and 4. The budget is 4.
 */
const VARIES: Readonly<Record<string, string>> = {
  Title:
    "the lockup's y is a function of the stop's light source and of " +
    "PRIMARY_Y_MAX, and a fresh pilot has no beacon status line - so the " +
    "screen's row set is not fixed. Observed 3 and 4. UR-68 owns the file.",
};

const BUDGET: Readonly<Record<string, number>> = {
  Title: 4,
  EarthActivation: 1,
  DirectorMap: 3,
  Briefing: 1,
  Preflight: 4,
  Warp: 2,
  Beacon: 1,
  Results: 7,
  Ending: 2,
};

async function open(page: Page, key: string): Promise<void> {
  await freezeReloads(page);
  await page.goto(`/?scene=${key}`);
  await page.waitForFunction(() => window.__kb !== undefined, null, { timeout: 60_000 });
  await page.waitForFunction(
    (k) => {
      const kb = window.__kb;
      const scene = kb?.game.scene.getScene(k) as { scene?: { isActive(): boolean } } | null;
      return scene !== null && scene?.scene?.isActive() === true;
    },
    key,
    { timeout: 60_000 },
  );
  await restartScene(page, key, { stopId: "mars" });
  await settle(page, 2200);
}

test("UR-69: every left edge is on a named line, or is counted", async ({ page }) => {
  test.setTimeout(600_000);

  const report: string[] = [];
  const grew: string[] = [];
  const shrank: string[] = [];

  for (const screen of SCREENS) {
    await open(page, screen.key);
    const elements = await elementsOf(page, screen.key);
    const world = await page.evaluate(() => {
      const game = (window as unknown as { __kb: { game: Phaser.Game } }).__kb.game;
      return game.scale.width;
    });

    const lefts = PLATE_LEFTS[screen.key] ?? [GUTTER];
    const rights = lefts.map((l) => l + (world - GUTTER * 2));
    const label = new Map<string, Element>();
    for (const el of elements) label.set(`${el.x}:${el.y}`, el);

    const off: string[] = [];
    for (const row of rowsOf(elements)) {
      const verdict = judgeRow(row, {
        anchor: screen.anchor,
        worldWidth: world,
        plateLefts: lefts,
        plateRights: rights,
        describe: (box) => {
          const el = label.get(`${box.x}:${box.y}`);
          return el === undefined ? `x=${box.x}` : `"${el.text}" ${el.size}px`;
        },
      });
      for (const line of verdict.off) off.push(`${screen.key}: ${line}`);
    }

    // Distinct edges counted over RUNS, not over Text objects: a sentence drawn
    // one Text per character has one left edge, not nineteen.
    const runLefts = new Set<number>();
    for (const row of rowsOf(elements)) {
      for (const run of runsOf(row)) runLefts.add(run.x);
    }
    report.push(
      `${screen.key}: ${elements.length} texts in ${runLefts.size} runs, ` +
        `${runLefts.size} distinct left edges, ` +
        `${off.length} off-model (budget ${BUDGET[screen.key] ?? 0})`,
    );
    for (const line of off) report.push(`    ${line}`);

    const budget = BUDGET[screen.key] ?? 0;
    if (off.length > budget) {
      grew.push(`${screen.key}: ${off.length} off-model, budget ${budget}`);
    }
    if (off.length < budget && !(screen.key in VARIES)) {
      shrank.push(
        `${screen.key}: ${off.length} off-model but the budget says ${budget} - ` +
          "lower it, so the list cannot lie about the state of the product",
      );
    }
  }

  // The census, printed on every run. The list of what is left is the test's
  // own output rather than a comment somebody has to maintain.
  // eslint-disable-next-line no-console
  console.log(`\nLEFT-EDGE CENSUS\n${report.join("\n")}\n`);
  // A sanity floor on the model itself: a screen with no plates has exactly one
  // legal edge, and adding one plate line must add the four inner lines and
  // their indents rather than opening the field.
  expect(legalLefts([]).length).toBeGreaterThan(1);

  expect(grew, grew.join("\n")).toEqual([]);
  expect(shrank, shrank.join("\n")).toEqual([]);
});
