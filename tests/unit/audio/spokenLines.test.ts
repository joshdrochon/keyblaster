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

/**
 * The FLIGHT table (`src/game/flight/copy.ts`) - the third string table, and the
 * third this guard had to be taught about (UR-142 was the second). Deliberately
 * the same regex `render-voice.mjs` uses, so guard and renderer cannot disagree
 * about what the text is.
 */
const FLIGHT_SPOKEN_KEYS = ["flight.canisterHint", "flight.nestedHint"];

/**
 * The STORY LANE table (`src/game/scenes/support/copy.ts`) - the fourth, and
 * the fourth this guard had to be taught about. UR-148 put a voice on the
 * ending card, whose line lives here rather than in content, in the menu table
 * or in the flight table.
 */
const LANE_SPOKEN_KEYS = ["ending.shadowLine"];

/** Same regex `render-voice.mjs` uses, so guard and renderer cannot disagree. */
const tableStrings = (path: string, keys: readonly string[]): Record<string, string> => {
  const table = readFileSync(join(REPO, path), "utf8");
  const out: Record<string, string> = {};
  for (const key of keys) {
    const re = new RegExp(`"${key.replace(/\./g, "\\.")}":\\s*\n?\\s*"((?:[^"\\\\]|\\\\.)*)"`);
    const raw = table.match(re)?.[1];
    if (typeof raw !== "string") continue;
    out[key] = raw.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return out;
};

const flightStrings = (): Record<string, string> =>
  tableStrings("src/game/flight/copy.ts", FLIGHT_SPOKEN_KEYS);

const laneStrings = (): Record<string, string> =>
  tableStrings("src/game/scenes/support/copy.ts", LANE_SPOKEN_KEYS);

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

  // FlightScene.maybeHintCanister - the id IS the flight-table key (UR-146).
  for (const [key, text] of Object.entries(flightStrings())) {
    if (text.trim().length === 0) continue;
    lines.push({ id: key, text: text.trim(), via: "FlightScene" });
  }

  // EndingScene.buildClosingLine - the id IS the lane-table key (UR-148).
  for (const [key, text] of Object.entries(laneStrings())) {
    if (text.trim().length === 0) continue;
    lines.push({ id: key, text: text.trim(), via: "EndingScene" });
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
    //
    // UR-142 ADDED THE FIFTH and this guard is what made it safe: the greeting
    // on an empty hangar is the first menu line Shadow speaks, and the menu
    // table it lives in was invisible to `render-voice.mjs` until the same
    // change taught the script about it. Adding the scene here is the moment
    // somebody has to confirm its id is renderable, which is the whole job.
    //
    // UR-146 added the sixth, from a third table neither this guard nor the
    // render script could see. `FLIGHT_SPOKEN_KEYS` is the half that fixes it.
    //
    // UR-148 added the seventh - the ending card - from a FOURTH table, the
    // story lane's. `LANE_SPOKEN_KEYS` and the script's `SPOKEN_LANE_KEYS` are
    // the halves that fix it, and adding the scene here is the moment somebody
    // confirms the id is renderable.
    // UR-169 added the eighth - the Briefing's closing line, from the SCENE
    // string table (`content/<lang>/ui.json`), which is the same table the
    // pre-flight ritual's lines come from and the script already collects via
    // `SPOKEN_UI_KEYS`.
    expect(speakSiteFiles()).toEqual([
      "src/game/scenes/BeaconScene.ts",
      "src/game/scenes/BriefingScene.ts",
      "src/game/scenes/EarthActivationScene.ts",
      "src/game/scenes/EndingScene.ts",
      "src/game/scenes/FlightScene.ts",
      "src/game/scenes/PreflightScene.ts",
      "src/game/scenes/ProfilePickerScene.ts",
      "src/game/scenes/WarpScene.ts",
    ]);
  });

  it("UR-148: the ending's line is spoken with the id the render script writes", () => {
    /**
     * The id, the drawn string and the rendered clip are ONE key. The scene
     * speaks `ending.shadowLine` and draws `ending.shadowLine`, so a caption
     * that says one thing over audio that says another is not expressible.
     *
     * WATCHED FAILING with the script's `SPOKEN_LANE_KEYS` block removed:
     *   AC-21.8: no speakable string is missing its recording
     *   expected [ 'ending.shadowLine (EndingScene)' ] to deeply equal []
     * and this case reports
     *   expected '#!/usr/bin/env node\n/**\n * Pre-render …' to contain
     *   'SPOKEN_LANE_KEYS'
     */
    const scene = readFileSync(join(SCENES, "EndingScene.ts"), "utf8");
    expect(scene).toContain('id: "ending.shadowLine",');
    // The voice is handed the SAME local the label above it was built from.
    expect(scene).toMatch(/const line = this\.lane\.copy\.text\("ending\.shadowLine"\)/);
    expect(scene).toMatch(/speak\(\{\s*\n\s*id: "ending\.shadowLine",\s*\n\s*text: line,/);
    // And the script can SEE the table the key lives in.
    const script = readFileSync(join(REPO, "scripts/render-voice.mjs"), "utf8");
    expect(script).toContain("SPOKEN_LANE_KEYS");
    expect(script).toContain("src/game/scenes/support/copy.ts");
    expect(Object.keys(laneStrings())).toEqual(LANE_SPOKEN_KEYS);
  });

  it("UR-146 / UR-148: the flight lines are spoken with the ids the script writes", () => {
    /**
     * The scene speaks the CONSTANT, not a literal, so it cannot spell the id
     * differently from the row the script renders - which is how 28 rendered
     * files came to target ids no call site spoke.
     *
     * WATCHED FAILING with the scene's `id: CANISTER_HINT_KEY` replaced by the
     * literal `id: "flight.canister-hint"`:
     *   expected 'import Phaser from "phaser";\nimport …' to contain
     *   'id: CANISTER_HINT_KEY,'
     */
    const flight = readFileSync(join(SCENES, "FlightScene.ts"), "utf8");
    expect(flight).toContain("id: CANISTER_HINT_KEY,");
    expect(flight).toContain("id: NESTED_HINT_KEY,");
    // And the script can SEE the table the constant points at.
    const script = readFileSync(join(REPO, "scripts/render-voice.mjs"), "utf8");
    expect(script).toContain("SPOKEN_FLIGHT_KEYS");
    expect(script).toContain("src/game/flight/copy.ts");
    // The line this guard reads and the line the game says are one string.
    expect(Object.keys(flightStrings())).toEqual(FLIGHT_SPOKEN_KEYS);
  });

  it("the coach note reaches the voice bus through the note-keyed lookup", () => {
    // `warp.coachNote` is the id of a SCREEN. If WarpScene ever built its own
    // per-sentence id, or stopped passing the note text through `speakNote`,
    // the lookup in `wiring.ts` would silently stop matching.
    const warp = readFileSync(join(SCENES, "WarpScene.ts"), "utf8");
    // The payload is keyed on `note`, i.e. the TEXT. It used to be spelled
    // `{ note: result.note }`; UR-64 made the spoken string the note AFTER the
    // retry rule has run, so it is now the shorthand `{ note }` over the local
    // the renderer is also handed. The claim is unchanged and the two halves of
    // it are asserted separately below: text, and the same text the screen
    // shows.
    expect(warp).toMatch(/speakNote\(\s*\{\s*note\s*[,}]/);
    const wiring = readFileSync(join(REPO, "src/game/audio/wiring.ts"), "utf8");
    expect(wiring).toContain("coachNoteClipId");
  });

  it("UR-64: the note a child HEARS is the note a child READS", () => {
    // `showNote` takes the resolved note as its second argument and both the
    // renderer and the voice bus are given THAT, not `result.note`. If the two
    // ever diverged, Shadow would say out loud an offer of a retry that the
    // screen had already withdrawn - which is the ticket, with a voice on it.
    //
    // Watched failing: put `result.note` back in the `speakNote` call and in
    // the `render({ text: ... })` above it and this reports
    //   expected 'import Phaser from "phaser";\nimport …' to contain 'render({ text: note })'
    // and the guard above it reports
    //   expected 'import Phaser from "phaser";\nimport …' to match
    //   /speakNote\(\s*\{\s*note\s*[,}]/
    //
    // ============ THE RESOLVED NOTE IS NOW QUEUED, NOT DRAWN ============
    // `askShadow` used to call `showNote(result, this.applyRetryRule(result.note))`
    // directly. Shadow's card shows the screen's instruction until the note has
    // had its dwell (`COACH_INTRO_MIN_MS`), so the note is put on
    // `pendingNote` and `releaseCoachNote` draws it a few frames later. Both
    // hops are asserted rather than one: the rule still runs on `result.note`
    // at arrival, and what is queued is exactly what is shown.
    const warp = readFileSync(join(SCENES, "WarpScene.ts"), "utf8");
    expect(warp).toContain(
      "this.pendingNote = { result, note: this.applyRetryRule(result.note) };",
    );
    expect(warp).toContain("this.showNote(pending.result, pending.note);");
    expect(warp).toContain("private showNote(result: CoachResult, note: string): void");
    expect(warp).toContain("render({ text: note })");
    expect(warp).toContain("speakNote({ note }");
    // And `result.note` reaches neither the renderer nor the bus any more.
    expect(warp).not.toMatch(/render\(\s*\{\s*text:\s*result\.note\s*\}/);
    expect(warp).not.toMatch(/speakNote\(\s*\{\s*note:\s*result\.note\s*\}/);
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

  it("boot.ts opts in CONDITIONALLY, never by default", () => {
    // This assertion used to be `not.toContain("allowSystemVoice")`, because
    // there was no runtime surface for the opt-in at all. Its own comment
    // named what would happen next: "if a `?voice=system` flag is ever added,
    // this assertion is the thing that forces whoever adds it to prove it is
    // CONDITIONAL rather than to slip the default back on."
    //
    // The flag was added (E-VOICE-1.5) so a live /api/coach note — the one case
    // D98 keeps the platform voice for, and the one that can never be
    // pre-rendered — can be switched on from a browser. So this now proves the
    // stronger thing: boot passes the option, and passes it as a COMPARISON
    // against the URL rather than as a literal `true`.
    const boot = readFileSync(join(REPO, "src/game/boot.ts"), "utf8");
    expect(boot).toContain("allowSystemVoice");

    const line = boot
      .split("\n")
      .find((l) => l.includes("allowSystemVoice:"));
    expect(line, "boot.ts does not pass allowSystemVoice").toBeDefined();
    // The defect this guards is a one-character edit: `=== "system"` becoming
    // `true`. Any literal there ships the platform voice to every child.
    expect(line).toMatch(/allowSystemVoice:\s*params\.get\("voice"\)\s*===/);
    expect(line).not.toMatch(/allowSystemVoice:\s*(true|1)\b/);
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

describe("UR-169: the Briefing's closing line is spoken without the pilot's name", () => {
  it("speaks a key of its own, not the drawn line with {pilotName} in it", () => {
    const src = readFileSync("src/game/scenes/BriefingScene.ts", "utf8");
    // A clip is rendered ONCE and every pilot hears it, so a `{pilotName}` in
    // the spoken string would be a placeholder read aloud.
    expect(src).toMatch(/id: "briefing\.shipReadySpoken"/);
    expect(src).not.toMatch(/speak\([\s\S]{0,120}briefing\.shipReady"/);
  });

  it("says it once per visit, after the page has finished revealing", () => {
    const src = readFileSync("src/game/scenes/BriefingScene.ts", "utf8");
    expect(src).toMatch(/if \(this\.shipReadySaid\) return;/);
    expect(src).toMatch(/this\.sayShipReady\(\);/);
  });

  it("the spoken string carries no interpolation token", () => {
    const ui = JSON.parse(readFileSync("src/content/en/ui.json", "utf8")) as {
      strings: Record<string, string>;
    };
    const line = ui.strings["briefing.shipReadySpoken"];
    expect(line).toBe("Ready to prepare the ship whenever you are.");
    expect(line).not.toMatch(/\{/);
  });
});
