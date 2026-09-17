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


/**
 * A file may opt out of ONE vocabulary check with a comment:
 *
 *   // @gauntlet-allow G-pii  (this file defines the banned key list)
 *
 * Needed because the guard files themselves must name the forbidden things.
 * The opt-out is never silent: the runner prints every waiver in the report,
 * so a waiver is a visible claim someone has to defend, not a way to make a
 * check quietly stop meaning anything.
 */

/**
 * Strip comments so a vocabulary check reads code, not prose about code.
 * A doc comment that says "no birthday, no contact field of any kind" is a
 * PROMISE not to store PII; flagging it as PII inverts the check's meaning and
 * trains people to ignore it. String literals are deliberately KEPT: a literal
 * "email" in code usually is a field name.
 */

/**
 * Judge verdicts (architecture 10.1 step 4). A reference-compare item cannot be
 * auto-passed; it passes only when an agent has opened both images and written
 * a verdict here citing the render and the round.
 *
 * The verdict is bound to the BYTES of the render it judged. Re-render the art
 * and the verdict stops applying, because the thing that was judged no longer
 * exists. That is what stops a stale pass from outliving the work it approved.
 */
function judgeVerdict(repo, id, renderPath) {
  const p = join(repo, "gauntlet/judge-verdicts.json");
  if (!existsSync(p)) return null;
  let all;
  try {
    all = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
  const v = all[id];
  if (!v || v.verdict !== "pass") return null;
  const abs = join(repo, renderPath);
  if (!existsSync(abs)) return null;
  const bytes = statSync(abs).size;
  // Tolerance, not equality. PNG encoding is not byte-deterministic: the same
  // art re-rendered moved 8 bytes on 167KB (0.005%), which is an encoder
  // hiccup, while a genuine redraw moved 2.1%. A byte-exact rule cannot tell
  // those apart and would force a re-judge on every run, which trains the
  // judge to rubber-stamp. 1% is comfortably above observed encoder noise and
  // far below any change a person would call a redraw.
  const STALE_TOLERANCE = 0.01;
  if (typeof v.renderBytes === "number") {
    const drift = Math.abs(bytes - v.renderBytes) / v.renderBytes;
    if (drift > STALE_TOLERANCE) {
      return { stale: true, judgedBytes: v.renderBytes, currentBytes: bytes, drift };
    }
  }
  return { ...v, bytes };
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function waives(src, checkId) {
  return new RegExp(`@gauntlet-allow\\s+${checkId}\\b`).test(src);
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
    // AC-22.1 is declared "U (config) + V (debug overlay)". Those are two
    // different claims with two different evidence artifacts, and collapsing
    // them let a config scan claim a visual pass. Split, per the PRD's own
    // wording.
    id: "V-22.1a",
    source: "D60#1 / AC-22.1 (config half)",
    title: "At least 5 parallax layers at distinct scroll speeds",
    kind: "static",
    run: async ({ repo }) => {
      const cfg = join(repo, "src/game/render/layers.ts");
      if (!existsSync(cfg)) return todo("src/game/render/layers.ts does not exist yet");
      const src = readFileSync(cfg, "utf8");
      const speeds = [...src.matchAll(/speed:\s*([0-9.]+)/g)].map((m) => Number(m[1]));
      // Count DISTINCT SCROLLING speeds. sky and hud are pinned at 0, and
      // debris and shipFx share 1.0 by design (art-direction s2) because the
      // rocks and the Lantern occupy one gameplay plane. Demanding
      // all-distinct would fail correct art.
      const scrolling = speeds.filter((v) => v > 0);
      const distinct = new Set(scrolling);
      return distinct.size >= 5
        ? ok(`${scrolling.length} scrolling layers, ${distinct.size} distinct speeds: ${[...distinct].sort((a, b) => a - b).join(", ")}`)
        : bad(`found ${distinct.size} distinct scrolling speeds; need >=5`);
    },
  },
  {
    id: "V-22.1b",
    source: "D60#1 / AC-22.1 (visual half)",
    title: "Layer-debug overlay shows the five speeds actually moving",
    kind: "visual",
    needsBrowser: true,
    // READS THE FLIGHT CAPTURE BY NAME, and checks it says so.
    //
    // This used to read `parallax-overlay.json`, which BOTH `flight.spec.ts` and
    // `title.spec.ts` wrote. The Title one measured "did the layer move at all",
    // which is not this item's claim, and it is the one that survived the race -
    // so "five speeds actually moving" was certified by a capture that never
    // measured a speed. Two changes make that impossible: the artifact is
    // scene-qualified, and the key asserted is `distinctRates`, which the weaker
    // capture does not emit at all.
    run: async ({ evidence }) => {
      if (!evidence.has("parallax-overlay-flight.json")) {
        return todo("Flight scene not built; no parallax-overlay-flight.json evidence");
      }
      const data = evidence.read("parallax-overlay-flight.json");
      if (data.scene !== "Flight") {
        return bad(
          `parallax-overlay-flight.json was captured from "${data.scene}", not Flight`,
          evidence.path("parallax-overlay-flight.json"),
        );
      }
      return evidence.assertNumber(
        "parallax-overlay-flight.json", "distinctRates", (v) => v >= 5,
        "layers observed moving at DISTINCT rates in the Flight debug overlay");
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
    // MEASURES THE OBJECTS, NOT THE FRAME.
    //
    // This used to assert that a desaturated frame contained between 3 and 60
    // connected regions, on an evidence file whose entire content was
    // `{"contours": 14}`. A region count cannot fail for the reason AC-22.4
    // exists: it says nothing about whether any of those regions IS a rock, and
    // a frame in which every asteroid had dissolved into the terrain would
    // still score a dozen contours off the terrain alone.
    //
    // `desaturated-silhouettes.json` measures, per rock and for the ship, the
    // luminance gap between the object and a ring just outside it. An object
    // that has dissolved into its background scores zero there whatever the
    // rest of the frame is doing.
    run: async ({ evidence }) => {
      if (!evidence.has("desaturated-silhouettes.json")) {
        return todo("Flight scene not built; no desaturated-silhouettes.json evidence");
      }
      const data = evidence.read("desaturated-silhouettes.json");
      // Anti-vacuity: a capture that measured one object is a capture of an
      // empty sky, and its minimum is meaningless.
      if (!(data.objectsMeasured >= 3)) {
        return bad(
          `only ${data.objectsMeasured} object(s) measured; the belt was empty`,
          evidence.path("desaturated-silhouettes.json"),
        );
      }
      return evidence.assertNumber(
        "desaturated-silhouettes.json", "minSeparation", (v) => v > 0.06,
        `weakest object/background luminance separation across ${data.objectsMeasured} objects, desaturated`);
    },
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
    needsBrowser: true,
    run: async ({ evidence }) => {
      // Two things are drawn on the plate: the untyped word in plateText, and
      // the letters ALREADY TYPED in the accent. This check only ever measured
      // the first pair, so it reported 18.08 while typed letters sat at 1.02:1
      // on two stops in colourblind mode - invisible, for the accessibility
      // setting. A contrast check that skips the colour the child is actually
      // reading is not a contrast check.
      // MEASURED BY THE GAME, NOT BY THIS FILE.
      //
      // This used to read `src/content/palettes.json` and check
      // `colorblind.plateAccent`. That field was read by NOTHING ELSE IN THE
      // REPO: `palette.ts` drew `colorblind.accent`, which on Saturn and Pluto
      // is a near-black (#111318) chosen to separate from an ivory sky. On the
      // plate (#0E1116) it is 1.02:1. This check reported 6.71:1 the whole time,
      // and it was not wrong - it was measuring a different colour from the one
      // a child was looking at.
      //
      // `contrast.json` is now written by `flight.spec.ts` from `paletteAt()` -
      // the function the scenes actually call - across both palette modes and
      // both letter states. A palette field that no renderer consumes cannot
      // satisfy it, because the number never passes through this file.
      if (!evidence.has("contrast.json")) {
        return todo("no contrast.json evidence; run the e2e suite");
      }
      const data = evidence.read("contrast.json");
      const rows = Array.isArray(data.rows) ? data.rows : [];
      // Seven stops x {normal, colourblind} x {resting, typed}. Asserted rather
      // than trusted: a capture that silently stopped covering colourblind mode
      // is exactly how the original defect hid.
      if (rows.length !== 28) {
        return bad(
          `contrast.json has ${rows.length} samples; expected 28 (7 stops x 2 modes x 2 letter states)`,
          evidence.path("contrast.json"),
        );
      }
      const modes = new Set(rows.map((r) => r.mode));
      const roles = new Set(rows.map((r) => r.role));
      if (!modes.has("colourblind") || !roles.has("typed")) {
        return bad(
          `contrast.json does not cover the typed letter in colourblind mode (modes: ${[...modes].join(", ")}; roles: ${[...roles].join(", ")})`,
          evidence.path("contrast.json"),
        );
      }
      const failing = rows.filter((r) => !(r.ratio >= 4.5));
      if (failing.length) {
        return bad(
          `below 4.5:1 - ${failing.map((r) => `${r.stop} ${r.mode} ${r.role} ${r.ratio}:1`).join(", ")}`,
          evidence.path("contrast.json"),
        );
      }
      const worst = rows.reduce((a, b) => (b.ratio < a.ratio ? b : a));
      return ok(
        `worst contrast ${worst.ratio}:1 (${worst.stop}, ${worst.mode}, ${worst.role}) across ${rows.length} samples read back from paletteAt()`,
        evidence.path("contrast.json"),
      );
    },
  },
  {
    id: "P-22.9",
    source: "D60#9 / AC-22.9 / NFR-1",
    title: "60 fps: p95 frame time <= 16.7 ms over a 60 s scripted flight",
    kind: "perf",
    needsBrowser: true,
    run: async ({ evidence }) => {
      if (!evidence.has("frametime.json")) {
        return todo("Flight scene not built; no frametime.json evidence");
      }
      const d = evidence.read("frametime.json");
      // AC-22.9 is a claim about FRAME RATE, so the measurement that settles it
      // is the frame INTERVAL, not the work done inside a frame. Those diverge
      // badly: a first capture reported p95Ms 3.5 (per-frame work) alongside
      // observedFps 3.4 and a p95 interval of 416ms. Reading only p95Ms passed
      // a game rendering 204 frames in 60 seconds as 60fps.
      const work = d["p95Ms"];
      const interval = d["p95FrameIntervalMs"];
      const fps = d["observedFps"];
      const method = String(d["method"] ?? "");
      const ev = "gauntlet/evidence/frametime.json";

      if (typeof interval !== "number" || typeof fps !== "number") {
        return bad("frametime.json must report p95FrameIntervalMs and observedFps; per-frame work alone cannot settle a frame-rate claim", ev);
      }
      // A headless capture cannot demonstrate 60fps: headless Chromium has been
      // measured driving this game at ~3-12fps regardless of how cheap the
      // frame is, so it measures the harness. See escalations.md "AC-22.9".
      if (/headless/i.test(method)) {
        return bad(`captured headless (${fps.toFixed(1)} fps observed) - headless Chromium cannot demonstrate 60fps; re-capture headed`, ev);
      }
      if (interval > 16.7) {
        return bad(`p95 frame interval ${interval.toFixed(1)}ms exceeds 16.7ms (observed ${fps.toFixed(1)} fps)`, ev);
      }
      if (typeof work === "number" && work > 16.7) {
        return bad(`p95 per-frame work ${work.toFixed(1)}ms exceeds 16.7ms`, ev);
      }
      return ok(`p95 frame interval ${interval.toFixed(1)}ms at ${fps.toFixed(1)} fps; per-frame work ${typeof work === "number" ? work.toFixed(1) : "n/a"}ms`, ev);
    },
  },
];

// ---------------------------------------------------------------------------
// Audio rubric (D62, D63, D88, PRD section 3.9)
// ---------------------------------------------------------------------------

/**
 * WHY EVERY AUDIO ITEM NOW READS TWO ARTIFACTS.
 *
 * `audio-graph.json` is produced by `buildAudioEvidence`, which builds a graph
 * on a null context INSIDE A UNIT TEST. Every number in it is honestly
 * measured, and not one of them can tell the difference between an audio system
 * the game plays through and an audio system nothing imports. That distinction
 * is not academic: A-21.1 .. A-21.5 were all green while `createAudioSystem()`
 * had no caller outside its own test, `SettingsScene` read a registry key
 * nobody wrote, and `FLIGHT_EVENTS.cue` was emitted to zero listeners
 * (audit.md 1.2). Five items certified a subsystem that was not in the product.
 *
 * A check that cannot distinguish "built" from "connected" is not a check. So
 * each item below now asserts BOTH halves and passes only on both:
 *
 *   BUILT    audio-graph.json   the sound is correctly made      (unchanged)
 *   WIRED    audio-wiring.json  the running game makes it        (new)
 *
 * `audio-wiring.json` is produced by `tests/e2e/audio-wiring.spec.ts` against a
 * REAL `bootGame()` in a browser. Nothing in it can be produced by a table: the
 * per-event `via` tags are written by the game code that made each call
 * ("flight-cue:blast", "ui:nav", "warp-scene:jump", "beacon-scene:lit"), the
 * ambient and music numbers come from real scene transitions and real HUD
 * snapshots, and the context names itself so a null one cannot pass as real.
 *
 * NOTHING IN THE BUILT HALF WAS WEAKENED. Every original predicate is below,
 * verbatim; the wiring predicate is an ADDITIONAL gate. Deleting
 * audio-wiring.json therefore cannot turn any of these green again - it turns
 * them `not-implemented`, which is the truth about a silent game.
 */

const GRAPH_ARTIFACT = "audio-graph.json";
const WIRING_ARTIFACT = "audio-wiring.json";

/** The ten events AC-21.3 names, in the PRD's order. */
const AUDIO_EVENTS = [
  "lock", "keystroke", "typo", "blast", "hit",
  "shield", "warpCharge", "warp", "beacon", "uiNav",
];

/**
 * The gate every audio item shares: a real boot produced a real audio system,
 * published where scenes look for it, and the game is stepping it.
 *
 * `contextKind` is the load-bearing field. `buildAudioEvidence` runs on a
 * `NullAudioContext` and says so; a browser says "AudioContext". An artifact
 * that reports the null context has measured a graph, not a game.
 */
function bootedAudio(w) {
  const b = w?.boot ?? {};
  return (
    b.onServices === true &&
    b.onRegistry === true &&
    b.registryKey === "kb.audio" &&
    typeof b.contextKind === "string" &&
    b.contextKind !== "NullAudioContext" &&
    /AudioContext/.test(b.contextKind) &&
    Array.isArray(b.buses) &&
    b.buses.includes("master") &&
    // The graph is being advanced by the game's own frame loop, not by a test.
    Number(b.framesAfterASecond ?? 0) > Number(b.framesAdvanced ?? 0)
  );
}

/**
 * Build an audio item that must satisfy the BUILT predicate on the graph
 * artifact and the WIRED predicate on the wiring artifact. Reports both paths,
 * so a pass always cites the evidence for both claims (D85).
 */
function audioItem({ built, builtWhat, wired, wiredWhat }) {
  return async ({ repo, evidence }) => {
    if (!existsSync(join(repo, "src/game/audio"))) {
      return todo("src/game/audio does not exist yet");
    }
    if (!evidence.has(GRAPH_ARTIFACT)) return todo("no audio-graph.json evidence yet");
    if (!evidence.has(WIRING_ARTIFACT)) {
      return todo(
        "no audio-wiring.json evidence yet - the graph is built, but nothing " +
        "shows the GAME plays it. Run `npx playwright test tests/e2e/audio-wiring.spec.ts`.",
      );
    }

    const builtResult = evidence.assertShape(GRAPH_ARTIFACT, built, `built: ${builtWhat}`);
    if (builtResult.status !== STATUS.PASS) return builtResult;

    const both = `${evidence.path(GRAPH_ARTIFACT)} + ${evidence.path(WIRING_ARTIFACT)}`;
    const w = evidence.read(WIRING_ARTIFACT);
    if (!bootedAudio(w)) {
      return {
        status: STATUS.FAIL,
        detail:
          `built: ${builtWhat} — but audio-wiring.json does not show a real boot ` +
          "producing a live audio system on a real AudioContext, published on " +
          "kb.services.audio and registry kb.audio and advanced every frame",
        evidence: both,
      };
    }

    let passed = false;
    try {
      passed = wired(w) === true;
    } catch {
      passed = false;
    }
    return {
      status: passed ? STATUS.PASS : STATUS.FAIL,
      detail: `built: ${builtWhat}; wired: ${wiredWhat}`,
      evidence: both,
    };
  };
}

const audio = [
  {
    id: "A-21.1",
    source: "D62 / AC-21.1",
    title: "Per-planet ambient bed exists, crossfades, and follows the running game",
    kind: "audio",
    needsBrowser: true,
    run: audioItem({
      built: (g) =>
        Array.isArray(g.ambientBeds) && g.ambientBeds.length === 7 && g.crossfade === true,
      builtWhat: "seven ambient beds with crossfade enabled",
      // The bed changed because the GAME changed stop. Two distinct stops in
      // order, with a crossfade counted at the transition - a table cannot
      // produce this, only a scene transition can.
      wired: (w) => {
        const stops = w?.ambient?.stops;
        return (
          Array.isArray(stops) &&
          new Set(stops).size >= 2 &&
          Number(w.ambient.crossfades ?? 0) >= 1 &&
          w.ambient.crossfadedOnSceneTransition === true
        );
      },
      wiredWhat: "the bed followed a real scene transition and crossfaded",
    }),
  },
  {
    id: "A-21.2",
    source: "D62 / AC-21.2",
    title: "Music has >= 3 intensity layers driven by live asteroids and combo",
    kind: "audio",
    needsBrowser: true,
    run: audioItem({
      built: (g) => (g.musicLayers ?? 0) >= 3,
      builtWhat: "music intensity layer count",
      // Fed by the real HUD stream, and the index actually MOVED. An index that
      // never leaves 0 is a graph nobody is driving.
      wired: (w) => {
        const m = w?.music ?? {};
        return (
          Number(m.hudSamples ?? 0) > 0 &&
          Array.isArray(m.indicesObserved) &&
          m.indicesObserved.length >= 2 &&
          typeof m.drivenBy === "string" &&
          /hud/i.test(m.drivenBy)
        );
      },
      wiredWhat: "the index moved on live HUD liveCount/combo during real play",
    }),
  },
  {
    id: "A-21.3",
    source: "D62 / AC-21.3",
    title: "All ten events have >= 3 SFX variants, rotate, and are reached by game code",
    kind: "audio",
    needsBrowser: true,
    run: audioItem({
      built: (g) => {
        const v = g.sfxVariants ?? {};
        return AUDIO_EVENTS.every((e) => (v[e] ?? 0) >= 3) && g.noConsecutiveRepeat === true;
      },
      builtWhat: ">=3 variants for all ten named events, with rotation",
      /**
       * Every one of the ten was PLAYED during a real session, and each carries
       * the call-site tag the game code that played it wrote. The tags are
       * checked for shape too: a play whose only provenance is "test" would be
       * the same hole in a different place.
       */
      wired: (w) => {
        const events = w?.events ?? {};
        return AUDIO_EVENTS.every((e) => {
          const entry = events[e];
          if (!entry || Number(entry.count ?? 0) <= 0) return false;
          const via = Array.isArray(entry.via) ? entry.via : [];
          return (
            via.length > 0 &&
            via.every((v) => typeof v === "string" && v.length > 0 && !/^test/i.test(v))
          );
        });
      },
      wiredWhat: "all ten played in a real session, each tagged with its game call site",
    }),
  },
  {
    id: "A-21.4",
    source: "D62 / AC-21.4",
    title: "Music ducks by >= 6 dB while Shadow speaks, on the live graph",
    kind: "audio",
    needsBrowser: true,
    run: audioItem({
      built: (g) => typeof g.duckDb === "number" && g.duckDb <= -6,
      builtWhat: "gain reduction applied to Music/Ambient under the Voice bus",
      /**
       * The same reduction, measured on the graph the running game is playing
       * through, by driving its ducker and sampling the real `AudioParam` after
       * the ramp. A real param is float32, so an exactly-scheduled -6.000000 dB
       * reads back as -5.9999999; the tolerance below is that rounding and
       * nothing else - the float64 measurement above still requires <= -6
       * exactly. It must also come back: a duck that never releases is a bug
       * the player only meets later.
       */
      wired: (w) => {
        const d = w?.duck ?? {};
        const slop = typeof d.float32SlopDb === "number" ? d.float32SlopDb : 1e-3;
        const perBus = d.reductionDb ?? {};
        const buses = Object.keys(perBus);
        return (
          d.measuredOnLiveGraph === true &&
          buses.includes("music") &&
          buses.includes("ambient") &&
          buses.every((b) => Number(perBus[b]) <= -6 + slop) &&
          d.releasedToResting === true &&
          Array.isArray(w?.voice?.spokenLines) &&
          w.voice.spokenLines.length > 0
        );
      },
      wiredWhat: "the live graph ducked >= 6 dB and released, with lines really spoken",
    }),
  },
  {
    id: "A-21.5",
    source: "D88 / AC-21.5",
    title: "Shadow speaks via Web Speech system voice; zero network TTS at runtime",
    kind: "audio",
    needsBrowser: true,
    run: audioItem({
      built: (g) => g.voiceTransport === "webspeech" && g.runtimeTtsNetworkCalls === 0,
      builtWhat: "system voice stand-in with no runtime TTS network calls (D88)",
      /**
       * The static and unit halves prove nothing CALLS a network TTS. This
       * proves a whole real session made no external request at all - measured
       * by the browser, not by a probe the code could route around - while the
       * game really did hand lines to the voice bus.
       *
       * The TRANSPORT is deliberately not re-asserted here. Headless Chromium
       * ships no speech synthesis, so a real player's transport cannot be
       * observed in CI; `browserSpeechApiPresent` records that fact so "silent"
       * in this artifact reads as D88's fallback working rather than as a gap.
       * Which transport a machine WITH voices gets is settled by audio-graph.json
       * above, where the platform voice list is injected.
       */
      wired: (w) => {
        const n = w?.network ?? {};
        return (
          Array.isArray(n.externalRequests) &&
          n.externalRequests.length === 0 &&
          Number(n.ttsNetworkCalls ?? -1) === 0 &&
          Number(n.linesSpokenDuringSession ?? 0) > 0 &&
          typeof w?.voice?.browserSpeechApiPresent === "boolean"
        );
      },
      wiredWhat: "a real session spoke lines and made zero external network requests",
    }),
  },
  {
    id: "A-21.6",
    source: "D88 / AC-21.6",
    title: "Coach notes are spoken after the text renders, display identical either way",
    kind: "audio",
    needsBrowser: true,
    run: async ({ evidence }) => {
      if (!evidence.has(WIRING_ARTIFACT)) {
        return todo("no audio-wiring.json evidence yet; run tests/e2e/audio-wiring.spec.ts");
      }
      return evidence.assertShape(
        WIRING_ARTIFACT,
        (w) => {
          const c = w?.coachNote ?? {};
          return (
            Array.isArray(c.order) &&
            c.order.join(">") === "text>speech" &&
            typeof c.textRendered === "string" &&
            c.textRendered.length > 0 &&
            // The display carries the text and NOTHING a renderer could branch
            // on, which is what makes "identical with or without speech"
            // structural rather than promised.
            Array.isArray(c.displayFields) &&
            c.displayFields.join(",") === "text" &&
            Array.isArray(c.spoken) &&
            c.spoken.some((s) => s?.kind === "coachNote")
          );
        },
        "the real warp screen rendered the note, then spoke it",
      );
    },
  },
  {
    id: "A-21.8",
    source: "audit.md 1.2 / AC-19.1 / AC-6e.2",
    title: "The game is audible: cues reach the bus, sliders move it, silence never crashes",
    kind: "audio",
    needsBrowser: true,
    run: async ({ evidence }) => {
      if (!evidence.has(WIRING_ARTIFACT)) {
        return todo("no audio-wiring.json evidence yet; run tests/e2e/audio-wiring.spec.ts");
      }
      const w = evidence.read(WIRING_ARTIFACT);
      const ev = evidence.path(WIRING_ARTIFACT);
      const problems = [];

      // AC-6e.2: a real keystroke produced a scheduled sound, one per cue.
      const f = w.flightCue ?? {};
      if (!(Number(f.sfxPlaysAfter ?? 0) > Number(f.sfxPlaysBefore ?? 0))) {
        problems.push("no sound was scheduled by a real flight cue");
      }
      if (!(Number(f.keystrokeCues ?? 0) > 0 && f.keystrokePlays === f.keystrokeCues)) {
        problems.push("keystroke cues and keystroke sounds do not match one for one");
      }
      const scheduled = Array.isArray(f.scheduled) ? f.scheduled : [];
      if (!scheduled.some((p) => Number(p?.peakGain) > 0 && String(p?.via ?? "").startsWith("flight-cue:"))) {
        problems.push("no scheduled play carries a flight-cue call site and a non-zero gain");
      }

      // It came out of the master bus: an AnalyserNode on the live graph.
      if (!(w.uiNav?.audible === true && Number(w.uiNav?.masterRmsPeak ?? 0) > 0)) {
        problems.push("the master bus carried no signal while the game played");
      }

      // AC-19.1: the sliders move the real gains, in the right direction.
      const s = w.settings ?? {};
      if (s.musicGainFollowedSlider !== true || s.sfxGainFollowedSlider !== true) {
        problems.push("a settings volume slider did not move its bus gain");
      }
      if (s.mutedSurvived !== true) problems.push("a muted game did not survive a burst of cues");

      // D88 / graceful degradation: no Web Audio at all is silence, not a crash.
      const n = w.noAudioContext ?? {};
      if (n.contextKind !== "NullAudioContext" || n.degradedSilently !== true) {
        problems.push("the game did not degrade silently with no AudioContext");
      }

      return problems.length === 0
        ? ok(
            `real cues scheduled ${scheduled.length} sounds, master RMS ${Number(w.uiNav.masterRmsPeak).toFixed(4)}, ` +
            "sliders moved both bus gains, muted and context-less runs both survived",
            ev,
          )
        : bad(problems.join("; "), ev);
    },
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
    run: async ({ evidence }) => {
      if (!evidence.has("input-latency.json")) {
        return todo("Flight scene not built; no input-latency.json evidence");
      }
      const d = evidence.read("input-latency.json");
      const ev = "gauntlet/evidence/input-latency.json";
      const method = String(d["method"] ?? "");
      // THE SAME DISEASE P-22.9 HAD, shipped one item further down the file.
      // "keydown to the first postrender that follows" measures how long the
      // RENDER took, not how long the player waited. The player waits for the
      // next frame. In a harness whose p95 frame interval is 144.7 ms, a 5.1 ms
      // answer is measuring the wrong clock - and AC-6e.1 is a claim about what
      // the child perceives (D77: "responsive = input-to-visual <= 1 frame").
      if (/headless/i.test(method)) {
        return bad("captured headless - at a 144.7ms p95 frame interval, keydown-to-postrender measures render cost, not perceived latency. Re-capture headed, and report the keydown-to-next-presented-frame delta.", ev);
      }
      if (typeof d["p95FrameIntervalMs"] !== "number") {
        return bad("must report p95FrameIntervalMs alongside p95Ms: a latency figure smaller than the frame interval is measuring the render, not the wait", ev);
      }
      return evidence.assertNumber("input-latency.json", "p95Ms", (v) => v <= 16.7,
        "p95 keydown-to-presented-frame latency");
    },
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
    id: "R-world",
    source: "D59 / D60 / art-direction.md section 0",
    title: "The flight screen has a named visual reference to be judged against",
    kind: "reference",
    referenceImage: "design-reference/refs/world-bar.png",
    renderEvidence: "flight-frame.png",
    run: async ({ repo, evidence }) => {
      // WHY THIS ITEM EXISTS. D59 names Alto's Odyssey as the visual bar, and
      // nothing in this rubric ever compared a screenshot to it. The
      // reference-compare step iterates over files PRESENT in
      // design-reference/refs/, so a missing reference meant a missing check -
      // silently. R-lantern and R-shadow exist only because the user supplied
      // those two PNGs, and they are the two things in the game that look
      // right. That is not a coincidence.
      //
      // The world art was therefore judged only against proxies - five layers
      // at distinct speeds, a gradient that shifts, a contour count - every one
      // of which passes on a flat brown screen. A rubric can falsify ugliness.
      // It cannot certify beauty. Only a side-by-side can.
      const ref = join(repo, "design-reference/refs/world-bar.png");
      if (!existsSync(ref)) {
        return bad(
          "no world reference image. D59 names Alto's Odyssey as the bar; put one or more screenshots at design-reference/refs/world-bar.png so the flight screen can be judged against it the way the Lantern and Shadow were.",
        );
      }
      if (!evidence.has("flight-frame.png")) {
        return todo("world reference present; no flight-frame.png render to compare yet");
      }
      const v = judgeVerdict(repo, "R-world", "gauntlet/evidence/flight-frame.png");
      if (!v) {
        return bad(
          "flight frame and reference both exist but no judge verdict recorded - a reference compare is never auto-passed (D85)",
          "gauntlet/evidence/flight-frame.png",
        );
      }
      if (v.stale) {
        return bad(`judge verdict is stale (${(v.drift * 100).toFixed(1)}% drift). Re-judge.`, "gauntlet/evidence/flight-frame.png");
      }
      return ok(`judged round ${v.round}: ${v.basis}`, "gauntlet/judge-notes.md");
    },
  },
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
      if (!evidence.has("lantern-render.png")) return todo("Lantern vector not drawn yet; no lantern-render.png");
      const v = judgeVerdict(repo, "R-lantern", "gauntlet/evidence/lantern-render.png");
      if (!v) return { status: STATUS.FAIL, detail: "render exists but no judge verdict recorded; a reference compare is never auto-passed (D85)", evidence: "gauntlet/evidence/lantern-render.png" };
      if (v.stale) return { status: STATUS.FAIL, detail: `judge verdict is stale: approved a ${v.judgedBytes}-byte render, current is ${v.currentBytes} (${(v.drift * 100).toFixed(1)}% drift). Re-judge.`, evidence: "gauntlet/evidence/lantern-render.png" };
      return ok(`judged round ${v.round}: ${v.basis}${v.residual ? " | residual: " + v.residual : ""}`, "gauntlet/judge-notes.md");
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
      if (!evidence.has("shadow-render.png")) return todo("Shadow vector not drawn yet; no shadow-render.png");
      const v = judgeVerdict(repo, "R-shadow", "gauntlet/evidence/shadow-render.png");
      if (!v) return { status: STATUS.FAIL, detail: "render exists but no judge verdict recorded; a reference compare is never auto-passed (D85)", evidence: "gauntlet/evidence/shadow-render.png" };
      if (v.stale) return { status: STATUS.FAIL, detail: `judge verdict is stale: approved a ${v.judgedBytes}-byte render, current is ${v.currentBytes} (${(v.drift * 100).toFixed(1)}% drift). Re-judge.`, evidence: "gauntlet/evidence/shadow-render.png" };
      return ok(`judged round ${v.round}: ${v.basis}${v.residual ? " | residual: " + v.residual : ""}`, "gauntlet/judge-notes.md");
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
      // A secrets scan of a STALE bundle is worse than no scan: it reports
      // clean for a build that predates the code it claims to have checked.
      // This dist/ was a 12KB scaffold from before the game existed, and the
      // check had been passing on it all night.
      const newestSrc = Math.max(
        ...walk(join(repo, "src")).map((f) => statSync(f).mtimeMs),
        ...(existsSync(join(repo, "api")) ? walk(join(repo, "api")).map((f) => statSync(f).mtimeMs) : [0]),
      );
      const newestDist = Math.max(...walk(dist).map((f) => statSync(f).mtimeMs), 0);
      if (newestDist < newestSrc) {
        return bad(`dist/ is older than src/ (built ${new Date(newestDist).toISOString()}, newest source ${new Date(newestSrc).toISOString()}) - scanning a stale bundle. Run npm run build.`);
      }
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
        // Comments stripped, string literals kept: the thing this check exists
        // to catch IS a string literal (load.image("ship.png")), while a doc
        // comment using one as an EXAMPLE of what not to do is not a raster
        // dependency. Same rule as G-pii and G-nored.
        const src = stripComments(readFileSync(f, "utf8"));
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
        // Match these as MODULE IMPORTS or SDK calls, not as bare words.
        // "amplitude" is ordinary vocabulary for an oscillation - Shadow's
        // glow pulse and the strike shake both have one - and "segment" is a
        // line segment. Banning the words bans the domain.
        [/from\s+["'][^"']*(mixpanel|amplitude|posthog|segment)[^"']*["']|require\(["'][^"']*(mixpanel|amplitude|posthog|segment)[^"']*["']\)|\b(mixpanel|posthog)\s*\.\s*(init|track|identify)\b|\bamplitude\s*\.\s*(init|track|getInstance)\b|segment\.com/i, "analytics SDK"],
        [/\bdateOfBirth\b|\bbirthday\b|\bphoneNumber\b|\bhomeAddress\b/i, "PII field"],
      ];
      const hits = [];
      const waived = [];
      for (const f of files) {
        const src = readFileSync(f, "utf8");
        const rel = f.replace(repo + "/", "");
        if (waives(src, "G-pii")) { waived.push(rel); continue; }
        const code = stripComments(src);
        for (const [re, label] of banned) if (re.test(code)) hits.push(`${label} in ${rel}`);
      }
      const note = waived.length ? ` (waived: ${waived.join(", ")})` : "";
      return hits.length === 0
        ? ok(`scanned ${files.length - waived.length} source files, clean${note}`)
        : bad(hits.join("; ") + note);
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
      const waived = [];
      for (const f of files) {
        const src = readFileSync(f, "utf8");
        const rel = f.replace(repo + "/", "");
        if (waives(src, "G-nored")) { waived.push(rel); continue; }
        const code = stripComments(src);
        for (const [re, label] of banned) if (re.test(code)) hits.push(`${label} in ${rel}`);
      }
      const note = waived.length ? ` (waived: ${waived.join(", ")})` : "";
      return hits.length === 0
        ? ok(`scanned ${files.length - waived.length} game sources, clean${note}`)
        : bad(hits.join("; ") + note);
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
      const GLOBALS = ["document", "window", "localStorage", "sessionStorage", "navigator"];
      for (const f of files) {
        const raw = readFileSync(f, "utf8");
        const rel = f.replace(repo + "/", "");
        if (/from\s+["']phaser["']|require\(["']phaser["']\)/.test(raw)) {
          hits.push(`phaser import in ${rel}`);
        }
        // Strip comments and string literals first. A doc comment explaining
        // "the real localStorage adapter lives in src/game" is not a DOM
        // dependency, and flagging it teaches people to stop reading the check.
        const src = raw
          .replace(/\/\*[\s\S]*?\*\//g, " ")
          .replace(/\/\/[^\n]*/g, " ")
          .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
        for (const g of GLOBALS) {
          // A local binding of the same name is not the global. The controller
          // legitimately owns a rolling `window` of outcomes (arch 4.3), and
          // banning the word would ban the domain's own vocabulary.
          const declared = new RegExp(
            `(?:const|let|var|function|class|interface|type)\\s+${g}\\b` +
            `|\\b${g}\\s*:` +
            `|\\(\\s*(?:[^)]*,\\s*)?${g}\\s*[:,)]`,
          ).test(src);
          if (declared) continue;
          if (new RegExp(`(?<![.\\w$])${g}\\s*\\.`).test(src)) {
            hits.push(`DOM global '${g}' in ${rel}`);
          }
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
    id: "G-one-shadow",
    source: "D91 / AC-25.1 / D83",
    title: "Exactly one drawShadow and one drawLantern implementation",
    kind: "static",
    run: async ({ repo }) => {
      const files = walk(join(repo, "src/game")).filter((f) => extname(f) === ".ts");
      if (files.length === 0) return todo("src/game has no sources yet");
      const problems = [];
      for (const [fn, what] of [["drawShadow", "Shadow"], ["drawLantern", "Lantern"]]) {
        const impls = files.filter((f) =>
          new RegExp(`export\\s+function\\s+${fn}\\b`).test(stripComments(readFileSync(f, "utf8"))),
        );
        if (impls.length > 1) {
          problems.push(
            `${impls.length} ${what} implementations: ${impls.map((f) => f.replace(repo + "/", "")).join(", ")}`,
          );
        }
      }
      // WHY THIS CHECK EXISTS. R-shadow judged ONE render and passed it. Four
      // menu scenes were drawing a second, unjudged Shadow - so the passing
      // rubric item did not cover what a player sees on Profile, Beacon Log,
      // Pause or Profile Picker. A reference compare is only worth what it
      // covers, and nothing was checking that it covered everything.
      return problems.length === 0
        ? ok(`one implementation each for Shadow and the Lantern across ${files.length} game files`)
        : bad(problems.join("; "));
    },
  },
  {
    id: "G-e2e-whole",
    source: "CLAUDE.md gauntlet loop / D93",
    title: "The whole e2e suite passes in ONE run, under the repo config",
    kind: "trace",
    run: async ({ repo }) => {
      // Read Playwright's OWN json reporter output, never a hand-written file.
      const p = join(repo, "gauntlet/evidence/e2e-report.json");
      if (!existsSync(p)) {
        return todo("no whole-suite run recorded yet (PW_PORT=<free> npx playwright test)");
      }
      let report;
      try {
        report = JSON.parse(readFileSync(p, "utf8"));
      } catch (e) {
        return bad(`e2e-report.json is not valid JSON: ${e.message}`);
      }
      const stats = report.stats ?? {};
      const failed = (stats.unexpected ?? 0) + (stats.flaky ?? 0);
      const passed = stats.expected ?? 0;
      // A run that skipped most of the suite is not a whole-suite run.
      if (passed + failed < 100) {
        return bad(`only ${passed + failed} tests in the recorded run; that is not the whole suite`, "gauntlet/evidence/e2e-report.json");
      }
      if (failed !== 0) {
        return bad(`${failed} of ${passed + failed} e2e tests failing or flaky in a whole-suite run`, "gauntlet/evidence/e2e-report.json");
      }
      return ok(`${passed} e2e tests pass in one run under the repo config`, "gauntlet/evidence/e2e-report.json");
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
