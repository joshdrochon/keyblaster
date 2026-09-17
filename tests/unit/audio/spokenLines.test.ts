/**
 * ============ D98'S GUARD: EVERY LINE SHADOW SAYS HAS A RECORDING ============
 *
 * D98: "a spoken line without a rendered clip is a BUILD FAILURE, not a runtime
 * fallback. Silence is the runtime behaviour if one ever slips through."
 *
 * This file is what makes that true rather than aspirational. It enumerates
 * every string the game can hand to the voice bus - by walking the SPEAK SITES
 * and the content they read, not a list someone maintains - and fails if any of
 * them has no rendered file. Twice now the diagnosis came from a player hearing
 * the wrong voice instead of from the suite:
 *
 *   - the first render pass shipped 28 files whose ids no call site spoke;
 *   - the coach note was classified as unrenderable LLM text when the sentence
 *     a child actually hears is authored, finite and shipped (D33's fallback
 *     bundle, and `mock.ts` - "That was a clean run, pilot.").
 *
 * A LIST WOULD NOT HAVE CAUGHT EITHER. So the rules here are:
 *
 *   1. the set of speak sites is derived by scanning src/game/scenes, and a new
 *      one fails this file until it is accounted for;
 *   2. the ids come from the same sources the scenes read - the stage bundles,
 *      ui.json, and `coachNoteLines()` - so content that changes changes both
 *      sides at once;
 *   3. the only accepted reason for a speakable string to have no clip is that
 *      it is a SHAPE rather than a sentence (a mock template interpolating the
 *      child's own missed word, AC-15.5) or live model text. That reason is
 *      checked structurally, not accepted on assertion.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STOP_IDS } from "../../../src/engine/types.js";
import { coachNoteLines, unrenderableCoachNotes } from "../../../src/engine/coach/index.js";
import { browserVoiceClips, createAudioSystem, manifestLang } from "../../../src/game/audio/index.js";
import { installAudio } from "../../../src/game/audio/wiring.js";
import { NullAudioContext } from "../../../src/game/audio/nullContext.js";
import { MAC_VOICES, fakeScheduler } from "./fakes.js";

const REPO = process.cwd();
const VOICE_DIR = join(REPO, "src/content/audio/voice");
const SCENES = join(REPO, "src/game/scenes");

/** Files under src/game/scenes that hand a line to the audio service. */
function speakSiteFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      const source = readFileSync(path, "utf8");
      if (/\.speak\(|speakNote\(|speakAudio\(|interruptFor\(/.test(source)) {
        found.push(path.slice(REPO.length + 1));
      }
    }
  };
  walk(SCENES);
  return found.sort();
}

const stageBundle = (stop: string): Record<string, unknown> | null => {
  const path = join(REPO, `src/content/en/${stop}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
};

const uiStrings = (): Record<string, string> => {
  const ui = JSON.parse(readFileSync(join(REPO, "src/content/en/ui.json"), "utf8")) as {
    strings?: Record<string, string>;
  };
  return ui.strings ?? {};
};

/**
 * The `SceneStringKey`s `PreflightScene.say()` can be called with, read out of
 * the scene: the step table plus every literal argument. A key added to either
 * arrives here without anyone editing this file.
 */
function preflightSpokenKeys(): string[] {
  const source = readFileSync(join(SCENES, "PreflightScene.ts"), "utf8");
  const keys = new Set<string>();

  const table = /const STEP_LINE_KEY[^{]*\{([^}]*)\}/s.exec(source);
  if (table?.[1]) {
    for (const match of table[1].matchAll(/"([^"]+)"/g)) keys.add(match[1] as string);
  }
  for (const match of source.matchAll(/this\.say\(\s*"([^"]+)"/g)) keys.add(match[1] as string);
  return [...keys].sort();
}

/** Every (id, text) the running game can hand to the voice bus. */
function spokenLines(): Array<{ id: string; text: string; via: string }> {
  const lines: Array<{ id: string; text: string; via: string }> = [];

  // BeaconScene.narrateBeacon - three fields per stop, `${stopId}.<field>`.
  for (const stop of STOP_IDS) {
    const bundle = stageBundle(stop);
    if (bundle === null) continue;
    for (const field of ["beaconHeadline", "beaconState", "beaconFlavor"] as const) {
      const text = bundle[field];
      if (typeof text !== "string" || text.trim().length === 0) continue;
      lines.push({ id: `${stop}.${field}`, text: text.trim(), via: "BeaconScene" });
    }
    // EarthActivationScene - `${stopId}.preflightLine`, whatever stop it runs for.
    const preflight = bundle["preflightLine"];
    if (typeof preflight === "string" && preflight.trim().length > 0) {
      lines.push({
        id: `${stop}.preflightLine`,
        text: preflight.trim(),
        via: "EarthActivationScene",
      });
    }
  }

  // PreflightScene.say - the id IS the ui.json key.
  const strings = uiStrings();
  for (const key of preflightSpokenKeys()) {
    const text = strings[key];
    if (typeof text !== "string" || text.trim().length === 0) continue;
    lines.push({ id: key, text: text.trim(), via: "PreflightScene" });
  }

  // WarpScene.showNote -> installAudio.speakNote -> coachNoteClipId.
  //
  // Scoped to the language the clips were rendered in, because a session in
  // another language gets NO clips at all - `browserVoiceClips` refuses to
  // serve English recordings over translated text (D98, E-VOICE-1), and the
  // test below holds it to that. `lang: null` is the mock, whose templates are
  // English whatever the content language is.
  const lang = manifestLang();
  for (const note of coachNoteLines()) {
    if (note.lang !== null && note.lang !== lang) continue;
    lines.push({ id: note.id, text: note.note.trim(), via: `WarpScene/${note.source}` });
  }

  return lines;
}

const renderedIds = (): Set<string> =>
  new Set(
    readdirSync(VOICE_DIR)
      .filter((f) => f.endsWith(".mp3"))
      .map((f) => f.slice(0, -".mp3".length)),
  );

describe("AC-21.8 / D98: the speak sites are the ones this guard knows about", () => {
  it("no scene hands a line to the voice bus without being enumerated here", () => {
    // A fifth speak site is not a problem - it is a site whose id space nobody
    // has checked, which is the exact shape of both failures so far.
    expect(speakSiteFiles()).toEqual([
      "src/game/scenes/BeaconScene.ts",
      "src/game/scenes/EarthActivationScene.ts",
      "src/game/scenes/PreflightScene.ts",
      "src/game/scenes/WarpScene.ts",
    ]);
  });

  it("the coach note reaches the voice bus through the note-keyed lookup", () => {
    // `warp.coachNote` is the id of a SCREEN. If WarpScene ever built its own
    // per-sentence id, or stopped passing the note text through `speakNote`,
    // the lookup in `wiring.ts` would silently stop matching.
    const warp = readFileSync(join(SCENES, "WarpScene.ts"), "utf8");
    expect(warp).toMatch(/speakNote\(\s*\{\s*note:\s*result\.note\s*\}/);
    const wiring = readFileSync(join(REPO, "src/game/audio/wiring.ts"), "utf8");
    expect(wiring).toContain("coachNoteClipId");
  });
});

describe("AC-21.8 / D98: every line the game can speak has a rendered clip", () => {
  const rendered = renderedIds();
  const manifest = JSON.parse(readFileSync(join(VOICE_DIR, "manifest.json"), "utf8")) as {
    lines: Array<{ id: string; file: string; chars: number }>;
  };
  const byId = new Map(manifest.lines.map((l) => [l.id, l]));

  it("AC-21.8: no speakable string is missing its recording", () => {
    // THE BUILD FAILURE. When this is red the fix is to render, not to relax it:
    //   node scripts/render-voice.mjs --live --voice TX3LPaxmHKxFdv7VOQHJ --cap-usd 1
    const missing = spokenLines()
      .filter((l) => !rendered.has(l.id))
      .map((l) => `${l.id} (${l.via})`);
    expect(missing).toEqual([]);
  });

  it("every recording has a manifest row, and the row matches today's text", () => {
    // Catches the other half: text edited after the render, so the file plays
    // the OLD sentence under the new one's id and nothing on screen shows it.
    const drifted = spokenLines()
      .filter((l) => byId.has(l.id))
      .filter((l) => byId.get(l.id)?.chars !== l.text.length)
      .map((l) => `${l.id}: rendered ${byId.get(l.id)?.chars}c, now ${l.text.length}c`);
    expect(drifted).toEqual([]);
  });

  it("the only excuse for no clip is a sentence that is a SHAPE, not a sentence", () => {
    // `unrenderableCoachNotes` is the one place a "cannot be rendered" claim is
    // allowed, and every entry has to prove it: either it interpolates a word
    // the child supplied, or it is live model text.
    for (const note of unrenderableCoachNotes()) {
      const isTemplate = note.shape.includes("{");
      const isLive = note.shape === "<live model text>";
      expect(isTemplate || isLive, note.shape).toBe(true);
      expect(note.reason.length).toBeGreaterThan(20);
    }
  });
});

describe("AC-21.8 / D98: English recordings are not played over another language's text", () => {
  /** A scope with an `Audio` constructor, which is all the catalog needs. */
  const scope = { Audio: class { constructor(readonly src: string) {} } };

  it("the shipped clips are served to a session in their own language", () => {
    expect(browserVoiceClips(scope, manifestLang())).not.toBe(null);
    expect(browserVoiceClips(scope, `${manifestLang()}-GB`)).not.toBe(null);
  });

  it("a session in another language gets no clips rather than the wrong voice", () => {
    // D45 ships three content languages and the scripted ids carry none of
    // them: `mars.beaconFlavor` is one id for all three. Serving the English
    // file to a Spanish reader is not a degraded voice, it is the wrong words.
    for (const other of ["es", "hi", "es-MX"]) {
      expect(browserVoiceClips(scope, other), other).toBe(null);
    }
  });
});

describe("AC-21.8 / D98: the system voice is OFF, and silence is what an unrendered line gets", () => {
  /** A browser-shaped scope with a perfectly good local speech synthesiser. */
  const scopeWithSpeech = (): {
    scope: Record<string, unknown>;
    spoken: string[];
  } => {
    const spoken: string[] = [];
    const scope: Record<string, unknown> = {
      speechSynthesis: {
        getVoices: () =>
          MAC_VOICES.map((v) => ({
            name: v.name,
            lang: v.lang,
            localService: v.localService,
            default: v.default === true,
          })),
        speak: (utterance: { text?: string }) => {
          spoken.push(String(utterance?.text ?? ""));
        },
        cancel: () => undefined,
        addEventListener: () => undefined,
      },
      SpeechSynthesisUtterance: class {
        voice: unknown = null;
        lang = "";
        rate = 1;
        pitch = 1;
        volume = 1;
        onend: unknown = null;
        onerror: unknown = null;
        onboundary: unknown = null;
        constructor(readonly text: string) {}
      },
      setTimeout: (cb: () => void) => cb as unknown,
      clearTimeout: () => undefined,
    };
    return { scope, spoken };
  };

  it("AC-21.8: a build that never asks for it never binds the platform's voice", () => {
    const { scope, spoken } = scopeWithSpeech();
    const graph = createAudioSystem({ ctx: new NullAudioContext(), scope, voiceClips: null });

    graph.voice.speak({ id: "warp.coachNote", text: "Something novel.", kind: "coachNote" });

    expect(graph.voice.transportId).toBe("silent");
    expect(spoken).toEqual([]);
  });

  it("boot.ts does not opt in - the shipped game has no system voice", () => {
    // There is no runtime surface for the opt-in today: it is an option on
    // `createAudioSystem` and boot does not pass it. If a `?voice=system` flag
    // is ever added (see gauntlet/escalations.md E-VOICE-1.5), this assertion
    // is the thing that forces whoever adds it to prove it is CONDITIONAL
    // rather than to slip the default back on.
    const boot = readFileSync(join(REPO, "src/game/boot.ts"), "utf8");
    expect(boot).not.toContain("allowSystemVoice");
  });

  it("AC-21.8: the opt-in exists, off by default, for a genuinely novel live note", () => {
    // A live `/api/coach` note cannot be recorded. Someone running with a real
    // endpoint can ask for it to be read; it is a per-session choice and the
    // default above is what ships.
    const { scope, spoken } = scopeWithSpeech();
    const graph = createAudioSystem({
      ctx: new NullAudioContext(),
      scope,
      voiceClips: null,
      allowSystemVoice: true,
    });

    graph.voice.speak({ id: "warp.coachNote", text: "Something novel.", kind: "coachNote" });

    expect(graph.voice.transportId).toBe("webspeech");
    expect(spoken).toEqual(["Something novel."]);
  });

  it("an interpolated mock note is shown and NOT spoken by default", () => {
    // The end-to-end shape of D98's runtime half: the text is up, the voice bus
    // has the line, and no OS voice reads it.
    const { scope, spoken } = scopeWithSpeech();
    const graph = createAudioSystem({
      ctx: new NullAudioContext(),
      scope,
      voiceClips: null,
      schedule: fakeScheduler().schedule,
    });
    const audio = installAudio({ graph });

    const shown: string[] = [];
    const note = 'Nice flying, pilot. Watch for "rivers" next time.';
    const result = audio.speakNote({ note }, (d) => shown.push(d.text), "warp.coachNote");

    expect(shown).toEqual([note]);
    expect(result.order).toEqual(["text", "speech"]);
    expect(spoken).toEqual([]);
    expect(audio.snapshot().voiceClipsUsed).toEqual([]);
  });
});
