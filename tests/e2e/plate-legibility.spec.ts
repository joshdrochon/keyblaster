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
async function rectContrast(page: Page, rect: Rect): Promise<number> {
  const box = await flightCanvasBox(page);
  const scale = box.width / DESIGN.width;
  const shot = await page.screenshot({
    clip: {
      x: box.x + rect.x * scale,
      y: box.y + rect.y * scale,
      width: Math.max(1, rect.w * scale),
      height: Math.max(1, rect.h * scale),
    },
  });
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

const find = (state: { rocks: readonly RockView[] }, word: string): RockView => {
  const rock = state.rocks.find((r) => r.word === word);
  if (rock === undefined) throw new Error(`no live rock for "${word}"`);
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
    // so neither is near the breach line.
    await spawnAt(page, "dust", { x: 1200, y: 220 });

    // THE OCCLUDER. A later rock, so it is added to the debris container AFTER
    // the victim, which is exactly the ordering that used to cover the word.
    // Its body is centred on the victim's PLATE.
    //
    // The victim's position is re-read IMMEDIATELY before this, because rocks
    // fall on the wall clock and a CDP round trip is long enough for one to
    // move a hundred pixels. Placing the occluder against a stale reading is
    // how this test passes while measuring two different frames.
    const aimed = find(await flightState(page), "dust");
    await spawnAt(page, "rivers", {
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
    const settled = find(await flightState(page), "dust");
    await spawnAt(page, "polar", { x: 420, y: settled.y });

    await waitFrames(page, 2);
    const state = await flightState(page);
    const victim = find(state, "dust");
    const occluder = find(state, "rivers");
    const control = find(state, "polar");

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
    const coveredContrast = await rectContrast(page, plateRect(victim));
    const cleanContrast = await rectContrast(page, plateRect(control));
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
    const rockContrast = await rectContrast(page, bareRock);
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
   * The rect is inset by the plate's corner radius, because a rounded rectangle
   * genuinely does show the sky in its four corners.
   */
  test("UR-23 / AC-22.8: nothing in the world draws over a word plate", async ({ page }) => {
    test.setTimeout(300_000);
    await bootFlight(page, {
      knobs: { maxLive: 20 },
      stageWordCount: 60,
      reducedMotion: true,
      pixelReadback: true,
      seed: 0x9101,
    });
    await freezeFlight(page);

    // A GRID, not one placement. The decoration this is guarding against is
    // placed by a seeded RNG behind a lane guard, so a single plate proves
    // whatever that seed happened to do. Plates are put across the whole
    // playable span - including the outer columns the lane guard hands to the
    // foreground - and at three heights.
    const words = ["dust", "rivers", "moons", "canyon", "polar", "surface", "beacon", "giant"];
    let i = 0;
    for (const y of [260, 560]) {
      for (const x of [400, 760, 1160, 1520]) {
        await spawnAt(page, words[i % words.length] as string, { x, y });
        i += 1;
      }
    }
    await waitFrames(page, 3);

    const state = await flightState(page);
    // ONLY THE PLACED ROCKS, and this is not a convenience.
    //
    // A rock the BELT spawned arrives on a `Back.Out` tween from scale 0.7, and
    // a frozen scene never runs a tween - so its plate is drawn at 70% of the
    // rectangle `plateSizePx` reports, and the measured rect spills onto the
    // sky around it. That sky is exactly what the clean frame changes, so those
    // two rocks report a difference that is not an occlusion. The debug spawn
    // hook lands the pop immediately for the rocks it places, which is why they
    // are the ones measured. Caught by this test reporting 59% on a rock it had
    // not placed while every rock it had placed read zero.
    const placed = state.rocks.filter((r) => words.includes(r.word));
    expect(placed.length, "the board did not hold the placed rocks").toBeGreaterThanOrEqual(6);
    const box = await flightCanvasBox(page);
    const scale = box.width / DESIGN.width;

    /** wordPlate.PLATE_RADIUS_PX: the corners really are sky. */
    const INSET_PX = 9;
    const rects = placed.map((r) => ({
      word: r.word,
      x: r.plateLeft + INSET_PX,
      y: r.plateTop + INSET_PX,
      w: r.plateRight - r.plateLeft - INSET_PX * 2,
      h: r.plateBottom - r.plateTop - INSET_PX * 2,
    }));

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
    const report = rects.map((r, k) => ({
      word: r.word,
      shippedPct: Number((shipped[k] ?? 0).toFixed(3)),
      revertedPct: Number((reverted[k] ?? 0).toFixed(3)),
    }));
    console.log("UR-23 plate overdraw:", JSON.stringify(report));

    // THE CONTROL FIRST, because it is what gives the assertion after it any
    // content: at the depth that shipped the defect, the world does reach a
    // word on this board.
    const worstReverted = Math.max(...reverted);
    expect(
      worstReverted,
      "nothing covered any plate even at the depth that shipped UR-23, so this board proves nothing",
    ).toBeGreaterThan(0.5);

    // THE ASSERTION. Not "mostly clean" and not a ratio: a word plate is opaque
    // and nothing may be in front of it, so the only number that means "cannot
    // happen" is zero.
    for (const row of report) {
      expect(
        row.shippedPct,
        `${row.shippedPct.toFixed(2)}% of the word "${row.word}" is painted by something other than its plate`,
      ).toBe(0);
    }

    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(
      join(EVIDENCE_DIR, "plate-overdraw.json"),
      `${JSON.stringify(
        {
          ticket: "UR-23",
          plateDepth: placed[0]?.plateDepth ?? null,
          shippedDefectDepth,
          worstShippedPct: Math.max(...shipped),
          worstRevertedPct: worstReverted,
          plates: report,
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
