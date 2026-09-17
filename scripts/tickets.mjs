#!/usr/bin/env node
/**
 * TICKETS — one ticket per atomic commitment in the docs, status COMPUTED.
 *
 *   node scripts/tickets.mjs             write gauntlet/tickets.json + docs/tickets.md
 *   node scripts/tickets.mjs --check     exit 1 if any ticket is FALSE-PASS or stale
 *   node scripts/tickets.mjs --json      print the board to stdout
 *
 * WHY THIS EXISTS, AND WHY NOTHING HERE ACCEPTS A TYPED STATUS.
 *
 * In one night this repo produced three artifacts that claimed done and were
 * wrong: gauntlet/summary.md reported `0 fail` while report.md reported 5;
 * rubric item V-22.8 reported 6.71:1 contrast on a palette field that no
 * renderer reads (the real figure is 1.02:1); and every trophy test passed
 * against a feature with zero implementation, because each test seeded the
 * trophy into the profile first. All three were green. All three were false.
 *
 * A ticket board with a hand-set `status:` field would be the same failure a
 * fourth time, across ~300 rows instead of one. So no status in this file is
 * ever written by a human or an agent. Every status is derived, on each run,
 * by joining the requirement to an evidence artifact and then asking two
 * questions the earlier checks did not ask:
 *
 *   1. Does the evidence exist?                     (existsSync — the weak one)
 *   2. Is it NEWER than the code it describes?      (staleness — what caught
 *                                                    the 12KB scaffold dist/)
 *   3. Does the citation bind to an ASSERTION, or   (strength — what would have
 *      only to a comment?                            caught the trophy tests)
 *
 * Question 1 alone is what `evidence.has()` does in rubric.mjs, and it is why
 * fourteen rubric items pass on a JSON file of any age and any provenance.
 *
 * DIRECTION OF FAILURE. Where this script is unsure, it resolves toward
 * UNVERIFIED, never toward DONE. A ticket board that is too pessimistic costs
 * someone an afternoon of re-checking. A ticket board that is too optimistic
 * is the thing we already shipped three times tonight.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  AC_EXEMPT,
  parseDecisions,
  parseInventory,
  parsePrd,
  sceneNames,
  sceneRowMap,
} from "./trace-check.mjs";
import { RUBRIC } from "../tests/gauntlet/rubric.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(REPO, p), "utf8");
const readIf = (p) => (existsSync(join(REPO, p)) ? read(p) : null);

const FLAGS = {
  check: process.argv.includes("--check"),
  json: process.argv.includes("--json"),
};

/**
 * The six states. One enum, because two enums is how a board grows a row that
 * is DONE in one column and OPEN in another.
 */
export const STATE = Object.freeze({
  DONE: "DONE",
  OPEN: "OPEN",
  UNVERIFIED: "UNVERIFIED",
  FALSE_PASS: "FALSE-PASS",
  BLOCKED: "BLOCKED",
  EXEMPT: "EXEMPT",
});

/** Rank for sorting a board so the bad news is at the top. */
const SEVERITY = {
  [STATE.FALSE_PASS]: 0,
  [STATE.BLOCKED]: 1,
  [STATE.OPEN]: 2,
  [STATE.UNVERIFIED]: 3,
  [STATE.EXEMPT]: 4,
  [STATE.DONE]: 5,
};

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

/**
 * The newest mtime under src/. Any evidence artifact older than this describes
 * code that has since changed, so it cannot certify the current tree. This is
 * the check that caught G-secrets scanning a dist/ built before the game
 * existed; it is applied to every artifact here rather than to one.
 */
function newestSourceMtime() {
  let newest = 0;
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|json)$/.test(e.name)) {
        const m = statSync(p).mtimeMs;
        if (m > newest) newest = m;
      }
    }
  };
  walk(join(REPO, "src"));
  return newest;
}

const NEWEST_SRC = newestSourceMtime();

/** @returns {{exists:boolean, stale:boolean, ageMs:number|null, path:string}} */
function artifact(relPath) {
  const abs = join(REPO, relPath);
  if (!existsSync(abs)) return { exists: false, stale: false, ageMs: null, path: relPath };
  const m = statSync(abs).mtimeMs;
  return { exists: true, stale: m < NEWEST_SRC, ageMs: NEWEST_SRC - m, path: relPath };
}

// ---------------------------------------------------------------------------
// Citation strength
// ---------------------------------------------------------------------------

/**
 * Read every test file ONCE, keeping the path so a ticket can cite it. The
 * existing trace-check concatenates all sources and asks `tests.includes(id)`,
 * which counts an AC named in a comment as covered. That is how 96/105 ACs
 * came to look cited. Here the same scan is graded.
 */
function testFiles() {
  const out = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(test|spec)\.ts$/.test(e.name)) {
        out.push({ path: p.slice(REPO.length + 1), src: readFileSync(p, "utf8") });
      }
    }
  };
  walk(join(REPO, "tests"));
  return out;
}

const TEST_FILES = testFiles();

/**
 * STRONG: the id appears inside a describe()/it()/test() title — a named,
 *         running assertion that fails under that name.
 * WEAK:   the id appears only in prose: a comment, a doc block, a variable.
 * NONE:   no test mentions it at all.
 *
 * The distinction matters because WEAK is exactly what a stale comment looks
 * like after the assertion it described was deleted.
 */
export function citationStrength(id, files = TEST_FILES) {
  // `it.each([...])("AC-x.y ...")` puts the cases between the call and the
  // title, so the optional group below steps over one bracketed argument list.
  // Known limit: the template-literal table form, it.each`...`, is not matched
  // and grades WEAK. That errs toward pessimism, which is the safe direction.
  const titleRe = new RegExp(
    `\\b(?:describe|it|test)(?:\\.\\w+)*\\s*\\(\\s*(?:\\[[^\\]]*\\]\\s*\\)\\s*\\(\\s*)?(["'\`])(?:(?!\\1).)*?${escapeRe(id)}`,
    "s",
  );
  const hits = { strong: [], weak: [] };
  for (const f of files) {
    if (!f.src.includes(id)) continue;
    if (titleRe.test(f.src)) hits.strong.push(f.path);
    else hits.weak.push(f.path);
  }
  if (hits.strong.length) return { level: "STRONG", files: hits.strong };
  if (hits.weak.length) return { level: "WEAK", files: hits.weak };
  return { level: "NONE", files: [] };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------------------------------------------------------------------
// Known false passes
// ---------------------------------------------------------------------------

/**
 * Findings from docs/audit.md and docs/coverage-audit.md: checks that are GREEN
 * and do not measure what they claim. This list is the one hand-maintained
 * input, and it is deliberately the PESSIMISTIC one — an entry that goes stale
 * keeps a ticket marked FALSE-PASS until someone proves the check honest, which
 * fails safe. Every entry must cite a line in an audit doc; a citation that no
 * longer resolves is a hard error rather than a silent drop, so this list
 * cannot rot quietly the way summary.md did.
 */
function knownFalsePasses(knownIds) {
  const p = "gauntlet/known-false-passes.json";
  const raw = readIf(p);
  if (!raw) return new Map();
  const entries = JSON.parse(raw);
  const map = new Map();
  const problems = [];
  for (const e of entries) {
    const doc = readIf(e.cite.file);
    if (doc === null) {
      problems.push(`${e.id}: cites ${e.cite.file}, which does not exist`);
      continue;
    }
    if (!doc.includes(e.cite.quote)) {
      problems.push(`${e.id}: the quote it cites is no longer in ${e.cite.file}`);
      continue;
    }
    // An id matching no rubric item and no AC would otherwise be dropped in
    // silence, and a pessimism list that silently forgets an entry is an
    // optimism list. Found the hard way: "L-6e.2" was in this file and matched
    // nothing, so the finding it recorded simply stopped being tracked.
    if (knownIds && !knownIds.has(e.id)) {
      problems.push(`${e.id}: matches no rubric item and no AC in the PRD`);
      continue;
    }
    map.set(e.id, e);
  }
  if (problems.length) {
    console.error("known-false-passes.json has unresolvable entries:");
    for (const x of problems) console.error(`  - ${x}`);
    process.exitCode = 1;
  }
  return map;
}

// ---------------------------------------------------------------------------
// The gauntlet report, per item
// ---------------------------------------------------------------------------

/** Parse `| PASS | G-secrets | ... |` rows out of gauntlet/report.md. */
function rubricResults() {
  const raw = readIf("gauntlet/report.md");
  const meta = artifact("gauntlet/report.md");
  const byId = new Map();
  if (!raw) return { byId, meta };
  for (const line of raw.split("\n")) {
    const m = line.match(/^\|\s*(PASS|FAIL|TODO|ESCALATED|NOT IMPLEMENTED)\s*\|\s*([\w.\-]+)\s*\|([^|]*)\|([^|]*)\|/i);
    if (!m) continue;
    byId.set(m[2].trim(), {
      status: m[1].trim().toUpperCase(),
      title: m[3].trim(),
      measurement: m[4].trim(),
    });
  }
  return { byId, meta };
}

// ---------------------------------------------------------------------------
// Source parsers for the doc shapes trace-check does not cover
// ---------------------------------------------------------------------------

/** `**FR-1 Scroll and ship.** The Lantern is fixed...` */
function parseFrs() {
  const src = read("docs/prd.md");
  const out = [];
  src.split("\n").forEach((line, i) => {
    const m = line.match(/^\*\*(FR-[\d]+[a-z]*)\s+([^*]+?)\.?\*\*\s*(.*)$/);
    if (m) out.push({ id: m[1], title: m[2].trim(), body: m[3].trim(), line: i + 1 });
  });
  return out;
}

/** `- **C13 · Planet names...** ... **Status: unresolved.**` */
function parseCollisions() {
  const src = read("docs/decision-log.md");
  const out = [];
  src.split("\n").forEach((line, i) => {
    const m = line.match(/^-\s*\*\*(C\d+)\s*·\s*([^*]+?)\*\*\s*(.*)$/);
    if (!m) return;
    const resolved = !/status:\s*unresolved/i.test(line);
    out.push({ id: m[1], title: m[2].trim().replace(/\.$/, ""), resolved, line: i + 1 });
  });
  return out;
}

/** `## AC-10.2 — controller cannot reach the 85% band` */
function parseEscalations() {
  const raw = readIf("gauntlet/escalations.md");
  if (!raw) return [];
  const out = [];
  raw.split("\n").forEach((line, i) => {
    const m = line.match(/^##\s+(?!#)(.+)$/);
    if (!m) return;
    const heading = m[1].trim();
    const ids = [...heading.matchAll(/\b((?:AC|FR|D|C|V|A|P|L|G|R)-?[\w.]*\d[\w.]*)\b/g)].map((x) => x[1]);
    out.push({ heading, refs: ids, line: i + 1 });
  });
  return out;
}

/** Decision text, for a ticket title. */
function decisionText() {
  const src = read("docs/decision-log.md");
  const out = new Map();
  src.split("\n").forEach((line, i) => {
    const m = line.match(/^-\s*\*\*(D\d+)\s*·\s*([A-Z-]+)\s*·\s*([^*]*)\*\*\s*(.*)$/);
    if (m) out.set(m[1], { status: m[2], round: m[3].trim(), body: m[4].trim(), line: i + 1 });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const firstSentence = (s, n = 110) => {
  const t = (s || "").split(/(?<=\.)\s/)[0].replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export function buildTickets() {
  const tickets = [];
  const { byId: rubricById, meta: reportMeta } = rubricResults();

  const { acs, citedDecisions } = parsePrd();
  const knownIds = new Set([...RUBRIC.map((r) => r.id), ...acs.keys()]);
  const falsePasses = knownFalsePasses(knownIds);
  const decisions = decisionText();
  const decisionStatus = parseDecisions();

  // --- Rubric items -------------------------------------------------------
  // These come first because the AC tickets below bind to them.
  const rubricByAc = new Map();
  for (const item of RUBRIC) {
    const result = rubricById.get(item.id);
    const fp = falsePasses.get(item.id);
    let state, why;
    if (fp) {
      state = STATE.FALSE_PASS;
      why = fp.why;
    } else if (!result) {
      state = STATE.OPEN;
      why = "no row for this item in gauntlet/report.md";
    } else if (result.status === "FAIL") {
      state = STATE.OPEN;
      why = result.measurement || "reported FAIL";
    } else if (result.status === "ESCALATED") {
      state = STATE.BLOCKED;
      why = "escalated — awaiting a decision in gauntlet/escalations.md";
    } else if (result.status === "PASS" && reportMeta.stale) {
      state = STATE.UNVERIFIED;
      why = `reported PASS, but report.md predates the newest file in src/ by ${fmtAge(reportMeta.ageMs)}`;
    } else if (result.status === "PASS") {
      state = STATE.DONE;
      why = result.measurement;
    } else {
      state = STATE.OPEN;
      why = result.status;
    }

    tickets.push({
      id: `KB-${item.id}`,
      kind: "rubric",
      title: item.title,
      source: `tests/gauntlet/rubric.mjs (${item.source ?? item.id})`,
      state,
      why,
      evidence: reportMeta.exists ? [`gauntlet/report.md${reportMeta.stale ? " (STALE)" : ""}`] : [],
      refs: refsIn(item.source ?? ""),
    });

    for (const ac of refsIn(item.source ?? "").filter((r) => r.startsWith("AC-"))) {
      if (!rubricByAc.has(ac)) rubricByAc.set(ac, []);
      rubricByAc.get(ac).push({ id: item.id, state });
    }
  }

  // --- Acceptance criteria ------------------------------------------------
  for (const [id, v] of acs) {
    const cite = citationStrength(id);
    const fp = falsePasses.get(id);
    const bound = rubricByAc.get(id) ?? [];
    let state, why;

    if (fp) {
      state = STATE.FALSE_PASS;
      why = fp.why;
    } else if (cite.level === "NONE") {
      state = STATE.OPEN;
      why = "no test names this AC";
    } else if (cite.level === "WEAK") {
      state = STATE.UNVERIFIED;
      why = `mentioned in ${cite.files.length} test file(s) but never in a test title — the citation may be a comment outliving its assertion`;
    } else if (bound.some((b) => b.state === STATE.FALSE_PASS)) {
      state = STATE.FALSE_PASS;
      why = `the rubric item covering it (${bound.find((b) => b.state === STATE.FALSE_PASS).id}) does not measure its claim`;
    } else if (bound.some((b) => b.state === STATE.OPEN)) {
      state = STATE.OPEN;
      why = `rubric item ${bound.find((b) => b.state === STATE.OPEN).id} is failing`;
    } else {
      state = STATE.DONE;
      why = `named by an assertion in ${cite.files.length} test file(s)`;
    }

    tickets.push({
      id: `KB-${id}`,
      kind: "ac",
      title: firstSentence(v.body.split(/[→]|->/)[0]),
      source: "docs/prd.md",
      state,
      why,
      testTypes: v.testTypes,
      evidence: cite.files,
      refs: bound.map((b) => b.id),
    });
  }

  // --- Functional requirements -------------------------------------------
  // An FR is done when every AC beneath it is done. It owns no evidence of its
  // own, so it never invents any.
  const acByFr = new Map();
  for (const [id] of acs) {
    const fr = `FR-${id.replace(/^AC-/, "").split(".")[0]}`;
    if (!acByFr.has(fr)) acByFr.set(fr, []);
    acByFr.get(fr).push(`KB-${id}`);
  }
  const stateOf = new Map(tickets.map((t) => [t.id, t.state]));
  for (const fr of parseFrs()) {
    const children = acByFr.get(fr.id) ?? [];
    const childStates = children.map((c) => stateOf.get(c)).filter(Boolean);
    const worst = childStates.length
      ? childStates.reduce((a, b) => (SEVERITY[a] <= SEVERITY[b] ? a : b))
      : STATE.OPEN;
    tickets.push({
      id: `KB-${fr.id}`,
      kind: "fr",
      title: fr.title,
      source: `docs/prd.md:${fr.line}`,
      state: worst,
      why: childStates.length
        ? `rolled up from ${children.length} AC(s); worst is ${worst}`
        : "no AC beneath this FR",
      evidence: [],
      refs: children,
    });
  }

  // --- Decisions ----------------------------------------------------------
  for (const [id, d] of decisions) {
    if (d.status !== "DECIDED") continue;
    let state, why;
    if (id in AC_EXEMPT) {
      state = STATE.EXEMPT;
      why = AC_EXEMPT[id];
    } else if (citedDecisions.has(id)) {
      state = STATE.DONE;
      why = "cited by at least one acceptance criterion in the PRD";
    } else {
      state = STATE.OPEN;
      why = "DECIDED but no acceptance criterion cites it, and no exemption explains why";
    }
    tickets.push({
      id: `KB-${id}`,
      kind: "decision",
      title: firstSentence(d.body),
      source: `docs/decision-log.md:${d.line}`,
      state,
      why,
      evidence: [],
      refs: [],
    });
  }

  // --- Collisions ---------------------------------------------------------
  for (const c of parseCollisions()) {
    tickets.push({
      id: `KB-${c.id}`,
      kind: "collision",
      title: c.title,
      source: `docs/decision-log.md:${c.line}`,
      state: c.resolved ? STATE.DONE : STATE.BLOCKED,
      why: c.resolved ? "resolved in the log" : "unresolved — two decisions conflict and the user picks",
      evidence: [],
      refs: [],
    });
  }

  // --- Screen inventory ---------------------------------------------------
  const inventory = parseInventory();
  const { rows: declared, nonScene } = sceneRowMap();
  const covered = new Set([...declared.values()].filter(Boolean));
  const scenes = new Set(sceneNames());
  for (const row of inventory) {
    const sceneFor = [...declared].find(([, v]) => v === row)?.[0];
    let state, why;
    if (nonScene.has(row)) {
      state = STATE.EXEMPT;
      why = "declared a non-scene row in sceneKeys.ts";
    } else if (sceneFor && scenes.has(sceneFor)) {
      state = STATE.DONE;
      why = `src/game/scenes/${sceneFor}Scene.ts exists and is mapped to this row`;
    } else if (covered.has(row)) {
      state = STATE.UNVERIFIED;
      why = "mapped in sceneKeys.ts, but no matching file in src/game/scenes";
    } else {
      state = STATE.OPEN;
      why = "no scene covers this inventory row";
    }
    tickets.push({
      id: `KB-SCREEN-${slug(row)}`,
      kind: "screen",
      title: row,
      source: "docs/design-brief-v2.md (screen inventory)",
      state,
      why,
      evidence: [],
      refs: sceneFor ? [sceneFor] : [],
    });
  }

  // --- Escalations --------------------------------------------------------
  // Always BLOCKED: an escalation is by construction a decision only the user
  // can take (D94). None of these can be computed to DONE from this side.
  parseEscalations().forEach((e, i) => {
    tickets.push({
      id: `KB-ESC-${String(i + 1).padStart(2, "0")}`,
      kind: "escalation",
      title: firstSentence(e.heading, 120),
      source: `gauntlet/escalations.md:${e.line}`,
      state: STATE.BLOCKED,
      why: "awaiting a user decision",
      evidence: [],
      refs: e.refs,
    });
  });

  tickets.sort(
    (a, b) => SEVERITY[a.state] - SEVERITY[b.state] || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id),
  );
  return tickets;
}

const refsIn = (s) => [...String(s).matchAll(/\b((?:AC|FR|D|C)-?\d[\w.]*)\b/g)].map((m) => m[1]);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const fmtAge = (ms) => (ms == null ? "?" : ms > 3600e3 ? `${(ms / 3600e3).toFixed(1)}h` : `${(ms / 60e3).toFixed(0)}m`);

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export function tally(tickets) {
  const t = {};
  for (const s of Object.values(STATE)) t[s] = 0;
  for (const x of tickets) t[x.state]++;
  return t;
}

function renderBoard(tickets) {
  const t = tally(tickets);
  const kinds = [...new Set(tickets.map((x) => x.kind))].sort();
  const L = [];
  L.push(`# Ticket board — KeyBlaster`);
  L.push(``);
  L.push(`<!-- GENERATED by scripts/tickets.mjs. Do not edit: every status here is`);
  L.push(`     computed from evidence on each run, and a hand-typed status is the`);
  L.push(`     exact failure this board exists to prevent. -->`);
  L.push(``);
  L.push(`Generated: ${new Date().toISOString()}`);
  L.push(`Tickets: **${tickets.length}**`);
  L.push(``);
  L.push(`| ${Object.values(STATE).join(" | ")} |`);
  L.push(`|${Object.values(STATE).map(() => "---").join("|")}|`);
  L.push(`| ${Object.values(STATE).map((s) => t[s]).join(" | ")} |`);
  L.push(``);
  L.push(`**DONE** means an assertion names it and the evidence is fresher than the`);
  L.push(`code. **UNVERIFIED** means something claims it but the binding is weak or`);
  L.push(`the evidence is stale. **FALSE-PASS** means a check is green and does not`);
  L.push(`measure its claim — read those first.`);
  L.push(``);

  for (const kind of kinds) {
    const rows = tickets.filter((x) => x.kind === kind);
    const kt = tally(rows);
    const head = Object.values(STATE).filter((s) => kt[s]).map((s) => `${kt[s]} ${s}`).join(" · ");
    L.push(`## ${kind} (${rows.length}) — ${head}`);
    L.push(``);
    L.push(`| state | id | title | why | source |`);
    L.push(`|---|---|---|---|---|`);
    for (const r of rows) {
      L.push(
        `| ${r.state} | \`${r.id}\` | ${esc(r.title)} | ${esc(firstSentence(r.why, 140))} | ${esc(r.source)} |`,
      );
    }
    L.push(``);
  }
  return L.join("\n");
}

const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

// ---------------------------------------------------------------------------

function main() {
  const tickets = buildTickets();
  const t = tally(tickets);

  writeFileSync(join(REPO, "gauntlet/tickets.json"), `${JSON.stringify(tickets, null, 2)}\n`);
  writeFileSync(join(REPO, "docs/tickets.md"), `${renderBoard(tickets)}\n`);

  if (FLAGS.json) {
    console.log(JSON.stringify({ tally: t, tickets }, null, 2));
  } else {
    console.log(`tickets: ${tickets.length} total`);
    for (const s of Object.values(STATE)) console.log(`  ${s.padEnd(11)} ${t[s]}`);
    console.log(`\nWrote gauntlet/tickets.json and docs/tickets.md`);
  }

  if (FLAGS.check && (t[STATE.FALSE_PASS] > 0 || t[STATE.UNVERIFIED] > 0)) {
    console.error(
      `\n--check: ${t[STATE.FALSE_PASS]} false pass(es) and ${t[STATE.UNVERIFIED]} unverified ticket(s)`,
    );
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
