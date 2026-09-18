import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { LAYERS } from "@game/render/layers";
import { TYPE_SIZES } from "@game/ui/theme";

/**
 * THE NEAR-MISS DETECTOR (UR-69, coding-standards rule 3).
 *
 * ================== THE DEFECT ==================
 * "Padding, spacing, font family and size must be uniform across the entire
 * app; no one-offs." The census of the built preview found 159 distinct left
 * edges and, inside them, FIFTEEN PAIRS OF EDGES 1-8 PX APART:
 *
 *   Title 3 · DirectorMap 3 · Ending 4 · Settings 2 · Briefing 1 · Warp 1 ·
 *   Results 1 · Preflight 0 · Beacon 0
 *
 * A distinct left edge can be correct - a centred headline has one, and these
 * screens are mostly centred - but two edges five pixels apart cannot both be.
 * One of them is a nudge nobody took back out.
 *
 * ================== WHY A COUNT IS NOT A GUARD ==================
 * Five guards in this project have been green while the screen was visibly
 * wrong, and every one of them asserted a NUMBER. A budget of "no more than N
 * edges" passes a screen that moved the defect somewhere else, and it tells the
 * next person nothing about what to open. So this fails PER ELEMENT, with the
 * element's scene, its path in the display list, its text and its x - the shape
 * of `arch/liveryReaders.test.ts`, for the same reason.
 *
 * ================== WHAT IT READS ==================
 * `gauntlet/evidence/screens/census.json`, written by
 * `scripts/contact-sheet.mjs` off the BUILT PREVIEW. Not the source, not a
 * mock, not a headless scene: the real display list of the real bundle at
 * 1920x1080, which is the only artifact that has ever caught one of these.
 *
 * That makes this a test over an EVIDENCE FILE, and evidence goes stale. The
 * staleness cases below refuse a census that predates the fields this guard
 * needs, so "the file on disk is old" fails loudly instead of passing quietly.
 *
 * ================== WHAT COUNTS AS A LEFT EDGE ==================
 * An element claims a left edge when it DECLARES a left anchor: `originX === 0`.
 * That is the object's own statement about how it is positioned, read off the
 * live object, not inferred from where it happened to land.
 *
 * Three kinds of object are therefore not judged on their left edge, and none
 * of them is an exemption granted to a screen:
 *
 *   originX 0.5 / 1   centred or right-anchored. Its left edge is a function of
 *                     its own width, so "Pluto" and "Neptune" centred under
 *                     their own discs CANNOT share one. Driving those pairs to
 *                     zero would mean forbidding centred type.
 *   decor             a seeded-random rock, mote or silhouette on a parallax
 *                     plane declared `decor` in `render/layers.ts`. Its
 *                     position comes from the palette's seed.
 *   Zone              a pointer hit target. It draws nothing at all.
 *
 * The classifier is asserted below, in both directions: it has to find decor
 * (or it is matching nothing) and it has to leave most of the type alone (or it
 * is swallowing the game). Reclassifying a screen as weather to make this pass
 * fails `the classifier has not swallowed the app`.
 *
 * ================== WATCH IT FAIL ==================
 * Every failing string below was read off a red run (rule 4).
 *
 *   `TitleScene.buildQuiet` back to `skyText(this, 4, 0, ...)` and the tagline
 *   back to `skyText(this, 2, 178, ...)`, rebuilt, recaptured - two red:
 *
 *     UR-69 ... > Title has no near-miss pair
 *       Title: "type the way through the solar system." (Title/Container[14]/
 *       Container[1]/Text[6]) at x=202 is 2px from "KEY" (Title/Container[14]/
 *       Container[1]/Text[2]) at x=200: expected [ ...(2) ] to deeply equal []
 *
 *   `PLATE_RHYTHM.instrument.padX` back to `STEP.inset`, rebuilt, recaptured:
 *
 *     UR-69 ... > Warp has no near-miss pair
 *       Warp: "Destination: Saturn." at x=136 is 8px from "warp drive" at
 *       x=128: expected [ Array(1) ] to deeply equal []
 *
 *   `BriefingScene` sentence size back to the literal `36` with `TYPE.prose`
 *   deleted:
 *
 *     UR-69 ... > every size on the screen is on the type scale
 *       Briefing: "Mars is the red planet." is set at 36px, which is not on
 *       TYPE: expected [ ...(5) ] to deeply equal []
 *
 *   `layers.ts` with `decor: true` on every row, rebuilt, recaptured - the
 *   anti-gaming case, which is the one that matters most here:
 *
 *     the classifier is honest ... > the classifier has not swallowed the app
 *       Title, Warp, Beacon, Ending - every element was classified away; the
 *       decor classifier is eating the game:
 *       expected [ 'Title', 'Warp', 'Beacon', 'Ending' ] to deeply equal []
 *     the classifier is honest ... > only the world's weather is declared decor
 *       expected [] to deeply equal [ 'debris', 'shipFx', 'hud' ]
 *
 *   The old census (no `elements` array) put back on disk:
 *
 *     UR-69 ... > the census on disk is the one this guard needs
 *       Title: census.json has no per-element rows - re-run
 *       `node scripts/contact-sheet.mjs`:
 *       expected undefined to be an instance of Array
 *     the classifier is honest ... > finds decoration at all
 *       no element is classified as decor - `render/layers.ts`'s `decor` flag
 *       is not reaching the scene graph: expected 0 to be greater than 20
 *
 *   npx vitest run tests/unit/ui/nearMissEdges.test.ts --coverage.enabled=false
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const CENSUS = path.join(ROOT, "gauntlet", "evidence", "screens", "census.json");

/** Two left edges this far apart are never two decisions. */
const NEAR_MIN = 1;
const NEAR_MAX = 8;

/**
 * THE EXEMPTION LIST. It is one entry long and it is a FACE, not a screen.
 *
 * `theme.FONT_STACK` is the whole product's type stack and every screen but one
 * is set in it. The Title's wordmark is set in `TitleScene.FONT` - "a logo is
 * allowed its own face", which that file argues for at length and which is the
 * reason the mark does not look like a menu heading at 128 px.
 *
 * IT MAY ONLY SHRINK, and `no entry here is stale` below fails if the Title
 * stops using it, so a closed exemption cannot sit here unnoticed. Nothing else
 * is on it: no screen, no element and no pair of edges is exempt from the
 * near-miss cases.
 */
const SECOND_FACE: Record<string, string> = {
  '"Avenir Next"':
    "the Title's WORDMARK. A logo, not chrome - `TitleScene.FONT` carries the " +
    "argument. It is the only element in the game set in it, at the only size " +
    "in the game nothing else uses.",
};

interface Element {
  readonly scene: string;
  readonly path: string;
  readonly type: string;
  readonly decor: boolean;
  readonly originX: number | null;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly fontSize: string | null;
  readonly text: string | null;
}

interface Screen {
  readonly key: string;
  readonly edges?: number[];
  readonly sizes?: string[];
  readonly families?: string[];
  readonly elements?: Element[];
  readonly error?: string;
}

interface Census {
  readonly capturedAt: string;
  readonly totals: Record<string, number>;
  readonly screens: Screen[];
}

const census: Census | null = existsSync(CENSUS)
  ? (JSON.parse(readFileSync(CENSUS, "utf8")) as Census)
  : null;

const screens: Screen[] = census?.screens ?? [];

/** How an element is named when it fails, so a reader knows what to open. */
function name(e: Element): string {
  const said = e.text === null || e.text === "" ? "" : `${JSON.stringify(e.text)} `;
  return `${said}(${e.path})`;
}

/** Elements whose LEFT EDGE is a claim: drawn, composed, left-anchored. */
function judged(s: Screen): Element[] {
  return (s.elements ?? []).filter(
    (e) => !e.decor && e.type !== "Zone" && e.originX === 0,
  );
}

/** Every Text on the screen, decor or not - the type scale binds all of it. */
function typeOn(s: Screen): Element[] {
  return (s.elements ?? []).filter((e) => e.type === "Text" && e.fontSize !== null);
}

/**
 * Pairs of judged elements whose left edges are 1-8 px apart, as sentences.
 *
 * Reported per PAIR and not per edge, because the fix is always "move one of
 * these onto the other", and a reader needs both ends of it.
 */
function nearMisses(s: Screen): string[] {
  const items = [...judged(s)].sort((a, b) => a.x - b.x);
  const out: string[] = [];
  for (let i = 1; i < items.length; i += 1) {
    const left = items[i - 1] as Element;
    const right = items[i] as Element;
    const gap = Math.round(right.x) - Math.round(left.x);
    if (gap < NEAR_MIN || gap > NEAR_MAX) continue;
    out.push(
      `${s.key}: ${name(right)} at x=${right.x} is ${gap}px from ` +
        `${name(left)} at x=${left.x}`,
    );
  }
  return out;
}

describe("UR-69: no two left edges 1-8 px apart", () => {
  it("the census on disk is the one this guard needs", () => {
    expect(census, `no census at ${CENSUS} - run scripts/contact-sheet.mjs`).not.toBeNull();
    expect(screens.length, "the census captured no screens").toBeGreaterThan(8);
    for (const s of screens) {
      expect(s.error, `${s.key} failed to capture: ${s.error ?? ""}`).toBeUndefined();
      expect(
        s.elements,
        `${s.key}: census.json has no per-element rows - re-run ` +
          "`node scripts/contact-sheet.mjs`",
      ).toBeInstanceOf(Array);
    }
    // `originX` is what makes "is this a left edge" answerable. A census from
    // before the per-element walk has rows but no anchors, and every row would
    // silently drop out of `judged()` - a guard passing on an empty set.
    const anchored = screens.flatMap((s) => s.elements ?? []).filter((e) => e.originX !== null);
    expect(
      anchored.length,
      "no element in the census declares an originX - the census predates the " +
        "anchor field; re-run `node scripts/contact-sheet.mjs`",
    ).toBeGreaterThan(100);
  });

  /**
   * THE CASE. One per screen, named, so a failure says which screen to open
   * and a regression on the Pre-flight cannot hide behind eight green ones.
   */
  it.each(screens.map((s) => [s.key, s] as const))("%s has no near-miss pair", (_key, s) => {
    const off = nearMisses(s);
    expect(off, off.join("\n")).toEqual([]);
  });

  it("every size on the screen is on the type scale", () => {
    const off = screens.flatMap((s) =>
      typeOn(s)
        .filter((e) => !TYPE_SIZES.includes(Number.parseFloat(e.fontSize as string)))
        .map((e) => `${s.key}: ${name(e)} is set at ${e.fontSize}, which is not on TYPE`),
    );
    expect(off, off.join("\n")).toEqual([]);
  });

  it("every screen is set in one face, and the second one is named", () => {
    const off: string[] = [];
    for (const s of screens) {
      for (const family of s.families ?? []) {
        if (family.includes("Devanagari")) continue;
        if (family in SECOND_FACE) continue;
        off.push(`${s.key} is set in ${family}, which is not the product's stack`);
      }
    }
    expect(off, off.join("\n")).toEqual([]);
  });

  it("no entry in SECOND_FACE is stale", () => {
    // The exemption list may only shrink. A face nothing is set in any more has
    // to be DELETED, so the list cannot lie about the state of the game.
    const live = new Set(screens.flatMap((s) => s.families ?? []));
    const gone = Object.keys(SECOND_FACE).filter((f) => !live.has(f));
    expect(gone, `${gone.join(", ")} - no longer drawn; delete the entry`).toEqual([]);
  });
});

describe("the classifier is honest in both directions", () => {
  it("finds decoration at all", () => {
    // A classifier that matched nothing would judge the weather and report
    // dozens of pairs nobody can fix - which is the state this lane found.
    const decor = screens.flatMap((s) => s.elements ?? []).filter((e) => e.decor);
    expect(
      decor.length,
      "no element is classified as decor - `render/layers.ts`'s `decor` flag " +
        "is not reaching the scene graph",
    ).toBeGreaterThan(20);
  });

  it("the classifier has not swallowed the app", () => {
    // THE ANTI-GAMING CASE. The cheapest way to make every case above pass is
    // to call more of the screen weather, so this fails the moment a screen has
    // nothing left to judge.
    const empty = screens.filter((s) => judged(s).length === 0).map((s) => s.key);
    expect(
      empty,
      `${empty.join(", ")} - every element was classified away; the decor ` +
        "classifier is eating the game",
    ).toEqual([]);
    const judgedAll = screens.reduce((a, s) => a + judged(s).length, 0);
    expect(judgedAll, "fewer than 40 elements in the whole app are judged").toBeGreaterThan(40);
  });

  it("only the world's weather is declared decor", () => {
    // Read off `layers.ts` rather than off the capture, so the intent is
    // asserted where it is written. `debris` carries the typeable rocks,
    // `shipFx` the Lantern and `hud` a scene's own type: a `decor: true` on any
    // of the three would exempt composed content.
    const composed = LAYERS.filter((l) => !l.decor).map((l) => l.id);
    expect(composed).toEqual(["debris", "shipFx", "hud"]);
  });
});
