import { DEG_TO_RAD } from "./kepler.js";

/**
 * The pulsar-navigation flavor line (D15, D81, AC-17.0).
 *
 * D15 grounds this in NASA SEXTANT and the Pioneer/Voyager plaque: a real
 * spacecraft fixes its position by timing millisecond pulsars, so the beacon
 * prints one too. It is flavor, but it is not invented flavor - the figure
 * shown is the actual light-travel delay of the beacon's position along each
 * pulsar's line of sight, which is the quantity a pulsar navigator really
 * solves for.
 *
 * Because a grades 2-5 player may well go and look these up, every claim in
 * this file is sourced. Nothing here is approximated for effect.
 */

/** Light seconds in one astronomical unit (IAU 2012 definition of the au). */
export const AU_LIGHT_SECONDS = 499.00478384;

/** Obliquity of the ecliptic at J2000.0, degrees (IAU 2006). */
export const OBLIQUITY_J2000_DEG = 23.4392911;

export interface Pulsar {
  /**
   * Catalogue designation as printed. Pulsar names use an ASCII hyphen as the
   * declination sign separator - "B1821-24" is the catalogue spelling, not a
   * minus sign, so this string is deliberately NOT U+2212 (unlike the numeric
   * fields, which follow D81).
   */
  readonly name: string;
  /** Right ascension, J2000, degrees. */
  readonly raDeg: number;
  /** Declination, J2000, degrees. */
  readonly decDeg: number;
  /** Barycentric spin period P0, milliseconds. */
  readonly periodMs: number;
}

/**
 * The four millisecond pulsars NICER/SEXTANT actually tracked during the
 * November 2017 ISS demonstration - the first X-ray pulsar navigation fix in
 * space (NASA Goddard, "NASA Team First to Demonstrate X-ray Navigation in
 * Space", 11 Jan 2018).
 *
 * B1937+21 is the famous first-discovered millisecond pulsar and is a common
 * stand-in in write-ups, but it was NOT one of the four SEXTANT targets. It is
 * deliberately absent.
 *
 * Positions (RAJD/DECJD) and periods (P0) are the ATNF Pulsar Catalogue
 * v2.8.1 values, queried 2026-09-16 from
 * https://www.atnf.csiro.au/research/pulsar/psrcat/ . B1821-24 is catalogued
 * under its J-name J1824-2452A; SEXTANT publications use the B-name, so that
 * is what the beacon prints.
 */
export const NAVIGATION_PULSARS: readonly Pulsar[] = [
  { name: "J0030+0451", raDeg: 7.61428128, decDeg: 4.861031, periodMs: 4.86545329 },
  { name: "J0218+4232", raDeg: 34.526494038, decDeg: 42.53815976, periodMs: 2.32309053 },
  { name: "J0437-4715", raDeg: 69.316872576, decDeg: -47.252783951, periodMs: 5.75745194 },
  { name: "B1821-24", raDeg: 276.13336627, decDeg: -24.8696885, periodMs: 3.05431576 },
] as const;

/** Unit vector toward a pulsar, in the J2000 ecliptic frame. */
export function pulsarEclipticUnitVector(
  pulsar: Pulsar,
): readonly [number, number, number] {
  const ra = pulsar.raDeg * DEG_TO_RAD;
  const dec = pulsar.decDeg * DEG_TO_RAD;
  const xq = Math.cos(dec) * Math.cos(ra);
  const yq = Math.cos(dec) * Math.sin(ra);
  const zq = Math.sin(dec);
  const eps = OBLIQUITY_J2000_DEG * DEG_TO_RAD;
  // Rotation about the equinox axis turns equatorial into ecliptic.
  return [
    xq,
    yq * Math.cos(eps) + zq * Math.sin(eps),
    -yq * Math.sin(eps) + zq * Math.cos(eps),
  ];
}

export interface PulsarDelay {
  readonly name: string;
  /** Light-travel delay of the beacon along this pulsar's line of sight. */
  readonly seconds: number;
}

/**
 * Project a heliocentric ecliptic position onto each pulsar direction - the
 * Roemer delay of pulsar timing.
 *
 * Positive means the beacon sits on the pulsar's side of the Sun, so a pulse
 * reaches it that many seconds EARLIER than it reaches a clock at the Sun.
 */
export function pulsarDelays(
  position: readonly [number, number, number],
  pulsars: readonly Pulsar[] = NAVIGATION_PULSARS,
): readonly PulsarDelay[] {
  const [x, y, z] = position;
  return pulsars.map((pulsar) => {
    const [ux, uy, uz] = pulsarEclipticUnitVector(pulsar);
    return {
      name: pulsar.name,
      seconds: (x * ux + y * uy + z * uz) * AU_LIGHT_SECONDS,
    };
  });
}
