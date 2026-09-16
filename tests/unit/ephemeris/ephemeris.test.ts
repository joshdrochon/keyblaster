import { describe, expect, it } from "vitest";
import { STOP_IDS } from "@engine/types.js";
import type { Pulsar } from "@engine/ephemeris/index.js";
import {
  AU_LIGHT_SECONDS,
  BETA_SIGN,
  EphemerisError,
  DAYS_PER_JULIAN_CENTURY,
  DEGREE_SIGN,
  DEG_TO_RAD,
  ELEMENTS,
  J2000_JD,
  KEPLER_MAX_ITERATIONS,
  KEPLER_TOLERANCE_RAD,
  LAMBDA_SIGN,
  MINUS_SIGN,
  NAVIGATION_PULSARS,
  OBLIQUITY_J2000_DEG,
  RAD_TO_DEG,
  TABLE_VALID_FROM_JD,
  TABLE_VALID_TO_JD,
  UNIX_EPOCH_JD,
  beaconReadout,
  centuriesSinceJ2000,
  classifyJd,
  dateFromJulian,
  elementsAt,
  formatBeaconCoords,
  formatLongitude,
  formatPulsarFix,
  formatSigned,
  heliocentricEcliptic,
  heliocentricEclipticAtJd,
  isWithinTableValidity,
  julianDate,
  pulsarDelays,
  pulsarEclipticUnitVector,
  solveKepler,
  wrapDeg180,
  wrapDeg360,
} from "@engine/ephemeris/index.js";
import {
  AC_BETA_TOLERANCE_DEG,
  AC_LAMBDA_TOLERANCE_DEG,
  AC_R_TOLERANCE_AU,
  BETA_TOLERANCE_DEG,
  ELEMENT_FIELD_ORDER,
  EXPECTED_ELEMENT_TABLE,
  LAMBDA_TOLERANCE_DEG,
  ORBIT_BAND_SLACK,
  PUBLISHED_ORBITS,
  REFERENCE_EPOCHS,
  R_TOLERANCE_AU,
  angleDeltaDeg,
} from "./reference.js";

/** Index into the pulsar table without an `as` cast (noUncheckedIndexedAccess). */
function pulsarAt(index: number): Pulsar {
  const pulsar = NAVIGATION_PULSARS[index];
  if (!pulsar) throw new Error(`no navigation pulsar at index ${index}`);
  return pulsar;
}

/**
 * Deterministic PRNG for the sweep tests. Math.random is banned in this repo's
 * tests so a failure is always reproducible from the seed alone.
 */
function mulberry32(seed: number): () => number {
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
// Julian date
// ---------------------------------------------------------------------------

describe("julianDate", () => {
  it("puts J2000.0 at 2000-01-01T12:00:00Z", () => {
    expect(julianDate(new Date("2000-01-01T12:00:00.000Z"))).toBe(J2000_JD);
  });

  it("puts the Unix epoch at UNIX_EPOCH_JD", () => {
    expect(julianDate(new Date(0))).toBe(UNIX_EPOCH_JD);
  });

  it("advances by exactly one per day", () => {
    const a = julianDate(new Date("2024-03-01T00:00:00.000Z"));
    const b = julianDate(new Date("2024-03-02T00:00:00.000Z"));
    expect(b - a).toBe(1);
  });

  it("round-trips through dateFromJulian", () => {
    const date = new Date("2026-09-16T04:05:06.000Z");
    expect(dateFromJulian(julianDate(date)).toISOString()).toBe(
      date.toISOString(),
    );
  });

  it("measures Julian centuries from J2000", () => {
    expect(centuriesSinceJ2000(J2000_JD)).toBe(0);
    expect(centuriesSinceJ2000(J2000_JD + DAYS_PER_JULIAN_CENTURY)).toBe(1);
    expect(centuriesSinceJ2000(J2000_JD - DAYS_PER_JULIAN_CENTURY)).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// Element table (AC-17.2)
// ---------------------------------------------------------------------------

describe("element table", () => {
  it("AC-17.2: carries the 1800-2050 element set for Pluto", () => {
    // These six numbers are the Pluto row of JPL Table 1 (1800 AD - 2050 AD).
    // The 3000 BC - 3000 AD table has a different Pluto row (a = 39.48686035,
    // e = 0.24885238, L = 238.96535011, ...) plus b/c/s/f correction terms, so
    // asserting the exact values is what pins AC-17.2 rather than just "Pluto
    // is present".
    expect(ELEMENTS.pluto.at).toEqual({
      aAu: 39.48211675,
      e: 0.2488273,
      iDeg: 17.14001206,
      lDeg: 238.92903833,
      varPiDeg: 224.06891629,
      omegaDeg: 110.30393684,
    });
    expect(ELEMENTS.pluto.perCentury).toEqual({
      aAu: -0.00031596,
      e: 0.0000517,
      iDeg: 0.00004818,
      lDeg: 145.20780515,
      varPiDeg: -0.04062942,
      omegaDeg: -0.01183482,
    });
  });

  it("AC-17.2: the 1800-2050 Pluto set needs no b/c/s/f correction fields", () => {
    // The long-window table adds them; ours must not, or M = L - varPi would
    // be the wrong mean anomaly (architecture section 4.5).
    expect(Object.keys(ELEMENTS.pluto.at).sort()).toEqual([
      "aAu",
      "e",
      "iDeg",
      "lDeg",
      "omegaDeg",
      "varPiDeg",
    ]);
  });

  it("AC-17.1/AC-17.2: every one of the 84 element fields matches JPL Table 1", () => {
    // The DE441 fixture proves the numbers are right; this proves they stay
    // right. Without it only Pluto's 12 fields were pinned and the other 72
    // rested entirely on the fixture's tolerance.
    for (const stop of STOP_IDS) {
      const expected = EXPECTED_ELEMENT_TABLE[stop];
      ELEMENT_FIELD_ORDER.forEach((field, column) => {
        expect(ELEMENTS[stop].at[field]).toBe(expected.at[column]);
        expect(ELEMENTS[stop].perCentury[field]).toBe(
          expected.perCentury[column],
        );
      });
    }
  });

  it("covers every stop on the route (D57)", () => {
    for (const stop of STOP_IDS) {
      expect(ELEMENTS[stop]).toBeDefined();
    }
    expect(Object.keys(ELEMENTS).sort()).toEqual([...STOP_IDS].sort());
  });

  it("has plausible semi-major axes, outward from Earth", () => {
    const radii = STOP_IDS.map((s) => ELEMENTS[s].at.aAu);
    expect(radii).toEqual([...radii].sort((a, b) => a - b));
    expect(new Set(radii).size).toBe(radii.length);
    expect(ELEMENTS.earth.at.aAu).toBeCloseTo(1, 4);
  });

  it("propagates elements linearly in T", () => {
    const at0 = elementsAt("mars", 0);
    expect(at0).toEqual(ELEMENTS.mars.at);

    const at1 = elementsAt("mars", 1);
    expect(at1.aAu).toBeCloseTo(
      ELEMENTS.mars.at.aAu + ELEMENTS.mars.perCentury.aAu,
      12,
    );
    expect(at1.lDeg).toBeCloseTo(
      ELEMENTS.mars.at.lDeg + ELEMENTS.mars.perCentury.lDeg,
      9,
    );

    const atHalf = elementsAt("mars", 0.5);
    expect(atHalf.e).toBeCloseTo((at0.e + at1.e) / 2, 15);
  });

  it("Earth's node rate is zero, so Omega stays 0 at any T", () => {
    expect(elementsAt("earth", 3).omegaDeg).toBe(0);
  });

  it("reports the 1800-2050 validity window", () => {
    expect(isWithinTableValidity(TABLE_VALID_FROM_JD)).toBe(true);
    expect(isWithinTableValidity(TABLE_VALID_TO_JD)).toBe(true);
    expect(isWithinTableValidity(J2000_JD)).toBe(true);
    expect(isWithinTableValidity(TABLE_VALID_FROM_JD - 1)).toBe(false);
    expect(isWithinTableValidity(TABLE_VALID_TO_JD + 1)).toBe(false);
  });

  it("anchors the validity window to 1800-01-01 and 2050-01-01", () => {
    expect(dateFromJulian(TABLE_VALID_FROM_JD).toISOString()).toBe(
      "1800-01-01T00:00:00.000Z",
    );
    expect(dateFromJulian(TABLE_VALID_TO_JD).toISOString()).toBe(
      "2050-01-01T00:00:00.000Z",
    );
  });
});

// ---------------------------------------------------------------------------
// Angle wrapping
// ---------------------------------------------------------------------------

describe("angle wrapping", () => {
  it("wraps into [0, 360)", () => {
    expect(wrapDeg360(0)).toBe(0);
    expect(wrapDeg360(359.9)).toBeCloseTo(359.9, 10);
    expect(wrapDeg360(360)).toBe(0);
    expect(wrapDeg360(720)).toBe(0);
    expect(wrapDeg360(-1)).toBeCloseTo(359, 10);
    expect(wrapDeg360(-360)).toBe(0);
    expect(wrapDeg360(1234.5)).toBeCloseTo(154.5, 10);
  });

  it("never returns 360 for an angle a hair below zero (0/360 boundary)", () => {
    // atan2 hands back exactly this shape for a point just clockwise of the
    // vernal equinox. Naive `x + 360` rounds to 360 and breaks the half-open
    // range; the trailing modulus is what saves it.
    for (const tiny of [-1e-15, -1e-16, -5e-14, -Number.EPSILON]) {
      const wrapped = wrapDeg360(tiny);
      expect(wrapped).toBeGreaterThanOrEqual(0);
      expect(wrapped).toBeLessThan(360);
    }
    expect(wrapDeg360(-1e-15)).toBe(0);
  });

  it("wraps into [-180, 180)", () => {
    expect(wrapDeg180(0)).toBe(0);
    expect(wrapDeg180(179.5)).toBeCloseTo(179.5, 10);
    expect(wrapDeg180(180)).toBe(-180);
    expect(wrapDeg180(181)).toBeCloseTo(-179, 10);
    expect(wrapDeg180(-180)).toBe(-180);
    expect(wrapDeg180(-181)).toBeCloseTo(179, 10);
    expect(wrapDeg180(360)).toBe(0);
    // Mars has accumulated ~48 revolutions of mean longitude by 2050; the
    // wrap is what keeps the Newton seed near the root.
    expect(wrapDeg180(19140.3 * 0.5)).toBeGreaterThanOrEqual(-180);
    expect(wrapDeg180(19140.3 * 0.5)).toBeLessThan(180);
  });

  it("wrapDeg180 stays in range for a deterministic sweep (seed 0xC0FFEE)", () => {
    const rand = mulberry32(0xc0ffee);
    for (let i = 0; i < 2000; i += 1) {
      const deg = (rand() - 0.5) * 2_000_000;
      const wrapped = wrapDeg180(deg);
      expect(wrapped).toBeGreaterThanOrEqual(-180);
      expect(wrapped).toBeLessThan(180);
      expect(wrapDeg360(wrapped - deg)).toBeCloseTo(0, 6);
    }
  });

  it("exposes matching degree/radian constants", () => {
    expect(DEG_TO_RAD * 180).toBeCloseTo(Math.PI, 15);
    expect(RAD_TO_DEG * Math.PI).toBeCloseTo(180, 12);
    expect(DEG_TO_RAD * RAD_TO_DEG).toBeCloseTo(1, 15);
  });
});

// ---------------------------------------------------------------------------
// Kepler solver
// ---------------------------------------------------------------------------

describe("solveKepler", () => {
  it("uses the tolerance architecture section 4.5 specifies", () => {
    expect(KEPLER_TOLERANCE_RAD).toBe(1e-6);
  });

  it("is exact for a circular orbit", () => {
    const solution = solveKepler(1.2345, 0);
    expect(solution.eccentricAnomalyRad).toBeCloseTo(1.2345, 12);
    expect(solution.converged).toBe(true);
  });

  it("satisfies E - e sin E = M to well inside 1e-6 rad", () => {
    for (const e of [0, 0.0086, 0.0167, 0.0484, 0.0934, 0.2488]) {
      for (const m of [-3.1, -1.7, -0.4, 0, 0.001, 0.9, 2.2, 3.14]) {
        const { eccentricAnomalyRad: big, converged } = solveKepler(m, e);
        expect(converged).toBe(true);
        expect(big - e * Math.sin(big) - m).toBeCloseTo(0, 9);
      }
    }
  });

  it("converges at Pluto's eccentricity e = 0.2488 (D15, AC-17.2)", () => {
    const e = ELEMENTS.pluto.at.e;
    expect(e).toBeGreaterThan(0.24);
    const rand = mulberry32(0x9e3779b9);
    let worstIterations = 0;
    for (let i = 0; i < 1000; i += 1) {
      const m = (rand() * 2 - 1) * Math.PI;
      const solution = solveKepler(m, e);
      expect(solution.converged).toBe(true);
      const residual =
        solution.eccentricAnomalyRad -
        e * Math.sin(solution.eccentricAnomalyRad) -
        m;
      expect(Math.abs(residual)).toBeLessThan(1e-9);
      worstIterations = Math.max(worstIterations, solution.iterations);
    }
    // Quadratic convergence from the M + e sin M seed: a handful of passes,
    // nowhere near the safety cap.
    expect(worstIterations).toBeLessThanOrEqual(5);
    expect(worstIterations).toBeLessThan(KEPLER_MAX_ITERATIONS);
  });

  it("still converges well past Pluto, at e = 0.6", () => {
    const solution = solveKepler(0.05, 0.6);
    expect(solution.converged).toBe(true);
    const e = 0.6;
    expect(
      solution.eccentricAnomalyRad -
        e * Math.sin(solution.eccentricAnomalyRad) -
        0.05,
    ).toBeCloseTo(0, 9);
  });

  it("reports non-convergence instead of looping forever", () => {
    // One pass cannot reach 1e-12 from the first-order seed. The solver must
    // return with converged=false rather than spin: a hung loop would freeze
    // the Beacon scene.
    const solution = solveKepler(1.0, 0.2488, 1e-12, 1);
    expect(solution.converged).toBe(false);
    expect(solution.iterations).toBe(1);
    expect(Number.isFinite(solution.eccentricAnomalyRad)).toBe(true);
  });

  it("accepts an explicit tolerance", () => {
    const loose = solveKepler(1.0, 0.2488, 1e-2);
    const tight = solveKepler(1.0, 0.2488, 1e-12, 50);
    expect(loose.converged).toBe(true);
    expect(tight.converged).toBe(true);
    expect(loose.iterations).toBeLessThanOrEqual(tight.iterations);
  });
});

// ---------------------------------------------------------------------------
// AC-17.1 - the real check against an independent ephemeris
// ---------------------------------------------------------------------------

describe("AC-17.1 heliocentric ecliptic coordinates", () => {
  for (const epoch of REFERENCE_EPOCHS) {
    for (const stop of STOP_IDS) {
      const expected = epoch.bodies[stop];
      it(`AC-17.1: ${stop} on ${epoch.iso} matches JPL DE441 within ${LAMBDA_TOLERANCE_DEG} deg / ${R_TOLERANCE_AU} AU`, () => {
        const got = heliocentricEclipticAtJd(stop, epoch.jd);
        expect(
          Math.abs(angleDeltaDeg(got.lambdaDeg, expected.lambdaDeg)),
        ).toBeLessThan(LAMBDA_TOLERANCE_DEG);
        expect(Math.abs(got.betaDeg - expected.betaDeg)).toBeLessThan(
          BETA_TOLERANCE_DEG,
        );
        expect(Math.abs(got.rAu - expected.rAu)).toBeLessThan(R_TOLERANCE_AU);
      });
    }
  }

  it("AC-17.1: the Date entry point agrees with the Julian-date one", () => {
    for (const epoch of REFERENCE_EPOCHS) {
      for (const stop of STOP_IDS) {
        const byDate = heliocentricEcliptic(stop, new Date(epoch.iso));
        const byJd = heliocentricEclipticAtJd(stop, epoch.jd);
        expect(byDate.lambdaDeg).toBeCloseTo(byJd.lambdaDeg, 9);
        expect(byDate.betaDeg).toBeCloseTo(byJd.betaDeg, 9);
        expect(byDate.rAu).toBeCloseTo(byJd.rAu, 12);
      }
    }
  });

  it("AC-17.1: lambda is in [0, 360) for every stop over a 250-year sweep", () => {
    // Fixed seed, fixed window: the whole 1800-2050 validity range.
    const rand = mulberry32(0x5eed1234);
    for (let i = 0; i < 1500; i += 1) {
      const jd =
        TABLE_VALID_FROM_JD +
        rand() * (TABLE_VALID_TO_JD - TABLE_VALID_FROM_JD);
      for (const stop of STOP_IDS) {
        const coords = heliocentricEclipticAtJd(stop, jd);
        expect(coords.lambdaDeg).toBeGreaterThanOrEqual(0);
        expect(coords.lambdaDeg).toBeLessThan(360);
        expect(coords.betaDeg).toBeGreaterThanOrEqual(-90);
        expect(coords.betaDeg).toBeLessThanOrEqual(90);
        expect(coords.rAu).toBeGreaterThan(0);
        expect(coords.keplerConverged).toBe(true);
      }
    }
  });

  it("AC-17.1: r stays inside each orbit's PUBLISHED perihelion/aphelion band", () => {
    // Bounds come from the NASA Planetary Fact Sheet, not from ELEMENTS, so
    // this genuinely constrains a and e rather than restating them.
    const rand = mulberry32(0x1234abcd);
    for (let i = 0; i < 400; i += 1) {
      const jd =
        TABLE_VALID_FROM_JD +
        rand() * (TABLE_VALID_TO_JD - TABLE_VALID_FROM_JD);
      for (const stop of STOP_IDS) {
        const orbit = PUBLISHED_ORBITS[stop];
        const coords = heliocentricEclipticAtJd(stop, jd);
        expect(coords.rAu).toBeGreaterThan(
          orbit.perihelionAu * (1 - ORBIT_BAND_SLACK),
        );
        expect(coords.rAu).toBeLessThan(
          orbit.aphelionAu * (1 + ORBIT_BAND_SLACK),
        );
      }
    }
  });

  it("AC-17.1: the asserted tolerances are strictly inside the AC's", () => {
    // Passing at these bounds therefore implies passing AC-17.1 as written.
    expect(LAMBDA_TOLERANCE_DEG).toBeLessThan(AC_LAMBDA_TOLERANCE_DEG);
    expect(BETA_TOLERANCE_DEG).toBeLessThan(AC_BETA_TOLERANCE_DEG);
    expect(R_TOLERANCE_AU).toBeLessThan(AC_R_TOLERANCE_AU);
  });

  it("returns a rectangular vector consistent with lambda/beta/r", () => {
    const coords = heliocentricEclipticAtJd("saturn", 2460310.5);
    const [x, y, z] = coords.xyzAu;
    expect(Math.hypot(x, y, z)).toBeCloseTo(coords.rAu, 12);
    expect(wrapDeg360(Math.atan2(y, x) * RAD_TO_DEG)).toBeCloseTo(
      coords.lambdaDeg,
      9,
    );
    expect(Math.asin(z / coords.rAu) * RAD_TO_DEG).toBeCloseTo(
      coords.betaDeg,
      9,
    );
  });
});

// ---------------------------------------------------------------------------
// Latitude sign, longitude motion, determinism
// ---------------------------------------------------------------------------

describe("beta sign handling", () => {
  it("is negative below the ecliptic and positive above it", () => {
    // Pluto is 11.2 deg north of the ecliptic at J2000 and 12.8 deg south by
    // 2050; the same body carries both signs, so a dropped sign cannot hide.
    expect(heliocentricEclipticAtJd("pluto", 2451545.0).betaDeg).toBeGreaterThan(
      10,
    );
    expect(heliocentricEclipticAtJd("pluto", 2469807.5).betaDeg).toBeLessThan(
      -10,
    );
  });

  it("tracks the sign of the z component exactly", () => {
    const rand = mulberry32(0xbeef01);
    for (let i = 0; i < 300; i += 1) {
      const jd =
        TABLE_VALID_FROM_JD +
        rand() * (TABLE_VALID_TO_JD - TABLE_VALID_FROM_JD);
      const coords = heliocentricEclipticAtJd("pluto", jd);
      expect(Math.sign(coords.betaDeg)).toBe(Math.sign(coords.xyzAu[2]));
    }
  });

  it("keeps |beta| within each orbit's PUBLISHED inclination", () => {
    // Deliberately checked against the NASA fact-sheet inclination, not
    // against elementsAt(...).iDeg. Reading the inclination back out of the
    // table under test would make this assertion true by construction and
    // constrain nothing.
    const rand = mulberry32(0x0ddba11);
    for (let i = 0; i < 300; i += 1) {
      const jd =
        TABLE_VALID_FROM_JD +
        rand() * (TABLE_VALID_TO_JD - TABLE_VALID_FROM_JD);
      for (const stop of STOP_IDS) {
        const coords = heliocentricEclipticAtJd(stop, jd);
        const published = PUBLISHED_ORBITS[stop].inclinationDeg;
        expect(Math.abs(coords.betaDeg)).toBeLessThanOrEqual(published + 0.05);
      }
    }
  });

  it("holds Earth within a thousandth of a degree of the ecliptic", () => {
    // Earth's row IS the ecliptic's defining plane at J2000, so beta must be
    // essentially zero. A non-zero value would mean the rotation is wrong.
    expect(
      Math.abs(heliocentricEclipticAtJd("earth", 2451545.0).betaDeg),
    ).toBeLessThan(0.001);
  });
});

describe("lambda at the 0/360 boundary", () => {
  it("crosses 360 -> 0 without ever leaving [0, 360)", () => {
    // Step Earth one hour at a time through the day it passes the vernal
    // equinox direction, and assert the wrap happens exactly once and the
    // value is always in range.
    const start = heliocentricEclipticAtJd("earth", 2451545.0).lambdaDeg;
    expect(start).toBeGreaterThan(0);

    let previous = Number.NaN;
    let wraps = 0;
    let sawHigh = false;
    let sawLow = false;
    // One full Earth year at hourly resolution.
    for (let hour = 0; hour <= 366 * 24; hour += 1) {
      const lambda = heliocentricEclipticAtJd(
        "earth",
        2451545.0 + hour / 24,
      ).lambdaDeg;
      expect(lambda).toBeGreaterThanOrEqual(0);
      expect(lambda).toBeLessThan(360);
      if (!Number.isNaN(previous) && lambda < previous) wraps += 1;
      if (lambda > 359.9) sawHigh = true;
      if (!Number.isNaN(previous) && previous > 359.9 && lambda < 0.1) {
        sawLow = true;
      }
      previous = lambda;
    }
    expect(sawHigh).toBe(true);
    expect(sawLow).toBe(true);
    expect(wraps).toBe(1);
  });

  it("puts a body just short of 360 on the high side, not at -0.x", () => {
    // Mars at J2000 sits at lambda 359.4 deg. A sign slip in the wrap would
    // surface it as -0.55 instead, so the high-side assertion is the check.
    const coords = heliocentricEclipticAtJd("mars", 2451545.0);
    expect(coords.lambdaDeg).toBeGreaterThan(359);
    expect(coords.lambdaDeg).toBeLessThan(360);
  });
});

describe("determinism", () => {
  it("returns identical numbers for the same date", () => {
    const date = new Date("2026-09-16T00:00:00.000Z");
    for (const stop of STOP_IDS) {
      const a = heliocentricEcliptic(stop, date);
      const b = heliocentricEcliptic(stop, new Date(date.getTime()));
      expect(b.lambdaDeg).toBe(a.lambdaDeg);
      expect(b.betaDeg).toBe(a.betaDeg);
      expect(b.rAu).toBe(a.rAu);
      expect(b.xyzAu).toEqual(a.xyzAu);
      expect(b.keplerIterations).toBe(a.keplerIterations);
      expect(formatBeaconCoords(b)).toBe(formatBeaconCoords(a));
      expect(formatPulsarFix(b)).toBe(formatPulsarFix(a));
    }
  });

  it("does not read the wall clock", () => {
    // The whole module takes the date as a parameter (CLAUDE.md hard rules),
    // so freezing Date.now must change nothing.
    const real = Date.now;
    const coords = heliocentricEcliptic("mars", new Date("2030-05-05T00:00:00Z"));
    Date.now = () => 0;
    try {
      const again = heliocentricEcliptic(
        "mars",
        new Date("2030-05-05T00:00:00Z"),
      );
      expect(again).toEqual(coords);
    } finally {
      Date.now = real;
    }
  });

  it("differs between stops on the same date", () => {
    const date = new Date("2026-09-16T00:00:00.000Z");
    const lambdas = STOP_IDS.map((s) => heliocentricEcliptic(s, date).lambdaDeg);
    expect(new Set(lambdas).size).toBe(STOP_IDS.length);
  });
});

// ---------------------------------------------------------------------------
// AC-17.0 display format
// ---------------------------------------------------------------------------

describe("AC-17.0 display format", () => {
  /** The literal example string from AC-17.0 / D81, byte for byte. */
  const EXAMPLE =
    "λ 214.6°  β −1.2°  r 1.52 AU";

  const sample = (lambdaDeg: number, betaDeg: number, rAu: number) => ({
    lambdaDeg,
    betaDeg,
    rAu,
    xyzAu: [0, 0, 0] as readonly [number, number, number],
    keplerIterations: 0,
    keplerConverged: true,
  });

  it("AC-17.0: reproduces the example string exactly", () => {
    expect(formatBeaconCoords(sample(214.6, -1.2, 1.52))).toBe(EXAMPLE);
  });

  it("AC-17.0: uses U+2212 MINUS SIGN, never a hyphen", () => {
    const line = formatBeaconCoords(sample(1, -1.24, 1.5));
    expect(line).toContain(MINUS_SIGN);
    expect(line).not.toContain("-");
    expect(MINUS_SIGN).toBe("−");
  });

  it("AC-17.0: one decimal on the angles, two on AU", () => {
    expect(formatBeaconCoords(sample(0, 0, 0))).toBe(
      `${LAMBDA_SIGN} 0.0${DEGREE_SIGN}  ${BETA_SIGN} 0.0${DEGREE_SIGN}  r 0.00 AU`,
    );
    expect(formatBeaconCoords(sample(359.94, 89.99, 39.999))).toBe(
      `${LAMBDA_SIGN} 359.9${DEGREE_SIGN}  ${BETA_SIGN} 90.0${DEGREE_SIGN}  r 40.00 AU`,
    );
  });

  it("AC-17.0: two spaces separate the three fields", () => {
    const line = formatBeaconCoords(sample(214.6, -1.2, 1.52));
    expect(line.split("  ")).toHaveLength(3);
    expect(line.startsWith(`${LAMBDA_SIGN} `)).toBe(true);
  });

  it("AC-17.0: never prints a signed zero", () => {
    // -0.04 rounds to -0.0; "beta minus zero" reads as a measurement nobody
    // made, so the sign is dropped.
    expect(formatSigned(-0.04, 1)).toBe("0.0");
    expect(formatSigned(-0, 1)).toBe("0.0");
    expect(formatSigned(-0.004, 2)).toBe("0.00");
    expect(formatBeaconCoords(sample(100, -0.02, 1))).toContain(
      `${BETA_SIGN} 0.0${DEGREE_SIGN}`,
    );
  });

  it("AC-17.0: rounds rather than truncates", () => {
    expect(formatSigned(1.25, 1)).toBe("1.3");
    expect(formatSigned(-1.25, 1)).toBe(`${MINUS_SIGN}1.3`);
    expect(formatSigned(1.515, 2)).toBe("1.51");
  });

  it("AC-17.0: renders a real stop on a real date", () => {
    const line = formatBeaconCoords(
      heliocentricEcliptic("mars", new Date("2024-01-01T00:00:00.000Z")),
    );
    expect(line).toBe(
      `${LAMBDA_SIGN} 258.6${DEGREE_SIGN}  ${BETA_SIGN} ${MINUS_SIGN}0.9${DEGREE_SIGN}  r 1.48 AU`,
    );
  });

  it("AC-17.0: produces a line for every stop without throwing", () => {
    const date = new Date("2026-09-16T00:00:00.000Z");
    for (const stop of STOP_IDS) {
      expect(formatBeaconCoords(heliocentricEcliptic(stop, date))).toMatch(
        /^λ \d+\.\d° {2}β [−]?\d+\.\d° {2}r \d+\.\d\d AU$/u,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Pulsar fix line (D15, second half of AC-17.0)
// ---------------------------------------------------------------------------

describe("pulsar fix line", () => {
  it("D15: names the FOUR pulsars NICER/SEXTANT actually tracked in Nov 2017", () => {
    // The Nov 2017 ISS demonstration used J0218+4232, B1821-24, J0030+0451
    // and J0437-4715 (NASA Goddard release, 11 Jan 2018). B1937+21 is the
    // first-discovered millisecond pulsar and a common stand-in in write-ups,
    // but it was not a SEXTANT target - asserting it here would teach a
    // grades 2-5 player something false, which D15 exists to prevent.
    expect([...NAVIGATION_PULSARS].map((p) => p.name).sort()).toEqual([
      "B1821-24",
      "J0030+0451",
      "J0218+4232",
      "J0437-4715",
    ]);
    expect(NAVIGATION_PULSARS.map((p) => p.name)).not.toContain("B1937+21");
  });

  it("D15: carries the ATNF catalogue position and period for each", () => {
    // ATNF Pulsar Catalogue v2.8.1, RAJD / DECJD / P0. B1821-24 is catalogued
    // as J1824-2452A; SEXTANT papers use the B-name, so that is what prints.
    const byName = new Map(NAVIGATION_PULSARS.map((p) => [p.name, p]));
    expect(byName.get("J0030+0451")).toEqual({
      name: "J0030+0451",
      raDeg: 7.61428128,
      decDeg: 4.861031,
      periodMs: 4.86545329,
    });
    expect(byName.get("J0218+4232")?.raDeg).toBe(34.526494038);
    expect(byName.get("J0437-4715")?.decDeg).toBe(-47.252783951);
    expect(byName.get("B1821-24")?.periodMs).toBe(3.05431576);
  });

  it("D15: every entry is a millisecond pulsar at a real sky position", () => {
    for (const pulsar of NAVIGATION_PULSARS) {
      expect(pulsar.periodMs).toBeGreaterThan(0);
      expect(pulsar.periodMs).toBeLessThan(10);
      expect(pulsar.raDeg).toBeGreaterThanOrEqual(0);
      expect(pulsar.raDeg).toBeLessThan(360);
      expect(Math.abs(pulsar.decDeg)).toBeLessThanOrEqual(90);
    }
  });

  it("AC-17.0: catalogue names use an ASCII hyphen, not U+2212", () => {
    // The hyphen in "B1821-24" is part of the designation, not a minus sign.
    // D81's U+2212 rule governs the numeric fields only.
    for (const pulsar of NAVIGATION_PULSARS) {
      expect(pulsar.name).not.toContain(MINUS_SIGN);
      expect(pulsar.name).toMatch(/^[BJ]\d{4}[+-]\d{2,4}$/u);
    }
  });

  it("gives each pulsar a unit direction vector", () => {
    for (const pulsar of NAVIGATION_PULSARS) {
      const [x, y, z] = pulsarEclipticUnitVector(pulsar);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
    }
  });

  it("rotates equatorial to ecliptic with the J2000 obliquity", () => {
    // The north celestial pole (dec +90) must land at ecliptic latitude
    // 90 - obliquity.
    const pole = pulsarEclipticUnitVector({
      name: "pole",
      raDeg: 0,
      decDeg: 90,
      periodMs: 1,
    });
    const betaDeg = Math.asin(pole[2]) * RAD_TO_DEG;
    expect(betaDeg).toBeCloseTo(90 - OBLIQUITY_J2000_DEG, 9);
    // A point on the equator at RA 0 is the equinox: unchanged by the rotation.
    const equinox = pulsarEclipticUnitVector({
      name: "equinox",
      raDeg: 0,
      decDeg: 0,
      periodMs: 1,
    });
    expect(equinox[0]).toBeCloseTo(1, 12);
    expect(equinox[1]).toBeCloseTo(0, 12);
    expect(equinox[2]).toBeCloseTo(0, 12);
  });

  it("delays are the projected light-travel time along each sight line", () => {
    const along = pulsarEclipticUnitVector(pulsarAt(0));
    const delays = pulsarDelays([along[0], along[1], along[2]]);
    expect(delays[0]?.seconds).toBeCloseTo(AU_LIGHT_SECONDS, 6);
    // Same position mirrored through the Sun flips every sign.
    const mirrored = pulsarDelays([-along[0], -along[1], -along[2]]);
    expect(mirrored[0]?.seconds).toBeCloseTo(-AU_LIGHT_SECONDS, 6);
  });

  it("accepts an explicit pulsar list", () => {
    const only = pulsarDelays([1, 0, 0], [pulsarAt(3)]);
    expect(only).toHaveLength(1);
    expect(only[0]?.name).toBe("B1821-24");
  });

  it("AC-17.0: prints one flavor line with signed delays", () => {
    const coords = heliocentricEcliptic(
      "pluto",
      new Date("2024-01-01T00:00:00.000Z"),
    );
    const line = formatPulsarFix(coords);
    expect(line.split("\n")).toHaveLength(1);
    expect(line.startsWith("pulsar fix  ")).toBe(true);
    for (const pulsar of NAVIGATION_PULSARS) {
      expect(line).toContain(pulsar.name);
    }
    expect(line).toMatch(/[+−]\d+\.\d s/u);
  });

  it("AC-17.0: uses U+2212 for a negative delay and + for a positive one", () => {
    const negative = formatPulsarFix({
      lambdaDeg: 0,
      betaDeg: 0,
      rAu: 1,
      xyzAu: [-1, 0, 0],
      keplerIterations: 1,
      keplerConverged: true,
    });
    const positive = formatPulsarFix({
      lambdaDeg: 0,
      betaDeg: 0,
      rAu: 1,
      xyzAu: [1, 0, 0],
      keplerIterations: 1,
      keplerConverged: true,
    });
    const delayTokens = (line: string) => line.match(/[+−]\d+\.\d s/gu);
    expect(delayTokens(negative)).toHaveLength(NAVIGATION_PULSARS.length);
    expect(delayTokens(negative)?.every((t) => t.startsWith(MINUS_SIGN))).toBe(
      true,
    );
    expect(delayTokens(positive)).toHaveLength(NAVIGATION_PULSARS.length);
    expect(delayTokens(positive)?.every((t) => t.startsWith("+"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The Beacon scene's single entry point
// ---------------------------------------------------------------------------

describe("beaconReadout", () => {
  it("AC-17.0: returns both display lines plus the raw numbers", () => {
    const date = new Date("2024-01-01T00:00:00.000Z");
    const readout = beaconReadout("mars", date);
    const coords = heliocentricEcliptic("mars", date);
    expect(readout.ok).toBe(true);
    if (!readout.ok) throw new Error("expected a readout");
    expect(readout.coordsLine).toBe(formatBeaconCoords(coords));
    expect(readout.pulsarLine).toBe(formatPulsarFix(coords));
    expect(readout.lambdaDeg).toBe(coords.lambdaDeg);
    expect(readout.betaDeg).toBe(coords.betaDeg);
    expect(readout.rAu).toBe(coords.rAu);
  });

  it("is deterministic across every stop", () => {
    const date = new Date("2026-09-16T12:00:00.000Z");
    for (const stop of STOP_IDS) {
      expect(beaconReadout(stop, date)).toEqual(beaconReadout(stop, date));
    }
  });
});

// ---------------------------------------------------------------------------
// Bad input never reaches the screen
// ---------------------------------------------------------------------------

describe("invalid input policy", () => {
  const INVALID = new Date("oops");
  const TOO_EARLY = new Date("1700-01-01T00:00:00.000Z");
  const TOO_LATE = new Date("2200-01-01T00:00:00.000Z");

  it("classifies a bad Julian date", () => {
    expect(classifyJd(2460310.5)).toBeNull();
    expect(classifyJd(Number.NaN)).toBe("invalid-date");
    expect(classifyJd(Number.POSITIVE_INFINITY)).toBe("invalid-date");
    expect(classifyJd(TABLE_VALID_FROM_JD - 1)).toBe("outside-table");
    expect(classifyJd(TABLE_VALID_TO_JD + 1)).toBe("outside-table");
  });

  it("AC-17.0: an Invalid Date never renders as the text \"NaN\"", () => {
    // new Date("oops").getTime() is NaN; before the guard this produced the
    // literal line "lambda NaN deg  beta NaN deg  r NaN AU" on screen.
    const result = beaconReadout("mars", INVALID);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failure");
    expect(result.reason).toBe("invalid-date");
    expect(result.message).not.toContain("NaN");
    expect(JSON.stringify(result)).not.toContain("NaN");
  });

  it("AC-17.0: a date outside 1800-2050 is refused, not silently wrong", () => {
    for (const date of [TOO_EARLY, TOO_LATE]) {
      const result = beaconReadout("pluto", date);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected a failure");
      expect(result.reason).toBe("outside-table");
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it("still succeeds on the play date and at both window edges", () => {
    expect(beaconReadout("mars", new Date("2026-09-16T00:00:00.000Z")).ok).toBe(
      true,
    );
    expect(beaconReadout("mars", dateFromJulian(TABLE_VALID_FROM_JD)).ok).toBe(
      true,
    );
    expect(beaconReadout("mars", dateFromJulian(TABLE_VALID_TO_JD)).ok).toBe(
      true,
    );
  });

  it("throws EphemerisError from the low-level entry points", () => {
    expect(() => heliocentricEcliptic("mars", INVALID)).toThrow(EphemerisError);
    expect(() => heliocentricEclipticAtJd("mars", Number.NaN)).toThrow(
      /not finite/u,
    );
    expect(() => heliocentricEclipticAtJd("mars", 1000000)).toThrow(
      /outside the 1800-2050 element table/u,
    );
    try {
      heliocentricEclipticAtJd("mars", Number.NaN);
      throw new Error("unreachable");
    } catch (error) {
      expect(error).toBeInstanceOf(EphemerisError);
      expect((error as EphemerisError).reason).toBe("invalid-date");
      expect((error as EphemerisError).name).toBe("EphemerisError");
    }
  });

  it("surfaces a Kepler divergence instead of using a half-solved anomaly", () => {
    // Forced through the options seam; unreachable with the real defaults,
    // which the 250-year sweep asserts.
    expect(() =>
      heliocentricEclipticAtJd("pluto", 2460310.5, {
        toleranceRad: 1e-15,
        maxIterations: 1,
      }),
    ).toThrow(/did not converge/u);
    try {
      heliocentricEcliptic("pluto", new Date("2024-01-01T00:00:00.000Z"), {
        toleranceRad: 1e-15,
        maxIterations: 1,
      });
      throw new Error("unreachable");
    } catch (error) {
      expect((error as EphemerisError).reason).toBe("kepler-diverged");
    }
  });

  it("refuses to format a non-finite number", () => {
    expect(() => formatSigned(Number.NaN, 1)).toThrow(EphemerisError);
    expect(() => formatSigned(Number.POSITIVE_INFINITY, 2)).toThrow(
      /Cannot format/u,
    );
    expect(() => formatLongitude(Number.NaN)).toThrow(EphemerisError);
  });
});

describe("AC-17.1: lambda never renders as 360.0", () => {
  it("wraps a longitude that rounds up to 360 back to 0.0", () => {
    expect(formatLongitude(359.96)).toBe("0.0");
    expect(formatLongitude(359.9999)).toBe("0.0");
    expect(formatLongitude(359.94)).toBe("359.9");
    expect(formatLongitude(0)).toBe("0.0");
  });

  it("holds for a real date where Earth sits at lambda 359.96", () => {
    // jd 2451810.18: Earth's true longitude is 359.957, which rounds to 360.0
    // and would contradict the [0, 360) range AC-17.1 states.
    const coords = heliocentricEclipticAtJd("earth", 2451810.18);
    expect(coords.lambdaDeg).toBeGreaterThan(359.95);
    expect(coords.lambdaDeg).toBeLessThan(360);
    const line = formatBeaconCoords(coords);
    expect(line).not.toContain("360.0");
    expect(line).toContain(`${LAMBDA_SIGN} 0.0${DEGREE_SIGN}`);
  });

  it("never prints a longitude of 360.0 over a full Earth year", () => {
    for (let hour = 0; hour <= 366 * 24; hour += 1) {
      const line = formatBeaconCoords(
        heliocentricEclipticAtJd("earth", 2451545.0 + hour / 24),
      );
      expect(line).not.toContain(`${LAMBDA_SIGN} 360.0`);
    }
  });
});
