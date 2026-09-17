import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bootFlight, flightState, spawnAt } from "./support/flightBoot.js";

/**
 * UR-33 - HIT STOP, AND THE ONE WAY IT COULD BE CATASTROPHIC.
 *
 * "when an asteroid is blocked or destroyed can we freeze the animation for a
 * couple frames" - Vlambeer's hit lag, and a good instinct: it makes a hit read
 * as something the ship pushed through instead of a sprite being switched off.
 *
 * ================== WHAT THIS SPEC IS REALLY FOR ==================
 * Not "does it freeze". That is the easy half and a screenshot would do it.
 *
 * This is a TYPING game. A hit stop implemented as a sleep, a busy-wait, or a
 * flag that any input handler consults would swallow keystrokes for two frames
 * on every single word - 58 times a belt, always at the exact moment the child
 * has finished one word and is starting the next, which is when they are
 * fastest. That defect is invisible to every assertion about freezing, it is
 * invisible in a screenshot, and a child would experience it as the game
 * randomly ignoring them.
 *
 * So the load-bearing test here types THROUGH the hold and counts the letters
 * that arrived.
 *
 * The keystrokes are dispatched inside the page rather than through Playwright,
 * and that is the point rather than a shortcut: the hold is 33 ms and a CDP
 * round trip on this box is measured in seconds, so driving it from the runner
 * could not land a key inside the window at all. The events go to the same
 * `window` "keydown" listener the browser feeds (`FlightScene.bindInput`), and
 * the spec asserts it is inside the hold when it types.
 */

test.use({ trace: "off" });

const EVIDENCE_DIR = resolve(process.cwd(), "gauntlet/evidence");

interface HoldProbe {
  readonly typedWord: string;
  readonly heldUntil: number;
  readonly atDispatch: number;
  readonly insideHold: boolean;
  readonly secondWord: string;
  readonly keysSent: number;
  readonly typedAfter: number;
  readonly offsetsAtHold: Record<string, number>;
  readonly offsetsDuringHold: Record<string, number>;
  readonly rockYAtHold: number | null;
  readonly rockYDuringHold: number | null;
}

test.describe("UR-33: the world holds, the player does not", () => {
  test("UR-33: typing through the hold loses nothing", async ({ page }) => {
    test.setTimeout(240_000);
    await bootFlight(page, {
      knobs: { maxLive: 5 },
      stageWordCount: 400,
      // Long falls, so the two rocks this needs are both still on the board
      // when the sequence runs, and neither breaches mid-measurement.
      calibration: { ikiMs: 4000, fkLatencyMs: 2000 },
      /**
       * LONG ENOUGH TO STILL BE HOLDING WHEN THE KEYS ARRIVE.
       *
       * The shipped hold is 33 ms. Everything below runs in one `page.evaluate`
       * with no awaits, but `__kbFlight.state()` builds a whole snapshot and at
       * 3 workers that call alone outlasts 33 ms - the full suite caught this
       * honestly, "the keys were dispatched at 3599.7 and the hold ran to
       * 3556", which is the precondition refusing to let the test claim it
       * typed during a hold it had already missed.
       *
       * Lengthening the window does not change what is being tested: the
       * question is whether a keystroke that lands DURING a hold reaches the
       * lock, and that is the same question at 33 ms and at 900 ms. The shipped
       * 33 ms is pinned by `tests/unit/flight/hitStop.test.ts` so this cannot
       * become the value players get.
       */
      hitStopMs: 900,
      seed: 0x3301,
    });

    // Two rocks with KNOWN, distinct-first-letter words. AC-2.1 guarantees
    // distinct first letters among live words, but not WHICH words, and this
    // sequence has to type one word exactly and then start another.
    await spawnAt(page, "dust", { x: 700, y: 120 });
    await spawnAt(page, "polar", { x: 1200, y: 120 });

    const probe = await page.evaluate((): HoldProbe => {
      const api = window.__kbFlight;
      if (api === undefined) throw new Error("no flight debug api");
      const key = (ch: string): void => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: ch,
            code: `Key${ch.toUpperCase()}`,
            bubbles: true,
          }),
        );
      };
      const first = "dust";
      const second = "polar";

      // 1. Destroy a rock: type the word, letter by letter, through the real
      // listener. The last letter is what fires the blast and starts the hold.
      for (const ch of first) key(ch);

      const state = api.state();
      const heldUntil = state.hitStopUntilMs;
      // Same clock the deadline is anchored to (`FlightScene`: performance.now()).
      const atDispatch = performance.now();
      const offsetsAtHold = { ...state.layerOffsets };
      const rockYAtHold = state.rocks.find((r) => r.word === second)?.y ?? null;

      // 2. TYPE THE NEXT WORD, right now, inside the hold. No awaits between
      // the blast and these keys: this is the same task, microseconds later,
      // which is exactly where a child's next keystroke lands.
      let keysSent = 0;
      for (const ch of second.slice(0, 3)) {
        key(ch);
        keysSent += 1;
      }
      const after = api.state();

      return {
        typedWord: first,
        heldUntil,
        atDispatch,
        insideHold: heldUntil > atDispatch,
        secondWord: second,
        keysSent,
        typedAfter: after.typed.length,
        offsetsAtHold,
        offsetsDuringHold: { ...after.layerOffsets },
        rockYAtHold,
        rockYDuringHold: after.rocks.find((r) => r.word === second)?.y ?? null,
      };
    });

    console.log("UR-33 hold probe:", JSON.stringify(probe));
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(
      join(EVIDENCE_DIR, "hit-stop.json"),
      `${JSON.stringify({ ticket: "UR-33", ...probe, source: "tests/e2e/hit-stop.spec.ts" }, null, 2)}\n`,
    );

    // THE PRECONDITION. If the blast did not start a hold, everything after
    // this is a test of ordinary typing and proves nothing about hit stop.
    expect(probe.heldUntil, "the blast did not start a hold").toBeGreaterThan(0);
    expect(
      probe.insideHold,
      `the keys were dispatched at ${probe.atDispatch} and the hold ran to ${probe.heldUntil}`,
    ).toBe(true);

    // THE ASSERTION. Every key typed during the hold reached the lock.
    expect(
      probe.typedAfter,
      `${probe.keysSent} keys were typed during the hold and ${probe.typedAfter} arrived`,
    ).toBe(probe.keysSent);
  });

  test("UR-33: the world stops and then starts again", async ({ page }) => {
    test.setTimeout(240_000);
    await bootFlight(page, {
      knobs: { maxLive: 5 },
      stageWordCount: 400,
      calibration: { ikiMs: 4000, fkLatencyMs: 2000 },
      // A HOLD THAT SPANS A FRAME ON THIS RENDERER. The shipped hold is 33 ms
      // and a headless page draws this scene at about 4.5 fps, so a shipped-
      // length hold is a seventh of one frame here and NO rendered frame ever
      // falls inside it - the first run of this test measured a frame 220 ms
      // after the blast and correctly reported the world had moved. Lengthening
      // it is the only way this environment can observe the behaviour at all;
      // `tests/unit/flight/hitStop.test.ts` pins the shipped 33 ms so this
      // cannot become the value players get.
      hitStopMs: 900,
      seed: 0x3302,
    });
    await spawnAt(page, "dust", { x: 700, y: 120 });
    await spawnAt(page, "polar", { x: 1200, y: 200 });

    const result = await page.evaluate(async () => {
      const api = window.__kbFlight;
      const game = window.__kbGame as unknown as {
        events: { on(e: string, f: () => void): void; off(e: string, f: () => void): void };
      };
      if (api === undefined) throw new Error("no flight debug api");
      const sample = (): { y: number | null; sky: number } => ({
        y: api.state().rocks.find((r) => r.word === "polar")?.y ?? null,
        sky: api.state().layerOffsets["nearField"] ?? 0,
      });
      const frame = (): Promise<void> =>
        new Promise((res) => {
          const on = (): void => {
            game.events.off("postrender", on);
            res();
          };
          game.events.on("postrender", on);
        });

      // Moving before.
      const a = sample();
      await frame();
      const b = sample();

      for (const ch of "dust") {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true }));
      }
      // The frame drawn while the hold is on.
      const held0 = sample();
      await frame();
      const held1 = sample();

      // ...and moving again afterwards. Waited out by the scene's OWN clock
      // rather than by a sleep the spec guesses at: the first version slept
      // 250 ms against a 900 ms hold and reported that the world never
      // restarted, which was true and was a fact about the sleep.
      const heldUntil = api.state().hitStopUntilMs;
      for (let i = 0; i < 300 && performance.now() <= heldUntil; i += 1) await frame();
      await frame();
      const c = sample();
      await frame();
      const d = sample();
      return { a, b, held0, held1, c, d };
    });

    console.log("UR-33 world hold:", JSON.stringify(result));

    // Before: the world is moving, so this test can tell moving from held.
    expect(
      Math.abs((result.b.y ?? 0) - (result.a.y ?? 0)) + Math.abs(result.b.sky - result.a.sky),
      "the world was not moving before the blast, so 'held' means nothing",
    ).toBeGreaterThan(0);

    // During: the rock does not fall and the near plane does not scroll.
    expect(result.held1.y, "a rock kept falling during the hold").toBe(result.held0.y);
    expect(result.held1.sky, "the parallax kept scrolling during the hold").toBe(result.held0.sky);

    // After: it starts again. A hold that never ends is a frozen game, and a
    // deadline that is never cleared is exactly how that would happen.
    expect(
      Math.abs((result.d.y ?? 0) - (result.c.y ?? 0)) + Math.abs(result.d.sky - result.c.sky),
      "the world never started moving again",
    ).toBeGreaterThan(0);
  });

  test("UR-33 / D31: taking a hull hit does NOT freeze the game", async ({ page }) => {
    test.setTimeout(240_000);
    await bootFlight(page, {
      knobs: { maxLive: 2 },
      stageWordCount: 58,
      calibration: { ikiMs: 4000, fkLatencyMs: 2000 },
      seed: 0x3303,
    });

    // The player asked for a hold on "blocked or destroyed". Destroyed is a
    // reward and a hold suits it; blocked is a hull strike, and holding the
    // whole game on the player's mistake is emphasis on the mistake - D31 and
    // AC-22b.1 both push the other way. This is that decision, asserted.
    const before = await flightState(page);
    await page.evaluate(() => window.__kbFlight?.strike());
    const after = await flightState(page);

    expect(after.hull, "the strike did not land").toBeLessThan(before.hull);
    expect(
      after.hitStopUntilMs,
      "a hull strike froze the game; D31 says the ship takes the knock, not the player",
    ).toBe(before.hitStopUntilMs);
  });
});
