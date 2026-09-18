import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  bootFlight,
  flightCanvasBox,
  flightState,
  freezeFlight,
  waitFrames,
} from "./support/flightBoot.js";
import { DESIGN } from "./support/lane.js";
// @ts-expect-error - .mjs tooling module, no type declarations by design
import { CORE, measureSilhouettes } from "../gauntlet/silhouette.mjs";

/**
 * AC-22.4 ACROSS THE DAMAGE STATES A SHIPPED STAGE CAN ACTUALLY REACH.
 *
 * ================== THE HOLE THIS FILLS ==================
 * `flight.spec.ts`'s V-22.4 measures every object against what is immediately
 * behind it and requires 0.06 of the 8-bit range between them. It samples the
 * ship at whatever damage the capture happens to have taken, and it BOUNDS that
 * damage with a constant called `SHIPPED_MAX_HULL`, set to 6, whose own comment
 * derives it from "a 40-word stage". The shipped stage is 58 words
 * (`DEFAULT_FLIGHT_CONFIG.stageWordCount`) and `hullForStage(58)` is NINE. So
 * the gate is capped two marks below the damage a child can really fly into,
 * and the value it stops measuring at is the value on its way to the sky's.
 *
 * That matters because the hull's brightness is not monotone in the bar. The
 * Lantern is cream and the frame behind it at the ship's height is the sky's
 * dark end, so a darkening hull is SAFE at both ends and crosses the sky's own
 * value in the middle. The numbers `flight.spec.ts` records from mars, its own
 * table, ship core against a sky holding at 83-92:
 *
 *   hits 0   203.5     hits 6   142.6      hits 10  55.3
 *   hits 2   144.6     hits 7    89.2      hits 12  51.7
 *   hits 4   141.7     hits 8    94.1
 *
 * 89.2 against a sky at 89 is a separation of 0.005 against a bar of 0.06. At
 * six marks the item passes; at seven it fails by a factor of twelve. Nothing
 * guarded the difference, and the difference is one hull hit.
 *
 * ================== WHAT THIS FILE DOES ==================
 * It walks the hull down one mark at a time from a full hull to one mark short
 * of a stall, at EVERY belted stop, and measures the Lantern with the gauntlet's
 * own `measureSilhouettes` - the same function, the same CORE/RING geometry and
 * the same 0.06 bar V-22.4 uses. The bar is not touched anywhere in this file.
 *
 * Coding-standards rule 5: the asteroid-visibility gate once booted mars only
 * and uranus passed the defect it existed to catch, so this names every stop
 * and every mark count it measured in its artifact.
 *
 *   PW_PORT=5219 npx playwright test tests/e2e/hull-scorch.spec.ts
 */

test.use({ trace: "off" });

const EVIDENCE_DIR = resolve(process.cwd(), "gauntlet/evidence");

/** Every stop with a belt. The set `flight.spec.ts` V-22.4 sweeps. */
const BELTED_STOPS = ["mars", "jupiter", "saturn", "uranus", "neptune", "pluto"];

/** `FlightScene.ts` - the ship's anchor and half-width, in DESIGN pixels. */
const SHIP = { cx: DESIGN.width / 2, cy: DESIGN.height - 150, halfWidth: 46 };

/**
 * `hullForStage(DEFAULT_FLIGHT_CONFIG.stageWordCount)` - the marks a SHIPPED
 * belt carries, and therefore the damage states this has to cover.
 *
 * Restated rather than imported because this file runs under Playwright's
 * loader against `tests/`; `tests/unit/flight/hullMarks.test.ts` binds the same
 * arithmetic to `@engine/hull` and the assertion below re-derives it from the
 * scene's own `maxHull` at every stop, so a change to the rule moves this
 * measurement instead of escaping it.
 */
const SHIPPED_HULL_MARKS = 9;

/**
 * A 400-word stage carries 66 marks, so the belt cannot stall itself while the
 * ladder is walked. The MARKS are what this measures and 0..8 of them are
 * reachable on the shipped 58-word stage; the long stage is the fixture that
 * lets them be held still, exactly as `flight.spec.ts`'s placed pass does.
 */
const FIXTURE_STAGE_WORDS = 400;

/** The deepest mark count that leaves the stage still flying on a 58-word belt. */
const MAX_MARKS = SHIPPED_HULL_MARKS - 1;

interface Reading {
  readonly stopId: string;
  readonly marks: number;
  readonly inside: number;
  readonly outside: number;
  readonly separation: number;
  readonly retries: number;
}

/**
 * One frozen frame, as a luma buffer.
 *
 * NOTHING HERE READS THE LIVE CANVAS. Without `preserveDrawingBuffer` a WebGL
 * canvas hands back uniform garbage, and that has produced two wrong
 * measurements on this project. The pixels come from a `page.screenshot` PNG,
 * decoded in the page and handed back as bytes.
 *
 * Frozen BEFORE the shutter and two frames waited for, because `scene.pause()`
 * stops `update` immediately while the compositor may still be holding a frame
 * from before the pause - the same correction V-22.4 needed.
 *
 * IT LEAVES THE SCENE FROZEN. The caller resumes it for exactly as long as the
 * mark's fade needs and no longer - see `runFor`.
 */
async function frozenLuma(page: Page): Promise<{
  w: number;
  h: number;
  grey: Uint8Array;
  state: Awaited<ReturnType<typeof flightState>>;
  box: { x: number; y: number; width: number; height: number };
}> {
  await freezeFlight(page);
  await waitFrames(page, 2);
  const box = await flightCanvasBox(page);
  const shot = await page.screenshot({
    clip: { x: box.x, y: box.y, width: box.width, height: box.height },
  });
  const state = await flightState(page);
  const decoded = await page.evaluate(async (b64in: string) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64in}`;
    await img.decode();
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const ctx = off.getContext("2d") as CanvasRenderingContext2D;
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    let s = "";
    for (let i = 0; i < w * h; i += 1) {
      s += String.fromCharCode(
        Math.round(
          0.299 * (data[i * 4] as number) +
            0.587 * (data[i * 4 + 1] as number) +
            0.114 * (data[i * 4 + 2] as number),
        ),
      );
    }
    return { w, h, b64: btoa(s) };
  }, shot.toString("base64"));
  const raw = Buffer.from(decoded.b64, "base64");
  const grey = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) grey[i] = raw[i] as number;
  return { w: decoded.w, h: decoded.h, grey, state, box };
}

/**
 * Measure the Lantern in one frozen frame, or say why it could not be measured.
 *
 * A WORD PLATE IS NOT THE SHIP. The plate layer draws above the Lantern (a
 * weighed trade recorded in `FlightScene.PLATE_DEPTH`: a word the child cannot
 * read is worse than a ship they cannot see for a quarter of a second), so a
 * plate crossing the ship's core makes the probe average a dark opaque
 * rectangle and report it as the rocket. V-22.4 caught that with a control and
 * this uses the same geometric test, taken BEFORE any pixel is read, so nothing
 * here can turn a genuinely weak reading into a skip.
 */
function measureShip(
  frame: { w: number; h: number; grey: Uint8Array; state: Awaited<ReturnType<typeof flightState>> },
  scale: number,
): { inside: number; outside: number; separation: number } | { plated: true } {
  const cx = SHIP.cx * scale;
  const cy = SHIP.cy * scale;
  const r = SHIP.halfWidth * scale;
  const core = r * CORE;
  const plated = frame.state.rocks.some(
    (rock) =>
      rock.plateLeft * scale < cx + core &&
      rock.plateRight * scale > cx - core &&
      rock.plateTop * scale < cy + core &&
      rock.plateBottom * scale > cy - core,
  );
  if (plated) return { plated: true };
  const measured = measureSilhouettes({
    grey: frame.grey,
    w: frame.w,
    h: frame.h,
    objects: [
      { id: "ship", kind: "ship", cx, cy, r },
      // The rocks are named so the ring cannot sample one of them and call it
      // sky. They are not measured here: V-22.4 owns the asteroids.
      ...frame.state.rocks.map((rock) => ({
        id: rock.id,
        kind: "rock",
        cx: rock.x * scale,
        cy: rock.y * scale,
        r: (rock.sizePx / 2) * scale,
      })),
    ],
    exclude: frame.state.rocks.map((rock) => ({
      x0: rock.plateLeft * scale,
      y0: rock.plateTop * scale,
      x1: rock.plateRight * scale,
      y1: rock.plateBottom * scale,
    })),
  });
  const ship = (measured.objects as { id: string; inside: number; outside: number; separation: number }[]).find(
    (o) => o.id === "ship",
  );
  if (ship === undefined) {
    throw new Error(
      `the ship was unmeasurable: ${JSON.stringify(measured.unmeasurable)}`,
    );
  }
  return { inside: ship.inside, outside: ship.outside, separation: ship.separation };
}

/**
 * LET THE WORLD RUN FOR A KNOWN LENGTH OF TIME, AND NO LONGER.
 *
 * Nobody types during this measurement, so every millisecond the belt runs is a
 * millisecond a rock falls closer to the hull - and a rock that lands takes a
 * mark this ladder did not ask for. On a loaded machine a CDP round trip can
 * take seconds, so a probe that leaves the scene running between steps walks
 * the hull past what a shipped stage can carry and measures a ship the game
 * never draws. That is not hypothetical: it is what this file did on the first
 * attempt, and its own guard caught it - "mars: the ladder walked past what a
 * shipped stage carries".
 *
 * So the scene is PAUSED for everything except the fade: strikes land on a
 * frozen world (`__kbFlight.strike` does not need `update`), and the world runs
 * only for the 200 ms `addScorch` tweens the mark in, plus a margin.
 */
async function runFor(page: Page, ms: number): Promise<void> {
  await freezeFlight(page, false);
  await page.waitForTimeout(ms);
  await freezeFlight(page);
  await waitFrames(page, 2);
}

test("AC-22.4 / UR-22: the scorched hull never takes the sky's own value", async ({ page }) => {
  test.setTimeout(900_000);

  const readings: Reading[] = [];
  const skipped: { stopId: string; marks: number; why: string }[] = [];

  for (const stopId of BELTED_STOPS) {
    console.log(`hull-scorch booting ${stopId}`);
    await bootFlight(page, {
      stopId,
      // ONE rock at a time. This is a measurement of the SHIP: every extra
      // plate is another chance of one crossing its core, and every extra rock
      // is another that can land on the hull and take a mark the ladder did not
      // ask for. V-22.4 owns the deep-board question.
      knobs: { maxLive: 1 },
      stageWordCount: FIXTURE_STAGE_WORDS,
      reducedMotion: true,
      seed: 0x4d22,
    });
    await page
      .waitForFunction(() => (window.__kbFlight?.state().rocks.length ?? 0) > 0, null, {
        timeout: 30_000,
      })
      .catch(() => undefined);
    // From here the world only moves when `runFor` says so.
    await freezeFlight(page);
    await waitFrames(page, 2);

    const box = await flightCanvasBox(page);
    const scale = box.width / DESIGN.width;

    for (let marks = 0; marks <= MAX_MARKS; marks += 1) {
      /**
       * WAIT FOR THE MARK COUNT, NEVER FOR A CLOCK (rule 6).
       *
       * The belt lands rocks on itself while nobody types, so the hull falls on
       * its own as well as when this asks it to. Driving `strike()` a fixed
       * number of times and assuming the count would be a harness describing a
       * ship it is not looking at. Instead: strike until the scene REPORTS the
       * mark count wanted, and read the count back out of the frame's own
       * state so a reading can never be filed under the wrong number.
       */
      await page.evaluate(async (want: number) => {
        const flight = window.__kbFlight;
        if (flight === undefined) return;
        let guard = 0;
        while ((flight.state().hullHits ?? 0) < want && (guard += 1) < 40) {
          flight.strike();
          await new Promise((r) => requestAnimationFrame(() => r(null)));
        }
      }, marks);
      // The mark fades in over 200 ms (`addScorch`); a frame taken during the
      // fade is a frame of a mark that is not fully drawn. This is the ONLY
      // window in which the belt is allowed to move.
      await runFor(page, 320);

      let reading: Reading | null = null;
      for (let retry = 0; retry < 6 && reading === null; retry += 1) {
        const frame = await frozenLuma(page);
        expect(
          frame.state.stalled,
          `${stopId}: the stage stalled at ${frame.state.hullHits} marks, so the ship is mid-dim`,
        ).toBe(false);
        const got = measureShip(frame, scale);
        if ("plated" in got) {
          skipped.push({ stopId, marks, why: "a word plate crossed the ship's core" });
          // Let the plate move on, then freeze again. Bounded, so a plate
          // parked on the ship cannot silently turn into a long free run.
          await runFor(page, 400);
          continue;
        }
        reading = {
          stopId,
          marks: frame.state.hullHits,
          inside: got.inside,
          outside: got.outside,
          separation: got.separation,
          retries: retry,
        };
      }
      expect(
        reading,
        `${stopId}: a word plate sat on the ship's core for every attempt at ${marks} marks`,
      ).not.toBeNull();
      readings.push(reading as Reading);

      /**
       * AND A PICTURE, because AC-22.4 is a number and `R-lantern` is a human.
       *
       * This pass changed what a damaged ship LOOKS like, and a separation of
       * 0.28 does not tell anybody whether nine marks still read as damage.
       * Four crops of the ship at mars, at the mark counts a stage passes
       * through, so the reference compare has something to look at rather than
       * a table.
       */
      if (stopId === "mars" && [0, 3, 6, 8].includes(marks)) {
        await freezeFlight(page);
        await waitFrames(page, 2);
        await page.screenshot({
          path: join(EVIDENCE_DIR, `hull-scorch-mars-${marks}.png`),
          clip: {
            x: box.x + (SHIP.cx - 90) * scale,
            y: box.y + (SHIP.cy - 110) * scale,
            width: 180 * scale,
            height: 200 * scale,
          },
        });
      }
    }

    const end = await flightState(page);
    // THE FIXTURE DID NOT OUTRUN THE GAME, and this is the assertion that keeps
    // the sweep honest about what a shipped stage can reach. The ladder is
    // walked on a long stage so it cannot stall; the marks it walks must still
    // be marks a 58-word belt allows.
    expect(
      Math.max(...readings.filter((r) => r.stopId === stopId).map((r) => r.marks)),
      `${stopId}: the ladder walked past what a shipped stage carries`,
    ).toBeLessThanOrEqual(SHIPPED_HULL_MARKS);
    expect(end.maxHull, `${stopId}: the fixture stage's hull`).toBeGreaterThan(
      SHIPPED_HULL_MARKS,
    );
  }

  const weakest = readings.reduce((a, b) => (b.separation < a.separation ? b : a));
  const byStop = Object.fromEntries(
    BELTED_STOPS.map((stopId) => {
      const at = readings.filter((r) => r.stopId === stopId);
      return [
        stopId,
        {
          curve: at.map((r) => ({
            marks: r.marks,
            inside: r.inside,
            outside: r.outside,
            separation: r.separation,
          })),
          min: Math.min(...at.map((r) => r.separation)),
        },
      ];
    }),
  );

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(
    join(EVIDENCE_DIR, "hull-scorch.json"),
    `${JSON.stringify(
      {
        ticket: "UR-22 / AC-22.4",
        claim:
          "at every belted stop and at every scorch count a shipped 58-word stage can reach, the Lantern's core still separates from the frame immediately around it by more than 0.06 of the 8-bit range",
        measure: "tests/gauntlet/silhouette.mjs measureSilhouettes, the same function and geometry V-22.4 uses",
        bar: 0.06,
        shippedHullMarks: SHIPPED_HULL_MARKS,
        markCountsWalked: [0, MAX_MARKS],
        fixtureStageWords: FIXTURE_STAGE_WORDS,
        stops: BELTED_STOPS,
        byStop,
        weakest,
        minSeparation: Number(weakest.separation.toFixed(4)),
        platedFramesRetried: skipped,
        supersedes:
          "flight.spec.ts's SHIPPED_MAX_HULL of 6, which its own comment derives from a 40-word stage while the shipped stage is 58 words and carries nine marks",
        limitations: [
          "it measures the ship, not the asteroids; V-22.4 owns those",
          "the ninth mark is taken in the same instant the stage stalls, so the ladder stops at eight - the last frame of a flying ship",
        ],
      },
      null,
      2,
    )}\n`,
  );

  // ANTI-VACUITY. A minimum over an empty set is not a minimum.
  expect(readings.length, "readings taken").toBe(BELTED_STOPS.length * (MAX_MARKS + 1));
  for (const stopId of BELTED_STOPS) {
    expect(
      readings.filter((r) => r.stopId === stopId).length,
      `${stopId}: readings contributed`,
    ).toBe(MAX_MARKS + 1);
  }
  // AND THE DAMAGED END IS IN THE SET. A ladder that never got past two marks
  // would report a clean sweep of the states that are not the problem.
  expect(
    Math.max(...readings.map((r) => r.marks)),
    "the deepest damage state measured",
  ).toBeGreaterThanOrEqual(MAX_MARKS);

  // THE BAR IS V-22.4'S, UNCHANGED. 0.06 of the 8-bit range is about 15 levels.
  expect(
    weakest.separation,
    `the hull takes the sky's value: ${JSON.stringify(weakest)}`,
  ).toBeGreaterThan(0.06);
});
