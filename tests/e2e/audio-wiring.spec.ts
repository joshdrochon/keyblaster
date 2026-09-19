/**
 * AUDIO WIRING - the evidence that the game is not silent.
 *
 * WHY THIS FILE EXISTS. `gauntlet/evidence/audio-graph.json` is produced by
 * `buildAudioEvidence`, which builds a graph on a null context INSIDE A UNIT
 * TEST. Every number in it is real, and not one of them can tell the difference
 * between an audio system the game plays through and an audio system nothing
 * imports. That is exactly what happened: A-21.1 .. A-21.5 were green while
 * `createAudioSystem()` had no caller outside its own test (audit.md 1.2).
 *
 * So this file measures the OTHER half, and it can only be measured here:
 *
 *   1. a REAL boot (`src/main.ts` -> `bootGame`) produces an audio system, on a
 *      real browser `AudioContext`, published where scenes look for it;
 *   2. a REAL flight cue - a child pressing a key, through FlightScene's own
 *      `cue()` - produces a scheduled sound on that graph;
 *   3. all ten of AC-21.3's events are reached BY GAME CODE. Every play the
 *      wiring routes is tagged with the call site that caused it
 *      (`flight-cue:blast`, `ui:nav`, `warp-scene:jump`, `beacon-scene:lit`),
 *      and the artifact reports those tags. A tag can only be produced by the
 *      code that carries it, so this cannot be satisfied by a table;
 *   4. the master bus actually moves air: an AnalyserNode on the live graph
 *      reads silence before the burst and signal during it.
 *
 * The scenes are driven the way a player drives them - real keydown events,
 * real scene transitions - and nothing test-only was added to any of them to
 * make it work.
 *
 * SERIAL, one worker: the tests share one accumulated artifact and `afterAll`
 * writes it. A test that fails leaves its section missing rather than faked,
 * which makes the rubric report the failure instead of hiding it.
 */

import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { missingEvidenceFields } from "./lib/evidenceCompleteness.js";
import { join, resolve } from "node:path";

test.use({
  trace: "off",
  launchOptions: {
    // Headless Chromium suspends every AudioContext until a gesture. The game
    // handles that correctly (boot resumes on the first keydown), but the
    // analyser measurement below needs the context running from the start, and
    // waiting for a gesture inside the page would make the measurement depend
    // on when the harness happened to press a key.
    args: ["--autoplay-policy=no-user-gesture-required"],
  },
});

test.describe.configure({ mode: "serial", timeout: 240_000 });

const EVIDENCE_DIR = resolve(process.cwd(), "gauntlet/evidence");
const ARTIFACT = "audio-wiring.json";

/** float32 rounding on a real `AudioParam`, in dB. See the AC-21.4 test. */
const FLOAT32_DB_SLOP = 1e-3;

/** The ten events AC-21.3 names. Restated here so the spec is self-contained. */
const TEN_EVENTS = [
  "lock",
  "keystroke",
  "typo",
  "blast",
  "hit",
  "shield",
  "warpCharge",
  "warp",
  "beacon",
  "uiNav",
] as const;

interface WiringSnapshot {
  registryKey: string;
  buses: string[];
  contextKind: string;
  played: Record<string, number>;
  reachedVia: Record<string, string[]>;
  cuesRouted: string[];
  recent: {
    event: string;
    variant: string;
    peakGain: number;
    startHz: number;
    ctxTime: number;
    via: string;
  }[];
  sfxPlays: number;
  toneSteps: number;
  ambientStops: string[];
  ambientCrossfades: number;
  musicIndices: number[];
  hudSamples: number;
  musicIndex: number;
  musicStops: string[];
  musicTrackIds: string[];
  musicTrack: string | null;
  musicSource: string;
  frames: number;
  advancedMs: number;
  spoken: { id: string; kind: string }[];
  voiceTransport: string;
  coachNoteOrder: string[];
  busGains: Record<string, number>;
  volumes: { music: number; sfx: number };
}

/**
 * Everything the run observed. Accumulated across the serial tests and written
 * once. Keys are read literally by tests/gauntlet/rubric.mjs.
 */
/**
 * MERGE INTO AN EVIDENCE KEY, NEVER OVERWRITE IT (A-21.2).
 *
 * Two specs in this file legitimately have something to say about `music`: spec
 * 3 measures the intensity index against the live HUD stream, spec 10 proves
 * the composed track was really fetched and decoded. Spec 10 ran later and
 * assigned `evidence["music"] = { stop, source, ... }`, which DELETED
 * `hudSamples`, `indicesObserved` and `drivenBy` - the three fields rubric item
 * A-21.2 reads. So A-21.2 failed its wired predicate while the feature worked
 * perfectly: the index moves, and the evidence of it was being overwritten
 * before the file was written.
 *
 * It had happened once before and been patched in place - `voice` spreads its
 * previous value at the second write site - which is how a hazard survives to
 * bite a second key. This is the structural version: every writer merges, so no
 * spec can silently drop another's fields whatever order they run in.
 */
function record(key: string, fields: Record<string, unknown>): void {
  const previous = (evidence[key] ?? {}) as Record<string, unknown>;
  evidence[key] = { ...previous, ...fields };
  for (const [field, value] of Object.entries(fields)) {
    if (value !== undefined) everWritten.add(`${key}.${field}`);
  }
}

/**
 * Every `key.field` any spec has successfully written, whether or not it
 * survived to the artifact.
 *
 * This is what lets the completeness check below say WHICH of two
 * indistinguishable failures happened. A field can be missing because the spec
 * that owns it never reached its write - it threw on a precondition upstream -
 * or because it was written and something removed it afterwards. The symptom is
 * identical and the fixes are opposite: the first is a broken fixture in one
 * spec, the second is the clobbering bug that hid long enough to eat two keys.
 * Recording the write makes them tell themselves apart.
 */
const everWritten = new Set<string>();

const evidence: Record<string, unknown> = {
  generatedBy: "tests/e2e/audio-wiring.spec.ts",
  note:
    "Measured on a real bootGame() in Chromium. Every 'via' tag was produced " +
    "by the game code that made the call, not by this file.",
};

/** Merge per-event observations from several scenes into one table. */
const eventsSeen: Record<string, { count: number; via: string[] }> = {};

function recordEvents(snap: WiringSnapshot): void {
  for (const event of TEN_EVENTS) {
    const entry = (eventsSeen[event] ??= { count: 0, via: [] });
    entry.count += snap.played[event] ?? 0;
    for (const via of snap.reachedVia[event] ?? []) {
      if (!entry.via.includes(via)) entry.via.push(via);
    }
  }
}

test.afterAll(() => {
  evidence["events"] = eventsSeen;
  evidence["eventsReached"] = TEN_EVENTS.filter(
    (e) => (eventsSeen[e]?.count ?? 0) > 0 && (eventsSeen[e]?.via.length ?? 0) > 0,
  );
  /**
   * THE ARTIFACT MUST STILL CARRY WHAT THE RUBRIC READS (A-21.2).
   *
   * A-21.2's wired predicate failed for weeks against a working feature, because
   * a later spec assigned over `evidence["music"]` and deleted the three fields
   * it reads. `record()` merges now, so it cannot happen the same way - but the
   * reason it went unnoticed is that NOTHING checked the artifact was complete
   * before writing it. This does. It names the fields rather than running the
   * rubric, because a missing field and a failing threshold are different
   * problems and only the first one is this file's fault.
   */
  const missing = missingEvidenceFields({
    evidence,
    everWritten,
    required: {
      music: {
        owner: "spec 3, 'a real flight cue produces a scheduled sound'",
        fields: ["drivenBy", "hudSamples", "indicesObserved"],
      },
      ambient: {
        owner: "spec 3, 'a real flight cue produces a scheduled sound'",
        fields: ["stops", "crossfades", "crossfadedOnSceneTransition"],
      },
      flightCue: {
        owner: "spec 3, 'a real flight cue produces a scheduled sound'",
        fields: ["cuesRouted", "distinctCues"],
      },
      voice: { owner: "spec 2, 'the boot graph is published'", fields: ["transport"] },
    },
  });

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(join(EVIDENCE_DIR, ARTIFACT), `${JSON.stringify(evidence, null, 2)}\n`);

  // Written first, then asserted: a partial artifact is more useful to read
  // than none, and the rubric will report it honestly either way.
  expect(
    missing.map((m) => m.detail),
    "evidence fields the audio rubric reads went missing",
  ).toEqual([]);
});

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

/** Vite's HMR client, stubbed. A reload mid-flight is not a product behaviour. */
async function muteHmr(page: Page): Promise<void> {
  await page.route("**/@vite/client", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: [
        "export const createHotContext = () => ({ accept(){}, acceptExports(){}, dispose(){}, prune(){}, decline(){}, invalidate(){}, on(){}, off(){}, send(){}, data:{} });",
        "export const updateStyle = () => {};",
        "export const removeStyle = () => {};",
        "export const injectQuery = (url) => url;",
        "export const ErrorOverlay = class {};",
      ].join("\n"),
    }),
  );
}

/** The real entry point, then wait for boot to finish. Nothing is stubbed. */
async function bootReal(page: Page, query = ""): Promise<void> {
  await muteHmr(page);
  await page.goto(`/${query}`);
  await expect(page.getByTestId("app")).toHaveAttribute("data-booted", "true", {
    timeout: 30_000,
  });
  await page.waitForFunction(
    () =>
      (window as unknown as { __kb?: { audio?: unknown } }).__kb?.audio !== undefined &&
      (window as unknown as { __kb?: { audio?: unknown } }).__kb?.audio !== null,
    null,
    { timeout: 30_000 },
  );
}

const snap = (page: Page): Promise<WiringSnapshot> =>
  page.evaluate(
    () =>
      (
        window as unknown as { __kb: { audio: { snapshot(): WiringSnapshot } } }
      ).__kb.audio.snapshot(),
  );

/** Dispatch a real keydown on window - the listener every scene binds. */
async function typeText(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => {
    for (const ch of value as string) {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: ch, code: `Key${ch.toUpperCase()}`, bubbles: true }),
      );
    }
  }, text);
}

// ---------------------------------------------------------------------------
// 1. A real boot produces an audio system
// ---------------------------------------------------------------------------

test("D62 / audit.md 1.2: a real game boot produces a live audio system on a real AudioContext", async ({
  page,
}) => {
  await bootReal(page);

  const boot = await page.evaluate(() => {
    const kb = (window as unknown as {
      __kb: {
        game: { registry: { get(k: string): unknown } };
        services: { audio: unknown };
        audio: {
          graph: { ctx: AudioContext; buses: Record<string, GainNode> };
          snapshot(): WiringSnapshot;
        };
      };
    }).__kb;
    const audio = kb.audio;
    const ctx = audio.graph.ctx;
    const s = audio.snapshot();
    return {
      // The same object in all three places a scene could look for it.
      onDebugBag: audio !== undefined && audio !== null,
      onServices: kb.services.audio === audio,
      onRegistry: kb.game.registry.get("kb.audio") === audio,
      registryKey: s.registryKey,
      buses: s.buses,
      contextKind: s.contextKind,
      contextState: ctx.state,
      sampleRate: ctx.sampleRate,
      // A real context's clock runs; a stand-in's does not have to.
      currentTime: ctx.currentTime,
      destinationConnected: audio.graph.buses["master"] !== undefined,
      framesAdvanced: s.frames,
      ambientStops: s.ambientStops,
      voiceTransport: s.voiceTransport,
      // Headless Chromium ships no speech synthesis, so the voice path falls
      // back to the silent transport here. That is the D88 fallback working,
      // not a wiring gap - and recording WHY keeps "silent" from reading as a
      // defect. Which transport a real player gets is measured with the
      // platform voice list in audio-graph.json (A-21.5).
      speechApiPresent:
        typeof (window as unknown as Record<string, unknown>)["speechSynthesis"] !==
        "undefined",
    };
  });

  expect(boot.onDebugBag).toBe(true);
  expect(boot.onServices).toBe(true);
  expect(boot.onRegistry).toBe(true);
  expect(boot.registryKey).toBe("kb.audio");
  expect(boot.buses).toEqual(["master", "music", "ambient", "sfx", "voice"]);
  // The decisive one: a null context would name itself here.
  expect(boot.contextKind).toMatch(/AudioContext/);
  expect(boot.contextKind).not.toBe("NullAudioContext");
  expect(boot.sampleRate).toBeGreaterThan(8000);

  // The frame driver is running: the graph is being advanced by the game, not
  // by anything in this file.
  await page.waitForTimeout(600);
  const after = await snap(page);
  expect(after.frames).toBeGreaterThan(boot.framesAdvanced);
  expect(after.advancedMs).toBeGreaterThan(0);
  // Earth's bed opens the game (AC-21.1).
  expect(after.ambientStops[0]).toBe("earth");

  evidence["boot"] = { ...boot, framesAfterASecond: after.frames };
  record("voice", {
    transport: after.voiceTransport,
    browserSpeechApiPresent: boot.speechApiPresent,
  });
});

// ---------------------------------------------------------------------------
// 2. UI nav
// ---------------------------------------------------------------------------

test("AC-21.3 uiNav: menu movement is audible, and the master bus moves air", async ({
  page,
}) => {
  await bootReal(page, "?scene=Title");
  // The title screen is the first thing a player touches and it rolls its own
  // keyboard list, so it is the honest place to prove menu movement is audible.
  await page.waitForFunction(
    () => {
      const game = (window as unknown as {
        __kb: { game: { scene: { getScenes(active: boolean): { scene: { key: string } }[] } } };
      }).__kb.game;
      return game.scene.getScenes(true).some((s) => s.scene.key === "Title");
    },
    null,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(600);

  const before = await snap(page);

  // An AnalyserNode on the LIVE master bus. This is the only measurement in the
  // suite that answers "did anything actually come out", as opposed to "was
  // something scheduled".
  await page.evaluate(() => {
    const kb = (window as unknown as {
      __kb: { audio: { graph: { ctx: AudioContext; buses: Record<string, GainNode> } } };
    }).__kb;
    const ctx = kb.audio.graph.ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    kb.audio.graph.buses["master"]!.connect(analyser);
    (window as unknown as Record<string, unknown>)["__kbAnalyser"] = analyser;
  });

  const readRms = (): Promise<number> =>
    page.evaluate(() => {
      const analyser = (window as unknown as Record<string, unknown>)[
        "__kbAnalyser"
      ] as AnalyserNode;
      const buffer = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (const sample of buffer) sum += sample * sample;
      return Math.sqrt(sum / buffer.length);
    });

  // Walk the menu with the keyboard only (D37). Each move is a `uiNav`.
  let peak = 0;
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("ArrowDown");
    peak = Math.max(peak, await readRms());
  }

  const after = await snap(page);
  recordEvents(after);

  expect(after.played["uiNav"]).toBeGreaterThan(before.played["uiNav"] ?? 0);
  expect(after.reachedVia["uiNav"]).toContain("ui:nav");

  record("uiNav", {
    playsBefore: before.played["uiNav"] ?? 0,
    playsAfter: after.played["uiNav"],
    via: after.reachedVia["uiNav"],
    // The bed is running under this, so "silence" is not the baseline; what
    // matters is that the bus carries signal at all.
    masterRmsPeak: peak,
    audible: peak > 0,
  });
});

// ---------------------------------------------------------------------------
// 3. Flight cues
// ---------------------------------------------------------------------------

test("AC-6e.2 / AC-21.1 / AC-21.2 / AC-21.3: a real flight cue produces a scheduled sound on the live graph", async ({
  page,
}) => {
  await bootReal(page);

  // Start the REAL FlightScene inside the REAL boot game. `debug` opens the
  // measurement surface the flight lane already ships; it changes no gameplay.
  await page.evaluate(() => {
    const kb = (window as unknown as {
      __kb: { game: { scene: { start(key: string, data?: unknown): void } } };
    }).__kb;
    kb.game.scene.start("Flight", {
      stopId: "mars",
      debug: true,
      seed: 20260916,
      stageWordCount: 40,
      stageDurationMs: 300_000,
      knobs: { maxLive: 4 },
    });
  });
  await page.waitForFunction(
    () => (window.__kbFlight?.state().rocks.length ?? 0) > 0,
    null,
    { timeout: 40_000 },
  );

  const before = await snap(page);
  expect(before.cuesRouted.length).toBe(0);

  // --- keystroke + lock + blast, by typing a word that is on screen ---------
  const word = await page.evaluate(() => window.__kbFlight?.words()[0] ?? "");
  expect(word.length).toBeGreaterThan(0);
  await typeText(page, word);

  // --- typo: lock a word, then press a letter that is not its next one ------
  // A typo is only a typo once a word is locked; an unmatched key with nothing
  // locked is `ignored`, which is a different cue and a different sound (D31).
  //
  // WAIT FOR THE ROCK, DO NOT WAIT FOR A CLOCK. This used to be
  // `waitForTimeout(400)` and then a single read of `words()`, and it returned
  // null on a real run: the word just typed BLASTS its rock, and the belt can
  // be empty - or hold only a one-letter word - for longer than 400 ms while
  // the next one spawns and falls into frame. The spec then bailed before
  // writing the evidence fields it owns, which is what turned A-21.2 red.
  //
  // Same shape as the V-22.4 probe, and the same fix: wait for the OBJECT. The
  // assertion below is unchanged and still fails loudly if no rock ever
  // arrives - a spec that quietly skipped its own cue would be worse than one
  // that fails.
  await page.waitForFunction(
    () => (window.__kbFlight?.words() ?? []).filter((w) => w.length >= 2).length > 0,
    null,
    { timeout: 40_000 },
  );
  const typoInput = await page.evaluate(() => {
    const words = (window.__kbFlight?.words() ?? []).filter((w) => w.length >= 2);
    const target = words[0];
    if (target === undefined) return null;
    const press = (key: string): void => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key, code: `Key${key.toUpperCase()}`, bubbles: true }),
      );
    };
    press(target[0]!);
    const wrong = "abcdefghijklmnopqrstuvwxyz"
      .split("")
      .find((c) => c !== target[1]!.toLowerCase());
    press(wrong ?? "q");
    return { target, wrong };
  });
  expect(typoInput).not.toBeNull();
  // Wait for the CUE, not for a clock: the thing this step exists to produce.
  await page.waitForFunction(
    () => {
      const audio = (window as unknown as {
        __kb: { audio: { snapshot(): { played: Record<string, number> } } };
      }).__kb.audio;
      return (audio.snapshot().played["typo"] ?? 0) > 0;
    },
    null,
    { timeout: 20_000 },
  );

  // --- shield: promote a rock to a canister and blast it -------------------
  // `makeCanister()` promotes the oldest live rock, so it returns null when the
  // belt is momentarily empty - the same precondition that broke the typo step.
  // Wait for a rock first; after that, null can only mean the debug surface is
  // closed, which is a defect rather than a timing accident.
  await page.waitForFunction(
    () => (window.__kbFlight?.words() ?? []).length > 0,
    null,
    { timeout: 40_000 },
  );
  const canister = await page.evaluate(() => window.__kbFlight?.makeCanister() ?? null);
  expect(canister, "makeCanister returned null with a rock on the belt").not.toBeNull();
  await typeText(page, canister as string);
  await page.waitForTimeout(400);

  // --- hit: stop typing and let one rock reach the hull ---------------------
  await page.waitForFunction(
    () => {
      const audio = (window as unknown as {
        __kb: { audio: { snapshot(): { played: Record<string, number> } } };
      }).__kb.audio;
      return (audio.snapshot().played["hit"] ?? 0) > 0;
    },
    null,
    { timeout: 90_000 },
  );

  const after = await snap(page);
  recordEvents(after);

  // The cue stream reached the bus.
  expect(after.cuesRouted.length).toBeGreaterThan(0);
  expect(after.sfxPlays).toBeGreaterThan(0);
  expect(after.played["keystroke"]).toBeGreaterThan(0);
  expect(after.played["lock"]).toBeGreaterThan(0);
  expect(after.played["blast"]).toBeGreaterThan(0);
  expect(after.played["typo"]).toBeGreaterThan(0);
  expect(after.played["hit"]).toBeGreaterThan(0);
  expect(after.reachedVia["keystroke"]).toContain("flight-cue:keystroke");
  expect(after.reachedVia["blast"]).toContain("flight-cue:blast");

  // AC-6e.2: every keystroke got an audio answer. One play per keystroke cue.
  const keystrokeCues = after.cuesRouted.filter(
    (c) => c === "keystroke" || c === "ignored",
  ).length;
  expect(after.played["keystroke"]).toBe(keystrokeCues);

  // AC-21.1: the bed followed the game to Mars, and it crossfaded.
  expect(after.ambientStops).toEqual(["earth", "mars"]);
  expect(after.ambientCrossfades).toBeGreaterThanOrEqual(1);

  // AC-21.2: the music index came from live HUD numbers, not from a constant.
  expect(after.hudSamples).toBeGreaterThan(0);

  const hud = await page.evaluate(() => {
    const s = window.__kbFlight?.state();
    return { combo: s?.combo ?? 0, live: s?.rocks.length ?? 0, hull: s?.hull ?? 0 };
  });

  record("flightCue", {
    scene: "Flight",
    stop: "mars",
    typedWord: word,
    typoInput,
    cuesRouted: after.cuesRouted,
    distinctCues: [...new Set(after.cuesRouted)],
    // Recorded, not asserted. The canister is promoted from the OLDEST rock,
    // which is the one nearest the breach line, so it can be struck before the
    // spec finishes typing it and the shield cue never fires. Asserting it
    // without first spawning a known rock by name would be a flaky red. See
    // the escalation; the fix is `spawn` then `makeCanister(word)`.
    canisterWord: canister,
    shieldPlays: after.played["shield"] ?? 0,
    sfxPlaysBefore: before.sfxPlays,
    sfxPlaysAfter: after.sfxPlays,
    keystrokeCues,
    keystrokePlays: after.played["keystroke"],
    toneSteps: after.toneSteps,
    // Each entry is a sound that was scheduled on the real context, with the
    // values that went to the nodes and the clock it went at.
    scheduled: after.recent.slice(-12),
  });
  record("ambient", {
    stops: after.ambientStops,
    crossfades: after.ambientCrossfades,
    crossfadedOnSceneTransition: after.ambientCrossfades >= 1,
  });
  record("music", {
    drivenBy: "FLIGHT_EVENTS.hud (liveCount, combo)",
    hudSamples: after.hudSamples,
    indicesObserved: after.musicIndices,
    indexNow: after.musicIndex,
    liveStateAtRead: hud,
  });
});

// ---------------------------------------------------------------------------
// 4. Warp: the stinger and the spoken coach note
// ---------------------------------------------------------------------------

test("AC-21.3 / AC-21.6: the warp spools, stings, and speaks its note after the text", async ({
  page,
}) => {
  await bootReal(page, "?scene=Warp&stop=mars");
  await page.waitForFunction(
    () => (window as unknown as { __kb: Record<string, unknown> }).__kb["warp"] !== undefined,
    null,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(500);

  const sentence = await page.evaluate(
    () =>
      (
        (window as unknown as { __kb: Record<string, unknown> }).__kb["warp"] as {
          snapshot(): { sentence: string };
        }
      ).snapshot().sentence,
  );
  expect(sentence.length).toBeGreaterThan(0);

  // Wait for the coach note so the AC-21.6 ordering is observed on the real
  // screen rather than on a stub.
  await page.waitForFunction(
    () =>
      (
        (window as unknown as { __kb: Record<string, unknown> }).__kb["warp"] as {
          snapshot(): { coach: { received: boolean } };
        }
      ).snapshot().coach.received,
    null,
    { timeout: 30_000 },
  );

  await typeText(page, sentence);
  await page.waitForTimeout(800);

  const after = await snap(page);
  recordEvents(after);

  expect(after.played["warpCharge"]).toBeGreaterThan(0);
  expect(after.played["warp"]).toBeGreaterThan(0);
  expect(after.reachedVia["warpCharge"]).toContain("warp-scene:charge");
  expect(after.reachedVia["warp"]).toContain("warp-scene:jump");

  // AC-21.6: the recorded order is "text" then "speech". It is RECORDED by
  // `speakCoachNote`, which calls the renderer before it touches the voice bus.
  expect(after.coachNoteOrder).toEqual(["text", "speech"]);

  const noteOnScreen = await page.evaluate(
    () =>
      (
        (window as unknown as { __kb: Record<string, unknown> }).__kb["warp"] as {
          snapshot(): { coach: { note: string } };
        }
      ).snapshot().coach.note,
  );
  expect(noteOnScreen.length).toBeGreaterThan(0);

  record("warp", {
    sentence,
    chargePlays: after.played["warpCharge"],
    warpPlays: after.played["warp"],
    via: {
      warpCharge: after.reachedVia["warpCharge"],
      warp: after.reachedVia["warp"],
    },
  });
  record("coachNote", {
    order: after.coachNoteOrder,
    spoken: after.spoken.filter((s) => s.kind === "coachNote"),
    textRendered: noteOnScreen,
    // AC-21.6's second half: the display carries the text and nothing a
    // renderer could branch on, so it cannot differ with or without speech.
    displayFields: ["text"],
  });
});

// ---------------------------------------------------------------------------
// 5. Beacon
// ---------------------------------------------------------------------------

test("AC-21.3 beacon: the reward bell rings when the lamp lights", async ({ page }) => {
  await bootReal(page, "?scene=Beacon&stop=mars");
  await page.waitForFunction(
    () => (window as unknown as { __kb: Record<string, unknown> }).__kb["beacon"] !== undefined,
    null,
    { timeout: 30_000 },
  );

  await page.waitForFunction(
    () => {
      const audio = (window as unknown as {
        __kb: { audio: { snapshot(): { played: Record<string, number> } } };
      }).__kb.audio;
      return (audio.snapshot().played["beacon"] ?? 0) > 0;
    },
    null,
    { timeout: 40_000 },
  );

  const after = await snap(page);
  recordEvents(after);
  expect(after.reachedVia["beacon"]).toContain("beacon-scene:lit");

  record("beacon", {
    plays: after.played["beacon"],
    via: after.reachedVia["beacon"],
    ambientStops: after.ambientStops,
  });
});

// ---------------------------------------------------------------------------
// 6. Shadow speaks, and the world ducks for him
// ---------------------------------------------------------------------------

test("AC-21.4 / AC-21.5: Shadow's pre-flight line ducks the live music bus", async ({
  page,
}) => {
  await bootReal(page, "?scene=Preflight&stop=mars");
  await page.waitForTimeout(1500);

  const spoke = await snap(page);
  // The scene said his line through the voice bus, not into the void.
  expect(spoke.spoken.length).toBeGreaterThan(0);
  expect(spoke.spoken.some((s) => s.kind === "scripted")).toBe(true);

  /**
   * The duck, measured on the LIVE graph, over real time.
   *
   * `SidechainDucker.measureReductionDb()` reads the gain back synchronously,
   * which is exact on the null context the unit evidence uses and useless here:
   * a real `AudioParam` does not move until the automation runs. So the same
   * ducker is driven and then SAMPLED after the ramp - the reduction reported
   * is what a browser's audio thread actually applied to the bus the game is
   * playing through.
   */
  const read = (): Promise<Record<string, number>> =>
    page.evaluate(() => {
      const buses = (window as unknown as {
        __kb: { audio: { graph: { buses: Record<string, GainNode> } } };
      }).__kb.audio.graph.buses;
      const out: Record<string, number> = {};
      for (const id of ["music", "ambient"]) out[id] = buses[id]!.gain.value;
      return out;
    });

  const duck = async (active: boolean): Promise<void> => {
    await page.evaluate((on) => {
      (window as unknown as {
        __kb: { audio: { graph: { ducker: { duck(a: boolean): void } } } };
      }).__kb.audio.graph.ducker.duck(on as boolean);
    }, active);
  };

  /**
   * Stop the ritual before measuring.
   *
   * The pre-flight sequence says a NEW line every few seconds, and each one
   * ducks again. Sampling a bus that a scene is still talking over measures the
   * overlap of two ducks, not the duck - and it does it differently depending
   * on which frame the ritual's timer happened to land on, which is a flake
   * that would eventually be "fixed" by loosening the threshold. The graph is
   * the live one either way; only the second talker goes.
   */
  await page.evaluate(() => {
    const kb = (window as unknown as {
      __kb: {
        game: { scene: { stop(key: string): void } };
        audio: { cancelVoice(): void };
      };
    }).__kb;
    kb.game.scene.stop("Preflight");
    kb.audio.cancelVoice();
  });

  const settled = (): Promise<void> =>
    page
      .waitForFunction(
        () => {
          const graph = (window as unknown as {
            __kb: {
              audio: {
                graph: {
                  buses: Record<string, GainNode>;
                  ducker: { ducking: boolean };
                };
              };
            };
          }).__kb.audio.graph;
          if (graph.ducker.ducking) return false;
          // The release ramp has finished when the bus stops moving.
          const bag = window as unknown as Record<string, number>;
          const now = graph.buses["music"]!.gain.value;
          const was = bag["__kbLastMusicGain"];
          bag["__kbLastMusicGain"] = now;
          return was !== undefined && Math.abs(now - was) < 1e-6;
        },
        null,
        { timeout: 20_000, polling: 120 },
      )
      .then(() => undefined);

  await settled();
  const resting = await read();

  await duck(true);
  await page.waitForTimeout(500);
  const ducked = await read();

  await duck(false);
  await settled();
  const released = await read();

  const db = (a: number, b: number): number =>
    b > 0 && a > 0 ? 20 * Math.log10(a / b) : Number.NEGATIVE_INFINITY;
  const reductionDb: Record<string, number> = {};
  for (const id of Object.keys(resting)) {
    reductionDb[id] = db(ducked[id] ?? 0, resting[id] ?? 0);
  }
  const worstDb = Math.max(...Object.values(reductionDb));

  expect(Object.keys(reductionDb).sort()).toEqual(["ambient", "music"]);
  // AC-21.4 is "at least 6 dB". A Web Audio `AudioParam` is float32, so the
  // exact -6.000000 dB the graph schedules comes back as -5.9999999 when it is
  // read off a real browser's bus. The tolerance is that rounding and nothing
  // else - a hundredth of a decibel either way is four orders of magnitude
  // below anything audible, and the null-context measurement in
  // audio-graph.json (float64) still asserts `<= -6` exactly.
  expect(worstDb).toBeLessThanOrEqual(-6 + FLOAT32_DB_SLOP);
  // And it comes back: a duck that never releases is a bug you only hear later.
  for (const id of Object.keys(resting)) {
    expect(released[id]).toBeCloseTo(resting[id] ?? 0, 2);
  }

  record("duck", {
    measuredOnLiveGraph: true,
    method: "drove the running game's SidechainDucker and sampled the real AudioParam after the ramp",
    restingGain: resting,
    duckedGain: ducked,
    releasedGain: released,
    reductionDb,
    worstDb,
    /** The dB tolerance applied for float32 rounding on a real AudioParam. */
    float32SlopDb: FLOAT32_DB_SLOP,
    releasedToResting: true,
  });
  record("voice", {
    transport: spoke.voiceTransport,
    spokenLines: spoke.spoken,
  });
});

// ---------------------------------------------------------------------------
// 7. The sliders move the gains
// ---------------------------------------------------------------------------

/**
 * UR-91 - THE BRIEFING'S TYPE-ON, ON A CONTEXT THAT IS ACTUALLY RUNNING.
 *
 * THIS LIVES HERE RATHER THAN IN `briefing.spec.ts` FOR ONE MEASURED REASON.
 * It was written there first and reported
 * "deepest music duck in dB: expected <= -6, Received -0.39313456124266183":
 * headless Chromium suspends every AudioContext until a gesture, so the duck's
 * 120 ms ramp advanced about 5 ms and then stopped. The product was correct -
 * the same page in a BUILT preview measured `busGains.music` 0.3508 against a
 * resting 0.6999, dead on 6.0 dB - and the number was a fact about the harness.
 * This file already sets `--autoplay-policy=no-user-gesture-required` for
 * exactly that reason, and an audio claim belongs with the audio harness.
 *
 * WHAT IT GUARDS is UR-25's failure mode, not a new one:
 * `playTransmissionTick` builds nodes on the voice bus and touches no history,
 * so a reveal that silently stopped calling it would look identical to one that
 * never had a sound. The unit tests prove the SOUND is right
 * (`transmissionRendered.test.ts`); only this proves the SCENE reaches it.
 *
 * WATCHED FAILING: delete the `audioFrom(this.registry)?.transmissionTick`
 * call from `BriefingScene.update` and this reports
 * "ticks fired over the whole page: expected +0 to be greater than +0" - the
 * page types in silence, with every unit test still green.
 */
test("UR-91 / AC-21.4: the briefing's reveal really sounds, and really ducks the world", async ({
  page,
}) => {
  await bootReal(page, "?scene=Briefing&stop=earth");
  await page.waitForFunction(
    () =>
      (window as unknown as {
        __kb?: { game: { scene: { getScene(k: string): { snapshot?: () => unknown } | null } } };
      }).__kb?.game.scene.getScene("Briefing")?.snapshot !== undefined,
    null,
    { timeout: 30_000 },
  );
  // The boot's own reveal runs out first, so the fader is back up and the
  // resting number below is honest.
  await page.waitForTimeout(2500);

  const seen = await page.evaluate(async () => {
    const kb = window as unknown as {
      __kb: {
        game: { scene: { getScene(k: string): unknown } };
        audio: { snapshot(): Record<string, unknown> };
      };
    };
    const scene = kb.__kb.game.scene.getScene("Briefing") as {
      snapshot(): { typewriter: { enabled: boolean; complete: boolean } };
      scene: { restart(data: unknown): void };
    };
    const audio = kb.__kb.audio;
    const busesOf = (s: Record<string, unknown>): Record<string, number> =>
      s["busGains"] as Record<string, number>;

    const resting = busesOf(audio.snapshot())["music"] as number;
    // A FRESH reveal to observe: the one that ran during boot is over.
    scene.scene.restart({ stopId: "earth", ctx: { stopId: "earth" } });

    // THE DEEPEST THE MUSIC GOT, not the first sample of it. DUCK_ATTACK_MS is
    // 120, so the frame after `beginTransmission` still reads the resting gain.
    let quietest = Number.POSITIVE_INFINITY;
    let sawRunning = false;
    const deadline = performance.now() + 25_000;
    while (performance.now() < deadline) {
      const tw = scene.snapshot().typewriter;
      if (tw.enabled && !tw.complete) {
        sawRunning = true;
        quietest = Math.min(quietest, busesOf(audio.snapshot())["music"] as number);
      }
      if (sawRunning && tw.complete) break;
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    // Let the 420 ms release land before reading the handback.
    await new Promise((r) => setTimeout(r, 900));
    const done = audio.snapshot();
    return {
      resting,
      quietest,
      sawRunning,
      ticks: done["transmissionTicks"] as number,
      via: done["transmissionVia"] as string[],
      transmitting: done["transmitting"] as boolean,
      afterMusic: busesOf(done)["music"] as number,
    };
  });

  // It sounded, and it was the briefing that reached it.
  expect(seen.sawRunning, "the reveal was never seen running").toBe(true);
  expect(seen.ticks, "ticks fired over the whole page").toBeGreaterThan(0);
  expect(seen.via).toContain("briefing:reveal");

  // AC-21.4: the world got out of Shadow's way while he transmitted...
  expect(
    20 * Math.log10(seen.quietest / seen.resting),
    "deepest music duck in dB",
  ).toBeLessThanOrEqual(-6 + FLOAT32_DB_SLOP);

  // ...and it was handed straight back. A duck left open is a game that plays
  // the rest of its music 6 dB quiet for the whole session.
  expect(seen.transmitting).toBe(false);
  expect(seen.afterMusic).toBeCloseTo(seen.resting, 3);
});

test("AC-19.1: the settings volume sliders move the live bus gains", async ({ page }) => {
  await bootReal(page, "?scene=Settings");
  await page.waitForFunction(
    () =>
      document.querySelector(
        '[data-testid="ui-screen"][data-scene="Settings"] [data-id="settings.music"]',
      ) !== null,
    null,
    { timeout: 30_000 },
  );

  const gains = (): Promise<{ music: number; sfx: number }> =>
    page.evaluate(() => {
      const buses = (window as unknown as {
        __kb: { audio: { graph: { buses: Record<string, GainNode> } } };
      }).__kb.audio.graph.buses;
      return { music: buses["music"]!.gain.value, sfx: buses["sfx"]!.gain.value };
    });

  const walkTo = async (id: string): Promise<void> => {
    const ids = await page
      .locator('[data-testid="ui-screen"][data-scene="Settings"] [data-testid="ui-item"]')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-id") ?? ""));
    const target = ids.indexOf(id);
    const current = await page
      .locator('[data-testid="ui-screen"][data-scene="Settings"]')
      .getAttribute("data-focus");
    const from = current === null ? 0 : Math.max(0, ids.indexOf(current));
    const steps = (target - from + ids.length) % ids.length;
    for (let i = 0; i < steps; i += 1) {
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(30);
    }
  };

  const opening = await gains();

  await walkTo("settings.music");
  for (let i = 0; i < 7; i += 1) {
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(40);
  }
  const afterMusic = await gains();
  expect(afterMusic.music).toBeLessThan(opening.music);

  await walkTo("settings.sfx");
  for (let i = 0; i < 16; i += 1) {
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(40);
  }
  const muted = await gains();
  expect(muted.sfx).toBeLessThan(opening.sfx);

  // A muted game still routes cues - at zero - and does not throw.
  const survived = await page.evaluate(() => {
    try {
      const audio = (window as unknown as {
        __kb: { audio: { uiNav(): unknown; snapshot(): WiringSnapshot } };
      }).__kb.audio;
      for (let i = 0; i < 20; i += 1) audio.uiNav();
      return { ok: true, plays: audio.snapshot().played["uiNav"] };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });
  expect(survived.ok).toBe(true);

  const stored = await page.evaluate(() => {
    const store = (window as unknown as {
      __kb: { services: { store: { activeProfile(): { settings: Record<string, number> } | null } } };
    }).__kb.services.store;
    return store.activeProfile()?.settings ?? null;
  });

  record("settings", {
    openingGains: opening,
    afterMusicSlider: afterMusic,
    afterSfxSlider: muted,
    storedMusicVolume: stored?.["musicVolume"] ?? null,
    storedSfxVolume: stored?.["sfxVolume"] ?? null,
    musicGainFollowedSlider: afterMusic.music < opening.music,
    sfxGainFollowedSlider: muted.sfx < opening.sfx,
    mutedSurvived: survived.ok,
  });
});

// ---------------------------------------------------------------------------
// 8. Degrading silently
// ---------------------------------------------------------------------------

test("D88: the game boots, plays and stays up with no AudioContext at all", async ({ page }) => {
  await muteHmr(page);
  // Take Web Audio away before anything loads. `createAudioSystem` must fall
  // back to the null context, and every call site must keep working.
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>)["AudioContext"];
    delete (window as unknown as Record<string, unknown>)["webkitAudioContext"];
  });

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto("/?scene=Title");
  await expect(page.getByTestId("app")).toHaveAttribute("data-booted", "true", {
    timeout: 30_000,
  });

  const result = await page.evaluate(() => {
    const audio = (window as unknown as {
      __kb: { audio: { uiNav(): unknown; snapshot(): WiringSnapshot } };
    }).__kb.audio;
    for (let i = 0; i < 10; i += 1) audio.uiNav();
    return audio.snapshot();
  });

  expect(result.contextKind).toBe("NullAudioContext");
  expect(result.played["uiNav"]).toBe(10);
  expect(errors).toEqual([]);

  record("noAudioContext", {
    contextKind: result.contextKind,
    uiNavPlays: result.played["uiNav"],
    pageErrors: errors,
    degradedSilently: errors.length === 0,
  });
});

// ---------------------------------------------------------------------------
// 9. AC-21.5: nothing on the network says a word
// ---------------------------------------------------------------------------

test("AC-21.5: a whole session makes zero TTS network calls", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.startsWith("http://localhost") || url.startsWith("http://127.0.0.1")) return;
    if (url.startsWith("data:") || url.startsWith("blob:")) return;
    external.push(url);
  });

  await bootReal(page, "?scene=Preflight&stop=mars");
  await page.waitForTimeout(2500);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(500);

  const s = await snap(page);
  expect(s.spoken.length).toBeGreaterThan(0);
  expect(external).toEqual([]);

  record("network", {
    externalRequests: external,
    ttsNetworkCalls: external.filter((u) => /tts|speech|voice|elevenlabs/i.test(u)).length,
    linesSpokenDuringSession: s.spoken.length,
    transport: s.voiceTransport,
  });
});


// ---------------------------------------------------------------------------
// 10. E-MUSIC-1 / UR-12: the composed music is really fetched, decoded, played
// ---------------------------------------------------------------------------

test("E-MUSIC-1 / UR-12: a real boot fetches the stop's composed track and plays it", async ({
  page,
}) => {
  // THE FAILURE THIS CATCHES. Every other check of this feature can pass on a
  // build that emitted no mp3: the glob compiles, the catalog reports ids, the
  // unit tests use a fake. Only a real browser fetching a real URL off a real
  // dev server and handing the bytes to a real `decodeAudioData` proves the
  // file exists, is audio, and reached the graph.
  const musicRequests: { url: string; status: number }[] = [];
  page.on("response", (response) => {
    const url = response.url();
    if (/\/music\/|music\/[a-z]+\.mp3/.test(url) || /(earth|mars|jupiter|saturn|uranus|neptune|pluto)[.-][^/]*\.mp3$/.test(url)) {
      musicRequests.push({ url, status: response.status() });
    }
  });

  await bootReal(page);
  await page.waitForFunction(
    () =>
      (window as unknown as { __kb: { audio: { snapshot(): { musicSource: string } } } }).__kb.audio.snapshot()
        .musicSource !== "silent",
    null,
    { timeout: 20_000 },
  );

  const s = await snap(page);
  // Earth opens the game, so Earth's piece is what is playing.
  expect(s.musicStops[0]).toBe("earth");
  expect(s.musicTrack).toBe("earth");
  expect(s.musicSource).toBe("track");
  // A build that shipped no files would report an empty list here and fall back
  // to the synthesised layers, which is a DIFFERENT state and not this one.
  expect(s.musicTrackIds).toContain("earth");
  expect(s.musicTrackIds.length).toBe(7);

  // The bytes really came off the server.
  const earth = musicRequests.filter((r) => /earth/.test(r.url));
  expect(earth.length).toBeGreaterThan(0);
  for (const request of earth) expect(request.status).toBe(200);

  // And the graph is playing a LOOPING BUFFER of that file, not an oscillator.
  const graph = await page.evaluate(() => {
    const kb = (window as unknown as {
      __kb: { audio: { graph: { ctx: AudioContext; music: { trackId: string | null; sourceKind: string } } } };
    }).__kb;
    return {
      sourceKind: kb.audio.graph.music.sourceKind,
      trackId: kb.audio.graph.music.trackId,
      sampleRate: kb.audio.graph.ctx.sampleRate,
    };
  });
  expect(graph.sourceKind).toBe("track");
  expect(graph.trackId).toBe("earth");

  record("music", {
    stop: s.musicTrack,
    source: s.musicSource,
    shippedTracks: s.musicTrackIds,
    fetched: musicRequests,
    contextSampleRate: graph.sampleRate,
  });
});
