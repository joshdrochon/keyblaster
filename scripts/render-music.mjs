#!/usr/bin/env node
/**
 * RENDER MUSIC (D63, AC-21.2, E-MUSIC-1).
 *
 *   node scripts/render-music.mjs                  dry run; prints the plan, spends nothing
 *   node scripts/render-music.mjs --live --cap-usd 2
 *
 * WHY ONE TRACK PER STOP AND NOT THREE.
 *
 * `music.ts` wants three CUMULATIVE intensity layers — bed, then bed+pulse,
 * then bed+pulse+drive — so a change in intensity reads as "the same piece
 * getting busier" rather than a different track starting. That is the right
 * design and it is already built.
 *
 * But three independently GENERATED clips cannot stack. They would be in
 * different keys, at different tempos, with unrelated phase; playing them
 * together is noise, not music. A generative model gives you a performance,
 * not stems.
 *
 * So each stop gets ONE piece, and the three layers are derived from that same
 * recording at playback time — the same buffer through three filter and gain
 * states. The music is real, the layers are cumulative in effect (more
 * brightness and more level as intensity rises), and they can never drift out
 * of phase with each other because they are one performance. AC-21.2's
 * requirement — three layers, index a pure function of live state — is
 * unchanged.
 *
 * LOOPING. Every piece is asked to be loopable, and the seam is checked by the
 * same offline discontinuity test the audio lane built for the wind bed: a
 * loop that does not join is a defect however good the music is.
 *
 * SPEND. Dry run is the default and prints the plan. `--live` needs an explicit
 * `--cap-usd` (D87), and the script refuses if the estimate exceeds it. It is
 * resumable: a stop whose file is already on disk is skipped, so a failure
 * halfway does not re-pay for the half that worked.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(REPO, "src/content/audio/music");

const flag = (n) => process.argv.includes(`--${n}`);
const value = (n, d = null) => {
  const i = process.argv.indexOf(`--${n}`);
  if (i < 0) return d;
  const v = process.argv[i + 1];
  // Do not swallow the next flag as a value — render-voice shipped that bug.
  return v === undefined || v.startsWith("--") ? d : v;
};

const LIVE = flag("live");
const CAP_USD = Number(value("cap-usd", "0"));
const KEY = process.env["ELEVENLABS_API_KEY"];
const LENGTH_MS = Number(value("ms", "40000"));

/**
 * One piece per stop. The brief for each is the PLACE, not a genre: the story
 * gives each stop a character and the music should follow the story rather
 * than a stock adjective.
 */
const STOPS = [
  { id: "earth", mood: "hopeful and close to home, a gentle send-off, warm and safe" },
  { id: "mars", mood: "dusty red frontier, curious and a little brave, first real distance" },
  { id: "jupiter", mood: "vast and stormy but not frightening, big slow awe" },
  { id: "saturn", mood: "weightless and glittering, ice and rings, delicate wonder" },
  { id: "uranus", mood: "cold tilted quiet, strange and still, patient" },
  { id: "neptune", mood: "deep blue distance, far from home, steady resolve" },
  { id: "pluto", mood: "the edge of everything, small and triumphant, the long way back" },
];

const BRIEF = (mood) =>
  `Instrumental background music for a children's space typing game, ages 7 to 11. ${mood}. ` +
  `A simple memorable melody a child could hum, soft synth pads, light gentle percussion, warm and encouraging, ` +
  `never tense, never sad, no vocals, no speech, no sudden loud hits. ` +
  `Steady tempo, loops seamlessly with no gap or change at the loop point.`;

/** Rough, and deliberately pessimistic so the cap bites early. */
const USD_PER_SECOND = 0.008;

function plan() {
  return STOPS.map((s) => ({
    ...s,
    file: `${s.id}.mp3`,
    onDisk: existsSync(join(OUT, `${s.id}.mp3`)),
    prompt: BRIEF(s.mood),
  }));
}

async function render(item) {
  const res = await fetch("https://api.elevenlabs.io/v1/music", {
    method: "POST",
    headers: { "xi-api-key": KEY, "content-type": "application/json" },
    body: JSON.stringify({ prompt: item.prompt, music_length_ms: LENGTH_MS }),
  });
  if (!res.ok) throw new Error(`${item.id}: ${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

// ---------------------------------------------------------------------------

const items = plan();
const todo = items.filter((i) => !i.onDisk);
const seconds = (todo.length * LENGTH_MS) / 1000;
const estimate = seconds * USD_PER_SECOND;

console.log(`\n${items.length} stops · ${todo.length} to render · ${LENGTH_MS / 1000}s each`);
for (const i of items) {
  console.log(`  ${i.onDisk ? "have" : "  — "}  ${i.id.padEnd(8)} ${i.mood.slice(0, 58)}`);
}
console.log(`\n  ${seconds}s · est. $${estimate.toFixed(2)}`);

if (!LIVE) {
  console.log(`\nDRY RUN — nothing sent, nothing spent (D87).`);
  console.log(`To render:  node scripts/render-music.mjs --live --cap-usd 2\n`);
  process.exit(0);
}
if (!KEY) {
  console.error("\nELEVENLABS_API_KEY is not set.");
  process.exit(1);
}
if (!(CAP_USD > 0)) {
  console.error("\n--live requires an explicit --cap-usd (D87).");
  process.exit(1);
}
if (estimate > CAP_USD) {
  console.error(`\nEstimate $${estimate.toFixed(2)} exceeds the $${CAP_USD} cap. Refusing.`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
let spent = 0;
let failed = 0;
for (const item of todo) {
  try {
    const buf = await render(item);
    writeFileSync(join(OUT, item.file), buf);
    spent += (LENGTH_MS / 1000) * USD_PER_SECOND;
    console.log(`  rendered ${item.id.padEnd(8)} ${buf.length} bytes`);
  } catch (e) {
    failed += 1;
    console.error(`  FAILED   ${item.id.padEnd(8)} ${String(e).slice(0, 120)}`);
  }
}

// Manifest last but in a finally-ish position: a partial run still leaves a
// truthful record of what is on disk.
const onDisk = plan().filter((i) => i.onDisk);
writeFileSync(
  join(OUT, "manifest.json"),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      lengthMs: LENGTH_MS,
      note: "One piece per stop. The three AC-21.2 intensity layers are derived from this same buffer at playback; generated clips cannot stack.",
      tracks: onDisk.map((i) => ({ stopId: i.id, file: i.file, prompt: i.prompt })),
    },
    null,
    2,
  )}\n`,
);

console.log(`\n${onDisk.length} on disk · ${failed} failed · ~$${spent.toFixed(2)} of $${CAP_USD}`);
console.log(`Written to src/content/audio/music/\n`);
