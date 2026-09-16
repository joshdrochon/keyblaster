#!/usr/bin/env node
/**
 * TRACE CHECK (D61 granularity rule, D78 screen completeness, architecture 10.2).
 *
 *   node scripts/trace-check.mjs            structural check; runs inside npm test
 *   node scripts/trace-check.mjs --strict   also requires a live test citing each AC
 *
 * Three relations are enforced:
 *   1. every DECIDED Dxx in the decision log maps to >= 1 AC in the PRD
 *   2. every ACx.y in the PRD declares >= 1 test type (U/E/V/P/M)
 *   3. every scene in src/game/scenes has a screen-inventory row, and vice versa
 *
 * WHY --strict EXISTS. CLAUDE.md wants every AC mapped to a real test. Most ACs
 * describe scenes that are not built yet, so demanding a live test today would
 * make npm test permanently red and every commit a red merge - which CLAUDE.md
 * also forbids. So the structural relations fail the build now, and the
 * AC -> live-test linkage is COUNTED AND PRINTED on every run so the gap is
 * visible rather than hidden. --strict turns that count into a failure and is
 * what the gauntlet runs once the scenes exist. The number is never suppressed.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STRICT = process.argv.includes("--strict");

const read = (p) => readFileSync(join(REPO, p), "utf8");

// ---------------------------------------------------------------------------
// 1. Decisions
// ---------------------------------------------------------------------------

/**
 * Decisions that cannot produce a product acceptance criterion, each with the
 * reason. This list is deliberately explicit: an unexplained exemption is how a
 * traceability check quietly stops meaning anything (D61).
 */
const AC_EXEMPT = {
  D01: "audience definition (grades 2-5); shapes content, not a testable behaviour",
  D07: "records a rejected alternative (planet-based blaster); nothing to build",
  D08: "scope statement (one story world); constrains what is NOT built",
  D10: "process: no v2, everything decided ships",
  D14: "process: Claude drafts story, user approves",
  D16: "process: story approved as one batch document",
  D20: "superseded in practice by D53's concrete knob mapping",
  D32: "policy restated concretely by D33; AC-15.3 carries the check",
  D35: "stack choice (Phaser 3 WebGL); architecture section 1",
  D36: "stack choice (TS + Vite + Phaser); architecture section 1",
  D37: "platform scope (web, desktop, keyboard); NFR and non-goals",
  D38: "process: solo build",
  D47: "infrastructure posture; AC-15.4 and NFR-4 carry the checks",
  D48: "superseded by D54",
  D54: "hosting choice; deploy is run by the user, architecture section 9",
  D55: "test policy; enforced by the coverage gate, not by an AC",
  D58: "reference-usage statement (Type Storm is mechanics-only)",
  D59: "names the visual bar; decomposed into D60's rubric",
  D61: "the granularity rule itself; this script is its enforcement",
  D64: "requires a section in the architecture doc; not product behaviour",
  D65: "naming (KeyBlaster)",
  D66: "naming (Shadow)",
  D67: "content approval milestone; PRD section 6 carries the fact table",
  D68: "names the current design brief",
  D69: "names the PRD and architecture docs",
  D70: "precedence order; lives in CLAUDE.md",
  D76: "process: docs/audit.md produced at end of build",
  D78: "screen completeness; enforced by relation 3 below",
  D82: "roadmap / track split",
  D84: "reference-image tooling; G-raster carries the shipped-art check",
  D85: "quality bar; enforced by the whole gauntlet",
  D86: "names the art direction doc",
  D87: "overnight guardrails; asserted in scripts/gauntlet.mjs",
  D92: "model choice for the coach call; AC-15.1/15.4 carry the behaviour",
  D93: "build method (builder/critic fan-out); process, not product",
  D94: "unattended-run process rule; enforced by .claude/settings.json, not by product behaviour",
};

function parseDecisions() {
  const src = read("docs/decision-log.md");
  const out = new Map();
  for (const m of src.matchAll(/^- \*\*(D\d+)\s*·\s*([A-Z-]+)/gm)) {
    out.set(m[1], m[2]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Acceptance criteria
// ---------------------------------------------------------------------------

const T_TYPES = ["U", "E", "V", "P", "M"];

function parsePrd() {
  const src = read("docs/prd.md");
  const acs = new Map(); // id -> { line, testTypes[] }
  for (const line of src.split("\n")) {
    const m = line.match(/^\s*-\s*(AC-[\d]+[a-z]?\.[\d]+[a-z]?)\s+(.*)$/);
    if (!m) continue;
    const id = m[1];
    const body = m[2];
    const types = new Set();
    // The PRD declares tests after an arrow: "-> U: ...", "-> U + V (shake)".
    const arrow = body.split(/[→]|->/).slice(1).join(" ");
    for (const t of arrow.matchAll(/\b([UEVPM])\b/g)) {
      if (T_TYPES.includes(t[1])) types.add(t[1]);
    }
    acs.set(id, { body, testTypes: [...types] });
  }
  // Which decisions does the PRD cite anywhere?
  const citedDecisions = new Set([...src.matchAll(/\b(D\d+)\b/g)].map((m) => m[1]));
  return { acs, citedDecisions };
}

// ---------------------------------------------------------------------------
// 3. Scenes vs the screen inventory
// ---------------------------------------------------------------------------

function parseInventory() {
  const src = read("docs/design-brief-v2.md");
  const start = src.indexOf("## Screen inventory");
  if (start < 0) throw new Error("design-brief-v2.md has no '## Screen inventory' section");
  const section = src.slice(start);
  const rows = [];
  for (const line of section.split("\n")) {
    const m = line.match(/^\|\s*([\w]+)\s*\|\s*([^|]+?)\s*\|/);
    if (!m) continue;
    const state = m[2].trim();
    if (state === "State" || /^-+$/.test(state)) continue;
    rows.push(state);
  }
  return rows;
}

/** "Director map" -> "directormap", so Scene filenames can be compared. */
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function sceneNames() {
  const dir = join(REPO, "src/game/scenes");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => extname(f) === ".ts" && !f.endsWith(".test.ts"))
    .map((f) => f.replace(/Scene\.ts$/, "").replace(/\.ts$/, ""));
}

function testSources() {
  const out = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(test|spec)\.ts$/.test(e.name)) out.push(readFileSync(p, "utf8"));
    }
  };
  walk(join(REPO, "tests"));
  return out.join("\n");
}

// ---------------------------------------------------------------------------

function main() {
  const failures = [];
  const notes = [];

  const decisions = parseDecisions();
  const { acs, citedDecisions } = parsePrd();

  // Relation 1: every DECIDED decision is cited by the PRD (or exempt).
  const decided = [...decisions].filter(([, status]) => status === "DECIDED").map(([id]) => id);
  const uncited = decided.filter((d) => !citedDecisions.has(d) && !(d in AC_EXEMPT));
  if (uncited.length) {
    failures.push(`Decisions with no acceptance criterion and no exemption: ${uncited.join(", ")}`);
  }
  // An exemption for a decision that IS cited is stale bookkeeping, not an error.
  const staleExempt = Object.keys(AC_EXEMPT).filter((d) => !decisions.has(d));
  if (staleExempt.length) {
    failures.push(`AC_EXEMPT names decisions that do not exist in the log: ${staleExempt.join(", ")}`);
  }

  // Relation 2: every AC declares at least one test type.
  // AC-12b.3 closes the NASA source verification for the debris table. It is a
  // research closure, not runtime behaviour; the table it closes is enforced by
  // AC-12b.1 and AC-12b.2, which do declare test types.
  const T_TYPE_EXEMPT = new Set(["AC-12b.3"]);
  const untyped = [...acs]
    .filter(([id, v]) => v.testTypes.length === 0 && !T_TYPE_EXEMPT.has(id))
    .map(([id]) => id);
  if (untyped.length) {
    failures.push(`ACs that declare no test type (U/E/V/P/M): ${untyped.join(", ")}`);
  }

  // Relation 3: scenes <-> screen inventory.
  const inventory = parseInventory();
  const invSlugs = new Set(inventory.map(slug));
  const scenes = sceneNames();
  const orphanScenes = scenes.filter((s) => !invSlugs.has(slug(s)));
  if (orphanScenes.length) {
    failures.push(`Scenes with no screen-inventory row (D78): ${orphanScenes.join(", ")}`);
  }
  if (scenes.length === 0) {
    notes.push(`src/game/scenes is empty (FIRST TASK 4); the reverse check is vacuous until scenes exist`);
  } else {
    const sceneSlugs = new Set(scenes.map(slug));
    const unbuilt = inventory.filter((r) => !sceneSlugs.has(slug(r)));
    if (unbuilt.length) notes.push(`Inventory rows with no scene yet: ${unbuilt.length} (${unbuilt.slice(0, 6).join(", ")}${unbuilt.length > 6 ? ", ..." : ""})`);
  }

  // AC -> live test linkage. Counted always, enforced only under --strict.
  const tests = testSources();
  const unlinked = [...acs.keys()].filter((id) => !tests.includes(id));
  const linked = acs.size - unlinked.length;

  console.log(`trace-check`);
  console.log(`  decisions:  ${decisions.size} total, ${decided.length} DECIDED, ${Object.keys(AC_EXEMPT).length} exempt from AC mapping`);
  console.log(`  ACs:        ${acs.size} parsed, ${acs.size - untyped.length} declare a test type`);
  console.log(`  scenes:     ${scenes.length} in src/game/scenes, ${inventory.length} inventory rows`);
  console.log(`  AC->test:   ${linked}/${acs.size} cited by a real test (${unlinked.length} not yet)`);
  for (const n of notes) console.log(`  note: ${n}`);

  if (STRICT && unlinked.length) {
    failures.push(`--strict: ACs with no test citing them: ${unlinked.length} (${unlinked.slice(0, 10).join(", ")}${unlinked.length > 10 ? ", ..." : ""})`);
  }

  if (failures.length) {
    console.error(`\ntrace-check FAILED`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\ntrace-check OK${STRICT ? " (strict)" : ""}`);
}

main();
