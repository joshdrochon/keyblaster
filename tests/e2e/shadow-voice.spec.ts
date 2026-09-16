import { expect, test, type Page } from "@playwright/test";
import { freezeReloads } from "./support/lane";

/**
 * AC-21.5 / D88: SHADOW ACTUALLY SPEAKS.
 *
 * The bug: the game was mute in a real browser even though the voice bus, the
 * ducker, the transports and the coach-note path were all correct and all
 * unit-tested. `createVoiceTransport` ran ONCE, inside `buildAudioGraph`, at
 * boot - and on Chrome `speechSynthesis.getVoices()` returns an EMPTY ARRAY
 * until the platform has loaded its voice list and fired `voiceschanged`, a
 * few milliseconds later. So `available()` was false at exactly the one moment
 * anybody asked, the graph captured the SILENT transport for the whole
 * session, and every line Shadow ever said went to a `setTimeout`.
 *
 * No unit test could catch it: a fake port answers `voices()` synchronously,
 * which is the one thing the real platform does not do. So the fake here
 * reproduces the real timing - empty first, populated on `voiceschanged` - and
 * the test is about the transport CHANGING ITS MIND, which is the fix.
 *
 * The other half is AC-21.5's no-network-TTS guarantee. Chrome's "Google ..."
 * and Edge's "... Online (Natural)" voices are rendered on a SERVER; speaking
 * through one is a runtime network TTS call made by the browser on our behalf.
 * A cloud-only machine must therefore stay unspoken - but it must not be
 * SILENT, so the line degrades to a chirp. Both are asserted.
 */

interface SpokenRecord {
  text: string;
  voice: string | null;
}

interface VoiceSpec {
  name: string;
  lang: string;
  localService: boolean;
  default?: boolean;
}

const MAC_LOCAL: VoiceSpec[] = [
  { name: "Google US English", lang: "en-US", localService: false, default: true },
  { name: "Alex", lang: "en-US", localService: true },
  { name: "Samantha", lang: "en-US", localService: true },
];

const CLOUD_ONLY: VoiceSpec[] = [
  { name: "Google US English", lang: "en-US", localService: false, default: true },
  { name: "Google UK English Female", lang: "en-GB", localService: false },
];

/**
 * Install a fake Web Speech API that behaves the way Chrome's does.
 *
 * The list starts EMPTY and stays empty until the test calls
 * `window.__loadVoices()`. That window is where the real bug lived, and boot
 * happens inside it.
 *
 * Driven by the test rather than by a timer on purpose. A `setTimeout` would
 * make "were the voices still loading when the game booted?" a question about
 * how fast the machine is, and this suite already software-renders WebGL on a
 * shared box - the one run where boot is slow would quietly stop testing the
 * bug while still passing.
 */
async function fakeSpeech(page: Page, voices: VoiceSpec[]): Promise<void> {
  await freezeReloads(page);
  await page.addInitScript(
    (list: VoiceSpec[]) => {
      const spoken: SpokenRecord[] = [];
      let live: VoiceSpec[] = [];
      const listeners: Array<() => void> = [];

      const synth = {
        getVoices: () => live,
        speak(utterance: { text: string; voice: { name: string } | null }) {
          spoken.push({
            text: utterance.text,
            voice: utterance.voice === null ? null : utterance.voice.name,
          });
        },
        cancel() {},
        addEventListener(type: string, listener: () => void) {
          if (type === "voiceschanged") listeners.push(listener);
        },
      };

      class FakeUtterance {
        voice: unknown = null;
        lang = "";
        rate = 1;
        pitch = 1;
        volume = 1;
        onend: unknown = null;
        onerror: unknown = null;
        constructor(public text: string) {}
      }

      // `window.speechSynthesis` is a READONLY accessor on Window.prototype, so
      // a plain assignment fails silently and the test then measures the real
      // browser instead of the fixture. `defineProperty` is not tidiness here,
      // it is the difference between a test and a placebo.
      Object.defineProperty(window, "speechSynthesis", {
        value: synth,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(window, "SpeechSynthesisUtterance", {
        value: FakeUtterance,
        configurable: true,
        writable: true,
      });
      (window as unknown as Record<string, unknown>)["__spoken"] = spoken;

      // The Chrome behaviour: the list arrives late, and only then does the
      // event fire. Anything that decided before this point decided on [].
      (window as unknown as Record<string, unknown>)["__loadVoices"] = () => {
        live = list;
        for (const listener of listeners) listener();
      };
    },
    voices,
  );
}

/** The platform finishes loading its voice list. Nothing in the game reboots. */
async function loadVoices(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __loadVoices(): void }).__loadVoices();
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

/** The transport the live audio service would use for a line RIGHT NOW. */
async function transportId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const kb = (window as unknown as { __kb: Record<string, unknown> }).__kb;
    const audio = kb["audio"] as { graph: { voice: { transportId: string } } };
    return audio.graph.voice.transportId;
  });
}

/** Say a line the way `PreflightScene.say` and `WarpScene.showNote` do. */
async function speak(page: Page, text: string): Promise<void> {
  await page.evaluate((line) => {
    const kb = (window as unknown as { __kb: Record<string, unknown> }).__kb;
    const audio = kb["audio"] as {
      speak(l: { id: string; text: string; kind: string }): void;
    };
    audio.speak({ id: "test.line", text: line, kind: "scripted" });
  }, text);
}

async function spoken(page: Page): Promise<SpokenRecord[]> {
  return page.evaluate(
    () => (window as unknown as { __spoken: SpokenRecord[] }).__spoken ?? [],
  );
}

async function sfxCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const kb = (window as unknown as { __kb: Record<string, unknown> }).__kb;
    const audio = kb["audio"] as { graph: { sfx: { history(): unknown[] } } };
    return audio.graph.sfx.history().length;
  });
}

test.describe("AC-21.5: Shadow speaks through the system voice", () => {
  test.setTimeout(120_000);

  test("AC-21.5: a voice list that arrives AFTER boot is still used", async ({
    page,
  }) => {
    await fakeSpeech(page, MAC_LOCAL);
    await bootTitle(page);

    // The graph was built while `getVoices()` was empty - the exact condition
    // that made the shipped game mute. There is genuinely no voice yet, and
    // the honest answer is silence.
    expect(await transportId(page)).toBe("silent");

    // The platform finishes loading. NOTHING in the game is rebuilt.
    await loadVoices(page);

    // ...and the very next line goes to the platform. This is the regression:
    // before the fix this still said "silent" forever.
    expect(await transportId(page)).toBe("webspeech");

    await speak(page, "Course locked, pilot.");
    const said = await spoken(page);
    expect(said.length).toBe(1);
    expect(said[0]?.text).toBe("Course locked, pilot.");

    // AC-21.5: the chosen voice is a LOCAL one, and specifically the top of the
    // macOS preference list - not the platform default, which in this fixture
    // is the cloud voice.
    expect(said[0]?.voice).toBe("Samantha");
  });

  test("AC-21.5: a cloud-only machine is never spoken through, and chirps instead", async ({
    page,
  }) => {
    // Every voice on this machine is rendered on a server. Speaking through one
    // would be a runtime network TTS call, which AC-21.5 forbids outright.
    await fakeSpeech(page, CLOUD_ONLY);
    await bootTitle(page);
    await loadVoices(page);

    // The voices loaded, and the transport STILL refuses them.
    expect(await transportId(page)).toBe("silent");

    const before = await sfxCount(page);
    await speak(page, "Mars ahead.");

    // Nothing reached the platform: zero network TTS.
    expect(await spoken(page)).toEqual([]);

    // But the game did not silently do nothing either - the line chirped, so
    // the player still gets "he said something" (D31: a chirp, never a failure
    // sound).
    expect(await sfxCount(page)).toBeGreaterThan(before);
  });

  test("AC-21.6: the line renders whether or not it is spoken", async ({ page }) => {
    // The display is the source of truth and must not branch on audio. Same
    // screen, no speech API at all.
    await freezeReloads(page);
    await page.addInitScript(() => {
      Object.defineProperty(window, "speechSynthesis", {
        value: undefined,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(window, "SpeechSynthesisUtterance", {
        value: undefined,
        configurable: true,
        writable: true,
      });
    });
    await bootTitle(page);

    expect(await transportId(page)).toBe("silent");

    // The bus still accepts the line and still records it, so ducking and the
    // "Shadow is talking" beat happen identically with and without a voice.
    await speak(page, "Nothing to hear here.");
    const history = await page.evaluate(() => {
      const kb = (window as unknown as { __kb: Record<string, unknown> }).__kb;
      const audio = kb["audio"] as {
        graph: { voice: { history(): { text: string }[] } };
      };
      return audio.graph.voice.history().map((l) => l.text);
    });
    expect(history).toContain("Nothing to hear here.");
  });
});
