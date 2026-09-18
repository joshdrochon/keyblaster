import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * THE "A TENTH BESPOKE PLATE" DETECTOR (UR-69, coding-standards rule 1, the
 * COMPONENT half).
 *
 * ================== THE DEFECT ==================
 * UR-69 asks for one reusable layout built from reusable components that take
 * props - the per-planet colour being the example - so that a change made in
 * one place carries to every place the component is used.
 *
 * Colour already carried over - `ui/theme.ts`, the per-stop palette and
 * `ui/grid.ts` are all shared and prop-driven, and standards rule 1 is enforced
 * for that half. The PLATE did not. Nine scenes drew their own rounded rects:
 *
 *   Pre-flight 7 · Briefing 7 · Warp 4 · Title 4 · Stall 4 · Results 4 ·
 *   HUD 4 · Earth activation 2 · Beacon 1
 *
 * So a corner treatment, a rim, a notch - or the PADDING UR-70 asked to
 * condense - had to be written nine times, and drifts the first time one of
 * them is touched.
 *
 * ================== WHY A GUARD AND NOT A HELPER ==================
 * `lib/kit.plate` already existed and eight of the nine scenes already called
 * it, and the nine bespoke rects were drawn anyway. A helper nobody is obliged
 * to use is a suggestion, and UR-69 says so out loud: "The guard is what makes
 * the invariant hold rather than the intention."
 *
 * ================== WHAT IT ASKS, AND WHY PER CALL SITE ==================
 * Every `fillRoundedRect` / `strokeRoundedRect` under `src/game/scenes` is a
 * finding unless it is named below. PER CALL SITE and not per file, which is
 * the lesson `liveryReaders.test.ts` wrote down: a file-level allowlist accepts
 * the tenth copy as long as it lands in a file that already had one. The
 * Beacon's mast is exempt; a plate added to `BeaconScene.ts` next week is not.
 *
 * A call site is keyed by its FILE and its own normalised text, so an entry
 * cannot silently come to cover a different drawing. Two byte-identical calls
 * in one file share an entry, which is correct where it happens: the Briefing
 * cuts the same window mask twice.
 *
 * ================== WHAT IT DOES NOT COVER ==================
 * `src/game/ui/` and `src/game/render/`. A knob bezel, a console vent, a rocket
 * fin and an asteroid facet are rounded rects that are not plates, and the
 * component this guard points at (`ui/plate.ts`) lives there - a sweep that
 * included its own implementation would have to exempt it, which is how a guard
 * comes to be written around the thing it guards. The boundary is by LOCATION,
 * which is a line a new screen cannot accidentally land on.
 *
 * It is also static: it can say a scene reaches the shared plate, never that
 * the pixels are right. The pixels are `tests/e2e/plate-legibility.spec.ts` and
 * the V-22.8 contrast rows.
 *
 * ================== WATCH IT FAIL (rule 4) ==================
 * Every value below was read off a real red run. See the block above
 * `NEGATIVE_CONTROLS` for the pasted-back-in case, which is the one UR-69 asks
 * for by name.
 *
 *   npx vitest run tests/unit/arch/platePainters.test.ts --coverage.enabled=false
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SCENES = path.join(ROOT, "src", "game", "scenes");

/**
 * THE ONLY IMPLEMENTATION. Every plate on every SCREEN is painted here, and
 * `lib/kit.plate`, `lib/kit.skyText`, `lib/kit.createFocusRing` and
 * `lib/typedWord` all forward to it.
 *
 * `ui/chrome.plate` is deliberately NOT one of them, and the claim above is
 * scoped to `scenes/` because of it. That function takes a Graphics and a
 * colour as a NUMBER and fills without stroking - it is the menu kit's
 * low-level fill primitive, used by `controls.ts` and `cockpit.ts` to build
 * console hardware, not a plate a screen puts text on. Routing it through this
 * component would mean changing every caller's colour type for no invariant
 * gained, and claiming it forwards when it does not is worse than the
 * duplication. Named here so the boundary is a decision rather than an
 * oversight.
 */
const COMPONENT = path.join(ROOT, "src", "game", "ui", "plate.ts");

/**
 * ROUNDED RECTS UNDER `scenes/` THAT ARE NOT PLATES, each with the reason.
 *
 * A plate is a SURFACE something is read on. These are not: they are drawings
 * that happen to have rounded corners, and routing a beacon mast through a
 * component whose props are "palette, corner, rim, rhythm" would be worse code
 * and a dishonest guard.
 *
 * Every entry is a claim in writing, keyed to the exact call. `no entry is
 * stale` below deletes this list's ability to rot: an entry that no longer
 * matches any call in its file fails.
 */
const NOT_A_PLATE: Record<string, string> = {
  // -- world art. Drawn objects that exist in the fiction. ------------------
  "BeaconScene.ts::fillRoundedRect(-14, -58, 28, 152, 10)":
    "the beacon's MAST. A pole with rounded ends, not a surface.",
  "EarthActivationScene.ts::fillRoundedRect(x - 48, y - 36, 96, 78, 14)":
    "the beacon lamp's HOUSING. Cold metal in the world, not chrome.",
  "EarthActivationScene.ts::strokeRoundedRect(x - 48, y - 36, 96, 78, 14)":
    "the same housing's edge.",

  // -- masks and frames. A hole in the hull is not a plate. -----------------
  "PreflightScene.ts::fillRoundedRect(WINDOW.x, WINDOW.y, WINDOW.w, WINDOW.h, WINDOW.r)":
    "the cockpit window's GEOMETRY MASK. Drawn white into an off-screen " +
    "graphics and never added to the scene; it is a shape, not a surface.",
  "PreflightScene.ts::strokeRoundedRect(WINDOW.x - 7, WINDOW.y - 7, WINDOW.w + 14, WINDOW.h + 14, WINDOW.r + 7)":
    "the window FRAME's outer ring. The frame is a hole in the hull with a " +
    "bezel round it; the thing behind it is the sky, not a fill.",
  "PreflightScene.ts::strokeRoundedRect(WINDOW.x, WINDOW.y, WINDOW.w, WINDOW.h, WINDOW.r)":
    "the same frame's inner ring, which catches the light from outside.",
  "BriefingScene.ts::fillRoundedRect(WINDOW.x, WINDOW.y, WINDOW.w, WINDOW.h, WINDOW.r)":
    "the same window mask, cut twice - once for the parallax clip and once " +
    "for the hull's inverted cutout.",
  "BriefingScene.ts::strokeRoundedRect(WINDOW.x - 7, WINDOW.y - 7, WINDOW.w + 14, WINDOW.h + 14, WINDOW.r + 7)":
    "the same frame, outer ring.",
  "BriefingScene.ts::strokeRoundedRect(WINDOW.x, WINDOW.y, WINDOW.w, WINDOW.h, WINDOW.r)":
    "the same frame, inner ring.",

  // -- marks and bars. A 3x16 rule is not a card. ---------------------------
  "HudScene.ts::fillRoundedRect(placeRect.x + 16, placeRect.y + 15, 3, 16, 1.5)":
    "the stop's colour as a 3x16 RULE beside its name. A mark, drawn on a " +
    "plate rather than being one.",
  "HudScene.ts::fillRoundedRect(x + i * 24, y, 16, 16, 5)":
    "one HULL MARK. Sixteen square pixels of accent; there is nothing on it.",
  "PreflightScene.ts::fillRoundedRect(ROW.x + 128, y + 16, ROW.w - 180, 8, 4)":
    "an 8 px DONE BAR across a finished system row. A tick's replacement " +
    "(AC-22b.1 forbids the tick's partner), not a surface.",
  "TitleScene.ts::fillRoundedRect(0, 152, 10, 8, 4)":
    "the accent RULE under the wordmark: the beacon beam, laid flat.",
  "BriefingScene.ts::fillRoundedRect(laid.page.x + 34, laid.page.y + 34, 8, laid.page.h - 68, 4)":
    "the accent RIBBON down the page's spine. 8 px wide.",

  "typedWord.ts::fillRoundedRect(x, y, Math.max(8, target.width), 5, 3)":
    "the next letter's soft UNDERLINE CUE (art-direction s7). 5 px tall and " +
    "it breathes; nothing is read on it.",

  // -- generated textures. Not on a screen at all. --------------------------
  "WarpScene.ts::fillRoundedRect(0, 0, 4, 48, 2)":
    "the `warpStreaks` PARTICLE TEXTURE, drawn into an off-screen graphics " +
    "at boot (D83: particle textures are generated from vector shapes). It " +
    "is 4x48 and is never a surface.",
};

/**
 * SCENES THAT STILL DRAW THEIR OWN PLATE, each with the ticket that owns the
 * fix and the lane that owns the file.
 *
 * THIS LIST MAY ONLY EVER SHRINK. The idiom is `liveryReaders.test.ts`'s
 * `KNOWN_BLIND_SCREENS` and `profileWriters.test.ts`'s `KNOWN_ORPHANS`, which is
 * how this repo lands a FULL-SCOPE sweep over a defect that is not closed yet
 * instead of narrowing the sweep to the part that is (standards rule 8: never
 * move a bar to make a number pass).
 *
 * Every entry here is held out for the same reason: these four files belong to
 * the lane fixing the Title lockup (UR-68) and the header contract (UR-19) in
 * the same change that wrote this guard, and two lanes editing one file is how
 * `crossDrift` was lost. They are not exemptions. The migration is mechanical -
 * `plate(...)` or `drawPlate(this, rect, props)` - and the `no entry is stale`
 * case below will not let a fixed one sit here.
 */
const BLOCKED_ON_ANOTHER_LANE: Record<string, string> = {
  "TitleScene.ts::fillRoundedRect(0, 0, width, height, 26)":
    "the menu item's plate. UR-68 (Title lockup spacing) owns this file.",
  "TitleScene.ts::fillRoundedRect(4, 4, width - 8, height * 0.42, 22)":
    "the same plate's top-lit facet. UR-68 owns this file.",
  "TitleScene.ts::strokeRoundedRect( item.root.x - pad, item.root.y - pad, item.width + pad * 2, item.height + pad * 2, item.id === \"primary\" ? 34 : 14, )":
    "the focus ring, which is `plate.paintFocusRing`. UR-68 owns this file.",
  "BriefingScene.ts::fillRoundedRect(laid.page.x + 8, laid.page.y + 12, laid.page.w, laid.page.h, 26)":
    "the page's drop shadow. UR-19 owns `support/briefingLayout.ts` and this " +
    "scene's header.",
  "BriefingScene.ts::fillRoundedRect(laid.page.x, laid.page.y, laid.page.w, laid.page.h, 26)":
    "the picture-book page itself: a card. UR-19 owns this scene's header.",
};

/** A file's code with comments blanked out, so a guard cannot read an excuse. */
function code(src: string): string {
  const blank = (m: string): string => m.replace(/[^\n]/g, " ");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/\/\/[^\n]*/g, blank);
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

/** Index of the `)` matching the `(` at `open`, or -1. */
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

const PAINT_CALL = /\b(fillRoundedRect|strokeRoundedRect)\s*\(/g;

export interface Site {
  /** `Basename.ts::normalisedCall` - the allowlist key. */
  readonly key: string;
  /** What a red run prints. */
  readonly message: string;
}

/**
 * Every raw rounded rect in one file's source.
 *
 * Takes TEXT rather than a path so the negative controls can paste a real
 * bespoke plate back into a real scene's source and re-ask, which is the only
 * way to know the detector can be made to fail (rule 4).
 */
export function sites(src: string, base: string): Site[] {
  const text = code(src);
  const out: Site[] = [];
  PAINT_CALL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PAINT_CALL.exec(text)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = matchParen(text, open);
    if (close === -1) continue;
    const line = text.slice(0, m.index).split("\n").length;
    const call = text.slice(m.index, close + 1).replace(/\s+/g, " ");
    out.push({
      key: `${base}::${call}`,
      message:
        `${base}:${line}: raw ${call} - a plate is drawn by ` +
        `ui/plate.drawPlate, not by a scene (UR-69)`,
    });
  }
  return out;
}

/** The findings in one file: every site that is not named in a list. */
export function judge(src: string, base: string): string[] {
  return sites(src, base)
    .filter((s) => !(s.key in NOT_A_PLATE) && !(s.key in BLOCKED_ON_ANOTHER_LANE))
    .map((s) => s.message);
}

const files = walk(SCENES).map((file) => ({
  base: path.basename(file),
  rel: path.relative(ROOT, file),
  src: readFileSync(file, "utf8"),
}));

const verdicts = files.map((f) => ({ ...f, found: judge(f.src, f.base), all: sites(f.src, f.base) }));
const painting = verdicts.filter((v) => v.all.length > 0);

describe("UR-69: a scene does not paint its own plate", () => {
  it("the sweep is looking at the screens, not at nothing", () => {
    // A sweep that matched nothing is a sweep that passes for the wrong reason,
    // which is how a Mars-only harness looked clean for months (rule 5). Name
    // every file that still draws a rounded rect of any kind.
    expect(
      painting.map((v) => v.base).sort(),
      "no scene file draws a rounded rect - the detector is matching nothing",
    ).toEqual(
      [
        "BeaconScene.ts",
        "BriefingScene.ts",
        "EarthActivationScene.ts",
        "HudScene.ts",
        "PreflightScene.ts",
        "TitleScene.ts",
        "WarpScene.ts",
        // `lib/` is swept too: the shared kit and the flight word plate are
        // where a tenth implementation would be least visible, because they
        // are already shared and already look like the right place.
        "typedWord.ts",
      ].sort(),
    );
  });

  it.each(verdicts.map((v) => [v.base, v] as const))("%s", (_base, v) => {
    expect(v.found, v.found.join("\n")).toEqual([]);
  });

  it("no entry in either list is stale", () => {
    // Both lists may only shrink. A call site that has been migrated must be
    // REMOVED, so an allowlist cannot lie about the state of the game.
    const live = new Set(verdicts.flatMap((v) => v.all.map((s) => s.key)));
    const gone = [...Object.keys(NOT_A_PLATE), ...Object.keys(BLOCKED_ON_ANOTHER_LANE)].filter(
      (key) => !live.has(key),
    );
    expect(
      gone,
      `${gone.join("\n")}\n- no longer drawn; delete the entry`,
    ).toEqual([]);
  });

  it("the screens this ticket migrated stay migrated", () => {
    // Named explicitly, so a revert fails a test that says what it was rather
    // than reappearing on an allowlist months later. These six are the scenes
    // UR-69 counted that no other lane held open.
    for (const base of [
      "WarpScene.ts",
      "StallScene.ts",
      "ResultsScene.ts",
      "HudScene.ts",
      "BeaconScene.ts",
      "PreflightScene.ts",
    ]) {
      const v = verdicts.find((x) => x.base === base);
      expect(v, `${base} is gone`).toBeDefined();
      expect(v?.found, `${base} painted its own plate again - UR-69`).toEqual([]);
    }
  });
});

describe("one implementation, and the kit reaches it", () => {
  const ui = (name: string): string =>
    code(readFileSync(path.join(ROOT, "src", "game", "ui", name), "utf8"));
  const lib = (name: string): string =>
    code(readFileSync(path.join(SCENES, "lib", name), "utf8"));

  it("is ui/plate.ts, and it exists", () => {
    const plate = code(readFileSync(COMPONENT, "utf8"));
    expect(plate).toMatch(/export function paintPlate\b/);
    expect(plate).toMatch(/export function drawPlate\b/);
    expect(plate).toMatch(/export function paintFocusRing\b/);
  });

  it("is the only thing lib/kit.ts paints a plate with", () => {
    // WATCHED FAILING: paste the shipped body of `kit.plate` back in -
    // `g.fillStyle(...); g.fillRoundedRect(x, y, w, h, options.radius ?? ...)`
    // - and this reports "lib/kit.ts paints its own rounded rect: expected
    // true to be false".
    const kit = lib("kit.ts");
    expect(/RoundedRect\s*\(/.test(kit), "lib/kit.ts paints its own rounded rect").toBe(false);
    expect(kit).toMatch(/from "@game\/ui\/plate"/);
  });

  it("is the only thing lib/typedWord.ts paints a word plate with", () => {
    const typed = lib("typedWord.ts");
    expect(typed).toMatch(/paintPlate\(/);
  });

  it("takes every colour from a token, so no ink can dodge AC-22.8", () => {
    // The same guard `controlSurface.ts` is held to. A hex literal is the only
    // way an unmeasured ink reaches the screen.
    expect(code(readFileSync(COMPONENT, "utf8"))).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(ui("plateLayout.ts")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("draws no text, so nothing can reach the glass unmeasured", () => {
    // A plate is a SURFACE. What sits on it goes through `lib/kit.skyText`,
    // which is what registers a colour pair for V-22.8; a plate that drew its
    // own label would be a second, unmeasured path to the screen.
    const plate = code(readFileSync(COMPONENT, "utf8"));
    expect(plate).not.toMatch(/scene\.add\.text\(/);
    expect(plate).not.toMatch(/\bsetText\(/);
  });
});

/**
 * NEGATIVE CONTROLS - the detector can be made to fail, per call site, naming
 * the file.
 *
 * UR-69 asks for exactly this case by name: "a guard that fails on a raw
 * fillRoundedRect inside a scene file". The first one below is that guard's
 * headline, pasted back into a real scene's real source.
 *
 * WATCHED FAILING, with the pasted-back plate in `WarpScene.ts` FOR REAL - the
 * shared `plate(this, PANEL...)` call replaced by the graphics it used to be:
 *
 *   FAIL UR-69: a scene does not paint its own plate > WarpScene.ts
 *   AssertionError:
 *     WarpScene.ts:629: raw fillRoundedRect(PANEL.x, PANEL.y, PANEL.w,
 *     PANEL.h, 16) - a plate is drawn by ui/plate.drawPlate, not by a scene
 *     (UR-69)
 *     WarpScene.ts:631: raw strokeRoundedRect(PANEL.x, PANEL.y, PANEL.w,
 *     PANEL.h, 16) - a plate is drawn by ui/plate.drawPlate, not by a scene
 *     (UR-69): expected [ ...(2) ] to deeply equal []
 *
 *   FAIL UR-69: ... > the screens this ticket migrated stay migrated
 *     WarpScene.ts painted its own plate again - UR-69: expected [ ...(2) ] to
 *     deeply equal []
 *
 * Two call sites, two line numbers, one file named, and a second case that says
 * which ticket closed it - which is the whole ask.
 *
 * `lib/kit.ts` with its shipped body pasted back (`g.fillStyle(...);
 * g.fillRoundedRect(x, y, w, h, options.radius ?? SPACE.radius)`):
 *
 *   FAIL one implementation, and the kit reaches it > is the only thing
 *   lib/kit.ts paints a plate with
 *     lib/kit.ts paints its own rounded rect: expected true to be false
 *
 * And the state the tree was in before the migration, which is the sweep
 * finding the defect it was written for - six files red at once:
 *
 *   HudScene.ts:209      raw fillRoundedRect(x, y, w, h, HUD_RADIUS)
 *   PreflightScene.ts:463 raw fillRoundedRect(SHELF.x, SHELF.y, SHELF.w, ...)
 *   ResultsScene.ts:537  raw fillRoundedRect(r.x, r.y, r.w, r.h, SPACE.radius)
 *   StallScene.ts:100    raw fillRoundedRect(cardX, cardY, cardW, cardH, 20)
 *   WarpScene.ts:936     raw fillRoundedRect(METER.x, METER.y, METER.w, ...)
 *   kit.ts:134           raw fillRoundedRect(x, y, w, h, options.radius ?? ...)
 *
 */
describe("negative control: the detector can be made to fail", () => {
  const warp = files.find((f) => f.base === "WarpScene.ts")?.src ?? "";

  it("a bespoke plate pasted back into a scene is reported, per call site", () => {
    const sabotaged = `${warp}
      function tenthPlate(this: { add: { graphics(): Graphics } }) {
        const g = this.add.graphics();
        g.fillStyle(0x0e1116, 1);
        g.fillRoundedRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h, SPACE.radius);
        g.lineStyle(2, 0x243040, 0.9);
        g.strokeRoundedRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h, SPACE.radius);
      }`;
    // The DELTA, not the whole file: Warp has its own legitimate rounded rects
    // (the charge track is a pill, the streak texture is generated at boot), so
    // a control that asserted the total would move every time one of those did.
    const before = new Set(judge(warp, "WarpScene.ts"));
    const found = judge(sabotaged, "WarpScene.ts").filter((f) => !before.has(f));
    expect(found.length, found.join("\n")).toBe(2);
    for (const f of found) expect(f).toMatch(/^WarpScene\.ts:\d+: raw (fill|stroke)RoundedRect\(/);
    expect(found[0]).toContain("fillRoundedRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h, SPACE.radius)");
    expect(found[1]).toContain("strokeRoundedRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h, SPACE.radius)");
  });

  it("names the line, so the report points at the call and not at the file", () => {
    const sabotaged = "\n\n\n\ng.fillRoundedRect(1, 2, 3, 4, 5);";
    expect(judge(sabotaged, "StallScene.ts")[0]).toContain("StallScene.ts:5:");
  });

  it("an exempt drawing in the WRONG file is still a finding", () => {
    // Per call site AND per file. The beacon's mast is exempt in
    // `BeaconScene.ts`; the same eight numbers in the stage report are not,
    // because a file-level allowlist is what let the ninth copy in.
    const mast = "g.fillRoundedRect(-14, -58, 28, 152, 10);";
    expect(judge(mast, "BeaconScene.ts")).toEqual([]);
    expect(judge(mast, "ResultsScene.ts").length).toBe(1);
  });

  it("a comment describing the fix does not satisfy the check", () => {
    // The ticket board was once found grading a defect fixed on the strength of
    // prose describing it. Comments are blanked before anything is judged.
    const sabotaged = `
      /* drawPlate(this, PANEL, { rhythm: "card" }) is used below, honestly */
      // drawPlate(this, PANEL)
      g.fillRoundedRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h, 16);
    `;
    const found = judge(sabotaged, "ResultsScene.ts");
    expect(found.length).toBe(1);
    expect(found[0]).toContain("ResultsScene.ts:4:");
  });

  it("blanking a comment does not move the line numbers it reports", () => {
    // `code()` blanks comments in place rather than deleting them. A stripper
    // that collapsed them would report a call at the wrong line, which is a
    // guard that names a file and then sends you to the wrong part of it.
    const sabotaged = "/* one\ntwo\nthree */\ng.fillRoundedRect(1, 2, 3, 4, 5);";
    expect(judge(sabotaged, "HudScene.ts")[0]).toContain("HudScene.ts:4:");
  });

  it("a file that paints nothing is never reported", () => {
    expect(judge("export const x = 1;", "none")).toEqual([]);
  });

  it("calling the shared component is not a finding", () => {
    const good = `
      import { drawPlate } from "@game/ui/plate";
      drawPlate(this, PANEL, { fill: INK.panel, stroke: pal.accent, rhythm: "card" });
    `;
    expect(judge(good, "WarpScene.ts")).toEqual([]);
  });
});
