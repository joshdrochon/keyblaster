#!/usr/bin/env node
/**
 * CAPTURE EVERY SCREEN (the standing method for judging art changes).
 *
 *   node scripts/capture-screens.mjs
 *   node scripts/capture-screens.mjs --port 5191        # a free port
 *   node scripts/capture-screens.mjs --only Title,Flight
 *
 * Writes one full-size PNG per screen into `gauntlet/evidence/screens/`, plus a
 * `manifest.json` recording what was captured, from which scene key, with what
 * data, and how big the file came out.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * Every art round so far has been judged off two frames - `flight-frame.png` and
 * `title-frame.png` - because those were the two an e2e spec happened to write.
 * A change to `render/parallax.ts` lands on FOURTEEN screens, and three separate
 * defects reached a player through the twelve nobody was looking at: the pale
 * near-plane slabs (seen first on the Title, months after they shipped on every
 * menu), the upside-down floor vignette, and the edge bars reported from play
 * three times. None of those was subtle. They were simply never rendered where
 * anyone would see them.
 *
 * So the capture is the method now, not an afterthought: every art change gets
 * re-run through this and re-judged against `design-reference/refs/world-bar.png`
 * and the three `alto-*.png` beside it.
 *
 * ---------------------------------------------------------------------------
 * HOW IT BOOTS A SCREEN
 *
 * `src/game/boot.ts` reads `?scene=<key>` and starts that scene directly, which
 * is the same entry point the e2e suite uses. Screens that need a particular
 * state - the Director map has three progress variants in the screen inventory -
 * get it through `scene.restart(data)` afterwards, exactly as
 * `tests/e2e/story-lane.ts` does, so a captured screen is the shipped scene in a
 * shipped state rather than a special build.
 *
 * A screen that fails to come up is RECORDED AND SKIPPED rather than aborting
 * the run, because a half-finished scene in another lane must not cost the other
 * thirteen captures. The process still exits non-zero, so a failure cannot pass
 * unnoticed in CI.
 *
 * It never writes outside the repo (D87), and it starts nothing that outlives
 * it: if it spawns a dev server it kills it on the way out.
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync, readFileSync} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(REPO, "gauntlet", "evidence", "screens");

const argOf = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const PORT = Number(argOf("port", 5183));
const ONLY = argOf("only", null);

/** The design resolution the art is drawn against (D81 / sceneKeys.ts). */
const VIEWPORT = { width: 1280, height: 720 };

/**
 * Progress fixtures for the screens whose inventory row demands variants.
 *
 * BUILT BY THE ENGINE, IN THE PAGE. This used to be a hand-transcription of
 * `tests/e2e/story-lane.ts`, and the transcription was wrong: it wrote
 * `charted: true`, a field `StopProgress` does not have and no reader consumes.
 * `isCharted` read `beaconPlacedAt !== null`, which is TRUE when the field is
 * absent, so the header counted seven lit beacons; `unlockedStops` read
 * `cleared`, which was absent too, so every label said "Locked". The capture
 * that went to the critic showed a finished game telling the child it was
 * locked, and the game itself was innocent.
 *
 * So the fixture is no longer transcribed at all. `markStopCleared` - the one
 * function that writes a cleared stop anywhere in this build - is imported
 * inside the browser and called, which means this script cannot invent a shape
 * the game does not use. The stop list comes from `@engine/types` for the same
 * reason.
 */
const PROGRESS_BUILDER = `
  const { markStopCleared } = await import("/src/engine/progress/index.ts");
  const { STOP_IDS } = await import("/src/engine/types.ts");
  const clear = (acc, stopId, stars, wpm, accuracy) =>
    markStopCleared(acc, stopId, { atMs: 1700000000000, stars, wpm, accuracy });
  const build = (ids) =>
    ids.reduce(
      (acc, s, i) => clear(acc, s, i === 0 ? 3 : (i % 3) + 1, 20 + i * 3, 90 + i),
      [],
    );
  return {
    marsOnly: build(STOP_IDS.slice(0, 1)),
    midRun: build(STOP_IDS.slice(0, 4)),
    allSeven: build(STOP_IDS),
  };
`;

/** Filled by `loadProgressVariants()` before any screen is captured. */
let PROGRESS = null;

/**
 * Every fixture entry must be a real `StopProgress`. Belt and braces on the
 * defect above: if the engine import ever silently resolves to something else,
 * the run stops here instead of shipping seventeen misleading PNGs.
 */
const REQUIRED_KEYS = [
  "stopId",
  "cleared",
  "stars",
  "bestWpm",
  "bestAccuracy",
  "lastWpm",
  "lastAccuracy",
  "beaconPlacedAt",
];

function assertProgressShape(variants) {
  for (const [name, rows] of Object.entries(variants)) {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error(`progress fixture "${name}" built nothing`);
    }
    for (const row of rows) {
      const missing = REQUIRED_KEYS.filter((k) => !(k in row));
      if (missing.length) {
        throw new Error(
          `progress fixture "${name}" entry ${row.stopId}: missing ${missing.join(", ")}`,
        );
      }
      if (row.cleared !== true || row.beaconPlacedAt === null) {
        throw new Error(
          `progress fixture "${name}" entry ${row.stopId} is not a cleared, beacon-placed stop`,
        );
      }
    }
  }
  return variants;
}

/**
 * The screen inventory, as screens rather than as scene keys.
 *
 * `settleMs` is per-screen on purpose: entrance tweens differ, and a frame
 * captured mid-tween is a picture of a transition rather than of a screen.
 */
const SCREENS = [
  { id: "title", scene: "Title", settleMs: 2200 },
  { id: "profile-picker", scene: "ProfilePicker", settleMs: 1200 },
  { id: "profile-create", scene: "ProfileCreate", settleMs: 1200 },
  { id: "earth-activation", scene: "EarthActivation", settleMs: 2000 },
  { id: "map-mars-only", scene: "DirectorMap", progress: "marsOnly", settleMs: 1600 },
  { id: "map-mid-run", scene: "DirectorMap", progress: "midRun", settleMs: 1600 },
  { id: "map-all-seven", scene: "DirectorMap", progress: "allSeven", settleMs: 1600 },
  { id: "briefing", scene: "Briefing", settleMs: 1800 },
  { id: "preflight", scene: "Preflight", settleMs: 2000 },
  { id: "flight", scene: "Flight", settleMs: 3200 },
  { id: "warp", scene: "Warp", settleMs: 2200 },
  { id: "beacon", scene: "Beacon", settleMs: 2400 },
  { id: "results", scene: "Results", settleMs: 2200 },
  { id: "beacon-log", scene: "BeaconLog", settleMs: 1600 },
  { id: "settings", scene: "Settings", settleMs: 1400 },
  { id: "pause", scene: "Pause", settleMs: 1400 },
  { id: "ending", scene: "Ending", settleMs: 2600 },
];

// ---------------------------------------------------------------------------
// Dev server
// ---------------------------------------------------------------------------

/**
 * Is a dev server answering on this port?
 *
 * An HTTP probe rather than a raw socket connect. The first version opened a
 * TCP connection to 127.0.0.1 and it reported "free" for a port that had two
 * vite processes on it, so the script started a second server, collided on
 * `--strictPort` and timed out. Asking for the page answers the question that
 * actually matters - can the capture load the app - and it costs one request.
 */
const listening = async (port) => {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 1500);
  try {
    const res = await fetch(`http://localhost:${port}/`, { signal: abort.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

async function ensureServer(port) {
  if (await listening(port)) {
    console.log(`using the dev server already on ${port}`);
    return null;
  }
  console.log(`starting a dev server on ${port}`);
  // `shell: true`: `npm` is a shim on macOS and spawning it without a shell
  // starts nothing, silently - the first run of this timed out for sixty
  // seconds waiting on a process that had already exited.
  const child = spawn(
    `npm run dev -- --port ${port} --strictPort`,
    { cwd: REPO, stdio: "ignore", shell: true },
  );
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await listening(port)) return child;
    await new Promise((r) => setTimeout(r, 400));
  }
  child.kill();
  throw new Error(`dev server did not come up on ${port} within 60s`);
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

async function main() {
  const { chromium } = await import("@playwright/test");
  const server = await ensureServer(PORT);
  const base = `http://localhost:${PORT}`;
  const wanted = ONLY ? new Set(ONLY.split(",").map((s) => s.trim().toLowerCase())) : null;
  const screens = SCREENS.filter(
    (s) => wanted === null || wanted.has(s.id) || wanted.has(s.scene.toLowerCase()),
  );

  // A full re-run clears the screens THIS SCRIPT OWNS, so a screen removed from
  // the inventory cannot leave a stale PNG behind for a judge to compare
  // against. Scoped to `--only`-less runs for the obvious reason.
  //
  // IT USED TO `rmSync(OUT, { recursive: true })`, WHICH WAS WRONG. The intent
  // was right and the blast radius was not: this directory is shared. A
  // playthrough agent had written 24 screenshots into it and a routine capture
  // run deleted all of them mid-session. Evidence a judge will read is not
  // something a tool gets to remove because it did not recognise the filename.
  //
  // Ownership is the previous manifest plus the current inventory, so a
  // renamed or removed screen is still cleaned up and nothing else is touched.
  mkdirSync(OUT, { recursive: true });
  if (wanted === null) {
    const owned = new Set(SCREENS.map((s) => `${s.id}.png`));
    const prev = join(OUT, "manifest.json");
    if (existsSync(prev)) {
      try {
        const m = JSON.parse(readFileSync(prev, "utf8"));
        for (const row of m.screens ?? []) if (row.file) owned.add(row.file);
      } catch {
        // A corrupt manifest means we cannot prove ownership, so we remove
        // nothing. Leaving a stale PNG is recoverable; deleting a judge's
        // evidence is not.
      }
    }
    for (const f of owned) {
      const abs = join(OUT, f);
      if (existsSync(abs)) rmSync(abs, { force: true });
    }
  }

  const browser = await chromium.launch();

  // The fixtures come out of the engine, in the page, before anything is shot.
  {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    try {
      await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      PROGRESS = assertProgressShape(
        await page.evaluate(new Function(`return (async () => {${PROGRESS_BUILDER}})()`)),
      );
      console.log(
        `progress fixtures built by the engine: ${Object.entries(PROGRESS)
          .map(([k, v]) => `${k} (${v.length})`)
          .join(", ")}`,
      );
    } finally {
      await page.close();
    }
  }

  const results = [];
  /** Every colour pair the captured screens drew over the sky (V-22.8). */
  const skyRows = [];

  for (const screen of screens) {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      // Vite's HMR socket pushes a full reload whenever another lane saves a
      // file, and a reload mid-capture detaches the canvas. Same stub the e2e
      // support module uses.
      await page.addInitScript(() => {
        class DeadSocket extends EventTarget {
          readyState = 3;
          send() {}
          close() {}
        }
        window.WebSocket = DeadSocket;
      });
      await page.goto(`${base}/?scene=${screen.scene}`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.__kb !== undefined, null, { timeout: 45_000 });
      await page.waitForFunction(
        (key) => {
          const scene = window.__kb?.game.scene.getScene(key);
          return scene !== null && scene !== undefined && scene.scene?.isActive() === true;
        },
        screen.scene,
        { timeout: 45_000 },
      );
      const data =
        screen.progress === undefined
          ? screen.data
          : { ...screen.data, progress: PROGRESS[screen.progress] };
      if (data !== undefined) {
        await page.evaluate(
          ({ key, payload }) => window.__kb?.game.scene.getScene(key)?.scene.restart(payload),
          { key: screen.scene, payload: data },
        );
        await page.waitForTimeout(600);
      }
      await page.waitForTimeout(screen.settleMs ?? 1500);

      const file = join(OUT, `${screen.id}.png`);
      await page.screenshot({ path: file, type: "png" });

      // V-22.8 EVIDENCE, TAKEN OFF THE SCREEN THAT WAS JUST SHOT.
      //
      // Sky-borne headlines shipped at 1.19:1 - 1.72:1 because the contrast
      // rubric only ever measured the word plate. Every scene now registers the
      // colour pair behind each piece of text it draws over the world, and the
      // capture reads them back from the same frame the judge is looking at, so
      // the number in the evidence file and the number on the PNG are the same
      // screen. A scene that registers nothing contributes nothing, and the
      // rubric fails on the missing screen rather than passing on silence.
      const sky = await page.evaluate((key) => {
        const scene = window.__kb?.game.scene.getScene(key);
        const snap = typeof scene?.snapshot === "function" ? scene.snapshot() : null;
        return Array.isArray(snap?.skyText) ? snap.skyText : [];
      }, screen.scene);
      for (const row of sky) skyRows.push({ ...row, capture: screen.id });
      results.push({
        id: screen.id,
        scene: screen.scene,
        file: `gauntlet/evidence/screens/${screen.id}.png`,
        variant: screen.progress ?? (screen.data === undefined ? null : Object.keys(screen.data).join(",")),
        bytes: statSync(file).size,
        pageErrors: errors.slice(0, 4),
        status: "ok",
      });
      console.log(`  ok    ${screen.id.padEnd(18)} ${screen.scene}`);
    } catch (e) {
      results.push({
        id: screen.id,
        scene: screen.scene,
        status: "failed",
        error: String(e).split("\n")[0],
        pageErrors: errors.slice(0, 4),
      });
      console.log(`  FAIL  ${screen.id.padEnd(18)} ${screen.scene}  ${String(e).split("\n")[0]}`);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  if (server !== null) server.kill();

  // The rubric reads this; `tests/unit/contrast` proves the maths it uses.
  if (wanted === null) {
    const EVIDENCE = join(REPO, "gauntlet", "evidence");
    mkdirSync(EVIDENCE, { recursive: true });
    writeFileSync(
      join(EVIDENCE, "contrast-sky.json"),
      `${JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          source: "scripts/capture-screens.mjs, from each scene's snapshot().skyText",
          note: "plateFill/plateAlpha are composited over WORST_CASE_SKY (white) by the rubric, so every ratio is the worst a sky can produce",
          screens: [...new Set(skyRows.map((r) => r.screen))].sort(),
          rows: skyRows,
        },
        null,
        2,
      )}\n`,
    );
    console.log(
      `sky-borne text measured: ${skyRows.length} row(s) across ${
        new Set(skyRows.map((r) => r.screen)).size
      } screen(s) -> gauntlet/evidence/contrast-sky.json`,
    );
  }

  const failed = results.filter((r) => r.status === "failed");
  writeFileSync(
    join(OUT, "manifest.json"),
    `${JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        viewport: VIEWPORT,
        port: PORT,
        judgedAgainst: [
          "design-reference/refs/world-bar.png",
          "design-reference/refs/alto-01_ChasmJump.png",
          "design-reference/refs/alto-03_PalmKicker.png",
          "design-reference/refs/alto-05_WaterDive.png",
        ],
        captured: results.length - failed.length,
        failed: failed.length,
        screens: results,
      },
      null,
      2,
    )}\n`,
  );

  console.log(
    `\n${results.length - failed.length}/${results.length} screens -> gauntlet/evidence/screens/`,
  );
  if (failed.length) {
    console.error(`${failed.length} screen(s) failed: ${failed.map((f) => f.id).join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

