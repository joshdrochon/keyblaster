import { expect, test, type Page } from "@playwright/test";
import { gameCanvas } from "./support/lane.js";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PUNISHMENT_WORDS,
  expectNoPunishment,
  mount,
  remount,
  snapshot,
  transitions,
} from "./story-lane";
import { DESIGN_WIDTH } from "../../src/game/sceneKeys.js";
import {
  checkWord,
  createAllowlist,
  isBlocked,
  normalizeWord,
  tokenize,
  MAX_WORD_LENGTH,
} from "../../src/engine/allowlist/index.js";

/**
 * Screen inventory row 4 - Briefing, and the stage-bundle content it renders.
 *
 * Two halves, on purpose:
 *
 *  1. THE SCREEN. Picture-book page inside a cockpit, planet through a window,
 *     Shadow present, one button. AC-18.1, C07.
 *  2. THE CONTENT. Every shipped word validated against `@engine/allowlist`
 *     and against the PRD's content rules. This half runs in Node with no
 *     browser, and it is the half that must FAIL rather than let a bad word
 *     ship: AC-12.2 (every belt stop has the five parts), AC-12.3 (every
 *     content word of a warp sentence is in that stage's pool), AC-13.2 (no
 *     blocked word anywhere), AC-25.3 (Shadow never says the forbidden word).
 *
 * THE ALLOWLIST THIS USES. `scripts/compile-allowlist` (architecture 5.2) has
 * not run, so there is no Fry-1000 on disk. The list is built per stop from the
 * stop's own pool plus `content/en/sight-words.json` plus its proper nouns, and
 * `createAllowlist` DROPS anything blocked or over-length on the way in - so a
 * blocked or 13+ letter pool word is absent from the list it was built from and
 * `checkWord` rejects it. The check is therefore not circular for exactly the
 * failure modes it exists to catch.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

const KEY = "Briefing";
const CONTENT = resolve(HERE, "../../src/content/en");
const EVIDENCE = resolve(HERE, "../../gauntlet/evidence");

interface Bundle {
  stopId: string;
  planetName: string;
  chapterTitle: string;
  briefing: string[];
  pool: string[];
  properNouns: string[];
  preflightLine: string;
  activationWord: string | null;
  warpSentence: string | null;
  beaconHeadline: string;
  beaconState: string;
  beaconFlavor: string;
}

const read = <T,>(file: string): T =>
  JSON.parse(readFileSync(resolve(CONTENT, file), "utf8")) as T;

const SIGHT = read<{ words: string[] }>("sight-words.json").words;

const BUNDLE_FILES = readdirSync(CONTENT).filter(
  (f) => f.endsWith(".json") && f !== "sight-words.json" && f !== "ui.json",
);
const BUNDLES = BUNDLE_FILES.map((f) => read<Bundle>(f));
const BELT = BUNDLES.filter((b) => b.stopId !== "earth");

const allowlistFor = (b: Bundle) =>
  createAllowlist({
    lang: "en",
    words: [...b.pool, ...SIGHT, ...(b.activationWord === null ? [] : [b.activationWord])],
    properNouns: b.properNouns,
  });

// ---------------------------------------------------------------------------
// Content (Node only - no browser)
// ---------------------------------------------------------------------------

test.describe("Stage bundles (AC-12.2, AC-12.3, AC-13.2, AC-25.3)", () => {
  test("AC-12.2 all seven stops ship a bundle and every belt stop has all five parts", () => {
    expect(BUNDLES.map((b) => b.stopId).sort()).toEqual([
      "earth", "jupiter", "mars", "neptune", "pluto", "saturn", "uranus",
    ]);
    for (const b of BELT) {
      expect(b.briefing.length, `${b.stopId} briefing length`).toBeGreaterThanOrEqual(3);
      expect(b.briefing.length, `${b.stopId} briefing length`).toBeLessThanOrEqual(5);
      expect(b.pool.length, `${b.stopId} pool`).toBeGreaterThan(10);
      expect(b.preflightLine.length, `${b.stopId} pre-flight line`).toBeGreaterThan(10);
      expect(b.warpSentence, `${b.stopId} warp sentence`).not.toBeNull();
      expect(b.beaconFlavor.length, `${b.stopId} beacon text`).toBeGreaterThan(10);
    }
    // D57: Earth is the launchpad. No belt, no warp sentence, one word.
    const earth = BUNDLES.find((b) => b.stopId === "earth");
    expect(earth?.pool).toEqual([]);
    expect(earth?.warpSentence).toBeNull();
    expect(earth?.activationWord).toBe("light");
  });

  for (const b of BUNDLES) {
    test(`AC-13.2 every ${b.stopId} pool word passes @engine/allowlist`, () => {
      const list = allowlistFor(b);
      for (const word of b.pool) {
        // Normalised on the way in, or the asteroid plate and the WordRecord
        // key disagree about what the child typed.
        expect(normalizeWord(word), `"${word}" is not in normal form`).toBe(word);
        expect(isBlocked(word), `"${word}" is on the blocklist`).toBe(false);
        expect(word.length, `"${word}" is longer than a word plate`).toBeLessThanOrEqual(
          MAX_WORD_LENGTH,
        );
        expect(checkWord(word, list), `"${word}" was refused`).toBeNull();
      }
    });

    test(`AC-13.2 every word a child READS at ${b.stopId} is on the allowlist`, () => {
      const list = allowlistFor(b);
      const prose = [
        ...b.briefing.map((s) => s.replace(/\{shipName\}/g, "")),
        b.warpSentence ?? "",
        b.beaconFlavor,
      ].join(" ");
      const unknown = tokenize(prose, "en").filter((w) => !list.hasReadable(w));
      // A word added to a briefing without being added to the pool, the proper
      // nouns or sight-words.json fails HERE rather than reaching a child.
      expect(unknown, `${b.stopId} briefing has unlisted words`).toEqual([]);
    });
  }

  for (const b of BELT) {
    test(`AC-12.3 every content word of the ${b.stopId} warp sentence is in its pool`, () => {
      const sight = new Set(SIGHT.map((w) => normalizeWord(w)));
      const pool = new Set(b.pool);
      const content = tokenize(b.warpSentence ?? "", "en").filter((w) => !sight.has(w));
      expect(content.length, `${b.stopId} warp sentence has no content words`).toBeGreaterThan(0);
      for (const word of content) {
        expect(pool.has(word), `"${word}" is not in the ${b.stopId} pool`).toBe(true);
      }
    });
  }

  test("AC-25.3 no shipped Shadow line contains a punishing word", () => {
    for (const b of BUNDLES) {
      const spoken = [b.preflightLine, b.beaconFlavor].join(" ");
      for (const re of PUNISHMENT_WORDS) {
        expect(spoken, `${b.stopId}: ${spoken}`).not.toMatch(re);
      }
    }
  });

  test("C07 no shipped copy names the ship; it uses {shipName}", () => {
    for (const b of BUNDLES) {
      const all = [...b.briefing, b.preflightLine, b.beaconFlavor].join(" ");
      expect(all, `${b.stopId} names the ship`).not.toMatch(/lantern/i);
    }
    const earth = BUNDLES.find((b) => b.stopId === "earth");
    expect(earth?.briefing.join(" ")).toContain("{shipName}");
  });
});

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

/**
 * WAIT FOR THE PAGE TO BE FINISHED TYPING, NOT FOR A CLOCK (UR-59).
 *
 * The briefing reveals itself character by character now, so `snapshot().text`
 * taken on arrival is a snapshot of a PREFIX. Anything asserting the copy has
 * to wait for the scene to say it is done - a `waitForTimeout` of the reveal ceiling
 * would be a guess that gets slower and flakier as copy grows, and standards
 * rule 6 is explicit that a clock is not a synchronisation primitive.
 */
async function revealed(page: Page): Promise<void> {
  await page.waitForFunction(
    (key: string) => {
      const scene = (
        window as unknown as {
          __kb?: { game: { scene: { getScene(k: string): { snapshot?: () => unknown } | null } } };
        }
      ).__kb?.game.scene.getScene(key);
      const snap = scene?.snapshot?.() as
        | { typewriter?: { complete?: boolean } }
        | undefined;
      return snap?.typewriter?.complete === true;
    },
    "Briefing",
    { timeout: 30_000 },
  );
}

/** Every hit zone the keyboard menu built, which is what a control really is. */
async function controlBoxes(
  page: Page,
): Promise<{ id: string; x: number; y: number; w: number; h: number }[]> {
  return page.evaluate((key: string) => {
    const kb = (window as unknown as { __kb: Record<string, unknown> }).__kb;
    const game = kb["game"] as {
      scene: {
        getScene(k: string): {
          children: {
            list: { name?: string; x: number; y: number; width: number; height: number }[];
          };
        } | null;
      };
    };
    const scene = game.scene.getScene(key);
    if (scene === null) return [];
    return scene.children.list
      .filter((o) => typeof o.name === "string" && o.name.startsWith("kb-hit:"))
      .map((o) => ({
        id: (o.name as string).slice("kb-hit:".length),
        x: o.x,
        y: o.y,
        w: o.width,
        h: o.height,
      }));
  }, "Briefing");
}

test.describe("Briefing (row 4)", () => {
  // Software WebGL under parallel workers; see the note on mount().
  test.setTimeout(120_000);

  test("the page is 3-5 story sentences, not a worksheet", async ({ page }) => {
    await mount(page, KEY, { stopId: "mars" });
    await revealed(page);
    const s = await snapshot(page, KEY);
    const mars = BUNDLES.find((b) => b.stopId === "mars");

    expect(s.sentenceCount).toBeGreaterThanOrEqual(3);
    expect(s.sentenceCount).toBeLessThanOrEqual(5);
    expect(s.planetName).toBe(mars?.planetName);
    const screen = s.text.join(" ");
    for (const sentence of mars?.briefing ?? []) {
      expect(screen).toContain(sentence);
    }
    expect(screen).toContain(mars?.chapterTitle ?? "");
    // No worksheet furniture: nothing numbered, nothing to fill in.
    for (const line of s.text) {
      expect(line).not.toMatch(/^\s*\d+[.)]\s/);
      expect(line).not.toMatch(/_{3,}/);
      expect(line).not.toMatch(/\bquestion\b/i);
    }
    expectNoPunishment(s.text);

    mkdirSync(EVIDENCE, { recursive: true });
    await gameCanvas(page).screenshot({ path: `${EVIDENCE}/briefing-mars.png` });
  });


/**
 * THE BRIEFING'S CONTROL RULE (UR-27 vs the one-button rule).
 *
 * `buttonCount === 1` encoded a real constraint - a picture-book page with a
 * field of buttons stops being a picture-book page - and UR-27 deliberately
 * broke it, because a player could open a planet and had no way back: Escape
 * worked and was invisible, and arriving by mouse left no pointer route out.
 *
 * Both decisions are right; the old assertion could not hold both. Replacing it
 * with `toBe(2)` would have traded a meaningful claim for a number that happens
 * to match today - two is fine, five is not, and a count cannot tell them apart.
 *
 * So the claim is about ROLES. Exactly one PRIMARY action, so nothing on the
 * page competes with launch; and at most one navigation affordance beside it,
 * so the page cannot grow a button field. `role` comes from the scene's own
 * `FocusTarget.primary`, which is what decides where focus opens.
 */
interface Control {
  id: string;
  role: "primary" | "navigate";
}

function controlRuleBreaches(controls: readonly Control[]): string[] {
  const primary = controls.filter((c) => c.role === "primary");
  const nav = controls.filter((c) => c.role !== "primary");
  const out: string[] = [];
  if (primary.length !== 1) out.push(`${primary.length} primary actions`);
  if (nav.length > 1) out.push(`${nav.length} navigation affordances`);
  return out;
}

test("the control rule can fail (negative control for the two tests below)", () => {
  // A check nobody has watched fail is not evidence. These are the shapes the
  // rule exists to reject.
  expect(controlRuleBreaches([{ id: "launch", role: "primary" }])).toEqual([]);
  expect(
    controlRuleBreaches([
      { id: "launch", role: "primary" },
      { id: "back", role: "navigate" },
    ]),
  ).toEqual([]);
  // Two forward actions: something now competes with launch.
  expect(
    controlRuleBreaches([
      { id: "launch", role: "primary" },
      { id: "skip", role: "primary" },
    ]),
  ).toContain("2 primary actions");
  // A button field.
  expect(
    controlRuleBreaches([
      { id: "launch", role: "primary" },
      { id: "back", role: "navigate" },
      { id: "settings", role: "navigate" },
    ]),
  ).toContain("2 navigation affordances");
  // No forward action at all.
  expect(controlRuleBreaches([{ id: "back", role: "navigate" }])).toContain(
    "0 primary actions",
  );
});

  test("the same layout dresses a second stop (inventory variant: Saturn)", async ({ page }) => {
    await mount(page, KEY, { stopId: "saturn" });
    const s = await snapshot(page, KEY);
    expect(s.planetName).toBe("Saturn");
    expect(s.sentenceCount).toBe(5);
    expect(controlRuleBreaches(s.controls as Control[])).toEqual([]);
    await gameCanvas(page).screenshot({ path: `${EVIDENCE}/briefing-saturn.png` });
  });

  test("C07 the ship is named from the profile, never hard-coded", async ({ page }) => {
    // EARTH, NOT MARS. `{shipName}` appears in exactly one briefing in the
    // game - `src/content/en/earth.json`, "Your ship is the {shipName}" - and
    // mars has never carried it, so this mounted a screen that could not have
    // named the ship however well the binding worked.
    await mount(page, KEY, { stopId: "earth", shipName: "Nomad" });
    await revealed(page);
    const s = await snapshot(page, KEY);
    const screen = s.text.join(" ");
    expect(screen).toContain("Nomad");
    expect(screen).not.toMatch(/lantern/i);
    expect(screen).not.toContain("{shipName}");
  });

  test("AC-18.1 one primary action, reachable and operable by keyboard alone", async ({ page }) => {
    await mount(page, KEY, { stopId: "mars" });
    const s = await snapshot(page, KEY);
    expect(controlRuleBreaches(s.controls as Control[])).toEqual([]);
    // ...and the forward action is the one focus opens on, which is what
    // "primary" means and why a child pressing Enter on arrival launches.
    expect(s.focusId).toBe("launch");

    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => (window.__kbTransitions ?? []).includes("Preflight"),
      null,
      { timeout: 30_000 },
    );
    expect(await transitions(page)).toContain("Preflight");
  });

  test("AC-18.1 escape returns to the map", async ({ page }) => {
    await mount(page, KEY, { stopId: "mars" });
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => (window.__kbTransitions ?? []).includes("DirectorMap"),
      null,
      { timeout: 30_000 },
    );
  });

  // -------------------------------------------------------------------------
  // UR-59: the page types itself out, and never stands in anybody's way
  // -------------------------------------------------------------------------

  test("UR-59 the page reveals itself rather than arriving complete", async ({ page }) => {
    // The effect exists AND it is mid-flight when the screen opens, which is
    // the half a "completes eventually" assertion cannot tell from no effect
    // at all.
    //
    // WATCHED FAILING: delete the `armTypewriter` call from `drawPage` and this
    // reports "expected 0 to be greater than 0" on `total` - the page is drawn
    // whole and there is nothing to reveal.
    await mount(page, KEY, { stopId: "neptune" });
    const opening = await snapshot(page, KEY);
    const typewriter = opening["typewriter"] as {
      enabled: boolean;
      complete: boolean;
      revealed: number;
      total: number;
      msPerChar: number;
    };
    expect(typewriter.enabled).toBe(true);
    expect(typewriter.total).toBeGreaterThan(0);
    // The cadence is the one the unit suite argues for, reported by the screen.
    expect(typewriter.msPerChar).toBeGreaterThan(0);
    expect(typewriter.msPerChar).toBeLessThan(10);

    await revealed(page);
    const done = await snapshot(page, KEY);
    const after = done["typewriter"] as { complete: boolean; revealed: number; total: number };
    expect(after.complete).toBe(true);
    expect(after.revealed).toBe(after.total);
    // ...and what it reveals is the real copy, not a prefix left behind.
    const neptune = BUNDLES.find((b) => b.stopId === "neptune");
    const screen = (done["text"] as string[]).join(" ");
    for (const sentence of neptune?.briefing ?? []) expect(screen).toContain(sentence);
  });

  /**
   * RESTART THE SCREEN AND MEASURE THE SKIP FROM INSIDE THE PAGE.
   *
   * ================== WHY NOT `page.keyboard.press` HERE ==================
   * The first version of these two cases mounted the screen, read the snapshot
   * back, asserted the page was still typing, and then pressed a key. It failed
   * on a loaded box with "expected false to be true" - the whole reveal is 1.8 s
   * and a snapshot round trip under six concurrent Playwright runs is longer
   * than that, so the page had finished before Node could look at it.
   *
   * TWO CAUSES, IDENTICAL OUTPUT (standards rule 9). "The reveal already
   * finished" and "the reveal never started" both report `complete: true`. They
   * are told apart by `enabled`/`total`, and the case above - which asserts
   * `enabled` true and `total` over zero - passed in the same run, so the reveal
   * armed and the failure was the clock, not the product.
   *
   * The fix is not a longer wait or a softer assertion, either of which would
   * hide the real defect later. It is to stop racing: the restart, the wait for
   * the reveal to be running, the keystroke and the read all happen in ONE
   * evaluate, so no round trip can elapse between them and the "instantly" in
   * the ticket is measured rather than inferred. `press()` is still used for the
   * real-input path in the AC-18.1 cases above and below.
   */
  async function skipWithKey(
    page: Page,
    stopId: string,
    key: string,
  ): Promise<{
    before: { enabled: boolean; complete: boolean; revealed: number; total: number };
    after: { enabled: boolean; complete: boolean; revealed: number; total: number };
    observed: boolean;
  }> {
    interface Typewriter {
      enabled: boolean;
      complete: boolean;
      revealed: number;
      total: number;
    }

    // A REAL KEYSTROKE, THROUGH THE REAL PIPELINE.
    //
    // This used to `window.dispatchEvent(new KeyboardEvent("keydown", { key }))`
    // from inside `page.evaluate`, so that the read-back could be synchronous.
    // It cost the test its subject. Phaser's catch-all `on("keydown")` fires
    // for any event and finished the reveal, but a binding routed by
    // `event.keyCode` never saw an Enter, because a KeyboardEvent built from
    // `{ key }` alone carries keyCode 0. The half-skip this test exists to
    // catch - page finishes, ship does not fly - was being manufactured by the
    // test rather than found in the game. `page.keyboard.press` goes through
    // CDP and arrives the way a child's Enter does.
    const before = await page.evaluate(async (stop) => {
      const scene = window.__kb?.game.scene.getScene("Briefing") as unknown as {
        scene: { restart(data: unknown): void };
        snapshot(): { typewriter: Typewriter };
      };
      const read = (): Typewriter | null => {
        try {
          return { ...scene.snapshot().typewriter };
        } catch {
          return null;
        }
      };
      scene.scene.restart({ stopId: stop });

      // Wait for the reveal to BE RUNNING - not for a number of milliseconds.
      const deadline = performance.now() + 25_000;
      while (performance.now() < deadline) {
        const now = read();
        if (now !== null && now.enabled && !now.complete) return now;
        await new Promise((done) => requestAnimationFrame(() => done(null)));
      }
      return null;
    }, stopId);

    await page.keyboard.press(key);

    const after = await page.evaluate(() => {
      const scene = window.__kb?.game.scene.getScene("Briefing") as unknown as {
        snapshot(): { typewriter: Typewriter };
      };
      try {
        return { ...scene.snapshot().typewriter };
      } catch {
        return null;
      }
    });

    const empty = { enabled: false, complete: true, revealed: 0, total: 0 };
    return { before: before ?? empty, after: after ?? empty, observed: before !== null };
  }

  test("UR-59 ANY key finishes it instantly", async ({ page }) => {
    // The claim the ticket turns on: a child who has seen this stop four times
    // is never made to wait, and the skip is not a named control - any key.
    //
    // WATCHED FAILING: remove the `keydown` listener from `armTypewriter` and
    // this reports "expected false to be true" on `after.complete` - the page
    // is still typing one keystroke later, at Earth's longest briefing.
    await mount(page, KEY, { stopId: "earth" });
    const { before, after, observed } = await skipWithKey(page, "earth", "x");

    expect(
      observed,
      `the reveal was never seen running (enabled ${before.enabled}, total ${before.total})`,
    ).toBe(true);
    expect(before.enabled).toBe(true);
    expect(before.complete).toBe(false);
    expect(before.revealed, "nothing was left to reveal").toBeLessThan(before.total);
    // ...and one keystroke later the whole page is there, in the same frame.
    expect(after.complete).toBe(true);
    expect(after.revealed).toBe(after.total);
    expect(after.total).toBe(before.total);
  });

  test("UR-59 the reveal never gates launch: Enter mid-reveal flies", async ({ page }) => {
    // The other half. Enter arrives WHILE the page is typing, and it has to do
    // both jobs on the one keystroke: finish the page and launch. A reveal that
    // swallowed the first key - a tempting way to implement "any key skips" -
    // would leave the screen sitting there.
    await mount(page, KEY, { stopId: "saturn" });
    const { before, after, observed } = await skipWithKey(page, "saturn", "Enter");
    expect(observed, "the reveal was never seen running").toBe(true);
    expect(before.complete).toBe(false);
    expect(after.complete).toBe(true);
    await page.waitForFunction(
      () => (window.__kbTransitions ?? []).includes("Preflight"),
      null,
      { timeout: 30_000 },
    );
    expect(await transitions(page)).toContain("Preflight");
  });

  test("UR-59/AC-19.3 reduced motion draws the page whole, with no reveal at all", async ({
    page,
  }) => {
    // A live reader of the persisted setting on the path it claims to affect
    // (standards rule 2). Not "the reveal is faster": there is no reveal.
    //
    // WATCHED FAILING: drop the `ctx.reducedMotion` guard from `armTypewriter`
    // and this reports "expected true to be false" on `typewriter.enabled` -
    // the page revealing itself on a screen that asked for calm motion.
    await mount(page, KEY, {
      stopId: "neptune",
      ctx: { stopId: "neptune", reducedMotion: true, colorblindPalette: false, profileId: null },
    });
    const s = await snapshot(page, KEY);
    const typewriter = s["typewriter"] as { enabled: boolean; complete: boolean };
    expect(typewriter.enabled).toBe(false);
    expect(typewriter.complete).toBe(true);
    // The whole page is on screen immediately, with no key pressed and no wait.
    const neptune = BUNDLES.find((b) => b.stopId === "neptune");
    const screen = (s["text"] as string[]).join(" ");
    for (const sentence of neptune?.briefing ?? []) expect(screen).toContain(sentence);
  });

  // -------------------------------------------------------------------------
  // The composition, at all seven stops (standards rule 5)
  // -------------------------------------------------------------------------

  test("UR-58/UR-60 the composition holds at every stop, not just at Mars", async ({ page }) => {
    // THE SWEEP, NOT THE SAMPLE. The original briefing collision shipped
    // because the capture harness booted Mars, which is the one stop whose copy
    // fits; Earth overflowed its plate by 88 px. Every claim below is therefore
    // read off the live screen once per stop, and the page's own plate - which
    // changes height with the copy - is read with it.
    //
    // WATCHED FAILING: put SHADOW_AT back to { x: 1076, y: 992, scale: 0.78 }
    // and the first stop reports "earth: Shadow x ... Received: 1076" against a
    // page whose right edge is 980.
    test.setTimeout(300_000);
    const STOPS = ["earth", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"];
    mkdirSync(EVIDENCE, { recursive: true });

    for (const [i, stopId] of STOPS.entries()) {
      if (i === 0) await mount(page, KEY, { stopId });
      else await remount(page, KEY, { stopId });
      await revealed(page);
      const s = await snapshot(page, KEY);
      const where = `${stopId}`;
      const page_ = s["page"] as { x: number; y: number; w: number; h: number };
      const shadow = s["shadowAt"] as { x: number; y: number; scale: number };
      const boxes = await controlBoxes(page);
      const launch = boxes.find((b) => b.id === "launch");
      const back = boxes.find((b) => b.id === "back");
      expect(launch, `${where}: no launch hit zone`).toBeDefined();
      expect(back, `${where}: no back hit zone`).toBeDefined();
      if (launch === undefined || back === undefined) continue;

      // UR-60: launch centred on the screen, at the foot.
      expect(
        Math.abs(launch.x + launch.w / 2 - DESIGN_WIDTH / 2),
        `${where}: launch centre`,
      ).toBeLessThanOrEqual(2);
      expect(launch.y + launch.h, `${where}: launch off the frame`).toBeLessThanOrEqual(1080);
      // ================== UR-60, AS C19/UR-95 LEFT IT ==================
      // This read `back.x + back.w < launch.x` - "the way out is on the LEFT" -
      // and it had been stale since C19 moved the chip into the product's back
      // corner and UR-95 moved that corner to the bottom-RIGHT. Measured here:
      // the chip's right edge is 1824 against a launch x of 716, so the
      // assertion reported "expected < 716, received 1824" and would have done
      // so at any width launch has ever had. It is a test contradicting a
      // shipped decision, not a test catching a regression.
      //
      // WHAT UR-60 WAS ACTUALLY ABOUT SURVIVES INTACT, and is what is asserted
      // instead: the way out must be SMALL and must not read as launch's pair.
      // Both of those are properties of size and separation, neither of which
      // is a side of the screen - which is precisely why naming a side was the
      // wrong way to write it the first time.
      expect(back.w * back.h, `${where}: back is not smaller`).toBeLessThan(
        (launch.w * launch.h) / 2,
      );
      // Not beside it, in either direction, and nowhere near touching.
      const gap =
        back.x > launch.x ? back.x - (launch.x + launch.w) : launch.x - (back.x + back.w);
      expect(gap, `${where}: back is beside launch (gap ${gap})`).toBeGreaterThan(200);
      // In the product's back corner, which `ui/grid.backCorner` defines and
      // Pre-flight reads too - the property that makes this a product rule
      // rather than two screens that happen to agree today.
      expect(back.x + back.w, `${where}: back is not in the back corner`).toBe(
        DESIGN_WIDTH - 96,
      );
      // UR-101: and the two share a foot line, with real air under both.
      expect(back.y + back.h, `${where}: back and launch are off one line`).toBe(
        launch.y + launch.h,
      );
      expect(1080 - (launch.y + launch.h), `${where}: not enough air`).toBe(32);
      // ...and neither lands on the page, whatever height this stop's copy gave it.
      for (const [name, box] of [["launch", launch], ["back", back]] as const) {
        const clear =
          box.y >= page_.y + page_.h ||
          box.x >= page_.x + page_.w ||
          box.x + box.w <= page_.x;
        expect(clear, `${where}: ${name} over the page (page ends ${page_.y + page_.h})`).toBe(
          true,
        );
      }

      // UR-58: Shadow is in the page's top-right quadrant, as DRAWN.
      expect(shadow.x, `${where}: Shadow x`).toBeGreaterThanOrEqual(page_.x + page_.w / 2);
      expect(shadow.x, `${where}: Shadow x`).toBeLessThanOrEqual(page_.x + page_.w);
      expect(shadow.y, `${where}: Shadow y`).toBeGreaterThanOrEqual(page_.y);
      expect(shadow.y, `${where}: Shadow y`).toBeLessThanOrEqual(page_.y + page_.h / 2);
      expect(shadow.scale, `${where}: Shadow scale`).toBeLessThan(0.78);

      await gameCanvas(page).screenshot({ path: `${EVIDENCE}/ur/UR-58-61-briefing-${stopId}.png` });
    }
  });

  test("UR-60 the focus ring is on the quiet control, at full strength", async ({ page }) => {
    // AC-18.1. A previous lane reported a focus-ring defect on this screen that
    // turned out to be a 29.7 s timeout rather than a ring (standards rule 9),
    // so this reads the RING's own geometry off the scene rather than reading a
    // boolean attribute that is equally empty when nothing was read at all.
    await mount(page, KEY, { stopId: "mars" });
    await revealed(page);
    expect((await snapshot(page, KEY))["focusId"]).toBe("launch");

    // Left from launch reaches the quiet control...
    await page.keyboard.press("ArrowLeft");
    await page.waitForFunction(
      () => {
        const scene = window.__kb?.game.scene.getScene("Briefing") as
          | { snapshot?: () => { focusId?: string } }
          | null;
        return scene?.snapshot?.().focusId === "back";
      },
      null,
      { timeout: 30_000 },
    );

    // ...and the ring that lands on it is the same ring, not a thinner one.
    const ring = await page.evaluate(() => {
      const scene = window.__kb?.game.scene.getScene("Briefing") as unknown as {
        children: { list: { type: string; depth: number; alpha: number; visible: boolean }[] };
      };
      const g = scene.children.list.find((o) => o.type === "Graphics" && o.depth === 30);
      return g === undefined ? null : { alpha: g.alpha, visible: g.visible };
    });
    expect(ring, "no focus ring graphics on the briefing").not.toBeNull();
    expect(ring?.visible).toBe(true);
    expect(ring?.alpha ?? 0).toBeGreaterThan(0.5);

    // And it still leaves by the keyboard from there.
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => (window.__kbTransitions ?? []).includes("DirectorMap"),
      null,
      { timeout: 30_000 },
    );
  });
});
