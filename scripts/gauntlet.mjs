#!/usr/bin/env node
/**
 * THE GAUNTLET RUNNER (architecture section 10.1).
 *
 *   node scripts/gauntlet.mjs            one pass, writes gauntlet/report.md
 *   node scripts/gauntlet.mjs --loop     unattended mode, writes gauntlet/summary.md
 *   node scripts/gauntlet.mjs --json     machine-readable result on stdout
 *
 * What this process DOES: run every rubric check, collect evidence, write the
 * report, track attempts per item, and escalate an item that has burned its
 * 8 attempts (architecture 10.1 step 5).
 *
 * What this process does NOT do: fix anything. Step 5's fix loop is an agent
 * writing code (D93). This runner is the instrument the agent reads. Keeping
 * that boundary is deliberate - a script that both measures and repairs can
 * always make its own numbers go green.
 *
 * GUARDRAILS (D87, CLAUDE.md). This script must never deploy, never run
 * vercel, never call a paid API without --live plus SPEND_CAP_USD, and never
 * write outside the repo. There is an assertion for each below.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ATTEMPT_CAP, RUBRIC, SECTIONS, STATUS } from "../tests/gauntlet/rubric.mjs";
import { srcHash, srcHashInputCount } from "./lib/srcHash.mjs";

const execFileAsync = promisify(execFile);
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GAUNTLET_DIR = join(REPO, "gauntlet");
const EVIDENCE_DIR = join(GAUNTLET_DIR, "evidence");
const STATE_PATH = join(GAUNTLET_DIR, "state.json");
const REPORT_PATH = join(GAUNTLET_DIR, "report.md");
const SUMMARY_PATH = join(GAUNTLET_DIR, "summary.md");
const ESCALATIONS_PATH = join(GAUNTLET_DIR, "escalations.md");

const argv = process.argv.slice(2);
const FLAGS = {
  loop: argv.includes("--loop"),
  json: argv.includes("--json"),
  live: argv.includes("--live"),
  quiet: argv.includes("--quiet"),
};

// --- Guardrails, asserted rather than assumed (D87) -------------------------

if (FLAGS.live && !process.env.SPEND_CAP_USD) {
  console.error("--live requires SPEND_CAP_USD. Refusing to make paid calls without a cap (D87).");
  process.exit(2);
}
const FORBIDDEN_ENV = ["VERCEL_TOKEN", "VERCEL_ORG_ID"];
for (const key of FORBIDDEN_ENV) {
  if (process.env[key]) {
    console.error(`${key} is set. The gauntlet never deploys (D87). Unset it and re-run.`);
    process.exit(2);
  }
}

/** Every write goes through here, so "writes confined to the repo" is enforced. */
function writeInRepo(path, contents) {
  const abs = resolve(path);
  if (!abs.startsWith(REPO + "/")) {
    throw new Error(`Refusing to write outside the repo (D87): ${abs}`);
  }
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, contents);
}

// --- Evidence access --------------------------------------------------------

/**
 * Evidence is a directory of artifacts produced by the e2e/perf runners.
 * A check may only pass by pointing at one of these; that is the whole point
 * of the judge step (architecture 10.1 step 4).
 */
const evidence = {
  has: (name) => existsSync(join(EVIDENCE_DIR, name)),
  path: (name) => `gauntlet/evidence/${name}`,
  read: (name) => JSON.parse(readFileSync(join(EVIDENCE_DIR, name), "utf8")),
  assertNumber(name, key, predicate, what) {
    const data = this.read(name);
    const value = data[key];
    if (typeof value !== "number" || Number.isNaN(value)) {
      return { status: STATUS.FAIL, detail: `${name} has no numeric "${key}"`, evidence: this.path(name) };
    }
    return {
      status: predicate(value) ? STATUS.PASS : STATUS.FAIL,
      detail: `${what}: ${key} = ${value}`,
      evidence: this.path(name),
    };
  },
  assertShape(name, predicate, what) {
    const data = this.read(name);
    return {
      status: predicate(data) ? STATUS.PASS : STATUS.FAIL,
      detail: what,
      evidence: this.path(name),
    };
  },
};

async function runNode(args) {
  try {
    const { stdout, stderr } = await execFileAsync("node", args, { cwd: REPO, maxBuffer: 20e6 });
    return { code: 0, stdout, stderr };
  } catch (e) {
    return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? String(e) };
  }
}

// --- Attempt tracking -------------------------------------------------------

function loadState() {
  if (!existsSync(STATE_PATH)) return { attempts: {}, escalated: {} };
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { attempts: {}, escalated: {} };
  }
}

function saveState(state) {
  writeInRepo(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

/**
 * Append an escalation. Never rewrites the file: it is the morning review
 * queue and its history matters (architecture 10.1 step 5).
 */
function escalate(item, result, attempts) {
  const stamp = new Date().toISOString();
  const entry = [
    ``,
    `## ${item.id} — ${item.title}`,
    ``,
    `- **Escalated:** ${stamp}`,
    `- **Source:** ${item.source}`,
    `- **Attempts:** ${attempts} (cap ${ATTEMPT_CAP})`,
    `- **Last measurement:** ${result.detail}`,
    `- **Evidence:** ${result.evidence ?? "none produced"}`,
    ``,
    `**Proposal:** ${item.proposal ?? "Needs a human read. The check is measuring the right thing but the implementation has not reached the threshold in " + ATTEMPT_CAP + " attempts."}`,
    ``,
    `_Not marked passed. D85: escalated items never ship as green._`,
    ``,
  ].join("\n");
  const existing = existsSync(ESCALATIONS_PATH) ? readFileSync(ESCALATIONS_PATH, "utf8") : "";
  writeInRepo(ESCALATIONS_PATH, existing + entry);
}

// --- One pass ---------------------------------------------------------------

async function runPass() {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const state = loadState();
  const results = new Map();

  for (const item of RUBRIC) {
    // AN ESCALATED ITEM IS STILL MEASURED.
    //
    // This used to `continue` here, so once `state.escalated[id]` was set the
    // item never ran again — the check stopped checking. The board then
    // permanently understated reality: G-e2e-whole sat ESCALATED while its own
    // artifact recorded 274 passed and 0 failed, because nothing re-read it.
    //
    // An escalation means A HUMAN NEEDS TO DECIDE SOMETHING. It does not mean
    // the world stopped moving. If the condition has since been met, the
    // escalation has been overtaken by events and saying so is the honest
    // report; if it has not, the item stays escalated exactly as before.
    //
    // This is the same defect this rubric spends its time catching elsewhere,
    // aimed at the rubric: a check bound to a fact it no longer verifies.
    const wasEscalated = state.escalated[item.id] === true;

    let result;
    try {
      result = await item.run({ repo: REPO, evidence, runNode, live: FLAGS.live });
    } catch (e) {
      result = { status: STATUS.FAIL, detail: `check threw: ${e.message}`, evidence: null };
    }

    // A pass with no evidence artifact is not a pass (D85, step 4). Static
    // checks are self-evidencing: the source tree they scanned IS the artifact.
    const selfEvidencing = ["static", "trace"].includes(item.kind);
    if (result.status === STATUS.PASS && !result.evidence && !selfEvidencing) {
      result = {
        status: STATUS.FAIL,
        detail: `claimed pass without an evidence artifact — rejected (D85). ${result.detail}`,
        evidence: null,
      };
    }

    if (wasEscalated) {
      // Re-measured above. Only a genuine PASS discharges an escalation, and
      // the discharge is announced rather than silent, so a reader can go and
      // close the write-up in gauntlet/escalations.md.
      if (result.status === STATUS.PASS) {
        delete state.escalated[item.id];
        state.attempts[item.id] = 0;
        result = {
          ...result,
          detail: `${result.detail} — passes now; the escalation is discharged, close it in gauntlet/escalations.md`,
        };
      } else {
        result = {
          status: STATUS.ESCALATED,
          detail: `still failing, escalated: ${result.detail}`,
          evidence: result.evidence ?? "gauntlet/escalations.md",
        };
      }
      results.set(item.id, result);
      continue;
    }

    if (result.status === STATUS.FAIL) {
      const n = (state.attempts[item.id] ?? 0) + 1;
      state.attempts[item.id] = n;
      if (n >= ATTEMPT_CAP) {
        state.escalated[item.id] = true;
        escalate(item, result, n);
        result = { ...result, status: STATUS.ESCALATED, detail: `${result.detail} — cap reached, escalated` };
      }
    } else if (result.status === STATUS.PASS) {
      state.attempts[item.id] = 0;
    }

    results.set(item.id, result);
  }

  saveState(state);
  return results;
}

// --- Reporting --------------------------------------------------------------

const ICON = {
  [STATUS.PASS]: "PASS",
  [STATUS.FAIL]: "FAIL",
  [STATUS.NOT_IMPLEMENTED]: "----",
  [STATUS.ESCALATED]: "ESC!",
};

function tally(results) {
  const t = { pass: 0, fail: 0, notImplemented: 0, escalated: 0 };
  for (const r of results.values()) {
    if (r.status === STATUS.PASS) t.pass++;
    else if (r.status === STATUS.FAIL) t.fail++;
    else if (r.status === STATUS.ESCALATED) t.escalated++;
    else t.notImplemented++;
  }
  return t;
}

function writeReport(results, startedAt) {
  const t = tally(results);
  const lines = [
    `# Gauntlet report`,
    ``,
    `Generated ${new Date().toISOString()} · elapsed ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
    ``,
    // A CONTENT hash of the tree this report measured, so staleness is a fact
    // rather than an mtime. `touch` cannot forge it and `git checkout` cannot
    // disturb it. scripts/tickets.mjs re-derives it and refuses to call a
    // ticket DONE on evidence whose hash no longer matches the tree.
    `<!-- src-hash: ${srcHash()} over ${srcHashInputCount()} files -->`,
    ``,
    `| pass | fail | not implemented | escalated | total |`,
    `|---|---|---|---|---|`,
    `| ${t.pass} | ${t.fail} | ${t.notImplemented} | ${t.escalated} | ${RUBRIC.length} |`,
    ``,
    `\`not implemented\` means the thing being measured does not exist yet. It is`,
    `never a pass (D85). The overnight loop drives that column to zero.`,
    ``,
  ];

  for (const [sectionName, items] of SECTIONS) {
    lines.push(`## ${sectionName}`, ``);
    lines.push(`| | id | item | measurement | evidence |`, `|---|---|---|---|---|`);
    for (const item of items) {
      const r = results.get(item.id);
      const detail = (r.detail ?? "").replace(/\n/g, "<br>").replace(/\|/g, "\\|");
      lines.push(`| ${ICON[r.status]} | ${item.id} | ${item.title} | ${detail} | ${r.evidence ?? "—"} |`);
    }
    lines.push(``);
  }

  const needJudge = RUBRIC.filter((i) => i.kind === "reference");
  if (needJudge.length) {
    lines.push(
      `## Judge step (architecture 10.1 step 4)`,
      ``,
      `These items cannot be auto-passed. An agent must open both images and either`,
      `call the match or list concrete differences (silhouette, proportion, colour,`,
      `detail) as fix tasks.`,
      ``,
    );
    for (const item of needJudge) {
      const r = results.get(item.id);
      lines.push(`### ${item.id} — ${item.title}`, ``);
      lines.push(`- Reference: \`${item.referenceImage}\``);
      lines.push(`- Render: \`${evidence.has(item.renderEvidence) ? evidence.path(item.renderEvidence) : "not rendered yet"}\``);
      lines.push(`- Status: ${ICON[r.status]} — ${r.detail}`, ``);
    }
  }

  writeInRepo(REPORT_PATH, lines.join("\n"));
  return t;
}

function writeSummary(passes, t, startedAt, lastCommit, mode = "overnight mode") {
  const lines = [
    `# Gauntlet summary (${mode})`,
    ``,
    `- Finished: ${new Date().toISOString()}`,
    `- Passes over the run: ${passes}`,
    `- Elapsed: ${((Date.now() - startedAt) / 1000 / 60).toFixed(1)} min`,
    `- Last commit: ${lastCommit}`,
    ``,
    `| pass | fail | not implemented | escalated | total |`,
    `|---|---|---|---|---|`,
    `| ${t.pass} | ${t.fail} | ${t.notImplemented} | ${t.escalated} | ${RUBRIC.length} |`,
    ``,
    t.escalated > 0
      ? `${t.escalated} item(s) escalated — read gauntlet/escalations.md first.`
      : `Nothing escalated.`,
    ``,
    `Full detail: gauntlet/report.md`,
    ``,
  ];
  writeInRepo(SUMMARY_PATH, lines.join("\n"));
}

async function lastCommit() {
  const r = await execFileAsync("git", ["log", "-1", "--oneline"], { cwd: REPO }).catch(() => null);
  return r ? r.stdout.trim() : "unknown";
}

// --- Entry ------------------------------------------------------------------

const startedAt = Date.now();

if (FLAGS.loop) {
  // Unattended mode: keep passing until every item is pass or escalated.
  let passes = 0;
  let t;
  const MAX_PASSES = 200; // a stop, so an unattended night cannot spin forever
  for (;;) {
    passes++;
    const results = await runPass();
    t = writeReport(results, startedAt);
    if (!FLAGS.quiet) {
      console.log(`pass ${passes}: ${t.pass} pass / ${t.fail} fail / ${t.notImplemented} not-impl / ${t.escalated} escalated`);
    }
    const settled = t.fail === 0 && t.notImplemented === 0;
    if (settled || passes >= MAX_PASSES) break;
    // Nothing here can fix anything (see header). Without an agent editing
    // code between passes the numbers cannot move, so one pass is the honest
    // amount of work to do; looping further would only burn cycles.
    break;
  }
  writeSummary(passes, t, startedAt, await lastCommit());
  console.log(`\nWrote gauntlet/report.md and gauntlet/summary.md`);
  process.exit(t.fail > 0 ? 1 : 0);
} else {
  const results = await runPass();
  const t = writeReport(results, startedAt);
  if (FLAGS.json) {
    console.log(JSON.stringify({ tally: t, items: Object.fromEntries(results) }, null, 2));
  } else {
    for (const [name, items] of SECTIONS) {
      console.log(`\n${name}`);
      for (const item of items) {
        const r = results.get(item.id);
        console.log(`  ${ICON[r.status]}  ${item.id.padEnd(14)} ${item.title}`);
        if (r.status !== STATUS.PASS && r.detail) console.log(`        ${r.detail.split("\n")[0]}`);
      }
    }
    console.log(`\n${t.pass} pass · ${t.fail} fail · ${t.notImplemented} not implemented · ${t.escalated} escalated · ${RUBRIC.length} total`);
    console.log(`Report: gauntlet/report.md`);
  }
  // Both files, always. See writeSummary's note: a summary that only the
  // --loop branch refreshes is a summary that lies after any single pass,
  // and it is the file a human reads first.
  writeSummary(1, t, startedAt, await lastCommit(), "single pass");
  process.exit(t.fail > 0 ? 1 : 0);
}
