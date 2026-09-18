import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * THE "A HULL IS CHOSEN, EARNED, PERSISTED, AND NOTHING DRAWS IT" DETECTOR
 * (UR-48, coding-standards rule 2, second named instance).
 *
 * ================== THE DEFECT ==================
 * Rule 2 names two fields. The first pair, `uppercase` and
 * `increasedLetterSpacing`, persisted perfectly and changed nothing on nine
 * screens; `settingReaders.test.ts` is the guard for that half. This is the
 * other one, quoted from the rule:
 *
 *     "Same shape, different field: `profile.shipId` was chosen at profile
 *      creation and reached nothing. Hulls could be earned and never equipped,
 *      and the flight screen drew a hardcoded ship regardless."
 *
 * Flight was closed by reading the profile inline. That fixed one screen. Four
 * screens draw the Lantern, and a fix that each screen has to remember to opt
 * into is the arrangement that lost `crossDrift` and lost keep-clear twice.
 *
 * ================== WHY IT SWEEPS ==================
 * Rule 5: a harness sweeps, it does not sample. The lesson cost two gates - the
 * screenshot harness booted Mars only and every capture looked clean, and the
 * asteroid-visibility gate booted Mars only, where re-run across six stops with
 * the defect reintroduced URANUS PASSED THE DEFECT. So this walks every file
 * under `src/game/scenes` and asks the question of each, rather than asserting
 * it of the screen somebody happened to be fixing.
 *
 * ================== WHAT IT ASKS ==================
 * Two things, because either alone has a hole:
 *
 *   1. PER CALL SITE. Every call that draws the Lantern either goes through
 *      `lib/livery.drawPlayerLantern` - where the resolution is inside the
 *      callee and there is no argument for "skip it" - or passes an explicit
 *      `livery:` that is not an object literal. A hardcoded colourway written
 *      inline at the call site is the defect in its newest possible form.
 *   2. PER FILE. A file that draws the Lantern names a profile-backed
 *      resolver. Check 1 alone would accept `livery: SOME_CONSTANT`.
 *
 * ================== WHAT IT DOES NOT COVER ==================
 * `src/game/render/lanternShot.ts` is a Phaser scene and is deliberately out of
 * scope: it is the render `R-lantern` is judged against, it passes NO livery on
 * purpose, and `render/lantern.ts` documents that as meaning "the constants,
 * byte for byte". Putting the active pilot's hull into the sheet a human signed
 * off is the opposite of the fix. It is out by LOCATION (not a screen, not
 * under `scenes/`), which is a line a new screen cannot accidentally land on.
 *
 * And this is a static check, so it can only say the profile is READ, never
 * that the colour reaches the glass. The pixels are
 * `tests/e2e/map-livery.spec.ts` and the flight half of
 * `tests/e2e/world-frame-invariants.spec.ts`, both of which count a hull's own
 * stripe on a real frame with the other hull as its control.
 *
 * ================== WATCH IT FAIL ==================
 * Every failing value below was read off a red run (rule 4).
 *
 *   `DirectorMapScene.buildLantern` back to the state the screen shipped in -
 *   `drawPlayerLantern(this,` -> `drawLantern(this,` and the
 *   `livery: this.shipLivery,` line deleted - two cases red:
 *
 *     UR-48 ... > DirectorMapScene.ts
 *       src/game/scenes/DirectorMapScene.ts: drawLantern call 1 has no livery::
 *       expected [ Array(1) ] to deeply equal []
 *     UR-48 ... > the screens that WERE this defect stay covered
 *       DirectorMapScene.ts lost its profile hull - this was a shipped defect
 *       once: expected [ Array(1) ] to deeply equal []
 *
 *   Dropping ONLY the `livery:` argument does NOT go red, and that is the
 *   wrapper doing its job: `drawPlayerLantern` resolves the hull itself.
 *
 *   `"DirectorMapScene.ts"` added to KNOWN_BLIND_SCREENS - two cases red:
 *
 *     UR-48 ... > DirectorMapScene.ts
 *       DirectorMapScene.ts is on the blind list but now reads the profile:
 *       expected 0 to be greater than 0
 *     UR-48 ... > no entry in KNOWN_BLIND_SCREENS is stale
 *       DirectorMapScene.ts now reads the profile - delete the
 *       KNOWN_BLIND_SCREENS entry: expected [ 'DirectorMapScene.ts' ] to
 *       deeply equal []
 *
 *   TITLE AND WARP, the two entries this list used to hold, re-broken the same
 *   way - `drawPlayerLantern(` -> `drawLantern(` and the livery import dropped:
 *
 *     UR-48 ... > TitleScene.ts
 *       src/game/scenes/TitleScene.ts: drawLantern call 1 has no livery:
 *     UR-48 ... > WarpScene.ts
 *       src/game/scenes/WarpScene.ts: drawLantern call 1 has no livery:
 *
 *   `"TitleScene.ts"` put back on the now-empty KNOWN_BLIND_SCREENS - two red,
 *   which is the staleness case refusing to let a closed defect sit on the
 *   allowlist:
 *
 *     UR-48 ... > TitleScene.ts
 *       TitleScene.ts is on the blind list but now reads the profile:
 *       expected 0 to be greater than 0
 *     UR-48 ... > no entry in KNOWN_BLIND_SCREENS is stale
 *       TitleScene.ts now reads the profile - delete the KNOWN_BLIND_SCREENS
 *       entry: expected [ 'TitleScene.ts' ] to deeply equal []
 *
 *   npx vitest run tests/unit/arch/liveryReaders.test.ts --coverage.enabled=false
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SCENES = path.join(ROOT, "src", "game", "scenes");

/**
 * Screens that draw the Lantern and do NOT yet read the profile, each with the
 * reason it is still here. THIS LIST MAY ONLY EVER SHRINK, and the staleness
 * test below fails if an entry is no longer true, so a fix cannot leave it
 * lying. The idiom is `profileWriters.test.ts`'s `KNOWN_ORPHANS`, which is how
 * this repo lands a full-scope sweep over a defect that is not closed yet
 * instead of narrowing the sweep to the part that is (rule 8: never move a bar
 * to make a number pass).
 *
 * IT IS EMPTY. Both entries were open defects rather than exemptions, and both
 * are closed:
 *
 *   TitleScene.ts  drew the idle Lantern at W*0.72 in the file constants, so
 *                  the FIRST screen a returning pilot sees was the one showing
 *                  them somebody else's ship.
 *   WarpScene.ts   drew the Lantern at `lanternStand()` in its non-overlay
 *                  mount, in the file constants. The overlay path draws no ship
 *                  at all - that one is Flight's, and Flight's was already
 *                  right - so the blind path was the standalone/capture one.
 *
 * Each was the one-line change the entry said it was: import
 * `drawPlayerLantern` from `./lib/livery` and call it instead of `drawLantern`.
 * Both were held out only because those files belonged to other lanes in the
 * change that wrote this guard. Adding an entry back is allowed - a screen can
 * legitimately arrive before its hull - but it is a claim made in writing, with
 * the ticket that owns the fix, and the staleness case below will not let it
 * rot. What the list does from here is stay empty.
 */
const KNOWN_BLIND_SCREENS: Record<string, string> = {};

/** A file's code with comments stripped, so a guard cannot read an excuse. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

/** Index of the `)` matching the `(` at `open`, or -1. Paren-aware because the
 *  argument list of every real call here ends in an object literal. */
function matchParen(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The two spellings that put a Lantern on a screen. */
const DRAW_CALL = /(^|[^.\w$])(drawPlayerLantern|drawLantern)\s*\(/g;

/** The resolvers that answer "which hull is this pilot wearing?". */
const PROFILE_RESOLVERS = ["drawPlayerLantern", "playerLivery", "liveryForShip", "liveryFor"];

interface Finding {
  /** One line per call site that draws a ship with no profile-backed hull. */
  readonly blind: string[];
  /** True when the file draws the Lantern at all. */
  readonly draws: boolean;
}

/**
 * Judge one file's source text.
 *
 * Takes TEXT rather than a path so the negative controls can sabotage a real
 * file's source and re-ask, which is the only way to know the detector can be
 * made to fail (rule 4).
 */
export function judge(src: string, label: string): Finding {
  const text = code(src);
  const blind: string[] = [];
  let draws = false;
  let n = 0;
  DRAW_CALL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DRAW_CALL.exec(text)) !== null) {
    const name = m[2] as string;
    const open = m.index + m[0].length - 1;
    const close = matchParen(text, open);
    if (close === -1) continue;
    const args = text.slice(open + 1, close);
    // A declaration is not a call. `{` after the parameter list is what tells
    // them apart, and there is a separate rule-3 guard for declarations.
    if (/^\s*[{:]/.test(text.slice(close + 1, close + 3))) continue;
    draws = true;
    n += 1;
    // The wrapper resolves the hull itself; there is no way to call it and skip
    // that. Any other spelling has to say `livery:` out loud, and the value may
    // not be an object literal - an inline colourway IS the hardcoded ship.
    if (name === "drawPlayerLantern") continue;
    if (!/\blivery\s*:\s*[^{\s]/.test(args)) {
      blind.push(`${label}: ${name} call ${n} has no livery:`);
    }
  }
  if (draws && !PROFILE_RESOLVERS.some((fn) => text.includes(`${fn}(`))) {
    blind.push(`${label}: draws the Lantern and names no profile-backed resolver`);
  }
  return { blind, draws };
}

const files = walk(SCENES).map((file) => ({
  file,
  base: path.basename(file),
  rel: path.relative(ROOT, file),
  src: readFileSync(file, "utf8"),
}));

const verdicts = files.map((f) => ({ ...f, ...judge(f.src, path.relative(ROOT, f.file)) }));
const drawing = verdicts.filter((v) => v.draws);

describe("UR-48: every screen that draws the ship reads the profile's hull", () => {
  it("the sweep found the screens that draw a ship at all", () => {
    // A sweep that matched nothing is a sweep that passes for the wrong reason,
    // which is how a Mars-only harness looked clean for months. Name them.
    expect(
      drawing.map((v) => v.base).sort(),
      "no scene file draws the Lantern - the detector is matching nothing",
    ).toEqual(
      ["DirectorMapScene.ts", "FlightScene.ts", "TitleScene.ts", "WarpScene.ts", "livery.ts"].sort(),
    );
  });

  it.each(drawing.map((v) => [v.base, v] as const))(
    "%s",
    (base, v) => {
      if (base in KNOWN_BLIND_SCREENS) {
        expect(v.blind.length, `${base} is on the blind list but now reads the profile`)
          .toBeGreaterThan(0);
        return;
      }
      expect(v.blind, v.blind.join("\n")).toEqual([]);
    },
  );

  it("no entry in KNOWN_BLIND_SCREENS is stale", () => {
    // The list may only shrink. A screen that has been fixed must be REMOVED
    // from it, so a fix cannot leave the allowlist lying about the state of the
    // game (`profileWriters.test.ts` holds its own list the same way).
    const fixed = Object.keys(KNOWN_BLIND_SCREENS).filter((base) => {
      const v = verdicts.find((x) => x.base === base);
      return v !== undefined && v.blind.length === 0;
    });
    expect(
      fixed,
      `${fixed.join(", ")} now reads the profile - delete the KNOWN_BLIND_SCREENS entry`,
    ).toEqual([]);

    const gone = Object.keys(KNOWN_BLIND_SCREENS).filter(
      (base) => !verdicts.some((v) => v.base === base && v.draws),
    );
    expect(gone, `${gone.join(", ")} no longer draws the Lantern`).toEqual([]);
  });

  it("the screens that WERE this defect stay covered", () => {
    // Named explicitly, so a revert is caught by a test that says what it was
    // rather than by the generic sweep months later.
    for (const base of [
      "FlightScene.ts",
      "DirectorMapScene.ts",
      // Both were entries on KNOWN_BLIND_SCREENS above until UR-48 closed them.
      // Named here so a revert fails a test that says what it was, rather than
      // quietly reappearing on an allowlist months later.
      "TitleScene.ts",
      "WarpScene.ts",
    ]) {
      const v = verdicts.find((x) => x.base === base);
      expect(v?.draws, `${base} stopped drawing the Lantern`).toBe(true);
      expect(v?.blind, `${base} lost its profile hull - this was a shipped defect once`)
        .toEqual([]);
    }
  });
});

describe("negative control: the detector can be made to fail", () => {
  const map = files.find((f) => f.base === "DirectorMapScene.ts")?.src ?? "";
  const flight = files.find((f) => f.base === "FlightScene.ts")?.src ?? "";

  it("the map with the wrapper swapped back for the bare drawing goes blind", () => {
    // `drawPlayerLantern(this, ...)` -> `drawLantern(this, ...)` AND the livery
    // argument removed: the exact state this screen shipped in.
    const sabotaged = map
      .replace(/drawPlayerLantern\(this,/g, "drawLantern(this,")
      .replace(/livery: this\.shipLivery,/g, "");
    expect(judge(sabotaged, "map").blind).toEqual(["map: drawLantern call 1 has no livery:"]);
  });

  it("flight with its livery argument removed goes blind", () => {
    const sabotaged = flight.replace(/\n\s*livery: this\.livery,/g, "");
    expect(judge(sabotaged, "flight").blind.length).toBeGreaterThan(0);
  });

  it("an inline colourway at the call site is not a profile hull", () => {
    const sabotaged = `
      import { drawLantern } from "@game/render/lantern";
      import { liveryForShip } from "@game/ui/catalog";
      const rig = drawLantern(this, 0, 0, {
        livery: { hull: "#F3E7D3", stripe: "#FF6B4A", glass: "#2A2F3A", lens: "#C9B79C" },
      });
      const unused = liveryForShip("ship-1", []);
    `;
    // The four hex literals are the ones the private second Lantern in
    // FlightScene actually used. Naming a resolver elsewhere in the file does
    // not save it, which is why check 1 is per CALL SITE.
    expect(judge(sabotaged, "inline").blind).toEqual(["inline: drawLantern call 1 has no livery:"]);
  });

  it("naming a resolver and never passing it does not satisfy the check", () => {
    const sabotaged = `
      import { drawLantern } from "@game/render/lantern";
      import { liveryForShip } from "@game/ui/catalog";
      const rig = drawLantern(this, 0, 0, { scale: 1, iris: 0.35 });
      const unused = liveryForShip("ship-1", []);
    `;
    expect(judge(sabotaged, "named").blind).toEqual(["named: drawLantern call 1 has no livery:"]);
  });

  it("a comment describing the fix does not satisfy the check", () => {
    // The ticket board was once found grading a defect fixed on the strength of
    // prose describing it. Comments are stripped before anything is judged.
    const sabotaged = `
      import { drawLantern } from "@game/render/lantern";
      /* livery: playerLivery(this) is passed below, honestly */
      // playerLivery(this)
      const rig = drawLantern(this, 0, 0, { scale: 1 });
    `;
    expect(judge(sabotaged, "prose").blind).toEqual([
      "prose: drawLantern call 1 has no livery:",
      "prose: draws the Lantern and names no profile-backed resolver",
    ]);
  });

  it("a file that draws nothing is never reported", () => {
    expect(judge("export const x = 1;", "none")).toEqual({ blind: [], draws: false });
  });
});
