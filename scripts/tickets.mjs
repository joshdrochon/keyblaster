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
import { srcHash } from "./lib/srcHash.mjs";

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
const CURRENT_SRC_HASH = srcHash();

/**
 * @returns {{exists:boolean, stale:boolean, ageMs:number|null, path:string, reason:string}}
 *
 * CONTENT first, mtime only as a fallback. An artifact that records the
 * `src-hash` of the tree it measured is stale when that hash no longer matches
 * — a fact `touch` cannot forge and `git checkout` cannot disturb. mtime is
 * kept for artifacts that carry no hash yet, and it is the WEAKER answer: the
 * critic showed `touch gauntlet/report.md` converting 21 UNVERIFIED tickets to
 * DONE, and `git checkout` rewriting every mtime under src/ so the verdict
 * depended on checkout order.
 */
function artifact(relPath) {
  const abs = join(REPO, relPath);
  if (!existsSync(abs)) {
    return { exists: false, stale: false, ageMs: null, path: relPath, reason: "missing" };
  }
  const m = statSync(abs).mtimeMs;
  const raw = readIf(relPath);
  const stamped = raw === null ? null : /<!--\s*src-hash:\s*([0-9a-f]{16})/.exec(raw)?.[1] ?? null;
  if (stamped !== null) {
    const now = CURRENT_SRC_HASH;
    return {
      exists: true,
      stale: stamped !== now,
      ageMs: NEWEST_SRC - m,
      path: relPath,
      reason: stamped === now ? "src-hash matches" : `src-hash ${stamped} != ${now}`,
    };
  }
  return {
    exists: true,
    stale: m < NEWEST_SRC,
    ageMs: NEWEST_SRC - m,
    path: relPath,
    reason: "no src-hash stamp; fell back to mtime, which touch can forge",
  };
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
  // title, so the optional group steps over one bracketed argument list.
  //
  // WHAT IS DELIBERATELY EXCLUDED, and why each one was a live false pass:
  //   .fails - a test whose GREEN COMES FROM THE ASSERTION FAILING. AC-10.2's
  //     only citation was one of these, and both audits record that the AC does
  //     not hold. Crediting it is the purest form of the false pass.
  //   .skip/.todo/.fixme - a citation with no assertion behind it. CLAUDE.md
  //     forbids skipped tests on main, and an earlier revision of this file's
  //     OWN TESTS advertised "test.skip variants are seen" as a feature.
  //   an id that is a strict PREFIX of a longer id - AC-6d.1 was DONE on the
  //     strength of tests titled AC-6d.1c, i.e. certified by the very tests a
  //     pessimism entry had flagged as measuring nothing.
  //   a commented-out `it(` - the exact thing WEAK exists to represent.
  // Known limit: the template-literal table form, it.each`...`, grades WEAK.
  // That errs toward pessimism, which is the safe direction.
  const BOUND = "(?![\\w.])"; // no longer id may extend this one
  const titleRe = new RegExp(
    `\\b(?:describe|it|test)(?:\\.(?!skip|todo|fixme|fails|concurrent\\.skip)\\w+)*\\s*\\(\\s*(?:\\[[^\\]]*\\]\\s*\\)\\s*\\(\\s*)?(["'\`])(?:(?!\\1).)*?${escapeRe(id)}${BOUND}`,
    "s",
  );
  const mentionRe = new RegExp(`${escapeRe(id)}${BOUND}`);
  const hits = { strong: [], weak: [] };
  for (const f of files) {
    if (!mentionRe.test(f.src)) continue;
    // Drop commented-out lines before looking for a title. A `// it("AC-x ...`
    // is a citation whose assertion was deleted, which is WEAK by definition.
    const live = f.src
      .split("\n")
      .filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l))
      .join("\n");
    if (titleRe.test(live) && hasRunningAssertion(live, id)) hits.strong.push(f.path);
    else hits.weak.push(f.path);
  }
  if (hits.strong.length) return { level: "STRONG", files: hits.strong };
  if (hits.weak.length) return { level: "WEAK", files: hits.weak };
  return { level: "NONE", files: [] };
}

/**
 * Does the title match lead to a test that actually RUNS?
 *
 * A `describe("AC-x.y ...")` is a legitimate title match, but if the only test
 * inside it is `it.fails(...)` then the block's green comes from an assertion
 * FAILING. That is how AC-10.2 sat DONE: its sole citation is a describe whose
 * one test is `it.fails`, with both audits recording that the AC does not hold.
 *
 * Braces are matched from the describe's own `(` so the scan stays inside that
 * block rather than borrowing a sibling's assertion. If the id is on a running
 * `it`/`test` title directly, the question does not arise.
 */
function hasRunningAssertion(src, id) {
  const direct = new RegExp(
    `\\b(?:it|test)(?:\\.(?!skip|todo|fixme|fails)\\w+)*\\s*\\(\\s*(?:\\[[^\\]]*\\]\\s*\\)\\s*\\(\\s*)?(["'\`])(?:(?!\\1).)*?${escapeRe(id)}(?![\\w.])`,
    "s",
  );
  if (direct.test(src)) return true;

  const openers = [...src.matchAll(new RegExp(`\\bdescribe(?:\\.\\w+)*\\s*\\(`, "g"))];
  for (const m of openers) {
    const head = src.slice(m.index, m.index + 400);
    if (!new RegExp(`${escapeRe(id)}(?![\\w.])`).test(head)) continue;
    // Walk braces from this describe's call to find its block.
    let depth = 0;
    let i = m.index + m[0].length - 1;
    let start = -1;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "(" || c === "{") {
        depth++;
        if (c === "{" && start < 0) start = i;
      } else if (c === ")" || c === "}") {
        depth--;
        if (depth <= 0) break;
      }
    }
    const body = src.slice(start < 0 ? m.index : start, i);
    if (/\b(?:it|test)(?:\.(?!skip|todo|fixme|fails)\w+)*\s*\(/.test(body)) return true;
  }
  return false;
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
    const m = line.match(
      /^\|\s*(PASS|FAIL|TODO|ESC!|ESCALATED|NOT IMPLEMENTED)\s*\|\s*([\w.\-]+)\s*\|([^|]*)\|([^|]*)\|/i,
    );
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

/**
 * Requirements AND the acceptance criteria each one OWNS, by document order.
 *
 * Ownership used to be inferred from the AC id — `AC-22.1` -> `FR-22` — and
 * that was wrong twice over. `FR-22` is "Nothing reads as punishment" and owns
 * `AC-22b.1/.2`; the nine `AC-22.x` visual criteria live under a `### 3.10`
 * heading and belong to it in no sense. Meanwhile `AC-19.x`, `AC-20.x`, all
 * seven audio `AC-21.x` and `AC-22b.x` had no FR ticket at all, because the
 * old parser matched only `**FR-n Title.**` and those sections are `### 3.x`
 * headings. That absence was silent, which is this project's signature defect.
 *
 * So: walk the document, and every AC belongs to the most recent requirement
 * heading above it, whichever of the two shapes that heading took.
 */
function parseFrs() {
  const src = read("docs/prd.md");
  const out = [];
  let current = null;
  src.split("\n").forEach((line, i) => {
    const fr = line.match(/^\*\*(FR-[\d]+[a-z]*)\s+([^*]+?)\.?\*\*\s*(.*)$/);
    if (fr) {
      current = { id: fr[1], title: fr[2].trim(), body: fr[3].trim(), line: i + 1, acs: [] };
      out.push(current);
      return;
    }
    // `### 3.10 Visual bar` — a section that owns criteria but declares no FR.
    const sec = line.match(/^###\s+([\d]+[a-z]*(?:\.[\d]+)?)\s+(.*)$/);
    if (sec) {
      current = {
        id: `SEC-${sec[1]}`,
        title: sec[2].trim(),
        body: "",
        line: i + 1,
        acs: [],
        section: true,
      };
      out.push(current);
      return;
    }
    const ac = line.match(/^\s*-\s*(AC-[\d]+[a-z]?\.[\d]+[a-z]?)\s+/);
    if (ac && current) current.acs.push(ac[1]);
  });
  // A requirement that owns no criterion is not a rollup parent; drop the bare
  // section rows so the board does not grow empty ceremony.
  return out.filter((r) => !r.section || r.acs.length > 0);
}

/** `- **C13 · Planet names...** ... **Status: unresolved.**` */
function parseCollisions() {
  const src = read("docs/decision-log.md");
  const out = [];
  src.split("\n").forEach((line, i) => {
    const m = line.match(/^-\s*\*\*(C\d+)\s*·\s*([^*]+?)\*\*\s*(.*)$/);
    if (!m) return;
    // Was `!/status: unresolved/`, i.e. DONE by absence. A collision with no
    // status line at all, or a status on the following line, read as resolved.
    // Require the log to SAY so.
    const resolved = /status:\s*\*{0,2}\s*(resolved|decided|closed)/i.test(line);
    out.push({ id: m[1], title: m[2].trim().replace(/\.$/, ""), resolved, line: i + 1 });
  });
  return out;
}

/**
 * `## AC-10.2 — controller cannot reach the 85% band`, plus whether it has been
 * resolved.
 *
 * Every heading used to be BLOCKED unconditionally, which meant an escalation
 * could not be closed by ANYONE — writing the decision into the file changed
 * nothing, only deleting the heading did. Since
 * `docs/definition-of-done.md` defines 100% as zero BLOCKED, 100% was
 * unreachable by construction. Six of the headings in the file were already
 * not pending when this was found.
 *
 * RESOLUTION CONVENTION, so the user can close one by writing a line:
 * put `**Resolved:**` (or `**Status:** resolved`) anywhere in the section, or
 * mark the heading itself `(fixed)` / `(resolved)`. The body is scanned only
 * up to the next `## `, so one section cannot close another.
 */
function parseEscalations() {
  const raw = readIf("gauntlet/escalations.md");
  if (!raw) return [];
  const lines = raw.split("\n");
  const starts = [];
  lines.forEach((line, i) => {
    const m = line.match(/^##\s+(?!#)(.+)$/);
    if (m) starts.push({ heading: m[1].trim(), line: i + 1, at: i });
  });
  return starts.map((sec, n) => {
    const body = lines.slice(sec.at, n + 1 < starts.length ? starts[n + 1].at : lines.length).join("\n");
    const resolved =
      /\((?:fixed|resolved|closed)\)/i.test(sec.heading) ||
      /\*\*Resolved:?\*\*/i.test(body) ||
      /\*\*Status:?\*\*\s*resolved/i.test(body);
    const ids = [...sec.heading.matchAll(/\b((?:AC|FR|D|C|V|A|P|L|G|R)-?[\w.]*\d[\w.]*)\b/g)].map(
      (x) => x[1],
    );
    return { heading: sec.heading, refs: ids, line: sec.line, resolved };
  });
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

/**
 * The rubric-item state decision, extracted as a PURE function so it can be
 * tested with fixtures.
 *
 * It was previously inline, and a critic demonstrated that deleting the
 * staleness branch entirely - or making `newestSourceMtime()` return 0, so
 * nothing is ever stale - left the whole suite green at 20/20. A check whose
 * removal nothing notices is not a check. This shape lets the branch be
 * exercised directly rather than only through whatever the repo happens to
 * look like on the day.
 */
export function rubricState({ result, falsePass, stale, ageMs, staleReason }) {
  if (falsePass) return { state: STATE.FALSE_PASS, why: falsePass.why };
  if (!result) return { state: STATE.OPEN, why: "no row for this item in gauntlet/report.md" };
  const status = String(result.status).toUpperCase();
  if (status === "FAIL") return { state: STATE.OPEN, why: result.measurement || "reported FAIL" };
  if (status === "ESC!" || status === "ESCALATED") {
    return { state: STATE.BLOCKED, why: "escalated — awaiting a decision in gauntlet/escalations.md" };
  }
  if (status === "PASS" && stale) {
    return {
      state: STATE.UNVERIFIED,
      why: `reported PASS on a tree that is no longer this one (${staleReason ?? `older by ${fmtAge(ageMs)}`})`,
    };
  }
  if (status === "PASS") return { state: STATE.DONE, why: result.measurement };
  return { state: STATE.OPEN, why: status };
}

/** Defects the user reported by looking at the game. See the block that uses it. */
function userReported() {
  const raw = readIf("gauntlet/user-reported.json");
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`tickets: gauntlet/user-reported.json is not valid JSON — ${e.message}`);
    process.exitCode = 1;
    return [];
  }
}

export function buildTickets() {
  const tickets = [];
  const { byId: rubricById, meta: reportMeta } = rubricResults();

  const { acs, citedDecisions } = parsePrd();
  const knownIds = new Set([...RUBRIC.map((r) => r.id), ...acs.keys()]);
  const prdEdges = prdRubricEdges();
  // Ids named by an escalation that is still open.
  const openEscalationFor = new Map();
  for (const e of parseEscalations()) {
    if (e.resolved) continue;
    for (const ref of e.refs) {
      if (!openEscalationFor.has(ref)) openEscalationFor.set(ref, firstSentence(e.heading, 90));
    }
  }
  const strictlyCited = decisionsCitedByCriteria();
  const falsePasses = knownFalsePasses(knownIds);
  const decisions = decisionText();
  const decisionStatus = parseDecisions();

  // --- Rubric items -------------------------------------------------------
  // These come first because the AC tickets below bind to them.
  const rubricByAc = new Map();
  for (const item of RUBRIC) {
    const { state, why } = rubricState({
      result: rubricById.get(item.id),
      falsePass: falsePasses.get(item.id),
      stale: reportMeta.stale,
      ageMs: reportMeta.ageMs,
      staleReason: reportMeta.reason,
    });

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
    // ...and the edges the PRD states in prose, which rubric.mjs does not carry.
    for (const [acId, named] of prdEdges) {
      if (!named.includes(item.id)) continue;
      if (!rubricByAc.has(acId)) rubricByAc.set(acId, []);
      if (!rubricByAc.get(acId).some((b) => b.id === item.id)) {
        rubricByAc.get(acId).push({ id: item.id, state });
      }
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
    } else if (openEscalationFor.has(id)) {
      // An AC named by an UNRESOLVED escalation is blocked on a human, whatever
      // its tests say. AC-10.2 was the case that forced this rule: its citation
      // is a describe called "AC-10.2 diagnostics: why the low end cannot
      // converge", six running tests that establish the criterion CANNOT hold.
      // They are good tests. They are not evidence that the AC is met, and no
      // amount of citation-grading can tell the difference - only the fact that
      // someone escalated it can.
      state = STATE.BLOCKED;
      why = `escalated: ${openEscalationFor.get(id)}`;
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
    } else if (bound.some((b) => b.state === STATE.UNVERIFIED)) {
      // The staleness pillar. Without this case the rubric item's freshness
      // check was computed and then thrown away here, so an AC could be DONE -
      // "evidence fresher than the code" - while the only evidence for it was
      // a report predating the code. That was 105 of 184 DONE rows.
      state = STATE.UNVERIFIED;
      why = `the rubric item covering it (${bound.find((b) => b.state === STATE.UNVERIFIED).id}) is itself unverified`;
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
  const stateOf = new Map(tickets.map((t) => [t.id, t.state]));
  const requirements = parseFrs();
  const owned = new Set(requirements.flatMap((r) => r.acs));
  // Absence must never be silent: an AC that no requirement heading owns is a
  // parse failure, not an AC without a parent, and it gets said out loud.
  const orphans = [...acs.keys()].filter((id) => !owned.has(id));
  if (orphans.length) {
    console.error(
      `tickets: ${orphans.length} AC(s) owned by no requirement heading: ${orphans.join(", ")}`,
    );
    process.exitCode = 1;
  }
  for (const fr of requirements) {
    const children = fr.acs.map((a) => `KB-${a}`);
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
    } else if (strictlyCited.has(id)) {
      state = STATE.DONE;
      why = "named on an acceptance-criterion or requirement line in the PRD";
    } else if (citedDecisions.has(id)) {
      // Mentioned somewhere in the PRD, but not by a criterion. That is where
      // D03 was DONE for appearing in the NON-GOALS list - cited for being
      // explicitly not built.
      state = STATE.UNVERIFIED;
      why =
        "mentioned in the PRD but not on any acceptance-criterion line — a heading or a non-goal is not a realisation";
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
    let screenEvidence = [];
    if (nonScene.has(row)) {
      state = STATE.EXEMPT;
      why = "declared a non-scene row in sceneKeys.ts";
    } else if (sceneFor && scenes.has(sceneFor)) {
      // Was `existsSync`, so a one-line stub passed. A screen is only DONE when
      // something DRIVES it: an e2e spec naming the scene key. The file
      // existing says nothing about whether the screen works.
      const driven = TEST_FILES.filter(
        (f) => f.path.includes("/e2e/") && new RegExp(`\\b${escapeRe(sceneFor)}\\b`).test(f.src),
      ).map((f) => f.path);
      if (driven.length > 0) {
        state = STATE.DONE;
        why = `driven by ${driven.length} e2e spec(s): ${driven.slice(0, 2).join(", ")}`;
        screenEvidence = driven;
      } else {
        state = STATE.UNVERIFIED;
        why = `src/game/scenes/${sceneFor}Scene.ts exists, but no e2e spec drives it — file existence is not a screen`;
      }
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
      evidence: screenEvidence,
      refs: sceneFor ? [sceneFor] : [],
    });
  }

  // --- User-reported defects ----------------------------------------------
  /**
   * Things the USER saw and reported, in their own words.
   *
   * These get first-class tickets because they are the only requirements in
   * this project verified by the one test that has never been wrong all night:
   * a person looking at the screen. The suite was green over an unplayable
   * game, over invisible asteroids, over a dead voice pipeline and over six
   * reports of the same bars. Every one of those was found by eye.
   *
   * Status is NOT computed here. A user-reported defect is closed when the user
   * says it is closed, or when there is evidence a critic accepted — not when a
   * check we wrote goes green. That is the whole lesson of the night, so the
   * `state` field is read from the file and the file records who closed it.
   */
  for (const r of userReported()) {
    tickets.push({
      id: `KB-${r.id}`,
      kind: "user-reported",
      title: firstSentence(r.what, 110),
      source: "gauntlet/user-reported.json",
      state: r.state === "DONE" ? STATE.DONE : STATE.OPEN,
      why:
        r.state === "DONE"
          ? r.evidence ?? "closed"
          : `reported ${r.reports ?? 1}x by the user: "${firstSentence(r.said, 90)}"`,
      evidence: r.evidence ? [r.evidence] : [],
      refs: [],
    });
  }

  // --- Escalations --------------------------------------------------------
  // Always BLOCKED: an escalation is by construction a decision only the user
  // can take (D94). None of these can be computed to DONE from this side.
  for (const e of parseEscalations()) {
    // Id derived from the heading, not from position. Positional ids meant
    // inserting one escalation at the top renumbered every other ticket, and
    // these are tracked across days.
    tickets.push({
      id: `KB-ESC-${slug(e.heading).slice(0, 44)}`,
      kind: "escalation",
      title: firstSentence(e.heading, 120),
      source: `gauntlet/escalations.md:${e.line}`,
      state: e.resolved ? STATE.DONE : STATE.BLOCKED,
      why: e.resolved
        ? "marked resolved in gauntlet/escalations.md"
        : "awaiting a user decision — add **Resolved:** to its section to close it",
      evidence: [],
      refs: e.refs,
    });
  }

  tickets.sort(
    (a, b) => SEVERITY[a.state] - SEVERITY[b.state] || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id),
  );
  return tickets;
}

const refsIn = (s) => [...String(s).matchAll(/\b((?:AC|FR|D|C)-?\d[\w.]*)\b/g)].map((m) => m[1]);

/**
 * AC -> rubric-item edges the PRD states IN PROSE, e.g. "gauntlet `R-lantern`".
 *
 * The board previously built this edge only from `rubric.mjs`'s own `source:`
 * string, and 11 of 33 rubric items name no AC there - so their failures
 * propagated nowhere. AC-24.2 sat DONE while R-lantern was OPEN, with the PRD
 * stating the link in plain text one line away. Both directions are read now.
 */
function prdRubricEdges() {
  const src = read("docs/prd.md");
  const edges = new Map(); // acId -> [rubricId]
  for (const line of src.split("\n")) {
    const ac = line.match(/^\s*-\s*(AC-[\d]+[a-z]?\.[\d]+[a-z]?)\s+/);
    if (!ac) continue;
    const named = [...line.matchAll(/gauntlet\s+`([A-Za-z0-9.\-]+)`/g)].map((m) => m[1]);
    if (named.length) edges.set(ac[1], named);
  }
  return edges;
}

/**
 * Decisions the PRD cites FROM AN ACCEPTANCE CRITERION, rather than anywhere in
 * the file.
 *
 * `trace-check`'s `citedDecisions` is `/\bD\d+\b/` over the whole document,
 * which is the substring scan this board exists to replace. It made 54 decision
 * tickets - 29% of the DONE column - DONE because a token appeared in a section
 * heading or a bullet. D03 was DONE for being named in the NON-GOALS list, i.e.
 * for being explicitly not built. Here a decision counts as realised only if an
 * AC or an FR line mentions it.
 */
function decisionsCitedByCriteria() {
  const src = read("docs/prd.md");
  const cited = new Set();
  for (const line of src.split("\n")) {
    const isAc = /^\s*-\s*AC-[\d]+[a-z]?\.[\d]+/.test(line);
    const isFr = /^\*\*FR-[\d]+[a-z]*\s/.test(line);
    if (!isAc && !isFr) continue;
    for (const m of line.matchAll(/\b(D\d+)\b/g)) cited.add(m[1]);
  }
  return cited;
}
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

  // 100% is every ticket DONE or EXEMPT (docs/definition-of-done.md). An
  // earlier revision exited 0 with 26 OPEN and 31 BLOCKED outstanding while
  // that document named this command as the sole measure - so the command the
  // project had designated as the definition of done returned success at ~82%.
  const outstanding = tickets.filter(
    (x) => x.state !== STATE.DONE && x.state !== STATE.EXEMPT,
  );
  if (FLAGS.check && outstanding.length > 0) {
    const byState = {};
    for (const x of outstanding) byState[x.state] = (byState[x.state] ?? 0) + 1;
    console.error(
      `\n--check: ${outstanding.length} ticket(s) not DONE or EXEMPT — ` +
        Object.entries(byState).map(([k, v]) => `${v} ${k}`).join(", "),
    );
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
