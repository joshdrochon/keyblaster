import { DEG_TO_RAD } from "./kepler.js";

/**
 * The pulsar-navigation flavor line (D15, D81, AC-17.0).
 *
 * D15 grounds this in NASA SEXTANT and the Pioneer/Voyager plaque: a real
 * spacecraft fixes its position by timing millisecond pulsars, so the beacon
 * prints one too. It is flavor, but it is not invented flavor - the number
 * shown is the actual barycentric light-travel delay of the beacon's position
 * along each pulsar's line of sight, which is the quantity a pulsar navigator
 * really solves for.
 */

/** Light seconds in one astronomical unit (IAU 2012 definition). */
export const AU_LIGHT_SECONDS = 499.00478384;

/** Obliquity of the ecliptic at J2000.0, degrees. */
export const OBLIQUITY_J2000_DEG = 23.4392911;

export interface Pulsar {
  /** Catalogue designation as printed. */
  readonly name: string;
  /** Right ascension, J2000, degrees. */
  readonly raDeg: number;
  /** Declination, J2000, degrees. */
  readonly decDeg: number;
  /** Spin period, milliseconds. Shown nowhere yet; kept for the beacon UI. */
  readonly periodMs: number;
}

/**
 * The three millisecond pulsars SEXTANT actually tracked on the ISS.
 * Coordinates are the J2000 catalogue positions.
 */
export const NAVIGATION_PULSARS: readonly Pulsar[] = [
  { name: "B1937+21", raDeg: 294.91064, decDeg: 21.58309, periodMs: 1.5578 },
  { name: "J0437−4715", raDeg: 69.31632, decDeg: -47.25248, periodMs: 5.7575 },
  { name: "B1821−24", raDeg: 276.13336, decDeg: -24.86972, periodMs: 3.0543 },
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
 * Project a heliocentric ecliptic position onto each pulsar direction.
 * Positive means the beacon sits on the pulsar's side of the Sun, so its
 * pulses arrive early relative to a Sun-centred clock.
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
