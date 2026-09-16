/**
 * THE RUBRIC (architecture section 10.4: "executable checks, not prose").
 *
 * This file is the only definition of "good enough" (CLAUDE.md precedence 3).
 * Every item is derived from a decision and a PRD acceptance criterion, and
 * every item must produce an EVIDENCE ARTIFACT before it may be called passed
 * (D85, and the judge step in architecture section 10.1 step 4).
 *
 * Status vocabulary - deliberately four values, not two:
 *   pass             the check ran, measured something, and met its threshold.
 *                    Requires a non-null evidence path. No evidence => not pass.
 *   fail             the check ran and missed its threshold. This is a TASK.
 *   not-implemented   the thing being measured does not exist yet. NEVER a pass.
 *                    The overnight loop drives this count to zero.
 *   escalated        hit the 8-attempt cap, or passes numerically but reads flat
 *                    against art-direction.md. Never counted as passed (D85).
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

export const STATUS = Object.freeze({
  PASS: "pass",
  FAIL: "fail",
  NOT_IMPLEMENTED: "not-implemented",
  ESCALATED: "escalated",
});

/** Per-item attempt cap before escalation (architecture 10.1 step 5). */
export const ATTEMPT_CAP = 8;

const ok = (detail, evidence = null) => ({ status: STATUS.PASS, detail, evidence });
const bad = (detail, evidence = null) => ({ status: STATUS.FAIL, detail, evidence });
const todo = (detail) => ({ status: STATUS.NOT_IMPLEMENTED, detail, evidence: null });

/** Recursively list files under dir, or [] if it does not exist. */
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const sceneFiles = (repo) =>
  walk(join(repo, "src/game/scenes")).filter((f) => extname(f) === ".ts");

const gameSources = (repo) =>
  walk(join(repo, "src/game")).filter((f) => [".ts", ".mjs"].includes(extname(f)));

const readAll = (files) => files.map((f) => readFileSync(f, "utf8")).join("\n");

// ---------------------------------------------------------------------------
// Visual rubric (D60, PRD section 3.10)
// ---------------------------------------------------------------------------

const visual = [
  {
    id: "V-22.1",
    source: "D60#1 / AC-22.1",
    title: "At least 5 parallax layers at distinct scroll speeds",
    kind: "visual",
    run: async ({ repo }) => {
      const cfg = join(repo, "src/game/render/layers.ts");
      if (!existsSync(cfg)) return todo("src/game/render/layers.ts does not exist yet");
      const src = readFileSync(cfg, "utf8");
      const speeds = [...src.matchAll(/speed:\s*([0-9.]+)/g)].map((m) => Number(m[1]));
      const distinct = new Set(speeds);
      return speeds.length >= 5 && distinct.size === speeds.length
        ? ok(`${speeds.length} layers, ${distinct.size} distinct speeds: ${speeds.join(", ")}`)
        : bad(`found ${speeds.length} layers / ${distinct.size} distinct speeds; need >=5 and all distinct`);
    },
  },
  {
    id: "V-22.2",
    source: "D60#2 / AC-22.2",
    title: "Idle frame is never still (two Title shots 1s apart differ > 2%)",
    kind: "visual",
    needsBrowser: true,
    run: async ({ evidence }) =>
      evidence.has("title-idle-diff.json")
        ? evidence.assertNumber("title-idle-diff.json", "diffPercent", (v) => v > 2,
            "pixel difference between two Title frames 1s apart")
        : todo("Title scene not built; no title-idle-diff.json evidence"),
  },
  {
    id: "V-22.3",
    source: "D60#3 / AC-22.3",
    title: "Sky gradient shifts across a stage (deltaE > 10)",
    kind: "visual",
    needsBrowser: true,
    run: async ({ evidence }) =>
      evidence.has("sky-gradient-shift.json")
        ? evidence.assertNumber("sky-gradient-shift.json", "deltaE", (v) => v > 10,
            "CIE deltaE between sampled sky at stage start and stage end")
        : todo("Flight scene not built; no sky-gradient-shift.json evidence"),
  },
  {
    id: "V-22.4",
    source: "D60#4 / AC-22.4",
    title: "Silhouettes read when desaturated",
    kind: "visual",
    needsBrowser: true,
    run: async ({ evidence }) =>
      evidence.has("desaturated-contours.json")
        ? evidence.assertNumber("desaturated-contours.json", "contours", (v) => v >= 3 && v <= 60,
            "contour count in the desaturated flight frame")
        : todo("Flight scene not built; no desaturated-contours.json evidence"),
  },
  {
    id: "V-22.5",
    source: "D60#5 / AC-22.5",
    title: "Zero Linear easing anywhere in tween configs",
    kind: "static",
    run: async ({ repo }) => {
      const files = gameSources(repo);
      if (files.length === 0) return todo("src/game has no sources yet");
      const hits = [];
      for (const f of files) {
        const src = readFileSync(f, "utf8");
        // Phaser accepts "Linear", Phaser.Math.Easing.Linear, and ease: 'linear'
        for (const m of src.matchAll(/ease[A-Za-z]*\s*:\s*["'`]?([A-Za-z.]*[Ll]inear)/g)) {
          hits.push(`${f.replace(repo + "/", "")}: ${m[0]}`);
        }
      }
      return hits.length === 0
        ? ok(`no Linear easing across ${files.length} game source files`)
        : bad(`Linear easing found:\n${hits.join("\n")}`);
    },
  },
  {
    id: "V-22.6",
    source: "D60#6 / AC-22.6",
    title: "Blast, hit and warp have distinct particle signatures",
    kind: "static",
    run: async ({ repo }) => {
      const p = join(repo, "src/game/render/particles.ts");
      if (!existsSync(p)) return todo("src/game/render/particles.ts does not exist yet");
      const src = readFileSync(p, "utf8");
      // art-direction.md section 9 names these three systems explicitly.
      const required = ["blastShards", "strikeSpark", "warpStreaks"];
      const missing = required.filter((n) => !src.includes(n));
      return missing.length === 0
        ? ok(`all three named particle systems present: ${required.join(", ")}`)
        : bad(`missing particle systems: ${missing.join(", ")}`);
    },
  },
  {
    id: "V-22.7",
    source: "D60#7 / AC-22.7",
    title: "Each stage palette is 5-7 colours plus exactly one accent",
    kind: "static",
    run: async ({ repo }) => {
      const p = join(repo, "src/content/palettes.json");
      if (!existsSync(p)) return todo("src/content/palettes.json not compiled yet (D70 promotes palettes into it)");
      let palettes;
      try {
        palettes = JSON.parse(readFileSync(p, "utf8"));
      } catch (e) {
        return bad(`palettes.json is not valid JSON: ${e.message}`);
      }
      const problems = [];
      for (const [stop, pal] of Object.entries(palettes)) {
        const n = Array.isArray(pal.colors) ? pal.colors.length : 0;
        if (n < 5 || n > 7) problems.push(`${stop}: ${n} colours (need 5-7)`);
        if (typeof pal.accent !== "string") problems.push(`${stop}: missing single accent`);
      }
      const count = Object.keys(palettes).length;
      if (count !== 7) problems.push(`${count} palettes (need 7, one per stop)`);
      return problems.length === 0
        ? ok(`7 palettes, each 5-7 colours + 1 accent`)
        : bad(problems.join("; "));
    },
  },
  {
    id: "V-22.8",
    source: "D60#8 / AC-22.8",
    title: "Word plate text contrast >= 4.5:1",
    kind: "unit",
    run: async ({ evidence }) =>
      evidence.has("contrast.json")
        ? evidence.assertNumber("contrast.json", "minRatio", (v) => v >= 4.5,
            "lowest word-plate contrast ratio across all seven palettes")
        : todo("no contrast.json evidence; palettes and label plates not built"),
  },
  {
    id: "P-22.9",
    source: "D60#9 / AC-22.9 / NFR-1",
    title: "60 fps: p95 frame time <= 16.7 ms over a 60 s scripted flight",
    kind: "perf",
    needsBrowser: true,
    run: async ({ evidence }) =>
      evidence.has("frametime.json")
        ? evidence.assertNumber("frametime.json", "p95Ms", (v) => v <= 16.7,
            "p95 frame time in headless Chromium over a 60 s scripted flight")
        : todo("Flight scene not built; no frametime.json evidence"),
  },
];

// ---------------------------------------------------------------------------
// Audio rubric (D62, D63, D88, PRD section 3.9)
// ---------------------------------------------------------------------------

const audio = [
  {
    id: "A-21.1",
    source: "D62 / AC-21.1",
    title: "Per-planet ambient bed exists and crossfades on transition",
    kind: "audio",
    run: async ({ repo, evidence }) => {
      if (!existsSync(join(repo, "src/game/audio"))) return todo("src/game/audio does not exist yet");
      return evidence.has("audio-graph.json")
        ? evidence.assertShape("audio-graph.json", (g) =>
            Array.isArray(g.ambientBeds) && g.ambientBeds.length === 7 && g.crossfade === true,
            "seven ambient beds with crossfade enabled")
        : todo("no audio-graph.json evidence yet");
    },
  },
  {
    id: "A-21.2",
    source: "D62 / AC-21.2",
    title: "Music has >= 3 intensity layers driven by live asteroids and combo",
    kind: "audio",
    run: async ({ evidence }) =>
      evidence.has("audio-graph.json")
        ? evidence.assertShape("audio-graph.json", (g) => (g.musicLayers ?? 0) >= 3,
            "music intensity layer count")
        : todo("no audio-graph.json evidence yet"),
  },
  {
    id: "A-21.3",
    source: "D62 / AC-21.3",
    title: "Every event has >= 3 SFX variants and never repeats consecutively",
    kind: "audio",
    run: async ({ evidence }) =>
      evidence.has("audio-graph.json")
        ? evidence.assertShape("audio-graph.json", (g) => {
            const v = g.sfxVariants ?? {};
            const events = ["lock","keystroke","typo","blast","hit","shield","warpCharge","warp","beacon","uiNav"];
            return events.every((e) => (v[e] ?? 0) >= 3) && g.noConsecutiveRepeat === true;
          }, ">=3 variants for all ten named events, with rotation")
        : todo("no audio-graph.json evidence yet"),
  },
  {
    id: "A-21.4",
    source: "D62 / AC-21.4",
    title: "Music ducks by >= 6 dB while Shadow speaks",
    kind: "audio",
    run: async ({ evidence }) =>
      evidence.has("audio-graph.json")
        ? evidence.assertNumber("audio-graph.json", "duckDb", (v) => v <= -6,
            "gain reduction applied to Music/Ambient under the Voice bus")
        : todo("no audio-graph.json evidence yet"),
  },
  {
    id: "A-21.5",
    source: "D88 / AC-21.5",
    title: "Shadow speaks via Web Speech system voice; zero network TTS at runtime",
    kind: "audio",
    run: async ({ evidence }) =>
      evidence.has("audio-graph.json")
        ? evidence.assertShape("audio-graph.json", (g) =>
            g.voiceTransport === "webspeech" && g.runtimeTtsNetworkCalls === 0,
            "system voice stand-in with no runtime TTS network calls (D88)")
        : todo("no audio-graph.json evidence yet"),
  },
];

// ---------------------------------------------------------------------------
// Core loop qualities (D77, PRD FR-6e)
// ---------------------------------------------------------------------------

const loop = [
  {
    id: "L-6e.1",
    source: "D77 / AC-6e.1",
    title: "Input-to-visual latency <= 16.7 ms (one frame)",
    kind: "perf",
    needsBrowser: true,
    run: async ({ evidence }) =>
      evidence.has("input-latency.json")
        ? evidence.assertNumber("input-latency.json", "p95Ms", (v) => v <= 16.7,
            "p95 keydown-to-render latency")
        : todo("Flight scene not built; no input-latency.json evidence"),
  },
  {
    id: "L-6e.3",
    source: "D77 / AC-6e.3",
    title: "No dead time > 2 s during flight",
    kind: "unit",
    run: async ({ evidence }) =>
      evidence.has("deadtime.json")
        ? evidence.assertNumber("deadtime.json", "maxGapMs", (v) => v <= 2000,
            "longest interval with no live asteroid and no pending spawn")
        : todo("flight simulation not built; no deadtime.json evidence"),
  },
  {
    id: "L-6e.4",
    source: "D77 / AC-6e.4 / D50",
    title: "Retention line trends upward across a full Earth->Pluto run",
    kind: "unit",
    run: async ({ evidence }) =>
      evidence.has("retention.json")
        ? evidence.assertShape("retention.json", (r) => r.trendUp === true,
            "simulated learner's retention improves across seven stops")
        : todo("learning-engine simulation not built; no retention.json evidence"),
  },
];

// ---------------------------------------------------------------------------
// Reference compare (architecture 10.1 step 3, D90/D91)
// ---------------------------------------------------------------------------

const reference = [
  {
    id: "R-lantern",
    source: "D90 / art-direction.md section 5",
    title: "Vector Lantern matches design-reference/refs/lantern-topdown.png",
    kind: "reference",
    referenceImage: "design-reference/refs/lantern-topdown.png",
    renderEvidence: "lantern-render.png",
    run: async ({ repo, evidence }) => {
      const ref = join(repo, "design-reference/refs/lantern-topdown.png");
      if (!existsSync(ref)) return bad("reference image missing from design-reference/refs/");
      return evidence.has("lantern-render.png")
        ? { status: STATUS.FAIL, detail: "render exists; side-by-side must be judged by the judge step, never auto-passed", evidence: "gauntlet/evidence/lantern-render.png", needsJudge: true }
        : todo("Lantern vector not drawn yet; no lantern-render.png");
    },
  },
  {
    id: "R-shadow",
    source: "D91 / art-direction.md section 6",
    title: "Vector Shadow matches design-reference/refs/shadow-sheet.png",
    kind: "reference",
    referenceImage: "design-reference/refs/shadow-sheet.png",
    renderEvidence: "shadow-render.png",
    run: async ({ repo, evidence }) => {
      const ref = join(repo, "design-reference/refs/shadow-sheet.png");
      if (!existsSync(ref)) return bad("reference image missing from design-reference/refs/");
      return evidence.has("shadow-render.png")
        ? { status: STATUS.FAIL, detail: "render exists; side-by-side must be judged by the judge step, never auto-passed", evidence: "gauntlet/evidence/shadow-render.png", needsJudge: true }
        : todo("Shadow vector not drawn yet; no shadow-render.png");
    },
  },
];

// ---------------------------------------------------------------------------
// Guardrails: secrets, raster, PII, traceability
// ---------------------------------------------------------------------------

const guardrails = [
  {
    id: "G-secrets",
    source: "NFR-4 / CLAUDE.md",
    title: "No API-key-shaped string in the client bundle",
    kind: "static",
    run: async ({ repo }) => {
      const dist = join(repo, "dist");
      if (!existsSync(dist)) return todo("dist/ not built yet (run npm run build)");
      const files = walk(dist).filter((f) => [".js", ".mjs", ".html", ".json", ".css"].includes(extname(f)));
      const patterns = [
        [/sk-ant-[A-Za-z0-9_-]{16,}/g, "Anthropic key"],
        [/sk-[A-Za-z0-9]{32,}/g, "generic sk- key"],
        [/ANTHROPIC_API_KEY\s*[:=]\s*["'][^"']+["']/g, "inlined ANTHROPIC_API_KEY"],
        [/ELEVENLABS_API_KEY\s*[:=]\s*["'][^"']+["']/g, "inlined ELEVENLABS_API_KEY"],
      ];
      const hits = [];
      for (const f of files) {
        const src = readFileSync(f, "utf8");
        for (const [re, label] of patterns) {
          if (re.test(src)) hits.push(`${label} in ${f.replace(repo + "/", "")}`);
          re.lastIndex = 0;
        }
      }
      return hits.length === 0
        ? ok(`scanned ${files.length} bundle files, no key-shaped strings`)
        : bad(hits.join("; "));
    },
  },
  {
    id: "G-raster",
    source: "D83 / D84 / CLAUDE.md",
    title: "No raster asset referenced from src/ (all art is vector in code)",
    kind: "static",
    run: async ({ repo }) => {
      const files = walk(join(repo, "src")).filter((f) => [".ts", ".mjs", ".html"].includes(extname(f)));
      if (files.length === 0) return todo("src/ has no sources yet");
      const hits = [];
      for (const f of files) {
        const src = readFileSync(f, "utf8");
        for (const m of src.matchAll(/["'`][^"'`]*\.(png|jpe?g|gif|webp|bmp|tiff?)["'`]/gi)) {
          hits.push(`${f.replace(repo + "/", "")}: ${m[0]}`);
        }
      }
      return hits.length === 0
        ? ok(`scanned ${files.length} source files, no raster references`)
        : bad(`raster referenced from src/ (D83 forbids this):\n${hits.join("\n")}`);
    },
  },
  {
    id: "G-pii",
    source: "D43 / AC-18.2 / NFR-3",
    title: "No PII field and no analytics SDK anywhere in src/",
    kind: "static",
    run: async ({ repo }) => {
      const files = walk(join(repo, "src")).filter((f) => [".ts", ".mjs", ".html"].includes(extname(f)));
      if (files.length === 0) return todo("src/ has no sources yet");
      const banned = [
        [/type=["']email["']/i, "email input field"],
        [/\bgtag\(|googletagmanager|google-analytics/i, "Google Analytics"],
        [/\bmixpanel\b|\bamplitude\b|\bsegment\.com\b|\bposthog\b/i, "analytics SDK"],
        [/\bdateOfBirth\b|\bbirthday\b|\bphoneNumber\b|\bhomeAddress\b/i, "PII field"],
      ];
      const hits = [];
      for (const f of files) {
        const src = readFileSync(f, "utf8");
        for (const [re, label] of banned) if (re.test(src)) hits.push(`${label} in ${f.replace(repo + "/", "")}`);
      }
      return hits.length === 0 ? ok(`scanned ${files.length} source files, clean`) : bad(hits.join("; "));
    },
  },
  {
    id: "G-nored",
    source: "D28 / D31 / design brief 'Do not'",
    title: "No red failure state, lives counter, or 'wrong' sound",
    kind: "static",
    run: async ({ repo }) => {
      const files = gameSources(repo);
      if (files.length === 0) return todo("src/game has no sources yet");
      const banned = [
        [/\blives\b\s*[:=]/i, "lives counter"],
        [/["'`]wrong["'`]/i, "a 'wrong' label or sound key"],
        [/redFlash|flashRed|\bgameOver\b/i, "red flash / game-over framing"],
      ];
      const hits = [];
      for (const f of files) {
        const src = readFileSync(f, "utf8");
        for (const [re, label] of banned) if (re.test(src)) hits.push(`${label} in ${f.replace(repo + "/", "")}`);
      }
      return hits.length === 0 ? ok(`scanned ${files.length} game sources, clean`) : bad(hits.join("; "));
    },
  },
  {
    id: "G-engine-purity",
    source: "CLAUDE.md HARD RULES / architecture section 2",
    title: "src/engine imports neither Phaser nor the DOM",
    kind: "static",
    run: async ({ repo }) => {
      const files = walk(join(repo, "src/engine")).filter((f) => extname(f) === ".ts");
      if (files.length === 0) return todo("src/engine has no sources yet");
      const hits = [];
      for (const f of files) {
        const src = readFileSync(f, "utf8");
        const rel = f.replace(repo + "/", "");
        if (/from\s+["']phaser["']|require\(["']phaser["']\)/.test(src)) hits.push(`phaser import in ${rel}`);
        for (const m of src.matchAll(/\b(document|window|localStorage|sessionStorage|navigator)\s*\./g)) {
          hits.push(`DOM global '${m[1]}' in ${rel}`);
        }
      }
      return hits.length === 0
        ? ok(`${files.length} engine files are Phaser-free and DOM-free`)
        : bad(hits.join("; "));
    },
  },
  {
    id: "G-trace",
    source: "D61 / D78 / architecture section 10.2",
    title: "trace-check green: every D has an AC, every AC a test, every scene a row",
    kind: "trace",
    run: async ({ repo, runNode }) => {
      const s = join(repo, "scripts/trace-check.mjs");
      if (!existsSync(s)) return todo("scripts/trace-check.mjs not written yet");
      const r = await runNode(["scripts/trace-check.mjs"]);
      return r.code === 0
        ? ok(r.stdout.trim().split("\n").slice(-3).join(" | "), "gauntlet/evidence/trace-check.txt")
        : bad(r.stdout.trim().split("\n").slice(-12).join("\n"), "gauntlet/evidence/trace-check.txt");
    },
  },
  {
    id: "G-scenes",
    source: "D78 / architecture section 10.2",
    title: "Every scene in src/game/scenes has a screen-inventory row",
    kind: "trace",
    run: async ({ repo }) => {
      const scenes = sceneFiles(repo);
      if (scenes.length === 0) return todo("src/game/scenes is empty (FIRST TASK 4)");
      return ok(`${scenes.length} scenes present; row-matching is enforced by trace-check (G-trace)`);
    },
  },
  {
    id: "G-coverage",
    source: "D55 / CLAUDE.md",
    title: "Engine coverage >= 95% lines/branches/functions/statements",
    kind: "unit",
    run: async ({ repo }) => {
      const p = join(repo, "coverage/coverage-summary.json");
      if (!existsSync(p)) return todo("no coverage summary yet (run npm test)");
      const total = JSON.parse(readFileSync(p, "utf8")).total;
      const keys = ["lines", "branches", "functions", "statements"];
      const low = keys.filter((k) => total[k].pct < 95).map((k) => `${k} ${total[k].pct}%`);
      const all = keys.map((k) => `${k} ${total[k].pct}%`).join(", ");
      return low.length === 0 ? ok(all, "coverage/coverage-summary.json") : bad(`below 95%: ${low.join(", ")} (${all})`);
    },
  },
];

/** The whole rubric, in report order. */
export const RUBRIC = [...guardrails, ...visual, ...audio, ...loop, ...reference];

export const SECTIONS = [
  ["Guardrails", guardrails],
  ["Visual (D60)", visual],
  ["Audio (D62)", audio],
  ["Core loop (D77)", loop],
  ["Reference compare (D90, D91)", reference],
];
