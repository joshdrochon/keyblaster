#!/usr/bin/env node
/**
 * RENDER AUDIBLE EVIDENCE (UR-13, UR-25, UR-30).
 *
 *   node scripts/render-audio-evidence.mjs
 *
 * Three of the audio reports this lane answers close on a HUMAN saying it
 * sounds right - a hum that is "annoying", typing that is not "satisfying", a
 * blast that feels "empty". No assertion settles any of those, so the lane also
 * ships the sound itself: WAVs of the real buses at the real bus gains, written
 * to gauntlet/evidence/audio/.
 *
 * A thin launcher, like scripts/render-music.mjs: the work is TypeScript because
 * it drives the SHIPPING modules rather than a copy of them, and vite-node is
 * how this repo runs TypeScript outside vitest.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = spawnSync("npx", ["vite-node", "scripts/lib/audioEvidence.ts"], {
  cwd: REPO,
  stdio: "inherit",
});
process.exit(run.status ?? 1);
