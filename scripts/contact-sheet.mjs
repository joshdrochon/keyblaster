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
      const DECOR = "kb-decor:";
      const sizes = new Set();
      const families = new Set();
      const edges = new Set();
      /**
       * EVERY ELEMENT, NAMED. The census used to emit a bag of x values, so a
       * near-miss pair could be reported but never attributed - and eight of
       * the fifteen pairs it reported turned out to be a decorative rock, an
       * invisible hit target or two correctly centred labels. A number nobody
       * can attribute is a number nobody can fix.
       */
      const elements = [];
      const walk = (node, scene, path, inDecor) => {
        let i = 0;
        for (const child of node.list ?? []) {
          i += 1;
          const name = typeof child.name === "string" ? child.name : "";
          const decor = inDecor || name.startsWith(DECOR);
          const here = `${path}/${child.type}${name === "" ? "" : "#" + name}[${i}]`;
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
                elements.push({
                  scene,
                  path: here,
                  type: child.type,
                  decor,
                  // An element's OWN declaration of what it is anchored by.
                  // 0 left, 0.5 centred, 1 right-anchored. Read off the object
                  // rather than inferred from where it landed.
                  originX: typeof child.originX === "number" ? child.originX : null,
                  x: Math.round(b.x * 100) / 100,
                  y: Math.round(b.y * 100) / 100,
                  w: Math.round(b.width * 100) / 100,
                  h: Math.round(b.height * 100) / 100,
                  fontSize:
                    child.type === "Text" && child.style?.fontSize !== undefined
                      ? String(child.style.fontSize)
                      : null,
                  text:
                    child.type === "Text" ? String(child.text ?? "").slice(0, 48) : null,
                });
              }
            }
          }
          if (child.list !== undefined) walk(child, scene, here, decor);
        }
      };
      for (const s of game.scene.getScenes(true)) walk(s.children, s.scene.key, s.scene.key, false);
      return {
        sizes: [...sizes],
        families: [...families],
        edges: [...edges].sort((a, b) => a - b),
        elements,
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

/**
 * A NEAR MISS: two left edges 1-8 px apart. Never a decision, always a nudge
 * somebody forgot to take back out - PROVIDED both edges are actually a left
 * edge somebody chose.
 *
 * RAW counts every object the walk found, which is the number this census has
 * always printed. LAYOUT counts only elements that DECLARE a left anchor
 * (`originX === 0`), are not decoration and are not an invisible hit target.
 * The gap between the two numbers is not an exemption list; it is the metric
 * being honest about what it can see:
 *
 *   decor      a seeded-random rock in a parallax layer. It has no line.
 *   Zone       a pointer hit target. It draws nothing at all.
 *   originX    0.5 is centred and 1 is right-anchored; both are correct
 *              alignments whose LEFT edge is a function of the element's own
 *              width, so two of them can never share one and driving the raw
 *              number to zero would mean forbidding centred type.
 */
const NEAR_MIN = 1;
const NEAR_MAX = 8;

function pairsOf(items) {
  const edges = [...new Set(items.map((e) => Math.round(e.x)))].sort((a, b) => a - b);
  const out = [];
  for (let i = 1; i < edges.length; i += 1) {
    const gap = edges[i] - edges[i - 1];
    if (gap < NEAR_MIN || gap > NEAR_MAX) continue;
    const at = (x) => items.filter((e) => Math.round(e.x) === x);
    out.push({
      left: edges[i - 1],
      right: edges[i],
      gap,
      drawnBy: [...at(edges[i - 1]), ...at(edges[i])].map(
        (e) => `${e.path}${e.text === null ? "" : ` ${JSON.stringify(e.text)}`} x=${e.x}`,
      ),
    });
  }
  return out;
}

const isLayout = (e) => !e.decor && e.type !== "Zone" && e.originX === 0;

for (const r of rows) {
  const items = r.elements ?? [];
  r.nearMissRaw = pairsOf(items);
  r.nearMiss = pairsOf(items.filter(isLayout));
  r.layoutElements = items.filter(isLayout).length;
}

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
      totals: {
        distinctLeftEdges: allEdges.size,
        distinctTypeSizes: allSizes.size,
        nearMissPairs: rows.reduce((a, r) => a + (r.nearMiss?.length ?? 0), 0),
        nearMissPairsRaw: rows.reduce((a, r) => a + (r.nearMissRaw?.length ?? 0), 0),
      },
      screens: rows,
    },
    null,
    2,
  ) + "\n",
);

const totalNear = rows.reduce((a, r) => a + (r.nearMiss?.length ?? 0), 0);
const totalNearRaw = rows.reduce((a, r) => a + (r.nearMissRaw?.length ?? 0), 0);
console.log("");
for (const r of rows) {
  console.log(
    `  ${r.key.padEnd(13)} near-miss ${String(r.nearMiss?.length ?? 0).padStart(2)} layout` +
      ` / ${String(r.nearMissRaw?.length ?? 0).padStart(2)} raw   edges ${(r.edges ?? []).length}`,
  );
  for (const p of r.nearMiss ?? []) {
    console.log(`      (${p.left},${p.right}) gap ${p.gap}`);
    for (const who of p.drawnBy) console.log(`        ${who}`);
  }
}
console.log(`\n  APP-WIDE: ${allEdges.size} distinct left edges, ${allSizes.size} type sizes`);
console.log(`  NEAR-MISS PAIRS: ${totalNear} layout / ${totalNearRaw} raw`);
console.log(`  images + census.json in ${OUT}`);
