import { expect, test, type Page } from "@playwright/test";
import { bootFlight, flightState, waitFrames } from "./support/flightBoot";

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

/** Record every call made on a fake Graphics, so a draw can be read back. */
const RECORDER = `(() => {
  const calls = [];
  const rec = new Proxy({}, {
    get: (_t, name) => (...args) => {
      calls.push({ op: String(name), args: args.filter((a) => typeof a === "number") });
      return rec;
    },
  });
  return { rec, calls };
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

test("AC-24.1: the emitter draws a lens, three concentric focusing rings, a finned housing and a pivot mount", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await bootFlight(page, { seed: 7 });

  // The emitter is drawn by one method into one Graphics, and a Phaser Graphics
  // keeps no display list - there is nothing to read back off the real one. So
  // the real draw method is handed a RECORDING graphics and asked what it drew.
  const ops = (await page.evaluate(`(() => {
    const scene = ${SCENE};
    const { rec, calls } = ${RECORDER};
    scene.drawEmitter(rec);
    return calls;
  })()`)) as DrawOp[];

  expect(ops.length, "the emitter drew nothing").toBeGreaterThan(0);

  const circles = ops.filter((o) => o.op === "strokeCircle");
  const fills = ops.filter((o) => o.op === "fillCircle");
  const rects = ops.filter((o) => o.op === "fillRoundedRect");
  const lines = ops.filter((o) => o.op === "lineBetween");

  // THREE CONCENTRIC FOCUSING RINGS.
  expect(circles.length, "the emitter does not draw three focusing rings").toBe(3);
  const centres = new Set(circles.map((c) => `${c.args[0]},${c.args[1]}`));
  expect(centres.size, "the three rings are not concentric").toBe(1);
  const radii = circles.map((c) => c.args[2]!).sort((a, b) => a - b);
  expect(new Set(radii).size, "the rings share a radius, so they are one ring drawn thrice").toBe(3);

  // ONE LARGE LENS, at the rings' centre, inside the innermost ring.
  expect(fills.length, "expected exactly one lens - one beam source, no second muzzle").toBe(1);
  const lens = fills[0]!;
  expect(`${lens.args[0]},${lens.args[1]}`, "the lens is not at the focusing rings' centre").toBe(
    [...centres][0],
  );
  expect(lens.args[2]!, "the lens is not inside the innermost ring").toBeLessThan(radii[0]!);

  // FINNED HEAT HOUSING: a housing body plus parallel vertical fins across it.
  expect(rects.length, "no housing and no pivot mount are drawn").toBeGreaterThanOrEqual(2);
  expect(lines.length, "the heat housing has no fins").toBeGreaterThanOrEqual(3);
  expect(new Set(lines.map((l) => l.args[0])).size, "the fins are all at one x, so they are one line").toBe(
    lines.length,
  );
  for (const l of lines) {
    expect(l.args[0], "a fin is not vertical, so it is not a fin").toBe(l.args[2]);
  }

  // PIVOT MOUNT: it sits BELOW the head, i.e. the head is mounted on it.
  const ringY = circles[0]!.args[1]!;
  expect(Math.max(...rects.map((r) => r.args[1]!)), "the mount is not below the emitter head").toBeGreaterThan(
    ringY,
  );
});

test("AC-24.1: the iris opens when the ship fires, and closes again", async ({ page }) => {
  test.setTimeout(120_000);
  await bootFlight(page, { seed: 7, knobs: { maxLive: 2 } });

  // Record what the REAL fire path asks the iris for, rather than calling the
  // draw function ourselves with two numbers and comparing them.
  await page.evaluate(`(() => {
    const scene = ${SCENE};
    const original = scene.drawIris.bind(scene);
    scene.__irisLog = [];
    scene.drawIris = (g, open) => { scene.__irisLog.push(open); original(g, open); };
  })()`);

  // Type the word the game LOCKED, not the word we picked: the first keystroke
  // resolves the lock among every live rock, and typing at a rock the lock did
  // not choose produces typos and no blast.
  const before = await flightState(page);
  await page.evaluate((first) => {
    const press = (ch: string): void => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: ch, code: `Key${ch.toUpperCase()}` }),
      );
    };
    press(first);
    const api = window.__kbFlight!;
    const state = api.state();
    const locked = state.rocks.find((r) => r.id === state.lockedId);
    for (const ch of (locked?.word ?? "").slice(state.typed.length)) press(ch);
  }, before.rocks[0]!.word[0]!);
  await waitFrames(page, 90);

  const after = await flightState(page);
  expect(after.hits, "nothing was blasted, so the ship never fired").toBeGreaterThan(0);

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

  // 2. The hull ART draws no text either, asked of the draw method itself.
  const textCalls = (await page.evaluate(`(() => {
    const scene = ${SCENE};
    const { rec, calls } = ${RECORDER};
    scene.drawLantern(rec);
    return calls.filter((c) => c.op.toLowerCase().includes("text")).length;
  })()`)) as number;
  expect(textCalls, "the hull art draws text").toBe(0);

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
