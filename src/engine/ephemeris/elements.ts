import type { StopId } from "../types.js";

/**
 * Keplerian elements and their per-century rates, all angles in degrees and
 * `a` in astronomical units.
 *
 * `L` is the mean longitude, `varPi` the longitude of perihelion (ϖ) and
 * `omega` the longitude of the ascending node (Ω). Mean anomaly is derived as
 * M = L − ϖ rather than tabulated (architecture section 4.5).
 */
export interface KeplerianElements {
  readonly aAu: number;
  readonly e: number;
  readonly iDeg: number;
  readonly lDeg: number;
  readonly varPiDeg: number;
  readonly omegaDeg: number;
}

/** Same six quantities, expressed as change per Julian century. */
export type KeplerianRates = KeplerianElements;

export interface ElementSet {
  readonly at: KeplerianElements;
  readonly perCentury: KeplerianRates;
}

/**
 * JPL "Keplerian Elements for Approximate Positions of the Major Planets",
 * Table 1: the 1800 AD – 2050 AD set, referred to the mean ecliptic and
 * equinox of J2000 (D15, AC-17.1).
 *
 * AC-17.2 pins Pluto to *this* table specifically. JPL publishes a second
 * table valid 3000 BC – 3000 AD whose Pluto row carries extra b/c/s/f
 * correction terms; that table is deliberately NOT used here, so the mean
 * anomaly stays the plain M = L − ϖ the architecture specifies.
 *
 * Earth's row is the Earth–Moon barycentre ("EM Bary" in the source table).
 * The barycentre sits ~4700 km from Earth's centre, i.e. 3e-5 AU and under
 * 0.003° of longitude, which is two orders of magnitude inside the ±1° /
 * ±0.05 AU tolerance AC-17.1 asks for.
 *
 * Mars, Jupiter, Saturn, Uranus, Neptune and Pluto rows are likewise the
 * system barycentres, as published.
 */
export const ELEMENTS: Readonly<Record<StopId, ElementSet>> = {
  earth: {
    at: {
      aAu: 1.00000261,
      e: 0.01671123,
      iDeg: -0.00001531,
      lDeg: 100.46457166,
      varPiDeg: 102.93768193,
      omegaDeg: 0.0,
    },
    perCentury: {
      aAu: 0.00000562,
      e: -0.00004392,
      iDeg: -0.01294668,
      lDeg: 35999.37244981,
      varPiDeg: 0.32327364,
      omegaDeg: 0.0,
    },
  },
  mars: {
    at: {
      aAu: 1.52371034,
      e: 0.0933941,
      iDeg: 1.84969142,
      lDeg: -4.55343205,
      varPiDeg: -23.94362959,
      omegaDeg: 49.55953891,
    },
    perCentury: {
      aAu: 0.00001847,
      e: 0.00007882,
      iDeg: -0.00813131,
      lDeg: 19140.30268499,
      varPiDeg: 0.44441088,
      omegaDeg: -0.29257343,
    },
  },
  jupiter: {
    at: {
      aAu: 5.202887,
      e: 0.04838624,
      iDeg: 1.30439695,
      lDeg: 34.39644051,
      varPiDeg: 14.72847983,
      omegaDeg: 100.47390909,
    },
    perCentury: {
      aAu: -0.00011607,
      e: -0.00013253,
      iDeg: -0.00183714,
      lDeg: 3034.74612775,
      varPiDeg: 0.21252668,
      omegaDeg: 0.20469106,
    },
  },
  saturn: {
    at: {
      aAu: 9.53667594,
      e: 0.05386179,
      iDeg: 2.48599187,
      lDeg: 49.95424423,
      varPiDeg: 92.59887831,
      omegaDeg: 113.66242448,
    },
    perCentury: {
      aAu: -0.0012506,
      e: -0.00050991,
      iDeg: 0.00193609,
      lDeg: 1222.49362201,
      varPiDeg: -0.41897216,
      omegaDeg: -0.28867794,
    },
  },
  uranus: {
    at: {
      aAu: 19.18916464,
      e: 0.04725744,
      iDeg: 0.77263783,
      lDeg: 313.23810451,
      varPiDeg: 170.9542763,
      omegaDeg: 74.01692503,
    },
    perCentury: {
      aAu: -0.00196176,
      e: -0.00004397,
      iDeg: -0.00242939,
      lDeg: 428.48202785,
      varPiDeg: 0.40805281,
      omegaDeg: 0.04240589,
    },
  },
  neptune: {
    at: {
      aAu: 30.06992276,
      e: 0.00859048,
      iDeg: 1.77004347,
      lDeg: -55.12002969,
      varPiDeg: 44.96476227,
      omegaDeg: 131.78422574,
    },
    perCentury: {
      aAu: 0.00026291,
      e: 0.00005105,
      iDeg: 0.00035372,
      lDeg: 218.45945325,
      varPiDeg: -0.32241464,
      omegaDeg: -0.00508664,
    },
  },
  pluto: {
    at: {
      aAu: 39.48211675,
      e: 0.2488273,
      iDeg: 17.14001206,
      lDeg: 238.92903833,
      varPiDeg: 224.06891629,
      omegaDeg: 110.30393684,
    },
    perCentury: {
      aAu: -0.00031596,
      e: 0.0000517,
      iDeg: 0.00004818,
      lDeg: 145.20780515,
      varPiDeg: -0.04062942,
      omegaDeg: -0.01183482,
    },
  },
};

/** Julian date of the J2000.0 epoch, 2000-01-01 12:00 TT. */
export const J2000_JD = 2451545.0;

/** Days in a Julian century, the unit T is measured in. */
export const DAYS_PER_JULIAN_CENTURY = 36525;

/**
 * The table is fitted over 1800–2050. Callers outside that window still get an
 * answer (the maths does not blow up), but `isWithinTableValidity` lets a UI
 * or a test say so. The game only ever asks for "today", so this is a guard
 * against a bad injected clock, not a real code path.
 */
export const TABLE_VALID_FROM_JD = 2378496.5; // 1800-01-01T00:00:00Z
export const TABLE_VALID_TO_JD = 2469807.5; // 2050-01-01T00:00:00Z

export function isWithinTableValidity(jd: number): boolean {
  return jd >= TABLE_VALID_FROM_JD && jd <= TABLE_VALID_TO_JD;
}

/**
 * Linearly propagate every element to time `t`, in Julian centuries past
 * J2000. This is the whole of step 1 in architecture section 4.5.
 */
export function elementsAt(planet: StopId, t: number): KeplerianElements {
  const set = ELEMENTS[planet];
  return {
    aAu: set.at.aAu + set.perCentury.aAu * t,
    e: set.at.e + set.perCentury.e * t,
    iDeg: set.at.iDeg + set.perCentury.iDeg * t,
    lDeg: set.at.lDeg + set.perCentury.lDeg * t,
    varPiDeg: set.at.varPiDeg + set.perCentury.varPiDeg * t,
    omegaDeg: set.at.omegaDeg + set.perCentury.omegaDeg * t,
  };
}
