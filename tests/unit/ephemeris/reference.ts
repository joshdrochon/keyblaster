import type { StopId } from "@engine/types.js";

/**
 * AC-17.1 reference ephemeris.
 *
 * PROVENANCE - read this before changing a number.
 *
 * These are NOT produced by the code under test. They come from NASA/JPL
 * Horizons (API v1.2), which integrates the DE441 numerical ephemeris - a
 * completely different method from the approximate Keplerian elements this
 * module implements. That independence is the entire point: a fixture derived
 * from our own solver would make AC-17.1 vacuous.
 *
 * Exact query, one per body, run 2026-09-16:
 *
 *   GET https://ssd.jpl.nasa.gov/api/horizons.api
 *     format=text  OBJ_DATA='NO'  MAKE_EPHEM='YES'
 *     EPHEM_TYPE='VECTORS'  VEC_TABLE='1'
 *     CENTER='500@10'            (Sun body centre)
 *     REF_PLANE='ECLIPTIC'       (ecliptic and mean equinox of J2000.0)
 *     OUT_UNITS='AU-D'
 *     TLIST=2451545.0,2460310.5,2469807.5
 *     COMMAND='3'|'4'|'5'|'6'|'7'|'8'|'9'
 *
 * COMMAND values are the system barycentres (Earth-Moon, Mars, Jupiter,
 * Saturn, Uranus, Neptune, Pluto), because the JPL approximate-elements table
 * tabulates barycentres. All rows report {source: DE441}.
 *
 * Horizons returns rectangular X/Y/Z in AU. The λ/β/r below are the direct
 * spherical conversion of those vectors:
 *   r = |v|,  λ = atan2(y, x) wrapped to [0, 360),  β = asin(z / r).
 * No other transformation is applied.
 *
 * Horizons timestamps are TDB; our JD is UT. The ~70 s difference moves Earth,
 * the fastest body here, by 0.0008° - four orders of magnitude inside the
 * ±1° tolerance.
 */

export interface ReferenceCoords {
  readonly lambdaDeg: number;
  readonly betaDeg: number;
  readonly rAu: number;
}

export interface ReferenceEpoch {
  /** Julian date the fixture was requested at. */
  readonly jd: number;
  /** The same instant as an ISO string, for readable test names. */
  readonly iso: string;
  readonly bodies: Readonly<Record<StopId, ReferenceCoords>>;
}

/**
 * Three fixed dates spanning the table's 1800-2050 fit window near its modern
 * end: the J2000 epoch itself, a recent date, and the last day the table is
 * published for.
 */
export const REFERENCE_EPOCHS: readonly ReferenceEpoch[] = [
  {
    jd: 2451545.0,
    iso: "2000-01-01T12:00:00.000Z",
    bodies: {
      earth: { lambdaDeg: 100.3794, betaDeg: -0.0001, rAu: 0.98331 },
      mars: { lambdaDeg: 359.4473, betaDeg: -1.4197, rAu: 1.391208 },
      jupiter: { lambdaDeg: 36.2946, betaDeg: -1.1746, rAu: 4.965381 },
      saturn: { lambdaDeg: 45.7222, betaDeg: -2.3032, rAu: 9.183848 },
      uranus: { lambdaDeg: 316.4186, betaDeg: -0.6848, rAu: 19.924025 },
      neptune: { lambdaDeg: 303.9289, betaDeg: 0.242, rAu: 30.12058 },
      pluto: { lambdaDeg: 250.5462, betaDeg: 11.1615, rAu: 30.223246 },
    },
  },
  {
    jd: 2460310.5,
    iso: "2024-01-01T00:00:00.000Z",
    bodies: {
      earth: { lambdaDeg: 99.7118, betaDeg: -0.0031, rAu: 0.983337 },
      mars: { lambdaDeg: 258.5711, betaDeg: -0.8984, rAu: 1.480661 },
      jupiter: { lambdaDeg: 45.503, betaDeg: -1.0681, rAu: 4.984897 },
      saturn: { lambdaDeg: 337.5551, betaDeg: -1.7266, rAu: 9.737826 },
      uranus: { lambdaDeg: 51.27, betaDeg: -0.2987, rAu: 19.613432 },
      neptune: { lambdaDeg: 356.5657, betaDeg: -1.2471, rAu: 29.903754 },
      pluto: { lambdaDeg: 299.5646, betaDeg: -2.8384, rAu: 34.922868 },
    },
  },
  {
    jd: 2469807.5,
    iso: "2050-01-01T00:00:00.000Z",
    bodies: {
      earth: { lambdaDeg: 100.0488, betaDeg: -0.0063, rAu: 0.983354 },
      mars: { lambdaDeg: 198.0726, betaDeg: 0.96, rAu: 1.623547 },
      jupiter: { lambdaDeg: 117.142, betaDeg: 0.3713, rAu: 5.241359 },
      saturn: { lambdaDeg: 298.5125, betaDeg: -0.2173, rAu: 9.984814 },
      uranus: { lambdaDeg: 167.1323, betaDeg: 0.7704, rAu: 18.284014 },
      neptune: { lambdaDeg: 54.2839, betaDeg: -1.7282, rAu: 29.816752 },
      pluto: { lambdaDeg: 337.9999, betaDeg: -12.8497, rAu: 41.434132 },
    },
  },
] as const;

/** The tolerances AC-17.1 writes down. The suite must satisfy these. */
export const AC_LAMBDA_TOLERANCE_DEG = 1;
export const AC_BETA_TOLERANCE_DEG = 1;
export const AC_R_TOLERANCE_AU = 0.05;

/**
 * The tolerances the tests actually assert at, and why they are tighter.
 *
 * Asserting at the AC's ±1° leaves enormous slack: the approximate-elements
 * method's real worst error against DE441 at these three epochs is 0.144° in
 * λ (Saturn at J2000), 0.0055° in β (Saturn in 2050) and 0.0115 AU in r
 * (Saturn at J2000). A fixture checked at ±1° therefore does not notice a
 * corrupted element - a 1-in-the-integer-place error in Earth's mean-longitude
 * rate moves λ by only 0.2° and sails through, while visibly changing what the
 * player reads off a display that prints to 0.1°.
 *
 * These bounds sit at roughly 2-3x the measured worst case: loose enough that
 * an ordinary floating-point or TDB/UT difference cannot trip them, tight
 * enough that mutating any single element field fails the suite. They are
 * strictly inside the AC bounds, which a test asserts, so passing here implies
 * passing AC-17.1.
 */
export const LAMBDA_TOLERANCE_DEG = 0.3;
export const BETA_TOLERANCE_DEG = 0.02;
export const R_TOLERANCE_AU = 0.03;

/**
 * Published orbital bounds, used for range checks that do NOT read the element
 * table under test.
 *
 * Perihelion and aphelion are the NASA Planetary Fact Sheet values converted
 * from 10^6 km to AU; inclinations are to the ecliptic, same source (Pluto
 * from the NASA Pluto fact sheet). Checking r and β against these rather than
 * against `ELEMENTS[...]` is what makes them real constraints on a and e
 * instead of restatements of the table.
 */
export interface PublishedOrbit {
  readonly perihelionAu: number;
  readonly aphelionAu: number;
  readonly inclinationDeg: number;
}

export const PUBLISHED_ORBITS: Readonly<Record<StopId, PublishedOrbit>> = {
  earth: { perihelionAu: 0.9833, aphelionAu: 1.0167, inclinationDeg: 0.0 },
  mars: { perihelionAu: 1.3814, aphelionAu: 1.666, inclinationDeg: 1.85 },
  jupiter: { perihelionAu: 4.9501, aphelionAu: 5.457, inclinationDeg: 1.304 },
  saturn: { perihelionAu: 9.0412, aphelionAu: 10.1238, inclinationDeg: 2.485 },
  uranus: { perihelionAu: 18.2861, aphelionAu: 20.0965, inclinationDeg: 0.773 },
  neptune: { perihelionAu: 29.81, aphelionAu: 30.33, inclinationDeg: 1.77 },
  pluto: { perihelionAu: 29.658, aphelionAu: 49.305, inclinationDeg: 17.16 },
};

/**
 * Slack on the published bounds. The elements drift secularly across the
 * 250-year window, and the fact-sheet figures are themselves rounded, so a
 * tight band would be a flaky test rather than a strict one. At 1% this still
 * catches a mis-keyed a or e - 1% of Uranus's orbit is 0.19 AU.
 */
export const ORBIT_BAND_SLACK = 0.01;

/** Smallest signed difference between two angles, degrees. */
export function angleDeltaDeg(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

/**
 * JPL Table 1 (1800 AD - 2050 AD), transcribed independently of
 * `src/engine/ephemeris/elements.ts`, in the source's own column order:
 * a, e, I, L, long.peri.(ϖ), long.node.(Ω), then the same six as rates per
 * Julian century.
 *
 * This is a mutation guard, not a correctness proof - the DE441 fixture above
 * is what proves the numbers are right. What this adds is that a later edit to
 * any one of the 84 fields fails a test by name, instead of drifting the
 * display by a tenth of a degree and passing.
 */
export const EXPECTED_ELEMENT_TABLE: Readonly<
  Record<StopId, { readonly at: readonly number[]; readonly perCentury: readonly number[] }>
> = {
  earth: {
    at: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
    perCentury: [
      0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0,
    ],
  },
  mars: {
    at: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    perCentury: [
      0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088,
      -0.29257343,
    ],
  },
  jupiter: {
    at: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    perCentury: [
      -0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668,
      0.20469106,
    ],
  },
  saturn: {
    at: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    perCentury: [
      -0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216,
      -0.28867794,
    ],
  },
  uranus: {
    at: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503],
    perCentury: [
      -0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281,
      0.04240589,
    ],
  },
  neptune: {
    at: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
    perCentury: [
      0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664,
    ],
  },
  pluto: {
    at: [39.48211675, 0.2488273, 17.14001206, 238.92903833, 224.06891629, 110.30393684],
    perCentury: [
      -0.00031596, 0.0000517, 0.00004818, 145.20780515, -0.04062942, -0.01183482,
    ],
  },
};

/** The element fields, in JPL's column order. */
export const ELEMENT_FIELD_ORDER = [
  "aAu",
  "e",
  "iDeg",
  "lDeg",
  "varPiDeg",
  "omegaDeg",
] as const;
