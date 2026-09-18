import { describe, expect, it } from "vitest";
import { BELT_STOP_IDS, STOP_IDS, isBeltStop, type StopId } from "@engine/types.js";
import {
  DEBRIS_SEPARATION,
  MIN_ROCK_LUMA,
  depthRamp,
  foregroundObjectInk,
  luma255,
  paletteFor,
  skyStops,
  skyStopsLate,
} from "@game/render/palette.js";
import { planeMaterialColor } from "@game/render/tiles.js";
import {
  DEBRIS_BY_STOP,
  LIT_FACE_MIN_STEP,
  debrisTypesFor,
  wordDebrisTypesFor,
  wordRockFill,
  type DebrisType,
} from "@game/render/asteroid.js";

/**
 * THE FR-12b TABLE IS SWEPT, NOT SAMPLED (coding-standards rule 5).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS FOR, AND THE REPORT THAT CAUSED IT
 *
 * A defect was reported against `DEBRIS_BY_STOP.earth` being `[]`: the claim was
 * that the empty entry made the decorative debris on the Earth activation screen
 * render as pure black silhouettes against the navy sky, and that Flight at
 * Earth would crash. Both halves were measured before anything was changed, and
 * NEITHER IS WHAT HAPPENS:
 *
 *   1. `parallax.materialsFor` has an explicit branch for a stop with no table
 *      row. It emits one generic rounded rock at `planeMaterialColor(planeFill,
 *      sky, planeFill, lift, 1)`, and a bond of 1 means that expression IS the
 *      plane's own fill. Measured at Earth: farField `#133465` (luminance 47.7),
 *      midField `#263D66` (58.8), debris plane `#384564` (68.6). Nothing there
 *      is black, and nothing is near it.
 *
 *   2. The near-black objects on that screen are `foregroundObjectInk`, which
 *      is deliberate and documented in `palette.ts` as "the darkest thing in
 *      frame at every stop". Earth's is 9.4. So are Neptune's 7.3, Uranus'
 *      11.2 and Pluto's 12.7. Earth is not an outlier; it is the same
 *      construction every stop gets.
 *
 *   3. The only place the empty entry is unsafe is `FlightScene.spawnRock`,
 *      where `types[i % Math.max(1, 0)]` is `undefined` and `variantFor` would
 *      throw on it. That state is unreachable: D57 makes Earth the launchpad and
 *      AC-12.1 clears it with one typed word, so Flight never opens there. It is
 *      already on the record in `gauntlet/escalations.md` as a latent, named,
 *      unreachable state rather than a live crash.
 *
 * SO EARTH KEEPS ITS EMPTY BELT. D57 (decision log, highest precedence) and PRD
 * FR-12b (no Earth row) both say the launchpad has none, and `asteroid.ts`'s own
 * header records that adding a type FR-12b does not list fails AC-12b.1.
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS ACTUALLY MISSING, WHICH IS THE PART THE REPORT GOT RIGHT
 *
 * Nothing swept the table. `wordRockSeparation.test.ts` derives its stop list
 * with `PALETTE_STOP_IDS.filter((id) => wordDebrisTypesFor(id).length > 0)` - a
 * list built FROM the table - so a stop whose entry is empty or short drops
 * silently out of every assertion in that file and reports nothing. Its
 * anti-vacuity guard is `expect(STOPS_WITH_A_BELT.length).toBe(6)`, which an
 * eighth stop added with an empty list would still satisfy.
 *
 * This file closes that. The stop list here comes from `STOP_IDS` and
 * `BELT_STOP_IDS` in `@engine/types` - the game's own declaration of which stops
 * exist and which have a belt - never from the table under test. A stop added to
 * the game with no debris row, or with a row too thin to draw, fails here by
 * name, and so does a material at any stop drawn in black.
 */

const skyLumasOf = (id: StopId): number[] => {
  const p = paletteFor(id);
  return [...skyStops(p), ...skyStopsLate(p)].map(luma255);
};

/** Every colour the table hands the renderer, per type, with its role. */
function materialColours(type: DebrisType): { role: string; hex: string }[] {
  const out = [
    { role: "fill", hex: type.fill },
    { role: "facet", hex: type.facet },
    { role: "rim", hex: type.rim },
  ];
  if (type.glint !== null) out.push({ role: "glint", hex: type.glint });
  return out;
}

const HEX6 = /^#[0-9A-Fa-f]{6}$/;

describe("AC-12b.1 / AC-12b.2: the debris table is complete at every stop the game has", () => {
  /**
   * THE HOLE THIS CLOSES. The partition is asserted from `STOP_IDS` and
   * `isBeltStop`, which are the ENGINE's statement of what exists, so the table
   * cannot define its own coverage. Both directions are checked: a belt stop
   * with nothing, and a belt-free stop that grew something.
   *
   * WATCHED FAILING, both directions, with the table edited and restored:
   *   `mars: []`                 -> "mars is a belt stop (BELT_STOP_IDS) and has
   *                                 0 word-carrying debris types"
   *   `earth: [<mars-regolith>]` -> "earth has no belt (D57, AC-12.1) and must
   *                                 have 0 word-carrying debris types, has 1"
   */
  it("AC-12b.1: every stop is either a belt stop with materials or the launchpad with none", () => {
    expect(STOP_IDS.length, "the game's stop list is not empty").toBe(7);
    // Every key in the table is a real stop, and every real stop is a key.
    expect(Object.keys(DEBRIS_BY_STOP).sort()).toEqual([...STOP_IDS].sort());

    let beltStops = 0;
    for (const id of STOP_IDS) {
      const carriers = wordDebrisTypesFor(id);
      if (isBeltStop(id)) {
        beltStops += 1;
        expect(
          carriers.length,
          `${id} is a belt stop (BELT_STOP_IDS) and has ${carriers.length} word-carrying debris types`,
        ).toBeGreaterThanOrEqual(1);
      } else {
        expect(
          carriers.length,
          `${id} has no belt (D57, AC-12.1) and must have 0 word-carrying debris types, has ${carriers.length}`,
        ).toBe(0);
      }
    }
    expect(beltStops, "BELT_STOP_IDS and STOP_IDS disagree about how many belts exist").toBe(
      BELT_STOP_IDS.length,
    );
  });

  /**
   * Structure, per type, at every stop - including the ambient types that never
   * carry a word, because `parallax.materialsFor` draws those too.
   *
   * WATCHED FAILING with `uranus-dark-ice` cut to two variants:
   *   "uranus/uranus-dark-ice has 2 silhouette variants; AC-12b.2 requires 3"
   */
  it("AC-12b.2: every debris type at every stop is drawable - 3+ variants, real profile, own stop", () => {
    const seenIds = new Set<string>();
    let typesSwept = 0;
    for (const id of STOP_IDS) {
      for (const type of debrisTypesFor(id)) {
        typesSwept += 1;
        expect(type.stop, `${type.id} is filed under ${id} but declares stop ${type.stop}`).toBe(id);
        expect(seenIds.has(type.id), `duplicate debris id ${type.id}`).toBe(false);
        seenIds.add(type.id);
        expect(type.label.trim().length, `${id}/${type.id} has an empty FR-12b label`).toBeGreaterThan(0);
        expect(type.source, `${id}/${type.id} source is not a NASA URL`).toMatch(/^https:\/\//);
        expect(
          type.variants.length,
          `${id}/${type.id} has ${type.variants.length} silhouette variants; AC-12b.2 requires 3`,
        ).toBeGreaterThanOrEqual(3);
        for (const v of type.variants) {
          expect(v.radii.length, `${id}/${type.id}/${v.id} has too few radius samples`).toBeGreaterThanOrEqual(6);
          const min = Math.min(...v.radii);
          const max = Math.max(...v.radii);
          // art-direction section 4: "rounded, chunky, friendly; no sharp
          // spikes". Measured floor across the whole table today is 0.79.
          expect(min, `${id}/${type.id}/${v.id} dips to ${min.toFixed(2)}r - that is a spike`).toBeGreaterThan(0.7);
          expect(max, `${id}/${type.id}/${v.id} exceeds its own radius`).toBeLessThanOrEqual(1);
        }
      }
    }
    // A sweep over an empty table is not a sweep. 13 types ship today.
    expect(typesSwept, "the table swept no types at all").toBeGreaterThanOrEqual(13);
  });
});

describe("AC-22.4: no material at any stop is drawn in black", () => {
  /**
   * WHY `MIN_ROCK_LUMA` IS THE RIGHT BAR FOR THE RAW `fill`, AND NOT A NEW ONE.
   *
   * A GAMEPLAY rock never wears `type.fill`: `wordRockFill` moves the body onto
   * `rockLumaWindow`, so even a black material would come back lifted (measured:
   * `withLuma255("#000000", 100)` is `#636363`). The raw hex reaches the screen
   * on the DECORATIVE path instead - `parallax.materialsFor` passes `type.fill`
   * through `planeMaterialColor`, which lifts toward the sky and bonds toward the
   * plane but has no floor of its own. `MIN_ROCK_LUMA` is palette.ts's existing
   * statement of where a rock stops being a material and becomes a hole in the
   * picture, so it is the bar reused, not a bar invented.
   *
   * Measured across all seven stops today, darkest first:
   *   uranus/uranus-dark-ice  46.0   jupiter/c-type   54.7   jupiter/trojan  66.7
   * The bar is 24.
   *
   * WATCHED FAILING with uranus' fill set to `#000000`:
   *   "uranus/uranus-dark-ice fill #000000 is luminance 0.0, under the
   *    MIN_ROCK_LUMA floor of 24"
   */
  it("AC-22.4: every fill at every stop clears MIN_ROCK_LUMA on the decorative path", () => {
    let checked = 0;
    for (const id of STOP_IDS) {
      for (const type of debrisTypesFor(id)) {
        for (const { role, hex } of materialColours(type)) {
          expect(hex, `${id}/${type.id} ${role} "${hex}" is not a 6-digit hex`).toMatch(HEX6);
        }
        const v = luma255(type.fill);
        checked += 1;
        expect(
          v,
          `${id}/${type.id} fill ${type.fill} is luminance ${v.toFixed(1)}, under the MIN_ROCK_LUMA floor of ${MIN_ROCK_LUMA}`,
        ).toBeGreaterThanOrEqual(MIN_ROCK_LUMA);
      }
    }
    expect(checked).toBeGreaterThanOrEqual(13);
  });

  /**
   * THE RIM AND THE GLINT ARE THE ONLY COLOURS `drawDebris` SETS RAW.
   *
   * The body is `wordRockFill`, the lit face is `wordRockLitFace` and the facet
   * is `wordRockFacet` - all three are value-controlled. `type.rim` and
   * `type.glint` are passed to `lineStyle`/`fillStyle` unchanged, so a dark rim
   * is a rim nobody sees, and a black one paints shadow where the light is. The
   * step reused is `LIT_FACE_MIN_STEP` (18), which is this file's existing
   * statement of how far above the body a LIT feature has to sit.
   *
   * Measured over all seven stops, tightest first:
   *   rim   jupiter/c-type   +63.8      glint  neptune/icy-body  +104.4
   *         jupiter/trojan  +104.3             saturn/ice-chunk  +146.0
   *
   * WATCHED FAILING with uranus' rim set to `#000000`:
   *   "uranus/uranus-dark-ice rim #000000 sits 26.7 BELOW the body it is drawn
   *    on (rim 0.0, body 26.7); a lit edge must be at least 18 above"
   */
  it("AC-22.4: the rim and the glint sit above the body at every stop", () => {
    let checked = 0;
    for (const id of STOP_IDS) {
      for (const type of debrisTypesFor(id)) {
        const body = luma255(wordRockFill(type, null));
        for (const { role, hex } of materialColours(type)) {
          if (role !== "rim" && role !== "glint") continue;
          checked += 1;
          const step = luma255(hex) - body;
          expect(
            step,
            `${id}/${type.id} ${role} ${hex} sits ${Math.abs(step).toFixed(1)} ${step < 0 ? "BELOW" : "above"} the body it is drawn on (${role} ${luma255(hex).toFixed(1)}, body ${body.toFixed(1)}); a lit edge must be at least ${LIT_FACE_MIN_STEP} above`,
          ).toBeGreaterThanOrEqual(LIT_FACE_MIN_STEP);
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(13);
  });

  /**
   * art-direction section 4: "a subtle 2-tone fill (base + one darker
   * crater/facet shape)". The DRAWN facet is value-forced by `wordRockFacet`,
   * but the table is what declares which of the two tones is the darker one, and
   * a table whose facet is lighter than its fill has inverted the crater.
   *
   * Measured, tightest first: jupiter/c-type 20.2, jupiter/trojan 29.4,
   * neptune/icy-body 30.2. Asserted on the sign, with the tightest recorded.
   *
   * WATCHED FAILING with mars' facet and fill swapped:
   *   "mars/mars-regolith facet #B5522A (107.0) is not darker than its fill
   *    #7A2E17 (66.1)"
   */
  it("AC-22.4: the facet tone is the darker of the two at every stop", () => {
    for (const id of STOP_IDS) {
      for (const type of debrisTypesFor(id)) {
        const f = luma255(type.fill);
        const c = luma255(type.facet);
        expect(
          c,
          `${id}/${type.id} facet ${type.facet} (${c.toFixed(1)}) is not darker than its fill ${type.fill} (${f.toFixed(1)})`,
        ).toBeLessThan(f);
      }
    }
  });
});

describe("AC-12.1: a stop with no belt still draws visible scenery", () => {
  /**
   * THE QUESTION NOBODY HAD ASKED ABOUT EARTH.
   *
   * The empty entry is correct, but "correct" was only ever an argument from
   * D57; nothing measured what the launchpad actually renders. These two
   * assertions are that measurement, and they sweep every stop rather than
   * pointing at Earth, so a second belt-free stop would be covered on arrival.
   */

  /**
   * The fallback's defining property, asserted rather than trusted: with a bond
   * of 1, `planeMaterialColor` returns the plane's own fill exactly. That is
   * what makes "no table row" mean "the plane's colour" and not "black" - the
   * table is not consulted at all, so it cannot contribute a value.
   *
   * WATCHED FAILING with the reconstruction's bond dropped to 0.55:
   *   "earth midField fallback is #233B66, not the plane's own #263D66"
   *
   * midField and not farField, which is worth writing down: farField's lift is
   * 0, so its atmospheric pass is the identity and bonding a colour toward
   * ITSELF cannot move it at any weight. The far plane survives a broken bond by
   * accident. Sweeping all three planes is what makes the control land.
   */
  it("AC-12.1: the no-belt fallback takes the plane's own fill, so an empty table cannot darken it", () => {
    let planes = 0;
    for (const id of STOP_IDS) {
      if (isBeltStop(id)) continue;
      expect(debrisTypesFor(id)).toHaveLength(0);
      const p = paletteFor(id);
      const sky = skyStops(p)[1];
      const ramp = depthRamp(p, 4);
      // The three decorated planes `parallax.buildParallax` gives a ramp band to.
      const names = ["farField", "midField", "debris"] as const;
      for (let i = 0; i < names.length; i += 1) {
        const planeFill = ramp[i] as string;
        const lift = i / 3;
        const fallback = planeMaterialColor(planeFill, sky, planeFill, lift, 1);
        planes += 1;
        expect(
          fallback,
          `${id} ${names[i]} fallback is ${fallback}, not the plane's own ${planeFill}`,
        ).toBe(planeFill);
        const v = luma255(fallback);
        expect(
          v,
          `${id} ${names[i]} draws its decorative debris at luminance ${v.toFixed(1)}, under the MIN_ROCK_LUMA floor of ${MIN_ROCK_LUMA}`,
        ).toBeGreaterThanOrEqual(MIN_ROCK_LUMA);
      }
    }
    // Earth is the only belt-free stop today; three planes.
    expect(planes, "no belt-free stop was swept").toBeGreaterThanOrEqual(3);
  });

  /**
   * `foregroundObjectInk` IS THE NEAR-BLACK, AND IT IS THE SAME EVERYWHERE.
   *
   * The nearField and foreVeil rocks are drawn in it at every stop, belt or not,
   * and palette.ts states outright that it is meant to be the frame's darkest
   * element. So the check is not "is it dark" - it is that Earth is built the
   * same way the other six are, and that no stop's ink has collapsed to pure
   * black. Measured, all seven:
   *
   *   neptune 7.3 · earth 9.4 · uranus 11.2 · pluto 12.7 · mars 24.6 ·
   *   jupiter 26.8 · saturn 30.3        against each stop's darkest sky value:
   *   12.7 · 15.9 · 18.7 · 21.8 · 42.4 · 46.0 · 52.2
   *
   * WATCHED FAILING with `foregroundObjectInk` returning `"#000000"`:
   *   "earth foreground ink #000000 is luminance 0.0 - pure black is not a
   *    value, it is the absence of one"
   */
  it("AC-22.4: every stop's foreground ink is the darkest element and none of them is black", () => {
    const readings: string[] = [];
    for (const id of STOP_IDS) {
      const p = paletteFor(id);
      const ink = foregroundObjectInk(p);
      const v = luma255(ink);
      const darkestSky = Math.min(...skyLumasOf(id));
      readings.push(`${id} ${v.toFixed(1)} vs sky ${darkestSky.toFixed(1)}`);
      expect(
        v,
        `${id} foreground ink ${ink} is luminance ${v.toFixed(1)} - pure black is not a value, it is the absence of one`,
      ).toBeGreaterThan(0);
      expect(
        darkestSky - v,
        `${id} foreground ink ${ink} (${v.toFixed(1)}) is not darker than its own darkest sky (${darkestSky.toFixed(1)}); the near objects would stop silhouetting`,
      ).toBeGreaterThan(0);
    }
    expect(readings).toHaveLength(7);
  });
});

describe("AC-22.4: the sweep itself cannot go vacuous", () => {
  /**
   * `wordRockSeparation.test.ts` derives its stop list from the table, so this
   * file is the one that has to prove the list it sweeps is the game's. If
   * `STOP_IDS` and the table ever disagree, every loop above still runs - over
   * the stops the ENGINE declares - and the missing entry is named.
   */
  it("AC-12b.1: the swept list is the engine's stop list, not the table's own keys", () => {
    const fromTable = Object.keys(DEBRIS_BY_STOP);
    const fromEngine = [...STOP_IDS] as string[];
    expect(fromEngine).toContain("earth");
    expect(fromEngine.length).toBe(fromTable.length);
    for (const id of fromEngine) {
      expect(fromTable, `${id} exists in the game but has no row in DEBRIS_BY_STOP`).toContain(id);
    }
    // And the separation bar this all feeds is the one palette.ts declares.
    expect(DEBRIS_SEPARATION).toBe(18);
    expect(MIN_ROCK_LUMA).toBe(24);
    expect(LIT_FACE_MIN_STEP).toBe(18);
  });
});
