import { describe, expect, it } from "vitest";
import {
  PALETTE_STOP_IDS,
  ROCK_SKY_SPAN,
  SKY_SWEEP_CLEARANCE,
  luma255,
  mixHex,
  paletteAt,
  paletteFor,
  skyStops,
  skyStopsLate,
  type StopPalette,
} from "@game/render/palette.js";
import {
  DEBRIS_BY_STOP,
  LIT_FACE_INNER,
  MEASURED_CORE,
  TERMINATOR_INNER,
  drawDebris,
  wordDebrisTypesFor,
  wordRockFill,
  wordRockLitFace,
  type DebrisType,
} from "@game/render/asteroid.js";

/**
 * UR-47: A WORD-ASTEROID IS VISIBLE AGAINST OPEN SKY, AT EVERY HEIGHT.
 *
 * ---------------------------------------------------------------------------
 * UR-47, THE OLDEST OPEN USER-REPORTED TICKET, AND WHY THE CHECKS MISSED IT
 *
 * UR-47: word-asteroids cannot be seen against open sky. Reported once,
 * recorded as fixed twice. It was never fixed, because nothing that claimed to
 * guarantee it was bound to the thing that draws a rock:
 *
 *   1. `StopPalette.debris` HAS NO CONSUMER ON THE GAMEPLAY PATH.
 *      `pickDebris` in `render/palette.ts` chooses it against the sky and the
 *      silhouette planes, and `tests/unit/render/depth.test.ts` asserts the
 *      result. `FlightScene.spawnRock` does not use it: it draws each rock from
 *      the FR-12b material table (`DebrisType.fill`) and passes
 *      `fillOverride: null` in normal mode. `StopPalette.debris` is read by
 *      `depthRamp` and by one fallback in `parallax.ts`. A field with a writer,
 *      a rule and a unit test, and no reader where it mattered -
 *      `docs/verification-gaps.md` instance 5, to the letter.
 *
 *   2. CLEARING THE THREE SKY STOPS IS NOT CLEARING THE SKY. The sky is a
 *      CONTINUOUS gradient and a rock falls through all of it. Any fill whose
 *      luminance lies strictly between two neighbouring stop luminances is
 *      matched EXACTLY by the sky at one height, by the intermediate value
 *      theorem. On Mars the shipped fill sat 23.7 from the nearest sky stop and
 *      0.0 from the gradient.
 *
 * So this file asserts the property in the units the V-22.4 probe measures, on
 * the colour `drawDebris` ACTUALLY SETS, for every stop, every material and both
 * palettes - and it carries the negative control that proves it can fail.
 *
 * ---------------------------------------------------------------------------
 * MEASURED ON THE SHIPPING GAME, NOT ARGUED FROM HERE
 *
 * Six stops, seven rocks each placed at a known height, scene FROZEN so the
 * pixels and the coordinates come from one frame, screenshot decoded as a PNG
 * (never read off a live WebGL canvas), scored by
 * `tests/gauntlet/silhouette.mjs measureSilhouettes` against its 0.06 bar:
 *
 *   stop      worst separation BEFORE        worst AFTER
 *   saturn    0.0062  (in 227.4 / out 225.8)     0.1999
 *   neptune   0.0435  (in  67.0 / out  55.9)     0.2483
 *   jupiter   0.0558  (in 136.5 / out 122.2)     0.2302
 *   mars      0.0556  (in 101.8 / out 116.0)     0.1895
 *   pluto     0.0574  (in 208.3 / out 193.6)     0.2297
 *   uranus    0.0905                             0.1476
 *
 * Five of the six stops with a belt were under the bar somewhere down the fall,
 * and the three worst failed HIGH in the frame, where the sky is brightest.
 *
 * The shipped gate for this AC - `tests/e2e/flight.spec.ts` V-22.4 - now sweeps
 * all six stops in pixels and places rocks at the bottom of the fall rather than
 * waiting for one to be there. Its own negative control, the same one-line
 * revert as below, run through that sweep:
 *
 *   stop      V-22.4 with the defect back    with the fix
 *   mars      0.0047                          0.2403
 *   jupiter   0.0077                          0.2176
 *   pluto     0.0090                          0.2366
 *   neptune   0.0215                          0.2664
 *   saturn    0.0228                          0.2457
 *   uranus    0.1400                          0.2075
 *
 * Uranus is the one stop that survives the defect, because its material was
 * already dark - which is exactly why a Mars-only gate was worth nothing and why
 * "it passed on Mars" was never evidence about the other five.
 *
 * EVERY ASSERTION IN THIS FILE HAS BEEN WATCHED FAIL, with the code reverted
 * rather than the test edited. The reds, verbatim:
 *
 *   `wordRockFill` returns `base` unchanged
 *     -> mars mars-regolith (normal): drawn #B5522A comes within 0.1 of the sky
 *        at height 0.69 of the fall: expected 0.05499999999999261 >= 20
 *     -> mars mars-regolith (colourblind): within 8.0 at height 0.80
 *     -> mars mars-regolith: 107.0 sits inside the sky sweep [74, 206]
 *   `TERMINATOR_INNER` 0.64 -> 0.55
 *     -> the terminator band reaches 0.435r, inside the 0.45r core the probe
 *        averages: expected 0.43450000000000005 to be greater than 0.45
 *   `DEBRIS_VALUE_SPREAD` 26 -> 16
 *     -> jupiter-trojan is only 5.6 from c-type - ordered, but not
 *        distinguishable: expected 5.627 to be >= 7
 *   `wordRockLitFace` drops its `LIT_FACE_MIN_STEP` floor
 *     -> neptune neptune-icy-body: lit face #274A9B against body #6C98FF:
 *        expected -77.817 to be greater than or equal to 16
 */

/** The V-22.4 bar, 0.06 of the 8-bit range, in the units used below. */
const PROBE_BAR_LUMA = 0.06 * 255;

/**
 * The floor asserted here.
 *
 * Not `SKY_SWEEP_CLEARANCE` (24), because `MIN_ROCK_LUMA` deliberately outranks
 * it at Uranus - whose sky bottom is the palette's own near-black, so the only
 * value that clears by a full 24 is one dark enough to stop being a material.
 * 20 is a third above the probe's bar and is what the clamp leaves.
 */
const CLEARANCE_FLOOR = 20;

/**
 * `SKY_MID_AT` from `parallax.ts`. Duplicated on purpose and only HERE, in the
 * test: the module under test refuses to hard-code it (a cycle, and a silent
 * drift hazard) and models a range of knee positions instead. This file pins the
 * real one so the assertions are about the gradient the game draws today, and so
 * that moving the knee in `parallax.ts` without moving it here shows up as a
 * failure rather than as a rock going quietly invisible.
 */
const SKY_MID_AT = 0.34;

function skyAt(stops: readonly [string, string, string], t: number): string {
  const [top, mid, bottom] = stops;
  const u = Math.min(1, Math.max(0, t));
  return u < SKY_MID_AT
    ? mixHex(top, mid, u / SKY_MID_AT)
    : mixHex(mid, bottom, (u - SKY_MID_AT) / (1 - SKY_MID_AT));
}

/**
 * The closest the sky ever comes to `hex`, in luminance, anywhere a rock falls -
 * and the height it happens at. This is the number AC-22.4 is really about: not
 * "how far is this rock from the average sky" but "is there a height at which it
 * is not there".
 */
function worstSkyGap(p: StopPalette, hex: string): { gap: number; atT: number } {
  const target = luma255(hex);
  let gap = Number.POSITIVE_INFINITY;
  let atT = 0;
  for (const stops of [skyStops(p), skyStopsLate(p)]) {
    for (let i = 0; i <= 400; i += 1) {
      const t = (i / 400) * ROCK_SKY_SPAN;
      const d = Math.abs(luma255(skyAt(stops, t)) - target);
      if (d < gap) {
        gap = d;
        atT = t;
      }
    }
  }
  return { gap, atT };
}

/**
 * THE COLOUR THE GAME PUTS ON A ROCK, taken from `drawDebris` rather than from
 * the helper it calls.
 *
 * This is the whole point of the file. `wordRockFill` could be perfect and
 * unused - which is exactly what happened to `StopPalette.debris` - so the fill
 * is read out of the first `fillStyle` the draw call makes, through a recorder
 * standing in for the Graphics. If a future change stops routing the body
 * through the rule, every assertion below goes red instead of staying green
 * about a function nobody calls.
 */
function bodyFillDrawnFor(type: DebrisType, fillOverride: string | null): string {
  const fills: number[] = [];
  const recorder = {
    clear: () => recorder,
    fillStyle: (colour: number) => {
      fills.push(colour);
      return recorder;
    },
    fillPoints: () => recorder,
    fillCircle: () => recorder,
    lineStyle: () => recorder,
    beginPath: () => recorder,
    moveTo: () => recorder,
    lineTo: () => recorder,
    strokePath: () => recorder,
    fillRoundedRect: () => recorder,
    strokeCircle: () => recorder,
  };
  drawDebris(recorder as unknown as Parameters<typeof drawDebris>[0], {
    type,
    variantIndex: 0,
    sizePx: 72,
    lightAngle: -Math.PI / 4,
    fillOverride,
  });
  expect(fills.length, `${type.id}: drawDebris set no fill`).toBeGreaterThan(0);
  return `#${(fills[0] as number).toString(16).padStart(6, "0").toUpperCase()}`;
}

const STOPS_WITH_A_BELT = PALETTE_STOP_IDS.filter((id) => wordDebrisTypesFor(id).length > 0);

describe("UR-47 / AC-22.4: a word-asteroid never matches the sky it falls through", () => {
  it("every stop that has a belt is covered, and Earth's empty belt is deliberate", () => {
    // ANTI-VACUITY, and it is not decoration. The loops below are over a derived
    // list; a table that lost its rows would make every one of them pass by
    // iterating nothing. D57 gives the launchpad no belt, so six is the number.
    expect(STOPS_WITH_A_BELT.length).toBe(6);
    expect(DEBRIS_BY_STOP.earth).toHaveLength(0);
  });

  for (const colorblind of [false, true]) {
    const mode = colorblind ? "colourblind" : "normal";

    it(`${mode}: the fill drawn on every rock clears the whole sky sweep`, () => {
      const readings: string[] = [];
      for (const id of STOPS_WITH_A_BELT) {
        const p = paletteFor(id);
        const override = colorblind ? paletteAt(id, true).debris : null;
        for (const type of wordDebrisTypesFor(id)) {
          const drawn = bodyFillDrawnFor(type, override);
          const { gap, atT } = worstSkyGap(p, drawn);
          readings.push(`${id}/${type.id} ${drawn} gap ${gap.toFixed(1)} at t=${atT.toFixed(2)}`);
          expect(
            gap,
            `${id} ${type.id} (${mode}): drawn ${drawn} comes within ${gap.toFixed(1)} of the sky at height ${atT.toFixed(2)} of the fall`,
          ).toBeGreaterThanOrEqual(CLEARANCE_FLOOR);
        }
      }
      // A minimum over an empty set is not a minimum.
      expect(readings.length).toBeGreaterThanOrEqual(11);
    });
  }

  it("the clearance is on the side art-direction section 2 puts the near layers", () => {
    // "darker toward the camera on bright stops and lighter toward the camera on
    // dark stops". A rock that cleared the sky by being brighter than a bright
    // stop's sky would pass the gap test above and be wrong - and unreachable,
    // since it would have to out-light the sky's top stop.
    for (const id of STOPS_WITH_A_BELT) {
      const p = paletteFor(id);
      let skyMin = Number.POSITIVE_INFINITY;
      let skyMax = Number.NEGATIVE_INFINITY;
      for (const stops of [skyStops(p), skyStopsLate(p)]) {
        for (let i = 0; i <= 200; i += 1) {
          const v = luma255(skyAt(stops, (i / 200) * ROCK_SKY_SPAN));
          skyMin = Math.min(skyMin, v);
          skyMax = Math.max(skyMax, v);
        }
      }
      for (const type of wordDebrisTypesFor(id)) {
        const v = luma255(bodyFillDrawnFor(type, null));
        const outside = v < skyMin || v > skyMax;
        expect(outside, `${id} ${type.id}: ${v.toFixed(1)} sits inside the sky sweep [${skyMin.toFixed(0)}, ${skyMax.toFixed(0)}]`).toBe(true);
      }
    }
  });

  /**
   * THE LIT FACE MUST NEVER REACH THE MEASURED CORE.
   *
   * `drawDebris` puts each material's own colour back on an annulus outside the
   * disc the AC-22.4 probe averages, which is the whole reason Saturn can be
   * visible AND still look like ice. That claim rests on one inequality between
   * three constants and the shape table, and if it ever stops holding, the
   * measured core starts including bright material and the separation numbers
   * quietly become about a different thing.
   *
   * So it is asserted against the REAL radius profiles rather than against the
   * 0.72 lower bound the comments quote, because the profiles are data and the
   * bound is a claim about them.
   */
  it("the lit face and the terminator both start outside the disc the probe averages", () => {
    const allRadii = Object.values(DEBRIS_BY_STOP)
      .flatMap((types) => types.flatMap((t) => t.variants.flatMap((v) => [...v.radii])));
    expect(allRadii.length).toBeGreaterThan(50);
    const minProfile = Math.min(...allRadii);
    expect(minProfile, "shallowest point of any rock outline").toBeGreaterThan(0.7);
    expect(
      TERMINATOR_INNER * minProfile,
      `the terminator band reaches ${(TERMINATOR_INNER * minProfile).toFixed(3)}r, inside the ${MEASURED_CORE}r core the probe averages`,
    ).toBeGreaterThan(MEASURED_CORE);
    expect(LIT_FACE_INNER * minProfile).toBeGreaterThan(MEASURED_CORE);
  });

  it("the lit face is lighter than the body it sits on, at every stop and material", () => {
    // Not automatic. At a DARK stop the body is lifted ABOVE the sky, so the raw
    // material is darker than the body and drawing it unchanged would paint a
    // shadow on the lit side. Neptune is the case: body 151, material 73.
    for (const id of STOPS_WITH_A_BELT) {
      for (const type of wordDebrisTypesFor(id)) {
        const body = wordRockFill(type);
        const face = wordRockLitFace(type, body);
        expect(
          luma255(face) - luma255(body),
          `${id} ${type.id}: lit face ${face} against body ${body}`,
        ).toBeGreaterThanOrEqual(16);
      }
    }
  });

  /**
   * IDENTITY, NOT JUST ORDER - and the difference is what a blind critic caught.
   *
   * An earlier version of the check below asserted only that a stop's materials
   * stayed monotonic in value. They did, at about five luminance levels apart,
   * which is "order preserved" and not "identity preserved": Jupiter's four
   * FR-12b materials were four shapes in one colour and a monotonicity test
   * cannot tell that from four materials. Both halves are asserted now - the
   * bodies are spaced, and the lit faces, which is where the material's own
   * colour actually appears, are far apart in value.
   */
  it("Jupiter's four materials are four materials, not four shapes in one colour", () => {
    // The fix moves the whole set of a stop's materials to one side of the sky.
    // It must not flatten them onto one value: FR-12b's C-type is the dark one
    // and its M-type the light one, and that has to survive the move or the
    // debris table has become decoration.
    const jupiter = wordDebrisTypesFor("jupiter");
    expect(jupiter.length).toBe(4);
    const byMaterial = [...jupiter].sort((a, b) => luma255(a.fill) - luma255(b.fill));
    const drawn = byMaterial.map((t) => luma255(bodyFillDrawnFor(t, null)));
    for (let i = 1; i < drawn.length; i += 1) {
      expect(
        drawn[i] as number,
        `${byMaterial[i]?.id} should stay lighter than ${byMaterial[i - 1]?.id}`,
      ).toBeGreaterThan(drawn[i - 1] as number);
      // ORDER IS NOT ENOUGH. At `DEBRIS_VALUE_SPREAD` 16 these sat about five
      // levels apart, which no eye separates; the spread is 26 and they sit
      // about nine apart.
      expect(
        (drawn[i] as number) - (drawn[i - 1] as number),
        `${byMaterial[i]?.id} is only ${((drawn[i] as number) - (drawn[i - 1] as number)).toFixed(1)} from ${byMaterial[i - 1]?.id} - ordered, but not distinguishable`,
      ).toBeGreaterThanOrEqual(7);
    }
    expect((drawn[drawn.length - 1] as number) - (drawn[0] as number)).toBeGreaterThanOrEqual(20);
    // And the lit faces, which is where the material's own colour is actually
    // seen: C-type charcoal against M-type metal is a 90-level difference.
    const faces = byMaterial.map((t) => luma255(wordRockLitFace(t, bodyFillDrawnFor(t, null))));
    expect(
      Math.max(...faces) - Math.min(...faces),
      `lit faces span only ${(Math.max(...faces) - Math.min(...faces)).toFixed(1)} levels`,
    ).toBeGreaterThanOrEqual(60);
  });

  /**
   * THE NEGATIVE CONTROL. `docs/verification-gaps.md` guard 5: a check that has
   * never been seen to fail is not a check.
   *
   * This runs the identical predicate over the fill the game USED to draw - the
   * raw FR-12b material, `DebrisType.fill`, which is still in the table and still
   * correct as a description of the material. Every failing stop is named with
   * its real number, so the control cannot rot into "some stops are bad".
   *
   * IT WAS ALSO WATCHED FAIL, which is the half that cannot be faked. The one
   * line `const out = withLuma255(base, target)` in `asteroid.wordRockFill` was
   * changed to `const out = base`, putting the shipped defect back, and this
   * file was run. Three of its six tests went red, verbatim:
   *
   *   x normal: the fill drawn on every rock clears the whole sky sweep
   *     -> mars mars-regolith (normal): drawn #B5522A comes within 0.1 of the
   *        sky at height 0.69 of the fall: expected 0.05499999999999261 to be
   *        greater than or equal to 20
   *   x colourblind: the fill drawn on every rock clears the whole sky sweep
   *     -> mars mars-regolith (colourblind): drawn #7A2E17 comes within 8.0 of
   *        the sky at height 0.80 of the fall: expected 8.040999999999997 to be
   *        greater than or equal to 20
   *   x the clearance is on the side art-direction section 2 puts the near layers
   *     -> mars mars-regolith: 107.0 sits inside the sky sweep [74, 206]
   *
   * Two things in that output are worth keeping. The first number is 0.055 of a
   * luminance level - not a small separation, an exact match, which is what the
   * e2e probe reports from the other end as 0.0556 on a frozen Mars frame
   * (rock 101.8, sky 116.0 at y=461 and 102.7 against 87.2 at y=562). The second
   * is that the COLOURBLIND fill failed too, at 8.0: D41's declared
   * `colorblind.debris` was chosen against the three sky stops by the same rule
   * and inherited the same hole.
   */
  it("NEGATIVE CONTROL: the raw FR-12b material fill fails this very check", () => {
    const failures: string[] = [];
    for (const id of STOPS_WITH_A_BELT) {
      const p = paletteFor(id);
      for (const type of wordDebrisTypesFor(id)) {
        const { gap, atT } = worstSkyGap(p, type.fill);
        if (gap < PROBE_BAR_LUMA) {
          failures.push(`${id}/${type.id} ${type.fill} gap=${gap.toFixed(2)} at t=${atT.toFixed(2)}`);
        }
      }
    }
    // Every stop with a belt had at least one material that the sky matched
    // exactly somewhere in the fall. Named, so this cannot quietly weaken.
    expect(failures.join("\n")).toContain("saturn/saturn-ice-chunk");
    expect(failures.join("\n")).toContain("mars/mars-regolith");
    expect(failures.join("\n")).toContain("neptune/neptune-icy-body");
    expect(failures.join("\n")).toContain("pluto/kuiper-water-ice");
    expect(failures.join("\n")).toContain("jupiter/s-type");
    expect(failures.join("\n")).toContain("uranus/uranus-dark-ice");
    expect(failures.length, failures.join("\n")).toBeGreaterThanOrEqual(6);
    // And the worst of them is a true zero, not a small number: the sky and the
    // rock are the same value to within a rounding step.
    const worst = Math.min(
      ...STOPS_WITH_A_BELT.flatMap((id) =>
        wordDebrisTypesFor(id).map((t) => worstSkyGap(paletteFor(id), t.fill).gap),
      ),
    );
    expect(worst).toBeLessThan(0.5);
  });
});
