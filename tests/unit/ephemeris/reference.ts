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

/** Tolerances written into AC-17.1. */
export const LAMBDA_TOLERANCE_DEG = 1;
export const BETA_TOLERANCE_DEG = 1;
export const R_TOLERANCE_AU = 0.05;

/** Smallest signed difference between two angles, degrees. */
export function angleDeltaDeg(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180;
}
