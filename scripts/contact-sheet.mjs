#!/usr/bin/env node
/**
 * Capture every screen from the SERVED build, plus its alignment census.
 *
 * WHY THIS EXISTS. The project owner has found five separate defects by
 * looking at a screen that a green test suite said was fine - moving stars,
 * a squished lockup, eleven left edges on one screen, a ship that was not
 * theirs, words hidden behind other words. Every one was visible in a
 * screenshot and invisible to the guard that named it.
 *
 * So the deliverable each morning is not "the suite is green". It is nine
 * images and a table of numbers, so a human can judge nine screens at once
 * instead of discovering them one at a time over a day.
 *
 * It probes the BUILT PREVIEW, not the dev server and not the source,
 * because the question is always what the person actually sees.
 *
 *   node scripts/contact-sheet.mjs [--port 4180] [--out gauntlet/evidence/screens]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "@playwright/test";

const argv = process.argv.slice(2);
const value = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  const next = argv[i + 1];
  return i < 0 || next === undefined || next.startsWith("--") ? fallback : next;
};

const PORT = value("port", "4180");
const OUT = value("out", "gauntlet/evidence/screens");
const STOP = value("stop", "jupiter");

/** Every screen a child can reach, with the state that makes it interesting. */
const SCREENS = [
  { key: "Title", note: "returning pilot - the beacon status line only exists with a beacon" },
  { key: "DirectorMap", note: "" },
  { key: "Briefing", note: "" },
  { key: "Preflight", note: "worst measured: 16 left edges, gutter is 96" },
  { key: "Warp", note: "" },
  { key: "Results", note: "" },
  { key: "Beacon", note: "" },
  { key: "Settings", note: "carries the hull equip row" },
  { key: "Ending", note: "" },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const rows = [];

for (const screen of SCREENS) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  try {
    await page.goto(`http://localhost:${PORT}/?scene=${screen.key}&stop=${STOP}`, {
      waitUntil: "load",
    });
    // Wait for the entrance tweens to land rather than for a clock - every
    // screen animates in, and a fixed sleep measured mid-flight before.
    await page.waitForTimeout(2600);

    const census = await page.evaluate(() => {
      const game = window.__kb?.game;
      if (game === undefined) return null;
      const sizes = new Set();
      const families = new Set();
      const edges = new Set();
      const walk = (node) => {
        for (const child of node.list ?? []) {
          if (child.visible !== false) {
            if (child.type === "Text") {
              const style = child.style ?? {};
              if (style.fontSize !== undefined) sizes.add(String(style.fontSize));
              if (style.fontFamily !== undefined) {
                families.add(String(style.fontFamily).split(",")[0].trim());
              }
            }
            if (typeof child.getBounds === "function") {
              const b = child.getBounds();
              if (b.width > 40 && b.height > 8 && b.x > -300 && b.x < 1900) {
                edges.add(Math.round(b.x));
              }
            }
          }
          if (child.list !== undefined) walk(child);
        }
      };
      for (const s of game.scene.getScenes(true)) walk(s.children);
      return {
        sizes: [...sizes],
        families: [...families],
        edges: [...edges].sort((a, b) => a - b),
      };
    });

    await page.screenshot({ path: join(OUT, `${screen.key}.png`) });
    rows.push({ key: screen.key, note: screen.note, ...(census ?? { error: "no game on page" }) });
    console.log(`  ${screen.key.padEnd(13)} ${census === null ? "NO GAME" : `${census.edges.length} edges, ${census.sizes.length} type sizes`}`);
  } catch (error) {
    rows.push({ key: screen.key, error: String(error?.message ?? error).slice(0, 120) });
    console.log(`  ${screen.key.padEnd(13)} ERROR`);
  }
  await page.close();
}

await browser.close();

const allEdges = new Set();
const allSizes = new Set();
for (const r of rows) {
  for (const e of r.edges ?? []) allEdges.add(e);
  for (const s of r.sizes ?? []) allSizes.add(s);
}

writeFileSync(
  join(OUT, "census.json"),
  JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      port: PORT,
      stop: STOP,
      totals: { distinctLeftEdges: allEdges.size, distinctTypeSizes: allSizes.size },
      screens: rows,
    },
    null,
    2,
  ) + "\n",
);

console.log(`\n  APP-WIDE: ${allEdges.size} distinct left edges, ${allSizes.size} type sizes`);
console.log(`  images + census.json in ${OUT}`);
