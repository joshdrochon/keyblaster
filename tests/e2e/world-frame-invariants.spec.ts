import { expect, test, type Page } from "@playwright/test";
import {
  blastOneRock,
  bootFlight,
  flightCanvasBox,
  flightState,
  freezeFlight,
  waitFrames,
} from "./support/flightBoot";
import { SHIPS } from "../../src/game/ui/catalog.js";

/**
 * FOUR ACs that describe what the flight frame does, and had no test naming them.
 *
 *   AC-1.1   "Ship x/y do not change during a stage except for shake offsets."
 *   AC-1.2   "Background layers advance every frame at their configured speeds."
 *   AC-24.1  "The beam emitter renders as engineered tech: large lens, iris
 *             aperture that opens on fire, three concentric focusing rings,
 *             finned heat housing, pivot mount that tracks the locked target.
 *             One beam source, no gun barrel."
 *   AC-24.3  "...no text is drawn on the hull and {shipName} renders
 *             dynamically."
 *
 * WHY E2E AND NOT UNIT. All four are properties of Phaser display objects, and
 * a vitest run can only see `src/engine`. So every assertion below is made
 * against the LIVE objects in a real browser - the ship's own container, the
 * parallax stack's containers, the emitter's own draw calls - and never against
 * a number the scene keeps alongside for reporting. `FlightDebugState.layerOffsets`
 * in particular is deliberately unused here: it is a parallel accumulator
 * computed next to `parallax.update()`, so a parallax that stopped dead would
 * leave it climbing and a test reading it would stay green.
 *
 * `tests/e2e/world-frame.spec.ts` is a different file, owned by the art lane.
 * This one does not touch it.
 */

const FLIGHT = "Flight";

/** Handle for the live scene, inside the page. Every evaluate re-fetches it. */
const SCENE = `(() => {
  const game = window.__kbGame;
  if (!game) throw new Error("__kbGame is not published");
  const scene = game.scene.getScene(${JSON.stringify(FLIGHT)});
  if (!scene) throw new Error("the Flight scene is not registered");
  return scene;
})()`;

/**
 * Play the belt: blast every live rock, so an unattended stage cannot stall.
 *
 * Each pass types the word the game LOCKED, which is not necessarily the word
 * we aimed at - the first keystroke resolves the lock across every live rock,
 * and typing at a rock the lock did not choose scores typos and blasts nothing.
 */
async function clearBelt(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api = window.__kbFlight;
    if (!api) return;
    const press = (ch: string): void => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: ch, code: `Key${ch.toUpperCase()}` }),
      );
    };
    for (let i = 0; i < 12; i += 1) {
      const start = api.state();
      const first = start.rocks[0];
      if (first === undefined) break;
      press(first.word[0] as string);
      const locked = api.state();
      const rock = locked.rocks.find((r) => r.id === locked.lockedId);
      if (rock === undefined) break;
      for (const ch of rock.word.slice(locked.typed.length)) press(ch);
    }
  });
}

// ---------------------------------------------------------------------------
// AC-1.1 — the ship does not move
// ---------------------------------------------------------------------------

test("AC-1.1: the ship's x/y never change across a stage, while the camera and the bob do", async ({
  page,
}) => {
  // 600 frames of a PLAYED belt. Headless frame rate drops hard when the suite
  // runs three workers wide, and this test buys its evidence in frames, not in
  // seconds - so the budget is generous on purpose.
  test.setTimeout(420_000);
  // A long stage with a big word budget: the belt is played hard below, and a
  // stage that COMPLETES tears the scene down mid-measurement.
  await bootFlight(page, { seed: 7, stageDurationMs: 300_000, stageWordCount: 500 });

  const sample = (): Promise<{
    ships: number;
    shipX: number;
    shipY: number;
    bobY: number;
    camX: number;
    camY: number;
  }> =>
    page.evaluate(`(() => {
      const scene = ${SCENE};
      const containers = scene.shipLayer.list.filter((o) => o.type === "Container");
      const root = containers[0];
      return {
        ships: containers.length,
        shipX: root.x,
        shipY: root.y,
        bobY: scene.shipBody.y,
        camX: scene.cameras.main.scrollX,
        camY: scene.cameras.main.scrollY,
      };
    })()`) as Promise<ReturnType<typeof sample> extends Promise<infer T> ? T : never>;

  const first = await sample();
  // Found by shape, not by index: a new sibling on the ship layer must not
  // silently re-point this test at a different object.
  expect(first.ships, "expected exactly one ship container on the ship layer").toBe(1);

  const seen = [first];
  // 600 frames, in twenty-four blocks, with a hull strike partway: shake is the
  // one thing the AC exempts, so the test has to actually cause some. The belt
  // is PLAYED throughout - an unplayed belt stalls after a few hull hits, and a
  // stalled ship sputters and SINKS (D29), which is not "during a stage".
  for (let block = 0; block < 24; block += 1) {
    if (block === 8) await page.evaluate(() => window.__kbFlight?.strike());
    await clearBelt(page);
    await waitFrames(page, 25);
    if (block % 4 === 3) seen.push(await sample());
  }

  for (const s of seen) {
    expect(s.shipX, "the ship moved in x during the stage").toBe(first.shipX);
    expect(s.shipY, "the ship moved in y during the stage").toBe(first.shipY);
  }

  // The controls. Without them this passes on a frozen game, on a scene that
  // failed to build, and on a ship that was never drawn at all.
  expect(
    seen.some((s) => s.camX !== first.camX || s.camY !== first.camY),
    "the camera never moved, so 'the ship did not' proves nothing",
  ).toBe(true);
  expect(
    seen.some((s) => s.bobY !== first.bobY),
    "the idle bob never ran, so the ship was not alive at all",
  ).toBe(true);

  const state = await flightState(page);
  expect(state.stalled, "the stage stalled, so these frames are not a stage").toBe(false);
});

// ---------------------------------------------------------------------------
// AC-1.2 — the background advances at its configured speeds
// ---------------------------------------------------------------------------

interface LayerSample {
  worldSpeed: number;
  height: number;
  elapsedMs: number;
  at: number;
  layers: { id: string; speed: number; y: number }[];
}

test("AC-1.2: every background layer advances each frame, in proportion to its configured speed", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await bootFlight(page, { seed: 7, stageDurationMs: 120_000 });

  /** The REAL containers the stack scrolls, and the speed each was built with. */
  const read = (): Promise<LayerSample> =>
    page.evaluate(`(() => {
      const scene = ${SCENE};
      return {
        worldSpeed: scene.cfg.worldSpeedPxPerSec,
        height: scene.scale.height,
        elapsedMs: scene.parallax.debugMotion().elapsedMs,
        at: performance.now(),
        layers: scene.parallax.layers.map((l) => ({
          id: l.spec.id, speed: l.spec.speed, y: l.container.y,
        })),
      };
    })()`) as Promise<LayerSample>;

  const before = await read();
  expect(before.layers.length, "the parallax stack was never built").toBeGreaterThanOrEqual(5);
  expect(before.worldSpeed, "world speed 0 freezes scrolling; nothing to measure").toBeGreaterThan(0);

  await waitFrames(page, 60);
  const after = await read();

  const H = before.height; // the stack wraps its containers modulo the stage height
  const advanced = new Map<string, number>();
  for (const b of before.layers) {
    const a = after.layers.find((l) => l.id === b.id)!;
    // Wrap-safe: a container that crossed a tile boundary reads lower, not back.
    advanced.set(b.id, (((a.y - b.y) % H) + H) % H);
  }

  // `shipFx` carries speed 1.00 and does NOT translate: art-direction L6 fixes
  // the ship, and its speed describes the plane it shares with the debris
  // (which is AC-1.1's other half). So the three roles are named here, and the
  // last assertion in this block makes a new layer that belongs to none of them
  // fail rather than quietly escape the test.
  const SCROLLING_IDS = ["celestial", "farField", "midField", "debris", "nearField", "foreVeil"];
  const PINNED_IDS = ["sky", "hud"];
  const FIXED_IDS = ["shipFx"];
  expect(
    [...SCROLLING_IDS, ...PINNED_IDS, ...FIXED_IDS].sort(),
    "a layer was added or renamed; this test has not been told what it should do",
  ).toEqual(before.layers.map((l) => l.id).sort());

  const scrolling = before.layers.filter((l) => SCROLLING_IDS.includes(l.id));
  const pinned = before.layers.filter((l) => PINNED_IDS.includes(l.id));
  expect(scrolling.length, "fewer than five scrolling layers").toBeGreaterThanOrEqual(5);
  for (const l of scrolling) {
    expect(l.speed, `scrolling layer ${l.id} is configured at speed 0`).toBeGreaterThan(0);
  }

  // 1. EVERY scrolling layer moved. Not "the stack moved".
  for (const l of scrolling) {
    expect(advanced.get(l.id)!, `layer ${l.id} (speed ${l.speed}) did not advance`).toBeGreaterThan(0);
  }

  // 2. A pinned layer stays pinned. `sky` is speed 0 by the art direction, and
  //    a stack that scrolled it would still pass check 1.
  for (const l of pinned) {
    const a = after.layers.find((x) => x.id === l.id)!;
    expect(a.y, `pinned layer ${l.id} scrolled`).toBe(l.y);
  }

  // 3. AT THEIR CONFIGURED SPEEDS. Each layer's travel, relative to one chosen
  //    layer's, must be the ratio of the two speeds in `render/layers.ts`.
  //    Ratios rather than absolute px/s because every layer shares one `dt`:
  //    a dropped frame slows all of them equally and cancels out, so this stays
  //    tight where an absolute check would have to be loose enough to pass a
  //    stack running at half speed.
  const ref = scrolling[0]!;
  const refMoved = advanced.get(ref.id)!;
  for (const l of scrolling.slice(1)) {
    const observed = advanced.get(l.id)! / refMoved;
    const configured = l.speed / ref.speed;
    expect(
      Math.abs(observed - configured) / configured,
      `layer ${l.id} travelled ${observed.toFixed(3)}x the ${ref.id} layer, but is configured at ${configured.toFixed(3)}x`,
    ).toBeLessThan(0.03);
  }

  // 4. And the absolute rate, so a stack whose every layer was scaled by one
  //    wrong factor is caught as well as one whose layers drifted apart.
  //
  //    Measured against the stack's SIMULATED clock, not the wall clock. The
  //    stack clamps each frame's delta to 64 ms (a tab-restore spike must not
  //    teleport the world), so under a loaded CI box wall-clock px/s measures
  //    the frame rate, not the layer: this same check against `performance.now`
  //    read 0.19 px/s against a configured 5.5 on a three-worker run. The
  //    elapsed here is accumulated by the stack in the same `update` that moves
  //    the layers, so it is honest about how much world time actually passed
  //    and still cannot hide a wrong SPEED, which is what the AC is about.
  const simSec = (after.elapsedMs - before.elapsedMs) / 1000;
  expect(simSec, "no world time passed at all").toBeGreaterThan(0.1);
  const observedPxPerSec = refMoved / simSec;
  const configuredPxPerSec = ref.speed * before.worldSpeed;
  expect(observedPxPerSec).toBeGreaterThan(configuredPxPerSec * 0.9);
  expect(observedPxPerSec).toBeLessThan(configuredPxPerSec * 1.1);
});

// ---------------------------------------------------------------------------
// AC-24.1 — the emitter is engineered tech, and it tracks
// ---------------------------------------------------------------------------

interface DrawOp {
  op: string;
  args: number[];
}

/**
 * Record what the SHARED Lantern actually draws, tagged by which display object
 * each call landed on.
 *
 * WHY NOT A FAKE GRAPHICS. This test used to hand `FlightScene.drawEmitter` a
 * recording Proxy - which was a faithful reading of a method that should never
 * have existed. The flight screen carried a private second Lantern in hardcoded
 * hex, so this test was measuring the emitter of a ship `R-lantern` had never
 * judged while the item claiming "exactly one drawLantern implementation" was
 * green (docs/verification-gaps.md instance 23).
 *
 * There is now one implementation and it has no entry point that takes a
 * Graphics, so the recorder goes one level down: `Phaser.GameObjects.Graphics`'
 * own methods are wrapped, a real rig is built off screen, and every call is
 * attributed to the object it was made on. That is strictly closer to the
 * product than a replayed draw function - it records the REAL construction
 * path, including anything drawn by a helper this test has never heard of.
 */
const EMITTER_OPS = `(async () => {
  const scene = ${SCENE};
  const probe = scene.add.graphics();
  const Proto = Object.getPrototypeOf(probe);
  probe.destroy();
  const OPS = ["fillCircle", "strokeCircle", "fillRect", "fillRoundedRect", "fillEllipse", "lineBetween"];
  const originals = {};
  const calls = [];
  let nextId = 1;
  let inside = false;
  for (const op of OPS) {
    originals[op] = Proto[op];
    Proto[op] = function (...args) {
      if (this.__recId === undefined) this.__recId = nextId++;
      if (!inside) {
        inside = true;
        calls.push({ id: this.__recId, op, args: args.filter((a) => typeof a === "number") });
        inside = false;
      }
      return originals[op].apply(this, args);
    };
  }
  let rig;
  try {
    const mod = await import("/src/game/render/lantern.ts");
    // Off screen, and with the flight screen's own options, so this is the
    // object the player flies rather than a differently-configured cousin.
    rig = mod.drawLantern(scene, -6000, -6000, { beam: false, exhaust: false, idleBob: false, iris: 0 });
  } finally {
    for (const op of OPS) Proto[op] = originals[op];
  }
  const ids = new Set();
  const walk = (o) => {
    if (o && o.__recId !== undefined) ids.add(o.__recId);
    for (const child of (o && o.list) || []) walk(child);
  };
  walk(rig.emitterMount);
  const emitter = calls.filter((c) => ids.has(c.id));
  const body = calls.filter((c) => !ids.has(c.id));
  rig.destroy();
  return { emitter, body };
})()`;

test("AC-24.1: the emitter draws a lens, three concentric focusing rings, a finned housing and a pivot mount", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await bootFlight(page, { seed: 7 });

  const { emitter, body } = (await page.evaluate(EMITTER_OPS)) as {
    emitter: DrawOp[];
    body: DrawOp[];
  };

  expect(emitter.length, "the emitter drew nothing").toBeGreaterThan(0);

  // THREE CONCENTRIC FOCUSING RINGS, PLUS THE LENS THEY FOCUS.
  // Grouped by centre rather than counted, because "three rings" is a statement
  // about concentricity: three discs at three centres are three lamps.
  const discs = emitter.filter((o) => o.op === "fillCircle");
  const byCentre = new Map<string, number[]>();
  for (const d of discs) {
    const key = `${d.args[0]},${d.args[1]}`;
    byCentre.set(key, [...(byCentre.get(key) ?? []), d.args[2]!]);
  }
  const stacks = [...byCentre.entries()].filter(([, radii]) => new Set(radii).size >= 3);

  // ONE BEAM SOURCE, NO SECOND MUZZLE: exactly one concentric stack.
  expect(stacks.length, "expected exactly one lens assembly - one beam source, no second muzzle").toBe(
    1,
  );
  const [lensCentre, radii] = stacks[0]!;
  const distinct = [...new Set(radii)].sort((a, b) => a - b);
  expect(
    distinct.length,
    "the lens assembly has fewer than four steps, so it cannot carry three focusing rings and a lens",
  ).toBeGreaterThanOrEqual(4);

  // FINNED HEAT HOUSING: a rounded housing body plus parallel fins across it.
  const housings = emitter.filter((o) => o.op === "fillRoundedRect");
  const fins = emitter.filter((o) => o.op === "fillRect");
  expect(housings.length, "no heat housing is drawn").toBeGreaterThanOrEqual(1);
  expect(fins.length, "the heat housing has no fins").toBeGreaterThanOrEqual(3);
  expect(
    new Set(fins.map((f) => f.args[0])).size,
    "the fins are all at one x, so they are one fin drawn several times",
  ).toBe(fins.length);
  expect(
    new Set(fins.map((f) => f.args[2])).size,
    "the fins are not the same width, so they are not a machined set",
  ).toBe(1);

  // THE HOUSING IS MOUNTED BELOW THE HEAD - the instrument sits ON something.
  const lensY = Number(lensCentre.split(",")[1]);
  expect(
    Math.max(...housings.map((h) => h.args[1]!)),
    "the heat housing is not below the emitter head",
  ).toBeGreaterThan(lensY);

  // PIVOT MOUNT: the fixed collar is drawn on the BODY (it does not rotate with
  // the head), between the lens and the hull. A head with no mount is glued on.
  const collar = body.filter((o) => o.op === "fillCircle" && o.args[1]! < -100);
  expect(collar.length, "the emitter has no pivot boss, so it is glued to the nose").toBeGreaterThan(
    0,
  );
});

test("AC-24.1: the iris opens when the ship fires, and closes again", async ({ page }) => {
  test.setTimeout(120_000);
  await bootFlight(page, { seed: 7, knobs: { maxLive: 2 } });

  // Record what the REAL fire path asks the iris for, rather than calling the
  // draw function ourselves with two numbers and comparing them.
  await page.evaluate(`(() => {
    const scene = ${SCENE};
    // The SHARED rig's own aperture. Flight no longer owns a drawIris - there is
    // one Lantern, and this records what the real fire path asks it for.
    const rig = scene.lantern;
    const original = rig.setIris.bind(rig);
    scene.__irisLog = [];
    rig.setIris = (open) => { scene.__irisLog.push(open); original(open); };
  })()`);

  /**
   * `blastOneRock` rather than a hand-rolled read-then-type.
   *
   * This used to read the board, take `rocks[0].word[0]`, and dispatch it a
   * round trip later. The belt holds ONE rock and it spends part of its life
   * above the frame, so by the time the keystroke landed the board could hold a
   * different rock with a different first letter: the press became a typo,
   * nothing locked, and the loop after it typed an empty string. The spec then
   * reported "nothing was blasted, so the ship never fired" - which was true,
   * and was a fact about the harness.
   *
   * The helper waits for a blastable rock (on the thing, never on a clock),
   * types the whole word inside one task so nothing can go stale between the
   * lock and the letters, and waits for `hits` to actually move. If no rock ever
   * arrives it throws with what the belt was doing rather than skipping.
   */
  await blastOneRock(page);

  const log = (await page.evaluate(`${SCENE}.__irisLog`)) as number[];
  expect(log.length, "firing never touched the iris").toBeGreaterThan(0);
  expect(Math.max(...log), "the iris never opened on fire").toBe(1);
  expect(Math.min(...log), "the iris never closed again after firing").toBe(0);
});

/**
 * One lock per page, deliberately. Locking a second rock means first clearing
 * the first, and a blast changes the belt, the stage count and the park grace -
 * three things that have nothing to do with where the emitter points. A fresh
 * boot per direction costs half a minute and measures only the aiming.
 */
async function aimedRotation(page: Page, x: number, word: string): Promise<number> {
  await bootFlight(page, { seed: 7, knobs: { maxLive: 2 }, stageDurationMs: 300_000, stageWordCount: 500 });

  const resting = (await page.evaluate(`${SCENE}.emitterHead.rotation`)) as number;
  expect(Math.abs(resting), "the emitter did not start centred").toBeLessThan(0.05);

  const press = (ch: string): Promise<void> =>
    page.evaluate((c) => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: c, code: `Key${c.toUpperCase()}` }),
      );
    }, ch);

  const locked = (await page.evaluate(
    ([w, px]) => {
      const api = window.__kbFlight!;
      api.spawn(w as string, { x: px as number, y: 40 });
      const mine = api.state().rocks.filter((r) => r.word === w).pop();
      const first = (w as string)[0]!;
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: first, code: `Key${first.toUpperCase()}` }),
      );
      return { wanted: mine?.id ?? null, got: api.state().lockedId };
    },
    [word, x] as const,
  )) as { wanted: string | null; got: string | null };

  expect(locked.wanted, `the "${word}" rock was never spawned`).not.toBeNull();
  // The word starts with a letter no pool word starts with, so the lock cannot
  // resolve to another rock - asserted rather than assumed.
  expect(locked.got, `pressing "${word[0]}" did not lock the rock we placed`).toBe(locked.wanted);

  // Sample while the lock is HELD, and keep it held by carrying on typing the
  // word one letter at a time. An untouched lock PARKS after ~1.5 inter-key
  // intervals (D24) and the head eases back to centre, so a single read taken a
  // moment too late reports ~0 and says nothing at all about tracking.
  let peak = 0;
  for (const ch of word.slice(1, -1)) {
    await waitFrames(page, 4);
    const now = (await page.evaluate(
      `(() => { const s = ${SCENE}; return { r: s.emitterHead.rotation, locked: s.lock.lockedId }; })()`,
    )) as { r: number; locked: string | null };
    if (now.locked === locked.wanted && Math.abs(now.r) > Math.abs(peak)) peak = now.r;
    await press(ch);
  }
  return peak;
}

test("AC-24.1: the emitter pivots toward a target on the left", async ({ page }) => {
  test.setTimeout(180_000);
  const left = await aimedRotation(page, 200, "zyxwvutsrqpon");
  expect(left, "the emitter did not swing toward a target on the left").toBeLessThan(-0.05);
  // "A head that spins is a turret, not a lamp": the swing is clamped.
  expect(Math.abs(left)).toBeLessThanOrEqual(0.7);
});

test("AC-24.1: the emitter pivots toward a target on the right", async ({ page }) => {
  test.setTimeout(180_000);
  const right = await aimedRotation(page, 1700, "zyxwvutsrqpon");
  expect(right, "the emitter did not swing toward a target on the right").toBeGreaterThan(0.05);
  expect(Math.abs(right)).toBeLessThanOrEqual(0.7);
});

// ---------------------------------------------------------------------------
// AC-24.3 — no text on the hull; the name is drawn dynamically or not at all
// ---------------------------------------------------------------------------

test("AC-24.3: no text is drawn on the hull, and a ship name is a dynamic decal, never baked art", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await bootFlight(page, { seed: 7 });

  // 1. Nothing in the flown ship's object tree is text.
  const shipText = (await page.evaluate(`(() => {
    const scene = ${SCENE};
    const found = [];
    const walk = (o) => {
      if (o && o.type === "Text") found.push(o.text ?? "");
      for (const child of (o && o.list) || []) walk(child);
    };
    for (const child of scene.shipLayer.list) walk(child);
    return found;
  })()`)) as string[];
  expect(shipText, "text is drawn on the hull").toEqual([]);

  /**
   * 2. THE SHIP ON SCREEN IS THE SHIP THE RUBRIC JUDGES.
   *
   * This used to ask `FlightScene.drawLantern` - a PRIVATE SECOND LANTERN in
   * hardcoded hex - whether it drew any text, and it did not, and that was a
   * true answer about the wrong object (docs/verification-gaps.md instance 23).
   * `R-lantern` judges `render/lantern.ts`; the flight screen drew something
   * else; so the one visual item a human signs off did not cover the object a
   * child looks at for the entire game.
   *
   * The assertion that closes that is not "no text" - it is that the flown ship
   * and the judged drawing are the SAME CONSTRUCTION. Built with the flight
   * screen's own options and compared as a shape of display types: if the scene
   * ever grows a second ship, or stops routing through this module, the two
   * trees stop matching and this goes red naming both.
   */
  const same = (await page.evaluate(`(async () => {
    const scene = ${SCENE};
    const shape = (o) => {
      const kids = ((o && o.list) || []).map(shape);
      return (o ? o.type : "?") + (kids.length ? "(" + kids.join(",") + ")" : "");
    };
    const mod = await import("/src/game/render/lantern.ts");
    const reference = mod.drawLantern(scene, -6000, -6000, {
      beam: false, exhaust: true, idleBob: false, iris: 0,
    });
    const result = { flown: shape(scene.lantern.container), judged: shape(reference.container) };
    reference.destroy();
    return result;
  })()`)) as { flown: string; judged: string };

  expect(
    same.flown,
    "the flown ship is not the drawing R-lantern judges - see verification-gaps instance 23",
  ).toBe(same.judged);

  // 3. The shared Lantern carries the name DYNAMICALLY: the decal exists only
  //    when a name is passed, and it reads back the name it was given. That is
  //    the difference between "{shipName} renders" and a hull with a word on it.
  const decal = (await page.evaluate(`(async () => {
    const scene = ${SCENE};
    const mod = await import("/src/game/render/lantern.ts");
    const textsIn = (rig) => {
      const out = [];
      const walk = (o) => {
        if (o && o.type === "Text") out.push(o.text);
        for (const child of (o && o.list) || []) walk(child);
      };
      walk(rig.container);
      return out;
    };
    const bare = mod.drawLantern(scene, -6000, -6000, { beam: false, exhaust: false, idleBob: false });
    const named = mod.drawLantern(scene, -6200, -6000, { beam: false, exhaust: false, idleBob: false, shipName: "Nomad" });
    const result = { bare: textsIn(bare), named: textsIn(named), colorways: mod.LANTERN_COLORWAYS.length };
    bare.destroy();
    named.destroy();
    return result;
  })()`)) as { bare: string[]; named: string[]; colorways: number };

  expect(decal.bare, "the hull art ships with a name baked into it").toEqual([]);
  expect(decal.named, "a ship name passed in did not render").toEqual(["Nomad"]);
  expect(decal.colorways, "AC-24.3: the reference's four colourways are not four ships").toBe(4);
});

// ---------------------------------------------------------------------------
// AC-6d.1b / D79 — the hull the child chose is the hull the child flies
// ---------------------------------------------------------------------------

/**
 * How many pixels of each given colour are on screen around the ship.
 *
 * ================== WHY NOT A BYTE COMPARISON OF TWO FRAMES ==================
 * That is what this was, and it FAILED ITS OWN CONTROL in the first whole-suite
 * run: two boots of the SAME hull did not produce identical bytes at 3 workers.
 * The control was right and the measurement was wrong. A frozen flight frame is
 * only deterministic in the ship; everything around it is not. The sky TRAVELS
 * on the wall clock (AC-22.3), rocks fall on it, and the plume and lens tweens
 * are at whatever phase they had reached when the scene paused - all of which
 * move with machine load and none of which is the ship.
 *
 * Byte equality was therefore measuring "the ship plus the moment", which is
 * docs/verification-gaps.md instance 14 almost exactly: a probe that samples a
 * moving world and reports whatever it lands on, in both directions.
 *
 * COUNTING A COLOUR is insensitive to every one of those. The hull's livery
 * band is drawn flat at full alpha, so the chosen stripe is either on the
 * screen or it is not, whatever the sky is doing behind it.
 */
async function stripeCounts(
  page: Page,
  shipId: string,
  targets: readonly string[],
): Promise<number[]> {
  await bootFlight(page, { seed: 7, stopId: "mars", shipId, reducedMotion: true });
  await waitFrames(page, 20);
  await freezeFlight(page, true);
  // A paused scene still RENDERS, but the compositor can hand back a frame
  // captured before the pause landed.
  await waitFrames(page, 2);
  const box = await flightCanvasBox(page);
  const design = await page.evaluate(() => {
    const g = window.__kbGame as unknown as { scale: { width: number; height: number } };
    return { w: g.scale.width, h: g.scale.height };
  });
  const sx = box.width / design.w;
  const sy = box.height / design.h;
  const shot = (
    await page.screenshot({
      clip: {
        x: box.x + (design.w / 2) * sx - 40 * sx,
        y: box.y + (design.h - 150) * sy - 60 * sy,
        width: 80 * sx,
        height: 110 * sy,
      },
    })
  ).toString("base64");

  return page.evaluate(
    async ([data, hexes]: readonly [string, readonly string[]]) => {
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = `data:image/png;base64,${data}`;
      });
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d");
      if (g === null) throw new Error("no 2d context");
      g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, c.width, c.height).data;
      const want = hexes.map((h) => [
        parseInt(h.slice(1, 3), 16),
        parseInt(h.slice(3, 5), 16),
        parseInt(h.slice(5, 7), 16),
      ]);
      const counts = want.map(() => 0);
      for (let i = 0; i < px.length; i += 4) {
        for (let k = 0; k < want.length; k += 1) {
          const t = want[k] as number[];
          if (
            Math.abs((px[i] ?? 0) - (t[0] as number)) <= 8 &&
            Math.abs((px[i + 1] ?? 0) - (t[1] as number)) <= 8 &&
            Math.abs((px[i + 2] ?? 0) - (t[2] as number)) <= 8
          ) {
            counts[k] = (counts[k] as number) + 1;
          }
        }
      }
      return counts;
    },
    [shot, targets] as const,
  );
}

test("AC-6d.1b: the profile's shipId reaches the flown ship, and a different hull is a different ship", async ({
  page,
}) => {
  test.setTimeout(180_000);

  // 1. THE BINDING. The scene reports the hull it DREW WITH - `livery` is the
  //    same object handed to render/lantern.ts, not a second copy computed
  //    beside it - so this is the catalogue entry arriving at the drawing.
  await bootFlight(page, { seed: 7, stopId: "mars", shipId: "ship-2" });
  const chosen = await flightState(page);
  expect(chosen.shipId, "the flight screen ignored the ship it was given").toBe("ship-2");
  expect(
    chosen.livery,
    "the ship was drawn in colours that are not the chosen hull's",
  ).toEqual(SHIPS.find((s) => s.id === "ship-2")?.colors);

  /**
   * 2. AND IT REACHES THE PIXELS.
   *
   * A field on a debug state proves the scene KNOWS which ship it is flying. It
   * proves nothing about what is on screen - which is the entire lesson of
   * docs/verification-gaps.md, and precisely how `profile.shipId` came to be
   * chosen, persisted, migrated and drawn by nothing.
   *
   * SHIP-2 AND SHIP-3, each the other's control. Their stripes are a blue and a
   * violet, so neither can be confused with the other and neither occurs in a
   * Mars sky. Ship-1's coral would have been a bad choice for exactly that
   * reason - a rust-coloured sky is full of near-coral pixels.
   *
   * MEASURED, and the bar is a fifth of the smaller reading rather than a
   * number that happened to work:
   *
   *     flying ship-2:   blue 310   violet   0
   *     flying ship-3:   blue   0   violet 318
   *
   * WATCHED FAILING. Hand `drawLantern` a constant livery while leaving the
   * scene's reported `livery` correct - the state assertion above still passes -
   * and this reads `ship-2 frame [blue 0, violet 0], ship-3 frame [blue 0,
   * violet 0]` and goes red. That is the half of this test that is about the
   * screen rather than about what the scene believes.
   */
  const blue = SHIPS.find((s) => s.id === "ship-2")!.colors.stripe;
  const violet = SHIPS.find((s) => s.id === "ship-3")!.colors.stripe;

  const flyingTwo = await stripeCounts(page, "ship-2", [blue, violet]);
  const flyingThree = await stripeCounts(page, "ship-3", [blue, violet]);

  const detail = `ship-2 frame [blue ${flyingTwo[0]}, violet ${flyingTwo[1]}], ship-3 frame [blue ${flyingThree[0]}, violet ${flyingThree[1]}]`;

  expect(flyingTwo[0], `ship-2's own stripe is not on screen: ${detail}`).toBeGreaterThan(200);
  expect(flyingThree[1], `ship-3's own stripe is not on screen: ${detail}`).toBeGreaterThan(200);
  // The control half: flying one hull must not put the OTHER hull's colour up.
  expect(
    flyingTwo[1],
    `ship-3's stripe is on screen while flying ship-2: ${detail}`,
  ).toBeLessThan((flyingTwo[0] as number) / 20);
  expect(
    flyingThree[0],
    `ship-2's stripe is on screen while flying ship-3: ${detail}`,
  ).toBeLessThan((flyingThree[1] as number) / 20);
});
