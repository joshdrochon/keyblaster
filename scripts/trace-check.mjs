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
 * what the gauntlet runs. The number is never suppressed.
 *
 * WHAT "CITED BY A TEST" MEANS, AND WHAT IT USED TO MEAN.
 *
 * This script used to link an AC to a test with `allTestSources.includes(id)` -
 * a substring scan over every test file concatenated. An AC named in a comment,
 * in a variable name, or in a `describe` title over a block whose assertions
 * were since deleted, counted as covered. That is how 97 of 106 ACs came to
 * look cited while the audit could only find tests for far fewer, and it is a
 * measurement of PROSE, not of assertions.
 *
 * The linkage is now graded by `citationStrength` from scripts/tickets.mjs -
 * the same grader the ticket board runs, deliberately reused rather than
 * reimplemented so the two can never disagree about what "tested" means:
 *
 *   STRONG  the id is inside a describe()/it()/test() TITLE, so a named test
 *           fails under that id. This is the only level that counts as cited.
 *   WEAK    the id appears only in prose. Exactly what a stale comment looks
 *           like once the assertion it described has been deleted.
 *   NONE    no test file mentions it.
 *
 * WEAK is reported separately rather than folded into either bucket, because
 * "someone wrote the id down" and "nothing tests this" are different problems
 * with different fixes.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { citationStrength } from "./tickets.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STRICT = process.argv.includes("--strict");

/**
 * Every reader below takes the repo root as an argument, defaulting to this
 * one. Not decoration: tests/unit/trace/*.test.ts points these functions at a
 * scratch tree with a deliberately broken scene map, which is the only way to
 * show that a relation can go red. A check nobody has ever seen fail is a
 * check nobody has evidence about.
 */
const read = (p, repo = REPO) => readFileSync(join(repo, p), "utf8");

// ---------------------------------------------------------------------------
// 1. Decisions
// ---------------------------------------------------------------------------

/**
 * Decisions that cannot produce a product acceptance criterion, each with the
 * reason. This list is deliberately explicit: an unexplained exemption is how a
 * traceability check quietly stops meaning anything (D61).
 */
export const AC_EXEMPT = {
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

export function parseDecisions(repo = REPO) {
  const src = read("docs/decision-log.md", repo);
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

export function parsePrd(repo = REPO) {
  const src = read("docs/prd.md", repo);
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

export function parseInventory(repo = REPO) {
  const src = read("docs/design-brief-v2.md", repo);
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

/**
 * Read the declared scene -> inventory-row map out of src/game/sceneKeys.ts.
 * Parsed rather than imported because this script is .mjs and the map is .ts;
 * the shape is a literal object, so a narrow regex is honest here.
 */
export function sceneRowMap(repo = REPO) {
  const p = join(repo, "src/game/sceneKeys.ts");
  if (!existsSync(p)) return { rows: new Map(), nonScene: new Set() };
  const src = read("src/game/sceneKeys.ts", repo);
  const rows = new Map();
  const block = src.slice(src.indexOf("SCENE_INVENTORY_ROW"), src.indexOf("NON_SCENE_ROWS"));
  for (const m of block.matchAll(/^\s*"?([A-Za-z]+)"?:\s*"([^"]*)"/gm)) {
    rows.set(m[1], m[2]);
  }
  const nonScene = new Set();
  const nsBlock = src.slice(src.indexOf("NON_SCENE_ROWS"));
  for (const m of nsBlock.matchAll(/^\s*"?([A-Za-z][A-Za-z\s-]*?)"?:\s*"/gm)) {
    nonScene.add(m[1].trim());
  }
  return { rows, nonScene };
}

export function sceneNames(repo = REPO) {
  const dir = join(repo, "src/game/scenes");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => extname(f) === ".ts" && !f.endsWith(".test.ts"))
    .map((f) => f.replace(/Scene\.ts$/, "").replace(/\.ts$/, ""));
}

export function testSources(repo = REPO) {
  const out = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(test|spec)\.ts$/.test(e.name)) out.push(readFileSync(p, "utf8"));
    }
  };
  walk(join(repo, "tests"));
  return out.join("\n");
}

// ---------------------------------------------------------------------------

/**
 * ACs that cannot have a live test, each with the reason. Same doctrine as
 * AC_EXEMPT above and the same risk: an unexplained exemption is how a
 * traceability check quietly stops meaning anything. Kept to the ONE entry the
 * repo already exempts from relation 2 on identical grounds, and every entry is
 * printed on every run so it stays a claim someone has to defend.
 *
 * Deliberately NOT here: AC-6e.5 (the playtest targets that were never set),
 * AC-1.1, AC-1.2, AC-13.3, AC-17.3, AC-23.1, AC-24.1, AC-24.3. Those are real
 * gaps. Exempting them would be the fix-by-redefinition this file exists to
 * prevent; they are escalated in gauntlet/escalations.md instead.
 */
export const TEST_EXEMPT = {
  "AC-12b.3": "NASA debris-source verification: a research closure, not runtime behaviour. Already exempt from relation 2 for the same reason; AC-12b.1/AC-12b.2 carry the table's runtime checks.",
};

/**
 * Run every relation and return what was found. Pure: it reads the tree and
 * returns a result, printing nothing and exiting nothing, so a test can point
 * it at a scratch tree and assert that a relation goes RED.
 */
export function runTraceCheck({ repo = REPO, strict = false, citations = citationStrength } = {}) {
  const failures = [];
  const notes = [];

  const decisions = parseDecisions(repo);
  const { acs, citedDecisions } = parsePrd(repo);

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
  const untyped = [...acs]
    .filter(([id, v]) => v.testTypes.length === 0 && !(id in TEST_EXEMPT))
    .map(([id]) => id);
  if (untyped.length) {
    failures.push(`ACs that declare no test type (U/E/V/P/M): ${untyped.join(", ")}`);
  }

  // Relation 3: scenes <-> screen inventory (D78), via the declared map.
  const inventory = parseInventory(repo);
  const { rows: declared, nonScene } = sceneRowMap(repo);
  const scenes = sceneNames(repo);

  const undeclared = scenes.filter((s) => !declared.has(s));
  if (undeclared.length) {
    failures.push(`Scenes missing a SCENE_INVENTORY_ROW entry (D78): ${undeclared.join(", ")}`);
  }
  // A declared row must actually exist in the brief, or the map is fiction.
  const invSet = new Set(inventory);
  const bogus = [...declared].filter(([, v]) => v !== "" && !invSet.has(v)).map(([k, v]) => `${k} -> "${v}"`);
  if (bogus.length) {
    failures.push(`SCENE_INVENTORY_ROW points at rows not in the design brief: ${bogus.join(", ")}`);
  }
  // Every brief row needs a scene, or an explained non-scene exemption.
  const covered = new Set([...declared.values()].filter(Boolean));
  const uncovered = inventory.filter((r) => !covered.has(r) && !nonScene.has(r));
  if (scenes.length === 0) {
    notes.push(`src/game/scenes is empty (FIRST TASK 4); the reverse check is vacuous until scenes exist`);
  } else if (uncovered.length) {
    notes.push(`Inventory rows with no scene yet: ${uncovered.length} (${uncovered.join(", ")})`);
  }

  // AC -> live test linkage, GRADED (see the header). Counted always, enforced
  // under --strict. `citations` is injected so a test can feed the grader a
  // known-comment-only citation and watch this relation go red.
  const strong = [];
  const weak = [];
  const none = [];
  for (const id of acs.keys()) {
    if (id in TEST_EXEMPT) continue;
    const level = citations(id).level;
    if (level === "STRONG") strong.push(id);
    else if (level === "WEAK") weak.push(id);
    else none.push(id);
  }
  const unlinked = [...weak, ...none].sort();

  if (strict && unlinked.length) {
    failures.push(
      `--strict: ACs with no test ASSERTING them: ${unlinked.length}` +
        ` (${none.length} named by no test at all: ${none.join(", ")}` +
        `; ${weak.length} named only in prose, never in a test title: ${weak.join(", ")})`,
    );
  }

  return {
    failures,
    notes,
    strict,
    counts: {
      decisions: decisions.size,
      decided: decided.length,
      acExempt: Object.keys(AC_EXEMPT).length,
      acs: acs.size,
      typed: acs.size - untyped.length,
      scenes: scenes.length,
      inventoryRows: inventory.length,
      coveredRows: covered.size,
      nonSceneRows: nonScene.size,
      testExempt: Object.keys(TEST_EXEMPT).length,
      strong: strong.length,
      weak: weak.length,
      none: none.length,
    },
    strong,
    weak,
    none,
  };
}

function main() {
  const r = runTraceCheck({ strict: STRICT });
  const c = r.counts;

  console.log(`trace-check`);
  console.log(`  decisions:  ${c.decisions} total, ${c.decided} DECIDED, ${c.acExempt} exempt from AC mapping`);
  console.log(`  ACs:        ${c.acs} parsed, ${c.typed} declare a test type`);
  console.log(`  scenes:     ${c.scenes} in src/game/scenes, ${c.inventoryRows} inventory rows, ${c.coveredRows} rows covered, ${c.nonSceneRows} non-scene rows`);
  console.log(`  AC->test:   ${c.strong}/${c.acs - c.testExempt} asserted by a named test (${c.weak} named only in prose, ${c.none} not named at all; ${c.testExempt} exempt)`);
  for (const [id, why] of Object.entries(TEST_EXEMPT)) console.log(`  exempt:     ${id} — ${why}`);
  for (const n of r.notes) console.log(`  note: ${n}`);

  if (r.failures.length) {
    console.error(`\ntrace-check FAILED`);
    for (const f of r.failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\ntrace-check OK${STRICT ? " (strict)" : ""}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
