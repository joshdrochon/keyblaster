import { expect, test, type Page } from "@playwright/test";
import { freezeReloads } from "./support/lane";

/**
 * SHADOW'S RENDERED VOICE, IN A REAL BROWSER (D63, D88; AC-21.4, AC-21.5).
 *
 * ================== WHY THIS FILE EXISTS ==================
 * The rendered lines shipped once already and were completely dead, in three
 * independent ways, none of which any test noticed:
 *
 *   1. NOTHING READ THEM. No module under `src/` referenced the mp3s at all.
 *   2. NOTHING SPOKE THEIR IDS. The 28 files were rendered against ids of the
 *      form `<stop>.<field>`, and the only scripted speak site in the game used
 *      `preflight.line.*`. The overlap was zero, so even a correct transport
 *      would have missed on every real line and silently fallen back.
 *   3. NOTHING SHIPPED THEM. `vite build` emits an asset only if something
 *      imports it, so `dist/` contained no mp3 and the feature would have 404'd
 *      in production while working in dev.
 *
 * Each of those is invisible to a unit test, because each is a property of the
 * REAL BUILD running in a REAL BROWSER. That is what this file checks, and it
 * is the only place any of it is checked.
 *
 * The audio element is faked - a headless browser decoding seven mp3s tells us
 * nothing and takes seconds - but everything above it is the shipped code: the
 * real manifest, the real bundler URLs, the real graph, the real scene.
 */

interface ClipRecord {
  src: string;
  plays: number;
}

/**
 * Replace `Audio` with a recorder that is STILL A REAL `HTMLAudioElement`.
 *
 * The first version of this fake was a plain class with the four members the
 * port declares, and it failed for a reason worth keeping: the live
 * `AudioContext.createMediaElementSource()` rejects anything that is not a real
 * media element, so the clip path fell back to Web Speech and `plays` stayed
 * zero - while the element had already been constructed, so a laxer assertion
 * would have called that a pass.
 *
 * So it SUBCLASSES `Audio`. The element is real, the `src` is the real bundled
 * URL and really loads, and the only thing overridden is `play()` - which
 * avoids both the autoplay policy and the cost of decoding an mp3 in a headless
 * browser, neither of which this test is about.
 */
async function fakeAudioElement(page: Page): Promise<void> {
  await freezeReloads(page);
  await page.addInitScript(() => {
    const clips: ClipRecord[] = [];
    (window as unknown as Record<string, unknown>)["__clips"] = clips;

    const RealAudio = window.Audio;

    class FakeAudio extends RealAudio {
      private readonly record: ClipRecord;

      constructor(source: string) {
        super();
        this.src = source;
        this.record = { src: this.src, plays: 0 };
        clips.push(this.record);
        (window as unknown as Record<string, unknown>)["__lastClip"] = this;
      }
      override play(): Promise<void> {
        this.record.plays += 1;
        return Promise.resolve();
      }
      /** The clip reaches its end. Drives the bus's "line finished". */
      end(): void {
        this.dispatchEvent(new Event("ended"));
      }
    }

    Object.defineProperty(window, "Audio", {
      value: FakeAudio,
      configurable: true,
      writable: true,
    });
  });
}

async function bootTitle(page: Page): Promise<void> {
  await page.goto("/?scene=Title");
  await expect(page.getByTestId("app")).toHaveAttribute("data-booted", "true");
  await page.waitForFunction(
    () => (window as unknown as { __kb?: { audio?: unknown } }).__kb?.audio !== undefined,
    null,
    { timeout: 60_000 },
  );
}

const clipIds = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const kb = (window as unknown as { __kb: Record<string, unknown> }).__kb;
    const audio = kb["audio"] as { graph: { voiceClipIds: string[] } };
    return [...audio.graph.voiceClipIds];
  });

const clips = (page: Page): Promise<ClipRecord[]> =>
  page.evaluate(() => (window as unknown as { __clips: ClipRecord[] }).__clips ?? []);

async function speak(page: Page, id: string, text: string): Promise<void> {
  await page.evaluate(
    ([lineId, lineText]) => {
      const kb = (window as unknown as { __kb: Record<string, unknown> }).__kb;
      const audio = kb["audio"] as {
        speak(l: { id: string; text: string; kind: string }): void;
      };
      audio.speak({ id: lineId as string, text: lineText as string, kind: "scripted" });
    },
    [id, text],
  );
}

test.describe("D63: Shadow's rendered lines reach the player", () => {
  test.setTimeout(120_000);

  test("the running game can play the rendered lines, by the ids scenes speak", async ({
    page,
  }) => {
    await fakeAudioElement(page);
    await bootTitle(page);

    const ids = await clipIds(page);
    // Not "some files exist" - the SPECIFIC ids the scenes hand to the bus.
    // This is the check whose absence let 28 unreachable files ship.
    expect(ids).toContain("mars.beaconHeadline");
    expect(ids).toContain("mars.beaconState");
    expect(ids).toContain("mars.beaconFlavor");
    expect(ids).toContain("earth.preflightLine");
    expect(ids.length).toBeGreaterThanOrEqual(28);
  });

  test("the urls are real bundled assets, not source paths", async ({ page }) => {
    await fakeAudioElement(page);
    await bootTitle(page);
    await speak(page, "mars.beaconFlavor", "The sun is smaller here.");

    const played = await clips(page);
    expect(played.length).toBe(1);
    expect(played[0]?.plays).toBe(1);
    // The url came from the bundler, so it resolves against the served origin.
    // A hand-built "src/content/..." string would 404 in a production build -
    // which is exactly what shipping these files without an import would do.
    expect(played[0]?.src).toMatch(/mars\.beaconFlavor/);
    expect(played[0]?.src).toMatch(/^https?:\/\//);

    // And it is really reachable over the wire, not merely well-formed.
    const url = played[0]!.src;
    const response = await page.request.get(url);
    expect(response.status()).toBe(200);
    expect(Number(response.headers()["content-length"] ?? "0")).toBeGreaterThan(1000);
  });

  test("a line with no rendered file falls through to the platform voice", async ({
    page,
  }) => {
    // A coach note is written at runtime and can never have a file. It must be
    // spoken, not swallowed.
    await fakeAudioElement(page);
    await bootTitle(page);
    await speak(page, "warp.coachNote", "Nice run, pilot.");

    expect(await clips(page)).toEqual([]);
    const history = await page.evaluate(() => {
      const kb = (window as unknown as { __kb: Record<string, unknown> }).__kb;
      const audio = kb["audio"] as { graph: { voice: { history(): { id: string }[] } } };
      return audio.graph.voice.history().map((l) => l.id);
    });
    expect(history).toEqual(["warp.coachNote"]);
  });

  test("AC-21.4: a rendered line ducks the live music bus, and releases", async ({
    page,
  }) => {
    // The whole reason for routing a clip through the graph instead of letting
    // an <audio> element play at the browser. Web Speech cannot do this - it
    // never enters the graph, so there is no bus for the sidechain to pull.
    //
    // POLLED, NOT SLEPT. The duck attack is 120 ms and the release 420 ms, but
    // this suite software-renders WebGL across three workers and the page can
    // be starved for far longer than either (see playwright.config.ts). A fixed
    // `waitForTimeout` here passed alone and failed in a full run, which is the
    // shape of flake that gets an assertion weakened rather than a wait fixed.
    await fakeAudioElement(page);
    await bootTitle(page);

    const musicGain = (): Promise<number> =>
      page.evaluate(() => {
        const kb = (window as unknown as { __kb: Record<string, unknown> }).__kb;
        const audio = kb["audio"] as {
          graph: { buses: { music: { gain: { value: number } } } };
        };
        return audio.graph.buses.music.gain.value;
      });

    const resting = await musicGain();
    expect(resting).toBeGreaterThan(0);

    await speak(page, "mars.beaconHeadline", "MARS BEACON");
    await page.waitForFunction(
      (rest) => {
        const kb = (window as unknown as { __kb: Record<string, unknown> }).__kb;
        const audio = kb["audio"] as {
          graph: { buses: { music: { gain: { value: number } } } };
        };
        return audio.graph.buses.music.gain.value < (rest as number) * 0.95;
      },
      resting,
      { timeout: 20_000 },
    );
    const ducked = await musicGain();

    // The clip ends; the world comes back to where it was, not to the shipped
    // default - that distinction is what `SidechainDucker.setBase` exists for.
    await page.evaluate(() => {
      (window as unknown as { __lastClip: { end(): void } }).__lastClip.end();
    });
    await page.waitForFunction(
      (low) => {
        const kb = (window as unknown as { __kb: Record<string, unknown> }).__kb;
        const audio = kb["audio"] as {
          graph: { buses: { music: { gain: { value: number } } } };
        };
        return audio.graph.buses.music.gain.value > (low as number) * 1.05;
      },
      ducked,
      { timeout: 20_000 },
    );
    expect(await musicGain()).toBeCloseTo(resting, 2);
  });

  test("the beacon screen speaks its line from a file", async ({ page }) => {
    // The emotional beat of the whole loop, and it was silent: the lines were
    // drawn and never spoken, so their renders could not be reached.
    //
    // ONE LINE, NOT THREE (1a839ee). The screen used to stitch "Mars Beacon" /
    // "placed" / the flavour line into something being read aloud. Every stop
    // now carries a written `beaconSpoken` sentence and speaks that instead,
    // so the clip to look for is `<stop>.beaconSpoken`.
    await fakeAudioElement(page);
    await page.goto("/?scene=Beacon&stop=mars");
    await expect(page.getByTestId("app")).toHaveAttribute("data-booted", "true");
    await page.waitForFunction(
      () => (window as unknown as { __kb?: { audio?: unknown } }).__kb?.audio !== undefined,
      null,
      { timeout: 60_000 },
    );

    // The lamp lights on a timer; the lines follow it, queued one at a time.
    await page.waitForFunction(
      () => (window as unknown as { __clips: ClipRecord[] }).__clips.length > 0,
      null,
      { timeout: 30_000 },
    );
    const played = await clips(page);
    expect(played[0]?.src).toMatch(/mars\.beaconSpoken/);

    const history = await page.evaluate(() => {
      const kb = (window as unknown as { __kb: Record<string, unknown> }).__kb;
      const audio = kb["audio"] as { graph: { voice: { history(): { id: string }[] } } };
      return audio.graph.voice.history().map((l) => l.id);
    });
    expect(history[0]).toBe("mars.beaconSpoken");
  });
});
