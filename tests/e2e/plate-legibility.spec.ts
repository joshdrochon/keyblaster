import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  bootFlight,
  flightState,
  freezeFlight,
  spawnAt,
  waitFrames,
  type RockView,
} from "./support/flightBoot.js";
import { DESIGN, gameCanvas } from "./support/lane.js";
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
  const box = await gameCanvas(page).boundingBox();
  if (box === null) throw new Error("no canvas");
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

  test("AC-2.3: the plate hangs level under a rock that is tumbling", async ({ page }) => {
    // A second thing the depth split fixed. The plate used to be a CHILD of the
    // rock container, and that container spins (`spinPerSec`), so the word
    // tumbled with the rock and swung through an arc around it. Art-direction
    // section 4 has always said the plate hangs below the rock.
    test.setTimeout(120_000);
    await bootFlight(page, { knobs: { maxLive: 4 }, stageWordCount: 40, seed: 0x9103 });
    // A LONG word, spawned at the very top. Fall time grows with word length
    // (FR-8), and this test needs the rock to still be on the board after
    // several round trips on a machine whose frames are not real-time.
    await spawnAt(page, "surface", { x: 800, y: -40 });

    const offsets: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      await waitFrames(page, 3);
      const live = (await flightState(page)).rocks.find((r) => r.word === "surface");
      // The rock falls on the wall clock; once it is gone there is nothing left
      // to sample and the samples already taken are the measurement.
      if (live === undefined) break;
      // The plate stays directly under its rock, whatever the rock is doing.
      offsets.push(live.plateY - live.y);
      expect(Math.abs((live.plateLeft + live.plateRight) / 2 - live.x)).toBeLessThan(2);
    }
    expect(offsets.length, "the rock left the board before it could be sampled").toBeGreaterThan(1);
    const spread = Math.max(...offsets) - Math.min(...offsets);
    expect(spread, `the plate's offset wandered by ${spread.toFixed(1)}px`).toBeLessThan(2);
  });
});
