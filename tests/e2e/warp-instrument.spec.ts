import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  activeScenes,
  bootScene,
  frameOf,
  freezeReloads,
  restartScene,
  pixelDiffPercent,
  snap,
  texts,
  waitForScene,
} from "./support/lane";

/**
 * THE WARP BREAK'S INSTRUMENT AND ITS SHIP - UR-62, UR-63, UR-64.
 *
 * ================== WHY A SEVEN-STOP SWEEP ==================
 * Coding standards rule 5. This screen renders at seven stops with seven
 * palettes and seven sentences of different lengths, and the last time an
 * acceptance gate on this project booted one stop, the defect it was written
 * for PASSED at a different stop. So every case below runs the whole set and
 * reports which stop failed, rather than sampling Mars and calling it an
 * answer. Earth is in the sweep even though it has no belt (D57): the screen is
 * reachable there and "nothing to type" must not mean "nothing drawn".
 *
 * ================== WHAT EACH TICKET CLAIMS ==================
 *   UR-62  the label, the readout and the track are ONE instrument - one plate,
 *          one border, one baseline shared by the label and the percentage.
 *   UR-63  the Lantern is on the screen, in PIXELS, not merely positioned. The
 *          band it stands in is cropped and compared against the same band of
 *          empty sky; a ship that rendered below the fold, behind a card or not
 *          at all makes those two crops the same picture.
 *   UR-64  when the note offers to type a word again, the sentence contains it.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EVIDENCE = join(REPO, "gauntlet", "evidence");

function writeEvidence(name: string, body: string | Buffer): void {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, name), body);
}

const STOPS = [
  "earth",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
] as const;

type Rect = { x: number; y: number; w: number; h: number };

type WarpShipSnapshot = {
  stopId: string;
  sentence: string;
  coach: { received: boolean; settled: boolean; note: string };
  retry: {
    outcome: string | null;
    promisedWord: string | null;
    keptBySentence: boolean;
    rawNote: string;
  };
  ship: {
    drawn: boolean;
    overlay: boolean;
    box: Rect;
    bandTop: number;
    cards: Rect[];
  };
};

async function openWarp(page: Page, stop: string): Promise<void> {
  await bootScene(page, "Warp", "warp", `&stop=${stop}`);
  // WAIT FOR THE THING (rule 6): the coach note is what UR-64's claim is about
  // and it arrives asynchronously, so nothing below may read the screen until
  // it has landed and finished fading in.
  await page.waitForFunction(() => {
    const bag = (window as unknown as { __kb: Record<string, unknown> }).__kb["warp"] as {
      snapshot(): { coach: { settled: boolean } };
    };
    return bag.snapshot().coach.settled === true;
  });
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test.describe("UR-63: the Lantern is on the warp screen", () => {
  for (const stop of STOPS) {
    test(`the ship is drawn, unoccluded and visible at ${stop}`, async ({ page }) => {
      test.setTimeout(60_000);
      await openWarp(page, stop);
      const s = await snap<WarpShipSnapshot>(page, "warp");

      // 1. SOMETHING DREW IT. A standalone boot is this scene's own rig.
      expect(s.ship.overlay, "this boot is standalone").toBe(false);
      expect(s.ship.drawn, `no Lantern at ${stop}`).toBe(true);

      // 2. IT IS INSIDE THE FRAME. The body, not the exhaust - a plume running
      //    off the bottom edge is the ship flying.
      const box = s.ship.box;
      expect(box.y, stop).toBeGreaterThan(0);
      expect(box.y + box.h, stop).toBeLessThan(1080);
      expect(box.x, stop).toBeGreaterThan(0);
      expect(box.x + box.w, stop).toBeLessThan(1920);

      // 3. NO CARD IS OVER IT. This is the defect UR-63 reported: the coach
      //    card ran across the fuselage and only the exhaust came out below.
      for (const card of s.ship.cards) {
        expect(
          overlaps(box, card),
          `${stop}: a card (${JSON.stringify(card)}) covers the ship (${JSON.stringify(box)})`,
        ).toBe(false);
      }

      // 4. AND IT IS ACTUALLY ON THE SCREEN, IN PIXELS.
      //
      //    Every line above is satisfied by a rig that was positioned and never
      //    rendered, which is exactly the failure coding standards rule 7 is
      //    written about. So the ship's own box is cropped and compared against
      //    an identically sized crop of the same band 700 px to its left, which
      //    is sky and nothing else. A ship that is drawn makes those two crops
      //    different pictures; a ship that is not makes them the same one.
      const shipShot = await frameOf(page, box);
      const skyShot = await frameOf(page, { ...box, x: box.x - 700 });
      const differs = await pixelDiffPercent(
        page,
        shipShot.toString("base64"),
        skyShot.toString("base64"),
      );
      writeEvidence(`ur63-ship-${stop}.png`, shipShot);
      // MEASURED, on a loaded box (load average ~31, three other lanes
      // verifying), at every stop:
      //
      //   with the ship   earth 60.89  mars 60.78  jupiter 60.81  saturn 60.41
      //                   uranus 60.28  neptune 61.04  pluto 57.93
      //   WITHOUT it      mars 1.78, neptune 1.80   (`drawLantern` skipped)
      //   sky vs sky      1.997                     (the control below)
      //
      // 12 is a FLOOR placed in the gap between 2 and 58, not a measurement of
      // the ship: the rig is a narrow silhouette inside a box that is mostly
      // the sky behind its fins, and the bar has to hold at the bright stops as
      // well as the dark ones. It is a static comparison of two crops of one
      // frame, so it does not depend on how many frames the host gave us.
      expect(differs, `${stop}: the ship's band is indistinguishable from sky`).toBeGreaterThan(
        12,
      );
    });
  }

  test("CONTROL: two crops of the same empty sky are the same picture", async ({ page }) => {
    // Without this the bar above is unfalsifiable: a page that rendered nothing
    // at all could still report a big number if the sky itself had a strong
    // horizontal gradient. Two sky crops at the same height, 700 px apart -
    // exactly the comparison above, minus the ship.
    test.setTimeout(60_000);
    await openWarp(page, "mars");
    const s = await snap<WarpShipSnapshot>(page, "warp");
    const box = s.ship.box;
    const a = await frameOf(page, { ...box, x: box.x - 700 });
    const b = await frameOf(page, { ...box, x: box.x - 500 });
    const differs = await pixelDiffPercent(
      page,
      a.toString("base64"),
      b.toString("base64"),
    );
    expect(differs, "empty sky must not read as a ship").toBeLessThan(12);
  });

  test("the ship is on the screen a CHILD gets, not just a standalone boot", async ({
    page,
  }) => {
    // ================== WHY THIS TEST EXISTS ==================
    // The screen a player reaches is the OVERLAY (D30): Flight launches Warp
    // over itself and keeps running, so the Lantern on screen is Flight's. The
    // old layout put the ship in a bay on the right that ONLY a standalone boot
    // ever drew, so every capture in this repo showed a ship no player had -
    // which is how UR-63 got past a suite that already screenshotted this
    // screen. This drives the real path.
    test.setTimeout(180_000);
    await freezeReloads(page);
    await page.goto("/?scene=Flight");
    await expect(page.getByTestId("app")).toHaveAttribute("data-booted", "true");
    await page.waitForFunction(
      () =>
        (window as unknown as { __kb?: Record<string, unknown> }).__kb?.["game"] !== undefined,
    );
    // A two-word belt, so the break arrives without flying two minutes of
    // rocks. `debug: true` is what publishes `__kbFlight`.
    await restartScene(page, "Flight", {
      stopId: "mars",
      debug: true,
      seed: 20260916,
      stageWordCount: 2,
      knobs: { maxLive: 2 },
    });
    await page.waitForFunction(
      () => {
        const api = (window as unknown as {
          __kbFlight?: { state(): { rocks: { word: string }[] } };
        }).__kbFlight;
        return (api?.state().rocks.length ?? 0) > 0;
      },
      null,
      // A SYNCHRONISATION DEADLINE, NOT A TOLERANCE (rule 6, rule 8). The
      // condition is "a rock exists", polled; this is only how long the poll is
      // allowed to keep asking. It is generous because this is the one case in
      // the file that boots a whole belt and waits for real fall time, and with
      // three Playwright workers on one box it timed out at 60 s and passed
      // alone in 54.7 s on the same tree. Nothing about what is asserted moves.
      { timeout: 120_000 },
    );
    await page.evaluate(() => {
      const api = (window as unknown as {
        __kbFlight: { state(): { rocks: { word: string }[] } };
      }).__kbFlight;
      for (const rock of api.state().rocks) {
        for (const ch of rock.word) {
          window.dispatchEvent(
            new KeyboardEvent("keydown", { key: ch, code: `Key${ch.toUpperCase()}` }),
          );
        }
      }
    });
    await waitForScene(page, "Warp", 90_000);
    // The slide-in, and a moment of the calmed belt drifting behind it.
    await page.waitForTimeout(1800);

    const live = await activeScenes(page);
    expect(live, "Flight must still be running behind the panel").toContain("Flight");
    const s = await snap<WarpShipSnapshot>(page, "warp");
    expect(s.ship.overlay, "this is the overlay path").toBe(true);
    // This scene draws NO ship when overlaid - Flight's is the one on screen -
    // and the box is where Flight stands it.
    expect(s.ship.drawn).toBe(false);

    for (const card of s.ship.cards) {
      expect(
        overlaps(s.ship.box, card),
        `a card covers Flight's ship: ${JSON.stringify(card)}`,
      ).toBe(false);
    }

    const shipShot = await frameOf(page, s.ship.box);
    const skyShot = await frameOf(page, { ...s.ship.box, x: s.ship.box.x - 700 });
    const differs = await pixelDiffPercent(
      page,
      shipShot.toString("base64"),
      skyShot.toString("base64"),
    );
    writeEvidence("ur63-ship-overlay.png", shipShot);
    writeEvidence("ur63-warp-overlay.png", await page.screenshot());
    expect(differs, "the ship is not visible on the overlaid warp break").toBeGreaterThan(12);
  });
});

test.describe("UR-62: the warp drive reads as one instrument", () => {
  for (const stop of STOPS) {
    test(`label, readout and track share one box at ${stop}`, async ({ page }) => {
      test.setTimeout(60_000);
      await openWarp(page, stop);

      // Both ends of the instrument's one line are on the screen. The
      // percentage is the readout; "warp drive" names what is being read.
      const visible = await texts(page, "warp");
      expect(visible.some((t) => t.includes("%")), `${stop}: no readout`).toBe(true);
      expect(
        visible.some((t) => t.trim().length > 0 && /drive|salto|इंजन/u.test(t)),
        `${stop}: nothing names the drive`,
      ).toBe(true);

      // The whole instrument, cropped, as the evidence a human can look at.
      writeEvidence(`ur62-instrument-${stop}.png`, await frameOf(page, INSTRUMENT_RECT));
      writeEvidence(`ur62-warp-${stop}.png`, await page.screenshot());
    });
  }
});

/** `support/warpLayout.INSTRUMENT`, restated - a spec may not import src. */
const INSTRUMENT_RECT: Rect = { x: 96, y: 536, w: 1728, h: 124 };

/**
 * The charged line used to hang BELOW the whole readout on a pill of its own,
 * which is the third of UR-62's three pieces. It is now the instrument's third
 * row, and it only exists at 100%, so it has to be typed to.
 *
 * TWO STOPS, AND WHY THAT IS THE WHOLE SET (rule 5). The row's GEOMETRY is
 * stop-independent - `instrumentChargedRow` has no stop in it, and
 * `warpLayout.test.ts` sweeps its containment once for that reason. The only
 * thing that varies by stop is which of two strings is drawn there:
 * `warp.chargedNext` names the next stop, and `warp.chargedLast` exists because
 * Pluto has no next one. Mars and Pluto are those two branches; the other five
 * stops are Mars with a different planet name in the same slot.
 */
for (const stop of ["mars", "pluto"] as const) {
  test(`the charged line is the instrument's third row at ${stop}`, async ({ page }) => {
    test.setTimeout(90_000);
    await openWarp(page, stop);
    const before = await snap<WarpShipSnapshot & { sentence: string }>(page, "warp");
    // Type all but the last character with real keystrokes.
    await page.keyboard.type(before.sentence.slice(0, -1), { delay: 12 });

    // STOP THE WORLD FOR THE LAST ONE (rule 6's corollary). The final character
    // starts the warp, and the warp cuts to Beacon 1200 ms later - so every
    // read after it is racing a scene that is about to be destroyed, and the
    // evidence PNG would sometimes be a picture of the wrong screen. The last
    // key is dispatched and the scene PAUSED in the same page turn: `beginWarp`
    // makes the charged line visible synchronously, and a paused scene keeps
    // rendering while its tween - the one that ends in `cutToBeacon` - does not
    // advance.
    const last = before.sentence.slice(-1);
    await page.evaluate((ch: string) => {
      const game = (window as unknown as { __kb: Record<string, unknown> }).__kb["game"] as {
        scene: { pause(k: string): void };
      };
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      game.scene.pause("Warp");
    }, last);

    const s = await snap<WarpShipSnapshot & { chargedLabelVisible: boolean; charged: boolean }>(
      page,
      "warp",
    );
    expect(s.charged, `${stop}: the sentence did not complete`).toBe(true);
    expect(s.chargedLabelVisible, `${stop}: the charged line never drew`).toBe(true);
    const visible = await texts(page, "warp");
    expect(
      visible.some((t) => /charged|cargado|भर गया/u.test(t)),
      `${stop}: nothing says the drive is charged`,
    ).toBe(true);
    writeEvidence(`ur62-charged-${stop}.png`, await frameOf(page, INSTRUMENT_RECT));
  });
}

test.describe("UR-64: the note never offers a retry the sentence cannot give", () => {
  for (const stop of STOPS) {
    test(`the offer and the sentence agree at ${stop}`, async ({ page }) => {
      test.setTimeout(60_000);
      await openWarp(page, stop);
      const s = await snap<WarpShipSnapshot>(page, "warp");

      expect(s.coach.received || s.coach.note.length > 0, `${stop}: no note`).toBe(true);
      // THE CLAIM. `keptBySentence` is computed in the scene off the note AS
      // DRAWN and the sentence AS LAID OUT, so it cannot be told the promise
      // was kept by a variable that disagrees with the screen. It is true on a
      // screen that made no offer, which is why the two lines below it exist.
      expect(
        s.retry.keptBySentence,
        `${stop}: note "${s.coach.note}" / sentence "${s.sentence}"`,
      ).toBe(true);
      if (s.retry.promisedWord !== null) {
        expect(
          s.sentence.toLowerCase(),
          `${stop}: the promised word is not in the sentence`,
        ).toContain(s.retry.promisedWord.toLowerCase());
      }
      // And the rule only ever changed the note by REMOVING an offer: the words
      // Shadow named are still named, because AC-15.5 is not what was broken.
      if (s.retry.outcome === "withdrawn") {
        expect(s.coach.note.length).toBeLessThan(s.retry.rawNote.length);
        expect(s.retry.rawNote).toContain(s.coach.note.replace(/\s+$/, ""));
      }
    });
  }
});

/**
 * UR-64's EVIDENCE A HUMAN CAN CHECK.
 *
 * A user-reported ticket is closed by a picture someone can look at, not by a
 * green tick. These two boots put a real slow word into the run and capture the
 * screen a child would get, one for each half of the answer:
 *
 *   pluto / "up"      nothing in Pluto's prose gives the word in a sentence a
 *                     child can type, so the offer is not made. This is the
 *                     exact case UR-64 reported.
 *   neptune / "deep"  the stop's own sentence contains it, so the offer stands
 *                     and the child types the word Shadow just named.
 *   uranus / "rings"  the stop's warp sentence does NOT contain it, but its own
 *                     briefing has a short typeable sentence that does - so the
 *                     break's sentence becomes that one and the offer is kept.
 *                     This is the path that makes UR-64 a fix rather than a
 *                     retraction, and it is the one that would silently stop
 *                     working if `retrySentenceFor` ever returned null forever.
 */
for (const [stop, word] of [
  ["pluto", "up"],
  ["neptune", "deep"],
  ["uranus", "rings"],
] as const) {
  test(`UR-64 evidence: the note and the sentence at ${stop}, slow on "${word}"`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await openWarp(page, stop);
    await restartScene(page, "Warp", {
      stopId: stop,
      missed: [],
      slow: [word],
      hitRate: 1,
      blasted: [word],
    });
    await page.waitForFunction(() => {
      const bag = (window as unknown as { __kb: Record<string, unknown> }).__kb["warp"] as {
        snapshot(): { coach: { settled: boolean; note: string } };
      };
      const s = bag.snapshot();
      return s.coach.settled && s.coach.note.includes('"');
    });
    const s = await snap<WarpShipSnapshot>(page, "warp");
    // The note still NAMES the word - AC-15.5 is not what was broken.
    expect(s.coach.note, `${stop}: the note stopped naming the slow word`).toContain(
      `"${word}"`,
    );
    expect(s.retry.keptBySentence).toBe(true);
    writeEvidence(`ur64-${stop}-${word}.png`, await page.screenshot());
    writeEvidence(
      `ur64-${stop}-${word}.json`,
      JSON.stringify({ note: s.coach.note, rawNote: s.retry.rawNote, sentence: s.sentence, outcome: s.retry.outcome }, null, 2),
    );
  });
}
