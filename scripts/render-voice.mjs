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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(REPO, "src/content/audio/voice");
const STOPS = ["earth", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"];

/** Fields that Shadow SPEAKS. Everything else on a bundle is read, not said. */
const SPOKEN_FIELDS = ["preflightLine", "beaconHeadline", "beaconState", "beaconFlavor"];

/** ElevenLabs bills per character. Flash v2.5 is ~$0.00003/char on paid tiers. */
const USD_PER_CHAR = 0.00003;

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const LIVE = flag("live");
const CAP_USD = Number(value("cap-usd", process.env["SPEND_CAP_USD"] ?? "0"));
const VOICE_ID = value("voice", process.env["ELEVENLABS_VOICE_ID"]);
const MODEL = value("model", "eleven_flash_v2_5");
const KEY = process.env["ELEVENLABS_API_KEY"];

function collectLines() {
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
  return lines;
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
        // Shadow is warm and steady, never theatrical (D66). Low style, high
        // stability: he is a calm co-pilot talking to a seven-year-old.
        voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.15 },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`${line.id}: ${res.status} ${res.statusText} ${await res.text()}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

const lines = collectLines();
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
let spent = 0;
const manifest = [];

for (const line of lines) {
  const cost = line.text.length * USD_PER_CHAR;
  if (spent + cost > CAP_USD) {
    console.error(`\nStopping: the next line would exceed the $${CAP_USD} cap. Rendered ${manifest.length}.`);
    break;
  }
  const audio = await render(line);
  const file = `${line.id}.mp3`;
  writeFileSync(join(OUT, file), audio);
  spent += cost;
  manifest.push({ id: line.id, file, chars: line.text.length, bytes: audio.length });
  console.log(`  rendered ${line.id.padEnd(26)} ${audio.length} bytes`);
}

writeFileSync(
  join(OUT, "manifest.json"),
  JSON.stringify(
    { renderedAt: new Date().toISOString(), model: MODEL, voiceId: VOICE_ID, lines: manifest },
    null,
    2,
  ) + "\n",
);
console.log(`\n${manifest.length} lines · $${spent.toFixed(4)} spent of $${CAP_USD} cap`);
console.log(`Written to src/content/audio/voice/ with a manifest.`);
