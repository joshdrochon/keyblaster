import { expect, test, type Page } from "@playwright/test";
import { freezeReloads } from "./support/lane.js";

/**
 * UR-50.5 / UR-14: NOTHING IN THE SKY TRAVELS SIDEWAYS, ON ANY SCREEN.
 *
 * ================== THE DEFECT, REPORTED TWICE ==================
 * UR-14, from play on the Title: the stars must not move with the parallax -
 * they should hold still and twinkle slowly, each on its own interval. Fixed -
 * `render/starField.ts` pins the field to the `sky` container, which never
 * scrolls or sways.
 *
 * UR-50.5, from play on the Briefing, months later: the stars in the window
 * still travel left to right.
 *
 * Both reports were right and the first fix was not wrong, because the
 * travelling objects were never the starfield. They are the decorative debris
 * planes, and `DRIFT_X` gives each a px/s FLOOR that runs at any world speed.
 * A pale far-field speck crossing a window at 5 px/s is a travelling star to
 * anyone not reading the source.
 *
 * ================== HOW THIS MEASURES IT ==================
 * IT STEPS THE WORLD BY HAND rather than waiting on a clock. Under three
 * Playwright workers this machine renders the briefing at about two frames a
 * second, so the first three attempts at this measurement sampled two frames
 * 4 s apart, found them identical, and would have certified the defect as
 * fixed. `scene.update(t, dt)` is public on every screen here and drives the
 * parallax directly, so 1200 x 16 ms is a deterministic 19.2 s of world in
 * whatever wall time the machine can spare. Standards rule 6: wait for the
 * thing, never for a clock - and where you cannot wait for it, drive it.
 *
 * THE DISTINCTION IT DRAWS is between breathing and travelling, because the
 * frame must keep moving (AC-22.2: two frames a second apart differ by >2% of
 * pixels) while nothing crosses it. Those look the same in one sample and are
 * told apart by doubling the clock:
 *
 *   BREATHING  `cameraSwayPx` +/-2 px on a 6 s sine, `idleDriftPx` +/-speed*6
 *              on a 12 s sine. Bounded: 10x the world time does not grow it.
 *   TRAVELLING `p.offset = mod(p.offset + rate * dt, W)`. Linear: 10x the
 *              world time is 10x the distance.
 *
 * ================== THE NEGATIVE CONTROL, MEASURED ==================
 * Run against the shipped Briefing (no `worldSpeed`, no `crossDrift: false`),
 * three nested drift planes travelled, and the numbers are `DRIFT_X` exactly:
 *
 *              1.92 s of world     19.2 s of world
 *   farField        +9.60 px            +96.0 px     (+5 px/s)
 *   midField       -15.36 px           -153.6 px     (-8 px/s)
 *   nearField      +21.12 px           +211.2 px     (+11 px/s)
 *   maxDy            0                    0          <- nothing ever fell
 *
 * Ten times the clock, ten times the distance: travel, not breathing. 211 px
 * is a quarter of the way across an 812 px window. After the fix the same
 * measurement gives `nestedMoved: 0` and a maxDx that goes DOWN from 12.02 to
 * 3.65 as the clock grows, which is a sine coming back round.
 *
 * Watch it fail: drop `crossDrift: false` from any scene below.
 *
 * The companion guard is `tests/unit/arch/noCrossDrift.test.ts`, and it is the
 * one that covers the screen nobody has written yet: this file can only visit
 * screens that exist, so it proves the mechanism while the source sweep proves
 * the coverage.
 *
 * ================== AND THEN IT CAME BACK A THIRD TIME ==================
 * Everything above this line is round two and all of it still holds. None of it
 * caught round three, which was a third mechanism again - a `TileSprite`
 * scrolling its own texture, which moves no object and so was invisible to a
 * walker that recorded Container positions. The shared rule, the sweep over
 * every screen that draws star-like light, and the numbers it was watched
 * failing at are in the last describe block of this file.
 */

/**
 * The widest a layer root may legitimately swing sideways, from `layers.ts`.
 *
 * `idleDriftPx` is a sine of amplitude `speed * 6` and `cameraSwayPx` one of
 * `2 * (0.25 + speed)`. The fastest layer is `foreVeil` at speed 1.8, so the
 * amplitude is 10.8 + 4.1 = 14.9 and a measurement taken between two arbitrary
 * phases can be up to twice that. Anything past it is not breathing.
 */
const SWAY_PEAK_TO_PEAK = 29.8;

/** Every screen that builds a world and has no gameplay lane. Flight is not here. */
const SCREENS = [
  "Title",
  "Briefing",
  "Preflight",
  "DirectorMap",
  "EarthActivation",
  "Warp",
  "Results",
  "Beacon",
  "Ending",
] as const;

interface Motion {
  worldSec: number;
  containers: number;
  /** Sub-planes of a layer. These are the ones that march; they must not. */
  nestedMoved: number;
  nested: { path: string; dx: number; dy: number }[];
  maxDx: number;
  maxDy: number;
  /**
   * TEXTURE-SPACE TRAVEL, AND WHY IT IS HERE NOW (UR-14, third report).
   *
   * Everything above this line measures `x` and `y` on a Container. That is a
   * complete description of ONE way a drawn thing can cross the frame, and the
   * report came back a third time because there is another: a `TileSprite`
   * scrolls its texture under a quad that never moves. Its `x` and `y` are
   * constant forever while its content marches, and the walker above did not
   * even record it - it skipped every node whose `type` was not `"Container"`.
   *
   * So two guards, both green, both measuring the mechanism that was blamed
   * LAST time, sat on top of a full-frame field of white marks travelling at
   * 69.5 px/s through the Briefing window. Measure the property that was
   * reported, not the mechanism that caused it the previous time.
   */
  texMoved: { path: string; type: string; dtx: number; dty: number }[];
  maxTexTravel: number;
}

async function motionOf(page: Page, scene: string, frames: number): Promise<Motion> {
  return page.evaluate(
    ([key, n]) => {
      const kb = (window as unknown as { __kb: { game: { scene: { getScene(k: string): unknown } } } })
        .__kb;
      const s = kb.game.scene.getScene(key) as {
        update(t: number, d: number): void;
        children: { list: unknown[] };
      };
      type Node = {
        type: string;
        x: number;
        y: number;
        list?: Node[];
        tilePositionX?: number;
        tilePositionY?: number;
      };
      interface Row {
        path: string;
        type: string;
        x: number;
        y: number;
        tx: number | null;
        ty: number | null;
      }
      // EVERY NODE, not only the Containers. See `texMoved`: the previous
      // version of this walker filtered to `type === "Container"` and so never
      // looked at the object that was actually travelling.
      const walk = (): Row[] => {
        const acc: Row[] = [];
        const rec = (node: Node, path: string): void => {
          acc.push({
            path,
            type: node.type,
            x: node.x,
            y: node.y,
            tx: node.tilePositionX ?? null,
            ty: node.tilePositionY ?? null,
          });
          node.list?.forEach((c, i) => rec(c, `${path}/${i}`));
        };
        (s.children.list as Node[]).forEach((c, i) => rec(c, `${i}`));
        return acc;
      };
      const before = walk();
      // 16 ms is the frame the game is built for; `update` clamps its own dt.
      for (let i = 0; i < (n as number); i += 1) s.update(i * 16, 16);
      const after = walk();
      const moved: { path: string; dx: number; dy: number }[] = [];
      const texMoved: { path: string; type: string; dtx: number; dty: number }[] = [];
      for (const a of before) {
        const c = after.find((z) => z.path === a.path);
        if (c === undefined) continue;
        if (a.tx !== null && a.ty !== null && c.tx !== null && c.ty !== null) {
          const dtx = Number((c.tx - a.tx).toFixed(2));
          const dty = Number((c.ty - a.ty).toFixed(2));
          if (Math.abs(dtx) > 0.01 || Math.abs(dty) > 0.01)
            texMoved.push({ path: a.path, type: a.type, dtx, dty });
        }
        if (a.type !== "Container") continue;
        const dx = Number((c.x - a.x).toFixed(2));
        // WRAP-CORRECTED. A scrolling layer's y is `mod(H)`, so a run that
        // crosses 1080 comes back as a small or negative difference and reads
        // as "it stopped falling" - which cost this file one red run at a
        // ratio of 7.22 where the arithmetic says 10. Vertical travel is
        // always downward here, so a negative difference is one wrap.
        // Only sound while a single call travels less than H; callers below
        // stay well under it.
        const rawDy = c.y - a.y;
        const dy = Number((rawDy < -0.01 ? rawDy + 1080 : rawDy).toFixed(2));
        if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) moved.push({ path: a.path, dx, dy });
      }
      const nested = moved.filter((r) => r.path.includes("/"));
      return {
        worldSec: Number((((n as number) * 16) / 1000).toFixed(2)),
        containers: before.filter((r) => r.type === "Container").length,
        nestedMoved: nested.length,
        nested: nested.slice(0, 6),
        maxDx: moved.reduce((m, r) => Math.max(m, Math.abs(r.dx)), 0),
        maxDy: moved.reduce((m, r) => Math.max(m, Math.abs(r.dy)), 0),
        texMoved,
        maxTexTravel: texMoved.reduce(
          (m, r) => Math.max(m, Math.abs(r.dtx), Math.abs(r.dty)),
          0,
        ),
      };
    },
    [scene, frames] as [string, number],
  );
}

async function boot(page: Page, scene: string): Promise<void> {
  await freezeReloads(page);
  await page.goto(`/?scene=${scene}`);
  await page.waitForFunction(() => (window as unknown as { __kb?: unknown }).__kb !== undefined, null, {
    timeout: 60_000,
  });
  await page.waitForFunction(
    (k) => {
      const kb = (window as unknown as {
        __kb?: { game: { scene: { getScene(key: string): { scene?: { isActive(): boolean } } | null } } };
      }).__kb;
      const s = kb?.game.scene.getScene(k);
      return s !== null && s !== undefined && s.scene?.isActive() === true;
    },
    scene,
    { timeout: 60_000 },
  );
}

test.describe("UR-50.5: no star layer travels on any screen", () => {
  for (const scene of SCREENS) {
    test(`${scene}: nothing crosses the frame`, async ({ page }) => {
      test.slow();
      await boot(page, scene);

      const short = await motionOf(page, scene, 120);
      const long = await motionOf(page, scene, 1200);

      // THE ASSERTION. A drift sub-plane that moves at all is travelling: its
      // only motion is the `mod(W)` march, so there is no bounded case to
      // allow for and the bar is zero rather than a tolerance.
      expect(
        short.nestedMoved,
        `${scene} planes travelling after 1.92 s: ${JSON.stringify(short.nested)}`,
      ).toBe(0);
      expect(
        long.nestedMoved,
        `${scene} planes travelling after 19.2 s: ${JSON.stringify(long.nested)}`,
      ).toBe(0);

      // The layer roots still sway, and that sway is BOUNDED by the motion
      // model rather than by a number somebody watched once.
      //
      // I set this bar at 16 on the first pass, from a single 3.65 px sample,
      // and all ten screens failed it at 24.7-25.0 px. The sample was right and
      // the bar was wrong: `maxDx` is a difference between two points on a sine,
      // so it can be anything up to the PEAK-TO-PEAK, and where it lands depends
      // only on which phase the two samples caught. Derived from `layers.ts`
      // instead, for the fastest layer (foreVeil, speed 1.8):
      //
      //   idleDriftPx  speed * 6            = 10.8
      //   cameraSwayPx 2 * (0.25 + speed)   =  4.1
      //   amplitude                          = 14.9  ->  peak-to-peak 29.8
      //
      // A travelling plane blows through this in three seconds, so the bar
      // still fails the defect; it just no longer fails the fix.
      expect(long.maxDx, `${scene} sideways: ${long.maxDx} px over 19.2 s`).toBeLessThanOrEqual(
        SWAY_PEAK_TO_PEAK,
      );
      expect(short.maxDx).toBeLessThanOrEqual(SWAY_PEAK_TO_PEAK);
    });
  }

  test("the sideways sway is BOUNDED, which is what tells it from travel", async ({
    page,
  }) => {
    test.slow();
    // The distinction the whole file rests on, measured directly rather than
    // argued: run the clock out by 8x and watch the sideways figure refuse to
    // grow, while the vertical one (Briefing scrolls at 30 px/s) multiplies.
    // A single sample cannot tell a sine from a ramp; four can.
    await boot(page, "Briefing");
    const runs: { sec: number; dx: number }[] = [];
    for (const frames of [600, 1200, 2400, 4800]) {
      const m = await motionOf(page, "Briefing", frames);
      runs.push({ sec: m.worldSec, dx: m.maxDx });
      expect(m.nestedMoved, `planes travelling at ${m.worldSec}s`).toBe(0);
    }
    const report = runs.map((r) => `${r.sec}s:${r.dx}px`).join("  ");
    for (const r of runs) {
      expect(r.dx, `sideways never exceeds the sway model - ${report}`).toBeLessThanOrEqual(
        SWAY_PEAK_TO_PEAK,
      );
    }
    // ...and it does not grow WITH the clock. A travelling plane would be 8x
    // bigger at the end of this list than at the start; measured, the figures
    // wander inside the sine (13.88, 3.85, 11.43, 2.55).
    const first = runs[0] as { dx: number };
    const last = runs[runs.length - 1] as { dx: number };
    expect(last.dx, `8x the clock must not be 8x the distance - ${report}`).toBeLessThan(
      first.dx * 8,
    );
  });

  test("Briefing: the belt moves, and it moves DOWN (UR-50.4)", async ({ page }) => {
    test.slow();
    // The other half of the report: "add debris drifting slowly DOWN inside the
    // window, so it reads as a view of a moving belt rather than a still
    // picture." The window took the default `worldSpeed` of 0, so the measured
    // vertical travel was exactly 0 px at every duration - the only thing
    // moving in the glass was the sideways march this file forbids.
    await boot(page, "Briefing");
    await page.evaluate(() => {
      const kb = (window as unknown as {
        __kb: { game: { scene: { getScene(k: string): { scene: { restart(d: unknown): void } } } } };
      }).__kb;
      kb.game.scene.getScene("Briefing").scene.restart({ stopId: "saturn" });
    });
    await page.waitForTimeout(1500);

    // 1.92 s and 9.6 s: both stay under one 1080 px wrap at this world speed
    // (the fastest layer covers 54 px/s, so 518 px at the long end).
    const short = await motionOf(page, "Briefing", 120);
    const long = await motionOf(page, "Briefing", 600);

    // Something falls...
    expect(short.maxDy, `vertical travel over 1.92 s: ${short.maxDy} px`).toBeGreaterThan(20);
    // ...and it falls at a CONSTANT RATE, which is what makes it a belt going
    // past rather than a layer rocking. Rate, not ratio: a rate survives the
    // wrap and says what the screen is actually doing in px/s.
    const rateShort = short.maxDy / short.worldSec;
    const rateLong = long.maxDy / long.worldSec;
    const report = `${rateShort.toFixed(1)} px/s at 1.92 s, ${rateLong.toFixed(1)} px/s at 9.6 s`;
    expect(rateShort, report).toBeGreaterThan(20);
    expect(Math.abs(rateLong - rateShort) / rateShort, report).toBeLessThan(0.1);
    // ...while the sideways axis stays put.
    expect(long.nestedMoved).toBe(0);
    expect(long.maxDy).toBeGreaterThan(long.maxDx * 10);
  });
});

/**
 * Every screen in the game that draws a field of small light marks on the sky,
 * minus the one named exception.
 *
 * TWO SURFACES, ONE LIST. The nine world screens get the pinned starfield
 * (`render/starField.ts`) AND the per-stop atmosphere pass (`atmospherePass` in
 * `render/parallax.ts`); the five menu screens get `ui/chrome.Backdrop`, whose
 * stars are placed by `ui/starfield.menuStars`. Both surfaces answer to
 * `starField.starsMayTravel`, so both are swept here by the same assertion.
 *
 * Flight is absent on purpose and its absence is not an omission: it is the
 * single entry in `TRAVELLING_LIGHT`, and `tests/unit/arch/noCrossDrift.test.ts`
 * checks this list against that table so a screen cannot be dropped from here
 * without buying an exception with a sentence.
 */
const STAR_SCREENS = [
  // Flight is here because it is no longer excepted (UR-14 round five): the
  // owner ruled that stars are far enough away that nothing in the sky moves
  // visibly, in flight or out of it. The arch guard fails if a screen that
  // draws stars is neither swept nor excepted, which is what put it here.
  "Flight",
  // World: starfield + atmosphere pass.
  "Title",
  "Briefing",
  "Preflight",
  "DirectorMap",
  "EarthActivation",
  "Warp",
  "Results",
  "Beacon",
  "Ending",
  // Menus: ui/chrome.Backdrop.
  "Settings",
  "BeaconLog",
  "ProfilePicker",
  "ProfileCreate",
  "Pause",
] as const;

/**
 * THE SHARED RULE, MEASURED (UR-14, reported three times).
 *
 * ================== WHAT THE THIRD REPORT WAS ==================
 * Long diagonal streaks crossing the whole Briefing pane, and - reported
 * separately, on the same build - stars still moving on the Title. Not the
 * starfield, which has been pinned since round one, and not the decorative
 * debris planes, which round two stopped. It was the ATMOSPHERE PASS: one
 * full-frame `TileSprite` per stop, tinted white, holding 24 lines 150-310 px
 * long leaning sideways by 0.28 of their length at Uranus and Neptune, 40
 * shorter ones at Mars and Jupiter, and 140 additive DOTS at Saturn and Pluto.
 * Its `tilePositionY` was advanced every frame at `worldSpeed * 1.45 + 26` px/s
 * - a floor, so it ran on screens whose world speed was zero, which is the
 * exact mistake `DRIFT_X` made and the exact reason `worldSpeed: 0` never meant
 * "nothing travels".
 *
 * THE TWO REPORTS ARE ONE OBJECT. Rendered alone on black, that pass at Saturn
 * IS a starfield - denser and more even than the real one, because its 512 px
 * texture tiles about eight times across the frame at 140 dots each. So every
 * world screen drew two fields of small white marks, one pinned and one
 * travelling, and the Title - whose palette follows the player's furthest
 * beacon, so a returning pilot gets Saturn - travelled fastest of all fourteen
 * at 133.3 px/s. Standards rule 3: one implementation per drawing, and the
 * guard must see the one the game is actually showing.
 *
 * ================== WHY BOTH EXISTING GUARDS PASSED ==================
 * They measured `x` and `y` on Containers. A `TileSprite` scrolls its texture
 * beneath a quad that never moves, so its `x` and `y` are constant forever -
 * and the walker in this file did not record it at all, because it kept only
 * nodes whose `type` was `"Container"`. The source sweep next door asserted
 * `crossDrift: false` at every call site and that the starfield was still on
 * the pinned `sky` layer; both were true, and neither is the property the
 * player reported. Two green guards, one travelling field, three tickets.
 *
 * So this asserts the PROPERTY - no star-like light crosses the frame, by any
 * mechanism - over every screen that draws any, with the mechanisms enumerated
 * rather than assumed: object position, container offset, texture coordinate.
 *
 * ================== THE NUMBERS, WATCHED FAILING ==================
 * The gate in `parallax.ts` was reverted to the shipped line - the
 * unconditional `weather.tilePositionY -= (worldSpeed * 1.45 + 26) * dt` - and
 * this block re-run. NINE of the fourteen screens went red, and what they
 * report is `dty` on a single `TileSprite`, after 1.92 s of world:
 *
 *   Title             -255.94 px    133.3 px/s
 *   Briefing          -133.44 px     69.5 px/s
 *   Preflight          -49.92 px     26.0 px/s
 *   DirectorMap        -49.92 px     26.0 px/s
 *   EarthActivation    -49.92 px     26.0 px/s
 *   Warp               -49.92 px     26.0 px/s
 *   Results            -49.92 px     26.0 px/s
 *   Beacon             -49.92 px     26.0 px/s
 *   Ending             -49.92 px     26.0 px/s
 *
 * Read the repeated 26.0. Those seven screens pass `worldSpeed: 0` and six of
 * them carry a comment saying nothing travels on them; 26 is the FLOOR term,
 * and it is the whole defect in one number. At 19.2 s Briefing reads -1334.40
 * and Title -2559.36 - ten times the clock, ten times the distance, a ramp
 * rather than a sine, which is the distinction this file is built on. 1334 px
 * is the 812 px Briefing pane crossed one and a half times.
 *
 * The five menu screens passed while broken, correctly: they draw no
 * `TileSprite`. Their half of the rule is the source sweep next door.
 *
 * Fixed, the same measurement gives `[]` at both durations on all fourteen.
 *
 * ================== AND THE NUMBERS ARE NOT LOAD-DEPENDENT ==================
 * Worth stating because this measurement is the kind that usually is, and
 * because on the day it was written eleven of fourteen e2e failures in this
 * repo turned out to be machine contention rather than product defects. A
 * starved page can make a still star look displaced between two samples and a
 * travelling one look still, so "no movement" from a racing probe means
 * nothing.
 *
 * This probe cannot have either error, because it does not race anything. The
 * before-sample, the 1200 `s.update(t, dt)` calls and the after-sample all run
 * inside ONE synchronous `page.evaluate` - no `requestAnimationFrame`, no
 * renderer, no wall clock between the two reads. Contention makes the block
 * take longer in real time and cannot touch the arithmetic. Standards rule 6's
 * corollary, in the strongest form available: not a paused scene but a stepped
 * one.
 *
 * Controlled rather than argued. The nine failing numbers above were produced
 * twice against the same broken code - once on a quiet box at two workers, once
 * at a system load average of 51.6 with three workers and five other Playwright
 * runs on the machine - and every one of them matched to the hundredth of a
 * pixel: -255.94, -133.44, and seven identical -49.92.
 */
test.describe("UR-14: no screen translates its stars", () => {
  for (const scene of STAR_SCREENS) {
    test(`${scene}: no star-like light crosses the frame`, async ({ page }) => {
      test.slow();
      await boot(page, scene);

      const short = await motionOf(page, scene, 120);
      const long = await motionOf(page, scene, 1200);

      // TEXTURE-SPACE. The bar is zero rather than a tolerance: a texture
      // offset has no bounded component to allow for. Either it is being
      // advanced or it is not.
      expect(
        short.texMoved,
        `${scene} texture travel after 1.92 s: ${JSON.stringify(short.texMoved)}`,
      ).toEqual([]);
      expect(
        long.texMoved,
        `${scene} texture travel after 19.2 s: ${JSON.stringify(long.texMoved)}`,
      ).toEqual([]);

      // ...and the other two mechanisms, so this test states the whole rule on
      // its own rather than leaning on the tests above it.
      expect(long.nestedMoved, `${scene} planes travelling: ${JSON.stringify(long.nested)}`).toBe(
        0,
      );
      expect(long.maxDx, `${scene} sideways: ${long.maxDx} px over 19.2 s`).toBeLessThanOrEqual(
        SWAY_PEAK_TO_PEAK,
      );
    });
  }

  test("the measurement can SEE texture travel, on the one screen that has it", async ({
    page,
  }) => {
    /**
     * THE POSITIVE CONTROL, and the reason it is not optional.
     *
     * Fourteen screens returning `[]` is also what a walker that never looks at
     * a TileSprite returns - which is precisely how this defect survived two
     * rounds of guards. Standards rule 9: when two causes produce identical
     * output, run both. Flight is the named exception in
     * `starField.TRAVELLING_LIGHT`, so it is the one place the same probe must
     * come back NON-zero. If this goes green at zero, the sweep above is
     * measuring nothing and says so here rather than in six months.
     */
    test.slow();
    await boot(page, "Flight");
    const m = await motionOf(page, "Flight", 600);
    expect(
      m.maxTexTravel,
      `Flight is the exception and must actually use it: ${JSON.stringify(m.texMoved)}`,
    ).toBeGreaterThan(1);
  });
});

// ===========================================================================
// UR-14, ROUND FOUR: THE PROPERTY, NOT THE MECHANISM
// ===========================================================================

/**
 * A POINT OF LIGHT DOES NOT CHANGE ITS PLACE ON THE SCREEN.
 *
 * ================== WHAT THE FOURTH REPORT WAS ==================
 * Lights still moving on the Title of the shipped build. Not the pinned field,
 * not the decorative planes' sideways march, not the atmosphere pass - all
 * three previous fixes were still holding, and the texture-scroll sweep above
 * was green while 58 sprites crossed the frame.
 *
 * Measured against the served build at commit 1f10068, 250 frames of world
 * (4.0 s), walking the display list and reading each node's RENDERED world
 * position:
 *
 *   node                          count   dy over 4.0 s    px/s
 *   Image kb/tex/mote               44        384.8        96.2
 *   Image kb/tex/glint              14        384.8        96.2
 *   tilePositionX/Y, every node      -            0           0
 *
 * 96.2 px/s is `nearField`'s 1.30 times the Title's 74 px/s world speed. The
 * sprites were replayed straight into the `nearField` container and rode it.
 *
 * ================== WHY ALL THREE EXISTING GUARDS WERE GREEN ==============
 * Three independent reasons, and every one of them is a filter written against
 * the mechanism of the previous round:
 *
 *   1. The walker above records every node but only DIFFS Containers -
 *      `if (a.type !== "Container") continue;`. An Image never got compared,
 *      whatever it was doing. Round two's guard had filtered the walk itself to
 *      Containers; round three widened the walk and left the diff filtered,
 *      which is the same blind spot one layer in.
 *   2. It diffs each node's OWN x and y. These sprites never touch theirs; a
 *      parent moves and they are carried. Only a world transform sees that.
 *   3. `nestedMoved` - the one assertion with a bar of zero - counts only paths
 *      containing "/", i.e. sub-planes. The `nearField` container is a layer
 *      ROOT, so it was excluded, and the only bar left on a root was `maxDx`
 *      against the sideways sway model. The travel was vertical. Nothing in
 *      this file asserted a vertical bar on a root at all.
 *
 * Three rounds, three mechanisms - container drift, texture scroll, object
 * parallax - and three guards each blind to the next one. So this block asserts
 * what was reported rather than how it happened.
 *
 * ================== HOW IT MEASURES ==================
 * EVERY node, not one type. EVERY node's RENDERED position, through
 * `getWorldTransformMatrix`, so a static child of a moving parent is caught by
 * construction and a fifth mechanism that moves any ancestor is caught without
 * this file being rewritten. The bar is ZERO, in both axes, on every screen
 * that is not the named exception.
 *
 * AND TWICE OVER, BECAUSE STEPPING THE WORLD CANNOT SEE EVERYTHING. The stepped
 * probe drives `scene.update` by hand, which is deterministic and immune to
 * machine load (see the note in the round-three block) - and it advances
 * nothing that Phaser drives from its own loop. A tween on a light is invisible
 * to it. So the same walk runs a second time over REAL RENDERED FRAMES, waiting
 * on `game.loop.frame` rather than on a clock, and reports how many frames it
 * actually got. A starved run says so in `framesAdvanced` instead of returning
 * a quiet zero (standards rule 9). That second pass is not decoration: it is
 * the only one of the two that can see a fifth mechanism driven by a tween,
 * and it found one - eighteen tweened discs on every menu screen, recorded and
 * closed in the note above `STAR_SCREENS`'s sweep below. A pass that only
 * stepped `scene.update` could not have seen it at all.
 *
 * ================== THE NUMBERS, WATCHED FAILING ==================
 * `starsMayTravel("world.nearLight", ...)` in `parallax.ts` was replaced with a
 * bare `true`, which puts the specks back on the scrolling `nearField`
 * container exactly as the shipped build had them, and this block re-run. NINE
 * of the fourteen screens went red, every one of them reporting 58 moved
 * lights - 44 `kb/tex/mote` and 14 `kb/tex/glint` - at these displacements:
 *
 *                     1.92 s            19.2 s
 *                     dy       dx       dy        dx      world speed
 *   Title           184.70     8.78    767.04    17.92    74 px/s
 *   Briefing         74.88     8.99    748.80    17.83    30 px/s
 *   Preflight         0.00     8.99      0.00    17.83     0
 *   DirectorMap       0.00     8.78      0.00    17.92     0
 *   EarthActivation   0.00     8.89      0.00    17.87     0
 *   Warp              0.00     8.89      0.00    17.87     0
 *   Results           0.00     8.89      0.00    17.87     0
 *   Beacon            0.00     8.78      0.00    17.92     0
 *   Ending            0.00     8.78      0.00    17.92     0
 *
 * READ THE TWO COLUMNS SEPARATELY, because they are two findings.
 *
 * `dy` is the travel that was reported: 184.70 px in 1.92 s on the Title is
 * 96.2 px/s, which is `nearField`'s 1.30 times that screen's 74 px/s world
 * speed, and the whole field crosses the 1080 px frame every eleven seconds.
 * 767.04 rather than 1847.04 at ten times the clock is one `mod(H)` wrap, not a
 * slowdown - the same wrap the round-two block corrects for above. The short
 * sample is the one that cannot be fooled by a wrap landing near zero, which is
 * why both durations are asserted.
 *
 * `dx` is what the other seven screens had instead, and it is why the bar here
 * is zero rather than the sway model the blocks above use. Those screens pass
 * `worldSpeed: 0`, so nothing scrolled - and 58 lit specks still slid 17.9 px
 * sideways on the near plane's idle drift and camera sway. A LAYER may breathe;
 * the assertions above allow it up to 29.8 px because a layer is a carrier. A
 * point of light may not, because a speck that shifts by seventeen pixels
 * against a still sky is a speck that moved.
 *
 * The five menu screens passed while broken, correctly: they draw no near
 * plane. Their half of this rule is the real-frames pass below.
 *
 * Fixed, all fourteen report `[]` at both durations. The Title's display list
 * also drops from 123 nodes to 95: a pinned plane needs no wrap copy.
 */

/**
 * The generated textures whose entire content is one speck of light
 * (`render/textures.ts`): a soft dot, a four-point sparkle, a radial bloom.
 */
const LIGHT_TEXTURES = ["kb/tex/mote", "kb/tex/glint", "kb/tex/glow"] as const;

/**
 * Rendered, above this a bright thing stops being a speck.
 *
 * The near field's motes run 18-72 px and its glints 14-34. The same `glow`
 * texture also draws the Lantern's bloom at 250x340 and the wordmark's plate
 * bloom at 900x360, which are lighting on an object rather than points in the
 * sky - and the wider one travels with the ship's sway on purpose. 120 sits in
 * the gap with room on both sides rather than on the edge of either.
 */
const SPECK_MAX_PX = 120;

/** Shape objects that draw a filled blob and nothing else. */
const SPECK_SHAPES = ["Arc", "Ellipse", "Curve", "Star", "Polygon"] as const;

/**
 * THE INVENTORY OF WHAT IS ALLOWED TO MOVE, which is the half of this test that
 * does not depend on recognising a light.
 *
 * Classifying lights needs foresight: it catches a fifth mechanism only if the
 * fifth mechanism uses a drawing this list already knows. So the sweep also
 * asserts from the other side - every node that moves at all must carry one of
 * these signatures, and each one is here because it is demonstrably NOT a point
 * of light:
 *
 *   Container:-:small       a parallax layer root or one of its drift
 *                           sub-planes. It carries matter; it draws nothing.
 *   Graphics:-:small        one plane's silhouettes in a single Graphics -
 *                           decorative rocks (a body, a facet and a rim), the
 *                           mid-field dust (240-660 px soft ellipses) and the
 *                           foreground veil (a sheet). UR-50.4 asked for these
 *                           to drift and they still do.
 *   Image:kb/tex/glow:big   the Lantern's bloom and the wordmark's plate bloom,
 *                           moving with the ship's camera sway. Lighting on an
 *                           object, 250x340 and 900x360 - not a speck.
 *
 * A new sprite, a new shape object or a new TileSprite that moves fails here
 * and names itself, whether or not this file can tell what it draws.
 */
const MOVES_BY_DESIGN = ["Container:-:small", "Graphics:-:small", "Image:kb/tex/glow:big"];

/**
 * THE FIFTH MECHANISM, FOUND BY THE REAL-FRAMES PASS AND CLOSED.
 *
 * `Backdrop.spawnMotes` in `src/game/ui/chrome.ts` put 18 accent discs of
 * radius 2-4 on the near-field depth of all five menu screens and tweened each
 * one `60 + (i % 5) * 26` px up the frame and back, forever. By the rule in
 * `render/starField.ts` those are points of light translating on a screen with
 * no flight, which is the appearance UR-14 has been reported for four times.
 *
 * Measured over one 2.5 s window of the game's own clock, before the fix:
 *
 *   Settings        15 of 18 moving    up to 56.3 px
 *   BeaconLog       17 of 18 moving    up to 69.5 px
 *   ProfilePicker   16 of 18 moving    up to 64.7 px
 *   ProfileCreate   16 of 18 moving    up to 59.8 px
 *   Pause           15 of 18 moving    up to 58.0 px
 *
 * Not 18, because the tweens are staggered and a disc caught at the turn of its
 * yoyo shows nothing inside the window. Over 3 s the same discs read 88-110 px.
 *
 * IT WAS THE FIRST TWEEN-DRIVEN ONE, and that is why no guard had ever seen it:
 * container drift, the plane march, texture scroll and object parallax are all
 * advanced by `scene.update`, and every probe before this one stepped
 * `scene.update` by hand. Phaser advances a tween from its own loop, so to a
 * stepped probe these eighteen discs were perfectly still.
 *
 * Fixed by tweening the ALPHA instead of the y and routing the decision through
 * `starsMayTravel("menu.backdrop", key)`, so the motes breathe where they stand
 * and the surface asks the rule rather than assuming an answer. All five menu
 * screens now report ZERO moving lights over the same window, which is why they
 * are swept below by the same assertion as the other nine rather than by an
 * enumeration of their own.
 *
 * ================== WATCHED FAILING ==================
 * The `y` term was put back on the mote tween unconditionally and the
 * real-frames sweep re-run at three workers. FIVE of the fourteen screens went
 * red - the five that draw a backdrop - and the nine world screens stayed
 * green, which is the right shape: the near plane was already fixed.
 *
 *   Settings         2 lights moving    largest dy   -0.64 px   (4 frames)
 *   BeaconLog        3 lights moving    largest dy   -1.03 px   (4 frames)
 *   ProfilePicker   12 lights moving    largest dy  -89.62 px   (8 frames)
 *   ProfileCreate    9 lights moving    largest dy  -12.53 px   (5 frames)
 *   Pause           11 lights moving    largest dy -100.96 px   (8 frames)
 *
 * READ THE SPREAD, because it is the argument for a bar of zero. Those five
 * numbers describe one identical defect; they differ only in which point of an
 * eight-to-twelve second yoyo each screen's discs happened to be caught at.
 * Settings reports 0.64 px of the same 60-164 px travel that Pause reports 101
 * of. Any tolerance big enough to be stable would have passed Settings and
 * BeaconLog while they were broken.
 *
 * READ THE FRAME COUNTS TOO. Four rendered frames in 2.5 s of game clock, under
 * three workers on a software rasteriser. An earlier version of this pass
 * waited for 150 FRAMES and asserted it got at least 40, and it failed on
 * Briefing and Preflight for that reason alone - a statement about the machine,
 * not about the product. The window is the game's own clock now, because a
 * tween runs on the loop delta and two and a half seconds of clock is two and a
 * half seconds of tween however few frames get drawn in them. Four frames is
 * still four rendered states, and the defect is plainly visible in them.
 */

interface LightMotion {
  worldSec: number;
  /** Rendered frames between the two samples. Two is enough to compare. */
  framesAdvanced: number;
  /**
   * Milliseconds of SIMULATED time between them - the sum of the loop deltas
   * the game actually handed its tween and update systems, which under load is
   * a small fraction of the wall time. This is the number a tween runs on.
   */
  worldMsAdvanced: number;
  nodes: number;
  /** How many nodes this walk classified as points of light. Never zero. */
  lights: number;
  movedLights: { path: string; kind: string; type: string; dx: number; dy: number }[];
  /** Distinct `type:texture:size` signatures of everything else that moved. */
  movedOther: string[];
  texMoved: { path: string; type: string; dtx: number; dty: number }[];
}

/**
 * Walk the real display list and diff every node's RENDERED position.
 *
 * `realTime: false` steps `scene.update` by hand `amount` times - deterministic,
 * load-proof, and blind to anything Phaser's own loop drives. `realTime: true`
 * lets the game run for `amount` milliseconds of SIMULATED time and sees the
 * lot, at the cost of depending on the machine actually rendering; it reports
 * both the clock and the frame count, so a starved run is told apart from a
 * still one rather than passing as one.
 */
async function lightMotion(
  page: Page,
  scene: string,
  amount: number,
  realTime: boolean,
): Promise<LightMotion> {
  return page.evaluate(
    async ([key, n, live, lightTex, speckMax, speckShapes]) => {
      const kb = (
        window as unknown as {
          __kb: {
            game: {
              loop: { frame: number; delta: number };
              scene: { getScene(k: string): unknown };
            };
          };
        }
      ).__kb;
      const s = kb.game.scene.getScene(key as string) as {
        update(t: number, d: number): void;
        children: { list: unknown[] };
        scene?: { isActive(): boolean };
      };
      type Node = {
        type: string;
        x?: number;
        y?: number;
        depth?: number;
        radius?: number;
        displayWidth?: number;
        displayHeight?: number;
        texture?: { key?: string };
        list?: Node[];
        tilePositionX?: number;
        tilePositionY?: number;
        getWorldTransformMatrix?: () => { tx: number; ty: number };
      };
      const textures = lightTex as readonly string[];
      const shapes = speckShapes as readonly string[];
      const max = speckMax as number;

      /** Rendered size of a node, in screen pixels. */
      const sizeOf = (node: Node): number => {
        if (typeof node.radius === "number") return node.radius * 2;
        return Math.max(Math.abs(node.displayWidth ?? 0), Math.abs(node.displayHeight ?? 0));
      };
      /**
       * Does this node read as a point of light? By what it DRAWS - a speck
       * texture at speck size, or a small filled shape - never by where it was
       * put or by which module put it there. That distinction is the whole
       * ticket: round three's rule classified by placement and excused these.
       */
      const lightKind = (node: Node): string | null => {
        const tex = node.texture?.key ?? null;
        const size = sizeOf(node);
        if (tex !== null && textures.includes(tex))
          return size <= max ? `${tex} ${size.toFixed(0)}px` : null;
        if (shapes.includes(node.type) && size > 0 && size <= max)
          return `${node.type} ${size.toFixed(0)}px`;
        return null;
      };

      interface Row {
        path: string;
        type: string;
        tex: string | null;
        light: string | null;
        size: number;
        tx: number;
        ty: number;
        tpx: number | null;
        tpy: number | null;
      }
      /**
       * EVERY node, and its position AS RENDERED. The parent's transform is
       * accumulated, so a sprite that never touches its own x is still caught
       * when the container under it scrolls - which is exactly what round four
       * was. `getWorldTransformMatrix` is the renderer's own answer; the manual
       * sum is the fallback for a node type that does not carry one.
       */
      const walk = (): Row[] => {
        const acc: Row[] = [];
        const rec = (node: Node, path: string, px: number, py: number): void => {
          let tx = px + (node.x ?? 0);
          let ty = py + (node.y ?? 0);
          const m = node.getWorldTransformMatrix?.();
          if (m !== undefined) {
            tx = m.tx;
            ty = m.ty;
          }
          acc.push({
            path,
            type: node.type,
            tex: node.texture?.key ?? null,
            light: lightKind(node),
            size: sizeOf(node),
            tx,
            ty,
            tpx: node.tilePositionX ?? null,
            tpy: node.tilePositionY ?? null,
          });
          node.list?.forEach((c, i) => rec(c, `${path}/${i}`, tx, ty));
        };
        (s.children.list as Node[]).forEach((c, i) => rec(c, `${i}`, 0, 0));
        return acc;
      };

      const before = walk();
      let advanced = 0;
      let worldMs = 0;
      let after: Row[];
      if (live === true) {
        const loop = kb.game.loop;
        const first = loop.frame;
        const started = performance.now();
        /**
         * THE WINDOW IS THE GAME'S SIMULATED TIME, WHICH IS NEITHER WALL TIME
         * NOR A FRAME COUNT. Both of those were tried and both were wrong:
         *
         *   frames  failed on Briefing and Preflight under two workers because
         *           the page drew 30-odd of the 150 asked for. A statement
         *           about the machine, not about the product.
         *   wall    passed, and measured almost nothing. Phaser SMOOTHS AND
         *           CLAMPS its delta, so a starved loop hands the tween system
         *           far less time than the wall clock says has passed: the
         *           positive control below, run at three workers, saw its
         *           tweened disc move 0.49 px in 2.5 s of wall time. The
         *           assertion held - the bar is zero - but a probe that only
         *           just sees the defect is a probe that will one day miss it.
         *
         * Summing `loop.delta` once per game frame is exactly the time the
         * tween system itself receives, so a window of 2000 of these is 2000 ms
         * of tween however long the machine takes to deliver them.
         *
         * AND IT IS A CEILING THE MACHINE MAY NOT REACH, which is stated rather
         * than hidden. Measured at three workers: the Briefing delivered 793 ms
         * of simulated time in a full minute of wall clock - roughly 24 frames,
         * because Phaser hands a starved loop a nominal ~33 ms delta whatever
         * the real gap was. So this pass takes whatever window it can get
         * inside its cap and REPORTS it; the caller asserts a floor it can
         * actually meet. That makes this pass a DETECTOR - what it finds is
         * real - rather than a bound. The deterministic bound over a long clock
         * is the stepped pass, which does not depend on the machine at all.
         */
        let simMs = 0;
        let seenFrame = loop.frame;
        /**
         * SAMPLED EVERY FRAME WHILE THE SCREEN IS STILL THERE.
         *
         * Preflight hands over to Flight after about two and a half seconds,
         * and a single sample taken at the end of the window read an empty
         * display list: nothing matched, so nothing was compared, and the run
         * reported a clean screen with `lights: 0`. That is standards rule 9 in
         * one line - "no light moved" and "nothing was measured" were the same
         * output. Keeping the last snapshot taken while the scene was live
         * gives a real comparison on a screen that leaves, and `framesAdvanced`
         * then says how much of the window it actually covered.
         */
        let last = before;
        let lastFrame = first;
        await new Promise<void>((resolve) => {
          const tick = (): void => {
            if (loop.frame !== seenFrame) {
              simMs += loop.delta;
              seenFrame = loop.frame;
            }
            const stillHere = s.scene?.isActive() === true;
            if (stillHere) {
              last = walk();
              lastFrame = loop.frame;
            }
            // Both figures are returned and both are asserted: the simulated
            // clock says the tween had time to run, the frame count says two
            // distinct rendered states were compared. The wall-clock cap is a
            // stop, not a measurement - whatever it catches is reported.
            if (
              !stillHere ||
              simMs >= (n as number) ||
              performance.now() - started > 45000
            ) {
              resolve();
              return;
            }
            requestAnimationFrame(tick);
          };
          tick();
        });
        advanced = lastFrame - first;
        worldMs = Math.round(simMs);
        after = last;
      } else {
        for (let i = 0; i < (n as number); i += 1) s.update(i * 16, 16);
        advanced = n as number;
        worldMs = (n as number) * 16;
        after = walk();
      }

      const movedLights: LightRow[] = [];
      const movedOther = new Set<string>();
      const texMoved: { path: string; type: string; dtx: number; dty: number }[] = [];
      interface LightRow {
        path: string;
        kind: string;
        type: string;
        dx: number;
        dy: number;
      }
      let lights = 0;
      for (const a of before) {
        const c = after.find((z) => z.path === a.path);
        if (c === undefined) continue;
        if (a.light !== null) lights += 1;
        if (a.tpx !== null && a.tpy !== null && c.tpx !== null && c.tpy !== null) {
          const dtx = Number((c.tpx - a.tpx).toFixed(2));
          const dty = Number((c.tpy - a.tpy).toFixed(2));
          if (Math.abs(dtx) > 0.01 || Math.abs(dty) > 0.01)
            texMoved.push({ path: a.path, type: a.type, dtx, dty });
        }
        const dx = Number((c.tx - a.tx).toFixed(2));
        const dy = Number((c.ty - a.ty).toFixed(2));
        if (Math.abs(dx) <= 0.005 && Math.abs(dy) <= 0.005) continue;
        if (a.light !== null) {
          movedLights.push({ path: a.path, kind: a.light, type: a.type, dx, dy });
        } else {
          movedOther.add(`${a.type}:${a.tex ?? "-"}:${a.size > max ? "big" : "small"}`);
        }
      }
      return {
        worldSec: Number((worldMs / 1000).toFixed(2)),
        framesAdvanced: advanced,
        worldMsAdvanced: worldMs,
        nodes: before.length,
        lights,
        movedLights,
        movedOther: [...movedOther].sort(),
        texMoved,
      };
    },
    [scene, amount, realTime, LIGHT_TEXTURES, SPECK_MAX_PX, SPECK_SHAPES] as [
      string,
      number,
      boolean,
      readonly string[],
      number,
      readonly string[],
    ],
  );
}


test.describe("UR-14: no point of light changes its place on the screen", () => {
  for (const scene of STAR_SCREENS) {
    test(`${scene}: every point of light holds its position`, async ({ page }) => {
      test.slow();
      await boot(page, scene);

      const short = await lightMotion(page, scene, 120, false);
      const long = await lightMotion(page, scene, 1200, false);

      // THE PROBE CAN SEE. Fourteen screens reporting "no light moved" is also
      // what a classifier that recognises nothing reports (standards rule 9).
      // Every screen in this sweep draws specks, so a zero here is a broken
      // measurement rather than a clean screen.
      expect(short.lights, `${scene} classified no node as a point of light`).toBeGreaterThan(0);

      // THE ASSERTION, in rendered screen pixels, with a bar of zero. There is
      // no bounded component to allow for: a light either holds its place or it
      // does not.
      expect(
        short.movedLights,
        `${scene} lights moved over 1.92 s: ${JSON.stringify(short.movedLights.slice(0, 4))}`,
      ).toEqual([]);
      expect(
        long.movedLights,
        `${scene} lights moved over 19.2 s: ${JSON.stringify(long.movedLights.slice(0, 4))}`,
      ).toEqual([]);

      // ...and the inventory from the other side, which does not depend on this
      // file recognising what the next mechanism draws.
      const unexpected = long.movedOther.filter((sig) => !MOVES_BY_DESIGN.includes(sig));
      expect(
        unexpected,
        `${scene} moved a drawing that is not on the inventory: ${unexpected.join(", ")}`,
      ).toEqual([]);

      // Round three's mechanism, restated here so this block stands alone.
      expect(long.texMoved, `${scene} texture travel: ${JSON.stringify(long.texMoved)}`).toEqual(
        [],
      );
    });
  }

  for (const scene of STAR_SCREENS) {
    test(`${scene}: and it holds over real rendered frames too`, async ({ page }) => {
      test.slow();
      await boot(page, scene);
      const live = await lightMotion(page, scene, 2000, true);
      // A starved page renders nothing and would report a clean screen. Say
      // which of the two happened rather than passing either way.
      // THE FLOOR IS WHAT A LOADED MACHINE CAN DELIVER, NOT WHAT THE WINDOW
      // ASKED FOR. 120 ms of simulated time is ample to see a translating
      // light - the broken backdrop motes were caught at 0.64 px on a screen
      // whose discs were near the turn of their yoyo, against a bar of zero -
      // and it is a floor the Briefing can reach under three workers, where
      // 1200 was not. Asked for 2000 and assert 120: full window on an idle
      // box, an honest measurement on a busy one, and a loud failure rather
      // than a quiet pass if the page renders nothing at all.
      expect(
        live.worldMsAdvanced,
        `${scene} only simulated ${live.worldMsAdvanced} ms; this measured nothing`,
      ).toBeGreaterThan(120);
      expect(
        live.framesAdvanced,
        `${scene} drew ${live.framesAdvanced} frames; two samples of one frame are one sample`,
      ).toBeGreaterThan(1);
      expect(live.lights).toBeGreaterThan(0);
      expect(
        live.movedLights,
        `${scene} lights moved over ${live.framesAdvanced} real frames: ${JSON.stringify(
          live.movedLights.slice(0, 4),
        )}`,
      ).toEqual([]);
    });
  }

  test("Flight is the exception, and it must actually be using it", async ({ page }) => {
    /**
     * THE POSITIVE CONTROL. Fourteen empty arrays are also what a walk that
     * never reaches a sprite produces - which is precisely how round four
     * survived round three's guard. Flight holds both entries in
     * `starField.TRAVELLING_LIGHT`, so it is the one screen where this same
     * probe, unchanged, must come back full.
     *
     * Measured on the shipped Flight at 110 px/s of world: all 58 near-plane
     * sprites travel 572.0 px in 4.0 s, which is 143.0 px/s, which is
     * `nearField`'s 1.30 times the world speed. Proportional, with no floor.
     */
    test.slow();
    await boot(page, "Flight");
    const m = await lightMotion(page, "Flight", 250, false);
    expect(
      m.movedLights.length,
      `Flight's near-plane lights must travel with the world: ${JSON.stringify(
        m.movedLights.slice(0, 3),
      )}`,
    ).toBeGreaterThanOrEqual(50);
    expect(m.texMoved.length, "Flight's atmosphere pass must travel too").toBeGreaterThan(0);
  });
});

/**
 * THE REAL-FRAMES PASS HAS ITS OWN CONTROL, and it needs one more than any
 * other measurement in this file.
 *
 * Fourteen screens reporting "no light moved over real frames" is also exactly
 * what a probe that cannot see a tween reports. That is not a hypothetical: it
 * is what the three guards before this one did for four rounds, and until the
 * fix above, `Backdrop.spawnMotes` was the live proof that the stepped pass had
 * that hole. Closing the defect also removed the only thing on screen that was
 * demonstrating the pass worked - so the demonstration is now synthetic and
 * permanent rather than borrowed from a defect.
 *
 * A single disc is added to a menu screen, tweened the way `spawnMotes` used to
 * tween its own, and the same probe is run unchanged. It must come back
 * naming that disc. If a future change makes the real-frames walk blind - a
 * different clock, a filter, a snapshot taken at the wrong moment - this goes
 * red here rather than going quiet on fourteen screens.
 *
 * Standards rule 9: when two causes produce identical output, run both.
 */
test("the real-frames pass can SEE a tween, which is what caught the fifth mechanism", async ({
  page,
}) => {
  test.slow();
  await boot(page, "Settings");
  await page.evaluate(() => {
    const kb = (
      window as unknown as {
        __kb: {
          game: {
            scene: {
              getScene(k: string): {
                add: {
                  circle(
                    x: number,
                    y: number,
                    r: number,
                    c: number,
                    a: number,
                  ): { setDepth(d: number): unknown };
                };
                tweens: { add(cfg: Record<string, unknown>): unknown };
              };
            };
          };
        };
      }
    ).__kb;
    const s = kb.game.scene.getScene("Settings");
    // A 4 px disc on the near-field depth: the same drawing the backdrop motes
    // were, so the classifier has to recognise it for the right reason.
    const probe = s.add.circle(400, 400, 4, 0xffffff, 0.6).setDepth(5);
    // Started from phase zero immediately before the probe runs, and short
    // enough that even the smallest window this pass accepts covers a
    // measurable part of it. The shipped defect was slower than this and was
    // still caught; the control is sized to the FLOOR, not to a good day.
    s.tweens.add({
      targets: probe,
      y: 300,
      duration: 1000,
      ease: "Sine.easeInOut",
      yoyo: true,
      repeat: -1,
    });
  });

  const live = await lightMotion(page, "Settings", 2000, true);
  expect(
    live.worldMsAdvanced,
    `the control only simulated ${live.worldMsAdvanced} ms`,
  ).toBeGreaterThan(120);
  expect(
    live.movedLights.length,
    "the real-frames pass cannot see a tweened point of light; every zero it reports is worthless",
  ).toBe(1);
  expect(live.movedLights[0]?.type).toBe("Arc");
  // The bar is "more than nothing", because that is exactly the property the
  // sweep above rests on: its own bar is zero, so a probe that can resolve any
  // displacement at all can resolve the one that matters. A larger number here
  // would only be measuring how good a day the machine is having.
  expect(
    Math.abs(live.movedLights[0]?.dy ?? 0),
    `the control moved ${live.movedLights[0]?.dy ?? 0} px in ${live.worldMsAdvanced} ms`,
  ).toBeGreaterThan(1);

  // ...and the stepped pass CANNOT see it, which is the whole reason the
  // real-frames pass exists. Measured rather than asserted from the docs: this
  // is the blind spot that let the fifth mechanism live on five screens.
  const stepped = await lightMotion(page, "Settings", 1200, false);
  expect(
    stepped.movedLights,
    "a tween became visible to the stepped pass; the note above is out of date",
  ).toEqual([]);
});
