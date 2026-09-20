import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { bootScene, settle, type GameHandle } from "./support/lane";

/**
 * ============ THE SCREEN AFTER A BELT CHARGES A BEACON ============
 *
 * Two of the three claims in that recast are properties of the RENDERED FRAME
 * and cannot be had from a pure function, which is why they are here rather
 * than in `tests/unit/scenes/warpBeacon.test.ts`:
 *
 *   THE DESTINATION  the row above the sentence and the badge in the card's
 *                    corner have to name the stop the NEXT SCENE plants, and
 *                    at Pluto they have to exist at all - the old expression
 *                    ran off the end of the route there and drew neither.
 *   THE OUTLINE      is a TIMING defect. The focus ring was painted at full
 *                    alpha at the card's final rectangle while the card was
 *                    still transparent and 150 px lower, so the outline hung
 *                    in space until the slide caught up. No still frame taken
 *                    after the entrance shows it; the only way to see it is to
 *                    sample both objects across the frames of the entrance.
 *
 * Both read `__kb.warp`, which `WarpScene.publish()` already exposes.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EVIDENCE = join(REPO, "gauntlet", "evidence");

function writeEvidence(name: string, body: string | Buffer): void {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, name), body);
}

interface WarpBoxes {
  ring: { alpha: number; visible: boolean; active: boolean };
  panelAlpha: number;
}

const boxes = (page: Page): Promise<WarpBoxes> =>
  page.evaluate(
    () => (window as unknown as { __kb: { warp: { boxes(): WarpBoxes } } }).__kb.warp.boxes(),
  );

const texts = (page: Page): Promise<string[]> =>
  page.evaluate(
    () => (window as unknown as { __kb: { warp: { texts(): string[] } } }).__kb.warp.texts(),
  );

interface BeaconSnapshot {
  stopId: string;
  beaconStopId: string;
}

const snap = (page: Page): Promise<BeaconSnapshot> =>
  page.evaluate(
    () =>
      (
        window as unknown as { __kb: { warp: { snapshot(): BeaconSnapshot } } }
      ).__kb.warp.snapshot(),
  );

/**
 * Every stop with a belt. Earth has none (D57), so it never reaches this
 * screen; Pluto is in the sweep rather than exempted from it, because Pluto is
 * where the old expression returned nothing at all.
 */
const STOPS = ["mars", "jupiter", "saturn", "uranus", "neptune", "pluto"] as const;

/** The stop's display name, as the card spells it. */
const NAMES: Record<string, string> = {
  mars: "Mars",
  jupiter: "Jupiter",
  saturn: "Saturn",
  uranus: "Uranus",
  neptune: "Neptune",
  pluto: "Pluto",
};

test.describe("the beacon being charged is the stop the child is standing at", () => {
  test.setTimeout(120_000);

  for (const stop of STOPS) {
    test(`the row and the badge name ${stop}, not the stop after it`, async ({ page }) => {
      await bootScene(page, "Warp", "warp", `&stop=${stop}`);
      await settle(page);

      const s = await snap(page);
      // ONE ID FOR BOTH. `buildSentencePanel` draws the badge from
      // `beaconStopId()` and the row from the name of the same call, so the
      // picture and the word cannot disagree - and it is the id `cutToBeacon`
      // forwards to `BeaconScene`, which is what makes the charge become the
      // object the next screen plants.
      //
      // WATCHED FAILING, against the build before this change:
      //   at mars: expected 'jupiter' to be 'mars'      (row "Destination: Jupiter.")
      //   at neptune: expected 'pluto' to be 'neptune'  (row "Destination: Pluto.")
      //   at pluto: expected undefined to be 'pluto'    (no row, no badge)
      expect(s.beaconStopId, `${stop}: the badge is keyed off another stop`).toBe(stop);
      expect(s.stopId).toBe(stop);

      const visible = await texts(page);
      const row = visible.find((t) => t.startsWith("Charging:")) ?? null;
      expect(row, `${stop}: nothing above the sentence names a beacon`).not.toBeNull();
      expect(row).toBe(`Charging: ${NAMES[stop]} Beacon`);

      // NOTHING SAYS "DESTINATION" ANY MORE, which is the half a green
      // assertion on the new row would miss: the old line could still be on
      // screen beside the new one.
      expect(visible.filter((t) => /Destination|warp drive/i.test(t))).toEqual([]);

      writeEvidence(`beacon-charge-${stop}.png`, await page.screenshot());
    });
  }

  test("at Pluto the charged line still hands the beacon to the next scene", async ({
    page,
  }) => {
    // PLUTO IS THE CASE THE OLD CODE HAD NO ANSWER FOR. `nextStopId` was null
    // there, so the last stop of the game showed the generic prompt, no planet
    // badge, and a charged line that named nowhere. It now reads exactly like
    // every other stop, which is true: Pluto's beacon is the one that finishes
    // the map.
    await bootScene(page, "Warp", "warp", "&stop=pluto");
    await settle(page);

    const sentence = await page.evaluate(
      () =>
        (
          window as unknown as { __kb: { warp: { snapshot(): { sentence: string } } } }
        ).__kb.warp.snapshot().sentence,
    );
    await page.keyboard.type(sentence.slice(0, -1), { delay: 10 });
    // The last character starts the warp and the warp cuts to Beacon, so the
    // key is dispatched and the scene PAUSED in the same page turn - a paused
    // scene keeps rendering while the tween that ends in `cutToBeacon` does not
    // advance. (`warp-instrument.spec.ts` does the same, for the same reason.)
    await page.evaluate((ch: string) => {
      const game = (window as unknown as { __kb: Record<string, unknown> }).__kb[
        "game"
      ] as GameHandle & { scene: { pause(k: string): void } };
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      game.scene.pause("Warp");
    }, sentence.slice(-1));

    const visible = await texts(page);
    expect(
      visible.some((t) => t === "Beacon charged. Plant it at Pluto."),
      `nothing hands Pluto's beacon on: ${JSON.stringify(visible)}`,
    ).toBe(true);
    writeEvidence("beacon-charged-pluto.png", await page.screenshot());
  });
});

/**
 * ============ THE OUTLINE AND ITS BOX ARRIVE TOGETHER ============
 *
 * THE DEFECT, AS THE NUMBERS THAT FOUND IT. Sampled every animation frame from
 * the first frame of the overlaid entrance, in a served build:
 *
 *              ring.alpha   panelRoot.alpha
 *     +11 ms      1.000          0.000
 *     +33 ms      0.550          0.000
 *     +101 ms     1.000          0.376
 *     +199 ms     1.000          0.736
 *
 * and after the fix, from the same script:
 *
 *     +11 ms      0.000          0.000
 *     +95 ms      0.367          0.367
 *     +199 ms     0.700          0.700
 *
 * The cause is not the timing: the ring was never given the entrance at all.
 * It is created outside `panelRoot` so it draws OVER the card, `slideIn` only
 * touched `panelRoot`, and `createFocusRing.moveTo` plays its own arrival the
 * moment it is called - at the card's FINAL rectangle. So the outline was
 * complete, lit and in its resting place while the box was still transparent
 * and 150 px below it.
 *
 * WHY THE SCENE IS RESTARTED RATHER THAN BOOTED. The entrance is the OVERLAY
 * path (D30: Flight `launch`es this scene over itself and keeps running); a
 * `?scene=Warp` boot is standalone and has nothing to slide over, so it never
 * showed the defect. `restart({ overlay: true })` is the same `create` the
 * game runs, without a belt in front of it.
 */
test.describe("the yellow outline does not arrive before its box", () => {
  test.setTimeout(120_000);

  test("the ring fades in on the same beat as the panel", async ({ page }) => {
    await bootScene(page, "Warp", "warp", "&stop=mars");
    await settle(page);

    // The trace is collected IN THE PAGE: a round trip per frame is slower
    // than the 460 ms entrance it is measuring.
    await page.evaluate(() => {
      const w = window as unknown as {
        __trace: { ms: number; ring: number; panel: number }[];
        __raf: number;
        __t0: number;
        __kb: { warp: { boxes(): WarpBoxes }; game: GameHandle };
      };
      w.__trace = [];
      w.__t0 = performance.now();
      const tick = (): void => {
        try {
          const b = w.__kb.warp.boxes();
          w.__trace.push({
            ms: Math.round(performance.now() - w.__t0),
            ring: b.ring.alpha,
            panel: b.panelAlpha,
          });
        } catch {
          // Between `restart` and `create` the bag still points at objects the
          // old mount destroyed. Those frames are not measurements.
        }
        w.__raf = requestAnimationFrame(tick);
      };
      tick();
    });

    await page.evaluate(() => {
      const w = window as unknown as {
        __t0: number;
        __kb: { game: GameHandle };
      };
      w.__t0 = performance.now();
      w.__kb.game.scene.getScene("Warp").scene.restart({ stopId: "mars", overlay: true });
    });
    await page.waitForTimeout(1200);

    const trace = await page.evaluate(() => {
      const w = window as unknown as {
        __raf: number;
        __trace: { ms: number; ring: number; panel: number }[];
      };
      cancelAnimationFrame(w.__raf);
      return w.__trace;
    });

    // Only the entrance: after it, both are 1 and the claim is vacuous.
    const entrance = trace.filter((r) => r.ms > 20 && r.ms <= 460);
    expect(entrance.length, "the entrance was never sampled").toBeGreaterThan(4);

    // THE CLAIM. The outline may never be more visible than the box behind it.
    // A tolerance of 0.05 is one frame of a 460 ms tween, not a licence: the
    // measured gap in the defect was 0.62 at its widest.
    const early = entrance
      .filter((r) => r.ring - r.panel > 0.05)
      .map((r) => `${r.ms} ms: ring ${r.ring.toFixed(3)} / panel ${r.panel.toFixed(3)}`);
    expect(
      early,
      "the outline is lit before the box it is drawn around",
    ).toEqual([]);

    // And it really did fade in, rather than the test having watched a screen
    // that was already fully drawn.
    expect(Math.min(...entrance.map((r) => r.ring))).toBeLessThan(0.5);

    writeEvidence(
      "warp-beacon-entrance.json",
      `${JSON.stringify(
        { trace: trace.filter((r) => r.ms <= 700), capturedAt: new Date().toISOString() },
        null,
        2,
      )}\n`,
    );
  });

  test("a frame partway through the entrance shows both, or neither", async ({ page }) => {
    // The picture a human can look at, which is what closes a reported ticket.
    await bootScene(page, "Warp", "warp", "&stop=mars");
    await settle(page);
    await page.evaluate(() => {
      const w = window as unknown as { __kb: { game: GameHandle & { scene: { pause(k: string): void } } } };
      w.__kb.game.scene.getScene("Warp").scene.restart({ stopId: "mars", overlay: true });
      setTimeout(() => w.__kb.game.scene.pause("Warp"), 120);
    });
    await page.waitForTimeout(600);

    const b = await boxes(page);
    expect(b.ring.alpha, `ring ${b.ring.alpha} / panel ${b.panelAlpha}`).toBeLessThanOrEqual(
      b.panelAlpha + 0.05,
    );
    writeEvidence("warp-beacon-entrance-120ms.png", await page.screenshot());
  });
});
