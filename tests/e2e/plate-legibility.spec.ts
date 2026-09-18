import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  bootFlight,
  flightCanvasBox,
  flightState,
  freezeFlight,
  spawnAt,
  waitFrames,
  type RockView,
} from "./support/flightBoot.js";
import { DESIGN } from "./support/lane.js";
import type { SpawnDebugOptions } from "../../src/game/scenes/FlightScene.js";

/**
 * AC-22.8 - A WORD PLATE IS NEVER COVERED BY A ROCK.
 *
 * ================== THE DEFECT ==================
 * The player watched asteroids drift over the words and said so. Every rock in
 * the scene lived in ONE container and was added in spawn order, so a rock that
 * arrived later drew over an earlier rock's plate. That is not a cosmetic
 * overlap. The word is the thing the child is reading; a covered word is a rock
 * they cannot shoot, and legibility is the game.
 *
 * ================== WHY THIS SPEC IS PIXELS AND NOT JUST DEPTH ==================
 * The fix is a depth split - plates on their own container above the rocks -
 * and a test that asserts "plateDepth > rockDepth" would pass on the day
 * somebody adds a third container between them, or sets a plate's alpha to
 * zero, or moves the plate under the near-plane veil. So the depth invariant is
 * asserted AND the frame is measured: a rock is placed deliberately on top of a
 * plate, and the plate's own rectangle is read back off the canvas.
 *
 * The measure is AC-22.8's own quantity - the WCAG contrast ratio between the
 * light and dark of the plate rect - so a red result means the child cannot
 * read the word, not that some pixels moved. A negative control measures a
 * patch of bare rock in the same frame and shows the measure CAN fail, which is
 * what makes the green one worth anything (D85).
 */

test.use({ trace: "off" });

const EVIDENCE_DIR = resolve(process.cwd(), "gauntlet/evidence");

/** AC-22.8 / rubric 8, restated so this file is a check and not a copy. */
const PLATE_MIN_CONTRAST = 4.5;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The light-to-dark contrast actually present in a rectangle of the canvas.
 *
 * Percentiles rather than min/max: a single antialiased pixel on a letter edge
 * is not what a child reads, and letting one outlier set the number would make
 * the measure noise.
 *
 * THE PERCENTILES ARE NOT SYMMETRIC, AND THAT IS THE WHOLE TRICK. A word plate
 * is mostly plate: four letters of thin stroke in a 120x46 rectangle cover
 * roughly a tenth of it. A 90th percentile is therefore still PLATE FILL, and a
 * naive 10/90 split measures the dark plate against itself and reports about
 * 3.8:1 for a perfectly legible word. The ink lives in the top couple of
 * percent, so that is where the light end is read from.
 */
async function rectContrast(page: Page, rect: Rect, what: string): Promise<number> {
  const box = await flightCanvasBox(page);
  const scale = box.width / DESIGN.width;
  const clip = {
    x: box.x + rect.x * scale,
    y: box.y + rect.y * scale,
    width: Math.max(1, rect.w * scale),
    height: Math.max(1, rect.h * scale),
  };
  /**
   * SAY WHICH RECTANGLE, BEFORE PLAYWRIGHT SAYS "CLIPPED AREA IS EITHER EMPTY
   * OR OUTSIDE THE RESULTING IMAGE".
   *
   * Rule 9: that message is produced by two different causes - a canvas that is
   * not on screen, and a rectangle that is off the canvas - and it names
   * neither. `flightCanvasBox` already throws its own error for the first, so
   * everything that reaches here is the second, and this says what was asked
   * for and where the picture ends.
   *
   * It is not hypothetical. In the run of 2026-09-17 this spec died here on the
   * third of its three measurements - a patch of "dust"'s own silhouette -
   * having already printed `covered 17.31:1, clean 17.43:1`, so the failure
   * arrived looking like a legibility result and was not one.
   *
   * REPRODUCED RATHER THAN REASONED ABOUT (rule 9). Put a second rock carrying
   * the same word on the board above the top of the frame, which is where a
   * belt rock spends the start of its life, and let the lookup match by word:
   * the rectangle handed to `clip` comes out at
   *
   *   asked for {"x":256.7,"y":-12.0,"w":106.4,"h":53.5} in design px ->
   *   {"x":171.1,"y":-8.0,...} on a canvas at {"x":0,"y":0,"width":1280,"height":720}
   *
   * A y of -8 is off the image, which is the rectangle Playwright refuses. The
   * OTHER cause of that same sentence - the canvas itself not being on screen -
   * is caught earlier, by `flightCanvasBox`, with its own wording. The two are
   * now told apart by their messages instead of by guessing.
   */
  if (
    clip.x < 0 ||
    clip.y < 0 ||
    clip.x + clip.width > box.x + box.width ||
    clip.y + clip.height > box.y + box.height
  ) {
    throw new Error(
      `${what}: the rectangle to measure is not on the canvas. asked for ` +
        `${JSON.stringify(rect)} in design px -> ${JSON.stringify(clip)} on a canvas at ` +
        `${JSON.stringify(box)}. Nothing about legibility has been measured.`,
    );
  }
  const shot = await page.screenshot({ clip });
  return page.evaluate(async (data: string) => {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = `data:image/png;base64,${data}`;
    });
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    if (ctx === null) throw new Error("no 2d context");
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, img.width, img.height).data;
    const channel = (v: number): number => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const lums: number[] = [];
    for (let i = 0; i < px.length; i += 4) {
      lums.push(
        0.2126 * channel(px[i] ?? 0) +
          0.7152 * channel(px[i + 1] ?? 0) +
          0.0722 * channel(px[i + 2] ?? 0),
      );
    }
    lums.sort((a, b) => a - b);
    const at = (q: number): number => lums[Math.floor((lums.length - 1) * q)] ?? 0;
    const lo = at(0.2);
    const hi = at(0.98);
    return (hi + 0.05) / (lo + 0.05);
  }, shot.toString("base64"));
}

const plateRect = (rock: RockView): Rect => ({
  x: rock.plateLeft,
  y: rock.plateTop,
  w: rock.plateRight - rock.plateLeft,
  h: rock.plateBottom - rock.plateTop,
});

/**
 * ================== A WORD IS NOT A NAME FOR A ROCK ==================
 *
 * This file used to look its rocks up by word, and that stopped being unique
 * the moment the belt got busier. `spawnAt` waits for A rock carrying the word,
 * and the belt may already be carrying it - the stage pool is small and the
 * board now holds 3.4-3.9 rocks where it used to manage 1.0 - so the wait is
 * satisfied by the belt's rock while the placement creates a second one, and
 * every measurement after that is taken on whichever came first in the array.
 *
 * Both failures this file reported in the run of 2026-09-17 are that:
 *
 *   :128  a clip rect off the top of the canvas, because the "victim" was a
 *         belt rock still above the frame.
 *   :334  66.60% overdraw on "dust", because a SECOND "dust" - the belt's, mid
 *         arrival-pop at scale 0.7 - was measured on the nominal rectangle its
 *         plate would have had at scale 1, and the sky around it is exactly
 *         what the clean frame changes.
 *
 * `flight.spec.ts` hit the same thing and solved it by matching on the
 * coordinate it asked for. Here the placement is what needs naming rather than
 * located, so the rock is named by IDENTITY: the id that appears on the board
 * as a result of this call, and nothing else.
 *
 * The scene is FROZEN when this is used, so the belt cannot spawn between the
 * two reads and the difference is exactly one rock. It throws if it is not.
 */
async function placeRock(
  page: Page,
  word: string,
  options: SpawnDebugOptions,
): Promise<string> {
  const before = new Set((await flightState(page)).rocks.map((r) => r.id));
  await spawnAt(page, word, options);
  const fresh = (await flightState(page)).rocks.filter(
    (r) => !before.has(r.id) && r.word === word,
  );
  if (fresh.length !== 1) {
    throw new Error(
      `placing "${word}" at ${JSON.stringify(options)} added ${fresh.length} rocks, not 1. ` +
        "The scene has to be frozen for this to be unambiguous.",
    );
  }
  return (fresh[0] as RockView).id;
}

const byId = (state: { rocks: readonly RockView[] }, id: string): RockView => {
  const rock = state.rocks.find((r) => r.id === id);
  if (rock === undefined) throw new Error(`the rock ${id} left the board before it was measured`);
  return rock;
};

test.describe("AC-22.8: word plates are never occluded", () => {
  test("AC-22.8: a rock placed ON a plate does not cover the word", async ({ page }) => {
    test.setTimeout(120_000);
    await bootFlight(page, {
      knobs: { maxLive: 7 },
      stageWordCount: 40,
      // The sky must hold still while two screenshots are taken, and the rocks
      // must not drift out from under each other between frames.
      reducedMotion: true,
      pixelReadback: true,
      seed: 0x9101,
    });

    // FREEZE FIRST, then build the frame. Every step below is a CDP round trip
    // and rocks fall on the wall clock, so on a running belt the occluder would
    // be aimed at where the victim WAS. Placement still works on a paused scene
    // - the debug hook positions the rock itself rather than waiting for the
    // next update - so the whole arrangement is built inside one frozen frame.
    await freezeFlight(page);

    // The victim. Placed high, so there is room for the occluder below it and
    // so neither is near the breach line. Named by the id the placement
    // created, never by its word - see `placeRock`.
    const victimId = await placeRock(page, "dust", { x: 1200, y: 220 });

    // THE OCCLUDER. A later rock, so it is added to the debris container AFTER
    // the victim, which is exactly the ordering that used to cover the word.
    // Its body is centred on the victim's PLATE.
    //
    // The victim's position is re-read IMMEDIATELY before this, because rocks
    // fall on the wall clock and a CDP round trip is long enough for one to
    // move a hundred pixels. Placing the occluder against a stale reading is
    // how this test passes while measuring two different frames.
    const aimed = byId(await flightState(page), victimId);
    const occluderId = await placeRock(page, "rivers", {
      x: aimed.x,
      y: (aimed.plateTop + aimed.plateBottom) / 2,
    });

    // A CONTROL ROCK, far to the left with nothing near it. It supplies the
    // "clean" reading for the same plate style in the same frame, which is what
    // makes the covered reading comparable to something.
    //
    // Spawned LAST and at the victim's own height on purpose: every CDP round
    // trip above is a second of falling, so a control placed first would be
    // near the breach line - or gone - by the time the frame is measured.
    const settled = byId(await flightState(page), victimId);
    const controlId = await placeRock(page, "polar", { x: 420, y: settled.y });

    await waitFrames(page, 2);
    const state = await flightState(page);
    const victim = byId(state, victimId);
    const occluder = byId(state, occluderId);
    const control = byId(state, controlId);

    // The test has to be exercising the case it names. If these ever stop
    // overlapping, the assertion below is passing for the wrong reason.
    const overlapsX =
      occluder.x + occluder.sizePx / 2 >= victim.plateLeft &&
      occluder.x - occluder.sizePx / 2 <= victim.plateRight;
    const rockTop = occluder.y - occluder.sizePx / 2;
    const overlapsY = rockTop <= victim.plateBottom && occluder.rockBottom >= victim.plateTop;
    expect(overlapsX, "the occluder is not over the plate; the test proves nothing").toBe(true);
    expect(overlapsY, "the occluder is not over the plate; the test proves nothing").toBe(true);

    // 1. THE FRAME. The word is still readable with a rock sitting on it.
    // Both rects come from the state read above, so both are the same instant.
    const coveredContrast = await rectContrast(page, plateRect(victim), "the covered plate");
    const cleanContrast = await rectContrast(page, plateRect(control), "the clean plate");
    console.log(
      `plate contrast: covered ${coveredContrast.toFixed(2)}:1, clean ${cleanContrast.toFixed(2)}:1`,
    );
    // AC-22.8's own floor. It is the FLOOR and not the sharp edge: an occluder
    // that covers half a word still leaves the other half at full contrast, and
    // with the depth fix reverted this measured 5.06:1 - degraded by a factor
    // of three and still over 4.5. So the AC is asserted because it is the AC,
    // and the assertion that actually catches the defect is the next one.
    expect(
      coveredContrast,
      `the plate for "dust" measured ${coveredContrast.toFixed(2)}:1 with a rock over it`,
    ).toBeGreaterThanOrEqual(PLATE_MIN_CONTRAST);

    // THE SHARP ONE. A rock sitting on a plate must not measurably dim it, and
    // the control plate in the same frame is what "measurably" is measured
    // against - so this cannot drift with the palette, the font or the sky.
    //
    // Calibrated against the real thing: with plates above the rocks this runs
    // at ~1.07 (16.04 clean-for-clean); with the depth reverted it falls to
    // 0.34. 0.75 sits between them with room on both sides.
    expect(
      coveredContrast / cleanContrast,
      `covered ${coveredContrast.toFixed(2)}:1 vs clean ${cleanContrast.toFixed(2)}:1 - a rock is dimming the word`,
    ).toBeGreaterThan(0.75);

    // 2. THE NEGATIVE CONTROL. The same measure, on a patch of bare rock in the
    // same frame. A flat silhouette has nothing like a plate's contrast, so a
    // measure that cannot tell them apart is not measuring legibility.
    // The VICTIM's own silhouette, not the occluder's: the occluder is centred
    // on a plate, so a patch around it contains the very plate this is supposed
    // to be a control for, and would measure ~16:1 - the plate, again.
    const bareRock: Rect = {
      x: victim.x - victim.sizePx * 0.22,
      y: victim.y - victim.sizePx * 0.22,
      w: victim.sizePx * 0.44,
      h: victim.sizePx * 0.44,
    };
    const rockContrast = await rectContrast(page, bareRock, "a patch of bare rock");
    expect(
      rockContrast,
      "the contrast measure cannot distinguish a plate from a rock, so it measures nothing",
    ).toBeLessThan(PLATE_MIN_CONTRAST);

    // 3. THE INVARIANT. Every plate draws above every rock, by construction.
    for (const rock of state.rocks) {
      expect(
        rock.plateDepth,
        `${rock.word}: plates must draw above rocks`,
      ).toBeGreaterThan(rock.rockDepth);
    }


    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(
      join(EVIDENCE_DIR, "plate-occlusion.json"),
      `${JSON.stringify(
        {
          minRatio: PLATE_MIN_CONTRAST,
          cleanContrast,
          coveredContrast,
          bareRockContrast: rockContrast,
          plateDepth: victim.plateDepth,
          rockDepth: victim.rockDepth,
          source: "tests/e2e/plate-legibility.spec.ts",
        },
        null,
        2,
      )}\n`,
    );
  });

  test("AC-22.8: a whole board of overlapping rocks leaves every plate above them", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await bootFlight(page, {
      knobs: { maxLive: 7 },
      stageWordCount: 40,
      reducedMotion: true,
      seed: 0x9102,
    });

    // Frozen first: five sequential spawns is five CDP round trips, and on a
    // running belt the rock placed first would have fallen past the breach line
    // - and taken a hull mark with it - before the fifth arrived.
    await freezeFlight(page);

    // Five rocks stacked into one column: every plate has at least one later
    // rock over it, which is the pile-up a busy belt actually produces. Placed
    // high, so no part of the stack is near the bottom of the screen.
    const words = ["dust", "rivers", "moons", "canyon", "polar"];
    for (const [i, word] of words.entries()) {
      await spawnAt(page, word, { x: 960, y: 140 + i * 48 });
    }
    await waitFrames(page, 2);

    const state = await flightState(page);
    expect(state.rocks.length).toBeGreaterThanOrEqual(words.length);
    for (const rock of state.rocks) {
      expect(rock.plateDepth, rock.word).toBeGreaterThan(rock.rockDepth);
      // AC-2.3's companion rule, which the reparenting must not have broken:
      // the plate hangs BELOW its rock and never over the silhouette.
      expect(rock.plateTop, rock.word).toBeGreaterThan(rock.rockBottom);
    }
  });

  /**
   * UR-23 - rocks drawing over word plates, reported from play.
   *
   * ================== WHY THE TESTS ABOVE DID NOT CATCH IT ==================
   * Both of them compare the plate to the GAMEPLAY rocks: `plateDepth >
   * rockDepth`, and a screenshot of one debris rock parked on one plate. The
   * plate layer sat at `debris + 0.5` = 4.5, so both were true, and five other
   * things were drawing over the playfield above 4.5 - the near-field drift
   * silhouettes (5), the floor vignette (5.6), the Lantern (6), the foreVeil
   * silhouettes (6.5, the biggest and darkest objects in the frame) and the
   * atmosphere pass (6.8). `render/parallax.ts` records the capture that caught
   * one: a near-plane rock over a plate, reading "acon".
   *
   * The player is not distinguishing decorative rocks from typeable ones, and
   * they should not have to: the complaint is "a rock is covering a word".
   *
   * ================== WHAT THIS MEASURES ==================
   * Not "is the word still legible", which the contrast test above already
   * covers and which an occluder can pass by covering only half a word. This
   * asks the total question directly:
   *
   *   IS ANY PIXEL OF A WORD PLATE DRAWN BY SOMETHING OTHER THAN THE PLATE?
   *
   * Two frames of one frozen scene: the live frame, and the same frame with
   * every object above the debris plane hidden except the plate layer itself.
   * Inside a plate, those two frames must be IDENTICAL - any pixel that changes
   * is a pixel the world painted over a word. It needs no knowledge of where
   * the decoration happens to be on this seed, and it cannot be satisfied by an
   * occluder that only covers part of the word.
   *
   * It catches SHOWING THROUGH as well as drawing over, which is the half a
   * depth fix cannot reach: while the plate filled at alpha 0.92, a near-black
   * `foreVeil` silhouette behind a word was a visible dark form inside the
   * rectangle and this diff counts every pixel of it.
   *
   * WATCHED FAILING, with `wordPlate.PLATE_FILL_ALPHA` put back to the shipped
   * 0.92 and nothing else changed. 20 of the 85 plates on the sweep reported
   * world through the word, at every one of the six stops:
   *
   *   jupiter clouds  2.549%    mars    pink     0.706%
   *   uranus  ball    1.271%    jupiter rivers   0.392%
   *   saturn  rivers  1.029%    neptune solar    0.174%
   *
   *   Error: mars: 0.71% of the word "pink" is painted by something other than
   *   its plate
   *
   * The depth revert inside the loop is the other control and it is asserted
   * per stop, so neither result rests on one seed liking one stop.
   *
   * The rect is inset by the plate's corner radius, because a rounded rectangle
   * genuinely does show the sky in its four corners.
   *
   * ================== WHAT IT DOES NOT MEASURE ==================
   * The HUD, which is a different scene and is not hidden in any of the three
   * frames, so it cancels. `tests/unit/flight/hudKeepOut.test.ts` owns that.
   * And one plate drawing over another: both frames hold the plates in the same
   * container in the same order, so a plate-on-plate overlap is identical in
   * each and cancels too. It is reported as a geometric count in the artifact
   * rather than left unsaid.
   *
   * ================== WHY IT SWEEPS (rule 5) ==================
   * This ran on one stop and one board depth, and both were wrong for the
   * question. The near planes are built per stop (`tiles.VEIL_BY_STOP`), so
   * "nothing is over a plate" on mars is a statement about mars - the same
   * shape as instances 2 and 3 in `docs/verification-gaps.md`, where a
   * Mars-only gate let Uranus pass the defect it existed to catch. And the
   * board it measured was whatever one boot happened to hold, on a belt that
   * managed 1.0 rocks; the belt now reaches `maxLive` 7, which is more plates,
   * further apart, over more of the near planes. So: every belted stop, and a
   * board filled to the depth the game can now reach before anything is placed
   * on it.
   */
  test("UR-23 / AC-22.8: nothing in the world draws over a word plate", async ({ page }) => {
    test.setTimeout(900_000);

    /** Every stop with a belt. `flight.spec.ts` V-22.4 sweeps the same set. */
    const BELTED_STOPS = ["mars", "jupiter", "saturn", "uranus", "neptune", "pluto"];
    /** wordPlate.PLATE_RADIUS_PX: the corners really are sky. */
    const INSET_PX = 9;
    /** The deepest board the belt can produce. `@engine/pacing` owns the knob. */
    const MAX_LIVE = 7;

    interface PlateReading {
      stopId: string;
      word: string;
      placed: boolean;
      scale: number;
      shippedPct: number;
      revertedPct: number;
    }
    const readings: PlateReading[] = [];
    const skipped: { stopId: string; word: string; why: string }[] = [];
    const boards: { stopId: string; beltRocks: number; plates: number; measured: number }[] = [];
    const plateOnPlate: {
      stopId: string;
      words: string[];
      beltOnly: boolean;
      coveredFraction: number;
    }[] = [];

    for (const stopId of BELTED_STOPS) {
      await bootFlight(page, {
        stopId,
        knobs: { maxLive: MAX_LIVE },
        // Long enough that the hull cannot empty while the board fills: a
        // stalled stage retires every rock at once and freezes the rest
        // wherever they were, which is not a frame of this game.
        stageWordCount: 400,
        reducedMotion: true,
        pixelReadback: true,
        seed: 0x9101,
      });

      /**
       * FILL THE BOARD FIRST, AND WAIT ON THE BOARD RATHER THAN ON A CLOCK.
       *
       * The belt is what puts rocks over the near planes in the real game, so
       * the measurement wants the belt's own rocks in the frame and not only
       * the ones this spec places. Waiting for the count is rule 6: a timeout
       * would be a different board on a different machine.
       *
       * It does not insist on all seven - `maxLive` is a ceiling and the pacing
       * lane owns how fast it is approached - but it records what it got, so a
       * run on a shallow board cannot be read as a run on a deep one.
       */
      await page
        .waitForFunction(
          (want: number) => (window.__kbFlight?.state().rocks.length ?? 0) >= want,
          MAX_LIVE,
          { timeout: 30_000 },
        )
        .catch(() => undefined);
      await freezeFlight(page);
      const beltRocks = (await flightState(page)).rocks.length;

      // A GRID, not one placement. The decoration this is guarding against is
      // placed by a seeded RNG behind a lane guard, so a single plate proves
      // whatever that seed happened to do. Plates are put across the whole
      // playable span - including the outer columns the lane guard hands to the
      // foreground - and at two heights.
      const words = ["dust", "rivers", "moons", "canyon", "polar", "surface", "beacon", "giant"];
      const placedIds: string[] = [];
      let i = 0;
      for (const y of [260, 560]) {
        for (const x of [400, 760, 1160, 1520]) {
          placedIds.push(
            await placeRock(page, words[i % words.length] as string, { x, y }),
          );
          i += 1;
        }
      }
      await waitFrames(page, 3);

      const state = await flightState(page);
      expect(
        state.rocks.length,
        `${stopId}: the board did not hold the placed rocks`,
      ).toBeGreaterThanOrEqual(placedIds.length);

      /**
       * THE RECTANGLE EACH PLATE ACTUALLY COVERS, read off the plate itself.
       *
       * `plateLeft/Right/Top/Bottom` in the debug state are the NOMINAL
       * rectangle. A rock the belt spawned arrives on a `Back.Out` tween from
       * scale 0.7 and a frozen scene never runs a tween, so its plate is drawn
       * at 70% of that rectangle and the rest of the measured area is sky -
       * which is exactly what the clean frame changes. That is the 66.60%
       * "overdraw" this spec reported on a clean word in the run of
       * 2026-09-17, and the previous answer to it was to measure only the rocks
       * the spec had placed. That answer threw away every belt rock, which is
       * every rock the player ever sees.
       *
       * `WordPlate.drawnRect` reports the drawn rectangle including the pop, so
       * the belt's plates can be measured as they are.
       */
      const plates = await page.evaluate(() => {
        const flight = (
          window as unknown as {
            __kbGame: { scene: { getScene(k: string): { children: { list: unknown[] } } } };
          }
        ).__kbGame.scene.getScene("Flight");
        const depth = window.__kbFlight?.state().rocks[0]?.plateDepth ?? 0;
        const layer = (
          flight.children.list as { depth: number; list?: unknown[] }[]
        ).find((c) => c.depth === depth && Array.isArray(c.list));
        if (layer === undefined) throw new Error("no plate layer at the reported depth");
        return (layer.list as {
          wordText: string;
          scaleX: number;
          drawnRect: { left: number; right: number; top: number; bottom: number };
        }[]).map((p) => ({
          word: p.wordText,
          scale: p.scaleX,
          ...p.drawnRect,
        }));
      });
      expect(plates.length, `${stopId}: no plates on the board`).toBeGreaterThanOrEqual(
        placedIds.length,
      );

      /**
       * PLATE ON PLATE, COUNTED RATHER THAN IMPLIED.
       *
       * Both frames hold the plates in one container in one order, so this diff
       * cannot see a plate over a plate and reporting zero would be a claim it
       * has not earned. It is geometry, so it is measured as geometry: which
       * pairs overlap, and how much of the smaller plate the other one takes.
       *
       * It is a real legibility question at a deep board - a word covering a
       * word is the same complaint as a rock covering one - and the fix is in
       * the spawn column rule (`@engine/spawn`), which is not this lane's file
       * and is live under the difficulty lane. Raised in
       * gauntlet/escalations.md; measured here so it has a number.
       */
      const placedWordsForOverlap = new Set(
        placedIds.map((id) => (state.rocks.find((r) => r.id === id) as RockView).word),
      );
      const beltWord = (w: string): boolean => !placedWordsForOverlap.has(w);
      for (let a = 0; a < plates.length; a += 1) {
        for (let b = a + 1; b < plates.length; b += 1) {
          const p = plates[a] as (typeof plates)[number];
          const q = plates[b] as (typeof plates)[number];
          const ow = Math.min(p.right, q.right) - Math.max(p.left, q.left);
          const oh = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
          if (ow <= 0 || oh <= 0) continue;
          const smaller = Math.min(
            (p.right - p.left) * (p.bottom - p.top),
            (q.right - q.left) * (q.bottom - q.top),
          );
          plateOnPlate.push({
            stopId,
            words: [p.word, q.word],
            // WHOSE BOARD THIS IS. The grid this spec places puts EIGHT extra
            // rocks on a board that is already carrying `maxLive` seven, so a
            // pair involving a placed rock is an overlap on a board denser than
            // the game can produce, and counting it as a finding would overstate
            // the ticket. Only `beltOnly` pairs are a statement about the belt.
            beltOnly: beltWord(p.word) && beltWord(q.word),
            coveredFraction: Number(((ow * oh) / smaller).toFixed(3)),
          });
        }
      }

      const box = await flightCanvasBox(page);
      const scale = box.width / DESIGN.width;
      const placedWords = new Set(
        placedIds.map((id) => (state.rocks.find((r) => r.id === id) as RockView).word),
      );
      const placedCentres = placedIds.map((id) => {
        const r = state.rocks.find((x) => x.id === id) as RockView;
        return { x: (r.plateLeft + r.plateRight) / 2, y: r.plateY };
      });

      const rects: {
        word: string;
        placed: boolean;
        scale: number;
        x: number;
        y: number;
        w: number;
        h: number;
      }[] = [];
      for (const p of plates) {
        const x = p.left + INSET_PX;
        const y = p.top + INSET_PX;
        const w = p.right - p.left - INSET_PX * 2;
        const h = p.bottom - p.top - INSET_PX * 2;
        // A plate that is not wholly in the picture is not an occlusion
        // question, it is a plate that is partly not drawn - the same
        // distinction `flight.spec.ts` draws between off-frame and
        // unmeasurable. Recorded, so a frame where everything was off-screen
        // cannot be read as a frame where everything was clean.
        if (w < 4 || h < 4 || x < 0 || y < 0 || x + w > DESIGN.width || y + h > DESIGN.height) {
          skipped.push({ stopId, word: p.word, why: `off-frame rect ${Math.round(x)},${Math.round(y)} ${Math.round(w)}x${Math.round(h)}` });
          continue;
        }
        const cx = (p.left + p.right) / 2;
        const cy = (p.top + p.bottom) / 2;
        const placed =
          placedWords.has(p.word) &&
          placedCentres.some((c) => Math.hypot(c.x - cx, c.y - cy) < 2);
        rects.push({ word: p.word, placed, scale: p.scale, x, y, w, h });
      }
      expect(
        rects.filter((r) => r.placed).length,
        `${stopId}: only ${rects.filter((r) => r.placed).length} of the ${placedIds.length} placed plates were measurable`,
      ).toBeGreaterThanOrEqual(6);

      const live = (await page.screenshot()).toString("base64");

      // THE DEFECT, PUT BACK ON PURPOSE (D85; the queue's "a check that cannot be
      // made to fail is not a check"). The plate layer is dropped to the depth
      // that shipped UR-23 and the same frame is taken again. If this frame is
      // clean too, the scene has no foreground over any plate on this seed and
      // the green result below is worth nothing - so it is asserted, not logged.
      const shippedDefectDepth = await page.evaluate(() => {
        const flight = (window as unknown as {
          __kbGame: { scene: { getScene(k: string): { children: { list: unknown[] } } } };
        }).__kbGame.scene.getScene("Flight");
        const plateDepth = window.__kbFlight?.state().rocks[0]?.plateDepth ?? 0;
        const plates = (flight.children.list as { depth: number; setDepth(d: number): void }[]).find(
          (c) => c.depth === plateDepth,
        );
        if (plates === undefined) throw new Error("no plate layer at the reported depth");
        plates.setDepth(4.5);
        return 4.5;
      });
      expect(shippedDefectDepth).toBe(4.5);
      await waitFrames(page, 2);
      const defect = (await page.screenshot()).toString("base64");

      // THE CLEAN FRAME: the plate drawn with nothing above the debris plane at
      // all. Whatever a plate looks like here is what a plate looks like when
      // nothing is covering it.
      await page.evaluate(() => {
        const flight = (window as unknown as {
          __kbGame: { scene: { getScene(k: string): { children: { list: unknown[] } } } };
        }).__kbGame.scene.getScene("Flight");
        for (const c of flight.children.list as {
          depth: number;
          visible: boolean;
          setVisible(v: boolean): void;
        }[]) {
          if (c.depth > 4.5) c.setVisible(false);
        }
      });
      await waitFrames(page, 2);
      const clean = (await page.screenshot()).toString("base64");

      const overdraw = async (a: string, b: string): Promise<number[]> =>
        page.evaluate(
          async ([first, second, rs, sc, ox, oy]: [
            string,
            string,
            typeof rects,
            number,
            number,
            number,
          ]) => {
            const load = (d: string): Promise<HTMLImageElement> =>
              new Promise((res, rej) => {
                const im = new Image();
                im.onload = () => res(im);
                im.onerror = rej;
                im.src = `data:image/png;base64,${d}`;
              });
            const [ia, ib] = await Promise.all([load(first), load(second)]);
            const ctxOf = (img: HTMLImageElement): CanvasRenderingContext2D => {
              const c = document.createElement("canvas");
              c.width = img.width;
              c.height = img.height;
              const g = c.getContext("2d");
              if (g === null) throw new Error("no 2d context");
              g.drawImage(img, 0, 0);
              return g;
            };
            const ca = ctxOf(ia);
            const cb = ctxOf(ib);
            return rs.map((r) => {
              const x = Math.round(ox + r.x * sc);
              const y = Math.round(oy + r.y * sc);
              const w = Math.max(1, Math.round(r.w * sc));
              const h = Math.max(1, Math.round(r.h * sc));
              const pa = ca.getImageData(x, y, w, h).data;
              const pb = cb.getImageData(x, y, w, h).data;
              let differing = 0;
              for (let p = 0; p < pa.length; p += 4) {
                const d = Math.max(
                  Math.abs((pa[p] ?? 0) - (pb[p] ?? 0)),
                  Math.abs((pa[p + 1] ?? 0) - (pb[p + 1] ?? 0)),
                  Math.abs((pa[p + 2] ?? 0) - (pb[p + 2] ?? 0)),
                );
                // >2 rather than >0: the compositor is not bit-exact between two
                // captures of the same frozen frame, and a 1-unit wobble is not
                // a rock.
                if (d > 2) differing += 1;
              }
              return (100 * differing) / (w * h);
            });
          },
          [a, b, rects, scale, box.x, box.y] as [
            string,
            string,
            typeof rects,
            number,
            number,
            number,
          ],
        );

      const shipped = await overdraw(live, clean);
      const reverted = await overdraw(defect, clean);
      rects.forEach((r, k) => {
        readings.push({
          stopId,
          word: r.word,
          placed: r.placed,
          scale: Number(r.scale.toFixed(3)),
          shippedPct: Number((shipped[k] ?? 0).toFixed(3)),
          revertedPct: Number((reverted[k] ?? 0).toFixed(3)),
        });
      });
      boards.push({ stopId, beltRocks, plates: plates.length, measured: rects.length });
      console.log(
        `UR-23 ${stopId}: belt held ${beltRocks}, ${rects.length} plates measured, ` +
          `worst shipped ${Math.max(...shipped, 0).toFixed(3)}%, ` +
          `worst reverted ${Math.max(...reverted, 0).toFixed(3)}%`,
      );

      // THE CONTROL, PER STOP. At the depth that shipped the defect the world
      // does reach a word on this board - asserted here rather than once at the
      // end, because a sweep whose control only fires on one stop is a sweep
      // that proves nothing about the other five.
      expect(
        Math.max(...reverted, 0),
        `${stopId}: nothing covered any plate even at the depth that shipped UR-23, so this stop proves nothing`,
      ).toBeGreaterThan(0.5);
    }

    console.log("UR-23 plate overdraw:", JSON.stringify(readings));

    // THE ASSERTION. Not "mostly clean" and not a ratio: a word plate is opaque
    // and nothing may be in front of it, so the only number that means "cannot
    // happen" is zero.
    for (const row of readings) {
      expect(
        row.shippedPct,
        `${row.stopId}: ${row.shippedPct.toFixed(2)}% of the word "${row.word}" is painted by something other than its plate`,
      ).toBe(0);
    }

    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(
      join(EVIDENCE_DIR, "plate-overdraw.json"),
      `${JSON.stringify(
        {
          ticket: "UR-23",
          maxLive: MAX_LIVE,
          stops: BELTED_STOPS,
          boards,
          platesMeasured: readings.length,
          beltPlatesMeasured: readings.filter((r) => !r.placed).length,
          worstShippedPct: Math.max(...readings.map((r) => r.shippedPct), 0),
          worstRevertedPct: Math.max(...readings.map((r) => r.revertedPct), 0),
          // Neither frame changes it, so this diff cannot see a plate over a
          // plate. Counted so the number is known rather than assumed.
          plateOnPlateOverlaps: plateOnPlate.length,
          plateOnPlateBeltOnly: plateOnPlate.filter((o) => o.beltOnly).length,
          worstBeltOnlyOverlap: Math.max(
            0,
            ...plateOnPlate.filter((o) => o.beltOnly).map((o) => o.coveredFraction),
          ),
          plateOnPlate,
          skipped,
          plates: readings,
          source: "tests/e2e/plate-legibility.spec.ts",
        },
        null,
        2,
      )}\n`,
    );
  });

  test("AC-2.3: the plate hangs level under a rock that is tumbling", async ({ page }) => {
    // A second thing the depth split fixed. The plate used to be a CHILD of the
    // rock container, and that container spins (`spinPerSec`), so the word
    // tumbled with the rock and swung through an arc around it. Art-direction
    // section 4 has always said the plate hangs below the rock.
    //
    // ============ WHY THE ROCK IS SPAWNED AND SAMPLED IN ONE EVALUATE ============
    // This test used to spawn over CDP and then sample over CDP: `waitFrames`
    // then `flightState`, six times. It failed in the full run of 2026-09-16
    // with ZERO samples, and the reason is neither a flake nor the product's
    // geometry - it is that ONE ROUND TRIP IS LONGER THAN THE ROCK'S LIFE.
    //
    // Instrumented on this machine: the boot cost 12 s, `spawnAt` another 7 s,
    // and a single `flightState` after it another 7 s - by which point "surface"
    // was already off the board, because a seven-letter word falls in about
    // three seconds (FR-8). There was never a sample to take. A second, slower
    // failure sat behind it: the belt runs while all this happens and nobody is
    // typing, so a 40-word stage spends its six hull marks (`hullForStage`) and
    // STALLS, which retires every rock at once - measured at 32 s, `hull 0/6,
    // stalled true`.
    //
    // Both are removed rather than absorbed. The spawn and the sampling happen
    // inside one `page.evaluate`, so nothing between them costs a round trip;
    // and the stage is long enough that its hull cannot empty during the
    // measurement. The three assertions are unchanged and measure the same
    // three quantities they always did.
    test.setTimeout(120_000);
    // stageWordCount 400, so `hullForStage` gives the stage 66 marks instead of
    // six. Nothing about a plate hanging level depends on how long the stage is;
    // the six-mark hull was an unrelated way for the fixture to end itself.
    //
    // THE SLOW CALIBRATION IS WHAT MAKES THIS A TEST OF TUMBLING. Measured on
    // this box, a headless page renders the flight at about 4.5 fps, and a rock
    // falls on the WALL CLOCK - so at the default calibration "surface" crossed
    // the whole screen in FIVE RENDERED FRAMES (y -40, 177, 390, 596, 823,
    // gone). Five frames is barely two samples, and it is also barely any
    // rotation, because `updateRocks` turns the rock per FRAME. The test could
    // therefore be green on a rock that never turned - which is the one
    // condition it exists to check.
    //
    // A slow pilot's calibration is a shipped, legal configuration (FR-8 scales
    // fall time by exactly this), and it buys the rock about ten times the
    // frames. The rotation assertion below then has something to assert.
    await bootFlight(page, {
      knobs: { maxLive: 4 },
      stageWordCount: 400,
      seed: 0x9103,
      calibration: { ikiMs: 1600, fkLatencyMs: 900 },
    });

    const samples = await page.evaluate(async (word: string) => {
      const game = window.__kbGame as unknown as {
        events: { on(e: string, f: () => void): void; off(e: string, f: () => void): void };
      };
      // A LONG word at the very top. Fall time grows with word length (FR-8),
      // so this is the rock with the most frames in it.
      // spinPerSec 0.15 is the FASTEST a shipped rock turns - `spawnRock` draws
      // it from `(rng() - 0.5) * 0.3`. Stated rather than left to the seed,
      // because this seed's rock turned at 0.0008 rad/s and the assertion below
      // was measuring a rock that was not tumbling.
      window.__kbFlight?.spawn(word, { x: 800, y: -40, spinPerSec: 0.15 });
      const out: { offsetY: number; centreErr: number; rotation: number }[] = [];
      await new Promise<void>((resolve) => {
        let frames = 0;
        const onRender = (): void => {
          frames += 1;
          const done = (): void => {
            game.events.off("postrender", onRender);
            resolve();
          };
          // EVERY frame. On a headless box the rock's whole life is a handful
          // of them, and skipping two in three is how this arrived at zero
          // samples in the run of 2026-09-16.
          const live = window.__kbFlight?.state().rocks.find((r) => r.word === word);
          // Gone means the stage ended or the rock reached the breach line;
          // what was sampled before that is the measurement.
          if (live === undefined || out.length >= 300 || frames > 600) {
            done();
            return;
          }
          out.push({
            offsetY: live.plateY - live.y,
            centreErr: Math.abs((live.plateLeft + live.plateRight) / 2 - live.x),
            rotation: live.rockRotation,
          });
        };
        game.events.on("postrender", onRender);
      });
      return out;
    }, "surface");

    expect(samples.length, "the rock left the board before it could be sampled").toBeGreaterThan(1);

    // THE PRECONDITION, ASSERTED. AC-2.3 is about a rock that is TUMBLING, so
    // the rock has to be caught tumbling or the result below is about a rock
    // that sat still. The plate hangs about 100 px under the rock, so this much
    // rotation would swing a re-parented plate several pixels sideways - well
    // past the 2 px the two assertions after it allow.
    const turned = Math.max(...samples.map((s) => s.rotation)) -
      Math.min(...samples.map((s) => s.rotation));
    expect(
      Math.abs(turned),
      `the rock turned ${turned.toFixed(3)} rad, so nothing about tumbling was measured`,
    ).toBeGreaterThan(0.02);

    // The plate stays directly under its rock, whatever the rock is doing.
    for (const s of samples) expect(s.centreErr).toBeLessThan(2);
    const offsets = samples.map((s) => s.offsetY);
    const spread = Math.max(...offsets) - Math.min(...offsets);
    expect(spread, `the plate's offset wandered by ${spread.toFixed(1)}px`).toBeLessThan(2);
  });
});
