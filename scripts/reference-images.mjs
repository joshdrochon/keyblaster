#!/usr/bin/env node
/**
 * Generate SHAPE REFERENCE art into design-reference/refs/ (D84).
 *
 *   node scripts/reference-images.mjs                  DRY RUN - prints prompts, spends nothing
 *   node scripts/reference-images.mjs --live --cap-usd 2
 *
 * D84: "Image models are reference-only. If the user supplies IMAGE_API_KEY, a
 * script may generate reference pictures into design-reference/refs/ ... never
 * loaded by the game; build test fails if any raster is referenced from src/."
 * `G-raster` enforces that second half already.
 *
 * WHAT THIS IS FOR, AND WHAT IT IS NOT.
 * It is a SHAPE VOCABULARY, not finished art. Alto's lead artist describes the
 * style as "stripping away the noise and reducing elements down to their
 * simplest components", and the team's own account is that assets are AUTHORED
 * and then assembled procedurally. Our world generates its geometry from noise
 * instead, which is why it reads as plausible rather than designed.
 *
 * So every prompt asks for flat black silhouettes on white with no interior
 * detail and no shading. That is the thing a person can trace into point lists.
 * A rendered illustration - gradients, texture, lighting - is worse than useless
 * here, because it cannot be traced and it flatters itself.
 *
 * D87: no live call without --live AND a spend cap.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(REPO, "design-reference/refs/generated");

/** gpt-image-1 at 1024x1024 standard quality. Confirm against current pricing. */
const USD_PER_IMAGE = 0.04;

const STYLE = [
  "flat vector silhouette sheet",
  "solid pure black shapes on a pure white background",
  "no gradients, no texture, no shading, no outlines, no detail inside the shapes",
  "side profile, orthographic, shapes arranged in a row with clear space between them",
  "simple bold geometry, chunky and readable at small size, gently angular",
  "the style of minimalist mobile game background art",
].join(", ");

/**
 * One sheet per stop, described from the FR-12b debris table and the story so
 * the shapes are the RIGHT shapes, not generic rocks. Sources are already cited
 * per stop in src/game/render/asteroid.ts.
 */
const SHEETS = [
  { id: "mars-massifs", subject: "six different Martian rock formations and mesas, wind-carved, layered terraces, one tall spire" },
  { id: "mars-debris", subject: "eight small rounded rocky asteroid chunks of varying size, cratered, irregular but friendly" },
  { id: "belt-debris", subject: "eight asteroid silhouettes of three kinds: dark lumpy carbonaceous, angular silicate, compact metallic" },
  { id: "saturn-ice", subject: "eight chunks of ring ice, faceted and crystalline, from tiny grains to a house-sized block" },
  { id: "uranus-shards", subject: "seven narrow dark icy ring shards, thin and splintered" },
  { id: "neptune-bodies", subject: "seven icy bodies, rounded and pitted, with faint ring debris" },
  { id: "pluto-kuiper", subject: "eight Kuiper belt ice chunks, angular frozen blocks, one with a heart-shaped plain" },
  { id: "foreground-frame", subject: "four near-camera foreground rock masses for framing the bottom corners of a screen, large and simple" },
];

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const val = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const LIVE = flag("live");
const CAP = Number(val("cap-usd", process.env["SPEND_CAP_USD"] ?? "0"));
const KEY = process.env["IMAGE_API_KEY"];
const MODEL = val("model", "gpt-image-1");
const SIZE = val("size", "1024x1024");

const prompts = SHEETS.map((s) => ({ ...s, prompt: `${s.subject}. ${STYLE}.` }));
const est = prompts.length * USD_PER_IMAGE;

console.log(`Shape-reference sheets (D84 - reference only, never shipped)\n`);
for (const p of prompts) console.log(`  ${p.id.padEnd(20)} ${p.subject}`);
console.log(`\n  ${prompts.length} sheets · est. $${est.toFixed(2)} at $${USD_PER_IMAGE}/image · ${MODEL} ${SIZE}`);
console.log(`\nShared style on every prompt:\n  ${STYLE}`);

if (!LIVE) {
  console.log(`\nDRY RUN - nothing sent, nothing spent (D87).`);
  console.log(`To generate:  node scripts/reference-images.mjs --live --cap-usd 1`);
  process.exit(0);
}

if (!KEY) { console.error("\nIMAGE_API_KEY is not set. Put it in .env and re-run."); process.exit(2); }
if (!Number.isFinite(CAP) || CAP <= 0) { console.error("\n--cap-usd is required and must be > 0 (D87)."); process.exit(2); }
if (est > CAP) { console.error(`\nEstimated $${est.toFixed(2)} exceeds the $${CAP} cap. Refusing.`); process.exit(2); }

mkdirSync(OUT, { recursive: true });
let spent = 0;
const manifest = [];

for (const p of prompts) {
  if (spent + USD_PER_IMAGE > CAP) { console.error(`\nStopping at the $${CAP} cap. Generated ${manifest.length}.`); break; }
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt: p.prompt, size: SIZE, n: 1 }),
  });
  if (!res.ok) { console.error(`${p.id}: ${res.status} ${await res.text()}`); continue; }
  const body = await res.json();
  const b64 = body.data?.[0]?.b64_json;
  const url = body.data?.[0]?.url;
  let bytes;
  if (b64) bytes = Buffer.from(b64, "base64");
  else if (url) bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
  else { console.error(`${p.id}: no image in response`); continue; }
  const file = `${p.id}.png`;
  writeFileSync(join(OUT, file), bytes);
  spent += USD_PER_IMAGE;
  manifest.push({ id: p.id, file, prompt: p.prompt, bytes: bytes.length });
  console.log(`  generated ${p.id.padEnd(20)} ${bytes.length} bytes`);
}

writeFileSync(
  join(OUT, "manifest.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), model: MODEL, size: SIZE, sheets: manifest }, null, 2) + "\n",
);
console.log(`\n${manifest.length} sheets · $${spent.toFixed(2)} of $${CAP}`);
console.log(`Written to design-reference/refs/generated/ — reference only (D84).`);
