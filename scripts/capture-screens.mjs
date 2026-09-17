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
 * menu), the upside-down floor vignette, and the edge bars the user reported
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
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync } from "node:fs";
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
 * Transcribed from `tests/e2e/story-lane.ts` PROGRESS_VARIANTS rather than
 * imported, because that file is a Playwright helper and this is a plain script.
 */
const STOPS = ["earth", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"];
const charted = (stopId, stars, bestWpm, bestAccuracy) => ({
  stopId,
  charted: true,
  stars,
  bestWpm,
  bestAccuracy,
});
const PROGRESS = {
  marsOnly: [charted("earth", 3, 0, 0)],
  midRun: [
    charted("earth", 3, 0, 0),
    charted("mars", 3, 26, 97),
    charted("jupiter", 2, 29, 93),
    charted("saturn", 2, 31, 91),
  ],
  allSeven: STOPS.map((s, i) => charted(s, i === 0 ? 3 : (i % 3) + 1, 20 + i * 3, 90 + i)),
};

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
  { id: "map-mars-only", scene: "DirectorMap", data: { progress: PROGRESS.marsOnly }, settleMs: 1600 },
  { id: "map-mid-run", scene: "DirectorMap", data: { progress: PROGRESS.midRun }, settleMs: 1600 },
  { id: "map-all-seven", scene: "DirectorMap", data: { progress: PROGRESS.allSeven }, settleMs: 1600 },
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

  // A full re-run replaces the whole directory, so a screen that has been
  // removed from the inventory cannot leave a stale PNG behind for a judge to
  // compare against. Scoped to `--only`-less runs for the obvious reason.
  if (wanted === null && existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const results = [];

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
      if (screen.data !== undefined) {
        await page.evaluate(
          ({ key, data }) => window.__kb?.game.scene.getScene(key)?.scene.restart(data),
          { key: screen.scene, data: screen.data },
        );
        await page.waitForTimeout(600);
      }
      await page.waitForTimeout(screen.settleMs ?? 1500);

      const file = join(OUT, `${screen.id}.png`);
      await page.screenshot({ path: file, type: "png" });
      results.push({
        id: screen.id,
        scene: screen.scene,
        file: `gauntlet/evidence/screens/${screen.id}.png`,
        variant: screen.data === undefined ? null : Object.keys(screen.data).join(","),
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

