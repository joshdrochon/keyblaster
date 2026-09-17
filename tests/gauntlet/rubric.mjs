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
import { parseInventory, sceneNames, sceneRowMap } from "../../scripts/trace-check.mjs";

/**
 * The scene readers come FROM trace-check rather than being written again here.
 * G-scenes and G-trace used to carry two different ideas of what a scene is
 * (27 vs 17) and report both as green; one definition is the fix. Injectable so
 * a test can hand the check a deliberately broken map and watch it go red.
 */
const TRACE = { parseInventory, sceneNames, sceneRowMap };

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

/**
 * WHAT COUNTS AS A SCENE. Exactly what boot.ts registers: `discoverScenes()`
 * globs `./scenes/*.ts`, top level only, and the file must map to a SCENE_KEYS
 * entry. `sceneNames` in trace-check reads the same set, so this is imported
 * rather than re-derived - the 27-vs-17 disagreement between G-scenes and
 * G-trace came from exactly one recursive `walk` that nobody cross-checked.
 */
const sceneFiles = (repo) =>
  readdirSync(join(repo, "src/game/scenes"), { withFileTypes: true })
    .filter((e) => e.isFile() && extname(e.name) === ".ts" && !e.name.endsWith(".test.ts"))
    .map((e) => join(repo, "src/game/scenes", e.name));

/**
 * Scenes that legitimately have NO screen-inventory row, each with the reason.
 * Same doctrine as trace-check's AC_EXEMPT: the empty string in
 * SCENE_INVENTORY_ROW is an exemption whether or not anyone wrote it down, and
 * an exemption nobody wrote down is how a completeness check stops meaning
 * anything. Writing them here makes the next `"": ` someone adds fail until
 * they say why.
 */
export const NO_SCREEN_SCENES = {
  Boot: "SCENE_KEYS.boot names the boot STEP, not a scene class - src/game/boot.ts is a function and there is no BootScene.ts. SCENE_INVENTORY_ROW is typed Record<SceneKey, string>, so the key must carry a value, and \"\" is the honest one: nothing is drawn and no row is claimed.",
};

/**
 * Phaser scenes that live OUTSIDE src/game/scenes, each with the reason.
 * D78 and trace-check relation 3 both only look inside that directory, so a
 * scene registered from anywhere else escapes the screen inventory entirely.
 * One does today, for a stated reason; the point of naming it is that the
 * SECOND one fails this item instead of arriving unnoticed.
 */
export const OFF_TREE_SCENES = {
  LanternShotScene: "src/game/render/lanternShot.ts - the R-lantern reference-compare harness. Registered by boot.ts only under ?lantern=1 and never in a normal session; a render harness is not a screen. Its own header states this.",
};

/**
 * Every CONCRETE Phaser scene class declared under src/game outside scenes/.
 * Resolved transitively to a fixpoint so a subclass of a subclass of
 * Phaser.Scene is still found.
 */
export function offTreeScenes(repo) {
  const declarations = [];
  for (const f of gameSources(repo)) {
    const rel = f.replace(repo + "/", "");
    const src = stripComments(readFileSync(f, "utf8"));
    for (const m of src.matchAll(
      /(abstract\s+)?class\s+([A-Za-z0-9_$]+)\s+extends\s+(?:Phaser\.)?([A-Za-z0-9_$.]+)/g,
    )) {
      declarations.push({ abstract: m[1] !== undefined, name: m[2], base: m[3].replace(/^Phaser\./, ""), rel });
    }
  }
  const sceneish = new Set(["Scene"]);
  for (let pass = 0; pass < 8; pass += 1) {
    const before = sceneish.size;
    for (const d of declarations) if (sceneish.has(d.base)) sceneish.add(d.name);
    if (sceneish.size === before) break;
  }
  return declarations.filter(
    (d) => !d.abstract && sceneish.has(d.name) && !d.rel.startsWith("src/game/scenes/"),
  );
}

/**
 * D78, asserted rather than deferred. Fails on:
 *   1. a scene file with no SCENE_INVENTORY_ROW entry
 *   2. a scene mapped to a row the design brief does not contain
 *   3. a scene mapped to "" that is not in NO_SCREEN_SCENES
 *   4. a NO_SCREEN_SCENES / OFF_TREE_SCENES entry that no longer applies
 *      (a stale exemption is a lie in the same direction)
 *   5. an inventory row with no scene and no NON_SCENE_ROWS reason
 *   6. a Phaser.Scene subclass under src/game outside scenes/, unlisted
 *   7. the rubric and trace-check disagreeing about how many scenes there are
 */
export function sceneCompleteness(repo, deps = TRACE) {
  const dir = join(repo, "src/game/scenes");
  if (!existsSync(dir) || sceneFiles(repo).length === 0) {
    return todo("src/game/scenes is empty (FIRST TASK 4)");
  }
  const scenes = deps.sceneNames(repo);
  const { rows: declared, nonScene } = deps.sceneRowMap(repo);
  const inventory = new Set(deps.parseInventory(repo));
  const problems = [];

  if (scenes.length !== sceneFiles(repo).length) {
    problems.push(
      `the rubric counts ${sceneFiles(repo).length} scene files and trace-check counts ${scenes.length};` +
        ` two checks disagreeing about what a scene is was the original defect here`,
    );
  }

  for (const name of scenes) {
    if (!declared.has(name)) {
      problems.push(`${name} has no SCENE_INVENTORY_ROW entry (D78)`);
      continue;
    }
    const row = declared.get(name);
    if (row !== "" && !inventory.has(row)) {
      problems.push(`${name} -> "${row}", which is not a row in the design brief`);
    }
  }

  // THE "" ESCAPE. trace-check:223 skips an empty row, so a scene mapped to ""
  // satisfies D78 while claiming no screen and being asked for none. Every such
  // key must be named below with a reason, in either direction.
  for (const [name, row] of declared) {
    if (row === "" && !(name in NO_SCREEN_SCENES)) {
      problems.push(`${name} maps to the empty row "" with no reason; add it to NO_SCREEN_SCENES or give it a row`);
    }
    // A key that claims a REAL row but has no scene file is fictional coverage:
    // the row reads as satisfied and nothing renders it.
    if (row !== "" && !scenes.includes(name)) {
      problems.push(`SCENE_INVENTORY_ROW claims ${name} -> "${row}", but src/game/scenes has no ${name} scene`);
    }
  }
  for (const name of Object.keys(NO_SCREEN_SCENES)) {
    if (!declared.has(name)) {
      problems.push(`NO_SCREEN_SCENES names ${name}, which is not in SCENE_INVENTORY_ROW any more`);
    } else if (declared.get(name) !== "") {
      problems.push(`NO_SCREEN_SCENES names ${name}, but it now has the row "${declared.get(name)}"`);
    }
  }

  // Reverse direction: every brief row needs a scene or a NON_SCENE_ROWS reason.
  const covered = new Set([...declared.values()].filter(Boolean));
  const uncovered = [...inventory].filter((r) => !covered.has(r) && !nonScene.has(r));
  if (uncovered.length) {
    problems.push(`inventory rows with no scene and no NON_SCENE_ROWS reason: ${uncovered.join(", ")}`);
  }

  // Scenes registered from outside scenes/ - invisible to D78 until now.
  //
  // Transitive, because `class X extends MenuScene` is a Phaser scene too and a
  // regex for `extends Phaser.Scene` alone would miss it. Abstract classes are
  // skipped by the language, not by a waiver list: `abstract class MenuScene
  // extends Phaser.Scene` cannot be registered and so cannot escape anything.
  const offTree = offTreeScenes(repo);
  for (const { name, rel } of offTree) {
    if (!(name in OFF_TREE_SCENES)) {
      problems.push(`${name} in ${rel} is a Phaser scene outside src/game/scenes, so D78 never sees it; list it in OFF_TREE_SCENES with a reason or move it`);
    }
  }
  for (const name of Object.keys(OFF_TREE_SCENES)) {
    if (!offTree.some((o) => o.name === name)) {
      problems.push(`OFF_TREE_SCENES names ${name}, which no longer exists`);
    }
  }

  if (problems.length) return bad(problems.join("; "));
  return ok(
    `${scenes.length} scenes, ${covered.size} of ${inventory.size} inventory rows covered,` +
      ` ${nonScene.size} rows declared non-scene, ${Object.keys(NO_SCREEN_SCENES).length} scene(s) with no screen,` +
      ` ${offTree.length} scene(s) outside src/game/scenes (all named, with reasons)`,
  );
}

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
    title: "Silhouettes read when desaturated, measured where the objects are",
    kind: "visual",
    needsBrowser: true,
    // THIS IS THE THIRD MEASURE BEHIND THIS ITEM. THE FIRST TWO WERE GREEN AND
    // COULD NOT ANSWER THE AC.
    //
    // 1. A CONTOUR COUNT, passed for any count in [3, 60], on an evidence file
    //    whose entire content was `{"contours": 14}`. It never identified the
    //    rocket or an asteroid; a frame with the Lantern failing to render and
    //    thirteen dust blobs scores the identical number.
    // 2. PER-REGION SEPARATION off a global Otsu binarisation. Stronger, and
    //    still adaptive: run against a floor vignette that crushed the play
    //    area to a 0.002 object/background step, it scored 0.239 — because
    //    Otsu re-splits a crushed frame and finds its object-sized regions
    //    somewhere else in the picture.
    //
    // The lane that shipped (2) refused to move the threshold to catch that one
    // vignette and was right: a number fitted to one known defect catches that
    // defect and passes the next. The defect was that the measurement could
    // migrate to a different part of the image, and no threshold fixes that.
    //
    // `desaturated-silhouettes.json` is now POSITION-ANCHORED: the scene is
    // asked where each rock and the ship are, and the frame is measured there —
    // object core against a background ring — with nothing chosen from the
    // data. The negative control is a unit test, not a sentence: feed the same
    // measure a synthetic frame with the vignette applied and it reports 0.000
    // while the superseded Otsu measure on identical pixels still reports 0.27
    // (tests/unit/gauntlet/silhouette.test.ts).
    //
    // THE BAR DID NOT MOVE. 0.06 is the same threshold the previous measure
    // used. What moved is what is being measured.
    run: async ({ evidence }) => {
      const name = "desaturated-silhouettes.json";
      if (!evidence.has(name)) {
        return todo("Flight scene not built; no desaturated-silhouettes.json evidence");
      }
      const data = evidence.read(name);
      const ev = evidence.path(name);
      // PROVENANCE. An artifact from the adaptive measure must not satisfy this
      // item, however good its number looks — that number is the false pass.
      if (!/measureSilhouettes/.test(String(data.measure ?? ""))) {
        return bad(
          `artifact does not name the position-anchored measure (measure: ${JSON.stringify(data.measure)}); a region count or an Otsu segmentation cannot answer AC-22.4`,
          ev,
        );
      }
      if (typeof data.negativeControl !== "string" || data.negativeControl.length < 40) {
        return bad("artifact must name a re-runnable negative control (D85)", ev);
      }
      // Anti-vacuity: a capture that measured one object is a capture of an
      // empty sky, and its minimum is meaningless.
      if (!(data.objectsMeasured >= 6)) {
        return bad(
          `only ${data.objectsMeasured} object(s) measured; the belt was empty`,
          ev,
        );
      }
      // AC-22.4 names the rocket AND the asteroids. A capture that never
      // located the ship has answered half the question.
      if (!(data.shipReadings >= 1) || data.shipReadings !== data.frames) {
        return bad(
          `the ship was measured in ${data.shipReadings} of ${data.frames} frames; AC-22.4 names the rocket as well as the asteroids`,
          ev,
        );
      }
      if (Array.isArray(data.unmeasurable) && data.unmeasurable.length > data.objectsMeasured / 4) {
        return bad(
          `${data.unmeasurable.length} object(s) could not be measured at all; a minimum taken over what happened to be measurable is not a minimum`,
          ev,
        );
      }
      const bands = data.byBand ?? {};
      const bandDetail = Object.entries(bands)
        .map(([b, v]) => `${b} ${v.min} (n=${v.n})`)
        .join(", ");
      return evidence.assertNumber(
        name, "minSeparation", (v) => v > 0.06,
        `weakest object/background luminance separation across ${data.objectsMeasured} objects, desaturated; by band: ${bandDetail}; weakest ${JSON.stringify(data.weakest)}`);
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
    title: "No dead time > 2 s during flight, on a measure that can exceed 2 s",
    kind: "unit",
    // THE ARTIFACT USED TO BE ITS OWN INSTRUMENT.
    //
    // `deadtime.json` read `{"maxGapMs": 120}` and 120 was `simulateStage`'s
    // spawn tick: that harness advances its clock with `nowMs +=
    // cfg.spawnIntervalMs`, so dead time could only ever be a multiple of 120
    // and the reported figure was the FLOOR of the measurable range. Breaching
    // 2000 would have needed seventeen consecutive picker refusals in a harness
    // that "resolves every live rock independently, as if the player could
    // answer them all at once" - the very assumption that hid the belt stall.
    // The item was true by construction and said nothing about the game.
    //
    // Four gates now, and the third is the one that matters: an artifact must
    // carry a NEGATIVE CONTROL that breached the threshold. If the harness
    // cannot produce a failing number, "0 ms" is a statement about the
    // empty-board fast path existing, not a measurement, and this item says so
    // instead of passing.
    run: async ({ evidence }) => {
      const name = "deadtime.json";
      if (!evidence.has(name)) return todo("flight simulation not built; no deadtime.json evidence");
      const d = evidence.read(name);
      const ev = evidence.path(name);
      if (typeof d.harness !== "string" || /simulateStage|parallel/i.test(d.harness)) {
        return bad(
          `harness must be the serial-typist belt: a harness that clears every live rock at once cannot be asked whether the sky went empty (got ${JSON.stringify(d.harness)})`,
          ev,
        );
      }
      if (typeof d.measurementResolutionMs !== "number") {
        return bad("must report measurementResolutionMs: a reading with no stated resolution cannot be told from its own tick", ev);
      }
      if (d.measurementResolutionMs > 0 && d.maxGapMs === d.measurementResolutionMs) {
        return bad(
          `maxGapMs (${d.maxGapMs}) is exactly the measurement resolution — the reading is the instrument, not the belt`,
          ev,
        );
      }
      const control = d.control;
      if (typeof control?.maxGapMs !== "number") {
        return bad("no negative control in the artifact: an anti-vacuity control that nobody can re-run is a sentence, not evidence", ev);
      }
      if (!(control.maxGapMs > 2000)) {
        return bad(
          `the negative control reached only ${control.maxGapMs} ms, so this measure has never been seen to breach 2000 ms and a pass proves nothing`,
          ev,
        );
      }
      if (!(d.belts >= 100) || !(d.spawns > 0)) {
        return bad(`too small to mean anything: ${d.belts} belts, ${d.spawns} spawns`, ev);
      }
      return evidence.assertNumber(name, "maxGapMs", (v) => v <= 2000,
        `longest interval with no live asteroid and no pending spawn across ${d.belts} belts (control breached at ${Math.round(control.maxGapMs)} ms)`);
    },
  },
  {
    id: "L-6e.4",
    source: "D77 / AC-6e.4 / D50",
    // RETITLED, DELIBERATELY AND NARROWER. The old title was "Retention line
    // trends upward across a full Earth->Pluto run" and three of its four words
    // were wrong: the simulation ran three stops of seven, "trends upward" was
    // arithmetic (the modelled child's recognition latency is a strictly
    // decreasing function of hit count, so no seed could fail), and it was read
    // as a learning result. What the evidence can support is that the PIPELINE
    // reports an improvement for a learner who improves, and that the selection
    // engine is what puts the re-met words on the line. See
    // gauntlet/escalations.md for the options and the reason for this one.
    title: "The retention pipeline reports improvement for a learner who improves, over the whole route",
    kind: "unit",
    run: async ({ evidence }) => {
      const name = "retention.json";
      if (!evidence.has(name)) return todo("learning-engine simulation not built; no retention.json evidence");
      const d = evidence.read(name);
      const ev = evidence.path(name);
      if (typeof d.harness !== "string" || /simulateStage|parallel/i.test(d.harness)) {
        return bad(`harness must be the serial-typist belt (got ${JSON.stringify(d.harness)})`, ev);
      }
      // The route, asserted rather than implied by the title. Earth flies no
      // belt (D57), so the whole route is six.
      if (d.stops !== 6) {
        return bad(`ran ${d.stops} stop(s); the Mars->Pluto route is six belts and the claim is about the whole run`, ev);
      }
      if (!(d.crossStopWords > 0)) {
        return bad("no word was met again at a later stop, so there is no delayed re-test to report on", ev);
      }
      if (!(d.engineSourcedWords > 0)) {
        return bad("no re-met word was chosen from the retention pool: the line is entirely the content pools' overlap, not the engine", ev);
      }
      // CONTROL 1 (the model). A learner who cannot get faster must not read as
      // improving. The control this replaces pitted a 260 ms learner against a
      // 220 ms floor and asserted the delta was under 60 - a 40 ms range tested
      // against a 60 ms bound, which could not have failed.
      const flat = d.controls?.flatLearner;
      if (flat === undefined) return bad("no flat-learner control in the artifact", ev);
      if (flat.trendUp !== false) {
        return bad("the flat-learner control reports an improvement: the pipeline says a learner who did not improve did", ev);
      }
      // CONTROL 2 (the engine). With the D21/D23 interleave removed, the number
      // of re-met words must DROP. If it does not, the engine contributes
      // nothing and this item is measuring how much the story's stage pools
      // happen to overlap.
      const noInterleave = d.controls?.noInterleave;
      if (noInterleave === undefined) return bad("no no-interleave control in the artifact", ev);
      if (!(noInterleave.crossStopWords < noInterleave.withInterleave)) {
        return bad(
          `removing the retention interleave changed the re-met word count from ${noInterleave.withInterleave} to ${noInterleave.crossStopWords}: the selection engine contributes nothing to this line`,
          ev,
        );
      }
      return evidence.assertShape(name, (r) => r.trendUp === true,
        `${d.crossStopWords} words met again at a later stop (${d.engineSourcedWords} of them brought back by the engine) read faster than at first exposure; controls: flat learner ${flat.trendUp}, no-interleave ${noInterleave.crossStopWords} vs ${noInterleave.withInterleave}`);
    },
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
    title: "trace-check green: every D has an AC, every AC an ASSERTING test, every scene a row",
    kind: "trace",
    // RUNS --strict, AND THAT IS THE POINT.
    //
    // This item used to run `scripts/trace-check.mjs` with no flag and report
    // PASS while its own printed line read "97/106 cited by a real test (9 not
    // yet)". The flag that turns that count into a failure exists, is named in
    // trace-check's header as "what the gauntlet runs", and was never passed.
    // An item whose evidence contradicts its own status is worse than no item.
    //
    // Passing it makes this item RED today: 10 acceptance criteria have no test
    // that asserts them. That is a real finding, escalated in
    // gauntlet/escalations.md with the list, not a reason to drop the flag.
    // `npm test` still runs the non-strict form, so the "no red merges" rule in
    // CLAUDE.md is untouched - the gap is red where the bar lives.
    run: async ({ repo, runNode }) => {
      const s = join(repo, "scripts/trace-check.mjs");
      if (!existsSync(s)) return todo("scripts/trace-check.mjs not written yet");
      const r = await runNode(["scripts/trace-check.mjs", "--strict"]);
      const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim();
      if (!/AC->test:/.test(out)) {
        return bad(`trace-check --strict produced no AC->test line; it did not run: ${out.slice(0, 400)}`,
          "gauntlet/evidence/trace-check.txt");
      }
      return r.code === 0
        ? ok(out.split("\n").filter((l) => /AC->test:|trace-check OK/.test(l)).join(" | "),
            "gauntlet/evidence/trace-check.txt")
        : bad(out.split("\n").slice(-12).join("\n"), "gauntlet/evidence/trace-check.txt");
    },
  },
  {
    id: "G-scenes",
    source: "D78 / architecture section 10.2",
    title: "Every registered Phaser scene has a screen-inventory row, and vice versa",
    kind: "trace",
    // THIS ITEM USED TO HAVE NO FAILING BRANCH AT ALL.
    //
    // It returned `todo` on an empty directory and `ok` on anything else, and
    // its own detail string said row-matching was "enforced by trace-check
    // (G-trace)" - which passed non-strict. One of thirty-three items, and
    // there was no input on which it could go red.
    //
    // It also disagreed with the check it deferred to about what a scene IS:
    // it reported 27 by walking every .ts under src/game/scenes, counting the
    // lib/ and support/ helpers as screens, while trace-check counted the 17
    // top-level scene files that boot.ts actually registers.
    //
    // Now it asserts D78 itself, through the SAME readers trace-check uses
    // (imported, not reimplemented, so the two can never disagree again), and
    // it closes the two escapes D78 had:
    //   - a scene mapped to the empty row "", which trace-check skips
    //     (`SCENE_INVENTORY_ROW.Boot` is ""), and
    //   - a Phaser.Scene subclass registered from OUTSIDE src/game/scenes,
    //     which relation 3 never looks at (`LanternShotScene`).
    // Both now need a named entry below, with a reason, or the item fails.
    run: async ({ repo }) => sceneCompleteness(repo),
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
