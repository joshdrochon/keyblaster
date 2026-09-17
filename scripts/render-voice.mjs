#!/usr/bin/env node
/**
 * Pre-render Shadow's scripted lines with ElevenLabs (D63, D88, architecture §5.3).
 *
 *   node scripts/render-voice.mjs                 DRY RUN - lists work, spends nothing
 *   node scripts/render-voice.mjs --list-voices   show available voices (free)
 *   node scripts/render-voice.mjs --live --voice <id> --cap-usd 2   actually render
 *
 * D87 IS THE REASON FOR THE SHAPE OF THIS SCRIPT. Paid APIs are mocked unless
 * --live is passed WITH a spend cap. The default does no network I/O at all, so
 * running it by accident costs nothing. The cap is checked before every call and
 * the run stops when it would be exceeded.
 *
 * D63: rendered at BUILD TIME and shipped as files. There is no runtime
 * ElevenLabs call anywhere in this product, and AC-21.5's zero-network-TTS
 * check still holds at runtime.
 *
 * The key is read from process.env and is never logged, never written to an
 * artifact, and never passed as an argv.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(REPO, "src/content/audio/voice");
const STOPS = ["earth", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"];

/**
 * Stage-bundle fields Shadow SPEAKS. Everything else on a bundle is read.
 *
 * ================== THIS LIST USED TO BE A GUESS ==================
 * The first render pass produced 28 files against ids of the form
 * `<stop>.<field>` taken from this list, and NO CALL SITE SPOKE ANY OF THEM.
 * `beaconHeadline` / `beaconState` / `beaconFlavor` were drawn as labels in
 * BeaconScene and never handed to the voice bus; `preflightLine` was drawn in
 * EarthActivationScene and never spoken either. Every file was correct, every
 * file was unreachable, and nothing in the repo noticed because no test related
 * the two id spaces.
 *
 * The scenes now speak them, with exactly these ids, and
 * `tests/unit/audio/voiceClips.test.ts` asserts the relationship in both
 * directions. BEFORE ADDING A FIELD HERE, ADD THE SPEAK SITE AND THE TEST. A
 * render with no call site is money spent on silence.
 */
const SPOKEN_FIELDS = ["preflightLine", "beaconHeadline", "beaconState", "beaconFlavor"];

/**
 * UI strings Shadow speaks, by their `SceneStringKey` (src/content/en/ui.json).
 *
 * These are the ONLY ids `PreflightScene.say()` has ever handed to the voice
 * bus (`PreflightScene.ts` -> `STEP_LINE_KEY`, plus the two literals), and none
 * of them had a file. They are per-GAME rather than per-stop: the pre-flight
 * ritual says the same three lines at every planet, so three renders cover all
 * seven stops, which is also why they cost almost nothing.
 *
 * The id IS the ui.json key, unchanged, because the id space is the contract
 * between this script and `browserVoiceClips` and a translation of it here
 * would be a silent miss at runtime.
 */
const SPOKEN_UI_KEYS = [
  "preflight.line.opening",
  "preflight.line.hull",
  "preflight.line.systems",
  "preflight.line.engines",
  "preflight.line.done",
  "preflight.line.returning",
];

/**
 * ================== THE COACH NOTE IS RENDERABLE (D98) ==================
 *
 * It was excluded from the first pass as "runtime LLM text, unrenderable by
 * construction", and that was wrong in both of the cases that actually happen:
 *
 *   - `/api/coach` is not deployed, so D33's shipped fallback bundle is the
 *     note on every warp break;
 *   - and the proxy is not even the default. `chooseTransport` gives an
 *     unconfigured build the MOCK, whose canned notes are what a player hears.
 *     "That was a clean run, pilot." - heard in the system voice, which is what
 *     started this - is `mock.ts` `CLEAN[0]`.
 *
 * Both are finite, authored text. They are collected FROM THE CODE THAT
 * PRODUCES THEM (`coachNoteLines()` in src/engine/coach/spokenNotes.ts) rather
 * than copied here, which is the rule the SPOKEN_FIELDS comment above asks for,
 * applied properly: this script, the runtime lookup (`coachNoteClipId`, used by
 * `installAudio.speakNote`) and the D98 guard
 * (tests/unit/audio/spokenLines.test.ts) read ONE enumeration. A note added to
 * either source becomes a render and a failing guard, never a silent miss.
 *
 * NOT EVERYTHING CAN BE RENDERED, and the split is data rather than a comment:
 * three mock templates interpolate the child's own missed words (AC-15.5) and a
 * live model note is whatever the model wrote. `unrenderableCoachNotes()` names
 * them; under D98 they are SILENT at runtime rather than read by an OS voice.
 *
 * Which LANGUAGES are rendered is `--langs` (default `en`), because Liam
 * reading Hindi with an English accent is worse than no voice at all. See
 * gauntlet/escalations.md E-VOICE-1.
 */

/**
 * Load the engine's note enumeration into this script.
 *
 * The engine is TypeScript with `.js` import specifiers, so it cannot simply be
 * `import()`ed from a .mjs script; esbuild (already a dependency of vite) is
 * used to bundle it to one temporary ESM file, which is imported and then
 * deleted. Importing the REAL module is the point - the alternative is a copy
 * of the strings in this file, and a copy is how the first 28 renders came to
 * target ids the game never spoke.
 */
async function loadCoachNotes() {
  let esbuild;
  try {
    esbuild = await import("esbuild");
  } catch {
    console.error(
      "esbuild is not installed, so the coach notes cannot be collected from " +
        "src/engine/coach. Run `npm install` and try again.",
    );
    process.exit(2);
  }
  const out = join(tmpdir(), `kb-coach-notes-${process.pid}.mjs`);
  try {
    await esbuild.build({
      entryPoints: [join(REPO, "src/engine/coach/spokenNotes.ts")],
      bundle: true,
      format: "esm",
      platform: "node",
      outfile: out,
      logLevel: "warning",
    });
    const mod = await import(`file://${out}`);
    return {
      lines: mod.coachNoteLines(),
      unrenderable: mod.unrenderableCoachNotes(),
    };
  } finally {
    rmSync(out, { force: true });
  }
}

/** ElevenLabs bills per character. Flash v2.5 is ~$0.00003/char on paid tiers. */
const USD_PER_CHAR = 0.00003;

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
/**
 * The value after `--name`, or `fallback`.
 *
 * The `startsWith("--")` guard is not decoration. Without it
 * `--voice --cap-usd 1` set the voice id to the literal string "--cap-usd" and
 * then sent seven requests to a voice that does not exist - a flag that eats
 * the next flag is a bug that spends money before it reports itself.
 */
const value = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const next = argv[i + 1];
  if (typeof next !== "string" || next.length === 0 || next.startsWith("--")) return fallback;
  return next;
};

const LIVE = flag("live");
const CAP_USD = Number(value("cap-usd", process.env["SPEND_CAP_USD"] ?? "0"));
const VOICE_ID = value("voice", process.env["ELEVENLABS_VOICE_ID"]);
const MODEL = value("model", "eleven_flash_v2_5");
const KEY = process.env["ELEVENLABS_API_KEY"];
/** Which languages of the coach note to render. See the D98 block above. */
const COACH_LANGS = (value("langs", "en") ?? "en")
  .split(",")
  .map((l) => l.trim())
  .filter(Boolean);

async function collectLines() {
  const lines = [];
  for (const stop of STOPS) {
    const p = join(REPO, `src/content/en/${stop}.json`);
    if (!existsSync(p)) continue;
    const bundle = JSON.parse(readFileSync(p, "utf8"));
    for (const field of SPOKEN_FIELDS) {
      const text = bundle[field];
      if (typeof text !== "string" || text.trim().length === 0) continue;
      lines.push({ id: `${stop}.${field}`, stop, field, text: text.trim() });
    }
  }

  // The pre-flight ritual's lines, which live in ui.json rather than in a stage
  // bundle because they are the same at every stop. See SPOKEN_UI_KEYS.
  const uiPath = join(REPO, "src/content/en/ui.json");
  if (existsSync(uiPath)) {
    const ui = JSON.parse(readFileSync(uiPath, "utf8"));
    const strings = ui?.strings ?? {};
    for (const key of SPOKEN_UI_KEYS) {
      const text = strings[key];
      if (typeof text !== "string" || text.trim().length === 0) continue;
      lines.push({ id: key, stop: "ui", field: key, text: text.trim() });
    }
  }

  // Shadow's warp-break note, from both transports that can produce one.
  const coach = await loadCoachNotes();
  for (const note of coach.lines) {
    // `lang: null` is the mock, whose templates are English at every lang.
    if (note.lang !== null && !COACH_LANGS.includes(note.lang)) continue;
    const text = note.note.trim();
    if (text.length === 0) continue;
    lines.push({ id: note.id, stop: "coach", field: note.source, text });
  }
  UNRENDERABLE = coach.unrenderable;

  return lines;
}

/** Notes the game can say that no file can hold. Printed with the plan. */
let UNRENDERABLE = [];

/** Rows of the manifest already on disk, by id. Empty on a first run. */
function existingManifest() {
  const p = join(OUT, "manifest.json");
  if (!existsSync(p)) return new Map();
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    const rows = Array.isArray(parsed?.lines) ? parsed.lines : [];
    return new Map(rows.filter((r) => typeof r?.id === "string").map((r) => [r.id, r]));
  } catch {
    return new Map();
  }
}

async function listVoices() {
  if (!KEY) {
    console.error("ELEVENLABS_API_KEY is not set. Put it in .env and re-run.");
    process.exit(2);
  }
  const res = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": KEY },
  });
  if (!res.ok) {
    console.error(`voices request failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const { voices } = await res.json();
  console.log(`${voices.length} voices available:\n`);
  for (const v of voices) {
    const labels = Object.values(v.labels ?? {}).join(", ");
    console.log(`  ${v.voice_id}  ${v.name.padEnd(18)} ${labels}`);
  }
  console.log(`\nPick one and pass it: --voice <id>`);
}

async function render(line) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": KEY, "content-type": "application/json" },
      body: JSON.stringify({
        text: line.text,
        model_id: MODEL,
        // Shadow is a SMALL ROBOT (D66, D91: charcoal body, pale-blue eyes,
        // antenna). Male, light rather than deep, and slightly mechanical in
        // delivery. `stability` is the lever that matters: near 1.0 flattens
        // prosody toward monotone, which is what reads as machine. `style` at
        // zero keeps any performance out of it. Warmth has to come from the
        // WORDS, not the delivery — a robot that emotes is a cartoon, and the
        // character sheet is a little utility bot, not a mascot.
        voice_settings: {
          stability: Number(value("stability", "0.92")),
          similarity_boost: 0.75,
          style: 0,
          use_speaker_boost: false,
        },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`${line.id}: ${res.status} ${res.statusText} ${await res.text()}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

const lines = await collectLines();
const chars = lines.reduce((n, l) => n + l.text.length, 0);
const estUsd = chars * USD_PER_CHAR;

if (flag("list-voices")) {
  await listVoices();
  process.exit(0);
}

console.log(`Shadow's scripted lines (D63, build-time only)\n`);
for (const l of lines) {
  console.log(`  ${l.id.padEnd(26)} ${String(l.text.length).padStart(4)}c  ${JSON.stringify(l.text.slice(0, 60))}`);
}
console.log(`\n  ${lines.length} lines · ${chars} characters · est. $${estUsd.toFixed(4)} at $${USD_PER_CHAR}/char`);

if (UNRENDERABLE.length > 0) {
  console.log(`\nNOT rendered, and not renderable (D98 says these are SILENT, never an OS voice):`);
  for (const item of UNRENDERABLE) {
    console.log(`  ${JSON.stringify(item.shape)}`);
    console.log(`      ${item.reason}`);
  }
}

if (!LIVE) {
  console.log(`\nDRY RUN - nothing was sent and nothing was spent (D87).`);
  console.log(`To render:  node scripts/render-voice.mjs --live --voice <id> --cap-usd 1`);
  console.log(`To pick a voice:  node scripts/render-voice.mjs --list-voices`);
  process.exit(0);
}

// --- live path --------------------------------------------------------------

if (!KEY) {
  console.error("\nELEVENLABS_API_KEY is not set.");
  process.exit(2);
}
if (!VOICE_ID) {
  console.error("\n--voice <id> is required. Run --list-voices to choose one.");
  process.exit(2);
}
if (!Number.isFinite(CAP_USD) || CAP_USD <= 0) {
  console.error("\n--cap-usd is required and must be > 0 (D87: no live call without a cap).");
  process.exit(2);
}
if (estUsd > CAP_USD) {
  console.error(`\nEstimated $${estUsd.toFixed(4)} exceeds the cap of $${CAP_USD}. Refusing.`);
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });

/**
 * ================== THIS RUN IS RESUMABLE (and it was not) ==================
 * The loop used to let `render()` throw straight out of the script. One 429
 * half way down the list left N mp3s on disk, NO manifest, and a re-run that
 * paid for all of them again. Three changes fix it and none of them change what
 * a clean run does:
 *
 *   1. a line whose file and manifest row both already exist is SKIPPED and
 *      costs nothing, so a re-run only pays for what is missing;
 *   2. a failed line is caught, reported, and the run moves on rather than
 *      taking the whole batch down with it;
 *   3. the manifest is written in a `finally`, so whatever was rendered is
 *      recorded even when the run ends badly.
 *
 * `--force` re-renders everything, which is what a voice change needs.
 */
const previous = existingManifest();
const FORCE = flag("force");
let spent = 0;
let failed = 0;
let skipped = 0;
const manifest = [];

try {
  for (const line of lines) {
    const priorRow = previous.get(line.id);
    const file = `${line.id}.mp3`;
    if (!FORCE && priorRow !== undefined && existsSync(join(OUT, file))) {
      manifest.push(priorRow);
      skipped += 1;
      continue;
    }
    const cost = line.text.length * USD_PER_CHAR;
    if (spent + cost > CAP_USD) {
      console.error(`\nStopping: the next line would exceed the $${CAP_USD} cap.`);
      break;
    }
    try {
      const audio = await render(line);
      writeFileSync(join(OUT, file), audio);
      spent += cost;
      manifest.push({ id: line.id, file, chars: line.text.length, bytes: audio.length });
      console.log(`  rendered ${line.id.padEnd(26)} ${audio.length} bytes`);
    } catch (error) {
      failed += 1;
      console.error(`  FAILED   ${line.id.padEnd(26)} ${String(error?.message ?? error)}`);
    }
  }
} finally {
  writeFileSync(
    join(OUT, "manifest.json"),
    JSON.stringify(
      {
        renderedAt: new Date().toISOString(),
        model: MODEL,
        voiceId: VOICE_ID,
        // The language these recordings are IN. `browserVoiceClips` refuses to
        // serve them to a session reading another language, because the
        // scripted ids carry no language of their own (D98, E-VOICE-1).
        lang: "en",
        lines: manifest,
      },
      null,
      2,
    ) + "\n",
  );
}

console.log(
  `\n${manifest.length} lines in the manifest · ${skipped} already on disk · ` +
    `${failed} failed · $${spent.toFixed(4)} spent of $${CAP_USD} cap`,
);
console.log(`Written to src/content/audio/voice/ with a manifest.`);
if (failed > 0) {
  console.log(`Re-run the same command to retry only the ${failed} that failed.`);
  process.exit(1);
}
