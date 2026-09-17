import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  KEEP_CLEAR_PAD,
  hitsKeepClear,
  keepClear,
  zoneBounds,
  zoneCoverage,
  type KeepClearShape,
} from "@game/render/keepClear";
import { DEBRIS_SPEC, OVERDRAWING_PLANES, type DebrisPlaneSpec } from "@game/render/layers";
import { FALLBACK_RADII, driftTile, type DriftMaterial, type TileOp } from "@game/render/tiles";
import { debrisTypesFor } from "@game/render/asteroid";
import { PALETTE_STOP_IDS } from "@game/render/palette";
import { titleKeepClear } from "@game/scenes/support/titleLayout";
import {
  LAMP_HALO_MAX,
  NODE_R,
  NODE_RIM,
  ROUTE_Y,
  lampY,
  mapKeepClear,
  nodeX,
} from "@game/scenes/support/mapLayout";
import { STOP_IDS } from "@engine/types";

/**
 * KEEP-CLEAR, ON EVERY SCREEN THAT REGISTERS ONE.
 *
 * ================== WHAT WAS REPORTED, TWICE ==================
 *   UR-06  a black asteroid drawn on top of the wordmark's "B" on the Title.
 *   UR-52  decorative debris drawn across the Director map: a black asteroid
 *          sat over MARS.
 *
 * Same defect, second screen. UR-06 was fixed with a rectangle assembled inside
 * `TitleScene.create()`, so the mechanism existed on exactly one screen and the
 * map never got it - which is the shape `docs/verification-gaps.md` documents
 * and which the starfield did too (stopped on the Title under UR-14, back in
 * the briefing window under UR-50.5).
 *
 * So this file does not test "the map is fixed". It tests the RULE, on BOTH
 * screens, across EVERY debris plane in `DEBRIS_SPEC` and EVERY stop - because
 * the asteroid-visibility gate that booted Mars only is exactly how Uranus
 * passed a defect (coding-standards rule 5).
 *
 * ================== WATCH THEM FAIL ==================
 * Every number below was READ OFF A RED RUN, not reasoned about. Break it,
 * run it, put the number back.
 *
 *   `keepClear: mapKeepClear()` deleted from DirectorMapScene.buildParallax
 *   -> "the two reported screens PASS their zones to buildParallax":
 *      `scenes/DirectorMapScene.ts: buildParallax has no keepClear`.
 *      Nothing else moves - the scene is Phaser, so the source guard is the
 *      only thing that can see it. That is why the guard exists.
 *
 *   `keepClear` dropped from parallax.ts's nearField driftTile call
 *   -> "every driftTile call in parallax.ts is handed the zones":
 *      `expected [ Array(1) ] to deeply equal []`.
 *
 *   `hitsKeepClear` circle branch forced false
 *   -> "with the keep-clear, Director map is untouched at every stop":
 *      `182 rock(s) cross Director map's own drawing: expected 182 to be +0`.
 *      The Title row stays green, which is the proof that the circles are what
 *      the map needed and the Title's rectangle could never have supplied.
 *
 *   `hitsKeepClear` rect branch forced false
 *   -> Title `1085 rock(s) cross Title's own drawing: expected 1085 to be +0`
 *      and the map rises to `954`.
 *
 *   ROCK_RIM 3 -> 0
 *   -> "a rock's painted RIM counts as ink": `expected false to be true`.
 *
 *   `KeepClear.circle` padding dropped (`r` instead of `r + pad`)
 *   -> "a planet keeps a margin": `expected 54 to be 82`, and
 *      "the map's planets are circles, one per stop": `expected 50 to be 78`.
 *
 *   npx vitest run tests/unit/render/keepClear.test.ts --coverage.enabled=false
 */

const W = 1920;
const H = 1080;

/** mulberry32, identical to the one `parallax.ts` seeds its content with. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// The geometry, on its own
// ---------------------------------------------------------------------------

describe("the keep-clear predicate measures EDGES, not centres", () => {
  const rect = keepClear().rect(500, 500, 100, 100, 0).zones();
  const circle = keepClear().circle(500, 500, 100, 0).zones();

  it("a rock whose CENTRE is outside but whose EDGE is inside is caught", () => {
    // This inversion is the whole defect class: the lane guard's centre-based
    // version put 67 px of rock inside the word lane and rendered "acon".
    expect(hitsKeepClear(400, 550, 10, rect)).toBe(false);
    expect(hitsKeepClear(400, 550, 120, rect)).toBe(true);
    expect(hitsKeepClear(300, 500, 150, circle)).toBe(true);
  });

  it("a circle zone is a DISC, not its bounding box", () => {
    // The corner of the box round a disc. A rect zone would reject a rock here;
    // a circle must not, because that is 27% more sky than the zone asked for -
    // and the map registers fourteen circles.
    const corner = 500 + 100 / Math.SQRT2 + 30;
    expect(hitsKeepClear(corner, corner, 1, circle)).toBe(false);
    expect(hitsKeepClear(corner, corner, 1, keepClear().rect(400, 400, 200, 200, 0).zones()))
      .toBe(true);
  });

  it("a rock's painted RIM counts as ink", () => {
    // `driftTile` strokes `towardLight(shape, light, 2.5)` OUTSIDE the outline,
    // so a rock that stops exactly on the zone still paints over it.
    expect(hitsKeepClear(500, 500 - 100 - 50 - 1, 50, circle)).toBe(true);
    expect(hitsKeepClear(500, 500 - 100 - 50 - 5, 50, circle)).toBe(false);
  });

  it("a planet keeps a margin, because a rock beside Mars still crosses it", () => {
    const [zone] = keepClear().circle(0, 0, NODE_R + NODE_RIM).zones();
    expect(zone?.kind).toBe("circle");
    expect(zone?.kind === "circle" ? zone.r : 0).toBe(NODE_R + NODE_RIM + KEEP_CLEAR_PAD);
  });

  it("zoneBounds covers both shapes, so a debug overlay cannot miss one", () => {
    expect(zoneBounds(circle[0] as KeepClearShape)).toEqual({
      x0: 400,
      y0: 400,
      x1: 600,
      y1: 600,
    });
    expect(zoneBounds(rect[0] as KeepClearShape)).toEqual({ x0: 500, y0: 500, x1: 600, y1: 600 });
  });
});

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

/**
 * Every radius profile the game draws a decorative rock with.
 *
 * The material's COLOUR cannot move a rock, but its `radii` shape its outline,
 * and `materialsFor` picks one per rock off `debrisTypesFor(stop)`. Sweeping
 * the stops is therefore sweeping the shapes, which is what a bounding box of
 * the drawn points depends on. Earth has no belt row (D57), so it falls through
 * to `FALLBACK_RADII` - included, so the launchpad is swept too.
 */
function materialsAt(stop: string): DriftMaterial[] {
  const types = debrisTypesFor(stop as never);
  const out: DriftMaterial[] = [];
  for (const type of types.slice(0, 3)) {
    for (const variant of type.variants.slice(0, 3)) {
      out.push({
        radii: variant.radii,
        facets: variant.facets.map((f) => ({ x: f.x, y: f.y, r: f.r })),
        fill: type.fill,
        facet: type.facet,
        rim: type.rim,
      });
    }
  }
  if (out.length === 0) {
    out.push({
      radii: FALLBACK_RADII,
      facets: [],
      fill: "#202830",
      facet: "#303840",
      rim: null,
    });
  }
  return out;
}

/** Every drawn point's bounding box, so the sweep measures INK, not inputs. */
function inkBoxes(ops: readonly TileOp[]): { x0: number; x1: number; y0: number; y1: number }[] {
  return ops
    .filter((o): o is Extract<TileOp, { kind: "poly" }> => o.kind === "poly")
    .map((o) => {
      const xs = o.points.map((p) => p.x);
      const ys = o.points.map((p) => p.y);
      return {
        x0: Math.min(...xs),
        x1: Math.max(...xs),
        y0: Math.min(...ys),
        y1: Math.max(...ys),
      };
    });
}

/**
 * Does this ink box cross a zone?
 *
 * An INDEPENDENT measure: `hitsKeepClear` decides with the rock's construction
 * centre and radius, this reads the polygon the tile actually emits. If the two
 * ever disagree the sweep fails, which is the point - a guard that re-runs the
 * implementation it is guarding is `f(x) === f(x)`.
 */
function crosses(
  b: { x0: number; x1: number; y0: number; y1: number },
  zones: readonly KeepClearShape[],
): boolean {
  for (const z of zones) {
    const g = zoneBounds(z);
    if (b.x1 <= g.x0 || b.x0 >= g.x1 || b.y1 <= g.y0 || b.y0 >= g.y1) continue;
    if (z.kind === "rect") return true;
    // Circle: the closest point of the ink box to the disc's centre.
    const nx = Math.min(Math.max(z.cx, b.x0), b.x1);
    const ny = Math.min(Math.max(z.cy, b.y0), b.y1);
    if ((nx - z.cx) ** 2 + (ny - z.cy) ** 2 < z.r ** 2) return true;
  }
  return false;
}

const SEEDS = [0x0d13, 0x1a17e, 0x5eed, 1, 2, 3, 4, 5, 6, 7];

interface Screen {
  readonly name: string;
  readonly zones: readonly KeepClearShape[];
  /** The planes this screen tells `buildParallax` to decorate. */
  readonly planes: readonly (keyof typeof DEBRIS_SPEC)[];
}

const SCREENS: readonly Screen[] = [
  {
    name: "Title",
    zones: titleKeepClear(W),
    // `TitleScene` passes no `decorate`, i.e. the full stack.
    planes: ["farField", "midField", "debris", "nearField", "foreVeil"],
  },
  {
    name: "Director map",
    zones: mapKeepClear(),
    planes: ["farField", "midField", "nearField"],
  },
];

function sweep(screen: Screen, zones: readonly KeepClearShape[]): number {
  let hits = 0;
  for (const stop of PALETTE_STOP_IDS) {
    const materials = materialsAt(stop);
    for (const plane of screen.planes) {
      const spec = DEBRIS_SPEC[plane] as DebrisPlaneSpec;
      for (const seed of SEEDS) {
        const ops = driftTile(W, H, {
          materials,
          ...spec,
          light: 0,
          keepClear: zones,
          rand: rng(seed),
        });
        hits += inkBoxes(ops).filter((b) => crosses(b, screen.zones)).length;
      }
    }
  }
  return hits;
}

describe("UR-52 / UR-06: debris keeps off what the screen drew", () => {
  for (const screen of SCREENS) {
    it(`NEGATIVE CONTROL: without a keep-clear, ${screen.name} IS hit`, () => {
      // Without this, a green sweep below would be evidence of nothing - the
      // seed could simply have put no rock there. `shardTint.test.ts` asserted
      // `f(x) === f(x)` and passed forever (coding-standards rule 4).
      const hits = sweep(screen, []);
      expect(hits, `${screen.name} was clean even with NO guard`).toBeGreaterThan(0);
    });

    it(`with the keep-clear, ${screen.name} is untouched at every stop`, () => {
      const hits = sweep(screen, screen.zones);
      expect(hits, `${hits} rock(s) cross ${screen.name}'s own drawing`).toBe(0);
    });

    it(`${screen.name}'s field is still populated - the guard drops, it does not empty`, () => {
      // The other way to fail UR-52: no asteroid on Mars because there are no
      // asteroids. Rubric item 2 wants the frame alive.
      let kept = 0;
      for (const plane of screen.planes) {
        const spec = DEBRIS_SPEC[plane] as DebrisPlaneSpec;
        for (const seed of SEEDS) {
          kept += driftTile(W, H, {
            materials: materialsAt("mars"),
            ...spec,
            light: 0,
            keepClear: screen.zones,
            rand: rng(seed),
          }).filter((o) => o.kind === "poly").length;
        }
      }
      expect(kept / SEEDS.length).toBeGreaterThan(3);
    });
  }

  it("the map's planets are circles, one per stop, on the route", () => {
    const zones = mapKeepClear();
    for (let i = 0; i < STOP_IDS.length; i += 1) {
      const planet = zones.find(
        (z) => z.kind === "circle" && z.cy === ROUTE_Y && Math.abs(z.cx - nodeX(i)) < 0.001,
      );
      expect(planet, `no keep-clear for ${STOP_IDS[i]}`).toBeDefined();
      const lamp = zones.find(
        (z) => z.kind === "circle" && z.cy === lampY() && Math.abs(z.cx - nodeX(i)) < 0.001,
      );
      expect(lamp, `no keep-clear for ${STOP_IDS[i]}'s beacon`).toBeDefined();
      expect(lamp?.kind === "circle" ? lamp.r : 0).toBe(LAMP_HALO_MAX + KEEP_CLEAR_PAD);
    }
  });

  it("neither screen's zones eat the frame", () => {
    // Over-covering is the other failure mode and it is silent: the screen just
    // goes flat. Measured, so the number is in the record rather than guessed.
    for (const screen of SCREENS) {
      const cover = zoneCoverage(screen.zones, W, H);
      expect(cover, `${screen.name} covers ${(cover * 100).toFixed(1)}% of the sky`)
        .toBeLessThan(0.6);
    }
  });
});

// ---------------------------------------------------------------------------
// The mechanism is SHARED - this is the half UR-06's fix did not have
// ---------------------------------------------------------------------------

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game");
const read = (f: string): string => readFileSync(resolve(SRC, f), "utf8");
/** Source with comments stripped, so a guard cannot read an excuse. */
const code = (f: string): string =>
  read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("the keep-clear mechanism is shared, not re-derived per screen", () => {
  it("every driftTile call in parallax.ts is handed the zones", () => {
    // UR-06's fix reached two of the five planes. `farField`, `midField` and
    // `debris` were left out, and a rock BEHIND unplated type ruins the read
    // just as thoroughly as one in front of it - which is what a wordmark on
    // open sky is.
    const src = code("render/parallax.ts");
    const calls = [...src.matchAll(/driftTile\(W, H, \{([\s\S]*?)\n {6,}\}\)/g)];
    expect(calls.length, "parallax.ts stopped calling driftTile the usual way").toBe(5);
    const missing = calls.filter((m) => !(m[1] ?? "").includes("keepClear"));
    expect(missing.map((m) => (m[1] ?? "").slice(0, 60))).toEqual([]);
  });

  it("both screens build their zones with the shared builder", () => {
    for (const f of ["scenes/support/titleLayout.ts", "scenes/support/mapLayout.ts"]) {
      expect(code(f), f).toContain("keepClear()");
      expect(code(f), f).toContain("@game/render/keepClear");
    }
  });

  it("no scene assembles a keep-clear rect literal of its own any more", () => {
    // The UR-06 shape: `keepClear: [{ x: ..., y: ..., w: ..., h: ... }]` inside
    // a `create()`. That is the thing that could not be reused and could not be
    // tested, so the guard is against the PLACEMENT, not against the values.
    const offenders: string[] = [];
    for (const f of ["scenes/TitleScene.ts", "scenes/DirectorMapScene.ts"]) {
      if (/keepClear:\s*\[/.test(code(f))) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it("the two reported screens PASS their zones to buildParallax", () => {
    // The zones existing is not the fix; the scene handing them over is. This
    // is the line that was deleted to watch the map fail - see the header.
    for (const [file, builder] of [
      ["scenes/TitleScene.ts", "titleKeepClear"],
      ["scenes/DirectorMapScene.ts", "mapKeepClear"],
    ] as const) {
      const src = code(file);
      const call = /buildParallax\(this, \{([\s\S]*?)\n {4}\}\)/.exec(src);
      expect(call, `${file}: buildParallax is not called the usual way`).not.toBeNull();
      expect(call?.[1] ?? "", `${file}: buildParallax has no keepClear`).toContain("keepClear");
      // ...and the zones it hands over come from the shared builder, not from
      // a literal assembled in `create()` (which is what UR-06 shipped).
      expect(src, `${file}: does not call ${builder}`).toContain(`${builder}(`);
    }
  });

  it("a screen that decorates an overdrawing plane must register zones", () => {
    // `nearField` (depth 5) and `foreVeil` (6.5) draw in FRONT of anything a
    // still screen puts at depth 4 or lower - which is exactly how a rock got
    // on top of Mars. Every plane named here is in DEBRIS_SPEC, so a new one
    // cannot be added without this sweep seeing it.
    for (const plane of OVERDRAWING_PLANES) {
      expect(DEBRIS_SPEC[plane], `${plane} has no debris budget`).toBeDefined();
    }
    for (const screen of SCREENS) {
      const overdraws = screen.planes.some((p) => OVERDRAWING_PLANES.includes(p));
      expect(overdraws && screen.zones.length > 0, `${screen.name}`).toBe(true);
    }
  });
});
